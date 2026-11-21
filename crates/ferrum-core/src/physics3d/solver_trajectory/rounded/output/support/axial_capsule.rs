//! Cardinal box faces and upright capsules, with both represented radius orders.
use super::*;

// Keep both local-radius-first F32 output and real radius around the represented center.
fn pole_lower(center: f32, near: f32, radius: f32) -> f64 {
    let local = center + (near - radius);
    let world = Bound::exact(f64::from(center + near)).sub(Bound::exact(f64::from(radius)));
    if !local.is_finite() || !world.finite() {
        return f64::NAN;
    }
    f64::from(local).min(world.lo)
}

fn slab_separated(
    context: Context<'_>,
    axis: usize,
    sign: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    let (Some(cube), Some(capsule)) = (sa.as_cuboid(), sb.as_capsule()) else {
        return Ok(false);
    };
    let (Some(a), Some(b)) = (
        frames(a.curve, start, end, work)?,
        frames(b.curve, start, end, work)?,
    ) else {
        return Ok(false);
    };
    let slab = cube.half_extents.to_array().map(|h| Float::span(-h, h));
    let mut top = f32::NEG_INFINITY;
    for &frame in &a.values[..a.len] {
        work.charge(512)?;
        let projected = frame.point_range(slab)[axis].mul(Float::exact(sign));
        if !projected.finite() {
            return Ok(false);
        }
        top = top.max(projected.hi);
    }
    let near = (sign * capsule.segment.a[axis]).min(sign * capsule.segment.b[axis]);
    let mut bottom = f64::INFINITY;
    for &frame in &b.values[..b.len] {
        work.charge(512)?;
        if frame.rotation.exact != Some(rp::Rotation::IDENTITY) {
            return Ok(false);
        }
        let center = frame.translation[axis].mul(Float::exact(sign)).lo;
        let pole = pole_lower(center, near, capsule.radius);
        if !pole.is_finite() {
            return Ok(false);
        }
        bottom = bottom.min(pole);
    }
    let gap = Bound::exact(bottom).sub(Bound::exact(f64::from(top)));
    Ok(gap.finite() && gap.lo > f64::from(clearance))
}

pub(in crate::physics3d::solver_trajectory::rounded::output) fn separated(
    mut context: Context<'_>,
    mut normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if context.sa.as_capsule().is_some() && context.sb.as_cuboid().is_some() {
        std::mem::swap(&mut context.a, &mut context.b);
        std::mem::swap(&mut context.sa, &mut context.sb);
        normal = -normal;
    }
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = context;
    let (Some(cuboid), Some(capsule)) = (sa.as_cuboid(), sb.as_capsule()) else {
        return Ok(false);
    };
    let (
        Curve::Integrated(kernel),
        Curve::Anchored {
            linear_velocity,
            rotation,
            ..
        },
    ) = (a.curve, b.curve)
    else {
        return Ok(false);
    };
    let omega = kernel.native.angular_velocity.abs();
    if !normal.is_finite()
        || normal.y < 0.99
        || rotation != rp::Rotation::IDENTITY
        || linear_velocity.y <= 0.
        || a.local_center != rp::Vector::ZERO
        || b.local_center != rp::Vector::ZERO
        || a.local_pose != rp::Pose::IDENTITY
        || b.local_pose != rp::Pose::IDENTITY
        || omega.y == 0.
        || omega.x + omega.z > omega.y / 256.
        || !clearance.is_finite()
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() < 0.
        || !capsule.radius.is_finite()
        || capsule.radius < 0.
        || !capsule.segment.a.is_finite()
        || !capsule.segment.b.is_finite()
    {
        return Ok(false);
    }

    // Use a fixed cap for the optional proof so a caller replaying the
    // measured work follows the same path. Exhausting the caller's budget
    // still reports WorkLimit, while hitting only this cap permits fallback.
    const MAX_PROOF_WORK: u64 = 4 * 1024 * 1024;
    let available = work.limit - work.used;
    let mut proof = Work {
        used: 0,
        limit: available.min(MAX_PROOF_WORK),
    };
    let attempt = (|| {
        const MAX_DEPTH: usize = 10;
        const MAX_SLABS: usize = 512;
        let mut pending = [0.; MAX_DEPTH];
        let mut count = 0;
        let mut slab = Context {
            start,
            end,
            ..context
        };
        for _ in 0..MAX_SLABS {
            proof.charge(32)?;
            if slab_separated(slab, 1, 1., &mut proof)? {
                if count == 0 {
                    return Ok(true);
                }
                slab.start = slab.end;
                count -= 1;
                slab.end = pending[count];
            } else {
                let middle = slab.start + (slab.end - slab.start) * 0.5;
                if middle <= slab.start || middle >= slab.end || count == MAX_DEPTH {
                    return Ok(false);
                }
                pending[count] = slab.end;
                count += 1;
                slab.end = middle;
            }
        }
        Ok(false)
    })();
    work.charge(proof.used)?;
    match attempt {
        Err(TrajectoryError::WorkLimit) if available > MAX_PROOF_WORK => Ok(false),
        result => result,
    }
}

// Prove a whole cardinal wall slab against the upright rider's original
// anchored pose graph, including its independently rounded locomotion clock.
pub(in crate::physics3d::solver_trajectory) fn fixed_wall_rider_separated(
    cache: &AxisCache<'_>,
    mut normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let mut ctx = cache.context;
    if ctx.sa.as_capsule().is_some() && ctx.sb.as_cuboid().is_some() {
        std::mem::swap(&mut ctx.a, &mut ctx.b);
        std::mem::swap(&mut ctx.sa, &mut ctx.sb);
        normal = -normal;
    }
    let (Some(cube), Some(cap), Curve::Constant { pose, .. }) =
        (ctx.sa.as_cuboid(), ctx.sb.as_capsule(), ctx.a.curve)
    else {
        return Ok(false);
    };
    let axis = normal.abs().max_position();
    let upright = match ctx.b.curve {
        Curve::Integrated(k) => {
            k.has_identity_orientation() && k.native.linear_velocity[axis] == 0.
        }
        Curve::Anchored {
            rotation, carrier, ..
        } => {
            rotation == rp::Rotation::IDENTITY
                && carrier.native.angular_velocity != rp::Vector::ZERO
        }
        _ => false,
    };
    if pose.rotation != rp::Rotation::IDENTITY
        || !upright
        || [ctx.a, ctx.b]
            .into_iter()
            .any(|m| m.local_pose != rp::Pose::IDENTITY || m.local_center != rp::Vector::ZERO)
        || !cube.half_extents.is_finite()
        || cube.half_extents.min_element() < 0.
        || !cap.radius.is_finite()
        || cap.radius <= 0.
        || !cap.segment.a.is_finite()
        || !cap.segment.b.is_finite()
        || !normal.is_finite()
        || !ctx.clearance.is_finite()
        || ctx.clearance <= 0.
    {
        return Ok(false);
    }
    if normal[axis].abs() != 1.
        || (0..3).any(|i| i != axis && normal[i] != 0.)
        || cap.segment.a[axis] != 0.
        || cap.segment.b[axis] != 0.
    {
        return Ok(false);
    }
    work.charge(32)?;
    if slab_separated(ctx, axis, normal[axis], work)? {
        return Ok(true);
    }
    let sign = normal[axis];
    let face = sign * (pose.translation[axis] + sign * cube.half_extents[axis]);
    let reference = face + cap.radius + ctx.clearance;
    let Some(center) = corotating::center_lower_bound(ctx, axis, sign, reference, work)? else {
        return Ok(false);
    };
    let gap = Bound::exact(pole_lower(center, 0., cap.radius)).sub(Bound::exact(f64::from(face)));
    Ok(gap.finite() && gap.lo > f64::from(ctx.clearance))
}
