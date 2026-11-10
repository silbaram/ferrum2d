//! Independent optional receiver streams. Existing material/model ABIs stay v1.
use super::{SpatialMaterial, SpatialScene};

pub(crate) type SpatialReceiverMasks = crate::render_command::SpriteLightMasks;

pub(super) fn push_billboard_material(
    materials: &mut Vec<SpatialMaterial>,
    receiver_masks: &mut Vec<SpatialReceiverMasks>,
    quad_count: usize,
    material: SpatialMaterial,
    masks: SpatialReceiverMasks,
) {
    let index = quad_count - 1;
    materials.resize(index, SpatialMaterial::default());
    materials.push(material);
    if masks != SpatialReceiverMasks::default() || !receiver_masks.is_empty() {
        receiver_masks.resize(index, SpatialReceiverMasks::default());
        receiver_masks.push(masks);
    }
}

fn valid(words: &[u32], count: usize) -> bool {
    words.is_empty() || words.len() == count * 2 && words.iter().all(|word| *word <= 255)
}

fn pair(words: &[u32], index: usize) -> SpatialReceiverMasks {
    if words.is_empty() {
        SpatialReceiverMasks::default()
    } else {
        SpatialReceiverMasks {
            light_mask: words[index * 2],
            shadow_mask: words[index * 2 + 1],
        }
    }
}

impl SpatialScene {
    /// Keep trailing generated quads neutral without growing the legacy material stream.
    pub(crate) fn pad_billboard_receiver_masks(&mut self) {
        if !self.billboard_receiver_masks.is_empty() {
            self.billboard_receiver_masks
                .resize(self.billboards.len() / 6, SpatialReceiverMasks::default());
        }
    }

    /// Applies only to the private candidate of an atomic full-scene configuration.
    pub(crate) fn configure_receiver_masks(
        &mut self,
        terrain: &[u32],
        billboards: &[u32],
        models: &[u32],
        handles: &[u32],
        model_metadata: &[u32],
    ) -> bool {
        if !valid(terrain, self.surfaces.len())
            || !valid(billboards, handles.len() / 2)
            || !valid(models, model_metadata.len() / 6)
            || self.surfaces.iter().enumerate().any(|(i, surface)| {
                !surface.is_rendered && pair(terrain, i) != SpatialReceiverMasks::default()
            })
            || handles
                .chunks_exact(2)
                .any(|h| !self.bindings.contains_key(&(h[0], h[1])))
            || model_metadata
                .chunks_exact(6)
                .any(|m| !self.models.bindings.contains_key(&(m[0], m[1])))
        {
            return false;
        }
        for (i, surface) in self.surfaces.iter_mut().enumerate() {
            surface.receiver_masks = pair(terrain, i);
        }
        for (i, h) in handles.chunks_exact(2).enumerate() {
            if let Some(binding) = self.bindings.get_mut(&(h[0], h[1])) {
                binding.receiver_masks = pair(billboards, i);
            }
        }
        for (i, m) in model_metadata.chunks_exact(6).enumerate() {
            if let Some(binding) = self.models.bindings.get_mut(&(m[0], m[1])) {
                binding.receiver_masks = pair(models, i);
            }
        }
        self.terrain_receiver_masks.clear();
        if self
            .surfaces
            .iter()
            .any(|surface| surface.receiver_masks != SpatialReceiverMasks::default())
        {
            self.terrain_receiver_masks
                .extend(self.surfaces.iter().map(|surface| surface.receiver_masks));
        }
        if self
            .bindings
            .values()
            .any(|binding| binding.receiver_masks != SpatialReceiverMasks::default())
        {
            self.billboard_receiver_masks.reserve(self.bindings.len());
        }
        if self
            .models
            .bindings
            .values()
            .any(|binding| binding.receiver_masks != SpatialReceiverMasks::default())
        {
            self.models
                .receiver_masks
                .reserve(self.models.bindings.len());
        }
        true
    }

    /// One pair per visible quad; neutral padding also covers generated glyphs/particles.
    pub(crate) fn push_billboard_material(
        &mut self,
        material: SpatialMaterial,
        masks: SpatialReceiverMasks,
    ) {
        push_billboard_material(
            &mut self.billboard_materials,
            &mut self.billboard_receiver_masks,
            self.billboards.len() / 6,
            material,
            masks,
        );
    }
}
