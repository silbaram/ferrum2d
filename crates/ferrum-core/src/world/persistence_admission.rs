//! Structural admission for an already decoded, untrusted World candidate.
//!
//! This does NOT validate the complete World payload: component values and
//! nested references, gameplay indices/slab, render history, retired/contact
//! observations and cross-Engine native ownership need separate guards. The
//! candidate is borrowed immutably; nothing is rebuilt, normalized or repaired.
use super::{JointKind, World, DEAD_ALIVE_POSITION};
use crate::entity::Entity;

const COMPONENT_STORAGES: usize = 45;
const JOINT_ARENAS: usize = 8;
const HEADER_WORK: u64 = 5 + COMPONENT_STORAGES as u64 + 4 * JOINT_ARENAS as u64 + 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WorldStorageAdmissionLimits {
    pub max_entity_slots: usize,
    /// Sum of high-water slot lengths in all eight joint arenas, not live count.
    pub max_joint_slots: usize,
    /// Precharged upper-bound units, defined by `required_work` below.
    pub max_work: u64,
    /// Logical fallible scratch reservation bytes; not total decode/RSS memory.
    pub max_scratch_bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct WorldStorageAdmissionStats {
    pub entity_slots: usize,
    pub live_entities: usize,
    pub joint_slots: usize,
    pub live_joints: usize,
    pub work_units: u64,
    pub scratch_bytes: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorldStorageAdmissionLimit {
    EntitySlots,
    JointSlots,
    Work,
    ScratchBytes,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorldStorageInvariant {
    EntityHandleWidth,
    EntityLayout,
    EntityGeneration { slot: usize },
    AliveIndex { position: usize },
    AlivePosition { slot: usize },
    EntityFreeList { position: usize },
    MissingReusableEntity { slot: usize },
    ComponentLength { storage: &'static str },
    DeadComponent { storage: &'static str, slot: usize },
    JointLayout { kind: JointKind },
    JointRemovalCapacity { kind: JointKind },
    JointFreeList { kind: JointKind, position: usize },
    JointOccupancy { kind: JointKind, slot: usize },
    JointEndpoint { kind: JointKind, slot: usize },
    JointIncidentLayout,
    JointIncident { slot: usize },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WorldStorageAdmissionError {
    Limit(WorldStorageAdmissionLimit),
    Allocation,
    Invalid(WorldStorageInvariant),
}
use WorldStorageAdmissionError::{Invalid, Limit};
use WorldStorageAdmissionLimit::{EntitySlots, JointSlots, ScratchBytes, Work};

// A cold fixed array of borrowed views avoids heap boxing or collecting every
// entity/component into a new payload. No virtual call reaches the tick path.
trait ComponentSlots {
    fn slots_len(&self) -> usize;
    fn populated(&self, slot: usize) -> bool;
}
impl<T> ComponentSlots for Vec<Option<T>> {
    fn slots_len(&self) -> usize {
        self.len()
    }
    fn populated(&self, slot: usize) -> bool {
        self[slot].is_some()
    }
}
impl<T> ComponentSlots for Vec<Vec<T>> {
    fn slots_len(&self) -> usize {
        self.len()
    }
    fn populated(&self, slot: usize) -> bool {
        !self[slot].is_empty()
    }
}
fn components(world: &World) -> [(&'static str, &dyn ComponentSlots); COMPONENT_STORAGES] {
    [
        ("transforms", &world.transforms),
        ("sprites", &world.sprites),
        ("sprite_normal_materials", &world.sprite_normal_materials),
        (
            "sprite_lighting_materials",
            &world.sprite_lighting_materials,
        ),
        ("sprite_surface_materials", &world.sprite_surface_materials),
        ("sprite_light_masks", &world.sprite_light_masks),
        ("sprite_nine_slices", &world.sprite_nine_slices),
        ("sprite_animations", &world.sprite_animations),
        ("sprite_playbacks", &world.sprite_playbacks),
        ("ground_shadows", &world.ground_shadows),
        ("velocities", &world.velocities),
        ("rotations", &world.rotations),
        ("angular_velocities", &world.angular_velocities),
        ("height_spans", &world.height_spans),
        ("projectile_arcs", &world.projectile_arcs),
        ("rigid_bodies", &world.rigid_bodies),
        ("colliders", &world.colliders),
        ("circle_colliders", &world.circle_colliders),
        ("oriented_box_colliders", &world.oriented_box_colliders),
        ("capsule_colliders", &world.capsule_colliders),
        ("edge_colliders", &world.edge_colliders),
        ("chain_colliders", &world.chain_colliders),
        ("convex_polygon_colliders", &world.convex_polygon_colliders),
        ("compound_colliders", &world.compound_colliders),
        ("collider_materials", &world.collider_materials),
        ("collision_filters", &world.collision_filters),
        ("lifetimes", &world.lifetimes),
        ("projectile_policies", &world.projectile_policies),
        ("bullet_lifetimes", &world.bullet_lifetimes),
        (
            "projectile_collision_targets",
            &world.projectile_collision_targets,
        ),
        ("projectile_tile_impacts", &world.projectile_tile_impacts),
        ("healths", &world.healths),
        ("damages", &world.damages),
        ("score_rewards", &world.score_rewards),
        ("gameplay_factions", &world.gameplay_factions),
        ("gameplay_tags", &world.gameplay_tags),
        ("action_bindings", &world.action_bindings),
        ("pickups", &world.pickups),
        ("interactions", &world.interactions),
        ("movement_patterns", &world.movement_patterns),
        ("collision_reactions", &world.collision_reactions),
        ("behavior_state_machines", &world.behavior_state_machines),
        (
            "behavior_state_enter_actions",
            &world.behavior_state_enter_actions,
        ),
        ("gameplay_timer_triggers", &world.gameplay_timer_triggers),
        (
            "gameplay_variable_mutation_triggers",
            &world.gameplay_variable_mutation_triggers,
        ),
    ]
}

struct JointLayout<'a> {
    kind: JointKind,
    slots: usize,
    generations: &'a [u32],
    // Capacity is observed: clear_joint/clear_for_entity push without reserving.
    free: &'a Vec<u32>,
}
fn joint_layouts(world: &World) -> [JointLayout<'_>; JOINT_ARENAS] {
    [
        JointLayout {
            kind: JointKind::Distance,
            slots: world.distance_joints.len(),
            generations: &world.distance_joint_generations,
            free: &world.distance_joint_free_list,
        },
        JointLayout {
            kind: JointKind::Rope,
            slots: world.rope_joints.len(),
            generations: &world.rope_joint_generations,
            free: &world.rope_joint_free_list,
        },
        JointLayout {
            kind: JointKind::Spring,
            slots: world.spring_joints.len(),
            generations: &world.spring_joint_generations,
            free: &world.spring_joint_free_list,
        },
        JointLayout {
            kind: JointKind::Pulley,
            slots: world.pulley_joints.len(),
            generations: &world.pulley_joint_generations,
            free: &world.pulley_joint_free_list,
        },
        JointLayout {
            kind: JointKind::Revolute,
            slots: world.revolute_joints.len(),
            generations: &world.revolute_joint_generations,
            free: &world.revolute_joint_free_list,
        },
        JointLayout {
            kind: JointKind::Prismatic,
            slots: world.prismatic_joints.len(),
            generations: &world.prismatic_joint_generations,
            free: &world.prismatic_joint_free_list,
        },
        JointLayout {
            kind: JointKind::Weld,
            slots: world.weld_joints.len(),
            generations: &world.weld_joint_generations,
            free: &world.weld_joint_free_list,
        },
        JointLayout {
            kind: JointKind::Gear,
            slots: world.gear_joints.len(),
            generations: &world.gear_joint_generations,
            free: &world.gear_joint_free_list,
        },
    ]
}

struct Scratch {
    entity_free: Vec<u8>,
    joint_free: Vec<u8>,
    incidents: Vec<u32>,
}
fn zeroed<T: Default + Clone>(length: usize) -> Result<Vec<T>, WorldStorageAdmissionError> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(length)
        .map_err(|_| WorldStorageAdmissionError::Allocation)?;
    // No allocation after successful reserve; T is only u8/u32 at call sites.
    values.resize(length, T::default());
    Ok(values)
}

// Model: fixed metadata checks + one unit per entity/alive/free/component slot,
// scratch zero fill, joint mark reset/free entry, plus three reserved units per
// joint slot (slot + up to two endpoints, even for an empty slot). This is an
// explicit conservative work allowance, not CPU instructions or elapsed time.
fn required_work(
    entities: usize,
    alive: usize,
    free: usize,
    joints: usize,
    joint_free: usize,
    max_arena: usize,
) -> Result<u64, WorldStorageAdmissionError> {
    let entity_units = (entities as u64)
        .checked_mul(COMPONENT_STORAGES as u64 + 4)
        .ok_or(Limit(Work))?;
    let joint_units = (joints as u64).checked_mul(4).ok_or(Limit(Work))?;
    [
        entity_units,
        joint_units,
        alive as u64,
        free as u64,
        joint_free as u64,
        max_arena as u64,
    ]
    .into_iter()
    .try_fold(HEADER_WORK, |total, n| {
        total.checked_add(n).ok_or(Limit(Work))
    })
}

pub(super) fn validate(
    world: &World,
    limits: WorldStorageAdmissionLimits,
) -> Result<WorldStorageAdmissionStats, WorldStorageAdmissionError> {
    // Reject an inadmissible header budget before any size-dependent iteration.
    if limits.max_work < HEADER_WORK {
        return Err(Limit(Work));
    }
    let entities = world.alive.len();
    if entities > limits.max_entity_slots {
        return Err(Limit(EntitySlots));
    }
    if entities.saturating_sub(1) > u32::MAX as usize {
        return Err(Invalid(WorldStorageInvariant::EntityHandleWidth));
    }
    if world.generations.len() != entities
        || world.alive_positions.len() != entities
        || world.alive_indices.len() > entities
        || world.free_list.len() > entities
    {
        return Err(Invalid(WorldStorageInvariant::EntityLayout));
    }
    let component_views = components(world);
    for (name, slots) in &component_views {
        if slots.slots_len() != entities {
            return Err(Invalid(WorldStorageInvariant::ComponentLength {
                storage: name,
            }));
        }
    }
    let layouts = joint_layouts(world);
    let mut joints = 0usize;
    let mut free_joints = 0usize;
    let mut max_arena = 0usize;
    for layout in &layouts {
        joints = joints.checked_add(layout.slots).ok_or(Limit(JointSlots))?;
        free_joints = free_joints
            .checked_add(layout.free.len())
            .ok_or(Limit(Work))?;
        max_arena = max_arena.max(layout.slots);
        if layout.slots.saturating_sub(1) > u32::MAX as usize
            || layout.generations.len() != layout.slots
            || layout.free.len() > layout.slots
        {
            return Err(Invalid(WorldStorageInvariant::JointLayout {
                kind: layout.kind,
            }));
        }
        if layout.free.capacity() < layout.slots {
            return Err(Invalid(WorldStorageInvariant::JointRemovalCapacity {
                kind: layout.kind,
            }));
        }
    }
    if joints > limits.max_joint_slots {
        return Err(Limit(JointSlots));
    }
    if world.joint_incident_counts.len() > entities {
        return Err(Invalid(WorldStorageInvariant::JointIncidentLayout));
    }
    let work = required_work(
        entities,
        world.alive_indices.len(),
        world.free_list.len(),
        joints,
        free_joints,
        max_arena,
    )?;
    if work > limits.max_work {
        return Err(Limit(Work));
    }
    let scratch_bytes = entities
        .checked_mul(std::mem::size_of::<u8>() + std::mem::size_of::<u32>())
        .and_then(|n| max_arena.checked_add(n))
        .ok_or(Limit(ScratchBytes))?;
    if scratch_bytes > limits.max_scratch_bytes {
        return Err(Limit(ScratchBytes));
    }
    // All size/shape/work/scratch limits are checked before fallible allocation.
    let mut scratch = Scratch {
        entity_free: zeroed(entities)?,
        joint_free: zeroed(max_arena)?,
        incidents: zeroed(entities)?,
    };
    validate_entities(world, &mut scratch.entity_free)?;
    for (name, slots) in &component_views {
        for (slot, &alive) in world.alive.iter().enumerate() {
            if !alive && slots.populated(slot) {
                return Err(Invalid(WorldStorageInvariant::DeadComponent {
                    storage: name,
                    slot,
                }));
            }
        }
    }
    let mut live_joints = 0;
    validate_joint_slots(
        world,
        JointKind::Distance,
        &world.distance_joints,
        &world.distance_joint_free_list,
        &mut scratch,
        &mut live_joints,
        |j| (j.entity_a, j.entity_b),
    )?;
    validate_joint_slots(
        world,
        JointKind::Rope,
        &world.rope_joints,
        &world.rope_joint_free_list,
        &mut scratch,
        &mut live_joints,
        |j| (j.entity_a, j.entity_b),
    )?;
    validate_joint_slots(
        world,
        JointKind::Spring,
        &world.spring_joints,
        &world.spring_joint_free_list,
        &mut scratch,
        &mut live_joints,
        |j| (j.entity_a, j.entity_b),
    )?;
    validate_joint_slots(
        world,
        JointKind::Pulley,
        &world.pulley_joints,
        &world.pulley_joint_free_list,
        &mut scratch,
        &mut live_joints,
        |j| (j.entity_a, j.entity_b),
    )?;
    validate_joint_slots(
        world,
        JointKind::Revolute,
        &world.revolute_joints,
        &world.revolute_joint_free_list,
        &mut scratch,
        &mut live_joints,
        |j| (j.entity_a, j.entity_b),
    )?;
    validate_joint_slots(
        world,
        JointKind::Prismatic,
        &world.prismatic_joints,
        &world.prismatic_joint_free_list,
        &mut scratch,
        &mut live_joints,
        |j| (j.entity_a, j.entity_b),
    )?;
    validate_joint_slots(
        world,
        JointKind::Weld,
        &world.weld_joints,
        &world.weld_joint_free_list,
        &mut scratch,
        &mut live_joints,
        |j| (j.entity_a, j.entity_b),
    )?;
    validate_joint_slots(
        world,
        JointKind::Gear,
        &world.gear_joints,
        &world.gear_joint_free_list,
        &mut scratch,
        &mut live_joints,
        |j| (j.entity_a, j.entity_b),
    )?;
    // reset_entity_storage leaves a lazy prefix. Missing DEAD tail slots and
    // stale generations in dead zero-count entries are intentionally legal.
    for slot in 0..entities {
        let observed = world.joint_incident_counts.get(slot);
        if world.alive[slot] {
            if !observed.is_some_and(|entry| {
                entry.generation == world.generations[slot]
                    && entry.count == scratch.incidents[slot]
            }) {
                return Err(Invalid(WorldStorageInvariant::JointIncident { slot }));
            }
        } else if observed.is_some_and(|entry| entry.count != 0) || scratch.incidents[slot] != 0 {
            return Err(Invalid(WorldStorageInvariant::JointIncident { slot }));
        }
    }
    Ok(WorldStorageAdmissionStats {
        entity_slots: entities,
        live_entities: world.alive_indices.len(),
        joint_slots: joints,
        live_joints,
        work_units: work,
        scratch_bytes,
    })
}

fn validate_entities(world: &World, free: &mut [u8]) -> Result<(), WorldStorageAdmissionError> {
    let count = world.alive.len();
    for (position, &index) in world.alive_indices.iter().enumerate() {
        if index >= count || !world.alive[index] || world.alive_positions[index] != position {
            return Err(Invalid(WorldStorageInvariant::AliveIndex { position }));
        }
    }
    for (position, &id) in world.free_list.iter().enumerate() {
        let slot = id as usize;
        if slot >= count || world.alive[slot] || free[slot] != 0 {
            return Err(Invalid(WorldStorageInvariant::EntityFreeList { position }));
        }
        free[slot] = 1;
    }
    for (slot, &listed) in free.iter().enumerate() {
        if world.alive[slot] {
            let position = world.alive_positions[slot];
            if position >= world.alive_indices.len() || world.alive_indices[position] != slot {
                return Err(Invalid(WorldStorageInvariant::AlivePosition { slot }));
            }
        } else {
            if world.alive_positions[slot] != DEAD_ALIVE_POSITION {
                return Err(Invalid(WorldStorageInvariant::AlivePosition { slot }));
            }
            if world.generations[slot] == 0 {
                return Err(Invalid(WorldStorageInvariant::EntityGeneration { slot }));
            }
            // MAX can be a reusable slot after MAX-1 despawn, or retired after
            // MAX despawn/reset. Ordinary dead generations must be free-listed.
            if listed == 0 && world.generations[slot] != u32::MAX {
                return Err(Invalid(WorldStorageInvariant::MissingReusableEntity {
                    slot,
                }));
            }
        }
    }
    Ok(())
}

fn validate_joint_slots<T>(
    world: &World,
    kind: JointKind,
    slots: &[Option<T>],
    free: &[u32],
    scratch: &mut Scratch,
    live: &mut usize,
    endpoints: impl Fn(&T) -> (Entity, Entity),
) -> Result<(), WorldStorageAdmissionError> {
    let marks = &mut scratch.joint_free[..slots.len()];
    marks.fill(0);
    for (position, &id) in free.iter().enumerate() {
        let index = id as usize;
        if index >= slots.len() || marks[index] != 0 || slots[index].is_some() {
            return Err(Invalid(WorldStorageInvariant::JointFreeList {
                kind,
                position,
            }));
        }
        marks[index] = 1;
    }
    for (slot, joint) in slots.iter().enumerate() {
        if let Some(joint) = joint {
            let (a, b) = endpoints(joint);
            if !current(world, a) || !current(world, b) {
                return Err(Invalid(WorldStorageInvariant::JointEndpoint { kind, slot }));
            }
            scratch.incidents[a.id as usize] = scratch.incidents[a.id as usize].saturating_add(1);
            if b != a {
                scratch.incidents[b.id as usize] =
                    scratch.incidents[b.id as usize].saturating_add(1);
            }
            *live += 1;
        } else if marks[slot] == 0 {
            return Err(Invalid(WorldStorageInvariant::JointOccupancy {
                kind,
                slot,
            }));
        }
    }
    Ok(())
}
fn current(world: &World, entity: Entity) -> bool {
    let index = entity.id as usize;
    world.alive.get(index).copied().unwrap_or(false)
        && world.generations[index] == entity.generation
}

#[cfg(test)]
mod tests;
