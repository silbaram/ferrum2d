//! Cold surface bindings. Native sort, snapshots and entity generations own their lifetime.
use super::Engine;
use crate::render_command::{SpriteSurfaceMaterial, SPRITE_SURFACE_TEXTURE_NONE};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// Atomic `[id, generation, emissionTex, specularTex, roughnessTex, flags,
    /// emissionR/G/B bits, specular bits, roughness bits, reserved0]` records.
    /// flags1 requires an opaque/cutout receiver; canonical flags0 detaches.
    pub fn configure_sprite_surface_materials(&mut self, records: &[u32]) -> bool {
        if !records.len().is_multiple_of(12) || records.len() / 12 > 65_536 {
            return false;
        }
        let mut seen = std::collections::HashSet::with_capacity(records.len() / 12);
        let mut changes = Vec::with_capacity(records.len() / 12);
        for record in records.chunks_exact(12) {
            let material = SpriteSurfaceMaterial {
                emission_texture: record[2],
                specular_texture: record[3],
                roughness_texture: record[4],
                flags: record[5],
                emission: [
                    f32::from_bits(record[6]),
                    f32::from_bits(record[7]),
                    f32::from_bits(record[8]),
                ],
                specular: f32::from_bits(record[9]),
                roughness: f32::from_bits(record[10]),
                reserved: record[11],
            };
            if material.flags > 1
                || material.reserved != 0
                || [
                    material.emission_texture,
                    material.specular_texture,
                    material.roughness_texture,
                ]
                .iter()
                .any(|&id| id > SPRITE_SURFACE_TEXTURE_NONE)
                || material
                    .emission
                    .iter()
                    .any(|v| !v.is_finite() || !(0.0..=64.0).contains(v))
                || !material.specular.is_finite()
                || !(0.0..=1.0).contains(&material.specular)
                || !material.roughness.is_finite()
                || !(0.0..=1.0).contains(&material.roughness)
                || (material.flags == 0 && material != SpriteSurfaceMaterial::default())
                || !seen.insert(record[0])
            {
                return false;
            }
            let Some(entity) = self.entity_from_handle(record[0], record[1]) else {
                return false;
            };
            let index = entity.id as usize;
            if self.world.sprites[index].is_none()
                || material.flags == 1 && self.world.sprite_lighting_materials[index].is_none()
            {
                return false;
            }
            changes.push((index, (material.flags == 1).then_some(material)));
        }
        for (index, material) in changes {
            self.world.sprite_surface_materials[index] = material;
        }
        true
    }
    pub fn sprite_surface_material_abi_version(&self) -> u32 {
        1
    }
    pub fn sprite_surface_material_size(&self) -> usize {
        core::mem::size_of::<SpriteSurfaceMaterial>()
    }
    pub fn sprite_surface_material_ptr(&self) -> *const SpriteSurfaceMaterial {
        self.frame_buffers.sprite_surface_materials.as_ptr()
    }
    pub fn sprite_surface_material_len(&self) -> usize {
        self.frame_buffers.sprite_surface_materials.len()
    }
}
