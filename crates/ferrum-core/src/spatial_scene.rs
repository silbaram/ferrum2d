//! Opt-in orthographic/perspective terrain and cylindrical sprite presentation.
use crate::{
    components::{RigidBodyType, Sprite, Transform2D},
    entity::Entity,
    physics::{Hd2dKinematicControllerConfig, PhysicsSystem},
    tilemap::Tilemap,
    world::World,
};
use std::collections::{BTreeMap, BTreeSet};
mod attachments;
pub(crate) use attachments::{AttachmentPose, SpatialAttachments};
mod connections;
mod environment;
mod model_streaming;
mod models;
pub(crate) use models::preflight_model_poses;
mod shadows;
pub(crate) use environment::{SpatialEnvironment, MAX_SHADOW_CASTERS};
mod navigation;
pub(crate) use navigation::{
    CombatCrowd, CombatNavigationRequest, CombatRouteKey, CombatVelocityRequest, SharedCombatRoute,
    SpatialMoveStatus, SpatialNavigation,
};
mod debug;
use connections::{ConnectionMove, SurfaceConnection};
pub(crate) use debug::SpatialDebugGeometry;

pub(crate) type Point = [f32; 3];
pub(crate) fn add(a: Point, b: Point) -> Point {
    std::array::from_fn(|i| a[i] + b[i])
}
pub(crate) fn sub(a: Point, b: Point) -> Point {
    std::array::from_fn(|i| a[i] - b[i])
}
pub(crate) fn scale(a: Point, s: f32) -> Point {
    a.map(|v| v * s)
}
pub(crate) fn dot(a: Point, b: Point) -> f32 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
pub(crate) fn cross(a: Point, b: Point) -> Point {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn unit(a: Point) -> Option<Point> {
    let n = dot(a, a).sqrt();
    (n.is_finite() && n > 1e-5).then(|| scale(a, 1.0 / n))
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct SpatialCamera {
    pub parameters: [f32; 12],
    pub matrix: [f32; 16],
    pub right: Point,
    up: Point,
    forward: Point,
    frustum: [[f64; 4]; 6],
    clip_magnitudes: [[f64; 4]; 3],
}
impl SpatialCamera {
    /// Match the local billboard +X axis to projected ground velocity, including perspective foreshortening.
    pub(crate) fn billboard_velocity_rotation(
        &self,
        at: Transform2D,
        elevation: f32,
        velocity: crate::components::Velocity,
    ) -> f32 {
        if velocity.vx == 0. && velocity.vy == 0. {
            return 0.;
        }
        let base = [f64::from(at.x), f64::from(elevation), -f64::from(at.y)];
        let clip: [f64; 4] = std::array::from_fn(|r| {
            (0..3)
                .map(|i| f64::from(self.matrix[i * 4 + r]) * base[i])
                .sum::<f64>()
                + f64::from(self.matrix[12 + r])
        });
        if clip[3].abs() < f64::MIN_POSITIVE {
            return 0.;
        }
        let derivative = |v: [f64; 3]| -> [f64; 2] {
            let d: [f64; 4] = std::array::from_fn(|r| {
                (0..3)
                    .map(|i| f64::from(self.matrix[i * 4 + r]) * v[i])
                    .sum()
            });
            [
                d[0] * clip[3] - clip[0] * d[3],
                d[1] * clip[3] - clip[1] * d[3],
            ]
        };
        let right = unit([self.right[0], 0., self.right[2]]).unwrap_or([1., 0., 0.]);
        let r = derivative(right.map(f64::from));
        let u = derivative([0., 1., 0.]);
        let d = derivative([f64::from(velocity.vx), 0., -f64::from(velocity.vy)]);
        let determinant = r[0] * u[1] - r[1] * u[0];
        if determinant == 0. || !determinant.is_finite() {
            return 0.;
        }
        let x = (d[0] * u[1] - d[1] * u[0]) / determinant;
        let y = (r[0] * d[1] - r[1] * d[0]) / determinant;
        if !x.is_finite() || !y.is_finite() || x == 0. && y == 0. {
            0.
        } else {
            y.atan2(x) as f32
        }
    }

    pub fn new(v: &[f32]) -> Option<Self> {
        if v.len() != 12
            || v.iter().any(|v| !v.is_finite())
            || ![0.0, 1.0].contains(&v[0])
            || v[7] <= 0.0
            || v[8] <= 0.0
            || v[9] <= v[8]
            || v[10] <= 0.0
            || v[11] <= 0.0
            || (v[0] == 1.0 && v[7] >= 3.13)
        {
            return None;
        }
        let eye = [v[1], v[2], v[3]];
        let target = [v[4], v[5], v[6]];
        let forward = unit(sub(target, eye))?;
        let right = unit(cross(forward, [0.0, 1.0, 0.0]))?;
        let up = cross(right, forward);
        let aspect = v[10] / v[11];
        let view = [
            right[0],
            up[0],
            -forward[0],
            0.0,
            right[1],
            up[1],
            -forward[1],
            0.0,
            right[2],
            up[2],
            -forward[2],
            0.0,
            -dot(right, eye),
            -dot(up, eye),
            dot(forward, eye),
            1.0,
        ];
        let mut projection = [0.0; 16];
        let near = v[8];
        let far = v[9];
        if v[0] == 0.0 {
            projection[0] = 2.0 / (v[7] * aspect);
            projection[5] = 2.0 / v[7];
            projection[10] = -2.0 / (far - near);
            projection[14] = -(far + near) / (far - near);
            projection[15] = 1.0;
        } else {
            let f = 1.0 / (v[7] * 0.5).tan();
            projection[0] = f / aspect;
            projection[5] = f;
            projection[10] = -(far + near) / (far - near);
            projection[11] = -1.0;
            projection[14] = -2.0 * far * near / (far - near);
        }
        let matrix: [f32; 16] = std::array::from_fn(|i| {
            let r = i % 4;
            let c = i / 4;
            (0..4)
                .map(|k| projection[k * 4 + r] * view[c * 4 + k])
                .sum()
        });
        if matrix.iter().any(|v: &f32| !v.is_finite()) {
            return None;
        }
        Some(Self {
            parameters: v.try_into().ok()?,
            matrix,
            right,
            up,
            forward,
            frustum: std::array::from_fn(|plane| {
                let axis = plane / 2;
                let sign = if plane % 2 == 0 { 1.0 } else { -1.0 };
                std::array::from_fn(|column| {
                    f64::from(matrix[column * 4 + 3]) + sign * f64::from(matrix[column * 4 + axis])
                })
            }),
            // GPU computes clip.w and clip[axis] separately. Keep their pre-cancellation magnitudes.
            clip_magnitudes: std::array::from_fn(|axis| {
                std::array::from_fn(|column| {
                    f64::from(matrix[column * 4 + 3]).abs()
                        + f64::from(matrix[column * 4 + axis]).abs()
                })
            }),
        })
    }
    /// Conservative AABB/clip-plane test, including geometry crossing the near or eye plane.
    fn intersects_bounds(&self, min: Point, max: Point) -> bool {
        self.frustum.iter().enumerate().all(|(index, plane)| {
            let mut distance = plane[3];
            let weights = self.clip_magnitudes[index / 2];
            let mut magnitude = weights[3];
            for axis in 0..3 {
                let support = if plane[axis] >= 0.0 {
                    max[axis]
                } else {
                    min[axis]
                };
                let term = plane[axis] * f64::from(support);
                distance += term;
                magnitude += weights[axis] * f64::from(min[axis].abs().max(max[axis].abs()));
            }
            // Keep boundary geometry despite f32 GPU transform rounding; f64 avoids CPU overflow.
            distance >= -16.0 * f64::from(f32::EPSILON) * magnitude.max(1.0)
        })
    }
    pub fn ray(&self, x: f32, y: f32) -> (Point, Point) {
        let v = self.parameters;
        let eye = [v[1], v[2], v[3]];
        let aspect = v[10] / v[11];
        if v[0] == 0.0 {
            let origin = add(
                add(eye, scale(self.right, x * v[7] * aspect * 0.5)),
                scale(self.up, y * v[7] * 0.5),
            );
            (add(origin, scale(self.forward, v[8])), self.forward)
        } else {
            let t = (v[7] * 0.5).tan();
            let dir = unit(add(
                add(self.forward, scale(self.right, x * t * aspect)),
                scale(self.up, y * t),
            ))
            .unwrap_or(self.forward);
            (add(eye, scale(dir, v[8] / dot(dir, self.forward))), dir)
        }
    }
}

/// World XYZ, atlas UV, straight RGBA, texture ID, alpha cutoff; 11 f32 values.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct SpatialVertex {
    pub position: Point,
    pub uv: [f32; 2],
    pub color: [f32; 4],
    pub texture: f32,
    pub cutoff: f32,
}
const _: () = assert!(std::mem::size_of::<SpatialVertex>() == 44);
/// Vertex ranges into the unchanged static terrain buffer; ABI v2, two u32 values.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SpatialTerrainDrawRange {
    pub first_vertex: u32,
    pub vertex_count: u32,
}
const _: () = assert!(std::mem::size_of::<SpatialTerrainDrawRange>() == 8);
pub(crate) const SURFACE_PROXY_FLAG: u32 = 16;
pub(crate) const SURFACE_RAMP_X_FLAG: u32 = 32;

#[derive(Clone, Copy, Debug)]
pub(crate) struct Surface {
    pub id: u32,
    pub floor: u32,
    pub bounds: [f32; 4],
    pub base: f32,
    pub heights: [f32; 2],
    pub ramp_x: bool,
    pub color: [f32; 4],
    pub texture: u32,
    pub kind: u32,
    pub walkable: bool,
    pub is_rendered: bool,
}
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SpatialMaterial {
    pub normal_texture: u32,
    pub flags: u32,
}
const _: () = assert!(std::mem::size_of::<SpatialMaterial>() == 8);
impl Default for SpatialMaterial {
    fn default() -> Self {
        Self {
            normal_texture: 16_777_215,
            flags: 3,
        }
    }
}
#[derive(Clone, Copy)]
pub(crate) struct Billboard {
    pub material: SpatialMaterial,
    pub units_per_pixel: f32,
    pub cutoff: f32,
    pub elevation: f32,
}

#[derive(Default)]
pub(crate) struct SpatialScene {
    /// Disposable authoring presentation; never participates in simulation or checkpoints.
    pub preview_hidden_entities: BTreeSet<(u32, u32)>,
    pub preview_hidden_surfaces: BTreeSet<u32>,
    pub attachments: attachments::SpatialAttachments,
    pub models: models::SpatialModels,
    pub environment: SpatialEnvironment,
    pub light_bindings: [Option<(Entity, f32)>; 16],
    pub shadow_casters: Vec<[SpatialVertex; 6]>,
    previous_shadow_casters: Vec<[SpatialVertex; 6]>,
    pub shadow_revision: u32,
    pub shadow_draw_ranges: Vec<shadows::ShadowDrawRange>,
    shadow_quad_scratch: Vec<SpatialVertex>,
    pub camera: Option<SpatialCamera>,
    pub surfaces: Vec<Surface>,
    pub terrain: Vec<SpatialVertex>,
    pub terrain_materials: Vec<SpatialMaterial>,
    pub billboard_materials: Vec<SpatialMaterial>,
    pub terrain_draw_ranges: Vec<SpatialTerrainDrawRange>,
    pub billboards: Vec<SpatialVertex>,
    pub debug: SpatialDebugGeometry,
    pub bindings: BTreeMap<(u32, u32), Billboard>,
    // Ephemeral native gameplay visuals never mutate authored revisions/save identity.
    pub runtime_billboards: Vec<(Entity, Billboard)>,
    /// Disposable render orientation; sorted full-generation keys, at most512 owned projectiles.
    pub runtime_sprite_rotations: Vec<(Entity, f32)>,
    pub frame_camera: [f32; 28],
    pub presentation: [f32; 6],
    pub frame_active: bool,
    pub revision: u32,
    pub physics: Tilemap,
    movement_scratch: crate::physics::KinematicSweepScratch,
    pub actor: Option<(Entity, f32, f32, f32)>,
    connections: Vec<SurfaceConnection>,
    pub navigation: SpatialNavigation,
    pub navigation_revision: u32,
}
impl SpatialScene {
    pub(crate) fn runtime_sprite_rotation(&self, entity: Entity) -> f32 {
        self.runtime_sprite_rotations
            .binary_search_by_key(&(entity.id, entity.generation), |(e, _)| {
                (e.id, e.generation)
            })
            .ok()
            .map_or(0., |i| self.runtime_sprite_rotations[i].1)
    }

    pub fn clear(&mut self) {
        self.preview_hidden_entities.clear();
        self.preview_hidden_surfaces.clear();
        self.attachments = Default::default();
        self.models = Default::default();
        self.environment = SpatialEnvironment::default();
        self.light_bindings.fill(None);
        self.shadow_casters.clear();
        self.previous_shadow_casters.clear();
        self.shadow_draw_ranges.clear();
        self.shadow_revision = self.shadow_revision.wrapping_add(1);
        self.shadow_quad_scratch.clear();
        self.camera = None;
        self.surfaces.clear();
        self.terrain.clear();
        self.terrain_materials.clear();
        self.billboard_materials.clear();
        self.terrain_draw_ranges.clear();
        self.billboards.clear();
        self.debug.reset();
        self.bindings.clear();
        self.runtime_billboards.clear();
        self.runtime_sprite_rotations.clear();
        self.physics.clear();
        self.actor = None;
        self.connections.clear();
        self.navigation = SpatialNavigation::default();
        self.navigation_revision = self.navigation_revision.wrapping_add(1);
        self.frame_active = false;
        self.revision = self.revision.wrapping_add(1);
    }
    pub fn configure_surfaces(&mut self, floats: &[f32], integers: &[u32]) -> bool {
        if !floats.len().is_multiple_of(11)
            || integers.len() != floats.len() / 11 * 4
            || integers.len() > 256 * 4
        {
            return false;
        }
        let mut surfaces = Vec::new();
        let mut mesh = Vec::new();
        let mut physics = Tilemap::with_half_open_hd2d_surfaces();
        for (index, (v, n)) in floats
            .chunks_exact(11)
            .zip(integers.chunks_exact(4))
            .enumerate()
        {
            let surface_flags = n[3] & !(SURFACE_PROXY_FLAG | SURFACE_RAMP_X_FLAG);
            if v.iter().any(|v| !v.is_finite())
                || v[2] <= 0.0
                || v[3] <= 0.0
                || v[0] + v[2] <= v[0]
                || v[1] + v[3] <= v[1]
                || v[4] > v[5].min(v[6])
                || v[7..11].iter().any(|c| !(0.0..=1.0).contains(c))
                || n[0] == 0
                || n[0] > 65535
                || n[1] > 65535
                || n[2] > 16_777_215
                || surface_flags > 9
                || ![0, 1, 2, 4].contains(&(surface_flags >> 1))
                || ((surface_flags >> 1) != 2 && (v[5] != v[6] || n[3] & SURFACE_RAMP_X_FLAG != 0))
                || (n[3] & SURFACE_PROXY_FLAG != 0 && n[2] != 16_777_215)
                || ![v[0] + v[2], v[1] + v[3]].iter().all(|v| v.is_finite())
            {
                return false;
            }
            let surface = Surface {
                id: n[0],
                floor: n[1],
                bounds: [v[0], v[1], v[2], v[3]],
                base: v[4],
                heights: [v[5], v[6]],
                ramp_x: n[3] & SURFACE_RAMP_X_FLAG != 0,
                color: v[7..11].try_into().unwrap_or([1.0; 4]),
                texture: n[2],
                kind: surface_flags >> 1,
                walkable: surface_flags & 1 != 0,
                is_rendered: n[3] & SURFACE_PROXY_FLAG == 0,
            };
            if surfaces.iter().any(|s: &Surface| {
                s.id == surface.id
                    || (s.floor == surface.floor && rectangles_overlap(s.bounds, surface.bounds))
            }) {
                return false;
            }
            let tile = (index + 1) as u32;
            physics.set_tile_definition(tile, 0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
            if !physics.set_tile_height_span_definition(
                tile,
                surface.floor,
                if surface.walkable {
                    surface.heights[0]
                } else {
                    surface.base
                },
                if surface.walkable {
                    0.0
                } else {
                    surface.heights[0].max(surface.heights[1]) - surface.base
                },
            ) || !physics.set_tile_hd2d_definition(
                tile,
                surface.kind,
                !surface.walkable,
                true,
                true,
                surface.heights[0] - surface.base,
                surface.kind == 2,
                u32::from(!surface.ramp_x),
                surface.heights[0],
                surface.heights[1],
            ) {
                return false;
            }
            physics.set_layer(index as u32, 1, 1, v[2], v[3], v[0], v[1], true, vec![tile]);
            append_surface(&mut mesh, surface);
            surfaces.push(surface);
        }
        self.terrain_draw_ranges = Vec::with_capacity(surfaces.len());
        self.navigation.cancel();
        self.connections.clear();
        self.terrain_materials = surfaces
            .iter()
            .map(|s| SpatialMaterial {
                flags: if s.is_rendered { 3 } else { 0 },
                ..SpatialMaterial::default()
            })
            .collect();
        self.navigation_revision = self.navigation_revision.wrapping_add(1);
        self.surfaces = surfaces;
        self.terrain = mesh;
        self.physics = physics;
        self.revision = self.revision.wrapping_add(1);
        true
    }
    /// Computes the displayed camera without borrowing a previous rendered frame.
    pub(crate) fn presented_camera(&self, viewport: [f32; 2]) -> Option<(SpatialCamera, [f32; 6])> {
        let mut camera = self.camera?;
        if viewport != [camera.parameters[10], camera.parameters[11]] {
            let mut values = camera.parameters;
            values[10] = viewport[0];
            values[11] = viewport[1];
            camera = SpatialCamera::new(&values)?;
        }
        let mut presentation = [0., 0., 1., 1., 0., 0.];
        if let Some(values) = self.environment.values.filter(|v| v[0] as u32 & 16 != 0) {
            let [width, height] = [values[80], values[81]];
            let mut p = camera.parameters;
            let fit = (p[10] / width).min(p[11] / height);
            let pixel_scale = if fit >= 1. { fit.floor() } else { fit };
            let w = width * pixel_scale;
            let h = height * pixel_scale;
            presentation = [
                (1. - w / p[10]) * 0.5,
                (1. - h / p[11]) * 0.5,
                w / p[10],
                h / p[11],
                width,
                height,
            ];
            p[10] = w;
            p[11] = h;
            if p[0] == 0. && values[82] == 1. {
                let unit = p[7] / height;
                let eye = [p[1], p[2], p[3]];
                let dx = ((dot(eye, camera.right) / unit).round() * unit) - dot(eye, camera.right);
                let dy = ((dot(eye, camera.up) / unit).round() * unit) - dot(eye, camera.up);
                let offset = add(scale(camera.right, dx), scale(camera.up, dy));
                for axis in 0..3 {
                    p[1 + axis] += offset[axis];
                    p[4 + axis] += offset[axis];
                }
            }
            if let Some(displayed) = SpatialCamera::new(&p) {
                camera = displayed;
            }
        }
        Some((camera, presentation))
    }

    /// The pointer is in logical canvas pixels; shots remain on a horizontal visual-height plane.
    pub(crate) fn aim_on_plane(
        &self,
        viewport: [f32; 2],
        pointer: [f32; 2],
        height: f32,
    ) -> Option<Transform2D> {
        if pointer
            .iter()
            .chain(viewport.iter())
            .any(|value| !value.is_finite())
            || !height.is_finite()
            || viewport.iter().any(|value| *value <= 0.0)
        {
            return None;
        }
        let (camera, p) = self.presented_camera(viewport)?;
        let u = pointer[0] / viewport[0];
        let v = pointer[1] / viewport[1];
        if u < p[0] || u > p[0] + p[2] || v < p[1] || v > p[1] + p[3] {
            return None;
        }
        let (origin, direction) =
            camera.ray((u - p[0]) / p[2] * 2.0 - 1.0, 1.0 - (v - p[1]) / p[3] * 2.0);
        if direction[1].abs() < 0.000001 {
            return None;
        }
        let time = (height - origin[1]) / direction[1];
        if !time.is_finite() || time < 0.0 {
            return None;
        }
        let hit = add(origin, scale(direction, time));
        let eye = [
            camera.parameters[1],
            camera.parameters[2],
            camera.parameters[3],
        ];
        let depth = dot(sub(hit, eye), camera.forward);
        if hit.iter().any(|value| !value.is_finite())
            || depth < camera.parameters[8]
            || depth > camera.parameters[9]
            || hit[0].abs() > 1_000_000.0
            || hit[2].abs() > 1_000_000.0
        {
            return None;
        }
        Some(Transform2D {
            x: hit[0],
            y: -hit[2],
        })
    }

    pub fn build(&mut self, world: &World) {
        self.runtime_billboards
            .sort_unstable_by_key(|(entity, _)| (entity.id, entity.generation));
        self.shadow_casters.clear();
        self.billboards.clear();
        self.billboard_materials.clear();
        self.debug.clear_frame();
        self.terrain_draw_ranges.clear();
        self.frame_active = self.camera.is_some();
        let Some(base) = self.camera else {
            return;
        };
        let Some((camera, presentation)) =
            self.presented_camera([base.parameters[10], base.parameters[11]])
        else {
            return;
        };
        self.presentation = presentation;
        self.environment.build(
            &camera,
            world,
            &self.light_bindings,
            self.actor.map(|a| {
                (
                    a.0,
                    self.bindings
                        .get(&(a.0.id, a.0.generation))
                        .map_or(0., |b| b.elevation),
                )
            }),
        );
        self.frame_camera[..16].copy_from_slice(&camera.matrix);
        self.frame_camera[16..].copy_from_slice(&camera.parameters);
        self.models.build(
            world,
            &camera,
            &self.environment.shadow_matrices,
            self.environment.values.is_some_and(|v| v[2] >= 0.),
            &self.preview_hidden_entities,
        );
        self.debug.begin_frame();
        for (index, surface) in self.surfaces.iter().enumerate() {
            if self.preview_hidden_surfaces.contains(&surface.id) {
                continue;
            }
            let [x, y, width, depth] = surface.bounds;
            if !camera.intersects_bounds(
                [x, surface.base, -y - depth],
                [x + width, surface.heights[0].max(surface.heights[1]), -y],
            ) {
                continue;
            }
            self.debug.surface(*surface);
            self.debug.surface_floor(*surface, &camera);
            if !surface.is_rendered {
                continue;
            }
            let first_vertex = index as u32 * 36;
            if let Some(previous) = self.terrain_draw_ranges.last_mut() {
                if previous.first_vertex + previous.vertex_count == first_vertex {
                    previous.vertex_count += 36;
                    continue;
                }
            }
            self.terrain_draw_ranges.push(SpatialTerrainDrawRange {
                first_vertex,
                vertex_count: 36,
            });
        }
        for ((id, generation), style) in self
            .bindings
            .iter()
            .map(|(key, style)| (*key, *style))
            .chain(
                self.runtime_billboards
                    .iter()
                    .map(|(e, style)| ((e.id, e.generation), *style)),
            )
        {
            let entity = Entity { id, generation };
            if self.preview_hidden_entities.contains(&(id, generation)) {
                continue;
            }
            if !world.is_current_entity(entity) {
                continue;
            }
            let Some((t, mut s)) = world.renderable_sprite_at_index(id as usize) else {
                continue;
            };
            s.rotation_radians += world.rotation_at_index_or_default(id as usize).radians
                + self.runtime_sprite_rotation(entity);
            let elevation =
                world.height_span(entity).map_or(0.0, |s| s.elevation) + style.elevation;
            let first = self.billboards.len();
            if style.material.flags & 1 != 0
                && self.environment.shadows()
                && self.shadow_casters.len() < MAX_SHADOW_CASTERS
            {
                self.shadow_quad_scratch.clear();
                append_billboard_internal(
                    &mut self.shadow_quad_scratch,
                    &camera,
                    t,
                    s,
                    elevation,
                    style,
                    false,
                );
                if let Ok(q) = self.shadow_quad_scratch.as_slice().try_into() {
                    self.shadow_casters.push(q);
                }
            }
            append_billboard(&mut self.billboards, &camera, t, s, elevation, style);
            if self.billboards.len() > first {
                self.billboard_materials.push(style.material);
            }
            self.debug.billboard(
                &self.billboards[first..],
                [t.x, elevation, -t.y],
                camera.right,
            );
            if let Some(span) = world.height_span(entity) {
                self.debug.height_span(t, span, &camera);
            }
        }
        self.debug.physics(world, &camera);
        self.shadow_casters
            .sort_unstable_by_key(|q| q[0].texture as u32);
        if self.shadow_casters != self.previous_shadow_casters {
            self.shadow_revision = self.shadow_revision.wrapping_add(1);
            self.previous_shadow_casters.clear();
            self.previous_shadow_casters
                .extend_from_slice(&self.shadow_casters);
        }
        self.build_shadow_ranges();
    }
    pub fn shadow_budget_valid(&self, world: &World) -> bool {
        self.shadow_budget_valid_after_removals(world, &std::collections::BTreeSet::new())
    }
    pub fn shadow_budget_valid_after_removals(
        &self,
        world: &World,
        removed: &std::collections::BTreeSet<(u32, u32)>,
    ) -> bool {
        let runtime = self
            .runtime_billboards
            .iter()
            .filter(|(e, style)| {
                style.material.flags & 1 != 0
                    && !removed.contains(&(e.id, e.generation))
                    && world.is_current_entity(*e)
            })
            .filter_map(|(e, _)| world.sprite_at_index(e.id as usize).map(|s| s.texture_id));
        self.shadow_budget_for_runtime(world, removed, self.environment.shadows(), runtime)
    }
    /// Cold restore preflight supplies the future runtime casters, including the saved environment.
    pub fn shadow_budget_for_runtime(
        &self,
        world: &World,
        removed: &std::collections::BTreeSet<(u32, u32)>,
        shadows: bool,
        runtime: impl Iterator<Item = u32>,
    ) -> bool {
        if !shadows {
            return true;
        }
        if self.bindings.len() > MAX_SHADOW_CASTERS {
            return false;
        }
        let mut previous = None;
        let mut runs = 0;
        for (index, surface) in self.surfaces.iter().enumerate() {
            if self.terrain_materials[index].flags & 1 == 0 {
                previous = None;
                continue;
            }
            if previous != Some(surface.texture) {
                runs += 1;
                previous = Some(surface.texture);
            }
        }
        // Fixed scratch keeps both authoring and native spawn admission allocation-free.
        let mut textures = [0; 64];
        let mut texture_count = 0;
        let mut caster_count = 0;
        let authored = self
            .bindings
            .iter()
            .filter(|(key, style)| style.material.flags & 1 != 0 && !removed.contains(key))
            .filter_map(|(&(id, generation), _)| {
                world
                    .sprite_at_index(id as usize)
                    .filter(|_| world.is_current_entity(Entity { id, generation }))
                    .map(|s| s.texture_id)
            });
        for texture in authored.chain(runtime) {
            caster_count += 1;
            if caster_count > MAX_SHADOW_CASTERS {
                return false;
            }
            if !textures[..texture_count].contains(&texture) {
                if runs + texture_count >= textures.len() {
                    return false;
                }
                textures[texture_count] = texture;
                texture_count += 1;
            }
        }
        runs + texture_count <= 64
    }
    /// Stable terrain identity only when the entity origin is on a walkable surface.
    pub fn support_surface_id(
        &self,
        at: Transform2D,
        span: crate::components::HeightSpan,
    ) -> Option<u32> {
        let hit = self.physics.hd2d_surface_at(at, Some(span))?;
        if hit.blocks_movement || (hit.elevation - span.elevation).abs() > 0.001 {
            return None;
        }
        self.surfaces.get(hit.layer_index).map(|surface| surface.id)
    }
    #[allow(clippy::too_many_arguments)]
    pub fn move_body(
        &mut self,
        world: &mut World,
        entity: Entity,
        dx: f32,
        dy: f32,
        max_step: f32,
        max_drop: f32,
        counters: Option<&mut crate::physics::PhysicsCounters>,
    ) -> bool {
        self.move_body_internal(
            world, entity, dx, dy, max_step, max_drop, counters, true, false,
        )
    }
    /// Combat trigger actors share terrain height/sweeps while retaining overlap damage contacts.
    pub(crate) fn move_combat_body(
        &mut self,
        world: &mut World,
        entity: Entity,
        dx: f32,
        dy: f32,
        counters: &mut crate::physics::PhysicsCounters,
    ) -> bool {
        self.move_body_internal(world, entity, dx, dy, 1.0, 1.0, Some(counters), true, true)
    }
    #[allow(clippy::too_many_arguments)]
    fn move_body_internal(
        &mut self,
        world: &mut World,
        entity: Entity,
        dx: f32,
        dy: f32,
        max_step: f32,
        max_drop: f32,
        mut counters: Option<&mut crate::physics::PhysicsCounters>,
        record_contacts: bool,
        combat: bool,
    ) -> bool {
        if !world.is_current_entity(entity)
            || ![dx, dy, max_step, max_drop].iter().all(|v| v.is_finite())
            || max_step < 0.0
            || max_drop < 0.0
            || world.height_span(entity).is_none()
            || !world
                .rigid_body(entity)
                .is_some_and(|b| b.enabled && b.body_type == RigidBodyType::Kinematic)
            || world.compound_collider_count(entity) != 1
            || !world
                .collider(entity)
                .is_some_and(|c| c.enabled && (combat || !c.is_trigger))
        {
            return false;
        }
        let cell = self
            .surfaces
            .iter()
            .fold(f32::INFINITY, |m, s| m.min(s.bounds[2]).min(s.bounds[3]));
        if !cell.is_finite() {
            return false;
        }
        let steps = (dx.abs().max(dy.abs()) / (cell * 0.25)).ceil().max(1.0);
        if steps > 128.0 {
            return false;
        }
        let capture = record_contacts && self.debug.captures_contacts() && (dx != 0. || dy != 0.);
        self.movement_scratch.begin_debug_capture(capture);
        for _ in 0..steps as usize {
            let current = world.transform(entity).unwrap_or_default();
            let center = world
                .collider(entity)
                .map_or(current, |c| c.center(current));
            let target = Transform2D {
                x: center.x + dx / steps,
                y: center.y + dy / steps,
            };
            let start_span = world.height_span(entity);
            // Gateway sweeps test hypothetical source/destination poses, not committed contacts.
            self.movement_scratch.set_debug_capture(false);
            match self.move_connected_body(
                world,
                entity,
                current,
                center,
                target,
                max_step,
                max_drop,
                counters.as_deref_mut(),
                if combat {
                    crate::components::CollisionMask::WALL
                } else {
                    crate::components::CollisionMask::ALL
                },
            ) {
                ConnectionMove::Moved => continue,
                ConnectionMove::Blocked => break,
                ConnectionMove::Unconnected => {}
            }
            self.movement_scratch.set_debug_capture(capture);
            if self.surfaces.iter().any(|s| {
                !s.walkable
                    && world
                        .height_span(entity)
                        .is_some_and(|span| span.floor.0 == s.floor)
                    && target.x >= s.bounds[0]
                    && target.x < s.bounds[0] + s.bounds[2]
                    && target.y >= s.bounds[1]
                    && target.y < s.bounds[1] + s.bounds[3]
            }) {
                break;
            }
            let previous_hits = self.movement_scratch.debug_hits.len();
            let previous_truncated = self.movement_scratch.debug_truncated;
            let result = PhysicsSystem::move_hd2d_kinematic_with_tilemap_and_scratch(
                world,
                &self.physics,
                entity,
                crate::components::Velocity {
                    vx: dx / steps,
                    vy: dy / steps,
                },
                Hd2dKinematicControllerConfig::new(
                    if combat {
                        crate::components::CollisionMask::WALL
                    } else {
                        crate::components::CollisionMask::ALL
                    },
                    8,
                )
                .with_step_height(max_step)
                .with_drop_height(max_drop),
                counters.as_deref_mut(),
                &mut self.movement_scratch,
                true,
            );
            if result.blocked_by_step || result.blocked_by_drop {
                self.movement_scratch.debug_hits.truncate(previous_hits);
                self.movement_scratch.debug_truncated = previous_truncated;
            }
            // The generic tile controller can infer stair/ramp floor changes. Spatial scenes require an authored gateway.
            if world.height_span(entity).map(|s| s.floor) != start_span.map(|s| s.floor) {
                self.movement_scratch.debug_hits.truncate(previous_hits);
                self.movement_scratch.debug_truncated = previous_truncated;
                world.set_transform(entity, current);
                if let Some(span) = start_span {
                    world.set_height_span(entity, span);
                }
                break;
            }
        }
        if capture {
            self.debug.capture_contacts(
                world,
                entity,
                &self.movement_scratch.debug_hits,
                self.movement_scratch.debug_truncated,
            );
        }
        self.movement_scratch.set_debug_capture(false);
        world.set_velocity(entity, crate::components::Velocity::default());
        true
    }
    pub fn pick(&self, camera: &SpatialCamera, x: f32, y: f32) -> Vec<f32> {
        let (origin, dir) = camera.ray(x, y);
        let mut closest = f32::INFINITY;
        let mut result = vec![];
        for (surface, vertices) in self.surfaces.iter().zip(self.terrain.chunks_exact(36)) {
            if self.preview_hidden_surfaces.contains(&surface.id) {
                continue;
            }
            for triangle in vertices.chunks_exact(3) {
                if let Some(distance) = ray_triangle(
                    origin,
                    dir,
                    triangle[0].position,
                    triangle[1].position,
                    triangle[2].position,
                ) {
                    let hit = add(origin, scale(dir, distance));
                    let eye = [
                        camera.parameters[1],
                        camera.parameters[2],
                        camera.parameters[3],
                    ];
                    let depth = dot(sub(hit, eye), camera.forward);
                    if distance < closest
                        && depth >= camera.parameters[8]
                        && depth <= camera.parameters[9]
                    {
                        closest = distance;
                        let normal = unit(cross(
                            sub(triangle[1].position, triangle[0].position),
                            sub(triangle[2].position, triangle[0].position),
                        ))
                        .unwrap_or([0.0, 1.0, 0.0]);
                        result = vec![
                            surface.id as f32,
                            surface.floor as f32,
                            hit[0],
                            -hit[2],
                            hit[1],
                            normal[0],
                            normal[1],
                            normal[2],
                            distance,
                            if surface.walkable && normal[1] > 0.5 {
                                1.0
                            } else {
                                0.0
                            },
                        ];
                    }
                }
            }
        }
        result
    }
}
fn rectangles_overlap(a: [f32; 4], b: [f32; 4]) -> bool {
    a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]
}
fn quad(
    out: &mut Vec<SpatialVertex>,
    points: [Point; 4],
    uv: [f32; 4],
    color: [f32; 4],
    texture: u32,
    cutoff: f32,
) {
    let uvs = [
        [uv[0], uv[1]],
        [uv[2], uv[1]],
        [uv[2], uv[3]],
        [uv[0], uv[3]],
    ];
    for i in [0, 1, 2, 0, 2, 3] {
        out.push(SpatialVertex {
            position: points[i],
            uv: uvs[i],
            color,
            texture: texture as f32,
            cutoff,
        });
    }
}
impl Surface {
    fn top_corners(self) -> [Point; 4] {
        let [x, y, w, d] = self.bounds;
        let [a, b] = self.heights;
        let h = if self.ramp_x {
            [a, b, b, a]
        } else {
            [a, a, b, b]
        };
        [
            [x, h[0], -y],
            [x + w, h[1], -y],
            [x + w, h[2], -y - d],
            [x, h[3], -y - d],
        ]
    }
}
fn append_surface(out: &mut Vec<SpatialVertex>, s: Surface) {
    let [x, y, w, d] = s.bounds;
    let p = s.top_corners();
    quad(out, p, [0.0, 0.0, 1.0, 1.0], s.color, s.texture, 0.01);
    let sides = std::array::from_fn(|i| {
        [
            s.color[0] * 0.65,
            s.color[1] * 0.65,
            s.color[2] * 0.65,
            s.color[3],
        ][i]
    });
    for i in 0..4 {
        let j = (i + 1) % 4;
        quad(
            out,
            [
                p[j],
                p[i],
                [p[i][0], s.base, p[i][2]],
                [p[j][0], s.base, p[j][2]],
            ],
            [0.0, 0.0, 1.0, 1.0],
            sides,
            s.texture,
            0.01,
        );
    }
    let bottom = if s.base < s.heights[0].max(s.heights[1]) {
        [
            [x, s.base, -y],
            [x, s.base, -y - d],
            [x + w, s.base, -y - d],
            [x + w, s.base, -y],
        ]
    } else {
        [[x, s.base, -y]; 4]
    };
    quad(out, bottom, [0.0, 0.0, 1.0, 1.0], sides, s.texture, 0.01);
}
pub(crate) fn append_billboard(
    out: &mut Vec<SpatialVertex>,
    camera: &SpatialCamera,
    t: Transform2D,
    s: Sprite,
    elevation: f32,
    style: Billboard,
) {
    append_billboard_internal(out, camera, t, s, elevation, style, true);
}
#[allow(clippy::too_many_arguments)]
fn append_billboard_internal(
    out: &mut Vec<SpatialVertex>,
    camera: &SpatialCamera,
    t: Transform2D,
    s: Sprite,
    elevation: f32,
    style: Billboard,
    cull: bool,
) {
    let right = unit([camera.right[0], 0.0, camera.right[2]]).unwrap_or([1.0, 0.0, 0.0]);
    let base = [t.x, elevation, -t.y];
    let size = style.units_per_pixel;
    let mut points = [[0.0; 3]; 4];
    for (index, (u, v)) in [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
        .into_iter()
        .enumerate()
    {
        let x = (u - s.origin_x) * s.width * size;
        let y = (s.origin_y - v) * s.height * size;
        let (sin, cos) = s.rotation_radians.sin_cos();
        points[index] = add(
            add(base, scale(right, x * cos - y * sin)),
            [0.0, x * sin + y * cos, 0.0],
        );
    }
    if points.iter().flatten().any(|v| !v.is_finite()) {
        return;
    }
    let clips: [[f32; 4]; 4] = points.map(|p| {
        std::array::from_fn(|r| {
            camera.matrix[r] * p[0]
                + camera.matrix[4 + r] * p[1]
                + camera.matrix[8 + r] * p[2]
                + camera.matrix[12 + r]
        })
    });
    if cull
        && (0..3).any(|axis| {
            clips.iter().all(|p| p[axis] > p[3]) || clips.iter().all(|p| p[axis] < -p[3])
        })
    {
        return;
    }
    quad(
        out,
        points,
        [s.u0, s.v0, s.u1, s.v1],
        [s.r, s.g, s.b, s.a],
        s.texture_id,
        style.cutoff,
    );
}
fn ray_triangle(origin: Point, dir: Point, a: Point, b: Point, c: Point) -> Option<f32> {
    let e1 = sub(b, a);
    let e2 = sub(c, a);
    let p = cross(dir, e2);
    let det = dot(e1, p);
    if det.abs() < 1e-6 {
        return None;
    }
    let t = sub(origin, a);
    let u = dot(t, p) / det;
    // A shared triangle edge must not become a hole after f64 screen -> f32 ray conversion.
    let edge_epsilon = 8.0 * f32::EPSILON;
    if !(-edge_epsilon..=1.0 + edge_epsilon).contains(&u) {
        return None;
    }
    let q = cross(t, e1);
    let v = dot(dir, q) / det;
    if v < -edge_epsilon || u + v > 1.0 + edge_epsilon {
        return None;
    }
    let distance = dot(e2, q) / det;
    (distance >= 0.0 && distance.is_finite()).then_some(distance)
}
