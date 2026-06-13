use super::*;
use crate::components::HeightSpan;

mod capsule;
mod convex_polygon;
mod oriented_box;
mod segment;
use capsule::{
    shape_cast_aabb_capsule, shape_cast_capsule_aabb, shape_cast_capsule_capsule,
    shape_cast_capsule_convex_polygon, shape_cast_capsule_oriented_box, shape_cast_circle_capsule,
    shape_cast_convex_polygon_capsule, shape_cast_oriented_box_capsule,
};
use convex_polygon::{
    shape_cast_aabb_convex_polygon, shape_cast_circle_convex_polygon,
    shape_cast_convex_polygon_aabb, shape_cast_convex_polygon_circle,
    shape_cast_convex_polygon_convex_polygon, shape_cast_convex_polygon_oriented_box,
    shape_cast_oriented_box_convex_polygon,
};
use oriented_box::{
    shape_cast_aabb_oriented_box, shape_cast_circle_oriented_box, shape_cast_oriented_box_aabb,
    shape_cast_oriented_box_circle, shape_cast_oriented_box_oriented_box,
};
use segment::shape_cast_moving_segment_circle;
use std::cmp::Ordering;

use super::query::query_height_span_allows;

impl CollisionSystem {
    pub fn shape_cast(
        world: &World,
        shape: CollisionQueryShape,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Option<ShapeCastHit> {
        let mut nearest = None;
        visit_shape_cast_hits(
            world,
            shape,
            direction,
            max_distance,
            query_mask,
            None,
            |hit| update_nearest_shape_cast_hit(&mut nearest, hit),
        );
        nearest
    }

    pub fn shape_cast_all(
        world: &World,
        shape: CollisionQueryShape,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
    ) -> Vec<ShapeCastHit> {
        let mut hits = Vec::new();
        Self::shape_cast_all_into(world, shape, direction, max_distance, query_mask, &mut hits);
        hits
    }

    pub(crate) fn shape_cast_all_into(
        world: &World,
        shape: CollisionQueryShape,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
        hits: &mut Vec<ShapeCastHit>,
    ) {
        hits.clear();
        Self::shape_cast_all_with_height_span_into(
            world,
            shape,
            direction,
            max_distance,
            query_mask,
            None,
            hits,
        );
    }

    pub(crate) fn shape_cast_all_with_height_span_into(
        world: &World,
        shape: CollisionQueryShape,
        direction: Velocity,
        max_distance: f32,
        query_mask: CollisionMask,
        query_height_span: Option<HeightSpan>,
        hits: &mut Vec<ShapeCastHit>,
    ) {
        hits.clear();
        visit_shape_cast_hits(
            world,
            shape,
            direction,
            max_distance,
            query_mask,
            query_height_span,
            |hit| hits.push(hit),
        );
        hits.sort_by(shape_cast_hit_order);
    }
}

fn visit_shape_cast_hits(
    world: &World,
    shape: CollisionQueryShape,
    direction: Velocity,
    max_distance: f32,
    query_mask: CollisionMask,
    query_height_span: Option<HeightSpan>,
    mut visit: impl FnMut(ShapeCastHit),
) {
    if !query_shape_is_valid(shape) || !max_distance.is_finite() || max_distance < 0.0 {
        return;
    }
    let Some((unit_x, unit_y)) = normalized_direction(direction) else {
        return;
    };
    let sweep_bounds =
        query_shape_sweep_bounds(shape, unit_x * max_distance, unit_y * max_distance);
    let reference = query_shape_reference_point(shape);

    for &index in world.alive_indices() {
        if !query_height_span_allows(world, index, query_height_span) {
            continue;
        }
        let Some(transform) = world.transform_at_index(index) else {
            continue;
        };
        let entity = entity_from_index(world, index);
        for collider_index in 0..world.compound_collider_count_at(index) {
            if !mask_contains_collider(world, index, collider_index, query_mask) {
                continue;
            }
            for segment_index in 0..collider_segment_count_at(world, index, collider_index) {
                let Some(collider_shape) =
                    collider_shape_at_segment(world, index, collider_index, segment_index)
                else {
                    continue;
                };
                if !sweep_bounds.overlaps(collider_bounds(transform, collider_shape)) {
                    continue;
                }
                let Some(hit) = shape_cast_hit(
                    shape,
                    unit_x,
                    unit_y,
                    max_distance,
                    transform,
                    collider_shape,
                ) else {
                    continue;
                };
                visit(ShapeCastHit {
                    entity,
                    distance: hit.distance,
                    point_x: reference.x + unit_x * hit.distance,
                    point_y: reference.y + unit_y * hit.distance,
                    normal_x: hit.normal_x,
                    normal_y: hit.normal_y,
                });
            }
        }
    }
}

fn update_nearest_shape_cast_hit(nearest: &mut Option<ShapeCastHit>, next: ShapeCastHit) {
    if nearest
        .as_ref()
        .is_none_or(|current| shape_cast_hit_order(&next, current).is_lt())
    {
        *nearest = Some(next);
    }
}

fn shape_cast_hit_order(a: &ShapeCastHit, b: &ShapeCastHit) -> Ordering {
    a.distance
        .total_cmp(&b.distance)
        .then_with(|| a.entity.id.cmp(&b.entity.id))
}

pub(super) fn shape_cast_hit(
    query_shape: CollisionQueryShape,
    unit_x: f32,
    unit_y: f32,
    max_distance: f32,
    collider_transform: Transform2D,
    collider_shape: ColliderShapeRef,
) -> Option<RaycastBoundsHit> {
    let collider_shape = match collider_shape {
        ColliderShapeRef::Edge(collider) => ColliderShapeRef::Capsule(edge_as_capsule(collider)),
        other => other,
    };

    if query_shape_overlaps_collider(query_shape, collider_transform, collider_shape) {
        return Some(RaycastBoundsHit {
            distance: 0.0,
            normal_x: 0.0,
            normal_y: 0.0,
        });
    }

    let reference = query_shape_reference_point(query_shape);
    let motion = ShapeCastMotion {
        unit_x,
        unit_y,
        max_distance,
    };
    match (query_shape, collider_shape) {
        (query_shape, ColliderShapeRef::Edge(collider)) => shape_cast_hit(
            query_shape,
            unit_x,
            unit_y,
            max_distance,
            collider_transform,
            ColliderShapeRef::Capsule(edge_as_capsule(collider)),
        ),
        (CollisionQueryShape::Aabb(bounds), ColliderShapeRef::Aabb(collider)) => {
            let (half_width, half_height) = query_aabb_half_extents(bounds);
            raycast_bounds(
                reference,
                unit_x,
                unit_y,
                max_distance,
                inflate_bounds(
                    AabbBounds::from_transform(collider_transform, collider),
                    half_width,
                    half_height,
                ),
            )
        }
        (CollisionQueryShape::Aabb(bounds), ColliderShapeRef::Circle(collider)) => {
            shape_cast_aabb_circle(
                reference,
                bounds,
                unit_x,
                unit_y,
                max_distance,
                collider.center(collider_transform),
                collider.radius,
            )
        }
        (CollisionQueryShape::Circle { radius, .. }, ColliderShapeRef::Aabb(collider)) => {
            raycast_bounds(
                reference,
                unit_x,
                unit_y,
                max_distance,
                inflate_bounds(
                    AabbBounds::from_transform(collider_transform, collider),
                    radius,
                    radius,
                ),
            )
        }
        (
            CollisionQueryShape::Circle {
                radius: query_radius,
                ..
            },
            ColliderShapeRef::Circle(collider),
        ) => raycast_circle(
            reference,
            unit_x,
            unit_y,
            max_distance,
            collider.center(collider_transform),
            query_radius + collider.radius,
        ),
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::Aabb(collider),
        ) => shape_cast_oriented_box_aabb(
            oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
            motion,
            AabbBounds::from_transform(collider_transform, collider),
        ),
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::Circle(collider),
        ) => shape_cast_oriented_box_circle(
            oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
            motion,
            collider.center(collider_transform),
            collider.radius,
        ),
        (CollisionQueryShape::Capsule { start, end, radius }, ColliderShapeRef::Aabb(collider)) => {
            shape_cast_capsule_aabb(
                start,
                end,
                radius,
                unit_x,
                unit_y,
                max_distance,
                AabbBounds::from_transform(collider_transform, collider),
            )
        }
        (
            CollisionQueryShape::Capsule { start, end, radius },
            ColliderShapeRef::Circle(collider),
        ) => shape_cast_moving_segment_circle(
            start,
            end,
            unit_x,
            unit_y,
            max_distance,
            collider.center(collider_transform),
            radius + collider.radius,
        ),
        (CollisionQueryShape::Aabb(bounds), ColliderShapeRef::Capsule(collider)) => {
            shape_cast_aabb_capsule(
                reference,
                bounds,
                motion,
                collider.start(collider_transform),
                collider.end(collider_transform),
                collider.radius,
            )
        }
        (CollisionQueryShape::Circle { radius, .. }, ColliderShapeRef::Capsule(collider)) => {
            shape_cast_circle_capsule(
                reference,
                radius,
                motion,
                collider.start(collider_transform),
                collider.end(collider_transform),
                collider.radius,
            )
        }
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::Capsule(collider),
        ) => shape_cast_oriented_box_capsule(
            oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
            motion,
            collider.start(collider_transform),
            collider.end(collider_transform),
            collider.radius,
        ),
        (CollisionQueryShape::Aabb(bounds), ColliderShapeRef::OrientedBox(collider, rotation)) => {
            shape_cast_aabb_oriented_box(
                reference,
                bounds,
                motion,
                oriented_box_geometry(
                    collider.center(collider_transform),
                    collider.half_width,
                    collider.half_height,
                    rotation,
                )?,
            )
        }
        (
            CollisionQueryShape::Circle { radius, .. },
            ColliderShapeRef::OrientedBox(collider, rotation),
        ) => shape_cast_circle_oriented_box(
            reference,
            radius,
            motion,
            oriented_box_geometry(
                collider.center(collider_transform),
                collider.half_width,
                collider.half_height,
                rotation,
            )?,
        ),
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::OrientedBox(collider, target_rotation),
        ) => shape_cast_oriented_box_oriented_box(
            oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
            motion,
            oriented_box_geometry(
                collider.center(collider_transform),
                collider.half_width,
                collider.half_height,
                target_rotation,
            )?,
        ),
        (
            CollisionQueryShape::Capsule { start, end, radius },
            ColliderShapeRef::OrientedBox(collider, rotation),
        ) => shape_cast_capsule_oriented_box(
            start,
            end,
            radius,
            motion,
            oriented_box_geometry(
                collider.center(collider_transform),
                collider.half_width,
                collider.half_height,
                rotation,
            )?,
        ),
        (
            CollisionQueryShape::Capsule { start, end, radius },
            ColliderShapeRef::Capsule(collider),
        ) => shape_cast_capsule_capsule(
            start,
            end,
            radius,
            motion,
            collider.start(collider_transform),
            collider.end(collider_transform),
            collider.radius,
        ),
        (
            CollisionQueryShape::Aabb(bounds),
            ColliderShapeRef::ConvexPolygon(collider, rotation),
        ) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(collider_transform, collider, rotation)?;
            shape_cast_aabb_convex_polygon(reference, bounds, motion, &vertices[..vertex_count])
        }
        (
            CollisionQueryShape::Circle { radius, .. },
            ColliderShapeRef::ConvexPolygon(collider, rotation),
        ) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(collider_transform, collider, rotation)?;
            shape_cast_circle_convex_polygon(reference, radius, motion, &vertices[..vertex_count])
        }
        (
            CollisionQueryShape::OrientedBox {
                center,
                half_width,
                half_height,
                rotation_radians,
            },
            ColliderShapeRef::ConvexPolygon(collider, target_rotation),
        ) => {
            let (vertices, vertex_count) = convex_polygon_collider_vertices_slice(
                collider_transform,
                collider,
                target_rotation,
            )?;
            shape_cast_oriented_box_convex_polygon(
                oriented_box_geometry(center, half_width, half_height, rotation_radians)?,
                motion,
                &vertices[..vertex_count],
            )
        }
        (
            CollisionQueryShape::Capsule { start, end, radius },
            ColliderShapeRef::ConvexPolygon(collider, rotation),
        ) => {
            let (vertices, vertex_count) =
                convex_polygon_collider_vertices_slice(collider_transform, collider, rotation)?;
            shape_cast_capsule_convex_polygon(start, end, radius, motion, &vertices[..vertex_count])
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices: moving_vertices,
                vertex_count: moving_vertex_count,
            },
            ColliderShapeRef::ConvexPolygon(collider, rotation),
        ) => {
            let moving_vertices = convex_polygon_vertices(&moving_vertices, moving_vertex_count)?;
            let (target_vertices, target_vertex_count) =
                convex_polygon_collider_vertices_slice(collider_transform, collider, rotation)?;
            shape_cast_convex_polygon_convex_polygon(
                moving_vertices,
                motion,
                &target_vertices[..target_vertex_count],
            )
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count,
            },
            ColliderShapeRef::Aabb(collider),
        ) => {
            let moving_vertices = convex_polygon_vertices(&vertices, vertex_count)?;
            shape_cast_convex_polygon_aabb(
                moving_vertices,
                motion,
                AabbBounds::from_transform(collider_transform, collider),
            )
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count,
            },
            ColliderShapeRef::Circle(collider),
        ) => {
            let moving_vertices = convex_polygon_vertices(&vertices, vertex_count)?;
            shape_cast_convex_polygon_circle(
                moving_vertices,
                motion,
                collider.center(collider_transform),
                collider.radius,
            )
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count,
            },
            ColliderShapeRef::OrientedBox(collider, rotation),
        ) => {
            let moving_vertices = convex_polygon_vertices(&vertices, vertex_count)?;
            shape_cast_convex_polygon_oriented_box(
                moving_vertices,
                motion,
                oriented_box_geometry(
                    collider.center(collider_transform),
                    collider.half_width,
                    collider.half_height,
                    rotation,
                )?,
            )
        }
        (
            CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count,
            },
            ColliderShapeRef::Capsule(collider),
        ) => {
            let moving_vertices = convex_polygon_vertices(&vertices, vertex_count)?;
            shape_cast_convex_polygon_capsule(
                moving_vertices,
                motion,
                collider.start(collider_transform),
                collider.end(collider_transform),
                collider.radius,
            )
        }
    }
}
