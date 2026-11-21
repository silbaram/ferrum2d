//! Bound the penetration along a fixed world face on both Native radius paths.
use super::*;

fn exact(x: f32) -> Bound {
    Bound::exact(f64::from(x))
}

fn dot(a: [Bound; 3], b: [Bound; 3]) -> Bound {
    a.into_iter()
        .zip(b)
        .fold(Bound::exact(0.), |s, (x, y)| s.add(x.mul(y)))
}

fn norm(v: [Bound; 3]) -> Bound {
    dot(v, v).sqrt()
}

fn projected_error(errors: [f64; 3], normal: rp::Vector) -> f64 {
    errors
        .into_iter()
        .zip(normal.to_array())
        .fold(0., |s, (e, n)| {
            upper_add(s, upper_mul(e, f64::from(n).abs()))
        })
}

/// The caller has established an unoffset translation kernel and supplied both
/// stored rotations and the constant normalized interior rotation.
#[allow(clippy::too_many_arguments)]
pub(super) fn fits(
    wall: rp::Pose,
    cube: &rp::Cuboid,
    actor: ShapeMotion,
    capsule: &rp::Capsule,
    rotations: [rp::Rotation; 3],
    normal: rp::Vector,
    epsilon: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Curve::Integrated(kernel) = actor.curve else {
        return Ok(false);
    };
    work.charge(2048)?;
    let n = normal.to_array().map(exact);
    let length = norm(n);
    if !length.finite() || length.lo <= 0. {
        return Ok(false);
    }
    let native = kernel.native;
    let h = native.integration_seconds;
    let t0 = native.motion.start.translation.to_array().map(exact);
    let v = native.linear_velocity.to_array().map(exact);
    // Keep dt shared until the ideal projection is evaluated. The scalar
    // native positions still have independent multiplication/addition rounding.
    let travel = dot(v, n).mul(Bound {
        lo: 0.,
        hi: f64::from(h),
    });
    let t = std::array::from_fn::<_, 3, _>(|i| {
        Value::input(Float::exact(native.motion.start.translation[i])).add(
            Value::input(Float::exact(native.linear_velocity[i]))
                .mul(Value::input(Float::span(0., h))),
        )
    });
    if !t.iter().all(|v| v.finite()) {
        return Ok(false);
    }
    let center_lo = dot(t0, n)
        .add(travel)
        .sub(Bound::exact(projected_error(t.map(|v| v.error), normal)))
        .lo;
    capsule_plane(
        wall,
        cube,
        t,
        center_lo,
        capsule,
        rotations,
        normal,
        length,
        Margin::Touching(epsilon),
        work,
    )
}

enum Margin {
    Touching(f32),
    Strict(f32),
}

/// A strictly clear actual pose can certify one element of a finite clock
/// image. Enclose the complete clearance-expanded capsule before clipping.
pub(in crate::physics3d::solver_trajectory::rounded::output::support) fn static_separated(
    wall: rp::Pose,
    cube: &rp::Cuboid,
    actor: rp::Pose,
    capsule: &rp::Capsule,
    normal: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if clearance < 0.
        || !clearance.is_finite()
        || !wall.is_finite()
        || !actor.is_finite()
        || !normal.is_finite()
        || !cube.half_extents.is_finite()
        || cube.half_extents.min_element() <= 0.
        || !capsule.radius.is_finite()
        || capsule.radius <= 0.
        || !capsule.segment.a.is_finite()
        || !capsule.segment.b.is_finite()
    {
        return Ok(false);
    }
    work.charge(512)?;
    let n = normal.to_array().map(exact);
    let length = norm(n);
    if length.lo <= 0. || !length.finite() {
        return Ok(false);
    }
    let center_lo = dot(actor.translation.to_array().map(exact), n).lo;
    let t = actor
        .translation
        .to_array()
        .map(|x| Value::input(Float::exact(x)));
    capsule_plane(
        wall,
        cube,
        t,
        center_lo,
        capsule,
        [actor.rotation; 3],
        normal,
        length,
        Margin::Strict(clearance),
        work,
    )
}

#[allow(clippy::too_many_arguments)]
fn capsule_plane(
    wall: rp::Pose,
    cube: &rp::Cuboid,
    t: [Value; 3],
    center_lo: f64,
    capsule: &rp::Capsule,
    rotations: [rp::Rotation; 3],
    normal: rp::Vector,
    length: Bound,
    margin: Margin,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let n = normal.to_array().map(exact);
    let expansion = match margin {
        Margin::Strict(c) | Margin::Touching(c) => c,
    };
    let points = [capsule.segment.a, capsule.segment.b];
    let radius = f64::from(capsule.radius);
    let core_radius = norm(points[0].to_array().map(exact))
        .hi
        .max(norm(points[1].to_array().map(exact)).hi);
    let mut capsule_lo = f64::INFINITY;
    let mut reach = 0.0_f64;
    for (index, q) in rotations.iter().copied().enumerate() {
        if rotations[..index].contains(&q) {
            continue;
        }
        work.charge(6144)?;
        let local_frame = Frame::exact(rp::Pose::from_rotation(q));
        let frame = Frame {
            translation: t.map(|v| v.actual),
            ..local_frame
        };
        let core = transform(frame, local_hull(&points, 0.));
        let full = transform(frame, local_hull(&points, capsule.radius));
        let expanded = core.map(|x| x.add(Value::local(0., capsule.radius)));
        if core
            .iter()
            .chain(&full)
            .chain(&expanded)
            .any(|v| !v.finite())
        {
            return Ok(false);
        }
        let errors = std::array::from_fn(|i| expanded[i].error.max(full[i].error));
        let scale = norm_squared_upper(local_frame.rotation.components);
        let radial = upper_mul(scale.max(1.), radius);
        // The shifted capsule lies in this sphere about its represented COM.
        // This covers an arbitrary convex combination of the core endpoints.
        reach = reach.max(upper_add(
            upper_add(upper_mul(scale, core_radius), radial),
            norm(errors.map(Bound::exact)).hi,
        ));
        let ideal = IdealTransform::new(local_frame);
        let offset = points
            .into_iter()
            .map(|p| dot(ideal.point(p), n).lo)
            .fold(f64::INFINITY, f64::min);
        let loss = upper_add(
            upper_mul(radial, length.hi),
            projected_error(errors, normal),
        );
        let lower = Bound::exact(center_lo)
            .add(Bound::exact(offset))
            .sub(Bound::exact(loss));
        if !lower.finite() || !reach.is_finite() {
            return Ok(false);
        }
        capsule_lo = capsule_lo.min(lower.lo);
    }

    // A far corner's rounding can be much larger than at the portion of a
    // wide floor that can meet this capsule. Restrict the box in its own frame
    // using an enclosure of all world points within the requested margin of
    // the capsule. Only this region can intersect the expanded or shifted shape.
    work.charge(8192)?;
    let wall_frame = Frame::exact(wall);
    let local = cube.half_extents.to_array().map(|h| Float::span(-h, h));
    let whole = transform(wall_frame, local.map(Value::input));
    if whole.iter().any(|v| !v.finite()) {
        return Ok(false);
    }
    let wall_error = norm(whole.map(|v| Bound::exact(v.error))).hi;
    let q = wall.rotation.to_array().map(exact);
    let scale = q
        .into_iter()
        .fold(Bound::exact(0.), |sum, v| sum.add(v.mul(v)));
    if !scale.finite() || scale.lo <= 0. {
        return Ok(false);
    }
    // Columns of the ideal quaternion map are orthogonal, of length |q|².
    // Recover each potentially colliding local coordinate via that column.
    let inverse_scale_squared = Bound {
        lo: (1. / scale.mul(scale).hi).next_down(),
        hi: (1. / scale.mul(scale).lo).next_up(),
    };
    let spread =
        (upper_add(upper_add(reach, f64::from(expansion)), wall_error) / scale.lo).next_up();
    let relative = std::array::from_fn(|i| {
        Bound {
            lo: f64::from(t[i].actual.lo),
            hi: f64::from(t[i].actual.hi),
        }
        .sub(exact(wall.translation[i]))
    });
    let ideal = IdealTransform::new(Frame::exact(rp::Pose::from_rotation(wall.rotation)));
    let mut clipped = local;
    let mut upper = dot(wall.translation.to_array().map(exact), n);
    for (i, axis) in [rp::Vector::X, rp::Vector::Y, rp::Vector::Z]
        .into_iter()
        .enumerate()
    {
        let column = ideal.point(axis);
        let range = dot(relative, column).mul(inverse_scale_squared).add(Bound {
            lo: -spread,
            hi: spread,
        });
        if !range.finite() {
            return Ok(false);
        }
        // Local inputs of the original rotation graph are represented F32s.
        let lo = local[i].lo.max(range.lo as f32);
        let hi = local[i].hi.min(range.hi as f32);
        if lo > hi {
            return Ok(true);
        }
        clipped[i] = Float::span(lo, hi);
        upper = upper.add(dot(column, n).mul(Bound {
            lo: f64::from(lo),
            hi: f64::from(hi),
        }));
    }
    let output = transform(wall_frame, clipped.map(Value::input));
    if output.iter().any(|v| !v.finite()) {
        return Ok(false);
    }
    let upper = upper.add(Bound::exact(projected_error(
        output.map(|v| v.error),
        normal,
    )));
    if !upper.finite() {
        return Ok(false);
    }
    let shift = exact(expansion).mul(length);
    Ok(match margin {
        Margin::Touching(_) => Bound::exact(capsule_lo).add(shift).lo >= upper.hi,
        Margin::Strict(_) => Bound::exact(capsule_lo).sub(shift).lo > upper.hi,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::solver_trajectory::{leaf_contact, Domain};

    #[test]
    fn oblique_capsule_clips_only_box_points_outside_the_clearance_neighborhood() {
        let rotation = rp::Rotation::from_rotation_y(0.3).normalize();
        let cube = rp::Cuboid::new(rp::Vector::new(0.25, 2., 5.));
        let cap = rp::Capsule::new_y(0.25, 0.25);
        let wall = rp::Pose::from_parts(rp::Vector::new(-2.8659801, 0., 0.88655156), rotation);
        let mut actor = rp::Pose::from_parts(rp::Vector::new(-3.3532026, 0., 1.037267), rotation);
        let budget = || Work {
            used: 0,
            limit: u64::MAX,
        };
        let clearance = 0.01;
        for clear in [true, false] {
            let contact = leaf_contact(&wall, &cube, &actor, &cap, &mut budget()).unwrap();
            assert_eq!(contact.dist > clearance, clear);
            assert_eq!(
                static_separated(
                    wall,
                    &cube,
                    actor,
                    &cap,
                    contact.normal1,
                    clearance,
                    &mut budget()
                )
                .unwrap(),
                clear
            );
            actor.translation -= contact.normal1 * 0.00001;
        }
    }

    #[test]
    fn rounded_world_support_rejects_coincident_points_at_valid_large_coordinates() {
        let scale = 1. / 16.;
        let base = 786432.;
        let q = rp::Rotation::from_rotation_z(std::f32::consts::FRAC_PI_4);
        let wall = rp::Pose::from_parts(rp::Vector::new(base, base, 0.), q);
        let actor = rp::Pose::from_parts(rp::Vector::new(base - scale, base + scale, 0.), q);
        let cube = rp::Cuboid::new(rp::Vector::new(4., 0.75 * scale, 4.));
        let cap = rp::Capsule::new_y(0.25 * scale, 0.4 * scale);
        let normal = q * rp::Vector::Y;
        assert_eq!(
            wall * (rp::Vector::Y * cube.half_extents.y),
            actor * cap.segment.a
        );
        let k = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(0, 0),
            Domain::new(0., 1.).unwrap(),
            1.,
            actor,
            rp::Vector::ZERO,
            rp::Vector::ZERO,
        )
        .unwrap();
        let motion = ShapeMotion {
            curve: Curve::Integrated(k),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        assert!(!fits(
            wall,
            &cube,
            motion,
            &cap,
            [q; 3],
            normal,
            1e-6,
            &mut Work {
                used: 0,
                limit: u64::MAX
            }
        )
        .unwrap());
    }
}
