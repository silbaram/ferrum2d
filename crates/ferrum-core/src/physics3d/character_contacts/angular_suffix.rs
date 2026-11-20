//! Keep the aggregate timeline's existing pair/static/instantaneous rows while
//! adding only active angular velocity-kinematic suffix geometry requirements.
use super::*;
use crate::physics3d::character_motion::angular_suffix::endpoint_plane_at_pose;

pub(super) enum Outcome {
    Clear,
    Recast,
    Stopped,
}
#[allow(clippy::too_many_arguments)]
pub(super) fn correct(
    world: &rp::PhysicsWorld,
    policies: &ContactPolicies,
    scene: &MotionScene,
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    scratch: &mut Scratch,
    time: Time,
    tolerance: f32,
    candidate_only: bool,
) -> Result<Outcome, ()> {
    let remaining = 1.0 - time;
    if remaining <= 0.0 {
        return Ok(Outcome::Clear);
    }
    let original = scratch.contacts.len();
    let result = (|| {
        for i in 0..original {
            let c = &scratch.contacts[i];
            if c.b.is_some() {
                continue;
            }
            let Some(motion) = scene.get(c.target).filter(|m| m.angvel != rp::Vector::ZERO) else {
                continue;
            };
            let target = &world.colliders[c.target];
            if !target
                .parent()
                .and_then(|id| world.bodies.get(id))
                .is_some_and(|b| b.body_type() == rp::RigidBodyType::KinematicVelocityBased)
            {
                continue;
            }
            let a = c.a;
            let handle = c.target;
            let source = c.source;
            let actor = &mut scratch.actors[a];
            let pose = actor_pose(world, actor);
            actor.out.contact_checks += 1;
            let plane = match endpoint_plane_at_pose(
                target,
                &scene.target_pose(handle, motion, 1.),
                &world.colliders[actor.collider],
                &pose,
                actor.velocity,
                remaining,
                characters[&actor.id].config.skin_width,
            ) {
                Ok(value) => value,
                Err(()) => {
                    actor.out.contact_failures += 1;
                    return Err(());
                }
            };
            if let Some(plane) = plane {
                scratch.contacts.push(Constraint {
                    a,
                    b: None,
                    target: handle,
                    source,
                    normal: plane.normal,
                    velocity: plane.normal * (plane.offset / plane.normal.length_squared()),
                });
            }
        }
        if scratch.contacts.len() == original {
            return Ok(Outcome::Clear);
        }
        for a in &mut scratch.actors {
            a.previous_velocity = a.velocity;
        }
        if !solver::solve(
            &mut scratch.actors,
            &scratch.contacts,
            policies.planar,
            tolerance,
            &mut scratch.solver,
        ) {
            if candidate_only {
                for a in &mut scratch.actors {
                    a.velocity = a.previous_velocity;
                }
                return Ok(Outcome::Clear);
            }
            if stop_sources(world, scene, scratch, time, tolerance) {
                for (a, blocked) in scratch.actors.iter_mut().zip(&scratch.blocked) {
                    a.limited |= *blocked;
                }
                return Ok(Outcome::Stopped);
            }
            for a in &mut scratch.actors {
                a.limited = true;
            }
            return Err(());
        }
        adjust_carry(
            world,
            &mut scratch.actors,
            &scratch.contacts,
            time,
            tolerance,
        );
        Ok(
            if scratch
                .actors
                .iter()
                .any(|a| a.velocity != a.previous_velocity)
            {
                Outcome::Recast
            } else {
                Outcome::Clear
            },
        )
    })();
    // Endpoint rows are ephemeral; normal/contact refresh keeps the original
    // rows and their identities. Capacity is reused by the next refinement.
    scratch.contacts.truncate(original);
    result
}
