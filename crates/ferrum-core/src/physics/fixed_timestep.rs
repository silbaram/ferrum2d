const DEFAULT_FIXED_STEP_SECONDS: f32 = 1.0 / 60.0;
const DEFAULT_MAX_FRAME_SECONDS: f32 = 0.25;
const DEFAULT_MAX_FIXED_STEPS: u32 = 8;
const FIXED_TIMESTEP_EPSILON: f32 = 0.0001;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FixedTimestepConfig {
    pub step_seconds: f32,
    pub max_frame_seconds: f32,
    pub max_steps_per_update: u32,
}

impl Default for FixedTimestepConfig {
    fn default() -> Self {
        Self {
            step_seconds: DEFAULT_FIXED_STEP_SECONDS,
            max_frame_seconds: DEFAULT_MAX_FRAME_SECONDS,
            max_steps_per_update: DEFAULT_MAX_FIXED_STEPS,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FixedTimestepUpdate {
    pub steps: u32,
    pub alpha: f32,
    pub consumed_seconds: f32,
    pub dropped_seconds: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct FixedTimestep {
    config: FixedTimestepConfig,
    accumulated_seconds: f32,
    paused: bool,
}

impl Default for FixedTimestep {
    fn default() -> Self {
        Self::new(FixedTimestepConfig::default())
    }
}

impl FixedTimestep {
    pub fn new(config: FixedTimestepConfig) -> Self {
        Self {
            config: sanitize_fixed_timestep_config(config),
            accumulated_seconds: 0.0,
            paused: false,
        }
    }

    pub fn config(&self) -> FixedTimestepConfig {
        self.config
    }

    pub fn accumulated_seconds(&self) -> f32 {
        self.accumulated_seconds
    }

    pub fn is_paused(&self) -> bool {
        self.paused
    }

    pub fn pause(&mut self) {
        self.paused = true;
    }

    pub fn resume(&mut self) {
        self.paused = false;
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.paused = paused;
    }

    pub fn reset(&mut self) {
        self.accumulated_seconds = 0.0;
    }

    pub fn advance(&mut self, delta_seconds: f32) -> FixedTimestepUpdate {
        if self.paused {
            return FixedTimestepUpdate {
                steps: 0,
                alpha: (self.accumulated_seconds / self.config.step_seconds).clamp(0.0, 1.0),
                consumed_seconds: 0.0,
                dropped_seconds: 0.0,
            };
        }

        let clamped_delta = if delta_seconds.is_finite() && delta_seconds > 0.0 {
            delta_seconds.min(self.config.max_frame_seconds)
        } else {
            0.0
        };
        let dropped_seconds = if delta_seconds.is_finite() && delta_seconds > clamped_delta {
            delta_seconds - clamped_delta
        } else {
            0.0
        };

        self.accumulated_seconds += clamped_delta;
        let mut steps = 0;
        while self.accumulated_seconds + FIXED_TIMESTEP_EPSILON >= self.config.step_seconds
            && steps < self.config.max_steps_per_update
        {
            self.accumulated_seconds -= self.config.step_seconds;
            steps += 1;
        }

        let step_seconds = self.config.step_seconds;
        let mut accumulator_dropped = 0.0;
        if steps == self.config.max_steps_per_update
            && self.accumulated_seconds + FIXED_TIMESTEP_EPSILON >= step_seconds
        {
            let accumulated_before_drop = self.accumulated_seconds;
            let kept = accumulated_before_drop % step_seconds;
            self.accumulated_seconds = if kept <= FIXED_TIMESTEP_EPSILON
                || kept + FIXED_TIMESTEP_EPSILON >= step_seconds
            {
                0.0
            } else {
                kept
            };
            accumulator_dropped = accumulated_before_drop - self.accumulated_seconds;
        }

        FixedTimestepUpdate {
            steps,
            alpha: (self.accumulated_seconds / self.config.step_seconds).clamp(0.0, 1.0),
            consumed_seconds: steps as f32 * self.config.step_seconds,
            dropped_seconds: dropped_seconds + accumulator_dropped,
        }
    }
}

fn sanitize_fixed_timestep_config(config: FixedTimestepConfig) -> FixedTimestepConfig {
    let default = FixedTimestepConfig::default();
    FixedTimestepConfig {
        step_seconds: if config.step_seconds.is_finite() && config.step_seconds > 0.0 {
            config.step_seconds
        } else {
            default.step_seconds
        },
        max_frame_seconds: if config.max_frame_seconds.is_finite() && config.max_frame_seconds > 0.0
        {
            config.max_frame_seconds
        } else {
            default.max_frame_seconds
        },
        max_steps_per_update: config.max_steps_per_update.max(1),
    }
}
