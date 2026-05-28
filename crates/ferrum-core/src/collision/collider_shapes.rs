use super::*;
use crate::components::{CompoundColliderRef, CompoundColliderShapeRef};

pub(crate) fn collider_shape(world: &World, index: usize) -> Option<ColliderShapeRef> {
    collider_shape_at(world, index, 0)
}

pub(crate) fn collider_shape_at(
    world: &World,
    index: usize,
    collider_index: usize,
) -> Option<ColliderShapeRef> {
    collider_shape_at_segment(world, index, collider_index, 0)
}

pub(super) fn collider_segment_count_at(
    world: &World,
    index: usize,
    collider_index: usize,
) -> usize {
    let Some(collider) = world.compound_collider_ref_at(index, collider_index) else {
        return 0;
    };
    match collider.shape {
        CompoundColliderShapeRef::Chain(collider) => collider.segment_count(),
        _ => 1,
    }
}

pub(super) fn collider_shape_at_segment(
    world: &World,
    index: usize,
    collider_index: usize,
    segment_index: usize,
) -> Option<ColliderShapeRef> {
    let collider = world.compound_collider_ref_at(index, collider_index)?;
    collider_shape_from_compound(world, index, collider, segment_index)
}

pub(super) fn collider_shape_from_compound(
    world: &World,
    index: usize,
    collider: CompoundColliderRef<'_>,
    segment_index: usize,
) -> Option<ColliderShapeRef> {
    if !collider.enabled() {
        return None;
    }
    match collider.shape {
        CompoundColliderShapeRef::Aabb(collider) => Some(ColliderShapeRef::Aabb(*collider)),
        CompoundColliderShapeRef::Circle(collider) => {
            is_valid_radius(collider.radius).then_some(ColliderShapeRef::Circle(*collider))
        }
        CompoundColliderShapeRef::OrientedBox(collider) => {
            (oriented_box_collider_is_valid(*collider)).then(|| {
                ColliderShapeRef::OrientedBox(
                    *collider,
                    oriented_box_total_rotation(world, index, *collider),
                )
            })
        }
        CompoundColliderShapeRef::Capsule(collider) => {
            capsule_collider_is_valid(*collider).then_some(ColliderShapeRef::Capsule(*collider))
        }
        CompoundColliderShapeRef::Edge(collider) => {
            edge_collider_is_valid(*collider).then_some(ColliderShapeRef::Edge(*collider))
        }
        CompoundColliderShapeRef::Chain(collider) => {
            chain_collider_segment(collider, segment_index).and_then(|segment| {
                edge_collider_is_valid(segment).then_some(ColliderShapeRef::Edge(segment))
            })
        }
        CompoundColliderShapeRef::ConvexPolygon(collider) => {
            (convex_polygon_collider_is_valid(*collider)).then(|| {
                ColliderShapeRef::ConvexPolygon(
                    *collider,
                    convex_polygon_total_rotation(world, index, *collider),
                )
            })
        }
    }
}

pub(super) fn collider_shape_is_valid(shape: ColliderShapeRef) -> bool {
    match shape {
        ColliderShapeRef::Aabb(collider) => collider.enabled,
        ColliderShapeRef::Circle(collider) => collider.enabled && is_valid_radius(collider.radius),
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            collider.enabled
                && oriented_box_collider_is_valid(collider)
                && rotation_radians.is_finite()
        }
        ColliderShapeRef::Capsule(collider) => {
            collider.enabled && capsule_collider_is_valid(collider)
        }
        ColliderShapeRef::Edge(collider) => collider.enabled && edge_collider_is_valid(collider),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            collider.enabled
                && convex_polygon_collider_is_valid(collider)
                && rotation_radians.is_finite()
        }
    }
}

pub(super) fn collider_shape_center(
    transform: Transform2D,
    shape: ColliderShapeRef,
) -> Transform2D {
    match shape {
        ColliderShapeRef::Aabb(collider) => collider.center(transform),
        ColliderShapeRef::Circle(collider) => collider.center(transform),
        ColliderShapeRef::OrientedBox(collider, _) => collider.center(transform),
        ColliderShapeRef::Capsule(collider) => collider.center(transform),
        ColliderShapeRef::Edge(collider) => collider.center(transform),
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            convex_polygon_collider_centroid(transform, collider, rotation_radians)
                .unwrap_or_else(|| collider.center(transform))
        }
    }
}

pub(super) fn collider_query_shape(
    transform: Transform2D,
    shape: ColliderShapeRef,
) -> Option<CollisionQueryShape> {
    match shape {
        ColliderShapeRef::Aabb(collider) => Some(CollisionQueryShape::Aabb(
            AabbBounds::from_transform(transform, collider),
        )),
        ColliderShapeRef::Circle(collider) => {
            is_valid_radius(collider.radius).then_some(CollisionQueryShape::Circle {
                center: collider.center(transform),
                radius: collider.radius,
            })
        }
        ColliderShapeRef::OrientedBox(collider, rotation_radians) => {
            oriented_box_collider_is_valid(collider).then_some(CollisionQueryShape::OrientedBox {
                center: collider.center(transform),
                half_width: collider.half_width,
                half_height: collider.half_height,
                rotation_radians,
            })
        }
        ColliderShapeRef::Capsule(collider) => {
            capsule_collider_is_valid(collider).then_some(CollisionQueryShape::Capsule {
                start: collider.start(transform),
                end: collider.end(transform),
                radius: collider.radius,
            })
        }
        ColliderShapeRef::Edge(collider) => {
            edge_collider_is_valid(collider).then_some(CollisionQueryShape::Capsule {
                start: collider.start(transform),
                end: collider.end(transform),
                radius: EDGE_COLLIDER_RADIUS,
            })
        }
        ColliderShapeRef::ConvexPolygon(collider, rotation_radians) => {
            let vertices = convex_polygon_collider_vertices(transform, collider, rotation_radians)?;
            Some(CollisionQueryShape::ConvexPolygon {
                vertices,
                vertex_count: collider.vertex_count,
            })
        }
    }
}

pub(super) fn edge_as_capsule(collider: EdgeCollider) -> CapsuleCollider {
    CapsuleCollider::new(
        collider.start_x,
        collider.start_y,
        collider.end_x,
        collider.end_y,
        EDGE_COLLIDER_RADIUS,
        collider.is_trigger,
        collider.layer,
    )
    .with_offset(collider.offset_x, collider.offset_y)
    .with_enabled(collider.enabled)
}

pub(super) fn chain_collider_segment(
    collider: &ChainCollider,
    segment_index: usize,
) -> Option<EdgeCollider> {
    if !collider.enabled {
        return None;
    }
    collider.segment(segment_index)
}

pub(super) fn oriented_box_collider_is_valid(collider: OrientedBoxCollider) -> bool {
    collider.enabled
        && is_valid_half_extent(collider.half_width)
        && is_valid_half_extent(collider.half_height)
        && collider.rotation_radians.is_finite()
}

pub(super) fn oriented_box_total_rotation(
    world: &World,
    index: usize,
    collider: OrientedBoxCollider,
) -> f32 {
    let entity_rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(|rotation| rotation.radians)
        .filter(|rotation| rotation.is_finite())
        .unwrap_or(0.0);
    collider.rotation_radians + entity_rotation
}

pub(super) fn convex_polygon_total_rotation(
    world: &World,
    index: usize,
    collider: ConvexPolygonCollider,
) -> f32 {
    let entity_rotation = world
        .rotations
        .get(index)
        .copied()
        .flatten()
        .map(|rotation| rotation.radians)
        .filter(|rotation| rotation.is_finite())
        .unwrap_or(0.0);
    collider.rotation_radians + entity_rotation
}
