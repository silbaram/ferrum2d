use super::*;
use crate::components::HeightSpan;
use std::cmp::Ordering;

use super::query::query_height_span_allows;

impl CollisionSystem {
    pub fn raycast(
        world: &World,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Option<RaycastHit> {
        let mut nearest = None;
        visit_raycast_hits(
            world,
            origin,
            direction,
            max_distance,
            query_mask,
            None,
            |hit| update_nearest_raycast_hit(&mut nearest, hit),
        );
        nearest
    }

    pub fn raycast_all(
        world: &World,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Vec<RaycastHit> {
        let mut hits = Vec::new();
        Self::raycast_all_into(
            world,
            origin,
            direction,
            max_distance,
            query_mask,
            &mut hits,
        );
        hits
    }

    pub fn segment_cast(
        world: &World,
        start: Transform2D,
        end: Transform2D,
        query_mask: CollisionMask,
    ) -> Option<RaycastHit> {
        let (direction, max_distance) = segment_direction_and_distance(start, end)?;
        Self::raycast(world, start, direction, max_distance, query_mask)
    }

    pub fn segment_cast_all(
        world: &World,
        start: Transform2D,
        end: Transform2D,
        query_mask: CollisionMask,
    ) -> Vec<RaycastHit> {
        let mut hits = Vec::new();
        Self::segment_cast_all_into(world, start, end, query_mask, &mut hits);
        hits
    }

    pub(crate) fn raycast_all_into(
        world: &World,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
        hits: &mut Vec<RaycastHit>,
    ) {
        hits.clear();
        Self::raycast_all_with_height_span_into(
            world,
            origin,
            direction,
            max_distance,
            query_mask,
            None,
            hits,
        );
    }

    pub(crate) fn raycast_all_with_height_span_into(
        world: &World,
        origin: Transform2D,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<RaycastHit>,
    ) {
        hits.clear();
        visit_raycast_hits(
            world,
            origin,
            direction,
            max_distance,
            query_mask,
            query_height_span,
            |hit| hits.push(hit),
        );
        hits.sort_by(raycast_hit_order);
    }

    pub(crate) fn segment_cast_all_into(
        world: &World,
        start: Transform2D,
        end: Transform2D,
        query_mask: CollisionMask,
        hits: &mut Vec<RaycastHit>,
    ) {
        hits.clear();
        let Some((direction, max_distance)) = segment_direction_and_distance(start, end) else {
            return;
        };
        Self::raycast_all_into(world, start, direction, max_distance, query_mask, hits);
    }

    pub(crate) fn segment_cast_all_with_height_span_into(
        world: &World,
        start: Transform2D,
        end: Transform2D,
        query_mask: CollisionMask,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<RaycastHit>,
    ) {
        hits.clear();
        let Some((direction, max_distance)) = segment_direction_and_distance(start, end) else {
            return;
        };
        Self::raycast_all_with_height_span_into(
            world,
            start,
            direction,
            max_distance,
            query_mask,
            query_height_span,
            hits,
        );
    }
}

fn visit_raycast_hits(
    world: &World,
    origin: Transform2D,
    direction: Velocity,
    max_distance: f32,
    query_mask: CollisionMask,
    query_height_span: Option<HeightSpan>,
    mut visit: impl FnMut(RaycastHit),
) {
    let Some((unit_x, unit_y)) = normalized_direction(direction) else {
        return;
    };
    if !max_distance.is_finite() || max_distance < 0.0 {
        return;
    }

    for &index in world.alive_indices() {
        if !query_height_span_allows(world, index, query_height_span) {
            continue;
        }
        let Some(transform) = world.transforms[index] else {
            continue;
        };
        let entity = entity_from_index(world, index);
        for collider_index in 0..world.compound_collider_count_at(index) {
            if !mask_contains_collider(world, index, collider_index, query_mask) {
                continue;
            }
            for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                let Some(shape) =
                    collider_shape_at_segment(world, index, collider_index, segment_index)
                else {
                    continue;
                };
                let Some(hit) =
                    raycast_shape(origin, unit_x, unit_y, max_distance, transform, shape)
                else {
                    continue;
                };
                visit(RaycastHit {
                    entity,
                    distance: hit.distance,
                    point_x: origin.x + unit_x * hit.distance,
                    point_y: origin.y + unit_y * hit.distance,
                    normal_x: hit.normal_x,
                    normal_y: hit.normal_y,
                });
            }
        }
    }
}

fn update_nearest_raycast_hit(nearest: &mut Option<RaycastHit>, next: RaycastHit) {
    if nearest
        .as_ref()
        .is_none_or(|current| raycast_hit_order(&next, current).is_lt())
    {
        *nearest = Some(next);
    }
}

fn raycast_hit_order(a: &RaycastHit, b: &RaycastHit) -> Ordering {
    a.distance
        .total_cmp(&b.distance)
        .then_with(|| a.entity.id.cmp(&b.entity.id))
}
