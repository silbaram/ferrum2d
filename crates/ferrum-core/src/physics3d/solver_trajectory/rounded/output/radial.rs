//! Query-graph-aware radial certificates. A world scalar radius and a local
//! radius transformed by a rounded quaternion are not interchangeable.
use super::*;

fn finite(v: Translation) -> bool {
    v.iter().all(|x| x.finite())
}
// Componentwise minima/maxima are a full interval lower/upper bound for the
// original nonnegative multiply/add/sqrt graph, not a sampled distance query.
fn length_range(v: Translation, ball_sqrt: bool) -> Option<(f32, f32)> {
    if !finite(v) {
        return None;
    }
    let minimum = rp::Vector::from_array(v.map(|x| {
        if x.lo <= 0. && x.hi >= 0. {
            0.
        } else {
            x.lo.abs().min(x.hi.abs())
        }
    }));
    let maximum = rp::Vector::from_array(v.map(|x| x.lo.abs().max(x.hi.abs())));
    let length = |v: rp::Vector| {
        if ball_sqrt {
            <f32 as rapier3d::parry::math::ComplexField>::sqrt(v.length_squared())
        } else {
            v.length()
        }
    };
    let (lo, hi) = (length(minimum), length(maximum));
    (lo.is_finite() && hi.is_finite()).then_some((lo, hi))
}

pub(super) fn world_scalar(
    a: &Frames,
    sa: &dyn rp::Shape,
    b: &Frames,
    sb: &dyn rp::Shape,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (Some(ball_a), Some(ball_b)) = (sa.as_ball(), sb.as_ball()) else {
        // Other native fallbacks have a different signed-distance graph.
        // A SupportMap support plane alone does not bound the rounded GJK
        // witness/dot result. Keep their existing cube/image fallback.
        return Ok(false);
    };
    work.charge(
        u64::try_from(a.len * b.len)
            .map_err(|_| TrajectoryError::WorkLimit)?
            .checked_mul(4096)
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    for fa in &a.values[..a.len] {
        for fb in &b.values[..b.len] {
            // Each ball core has exactly one original local point: zero.
            // Enclose original world-pose application and F32 subtraction,
            // then the actual nonnegative length graph. Do not replace
            // (length - ra) - rb with length - (ra + rb) or a real plane gap.
            let delta = sub(fb.point(rp::Vector::ZERO), fa.point(rp::Vector::ZERO));
            if !length_range(delta, false)
                .is_some_and(|(lo, _)| (lo - ball_a.radius) - ball_b.radius >= clearance)
            {
                return Ok(false);
            }
            // The primary positive-core branch can fall through to the
            // native dispatcher. It uses the already-rounded original
            // pos1.inv_mul(pos2), ComplexField::sqrt, and radius sum first.
            let relative = Frame::relative(*fa, *fb);
            if !length_range(relative.translation, true)
                .is_some_and(|(lo, _)| lo - (ball_a.radius + ball_b.radius) >= clearance)
            {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn normalized(v: Translation) -> Option<Translation> {
    if !finite(v) {
        return None;
    }
    if v.iter().all(|x| x.lo.to_bits() == x.hi.to_bits()) {
        return rp::Vector::from_array(v.map(|x| x.lo))
            .try_normalize()
            .map(exact_vector);
    }
    let squared = v[0].mul(v[0]).add(v[1].mul(v[1])).add(v[2].mul(v[2]));
    if !squared.finite() || squared.lo <= 0. || squared.lo.to_bits() != squared.hi.to_bits() {
        return None;
    }
    // The norm² proof covers every Cartesian vector, so its lower corner is
    // a valid native length_recip input with those same norm² bits. It is not
    // a time sample used to assume that the rest share its norm.
    let corner = rp::Vector::from_array(v.map(|x| x.lo));
    if corner.length_squared().to_bits() != squared.lo.to_bits() {
        return None;
    }
    let factor = corner.length_recip();
    (factor.is_finite() && factor > 0.).then(|| v.map(|x| x.mul(Float::exact(factor))))
}
fn dot(a: Translation, b: Translation) -> Float {
    a[0].mul(b[0]).add(a[1].mul(b[1])).add(a[2].mul(b[2]))
}

#[allow(clippy::too_many_arguments)]
fn affine_edge_separated(
    kernel: Kernel,
    dt: Float,
    carrier_translation: Translation,
    translation: Translation,
    additions: [rp::Vector; 2],
    foot: rp::Vector,
    point: rp::Vector,
    first_core: rp::Vector,
    radius: f32,
    clearance: f32,
) -> bool {
    use super::support::{half_ulp, rounding, Op};
    let Some(axis) = (first_core - point).try_normalize() else {
        return false;
    };
    let norm = super::super::dot(axis, axis).sqrt();
    let time = Bound {
        lo: f64::from(dt.lo),
        hi: f64::from(dt.hi),
    };
    let mut origin = Bound::exact(0.);
    let mut speed = Bound::exact(0.);
    let mut world_error = Bound::exact(0.);
    let mut local_error = Bound::exact(0.);
    for i in 0..3 {
        if axis[i] == 0. {
            continue;
        }
        let direction = Bound::exact(f64::from(axis[i]));
        let magnitude = Bound::exact(f64::from(axis[i].abs()));
        let initial = kernel.native.motion.start.translation[i];
        let velocity = kernel.native.linear_velocity[i];
        let local = Float::exact(foot[i]);
        let radius_range = Float::span(-radius, radius);
        let local_surface = local.add(radius_range);
        let product = Float::exact(velocity).mul(dt);
        let mut translation_error =
            Bound::exact(rounding(Float::exact(velocity), dt, product, Op::Multiply)).add(
                Bound::exact(rounding(
                    Float::exact(initial),
                    product,
                    carrier_translation[i],
                    Op::Add,
                )),
            );
        let mut base = carrier_translation[i];
        let mut ideal = Bound::exact(f64::from(initial));
        for addition in additions {
            let term = Float::exact(addition[i]);
            let next = base.add(term);
            translation_error =
                translation_error.add(Bound::exact(rounding(base, term, next, Op::Add)));
            base = next;
            ideal = ideal.add(Bound::exact(f64::from(addition[i])));
        }
        let core = translation[i].add(local);
        world_error = world_error.add(
            translation_error
                .add(Bound::exact(rounding(translation[i], local, core, Op::Add)))
                .mul(magnitude),
        );
        let surface = translation[i].add(local_surface);
        local_error = local_error.add(
            translation_error
                .add(Bound::exact(rounding(
                    local,
                    radius_range,
                    local_surface,
                    Op::Add,
                )))
                .add(Bound::exact(rounding(
                    translation[i],
                    local_surface,
                    surface,
                    Op::Add,
                )))
                // Include a possible rounding of a represented radius component.
                .add(Bound::exact(half_ulp(radius_range)))
                .mul(magnitude),
        );
        origin = origin.add(
            direction.mul(
                ideal
                    .add(Bound::exact(f64::from(foot[i])))
                    .sub(Bound::exact(f64::from(point[i]))),
            ),
        );
        speed = speed.add(direction.mul(Bound::exact(f64::from(velocity))));
    }
    // Combine the affine rates before multiplying by the shared Native dt.
    // Each error separately covers the original RN point/radius graph, so
    // a nearly tangent translation does not require a Cartesian time walk.
    let projected = origin.add(speed.mul(time));
    let threshold = Bound::exact(f64::from(radius))
        .add(Bound::exact(f64::from(clearance)))
        .mul(norm);
    let gap = projected.sub(threshold);
    let world = gap.sub(world_error);
    let local = gap.sub(local_error);
    world.finite() && local.finite() && world.lo > 0. && local.lo > 0.
}

/// Bound the same endpoint/edge witness throughout a translation of an
/// upright capsule past a fixed, axis-aligned box.
pub(super) fn fixed_box_capsule_edge(
    context: Context<'_>,
    work: &mut Work,
) -> Result<Option<bool>, TrajectoryError> {
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    let (cube, cuboid, cap, capsule) =
        if let (Some(cuboid), Some(capsule)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, cuboid, b, capsule)
        } else if let (Some(capsule), Some(cuboid)) = (sa.as_capsule(), sb.as_cuboid()) {
            (b, cuboid, a, capsule)
        } else {
            return Ok(None);
        };
    let Curve::Constant { pose, .. } = cube.curve else {
        return Ok(None);
    };
    let pose = if cube.local_center == rp::Vector::ZERO && cube.local_pose == rp::Pose::IDENTITY {
        pose
    } else {
        cube.metered_pose(start, work)?
    };
    let foot = capsule.segment.a;
    let (kernel, additions) = match cap.curve {
        Curve::Integrated(kernel) => (kernel, [rp::Vector::ZERO; 2]),
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } if linear_velocity == rp::Vector::ZERO && rotation == rp::Rotation::IDENTITY => {
            (carrier, [anchor, offset])
        }
        _ => return Ok(None),
    };
    if !pose.is_finite()
        || pose.rotation != rp::Rotation::IDENTITY
        || cap.local_center != rp::Vector::ZERO
        || cap.local_pose != rp::Pose::IDENTITY
        || foot.x != 0.
        || foot.z != 0.
        || foot.y > 0.
        || capsule.segment.b != -foot
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() < 0.
        || !capsule.radius.is_finite()
        || capsule.radius < 0.
    {
        return Ok(None);
    }
    let Some((from, to)) =
        super::super::linear_pose_range(Curve::Integrated(kernel), start, end, work)?
    else {
        return Ok(None);
    };
    if from.rotation != rp::Rotation::IDENTITY || to.rotation != rp::Rotation::IDENTITY {
        return Ok(None);
    }
    work.charge(1024)?;
    let carrier_translation =
        std::array::from_fn(|i| Float::span(from.translation[i], to.translation[i]));
    // With an identity, non-rotating carrier, both original anchor adds
    // are monotone on the same clock. Keep their intermediate rounding.
    let translation = add(
        add(carrier_translation, exact_vector(additions[0])),
        exact_vector(additions[1]),
    );
    let dt = Float::span(kernel.local_delta(start), kernel.local_delta(end));
    let first_core = (from.translation + additions[0] + additions[1]) + foot;
    let lo = pose.translation - cuboid.half_extents;
    let hi = pose.translation + cuboid.half_extents;
    if lo.is_finite() && hi.is_finite() {
        // Every point of an upright segment has the same X/Z. The vertical
        // plane supporting a box corner therefore bounds the entire capsule
        // even when the closest core point slides along the box's side.
        let mut corner = first_core.clamp(lo, hi);
        corner.y = first_core.y;
        if corner.x != first_core.x && corner.z != first_core.z {
            work.charge(256)?;
            if affine_edge_separated(
                kernel,
                dt,
                carrier_translation,
                translation,
                additions,
                foot,
                corner,
                first_core,
                capsule.radius,
                clearance,
            ) {
                return Ok(Some(true));
            }
        }
    }
    let core = add(translation, exact_vector(foot));
    let local = sub(core, exact_vector(pose.translation));
    // The native core/slab precheck adds the endpoint after forming the
    // relative pose. Its rounding can differ from the per-witness projection.
    let slab_y = translation[1]
        .sub(Float::exact(pose.translation.y))
        .add(Float::exact(foot.y));
    if !finite(local)
        || !slab_y.finite()
        || local[1].lo <= cuboid.half_extents.y
        || slab_y.lo <= cuboid.half_extents.y
    {
        return Ok(None);
    }
    let mut point = [Float::ZERO; 3];
    let mut world_gap = [Bound::exact(0.); 3];
    let mut outside = 0;
    for i in 0..3 {
        let h = cuboid.half_extents[i];
        let face = if local[i].lo > h {
            Some(h)
        } else if local[i].hi < -h {
            Some(-h)
        } else {
            None
        };
        if let Some(face) = face {
            outside += 1;
            let face = pose.translation[i] + face;
            point[i] = Float::exact(face);
            let gap = if local[i].lo > h {
                Bound::exact(f64::from(core[i].lo)).sub(Bound::exact(f64::from(face)))
            } else {
                Bound::exact(f64::from(face)).sub(Bound::exact(f64::from(core[i].hi)))
            };
            if !gap.finite() || gap.lo <= 0. {
                return Ok(None);
            }
            world_gap[i] = gap;
        } else {
            if local[i].lo < -h || local[i].hi > h {
                return Ok(None);
            }
            // An unclamped tangent may move along the edge. A zero box
            // origin component makes its inverse/forward projection exactly
            // the same rounded coordinate as the capsule core at each time.
            if pose.translation[i] != 0. {
                let p = local[i].lo + pose.translation[i];
                if local[i].lo != local[i].hi || core[i].lo != p || core[i].hi != p {
                    return Ok(None);
                }
            }
            point[i] = core[i];
        }
    }
    // Every segment candidate has the same tangential coordinates, while its
    // Y can only move farther above the top face. The first endpoint wins
    // distance ties in the native feature query. Two clamped coordinates
    // ensure that query uses its radial normal, without the face override.
    let length = |delta: [Bound; 3]| {
        delta
            .into_iter()
            .fold(Bound::exact(0.), |sum, x| sum.add(x.mul(x)))
            .sqrt()
    };
    if outside < 2 {
        return Ok(None);
    }
    work.charge(256)?;
    if affine_edge_separated(
        kernel,
        dt,
        carrier_translation,
        translation,
        additions,
        foot,
        rp::Vector::from_array(std::array::from_fn(|i| {
            if world_gap[i].is_exact(0.) {
                first_core[i]
            } else {
                point[i].lo
            }
        })),
        first_core,
        capsule.radius,
        clearance,
    ) {
        return Ok(Some(true));
    }
    if length(world_gap)
        .sub(Bound::exact(f64::from(capsule.radius)))
        .lo
        <= f64::from(clearance)
    {
        return Ok(Some(false));
    }

    // Enclose the native F64 witness normalization, then the F32 local
    // normalization, radius offset, translation and signed-distance dot.
    let delta = std::array::from_fn(|i| {
        if world_gap[i].is_exact(0.) {
            Bound::exact(0.)
        } else {
            Bound {
                lo: Bound::exact(f64::from(core[i].lo))
                    .sub(Bound::exact(f64::from(point[i].hi)))
                    .lo,
                hi: Bound::exact(f64::from(core[i].hi))
                    .sub(Bound::exact(f64::from(point[i].lo)))
                    .hi,
            }
        }
    });
    let norm = length(delta);
    if !norm.finite() || norm.lo <= 0. {
        return Ok(Some(false));
    }
    let inverse = Bound {
        lo: (1. / norm.hi).next_down(),
        hi: (1. / norm.lo).next_up(),
    };
    let normal = delta.map(|x| {
        let n = x.mul(inverse);
        Float::span(n.lo as f32, n.hi as f32)
    });
    let Some((min, max)) = length_range(normal, false) else {
        return Ok(Some(false));
    };
    if min <= 0. {
        return Ok(Some(false));
    }
    let inverse = Float::span(1. / max, 1. / min);
    let offset = normal.map(|n| {
        Float::span(-n.hi, -n.lo)
            .mul(inverse)
            .mul(Float::exact(capsule.radius))
    });
    let point_cap = add(translation, add(exact_vector(foot), offset));
    let distance = dot(sub(point_cap, point), normal);
    if distance.finite() && distance.lo > clearance {
        return Ok(Some(true));
    }

    // When a split falls across a single rounded translation transition,
    // independent normal intervals can still straddle the margin. Enumerate
    // the complete Cartesian image (at most eight represented translations)
    // with the original native query. Extra combinations may only decline
    // clearance. The real capsule radius was already bounded above.
    // Enumerate the carrier image, since the two rounded anchor additions
    // can skip representable output coordinates at a carrier transition.
    // A proved shared tangent contributes zero in both distance graphs and
    // its entire range stays inside the same face, so one value suffices.
    let [Some(x), Some(y), Some(z)] = std::array::from_fn(|i| {
        let range = carrier_translation[i];
        if world_gap[i].is_exact(0.) {
            Float::exact(range.lo).image()
        } else {
            range.image()
        }
    }) else {
        return Ok(Some(false));
    };
    use super::super::super::feature_contact;
    work.charge(64)?;
    for &x in &x.values[..x.len] {
        for &y in &y.values[..y.len] {
            for &z in &z.values[..z.len] {
                let cap_pose = rp::Pose::from_translation(
                    rp::Vector::new(x, y, z) + additions[0] + additions[1],
                );
                let contact =
                    feature_contact::cuboid_capsule(&pose, cuboid, &cap_pose, capsule, work)?;
                if contact.is_none_or(|c| !c.dist.is_finite() || c.dist <= clearance) {
                    return Ok(Some(false));
                }
            }
        }
    }
    Ok(Some(true))
}

fn face_pair(a: Frame, cube: &rp::Cuboid, b: Frame, capsule: &rp::Capsule, clearance: f32) -> bool {
    let parameter = Float::span(0., 1.);
    // Every original affine-interpolated segment witness, plus the stored
    // endpoint branches. This is not just two sampled capsule positions.
    let core = std::array::from_fn(|i| {
        let x = Float::exact(capsule.segment.a[i])
            .add(Float::exact(capsule.segment.b[i] - capsule.segment.a[i]).mul(parameter));
        Float::span(
            x.lo.min(capsule.segment.a[i]).min(capsule.segment.b[i]),
            x.hi.max(capsule.segment.a[i]).max(capsule.segment.b[i]),
        )
    });
    let world = b.point_range(core);
    let inverse = a.inverse();
    let local = inverse.point_range(world); // Original inverse-pose * point.
    let relative = Frame::relative(a, b); // Original separate slab precheck.
    let end_a = relative.point(capsule.segment.a);
    let end_b = relative.point(capsule.segment.b);
    if !finite(core) || !finite(world) || !finite(local) || !finite(end_a) || !finite(end_b) {
        return false;
    }
    for axis in 0..3 {
        for sign in [-1_f32, 1.] {
            let h = cube.half_extents[axis];
            let outside = if sign > 0. {
                local[axis].lo > h && end_a[axis].lo > h && end_b[axis].lo > h
            } else {
                local[axis].hi < -h && end_a[axis].hi < -h && end_b[axis].hi < -h
            };
            if !outside
                || (0..3).any(|i| {
                    i != axis
                        && (local[i].lo < -cube.half_extents[i]
                            || local[i].hi > cube.half_extents[i])
                })
            {
                continue;
            }
            let mut face = rp::Vector::ZERO;
            face[axis] = sign;
            let Some(normal) = normalized(a.rotation.vector(face)) else {
                continue;
            };
            let negative = normal.map(|x| Float::span(-x.hi, -x.lo));
            let Some(local_normal) = normalized(b.rotation.conjugate().range(negative)) else {
                continue;
            };
            let mut projection = local;
            projection[axis] = Float::exact(h * sign);
            let point_a = a.point_range(projection);
            let core_delta = sub(world, point_a);
            if !finite(core_delta) || !core_delta.iter().any(|x| x.lo > 0. || x.hi < 0.) {
                continue;
            }
            let offset = local_normal.map(|x| x.mul(Float::exact(capsule.radius)));
            let point_b = b.point_range(add(core, offset));
            let distance = dot(sub(point_b, point_a), normal);
            if distance.finite() && distance.lo > clearance {
                return true;
            }
        }
    }
    false
}

pub(super) fn local_face(
    a: &Frames,
    sa: &dyn rp::Shape,
    b: &Frames,
    sb: &dyn rp::Shape,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (a, cube, b, capsule) =
        if let (Some(cube), Some(capsule)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, cube, b, capsule)
        } else if let (Some(capsule), Some(cube)) = (sa.as_capsule(), sb.as_cuboid()) {
            (b, cube, a, capsule)
        } else {
            return Ok(false);
        };
    work.charge(
        u64::try_from(a.len * b.len)
            .map_err(|_| TrajectoryError::WorkLimit)?
            .checked_mul(16384)
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    for fa in &a.values[..a.len] {
        for fb in &b.values[..b.len] {
            if !face_pair(*fa, cube, *fb, capsule, clearance) {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

#[cfg(test)]
#[test]
fn village_building_corner_preserves_the_positive_skin_in_both_orders() {
    use crate::physics3d::solver_trajectory::{cast_policy, Domain};
    let domain = Domain::new(0.0234375, 0.03125).unwrap();
    let offset = rp::Vector::new(0., 46., 0.);
    let building = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::translation(95., 46., -110.),
            start_time: domain.start,
            end_time: domain.end,
        },
        local_center: offset,
        local_pose: rp::Pose::from_translation(offset),
    };
    let npc = ShapeMotion {
        curve: Curve::Integrated(
            Kernel::from_velocity(
                rp::RigidBodyHandle::invalid(),
                domain,
                rp::Pose::translation(142.29886, 6.757383, -67.762215),
                rp::Vector::new(-0.6088867, 0., 0.7932129),
                rp::Vector::ZERO,
            )
            .unwrap(),
        ),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let box_shape = rp::SharedShape::cuboid(42., 46., 40.);
    let capsule = rp::SharedShape::capsule_y(1., 5.);
    let end_contact = super::super::super::feature_contact::cuboid_capsule(
        &building.pose(domain.end),
        box_shape.as_cuboid().unwrap(),
        &npc.pose(domain.end),
        capsule.as_capsule().unwrap(),
        &mut Work {
            used: 0,
            limit: 128 * 1024,
        },
    )
    .unwrap()
    .unwrap();
    assert!(end_contact.dist > 0.75 && end_contact.dist < 0.751);
    for (a, sa, b, sb) in [
        (building, box_shape.as_ref(), npc, capsule.as_ref()),
        (npc, capsule.as_ref(), building, box_shape.as_ref()),
    ] {
        let mut work = Work {
            used: 0,
            limit: 128 * 1024,
        };
        assert!(cast_policy(
            a,
            sa,
            b,
            sb,
            domain.start,
            domain.end,
            0.75,
            domain.duration() * 1e-6,
            &mut work,
            true
        )
        .unwrap()
        .is_none());
        let context = Context {
            a,
            sa,
            b,
            sb,
            start: domain.start,
            end: domain.end,
            clearance: 0.751,
        };
        assert_ne!(
            fixed_box_capsule_edge(context, &mut work).unwrap(),
            Some(true)
        );
    }
}
