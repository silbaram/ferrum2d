//! Cold receiver bindings; sorted render metadata is a separate, optional bulk sidecar.
use super::Engine;
use crate::render_command::{SpriteLightMasks, SpriteLightingMaterial};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// Atomic `[id, generation, mode, cutoff f32 bits]`; omitted masks reset to all channels.
    pub fn configure_sprite_lighting_materials(&mut self, records: &[u32]) -> bool {
        self.apply_sprite_lighting_materials(records, 4)
    }
    /// Atomic v2 `[id, generation, mode, cutoff bits, light mask, shadow mask]`.
    /// Eight channel bits per mask. Custom masks require opaque/cutout reception.
    pub fn configure_sprite_lighting_materials_v2(&mut self, records: &[u32]) -> bool {
        self.apply_sprite_lighting_materials(records, 6)
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
    pub fn sprite_light_mask_abi_version(&self) -> u32 {
        1
    }
    pub fn sprite_light_mask_size(&self) -> usize {
        core::mem::size_of::<SpriteLightMasks>()
    }
    pub fn sprite_light_mask_ptr(&self) -> *const SpriteLightMasks {
        self.frame_buffers.sprite_light_masks.as_ptr()
    }
    pub fn sprite_light_mask_len(&self) -> usize {
        self.frame_buffers.sprite_light_masks.len()
    }
}

impl Engine {
    /// Validate the entire cold batch before changing receiver, mask or surface state.
    fn apply_sprite_lighting_materials(&mut self, records: &[u32], stride: usize) -> bool {
        if !records.len().is_multiple_of(stride) || records.len() / stride > 65_536 {
            return false;
        }
        let mut seen = std::collections::HashSet::with_capacity(records.len() / stride);
        let mut changes = Vec::with_capacity(records.len() / stride);
        for record in records.chunks_exact(stride) {
            let cutoff = f32::from_bits(record[3]);
            let masks = if stride == 6 {
                SpriteLightMasks {
                    light_mask: record[4],
                    shadow_mask: record[5],
                }
            } else {
                SpriteLightMasks::default()
            };
            if record[2] > 2
                || !cutoff.is_finite()
                || !(0.0..=1.0).contains(&cutoff)
                || (record[2] != 2 && cutoff != 0.0)
                || masks.light_mask > 255
                || masks.shadow_mask > 255
                || (record[2] == 0 && masks != SpriteLightMasks::default())
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
                (masks != SpriteLightMasks::default()).then_some(masks),
            ));
        }
        for (index, material, masks) in changes {
            self.world.sprite_lighting_materials[index] = material;
            self.world.sprite_light_masks[index] = masks;
            if material.is_none() {
                self.world.sprite_surface_materials[index] = None;
            }
        }
        true
    }
}
