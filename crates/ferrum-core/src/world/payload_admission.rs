//! Cold immutable payload guard after structural storage admission.
//! Numeric rejection here is an external-file safety policy, not a change to
//! permissive setters or the solver's ordinary normalization behavior.
use super::persistence_admission::{WorldStorageAdmissionError, WorldStorageAdmissionLimits};
use super::World;
mod basic;
mod gameplay;
mod joints;
#[cfg(test)]
mod tests;

// Fixed-array work is conservatively reserved even when a slot is empty. This
// includes the 45 Option/typed-slot dispatches. Populated fixed arrays are
// charged separately before each owner validation and pairwise uniqueness.
const ENTITY_WORK: u64 = 64;
const JOINT_WORK: u64 = 128;
const COMPOUND_WORK: u64 = 256;
const CLIP_HEADER_WORK: u64 = 128;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WorldPayloadAdmissionLimits {
    pub storage: WorldStorageAdmissionLimits,
    /// Combined storage+payload work, in documented conservative units.
    pub max_work: u64,
    /// Combined fallible scratch bytes; the payload pass allocates none.
    pub max_scratch_bytes: usize,
    /// Compound leaves + clips + frames + timeline order/ends, per World walk.
    pub max_nested_items: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WorldPayloadAdmissionStats {
    pub work_units: u64,
    pub scratch_bytes: usize,
    pub nested_items: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorldPayloadAdmissionError {
    Storage(WorldStorageAdmissionError),
    Work,
    NestedItems,
    Invalid {
        storage: &'static str,
        slot: usize,
        field: &'static str,
    },
}
type Result<T = ()> = std::result::Result<T, WorldPayloadAdmissionError>;
fn require(ok: bool, storage: &'static str, slot: usize, field: &'static str) -> Result {
    if ok {
        Ok(())
    } else {
        Err(WorldPayloadAdmissionError::Invalid {
            storage,
            slot,
            field,
        })
    }
}
fn finite(values: &[f32]) -> bool {
    values.iter().all(|v| v.is_finite())
}
struct Budget {
    max_work: u64,
    max_nested: usize,
    work: u64,
    nested: usize,
}
impl Budget {
    fn charge(&mut self, work: u64) -> Result {
        let next = self
            .work
            .checked_add(work)
            .ok_or(WorldPayloadAdmissionError::Work)?;
        if next > self.max_work {
            return Err(WorldPayloadAdmissionError::Work);
        }
        self.work = next;
        Ok(())
    }
    fn nested(&mut self, n: usize, per_item: u64) -> Result {
        let next = self
            .nested
            .checked_add(n)
            .ok_or(WorldPayloadAdmissionError::NestedItems)?;
        if next > self.max_nested {
            return Err(WorldPayloadAdmissionError::NestedItems);
        }
        self.charge(
            (n as u64)
                .checked_mul(per_item)
                .ok_or(WorldPayloadAdmissionError::Work)?,
        )?;
        self.nested = next;
        Ok(())
    }
}
pub(super) fn validate(
    world: &World,
    limits: WorldPayloadAdmissionLimits,
) -> Result<WorldPayloadAdmissionStats> {
    // Do not trust caller-provided stats or layout membership. The borrowed
    // candidate itself must pass storage admission before any payload indexing.
    let mut storage = limits.storage;
    storage.max_work = storage.max_work.min(limits.max_work);
    storage.max_scratch_bytes = storage.max_scratch_bytes.min(limits.max_scratch_bytes);
    let stats = world
        .validate_storage_admission(storage)
        .map_err(WorldPayloadAdmissionError::Storage)?;
    let mut budget = Budget {
        max_work: limits.max_work,
        max_nested: limits.max_nested_items,
        work: stats.work_units,
        nested: 0,
    };
    budget.charge(
        (stats.entity_slots as u64)
            .checked_mul(ENTITY_WORK)
            .ok_or(WorldPayloadAdmissionError::Work)?,
    )?;
    budget.charge(
        (stats.joint_slots as u64)
            .checked_mul(JOINT_WORK)
            .ok_or(WorldPayloadAdmissionError::Work)?,
    )?;
    for &i in &world.alive_indices {
        basic::entity(world, i, &mut budget)?;
        gameplay::entity(world, i, &mut budget)?;
    }
    joints::validate(world)?;
    Ok(WorldPayloadAdmissionStats {
        work_units: budget.work,
        scratch_bytes: stats.scratch_bytes,
        nested_items: budget.nested,
    })
}

// Value-only cold projections. Existing entity validation retains its exact
// budgets, order and predicates; these helpers never construct or inspect World.
impl World {
    pub(crate) fn file_material_payload_valid(value: &crate::components::PhysicsMaterial) -> bool {
        basic::material(value)
    }
    pub(crate) fn file_animation_payload_valid(value: &crate::components::SpriteAnimation) -> bool {
        basic::animation(value)
    }
    pub(crate) fn file_rigid_body_payload_valid(value: &crate::components::RigidBody) -> bool {
        basic::body(value)
    }
    pub(crate) fn file_shape_payload_valid(
        value: &crate::components::CompoundColliderShape,
    ) -> bool {
        basic::shape(value)
    }
}
