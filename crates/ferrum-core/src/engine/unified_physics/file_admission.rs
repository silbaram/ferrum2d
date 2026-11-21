//! Cold Engine/native ownership checks, staged separately from checkpoint decoding.
//!
//! Call only after native PhysicsWorld snapshot admission and World entity-arena
//! admission. This pass does not establish either prerequisite, decode a file,
//! synchronize authoring, rebuild indices, step, or validate the complete Engine.
use super::{Engine, UnifiedPhysicsRuntime, UnifiedTerrainSource};
use crate::entity::Entity;
use crate::physics3d::file_shared_shapes as shape_aliases;
use crate::physics3d::{BodyId, ColliderId, Space};
use crate::world::World;

/// Cold file-only backing access without exposing a mutable PhysicsWorld to
/// siblings, installing shapes, stepping or rebuilding runtime caches.
pub(in crate::engine) fn capture_shape_aliases(
    runtime: &UnifiedPhysicsRuntime,
    limits: shape_aliases::Limits,
) -> Result<(shape_aliases::Table, shape_aliases::Usage), shape_aliases::Error> {
    shape_aliases::capture(&runtime.physics, limits)
}

pub(in crate::engine) fn restore_shape_aliases(
    runtime: &mut UnifiedPhysicsRuntime,
    table: &shape_aliases::Table,
    limits: shape_aliases::Limits,
) -> Result<shape_aliases::Usage, shape_aliases::Error> {
    shape_aliases::restore(&mut runtime.physics, table, limits)
}

#[cfg(test)]
pub(in crate::engine) fn share_first_pair_for_file_test(engine: &mut Engine) {
    shape_aliases::share_first_pair_for_file_test(
        &mut engine.unified_physics.as_mut().unwrap().physics,
    );
}

#[derive(Debug, Clone, Copy)]
pub(in crate::engine) struct Limits {
    /// Logical records, initialized scratch elements, sort/search levels.
    pub max_work: usize,
    /// Cumulative requested scratch payload, not allocator overhead or RSS.
    pub max_scratch_bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::engine) struct Usage {
    pub work: usize,
    pub scratch_bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(in crate::engine) enum Error {
    WorkLimit,
    ScratchLimit,
    Allocation,
    EntityHistory,
    Marker,
    BodyBinding,
    BodyInverse,
    BodyCoverage,
    ColliderOwner,
    FixtureCache,
    TerrainIndex,
    JointSource,
    JointOwner,
    JointCache,
    ProjectileOwner,
    RenderOffset,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "invalid Engine native binding state: {self:?}")
    }
}
impl std::error::Error for Error {}

struct Budget {
    work: usize,
    scratch: usize,
}
impl Budget {
    fn charge(&mut self, count: usize) -> Result<(), Error> {
        self.work = self.work.checked_sub(count).ok_or(Error::WorkLimit)?;
        Ok(())
    }
    fn vector<T>(&mut self, count: usize) -> Result<Vec<T>, Error> {
        self.charge(count)?;
        self.scratch = self
            .scratch
            .checked_sub(
                count
                    .checked_mul(size_of::<T>())
                    .ok_or(Error::ScratchLimit)?,
            )
            .ok_or(Error::ScratchLimit)?;
        let mut result = Vec::new();
        result
            .try_reserve_exact(count)
            .map_err(|_| Error::Allocation)?;
        Ok(result)
    }
    fn sort(&mut self, count: usize) -> Result<(), Error> {
        let levels = (usize::BITS - count.saturating_sub(1).leading_zeros()) as usize;
        self.charge(count.checked_mul(levels).ok_or(Error::WorkLimit)?)
    }
    fn search(&mut self, count: usize) -> Result<(), Error> {
        self.charge((usize::BITS - count.leading_zeros()) as usize)
    }
}

type Key = (u32, u32);
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Owner {
    Entity(Key),
    Terrain(super::terrain::Group),
}
type BodyOwner = (BodyId, Owner);

fn entity(key: Key) -> Entity {
    Entity {
        id: key.0,
        generation: key.1,
    }
}

// World::despawn advances generations, but native retirement is deferred until
// the next synchronization. The exhausted MAX generation can remain dead at MAX.
fn known_entity_history(world: &World, value: Entity) -> Result<bool, Error> {
    let generation = world
        .generation_at_index(value.id as usize)
        .ok_or(Error::EntityHistory)?;
    if value.generation > generation {
        return Err(Error::EntityHistory);
    }
    let current = world.is_current_entity(value);
    if !current && value.generation == generation && generation != u32::MAX {
        return Err(Error::EntityHistory);
    }
    Ok(current)
}

fn body_owner(
    owners: &[BodyOwner],
    id: BodyId,
    budget: &mut Budget,
) -> Result<Option<Owner>, Error> {
    budget.search(owners.len())?;
    Ok(owners
        .binary_search_by_key(&id, |entry| entry.0)
        .ok()
        .map(|i| owners[i].1))
}

fn fixture_cache(
    runtime: &UnifiedPhysicsRuntime,
    body: BodyId,
    sources: &[crate::components::CompoundCollider],
    fixtures: &[ColliderId],
    actual_count: usize,
    budget: &mut Budget,
) -> Result<(), Error> {
    budget.charge(sources.len())?;
    budget.charge(fixtures.len())?;
    if sources.iter().filter(|source| source.enabled()).count() != fixtures.len()
        || fixtures.len() != actual_count
    {
        return Err(Error::FixtureCache);
    }
    let mut sorted = budget.vector(fixtures.len())?;
    for &id in fixtures {
        if runtime
            .physics
            .collider_owner(id)
            .map_err(|_| Error::FixtureCache)?
            .body
            != body
        {
            return Err(Error::ColliderOwner);
        }
        sorted.push(id);
    }
    budget.sort(sorted.len())?;
    sorted.sort_unstable();
    budget.charge(sorted.len())?;
    if sorted.windows(2).any(|ids| ids[0] == ids[1]) {
        return Err(Error::FixtureCache);
    }
    Ok(())
}

fn known_joint_key(world: &World, key: super::planar_joints::Key) -> Result<(), Error> {
    // These World generations wrap on clear, unlike entity generations. A cached
    // source may predate a clear/reuse, so do not order-compare its generation.
    let generations = match key.0 {
        0 => &world.distance_joint_generations,
        1 => &world.rope_joint_generations,
        2 => &world.spring_joint_generations,
        3 => &world.revolute_joint_generations,
        4 => &world.prismatic_joint_generations,
        5 => &world.gear_joint_generations,
        6 => &world.weld_joint_generations,
        7 => &world.pulley_joint_generations,
        _ => return Err(Error::JointSource),
    };
    generations.get(key.1 as usize).ok_or(Error::JointSource)?;
    Ok(())
}

fn joints(
    runtime: &UnifiedPhysicsRuntime,
    world: &World,
    owners: &[BodyOwner],
    budget: &mut Budget,
) -> Result<(), Error> {
    budget.charge(runtime.physics.joint_count())?;
    for id in runtime.physics.joint_ids() {
        budget.search(runtime.physics.joint_count())?;
        let desc = runtime
            .physics
            .joint_desc(id)
            .map_err(|_| Error::JointOwner)?;
        for endpoint in [desc.body_a, desc.body_b] {
            if !matches!(
                body_owner(owners, endpoint, budget)?,
                Some(Owner::Entity(_))
            ) {
                return Err(Error::JointOwner);
            }
        }
    }
    budget.charge(runtime.native_joint_events.len())?;
    let mut events = budget.vector(runtime.native_joint_events.len())?;
    for event in &runtime.native_joint_events {
        events.push((event.joint, event.body_a, event.body_b));
    }
    budget.sort(events.len())?;
    events.sort_unstable();
    budget.charge(runtime.legacy_joints.len())?;
    let mut identities = budget.vector(runtime.legacy_joints.len())?;
    for (&key, binding) in &runtime.legacy_joints {
        let (source_key, entities, desc) = binding.file_source();
        known_joint_key(world, key)?;
        if source_key != key || runtime.physics.config().space != Space::PlanarXy {
            return Err(Error::JointSource);
        }
        let mut removed_endpoint = false;
        for (source, body) in entities.into_iter().zip([desc.body_a, desc.body_b]) {
            known_entity_history(world, source)?;
            match body_owner(owners, body, budget)? {
                Some(Owner::Entity(actual)) if actual == (source.id, source.generation) => {}
                None if runtime.physics.body_state(body).is_err() => removed_endpoint = true,
                _ => return Err(Error::JointOwner),
            }
        }
        budget.search(runtime.physics.joint_count())?;
        match runtime.physics.joint_desc(binding.native) {
            Ok(actual) if actual == desc && !removed_endpoint => {}
            Ok(_) => return Err(Error::JointCache),
            Err(_) if removed_endpoint => {
                // Public remove/unbind removes the native endpoint/joint first;
                // commit_planar_joints/finish_planar_joints retires this cache later.
            }
            Err(_) => {
                budget.search(events.len())?;
                if events
                    .binary_search(&(binding.native, desc.body_a, desc.body_b))
                    .is_err()
                {
                    return Err(Error::JointCache);
                }
            }
        }
        identities.push(binding.native);
    }
    budget.sort(identities.len())?;
    identities.sort_unstable();
    budget.charge(identities.len())?;
    if identities.windows(2).any(|ids| ids[0] == ids[1]) {
        return Err(Error::JointCache);
    }
    budget.charge(runtime.pending_joints.len())?;
    let mut keys = budget.vector(runtime.pending_joints.len())?;
    for pending in &runtime.pending_joints {
        let (key, entities, desc) = pending.file_source();
        known_joint_key(world, key)?;
        for (source, body) in entities.into_iter().zip([desc.body_a, desc.body_b]) {
            known_entity_history(world, source)?;
            if body
                != (BodyId {
                    slot: source.id,
                    generation: source.generation,
                })
            {
                return Err(Error::JointSource);
            }
        }
        keys.push(key);
    }
    budget.sort(keys.len())?;
    keys.sort_unstable();
    budget.charge(keys.len())?;
    if keys.windows(2).any(|keys| keys[0] == keys[1]) {
        return Err(Error::JointSource);
    }
    budget.charge(runtime.retired_joints.len())?;
    for &key in &runtime.retired_joints {
        known_joint_key(world, key)?;
    }
    Ok(())
}

/// Read-only ownership validation for a decoded Engine whose native snapshots
/// and World entity arenas have already passed their separate admission stages.
///
/// The private checkpoint/native deserializer currently establishes the native
/// prerequisite; the future file importer must establish both before calling.
/// This function deliberately is not connected to either importer yet. It keeps
/// valid dirty World authoring and deferred retirement without synchronization.
/// Logical work does not bound std comparisons, CPU instructions, heap or RSS.
#[allow(dead_code)] // Staged helper: file-envelope integration is a separate change.
pub(in crate::engine) fn validate_after_native_admission(
    engine: &Engine,
    limits: Limits,
) -> Result<Usage, Error> {
    let world = &engine.world;
    let mut budget = Budget {
        work: limits.max_work,
        scratch: limits.max_scratch_bytes,
    };
    budget.charge(world.unified_physics_entities.len())?;
    let Some(runtime) = &engine.unified_physics else {
        return if world.unified_physics_entities.is_empty() {
            Ok(Usage {
                work: limits.max_work - budget.work,
                scratch_bytes: 0,
            })
        } else {
            Err(Error::Marker)
        };
    };
    budget.charge(runtime.bindings.len())?;
    budget.charge(runtime.entities_by_body.len())?;
    budget.charge(runtime.terrain.registered.len())?;
    budget.charge(runtime.terrain.by_collider.len())?;
    let owner_count = runtime
        .bindings
        .len()
        .checked_add(runtime.terrain.groups.len())
        .ok_or(Error::WorkLimit)?;
    if owner_count != runtime.physics.body_count()
        || runtime.bindings.len() != runtime.entities_by_body.len()
    {
        return Err(Error::BodyCoverage);
    }
    let mut owners = budget.vector(owner_count)?;
    let mut inverse = budget.vector(runtime.bindings.len())?;
    let mut marks = world.unified_physics_entities.iter();
    let mut colliders = 0usize;
    for (&key, binding) in &runtime.bindings {
        let current = known_entity_history(world, entity(key))?;
        if current && marks.next() != Some(&key) {
            return Err(Error::Marker);
        }
        if !binding
            .render_offset
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1.0e6)
            || (runtime.physics.config().space == Space::PlanarXy
                && binding.render_offset[2] != 0.0)
        {
            return Err(Error::RenderOffset);
        }
        let ids = runtime
            .physics
            .collider_ids(binding.body)
            .map_err(|_| Error::BodyBinding)?;
        let (count, upper) = ids.size_hint();
        if upper != Some(count) {
            return Err(Error::ColliderOwner);
        }
        budget.charge(count)?;
        for id in ids {
            if runtime
                .physics
                .collider_owner(id)
                .map_err(|_| Error::ColliderOwner)?
                .body
                != binding.body
            {
                return Err(Error::ColliderOwner);
            }
        }
        colliders = colliders.checked_add(count).ok_or(Error::WorkLimit)?;
        if let Some(cache) = &binding.legacy {
            if runtime.physics.config().space != Space::PlanarXy {
                return Err(Error::FixtureCache);
            }
            let (sources, fixtures) = cache.file_fixtures();
            fixture_cache(runtime, binding.body, sources, fixtures, count, &mut budget)?;
        }
        owners.push((binding.body, Owner::Entity(key)));
        inverse.push((binding.body, key));
    }
    if marks.next().is_some() {
        return Err(Error::Marker);
    }
    budget.sort(inverse.len())?;
    inverse.sort_unstable_by_key(|entry| entry.0);
    for ((body, key), (actual_body, actual_entity)) in inverse.iter().zip(&runtime.entities_by_body)
    {
        if body != actual_body || *key != (actual_entity.id, actual_entity.generation) {
            return Err(Error::BodyInverse);
        }
    }
    budget.charge(runtime.terrain.groups.len())?;
    for (&group, &body) in &runtime.terrain.groups {
        let ids = runtime
            .physics
            .collider_ids(body)
            .map_err(|_| Error::TerrainIndex)?;
        let (count, upper) = ids.size_hint();
        if upper != Some(count) {
            return Err(Error::TerrainIndex);
        }
        budget.charge(count)?;
        if count == 0 || count > 64 {
            return Err(Error::TerrainIndex);
        }
        owners.push((body, Owner::Terrain(group)));
    }
    let mut terrain = budget.vector(runtime.terrain.registered.len())?;
    for (&source, registered) in &runtime.terrain.registered {
        let id = registered.file_collider();
        if !registered.wanted.file_matches_origin(source)
            || runtime
                .physics
                .collider_owner(id)
                .map_err(|_| Error::TerrainIndex)?
                .body
                != registered.body
            || runtime
                .physics
                .body_kind(registered.body)
                .map_err(|_| Error::TerrainIndex)?
                != registered.wanted.desc.body.kind
        {
            return Err(Error::TerrainIndex);
        }
        budget.search(runtime.terrain.groups.len())?;
        if runtime.terrain.groups.get(&registered.wanted.group) != Some(&registered.body) {
            return Err(Error::TerrainIndex);
        }
        if !match (source, registered.wanted.group) {
            (
                UnifiedTerrainSource::Tile { layer, .. },
                super::terrain::Group::Tile {
                    layer: group_layer, ..
                },
            ) => layer == group_layer,
            (
                UnifiedTerrainSource::SpatialSurface { id },
                super::terrain::Group::Surface(group_id),
            ) => id == group_id,
            _ => false,
        } {
            return Err(Error::TerrainIndex);
        }
        budget.charge(1)?;
        colliders = colliders.checked_add(1).ok_or(Error::WorkLimit)?;

        terrain.push((id, source));
    }
    if colliders != runtime.physics.collider_count()
        || terrain.len() != runtime.terrain.by_collider.len()
    {
        return Err(Error::ColliderOwner);
    }
    budget.sort(terrain.len())?;
    terrain.sort_unstable_by_key(|entry| entry.0);
    for ((id, source), (actual_id, actual_source)) in
        terrain.iter().zip(&runtime.terrain.by_collider)
    {
        if id != actual_id || source != actual_source {
            return Err(Error::TerrainIndex);
        }
    }
    budget.sort(owners.len())?;
    owners.sort_unstable_by_key(|entry| entry.0);
    budget.charge(owners.len())?;
    if owners
        .windows(2)
        .any(|entries| entries[0].0 == entries[1].0)
    {
        return Err(Error::BodyCoverage);
    }
    if let Some(pending) = runtime.terrain.file_pending() {
        budget.charge(runtime.terrain.pending_sources.len())?;
        for (source, _) in &runtime.terrain.pending_sources {
            budget.search(pending.len())?;
            budget.search(runtime.terrain.registered.len())?;
            if !pending.contains_key(source) && !runtime.terrain.registered.contains_key(source) {
                return Err(Error::TerrainIndex);
            }
        }
        budget.charge(pending.len())?;
        for (&source, wanted) in pending {
            if !wanted.file_matches_origin(source) {
                return Err(Error::TerrainIndex);
            }
        }
    }
    budget.charge(runtime.pending_planar.len())?;
    let mut pending = budget.vector(runtime.pending_planar.len())?;
    for body in &runtime.pending_planar {
        let owner = body.file_owner();
        known_entity_history(world, owner)?;
        if let Some((sources, descs)) = body.file_fixtures() {
            budget.charge(sources.len())?;
            budget.charge(descs.len())?;
            if sources.iter().filter(|source| source.enabled()).count() != descs.len() {
                return Err(Error::FixtureCache);
            }
        }
        pending.push((owner.id, owner.generation));
    }
    budget.sort(pending.len())?;
    pending.sort_unstable();
    budget.charge(pending.len())?;
    if pending.windows(2).any(|keys| keys[0] == keys[1]) {
        return Err(Error::EntityHistory);
    }
    budget.charge(runtime.retired.len())?;
    for &key in &runtime.retired {
        known_entity_history(world, entity(key))?;
    }
    budget.charge(runtime.projectiles.len())?;
    for (&key, projectile) in &runtime.projectiles {
        if body_owner(&owners, projectile.file_body(), &mut budget)? != Some(Owner::Entity(key)) {
            return Err(Error::ProjectileOwner);
        }
        budget.search(runtime.bindings.len())?;
        if runtime
            .bindings
            .get(&key)
            .is_none_or(|binding| binding.legacy.is_some())
        {
            return Err(Error::ProjectileOwner);
        }
    }
    joints(runtime, world, &owners, &mut budget)?;
    Ok(Usage {
        work: limits.max_work - budget.work,
        scratch_bytes: limits.max_scratch_bytes - budget.scratch,
    })
}

#[cfg(test)]
mod tests;
