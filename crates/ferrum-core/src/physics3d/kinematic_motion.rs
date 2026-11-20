//! Prescribed collider trajectories and conservative swept bounds.
use rapier3d::parry::bounding_volume::{Aabb, BoundingVolume};
use rapier3d::parry::query::NonlinearRigidMotion;
use rapier3d::prelude as rp;
pub(super) fn collider_motion(
    body: &rp::RigidBody,
    collider: &rp::Collider,
    dt: f32,
) -> NonlinearRigidMotion {
    let local = collider.position_wrt_parent().copied().unwrap_or_default();
    if body.body_type() == rp::RigidBodyType::KinematicVelocityBased {
        // Velocity integration rotates around the mass center, not the body
        // origin. Preserve angular winding instead of recovering it from endpoints.
        return NonlinearRigidMotion::new(
            *collider.position(),
            local.inverse() * body.local_center_of_mass(),
            body.linvel() * dt,
            body.angvel() * dt,
        );
    }
    let next = if body.body_type() == rp::RigidBodyType::KinematicPositionBased {
        *body.next_position()
    } else {
        *body.position()
    };
    NonlinearRigidMotion::new(
        *collider.position(),
        local.inverse() * rp::Vector::ZERO,
        next.translation - body.position().translation,
        (next.rotation * body.rotation().inverse()).to_scaled_axis(),
    )
}
/// Velocity-kinematic preview for the actual upcoming backend pass schedule.
/// Position-prescribed motion and zero-angular velocity retain their old path.
/// Re-evaluated at the current event interval dt, never by scaling a prior cap.
pub(super) fn accepted_collider_motion(
    body: &rp::RigidBody,
    collider: &rp::Collider,
    dt: f32,
    schedule: &(rp::IntegrationParameters, usize),
) -> NonlinearRigidMotion {
    if body.body_type() != rp::RigidBodyType::KinematicVelocityBased
        || body.angvel() == rp::Vector::ZERO
    {
        return collider_motion(body, collider, dt);
    }
    let (next, angular) = body.predict_kinematic_motion(&schedule.0, schedule.1);
    let local = collider.position_wrt_parent().copied().unwrap_or_default();
    let center = body.local_center_of_mass();
    NonlinearRigidMotion::new(
        *collider.position(),
        local.inverse() * center,
        next * center - *body.position() * center,
        angular,
    )
}

pub(super) fn accepted_kinematic_pose(
    body: &rp::RigidBody,
    dt: f32,
    schedule: &(rp::IntegrationParameters, usize),
) -> rp::Pose {
    if body.angvel() == rp::Vector::ZERO {
        // Preserve the established linear carry arithmetic and result bytes.
        body.predict_position_using_velocity(dt)
    } else {
        body.predict_kinematic_motion(&schedule.0, schedule.1).0
    }
}

pub(super) fn motion_bounds(shape: &dyn rp::Shape, motion: &NonlinearRigidMotion) -> Aabb {
    let start = if motion.angvel == rp::Vector::ZERO {
        shape.compute_aabb(&motion.start)
    } else {
        let sphere = shape.compute_local_bounding_sphere();
        Aabb::from_half_extents(
            motion.start * motion.local_center,
            rp::Vector::splat((sphere.center - motion.local_center).length() + sphere.radius),
        )
    };
    start.merged(&start.translated(motion.linvel))
}
