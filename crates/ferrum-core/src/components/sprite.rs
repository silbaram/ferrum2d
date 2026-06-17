pub const DEFAULT_SPRITE_RENDER_LAYER: i32 = 1_000;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sprite {
    pub texture_id: u32,
    pub width: f32,
    pub height: f32,
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
    pub rotation_radians: f32,
    pub render_layer: i32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteFrame {
    pub u0: f32,
    pub v0: f32,
    pub u1: f32,
    pub v1: f32,
}

impl SpriteFrame {
    pub const FULL: Self = Self {
        u0: 0.0,
        v0: 0.0,
        u1: 1.0,
        v1: 1.0,
    };

    pub fn from_values(u0: f32, v0: f32, u1: f32, v1: f32) -> Option<Self> {
        if u0.is_finite()
            && v0.is_finite()
            && u1.is_finite()
            && v1.is_finite()
            && (0.0..=1.0).contains(&u0)
            && (0.0..=1.0).contains(&v0)
            && (0.0..=1.0).contains(&u1)
            && (0.0..=1.0).contains(&v1)
            && u1 > u0
            && v1 > v0
        {
            Some(Self { u0, v0, u1, v1 })
        } else {
            None
        }
    }

    pub fn uv(self) -> (f32, f32, f32, f32) {
        (self.u0, self.v0, self.u1, self.v1)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimation {
    pub columns: u32,
    pub rows: u32,
    pub idle: SpriteAnimationState,
    pub moving: SpriteAnimationState,
    pub idle_frames: Option<SpriteAnimationFrameSequence>,
    pub moving_frames: Option<SpriteAnimationFrameSequence>,
    pub current_state: SpriteAnimationKind,
    pub current_frame: u32,
    pub elapsed_seconds: f32,
}

pub const MAX_SPRITE_ANIMATION_FRAMES: usize = 32;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimationFrameSequence {
    frames: [SpriteFrame; MAX_SPRITE_ANIMATION_FRAMES],
    frame_count: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimationState {
    pub row: u32,
    pub frame_count: u32,
    pub frames_per_second: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpriteAnimationKind {
    Idle,
    Moving,
}

impl SpriteAnimation {
    pub fn new(
        columns: u32,
        rows: u32,
        idle: SpriteAnimationState,
        moving: SpriteAnimationState,
    ) -> Option<Self> {
        if columns <= 1 || rows == 0 || !idle.is_valid(columns, rows) {
            return None;
        }

        Some(Self {
            columns,
            rows,
            idle,
            moving: if moving.is_valid(columns, rows) {
                moving
            } else {
                idle
            },
            idle_frames: None,
            moving_frames: None,
            current_state: SpriteAnimationKind::Idle,
            current_frame: 0,
            elapsed_seconds: 0.0,
        })
    }

    pub fn horizontal(frame_count: u32, frames_per_second: f32) -> Option<Self> {
        let state = SpriteAnimationState {
            row: 0,
            frame_count,
            frames_per_second,
        };
        Self::new(frame_count, 1, state, state)
    }

    pub fn atlas(
        idle_frames: &[SpriteFrame],
        idle_frames_per_second: f32,
        moving_frames: &[SpriteFrame],
        moving_frames_per_second: f32,
    ) -> Option<Self> {
        let idle_sequence = SpriteAnimationFrameSequence::from_frames(idle_frames)?;
        let moving_sequence =
            SpriteAnimationFrameSequence::from_frames(moving_frames).unwrap_or(idle_sequence);
        let idle = SpriteAnimationState {
            row: 0,
            frame_count: idle_sequence.frame_count,
            frames_per_second: idle_frames_per_second,
        };
        let moving = SpriteAnimationState {
            row: 0,
            frame_count: moving_sequence.frame_count,
            frames_per_second: moving_frames_per_second,
        };
        if !idle.is_timed() {
            return None;
        }

        Some(Self {
            columns: idle_sequence.frame_count.max(moving_sequence.frame_count),
            rows: 1,
            idle,
            moving: if moving.is_timed() { moving } else { idle },
            idle_frames: Some(idle_sequence),
            moving_frames: Some(if moving.is_timed() {
                moving_sequence
            } else {
                idle_sequence
            }),
            current_state: SpriteAnimationKind::Idle,
            current_frame: 0,
            elapsed_seconds: 0.0,
        })
    }

    pub fn advance(&mut self, delta: f32, is_moving: bool) {
        let next_state = if is_moving {
            SpriteAnimationKind::Moving
        } else {
            SpriteAnimationKind::Idle
        };
        if self.current_state != next_state {
            self.current_state = next_state;
            self.current_frame = 0;
            self.elapsed_seconds = 0.0;
        }

        if delta <= 0.0 || !delta.is_finite() {
            return;
        }

        let state = self.active_state();
        self.elapsed_seconds += delta;
        let frame_duration = 1.0 / state.frames_per_second;
        while self.elapsed_seconds >= frame_duration {
            self.elapsed_seconds -= frame_duration;
            self.current_frame = (self.current_frame + 1) % state.frame_count;
        }
    }

    pub fn uv(&self) -> (f32, f32, f32, f32) {
        let state = self.active_state();
        if let Some(sequence) = self.active_frame_sequence() {
            return sequence.frame(self.current_frame).uv();
        }

        let frame_width = 1.0 / self.columns as f32;
        let frame_height = 1.0 / self.rows as f32;
        let u0 = self.current_frame as f32 * frame_width;
        let v0 = state.row as f32 * frame_height;
        (u0, v0, u0 + frame_width, v0 + frame_height)
    }

    fn active_state(&self) -> SpriteAnimationState {
        match self.current_state {
            SpriteAnimationKind::Idle => self.idle,
            SpriteAnimationKind::Moving => self.moving,
        }
    }

    fn active_frame_sequence(&self) -> Option<&SpriteAnimationFrameSequence> {
        match self.current_state {
            SpriteAnimationKind::Idle => self.idle_frames.as_ref(),
            SpriteAnimationKind::Moving => self.moving_frames.as_ref(),
        }
    }
}

impl SpriteAnimationFrameSequence {
    pub fn from_frames(frames: &[SpriteFrame]) -> Option<Self> {
        if frames.is_empty() || frames.len() > MAX_SPRITE_ANIMATION_FRAMES {
            return None;
        }

        let mut sequence = Self {
            frames: [SpriteFrame::FULL; MAX_SPRITE_ANIMATION_FRAMES],
            frame_count: frames.len() as u32,
        };
        for (index, frame) in frames.iter().copied().enumerate() {
            sequence.frames[index] = frame;
        }
        Some(sequence)
    }

    pub fn frame_count(&self) -> u32 {
        self.frame_count
    }

    pub fn first_frame(&self) -> SpriteFrame {
        self.frames[0]
    }

    fn frame(&self, index: u32) -> SpriteFrame {
        let resolved = (index % self.frame_count) as usize;
        self.frames[resolved]
    }
}

impl SpriteAnimationState {
    pub fn is_valid(&self, columns: u32, rows: u32) -> bool {
        self.row < rows && self.frame_count > 0 && self.frame_count <= columns && self.is_timed()
    }

    pub fn is_timed(&self) -> bool {
        self.frames_per_second.is_finite() && self.frames_per_second > 0.0
    }
}
