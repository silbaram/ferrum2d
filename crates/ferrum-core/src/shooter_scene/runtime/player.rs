#[cfg(test)]
use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::components::gameplay::{
    ActionAimSource, ActionPattern, ProjectileCollisionTarget, ProjectileTileImpact,
};
use crate::components::{Transform2D, Velocity};
use crate::entity::Entity;
use crate::gameplay::{
    action_failure_event_data, apply_dash_action_core_data, apply_topdown_input_movement_phase,
    dash_action_core_data_from_plan, input_action_trigger_failure_decision_for_policy,
    melee_attack_core_data_from_plan, plan_input_dash_action_transform, plan_input_melee_action,
    plan_input_projectile_action, prepare_input_action_if_ready,
    projectile_action_plan_failure_reason, projectile_spawn_core_data_from_plan,
    push_action_failure_event, should_report_fixed_action_pattern_mismatch,
    topdown_input_direction, validate_input_projectile_action_support,
    ActionAttemptFailureDecision, ActionAttemptFailurePolicy, DashActionPayload,
    FrameInputSnapshot, InputActionTrigger, MeleeActionPayload, ProjectileActionPayload,
    SpawnPrefabActionPayload, TopdownInputMovementPhaseConfig,
};
use crate::gameplay_event::{
    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM, GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
    GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
};
use crate::input::{InputActionRegistry, InputState};
use crate::physics::{PhysicsBounds, PhysicsSystem};
use crate::tilemap::Tilemap;
use crate::world::World;

use super::super::{
    ShooterScene, SHOOTER_DASH_ACTION_ID, SHOOTER_MELEE_ACTION_ID, SHOOTER_PRIMARY_FIRE_ACTION_ID,
};
use super::spawn::ProjectileSpawnCommand;
use super::{
    commit_prepared_input_action, dash_action_plan_failure_reason,
    melee_action_plan_failure_reason, ActionPatternKind, GameplayEventSink,
};

#[derive(Debug, Clone, Copy)]
pub(in crate::shooter_scene) struct ProjectileFireConfig {
    pub(in crate::shooter_scene) speed: f32,
    pub(in crate::shooter_scene) damage: f32,
    pub(in crate::shooter_scene) lifetime_seconds: f32,
    pub(in crate::shooter_scene) aim: ActionAimSource,
    pub(in crate::shooter_scene) collision_target: ProjectileCollisionTarget,
    pub(in crate::shooter_scene) tile_impact: ProjectileTileImpact,
}

#[derive(Debug, Clone, Copy)]
struct PlayerActionInput<'a> {
    snapshot: FrameInputSnapshot,
    registry: &'a InputActionRegistry,
}

impl ShooterScene {
    #[cfg(test)]
    pub(in crate::shooter_scene) fn apply_player_input(
        &mut self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        _audio_events: &mut Vec<AudioEvent>,
    ) {
        // Compatibility helper for legacy tests; production frames flush
        // deferred spawns and emit audio through `update_internal`.
        let input_actions = InputActionRegistry::default();
        let previous_input = self.previous_input;
        self.apply_player_input_with_actions(
            world,
            camera,
            input,
            previous_input,
            &input_actions,
            &Tilemap::default(),
            None,
        );
        self.previous_space = input.space;
        self.previous_enter = input.enter;
        self.previous_mouse_left = input.mouse_left;
        self.previous_input = input;
    }

    pub(in crate::shooter_scene) fn normalized_input_direction(input: InputState) -> Velocity {
        topdown_input_direction(input)
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn apply_player_movement_input(
        &mut self,
        world: &mut World,
        input: InputState,
    ) {
        self.apply_player_movement_input_snapshot(world, FrameInputSnapshot::current_only(input));
    }

    pub(in crate::shooter_scene) fn apply_player_movement_input_snapshot(
        &mut self,
        world: &mut World,
        input: FrameInputSnapshot,
    ) {
        if let Some(player) = world.primary_actor_entity() {
            apply_topdown_input_movement_phase(
                world,
                TopdownInputMovementPhaseConfig {
                    entity: player,
                    input,
                    default_speed: self.config.player_speed,
                },
            );
        }
    }

    #[cfg(test)]
    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn apply_player_input_with_actions(
        &mut self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        previous_input: InputState,
        input_actions: &InputActionRegistry,
        tilemap: &Tilemap,
        gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) {
        let input = FrameInputSnapshot::new(input, previous_input);
        self.apply_player_movement_input_snapshot(world, input);
        self.apply_player_actions_with_snapshot(
            world,
            camera,
            input,
            input_actions,
            tilemap,
            gameplay_events,
        );
    }

    #[allow(clippy::too_many_arguments)]
    #[cfg(test)]
    pub(in crate::shooter_scene) fn apply_player_actions_with_input(
        &mut self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        previous_input: InputState,
        input_actions: &InputActionRegistry,
        tilemap: &Tilemap,
        gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) {
        self.apply_player_actions_with_snapshot(
            world,
            camera,
            FrameInputSnapshot::new(input, previous_input),
            input_actions,
            tilemap,
            gameplay_events,
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn apply_player_actions_with_snapshot(
        &mut self,
        world: &mut World,
        camera: &Camera2D,
        input: FrameInputSnapshot,
        input_actions: &InputActionRegistry,
        tilemap: &Tilemap,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) {
        let Some(player) = world.primary_actor_entity() else {
            return;
        };
        let dir = Self::normalized_input_direction(input.current);
        let action_input = PlayerActionInput {
            snapshot: input,
            registry: input_actions,
        };
        self.try_dash_player(
            world,
            camera,
            action_input,
            player,
            dir,
            gameplay_events.as_deref_mut(),
        );
        self.try_queue_melee_player(world, action_input, player, gameplay_events.as_deref_mut());
        let spawn_prefab_consumed_primary_fire = self.try_queue_spawn_prefab_player(
            world,
            action_input,
            player,
            tilemap,
            gameplay_events.as_deref_mut(),
        );
        if spawn_prefab_consumed_primary_fire {
            return;
        }
        if self.try_queue_projectile_player(
            world,
            action_input,
            camera,
            player,
            gameplay_events.as_deref_mut(),
        ) {
            return;
        }

        let wants_legacy_fire = input.current.space == 1 || input.current.mouse_left == 1;
        if wants_legacy_fire
            && self.primary_fire_binding_blocks_legacy_fire(world, player, gameplay_events)
        {
            return;
        }
        if wants_legacy_fire
            && self.fire_cooldown_seconds <= 0.0
            && self.queue_bullet_toward_mouse_with_projectile(
                world,
                camera,
                input.current,
                player,
                ProjectileFireConfig {
                    speed: self.config.bullet_speed,
                    damage: self.config.bullet_damage,
                    lifetime_seconds: self.config.bullet_lifetime,
                    aim: ActionAimSource::Input,
                    collision_target: ProjectileCollisionTarget::Enemies,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        {
            self.fire_cooldown_seconds = self.config.fire_cooldown;
        }
    }

    fn primary_fire_binding_blocks_legacy_fire(
        &self,
        world: &World,
        player: Entity,
        gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> bool {
        let Some(binding) = world.action_binding(player, SHOOTER_PRIMARY_FIRE_ACTION_ID) else {
            return false;
        };
        let kind = ActionPatternKind::from_pattern(binding.pattern);
        if matches!(
            kind,
            ActionPatternKind::Projectile | ActionPatternKind::SpawnPrefab
        ) {
            return true;
        }
        if should_report_fixed_action_pattern_mismatch(Some(kind)) {
            push_action_failure_event(
                gameplay_events,
                action_failure_event_data(
                    player,
                    player,
                    SHOOTER_PRIMARY_FIRE_ACTION_ID,
                    GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
                ),
            );
        }
        true
    }

    fn try_queue_melee_player(
        &mut self,
        world: &mut World,
        action_input: PlayerActionInput<'_>,
        player: Entity,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) {
        match prepare_input_action_if_ready(
            world,
            action_input.registry,
            action_input.snapshot,
            player,
            SHOOTER_MELEE_ACTION_ID,
            ActionPatternKind::Melee,
        ) {
            InputActionTrigger::Ready(prepared) => {
                let Some(player_t) = world.transform(player) else {
                    push_action_failure_event(
                        gameplay_events.as_deref_mut(),
                        action_failure_event_data(
                            player,
                            player,
                            SHOOTER_MELEE_ACTION_ID,
                            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
                        ),
                    );
                    return;
                };
                let ActionPattern::Melee {
                    range,
                    damage,
                    target,
                } = prepared.binding.pattern
                else {
                    push_action_failure_event(
                        gameplay_events.as_deref_mut(),
                        action_failure_event_data(
                            player,
                            player,
                            SHOOTER_MELEE_ACTION_ID,
                            GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
                        ),
                    );
                    return;
                };
                let plan = match plan_input_melee_action(
                    MeleeActionPayload {
                        range,
                        damage,
                        target,
                    },
                    player_t,
                ) {
                    Ok(plan) => plan,
                    Err(error) => {
                        push_action_failure_event(
                            gameplay_events,
                            action_failure_event_data(
                                player,
                                player,
                                SHOOTER_MELEE_ACTION_ID,
                                melee_action_plan_failure_reason(error),
                            ),
                        );
                        return;
                    }
                };
                let core_data = melee_attack_core_data_from_plan(
                    prepared.entity,
                    plan,
                    world.height_span(prepared.entity),
                );
                if commit_prepared_input_action(world, prepared) {
                    self.queue_melee_attack(core_data);
                }
            }
            trigger @ InputActionTrigger::PatternMismatch => {
                if should_report_fixed_action_pattern_mismatch(
                    world
                        .action_binding(player, SHOOTER_MELEE_ACTION_ID)
                        .map(|binding| ActionPatternKind::from_pattern(binding.pattern)),
                ) {
                    if let ActionAttemptFailureDecision::Failure(reason_code) =
                        input_action_trigger_failure_decision_for_policy(
                            trigger,
                            ActionAttemptFailurePolicy::ReportPatternMismatchOnly,
                        )
                    {
                        push_action_failure_event(
                            gameplay_events,
                            action_failure_event_data(
                                player,
                                player,
                                SHOOTER_MELEE_ACTION_ID,
                                reason_code,
                            ),
                        );
                    }
                }
            }
            InputActionTrigger::Inactive
            | InputActionTrigger::Missing
            | InputActionTrigger::CoolingDown => {}
        }
    }

    fn try_queue_spawn_prefab_player(
        &mut self,
        world: &mut World,
        action_input: PlayerActionInput<'_>,
        player: Entity,
        tilemap: &Tilemap,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> bool {
        let Some(bindings) = world.action_bindings(player) else {
            return false;
        };
        let mut consumed_primary_fire = false;
        for binding in bindings.iter() {
            let ActionPattern::SpawnPrefab { .. } = binding.pattern else {
                continue;
            };
            let trigger = prepare_input_action_if_ready(
                world,
                action_input.registry,
                action_input.snapshot,
                player,
                binding.action_id,
                ActionPatternKind::SpawnPrefab,
            );
            let InputActionTrigger::Ready(prepared) = trigger else {
                debug_assert_eq!(
                    input_action_trigger_failure_decision_for_policy(
                        trigger,
                        ActionAttemptFailurePolicy::Silent,
                    ),
                    ActionAttemptFailureDecision::Noop
                );
                continue;
            };
            consumed_primary_fire |= prepared.action_id == SHOOTER_PRIMARY_FIRE_ACTION_ID;
            let ActionPattern::SpawnPrefab {
                prefab_id,
                projectile,
                anchor,
                phase,
                offset_x,
                offset_y,
            } = prepared.binding.pattern
            else {
                continue;
            };
            let command = match self.spawn_prefab_command(
                world,
                player,
                prepared.action_id,
                SpawnPrefabActionPayload {
                    prefab_id,
                    projectile,
                    anchor,
                    phase,
                    offset_x,
                    offset_y,
                },
            ) {
                Ok(command) => command,
                Err(reason_code) => {
                    push_action_failure_event(
                        gameplay_events.as_deref_mut(),
                        action_failure_event_data(player, player, prepared.action_id, reason_code),
                    );
                    continue;
                }
            };
            if let Err(reason_code) =
                self.commit_prefab_spawn_with_pre_commit_gate(tilemap, command, || {
                    commit_prepared_input_action(world, prepared)
                })
            {
                push_action_failure_event(
                    gameplay_events.as_deref_mut(),
                    action_failure_event_data(player, player, prepared.action_id, reason_code),
                );
                continue;
            }
        }
        consumed_primary_fire
    }

    fn try_queue_projectile_player(
        &mut self,
        world: &mut World,
        action_input: PlayerActionInput<'_>,
        camera: &Camera2D,
        player: Entity,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> bool {
        let Some(bindings) = world.action_bindings(player) else {
            return false;
        };
        for binding in bindings.iter() {
            let ActionPattern::Projectile {
                speed,
                damage,
                lifetime_seconds,
                aim,
                collision_target,
                tile_impact,
            } = binding.pattern
            else {
                continue;
            };
            match prepare_input_action_if_ready(
                world,
                action_input.registry,
                action_input.snapshot,
                player,
                binding.action_id,
                ActionPatternKind::Projectile,
            ) {
                InputActionTrigger::Ready(prepared) => {
                    let command = match self.projectile_spawn_command_toward_mouse(
                        world,
                        camera,
                        action_input.snapshot.current,
                        player,
                        ProjectileFireConfig {
                            speed,
                            damage,
                            lifetime_seconds,
                            aim,
                            collision_target,
                            tile_impact,
                        },
                    ) {
                        Ok(command) => command,
                        Err(reason_code) => {
                            push_action_failure_event(
                                gameplay_events,
                                action_failure_event_data(
                                    player,
                                    player,
                                    prepared.action_id,
                                    reason_code,
                                ),
                            );
                            return true;
                        }
                    };
                    if let Err(reason_code) = self
                        .commit_projectile_spawn_with_pre_commit_gate(command, || {
                            commit_prepared_input_action(world, prepared)
                        })
                    {
                        debug_assert_eq!(reason_code, GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL);
                        push_action_failure_event(
                            gameplay_events.as_deref_mut(),
                            action_failure_event_data(
                                player,
                                player,
                                binding.action_id,
                                reason_code,
                            ),
                        );
                    }
                    return true;
                }
                trigger @ InputActionTrigger::PatternMismatch => {
                    match input_action_trigger_failure_decision_for_policy(
                        trigger,
                        ActionAttemptFailurePolicy::PrimaryInputWithMissingFallback,
                    ) {
                        ActionAttemptFailureDecision::Fallback => {}
                        ActionAttemptFailureDecision::Noop => return true,
                        ActionAttemptFailureDecision::Failure(reason_code) => {
                            if should_report_fixed_action_pattern_mismatch(Some(
                                ActionPatternKind::from_pattern(binding.pattern),
                            )) {
                                push_action_failure_event(
                                    gameplay_events,
                                    action_failure_event_data(
                                        player,
                                        player,
                                        binding.action_id,
                                        reason_code,
                                    ),
                                );
                            }
                            return true;
                        }
                    }
                }
                InputActionTrigger::Inactive
                | InputActionTrigger::Missing
                | InputActionTrigger::CoolingDown => {}
            }
        }
        false
    }

    fn try_dash_player(
        &self,
        world: &mut World,
        camera: &Camera2D,
        action_input: PlayerActionInput<'_>,
        player: Entity,
        input_direction: Velocity,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) {
        match prepare_input_action_if_ready(
            world,
            action_input.registry,
            action_input.snapshot,
            player,
            SHOOTER_DASH_ACTION_ID,
            ActionPatternKind::Dash,
        ) {
            InputActionTrigger::Ready(prepared) => {
                let Some(player_t) = world.transform(player) else {
                    push_action_failure_event(
                        gameplay_events.as_deref_mut(),
                        action_failure_event_data(
                            player,
                            player,
                            SHOOTER_DASH_ACTION_ID,
                            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
                        ),
                    );
                    return;
                };
                let ActionPattern::Dash { distance, aim } = prepared.binding.pattern else {
                    return;
                };
                let aim_target = camera.screen_to_world(Transform2D {
                    x: action_input.snapshot.current.mouse_x,
                    y: action_input.snapshot.current.mouse_y,
                });
                let transform = match plan_input_dash_action_transform(
                    DashActionPayload { distance, aim },
                    player_t,
                    input_direction,
                    aim_target,
                ) {
                    Ok(transform) => transform,
                    Err(error) => {
                        push_action_failure_event(
                            gameplay_events,
                            action_failure_event_data(
                                player,
                                player,
                                SHOOTER_DASH_ACTION_ID,
                                dash_action_plan_failure_reason(error),
                            ),
                        );
                        return;
                    }
                };
                let dash_data = dash_action_core_data_from_plan(prepared.entity, transform);
                if commit_prepared_input_action(world, prepared) {
                    apply_dash_action_core_data(world, dash_data);
                }
            }
            trigger @ InputActionTrigger::PatternMismatch => {
                if should_report_fixed_action_pattern_mismatch(
                    world
                        .action_binding(player, SHOOTER_DASH_ACTION_ID)
                        .map(|binding| ActionPatternKind::from_pattern(binding.pattern)),
                ) {
                    if let ActionAttemptFailureDecision::Failure(reason_code) =
                        input_action_trigger_failure_decision_for_policy(
                            trigger,
                            ActionAttemptFailurePolicy::ReportPatternMismatchOnly,
                        )
                    {
                        push_action_failure_event(
                            gameplay_events,
                            action_failure_event_data(
                                player,
                                player,
                                SHOOTER_DASH_ACTION_ID,
                                reason_code,
                            ),
                        );
                    }
                }
            }
            InputActionTrigger::Inactive
            | InputActionTrigger::Missing
            | InputActionTrigger::CoolingDown => {}
        }
    }

    #[cfg(test)]
    pub(in crate::shooter_scene) fn fire_bullet_toward_mouse(
        &self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        player: Entity,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        if let Ok(command) = self.projectile_spawn_command_toward_mouse(
            world,
            camera,
            input,
            player,
            ProjectileFireConfig {
                speed: self.config.bullet_speed,
                damage: self.config.bullet_damage,
                lifetime_seconds: self.config.bullet_lifetime,
                aim: ActionAimSource::Input,
                collision_target: ProjectileCollisionTarget::Enemies,
                tile_impact: ProjectileTileImpact::Despawn,
            },
        ) {
            self.spawn_projectile_now(world, audio_events, command);
        }
    }

    fn queue_bullet_toward_mouse_with_projectile(
        &mut self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        player: Entity,
        projectile: ProjectileFireConfig,
    ) -> bool {
        if let Ok(command) =
            self.projectile_spawn_command_toward_mouse(world, camera, input, player, projectile)
        {
            return self.queue_projectile_spawn(command).is_ok();
        }
        false
    }

    fn projectile_spawn_command_toward_mouse(
        &self,
        world: &World,
        camera: &Camera2D,
        input: InputState,
        player: Entity,
        projectile: ProjectileFireConfig,
    ) -> Result<ProjectileSpawnCommand, u32> {
        let payload = ProjectileActionPayload {
            speed: projectile.speed,
            damage: projectile.damage,
            lifetime_seconds: projectile.lifetime_seconds,
            aim: projectile.aim,
            collision_target: projectile.collision_target,
            tile_impact: projectile.tile_impact,
        };
        validate_input_projectile_action_support(payload)
            .map_err(projectile_action_plan_failure_reason)?;
        let Some(player_t) = world.transform(player) else {
            return Err(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM);
        };
        let target = camera.screen_to_world(Transform2D {
            x: input.mouse_x,
            y: input.mouse_y,
        });
        let spawn_offset = self
            .config
            .player_template
            .sprite_width
            .max(self.config.player_template.sprite_height)
            * 0.5
            + self
                .config
                .bullet_template
                .sprite_width
                .max(self.config.bullet_template.sprite_height)
                * 0.5;
        let plan = plan_input_projectile_action(payload, player_t, target, spawn_offset)
            .map_err(projectile_action_plan_failure_reason)?;
        let command_data = projectile_spawn_core_data_from_plan(plan, payload);
        Ok(self.projectile_spawn_command_from_core_data(world, player, command_data))
    }

    pub(in crate::shooter_scene) fn clamp_player_to_world(&self, world: &mut World) {
        let Some(player) = world.primary_actor_entity() else {
            return;
        };
        PhysicsSystem::clamp_entity_to_bounds(
            world,
            player,
            PhysicsBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: self.config.world_width,
                max_y: self.config.world_height,
            },
        );
    }
}
