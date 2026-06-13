use super::*;
use crate::components::HeightSpan;

impl CollisionSystem {
    pub fn point_query(
        world: &World,
        point: Transform2D,
        query_mask: CollisionMask,
    ) -> Vec<PointQueryHit> {
        let mut hits = Vec::new();
        Self::point_query_into(world, point, query_mask, &mut hits);
        hits
    }

    pub fn aabb_query(
        world: &World,
        bounds: AabbBounds,
        query_mask: CollisionMask,
    ) -> Vec<AabbQueryHit> {
        let mut hits = Vec::new();
        Self::aabb_query_into(world, bounds, query_mask, &mut hits);
        hits
    }

    pub fn circle_query(
        world: &World,
        center: Transform2D,
        radius: f32,
        query_mask: CollisionMask,
    ) -> Vec<CircleQueryHit> {
        let mut hits = Vec::new();
        Self::circle_query_into(world, center, radius, query_mask, &mut hits);
        hits
    }

    pub fn shape_query(
        world: &World,
        shape: CollisionQueryShape,
        query_mask: CollisionMask,
    ) -> Vec<ShapeQueryHit> {
        let mut hits = Vec::new();
        Self::shape_query_into(world, shape, query_mask, &mut hits);
        hits
    }

    pub fn nearest_body_query(
        world: &World,
        point: Transform2D,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Option<NearestBodyQueryHit> {
        if !point.x.is_finite()
            || !point.y.is_finite()
            || !max_distance.is_finite()
            || max_distance < 0.0
        {
            return None;
        }

        Self::nearest_body_query_with_height_span(world, point, max_distance, query_mask, None)
    }

    pub fn nearest_body_query_with_height_span(
        world: &World,
        point: Transform2D,
        max_distance: f32,
        query_mask: CollisionMask,
        query_height_span: Option<HeightSpan>,
    ) -> Option<NearestBodyQueryHit> {
        if !point.x.is_finite()
            || !point.y.is_finite()
            || !max_distance.is_finite()
            || max_distance < 0.0
        {
            return None;
        }

        let mut best = None;
        for &index in world.alive_indices() {
            if !query_height_span_allows(world, index, query_height_span) {
                continue;
            }
            let Some(transform) = world.transform_at_index(index) else {
                continue;
            };
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
                    let Some(hit) = nearest_body_hit(
                        point,
                        transform,
                        shape,
                        entity_from_index(world, index),
                        max_distance,
                    ) else {
                        continue;
                    };
                    update_nearest_body_hit(&mut best, hit);
                }
            }
        }
        best
    }

    pub(crate) fn point_query_into(
        world: &World,
        point: Transform2D,
        query_mask: CollisionMask,
        hits: &mut Vec<PointQueryHit>,
    ) {
        hits.clear();
        Self::point_query_with_height_span_into(world, point, query_mask, None, hits);
    }

    pub(crate) fn point_query_with_height_span_into(
        world: &World,
        point: Transform2D,
        query_mask: CollisionMask,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<PointQueryHit>,
    ) {
        hits.clear();
        for &index in world.alive_indices() {
            if !query_height_span_allows(world, index, query_height_span) {
                continue;
            }
            let Some(transform) = world.transform_at_index(index) else {
                continue;
            };
            'colliders: for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !collider_contains_point(transform, shape, point) {
                        continue;
                    }
                    hits.push(PointQueryHit {
                        entity: entity_from_index(world, index),
                    });
                    break 'colliders;
                }
            }
        }
    }

    pub(crate) fn aabb_query_into(
        world: &World,
        bounds: AabbBounds,
        query_mask: CollisionMask,
        hits: &mut Vec<AabbQueryHit>,
    ) {
        hits.clear();
        Self::aabb_query_with_height_span_into(world, bounds, query_mask, None, hits);
    }

    pub(crate) fn aabb_query_with_height_span_into(
        world: &World,
        bounds: AabbBounds,
        query_mask: CollisionMask,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<AabbQueryHit>,
    ) {
        hits.clear();
        for &index in world.alive_indices() {
            if !query_height_span_allows(world, index, query_height_span) {
                continue;
            }
            let Some(transform) = world.transform_at_index(index) else {
                continue;
            };
            'colliders: for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !collider_overlaps_aabb(transform, shape, bounds) {
                        continue;
                    }
                    hits.push(AabbQueryHit {
                        entity: entity_from_index(world, index),
                    });
                    break 'colliders;
                }
            }
        }
    }

    pub(crate) fn circle_query_into(
        world: &World,
        center: Transform2D,
        radius: f32,
        query_mask: CollisionMask,
        hits: &mut Vec<CircleQueryHit>,
    ) {
        hits.clear();
        if !is_valid_radius(radius) {
            return;
        }
        Self::circle_query_with_height_span_into(world, center, radius, query_mask, None, hits);
    }

    pub(crate) fn circle_query_with_height_span_into(
        world: &World,
        center: Transform2D,
        radius: f32,
        query_mask: CollisionMask,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<CircleQueryHit>,
    ) {
        hits.clear();
        if !is_valid_radius(radius) {
            return;
        }
        for &index in world.alive_indices() {
            if !query_height_span_allows(world, index, query_height_span) {
                continue;
            }
            let Some(transform) = world.transform_at_index(index) else {
                continue;
            };
            'colliders: for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !collider_overlaps_circle(transform, shape, center, radius) {
                        continue;
                    }
                    hits.push(CircleQueryHit {
                        entity: entity_from_index(world, index),
                    });
                    break 'colliders;
                }
            }
        }
    }

    pub(crate) fn shape_query_into(
        world: &World,
        shape: CollisionQueryShape,
        query_mask: CollisionMask,
        hits: &mut Vec<ShapeQueryHit>,
    ) {
        hits.clear();
        if !query_shape_is_valid(shape) {
            return;
        }
        Self::shape_query_with_height_span_into(world, shape, query_mask, None, hits);
    }

    pub(crate) fn shape_query_with_height_span_into(
        world: &World,
        shape: CollisionQueryShape,
        query_mask: CollisionMask,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<ShapeQueryHit>,
    ) {
        hits.clear();
        if !query_shape_is_valid(shape) {
            return;
        }
        for &index in world.alive_indices() {
            if !query_height_span_allows(world, index, query_height_span) {
                continue;
            }
            let Some(transform) = world.transform_at_index(index) else {
                continue;
            };
            'colliders: for collider_index in 0..world.compound_collider_count_at(index) {
                if !mask_contains_collider(world, index, collider_index, query_mask) {
                    continue;
                }
                for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                    let Some(collider_shape) =
                        collider_shape_at_segment(world, index, collider_index, segment_index)
                    else {
                        continue;
                    };
                    if !query_shape_overlaps_collider(shape, transform, collider_shape) {
                        continue;
                    }
                    hits.push(ShapeQueryHit {
                        entity: entity_from_index(world, index),
                    });
                    break 'colliders;
                }
            }
        }
    }
}

pub(crate) fn query_height_span_allows(
    world: &World,
    index: usize,
    query_height_span: Option<HeightSpan>,
) -> bool {
    match query_height_span {
        Some(query_span) => world
            .height_span_at(index)
            .is_some_and(|body_span| query_span.overlaps(body_span)),
        None => true,
    }
}

fn nearest_body_hit(
    point: Transform2D,
    transform: Transform2D,
    shape: ColliderShapeRef,
    entity: Entity,
    max_distance: f32,
) -> Option<NearestBodyQueryHit> {
    let (distance, point_x, point_y) = nearest_point_on_collider(point, transform, shape)?;
    if distance > max_distance {
        return None;
    }
    Some(NearestBodyQueryHit {
        entity,
        distance,
        point_x,
        point_y,
    })
}

fn update_nearest_body_hit(best: &mut Option<NearestBodyQueryHit>, next: NearestBodyQueryHit) {
    if best.is_none_or(|current| {
        next.distance
            .total_cmp(&current.distance)
            .then_with(|| next.entity.id.cmp(&current.entity.id))
            .then_with(|| next.entity.generation.cmp(&current.entity.generation))
            .is_lt()
    }) {
        *best = Some(next);
    }
}
