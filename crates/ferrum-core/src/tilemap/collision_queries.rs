use super::queries::{
    best_tile_hit_is_better, is_tilemap_blocked_layer, nearest_obstacle_hit,
    resolve_dynamic_aabb_against_static, update_nearest_obstacle_hit,
};
use super::{
    Tilemap, TilemapNearestObstacleHit, TilemapResolveStats, TilemapSweepHit,
    MAX_TILE_COLLISION_RESOLUTION_STEPS, TILE_GROUND_NORMAL_Y_MIN, TILE_SWEEP_EPSILON,
};
use crate::collision::{AabbBounds, CollisionSystem};
use crate::components::{AabbCollider, Transform2D, Velocity};
use crate::physics::PhysicsCounters;
use crate::world::World;

mod contact;
mod linear_cast;
mod one_way;
mod slope;

impl Tilemap {
    pub fn resolve_dynamic_collisions(&self, world: &mut World) {
        self.resolve_dynamic_collisions_internal(world, None);
    }

    pub(crate) fn resolve_dynamic_collisions_with_counters(
        &self,
        world: &mut World,
        counters: &mut PhysicsCounters,
    ) {
        self.resolve_dynamic_collisions_internal(world, Some(counters));
    }

    fn resolve_dynamic_collisions_internal(
        &self,
        world: &mut World,
        mut counters: Option<&mut PhysicsCounters>,
    ) {
        for entity_index in 0..world.transforms.len() {
            if !world.alive[entity_index] {
                continue;
            }
            let Some(collider) = world.colliders[entity_index] else {
                continue;
            };
            if !collider.enabled || !is_tilemap_blocked_layer(collider.layer) {
                continue;
            }
            let Some(mut transform) = world.transforms[entity_index] else {
                continue;
            };
            if let Some(counters) = counters.as_deref_mut() {
                counters.kinematic_moves = counters.kinematic_moves.saturating_add(1);
            }
            let stats = self.resolve_transform_against_solid_tiles(&mut transform, collider);
            if let Some(counters) = counters.as_deref_mut() {
                counters.tile_candidate_checks = counters
                    .tile_candidate_checks
                    .saturating_add(stats.candidate_tiles);
                counters.kinematic_hits = counters.kinematic_hits.saturating_add(stats.hit_tiles);
                counters.kinematic_tile_hits =
                    counters.kinematic_tile_hits.saturating_add(stats.hit_tiles);
            }
            world.transforms[entity_index] = Some(transform);
        }
    }

    pub(crate) fn ground_probe_contact(
        &self,
        start: Transform2D,
        collider: AabbCollider,
        probe_distance: f32,
    ) -> Option<TilemapSweepHit> {
        if !is_tilemap_blocked_layer(collider.layer)
            || !probe_distance.is_finite()
            || probe_distance <= 0.0
        {
            return None;
        }

        let displacement = Velocity {
            vx: 0.0,
            vy: probe_distance,
        };
        let end = Transform2D {
            x: start.x,
            y: start.y + probe_distance,
        };
        let swept_bounds = AabbBounds::swept(start, end, collider);
        let mut best: Option<TilemapSweepHit> = None;

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(swept_bounds) else {
                continue;
            };

            self.visit_collision_rect_candidates(layer_index, range, |rect| {
                let rect_bounds = rect.bounds(layer);
                if !rect_bounds.overlaps(swept_bounds) {
                    return true;
                }
                let static_collider = rect.aabb_collider(layer, collider.layer);
                let rect_center = rect.center(layer);
                let Some(contact) = CollisionSystem::swept_aabb_contact(
                    start,
                    displacement,
                    collider,
                    rect_center,
                    Velocity::default(),
                    static_collider,
                    1.0,
                ) else {
                    return true;
                };
                if contact.normal_y < TILE_GROUND_NORMAL_Y_MIN {
                    return true;
                }
                let into_normal =
                    displacement.vx * contact.normal_x + displacement.vy * contact.normal_y;
                if contact.time <= TILE_SWEEP_EPSILON && into_normal <= 0.0 {
                    return true;
                }

                if best_tile_hit_is_better(&best, contact, layer_index, rect.tile_index) {
                    best = Some(TilemapSweepHit {
                        layer_index,
                        tile_index: rect.tile_index,
                        contact,
                    });
                }
                true
            });

            self.update_one_way_tile_swept_hit_for_range(
                layer_index,
                layer,
                range,
                swept_bounds,
                start,
                collider,
                displacement,
                None,
                &mut best,
            );
        }

        best
    }

    pub fn nearest_collision_obstacle(
        &self,
        point: Transform2D,
        max_distance: f32,
    ) -> Option<TilemapNearestObstacleHit> {
        if !point.x.is_finite()
            || !point.y.is_finite()
            || !max_distance.is_finite()
            || max_distance < 0.0
        {
            return None;
        }
        let query_bounds = AabbBounds::from_center(point, max_distance, max_distance)?;
        let mut best = None;

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(range) = layer.candidate_tile_range_for_bounds(query_bounds) else {
                continue;
            };
            self.visit_collision_rect_candidates(layer_index, range, |rect| {
                let Some(hit) = nearest_obstacle_hit(point, max_distance, layer_index, layer, rect)
                else {
                    return true;
                };
                update_nearest_obstacle_hit(&mut best, hit);
                true
            });
        }

        best
    }

    fn resolve_transform_against_solid_tiles(
        &self,
        transform: &mut Transform2D,
        collider: AabbCollider,
    ) -> TilemapResolveStats {
        let mut stats = TilemapResolveStats::default();
        let mut candidate_rects = Vec::new();
        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            for _ in 0..MAX_TILE_COLLISION_RESOLUTION_STEPS {
                let dynamic_bounds = AabbBounds::from_transform(*transform, collider);
                let Some(range) = layer.candidate_tile_range_for_bounds(dynamic_bounds) else {
                    break;
                };
                let mut resolved = false;
                self.collect_collision_rect_candidates_in_tile_order(
                    layer_index,
                    range,
                    &mut candidate_rects,
                );

                for rect in candidate_rects.iter().copied() {
                    let rect_bounds = rect.bounds(layer);
                    if !rect_bounds.overlaps(dynamic_bounds) {
                        continue;
                    }
                    stats.candidate_tiles = stats.candidate_tiles.saturating_add(1);
                    if resolve_dynamic_aabb_against_static(
                        transform,
                        collider,
                        rect.center(layer),
                        rect.half_width(layer),
                        rect.half_height(layer),
                    ) {
                        resolved = true;
                        stats.hit_tiles = stats.hit_tiles.saturating_add(1);
                        break;
                    }
                }

                if !resolved {
                    break;
                }
            }
        }
        stats
    }
}
