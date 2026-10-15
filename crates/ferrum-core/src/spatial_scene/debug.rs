//! Optional native geometry only; uses the scene's existing 11-float vertex layout.
use super::{add, scale, Point, SpatialCamera, SpatialVertex, Surface};
use crate::collision::PhysicsDebugLine;
use crate::components::{HeightSpan, Transform2D};
use crate::entity::Entity;
use crate::physics::KinematicDebugHit;
mod physics;

pub(crate) const MAX_DEBUG_VERTICES: usize = 32_768;
const TERRAIN: u32 = 1;
const BILLBOARDS: u32 = 2;
const HEIGHT_SPANS: u32 = 4;
const DEPTH_TEST: u32 = 8;
const COLLIDERS: u32 = 16;
const CONTACTS: u32 = 32;
const FLOOR_IDS: u32 = 64;
const CYAN: [f32; 4] = [0.0, 1.0, 1.0, 1.0];
const YELLOW: [f32; 4] = [1.0, 1.0, 0.0, 1.0];
const MAGENTA: [f32; 4] = [1.0, 0.0, 1.0, 1.0];

#[derive(Default)]
pub(crate) struct SpatialDebugGeometry {
    flags: u32,
    pub frame_flags: u32,
    pub vertices: Vec<SpatialVertex>,
    pub truncated: bool,
    shape_lines: Vec<PhysicsDebugLine>,
    contacts: Vec<KinematicDebugHit>,
    contact_pose: Option<(Entity, Transform2D, HeightSpan)>,
    contacts_truncated: bool,
}
impl SpatialDebugGeometry {
    pub fn configure(&mut self, flags: u32) -> bool {
        if flags & !127 != 0 || (flags & !DEPTH_TEST == 0 && flags != 0) {
            return false;
        }
        if flags != 0 && self.vertices.capacity() < MAX_DEBUG_VERTICES {
            self.vertices
                .reserve(MAX_DEBUG_VERTICES - self.vertices.len());
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
        let [x, y, w, d] = s.bounds;
        let [a, b] = s.heights;
        let top = [
            [x, a, -y],
            [x + w, a, -y],
            [x + w, b, -y - d],
            [x, b, -y - d],
        ];
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
