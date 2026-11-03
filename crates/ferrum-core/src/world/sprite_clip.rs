use crate::components::SpriteFrame;

pub(crate) const MAX_CLIP_FRAMES: usize = 256;
pub(crate) const MAX_CLIP_TOTAL_FRAMES: usize = 4096;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SpriteClip {
    pub id: u32,
    pub frames: Vec<SpriteFrame>,
    pub fps: f32,
    pub looping: bool,
    pub emit_events: bool,
    timeline: Option<ClipTimeline>,
}

#[derive(Clone, Debug, PartialEq)]
struct ClipTimeline {
    order: Vec<usize>,
    ends: Vec<f64>,
}

impl SpriteClip {
    pub(crate) fn uniform(id: u32, frames: Vec<SpriteFrame>, fps: f32, looping: bool) -> Self {
        Self {
            id,
            frames,
            fps,
            looping,
            emit_events: false,
            timeline: None,
        }
    }

    pub(crate) fn extended(
        mut self,
        direction: u32,
        durations_ms: Option<&[f32]>,
        emit_events: bool,
    ) -> Option<Self> {
        if direction > 2
            || durations_ms.is_some_and(|values| {
                values.len() != self.frames.len()
                    || values
                        .iter()
                        .any(|ms| !ms.is_finite() || !(1.0..=1_000_000.0).contains(ms))
            })
        {
            return None;
        }
        self.emit_events = emit_events;
        if direction == 0 && durations_ms.is_none() && !emit_events {
            return Some(self);
        }
        let count = self.frames.len();
        let mut order: Vec<usize> = if direction == 1 {
            (0..count).rev().collect()
        } else {
            (0..count).collect()
        };
        if direction == 2 && count > 1 {
            order.extend((1..count - 1).rev());
            if !self.looping {
                order.push(0);
            }
        }
        let mut ends = Vec::with_capacity(order.len());
        let mut elapsed = 0.0;
        for (step, frame) in order.iter().copied().enumerate() {
            elapsed = durations_ms.map_or_else(
                || (step + 1) as f64 / f64::from(self.fps),
                |ms| elapsed + f64::from(ms[frame]) / 1000.0,
            );
            ends.push(elapsed);
        }
        self.timeline = Some(ClipTimeline { order, ends });
        Some(self)
    }

    pub(crate) fn duration_seconds(&self) -> f64 {
        self.timeline.as_ref().map_or_else(
            || self.frames.len() as f64 / f64::from(self.fps),
            |timeline| timeline.ends[timeline.ends.len() - 1],
        )
    }

    pub(crate) fn frame_index(&self, elapsed: f64) -> usize {
        if let Some(timeline) = &self.timeline {
            return timeline.order[timeline
                .ends
                .partition_point(|end| *end <= elapsed)
                .min(timeline.order.len() - 1)];
        }
        ((elapsed * f64::from(self.fps) + 1e-9).floor() as usize).min(self.frames.len() - 1)
    }

    /// Seeking selects the first occurrence in playback order (outbound for pingpong).
    pub(crate) fn frame_start(&self, frame: usize) -> f64 {
        if let Some(timeline) = &self.timeline {
            let step = timeline
                .order
                .iter()
                .position(|index| *index == frame)
                .unwrap_or(0);
            return if step == 0 {
                0.0
            } else {
                timeline.ends[step - 1]
            };
        }
        frame as f64 / f64::from(self.fps)
    }

    pub(crate) fn step_count(&self) -> usize {
        self.timeline
            .as_ref()
            .map_or(self.frames.len(), |timeline| timeline.order.len())
    }
    pub(crate) fn step_frame(&self, step: usize) -> usize {
        self.timeline
            .as_ref()
            .map_or(step, |timeline| timeline.order[step])
    }

    pub(crate) fn transition_count(&self, time: f64) -> u64 {
        let duration = self.duration_seconds();
        let (cycles, phase) = if self.looping {
            let (cycles, phase) = cycle_phase(time, duration);
            (cycles as u64, phase)
        } else {
            (0, time.min(duration))
        };
        let step = self.timeline.as_ref().map_or_else(
            || (phase * f64::from(self.fps)).floor() as usize,
            |timeline| timeline.ends.partition_point(|end| *end <= phase),
        );
        cycles
            .saturating_mul(self.step_count() as u64)
            .saturating_add(step.min(self.step_count() - 1) as u64)
    }

    pub(crate) fn normalized_elapsed(&self, elapsed: f64) -> f64 {
        let duration = self.duration_seconds();
        if !self.looping {
            return elapsed.min(duration);
        }
        // Retain exact legacy modulo behavior for old fps-only clips. Extended
        // timelines use one quotient/remainder definition for events and phase.
        if self.timeline.is_none() {
            elapsed % duration
        } else {
            cycle_phase(elapsed, duration).1
        }
    }
}

fn cycle_phase(time: f64, duration: f64) -> (f64, f64) {
    // Every validated frame lasts at least 1 ms. Keep subtraction error below
    // one eighth of that minimum; at larger magnitudes even a seemingly valid
    // zero remainder can have lost the whole phase through cancellation.
    // Ordinary loop boundaries retain their conventional quotient behavior.
    if time * f64::EPSILON >= 0.001 / 8.0 {
        let phase = time % duration;
        return (((time - phase) / duration).round(), phase);
    }
    let mut cycles = (time / duration).floor();
    let mut phase = time - cycles * duration;
    if phase < 0.0 {
        cycles -= 1.0;
        phase += duration;
    }
    if phase >= duration {
        cycles += 1.0;
        phase -= duration;
    }
    if !(0.0..duration).contains(&phase) {
        // At magnitudes beyond the precision of whole cycle counts, retain a
        // finite bounded phase; emitted event counts saturate independently.
        phase = time % duration;
        cycles = ((time - phase) / duration).round();
    }
    (cycles, phase)
}
