use super::scenes::SceneMode;
use super::Engine;
use crate::entity::Entity;
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

// Cold-path bulk protocol. Handles are pairs (id, generation); states are
// 0 = removed, 1 = alive, 3 = alive with a consumed once interaction.
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
                1 | (u32::from(consumed) << 1)
            })
            .collect()
    }

    pub fn capture_data_scene_navigation(&self) -> Vec<f64> {
        if self.scene_mode != SceneMode::Data {
            return Vec::new();
        }
        self.data_scene.navigation.data_scene_navigation_snapshot()
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
        let mut seen = HashSet::with_capacity(states.len());
        // Validate the entire batch before mutating any entity.
        for (handle, state) in handles.chunks_exact(2).zip(states) {
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            if !matches!(state, 0 | 1 | 3)
                || !seen.insert(entity.id)
                || !self.world.is_current_entity(entity)
            {
                return false;
            }
            if *state == 3
                && !self
                    .world
                    .interaction_at_index(entity.id as usize)
                    .is_some_and(|interaction| interaction.once)
            {
                return false;
            }
        }
        for (handle, state) in handles.chunks_exact(2).zip(states) {
            let entity = Entity {
                id: handle[0],
                generation: handle[1],
            };
            if *state == 0 {
                self.world.despawn(entity);
            } else if let Some(interaction) =
                self.world.interaction_mut_at_index(entity.id as usize)
            {
                interaction.consumed = *state == 3;
            }
        }
        true
    }
}
