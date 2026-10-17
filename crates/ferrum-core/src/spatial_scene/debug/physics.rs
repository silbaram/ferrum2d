//! Bounded physics diagnostics. Reads native shapes and captured hits; never runs collision queries.
use super::*;
use crate::collision::{collider_segment_count_at, ColliderKey, CollisionSystem};
use crate::world::World;

const GREEN: [f32; 4] = [0.1, 1., 0.2, 1.];
const ORANGE: [f32; 4] = [1., 0.5, 0., 1.];
const RED: [f32; 4] = [1., 0.1, 0.1, 1.];
const WHITE: [f32; 4] = [1.; 4];
const MAX_ENTITIES: usize = 4096;
const MAX_SHAPES: usize = 2048;

fn active(world: &World, entity: Entity) -> bool {
    world.is_current_entity(entity) && !world.rigid_body(entity).is_some_and(|b| !b.enabled)
}
impl SpatialDebugGeometry {
    pub fn captures_contacts(&self) -> bool {
        self.flags & CONTACTS != 0
    }
    pub fn capture_contacts(
        &mut self,
        world: &World,
        actor: Entity,
        hits: &[KinematicDebugHit],
        truncated: bool,
    ) {
        if !self.captures_contacts() {
            return;
        }
        self.contacts.clear();
        self.contacts
            .extend_from_slice(&hits[..hits.len().min(128)]);
        self.contact_pose = world
            .transform(actor)
            .zip(world.height_span(actor))
            .map(|(at, span)| (actor, at, span));
        self.contacts_truncated = truncated || hits.len() > 128;
    }
    fn contact(
        &mut self,
        at: Transform2D,
        elevation: f32,
        normal: crate::components::Velocity,
        camera: &SpatialCamera,
    ) {
        let p = [at.x, elevation, -at.y];
        if !camera.intersects_bounds(add(p, [-12.; 3]), add(p, [12.; 3])) {
            return;
        }
        self.line(add(p, [-2., 0., 0.]), add(p, [2., 0., 0.]), RED);
        self.line(add(p, [0., 0., -2.]), add(p, [0., 0., 2.]), RED);
        self.line(p, add(p, [normal.vx * 10., 0., -normal.vy * 10.]), RED);
    }
    pub fn physics(&mut self, world: &World, camera: &SpatialCamera) {
        if self.frame_flags & CONTACTS != 0 {
            if self.contact_pose.is_some_and(|(a, at, span)| {
                active(world, a)
                    && world.transform(a) == Some(at)
                    && world.height_span(a) == Some(span)
                    && world
                        .collider(a)
                        .is_some_and(|c| c.enabled && !c.is_trigger)
            }) {
                self.truncated |= self.contacts_truncated;
                for i in 0..self.contacts.len() {
                    let hit = self.contacts[i];
                    if hit.target.is_some_and(|e| !active(world, e)) {
                        continue;
                    }
                    let height = hit.span.map_or(0., |s| s.elevation * 0.5 + s.top() * 0.5);
                    self.contact(hit.point, height, hit.normal, camera);
                }
            }
            for (index, hit) in world.rigid_contact_impulses().take(257).enumerate() {
                if index == 256 {
                    self.truncated = true;
                    break;
                }
                if !active(world, hit.entity_a)
                    || !active(world, hit.entity_b)
                    || !world
                        .height_spans_allow_at(hit.entity_a.id as usize, hit.entity_b.id as usize)
                {
                    continue;
                }
                let a = world.height_span(hit.entity_a);
                let b = world.height_span(hit.entity_b);
                let height = match (a, b) {
                    (Some(a), Some(b)) => {
                        a.elevation.max(b.elevation) * 0.5 + a.top().min(b.top()) * 0.5
                    }
                    (Some(s), None) | (None, Some(s)) => s.elevation * 0.5 + s.top() * 0.5,
                    _ => 0.,
                };
                self.contact(
                    Transform2D {
                        x: hit.point_x,
                        y: hit.point_y,
                    },
                    height,
                    crate::components::Velocity {
                        vx: hit.normal_x,
                        vy: hit.normal_y,
                    },
                    camera,
                );
            }
        }
        if self.frame_flags & (COLLIDERS | FLOOR_IDS) == 0 {
            return;
        }
        self.truncated |= world.alive_indices().len() > MAX_ENTITIES;
        let mut shapes = 0;
        for &index in world.alive_indices().iter().take(MAX_ENTITIES) {
            let Some(entity) = world.entity_at_index(index) else {
                continue;
            };
            let span = world.height_span(entity);
            let bottom = span.map_or(0., |s| s.elevation);
            let top = span.map_or(0., |s| s.top());
            let mut labeled = false;
            for collider_index in 0..world.compound_collider_count_at(index) {
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    if shapes == MAX_SHAPES || self.vertices.len() >= MAX_DEBUG_VERTICES {
                        self.truncated = true;
                        return;
                    }
                    shapes += 1;
                    let Some(bounds) = CollisionSystem::spatial_collider_debug_lines_into(
                        world,
                        ColliderKey {
                            entity_index: index,
                            collider_index,
                            segment_index,
                        },
                        &mut self.shape_lines,
                    ) else {
                        continue;
                    };
                    if !camera.intersects_bounds(
                        [bounds.min_x, bottom, -bounds.max_y],
                        [bounds.max_x, top, -bounds.min_y],
                    ) {
                        continue;
                    }
                    if self.frame_flags & COLLIDERS != 0 {
                        let trigger = world
                            .compound_collider_ref_at(index, collider_index)
                            .is_some_and(|c| c.is_trigger());
                        let color = if trigger { ORANGE } else { GREEN };
                        for i in 0..self.shape_lines.len() {
                            let l = self.shape_lines[i];
                            let a = [l.x0, bottom, -l.y0];
                            let b = [l.x1, bottom, -l.y1];
                            self.line(a, b, color);
                            if top > bottom {
                                self.line([l.x0, top, -l.y0], [l.x1, top, -l.y1], color);
                                self.line(a, [l.x0, top, -l.y0], color);
                            }
                        }
                    }
                    if !labeled && self.frame_flags & FLOOR_IDS != 0 {
                        self.floor_label(
                            [
                                bounds.min_x * 0.5 + bounds.max_x * 0.5,
                                top + 4.,
                                -(bounds.min_y * 0.5 + bounds.max_y * 0.5),
                            ],
                            span.map(|s| s.floor.0),
                            camera,
                        );
                        labeled = true;
                    }
                }
            }
        }
    }
    pub fn surface_floor(&mut self, s: Surface, camera: &SpatialCamera) {
        if self.frame_flags & FLOOR_IDS != 0 {
            self.floor_label(
                [
                    s.bounds[0] + s.bounds[2] * 0.5,
                    s.heights[0] * 0.5 + s.heights[1] * 0.5 + 4.,
                    -s.bounds[1] - s.bounds[3] * 0.5,
                ],
                Some(s.floor),
                camera,
            );
        }
    }
    /// Asset-free seven-segment stroke labels, facing the same camera as the diagnostic geometry.
    fn floor_label(&mut self, at: Point, floor: Option<u32>, camera: &SpatialCamera) {
        const DIGITS: [u8; 10] = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f];
        const SEGMENTS: [[[f32; 2]; 2]; 7] = [
            [[0., 6.], [3., 6.]],
            [[3., 6.], [3., 3.]],
            [[3., 3.], [3., 0.]],
            [[3., 0.], [0., 0.]],
            [[0., 0.], [0., 3.]],
            [[0., 3.], [0., 6.]],
            [[0., 3.], [3., 3.]],
        ];
        let mut glyphs = [0_u8; 11];
        glyphs[0] = 0x71; // F
        let count = if let Some(mut n) = floor {
            let mut digits = [0_u8; 10];
            let mut len = 0;
            loop {
                digits[len] = (n % 10) as u8;
                len += 1;
                n /= 10;
                if n == 0 {
                    break;
                }
            }
            for i in 0..len {
                glyphs[i + 1] = DIGITS[digits[len - 1 - i] as usize];
            }
            len + 1
        } else {
            glyphs[1] = 0x40;
            2
        }; // F-: no heightSpan, collision is not restricted to a floor.
        for (index, &mask) in glyphs[..count].iter().enumerate() {
            for (bit, segment) in SEGMENTS.iter().enumerate() {
                if mask & (1 << bit) == 0 {
                    continue;
                }
                let points = segment.map(|p| {
                    add(
                        at,
                        add(
                            scale(camera.right, p[0] + index as f32 * 4.),
                            scale(camera.up, p[1]),
                        ),
                    )
                });
                self.line(points[0], points[1], WHITE);
            }
        }
    }
}
