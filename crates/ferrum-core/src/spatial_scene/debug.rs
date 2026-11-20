//! Optional native geometry only; uses the scene's existing 11-float vertex layout.
use super::{add, scale, Point, SpatialCamera, SpatialVertex, Surface};
use crate::collision::PhysicsDebugLine;
use crate::components::{HeightSpan, Transform2D};
use crate::entity::Entity;
use crate::physics::KinematicDebugHit;
mod physics;
mod sun_coverage;

pub(crate) const MAX_DEBUG_VERTICES: usize = 32_768;
const TERRAIN: u32 = 1;
const BILLBOARDS: u32 = 2;
const HEIGHT_SPANS: u32 = 4;
const DEPTH_TEST: u32 = 8;
const COLLIDERS: u32 = 16;
const CONTACTS: u32 = 32;
const FLOOR_IDS: u32 = 64;
const SUN_SHADOW_COVERAGE: u32 = 128;
// Output-only marker. It enables the existing XYZ packet without pretending
// that a configured collider/terrain category or depth preference changed.
const NATIVE_PHYSICS: u32 = 256;
const CYAN: [f32; 4] = [0.0, 1.0, 1.0, 1.0];
const YELLOW: [f32; 4] = [1.0, 1.0, 0.0, 1.0];
const MAGENTA: [f32; 4] = [1.0, 0.0, 1.0, 1.0];

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct SpatialDebugGeometry {
    flags: u32,
    pub frame_flags: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub vertices: Vec<SpatialVertex>,
    pub truncated: bool,
    #[serde(with = "crate::checkpoint_codec::vector")]
    shape_lines: Vec<PhysicsDebugLine>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    contacts: Vec<KinematicDebugHit>,
    contact_pose: Option<(Entity, Transform2D, HeightSpan)>,
    contacts_truncated: bool,
}
impl SpatialDebugGeometry {
    pub fn configure(&mut self, flags: u32) -> bool {
        if flags & !255 != 0 {
            return false;
        }
        // A cube/plane cut has at most six sides: two outlines need at most 24 vertices.
        let reserve = if flags & !DEPTH_TEST == SUN_SHADOW_COVERAGE {
            24
        } else {
            MAX_DEBUG_VERTICES
        };
        if flags != 0 && self.vertices.capacity() < reserve {
            self.vertices.reserve(reserve - self.vertices.len());
        }
        self.flags = flags;
        if flags & (COLLIDERS | FLOOR_IDS) != 0 && self.shape_lines.capacity() < 33 {
            self.shape_lines.reserve(33);
        }
        if flags & CONTACTS != 0 && self.contacts.capacity() < 128 {
            self.contacts.reserve(128);
        }
        self.contacts.clear();
        self.contact_pose = None;
        self.contacts_truncated = false;
        self.clear_frame();
        true
    }
    pub fn reset(&mut self) {
        self.flags = 0;
        self.contacts.clear();
        self.contact_pose = None;
        self.contacts_truncated = false;
        self.clear_frame();
    }
    pub fn clear_frame(&mut self) {
        self.vertices.clear();
        self.frame_flags = 0;
        self.truncated = false;
    }
    pub fn begin_frame(&mut self) {
        self.frame_flags = self.flags;
    }
    pub fn depth_test(&self) -> bool {
        self.frame_flags & DEPTH_TEST != 0
    }
    pub(crate) fn native_physics_flags(&self) -> u32 {
        let mut flags = 0;
        if self.frame_flags & COLLIDERS != 0 {
            flags |= crate::collision::PHYSICS_DEBUG_COLLIDERS;
        }
        if self.frame_flags & CONTACTS != 0 {
            flags |= crate::collision::PHYSICS_DEBUG_CONTACTS;
        }
        flags
    }
    pub(crate) fn remaining_native_lines(&mut self) -> u32 {
        if self.vertices.capacity() < MAX_DEBUG_VERTICES {
            self.vertices
                .reserve(MAX_DEBUG_VERTICES - self.vertices.len());
        }
        ((MAX_DEBUG_VERTICES - self.vertices.len()) / 2) as u32
    }
    pub(crate) fn begin_native_physics(&mut self) {
        self.frame_flags |= NATIVE_PHYSICS;
    }
    pub(crate) fn native_line(&mut self, a: Point, b: Point, color: [f32; 4]) -> bool {
        let before = self.vertices.len();
        self.line(a, b, color);
        self.vertices.len() == before + 2
    }
    fn line(&mut self, a: Point, b: Point, color: [f32; 4]) {
        if [a, b].iter().flatten().any(|v| !v.is_finite()) {
            self.truncated = true;
            return;
        }
        if self.vertices.len() + 2 > MAX_DEBUG_VERTICES {
            self.truncated = true;
            return;
        }
        for position in [a, b] {
            self.vertices.push(SpatialVertex {
                position,
                uv: [0.0; 2],
                color,
                texture: 16_777_215.0,
                cutoff: 0.0,
            });
        }
    }
    fn outline(&mut self, points: [Point; 4], color: [f32; 4]) {
        for i in 0..4 {
            self.line(points[i], points[(i + 1) % 4], color);
        }
    }
    fn cross(&mut self, at: Point, right: Point, color: [f32; 4]) {
        self.line(
            add(at, scale(right, -3.0)),
            add(at, scale(right, 3.0)),
            color,
        );
        self.line(add(at, [0.0, -3.0, 0.0]), add(at, [0.0, 3.0, 0.0]), color);
    }
    pub fn surface(&mut self, s: Surface) {
        if self.frame_flags & TERRAIN == 0 {
            return;
        }
        let top = s.top_corners();
        let base = top.map(|p| [p[0], s.base, p[2]]);
        self.outline(top, CYAN);
        self.outline(base, CYAN);
        for i in 0..4 {
            self.line(top[i], base[i], CYAN);
        }
    }
    pub fn billboard(&mut self, vertices: &[SpatialVertex], foot: Point, right: Point) {
        if self.frame_flags & BILLBOARDS == 0 || vertices.len() != 6 {
            return;
        }
        self.outline(
            [
                vertices[0].position,
                vertices[1].position,
                vertices[2].position,
                vertices[5].position,
            ],
            YELLOW,
        );
        self.cross(foot, right, YELLOW);
    }
    /// Native entity-origin height marker; deliberately does not claim collider footprint geometry.
    pub fn height_span(&mut self, at: Transform2D, span: HeightSpan, camera: &SpatialCamera) {
        if self.frame_flags & HEIGHT_SPANS == 0 {
            return;
        }
        let bottom = [at.x, span.elevation, -at.y];
        let top = [at.x, span.top(), -at.y];
        let min = [at.x - 3.0, span.elevation - 3.0, -at.y - 3.0];
        let max = [at.x + 3.0, span.top() + 3.0, -at.y + 3.0];
        if !camera.intersects_bounds(min, max) {
            return;
        }
        self.line(bottom, top, MAGENTA);
        self.cross(bottom, camera.right, MAGENTA);
        self.cross(top, camera.right, MAGENTA);
    }
}

impl SpatialDebugGeometry {
    pub(super) fn validate_file(
        &self,
        world: &crate::world::World,
        b: &mut super::file_admission::Budget,
    ) -> Result<(), super::file_admission::Error> {
        use super::file_admission::{
            entity_history, finite, require, span, vertex, Field, Problem,
        };
        b.work(self.vertices.len())?;
        b.work(self.shape_lines.len())?;
        b.work(self.contacts.len())?;
        b.work(2)?;
        require(
            self.flags & !255 == 0
                && self.frame_flags & !511 == 0
                && self.vertices.len() <= MAX_DEBUG_VERTICES
                && self.vertices.len().is_multiple_of(2)
                && self.contacts.len() <= 128,
            Field::Debug,
            0,
            Problem::Length,
        )?;
        for (i, v) in self.vertices.iter().enumerate() {
            require(
                vertex(v) && v.texture == 16_777_215. && v.cutoff == 0. && v.uv == [0.; 2],
                Field::Debug,
                i,
                Problem::Number,
            )?;
        }
        for (i, v) in self.shape_lines.iter().enumerate() {
            require(
                finite(&[v.x0, v.y0, v.x1, v.y1, v.r, v.g, v.b, v.a]),
                Field::Debug,
                i,
                Problem::Number,
            )?;
        }
        for (i, v) in self.contacts.iter().enumerate() {
            require(
                v.target.is_none_or(|e| entity_history(world, e))
                    && finite(&[v.point.x, v.point.y, v.normal.vx, v.normal.vy])
                    && v.span.is_none_or(span),
                Field::Debug,
                i,
                Problem::Number,
            )?;
        }
        if let Some((e, at, height)) = self.contact_pose {
            require(
                entity_history(world, e) && finite(&[at.x, at.y]) && span(height),
                Field::Debug,
                0,
                Problem::Reference,
            )?;
        }
        Ok(())
    }
}
#[cfg(test)]
impl SpatialDebugGeometry {
    pub(super) fn corrupt_file_fixture(&mut self, case: u32) {
        match case {
            0 => self.flags = 512,
            1 => self.vertices.push(SpatialVertex {
                position: [0.; 3],
                uv: [0.; 2],
                color: [1.; 4],
                texture: 16_777_215.,
                cutoff: 0.,
            }),
            2 => self.contacts.push(KinematicDebugHit {
                target: None,
                point: Transform2D::default(),
                normal: crate::components::Velocity {
                    vx: f32::NAN,
                    vy: 0.,
                },
                span: None,
            }),
            _ => unreachable!(),
        }
    }
}
