//! Conservative light-face culling. Main-camera visibility never removes a shadow caster.
use super::{Point, SpatialScene, SpatialVertex};

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub(crate) struct ShadowDrawRange {
    pub face: u32,
    pub source: u32,
    pub first: u32,
    pub count: u32,
}
const _: () = assert!(std::mem::size_of::<ShadowDrawRange>() == 16);

impl SpatialScene {
    pub(super) fn build_shadow_ranges(&mut self) {
        self.shadow_draw_ranges.clear();
        if !self.environment.shadows() {
            return;
        }
        for index in 0..self.environment.shadow_matrices.len() / 16 {
            let matrix = &self.environment.shadow_matrices[index * 16..index * 16 + 16];
            let face = if self.environment.values.is_some_and(|v| v[2] < 0.) {
                6
            } else {
                index
            };
            let start = self.shadow_draw_ranges.len();
            for (source, vertices, stride) in [
                (0, self.terrain.as_slice(), 36),
                (1, self.shadow_casters.as_flattened(), 6),
            ] {
                for (index, chunk) in vertices.chunks_exact(stride).enumerate() {
                    if (source == 0 && self.terrain_materials[index].flags & 1 == 0)
                        || !intersects(matrix, chunk)
                    {
                        continue;
                    }
                    let first = (index * stride) as u32;
                    if let Some(last) = self.shadow_draw_ranges.last_mut() {
                        if last.face == face as u32
                            && last.source == source
                            && last.first + last.count == first
                        {
                            last.count += stride as u32;
                            continue;
                        }
                    }
                    self.shadow_draw_ranges.push(ShadowDrawRange {
                        face: face as u32,
                        source,
                        first,
                        count: stride as u32,
                    });
                }
            }
            // Disjoint ranges can split a texture batch. Preserve the original 64-draw face budget.
            let batches: usize = self.shadow_draw_ranges[start..]
                .iter()
                .map(|r| {
                    let vertices = if r.source == 0 {
                        self.terrain.as_slice()
                    } else {
                        self.shadow_casters.as_flattened()
                    };
                    vertices[r.first as usize..(r.first + r.count) as usize]
                        .chunks_exact(3)
                        .map(|t| t[0].texture)
                        .fold((0, None), |(n, last), id| {
                            (n + usize::from(last != Some(id)), Some(id))
                        })
                        .0
                })
                .sum();
            if batches > 64 {
                self.shadow_draw_ranges.truncate(start);
                for (index, material) in self.terrain_materials.iter().enumerate() {
                    if material.flags & 1 == 0 {
                        continue;
                    }
                    let first = index as u32 * 36;
                    if let Some(last) = self.shadow_draw_ranges.last_mut() {
                        if last.face == face as u32
                            && last.source == 0
                            && last.first + last.count == first
                        {
                            last.count += 36;
                            continue;
                        }
                    }
                    self.shadow_draw_ranges.push(ShadowDrawRange {
                        face: face as u32,
                        source: 0,
                        first,
                        count: 36,
                    });
                }
                if !self.shadow_casters.is_empty() {
                    self.shadow_draw_ranges.push(ShadowDrawRange {
                        face: face as u32,
                        source: 1,
                        first: 0,
                        count: self.shadow_casters.len() as u32 * 6,
                    });
                }
            }
        }
    }
}

fn intersects(matrix: &[f32], vertices: &[SpatialVertex]) -> bool {
    let mut min: Point = [f32::INFINITY; 3];
    let mut max: Point = [f32::NEG_INFINITY; 3];
    for v in vertices {
        for axis in 0..3 {
            min[axis] = min[axis].min(v.position[axis]);
            max[axis] = max[axis].max(v.position[axis]);
        }
    }
    // Unnormalized homogeneous planes, evaluated in f64 with an f32 GPU rounding allowance.
    (0..6).all(|plane| {
        let row = plane / 2;
        let sign = if plane % 2 == 0 { 1.0 } else { -1.0 };
        let mut distance = f64::from(matrix[15]) + sign * f64::from(matrix[12 + row]);
        let mut magnitude = distance.abs();
        for axis in 0..3 {
            let w = f64::from(matrix[axis * 4 + 3]);
            let r = f64::from(matrix[axis * 4 + row]);
            let p = w + sign * r;
            distance += p * f64::from(if p >= 0.0 { max[axis] } else { min[axis] });
            magnitude += (w.abs() + r.abs()) * f64::from(min[axis].abs().max(max[axis].abs()));
        }
        distance >= -16.0 * f64::from(f32::EPSILON) * magnitude.max(1.0)
    })
}
