//! Engine frame publication follows the actual native completion boundary.
use super::{tick_gameplay_timer_triggers, Engine, FixedTimestepUpdate, InputState};
use crate::engine::unified_physics::UnifiedPhysicsError;

impl Engine {
    pub(in crate::engine) fn reset_native_motion_attempt(&mut self) {
        if let Some(runtime) = &mut self.unified_physics {
            runtime.begin_actual_motion_attempt();
        }
    }

    pub(super) fn actual_native_motion_failure(&self) -> Option<UnifiedPhysicsError> {
        self.unified_physics
            .as_ref()?
            .actual_motion_result()
            .err()
            .map(Into::into)
    }

    pub(super) fn actual_native_committed_seconds(&self) -> f32 {
        self.unified_physics
            .as_ref()
            .map_or(0., |r| r.actual_motion_completed_seconds())
    }

    pub(super) fn checked_actual_native_motion(&self) -> Result<(), String> {
        if let Some(error) = self.actual_native_motion_failure() {
            Err(format!(
                "Ferrum2D actual native motion rejected after {} committed seconds: {}",
                self.actual_native_committed_seconds(),
                error
            ))
        } else {
            Ok(())
        }
    }

    /// The ordinary fixed path keeps its original wall-clock/accumulator
    /// contract. On a new actual-motion failure only the committed duration is
    /// reported as consumed; the rejected suffix is explicitly dropped and no
    /// post-physics gameplay, render interpolation or frame publication runs.
    pub(super) fn advance_fixed_native_simulation(
        &mut self,
        delta: f64,
    ) -> Result<f32, UnifiedPhysicsError> {
        let frame_elapsed = self.elapsed_seconds;
        self.elapsed_seconds += delta;
        self.begin_simulation_frame();
        if self.active_scene_game_state().freezes_simulation() {
            self.world.reset_render_interpolation();
            self.last_fixed_update = FixedTimestepUpdate::default();
            self.fixed_timestep_input_latch.clear();
            self.previous_input_sample = self.input;
            self.data_scene.gameplay.observe_input(self.input);
            return Ok(delta as f32);
        }
        self.spatial_scene.advance_light_selection(&self.world, 0.);
        self.data_scene.gameplay.combat.begin_frame();
        let update = self.fixed_timestep.advance(delta as f32);
        let seconds = self.fixed_timestep.config().step_seconds;
        for step_index in 0..update.steps {
            self.reset_native_motion_attempt();
            if self.render_interpolation_enabled {
                self.world.begin_render_interpolation_step();
            }
            let input = self.fixed_step_input(step_index == 0);
            let presses = if step_index == 0 {
                self.fixed_timestep_input_latch
                    .apply_to(InputState::default())
            } else {
                InputState::default()
            };
            self.tweens.update(&mut self.world, seconds);
            self.update_scene(seconds, input, presses);
            self.step_auto_rigid_bodies(seconds);
            if let Some(error) = self.actual_native_motion_failure() {
                let partial = self.actual_native_committed_seconds().clamp(0., seconds);
                if step_index == 0 && partial > 0. {
                    self.fixed_timestep_input_latch.clear();
                }
                // `steps` counts positive-duration native intervals here. An
                // incomplete interval is accompanied by Err and exact seconds,
                // never presented as a successfully completed nominal tick.
                let consumed = step_index as f32 * seconds + partial;
                self.last_fixed_update = FixedTimestepUpdate {
                    steps: step_index + u32::from(partial > 0.),
                    alpha: 0.,
                    consumed_seconds: consumed,
                    dropped_seconds: update.dropped_seconds
                        + (update.steps - step_index) as f32 * seconds
                        - partial,
                };
                self.physics_counters
                    .record_fixed_update(self.last_fixed_update);
                self.world.reset_render_interpolation();
                // Engine's frame clock advances only on a complete successful
                // frame. Native's separately reported physical prefix remains.
                self.elapsed_seconds = frame_elapsed;
                return Err(error);
            }
            if step_index == 0 {
                self.fixed_timestep_input_latch.clear();
            }
            self.record_collision_lifecycle_events();
            self.update_data_scene_gameplay(input, presses, seconds);
            self.spatial_scene
                .advance_light_selection(&self.world, seconds);
            if self.render_interpolation_enabled {
                self.world.end_render_interpolation_step();
            }
        }
        self.last_fixed_update = update;
        self.physics_counters.record_fixed_update(update);
        if self.render_interpolation_enabled {
            self.world
                .set_render_interpolation_alpha(Some(update.alpha));
        }
        if !self.active_scene_ticks_gameplay_timers() {
            tick_gameplay_timer_triggers(
                &mut self.world,
                update.consumed_seconds,
                &mut self.frame_buffers.gameplay_events,
            );
        }
        self.finish_simulation_frame(delta as f32);
        Ok(delta as f32)
    }
}
