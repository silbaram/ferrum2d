use crate::audio_event::AudioEvent;
use crate::components::gameplay::{
    GameplayFaction, ProjectileCollisionTarget, ProjectileTileImpact, SpawnAnchor, SpawnPhase,
    SpawnPrefabProjectilePayload,
};
use crate::components::{
    CollisionLayer, HeightSpan, PhysicsFloorId, ProjectileArc, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::gameplay::{
    drain_deferred_commands_into, has_bounded_deferred_command_capacity,
    plan_projectile_action_toward_target, plan_supported_spawn_prefab_action,
    prefab_spawned_event_payload, projectile_action_plan_failure_reason,
    projectile_spawn_core_data_from_plan, spawn_prefab_action_plan_failure_reason,
    spawn_prefab_core_data_from_plan, spawn_prefab_placement_is_blocked_by_tilemap,
    spawn_prefab_pre_commit_failure_reason, spawn_projectile_entity,
    try_push_bounded_deferred_command, validate_spawn_prefab_pre_commit_gates,
    PrefabSpawnedEventPayload, ProjectileActionPayload, ProjectileEntitySpawnData,
    ProjectileSpawnCoreData, SpawnPrefabActionPayload, SpawnPrefabCoreData, SpawnPrefabSupport,
};
use crate::gameplay_event::{
    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM, GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
};
use crate::tilemap::Tilemap;
use crate::world::{
    EntityTemplate, PrefabEntitySpawnRequest, PrefabSpriteTint, ProjectileSpawnRequest, World,
};

use super::super::{
    ShooterPrefabKind, ShooterPrefabResolvedComponents, ShooterPrefabTextureSlot, ShooterScene,
};
use super::{push_audio_event, GameplayEventSink};

#[cfg(test)]
use crate::gameplay::PrefabEnemyEntitySpawnData;

pub(in crate::shooter_scene) const MAX_PENDING_SPAWNS: usize = 64;

// Spawn commands stay Copy because the pending queue is a small fixed-size buffer.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Copy)]
pub(in crate::shooter_scene) enum ShooterSpawnCommand {
    Projectile(ProjectileSpawnCommand),
    Prefab(PrefabSpawnCommand),
}

#[derive(Debug, Clone, Copy)]
pub(in crate::shooter_scene) struct ProjectileSpawnCommand {
    pub(in crate::shooter_scene) transform: Transform2D,
    pub(in crate::shooter_scene) velocity: Velocity,
    pub(in crate::shooter_scene) texture_id: u32,
    pub(in crate::shooter_scene) lifetime_seconds: f32,
    pub(in crate::shooter_scene) template: EntityTemplate,
    pub(in crate::shooter_scene) damage: f32,
    pub(in crate::shooter_scene) collision_target: ProjectileCollisionTarget,
    pub(in crate::shooter_scene) tile_impact: ProjectileTileImpact,
    pub(in crate::shooter_scene) source_faction: Option<GameplayFaction>,
    pub(in crate::shooter_scene) arc: Option<ProjectileArc>,
    pub(in crate::shooter_scene) sound_id: u32,
    pub(in crate::shooter_scene) sound_volume: f32,
    pub(in crate::shooter_scene) sound_pitch: f32,
}

#[derive(Debug, Clone, Copy)]
pub(in crate::shooter_scene) struct PrefabSpawnCommand {
    pub(in crate::shooter_scene) kind: ShooterPrefabKind,
    pub(in crate::shooter_scene) layer: CollisionLayer,
    pub(in crate::shooter_scene) source: Entity,
    pub(in crate::shooter_scene) action_id: u32,
    pub(in crate::shooter_scene) prefab_id: u32,
    pub(in crate::shooter_scene) projectile: Option<ProjectileSpawnCommand>,
    pub(in crate::shooter_scene) transform: Transform2D,
    pub(in crate::shooter_scene) texture_id: u32,
    pub(in crate::shooter_scene) template: EntityTemplate,
    pub(in crate::shooter_scene) health: f32,
    pub(in crate::shooter_scene) score_reward: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum SpawnCommandDispatchResult {
    Projectile(ProjectileSpawnDispatchResult),
    Prefab(PrefabSpawnCommandDispatchResult),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SpawnFlushResultConsumption {
    prefab_spawned_event_pushed: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(in crate::shooter_scene) struct SpawnFlushResult {
    pub(in crate::shooter_scene) commands_drained: usize,
    pub(in crate::shooter_scene) projectile_spawns: usize,
    pub(in crate::shooter_scene) projectile_arcs_applied: usize,
    pub(in crate::shooter_scene) projectile_shoot_audio_events_pushed: usize,
    pub(in crate::shooter_scene) prefab_spawns: usize,
    pub(in crate::shooter_scene) prefab_spawned_payloads: usize,
    pub(in crate::shooter_scene) prefab_spawned_events_pushed: usize,
}

impl SpawnFlushResult {
    pub(in crate::shooter_scene) fn accumulate(&mut self, other: Self) {
        self.commands_drained = self.commands_drained.saturating_add(other.commands_drained);
        self.projectile_spawns = self
            .projectile_spawns
            .saturating_add(other.projectile_spawns);
        self.projectile_arcs_applied = self
            .projectile_arcs_applied
            .saturating_add(other.projectile_arcs_applied);
        self.projectile_shoot_audio_events_pushed = self
            .projectile_shoot_audio_events_pushed
            .saturating_add(other.projectile_shoot_audio_events_pushed);
        self.prefab_spawns = self.prefab_spawns.saturating_add(other.prefab_spawns);
        self.prefab_spawned_payloads = self
            .prefab_spawned_payloads
            .saturating_add(other.prefab_spawned_payloads);
        self.prefab_spawned_events_pushed = self
            .prefab_spawned_events_pushed
            .saturating_add(other.prefab_spawned_events_pushed);
    }

    fn record_dispatch(&mut self, result: SpawnCommandDispatchResult) {
        match result {
            SpawnCommandDispatchResult::Projectile(projectile) => {
                self.projectile_spawns = self.projectile_spawns.saturating_add(1);
                if projectile.arc_applied {
                    self.projectile_arcs_applied = self.projectile_arcs_applied.saturating_add(1);
                }
                if projectile.shoot_audio_event_pushed {
                    self.projectile_shoot_audio_events_pushed =
                        self.projectile_shoot_audio_events_pushed.saturating_add(1);
                }
            }
            SpawnCommandDispatchResult::Prefab(_) => {
                self.prefab_spawns = self.prefab_spawns.saturating_add(1);
                self.prefab_spawned_payloads = self.prefab_spawned_payloads.saturating_add(1);
            }
        }
    }

    fn record_consumption(&mut self, consumption: SpawnFlushResultConsumption) {
        if consumption.prefab_spawned_event_pushed {
            self.prefab_spawned_events_pushed = self.prefab_spawned_events_pushed.saturating_add(1);
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct ProjectileShootAudioData {
    sound_id: u32,
    volume: f32,
    pitch: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProjectileShootAudioDispatchResult {
    audio_event_pushed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::shooter_scene) struct ProjectileSpawnDispatchResult {
    pub(in crate::shooter_scene) spawned: Entity,
    pub(in crate::shooter_scene) arc_applied: bool,
    pub(in crate::shooter_scene) shoot_audio_event_pushed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PrefabSpawnDispatchResult {
    kind: ShooterPrefabKind,
    spawned: Entity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PrefabSpawnCommandDispatchResult {
    prefab_spawn: PrefabSpawnDispatchResult,
    spawned_event_payload: PrefabSpawnedEventPayload,
}

impl ShooterScene {
    pub(in crate::shooter_scene) fn queue_projectile_spawn(
        &mut self,
        command: ProjectileSpawnCommand,
    ) -> Result<(), u32> {
        self.queue_spawn_command(ShooterSpawnCommand::Projectile(command))
    }

    pub(in crate::shooter_scene) fn queue_prefab_spawn(
        &mut self,
        command: PrefabSpawnCommand,
    ) -> Result<(), u32> {
        self.queue_spawn_command(ShooterSpawnCommand::Prefab(command))
    }

    fn queue_spawn_command(&mut self, command: ShooterSpawnCommand) -> Result<(), u32> {
        if try_push_bounded_deferred_command(&mut self.pending_spawns, MAX_PENDING_SPAWNS, command)
        {
            Ok(())
        } else {
            Err(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL)
        }
    }

    pub(in crate::shooter_scene) fn has_pending_spawn_capacity(&self) -> bool {
        has_bounded_deferred_command_capacity(&self.pending_spawns, MAX_PENDING_SPAWNS)
    }

    pub(in crate::shooter_scene) fn commit_projectile_spawn_with_pre_commit_gate(
        &mut self,
        command: ProjectileSpawnCommand,
        commit: impl FnOnce() -> bool,
    ) -> Result<bool, u32> {
        if !self.has_pending_spawn_capacity() {
            return Err(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL);
        }
        if commit() {
            self.queue_projectile_spawn(command)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub(in crate::shooter_scene) fn commit_prefab_spawn_with_pre_commit_gate(
        &mut self,
        tilemap: &Tilemap,
        command: PrefabSpawnCommand,
        commit: impl FnOnce() -> bool,
    ) -> Result<bool, u32> {
        validate_spawn_prefab_pre_commit_gates(self.has_pending_spawn_capacity(), || match command
            .layer
        {
            CollisionLayer::Enemy => spawn_prefab_placement_is_blocked_by_tilemap(
                tilemap,
                command.template,
                command.transform,
                command.layer,
                &mut self.spawn_obstacle_contacts,
            ),
            CollisionLayer::Bullet => false,
            CollisionLayer::Player | CollisionLayer::Wall | CollisionLayer::Pickup => {
                debug_assert!(
                    false,
                    "unsupported prefab spawn commands are rejected before queueing"
                );
                true
            }
        })
        .map_err(spawn_prefab_pre_commit_failure_reason)?;
        if commit() {
            self.queue_prefab_spawn(command)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub(in crate::shooter_scene) fn projectile_spawn_command_from_core_data(
        &self,
        world: &World,
        source: Entity,
        core_data: ProjectileSpawnCoreData,
    ) -> ProjectileSpawnCommand {
        let components = self.projectile_spawn_components();
        self.projectile_spawn_command_from_core_data_with_components(
            world, source, core_data, components,
        )
    }

    fn projectile_spawn_command_from_core_data_with_components(
        &self,
        world: &World,
        source: Entity,
        core_data: ProjectileSpawnCoreData,
        components: ShooterPrefabResolvedComponents,
    ) -> ProjectileSpawnCommand {
        ProjectileSpawnCommand {
            transform: core_data.transform,
            velocity: core_data.velocity,
            texture_id: self.texture_id_for_prefab_texture_slot(components.texture),
            lifetime_seconds: core_data.lifetime_seconds,
            template: components.template,
            damage: core_data.damage,
            collision_target: core_data.collision_target,
            tile_impact: core_data.tile_impact,
            source_faction: world.gameplay_faction(source),
            arc: self.projectile_arc_for_source(world, source),
            sound_id: self.sound_ids.shoot,
            sound_volume: self.config.audio_policy.shoot_volume,
            sound_pitch: self.config.audio_policy.shoot_pitch,
        }
    }

    pub(in crate::shooter_scene) fn projectile_spawn_command_toward_player(
        &self,
        world: &World,
        source: Entity,
        payload: ProjectileActionPayload,
    ) -> Result<ProjectileSpawnCommand, u32> {
        let Some(source_t) = world.transform(source) else {
            return Err(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM);
        };
        let target = world
            .player_entity()
            .and_then(|player| world.transform(player).map(|transform| (player, transform)));
        let source_half_extent = world
            .sprites
            .get(source.id as usize)
            .copied()
            .flatten()
            .map_or(0.0, |sprite| sprite.width.max(sprite.height) * 0.5);
        let projectile_template = self.projectile_spawn_components().template;
        let bullet_half_extent = projectile_template
            .sprite_width
            .max(projectile_template.sprite_height)
            * 0.5;
        let spawn_offset = source_half_extent + bullet_half_extent;
        let plan =
            plan_projectile_action_toward_target(payload, source, source_t, target, spawn_offset)
                .map_err(projectile_action_plan_failure_reason)?;
        let command_data = projectile_spawn_core_data_from_plan(plan, payload);
        Ok(self.projectile_spawn_command_from_core_data(world, source, command_data))
    }

    fn projectile_spawn_components(&self) -> ShooterPrefabResolvedComponents {
        self.resolve_builtin_prefab_components(ShooterPrefabKind::Bullet)
    }

    fn projectile_arc_for_source(&self, world: &World, source: Entity) -> Option<ProjectileArc> {
        if !self.config.projectile_arc.enabled {
            return None;
        }
        let source_height_span = world.height_span(source).unwrap_or(HeightSpan {
            floor: PhysicsFloorId::DEFAULT,
            elevation: 0.0,
            height: 0.0,
        });
        ProjectileArc::new(
            source_height_span.floor,
            source_height_span.elevation,
            self.config.projectile_arc.launch_height,
            self.config.projectile_arc.z_velocity,
            self.config.projectile_arc.gravity,
            self.config.projectile_arc.hit_height,
        )
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn prefab_spawn_command_from_core_data(
        &self,
        core_data: SpawnPrefabCoreData,
    ) -> Result<PrefabSpawnCommand, u32> {
        let Some(components) = self.prefab_spawn_components_for_prefab_id(core_data.prefab_id)
        else {
            return Err(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB);
        };
        Ok(self.prefab_spawn_command_from_core_data_with_components(core_data, components))
    }

    fn prefab_spawn_command_from_core_data_with_components(
        &self,
        core_data: SpawnPrefabCoreData,
        components: ShooterPrefabResolvedComponents,
    ) -> PrefabSpawnCommand {
        PrefabSpawnCommand {
            kind: components.kind,
            layer: components.layer,
            source: core_data.source,
            action_id: core_data.action_id,
            prefab_id: core_data.prefab_id,
            projectile: None,
            transform: core_data.transform,
            texture_id: self.texture_id_for_prefab_texture_slot(components.texture),
            template: components.template,
            health: components
                .health
                .unwrap_or_else(|| self.active_enemy_health()),
            score_reward: components
                .score_reward
                .unwrap_or_else(|| self.active_score_reward()),
        }
    }

    #[cfg(test)]
    fn prefab_spawn_components_for_prefab_id(
        &self,
        prefab_id: u32,
    ) -> Option<ShooterPrefabResolvedComponents> {
        let registration = self.resolve_spawn_prefab_registration(prefab_id)?;
        let mut components = self.resolve_spawn_prefab_components(registration);
        if components.layer != CollisionLayer::Enemy {
            return None;
        }
        components.health = Some(self.active_enemy_health());
        components.score_reward = Some(self.active_score_reward());
        Some(components)
    }

    fn projectile_prefab_spawn_command_from_core_data_with_components(
        &self,
        world: &World,
        source: Entity,
        core_data: SpawnPrefabCoreData,
        components: ShooterPrefabResolvedComponents,
    ) -> Result<PrefabSpawnCommand, u32> {
        let Some(spawn_payload) = core_data.projectile else {
            return Err(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB);
        };
        let projectile_payload = projectile_action_payload_from_spawn_prefab_payload(spawn_payload);
        let Some(source_t) = world.transform(source) else {
            return Err(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM);
        };
        let target = world
            .player_entity()
            .and_then(|player| world.transform(player).map(|transform| (player, transform)));
        let plan =
            plan_projectile_action_toward_target(projectile_payload, source, source_t, target, 0.0)
                .map_err(projectile_action_plan_failure_reason)?;
        let mut projectile_core_data =
            projectile_spawn_core_data_from_plan(plan, projectile_payload);
        projectile_core_data.transform = core_data.transform;
        let projectile_command = self.projectile_spawn_command_from_core_data_with_components(
            world,
            source,
            projectile_core_data,
            components,
        );
        let mut command =
            self.prefab_spawn_command_from_core_data_with_components(core_data, components);
        command.projectile = Some(projectile_command);
        Ok(command)
    }

    fn texture_id_for_prefab_texture_slot(&self, slot: ShooterPrefabTextureSlot) -> u32 {
        match slot {
            ShooterPrefabTextureSlot::Player => self.texture_ids.player,
            ShooterPrefabTextureSlot::Enemy => self.texture_ids.enemy,
            ShooterPrefabTextureSlot::Bullet => self.texture_ids.bullet,
        }
    }

    pub(in crate::shooter_scene) fn spawn_prefab_command(
        &self,
        world: &World,
        source: Entity,
        action_id: u32,
        payload: SpawnPrefabActionPayload,
    ) -> Result<PrefabSpawnCommand, u32> {
        let registration = self.resolve_spawn_prefab_registration(payload.prefab_id);
        let support = match registration {
            Some(registration)
                if self.resolve_spawn_prefab_components(registration).layer
                    == CollisionLayer::Enemy
                    && payload.projectile.is_none() =>
            {
                SpawnPrefabSupport::Supported
            }
            Some(registration)
                if self.resolve_spawn_prefab_components(registration).layer
                    == CollisionLayer::Bullet
                    && payload.projectile.is_some() =>
            {
                SpawnPrefabSupport::Supported
            }
            _ => SpawnPrefabSupport::Unsupported,
        };
        let plan = plan_supported_spawn_prefab_action(payload, world.transform(source), support)
            .map_err(spawn_prefab_action_plan_failure_reason)?;
        let core_data = spawn_prefab_core_data_from_plan(source, action_id, plan);
        let Some(registration) = registration else {
            return Err(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB);
        };
        let components = self.resolve_spawn_prefab_components(registration);
        match components.layer {
            CollisionLayer::Enemy => {
                Ok(self.prefab_spawn_command_from_core_data_with_components(core_data, components))
            }
            CollisionLayer::Bullet => self
                .projectile_prefab_spawn_command_from_core_data_with_components(
                    world, source, core_data, components,
                ),
            CollisionLayer::Player | CollisionLayer::Wall | CollisionLayer::Pickup => {
                Err(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB)
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn collision_spawn_prefab_command(
        &self,
        world: &World,
        source: Entity,
        anchor: Entity,
        action_id: u32,
        prefab_id: u32,
        offset_x: f32,
        offset_y: f32,
    ) -> Result<PrefabSpawnCommand, u32> {
        let payload = SpawnPrefabActionPayload {
            prefab_id,
            projectile: None,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x,
            offset_y,
        };
        let registration = self.resolve_spawn_prefab_registration(prefab_id);
        let support = match registration {
            Some(registration)
                if self.resolve_spawn_prefab_components(registration).layer
                    == CollisionLayer::Enemy =>
            {
                SpawnPrefabSupport::Supported
            }
            _ => SpawnPrefabSupport::Unsupported,
        };
        let plan = plan_supported_spawn_prefab_action(payload, world.transform(anchor), support)
            .map_err(spawn_prefab_action_plan_failure_reason)?;
        let core_data = spawn_prefab_core_data_from_plan(source, action_id, plan);
        let Some(registration) = registration else {
            return Err(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB);
        };
        let components = self.resolve_spawn_prefab_components(registration);
        if components.layer != CollisionLayer::Enemy {
            return Err(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB);
        }
        Ok(self.prefab_spawn_command_from_core_data_with_components(core_data, components))
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn flush_pending_spawns(
        &mut self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
    ) -> SpawnFlushResult {
        self.flush_pending_spawns_with_events(world, audio_events, None)
    }

    pub(in crate::shooter_scene) fn flush_pending_spawns_with_events(
        &mut self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> SpawnFlushResult {
        let command_count =
            drain_deferred_commands_into(&mut self.pending_spawns, &mut self.spawn_commands);
        let mut flush_result = SpawnFlushResult {
            commands_drained: command_count,
            ..SpawnFlushResult::default()
        };
        for command_index in 0..command_count {
            let command = self.spawn_commands[command_index];
            let result = dispatch_spawn_command(world, audio_events, command);
            flush_result.record_dispatch(result);
            let consumption =
                consume_spawn_command_dispatch_result(result, gameplay_events.as_deref_mut());
            flush_result.record_consumption(consumption);
        }
        self.spawn_commands.clear();
        flush_result
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn spawn_projectile_now(
        &self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
        command: ProjectileSpawnCommand,
    ) -> ProjectileSpawnDispatchResult {
        spawn_projectile_now(world, audio_events, command)
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn pending_spawn_count(&self) -> usize {
        self.pending_spawns.len()
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn fill_pending_spawns_for_test(&mut self) {
        self.pending_spawns.clear();
        for _ in 0..MAX_PENDING_SPAWNS {
            self.pending_spawns
                .push(ShooterSpawnCommand::Projectile(ProjectileSpawnCommand {
                    transform: Transform2D { x: 0.0, y: 0.0 },
                    velocity: Velocity { vx: 0.0, vy: 0.0 },
                    texture_id: 0,
                    lifetime_seconds: 1.0,
                    template: EntityTemplate::new(8.0, 8.0),
                    damage: 1.0,
                    collision_target: ProjectileCollisionTarget::Enemies,
                    tile_impact: ProjectileTileImpact::Despawn,
                    source_faction: None,
                    arc: None,
                    sound_id: 0,
                    sound_volume: 0.0,
                    sound_pitch: 1.0,
                }));
        }
    }
}

fn prefab_spawned_payload_from_command(
    spawned: Entity,
    command: PrefabSpawnCommand,
) -> PrefabSpawnedEventPayload {
    prefab_spawned_event_payload(
        spawned,
        command.source,
        command.prefab_id,
        command.action_id,
    )
}

fn bullet_spawn_request_from_projectile_command(
    command: ProjectileSpawnCommand,
) -> ProjectileSpawnRequest {
    ProjectileSpawnRequest {
        transform: command.transform,
        velocity: command.velocity,
        texture_id: command.texture_id,
        lifetime: command.lifetime_seconds,
        template: command.template,
        damage: command.damage,
        collision_target: command.collision_target,
        tile_impact: command.tile_impact,
        source_faction: command.source_faction,
    }
}

fn projectile_action_payload_from_spawn_prefab_payload(
    payload: SpawnPrefabProjectilePayload,
) -> ProjectileActionPayload {
    ProjectileActionPayload {
        speed: payload.speed,
        damage: payload.damage,
        lifetime_seconds: payload.lifetime_seconds,
        aim: payload.aim,
        collision_target: payload.collision_target,
        tile_impact: payload.tile_impact,
    }
}

#[cfg(test)]
fn enemy_entity_spawn_data_from_prefab_command(
    command: PrefabSpawnCommand,
) -> PrefabEnemyEntitySpawnData {
    debug_assert_eq!(command.kind, ShooterPrefabKind::Enemy);
    debug_assert!(command.projectile.is_none());
    PrefabEnemyEntitySpawnData {
        transform: command.transform,
        texture_id: command.texture_id,
        template: command.template,
        health: command.health,
        score_reward: command.score_reward,
    }
}

fn prefab_entity_spawn_request_from_command(
    command: PrefabSpawnCommand,
) -> PrefabEntitySpawnRequest {
    let sprite_tint = match command.layer {
        CollisionLayer::Player => PrefabSpriteTint::PLAYER,
        CollisionLayer::Enemy => PrefabSpriteTint::ENEMY,
        CollisionLayer::Bullet => PrefabSpriteTint::PROJECTILE,
        CollisionLayer::Wall | CollisionLayer::Pickup => PrefabSpriteTint::PLAYER,
    };
    PrefabEntitySpawnRequest {
        transform: command.transform,
        velocity: None,
        texture_id: command.texture_id,
        template: command.template,
        layer: command.layer,
        sprite_tint,
        lifetime_seconds: None,
        projectile_policy: None,
        gameplay_faction: None,
        damage: None,
        health: Some(command.health),
        score_reward: Some(command.score_reward),
        player_marker: command.layer == CollisionLayer::Player,
    }
}

fn projectile_shoot_audio_data_from_command(
    command: ProjectileSpawnCommand,
) -> ProjectileShootAudioData {
    ProjectileShootAudioData {
        sound_id: command.sound_id,
        volume: command.sound_volume,
        pitch: command.sound_pitch,
    }
}

fn push_projectile_shoot_audio_event(
    audio_events: &mut Vec<AudioEvent>,
    data: ProjectileShootAudioData,
) -> ProjectileShootAudioDispatchResult {
    let before_len = audio_events.len();
    push_audio_event(audio_events, data.sound_id, data.volume, data.pitch);
    ProjectileShootAudioDispatchResult {
        audio_event_pushed: audio_events.len() > before_len,
    }
}

fn dispatch_spawn_command(
    world: &mut World,
    audio_events: &mut Vec<AudioEvent>,
    command: ShooterSpawnCommand,
) -> SpawnCommandDispatchResult {
    match command {
        ShooterSpawnCommand::Projectile(projectile) => {
            let spawned = spawn_projectile_now(world, audio_events, projectile);
            SpawnCommandDispatchResult::Projectile(spawned)
        }
        ShooterSpawnCommand::Prefab(prefab) => {
            let spawn_result = spawn_prefab_now(world, audio_events, prefab);
            SpawnCommandDispatchResult::Prefab(PrefabSpawnCommandDispatchResult {
                prefab_spawn: spawn_result,
                spawned_event_payload: prefab_spawned_payload_from_command(
                    spawn_result.spawned,
                    prefab,
                ),
            })
        }
    }
}

fn consume_spawn_command_dispatch_result(
    result: SpawnCommandDispatchResult,
    gameplay_events: Option<&mut GameplayEventSink<'_>>,
) -> SpawnFlushResultConsumption {
    let prefab_spawned_event_pushed = match (gameplay_events, result) {
        (Some(events), SpawnCommandDispatchResult::Prefab(prefab)) => {
            events
                .push_prefab_spawned_payload(prefab.spawned_event_payload)
                .event_pushed
        }
        (None, SpawnCommandDispatchResult::Prefab(_))
        | (_, SpawnCommandDispatchResult::Projectile(_)) => false,
    };
    SpawnFlushResultConsumption {
        prefab_spawned_event_pushed,
    }
}

fn spawn_projectile_now(
    world: &mut World,
    audio_events: &mut Vec<AudioEvent>,
    command: ProjectileSpawnCommand,
) -> ProjectileSpawnDispatchResult {
    let result = spawn_projectile_entity(
        world,
        ProjectileEntitySpawnData {
            request: bullet_spawn_request_from_projectile_command(command),
            arc: command.arc,
        },
    );
    let audio_result = push_projectile_shoot_audio_event(
        audio_events,
        projectile_shoot_audio_data_from_command(command),
    );
    ProjectileSpawnDispatchResult {
        spawned: result.spawned,
        arc_applied: result.arc_applied,
        shoot_audio_event_pushed: audio_result.audio_event_pushed,
    }
}

fn spawn_prefab_now(
    world: &mut World,
    audio_events: &mut Vec<AudioEvent>,
    command: PrefabSpawnCommand,
) -> PrefabSpawnDispatchResult {
    match command.layer {
        CollisionLayer::Enemy => {
            let spawned = world.spawn_prefab_entity_from_request(
                prefab_entity_spawn_request_from_command(command),
            );
            PrefabSpawnDispatchResult {
                kind: command.kind,
                spawned,
            }
        }
        CollisionLayer::Bullet => {
            let projectile = command
                .projectile
                .expect("bullet prefab commands carry projectile data by construction");
            let result = spawn_projectile_now(world, audio_events, projectile);
            PrefabSpawnDispatchResult {
                kind: command.kind,
                spawned: result.spawned,
            }
        }
        CollisionLayer::Player | CollisionLayer::Wall | CollisionLayer::Pickup => {
            unreachable!("unsupported prefab spawn commands are rejected before queueing")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_event::AUDIO_CHANNEL_SFX;
    use crate::components::gameplay::{
        ActionAimSource, GameplayFaction, SpawnAnchor, SpawnPhase, GAMEPLAY_FACTION_ENEMY,
    };
    use crate::gameplay::SpawnPrefabCoreData;
    use crate::gameplay_event::GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT;
    use crate::shooter_scene::{EnemyBehavior, EnemySpawnPattern, ShooterProjectileArcConfig};
    use crate::shooter_scene::{ShooterWaveConfig, DEFAULT_TEXTURE_ID};

    fn test_projectile_spawn_command() -> ProjectileSpawnCommand {
        ProjectileSpawnCommand {
            transform: Transform2D { x: 4.0, y: 8.0 },
            velocity: Velocity { vx: 12.0, vy: 0.0 },
            texture_id: 3,
            lifetime_seconds: 1.0,
            template: EntityTemplate::new(6.0, 6.0),
            damage: 1.0,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Despawn,
            source_faction: None,
            arc: None,
            sound_id: 5,
            sound_volume: 0.75,
            sound_pitch: 1.0,
        }
    }

    fn test_prefab_spawn_command() -> PrefabSpawnCommand {
        let template = EntityTemplate::new(12.0, 14.0);
        let health = 3.0;
        let score_reward = 2;
        PrefabSpawnCommand {
            kind: ShooterPrefabKind::Enemy,
            layer: CollisionLayer::Enemy,
            source: Entity {
                id: 7,
                generation: 1,
            },
            action_id: 9,
            prefab_id: 1,
            projectile: None,
            transform: Transform2D { x: 16.0, y: 24.0 },
            texture_id: 11,
            template,
            health,
            score_reward,
        }
    }

    #[test]
    fn spawn_queue_push_reports_success_and_increments_pending_count() {
        let mut scene = ShooterScene::new();

        assert_eq!(
            scene.queue_projectile_spawn(test_projectile_spawn_command()),
            Ok(())
        );
        assert_eq!(scene.pending_spawn_count(), 1);

        assert_eq!(
            scene.queue_prefab_spawn(test_prefab_spawn_command()),
            Ok(())
        );
        assert_eq!(scene.pending_spawn_count(), 2);
    }

    #[test]
    fn spawn_queue_push_reports_full_reason_without_mutating_queue() {
        let mut scene = ShooterScene::new();
        scene.fill_pending_spawns_for_test();
        let before_count = scene.pending_spawn_count();

        assert_eq!(
            scene.queue_projectile_spawn(test_projectile_spawn_command()),
            Err(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL)
        );
        assert_eq!(scene.pending_spawn_count(), before_count);
        assert_eq!(
            scene.queue_prefab_spawn(test_prefab_spawn_command()),
            Err(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL)
        );
        assert_eq!(scene.pending_spawn_count(), before_count);
    }

    #[test]
    fn prefab_spawned_payload_from_command_preserves_spawn_context() {
        let spawned = Entity {
            id: 21,
            generation: 2,
        };
        let command = test_prefab_spawn_command();

        assert_eq!(
            prefab_spawned_payload_from_command(spawned, command),
            PrefabSpawnedEventPayload {
                spawned,
                source: command.source,
                prefab_id: command.prefab_id,
                action_id: command.action_id,
            }
        );
    }

    #[test]
    fn enemy_entity_spawn_data_from_prefab_command_preserves_enemy_spawn_fields() {
        let command = test_prefab_spawn_command();

        assert_eq!(
            enemy_entity_spawn_data_from_prefab_command(command),
            PrefabEnemyEntitySpawnData {
                transform: command.transform,
                texture_id: command.texture_id,
                template: command.template,
                health: command.health,
                score_reward: command.score_reward,
            }
        );
    }

    #[test]
    fn projectile_shoot_audio_data_from_command_preserves_audio_fields() {
        let command = test_projectile_spawn_command();

        assert_eq!(
            projectile_shoot_audio_data_from_command(command),
            ProjectileShootAudioData {
                sound_id: command.sound_id,
                volume: command.sound_volume,
                pitch: command.sound_pitch,
            }
        );
    }

    #[test]
    fn bullet_spawn_request_from_projectile_command_preserves_projectile_spawn_fields() {
        let command = ProjectileSpawnCommand {
            transform: Transform2D { x: 4.0, y: 8.0 },
            velocity: Velocity { vx: 12.0, vy: -3.0 },
            texture_id: 3,
            lifetime_seconds: 1.5,
            template: EntityTemplate::new(6.0, 10.0),
            damage: 2.25,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
            source_faction: Some(GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap()),
            arc: ProjectileArc::new(PhysicsFloorId(2), 6.0, 3.0, 4.0, 9.8, 1.5),
            sound_id: 5,
            sound_volume: 0.75,
            sound_pitch: 1.0,
        };

        let request = bullet_spawn_request_from_projectile_command(command);

        assert_eq!(request.transform, command.transform);
        assert_eq!(request.velocity, command.velocity);
        assert_eq!(request.texture_id, command.texture_id);
        assert_eq!(request.lifetime, command.lifetime_seconds);
        assert_eq!(request.template, command.template);
        assert_eq!(request.damage, command.damage);
        assert_eq!(request.collision_target, command.collision_target);
        assert_eq!(request.tile_impact, command.tile_impact);
        assert_eq!(request.source_faction, command.source_faction);
    }

    #[test]
    fn spawn_projectile_now_applies_arc_and_pushes_shoot_audio_after_bullet_spawn() {
        let scene = ShooterScene::new();
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let arc = ProjectileArc::new(PhysicsFloorId(2), 6.0, 3.0, 4.0, 9.8, 1.5)
            .expect("test projectile arc values are finite and valid");
        let command = ProjectileSpawnCommand {
            transform: Transform2D { x: 4.0, y: 8.0 },
            velocity: Velocity { vx: 12.0, vy: -3.0 },
            texture_id: 3,
            lifetime_seconds: 1.5,
            template: EntityTemplate::new(6.0, 10.0),
            damage: 2.25,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
            source_faction: Some(GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap()),
            arc: Some(arc),
            sound_id: 5,
            sound_volume: 0.75,
            sound_pitch: 1.25,
        };

        let result = scene.spawn_projectile_now(&mut world, &mut audio_events, command);

        let bullet_index = world
            .alive_indices()
            .iter()
            .copied()
            .find(|&index| world.collider_layer_at(index) == Some(CollisionLayer::Bullet))
            .unwrap();
        let bullet = world
            .entity_at_index(bullet_index)
            .expect("test bullet entity should exist");
        assert_eq!(
            result,
            ProjectileSpawnDispatchResult {
                spawned: bullet,
                arc_applied: true,
                shoot_audio_event_pushed: true,
            }
        );
        assert_eq!(world.projectile_arc(bullet), Some(arc));
        assert_eq!(world.height_span(bullet), arc.height_span());
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id as u32, command.sound_id);
        assert_eq!(audio_events[0].volume, command.sound_volume);
        assert_eq!(audio_events[0].pitch, command.sound_pitch);
    }

    #[test]
    fn spawn_projectile_now_reports_no_arc_when_command_has_no_arc() {
        let scene = ShooterScene::new();
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let mut command = test_projectile_spawn_command();
        command.arc = None;

        let result = scene.spawn_projectile_now(&mut world, &mut audio_events, command);
        let spawned_index = result.spawned.id as usize;

        assert_eq!(
            result,
            ProjectileSpawnDispatchResult {
                spawned: Entity {
                    id: spawned_index as u32,
                    generation: world
                        .generation_at_index(spawned_index)
                        .expect("test entity index should exist"),
                },
                arc_applied: false,
                shoot_audio_event_pushed: true,
            }
        );
        assert_eq!(world.projectile_arc(result.spawned), None);
        assert_eq!(
            world.collider_layer_at(spawned_index),
            Some(CollisionLayer::Bullet)
        );
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id as u32, command.sound_id);
    }

    #[test]
    fn spawn_projectile_now_reports_default_sound_id_audio_skip() {
        let scene = ShooterScene::new();
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let mut command = test_projectile_spawn_command();
        command.sound_id = 0;

        let result = scene.spawn_projectile_now(&mut world, &mut audio_events, command);

        assert_eq!(
            world.collider_layer_at(result.spawned.id as usize),
            Some(CollisionLayer::Bullet)
        );
        assert_eq!(
            result,
            ProjectileSpawnDispatchResult {
                spawned: result.spawned,
                arc_applied: false,
                shoot_audio_event_pushed: false,
            }
        );
        assert!(audio_events.is_empty());
    }

    #[test]
    fn push_projectile_shoot_audio_event_uses_default_audio_skip_policy() {
        let mut audio_events = Vec::new();

        let default_sound_result = push_projectile_shoot_audio_event(
            &mut audio_events,
            ProjectileShootAudioData {
                sound_id: 0,
                volume: 0.75,
                pitch: 1.25,
            },
        );

        assert_eq!(
            default_sound_result,
            ProjectileShootAudioDispatchResult {
                audio_event_pushed: false,
            }
        );
        assert!(audio_events.is_empty());

        let pushed_result = push_projectile_shoot_audio_event(
            &mut audio_events,
            ProjectileShootAudioData {
                sound_id: 5,
                volume: 0.75,
                pitch: 1.25,
            },
        );

        assert_eq!(
            pushed_result,
            ProjectileShootAudioDispatchResult {
                audio_event_pushed: true,
            }
        );
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id, 5.0);
        assert_eq!(audio_events[0].volume, 0.75);
        assert_eq!(audio_events[0].pitch, 1.25);
        assert_eq!(audio_events[0].channel_id, AUDIO_CHANNEL_SFX);
    }

    #[test]
    fn spawn_prefab_now_spawns_enemy_from_prefab_command_fields() {
        let mut world = World::default();
        let command = test_prefab_spawn_command();
        let mut audio_events = Vec::new();

        let result = spawn_prefab_now(&mut world, &mut audio_events, command);
        let spawned = result.spawned;
        let spawned_index = spawned.id as usize;

        assert_eq!(
            result,
            PrefabSpawnDispatchResult {
                kind: ShooterPrefabKind::Enemy,
                spawned
            }
        );
        assert_eq!(
            world.transform_at_index(spawned_index),
            Some(command.transform)
        );
        assert_eq!(
            world
                .sprite_at_index(spawned_index)
                .map(|sprite| sprite.texture_id),
            Some(command.texture_id)
        );
        assert_eq!(
            world
                .sprite_at_index(spawned_index)
                .map(|sprite| sprite.width),
            Some(command.template.sprite_width)
        );
        assert_eq!(
            world
                .sprite_at_index(spawned_index)
                .map(|sprite| sprite.height),
            Some(command.template.sprite_height)
        );
        assert_eq!(world.health_at_index(spawned_index), Some(command.health));
        assert_eq!(
            world.score_reward_at_index(spawned_index),
            Some(command.score_reward)
        );
        assert_eq!(
            world.collider_layer_at(spawned_index),
            Some(CollisionLayer::Enemy)
        );
    }

    #[test]
    fn dispatch_projectile_spawn_command_spawns_bullet_audio_without_prefab_payload() {
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let command = test_projectile_spawn_command();

        let result = dispatch_spawn_command(
            &mut world,
            &mut audio_events,
            ShooterSpawnCommand::Projectile(command),
        );

        assert_eq!(
            result,
            SpawnCommandDispatchResult::Projectile(ProjectileSpawnDispatchResult {
                spawned: Entity {
                    id: 0,
                    generation: world
                        .generation_at_index(0)
                        .expect("test entity index should exist"),
                },
                arc_applied: false,
                shoot_audio_event_pushed: true,
            })
        );
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id as u32, command.sound_id);
        let bullet_count = world
            .alive_indices()
            .iter()
            .filter(|&&index| world.collider_layer_at(index) == Some(CollisionLayer::Bullet))
            .count();
        assert_eq!(bullet_count, 1);
    }

    #[test]
    fn dispatch_prefab_spawn_command_returns_prefab_payload_after_enemy_spawn() {
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let command = test_prefab_spawn_command();

        let result = dispatch_spawn_command(
            &mut world,
            &mut audio_events,
            ShooterSpawnCommand::Prefab(command),
        );

        let SpawnCommandDispatchResult::Prefab(prefab_result) = result else {
            panic!("prefab spawn command must return prefab dispatch result");
        };
        assert!(audio_events.is_empty());
        assert_eq!(
            prefab_result.prefab_spawn,
            PrefabSpawnDispatchResult {
                kind: ShooterPrefabKind::Enemy,
                spawned: prefab_result.spawned_event_payload.spawned,
            }
        );
        assert_eq!(prefab_result.spawned_event_payload.source, command.source);
        assert_eq!(
            prefab_result.spawned_event_payload.prefab_id,
            command.prefab_id
        );
        assert_eq!(
            prefab_result.spawned_event_payload.action_id,
            command.action_id
        );
        assert_eq!(
            world.collider_layer_at(prefab_result.prefab_spawn.spawned.id as usize),
            Some(CollisionLayer::Enemy)
        );
        assert_eq!(
            world.transform_at_index(prefab_result.prefab_spawn.spawned.id as usize),
            Some(command.transform)
        );
    }

    #[test]
    fn consume_spawn_command_dispatch_result_pushes_only_prefab_spawned_payload() {
        let source = Entity {
            id: 7,
            generation: 1,
        };
        let spawned = Entity {
            id: 11,
            generation: 2,
        };
        let payload = PrefabSpawnedEventPayload {
            spawned,
            source,
            prefab_id: 3,
            action_id: 5,
        };
        let mut gameplay_events = Vec::new();

        let result = {
            let mut sink = GameplayEventSink::new(&mut gameplay_events);
            consume_spawn_command_dispatch_result(
                SpawnCommandDispatchResult::Prefab(PrefabSpawnCommandDispatchResult {
                    prefab_spawn: PrefabSpawnDispatchResult {
                        kind: ShooterPrefabKind::Enemy,
                        spawned,
                    },
                    spawned_event_payload: payload,
                }),
                Some(&mut sink),
            )
        };

        assert_eq!(
            result,
            SpawnFlushResultConsumption {
                prefab_spawned_event_pushed: true,
            }
        );
        assert_eq!(gameplay_events.len(), 1);
        assert_eq!(gameplay_events[0].actor_id, spawned.id);
        assert_eq!(gameplay_events[0].source_id, source.id);
        assert_eq!(gameplay_events[0].token_id, payload.prefab_id);
        assert_eq!(gameplay_events[0].payload_bits, payload.action_id);

        let result = {
            let mut sink = GameplayEventSink::new(&mut gameplay_events);
            consume_spawn_command_dispatch_result(
                SpawnCommandDispatchResult::Projectile(ProjectileSpawnDispatchResult {
                    spawned,
                    arc_applied: false,
                    shoot_audio_event_pushed: false,
                }),
                Some(&mut sink),
            )
        };

        assert_eq!(
            result,
            SpawnFlushResultConsumption {
                prefab_spawned_event_pushed: false,
            }
        );
        assert_eq!(gameplay_events.len(), 1);
    }

    #[test]
    fn consume_spawn_command_dispatch_result_reports_unpushed_without_event_sink() {
        let spawned = Entity {
            id: 11,
            generation: 2,
        };
        let payload = PrefabSpawnedEventPayload {
            spawned,
            source: Entity {
                id: 7,
                generation: 1,
            },
            prefab_id: 3,
            action_id: 5,
        };

        let result = consume_spawn_command_dispatch_result(
            SpawnCommandDispatchResult::Prefab(PrefabSpawnCommandDispatchResult {
                prefab_spawn: PrefabSpawnDispatchResult {
                    kind: ShooterPrefabKind::Enemy,
                    spawned,
                },
                spawned_event_payload: payload,
            }),
            None,
        );

        assert_eq!(
            result,
            SpawnFlushResultConsumption {
                prefab_spawned_event_pushed: false,
            }
        );
    }

    #[test]
    fn spawn_flush_result_counts_dispatch_variants_without_consuming_events() {
        let spawned = Entity {
            id: 11,
            generation: 2,
        };
        let payload = PrefabSpawnedEventPayload {
            spawned,
            source: Entity {
                id: 7,
                generation: 1,
            },
            prefab_id: 3,
            action_id: 5,
        };
        let mut result = SpawnFlushResult::default();

        result.record_dispatch(SpawnCommandDispatchResult::Projectile(
            ProjectileSpawnDispatchResult {
                spawned,
                arc_applied: true,
                shoot_audio_event_pushed: true,
            },
        ));
        result.record_dispatch(SpawnCommandDispatchResult::Prefab(
            PrefabSpawnCommandDispatchResult {
                prefab_spawn: PrefabSpawnDispatchResult {
                    kind: ShooterPrefabKind::Enemy,
                    spawned,
                },
                spawned_event_payload: payload,
            },
        ));

        assert_eq!(
            result,
            SpawnFlushResult {
                commands_drained: 0,
                projectile_spawns: 1,
                projectile_arcs_applied: 1,
                projectile_shoot_audio_events_pushed: 1,
                prefab_spawns: 1,
                prefab_spawned_payloads: 1,
                prefab_spawned_events_pushed: 0,
            }
        );
    }

    #[test]
    fn spawn_flush_result_accumulates_substep_results() {
        let mut result = SpawnFlushResult {
            commands_drained: 1,
            projectile_spawns: 1,
            projectile_arcs_applied: 1,
            projectile_shoot_audio_events_pushed: 1,
            prefab_spawns: 0,
            prefab_spawned_payloads: 0,
            prefab_spawned_events_pushed: 0,
        };

        result.accumulate(SpawnFlushResult {
            commands_drained: 2,
            projectile_spawns: 0,
            projectile_arcs_applied: 0,
            projectile_shoot_audio_events_pushed: 0,
            prefab_spawns: 2,
            prefab_spawned_payloads: 2,
            prefab_spawned_events_pushed: 1,
        });

        assert_eq!(
            result,
            SpawnFlushResult {
                commands_drained: 3,
                projectile_spawns: 1,
                projectile_arcs_applied: 1,
                projectile_shoot_audio_events_pushed: 1,
                prefab_spawns: 2,
                prefab_spawned_payloads: 2,
                prefab_spawned_events_pushed: 1,
            }
        );
    }

    #[test]
    fn flush_pending_spawns_preserves_mixed_command_order_and_emits_prefab_payload() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let projectile = test_projectile_spawn_command();
        let prefab = test_prefab_spawn_command();
        assert_eq!(scene.queue_projectile_spawn(projectile), Ok(()));
        assert_eq!(scene.queue_prefab_spawn(prefab), Ok(()));
        let mut gameplay_events = Vec::new();

        {
            let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
            let result = scene.flush_pending_spawns_with_events(
                &mut world,
                &mut audio_events,
                Some(&mut gameplay_sink),
            );
            assert_eq!(
                result,
                SpawnFlushResult {
                    commands_drained: 2,
                    projectile_spawns: 1,
                    projectile_arcs_applied: 0,
                    projectile_shoot_audio_events_pushed: 1,
                    prefab_spawns: 1,
                    prefab_spawned_payloads: 1,
                    prefab_spawned_events_pushed: 1,
                }
            );
        }

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id as u32, projectile.sound_id);
        assert_eq!(gameplay_events.len(), 1);
        assert_eq!(gameplay_events[0].actor_id, 1);
        assert_eq!(gameplay_events[0].source_id, prefab.source.id);
        assert_eq!(gameplay_events[0].token_id, prefab.prefab_id);
        assert_eq!(gameplay_events[0].payload_bits, prefab.action_id);
        assert_eq!(world.collider_layer_at(0), Some(CollisionLayer::Bullet));
        assert_eq!(world.collider_layer_at(1), Some(CollisionLayer::Enemy));
    }

    #[test]
    fn flush_pending_spawns_reports_aggregate_result_without_event_sink() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let mut projectile = test_projectile_spawn_command();
        projectile.arc = Some(
            ProjectileArc::new(PhysicsFloorId(2), 6.0, 3.0, 4.0, 9.8, 1.5)
                .expect("test projectile arc values are finite and valid"),
        );
        let prefab = test_prefab_spawn_command();
        assert_eq!(scene.queue_projectile_spawn(projectile), Ok(()));
        assert_eq!(scene.queue_prefab_spawn(prefab), Ok(()));

        let result = scene.flush_pending_spawns(&mut world, &mut audio_events);

        assert_eq!(
            result,
            SpawnFlushResult {
                commands_drained: 2,
                projectile_spawns: 1,
                projectile_arcs_applied: 1,
                projectile_shoot_audio_events_pushed: 1,
                prefab_spawns: 1,
                prefab_spawned_payloads: 1,
                prefab_spawned_events_pushed: 0,
            }
        );
        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(audio_events.len(), 1);
        assert_eq!(world.collider_layer_at(0), Some(CollisionLayer::Bullet));
        assert_eq!(
            world.projectile_arc(Entity {
                id: 0,
                generation: 0
            }),
            projectile.arc
        );
        assert_eq!(world.collider_layer_at(1), Some(CollisionLayer::Enemy));
    }

    #[test]
    fn projectile_spawn_pre_commit_gate_queues_only_after_successful_commit() {
        let mut scene = ShooterScene::new();
        let mut did_commit = false;

        let result = scene.commit_projectile_spawn_with_pre_commit_gate(
            test_projectile_spawn_command(),
            || {
                did_commit = true;
                true
            },
        );

        assert_eq!(result, Ok(true));
        assert!(did_commit);
        assert_eq!(scene.pending_spawn_count(), 1);
    }

    #[test]
    fn projectile_spawn_pre_commit_gate_skips_queue_when_commit_returns_false() {
        let mut scene = ShooterScene::new();
        let mut did_check_commit = false;

        let result = scene.commit_projectile_spawn_with_pre_commit_gate(
            test_projectile_spawn_command(),
            || {
                did_check_commit = true;
                false
            },
        );

        assert_eq!(result, Ok(false));
        assert!(did_check_commit);
        assert_eq!(scene.pending_spawn_count(), 0);
    }

    #[test]
    fn projectile_spawn_pre_commit_gate_reports_full_without_calling_commit() {
        let mut scene = ShooterScene::new();
        scene.fill_pending_spawns_for_test();
        let before_count = scene.pending_spawn_count();
        let mut did_check_commit = false;

        let result = scene.commit_projectile_spawn_with_pre_commit_gate(
            test_projectile_spawn_command(),
            || {
                did_check_commit = true;
                true
            },
        );

        assert_eq!(result, Err(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL));
        assert!(!did_check_commit);
        assert_eq!(scene.pending_spawn_count(), before_count);
    }

    #[test]
    fn prefab_spawn_pre_commit_gate_queues_only_after_successful_commit() {
        let mut scene = ShooterScene::new();
        let tilemap = Tilemap::default();
        let mut did_commit = false;

        let result = scene.commit_prefab_spawn_with_pre_commit_gate(
            &tilemap,
            test_prefab_spawn_command(),
            || {
                did_commit = true;
                true
            },
        );

        assert_eq!(result, Ok(true));
        assert!(did_commit);
        assert_eq!(scene.pending_spawn_count(), 1);
    }

    #[test]
    fn prefab_spawn_pre_commit_gate_skips_queue_when_commit_returns_false() {
        let mut scene = ShooterScene::new();
        let tilemap = Tilemap::default();
        let mut did_check_commit = false;

        let result = scene.commit_prefab_spawn_with_pre_commit_gate(
            &tilemap,
            test_prefab_spawn_command(),
            || {
                did_check_commit = true;
                false
            },
        );

        assert_eq!(result, Ok(false));
        assert!(did_check_commit);
        assert_eq!(scene.pending_spawn_count(), 0);
    }

    #[test]
    fn prefab_spawn_pre_commit_gate_reports_blocked_without_calling_commit() {
        let mut scene = ShooterScene::new();
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, true, vec![1]);
        let mut did_check_commit = false;

        let result = scene.commit_prefab_spawn_with_pre_commit_gate(
            &tilemap,
            test_prefab_spawn_command(),
            || {
                did_check_commit = true;
                true
            },
        );

        assert_eq!(result, Err(GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT));
        assert!(!did_check_commit);
        assert_eq!(scene.pending_spawn_count(), 0);
    }

    #[test]
    fn prefab_spawn_pre_commit_gate_reports_full_before_blocked_placement() {
        let mut scene = ShooterScene::new();
        scene.fill_pending_spawns_for_test();
        let before_count = scene.pending_spawn_count();
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, true, vec![1]);
        let mut did_check_commit = false;

        let result = scene.commit_prefab_spawn_with_pre_commit_gate(
            &tilemap,
            test_prefab_spawn_command(),
            || {
                did_check_commit = true;
                true
            },
        );

        assert_eq!(result, Err(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL));
        assert!(!did_check_commit);
        assert_eq!(scene.pending_spawn_count(), before_count);
    }

    #[test]
    fn projectile_spawn_command_from_core_data_adds_scene_fields_and_arc() {
        let mut scene = ShooterScene::new();
        scene.texture_ids.bullet = 17;
        scene.sound_ids.shoot = 23;
        scene.config.bullet_template = EntityTemplate::new(6.0, 10.0);
        scene.config.audio_policy.shoot_volume = 0.25;
        scene.config.audio_policy.shoot_pitch = 1.25;
        scene.config.projectile_arc =
            ShooterProjectileArcConfig::from_values(true, 3.0, 4.0, 9.8, 1.5);

        let mut world = World::default();
        let source = world.spawn_enemy(32.0, 48.0, DEFAULT_TEXTURE_ID);
        let source_faction = GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap();
        world.set_gameplay_faction(source, source_faction);
        let source_height_span = HeightSpan::new(PhysicsFloorId(2), 6.0, 8.0).unwrap();
        assert!(world.set_height_span(source, source_height_span));

        let core_data = ProjectileSpawnCoreData {
            transform: Transform2D { x: 40.0, y: 48.0 },
            velocity: Velocity { vx: 120.0, vy: 0.0 },
            lifetime_seconds: 1.4,
            damage: 2.5,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
        };

        let command = scene.projectile_spawn_command_from_core_data(&world, source, core_data);

        assert_eq!(command.transform, core_data.transform);
        assert_eq!(command.velocity, core_data.velocity);
        assert_eq!(command.texture_id, 17);
        assert_eq!(command.lifetime_seconds, 1.4);
        assert_eq!(command.template, EntityTemplate::new(6.0, 10.0));
        assert_eq!(command.damage, 2.5);
        assert_eq!(command.collision_target, ProjectileCollisionTarget::Player);
        assert_eq!(command.tile_impact, ProjectileTileImpact::Bounce);
        assert_eq!(command.source_faction, Some(source_faction));
        assert_eq!(
            command.arc,
            ProjectileArc::new(PhysicsFloorId(2), 6.0, 3.0, 4.0, 9.8, 1.5)
        );
        assert_eq!(command.sound_id, 23);
        assert_eq!(command.sound_volume, 0.25);
        assert_eq!(command.sound_pitch, 1.25);
    }

    #[test]
    fn projectile_spawn_command_toward_player_plans_and_adds_scene_fields() {
        let mut scene = ShooterScene::new();
        scene.texture_ids.bullet = 17;
        scene.sound_ids.shoot = 23;
        scene.config.bullet_template = EntityTemplate::new(6.0, 10.0);
        scene.config.audio_policy.shoot_volume = 0.25;
        scene.config.audio_policy.shoot_pitch = 1.25;

        let mut world = World::default();
        let source = world.spawn_enemy(32.0, 48.0, DEFAULT_TEXTURE_ID);
        let player = world.spawn_player(132.0, 48.0, DEFAULT_TEXTURE_ID);
        let source_sprite = world
            .sprite_at_index(source.id as usize)
            .expect("spawned enemy should have a sprite");
        let source_half_extent = source_sprite.width.max(source_sprite.height) * 0.5;
        let bullet_half_extent = scene
            .config
            .bullet_template
            .sprite_width
            .max(scene.config.bullet_template.sprite_height)
            * 0.5;
        let payload = ProjectileActionPayload {
            speed: 120.0,
            damage: 3.0,
            lifetime_seconds: 1.5,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
        };

        let command = scene
            .projectile_spawn_command_toward_player(&world, source, payload)
            .unwrap();

        assert_eq!(world.player_entity(), Some(player));
        assert!(
            (command.transform.x - (32.0 + source_half_extent + bullet_half_extent)).abs() < 0.001
        );
        assert!((command.transform.y - 48.0).abs() < 0.001);
        assert_eq!(command.velocity, Velocity { vx: 120.0, vy: 0.0 });
        assert_eq!(command.texture_id, 17);
        assert_eq!(command.lifetime_seconds, 1.5);
        assert_eq!(command.template, EntityTemplate::new(6.0, 10.0));
        assert_eq!(command.damage, 3.0);
        assert_eq!(command.collision_target, ProjectileCollisionTarget::Player);
        assert_eq!(command.tile_impact, ProjectileTileImpact::Bounce);
        assert_eq!(command.sound_id, 23);
        assert_eq!(command.sound_volume, 0.25);
        assert_eq!(command.sound_pitch, 1.25);
    }

    #[test]
    fn prefab_spawn_command_from_core_data_adds_scene_fields() {
        let mut scene = ShooterScene::new();
        scene.texture_ids.enemy = 31;
        scene.config.enemy_template = EntityTemplate::new(20.0, 24.0);
        scene.config.enemy_health = 7.5;
        scene.config.score_reward = 11;

        let mut world = World::default();
        let source = world.spawn_entity();
        let core_data = SpawnPrefabCoreData {
            source,
            action_id: 41,
            prefab_id: 1,
            projectile: None,
            transform: Transform2D { x: 72.0, y: 80.0 },
        };

        let command = scene
            .prefab_spawn_command_from_core_data(core_data)
            .unwrap();

        assert_eq!(command.source, source);
        assert_eq!(command.action_id, 41);
        assert_eq!(command.prefab_id, 1);
        assert_eq!(command.transform, Transform2D { x: 72.0, y: 80.0 });
        assert_eq!(command.texture_id, 31);
        assert_eq!(command.template, EntityTemplate::new(20.0, 24.0));
        assert_eq!(command.health, 7.5);
        assert_eq!(command.score_reward, 11);
    }

    #[test]
    fn spawn_prefab_command_plans_and_adds_scene_fields() {
        let mut scene = ShooterScene::new();
        scene.texture_ids.enemy = 31;
        scene.config.enemy_template = EntityTemplate::new(20.0, 24.0);
        scene.config.enemy_health = 7.5;
        scene.config.score_reward = 11;

        let mut world = World::default();
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 72.0, y: 80.0 });

        let command = scene
            .spawn_prefab_command(
                &world,
                source,
                41,
                SpawnPrefabActionPayload {
                    prefab_id: 1,
                    projectile: None,
                    anchor: SpawnAnchor::SelfEntity,
                    phase: SpawnPhase::PrePhysics,
                    offset_x: 4.0,
                    offset_y: -8.0,
                },
            )
            .unwrap();

        assert_eq!(command.source, source);
        assert_eq!(command.action_id, 41);
        assert_eq!(command.prefab_id, 1);
        assert_eq!(command.transform, Transform2D { x: 76.0, y: 72.0 });
        assert_eq!(command.texture_id, 31);
        assert_eq!(command.template, EntityTemplate::new(20.0, 24.0));
        assert_eq!(command.health, 7.5);
        assert_eq!(command.score_reward, 11);
    }

    #[test]
    fn spawn_prefab_command_uses_registered_enemy_prefab_alias() {
        let mut scene = ShooterScene::new();
        scene.texture_ids.enemy = 31;
        scene.config.enemy_template = EntityTemplate::new(20.0, 24.0);
        scene.config.enemy_health = 7.5;
        scene.config.score_reward = 11;
        assert!(scene.register_spawn_prefab_kind(7, ShooterPrefabKind::Enemy));

        let mut world = World::default();
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 72.0, y: 80.0 });

        let command = scene
            .spawn_prefab_command(
                &world,
                source,
                41,
                SpawnPrefabActionPayload {
                    prefab_id: 7,
                    projectile: None,
                    anchor: SpawnAnchor::SelfEntity,
                    phase: SpawnPhase::PrePhysics,
                    offset_x: 4.0,
                    offset_y: -8.0,
                },
            )
            .unwrap();

        assert_eq!(command.prefab_id, 7);
        assert_eq!(command.transform, Transform2D { x: 76.0, y: 72.0 });
        assert_eq!(command.texture_id, 31);
        assert_eq!(command.template, EntityTemplate::new(20.0, 24.0));
        assert_eq!(command.health, 7.5);
        assert_eq!(command.score_reward, 11);
    }

    #[test]
    fn spawn_prefab_command_uses_registered_bullet_prefab_alias_with_projectile_payload() {
        let mut scene = ShooterScene::new();
        scene.texture_ids.bullet = 17;
        scene.config.bullet_template = EntityTemplate::new(6.0, 10.0);
        assert!(scene.register_spawn_prefab_kind(9, ShooterPrefabKind::Bullet));

        let mut world = World::default();
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 72.0, y: 80.0 });
        let player = world.spawn_player(172.0, 80.0, DEFAULT_TEXTURE_ID);

        let command = scene
            .spawn_prefab_command(
                &world,
                source,
                41,
                SpawnPrefabActionPayload {
                    prefab_id: 9,
                    projectile: Some(SpawnPrefabProjectilePayload {
                        speed: 120.0,
                        damage: 3.0,
                        lifetime_seconds: 1.5,
                        aim: ActionAimSource::TargetPlayer,
                        collision_target: ProjectileCollisionTarget::Player,
                        tile_impact: ProjectileTileImpact::Bounce,
                    }),
                    anchor: SpawnAnchor::SelfEntity,
                    phase: SpawnPhase::PrePhysics,
                    offset_x: 4.0,
                    offset_y: -8.0,
                },
            )
            .unwrap();

        let projectile = command
            .projectile
            .expect("bullet prefab command should carry projectile command data");
        assert_eq!(world.player_entity(), Some(player));
        assert_eq!(command.kind, ShooterPrefabKind::Bullet);
        assert_eq!(command.prefab_id, 9);
        assert_eq!(command.transform, Transform2D { x: 76.0, y: 72.0 });
        assert_eq!(projectile.transform, Transform2D { x: 76.0, y: 72.0 });
        assert_eq!(projectile.velocity, Velocity { vx: 120.0, vy: 0.0 });
        assert_eq!(projectile.texture_id, 17);
        assert_eq!(projectile.template, EntityTemplate::new(6.0, 10.0));
        assert_eq!(projectile.damage, 3.0);
        assert_eq!(projectile.lifetime_seconds, 1.5);
        assert_eq!(
            projectile.collision_target,
            ProjectileCollisionTarget::Player
        );
        assert_eq!(projectile.tile_impact, ProjectileTileImpact::Bounce);
    }

    #[test]
    fn prefab_spawn_command_from_core_data_uses_active_wave_combat_values() {
        let mut scene = ShooterScene::new();
        scene.config.enemy_health = 2.0;
        scene.config.score_reward = 3;
        scene.set_wave_config(
            0,
            ShooterWaveConfig::from_values(
                10.0,
                0.25,
                1,
                72.0,
                EnemyBehavior::Chase,
                EnemySpawnPattern::Center,
                9.0,
                13,
            ),
        );

        let mut world = World::default();
        let source = world.spawn_entity();
        let command = scene
            .prefab_spawn_command_from_core_data(SpawnPrefabCoreData {
                source,
                action_id: 41,
                prefab_id: 1,
                projectile: None,
                transform: Transform2D { x: 72.0, y: 80.0 },
            })
            .unwrap();

        assert_eq!(command.health, 9.0);
        assert_eq!(command.score_reward, 13);
    }
}
