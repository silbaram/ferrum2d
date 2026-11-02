//! Explicit Data Scene atlas playback. Configuration is cold; frame advancement allocates nothing.
use crate::components::Sprite;
use crate::entity::Entity;
use crate::gameplay_event::{
    GameplayEvent, GAMEPLAY_EVENT_SPRITE_ANIMATION_COMPLETED,
    GAMEPLAY_EVENT_SPRITE_ANIMATION_FRAME, GAMEPLAY_EVENT_SPRITE_ANIMATION_OVERFLOW,
};
use std::sync::Arc;

pub(crate) use super::sprite_clip::{SpriteClip, MAX_CLIP_FRAMES, MAX_CLIP_TOTAL_FRAMES};
pub(crate) const ANIMATION_EVENT_LIMIT: usize = 4096;

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SpritePlayback {
    pub clips: Arc<[SpriteClip]>,
    pub active: usize,
    pub elapsed: f64,
    pub paused: bool,
    pub flip_x: bool,
    pub flip_y: bool,
}

impl SpritePlayback {
    pub fn frame_index(&self) -> usize {
        let clip = &self.clips[self.active];
        clip.frame_index(self.elapsed)
    }

    pub fn finished(&self) -> bool {
        let clip = &self.clips[self.active];
        !clip.looping && self.elapsed >= clip.duration_seconds()
    }

    pub fn normalize_time(&mut self) {
        let clip = &self.clips[self.active];
        self.elapsed = clip.normalized_elapsed(self.elapsed);
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

    pub(crate) fn advance_with_events(
        &mut self,
        delta: f32,
        actor: Entity,
        events: &mut Vec<GameplayEvent>,
        overflow: &mut Option<usize>,
    ) {
        if self.paused || !delta.is_finite() || delta <= 0.0 {
            return;
        }
        let clip = &self.clips[self.active];
        let next = self.elapsed + f64::from(delta);
        if clip.emit_events {
            let start = clip.transition_count(self.elapsed);
            let end = clip.transition_count(next);
            let count = end.saturating_sub(start);
            let available = ANIMATION_EVENT_LIMIT.saturating_sub(events.len()) as u64;
            let emitted = count.min(available);
            for offset in 1..=emitted {
                let step = (start + offset) % clip.step_count() as u64;
                events.push(animation_event(
                    GAMEPLAY_EVENT_SPRITE_ANIMATION_FRAME,
                    actor,
                    clip.id,
                    clip.step_frame(step as usize) as u32,
                ));
            }
            record_overflow(events, overflow, count - emitted);
            if !clip.looping
                && self.elapsed < clip.duration_seconds()
                && next >= clip.duration_seconds()
            {
                if events.len() < ANIMATION_EVENT_LIMIT {
                    events.push(animation_event(
                        GAMEPLAY_EVENT_SPRITE_ANIMATION_COMPLETED,
                        actor,
                        clip.id,
                        clip.frame_index(clip.duration_seconds()) as u32,
                    ));
                } else {
                    record_overflow(events, overflow, 1);
                }
            }
        }
        self.elapsed = next;
        self.normalize_time();
    }
}

fn animation_event(kind: u32, actor: Entity, clip: u32, frame: u32) -> GameplayEvent {
    GameplayEvent {
        kind,
        actor_id: actor.id,
        actor_generation: actor.generation,
        source_id: actor.id,
        source_generation: actor.generation,
        token_id: clip,
        flags: 0,
        payload_bits: frame,
    }
}

fn record_overflow(events: &mut Vec<GameplayEvent>, overflow: &mut Option<usize>, count: u64) {
    if count == 0 {
        return;
    }
    let count = count.min(u64::from(u32::MAX)) as u32;
    if let Some(index) = *overflow {
        events[index].payload_bits = events[index].payload_bits.saturating_add(count);
    } else {
        *overflow = Some(events.len());
        events.push(animation_event(
            GAMEPLAY_EVENT_SPRITE_ANIMATION_OVERFLOW,
            Entity {
                id: u32::MAX,
                generation: 0,
            },
            0,
            count,
        ));
    }
}
