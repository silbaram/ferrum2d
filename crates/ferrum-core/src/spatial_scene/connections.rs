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
    let t = ((p.y - s.bounds[1]) / s.bounds[3]).clamp(0.0, 1.0);
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
