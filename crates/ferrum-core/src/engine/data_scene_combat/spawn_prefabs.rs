//! Bounded scene-owned actor prefabs. Catalog setup is cold; spawning stays entirely native.
use super::*;
use crate::collision::collider_segment_count_at;
use crate::components::gameplay::MovementPattern;
use crate::world::actor_prototype::ActorPrototype;

pub(super) const MAX_LIVE: usize = 512;
pub(super) const MAX_RECORDS: usize = MAX_LIVE + MAX_PROJECTILES;

pub(super) struct ActorPrefab {
    pub id: u32,
    pub prototype: ActorPrototype,
    pub billboard: Option<Billboard>,
    segments: u64,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct SpawnedActor {
    pub entity: Entity,
    pub serial: u32,
    pub prefab: u32,
    pub origin: Transform2D,
}

pub(super) struct SpawnPrefabs {
    pub definitions: Vec<ActorPrefab>,
    pub actors: Vec<SpawnedActor>,
    pub lineage: Vec<Option<(u32, u32)>>,
    pub next_serial: u32,
    projectile_sources: Vec<Entity>,
}

impl Default for SpawnPrefabs {
    fn default() -> Self {
        Self {
            definitions: Vec::new(),
            actors: Vec::with_capacity(MAX_RECORDS),
            lineage: vec![None; MAX_COMBAT_ENTITIES],
            next_serial: 0,
            projectile_sources: Vec::with_capacity(MAX_PROJECTILES),
        }
    }
}

impl SpawnPrefabs {
    pub(super) fn has_definitions(&self) -> bool {
        !self.definitions.is_empty()
    }
    pub(super) fn owns(&self, entity: Entity) -> bool {
        self.lineage
            .get(entity.id as usize)
            .copied()
            .flatten()
            .is_some_and(|(generation, _)| generation == entity.generation)
    }
    pub(super) fn prototype_source(&self, entity: Entity) -> Option<Entity> {
        let (generation, prefab) = self.lineage.get(entity.id as usize).copied().flatten()?;
        if generation != entity.generation {
            return None;
        }
        self.definition(prefab).map(|p| p.prototype.source)
    }
    pub(super) fn definition(&self, id: u32) -> Option<&ActorPrefab> {
        self.definitions
            .binary_search_by_key(&id, |p| p.id)
            .ok()
            .map(|index| &self.definitions[index])
    }
    pub(super) fn retire(&mut self, world: &World, projectiles: &[(Entity, Entity, u32)]) {
        self.projectile_sources.clear();
        self.projectile_sources.extend(
            projectiles
                .iter()
                .filter(|(shot, _, _)| world.is_current_entity(*shot))
                .map(|(_, source, _)| *source),
        );
        self.projectile_sources
            .sort_unstable_by_key(|e| (e.id, e.generation));
        let references = &self.projectile_sources;
        self.actors.retain(|actor| {
            if world.is_current_entity(actor.entity)
                || references
                    .binary_search_by_key(&(actor.entity.id, actor.entity.generation), |e| {
                        (e.id, e.generation)
                    })
                    .is_ok()
            {
                return true;
            }
            if let Some(slot) = self.lineage.get_mut(actor.entity.id as usize) {
                if slot.is_some_and(|(generation, _)| generation == actor.entity.generation) {
                    *slot = None;
                }
            }
            false
        });
    }
    fn decode(
        combat: &DataSceneCombat,
        world: &World,
        spatial: &SpatialScene,
        metadata: &[u32],
    ) -> Option<Self> {
        if !metadata.len().is_multiple_of(3) || metadata.len() / 3 > MAX_ACTOR_PREFABS {
            return None;
        }
        let mut config = Self::default();
        let mut previous = 0;
        for values in metadata.chunks_exact(3) {
            let source = Entity {
                id: values[1],
                generation: values[2],
            };
            if values[0] <= previous
                || source.id as usize >= MAX_COMBAT_ENTITIES
                || combat.owns_projectile(source)
                || combat.spawn_prefabs.owns(source)
                || spatial.attachments.contains(source)
                || spatial
                    .models
                    .bindings
                    .contains_key(&(source.id, source.generation))
            {
                return None;
            }
            let prototype = world.actor_prototype(source)?;
            if let Some(
                MovementPattern::Chase {
                    target: crate::components::gameplay::MovementTarget::Entity(target),
                    ..
                }
                | MovementPattern::SeekTarget {
                    target: crate::components::gameplay::MovementTarget::Entity(target),
                    ..
                }
                | MovementPattern::Orbit {
                    target: crate::components::gameplay::MovementTarget::Entity(target),
                    ..
                },
            ) = prototype.movement
            {
                if !world.is_current_entity(target)
                    || combat.owns_projectile(target)
                    || combat.owns_spawned_actor(target)
                {
                    return None;
                }
            }
            if matches!(
                prototype.movement,
                Some(
                    MovementPattern::TopdownInput { .. }
                        | MovementPattern::PlatformerInput { .. }
                        | MovementPattern::Oscillate { .. }
                )
            ) {
                return None;
            }
            if spatial.camera.is_some()
                && (prototype.height_span.is_some() != world.rigid_body(source).is_some())
            {
                return None;
            }
            let segments = (0..world.compound_collider_count(source))
                .map(|c| collider_segment_count_at(world, source.id as usize, c) as u64)
                .sum::<u64>()
                .max(1);
            previous = values[0];
            config.definitions.push(ActorPrefab {
                id: values[0],
                prototype,
                billboard: spatial
                    .bindings
                    .get(&(source.id, source.generation))
                    .copied(),
                segments,
            });
        }
        for &index in world.alive_indices() {
            let source = world.entity_at_index(index)?;
            if combat.owns_projectile(source) || combat.owns_spawned_actor(source) {
                continue;
            }
            let Some(actions) = world.action_bindings(source) else {
                continue;
            };
            for action in actions.iter() {
                if let ActionPattern::SpawnPrefab {
                    prefab_id,
                    projectile,
                    ..
                } = action.pattern
                {
                    if config.definition(prefab_id).is_none() || projectile.is_some() {
                        return None;
                    }
                }
            }
        }
        Some(config)
    }
}

impl DataSceneCombat {
    pub(super) fn projectile_prefab_binding(&self, source: Entity, action: u32) -> u32 {
        let own = self.prefabs.binding(source, action);
        if own != 0 {
            own
        } else {
            self.spawn_prefabs
                .prototype_source(source)
                .map_or(0, |source| self.prefabs.binding(source, action))
        }
    }

    pub(super) fn spawn_actor_action(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        tilemap: &crate::tilemap::Tilemap,
        prepared: PreparedAction,
        payload: SpawnPrefabActionPayload,
        events: &mut Vec<GameplayEvent>,
    ) {
        let plan = match plan_spawn_prefab_action(payload, world.transform(prepared.entity)) {
            Ok(plan) => plan,
            Err(error) => {
                self.failure(
                    events,
                    prepared.entity,
                    prepared.action_id,
                    spawn_prefab_action_plan_failure_reason(error),
                );
                return;
            }
        };
        let Some(prefab_index) = self
            .spawn_prefabs
            .definitions
            .binary_search_by_key(&plan.prefab_id, |p| p.id)
            .ok()
        else {
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
            );
            return;
        };
        if payload.projectile.is_some() {
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE,
            );
            return;
        }
        if ![plan.transform.x, plan.transform.y]
            .iter()
            .all(|v| v.is_finite() && v.abs() <= 1_000_000.)
        {
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
            );
            return;
        }
        if !self.actions.attempt() || !self.actions.reserve(MAX_RECORDS as u64) {
            self.action_capacity_failure(prepared, events);
            return;
        }
        let live = self
            .spawn_prefabs
            .actors
            .iter()
            .filter(|a| world.is_current_entity(a.entity))
            .count();
        if !world.can_spawn_below(MAX_COMBAT_ENTITIES)
            || live >= MAX_LIVE
            || self.spawn_prefabs.actors.len() >= MAX_RECORDS
            || self.spawn_prefabs.next_serial == u32::MAX
        {
            self.action_capacity_failure(prepared, events);
            return;
        }
        let Some((geometry, preparation)) = self.actions.geometry_bound(world) else {
            self.action_capacity_failure(prepared, events);
            return;
        };
        let Some(tile_work) = self
            .actions
            .tile_bound(tilemap)
            .zip(self.actions.tile_bound(&spatial.physics))
            .map(|(a, b)| a.saturating_add(b))
        else {
            self.action_capacity_failure(prepared, events);
            return;
        };
        let prefab = &self.spawn_prefabs.definitions[prefab_index];
        let shadow_work = if spatial.environment.shadows()
            && prefab
                .billboard
                .is_some_and(|style| style.material.flags & 1 != 0)
        {
            (spatial.bindings.len() + spatial.runtime_billboards.len() + spatial.surfaces.len() + 1)
                as u64
                * 64
        } else {
            0
        };
        let work = preparation
            .saturating_add(
                geometry
                    .saturating_add(tile_work)
                    .saturating_mul(prefab.segments)
                    .saturating_mul(64),
            )
            .saturating_add(MAX_RECORDS as u64 * 4)
            .saturating_add(shadow_work);
        if !self.actions.reserve(work) {
            self.action_capacity_failure(prepared, events);
            return;
        }
        if prefab.prototype.movement.is_some()
            && world
                .alive_indices()
                .iter()
                .filter(|&&i| {
                    world.entity_at_index(i) != world.primary_actor_entity()
                        && world.movement_pattern_at_index(i).is_some()
                })
                .count()
                >= MAX_ACTORS
        {
            self.action_capacity_failure(prepared, events);
            return;
        }
        if prefab
            .prototype
            .movement
            .is_some_and(|pattern| self.navigation.owns(pattern))
            && world
                .alive_indices()
                .iter()
                .filter(|&&i| {
                    world.entity_at_index(i) != world.primary_actor_entity()
                        && world
                            .movement_pattern_at_index(i)
                            .is_some_and(|pattern| self.navigation.owns(pattern))
                })
                .count()
                >= self.navigation.actor_capacity()
        {
            self.action_capacity_failure(prepared, events);
            return;
        }
        let mut span = prefab.prototype.height_span;
        if let (Some(seed), Some(source)) = (span, world.height_span(prepared.entity)) {
            span = HeightSpan::new(source.floor, source.elevation, seed.height);
            if span.is_none() {
                self.failure(
                    events,
                    prepared.entity,
                    prepared.action_id,
                    GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
                );
                return;
            }
        }
        let Some(spawned) = world.spawn_actor_prototype(
            &prefab.prototype,
            plan.transform,
            span,
            MAX_COMBAT_ENTITIES,
        ) else {
            self.action_capacity_failure(prepared, events);
            return;
        };
        let support = if spatial.camera.is_some() {
            if let Some(mut span) = world.height_span(spawned) {
                let center = (0..world.compound_collider_count(spawned))
                    .find_map(|collider| {
                        crate::collision::collider_shape_at_segment(
                            world,
                            spawned.id as usize,
                            collider,
                            0,
                        )
                        .map(|shape| crate::collision::collider_shape_center(plan.transform, shape))
                    })
                    .unwrap_or(plan.transform);
                if let Some(surface) = spatial.physics.hd2d_surface_at(center, Some(span)) {
                    let delta = surface.elevation - span.elevation;
                    let (step, drop) = self.navigation.movement_limits();
                    if !surface.blocks_movement && delta <= step && delta >= -drop {
                        span.elevation = surface.elevation;
                        world.set_height_span(spawned, span);
                        true
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                true
            }
        } else {
            true
        };
        let blocked = !support
            || CollisionSystem::entity_overlaps_solid_mask(world, spawned, CollisionMask::WALL)
            || tilemap.actor_placement_blocked(world, spawned)
            || spatial.physics.actor_placement_blocked(world, spawned);
        if blocked {
            world.discard_actor_prototype(spawned);
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
            );
            return;
        }
        let mut billboard = prefab.billboard;
        if span.is_none() {
            if let Some(style) = &mut billboard {
                style.elevation += world
                    .height_span(prepared.entity)
                    .map_or(0., |h| h.elevation);
            }
        }
        if billboard.is_some_and(|style| !style.elevation.is_finite()) {
            world.discard_actor_prototype(spawned);
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
            );
            return;
        }
        if let Some(style) = billboard {
            spatial.runtime_billboards.push((spawned, style));
            if shadow_work != 0 && !spatial.shadow_budget_valid(world) {
                spatial.runtime_billboards.pop();
                world.discard_actor_prototype(spawned);
                self.action_capacity_failure(prepared, events);
                return;
            }
        }
        self.spawn_prefabs.next_serial += 1;
        self.spawn_prefabs.actors.push(SpawnedActor {
            entity: spawned,
            serial: self.spawn_prefabs.next_serial,
            prefab: plan.prefab_id,
            origin: plan.transform,
        });
        self.spawn_prefabs.lineage[spawned.id as usize] =
            Some((spawned.generation, plan.prefab_id));
        commit_prepared_action(world, prepared);
        self.stats[3] = self.stats[3].saturating_add(1);
        self.event(
            events,
            GameplayEvent::prefab_spawned(
                spawned,
                prepared.entity,
                plan.prefab_id,
                prepared.action_id,
            ),
        );
    }
}

#[wasm_bindgen]
impl Engine {
    /// Cold diagnostics: [version, next serial, records], then serial/prefab/id/generation/alive.
    /// Removed sources are retained only while an owned projectile still references them.
    pub fn data_scene_spawned_actor_handles(&self) -> Vec<u32> {
        let prefabs = &self.data_scene.gameplay.combat.spawn_prefabs;
        let mut values = Vec::with_capacity(3 + prefabs.actors.len() * 5);
        values.extend([1, prefabs.next_serial, prefabs.actors.len() as u32]);
        for actor in &prefabs.actors {
            values.extend([
                actor.serial,
                actor.prefab,
                actor.entity.id,
                actor.entity.generation,
                u32::from(self.world.is_current_entity(actor.entity)),
            ]);
        }
        values
    }
    /// Native catalog prototype: metadata triples are sorted positive semantic prefab id / authored handle.
    /// Standalone actor catalogs and semantic spawned-actor checkpoints.
    pub fn data_scene_spawn_prefabs_version(&self) -> u32 {
        1
    }

    /// Cold registration after authored spatial billboard styles are configured.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_gameplay_v7(
        &mut self,
        has_actor: bool,
        id: u32,
        generation: u32,
        interaction: u32,
        combat: bool,
        metadata: &[u32],
        values: &[f32],
        bindings: &[u32],
        navigation: &[f32],
        agents: &[u32],
        distances: &[f32],
        flags: u32,
        actor_prefabs: &[u32],
    ) -> bool {
        if !combat {
            return false;
        }
        if has_actor
            && self
                .data_scene
                .gameplay
                .combat
                .owns_spawned_actor(Entity { id, generation })
        {
            return false;
        }
        let Some(config) = SpawnPrefabs::decode(
            &self.data_scene.gameplay.combat,
            &self.world,
            &self.spatial_scene,
            actor_prefabs,
        ) else {
            return false;
        };
        if !navigation.is_empty()
            && config.definitions.iter().any(|prefab| {
                let managed = matches!(
                    prefab.prototype.movement,
                    Some(MovementPattern::Chase { .. })
                ) || flags & 1 != 0
                    && matches!(
                        prefab.prototype.movement,
                        Some(
                            MovementPattern::SeekTarget { .. } | MovementPattern::Accelerate { .. }
                        )
                    );
                managed
                    && !crate::spatial_scene::SpatialNavigation::combat_supported(
                        &self.world,
                        prefab.prototype.source,
                    )
            })
        {
            return false;
        }
        let applied = match navigation.len() {
            0 if flags == 0 && agents.is_empty() && distances.is_empty() => self
                .configure_data_scene_gameplay_v3(
                    has_actor,
                    id,
                    generation,
                    interaction,
                    combat,
                    metadata,
                    values,
                    bindings,
                ),
            6 if flags == 0 && agents.is_empty() && distances.is_empty() => self
                .configure_data_scene_gameplay_v4(
                    has_actor,
                    id,
                    generation,
                    interaction,
                    combat,
                    metadata,
                    values,
                    bindings,
                    navigation,
                ),
            7 => self.configure_data_scene_gameplay_v6(
                has_actor,
                id,
                generation,
                interaction,
                combat,
                metadata,
                values,
                bindings,
                navigation,
                agents,
                distances,
                flags,
            ),
            _ => false,
        };
        if !applied {
            return false;
        }
        if config.has_definitions() {
            self.world
                .reserve_actor_prototype_spawns(MAX_COMBAT_ENTITIES);
            self.spatial_scene
                .runtime_billboards
                .reserve(MAX_LIVE + MAX_PROJECTILES);
        }
        self.data_scene.gameplay.combat.spawn_prefabs = config;
        true
    }
}
