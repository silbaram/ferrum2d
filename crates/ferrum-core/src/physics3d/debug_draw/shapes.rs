use super::*;
use rapier3d::parry::{bounding_volume::Aabb, shape::TypedShape};

#[derive(Clone, Copy)]
struct Visit<'a> {
    shape: &'a dyn NativeShape,
    pose: rp::Pose,
}

impl<F: FnMut(DebugLine3d) -> bool> Draw<F> {
    pub(super) fn shape_bounds(&mut self, shape: &dyn NativeShape, pose: rp::Pose) {
        if !self.visit() {
            return;
        }
        // Convex AABB support scans every point. Charge those visits instead of
        // calling a seemingly constant helper whose inner loop evades the cap.
        let bounds = match shape.as_typed_shape() {
            TypedShape::ConvexPolyhedron(poly) => {
                let mut min = rp::Vector::splat(f32::INFINITY);
                let mut max = rp::Vector::splat(f32::NEG_INFINITY);
                if poly.points().is_empty() {
                    self.unsupported();
                    return;
                }
                for point in poly.points() {
                    if !self.visit() {
                        return;
                    }
                    let p = pose * *point;
                    min = min.min(p);
                    max = max.max(p);
                }
                Aabb::new(min, max)
            }
            TypedShape::TriMesh(mesh) => mesh.aabb(&pose),
            TypedShape::Compound(compound) => compound.local_aabb().transform_by(&pose),
            TypedShape::Ball(_)
            | TypedShape::Cuboid(_)
            | TypedShape::Capsule(_)
            | TypedShape::HeightField(_)
            | TypedShape::Triangle(_)
            | TypedShape::Segment(_) => shape.compute_aabb(&pose),
            _ => {
                self.unsupported();
                return;
            }
        };
        self.box_edges(bounds.mins, bounds.maxs, rp::Pose::IDENTITY, BOUNDS);
    }

    pub(super) fn shape(&mut self, shape: &dyn NativeShape, pose: rp::Pose, color: [f32; 4]) {
        // Borrowed local work items avoid both recursive native compound walks
        // and self-referential persistent scratch. Legal public compounds have
        // at most64 leaf parts; unexpected wider/deeper trees remain bounded.
        let mut stack = [None; 64];
        stack[0] = Some(Visit { shape, pose });
        let mut len = 1;
        while len != 0 {
            len -= 1;
            let Some(Visit { shape, pose }) = stack[len].take() else {
                continue;
            };
            if !self.visit() {
                return;
            }
            match shape.as_typed_shape() {
                TypedShape::Ball(ball) => {
                    let center = pose.translation;
                    for [u, v] in [
                        [rp::Vector::X, rp::Vector::Y],
                        [rp::Vector::X, rp::Vector::Z],
                        [rp::Vector::Y, rp::Vector::Z],
                    ] {
                        self.ring(center, u, v, ball.radius, color);
                        if self.stopped {
                            return;
                        }
                    }
                }
                TypedShape::Cuboid(cube) => {
                    self.box_edges(-cube.half_extents, cube.half_extents, pose, color)
                }
                TypedShape::Capsule(capsule) => {
                    let a = pose * capsule.segment.a;
                    let b = pose * capsule.segment.b;
                    self.capsule(a, b, capsule.radius, color);
                }
                TypedShape::ConvexPolyhedron(poly) => {
                    // edges() also retains deleted coplanar triangulation and
                    // optimization history. Walk active face adjacency and let
                    // the first incident face own the shared rendered edge.
                    for (face_id, face) in poly.faces().iter().enumerate() {
                        if !self.visit() {
                            return;
                        }
                        let start = face.first_vertex_or_edge as usize;
                        let Some(end) = start.checked_add(face.num_vertices_or_edges as usize)
                        else {
                            self.unsupported();
                            break;
                        };
                        let Some(edges) = poly.edges_adj_to_face().get(start..end) else {
                            self.unsupported();
                            break;
                        };
                        for edge_id in edges {
                            if !self.visit() {
                                return;
                            }
                            let Some(edge) = poly.edges().get(*edge_id as usize) else {
                                self.unsupported();
                                break;
                            };
                            if edge.faces[0] as usize != face_id {
                                continue;
                            }
                            let Some(a) = poly.points().get(edge.vertices[0] as usize) else {
                                self.unsupported();
                                break;
                            };
                            let Some(b) = poly.points().get(edge.vertices[1] as usize) else {
                                self.unsupported();
                                break;
                            };
                            if !self.line(pose * *a, pose * *b, color) {
                                return;
                            }
                        }
                    }
                }
                TypedShape::TriMesh(mesh) => {
                    for triangle in mesh.indices() {
                        if !self.visit() {
                            return;
                        }
                        let Some(a) = mesh.vertices().get(triangle[0] as usize) else {
                            self.unsupported();
                            break;
                        };
                        let Some(b) = mesh.vertices().get(triangle[1] as usize) else {
                            self.unsupported();
                            break;
                        };
                        let Some(c) = mesh.vertices().get(triangle[2] as usize) else {
                            self.unsupported();
                            break;
                        };
                        self.triangle(pose * *a, pose * *b, pose * *c, color);
                        if self.stopped {
                            return;
                        }
                    }
                }
                TypedShape::HeightField(field) => {
                    let (rows, columns) = field.num_cells_ij();
                    for row in 0..rows {
                        for column in 0..columns {
                            // Empty/removed cells consume work too. The public
                            // triangles iterator skips holes internally.
                            if !self.visit() {
                                return;
                            }
                            let (a, b) = field.triangles_at(row, column);
                            for triangle in [a, b].into_iter().flatten() {
                                if !self.visit() {
                                    return;
                                }
                                self.triangle(
                                    pose * triangle.a,
                                    pose * triangle.b,
                                    pose * triangle.c,
                                    color,
                                );
                                if self.stopped {
                                    return;
                                }
                            }
                        }
                    }
                }
                TypedShape::Compound(compound) => {
                    for (local, child) in compound.shapes().iter().rev() {
                        if !self.visit() {
                            return;
                        }
                        if len == stack.len() {
                            self.stop();
                            return;
                        }
                        stack[len] = Some(Visit {
                            shape: child.as_ref(),
                            pose: pose * *local,
                        });
                        len += 1;
                    }
                }
                TypedShape::Triangle(triangle) => self.triangle(
                    pose * triangle.a,
                    pose * triangle.b,
                    pose * triangle.c,
                    color,
                ),
                TypedShape::Segment(segment) => {
                    self.line(pose * segment.a, pose * segment.b, color);
                }
                _ => self.unsupported(),
            }
            if self.stopped {
                return;
            }
        }
    }

    fn triangle(&mut self, a: rp::Vector, b: rp::Vector, c: rp::Vector, color: [f32; 4]) {
        if self.line(a, b, color) && self.line(b, c, color) {
            self.line(c, a, color);
        }
    }

    fn capsule(&mut self, a: rp::Vector, b: rp::Vector, radius: f32, color: [f32; 4]) {
        let axis = (b - a).normalize_or_zero();
        let axis = if axis == rp::Vector::ZERO {
            rp::Vector::Y
        } else {
            axis
        };
        let seed = if axis.y.abs() < 0.9 {
            rp::Vector::Y
        } else {
            rp::Vector::X
        };
        let u = axis.cross(seed).normalize_or_zero();
        let v = axis.cross(u);
        self.ring(a, u, v, radius, color);
        self.ring(b, u, v, radius, color);
        for tangent in [u, -u, v, -v] {
            if !self.line(a + tangent * radius, b + tangent * radius, color) {
                return;
            }
        }
        for tangent in [u, v] {
            for (center, direction) in [(a, -axis), (b, axis)] {
                for i in 0..SEGMENTS / 2 {
                    let start = i as f32 * std::f32::consts::TAU / SEGMENTS as f32;
                    let end = (i + 1) as f32 * std::f32::consts::TAU / SEGMENTS as f32;
                    if !self.line(
                        center + (tangent * start.cos() + direction * start.sin()) * radius,
                        center + (tangent * end.cos() + direction * end.sin()) * radius,
                        color,
                    ) {
                        return;
                    }
                }
            }
        }
    }
}
