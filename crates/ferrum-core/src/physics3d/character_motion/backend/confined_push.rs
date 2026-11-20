//! Horizontal motor geometry under a low stationary ceiling. A turning receiver
//! can bring its surface back toward the character even as its center recedes.
use super::*;
use crate::physics3d::character_dynamics::prediction_band;
use crate::physics3d::colliders::native_collider;
use crate::physics3d::events::collider_id;
use crate::physics3d::ColliderId;
use rapier3d::parry::bounding_volume::BoundingVolume;

#[derive(Clone, Copy)]
pub(super) struct Receiver {
    collider: ColliderId,
    admitted: bool,
}

#[allow(clippy::too_many_arguments)]
pub(super) fn select(
    world: &PhysicsWorld3d,
    body: BodyId,
    runtime: &CharacterRuntime,
    actor: &rp::Collider,
    query: &rp::QueryPipeline<'_>,
    travel: f32,
    scan_price: u64,
    work: &mut Work,
) -> Result<Option<Receiver>, TrajectoryError> {
    if let Some(collider) =
        world
            .character_dynamics
            .confined_receiver(body, runtime.collider, work)?
    {
        return Ok(Some(Receiver {
            collider,
            admitted: true,
        }));
    }
    // A previously clear motor can approach a single supported receiver before
    // the next contact solve. The scene's original pair/one-way filter applies.
    work.charge(scan_price)?;
    let bounds = actor
        .compute_aabb()
        .loosened(runtime.config.skin_width + travel);
    let actor_handle = native_collider(runtime.collider);
    let mut candidate = None;
    for (handle, target) in query.intersect_aabb_conservative(bounds) {
        if !target.is_enabled()
            || target.shape().as_cuboid().is_none()
            || !target
                .parent()
                .and_then(|h| world.backend.bodies.get(h))
                .is_some_and(|body| body.is_dynamic() && body.is_enabled())
        {
            continue;
        }
        for pair in world.backend.contact_pairs_with(handle) {
            work.charge(1)?;
            if pair.has_any_active_contact()
                && pair.collider1 != actor_handle
                && pair.collider2 != actor_handle
            {
                if candidate.is_some() {
                    return Ok(None);
                }
                candidate = Some(Receiver {
                    collider: collider_id(handle),
                    admitted: false,
                });
                break;
            }
        }
    }
    Ok(candidate)
}

impl Receiver {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn project(
        self,
        scratch: &BackendMotionScratch,
        entry: Entry,
        proposal: Curve,
        runtime: &CharacterRuntime,
        support: rp::RigidBodyHandle,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        work: &mut Work,
    ) -> Result<rp::Vector, TrajectoryError> {
        let Curve::Anchored {
            linear_velocity: planned,
            ..
        } = proposal
        else {
            return Err(TrajectoryError::InvalidReference);
        };
        let up: rp::Vector = runtime.config.up.into();
        if planned.dot(up) != 0. || planned == rp::Vector::ZERO {
            return Ok(planned);
        }
        let target = colliders
            .get(native_collider(self.collider))
            .ok_or(TrajectoryError::InvalidReference)?;
        let actor = colliders
            .get(native_collider(runtime.collider))
            .ok_or(TrajectoryError::InvalidReference)?;
        work.charge(u64::from(usize::BITS - scratch.entries.len().max(1).leading_zeros()) + 4)?;
        let Some(index) = scratch
            .entry_index(target.parent())
            .filter(|_| target.parent() != Some(support))
        else {
            return Ok(planned);
        };
        let receiver = &scratch.entries[index];
        let Curve::Integrated(kernel) = receiver.curve else {
            return Ok(planned);
        };
        if kernel.native.angular_velocity == rp::Vector::ZERO
            || actor.shape().as_capsule().is_none()
            || target.shape().as_cuboid().is_none()
        {
            return Ok(planned);
        }
        let motion = |curve, handle: rp::RigidBodyHandle, collider: &rp::Collider| ShapeMotion {
            curve,
            local_center: bodies[handle].local_center_of_mass(),
            local_pose: collider.position_wrt_parent().copied().unwrap_or_default(),
        };
        let actor_motion = motion(proposal, entry.value.handle, actor);
        let obstacle = motion(receiver.curve, receiver.value.handle, target);
        let end_pose = obstacle.metered_pose(kernel.domain.end, work)?;
        let hit = solver_trajectory::leaf_contact(
            &end_pose,
            target.shape(),
            &actor_motion.metered_pose(kernel.domain.end, work)?,
            actor.shape(),
            work,
        )?;
        let skin = runtime.config.skin_width;
        if hit.dist > skin {
            return Ok(planned);
        }
        let tangent = hit.normal1 - up * hit.normal1.dot(up);
        let into = -planned.dot(tangent);
        let norm = tangent.length_squared();
        if norm <= 0.
            || into <= 0.
            || (!self.admitted && kernel.native.linear_velocity.dot(tangent) >= 0.)
        {
            return Ok(planned);
        }
        let dt = native_duration(kernel.domain.duration())?;
        let limit = if self.admitted {
            // An existing row can transport the rider by the incoming material
            // point's own travel. Its physical impulse is still solved once.
            let start = obstacle.metered_pose(kernel.domain.start, work)?;
            let local = end_pose.inverse_transform_point(hit.point1);
            let incoming = (hit.point1 - start * local).dot(hit.normal1).max(0.);
            into + incoming / dt
        } else {
            into
        };
        // Keep the proposal in reach of the next finite row. Every corrected
        // curve still goes through the full continuous scene and endpoint checks.
        let correction = ((prediction_band(skin) - hit.dist) / dt).min(limit);
        let result = planned + tangent * (correction / norm);
        if !result.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(result)
    }
}
