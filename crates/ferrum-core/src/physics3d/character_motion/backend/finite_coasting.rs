//! A finite coasting island can express the same translation in one Native
//! frame. Independently rounded kinematic endpoints otherwise acquire unequal
//! apparent rates and can close a skin-wide gap despite equal physical velocity.
use super::*;

fn frame(m: ShapeMotion) -> Option<(Kernel, rp::Vector)> {
    if m.local_center != rp::Vector::ZERO || m.local_pose != rp::Pose::IDENTITY {
        return None;
    }
    match m.curve {
        Curve::Integrated(k) => Some((k, k.native.motion.start.translation)),
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } if anchor == -carrier.native.motion.start.translation
            && linear_velocity == rp::Vector::ZERO
            && rotation == rp::Rotation::IDENTITY =>
        {
            Some((carrier, offset))
        }
        _ => None,
    }
}

fn grid(value: f32) -> i32 {
    let exponent = ((value.to_bits() >> 23) & 255) as i32;
    (exponent - 150).max(-149)
}

// All possible displacements are multiples of 2^grid. For an additive
// offset, the common (possibly finer) lattice is exact while its coordinates
// fit the 24-bit significand, including the upper power-of-two boundary.
fn exact_shift(value: f32, displacement: [f64; 2], grid_step: i32) -> bool {
    let bits = value.abs().to_bits();
    let mut step = grid_step;
    if bits != 0 {
        let fraction = bits & 0x7fffff;
        let significand = if bits >> 23 == 0 {
            fraction
        } else {
            fraction | 0x800000
        };
        step = step.min(grid(value) + significand.trailing_zeros() as i32);
    }
    let limit = 2_f64.powi(step + 24).min(f64::from(f32::MAX));
    displacement.into_iter().all(|d| {
        d == 0. && f64::from(value).abs() <= limit
            || (f64::from(value) + d).abs().next_up() <= limit
    })
}

fn exact_pole(center: f32, offset: f32) -> Option<f32> {
    // Two F32 values within 26 binades add exactly in F64. Decline a
    // much smaller nonzero addend which even a widened sum could lose.
    if center != 0. && offset != 0. && grid(center).abs_diff(grid(offset)) > 26 {
        return None;
    }
    let pole = center + offset;
    (pole.is_finite() && f64::from(pole) == f64::from(center) + f64::from(offset)).then_some(pole)
}

pub(in crate::physics3d::character_motion) fn retains_gap(
    (a, sa): (&ColliderTrajectory, &dyn rp::Shape),
    (b, sb): (&ColliderTrajectory, &dyn rp::Shape),
    start: Time,
    end: Time,
    skin: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if a.sensor
        || b.sensor
        || skin <= 0.
        || !matches!(
            (a.role, b.role),
            (Role::Character(_), Role::Character(_) | Role::Dynamic)
                | (Role::Dynamic, Role::Character(_))
        )
        || !matches!(a.motion.curve, Curve::Anchored { .. })
            && !matches!(b.motion.curve, Curve::Anchored { .. })
    {
        return Ok(false);
    }
    let (Some((ka, oa)), Some((kb, ob))) = (frame(a.motion), frame(b.motion)) else {
        return Ok(false);
    };
    if ka.native.motion.body != kb.native.motion.body {
        return Ok(false);
    }
    work.charge(512)?;
    if !representable::same_kernel(ka, kb)
        || !ka.has_identity_orientation()
        || !(ka.domain.duration() as f32).is_finite()
        || start < ka.domain.start
        || end > ka.domain.end
        || start > end
    {
        return Ok(false);
    }
    let n = ka.native;
    if n.motion.start.translation + n.linear_velocity * n.integration_seconds
        != n.motion.end.translation
    {
        return Ok(false);
    }
    let axis = n.linear_velocity.abs().max_position();
    if n.linear_velocity[axis] == 0.
        || (0..3).any(|k| k != axis && (n.linear_velocity[k] != 0. || oa[k] != ob[k]))
    {
        return Ok(false);
    }
    let extent = |shape: &dyn rp::Shape| {
        if let Some(c) = shape.as_capsule() {
            // Center is an attained core point; no cap vertex extends
            // farther along this transverse cardinal direction.
            (c.segment.a == -c.segment.b && c.segment.a[axis] == 0.).then_some(c.radius)
        } else {
            shape.as_cuboid().map(|c| c.half_extents[axis])
        }
    };
    let (Some(ra), Some(rb)) = (extent(sa), extent(sb)) else {
        return Ok(false);
    };
    let base = n.motion.start.translation[axis];
    let final_base = n.motion.end.translation[axis];
    // Sterbenz subtraction is exact within this binade. The saved branch
    // identity and monotonic Native product bound all intermediate COMs.
    if !base.is_normal()
        || !final_base.is_normal()
        || base.is_sign_negative() != final_base.is_sign_negative()
        || grid(base) != grid(final_base)
    {
        return Ok(false);
    }
    let displacement = [0., f64::from(final_base) - f64::from(base)];
    let ((left, lr), (right, rr)) = if oa[axis] <= ob[axis] {
        ((oa[axis], ra), (ob[axis], rb))
    } else {
        ((ob[axis], rb), (oa[axis], ra))
    };
    let (Some(l), Some(r)) = (exact_pole(left, lr), exact_pole(right, -rr)) else {
        return Ok(false);
    };
    if [left, right, l, r]
        .into_iter()
        .any(|x| !x.is_finite() || !exact_shift(x, displacement, grid(base)))
    {
        return Ok(false);
    }
    // Every local and world pole is exactly its initial coordinate plus
    // the same represented D. A clear pair retains its full skin. An already
    // in-skin pair keeps its positive attained gap with zero relative rate.
    if r <= l {
        return Ok(false);
    }
    if (f64::from(r) - f64::from(l)).next_down() > f64::from(skin) {
        return Ok(true);
    }
    // The original start witness must belong to the existing contact. When
    // it classifies the start as clear, leave the ordinary skin cast in charge.
    let contact = solver_trajectory::leaf_contact(
        &a.motion.pose(start),
        sa,
        &b.motion.pose(start),
        sb,
        work,
    )?;
    Ok(contact.dist > 0. && contact.dist <= skin)
}

pub(super) fn align(
    s: &mut BackendMotionScratch,
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    work: &mut Work,
) -> Result<(), TrajectoryError> {
    let log = usize::BITS - s.entries.len().max(1).leading_zeros();
    work.charge((u64::from(log) * 2 + 4) * s.origins.len() as u64)?;
    for origin in &s.origins {
        let Some(driver) = origin.coasting_frame else {
            continue;
        };
        if !origin.finite_mass || origin.support.is_some() || origin.anchored {
            continue;
        }
        let Some(i) = s.entry_index(Some(crate::physics3d::world::native_id(origin.body))) else {
            continue;
        };
        let Some(j) = s.entry_index(Some(crate::physics3d::world::native_id(driver))) else {
            continue;
        };
        let (Curve::Integrated(own), Curve::Integrated(carrier)) =
            (s.entries[i].curve, s.entries[j].curve)
        else {
            continue;
        };
        work.charge(512)?;
        if !own.has_identity_orientation()
            || !carrier.has_identity_orientation()
            || own.domain.start != carrier.domain.start
            || own.domain.end != carrier.domain.end
            || own.native.integration_seconds != carrier.native.integration_seconds
        {
            continue;
        }
        let rate = carrier.linear_velocity_at_time();
        let plan = origin.relative_plan + origin.geometry_delta + s.entries[i].geometry_delta;
        let axis = rate.abs().max_position();
        if rate[axis] == 0.
            || (0..3).any(|k| {
                k != axis && (plan[k] != 0. || rate[k] != 0. || own.native.linear_velocity[k] != 0.)
            })
        {
            continue;
        }
        // The predicted physical load and actor's free plan must already
        // agree within the two positions' measured F32 cells over the slice.
        let start = own.native.motion.start;
        let cell_width = |k: Kernel| {
            let magnitude = k.native.motion.start.translation[axis]
                .abs()
                .max(k.native.motion.end.translation[axis].abs());
            f64::from(magnitude.next_up()) - f64::from(magnitude)
        };
        let cell = cell_width(own) + cell_width(carrier);
        let elapsed = own.domain.duration();
        let close = |x: f32| (f64::from(x) - f64::from(rate[axis])).abs() * elapsed <= cell;
        if !cell.is_finite()
            || !characters
                .get(&origin.body)
                .is_some_and(|r| cell < f64::from(r.config.skin_width))
            || !close(plan[axis])
            || !close(own.linear_velocity_at_time()[axis])
            || !close((origin.relative_momentum + origin.velocity_delta)[axis])
        {
            continue;
        }
        let curve = Curve::Anchored {
            carrier,
            anchor: -carrier.native.motion.start.translation,
            offset: start.translation,
            linear_velocity: rp::Vector::ZERO,
            rotation: start.rotation,
        };
        let end = curve.com_pose(own.domain.end);
        if !end.is_finite()
            || !solver_trajectory::same_pose_bits(curve.com_pose(own.domain.start), start)
            || (f64::from(end.translation[axis])
                - f64::from(own.native.motion.end.translation[axis]))
            .abs()
                > cell
        {
            continue;
        }
        s.entries[i].curve = curve;
        s.entries[i].value.end = end;
        s.entries[i].value.keep_integrated_endpoint = true;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_translation_preserves_existing_skin_and_rejects_overlap_or_an_independent_clock() {
        let k = Kernel::from_velocity(
            rp::RigidBodyHandle::from_raw_parts(2, 0),
            Domain::new(0., 0.025).unwrap(),
            rp::Pose::translation(4., 0., 0.),
            rp::Vector::X,
            rp::Vector::ZERO,
        )
        .unwrap();
        let actor = |slot, x, carrier: Kernel| ColliderTrajectory {
            parent: Some(rp::RigidBodyHandle::from_raw_parts(slot, 0)),
            collider: rp::ColliderHandle::from_raw_parts(slot, 0),
            role: Role::Character(BodyId {
                slot,
                generation: 0,
            }),
            sensor: false,
            motion: ShapeMotion {
                curve: Curve::Anchored {
                    carrier,
                    anchor: -carrier.native.motion.start.translation,
                    offset: rp::Vector::new(x, 0., 0.),
                    linear_velocity: rp::Vector::ZERO,
                    rotation: rp::Rotation::IDENTITY,
                },
                local_center: rp::Vector::ZERO,
                local_pose: rp::Pose::IDENTITY,
            },
            bounds: rapier3d::parry::bounding_volume::Aabb::new(rp::Vector::ZERO, rp::Vector::ZERO),
        };
        let shape = rp::Capsule::new_y(0.25, 0.25);
        let a = actor(0, 0., k);
        let check = |b| {
            retains_gap(
                (&a, &shape),
                (&b, &shape),
                0.,
                0.025,
                0.01,
                &mut Work {
                    used: 0,
                    limit: 1 << 20,
                },
            )
            .unwrap()
        };
        assert!(check(actor(1, 0.51, k)));
        assert!(check(actor(1, 0.52, k)));
        assert!(!check(actor(1, 0.49, k)));
        let mut independent = k;
        independent.native.linear_velocity.x = 0.5;
        assert!(!check(actor(1, 0.51, independent)));
        assert!(exact_pole(f32::MAX, f32::from_bits(1)).is_none());
        assert!(!exact_shift(1., [0., 0.5], -25));
    }
}
