//! Cold receiver bindings; sorted render metadata is a separate, optional bulk sidecar.
use super::Engine;
use crate::render_command::SpriteLightingMaterial;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// Atomic `[id, generation, mode, cutoff f32 bits]`; mode 0 detaches, 1 opaque, 2 cutout.
    pub fn configure_sprite_lighting_materials(&mut self, records: &[u32]) -> bool {
        if !records.len().is_multiple_of(4) || records.len() / 4 > 65_536 {
            return false;
        }
        let mut seen = std::collections::HashSet::with_capacity(records.len() / 4);
        let mut changes = Vec::with_capacity(records.len() / 4);
        for record in records.chunks_exact(4) {
            let cutoff = f32::from_bits(record[3]);
            if record[2] > 2
                || !cutoff.is_finite()
                || !(0.0..=1.0).contains(&cutoff)
                || (record[2] != 2 && cutoff != 0.0)
                || !seen.insert(record[0])
            {
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
                (record[2] != 0).then_some(SpriteLightingMaterial {
                    mode: record[2],
                    alpha_cutoff: cutoff,
                }),
            ));
        }
        for (index, material) in changes {
            self.world.sprite_lighting_materials[index] = material;
        }
        true
    }
    pub fn sprite_lighting_material_abi_version(&self) -> u32 {
        1
    }
    pub fn sprite_lighting_material_size(&self) -> usize {
        core::mem::size_of::<SpriteLightingMaterial>()
    }
    pub fn sprite_lighting_material_ptr(&self) -> *const SpriteLightingMaterial {
        self.frame_buffers.sprite_lighting_materials.as_ptr()
    }
    pub fn sprite_lighting_material_len(&self) -> usize {
        self.frame_buffers.sprite_lighting_materials.len()
    }
}
