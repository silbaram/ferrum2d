//! Bounded grid crossings for combat dashes. Uniform samples can miss diagonal cell corners.
use super::Tilemap;
use crate::components::Transform2D;

pub(crate) const MAX_ACTION_DASH_BREAKPOINTS: usize = 129;

impl Tilemap {
    pub(crate) fn actor_placement_blocked(
        &self,
        world: &crate::world::World,
        entity: crate::entity::Entity,
    ) -> bool {
        use super::queries::tile_height_span_allows;
        use crate::collision::{
            collider_bounds, collider_segment_count_at, collider_shape_at_segment,
            ColliderShapeRef, CollisionSystem,
        };
        use crate::components::CollisionLayer;
        let Some(at) = world.transform(entity) else {
            return true;
        };
        let index = entity.id as usize;
        for collider in 0..world.compound_collider_count(entity) {
            for segment in 0..collider_segment_count_at(world, index, collider) {
                let Some(shape) = collider_shape_at_segment(world, index, collider, segment) else {
                    continue;
                };
                let bounds = collider_bounds(at, shape);
                for (layer_index, layer) in self
                    .layers
                    .iter()
                    .enumerate()
                    .filter_map(|(i, l)| l.as_ref().map(|l| (i, l)))
                    .filter(|(_, l)| l.collision)
                {
                    let Some(range) = layer.candidate_tile_range_for_bounds(bounds) else {
                        continue;
                    };
                    let mut blocked = false;
                    self.visit_collision_rect_candidates(layer_index, range, |rect| {
                        if tile_height_span_allows(rect, world.height_span(entity))
                            && CollisionSystem::shapes_penetrate(
                                at,
                                shape,
                                rect.center(layer),
                                ColliderShapeRef::Aabb(
                                    rect.aabb_collider(layer, CollisionLayer::Wall),
                                ),
                            )
                        {
                            blocked = true;
                            return false;
                        }
                        true
                    });
                    if blocked {
                        return true;
                    }
                }
            }
        }
        false
    }
    /// Collect grid crossings before moving. The caller visits each open interval and its end.
    /// A conservative capacity rejection leaves the actor and its cooldown untouched.
    pub(crate) fn action_dash_breakpoints(
        &self,
        from: Transform2D,
        to: Transform2D,
        points: &mut Vec<f64>,
    ) -> bool {
        points.clear();
        points.extend([0., 1.]);
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            let axes = [
                (
                    from.x,
                    to.x,
                    layer.origin_x,
                    layer.tile_width,
                    layer.columns,
                ),
                (from.y, to.y, layer.origin_y, layer.tile_height, layer.rows),
            ];
            // Clip first: a remote, tiny grid must not exhaust an unrelated dash's capacity.
            let mut entry: f64 = 0.;
            let mut exit: f64 = 1.;
            for &(start, end, origin, extent, cells) in &axes {
                let start = f64::from(start);
                let delta = f64::from(end) - start;
                let low = f64::from(origin);
                let high = low + f64::from(extent) * f64::from(cells);
                if delta == 0. {
                    if start < low || start > high {
                        entry = 1.;
                        exit = 0.;
                        break;
                    }
                } else {
                    let a = (low - start) / delta;
                    let b = (high - start) / delta;
                    entry = entry.max(a.min(b));
                    exit = exit.min(a.max(b));
                }
            }
            if entry >= exit {
                continue;
            }
            for (start, end, origin, extent, cells) in axes {
                let start = f64::from(start);
                let delta = f64::from(end) - start;
                if delta == 0. {
                    continue;
                }
                let origin = f64::from(origin);
                let extent = f64::from(extent);
                let a = (start + delta * entry - origin) / extent;
                let b = (start + delta * exit - origin) / extent;
                let first = a.min(b).ceil().max(0.) as u64;
                let last = a.max(b).floor().min(f64::from(cells)) as u64;
                if first > last {
                    continue;
                }
                // Admit the complete loop, including duplicate or endpoint candidates.
                if last - first + 1 > (MAX_ACTION_DASH_BREAKPOINTS - points.len()) as u64 {
                    return false;
                }
                for boundary in first..=last {
                    let t = (origin + boundary as f64 * extent - start) / delta;
                    if t > 0. && t < 1. {
                        points.push(t);
                    }
                }
            }
        }
        points.sort_unstable_by(f64::total_cmp);
        points.dedup();
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combat_action_dash_ignores_remote_grids_and_refuses_excess_crossings_before_growth() {
        let mut tilemap = Tilemap::default();
        let from = Transform2D { x: 0., y: 0. };
        let to = Transform2D { x: 512., y: 0. };
        let mut points = Vec::with_capacity(MAX_ACTION_DASH_BREAKPOINTS);
        tilemap.set_layer(0, 1024, 1, 0.25, 0.25, 0., 100., true, vec![0; 1024]);
        assert!(tilemap.action_dash_breakpoints(from, to, &mut points));
        assert_eq!(points, [0., 1.]);
        tilemap.set_layer(0, 1024, 1, 0.25, 0.25, 0., 0., true, vec![0; 1024]);
        assert!(!tilemap.action_dash_breakpoints(from, to, &mut points));
        assert_eq!(points.capacity(), MAX_ACTION_DASH_BREAKPOINTS);
        assert!(points.len() <= MAX_ACTION_DASH_BREAKPOINTS);
    }
}
