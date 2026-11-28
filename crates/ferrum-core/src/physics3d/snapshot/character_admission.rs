//! Independent cold character-field visit allowance; scratch allocation is zero.
use super::{PhysicsSnapshotError, PhysicsWorld3d};
use crate::physics3d::{colliders::native_collider, world::native_id};

#[derive(Clone, Copy, Debug)]
pub(super) struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Usage {
    pub work: u64,
    pub scratch_bytes: usize,
}

pub(super) const LIMITS: Limits = Limits {
    max_work: 128 * 1024 * 1024,
    max_scratch_bytes: 0,
};

// Conservative fixed field visits for the runtime, accumulated motion and path
// progress records. These are logical cold work units.
const BASE_WORK: u64 = 8;
const RUNTIME_WORK: u64 = 384;
const TOTAL_WORK: u64 = 128;
const BODY_COLLIDER_WORK: u64 = 8;
const PATH_TIME_WORK: u64 = 8;

pub(super) fn validate(
    world: &PhysicsWorld3d,
    limits: Limits,
) -> Result<Usage, PhysicsSnapshotError> {
    let invalid = || PhysicsSnapshotError::InvalidState;
    let capacity = || PhysicsSnapshotError::Capacity;
    let totals = world.path_scratch.saved_character_payload_counts();
    let (cuts, ids, stopped) = world.path_scratch.saved_time_payload_counts();
    // These are the existing authored path maxima (16 paths, 4 knots each),
    // checked before the owner walks any saved time/identity backing storage.
    if cuts > 65 || ids > 16 || stopped > 16 {
        return Err(invalid());
    }
    let path_time_records = cuts + ids + stopped; // At most97 after the O(1) caps.
                                                  // WorldConfig has already passed the native constructor validator. Checking
                                                  // raw lengths is O(1), before any payload/index/reference walk.
    if [world.characters.len(), totals]
        .iter()
        .any(|&n| n > world.config.max_characters)
    {
        return Err(invalid());
    }
    let mut usage = Usage {
        work: BASE_WORK,
        scratch_bytes: 0,
    };
    for (length, allowance) in [
        (world.characters.len(), RUNTIME_WORK),
        (totals, TOTAL_WORK),
        (path_time_records, PATH_TIME_WORK),
    ] {
        usage.work = usage
            .work
            .checked_add(
                (length as u64)
                    .checked_mul(allowance)
                    .ok_or_else(capacity)?,
            )
            .ok_or_else(capacity)?;
    }
    if usage.work > limits.max_work || usage.scratch_bytes > limits.max_scratch_bytes {
        return Err(capacity());
    }
    for (id, runtime) in &world.characters {
        let body = world
            .backend
            .bodies
            .get(native_id(*id))
            .ok_or_else(invalid)?;
        // Sensors are permitted in addition to the one owned solid capsule.
        // Charge every attached collider before visiting this backing slice.
        usage.work = usage
            .work
            .checked_add(
                (body.colliders().len() as u64)
                    .checked_mul(BODY_COLLIDER_WORK)
                    .ok_or_else(capacity)?,
            )
            .ok_or_else(capacity)?;
        if usage.work > limits.max_work {
            return Err(capacity());
        }
        let mut solids = 0;
        for handle in body.colliders() {
            let collider = world.backend.colliders.get(*handle).ok_or_else(invalid)?;
            if !collider.is_sensor() {
                solids += 1;
                if *handle != native_collider(runtime.collider) {
                    return Err(invalid());
                }
            }
        }
        if solids != 1 || !runtime.saved_payload_valid(world.config.space) {
            return Err(invalid());
        }
        if let Some(ground) = runtime.state.ground {
            let collider = world
                .backend
                .colliders
                .get(native_collider(ground.collider))
                .ok_or_else(invalid)?;
            if ground.body == *id
                || collider.parent() != Some(native_id(ground.body))
                || !world.backend.bodies.contains(native_id(ground.body))
                || collider.is_sensor()
            {
                return Err(invalid());
            }
        }
    }
    if !world
        .path_scratch
        .saved_character_payload_valid(world.config.space)
    {
        return Err(invalid());
    }
    if !world.path_scratch.saved_time_payload_valid() {
        return Err(invalid());
    }
    // No fallible/infallible scratch allocation, shape query, state mutation or
    // force integration occurs in this owner pass. Existing native guards and
    // decoder allowances remain separate policies, not a reset of their usage.
    Ok(usage)
}
