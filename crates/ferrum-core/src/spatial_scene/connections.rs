//! Explicit bidirectional shared-edge gateways; no destination pathfinding or implicit floor inference.
use super::{SpatialScene, Surface};
use crate::components::{HeightSpan, PhysicsFloorId, Transform2D, Velocity};
use crate::entity::Entity;
use crate::physics::{PhysicsCounters, PhysicsSystem};
use crate::world::World;

#[derive(Clone, Copy)]
pub(super) struct SurfaceConnection {
    from: usize,
    to: usize,
    axis: usize,
    boundary: f32,
    lower: f32,
    upper: f32,
}
pub(super) enum ConnectionMove {
    Unconnected,
    Blocked,
    Moved,
}

fn shared_edge(a: Surface, b: Surface) -> Option<(usize, f32, f32, f32)> {
    let [ax, ay, aw, ad] = a.bounds;
    let [bx, by, bw, bd] = b.bounds;
    if (ax + aw == bx || bx + bw == ax) && ay.max(by) < (ay + ad).min(by + bd) {
        Some((
            0,
            if ax + aw == bx { bx } else { ax },
            ay.max(by),
            (ay + ad).min(by + bd),
        ))
    } else if (ay + ad == by || by + bd == ay) && ax.max(bx) < (ax + aw).min(bx + bw) {
        Some((
            1,
            if ay + ad == by { by } else { ay },
            ax.max(bx),
            (ax + aw).min(bx + bw),
        ))
    } else {
        None
    }
}
fn contains(s: Surface, p: Transform2D) -> bool {
    let [x, y, w, d] = s.bounds;
    p.x >= x && p.x < x + w && p.y >= y && p.y < y + d
}
fn elevation(s: Surface, p: Transform2D) -> f32 {
    let axis = usize::from(!s.ramp_x);
    let at = if s.ramp_x { p.x } else { p.y };
    let t = ((at - s.bounds[axis]) / s.bounds[axis + 2]).clamp(0.0, 1.0);
    // Convex interpolation avoids overflowing b-a for otherwise finite authored heights.
    s.heights[0] * (1.0 - t) + s.heights[1] * t
}
impl SpatialScene {
    pub(super) fn navigation_surfaces_connected(&self, from: usize, to: usize) -> bool {
        from == to
            || (self.surfaces[from].floor == self.surfaces[to].floor
                && shared_edge(self.surfaces[from], self.surfaces[to]).is_some())
            || self
                .connections
                .iter()
                .any(|c| c.from == from && c.to == to)
    }
    /// Same-floor adjacency alone does not make a diagonal across a third surface safe.
    pub(super) fn navigation_edge_crosses_supports(
        &self,
        from: usize,
        to: usize,
        a: Transform2D,
        b: Transform2D,
    ) -> bool {
        if from == to {
            return true;
        }
        let Some((axis, boundary, lower, upper)) =
            shared_edge(self.surfaces[from], self.surfaces[to])
        else {
            return false;
        };
        let p = [f64::from(a.x), f64::from(a.y)];
        let q = [f64::from(b.x), f64::from(b.y)];
        let delta = q[axis] - p[axis];
        if delta == 0. {
            return false;
        }
        let t = (f64::from(boundary) - p[axis]) / delta;
        let along = p[1 - axis] + (q[1 - axis] - p[1 - axis]) * t;
        let owner = if self.surfaces[from].bounds[axis] == boundary {
            self.surfaces[from]
        } else {
            self.surfaces[to]
        };
        let owned_upper = self.surfaces[from].floor == self.surfaces[to].floor
            && along == f64::from(upper)
            && along < f64::from(owner.bounds[1 - axis] + owner.bounds[3 - axis]);
        (0. ..=1.).contains(&t)
            && along >= f64::from(lower)
            && (along < f64::from(upper) || owned_upper)
    }
    pub fn configure_connections(&mut self, pairs: &[u32]) -> bool {
        if !pairs.len().is_multiple_of(2) || pairs.len() > 512 {
            return false;
        }
        let mut next: Vec<SurfaceConnection> = Vec::with_capacity(pairs.len());
        for pair in pairs.chunks_exact(2) {
            let Some(from) = self.surfaces.iter().position(|s| s.id == pair[0]) else {
                return false;
            };
            let Some(to) = self.surfaces.iter().position(|s| s.id == pair[1]) else {
                return false;
            };
            let a = self.surfaces[from];
            let b = self.surfaces[to];
            if !a.walkable || !b.walkable || a.floor == b.floor {
                return false;
            }
            let Some((axis, boundary, lower, upper)) = shared_edge(a, b) else {
                return false;
            };
            for (from, to) in [(from, to), (to, from)] {
                if next.iter().any(|c| {
                    c.from == from
                        && (c.to == to
                            || (c.axis == axis
                                && c.boundary == boundary
                                && c.lower.max(lower) < c.upper.min(upper)))
                }) {
                    return false;
                }
                next.push(SurfaceConnection {
                    from,
                    to,
                    axis,
                    boundary,
                    lower,
                    upper,
                });
            }
        }
        self.connections = next;
        self.navigation_revision = self.navigation_revision.wrapping_add(1);
        true
    }
    #[allow(clippy::too_many_arguments)]
    pub(super) fn move_connected_body(
        &mut self,
        world: &mut World,
        entity: Entity,
        original: Transform2D,
        center: Transform2D,
        target: Transform2D,
        max_step: f32,
        max_drop: f32,
        mut counters: Option<&mut PhysicsCounters>,
        solid_mask: crate::components::CollisionMask,
    ) -> ConnectionMove {
        if self.connections.is_empty() {
            return ConnectionMove::Unconnected;
        }
        let Some(span) = world.height_span(entity) else {
            return ConnectionMove::Unconnected;
        };
        let Some(source) = self.physics.hd2d_surface_at(center, Some(span)) else {
            return ConnectionMove::Unconnected;
        };
        let start = [center.x, center.y];
        let end = [target.x, target.y];
        let Some(connection) = self
            .connections
            .iter()
            .find(|c| {
                if c.from != source.layer_index {
                    return false;
                }
                let axis = c.axis;
                let source_bounds = self.surfaces[c.from].bounds;
                let outward = if source_bounds[axis] == c.boundary {
                    end[axis] < c.boundary
                } else {
                    end[axis] >= c.boundary
                };
                let distance = end[axis] - start[axis];
                if !outward || distance == 0.0 {
                    return false;
                }
                let t = (c.boundary - start[axis]) / distance;
                let at = start[1 - axis] + t * (end[1 - axis] - start[1 - axis]);
                (0.0..=1.0).contains(&t) && at >= c.lower && at <= c.upper
            })
            .copied()
        else {
            return ConnectionMove::Unconnected;
        };
        // A short diagonal can cross two neighboring edges near a corner. Do not skip the intermediate floor.
        if !contains(self.surfaces[connection.to], target) {
            return ConnectionMove::Blocked;
        }
        if (source.elevation - span.elevation).abs() > 0.001 {
            return ConnectionMove::Blocked;
        }
        let distance = end[connection.axis] - start[connection.axis];
        if distance == 0.0 {
            return ConnectionMove::Unconnected;
        }
        let t = (connection.boundary - start[connection.axis]) / distance;
        if !(0.0..=1.0).contains(&t) {
            return ConnectionMove::Unconnected;
        }
        let tangent = 1 - connection.axis;
        let at = start[tangent] + t * (end[tangent] - start[tangent]);
        let Some(collider) = world.collider(entity) else {
            return ConnectionMove::Blocked;
        };
        let clearance = if tangent == 0 {
            collider.half_width
        } else {
            collider.half_height
        };
        if at - clearance < connection.lower || at + clearance > connection.upper {
            return ConnectionMove::Blocked;
        }
        let destination = self.surfaces[connection.to];
        let height = elevation(destination, target);
        let delta = height - span.elevation;
        if !height.is_finite()
            || !(height + span.height).is_finite()
            || delta > max_step + 0.001
            || delta < -max_drop - 0.001
        {
            return ConnectionMove::Blocked;
        }
        let next = HeightSpan {
            floor: PhysicsFloorId(destination.floor),
            elevation: height,
            height: span.height,
        };
        let movement = Velocity {
            vx: target.x - center.x,
            vy: target.y - center.y,
        };
        // Both floors must admit this short segment. Probes update no simulation events; only the final pose/span commits.
        for probe_span in [span, next] {
            world.set_transform(entity, original);
            world.set_height_span(entity, probe_span);
            let moved = PhysicsSystem::sweep_spatial_body_with_scratch(
                world,
                &self.physics,
                entity,
                movement,
                &mut self.movement_scratch,
                counters.as_deref_mut(),
                solid_mask,
            );
            if moved.is_none_or(|moved| {
                (moved.end.x - (original.x + movement.vx)).abs() > 0.0001
                    || (moved.end.y - (original.y + movement.vy)).abs() > 0.0001
                    || !contains(destination, collider.center(moved.end))
            }) {
                world.set_transform(entity, original);
                world.set_height_span(entity, span);
                return ConnectionMove::Blocked;
            }
        }
        ConnectionMove::Moved
    }
}

#[cfg(test)]
mod navigation_edge_tests {
    use super::*;
    #[test]
    fn shared_edge_upper_corner_owned_by_larger_neighbor_remains_walkable() {
        let mut scene = SpatialScene::default();
        let a = [0., 0., 8., 8., 0., 0., 0., 1., 1., 1., 1.];
        let b = [8., 0., 8., 16., 0., 0., 0., 1., 1., 1., 1.];
        assert!(scene.configure_surfaces(&[a, b].concat(), &[1, 0, 16777215, 1, 2, 0, 16777215, 1]));
        let from = Transform2D { x: 4., y: 4. };
        let to = Transform2D { x: 12., y: 12. };
        assert!(scene.navigation_edge_crosses_supports(0, 1, from, to));
        assert!(scene.navigation_edge_crosses_supports(1, 0, to, from));
        assert!(scene.configure_surfaces(&[a, b].concat(), &[1, 0, 16777215, 1, 2, 1, 16777215, 1]));
        assert!(!scene.navigation_edge_crosses_supports(0, 1, from, to));
    }
}
