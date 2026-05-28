use crate::entity::Entity;
use crate::world::World;

mod body_impulses;
mod ccd;
mod counters;
mod fixed_timestep;
mod islands;
mod joints;
mod math;
mod platformer;
mod platformer_controller;
mod rigid_body;
mod rigid_body_properties;
mod rigid_body_step;
mod sleep;
mod solver;
mod system;

pub(in crate::physics) use body_impulses::{apply_contact_impulse, contact_point_velocity};
pub use counters::PhysicsCounters;
pub use fixed_timestep::{FixedTimestep, FixedTimestepConfig, FixedTimestepUpdate};
#[cfg(test)]
use islands::RigidBodyJointIslandBuckets;
pub(in crate::physics) use islands::{
    union_contact_manifold_islands, union_joint_islands, RigidBodyIslandGraph,
    RigidBodyIslandSchedule,
};
#[cfg(test)]
use joints::*;
use platformer::KinematicMoveSettings;
pub use platformer::{
    GroundProbeHit, KinematicMoveResult, MovingPlatformCarryConfig, OneWayPlatformConfig,
    PhysicsBounds, PlatformerControllerConfig, PlatformerControllerInput,
    PlatformerControllerResult, PlatformerControllerState, SlopeConfig, SlopeSegment,
    SlopeSurfaceHit,
};
pub use rigid_body::{RigidBodyIslandStats, RigidBodyStepConfig, RigidBodyStepStats};
#[cfg(test)]
use rigid_body::{
    DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR, DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
    MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
};
pub(in crate::physics) use rigid_body_properties::{
    has_disabled_rigid_body, rigid_body_inverse_inertia, rigid_body_inverse_mass,
};
pub(crate) use rigid_body_step::RigidBodyStepScratch;
pub(in crate::physics) use sleep::{
    is_rigid_body_wake_source, is_sleeping_dynamic_rigid_body, rigid_body_is_ready_for_sleep,
};
#[cfg(test)]
use solver::build_rigid_contact_constraints;
pub use system::PhysicsSystem;

const KINEMATIC_EPSILON: f32 = 0.0001;
const GROUND_NORMAL_Y_MIN: f32 = 0.5;
const MAX_KINEMATIC_ITERATIONS: u32 = 8;
const MAX_RIGID_BODY_SUBSTEPS: u32 = 16;
const DEFAULT_SLEEP_LINEAR_THRESHOLD: f32 = 0.05;
const DEFAULT_SLEEP_ANGULAR_THRESHOLD: f32 = 0.05;
const DEFAULT_SLEEP_TIME_THRESHOLD_SECONDS: f32 = 0.5;

impl PhysicsSystem {
    pub fn integrate(world: &mut World, delta: f32) {
        for i in 0..world.transforms.len() {
            if !world.alive[i] {
                continue;
            }
            if let (Some(transform), Some(velocity)) =
                (world.transforms[i].as_mut(), world.velocities[i])
            {
                transform.x += velocity.vx * delta;
                transform.y += velocity.vy * delta;
            }
        }
    }
}

fn valid_world_entity_index(world: &World, entity: Entity) -> Option<usize> {
    let index = entity.id as usize;
    (index < world.alive.len()
        && world.alive[index]
        && world.generations[index] == entity.generation)
        .then_some(index)
}

#[cfg(test)]
mod tests;
