//! Explicit Data Scene atlas playback. Configuration is cold; frame advancement allocates nothing.
use crate::components::{Sprite, SpriteFrame};

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SpriteClip {
    pub id: u32,
    pub frames: Vec<SpriteFrame>,
    pub fps: f32,
    pub looping: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SpritePlayback {
    pub clips: Vec<SpriteClip>,
    pub active: usize,
    pub elapsed: f64,
    pub paused: bool,
    pub flip_x: bool,
    pub flip_y: bool,
}

impl SpritePlayback {
    pub fn frame_index(&self) -> usize {
        let clip = &self.clips[self.active];
        ((self.elapsed * f64::from(clip.fps) + 1e-9).floor() as usize).min(clip.frames.len() - 1)
    }

    pub fn finished(&self) -> bool {
        let clip = &self.clips[self.active];
        !clip.looping && self.elapsed >= clip.frames.len() as f64 / f64::from(clip.fps)
    }

    pub fn normalize_time(&mut self) {
        let clip = &self.clips[self.active];
        let duration = clip.frames.len() as f64 / f64::from(clip.fps);
        self.elapsed = if clip.looping {
            self.elapsed % duration
        } else {
            self.elapsed.min(duration)
        };
    }

    pub fn advance(&mut self, delta: f32) {
        if !self.paused && delta.is_finite() && delta > 0.0 {
            self.elapsed += f64::from(delta);
            self.normalize_time();
        }
    }

    pub fn write_sprite(&self, sprite: &mut Sprite) {
        let frame = self.clips[self.active].frames[self.frame_index()];
        (sprite.u0, sprite.u1) = if self.flip_x {
            (frame.u1, frame.u0)
        } else {
            (frame.u0, frame.u1)
        };
        (sprite.v0, sprite.v1) = if self.flip_y {
            (frame.v1, frame.v0)
        } else {
            (frame.v0, frame.v1)
        };
    }
}
