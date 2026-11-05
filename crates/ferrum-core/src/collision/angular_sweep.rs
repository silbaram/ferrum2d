use super::broadphase::swept_collider_bounds;
use super::convex_contact::convex_contact_geometry_project;
use super::*;

const MAX_ADVANCES: usize = 64;

#[derive(Clone, Copy, Debug)]
pub(crate) enum AngularSweepResult {
    Contact(SweptShapeContactHit),
    BudgetLimit(SweptShapeContactHit),
}

#[derive(Clone, Copy)]
pub(crate) struct ShapeMotion {
    pub(crate) start: Transform2D,
    pub(crate) shape: ColliderShapeRef,
    pub(crate) velocity: Velocity,
    pub(crate) angular_velocity: f32,
}

pub(crate) fn shape_angular_velocity(world: &World, index: usize, shape: ColliderShapeRef) -> f32 {
    if !matches!(
        shape,
        ColliderShapeRef::OrientedBox(..) | ColliderShapeRef::ConvexPolygon(..)
    ) {
        return 0.0;
    }
    let value = world
        .angular_velocity_at_index_or_default(index)
        .radians_per_second;
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

pub(crate) fn rotated_shape(shape: ColliderShapeRef, angle: f32) -> ColliderShapeRef {
    match shape {
        ColliderShapeRef::OrientedBox(c, r) => ColliderShapeRef::OrientedBox(c, r + angle),
        ColliderShapeRef::ConvexPolygon(c, r) => ColliderShapeRef::ConvexPolygon(c, r + angle),
        _ => shape,
    }
}

fn rotation_radius(shape: ColliderShapeRef) -> f32 {
    match shape {
        ColliderShapeRef::OrientedBox(c, _) => c.half_width.hypot(c.half_height),
        ColliderShapeRef::ConvexPolygon(c, _) => c
            .vertices
            .iter()
            .take(c.vertex_count as usize)
            .map(|p| p.x.hypot(p.y))
            .fold(0.0_f32, f32::max),
        _ => 0.0,
    }
}

fn radius(start: Transform2D, shape: ColliderShapeRef) -> f32 {
    match shape {
        ColliderShapeRef::OrientedBox(c, _) => {
            return c.offset_x.hypot(c.offset_y) + rotation_radius(shape)
        }
        ColliderShapeRef::ConvexPolygon(c, _) => {
            return c.offset_x.hypot(c.offset_y) + rotation_radius(shape)
        }
        _ => {}
    }
    let b = collider_bounds(start, shape);
    let x = (b.min_x - start.x).abs().max((b.max_x - start.x).abs());
    let y = (b.min_y - start.y).abs().max((b.max_y - start.y).abs());
    x.hypot(y)
}

pub(crate) fn angular_swept_bounds(motion: ShapeMotion, delta: f32) -> AabbBounds {
    if motion.angular_velocity == 0.0 {
        return swept_collider_bounds(motion.start, motion.shape, motion.velocity, delta);
    }
    let r = radius(motion.start, motion.shape);
    let dx = motion.velocity.vx * delta;
    let dy = motion.velocity.vy * delta;
    AabbBounds {
        min_x: motion.start.x + dx.min(0.0) - r,
        max_x: motion.start.x + dx.max(0.0) + r,
        min_y: motion.start.y + dy.min(0.0) - r,
        max_y: motion.start.y + dy.max(0.0) + r,
    }
}

impl ShapeMotion {
    pub(crate) fn rotation_origin_at(self, seconds: f32) -> Transform2D {
        let origin = match self.shape {
            ColliderShapeRef::OrientedBox(collider, _) => collider.center(self.start),
            ColliderShapeRef::ConvexPolygon(collider, _) => collider.center(self.start),
            _ => self.start,
        };
        Transform2D {
            x: origin.x + self.velocity.vx * seconds,
            y: origin.y + self.velocity.vy * seconds,
        }
    }

    fn geometry_at(self, seconds: f32) -> Option<ConvexContactGeometry> {
        convex_contact_geometry_from_shape(
            Transform2D {
                x: self.start.x + self.velocity.vx * seconds,
                y: self.start.y + self.velocity.vy * seconds,
            },
            rotated_shape(self.shape, self.angular_velocity * seconds),
        )
    }
}

impl CollisionSystem {
    /// Conservative advancement: each SAT gap bounds a safe interval using the
    /// maximum relative surface speed. A work-limit result clips at a safe pose.
    pub(crate) fn angular_swept_shape_contact(
        a: ShapeMotion,
        b: ShapeMotion,
        delta: f32,
    ) -> Option<AngularSweepResult> {
        // Collider offsets translate the rotation origin; geometry_at rotates
        // local vertices about that fixed origin, not about the entity origin.
        let angular_speed = a.angular_velocity.abs() * rotation_radius(a.shape)
            + b.angular_velocity.abs() * rotation_radius(b.shape);
        let speed =
            (a.velocity.vx - b.velocity.vx).hypot(a.velocity.vy - b.velocity.vy) + angular_speed;
        if !speed.is_finite() || speed <= RAY_EPSILON || !is_valid_delta(delta) {
            return None;
        }
        let mut seconds = 0.0;
        for iteration in 0..MAX_ADVANCES {
            let (gap, nx, ny) = separation(a.geometry_at(seconds)?, b.geometry_at(seconds)?)?;
            // Hold this separating axis fixed for the remaining interval. Linear
            // motion closes its gap only along the axis; rotation is bounded by
            // each shape's maximum surface speed. Tangential speed cannot close
            // the gap, so it must not consume the entire advancement budget.
            let closing_bound = (a.velocity.vx - b.velocity.vx) * nx
                + (a.velocity.vy - b.velocity.vy) * ny
                + angular_speed;
            if gap - closing_bound.max(0.0) * (delta - seconds) > RAY_EPSILON {
                return None;
            }
            let mut separating_touch = false;
            if gap <= RAY_EPSILON {
                let point = Self::angular_contact_point(a, b, seconds)?;
                let origin_a = a.rotation_origin_at(seconds);
                let origin_b = b.rotation_origin_at(seconds);
                let vx =
                    a.velocity.vx - a.angular_velocity * (point.y - origin_a.y) - b.velocity.vx
                        + b.angular_velocity * (point.y - origin_b.y);
                let vy = a.velocity.vy + a.angular_velocity * (point.x - origin_a.x)
                    - b.velocity.vy
                    - b.angular_velocity * (point.x - origin_b.x);
                separating_touch = vx * nx + vy * ny <= 0.0;
            }
            if separating_touch && gap >= 0.0 && closing_bound <= 0.0 {
                return None;
            }
            if (gap <= RAY_EPSILON && !separating_touch) || iteration + 1 == MAX_ADVANCES {
                let hit = SweptShapeContactHit {
                    time: seconds / delta,
                    normal_x: nx,
                    normal_y: ny,
                };
                return Some(if gap <= RAY_EPSILON && !separating_touch {
                    AngularSweepResult::Contact(hit)
                } else {
                    AngularSweepResult::BudgetLimit(hit)
                });
            }
            seconds += (gap - RAY_EPSILON * 0.5).max(RAY_EPSILON * 0.5) / speed;
            if seconds > delta {
                return None;
            }
        }
        None
    }

    pub(crate) fn angular_contact_point(
        a: ShapeMotion,
        b: ShapeMotion,
        seconds: f32,
    ) -> Option<Transform2D> {
        let ag = a.geometry_at(seconds)?;
        let bg = b.geometry_at(seconds)?;
        let (av, an) = features(ag);
        let (bv, bn) = features(bg);
        let mut best = (
            f32::INFINITY,
            Transform2D::default(),
            Transform2D::default(),
        );
        for (points, count, edges, edge_count, reverse) in
            [(&av, an, &bv, bn, false), (&bv, bn, &av, an, true)]
        {
            for p in &points[..count] {
                for i in 0..edge_count {
                    let start = edges[i];
                    let end = edges[(i + 1) % edge_count];
                    let dx = end.x - start.x;
                    let dy = end.y - start.y;
                    let length = dx * dx + dy * dy;
                    let t = if length > 0.0 {
                        (((p.x - start.x) * dx + (p.y - start.y) * dy) / length).clamp(0.0, 1.0)
                    } else {
                        0.0
                    };
                    let q = Transform2D {
                        x: start.x + t * dx,
                        y: start.y + t * dy,
                    };
                    let distance = (p.x - q.x).hypot(p.y - q.y);
                    if distance < best.0 {
                        best = if reverse {
                            (distance, q, *p)
                        } else {
                            (distance, *p, q)
                        };
                    }
                }
            }
        }
        let (_, nx, ny) = if best.0 > 0.0 {
            (
                best.0,
                (best.2.x - best.1.x) / best.0,
                (best.2.y - best.1.y) / best.0,
            )
        } else {
            separation(ag, bg)?
        };
        // Circle centers and capsule spines are core features, not surfaces.
        // Move each witness to its rounded boundary before taking the midpoint.
        let radius_delta = round_radius(ag) - round_radius(bg);
        Some(Transform2D {
            x: (best.1.x + best.2.x + nx * radius_delta) * 0.5,
            y: (best.1.y + best.2.y + ny * radius_delta) * 0.5,
        })
    }
}

fn round_radius(geometry: ConvexContactGeometry) -> f32 {
    match geometry {
        ConvexContactGeometry::Circle { radius, .. }
        | ConvexContactGeometry::Capsule { radius, .. } => radius,
        ConvexContactGeometry::Polygon { .. } => 0.0,
    }
}

// Projecting onto any unit axis gives a lower bound on the separation. Face
// normals and endpoint axes cover polygons, circles, capsules and thin edges.
fn separation(a: ConvexContactGeometry, b: ConvexContactGeometry) -> Option<(f32, f32, f32)> {
    let mut best = (f32::NEG_INFINITY, 1.0, 0.0);
    let mut axis = |dx: f32, dy: f32| -> Option<()> {
        let len = dx.hypot(dy);
        if len <= RAY_EPSILON {
            return Some(());
        }
        let (nx, ny) = (dx / len, dy / len);
        let (amin, amax) = convex_contact_geometry_project(a, nx, ny)?;
        let (bmin, bmax) = convex_contact_geometry_project(b, nx, ny)?;
        for candidate in [(bmin - amax, nx, ny), (amin - bmax, -nx, -ny)] {
            if candidate.0 > best.0 {
                best = candidate;
            }
        }
        Some(())
    };
    let (av, an) = features(a);
    let (bv, bn) = features(b);
    for (vertices, count) in [(&av, an), (&bv, bn)] {
        for i in 0..count {
            let p = vertices[i];
            let q = vertices[(i + 1) % count];
            axis(-(q.y - p.y), q.x - p.x)?;
        }
    }
    for p in &av[..an] {
        for q in &bv[..bn] {
            axis(q.x - p.x, q.y - p.y)?;
        }
    }
    axis(1.0, 0.0)?;
    axis(0.0, 1.0)?;
    Some(best)
}

fn features(
    geometry: ConvexContactGeometry,
) -> ([Transform2D; MAX_CONVEX_POLYGON_VERTICES], usize) {
    let mut points = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    match geometry {
        ConvexContactGeometry::Polygon {
            vertices,
            vertex_count,
            ..
        } => (vertices, vertex_count),
        ConvexContactGeometry::Circle { center, .. } => {
            points[0] = center;
            (points, 1)
        }
        ConvexContactGeometry::Capsule { start, end, .. } => {
            points[0] = start;
            points[1] = end;
            (points, 2)
        }
    }
}
