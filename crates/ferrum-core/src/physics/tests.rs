use super::math::velocity_len_squared;
use super::solver::CONTACT_IMPULSE_EPSILON;
use super::*;
use crate::components::{
    AabbCollider, AngularVelocity, CapsuleCollider, CircleCollider, CollisionFilter,
    CollisionLayer, CollisionMask, CompoundCollider, CompoundColliderShape, ConvexPolygonCollider,
    DistanceJoint, GearJoint, OrientedBoxCollider, PhysicsMaterial, PrismaticJoint, PulleyJoint,
    RevoluteJoint, RigidBody, RopeJoint, Rotation2D, SpringJoint, Transform2D, Velocity, WeldJoint,
    MAX_CONVEX_POLYGON_VERTICES,
};

mod basics;
mod contact_block_solver;
mod kinematic_platformer;
mod rigid_body_ccd;
mod rigid_body_contact_bias;
mod rigid_body_contact_response;
mod rigid_body_integration;
mod rigid_body_islands;
mod rigid_body_joints;
mod rigid_body_position_correction;
mod rigid_body_sleep_wake;

fn spawn_kinematic_body(
    world: &mut World,
    x: f32,
    y: f32,
    layer: CollisionLayer,
    is_trigger: bool,
) -> Entity {
    spawn_kinematic_body_with_size(world, x, y, layer, is_trigger, 5.0, 5.0)
}

fn spawn_dynamic_body(world: &mut World, x: f32, y: f32, half_extent: f32) -> Entity {
    let entity = spawn_kinematic_body_with_size(
        world,
        x,
        y,
        CollisionLayer::Player,
        false,
        half_extent,
        half_extent,
    );
    world.set_rigid_body(entity, RigidBody::dynamic(1.0));
    entity
}

fn spawn_dynamic_capsule(world: &mut World, x: f32, y: f32, collider: CapsuleCollider) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_capsule_collider(entity, collider);
    world.set_collision_filter(
        entity,
        CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(entity, RigidBody::dynamic(1.0));
    entity
}

fn spawn_dynamic_circle(world: &mut World, x: f32, y: f32, radius: f32) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_circle_collider(
        entity,
        CircleCollider {
            radius,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Player,
        },
    );
    world.set_collision_filter(
        entity,
        CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(
        entity,
        RigidBody::dynamic_circle(1.0, radius)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    entity
}

fn spawn_dynamic_oriented_box(
    world: &mut World,
    x: f32,
    y: f32,
    collider: OrientedBoxCollider,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_oriented_box_collider(entity, collider);
    world.set_collision_filter(
        entity,
        CollisionFilter::new(collider.layer.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(entity, RigidBody::dynamic(1.0));
    entity
}

fn spawn_static_convex_polygon(
    world: &mut World,
    x: f32,
    y: f32,
    collider: ConvexPolygonCollider,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_convex_polygon_collider(entity, collider);
    world.set_collision_filter(
        entity,
        CollisionFilter::new(collider.layer.mask(), CollisionMask::ALL),
    );
    world.set_rigid_body(entity, RigidBody::static_body());
    entity
}

fn convex_polygon_collider(points: &[(f32, f32)]) -> ConvexPolygonCollider {
    let mut vertices = [Transform2D { x: 0.0, y: 0.0 }; MAX_CONVEX_POLYGON_VERTICES];
    for (index, (x, y)) in points.iter().copied().enumerate() {
        vertices[index] = Transform2D { x, y };
    }
    ConvexPolygonCollider::new(vertices, points.len() as u32, false, CollisionLayer::Wall)
}

fn spawn_kinematic_body_with_size(
    world: &mut World,
    x: f32,
    y: f32,
    layer: CollisionLayer,
    is_trigger: bool,
    half_width: f32,
    half_height: f32,
) -> Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_aabb_collider(
        entity,
        AabbCollider {
            half_width,
            half_height,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        },
    );
    world.set_collision_filter(
        entity,
        CollisionFilter::new(layer.mask(), CollisionMask::ALL),
    );
    entity
}
