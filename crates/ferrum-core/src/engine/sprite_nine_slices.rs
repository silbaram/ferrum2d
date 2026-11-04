//! Cold atomic bindings; expansion uses existing render commands and sort/material records.
use super::Engine;
use crate::components::SpriteNineSlice;
use crate::render_command::SpriteRenderItem;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    pub fn sprite_nine_slice_abi_version(&self) -> u32 {
        1
    }

    /// Pairs of entity id/generation and nine f32 values per binding. All-zero detaches.
    pub fn configure_sprite_nine_slices(&mut self, handles: &[u32], values: &[f32]) -> bool {
        if !handles.len().is_multiple_of(2)
            || handles.len() / 2 > 65_536
            || values.len() != handles.len() / 2 * 9
        {
            return false;
        }
        let mut seen = std::collections::HashSet::with_capacity(handles.len() / 2);
        let mut changes = Vec::with_capacity(handles.len() / 2);
        for (handle, record) in handles.chunks_exact(2).zip(values.chunks_exact(9)) {
            let Some(entity) = self.entity_from_handle(handle[0], handle[1]) else {
                return false;
            };
            let i = entity.id as usize;
            if !seen.insert(entity.id) || self.world.sprites[i].is_none() {
                return false;
            }
            let slice = if record.iter().all(|v| *v == 0.) {
                None
            } else {
                let Some(slice) = SpriteNineSlice::from_record(record) else {
                    return false;
                };
                if self.world.ground_shadows[i].is_some_and(|s| {
                    s.shape == crate::world::ground_shadow::GroundShadowShape::Alpha
                }) || self
                    .spatial_scene
                    .bindings
                    .contains_key(&(entity.id, entity.generation))
                    || self
                        .spatial_scene
                        .models
                        .bindings
                        .contains_key(&(entity.id, entity.generation))
                    || self
                        .spatial_scene
                        .runtime_billboards
                        .iter()
                        .any(|(e, _)| *e == entity)
                {
                    return false;
                }
                Some(slice)
            };
            changes.push((i, slice));
        }
        for (i, slice) in changes {
            self.world.sprite_nine_slices[i] = slice;
        }
        true
    }
}

/// Full sprite culling/picking stays unchanged. Each tile shares its owner's sort key.
pub(super) fn append_nine_slice(
    items: &mut Vec<SpriteRenderItem>,
    item: SpriteRenderItem,
    slice: SpriteNineSlice,
    ground_y_scale: f32,
) {
    let command = item.command;
    let (xs, us) = cuts(
        command.width,
        slice.source_width,
        slice.left,
        slice.right,
        slice.border_scale,
        slice.flip_x ^ (command.u1 < command.u0),
    );
    let (ys, vs) = cuts(
        command.height,
        slice.source_height,
        slice.top,
        slice.bottom,
        slice.border_scale,
        slice.flip_y ^ (command.v1 < command.v0),
    );
    let u0 = command.u0.min(command.u1);
    let v0 = command.v0.min(command.v1);
    let du = (command.u1 - command.u0).abs();
    let dv = (command.v1 - command.v0).abs();
    let (sin, cos) = command.rotation_radians.sin_cos();
    let center_x = command.x + command.width * 0.5;
    let center_y = command.y + command.height * 0.5;
    for y in 0..3 {
        for x in 0..3 {
            let width = xs[x + 1] - xs[x];
            let height = ys[y + 1] - ys[y];
            if width <= 0. || height <= 0. {
                continue;
            }
            let dx = (xs[x] + xs[x + 1] - command.width) * 0.5;
            let dy = (ys[y] + ys[y + 1] - command.height) * 0.5;
            let mut tile = item;
            tile.command.x = center_x + cos * dx - sin * dy - width * 0.5;
            tile.command.y = center_y + (sin * dx + cos * dy) * ground_y_scale - height * 0.5;
            tile.command.width = width;
            tile.command.height = height;
            tile.command.u0 = u0 + du * us[x];
            tile.command.u1 = u0 + du * us[x + 1];
            tile.command.v0 = v0 + dv * vs[y];
            tile.command.v1 = v0 + dv * vs[y + 1];
            items.push(tile);
        }
    }
}

fn cuts(
    target: f32,
    source: f32,
    first: f32,
    last: f32,
    scale: f32,
    flip: bool,
) -> ([f32; 4], [f32; 4]) {
    let mut uv = [0., first / source, 1. - last / source, 1.];
    let (first, last) = if flip {
        uv.reverse();
        (last, first)
    } else {
        (first, last)
    };
    let first = first * scale;
    let last = last * scale;
    let shrink = if first + last > target {
        target / (first + last)
    } else {
        1.
    };
    // Clamping the shared center cut avoids negative cells from f32 cancellation.
    let a = (first * shrink).min(target);
    let b = (target - last * shrink).max(a);
    ([0., a, b, target], uv)
}
