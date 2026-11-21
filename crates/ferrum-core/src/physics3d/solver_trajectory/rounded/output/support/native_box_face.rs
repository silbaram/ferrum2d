//! Original rounded support of a rotating box against an immobile cardinal face.
use super::super::{frames, Float, Frame, Translation};
use crate::physics3d::solver_trajectory::rounded::FacePrefix;
use crate::physics3d::solver_trajectory::{
    constant_pose, Curve, ShapeMotion, Time, TrajectoryError, Work,
};
use rapier3d::prelude as rp;

struct Face {
    body: ShapeMotion,
    solid: rp::Vector,
    floor: rp::Pose,
    half: rp::Vector,
    axis: usize,
    sign: f32,
    coordinate: f32,
}

impl Face {
    fn new(
        a: ShapeMotion,
        ca: &rapier3d::parry::shape::Cuboid,
        b: ShapeMotion,
        cb: &rapier3d::parry::shape::Cuboid,
        normal: rp::Vector,
        start: Time,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        if normal.to_array().iter().filter(|&&x| x != 0.).count() != 1 {
            return Ok(None);
        }
        let turning = |m: ShapeMotion| {
            matches!(
                m.curve, Curve::Integrated(k) if k.native.angular_velocity != rp::Vector::ZERO
            )
        };
        let (floor, half, body, solid, n) = match (turning(a), turning(b)) {
            (false, true) => (a, ca, b, cb, normal),
            (true, false) => (b, cb, a, ca, -normal),
            _ => return Ok(None),
        };
        work.charge(384)?;
        if constant_pose(floor.curve).is_none() {
            return Ok(None);
        }
        // A face resting flat can rock across the floor normal within a
        // single native pass. Keep that original contact chronology when
        // the dominant component of its local normal still rounds to one.
        let local_normal = body.metered_pose(start, work)?.rotation.inverse() * n;
        if !local_normal.is_finite() || local_normal.abs().max_element() >= 1. {
            return Ok(None);
        }
        let axis = n.abs().max_position();
        let sign = n[axis];
        let pose = floor.pose(start);
        let half = half.half_extents;
        let solid = solid.half_extents;
        if sign.abs() != 1.
            || !pose.is_finite()
            || pose.rotation != rp::Rotation::IDENTITY
            || !half.is_finite()
            || !solid.is_finite()
            || half.min_element() < 0.
            || solid.min_element() < 0.
            || !(pose.translation - half).is_finite()
            || !(pose.translation + half).is_finite()
        {
            return Ok(None);
        }
        Ok(Some(Self {
            body,
            solid,
            floor: pose,
            half,
            axis,
            sign,
            coordinate: pose.translation[axis] + sign * half[axis],
        }))
    }

    fn separated(&self, start: Time, end: Time, work: &mut Work) -> Result<bool, TrajectoryError> {
        let Some(poses) = frames(self.body.curve, start, end, work)? else {
            return Ok(false);
        };
        for frame in &poses.values[..poses.len] {
            let frame = frame.shape(self.body);
            if !frame_separated(
                frame,
                self.solid,
                self.axis,
                self.sign,
                self.coordinate,
                work,
            )? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    // Supply an actual common point as well as the Native manifold witness.
    // Reconstructing the very same F32 point from an in-box local coordinate
    // avoids assigning a contact to an extension of a finite face.
    fn contains_vertex(&self, time: Time, work: &mut Work) -> Result<bool, TrajectoryError> {
        let pose = self.body.metered_pose(time, work)?;
        for ix in [-1., 1.] {
            for iy in [-1., 1.] {
                for iz in [-1., 1.] {
                    work.charge(128)?;
                    let point = pose * (self.solid * rp::Vector::new(ix, iy, iz));
                    let local = self.floor.inverse_transform_point(point);
                    if local.is_finite()
                        && local.abs().cmple(self.half).all()
                        && self.floor * local == point
                    {
                        return Ok(true);
                    }
                }
            }
        }
        Ok(false)
    }
}

fn sign_product(a: Float, b: Float) -> (bool, bool) {
    // Use factor signs directly. Multiplying tiny factors can round to zero
    // before the original graph multiplies either factor by its coordinate.
    let same = a.lo >= 0. && b.lo >= 0. || a.hi <= 0. && b.hi <= 0.;
    let opposite = a.lo >= 0. && b.hi <= 0. || a.hi <= 0. && b.lo >= 0.;
    (same, opposite)
}

fn frame_separated(
    frame: Frame,
    half: rp::Vector,
    axis: usize,
    sign: f32,
    face: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(320)?;
    let q = frame.rotation.components;
    let scalar = q[3]
        .mul(q[3])
        .sub(q[0].mul(q[0]).add(q[1].mul(q[1])).add(q[2].mul(q[2])));
    let mut cell: Translation = half.to_array().map(|x| Float::span(-x, x));
    let full = frame.point_range(cell);
    if full.iter().any(|bound| !bound.finite()) {
        return Ok(false);
    }
    let clears = |bound: Float| {
        if sign > 0. {
            bound.lo > face
        } else {
            bound.hi < face
        }
    };
    if clears(full[axis]) {
        return Ok(true);
    }
    let mut mixed = [0usize; 3];
    let mut count = 0;
    // Every occurrence of each local coordinate in Quat::mul_vec3 has a
    // known sign unless the diagonal, dot and cross contributions oppose.
    // Rounded multiply/add are monotone with their argument, ties included.
    for i in 0..3 {
        let dot = if axis == i {
            (true, false)
        } else {
            sign_product(q[axis], q[i])
        };
        let cross = if i == (axis + 1) % 3 {
            let (pos, neg) = sign_product(q[(axis + 2) % 3], q[3]);
            (neg, pos)
        } else if i == (axis + 2) % 3 {
            sign_product(q[(axis + 1) % 3], q[3])
        } else {
            (scalar.lo >= 0., scalar.hi <= 0.)
        };
        let direction = if dot.0 && cross.0 {
            1.
        } else if dot.1 && cross.1 {
            -1.
        } else {
            mixed[count] = i;
            count += 1;
            continue;
        };
        cell[i] = Float::exact(-sign * direction * half[i]);
    }
    if count > 0 {
        // The exact quaternion transform is affine in the material point.
        // Combining each coordinate's dot/cross coefficients before applying
        // its interval avoids treating one corner as several independent ones.
        // Enclose the original rounded point graph separately on the same cell.
        use super::{transform, Bound, IdealTransform, Value};
        work.charge(640)?;
        let local = Frame {
            translation: [Float::ZERO; 3],
            ..frame
        };
        let ideal = IdealTransform::new(local);
        let mut coordinate = Value::input(frame.translation[axis]).ideal;
        for i in 0..3 {
            let mut e = rp::Vector::ZERO;
            e[i] = 1.;
            coordinate = coordinate.add(ideal.point(e)[axis].mul(Value::input(cell[i]).ideal));
        }
        let error = transform(frame, cell.map(Value::input))[axis].error;
        if coordinate.finite() && error.is_finite() {
            let output = coordinate.add(Bound {
                lo: -error,
                hi: error,
            });
            if (sign > 0. && output.lo > f64::from(face))
                || (sign < 0. && output.hi < f64::from(face))
            {
                return Ok(true);
            }
        }
    }
    let mut pending = [(cell, 0usize); 9];
    let mut pending_count = 1;
    while pending_count > 0 {
        pending_count -= 1;
        let (cell, depth) = pending[pending_count];
        work.charge(224)?;
        let bound = frame.point_range(cell)[axis];
        if bound.finite() && clears(bound) {
            continue;
        }
        if count == 0 || depth == 8 {
            return Ok(false);
        }
        let i = mixed[depth % count];
        let mid = cell[i].lo.midpoint(cell[i].hi);
        if mid <= cell[i].lo || mid >= cell[i].hi {
            return Ok(false);
        }
        let mut left = cell;
        left[i].hi = mid;
        let mut right = cell;
        right[i].lo = mid;
        pending[pending_count] = (left, depth + 1);
        pending[pending_count + 1] = (right, depth + 1);
        pending_count += 2;
    }
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn native_box_face_cast(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    initial: rapier3d::parry::query::Contact,
    start: Time,
    end: Time,
    clearance: f32,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<FacePrefix>, TrajectoryError> {
    use crate::physics3d::solver_trajectory::leaf_contact;
    if clearance != 0. || initial.dist <= 0. {
        return Ok(None);
    }
    let (Some(ca), Some(cb)) = (sa.as_cuboid(), sb.as_cuboid()) else {
        return Ok(None);
    };
    let Some(face) = Face::new(a, ca, b, cb, initial.normal1, start, work)? else {
        return Ok(None);
    };
    let mut safe = start;
    let mut pending = [end; 49];
    let mut count = 1;
    let work_start = work.used;
    while count > 0 {
        if work.used - work_start > 4 * 1024 * 1024 {
            return Ok((safe > start).then_some(FacePrefix::Through(safe)));
        }
        let through = pending[count - 1];
        if face.separated(safe, through, work)? {
            safe = through;
            count -= 1;
            continue;
        }
        if through - safe <= tolerance {
            let time = (safe + tolerance).min(end);
            let time = if time - safe > tolerance {
                time.next_down()
            } else {
                time
            };
            if face.contains_vertex(time, work)? {
                let hit = leaf_contact(
                    &a.metered_pose(time, work)?,
                    sa,
                    &b.metered_pose(time, work)?,
                    sb,
                    work,
                )?;
                if !hit.dist.is_finite()
                    || !hit.point1.is_finite()
                    || !hit.point2.is_finite()
                    || !hit.normal1.is_finite()
                    || !hit.normal2.is_finite()
                {
                    return Err(TrajectoryError::NonFinite);
                }
                if hit.dist <= clearance {
                    return Ok(Some(FacePrefix::Boundary {
                        safe_time: safe,
                        hit_time: time,
                        witness: Some(hit),
                    }));
                }
            }
        }
        let mid = safe.midpoint(through);
        if count == pending.len() || mid <= safe || mid >= through {
            return Ok((safe > start).then_some(FacePrefix::Through(safe)));
        }
        pending[count] = mid;
        count += 1;
    }
    Ok(Some(FacePrefix::Separated))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::solver_trajectory::{leaf_contact, Domain, Kernel};

    #[test]
    fn rotating_box_requires_a_clear_prefix_and_an_original_finite_face_witness() {
        let duration = 0.02_f32;
        let end = Time::from(duration);
        let shape_motion = |curve| ShapeMotion {
            curve,
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let surface = shape_motion(Curve::Constant {
            pose: rp::Pose::from_translation(-rp::Vector::Y * 0.1),
            start_time: 0.,
            end_time: end,
        });
        let floor = rp::SharedShape::cuboid(1., 0.1, 1.);
        let solid = rp::SharedShape::cuboid(0.13, 0.1, 0.08);
        for (x, vy, tilt, crossing) in [
            (0., -5., 0.07, true),
            (0., 1., 0.07, false),
            (3., -5., 0.07, false),
            (0., -5., 0.0001, false),
        ] {
            let mover = shape_motion(Curve::Integrated(
                Kernel::from_velocity(
                    rp::RigidBodyHandle::invalid(),
                    Domain::new(0., end).unwrap(),
                    rp::Pose::from_parts(
                        rp::Vector::new(x, 0.17, 0.),
                        rp::Rotation::from_rotation_z(tilt),
                    ),
                    rp::Vector::new(0.03, vy, 0.),
                    rp::Vector::new(0.3, -0.1, 0.5),
                )
                .unwrap(),
            ));
            for (a, sa, b, sb) in [
                (surface, floor.as_ref(), mover, solid.as_ref()),
                (mover, solid.as_ref(), surface, floor.as_ref()),
            ] {
                let mut work = Work {
                    used: 0,
                    limit: 32 * 1024 * 1024,
                };
                let initial = leaf_contact(&a.pose(0.), sa, &b.pose(0.), sb, &mut work).unwrap();
                let result =
                    native_box_face_cast(a, sa, b, sb, initial, 0., end, 0., 1e-7, &mut work)
                        .unwrap();
                if let Some(FacePrefix::Boundary {
                    safe_time,
                    hit_time,
                    witness: Some(hit),
                }) = result
                {
                    assert!(
                        crossing
                            && safe_time > 0.
                            && safe_time < hit_time
                            && hit_time - safe_time <= 1e-7
                    );
                    assert!(
                        leaf_contact(&a.pose(safe_time), sa, &b.pose(safe_time), sb, &mut work)
                            .unwrap()
                            .dist
                            > 0.
                    );
                    assert!(hit.dist <= 0.);
                } else {
                    assert!(!crossing);
                    if x == 0. && vy > 0. {
                        assert!(matches!(result, Some(FacePrefix::Separated)));
                    } else if tilt == 0.0001 {
                        assert!(result.is_none(), "flat contact keeps the general cast");
                    }
                }
            }
        }
    }
}
