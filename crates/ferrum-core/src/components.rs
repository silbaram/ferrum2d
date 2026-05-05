#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Transform2D {
    pub x: f32,
    pub y: f32,
}

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
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SpriteAnimation {
    pub columns: u32,
    pub rows: u32,
    pub idle: SpriteAnimationState,
    pub moving: SpriteAnimationState,
    pub current_state: SpriteAnimationKind,
    pub current_frame: u32,
    pub elapsed_seconds: f32,
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
}

impl SpriteAnimationState {
    pub fn is_valid(&self, columns: u32, rows: u32) -> bool {
        self.row < rows
            && self.frame_count > 0
            && self.frame_count <= columns
            && self.frames_per_second.is_finite()
            && self.frames_per_second > 0.0
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Velocity {
    pub vx: f32,
    pub vy: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CollisionLayer {
    Player,
    Enemy,
    Bullet,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AabbCollider {
    pub half_width: f32,
    pub half_height: f32,
    pub is_trigger: bool,
    pub layer: CollisionLayer,
}
