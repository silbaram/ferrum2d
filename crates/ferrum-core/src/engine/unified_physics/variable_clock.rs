//! A native world has one nominal clock and an actual duration scoped to each
//! accepted simulation interval. Variable frames never select a second solver.
use super::{Engine, UnifiedPhysicsError};
use crate::physics::{FixedTimestep, FixedTimestepConfig, FixedTimestepUpdate};
use wasm_bindgen::prelude::*;

const MIN_INTERVAL: f32 = 0.0001;
const MAX_INTERVAL: f32 = 0.1;
const MAX_VARIABLE_INTERVALS: u32 = 1024;
const MAX_FRAME_SECONDS: f32 = MAX_INTERVAL * MAX_VARIABLE_INTERVALS as f32;

#[derive(Clone, Copy, Debug)]
pub(in crate::engine) struct VariableFramePlan {
    pub steps: u32,
    pub interval: f32,
    pub update: FixedTimestepUpdate,
}

impl Engine {
    pub(in crate::engine) fn apply_fixed_timestep_config(
        &mut self,
        enabled: bool,
        step_seconds: f32,
        max_frame_seconds: f32,
        max_steps_per_update: u32,
    ) {
        let was_enabled = self.fixed_timestep_enabled;
        self.fixed_timestep_enabled = enabled;
        self.world.reset_render_interpolation();
        self.fixed_timestep = FixedTimestep::new(FixedTimestepConfig {
            step_seconds,
            max_frame_seconds,
            max_steps_per_update,
        });
        self.last_fixed_update = FixedTimestepUpdate::default();
        if !enabled || !was_enabled {
            self.fixed_timestep_input_latch.clear();
            self.previous_input_sample = self.input;
            self.data_scene.gameplay.observe_input(self.input);
        }
    }

    fn reject_unified_clock(&mut self) -> UnifiedPhysicsError {
        let error = UnifiedPhysicsError::ClockMismatch;
        if let Some(runtime) = &mut self.unified_physics {
            runtime.last_error.record(error);
        }
        error
    }

    pub(in crate::engine) fn variable_native_frame_plan(
        &mut self,
        seconds: f64,
    ) -> Result<Option<VariableFramePlan>, UnifiedPhysicsError> {
        if self.unified_physics.is_none() {
            return Ok(None);
        }
        let requested = seconds as f32;
        if !seconds.is_finite() || !requested.is_finite() || seconds < 0.0 {
            return Err(self.reject_unified_clock());
        }
        if self.fixed_timestep_enabled {
            // Sub-quantum positive fixed input remains a valid accumulator input.
            return Ok(None);
        }
        if seconds > 0.0 && requested < MIN_INTERVAL {
            return Err(self.reject_unified_clock());
        }
        if requested == 0.0 {
            return Ok(Some(VariableFramePlan {
                steps: 0,
                interval: 0.0,
                update: FixedTimestepUpdate::default(),
            }));
        }
        let clock = self.fixed_timestep.config();
        let accepted = requested
            .min(clock.max_frame_seconds)
            .min(clock.max_steps_per_update as f32 * MAX_INTERVAL);
        let steps = (accepted / MAX_INTERVAL).ceil() as u32;
        let interval = accepted / steps as f32;
        if steps == 0
            || steps > MAX_VARIABLE_INTERVALS
            || !interval.is_finite()
            || !(MIN_INTERVAL..=MAX_INTERVAL).contains(&interval)
        {
            return Err(self.reject_unified_clock());
        }
        let consumed_seconds = interval * steps as f32;
        if self.auto_rigid_body_step_enabled && !self.active_scene_game_state().freezes_simulation()
        {
            if let Some(runtime) = &mut self.unified_physics {
                // The one-shot impulse is applied in the first interval. With
                // opposing force signs its first peak can exceed the final one.
                for seconds in [interval, consumed_seconds] {
                    if let Err(error) = runtime.physics.validate_character_force_duration(seconds) {
                        let error = UnifiedPhysicsError::from(error);
                        runtime.last_error.record(error);
                        return Err(error);
                    }
                }
            }
        }
        Ok(Some(VariableFramePlan {
            steps,
            interval,
            update: FixedTimestepUpdate {
                steps,
                alpha: 0.0,
                consumed_seconds,
                dropped_seconds: (requested - consumed_seconds).max(0.0),
            },
        }))
    }

    /// The closure contains the entire Engine interval, including movement and
    /// gameplay preparation that reads WorldConfig::step_seconds. Every normal
    /// return, including a rejected inner operation, restores the nominal clock.
    pub(in crate::engine) fn with_unified_interval<T>(
        &mut self,
        seconds: f32,
        operation: impl FnOnce(&mut Self) -> T,
    ) -> Result<T, UnifiedPhysicsError> {
        self.with_unified_duration(seconds, true, operation)
    }

    pub(in crate::engine) fn with_unified_frame_interval<T>(
        &mut self,
        seconds: f32,
        operation: impl FnOnce(&mut Self) -> T,
    ) -> Result<T, UnifiedPhysicsError> {
        self.with_unified_duration(seconds, self.auto_rigid_body_step_enabled, operation)
    }

    fn with_unified_duration<T>(
        &mut self,
        seconds: f32,
        validate_forces: bool,
        operation: impl FnOnce(&mut Self) -> T,
    ) -> Result<T, UnifiedPhysicsError> {
        let Some(runtime) = &mut self.unified_physics else {
            return Err(UnifiedPhysicsError::NotConfigured);
        };
        if !seconds.is_finite()
            || !(MIN_INTERVAL..=MAX_INTERVAL).contains(&seconds)
            || (self.fixed_timestep_enabled
                && (seconds - runtime.physics.config().step_seconds).abs() > 1.0e-7)
        {
            return Err(self.reject_unified_clock());
        }
        let owns_interval = if self.fixed_timestep_enabled {
            false
        } else {
            match runtime.physics.begin_interval(seconds, validate_forces) {
                Ok(owns) => owns,
                Err(error) => {
                    let error = UnifiedPhysicsError::from(error);
                    runtime.last_error.record(error);
                    return Err(error);
                }
            }
        };
        let result = operation(self);
        if owns_interval {
            // A scene transition can install a new runtime; its own nominal
            // settings must never be overwritten with the departed world's.
            if let Some(runtime) = &mut self.unified_physics {
                runtime.physics.end_interval();
            }
        }
        Ok(result)
    }
}

#[wasm_bindgen]
impl Engine {
    /// Version 1: checked native fixed/variable clock and nominal-step query.
    pub fn unified_physics_clock_version(&self) -> u32 {
        1
    }

    /// Nominal world duration; an active variable interval is never exposed.
    /// Returns zero when no native physics world is selected.
    pub fn unified_physics_clock_step_seconds(&self) -> f32 {
        self.unified_physics
            .as_ref()
            .map_or(0.0, |runtime| runtime.physics.nominal_step_seconds())
    }

    /// Current native frame-time budget; zero when no native world is selected.
    pub fn unified_physics_clock_max_frame_seconds(&self) -> f32 {
        if self.unified_physics.is_some() {
            self.fixed_timestep.config().max_frame_seconds
        } else {
            0.0
        }
    }

    /// Current native interval-count budget; zero when no native world is selected.
    pub fn unified_physics_clock_max_steps_per_update(&self) -> u32 {
        if self.unified_physics.is_some() {
            self.fixed_timestep.config().max_steps_per_update
        } else {
            0
        }
    }

    /// Clock mode installed by the saved native policy on the next scene change.
    /// Returns false when no native default policy is selected.
    pub fn default_physics_policy_fixed_timestep(&self) -> bool {
        self.default_unified_physics.is_some() && self.default_unified_physics_fixed
    }

    /// Changes clock ownership after complete validation. Variable frames use
    /// their actual bounded duration; manual steps accept one 0.0001..=0.1s
    /// interval. Explicit nominal-step changes require a new world.
    /// A failed call preserves clock, render history and queued input/forces.
    pub fn configure_unified_physics_clock(
        &mut self,
        enabled: bool,
        step_seconds: f32,
        max_frame_seconds: f32,
        max_steps_per_update: u32,
    ) -> bool {
        let admitted = self.unified_physics.as_ref().is_some_and(|runtime| {
            !runtime.physics.has_active_interval()
                && step_seconds.is_finite()
                && (MIN_INTERVAL..=MAX_INTERVAL).contains(&step_seconds)
                && step_seconds == runtime.physics.nominal_step_seconds()
                && max_frame_seconds.is_finite()
                && (MIN_INTERVAL..=MAX_FRAME_SECONDS).contains(&max_frame_seconds)
                && (1..=MAX_VARIABLE_INTERVALS).contains(&max_steps_per_update)
        });
        if !admitted {
            self.reject_unified_clock();
            return false;
        }
        self.apply_fixed_timestep_config(
            enabled,
            step_seconds,
            max_frame_seconds,
            max_steps_per_update,
        );
        if self.default_unified_physics.is_some() {
            self.default_unified_physics_fixed = enabled;
        }
        true
    }
}
