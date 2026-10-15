use super::scenes::SceneMode;
use super::Engine;
use crate::entity::Entity;
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

const ANIMATION_PROGRESS_STRIDE: usize = 32;

// Cold-path bulk protocol. Handles are pairs (id, generation); states are
// 0 = removed; bits 0/1 = alive/consumed, 2/3 = body present/enabled,
// 4/5 = single collider present/enabled. Legacy states 1/3 preserve authored physics.
#[wasm_bindgen]
impl Engine {
    pub fn data_scene_epoch(&self) -> u32 {
        if self.scene_mode == SceneMode::Data {
            self.data_scene.epoch
        } else {
            0
        }
    }

    pub fn capture_data_scene_progress(&self, epoch: u32, handles: &[u32]) -> Vec<u32> {
        if epoch == 0 || self.data_scene_epoch() != epoch || !handles.len().is_multiple_of(2) {
            return Vec::new();
        }
        handles
            .chunks_exact(2)
            .map(|handle| {
                let entity = Entity {
                    id: handle[0],
                    generation: handle[1],
                };
                if !self.world.is_current_entity(entity) {
                    return 0;
                }
                let consumed = self
                    .world
                    .interaction_at_index(entity.id as usize)
                    .is_some_and(|interaction| interaction.once && interaction.consumed);
                let body = self.world.rigid_body(entity);
                let collider = (self.world.compound_collider_count(entity) == 1)
                    .then(|| self.world.compound_collider_ref_at(entity.id as usize, 0))
                    .flatten();
                1 | (u32::from(consumed) << 1)
                    | (u32::from(body.is_some()) << 2)
                    | (u32::from(body.is_some_and(|body| body.enabled)) << 3)
                    | (u32::from(collider.is_some()) << 4)
                    | (u32::from(collider.is_some_and(|collider| collider.enabled())) << 5)
            })
            .collect()
    }

    pub fn capture_data_scene_navigation(&self) -> Vec<f64> {
        if self.scene_mode != SceneMode::Data {
            return Vec::new();
        }
        let mut snapshot = self.data_scene.navigation.data_scene_navigation_snapshot();
        self.data_scene
            .navigation_obstacles
            .snapshot_costs(&mut snapshot);
        snapshot
    }

    pub fn restore_data_scene_progress(
        &mut self,
        epoch: u32,
        handles: &[u32],
        states: &[u32],
    ) -> bool {
        if epoch == 0 || self.data_scene_epoch() != epoch || handles.len() != states.len() * 2 {
            return false;
        }
        if !self.validate_data_scene_progress(handles, states) {
            return false;
        }
        for (handle, state) in handles.chunks_exact(2).zip(states) {
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            if *state == 0 {
                self.world.despawn(entity);
            } else {
                if *state & 4 != 0 {
                    self.set_physics_body_enabled(entity.id, entity.generation, *state & 8 != 0);
                }
                if *state & 16 != 0 {
                    self.set_physics_collider_enabled_for_entity(entity, *state & 32 != 0);
                }
                if let Some(interaction) = self.world.interaction_mut_at_index(entity.id as usize) {
                    interaction.consumed = *state & 2 != 0;
                }
            }
        }
        self.synchronize_data_scene_navigation();
        true
    }

    /// 32 f64 values per authored handle: present, clip, seconds, paused, flipX,
    /// flipY, native movement binding present, facing (up/down/left/right = 0..3), then eight clip/flipX/flipY poses.
    pub fn capture_data_scene_animation_progress(&self, epoch: u32, handles: &[u32]) -> Vec<f64> {
        if epoch == 0 || self.data_scene_epoch() != epoch || !handles.len().is_multiple_of(2) {
            return Vec::new();
        }
        let mut values = Vec::with_capacity(handles.len() * 16);
        for handle in handles.chunks_exact(2) {
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            let playback = self
                .world
                .is_current_entity(entity)
                .then(|| self.world.sprite_playbacks[entity.id as usize].as_ref())
                .flatten();
            if let Some(playback) = playback {
                let movement = self.data_scene.movement_animation.progress(entity);
                values.extend([
                    1.0,
                    f64::from(playback.clips[playback.active].id),
                    playback.elapsed,
                    f64::from(playback.paused),
                    f64::from(playback.flip_x),
                    f64::from(playback.flip_y),
                    f64::from(movement.is_some()),
                    f64::from(movement.map_or(0, |values| values[0])),
                ]);
                values.extend(
                    movement.unwrap_or([0; 25])[1..]
                        .iter()
                        .copied()
                        .map(f64::from),
                );
            } else {
                values.extend([0.0; 32]);
            }
        }
        values
    }

    /// Validates physics/removal and animation records together before any mutation.
    pub fn restore_data_scene_progress_with_animations(
        &mut self,
        epoch: u32,
        handles: &[u32],
        states: &[u32],
        animations: &[f64],
    ) -> bool {
        if epoch == 0
            || self.data_scene_epoch() != epoch
            || !self.validate_data_scene_animation_progress(handles, states, animations)
        {
            return false;
        }
        if !self.restore_data_scene_progress(epoch, handles, states) {
            return false;
        }
        self.apply_data_scene_animation_progress(handles, animations);
        true
    }
}

impl Engine {
    pub(super) fn validate_data_scene_animation_progress(
        &self,
        handles: &[u32],
        states: &[u32],
        animations: &[f64],
    ) -> bool {
        if !self.validate_data_scene_progress(handles, states)
            || states.len().checked_mul(ANIMATION_PROGRESS_STRIDE) != Some(animations.len())
        {
            return false;
        }
        for ((handle, state), animation) in handles
            .chunks_exact(2)
            .zip(states)
            .zip(animations.chunks_exact(ANIMATION_PROGRESS_STRIDE))
        {
            if animation[0] == 0.0 {
                if animation.iter().any(|value| *value != 0.0) {
                    return false;
                }
                continue;
            }
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            let Some(playback) = self.world.sprite_playbacks[entity.id as usize].as_ref() else {
                return false;
            };
            let Some(clip) = playback
                .clips
                .iter()
                .find(|clip| f64::from(clip.id) == animation[1])
            else {
                return false;
            };
            let duration = clip.frames.len() as f64 / f64::from(clip.fps);
            if *state == 0
                || animation[0] != 1.0
                || self.world.sprites[entity.id as usize].is_none()
                || !animation[2].is_finite()
                || animation[2] < 0.0
                || animation[2] > duration
                || (clip.looping && animation[2] >= duration)
                || animation[3..7]
                    .iter()
                    .any(|flag| *flag != 0.0 && *flag != 1.0)
                || !animation[7].is_finite()
                || !(0.0..=3.0).contains(&animation[7])
                || animation[7].fract() != 0.0
                || (animation[6] == 0.0 && animation[7] != 0.0)
                || (animation[6] == 1.0
                    && (self.world.primary_actor_entity() != Some(entity)
                        || !self
                            .world
                            .transform(entity)
                            .is_some_and(|at| at.x.is_finite() && at.y.is_finite())))
            {
                return false;
            }
            if animation[6] == 0.0 {
                if animation[8..].iter().any(|value| *value != 0.0) {
                    return false;
                }
            } else {
                for pose in animation[8..].chunks_exact(3) {
                    if !playback
                        .clips
                        .iter()
                        .any(|clip| f64::from(clip.id) == pose[0])
                        || pose[1..].iter().any(|flag| *flag != 0.0 && *flag != 1.0)
                    {
                        return false;
                    }
                }
            }
        }
        true
    }

    pub(super) fn apply_data_scene_animation_progress(
        &mut self,
        handles: &[u32],
        animations: &[f64],
    ) {
        for (handle, animation) in handles
            .chunks_exact(2)
            .zip(animations.chunks_exact(ANIMATION_PROGRESS_STRIDE))
        {
            if animation[0] == 0.0 {
                continue;
            }
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            if animation[6] == 0.0 {
                self.data_scene.movement_animation.detach(entity);
            } else {
                let poses: Vec<u32> = animation[8..].iter().map(|value| *value as u32).collect();
                // All poses and the primary actor were validated before mutation.
                self.configure_data_scene_movement_animation(&poses, animation[7] as u32);
            }
            let index = entity.id as usize;
            if let Some(playback) = self.world.sprite_playbacks[index].as_mut() {
                // Clip existence was checked for the entire batch above.
                if let Some(active) = playback
                    .clips
                    .iter()
                    .position(|clip| f64::from(clip.id) == animation[1])
                {
                    playback.active = active;
                }
                playback.elapsed = animation[2];
                playback.paused = animation[3] == 1.0;
                playback.flip_x = animation[4] == 1.0;
                playback.flip_y = animation[5] == 1.0;
                if let Some(sprite) = self.world.sprites[index].as_mut() {
                    playback.write_sprite(sprite);
                }
            }
        }
    }
}

impl Engine {
    pub(super) fn validate_data_scene_progress(&self, handles: &[u32], states: &[u32]) -> bool {
        if handles.len() != states.len() * 2 {
            return false;
        }
        let mut seen = HashSet::with_capacity(states.len());
        // Validate the entire batch before mutating any entity.
        for (handle, state) in handles.chunks_exact(2).zip(states) {
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            if (*state != 0 && (*state & 1 == 0 || *state & !63 != 0))
                || (*state & 8 != 0 && *state & 4 == 0)
                || (*state & 32 != 0 && *state & 16 == 0)
                || (*state & 4 != 0 && self.world.rigid_body(entity).is_none())
                || (*state & 16 != 0 && self.world.compound_collider_count(entity) != 1)
                || !seen.insert(entity.id)
                || !self.world.is_current_entity(entity)
            {
                return false;
            }
            if *state & 2 != 0
                && !self
                    .world
                    .interaction_at_index(entity.id as usize)
                    .is_some_and(|interaction| interaction.once)
            {
                return false;
            }
        }
        true
    }
}
