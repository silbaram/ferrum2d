use super::*;

mod rigid_body_ccd_aabb;
mod rigid_body_ccd_convex;
mod rigid_body_ccd_shape_pairs;
mod rigid_body_ccd_wake_repeat;

fn spawn_fast_dynamic_convex_polygon_ccd_mover(world: &mut World) -> Entity {
    let collider = convex_polygon_collider(&[(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)]);
    let entity = spawn_static_convex_polygon(world, 0.0, 0.0, collider);
    world.set_collision_filter(
        entity,
        CollisionFilter::new(CollisionLayer::Player.mask(), CollisionMask::ALL),
    );
    world.set_velocity(entity, Velocity { vx: 100.0, vy: 0.0 });
    world.set_rigid_body(
        entity,
        RigidBody::dynamic_convex_polygon(1.0, collider.vertices, collider.vertex_count)
            .with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    entity
}
