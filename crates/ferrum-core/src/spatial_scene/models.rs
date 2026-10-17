//! Immutable asset bounds + native entity poses. Geometry/GPU resources belong to the platform.
use super::{Point, SpatialCamera};
use crate::{entity::Entity, world::World};
use std::collections::BTreeMap;

#[derive(Debug)]
pub(crate) struct ModelBinding {
    pub asset: u32,
    pub flags: u32,
    pub elevation: f32,
    pub yaw: f32,
    pub scale: f32,
    pub min: Point,
    pub max: Point,
}

/// Extension v1: four u32 words followed by a column-major model matrix (80 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ModelDraw {
    asset: u32,
    flags: u32,
    /// Camera bit 0; point faces bits 1..6; sun bit 7.
    mask: u32,
    reserved: u32,
    matrix: [f32; 16],
}
const _: () = assert!(std::mem::size_of::<ModelDraw>() == 80);

#[derive(Default, Debug)]
pub(crate) struct SpatialModels {
    pub(super) streaming: super::model_streaming::ModelStreaming,
    pub bindings: BTreeMap<(u32, u32), ModelBinding>,
    pub draws: Vec<ModelDraw>,
}
impl SpatialModels {
    /// Metadata: entity ID/generation, asset ID, flags, primitive count, triangle count.
    /// Style: elevation, yaw, positive uniform scale, local min XYZ, local max XYZ.
    pub fn configure(&mut self, world: &World, metadata: &[u32], styles: &[f32]) -> bool {
        if !metadata.len().is_multiple_of(6)
            || metadata.len() > 1024 * 6
            || styles.len() != metadata.len() / 6 * 9
        {
            return false;
        }
        let mut next = BTreeMap::new();
        let mut primitives = 0_u64;
        let mut triangles = 0_u64;
        for (m, v) in metadata.chunks_exact(6).zip(styles.chunks_exact(9)) {
            let entity = Entity {
                id: m[0],
                generation: m[1],
            };
            primitives += u64::from(m[4]);
            triangles += u64::from(m[5]);
            if !world.is_current_entity(entity)
                || world.transform(entity).is_none()
                || m[2] == 0
                || m[3] > 3
                || !(1..=32).contains(&m[4])
                || !(1..=65536).contains(&m[5])
                || primitives > 4096
                || triangles > 262144
                || v.iter().any(|x| !x.is_finite())
                || !(0.0001..=10000.).contains(&v[2])
                || (0..3).any(|i| v[i + 3] > v[i + 6])
                || next.contains_key(&(m[0], m[1]))
            {
                return false;
            }
            let binding = ModelBinding {
                asset: m[2],
                flags: m[3],
                elevation: v[0],
                yaw: v[1],
                scale: v[2],
                min: [v[3], v[4], v[5]],
                max: [v[6], v[7], v[8]],
            };
            if binding.pose(world, entity).is_none() {
                return false;
            }
            next.insert((m[0], m[1]), binding);
        }
        self.streaming = Default::default();
        self.bindings = next;
        self.draws.clear();
        // Reserve during cold configuration rather than growing the Wasm bulk output in a frame.
        self.draws.reserve(self.bindings.len());
        true
    }
    pub fn build(
        &mut self,
        world: &World,
        camera: &SpatialCamera,
        shadow_matrices: &[f32],
        point_shadow: bool,
    ) {
        self.draws.clear();
        self.streaming.update_chunks(camera);
        for (&(id, generation), binding) in &self.bindings {
            let entity = Entity { id, generation };
            if !world.is_current_entity(entity) {
                continue;
            }
            let Some((matrix, min, max)) = binding.pose(world, entity) else {
                continue;
            };
            let mut mask = u32::from(camera.intersects_bounds(min, max));
            if binding.flags & 1 != 0 {
                for (index, m) in shadow_matrices.chunks_exact(16).enumerate() {
                    if super::shadows::intersects_bounds(m, min, max) {
                        let bit = if !point_shadow || index == 6 {
                            7
                        } else {
                            index + 1
                        };
                        mask |= 1 << bit;
                    }
                }
            }
            let (asset, resident) =
                self.streaming
                    .select((id, generation), binding.asset, &matrix, camera);
            if !resident {
                mask &= !1;
            }
            // Inactive chunks release GPU resources unless a light still needs their shadows.
            if !resident && mask == 0 {
                continue;
            }
            // Resident references retain resources even when camera-culled.
            self.draws.push(ModelDraw {
                asset,
                flags: binding.flags,
                mask,
                reserved: 0,
                matrix,
            });
        }
    }
}
impl ModelBinding {
    fn pose(&self, world: &World, entity: Entity) -> Option<([f32; 16], Point, Point)> {
        let at = world.transform(entity)?;
        self.pose_at_rotation(
            at,
            world.height_span(entity).map_or(0., |s| s.elevation),
            world
                .rotation_at_index_or_default(entity.id as usize)
                .radians,
        )
    }
    pub(crate) fn pose_at(
        &self,
        at: crate::components::Transform2D,
        body_elevation: f32,
    ) -> Option<([f32; 16], Point, Point)> {
        self.pose_at_rotation(at, body_elevation, 0.)
    }
    pub(crate) fn pose_at_rotation(
        &self,
        at: crate::components::Transform2D,
        body_elevation: f32,
        rotation: f32,
    ) -> Option<([f32; 16], Point, Point)> {
        let elevation = body_elevation + self.elevation;
        let yaw = self.yaw + rotation;
        // Guard intermediate GPU products too, including cancellation near the f32 limit.
        let extent = self
            .min
            .iter()
            .chain(&self.max)
            .map(|v| v.abs())
            .fold(0_f32, f32::max);
        if !(extent * self.scale * 4.
            + at.x.abs()
            + at.y.abs()
            + body_elevation.abs()
            + self.elevation.abs())
        .is_finite()
        {
            return None;
        }
        // Preserve exact authored cardinal placement so mesh and axis-aligned proxies agree.
        // Only match the exact f32 radians sent by authoring; nearby free angles stay unsnapped.
        use std::f32::consts::{FRAC_PI_2, PI, TAU};
        let (sin, cos) = if yaw == 0. || yaw == TAU || yaw == -TAU {
            (0., 1.)
        } else if yaw == FRAC_PI_2 || yaw == -3. * FRAC_PI_2 {
            (1., 0.)
        } else if yaw == PI || yaw == -PI {
            (0., -1.)
        } else if yaw == -FRAC_PI_2 || yaw == 3. * FRAC_PI_2 {
            (-1., 0.)
        } else {
            yaw.sin_cos()
        };
        let (s, c) = (sin * self.scale, cos * self.scale);
        let matrix = [
            c, 0., -s, 0., 0., self.scale, 0., 0., s, 0., c, 0., at.x, elevation, -at.y, 1.,
        ];
        let mut min = [f32::INFINITY; 3];
        let mut max = [f32::NEG_INFINITY; 3];
        for bits in 0..8 {
            let p: Point = std::array::from_fn(|i| {
                if bits & (1 << i) == 0 {
                    self.min[i]
                } else {
                    self.max[i]
                }
            });
            let v = [
                c * p[0] + s * p[2] + at.x,
                self.scale * p[1] + elevation,
                -s * p[0] + c * p[2] - at.y,
            ];
            for i in 0..3 {
                min[i] = min[i].min(v[i]);
                max[i] = max[i].max(v[i]);
            }
        }
        matrix
            .iter()
            .chain(min.iter())
            .chain(max.iter())
            .all(|v| v.is_finite())
            .then_some((matrix, min, max))
    }
}

pub(crate) fn preflight_model_poses(styles: &[f32], origins: &[f32]) -> bool {
    if !styles.len().is_multiple_of(9)
        || styles.len() > 1024 * 9
        || origins.len() != styles.len() / 9 * 3
    {
        return false;
    }
    styles
        .chunks_exact(9)
        .zip(origins.chunks_exact(3))
        .all(|(v, o)| {
            if v.iter().chain(o).any(|x| !x.is_finite())
                || !(0.0001..=10000.).contains(&v[2])
                || (0..3).any(|i| v[3 + i] > v[6 + i])
            {
                return false;
            }
            ModelBinding {
                asset: 1,
                flags: 3,
                elevation: v[0],
                yaw: v[1],
                scale: v[2],
                min: [v[3], v[4], v[5]],
                max: [v[6], v[7], v[8]],
            }
            .pose_at(crate::components::Transform2D { x: o[0], y: o[1] }, o[2])
            .is_some()
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cardinal_model_matrices_match_aabb_proxy_axes_without_snapping_nearby_yaw() {
        let mut binding = ModelBinding {
            asset: 1,
            flags: 3,
            elevation: 16.,
            yaw: 0.,
            scale: 10000.,
            min: [-64., -4., -144.],
            max: [64., 80., 48.],
        };
        let at = crate::components::Transform2D { x: 120., y: 32. };
        for degrees in [-360., -270., -180., -90., 0., 90., 180., 270., 360.] {
            binding.yaw = (degrees as f32).to_radians();
            let (matrix, min, max) = binding.pose_at(at, 0.).unwrap();
            assert!([0., -10000., 10000.].contains(&matrix[0]));
            assert!([0., -10000., 10000.].contains(&matrix[2]));
            assert!([0., -10000., 10000.].contains(&matrix[8]));
            assert!([0., -10000., 10000.].contains(&matrix[10]));
            let x_extent = max[0] - min[0];
            assert!(x_extent == 1280000. || x_extent == 1920000.);
        }
        binding.yaw = std::f32::consts::FRAC_PI_2.next_up();
        assert_ne!(binding.pose_at(at, 0.).unwrap().0[0], 0.);
    }
}
