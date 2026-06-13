use super::*;
use crate::components::{
    CapsuleCollider, CircleCollider, CollisionFilter, CollisionLayer, CollisionMask,
    CompoundCollider, CompoundColliderShape, ConvexPolygonCollider, EdgeCollider, HeightSpan,
    OrientedBoxCollider, PhysicsFloorId,
};

mod area_queries;
mod compound_colliders;
mod contact_builders;
mod debug_lines;
mod height_spans;
mod manifold_basic;
mod manifold_capsule;
mod manifold_convex;
mod manifold_oriented_box;
mod nearest_queries;
mod overlap_basics;
mod pair_filters;
mod point_queries;
mod raycasts;
mod shape_cast;
mod shape_queries;
mod swept;

fn collider(half_width: f32, half_height: f32) -> AabbCollider {
    AabbCollider {
        half_width,
        half_height,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: true,
        layer: CollisionLayer::Enemy,
    }
}

fn circle(radius: f32) -> CircleCollider {
    CircleCollider {
        radius,
        offset_x: 0.0,
        offset_y: 0.0,
        enabled: true,
        is_trigger: true,
        layer: CollisionLayer::Enemy,
    }
}

fn capsule(start_x: f32, start_y: f32, end_x: f32, end_y: f32, radius: f32) -> CapsuleCollider {
    CapsuleCollider::new(
        start_x,
        start_y,
        end_x,
        end_y,
        radius,
        true,
        CollisionLayer::Enemy,
    )
}

fn edge(start_x: f32, start_y: f32, end_x: f32, end_y: f32) -> EdgeCollider {
    EdgeCollider::new(start_x, start_y, end_x, end_y, true, CollisionLayer::Enemy)
}

fn oriented_box(half_width: f32, half_height: f32, rotation_radians: f32) -> OrientedBoxCollider {
    OrientedBoxCollider::new(
        half_width,
        half_height,
        rotation_radians,
        true,
        CollisionLayer::Enemy,
    )
}

fn convex_polygon(points: &[(f32, f32)]) -> CollisionQueryShape {
    let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    for (index, (x, y)) in points.iter().copied().enumerate() {
        vertices[index] = Transform2D { x, y };
    }
    CollisionQueryShape::ConvexPolygon {
        vertices,
        vertex_count: points.len() as u32,
    }
}

fn convex_polygon_collider(points: &[(f32, f32)]) -> ConvexPolygonCollider {
    let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    for (index, (x, y)) in points.iter().copied().enumerate() {
        vertices[index] = Transform2D { x, y };
    }
    ConvexPolygonCollider::new(vertices, points.len() as u32, true, CollisionLayer::Enemy)
}

fn spawn_custom_body(
    world: &mut World,
    x: f32,
    y: f32,
    category: CollisionMask,
    mask: CollisionMask,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_aabb_collider(
        entity,
        AabbCollider {
            half_width: 5.0,
            half_height: 5.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: true,
            layer: CollisionLayer::Player,
        },
    );
    world.set_collision_filter(entity, CollisionFilter::new(category, mask));
    entity
}

fn spawn_custom_circle(
    world: &mut World,
    x: f32,
    y: f32,
    radius: f32,
    category: CollisionMask,
    mask: CollisionMask,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_circle_collider(entity, circle(radius));
    world.set_collision_filter(entity, CollisionFilter::new(category, mask));
    entity
}

fn spawn_custom_capsule(
    world: &mut World,
    x: f32,
    y: f32,
    collider: CapsuleCollider,
    category: CollisionMask,
    mask: CollisionMask,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_capsule_collider(entity, collider);
    world.set_collision_filter(entity, CollisionFilter::new(category, mask));
    entity
}

fn spawn_custom_edge(
    world: &mut World,
    x: f32,
    y: f32,
    collider: EdgeCollider,
    category: CollisionMask,
    mask: CollisionMask,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_edge_collider(entity, collider);
    world.set_collision_filter(entity, CollisionFilter::new(category, mask));
    entity
}

fn spawn_custom_chain(
    world: &mut World,
    x: f32,
    y: f32,
    collider: ChainCollider,
    category: CollisionMask,
    mask: CollisionMask,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_chain_collider(entity, collider);
    world.set_collision_filter(entity, CollisionFilter::new(category, mask));
    entity
}

fn spawn_custom_oriented_box(
    world: &mut World,
    x: f32,
    y: f32,
    collider: OrientedBoxCollider,
    category: CollisionMask,
    mask: CollisionMask,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_oriented_box_collider(entity, collider);
    world.set_collision_filter(entity, CollisionFilter::new(category, mask));
    entity
}

fn spawn_custom_convex_polygon(
    world: &mut World,
    x: f32,
    y: f32,
    collider: ConvexPolygonCollider,
    category: CollisionMask,
    mask: CollisionMask,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_convex_polygon_collider(entity, collider);
    world.set_collision_filter(entity, CollisionFilter::new(category, mask));
    entity
}

fn chain(points: &[(f32, f32)], looped: bool) -> ChainCollider {
    let mut vertices =
        [Transform2D { x: 0.0, y: 0.0 }; crate::components::MAX_CHAIN_COLLIDER_VERTICES];
    for (index, (x, y)) in points.iter().copied().enumerate() {
        vertices[index] = Transform2D { x, y };
    }
    ChainCollider::new(
        vertices,
        points.len() as u32,
        looped,
        false,
        CollisionLayer::Wall,
    )
}
