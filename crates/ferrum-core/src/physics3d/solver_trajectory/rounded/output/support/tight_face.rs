//! The controller's finite box-face fit over an actual Native translation.
use super::*;
mod world;
pub(super) use world::static_separated;

/// Re-evaluate the tight controller's box-local capsule support on every
/// represented pose of the kernel. The caller owns the tight-fit policy and
/// passes its original touching allowance. Ordinary casts use their own margin.
pub(in crate::physics3d) fn tight_face_fits(
    wall: ShapeMotion,
    wall_shape: &dyn rp::Shape,
    actor: ShapeMotion,
    actor_shape: &dyn rp::Shape,
    up: rp::Vector,
    epsilon: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (
        Curve::Constant {
            pose: wall_body, ..
        },
        Curve::Integrated(k),
        Some(cube),
        Some(cap),
    ) = (
        wall.curve,
        actor.curve,
        wall_shape.as_cuboid(),
        actor_shape.as_capsule(),
    )
    else {
        return Ok(false);
    };
    let native = k.native;
    if (wall_body.rotation == rp::Rotation::IDENTITY
        && wall.local_pose.rotation == rp::Rotation::IDENTITY)
        || actor.local_center != rp::Vector::ZERO
        || actor.local_pose != rp::Pose::IDENTITY
        || native.angular_velocity != rp::Vector::ZERO
        || !epsilon.is_finite()
        || epsilon <= 0.
    {
        return Ok(false);
    }
    work.charge(256)?;
    let h = native.integration_seconds;
    let pose = wall.pose(k.domain.start);
    let direction = pose.rotation * rp::Vector::Y;
    // Leave cardinal planes to the existing exact axis proofs. The oblique
    // plane must be parallel to the controller's support face.
    if !h.is_finite()
        || h <= 0.
        || !pose.is_finite()
        || !up.is_finite()
        || direction
            .to_array()
            .into_iter()
            .filter(|v| *v != 0.)
            .count()
            < 2
        || direction.dot(up).abs() < 1. - 1e-6
        || native.motion.start.translation + native.linear_velocity * h
            != native.motion.end.translation
        || !native.motion.start.is_finite()
        || !native.motion.end.is_finite()
    {
        return Ok(false);
    }
    work.charge(4096)?;
    // With zero angular velocity all positive interior dt give the same
    // normalized quaternion. Stored poses have separate endpoint branches.
    let rotations = [
        actor.pose(k.domain.start).rotation,
        native.position_at_integration_time(h.next_down()).rotation * actor.local_pose.rotation,
        actor.pose(k.domain.end).rotation,
    ];
    let inverse = pose.rotation.inverse();
    let frame = Frame::exact(rp::Pose::from_rotation(inverse));
    let center = |dt: Float| {
        let v = |n| Value::input(Float::exact(n));
        let p = std::array::from_fn(|i| {
            v(native.motion.start.translation[i])
                .add(v(native.linear_velocity[i]).mul(Value::input(dt)))
                .sub(v(pose.translation[i]))
        });
        transform(frame, p)
    };
    let interval = center(Float::span(0., h));
    let start = center(Float::ZERO);
    let end = center(Float::exact(h));
    // The exact projection is affine in one shared local dt. Only the
    // arithmetic errors span independent component intervals.
    let mut center_bounds = [Float::ZERO; 3];
    for i in 0..3 {
        if !interval[i].finite() || !start[i].finite() || !end[i].finite() {
            return Ok(false);
        }
        let lo = (start[i].ideal.lo.min(end[i].ideal.lo) - interval[i].error).next_down();
        let hi = (start[i].ideal.hi.max(end[i].ideal.hi) + interval[i].error).next_up();
        // Actual results are f32. Nearest rounding the real bound is
        // monotone and leaves every such result inside.
        center_bounds[i] = Float::span(lo as f32, hi as f32);
    }
    let above = center_bounds[1].lo >= 0.;
    for rotation in rotations {
        let q = inverse * rotation;
        let a = q * cap.segment.a;
        let b = q * cap.segment.b;
        for i in 0..3 {
            let ends = Float::span(a[i], b[i]).add(center_bounds[i]);
            let min = ends.lo - cap.radius;
            let max = ends.hi + cap.radius;
            let half = cube.half_extents[i];
            if !min.is_finite() || !max.is_finite() || !half.is_finite() {
                return Ok(false);
            }
            if i == 1 {
                let gap = if above { min - half } else { -half - max };
                if gap < -epsilon {
                    return Ok(false);
                }
            } else if min <= -half + epsilon || max >= half - epsilon {
                return Ok(false);
            }
        }
    }
    let normal = if above { direction } else { -direction };
    world::fits(pose, cube, actor, cap, rotations, normal, epsilon, work)
}
