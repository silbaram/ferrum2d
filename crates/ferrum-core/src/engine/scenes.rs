use crate::breakout_scene::{breakout_brick_hit_particle_preset, BreakoutParticleBurstSink};
use crate::game_state::GameState;
use crate::input::InputState;
use crate::platformer_scene::{
    platformer_landing_dust_particle_preset, PlatformerParticleBurstSink,
};
use crate::shooter_scene::{ParticleBurstSink, TweenSink};

use super::Engine;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum ActiveScene {
    #[default]
    Shooter,
    Breakout,
    Platformer,
}

impl Engine {
    pub(super) fn active_scene_score(&self) -> u32 {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.score(),
            ActiveScene::Breakout => self.breakout_scene.score(),
            ActiveScene::Platformer => self.platformer_scene.score(),
        }
    }

    pub(super) fn active_scene_game_state(&self) -> GameState {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.game_state(),
            ActiveScene::Breakout => self.breakout_scene.game_state(),
            ActiveScene::Platformer => self.platformer_scene.game_state(),
        }
    }

    pub(super) fn active_scene_game_state_code(&self) -> u32 {
        match self.active_scene_game_state() {
            GameState::Title => 0,
            GameState::Playing => 1,
            GameState::GameOver => 2,
        }
    }

    pub(super) fn active_scene_action_trigger_attempts(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_action_trigger_attempts(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn reset_active_scene_action_trigger_frame_diagnostics(&mut self) {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.reset_action_trigger_frame_diagnostics(),
            ActiveScene::Breakout | ActiveScene::Platformer => {}
        }
    }

    pub(super) fn active_scene_action_trigger_failures(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_action_trigger_failures(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_action_trigger_failure_events_pushed(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_action_trigger_failure_events_pushed(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_action_trigger_commit_skips(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_action_trigger_commit_skips(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_last_prepared_action_trigger_failure_reason_code(&self) -> u32 {
        match self.active_scene {
            ActiveScene::Shooter => self
                .scene
                .last_prepared_action_trigger_failure_reason_code(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_action_trigger_failure_count_for_reason(
        &self,
        reason_code: u32,
    ) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self
                .scene
                .last_action_trigger_failure_count_for_reason(reason_code),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_commands_drained(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_spawn_flush_commands_drained(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_projectile_spawns(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_spawn_flush_projectile_spawns(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_projectile_arcs_applied(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_spawn_flush_projectile_arcs_applied(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_projectile_shoot_audio_events_pushed(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self
                .scene
                .last_spawn_flush_projectile_shoot_audio_events_pushed(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_prefab_spawns(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_spawn_flush_prefab_spawns(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_prefab_spawned_payloads(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_spawn_flush_prefab_spawned_payloads(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_spawn_flush_prefab_spawned_events_pushed(&self) -> usize {
        match self.active_scene {
            ActiveScene::Shooter => self.scene.last_spawn_flush_prefab_spawned_events_pushed(),
            ActiveScene::Breakout | ActiveScene::Platformer => 0,
        }
    }

    pub(super) fn active_scene_ticks_gameplay_timers(&self) -> bool {
        self.active_scene == ActiveScene::Shooter && self.scene.game_state() == GameState::Playing
    }

    pub(super) fn reset_active_scene_game(&mut self) {
        match self.active_scene {
            ActiveScene::Shooter => {
                self.scene
                    .reset_playing(&mut self.world, &mut self.camera, &mut self.audio_events);
            }
            ActiveScene::Breakout => self
                .breakout_scene
                .reset_playing(&mut self.world, &mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .reset_playing(&mut self.world, &mut self.camera),
        }
    }

    pub(super) fn reset_to_title(&mut self) {
        match self.active_scene {
            ActiveScene::Shooter => {
                self.scene.reset_to_title(
                    &mut self.world,
                    &mut self.camera,
                    &mut self.audio_events,
                );
            }
            ActiveScene::Breakout => self
                .breakout_scene
                .reset_to_title(&mut self.world, &mut self.camera),
            ActiveScene::Platformer => self
                .platformer_scene
                .reset_to_title(&mut self.world, &mut self.camera),
        }
        self.particles.clear();
        self.tweens.clear();
        self.clear_physics_history();
    }

    pub(super) fn update_scene(&mut self, delta: f32, input: InputState) {
        match self.active_scene {
            ActiveScene::Shooter => {
                let hit_particle_preset = self
                    .shooter_hit_particle_preset
                    .and_then(|preset_id| self.particle_presets.get(preset_id as usize))
                    .and_then(|preset| *preset);
                let hit_particles = (hit_particle_preset.is_some()
                    || !self.particle_presets.is_empty())
                .then(|| {
                    ParticleBurstSink::with_presets(
                        &mut self.particles,
                        hit_particle_preset,
                        &self.particle_presets,
                    )
                });
                let hit_tweens = Some(TweenSink::new(&mut self.tweens));
                self.scene.update_with_counters(
                    &mut self.world,
                    &mut self.camera,
                    input,
                    &self.input_actions,
                    &mut self.audio_events,
                    &self.tilemap,
                    delta,
                    &mut self.physics_counters,
                    &mut self.collision_events,
                    &mut self.collision_event_counts,
                    &mut self.gameplay_events,
                    hit_particles,
                    hit_tweens,
                );
            }
            ActiveScene::Breakout => {
                let mut hit_particles = BreakoutParticleBurstSink::new(
                    &mut self.particles,
                    breakout_brick_hit_particle_preset(),
                );
                self.breakout_scene.update(
                    &mut self.world,
                    &mut self.camera,
                    input,
                    delta,
                    &mut self.collision_events,
                    &mut self.collision_event_counts,
                    Some(&mut hit_particles),
                );
            }
            ActiveScene::Platformer => {
                let mut landing_particles = PlatformerParticleBurstSink::new(
                    &mut self.particles,
                    platformer_landing_dust_particle_preset(),
                );
                self.platformer_scene.update(
                    &mut self.world,
                    &mut self.camera,
                    input,
                    delta,
                    &mut self.physics_counters,
                    Some(&mut landing_particles),
                );
            }
        }
    }
}
