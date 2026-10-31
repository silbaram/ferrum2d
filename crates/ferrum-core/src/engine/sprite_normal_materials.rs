//! Cold, atomic material binding and command-aligned bulk render metadata.
use super::Engine;
use crate::render_command::{SpriteNormalMaterial, SPRITE_NORMAL_NONE};
use wasm_bindgen::prelude::*;

const MAX_BINDINGS: usize = 65_536;

#[wasm_bindgen]
impl Engine {
    /// Bind `[id, generation, normal texture, flags]` records atomically. NONE detaches.
    pub fn configure_sprite_normal_materials(&mut self, records: &[u32]) -> bool {
        if !records.len().is_multiple_of(4) || records.len() / 4 > MAX_BINDINGS {
            return false;
        }
        let mut seen = std::collections::HashSet::with_capacity(records.len() / 4);
        let mut changes = Vec::with_capacity(records.len() / 4);
        for record in records.chunks_exact(4) {
            if record[2] > SPRITE_NORMAL_NONE || record[3] != 0 || !seen.insert(record[0]) {
                return false;
            }
            let Some(entity) = self.entity_from_handle(record[0], record[1]) else {
                return false;
            };
            let index = entity.id as usize;
            if self.world.sprites[index].is_none() {
                return false;
            }
            changes.push((
                index,
                (record[2] != SPRITE_NORMAL_NONE).then_some(SpriteNormalMaterial {
                    normal_texture: record[2],
                    flags: 0,
                }),
            ));
        }
        for (index, material) in changes {
            self.world.sprite_normal_materials[index] = material;
        }
        true
    }
    pub fn sprite_normal_material_abi_version(&self) -> u32 {
        1
    }
    pub fn sprite_normal_material_size(&self) -> usize {
        core::mem::size_of::<SpriteNormalMaterial>()
    }
    pub fn sprite_normal_material_ptr(&self) -> *const SpriteNormalMaterial {
        self.frame_buffers.sprite_normal_materials.as_ptr()
    }
    pub fn sprite_normal_material_len(&self) -> usize {
        self.frame_buffers.sprite_normal_materials.len()
    }
}
