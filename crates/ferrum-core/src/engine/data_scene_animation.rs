use wasm_bindgen::prelude::*;

use super::{Engine, SceneMode};
use crate::components::SpriteFrame;
use crate::world::sprite_playback::{SpriteClip, SpritePlayback};

const UPDATE_STRIDE: usize = 8;

#[wasm_bindgen]
impl Engine {
    /// Installs atlas clips once. Each descriptor is [id, frame_count, fps, looping].
    pub fn configure_data_scene_sprite_clips(
        &mut self,
        entity_id: u32,
        generation: u32,
        descriptors: &[f32],
        frames: &[f32],
        initial_clip: u32,
    ) -> bool {
        if self.scene_mode != SceneMode::Data
            || descriptors.is_empty()
            || !descriptors.len().is_multiple_of(4)
            || descriptors.len() > 64 * 4
        {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, generation) else {
            return false;
        };
        if self.world.sprites[entity.id as usize].is_none() {
            return false;
        }
        let mut clips: Vec<SpriteClip> = Vec::with_capacity(descriptors.len() / 4);
        let mut offset = 0;
        for descriptor in descriptors.chunks_exact(4) {
            let [id, count, fps, looping] =
                [descriptor[0], descriptor[1], descriptor[2], descriptor[3]];
            if !id.is_finite()
                || !(0.0..=65535.0).contains(&id)
                || id.fract() != 0.0
                || !count.is_finite()
                || !(1.0..=32.0).contains(&count)
                || count.fract() != 0.0
                || !fps.is_finite()
                || !(0.001..=1000.0).contains(&fps)
                || (looping != 0.0 && looping != 1.0)
                || clips.iter().any(|clip| clip.id == id as u32)
            {
                return false;
            }
            let end = offset + count as usize * 4;
            let Some(values) = frames.get(offset..end) else {
                return false;
            };
            let mut clip_frames = Vec::with_capacity(count as usize);
            for uv in values.chunks_exact(4) {
                let Some(frame) = SpriteFrame::from_values(uv[0], uv[1], uv[2], uv[3]) else {
                    return false;
                };
                clip_frames.push(frame);
            }
            offset = end;
            clips.push(SpriteClip {
                id: id as u32,
                frames: clip_frames,
                fps,
                looping: looping == 1.0,
            });
        }
        if offset != frames.len() {
            return false;
        }
        let Some(active) = clips.iter().position(|clip| clip.id == initial_clip) else {
            return false;
        };
        let playback = SpritePlayback {
            clips,
            active,
            elapsed: 0.0,
            paused: false,
            flip_x: false,
            flip_y: false,
        };
        let index = entity.id as usize;
        if let Some(sprite) = self.world.sprites[index].as_mut() {
            playback.write_sprite(sprite);
        }
        self.world.sprite_playbacks[index] = Some(playback);
        self.world.sprite_animations[index] = None;
        self.data_scene.movement_animation.detach(entity);
        true
    }

    /// Atomic batch: [id, generation, mask, clip, frame, flip_x, flip_y, paused].
    /// Bits 1/2/4/8/16 select fields; bit 32 restarts the selected clip.
    pub fn update_data_scene_sprite_animations(&mut self, updates: &[u32]) -> bool {
        if self.scene_mode != SceneMode::Data || !updates.len().is_multiple_of(UPDATE_STRIDE) {
            return false;
        }
        // A handle may appear once per batch, so all validation uses the current state.
        let mut seen = std::collections::HashSet::with_capacity(updates.len() / UPDATE_STRIDE);
        for update in updates.chunks_exact(UPDATE_STRIDE) {
            let Some(entity) = self.entity_from_handle(update[0], update[1]) else {
                return false;
            };
            let Some(playback) = self.world.sprite_playbacks[entity.id as usize].as_ref() else {
                return false;
            };
            let mask = update[2];
            if mask & !63 != 0
                || (mask & 32 != 0 && mask & 1 == 0)
                || (mask & 4 != 0 && update[5] > 1)
                || (mask & 8 != 0 && update[6] > 1)
                || (mask & 16 != 0 && update[7] > 1)
                || !seen.insert(update[0])
            {
                return false;
            }
            let clip = if mask & 1 != 0 {
                let Some(clip) = playback.clips.iter().find(|clip| clip.id == update[3]) else {
                    return false;
                };
                clip
            } else {
                &playback.clips[playback.active]
            };
            if mask & 2 != 0 && update[4] as usize >= clip.frames.len() {
                return false;
            }
        }
        for update in updates.chunks_exact(UPDATE_STRIDE) {
            let index = update[0] as usize;
            if update[2] != 0 {
                self.data_scene
                    .movement_animation
                    .detach(crate::entity::Entity {
                        id: update[0],
                        generation: update[1],
                    });
            }
            let Some(playback) = self.world.sprite_playbacks[index].as_mut() else {
                continue;
            };
            let mask = update[2];
            if mask & 1 != 0 {
                if let Some(active) = playback.clips.iter().position(|clip| clip.id == update[3]) {
                    playback.active = active;
                }
                if mask & 32 != 0 {
                    playback.elapsed = 0.0;
                }
                playback.normalize_time();
            }
            if mask & 2 != 0 {
                playback.elapsed =
                    f64::from(update[4]) / f64::from(playback.clips[playback.active].fps);
            }
            if mask & 4 != 0 {
                playback.flip_x = update[5] != 0;
            }
            if mask & 8 != 0 {
                playback.flip_y = update[6] != 0;
            }
            if mask & 16 != 0 {
                playback.paused = update[7] != 0;
            }
            if let Some(sprite) = self.world.sprites[index].as_mut() {
                playback.write_sprite(sprite);
            }
        }
        true
    }

    /// Diagnostic snapshot, not a per-entity frame-loop API.
    pub fn data_scene_sprite_animation_state(&self, entity_id: u32, generation: u32) -> Vec<f64> {
        if self.scene_mode != SceneMode::Data {
            return Vec::new();
        }
        let Some(entity) = self.entity_from_handle(entity_id, generation) else {
            return Vec::new();
        };
        let Some(state) = self.world.sprite_playbacks[entity.id as usize].as_ref() else {
            return Vec::new();
        };
        vec![
            f64::from(state.clips[state.active].id),
            state.frame_index() as f64,
            state.elapsed,
            u8::from(state.paused).into(),
            u8::from(state.finished()).into(),
            u8::from(state.flip_x).into(),
            u8::from(state.flip_y).into(),
        ]
    }
}
