//! Only the backend state reachable through Ferrum's supported rigid-body API.
//! Unsupported sets must have their exact canonical empty persistent state.
use rapier3d::prelude as rp;
use serde::{Deserialize, Serialize};

// Remote Deserialize initializes every PhysicsWorld field explicitly. A new
// upstream field must be reviewed here; no broad default can discard it.
#[derive(Serialize, Deserialize)]
#[serde(remote = "rp::PhysicsWorld")]
pub(super) struct State {
    gravity: rp::Vector,
    integration_parameters: rp::IntegrationParameters,
    #[serde(skip)]
    physics_pipeline: rp::PhysicsPipeline,
    #[serde(skip)]
    collision_pipeline: rp::CollisionPipeline,
    islands: rp::IslandManager,
    broad_phase: rp::BroadPhaseBvh,
    narrow_phase: rp::NarrowPhase,
    bodies: rp::RigidBodySet,
    colliders: rp::ColliderSet,
    impulse_joints: rp::ImpulseJointSet,
    #[serde(with = "multibodies")]
    multibody_joints: rp::MultibodyJointSet,
    #[serde(with = "soft_bodies")]
    soft_bodies: rp::SoftBodySet,
    #[serde(skip)]
    ccd_solver: rp::CCDSolver,
}

// These fixed buffers bound the canonical check even if a future internal
// caller accidentally populates an unsupported set. No temporary Vec is made.
const EMPTY_ENCODING_BYTES: usize = 256;
fn save_empty<S: serde::Serializer, T: Serialize>(
    value: &T,
    empty: &T,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    let mut actual = [0; EMPTY_ENCODING_BYTES];
    let mut canonical = [0; EMPTY_ENCODING_BYTES];
    let equal = match (
        postcard::to_slice(value, &mut actual),
        postcard::to_slice(empty, &mut canonical),
    ) {
        (Ok(actual), Ok(canonical)) => actual == canonical,
        _ => false,
    };
    if !equal {
        return Err(serde::ser::Error::custom(
            "unsupported backend set is not canonically empty",
        ));
    }
    serializer.serialize_u8(0)
}

fn load_empty<'de, D: serde::Deserializer<'de>, T>(
    deserializer: D,
    allocation_work: usize,
    create: impl FnOnce() -> T,
) -> Result<T, D::Error> {
    if u8::deserialize(deserializer)? != 0 {
        return Err(serde::de::Error::custom("unsupported backend set marker"));
    }
    crate::checkpoint_decode::reserve_bytes(allocation_work)
        .map_err(|_| serde::de::Error::custom("empty backend set allocation budget"))?;
    Ok(create())
}

// Pinned Arena::new allocates four slots. Include conservative enum alignment
// overhead before invoking that known constructor; this is the existing typed
// work policy, not a measured allocator/RSS bound.
fn empty_arena_work<T>() -> usize {
    4usize.saturating_mul(std::mem::size_of::<T>().saturating_add(2 * std::mem::align_of::<T>()))
}

mod multibodies {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &rp::MultibodyJointSet,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        save_empty(value, &rp::MultibodyJointSet::new(), serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<rp::MultibodyJointSet, D::Error> {
        load_empty(
            deserializer,
            empty_arena_work::<rp::Multibody>(),
            rp::MultibodyJointSet::new,
        )
    }
}
mod soft_bodies {
    use super::*;
    pub fn serialize<S: serde::Serializer>(
        value: &rp::SoftBodySet,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        save_empty(value, &rp::SoftBodySet::new(), serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<rp::SoftBodySet, D::Error> {
        load_empty(
            deserializer,
            empty_arena_work::<rp::SoftBody>(),
            rp::SoftBodySet::new,
        )
    }
}

#[cfg(test)]
mod tests;
