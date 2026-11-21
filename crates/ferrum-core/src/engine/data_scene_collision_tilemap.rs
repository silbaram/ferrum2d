//! Bounded Data Scene grid authoring; collision-only v1 stays byte-for-byte compatible.
use super::{scenes::SceneMode, Engine};
use crate::components::SpriteFrame;
use crate::physics3d::PlanarCollisionSpan;
use crate::tilemap::Tilemap;
use wasm_bindgen::prelude::*;

fn decode(metadata: &[u32], values: &[f32], cells: &[u32]) -> Option<Tilemap> {
    if metadata.is_empty() && values.is_empty() && cells.is_empty() {
        return Some(Tilemap::default());
    }
    if metadata.len() < 3 || values.len() < 4 {
        return None;
    }
    let (columns, rows, count) = (metadata[0], metadata[1], metadata[2] as usize);
    if !(1..=256).contains(&columns)
        || !(1..=256).contains(&rows)
        || count > 256
        || metadata.len() != 3 + count * 5
        || values.len() != 4 + count * 5
        || cells.len() != columns as usize * rows as usize
        || values.iter().any(|v| !v.is_finite())
    {
        return None;
    }
    let (width, height, x, y) = (values[0], values[1], values[2], values[3]);
    if width <= 0.
        || height <= 0.
        || [
            width,
            height,
            x,
            y,
            x + columns as f32 * width,
            y + rows as f32 * height,
        ]
        .iter()
        .any(|v| !v.is_finite() || v.abs() > 1e6)
    {
        return None;
    }
    let mut defined = [false; 257];
    let mut candidate = Tilemap::default();
    for (m, v) in metadata[3..]
        .chunks_exact(5)
        .zip(values[4..].chunks_exact(5))
    {
        let id = m[0] as usize;
        let span = PlanarCollisionSpan {
            floor: m[1],
            elevation: v[0],
            height: v[1],
        };
        if id == 0
            || id > 256
            || defined[id]
            || !span.valid()
            || m[3] & !15 != 0
            || (m[3] & 8 == 0 && (m[4] != 0 || v[3] != 0. || v[4] != 0.))
        {
            return None;
        }
        defined[id] = true;
        if !candidate.set_tile_height_span_definition(m[0], m[1], v[0], v[1])
            || !candidate.set_tile_hd2d_definition(
                m[0],
                m[2],
                m[3] & 1 != 0,
                m[3] & 2 != 0,
                m[3] & 4 != 0,
                v[2],
                m[3] & 8 != 0,
                m[4],
                v[3],
                v[4],
            )
        {
            return None;
        }
    }
    if cells
        .iter()
        .any(|&id| id > 256 || (id != 0 && !defined[id as usize]))
    {
        return None;
    }
    candidate.set_layer(0, columns, rows, width, height, x, y, true, cells.to_vec());
    Some(candidate)
}

/// v2 adds a separate, versioned visual buffer to the unchanged collision packet.
/// Definitions without a visual entry retain their invisible collision behavior.
fn decode_visuals(
    candidate: &mut Tilemap,
    collision_metadata: &[u32],
    metadata: &[u32],
    values: &[f32],
) -> Option<()> {
    if metadata.len() < 2 || metadata[0] != 2 {
        return None;
    }
    let count = metadata[1] as usize;
    if count > 256 || metadata.len() != 2 + count * 2 || values.len() != count * 8 {
        return None;
    }
    let mut seen = [false; 257];
    for (m, v) in metadata[2..].chunks_exact(2).zip(values.chunks_exact(8)) {
        let id = m[0] as usize;
        if id == 0
            || id > 256
            || seen[id]
            // Sprite command texture IDs use f32; disallow lossy integer casts.
            || m[1] > 0x00ff_ffff
            || !collision_metadata.get(3..)?.chunks_exact(5).any(|d| d[0] == m[0])
            || SpriteFrame::from_values(v[0], v[1], v[2], v[3]).is_none()
            || v[4..].iter().any(|c| !c.is_finite() || !(0.0..=1.0).contains(c))
        {
            return None;
        }
        seen[id] = true;
        candidate.set_tile_definition(m[0], m[1], v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
    }
    Some(())
}

#[wasm_bindgen]
impl Engine {
    /// Cold capability negotiation. v1 collision packets remain supported.
    pub fn data_scene_collision_tilemap_version(&self) -> u32 {
        2
    }

    /// Replaces the Data Scene collision grid and metadata. Empty buffers clear it.
    /// Native geometry is admitted here and synchronized by the next query/tick.
    pub fn configure_data_scene_collision_tilemap(
        &mut self,
        metadata: &[u32],
        values: &[f32],
        cells: &[u32],
    ) -> bool {
        if self.scene_mode != SceneMode::Data {
            return false;
        }
        let Some(candidate) = decode(metadata, values, cells) else {
            return false;
        };
        self.admit_data_scene_tilemap(candidate)
    }

    /// Atomically replaces collision data and opt-in graphics using the existing tile renderer.
    /// Visual metadata is `[2, count, tile_id, texture_id, ...]`; each visual has
    /// `[u0, v0, u1, v1, r, g, b, a]` values. No renderer ABI change is required.
    pub fn configure_data_scene_collision_tilemap_v2(
        &mut self,
        metadata: &[u32],
        values: &[f32],
        cells: &[u32],
        visual_metadata: &[u32],
        visual_values: &[f32],
    ) -> bool {
        if self.scene_mode != SceneMode::Data {
            return false;
        }
        let Some(mut candidate) = decode(metadata, values, cells) else {
            return false;
        };
        if decode_visuals(&mut candidate, metadata, visual_metadata, visual_values).is_none()
            // The existing tile renderer consumes the planar camera only. Fail explicitly.
            || (visual_metadata[1] != 0 && self.spatial_scene.camera.is_some())
        {
            return false;
        }
        self.admit_data_scene_tilemap(candidate)
    }
}

impl Engine {
    fn admit_data_scene_tilemap(&mut self, candidate: Tilemap) -> bool {
        if self.unified_physics.as_ref().is_some_and(|runtime| {
            runtime
                .validate_collision_tilemap(&candidate, &self.spatial_scene)
                .is_err()
        }) {
            return false;
        }
        self.tilemap.replace_collision_data(candidate)
    }
}

#[cfg(test)]
mod graphical_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::{Space, WorldConfig};
    fn packet() -> (Vec<u32>, Vec<f32>, Vec<u32>) {
        (
            vec![1, 1, 1, 1, 0, 0, 7, 0],
            vec![1., 1., 2., 0., 0., 1., 0., 0., 0.],
            vec![1],
        )
    }
    #[test]
    fn hd2d_native_tilemap_bulk_rejects_wrong_scene_invalid_payload_and_undefined_ids() {
        let mut e = Engine::new();
        let (m, f, c) = packet();
        assert!(!e.configure_data_scene_collision_tilemap(&m, &f, &c));
        e.use_data_scene();
        assert!(e.configure_data_scene_collision_tilemap(&m, &f, &c));
        let previous = e.tilemap.clone();
        for (metadata, values, cells) in [
            (vec![0, 1, 1], f.clone(), c.clone()),
            (m.clone(), f.clone(), vec![2]),
            (m.clone(), vec![], c.clone()),
        ] {
            assert!(!e.configure_data_scene_collision_tilemap(&metadata, &values, &cells));
            assert_eq!(e.tilemap, previous);
        }
    }
    #[test]
    fn hd2d_native_tilemap_bulk_capacity_rejection_preserves_live_world() {
        let mut e = Engine::new();
        e.use_data_scene();
        e.configure_unified_physics(WorldConfig {
            space: Space::PlanarXy,
            max_bodies: 1,
            max_colliders: 1,
            ..Default::default()
        })
        .unwrap();
        let (mut m, f, _) = packet();
        m[0] = 2;
        let previous = e.tilemap.clone();
        assert!(!e.configure_data_scene_collision_tilemap(&m, &f, &[1, 1]));
        assert_eq!(e.tilemap, previous);
        m[0] = 1;
        assert!(e.configure_data_scene_collision_tilemap(&m, &f, &[1]));
    }
    #[test]
    fn hd2d_native_tilemap_bulk_replacements_have_fresh_revision_and_can_clear() {
        let mut e = Engine::new();
        e.use_data_scene();
        let (m, mut f, c) = packet();
        assert!(e.configure_data_scene_collision_tilemap(&m, &f, &c));
        let revision = e.tilemap.physics_revision();
        f[2] = 3.;
        assert!(e.configure_data_scene_collision_tilemap(&m, &f, &c));
        assert!(e.tilemap.physics_revision() > revision);
        assert!(e.configure_data_scene_collision_tilemap(&[], &[], &[]));
        assert_eq!(e.tilemap.terrain_tiles().count(), 0);
    }
}
