//! Immutable asset bounds + native entity poses. Geometry/GPU resources belong to the platform.
impl SpatialModels {
    pub(crate) fn file_resource_draws(&self) -> impl ExactSizeIterator<Item = (u32, u32)> + '_ {
        self.draws.iter().map(|d| (d.asset, d.flags))
    }
}

use super::{Point, SpatialCamera, SpatialReceiverMasks};
use crate::{entity::Entity, world::World};
use std::collections::BTreeMap;

mod native_pose;

/// Cold authoring bit only. Render ModelDraw flags remain the existing cast/receive pair.
const SHADOW_ONLY: u32 = 4;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct ModelBinding {
    pub receiver_masks: SpatialReceiverMasks,
    draw_index: Option<usize>,
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
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct ModelDraw {
    asset: u32,
    flags: u32,
    /// Camera0, first point faces1..6, sun7; model ABI v2 adds second point faces8..13.
    mask: u32,
    reserved: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    matrix: [f32; 16],
}
const _: () = assert!(std::mem::size_of::<ModelDraw>() == 80);

#[derive(Default, Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct SpatialModels {
    pub(super) streaming: super::model_streaming::ModelStreaming,
    #[serde(deserialize_with = "crate::spatial_scene::file_admission::ordered::map")]
    pub bindings: BTreeMap<(u32, u32), ModelBinding>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub draws: Vec<ModelDraw>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub receiver_masks: Vec<SpatialReceiverMasks>,
}
impl SpatialModels {
    /// Metadata: entity ID/generation, asset ID, flags, primitive count, triangle count.
    /// Flags: cast=1, receive=2, shadow-only=4. The last bit is not exported in ModelDraw.
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
                || world.sprite_nine_slices[entity.id as usize].is_some()
                || m[2] == 0
                || m[3] > 7
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
                receiver_masks: Default::default(),
                draw_index: None,
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
        self.receiver_masks.clear();
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
        hidden: &std::collections::BTreeSet<(u32, u32)>,
    ) {
        self.build_with_native_poses(world, camera, shadow_matrices, point_shadow, hidden, |_| {
            None
        });
    }

    pub(super) fn build_with_native_poses(
        &mut self,
        world: &World,
        camera: &SpatialCamera,
        shadow_matrices: &[f32],
        point_shadow: bool,
        hidden: &std::collections::BTreeSet<(u32, u32)>,
        native_pose: impl Fn(Entity) -> Option<crate::physics3d::Pose>,
    ) {
        self.draws.clear();
        self.receiver_masks.clear();
        self.streaming.update_chunks(camera);
        for (&(id, generation), binding) in &mut self.bindings {
            binding.draw_index = None;
            if hidden.contains(&(id, generation)) {
                continue;
            }
            let entity = Entity { id, generation };
            if !world.is_current_entity(entity) {
                continue;
            }
            let pose = match native_pose(entity) {
                Some(pose) => binding.pose_at_native(pose),
                None => binding.pose(world, entity),
            };
            let Some((matrix, min, max)) = pose else {
                continue;
            };
            let mut mask =
                u32::from(binding.flags & SHADOW_ONLY == 0 && camera.intersects_bounds(min, max));
            if binding.flags & 1 != 0 {
                for (index, m) in shadow_matrices.chunks_exact(16).enumerate() {
                    if super::shadows::intersects_bounds(m, min, max) {
                        let sun = shadow_matrices.len() / 16 % 6 == 1;
                        let bit =
                            if !point_shadow || (sun && index + 1 == shadow_matrices.len() / 16) {
                                7
                            } else if index >= 6 {
                                index + 2
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
            binding.draw_index = Some(self.draws.len());
            if binding.receiver_masks != SpatialReceiverMasks::default()
                || !self.receiver_masks.is_empty()
            {
                self.receiver_masks
                    .resize(self.draws.len(), SpatialReceiverMasks::default());
                self.receiver_masks.push(binding.receiver_masks);
            }
            self.draws.push(ModelDraw {
                asset,
                flags: binding.flags & 3,
                mask,
                reserved: 0,
                matrix,
            });
        }
    }
    /// Cold owned snapshot of the last rendered LOD/pose, including the camera visibility bit.
    pub fn draw_snapshot(&self, key: (u32, u32)) -> Vec<u32> {
        let Some(draw) = self
            .bindings
            .get(&key)
            .and_then(|binding| binding.draw_index)
            .and_then(|index| self.draws.get(index))
        else {
            return Vec::new();
        };
        let mut words = Vec::with_capacity(20);
        words.extend([draw.asset, draw.flags, draw.mask, draw.reserved]);
        words.extend(draw.matrix.iter().map(|value| value.to_bits()));
        words
    }
}
impl ModelBinding {
    fn pose(&self, world: &World, entity: Entity) -> Option<([f32; 16], Point, Point)> {
        let at = world.render_transform_at_index(entity.id as usize)?;
        self.pose_at_rotation(
            at,
            world
                .render_height_span_at(entity.id as usize)
                .map_or(0., |s| s.elevation),
            world.render_rotation_at_index(entity.id as usize).radians,
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
        let (sin, cos) = yaw_sin_cos(yaw);
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

fn yaw_sin_cos(yaw: f32) -> (f32, f32) {
    use std::f32::consts::{FRAC_PI_2, PI, TAU};
    if yaw == 0. || yaw == TAU || yaw == -TAU {
        (0., 1.)
    } else if yaw == FRAC_PI_2 || yaw == -3. * FRAC_PI_2 {
        (1., 0.)
    } else if yaw == PI || yaw == -PI {
        (0., -1.)
    } else if yaw == -FRAC_PI_2 || yaw == 3. * FRAC_PI_2 {
        (-1., 0.)
    } else {
        yaw.sin_cos()
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
                receiver_masks: Default::default(),
                draw_index: None,
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

impl SpatialModels {
    pub(super) fn validate_file(
        &self,
        world: &World,
        b: &mut super::file_admission::Budget,
    ) -> Result<(), super::file_admission::Error> {
        use super::file_admission::{entity_history, finite, masks, require, Field, Problem};
        b.work(self.bindings.len())?;
        b.work(self.draws.len())?;
        b.work(self.receiver_masks.len())?;
        require(
            self.bindings.len() <= 1024
                && self.draws.len() <= self.bindings.len()
                && (self.receiver_masks.is_empty()
                    || self.receiver_masks.len() == self.draws.len()),
            Field::Model,
            0,
            Problem::Length,
        )?;
        let mut owned = b.vector::<bool>(self.draws.len())?;
        owned.resize(self.draws.len(), false);
        for (i, (&(id, generation), v)) in self.bindings.iter().enumerate() {
            require(
                entity_history(world, Entity { id, generation }),
                Field::Model,
                i,
                Problem::Reference,
            )?;
            require(
                v.asset != 0
                    && v.flags <= 7
                    && finite(&[v.elevation, v.yaw, v.scale])
                    && (0.0001..=10000.).contains(&v.scale)
                    && finite(&v.min)
                    && finite(&v.max)
                    && (0..3).all(|axis| v.min[axis] <= v.max[axis])
                    && masks(v.receiver_masks),
                Field::Model,
                i,
                Problem::Range,
            )?;
            if let Some(index) = v.draw_index {
                require(
                    index < self.draws.len(),
                    Field::Model,
                    i,
                    Problem::Reference,
                )?;
                require(!owned[index], Field::Model, i, Problem::Duplicate)?;
                owned[index] = true;
                require(
                    self.draws[index].flags == v.flags & 3,
                    Field::Model,
                    i,
                    Problem::Cache,
                )?;
                let receiver = self.receiver_masks.get(index).copied().unwrap_or_default();
                require(
                    receiver == v.receiver_masks,
                    Field::Model,
                    i,
                    Problem::Cache,
                )?;
            }
        }
        require(
            owned.iter().all(|v| *v),
            Field::Model,
            0,
            Problem::Reference,
        )?;
        for (i, v) in self.draws.iter().enumerate() {
            require(
                v.asset != 0
                    && v.flags <= 3
                    && v.mask & !0x3fff == 0
                    && v.reserved == 0
                    && finite(&v.matrix)
                    && v.matrix[3] == 0.
                    && v.matrix[7] == 0.
                    && v.matrix[11] == 0.
                    && v.matrix[15] == 1.,
                Field::Model,
                i,
                Problem::Range,
            )?;
        }
        for (i, v) in self.receiver_masks.iter().enumerate() {
            require(masks(*v), Field::Model, i, Problem::Range)?;
        }
        // Streaming can be reconfigured while last-frame draws retain old assets
        // and selected poses. Asset existence/bytes are a host obligation.
        self.streaming.validate_file(&self.bindings, b)
    }
}
#[cfg(test)]
impl SpatialModels {
    pub(super) fn corrupt_file_fixture(&mut self, case: u32) {
        match case {
            0 => self.bindings.values_mut().next().unwrap().scale = 0.,
            1 => self.bindings.values_mut().next().unwrap().draw_index = Some(usize::MAX),
            2 => self.draws[0].reserved = 1,
            3 => self.draws[0].mask |= 1 << 31,
            _ => unreachable!(),
        }
    }
}

#[cfg(test)]
impl SpatialModels {
    pub(super) fn file_collection_packet(&self, packet: &[u8], duplicate: bool) -> Vec<u8> {
        super::file_admission::collection_tests::map_packet(packet, &self.bindings, duplicate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cardinal_model_matrices_match_aabb_proxy_axes_without_snapping_nearby_yaw() {
        let mut binding = ModelBinding {
            receiver_masks: Default::default(),
            draw_index: None,
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
