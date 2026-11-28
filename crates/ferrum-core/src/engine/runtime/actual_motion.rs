//! Engine frame publication after checked native ticks.
use super::{tick_gameplay_timer_triggers, Engine, FixedTimestepUpdate, InputState};
use crate::engine::unified_physics::UnifiedPhysicsError;

impl Engine {
    pub(super) fn native_step_failure(&self) -> Option<UnifiedPhysicsError> {
        self.unified_physics.as_ref()?.frame_step_failure()
    }

    pub(super) fn begin_checked_native_frame(&mut self) {
        if let Some(runtime) = &mut self.unified_physics {
            runtime.begin_checked_frame();
        }
    }

    /// Checked entries report clock, preparation and commit failures.
    /// Raw `update_frame` keeps the retained diagnostic only.
    pub(super) fn checked_native_frame(&self) -> Result<(), String> {
        match self
            .unified_physics
            .as_ref()
            .and_then(|runtime| runtime.frame_step_failure())
        {
            Some(error) => Err(format!("Ferrum2D native physics step skipped: {error}")),
            None => Ok(()),
        }
    }

    /// Starts one Data-scene native tick. A tick suspended by a zero-progress
    /// rejection already ran its tweens and scene update, so the retry resumes
    /// at physics. Returns the resume state and the presses for this tick.
    pub(super) fn begin_native_gameplay_tick(
        &mut self,
        seconds: f32,
        step_index: u32,
        input: InputState,
    ) -> (Option<bool>, InputState) {
        let resumed = self
            .unified_physics
            .as_mut()
            .and_then(|runtime| runtime.take_suspended_tick());
        let presses = if step_index == 0 && resumed != Some(false) {
            self.fixed_timestep_input_latch
                .apply_to(InputState::default())
        } else {
            InputState::default()
        };
        if resumed.is_none() {
            self.tweens.update(&mut self.world, seconds);
            self.update_scene(seconds, input, presses);
        }
        (resumed, presses)
    }

    /// Records that a zero-progress rejection followed pre-physics gameplay.
    /// Built-in scenes step inside `update_scene`, so they always rerun it.
    pub(super) fn suspend_native_gameplay_tick(&mut self, resumed: Option<bool>, step_index: u32) {
        if self.has_native_built_in() {
            return;
        }
        if let Some(runtime) = &mut self.unified_physics {
            runtime.suspend_tick(resumed.unwrap_or(step_index == 0));
        }
    }

    /// Publish completed intervals; a rejected tick stops frame processing.
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
            if self.render_interpolation_enabled {
                self.world.begin_render_interpolation_step();
            }
            let input = self.fixed_step_input(step_index == 0);
            let (resumed, presses) = self.begin_native_gameplay_tick(seconds, step_index, input);
            self.step_auto_rigid_bodies(seconds);
            if let Some(error) = self.native_step_failure() {
                self.suspend_native_gameplay_tick(resumed, step_index);
                self.last_fixed_update = FixedTimestepUpdate {
                    steps: step_index,
                    alpha: 0.,
                    consumed_seconds: step_index as f32 * seconds,
                    dropped_seconds: update.dropped_seconds
                        + (update.steps - step_index) as f32 * seconds,
                };
                self.physics_counters
                    .record_fixed_update(self.last_fixed_update);
                self.world.reset_render_interpolation();
                self.elapsed_seconds = frame_elapsed;
                return Err(error);
            }
            if step_index == 0 && resumed != Some(false) {
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
