//! Bounded, opt-in Data Scene orchestration of scene-neutral gameplay systems.
mod actions;
mod navigation;
mod prefabs;
mod progress;
mod projectile_visuals;
mod spawn_checkpoint;
mod spawn_prefabs;
use super::{Engine, SceneMode};
use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::collision::{
    AabbBounds, CircleQueryHit, CollisionPair, CollisionQueryShape, CollisionScratch,
    CollisionSystem,
};
use crate::components::gameplay::{
    ActionAimSource, ActionPattern, CollisionReaction, CollisionTarget, ProjectileCollisionTarget,
    ProjectileTileImpact,
};
use crate::components::{
    CollisionLayer, CollisionMask, HeightSpan, PhysicsFloorId, SpriteFrame, Transform2D, Velocity,
};
use crate::effect_event::EffectEvent;
use crate::entity::Entity;
use crate::gameplay::*;
use crate::gameplay_event::*;
use crate::input::InputActionRegistry;
use crate::particles::{ParticlePreset, ParticleSystem};
use crate::physics::PhysicsCounters;
use crate::spatial_scene::{Billboard, SpatialMaterial, SpatialScene};
use crate::world::{EntityTemplate, ProjectileSpawnRequest, World};
use prefabs::ProjectilePrefabConfig;
use wasm_bindgen::prelude::*;

pub(super) const MAX_COMBAT_ENTITIES: usize = 2048;
pub(super) const MAX_ACTOR_PREFABS: usize = 256;
const MAX_ACTORS: usize = 512;
const MAX_PROJECTILES: usize = 512;
const MAX_TRIGGERS: usize = 512;
const MAX_PAIRS: usize = 4096;
const MAX_EVENTS: usize = 8192;

pub(super) struct CombatInput<'a> {
    pub(super) actions: &'a InputActionRegistry,
    pub(super) snapshot: FrameInputSnapshot,
    pub(super) camera: &'a Camera2D,
    pub(super) tilemap: &'a crate::tilemap::Tilemap,
}

pub(super) struct DataSceneCombat {
    pub(super) enabled: bool,
    queue: ActionTriggerQueue<ActionTriggerCommand>,
    scratch: CollisionScratch,
    pairs: Vec<CollisionPair>,
    contacts: CollisionContactTracker,
    marked: Vec<bool>,
    pending: Vec<Entity>,
    area_hits: Vec<CircleQueryHit>,
    projectiles: Vec<(Entity, Entity, u32)>,
    prefabs: ProjectilePrefabConfig,
    navigation: navigation::CombatNavigation,
    actions: actions::CombatActions,
    spawn_prefabs: spawn_prefabs::SpawnPrefabs,
    moved_velocities: Vec<(Entity, Velocity)>,
    // actors/projectiles are gauges; the remaining values are saturating totals.
    stats: [u32; 9],
    checkpoint_authored: Vec<progress::AuthoredDefinition>,
}

impl Default for DataSceneCombat {
    fn default() -> Self {
        Self {
            enabled: false,
            queue: ActionTriggerQueue::with_capacity(MAX_TRIGGERS),
            scratch: Default::default(),
            pairs: Vec::with_capacity(MAX_PAIRS),
            contacts: CollisionContactTracker::with_capacity(MAX_PAIRS),
            marked: vec![false; MAX_COMBAT_ENTITIES],
            pending: Vec::with_capacity(MAX_COMBAT_ENTITIES),
            area_hits: Vec::with_capacity(MAX_COMBAT_ENTITIES),
            projectiles: Vec::with_capacity(MAX_PROJECTILES),
            prefabs: ProjectilePrefabConfig::default(),
            navigation: navigation::CombatNavigation::default(),
            actions: actions::CombatActions::default(),
            spawn_prefabs: spawn_prefabs::SpawnPrefabs::default(),
            moved_velocities: Vec::with_capacity(MAX_ACTORS),
            stats: [0; 9],
            checkpoint_authored: Vec::new(),
        }
    }
}

impl DataSceneCombat {
    /// Reconfiguration retires these exact generations, so they cannot become the next actor.
    pub(super) fn owns_projectile(&self, entity: Entity) -> bool {
        self.projectiles
            .iter()
            .any(|(projectile, _, _)| *projectile == entity)
    }

    pub(super) fn owns_spawned_actor(&self, entity: Entity) -> bool {
        self.spawn_prefabs.owns(entity)
    }

    pub(super) fn reconfigure(
        &mut self,
        enabled: bool,
        world: &mut World,
        spatial: &mut SpatialScene,
    ) {
        for (entity, _, _) in self.projectiles.drain(..) {
            world.despawn(entity);
        }
        for actor in self.spawn_prefabs.actors.drain(..) {
            world.despawn(actor.entity);
        }
        self.spawn_prefabs = spawn_prefabs::SpawnPrefabs::default();
        spatial.runtime_billboards.clear();
        spatial.runtime_sprite_rotations.clear();
        spatial.runtime_billboards.reserve(MAX_PROJECTILES);
        self.queue.clear();
        self.contacts.clear();
        self.pending.clear();
        self.moved_velocities.clear();
        self.stats = [0; 9];
        self.enabled = enabled;
        self.prefabs = ProjectilePrefabConfig::default();
        self.navigation = navigation::CombatNavigation::default();
        self.actions = actions::CombatActions::default();
        self.checkpoint_authored = if enabled {
            progress::capture_definitions(world)
        } else {
            Vec::new()
        };
    }

    pub(super) fn begin_frame(&mut self) {
        self.navigation.begin_frame();
        self.actions.begin_frame();
    }

    pub(super) fn capped(&mut self) {
        self.stats[7] = self.stats[7].saturating_add(1);
    }

    fn event(&mut self, events: &mut Vec<GameplayEvent>, event: GameplayEvent) {
        if events.len() < MAX_EVENTS {
            events.push(event);
        } else {
            self.capped();
        }
    }

    fn failure(
        &mut self,
        events: &mut Vec<GameplayEvent>,
        source: Entity,
        action: u32,
        reason: u32,
    ) {
        self.event(
            events,
            GameplayEvent::action_failed(source, source, action, reason),
        );
    }

    pub(super) fn pre_physics(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        delta: f32,
        events: &mut Vec<GameplayEvent>,
        counters: &mut PhysicsCounters,
        input: CombatInput<'_>,
    ) {
        if !self.enabled {
            return;
        }
        if world
            .alive_indices()
            .iter()
            .any(|&index| index >= MAX_COMBAT_ENTITIES)
        {
            self.capped();
            return;
        }
        self.projectiles
            .retain(|(e, _, _)| world.is_current_entity(*e));
        self.spawn_prefabs.retire(world, &self.projectiles);
        spatial
            .runtime_billboards
            .retain(|(e, _)| world.is_current_entity(*e));
        self.stats[1] = self.projectiles.len() as u32;
        let tilemap = input.tilemap;
        self.input_action(world, spatial, input, events, counters);
        self.navigation
            .step(world, spatial, delta, counters, &self.spawn_prefabs);
        let player = world.primary_actor_entity();
        let player_t = player.and_then(|e| world.transform(e));
        let count = world.alive_indices().len();
        self.moved_velocities.clear();
        let mut actors = 0;
        for position in 0..count {
            let index = world.alive_indices()[position];
            let Some(entity) = world.entity_at_index(index) else {
                continue;
            };
            if let Some(pattern) = world.movement_pattern(entity) {
                if Some(entity) != player && !spatial.attachments.contains(entity) {
                    actors += 1;
                    if actors > MAX_ACTORS {
                        world.velocities[index] = Some(Velocity::default());
                        self.capped();
                        continue;
                    }
                    if self.navigation.owns(pattern) {
                        let velocity = world.velocity_at_index_or_default(index);
                        self.moved_velocities.push((entity, velocity));
                        world.velocities[index] = Some(Velocity::default());
                        self.stats[2] = self.stats[2].saturating_add(1);
                    } else {
                        let application =
                            apply_scene_neutral_movement_pattern(world, index, player_t, pattern);
                        if let MovementPatternApplication::DeferredChase {
                            target_transform,
                            speed,
                            ..
                        } = application
                        {
                            world.velocities[index] = world
                                .transform(entity)
                                .map(|t| velocity_toward(t, target_transform, speed));
                        }
                        if application != MovementPatternApplication::Unsupported {
                            self.stats[2] = self.stats[2].saturating_add(1);
                            if spatial.camera.is_some()
                                && world.rigid_body(entity).is_some_and(|b| {
                                    b.body_type == crate::components::RigidBodyType::Kinematic
                                })
                            {
                                let velocity = world.velocity_at_index_or_default(index);
                                spatial.move_combat_body(
                                    world,
                                    entity,
                                    velocity.vx * delta,
                                    velocity.vy * delta,
                                    counters,
                                );
                                self.moved_velocities.push((entity, velocity));
                                world.velocities[index] = Some(Velocity::default());
                            }
                        }
                    }
                }
            }
            let Some(timer) = world.gameplay_timer_trigger_at_index(index) else {
                continue;
            };
            if !world.gameplay_variable_comparison_matches(timer.guard) {
                continue;
            }
            let Some(timer) = world.gameplay_timer_trigger_mut_at_index(index) else {
                continue;
            };
            // Combat action timers are bounded periodic sources; event-only timers stay one-shot.
            if timer.fired && timer.action_id.is_some() {
                timer.fired = false;
                timer.remaining_seconds = timer.duration_seconds;
            }
            let Some(dispatch) = tick_gameplay_timer_trigger_for_dispatch(entity, timer, delta)
            else {
                continue;
            };
            self.event(events, dispatch.event());
            if let Some(trigger) = dispatch.action_trigger() {
                if let Err(error) = self.queue.queue_action_trigger(trigger) {
                    self.capped();
                    self.event(events, action_failure_gameplay_event(error));
                }
            }
        }
        self.stats[0] = actors.min(MAX_ACTORS) as u32;
        if self.queue.begin_processing() {
            for index in 0..self.queue.processing_len() {
                if let Some(trigger) = self.queue.processing_at(index) {
                    self.action(world, spatial, tilemap, trigger, events, counters);
                }
            }
            self.queue.finish_processing();
        }
    }

    fn projectile_mask(target: ProjectileCollisionTarget) -> CollisionMask {
        match target {
            ProjectileCollisionTarget::Enemies => CollisionMask::ENEMY,
            ProjectileCollisionTarget::Player => CollisionMask::PLAYER,
        }
        .union(CollisionMask::WALL)
    }

    fn projectile_pose(
        world: &World,
        spatial: &SpatialScene,
        source: Entity,
    ) -> Option<(HeightSpan, Billboard)> {
        let source_span = world.height_span(source).unwrap_or(HeightSpan {
            floor: PhysicsFloorId::DEFAULT,
            elevation: 0.0,
            height: 1.0,
        });
        let span = HeightSpan::new(
            source_span.floor,
            source_span.elevation + source_span.height * 0.5,
            source_span.height.clamp(0.01, 1.0),
        )?;
        let style = spatial
            .bindings
            .get(&(source.id, source.generation))
            .copied()
            .or_else(|| {
                spatial
                    .runtime_billboards
                    .iter()
                    .find(|(entity, _)| *entity == source)
                    .map(|(_, style)| *style)
            })
            .unwrap_or(Billboard {
                material: SpatialMaterial {
                    normal_texture: 16_777_215,
                    flags: 0,
                },
                units_per_pixel: 1.0,
                cutoff: 0.01,
                elevation: 0.0,
            });
        Some((span, style))
    }

    fn projectile_presentation(
        &self,
        world: &World,
        spatial: &SpatialScene,
        source: Entity,
        action: u32,
    ) -> Option<(HeightSpan, Billboard)> {
        let (span, mut style) = Self::projectile_pose(world, spatial, source)?;
        if let Some(prefab) = self
            .prefabs
            .get(self.projectile_prefab_binding(source, action))
        {
            style.units_per_pixel = prefab.values[8];
            style.cutoff = prefab.values[9];
            style.elevation += prefab.values[10];
        }
        (span.elevation + style.elevation)
            .is_finite()
            .then_some((span, style))
    }

    fn input_action(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        input: CombatInput<'_>,
        events: &mut Vec<GameplayEvent>,
        counters: &mut PhysicsCounters,
    ) {
        let Some(actor) = world.primary_actor_entity() else {
            return;
        };
        let Some(bindings) = world.action_bindings(actor) else {
            return;
        };
        for binding in bindings.iter() {
            if !actions::uses_primary_input(binding.pattern) {
                continue;
            }
            let InputActionTrigger::Ready(prepared) = prepare_input_action_if_ready(
                world,
                input.actions,
                input.snapshot,
                actor,
                binding.action_id,
                ActionPatternKind::from_pattern(binding.pattern),
            ) else {
                continue;
            };
            let payload = match prepared_action_payload_from_binding(prepared.binding) {
                PreparedActionPayload::Melee(payload) => {
                    self.queue_melee(world, prepared, payload, true, events);
                    return;
                }
                PreparedActionPayload::Dash(payload) => {
                    self.input_dash(world, spatial, &input, prepared, payload, events, counters);
                    return;
                }
                PreparedActionPayload::Projectile(payload) => payload,
                PreparedActionPayload::SpawnPrefab(payload) => {
                    self.spawn_actor_action(
                        world,
                        spatial,
                        input.tilemap,
                        prepared,
                        payload,
                        events,
                    );
                    return;
                }
            };
            let Some(at) = world.transform(actor) else {
                return;
            };
            let pointer = [
                input.snapshot.current.mouse_x,
                input.snapshot.current.mouse_y,
            ];
            let viewport = [input.camera.viewport_width, input.camera.viewport_height];
            let aim = self
                .projectile_presentation(world, spatial, actor, binding.action_id)
                .and_then(|(span, style)| {
                    if spatial.camera.is_some() {
                        spatial.aim_on_plane(viewport, pointer, span.elevation + style.elevation)
                    } else if pointer.iter().any(|v| !v.is_finite())
                        || pointer[0] < 0.0
                        || pointer[1] < 0.0
                        || pointer[0] > viewport[0]
                        || pointer[1] > viewport[1]
                    {
                        None
                    } else {
                        Some(input.camera.screen_to_world(Transform2D {
                            x: pointer[0],
                            y: pointer[1],
                        }))
                    }
                });
            let Some(aim) = aim.filter(|aim| (aim.x - at.x).hypot(aim.y - at.y) > 0.0001) else {
                self.failure(
                    events,
                    actor,
                    binding.action_id,
                    GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
                );
                return;
            };
            match plan_input_projectile_action(payload, at, aim, 0.0) {
                Ok(plan) => {
                    self.spawn_prepared_projectile(world, spatial, prepared, payload, plan, events)
                }
                Err(error) => self.failure(
                    events,
                    actor,
                    binding.action_id,
                    projectile_action_plan_failure_reason(error),
                ),
            }
            // Stable authored action order; at most one input attack attempt per substep.
            return;
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn action(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        tilemap: &crate::tilemap::Tilemap,
        trigger: ActionTriggerCommand,
        events: &mut Vec<GameplayEvent>,
        counters: &mut PhysicsCounters,
    ) {
        let prepared = match prepare_action_trigger_for_dispatch(
            world,
            trigger,
            ActionAttemptFailurePolicy::ReportGenericReadinessFailures,
        ) {
            ActionTriggerPreparation::Ready(p) => p,
            ActionTriggerPreparation::Failure(e) => {
                self.event(events, action_failure_gameplay_event(e));
                return;
            }
            ActionTriggerPreparation::Noop => return,
        };
        let payload = match prepared.payload {
            PreparedActionPayload::Melee(payload) => {
                self.queue_melee(world, prepared.prepared, payload, false, events);
                return;
            }
            PreparedActionPayload::Dash(payload) => {
                self.target_dash(
                    world,
                    spatial,
                    tilemap,
                    prepared.prepared,
                    payload,
                    events,
                    counters,
                );
                return;
            }
            PreparedActionPayload::SpawnPrefab(payload) => {
                self.spawn_actor_action(
                    world,
                    spatial,
                    tilemap,
                    prepared.prepared,
                    payload,
                    events,
                );
                return;
            }
            PreparedActionPayload::Projectile(payload) => payload,
        };
        // Tile bounce/arc and prefab actions remain scene-specific capabilities.
        if payload.tile_impact != ProjectileTileImpact::Despawn {
            self.failure(
                events,
                trigger.source,
                trigger.action_id,
                GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE,
            );
            return;
        }
        let Some(at) = world.transform(trigger.source) else {
            self.failure(
                events,
                trigger.source,
                trigger.action_id,
                GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
            );
            return;
        };
        let target = world
            .primary_actor_entity()
            .and_then(|e| world.transform(e).map(|t| (e, t)));
        let plan =
            match plan_projectile_action_toward_target(payload, trigger.source, at, target, 0.0) {
                Ok(plan) => plan,
                Err(error) => {
                    self.failure(
                        events,
                        trigger.source,
                        trigger.action_id,
                        projectile_action_plan_failure_reason(error),
                    );
                    return;
                }
            };
        self.spawn_prepared_projectile(world, spatial, prepared.prepared, payload, plan, events);
    }

    #[allow(clippy::too_many_arguments)]
    fn spawn_prepared_projectile(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        prepared: PreparedAction,
        payload: ProjectileActionPayload,
        plan: ProjectileSpawnPlan,
        events: &mut Vec<GameplayEvent>,
    ) {
        if payload.tile_impact != ProjectileTileImpact::Despawn {
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE,
            );
            return;
        }
        if self.projectiles.len() >= MAX_PROJECTILES
            || world.alive_indices().len() >= MAX_COMBAT_ENTITIES
            || !world.can_spawn_below(MAX_COMBAT_ENTITIES)
        {
            self.capped();
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
            );
            return;
        }
        let Some((span, style)) =
            self.projectile_presentation(world, spatial, prepared.entity, prepared.action_id)
        else {
            self.failure(
                events,
                prepared.entity,
                prepared.action_id,
                GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
            );
            return;
        };
        let source_sprite = world.sprite_at_index(prepared.entity.id as usize);
        let frame = source_sprite.map_or(SpriteFrame::FULL, |s| SpriteFrame {
            u0: s.u0,
            v0: s.v0,
            u1: s.u1,
            v1: s.v1,
        });
        let prefab_id = self.projectile_prefab_binding(prepared.entity, prepared.action_id);
        let prefab = self.prefabs.get(prefab_id);
        let template = if let Some(prefab) = prefab {
            prefab.template()
        } else {
            let mut template = EntityTemplate::new(4.0, 4.0).with_frame(4.0, 4.0, frame);
            let radius = (2.0 * style.units_per_pixel).max(0.001);
            template.collider_half_width = radius;
            template.collider_half_height = radius;
            template.collider_shape =
                crate::world::EntityTemplateColliderShape::aabb(radius, radius);
            template
        };
        let data = projectile_spawn_core_data_from_plan(plan, payload);
        let spawned = spawn_projectile_entity(
            world,
            ProjectileEntitySpawnData {
                request: ProjectileSpawnRequest {
                    transform: data.transform,
                    velocity: data.velocity,
                    texture_id: prefab
                        .map_or_else(|| source_sprite.map_or(0, |s| s.texture_id), |p| p.texture),
                    lifetime: data.lifetime_seconds,
                    template,
                    damage: data.damage,
                    collision_target: data.collision_target,
                    tile_impact: data.tile_impact,
                    source_faction: world.gameplay_faction(prepared.entity),
                },
                arc: None,
            },
        )
        .spawned;
        if let Some(prefab) = prefab {
            prefab.tint(world, spawned);
        }
        world.set_height_span(spawned, span);
        world.add_collision_reaction(
            spawned,
            CollisionReaction::Damage {
                target: CollisionTarget::OtherEntity,
            },
        );
        world.add_collision_reaction(
            spawned,
            CollisionReaction::Despawn {
                target: CollisionTarget::SelfEntity,
            },
        );
        // Match the standard projectile policy: no source/enemy self hits.
        world.set_collision_filter(
            spawned,
            crate::components::CollisionFilter {
                category: CollisionMask::BULLET,
                mask: Self::projectile_mask(payload.collision_target),
            },
        );
        if spatial.camera.is_some() {
            spatial.runtime_billboards.push((
                spawned,
                Billboard {
                    material: SpatialMaterial {
                        normal_texture: 16_777_215,
                        flags: 0,
                    },
                    ..style
                },
            ));
        }
        commit_prepared_action(world, prepared);
        self.projectiles.push((spawned, prepared.entity, prefab_id));
        self.stats[3] = self.stats[3].saturating_add(1);
        self.stats[1] = self.projectiles.len() as u32;
        self.event(
            events,
            GameplayEvent::prefab_spawned(spawned, prepared.entity, 0, prepared.action_id),
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn post_physics(
        &mut self,
        world: &mut World,
        spatial: &mut SpatialScene,
        tilemap: &crate::tilemap::Tilemap,
        particles: &mut ParticleSystem,
        presets: &[Option<ParticlePreset>],
        audio: &mut Vec<AudioEvent>,
        events: &mut Vec<GameplayEvent>,
        effects: &mut Vec<EffectEvent>,
        delta: f32,
    ) {
        if !self.enabled {
            return;
        }
        if world
            .alive_indices()
            .iter()
            .any(|&index| index >= MAX_COMBAT_ENTITIES)
        {
            self.capped();
            return;
        }
        self.marked.fill(false);
        self.pending.clear();
        self.stats[6] =
            self.stats[6]
                .saturating_add(run_lifetime_system(world, delta, &mut self.pending) as u32);
        for e in &self.pending {
            self.marked[e.id as usize] = true;
        }
        self.resolve_melee(world, spatial, tilemap, events);
        if !CollisionSystem::build_pairs_bounded_into(
            &mut self.scratch,
            world,
            &mut self.pairs,
            MAX_COMBAT_ENTITIES * 8,
            MAX_PAIRS,
        ) {
            self.capped();
        }
        self.pairs.retain(|pair| {
            !self
                .projectiles
                .iter()
                .any(|(e, _, _)| *e == pair.a || *e == pair.b)
        });
        for index in 0..self.projectiles.len() {
            let (entity, source, _) = self.projectiles[index];
            if !world.is_current_entity(entity) || self.marked[entity.id as usize] {
                continue;
            }
            let (Some(at), Some(collider)) = (world.transform(entity), world.collider(entity))
            else {
                continue;
            };
            let velocity = world.velocity_at_index_or_default(entity.id as usize);
            let start = Transform2D {
                x: at.x - velocity.vx * delta,
                y: at.y - velocity.vy * delta,
            };
            let distance = (velocity.vx.hypot(velocity.vy)) * delta;
            let span = world.height_span(entity);
            let target = CollisionSystem::shape_cast_with_height_span(
                world,
                CollisionQueryShape::Aabb(AabbBounds::from_transform(start, collider)),
                velocity,
                distance,
                Self::projectile_mask(world.projectile_collision_target_at(entity.id as usize)),
                span,
                Some(source),
                world.collision_filter_at(entity.id as usize),
            );
            let tile_hit =
                tilemap.projectile_aabb_blocking_tile_hit(start, velocity, collider, delta, span);
            let spatial_hit = spatial
                .physics
                .projectile_aabb_blocking_tile_hit(start, velocity, collider, delta, span);
            let tile_hit = match (tile_hit, spatial_hit) {
                (Some(a), Some(b)) => Some(if a.contact.time <= b.contact.time {
                    a
                } else {
                    b
                }),
                (a, b) => a.or(b),
            };
            if let Some(hit) =
                tile_hit.filter(|h| target.is_none_or(|t| h.contact.time * distance <= t.distance))
            {
                self.marked[entity.id as usize] = true;
                self.pending.push(entity);
                self.event(
                    events,
                    GameplayEvent::tile_impact(GameplayTileImpactEventPayload {
                        projectile: entity,
                        tile_impact_code: 0,
                        layer_index: hit.layer_index as u32,
                        tile_index: hit.tile_index as u32,
                        normal_x: hit.contact.normal_x,
                        normal_y: hit.contact.normal_y,
                        bounced: false,
                        target_removed: true,
                    }),
                );
            } else if let Some(hit) = target {
                if world.collider_layer_at(hit.entity.id as usize) == Some(CollisionLayer::Wall) {
                    self.marked[entity.id as usize] = true;
                    self.pending.push(entity);
                    self.event(events, GameplayEvent::collision_despawn(entity, hit.entity));
                } else if self.pairs.len() < MAX_PAIRS {
                    self.pairs.push(CollisionPair {
                        a: entity,
                        b: hit.entity,
                    });
                } else {
                    self.capped();
                }
            }
        }
        self.contacts.clear_current();
        for index in 0..self.pairs.len() {
            let pair = self.pairs[index];
            if self.marked[pair.a.id as usize] || self.marked[pair.b.id as usize] {
                continue;
            }
            let entered = self.contacts.register(pair.a, pair.b);
            let context =
                CollisionReactionPair::new(pair.a.id as usize, pair.b.id as usize, pair.a, pair.b);
            let Some(outcomes) = apply_collision_reaction_sets_for_pair(
                world,
                context,
                entered,
                &mut self.area_hits,
                &mut self.marked,
                &mut self.pending,
                |world, index| CollisionDamageReactionDefaults {
                    health: world.health_at_index(index).unwrap_or(f32::MAX),
                    score_reward: 0,
                    despawn_on_kill: true,
                },
            ) else {
                continue;
            };
            for applied in outcomes.outcomes() {
                for damage in applied.outcome.damage_outcomes() {
                    self.stats[4] = self.stats[4].saturating_add(1);
                    self.stats[5] = self.stats[5].saturating_add(u32::from(damage.killed));
                }
                for payload in
                    collision_gameplay_events_for_reaction_outcome(applied.pair, &applied.outcome)
                        .events()
                {
                    let event = match payload {
                        CollisionGameplayEventPayload::Damage {
                            target,
                            source,
                            damage,
                            target_removed,
                        } => {
                            GameplayEvent::collision_damage(target, source, damage, target_removed)
                        }
                        CollisionGameplayEventPayload::Despawn { target, source } => {
                            GameplayEvent::collision_despawn(target, source)
                        }
                        CollisionGameplayEventPayload::PickupCollected {
                            collector,
                            pickup,
                            item_id,
                            count,
                            target_removed,
                        } => GameplayEvent::pickup_collected(
                            collector,
                            pickup,
                            item_id,
                            count,
                            target_removed,
                        ),
                        CollisionGameplayEventPayload::FactionDamageDenied {
                            target,
                            source,
                            source_faction_id,
                            target_faction_id,
                        } => GameplayEvent::faction_damage_denied(
                            target,
                            source,
                            source_faction_id,
                            target_faction_id,
                        ),
                    };
                    self.event(events, event);
                }
                for effect in applied.outcome.side_effects() {
                    match collision_side_effect_payload(world, effect) {
                        Some(CollisionSideEffectPayload::SpawnParticleAt {
                            preset_id,
                            position,
                        }) => {
                            if let Some(Some(preset)) = presets.get(preset_id as usize) {
                                let target = match effect.effect {
                                    Some(CollisionSideEffect::SpawnParticle {
                                        target_index,
                                        ..
                                    }) => world.entity_at_index(target_index),
                                    _ => None,
                                }
                                .unwrap_or(applied.pair.source);
                                let (height, units) = spatial
                                    .bindings
                                    .get(&(target.id, target.generation))
                                    .map_or(
                                        (
                                            world.height_span(target).map_or(0.0, |s| s.elevation),
                                            1.0,
                                        ),
                                        |style| {
                                            (
                                                world
                                                    .height_span(target)
                                                    .map_or(0.0, |s| s.elevation)
                                                    + style.elevation,
                                                style.units_per_pixel,
                                            )
                                        },
                                    );
                                let spawned = if spatial.camera.is_some() {
                                    particles.spawn_spatial_burst(
                                        *preset, position.x, position.y, height, units,
                                    )
                                } else {
                                    particles.spawn_burst(*preset, position.x, position.y)
                                };
                                self.stats[8] = self.stats[8].saturating_add(spawned as u32);
                                if spawned < preset.burst_count as usize {
                                    self.capped();
                                }
                                self.event(
                                    events,
                                    GameplayEvent::presentation_effect(
                                        applied.pair.source,
                                        applied.pair.other,
                                        preset_id,
                                        GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
                                    ),
                                );
                            }
                        }
                        Some(CollisionSideEffectPayload::PlaySound {
                            sound_id,
                            volume,
                            pitch,
                        }) => {
                            if audio.len() < MAX_EVENTS {
                                audio.push(AudioEvent {
                                    sound_id: sound_id as f32,
                                    volume,
                                    pitch,
                                    channel_id: crate::audio_event::AUDIO_CHANNEL_SFX,
                                });
                            }
                        }
                        Some(CollisionSideEffectPayload::PresentationEffect {
                            actor,
                            effect_id,
                            effect_type,
                            intensity,
                            radius,
                        }) => {
                            if events.len() < MAX_EVENTS && effects.len() < MAX_EVENTS {
                                if let Some(position) = world.transform(actor) {
                                    self.event(
                                        events,
                                        GameplayEvent::presentation_effect(
                                            actor,
                                            applied.pair.source,
                                            effect_id,
                                            effect_type,
                                        ),
                                    );
                                    effects.push(EffectEvent::new(
                                        actor,
                                        applied.pair.source,
                                        effect_id,
                                        effect_type,
                                        position,
                                        intensity,
                                        radius,
                                    ));
                                }
                            } else {
                                self.capped();
                            }
                        }
                        Some(CollisionSideEffectPayload::CameraShake) => self.event(
                            events,
                            GameplayEvent::presentation_effect(
                                applied.pair.source,
                                applied.pair.other,
                                0,
                                GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE,
                            ),
                        ),
                        None => {}
                    }
                }
            }
        }
        self.contacts.finish();
        for entity in self.pending.drain(..) {
            world.despawn(entity);
        }
        for (entity, velocity) in self.moved_velocities.drain(..) {
            if world.is_current_entity(entity) {
                world.velocities[entity.id as usize] = Some(velocity);
            }
        }
        self.projectiles
            .retain(|(e, _, _)| world.is_current_entity(*e));
        spatial
            .runtime_billboards
            .retain(|(e, _)| world.is_current_entity(*e));
        self.stats[1] = self.projectiles.len() as u32;
    }
}

#[wasm_bindgen]
impl Engine {
    /// Additive input-projectile execution capability; no configuration or command ABI changes.
    pub fn data_scene_input_projectiles_version(&self) -> u32 {
        1
    }

    /// Capability and active mode flag; older Wasm builds have no such method.
    pub fn data_scene_combat_enabled(&self) -> bool {
        self.scene_mode == SceneMode::Data && self.data_scene.gameplay.combat.enabled
    }

    /// Cold diagnostics v1: version, actors, projectiles, AI steps, spawned, hits, kills, expired, capped, particles spawned.
    pub fn data_scene_combat_stats(&self) -> Vec<u32> {
        let mut values = vec![1];
        values.extend(self.data_scene.gameplay.combat.stats);
        values
    }
}
