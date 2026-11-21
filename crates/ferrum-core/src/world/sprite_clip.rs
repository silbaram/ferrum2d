use crate::components::SpriteFrame;

pub(crate) const MAX_CLIP_FRAMES: usize = 256;
pub(crate) const MAX_CLIP_TOTAL_FRAMES: usize = 4096;

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct SpriteClip {
    pub id: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub frames: Vec<SpriteFrame>,
    pub fps: f32,
    pub looping: bool,
    pub emit_events: bool,
    timeline: Option<ClipTimeline>,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct ClipTimeline {
    #[serde(with = "crate::checkpoint_codec::vector")]
    order: Vec<usize>,
    #[serde(with = "crate::checkpoint_codec::vector")]
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SavedClipIssue {
    Header,
    Frame,
    Timeline,
}
impl SpriteClip {
    /// O(1) lengths, inspected before the caller precharges any variable walk.
    pub(crate) fn saved_payload_lengths(&self) -> [usize; 3] {
        [
            self.frames.len(),
            self.timeline.as_ref().map_or(0, |t| t.order.len()),
            self.timeline.as_ref().map_or(0, |t| t.ends.len()),
        ]
    }
    pub(crate) fn admit_saved_payload(&self) -> Result<(), SavedClipIssue> {
        if self.id > 65535
            || self.frames.is_empty()
            || self.frames.len() > MAX_CLIP_FRAMES
            || !self.fps.is_finite()
            || (self.fps != 0.0 && !(0.001..=1000.).contains(&self.fps))
            || (self.fps == 0.0 && self.timeline.is_none())
        {
            return Err(SavedClipIssue::Header);
        }
        if self.frames.iter().any(|f| {
            [f.u0, f.v0, f.u1, f.v1]
                .iter()
                .any(|v| !v.is_finite() || !(0.0..=1.0).contains(v))
                || f.u0 == f.u1
                || f.v0 == f.v1
        }) {
            return Err(SavedClipIssue::Frame);
        }
        if let Some(t) = &self.timeline {
            let n = self.frames.len();
            if t.order.is_empty()
                || t.order.len() != t.ends.len()
                || t.order.len() > 2 * n
                || t.order.iter().any(|&i| i >= n)
            {
                return Err(SavedClipIssue::Timeline);
            }
            // The producer emits forward, reverse, or ping-pong. Check the full
            // order without allocating/rebuilding it, including repeated end0.
            let forward = t.order.len() == n && t.order.iter().copied().eq(0..n);
            let reverse = t.order.len() == n && t.order.iter().copied().eq((0..n).rev());
            let ping_len = if n == 1 {
                1
            } else {
                2 * n - 2 + usize::from(!self.looping)
            };
            let ping = t.order.len() == ping_len
                && t.order
                    .iter()
                    .enumerate()
                    .all(|(step, &i)| i == if step < n { step } else { 2 * n - 2 - step });
            if !forward && !reverse && !ping {
                return Err(SavedClipIssue::Timeline);
            }
            let mut previous: f64 = 0.;
            for &end in &t.ends {
                // Construction rounds each cumulative f64 end. Bound subtraction
                // by two endpoint ulps rather than a fixture-specific epsilon.
                let roundoff = 2.0 * f64::EPSILON * (end.abs() + previous.abs());
                let duration = end - previous;
                if !end.is_finite()
                    || end <= previous
                    || duration + roundoff < 0.001
                    || duration - roundoff > 1000.0
                {
                    return Err(SavedClipIssue::Timeline);
                }
                previous = end;
            }
        }
        Ok(())
    }
}

impl SpriteClip {
    /// Logical field bytes/visits for exact same-value file alias comparison.
    /// Vec capacities are wire fields in the private memory codec. No allocation
    /// or timeline reconstruction occurs here; the caller precharges this cost.
    pub(crate) fn file_alias_compare_cost(&self) -> Option<(u64, usize)> {
        let mut work = 16u64.checked_add((self.frames.len() as u64).checked_mul(4)?)?;
        let mut bytes = 27usize.checked_add(self.frames.len().checked_mul(16)?)?;
        if let Some(t) = &self.timeline {
            let count = t.order.len().checked_add(t.ends.len())?;
            work = work.checked_add(count as u64)?;
            bytes = bytes.checked_add(32)?.checked_add(count.checked_mul(8)?)?;
        }
        Some((work, bytes))
    }
    pub(crate) fn file_alias_value_eq(&self, other: &Self) -> bool {
        if self.id != other.id
            || self.fps.to_bits() != other.fps.to_bits()
            || self.looping != other.looping
            || self.emit_events != other.emit_events
            || self.frames.len() != other.frames.len()
            || self.frames.capacity() != other.frames.capacity()
        {
            return false;
        }
        if !self.frames.iter().zip(&other.frames).all(|(a, b)| {
            [
                a.u0.to_bits(),
                a.v0.to_bits(),
                a.u1.to_bits(),
                a.v1.to_bits(),
            ] == [
                b.u0.to_bits(),
                b.v0.to_bits(),
                b.u1.to_bits(),
                b.v1.to_bits(),
            ]
        }) {
            return false;
        }
        match (&self.timeline, &other.timeline) {
            (None, None) => true,
            (Some(a), Some(b)) => {
                a.order.len() == b.order.len()
                    && a.order.capacity() == b.order.capacity()
                    && a.ends.len() == b.ends.len()
                    && a.ends.capacity() == b.ends.capacity()
                    && a.order == b.order
                    && a.ends
                        .iter()
                        .zip(&b.ends)
                        .all(|(a, b)| a.to_bits() == b.to_bits())
            }
            _ => false,
        }
    }
}
