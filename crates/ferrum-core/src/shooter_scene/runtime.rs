use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::collision_event::{CollisionEvent, CollisionEventCounts};
use crate::components::{HeightSpan, Transform2D};
use crate::effect_event::EffectEvent;
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::gameplay::FrameInputSnapshot;
use crate::gameplay_event::GameplayEvent;
use crate::input::{InputActionRegistry, InputState};
use crate::physics::PhysicsCounters;
use crate::tilemap::Tilemap;
use crate::world::World;

use super::ShooterScene;

mod actions;
mod bullets;
mod combat;
mod despawn;
mod effects;
mod enemies;
mod interaction;
mod player;
mod spawn;
mod waves;

pub(crate) use crate::gameplay::ActionTriggerCommand;
pub(in crate::shooter_scene) use crate::gameplay::{
    dash_action_plan_failure_reason, melee_action_plan_failure_reason, ActionPatternKind,
};
pub(in crate::shooter_scene) use actions::{
    commit_prepared_input_action, ActionTriggerPhaseProcessResult,
};
use effects::ShooterRuntimeSinks;
pub(in crate::shooter_scene) use effects::{
    push_audio_event, push_game_over_audio_event, push_hit_audio_event, CollisionEventSink,
    GameplayEventSink,
};
pub(crate) use effects::{ParticleBurstSink, TweenSink};
pub(in crate::shooter_scene) use spawn::{ShooterSpawnCommand, SpawnFlushResult};
pub(in crate::shooter_scene) use waves::WaveActionTrigger;

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::shooter_scene) struct MeleeAttackCommand {
    pub(in crate::shooter_scene) attacker: Entity,
    pub(in crate::shooter_scene) center: Transform2D,
    pub(in crate::shooter_scene) range: f32,
    pub(in crate::shooter_scene) damage: f32,
    pub(in crate::shooter_scene) target: crate::components::gameplay::MeleeTarget,
    pub(in crate::shooter_scene) height_span: Option<HeightSpan>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(in crate::shooter_scene) struct MeleeAttackQueueResult {
    pub(in crate::shooter_scene) queued: MeleeAttackCommand,
}

impl ShooterScene {
    pub(in crate::shooter_scene) fn queue_melee_attack(
        &mut self,
        core_data: crate::gameplay::MeleeAttackCoreData,
    ) -> MeleeAttackQueueResult {
        let queued = MeleeAttackCommand {
            attacker: core_data.attacker,
            center: core_data.center,
            range: core_data.range,
            damage: core_data.damage,
            target: core_data.target,
            height_span: core_data.height_span,
        };
        self.pending_melee_attacks.push(queued);
        MeleeAttackQueueResult { queued }
    }

    pub(in crate::shooter_scene) fn enter_game_over(&mut self) -> bool {
        if self.game_state == GameState::GameOver {
            return false;
        }
        self.game_state = GameState::GameOver;
        true
    }

    pub(in crate::shooter_scene) fn commit_score_delta(&mut self, delta: u32) {
        crate::gameplay::commit_score_delta(&mut self.score, delta);
    }
}

impl ShooterScene {
    #[cfg(test)]
    pub fn update(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
    ) {
        let input_actions = InputActionRegistry::default();
        self.update_internal(
            world,
            camera,
            input,
            &input_actions,
            audio_events,
            tilemap,
            delta,
            ShooterRuntimeSinks::default(),
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update_with_counters(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        input_actions: &InputActionRegistry,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
        physics_counters: &mut PhysicsCounters,
        collision_events: &mut Vec<CollisionEvent>,
        collision_event_counts: &mut CollisionEventCounts,
        gameplay_events: &mut Vec<GameplayEvent>,
        effect_events: &mut Vec<EffectEvent>,
        hit_particles: Option<ParticleBurstSink<'_>>,
        hit_tweens: Option<TweenSink<'_>>,
    ) {
        self.update_internal(
            world,
            camera,
            input,
            input_actions,
            audio_events,
            tilemap,
            delta,
            ShooterRuntimeSinks::with_effects(
                physics_counters,
                collision_events,
                collision_event_counts,
                gameplay_events,
                effect_events,
                hit_particles,
                hit_tweens,
            ),
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn update_internal(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        input_actions: &InputActionRegistry,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
        mut sinks: ShooterRuntimeSinks<'_>,
    ) {
        let space_pressed = input.space == 1 && self.previous_space == 0;
        let enter_pressed = input.enter == 1 && self.previous_enter == 0;

        match self.game_state {
            GameState::Title => {
                if space_pressed || enter_pressed {
                    self.game_state = GameState::Playing;
                }
            }
            GameState::GameOver => {
                if space_pressed {
                    self.reset_playing(world, camera, audio_events);
                    self.game_state = GameState::Playing;
                }
            }
            GameState::Playing => {
                self.tick_playing_timers(delta);
                world.tick_action_cooldowns(delta);
                world.tick_collision_reaction_cooldowns(delta);
                self.tick_gameplay_timer_action_triggers(
                    world,
                    delta,
                    sinks.gameplay_events.as_mut(),
                );
                self.advance_wave_if_needed(world, sinks.gameplay_events.as_mut());
                self.camera_elapsed_seconds += delta.max(0.0);
                let input = FrameInputSnapshot::new(input, self.previous_input_state());
                self.apply_player_movement_input_snapshot(world, input);
                self.apply_player_actions_with_snapshot(
                    world,
                    camera,
                    input,
                    input_actions,
                    tilemap,
                    sinks.gameplay_events.as_mut(),
                );
                let action_trigger_phase_result =
                    self.process_action_triggers(world, tilemap, sinks.gameplay_events.as_mut());
                self.last_action_trigger_phase_result
                    .accumulate(action_trigger_phase_result);
                let spawn_flush_result = self.flush_pending_spawns_with_events(
                    world,
                    audio_events,
                    sinks.gameplay_events.as_mut(),
                );
                self.last_spawn_flush_result.accumulate(spawn_flush_result);
                self.apply_enemy_movement_phase(world, tilemap, delta);
                self.apply_projectile_movement_phase(world);
                world.update(delta);
                if let Some(counters) = sinks.physics_counters.as_deref_mut() {
                    tilemap.resolve_dynamic_collisions_with_counters(world, counters);
                } else {
                    tilemap.resolve_dynamic_collisions(world);
                }
                self.clamp_player_to_world(world);
                self.update_camera_follow(world, camera);
                self.update_bullets(world, delta);
                self.spawn_enemy_if_needed(world);
                self.handle_collisions(
                    world,
                    tilemap,
                    audio_events,
                    delta,
                    sinks.collision_events.as_mut(),
                    sinks.gameplay_events.as_mut(),
                    sinks.hit_particles.as_mut(),
                    sinks.hit_tweens.as_mut(),
                );
                self.emit_player_interactions(world, sinks.gameplay_events.as_mut());
            }
        }

        self.previous_space = input.space;
        self.previous_enter = input.enter;
        self.previous_mouse_left = input.mouse_left;
        self.previous_input = input;
    }

    fn previous_input_state(&self) -> InputState {
        self.previous_input
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::gameplay::MeleeTarget;
    use crate::components::PhysicsFloorId;
    use crate::gameplay::MeleeAttackCoreData;

    #[test]
    fn enter_game_over_reports_first_transition_only() {
        let mut scene = ShooterScene::new();
        scene.game_state = GameState::Playing;

        assert!(scene.enter_game_over());
        assert_eq!(scene.game_state, GameState::GameOver);
        assert!(!scene.enter_game_over());
        assert_eq!(scene.game_state, GameState::GameOver);
    }

    #[test]
    fn commit_score_delta_updates_scene_score_with_saturation() {
        let mut scene = ShooterScene::new();

        scene.commit_score_delta(3);
        assert_eq!(scene.score, 3);

        scene.commit_score_delta(0);
        assert_eq!(scene.score, 3);

        scene.score = u32::MAX - 1;
        scene.commit_score_delta(3);
        assert_eq!(scene.score, u32::MAX);
    }

    #[test]
    fn queue_melee_attack_returns_queued_command_and_preserves_fields() {
        let mut scene = ShooterScene::new();
        let height_span =
            HeightSpan::new(PhysicsFloorId(2), 4.0, 8.0).expect("test height span is valid");
        let core_data = MeleeAttackCoreData {
            attacker: Entity {
                id: 7,
                generation: 1,
            },
            center: Transform2D { x: 16.0, y: 24.0 },
            range: 32.0,
            damage: 2.5,
            target: MeleeTarget::Player,
            height_span: Some(height_span),
        };

        let result = scene.queue_melee_attack(core_data);

        let expected = MeleeAttackCommand {
            attacker: core_data.attacker,
            center: core_data.center,
            range: core_data.range,
            damage: core_data.damage,
            target: core_data.target,
            height_span: core_data.height_span,
        };
        assert_eq!(result, MeleeAttackQueueResult { queued: expected });
        assert_eq!(scene.pending_melee_attacks.as_slice(), &[expected]);

        let core_data = MeleeAttackCoreData {
            attacker: Entity {
                id: 8,
                generation: 3,
            },
            center: Transform2D { x: 32.0, y: 48.0 },
            range: 12.0,
            damage: 1.0,
            target: MeleeTarget::Enemies,
            height_span: None,
        };

        let result = scene.queue_melee_attack(core_data);

        let expected_without_height = MeleeAttackCommand {
            attacker: core_data.attacker,
            center: core_data.center,
            range: core_data.range,
            damage: core_data.damage,
            target: core_data.target,
            height_span: core_data.height_span,
        };
        assert_eq!(
            result,
            MeleeAttackQueueResult {
                queued: expected_without_height,
            }
        );
        assert_eq!(
            scene.pending_melee_attacks.as_slice(),
            &[expected, expected_without_height]
        );
    }
}
