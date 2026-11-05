use super::super::Engine;
use wasm_bindgen::prelude::*;

const STRIDE: usize = 48;
const MAX_REQUESTS: usize = 128;

#[wasm_bindgen]
impl Engine {
    /// Owned packet: [query count, total hits, returned hits, (id, generation, distance,
    /// point x/y, normal x/y)*, ...]. Never aliases Wasm memory across a later call.
    pub fn batch_cast_bodies(&mut self, requests: &[f64]) -> Vec<f64> {
        if !requests.len().is_multiple_of(STRIDE)
            || requests.len() / STRIDE > MAX_REQUESTS
            || !requests.chunks_exact(STRIDE).all(valid_request)
        {
            return Vec::new();
        }
        let mut result = Vec::with_capacity(1 + requests.len() / STRIDE * 9);
        result.push((requests.len() / STRIDE) as f64);
        for r in requests.chunks_exact(STRIDE) {
            let kind = r[0] as u32;
            let mask = r[1] as u32;
            let floor = r[3] as u32;
            let v: [f32; STRIDE - 6] = std::array::from_fn(|i| r[i + 6] as f32);
            let height = (floor, v[0], v[1]);
            match (kind, r[2] == 1.0) {
                (0, false) => {
                    self.raycast_bodies(v[2], v[3], v[7], v[8], v[9], mask);
                }
                (0, true) => {
                    self.raycast_bodies_with_height_span(
                        v[2], v[3], v[7], v[8], v[9], mask, height.0, height.1, height.2,
                    );
                }
                (1, false) => {
                    self.segment_cast_bodies(v[2], v[3], v[4], v[5], mask);
                }
                (1, true) => {
                    self.segment_cast_bodies_with_height_span(
                        v[2], v[3], v[4], v[5], mask, height.0, height.1, height.2,
                    );
                }
                (2, false) => {
                    self.shape_cast_aabb_bodies(v[2], v[3], v[4], v[5], v[7], v[8], v[9], mask);
                }
                (2, true) => {
                    self.shape_cast_aabb_bodies_with_height_span(
                        v[2], v[3], v[4], v[5], v[7], v[8], v[9], mask, height.0, height.1,
                        height.2,
                    );
                }
                (3, false) => {
                    self.shape_cast_circle_bodies(v[2], v[3], v[4], v[7], v[8], v[9], mask);
                }
                (3, true) => {
                    self.shape_cast_circle_bodies_with_height_span(
                        v[2], v[3], v[4], v[7], v[8], v[9], mask, height.0, height.1, height.2,
                    );
                }
                (4, false) => {
                    self.shape_cast_oriented_box_bodies(
                        v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], mask,
                    );
                }
                (4, true) => {
                    self.shape_cast_oriented_box_bodies_with_height_span(
                        v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], mask, height.0, height.1,
                        height.2,
                    );
                }
                (5, false) => {
                    self.shape_cast_capsule_bodies(
                        v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], mask,
                    );
                }
                (5, true) => {
                    self.shape_cast_capsule_bodies_with_height_span(
                        v[2], v[3], v[4], v[5], v[6], v[7], v[8], v[9], mask, height.0, height.1,
                        height.2,
                    );
                }
                (6, false) => {
                    self.shape_cast_convex_polygon_bodies(
                        v[10..10 + r[5] as usize * 2].to_vec(),
                        v[7],
                        v[8],
                        v[9],
                        mask,
                    );
                }
                (6, true) => {
                    self.shape_cast_convex_polygon_bodies_with_height_span(
                        v[10..10 + r[5] as usize * 2].to_vec(),
                        v[7],
                        v[8],
                        v[9],
                        mask,
                        height.0,
                        height.1,
                        height.2,
                    );
                }
                _ => unreachable!("validated query kind"),
            }
            let count = self.physics_raycast_hits.len().min(r[4] as usize);
            result.extend([self.physics_raycast_hits.len() as f64, count as f64]);
            for hit in &self.physics_raycast_hits[..count] {
                result.extend([
                    hit.entity_id as f64,
                    hit.entity_generation as f64,
                    hit.distance as f64,
                    hit.point_x as f64,
                    hit.point_y as f64,
                    hit.normal_x as f64,
                    hit.normal_y as f64,
                ]);
            }
        }
        result
    }
}

fn valid_request(r: &[f64]) -> bool {
    if r.iter().any(|n| !n.is_finite())
        || r[..6].iter().any(|n| *n < 0.0 || n.fract() != 0.0)
        || r[0] > 6.0
        || r[1] > u32::MAX as f64
        || r[2] > 1.0
        || r[3] > u32::MAX as f64
        || !(1.0..=32.0).contains(&r[4])
        || r[5] > 16.0
        || r[6..].iter().any(|n| !(*n as f32).is_finite())
    {
        return false;
    }
    let v = &r[6..];
    if r[2] == 1.0 && v[1] < 0.0 {
        return false;
    }
    if r[0] != 1.0 && v[9] < 0.0 {
        return false;
    }
    match r[0] as u32 {
        2 | 4 => v[4] > 0.0 && v[5] > 0.0,
        3 => v[4] > 0.0,
        5 => v[6] > 0.0,
        6 => {
            r[5] >= 3.0
                && Engine::convex_polygon_query_shape(
                    &v[10..10 + r[5] as usize * 2]
                        .iter()
                        .map(|n| *n as f32)
                        .collect::<Vec<_>>(),
                )
                .is_some()
        }
        _ => true,
    }
}
