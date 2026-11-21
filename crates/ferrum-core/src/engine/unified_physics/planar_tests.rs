use super::*;
use crate::components::{
    AabbCollider, CircleCollider, CollisionLayer, CompoundCollider, CompoundColliderShape,
    PhysicsMaterial, RigidBody,
};
use crate::physics3d::{BodyKind, QueryFilter, RayCast, Shape};

fn configured(gravity: [f32; 3]) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
}
fn body(e: &mut Engine, x: f32, y: f32, rigid: RigidBody) -> Entity {
    let id = e.world.spawn_entity();
    e.world.set_transform(id, Transform2D { x, y });
    e.world.set_rigid_body(id, rigid);
    id
}
fn ball(e: &mut Engine, id: Entity, radius: f32) {
    e.world
        .set_circle_collider(id, CircleCollider::new(radius, false, CollisionLayer::Wall));
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.002, "{a} != {b}");
}

#[test]
fn existing_component_mass_inertia_and_inputs_reach_actual_engine_ticks_once() {
    let mut e = configured([0.0; 3]);
    let id = body(&mut e, 0.0, 0.0, RigidBody::dynamic(2.0).with_inertia(4.0));
    ball(&mut e, id, 3.0); // Volume must not override authored mass.
    e.world.apply_impulse(id, Velocity { vx: 4.0, vy: 0.0 });
    e.world.apply_angular_impulse(id, 8.0);
    e.world.apply_force(id, Velocity { vx: 12.0, vy: 0.0 });
    e.world.apply_torque(id, 24.0);
    tick(&mut e, 1);
    let s = e.unified_body_state(id).unwrap();
    near(s.linear_velocity[0], 2.1);
    near(s.angular_velocity[2], 2.1);
    tick(&mut e, 59);
    let s = e.unified_body_state(id).unwrap();
    near(s.linear_velocity[0], 2.1);
    near(s.angular_velocity[2], 2.1);
    assert!(s.pose.position[0] > 2.09 && s.pose.position[0] < 2.101);
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn configuring_imports_existing_bodies_without_consuming_pending_impulses() {
    let mut e = Engine::new();
    e.activate_data_scene();
    let id = body(&mut e, 0.0, 0.0, RigidBody::dynamic(2.0));
    e.world.apply_impulse(id, Velocity { vx: 4.0, vy: 0.0 });
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    near(e.unified_body_state(id).unwrap().linear_velocity[0], 0.0);
    tick(&mut e, 2);
    near(e.unified_body_state(id).unwrap().linear_velocity[0], 2.0);
    assert_eq!(e.world.rigid_body(id).unwrap().impulse, Velocity::default());
}

#[test]
fn imported_dynamic_body_collides_with_collider_only_ground() {
    let mut e = configured([0.0, 9.81, 0.0]);
    let floor = e.world.spawn_entity();
    e.world.set_transform(floor, Transform2D { x: 0.0, y: 3.0 });
    e.world.set_aabb_collider(
        floor,
        AabbCollider::new(10.0, 0.5, false, CollisionLayer::Wall),
    );
    let id = body(&mut e, 0.0, 0.0, RigidBody::dynamic_circle(1.0, 0.5));
    ball(&mut e, id, 0.5);
    tick(&mut e, 300);
    let s = e.unified_body_state(id).unwrap();
    near(s.pose.position[1], 2.0);
    assert!(s.sleeping, "{s:?}"); // Mirroring must not wake an idle body every tick.
    assert_eq!(e.world.rigid_body(id).unwrap().is_sleeping, s.sleeping);
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn authored_pose_velocity_mass_and_rotation_lock_edits_update_live_binding() {
    let mut e = configured([0.0; 3]);
    let id = body(&mut e, 0.0, 0.0, RigidBody::dynamic(2.0));
    tick(&mut e, 1);
    e.world.set_transform(id, Transform2D { x: 10.0, y: 2.0 });
    e.world.set_velocity(id, Velocity { vx: 3.0, vy: 0.0 });
    let mut rigid = RigidBody::dynamic(4.0).with_inertia(8.0);
    rigid.fixed_rotation = true;
    e.world.set_rigid_body(id, rigid);
    e.world.apply_impulse(id, Velocity { vx: 4.0, vy: 0.0 });
    e.world.apply_angular_impulse(id, 8.0);
    tick(&mut e, 1);
    let s = e.unified_body_state(id).unwrap();
    near(s.pose.position[0], 10.0 + 4.0 / 60.0);
    near(s.linear_velocity[0], 4.0);
    near(s.angular_velocity[2], 0.0);
    let mut rigid = e.world.rigid_body(id).unwrap();
    rigid.fixed_rotation = false;
    e.world.set_rigid_body(id, rigid);
    e.world.apply_angular_impulse(id, 8.0);
    tick(&mut e, 1);
    near(e.unified_body_state(id).unwrap().angular_velocity[2], 1.0);
}

#[test]
fn invalid_batch_does_not_partially_import_or_consume_other_body_inputs() {
    let mut e = configured([0.0; 3]);
    let good = body(&mut e, 0.0, 0.0, RigidBody::dynamic(2.0));
    let bad = body(&mut e, 10.0, 0.0, RigidBody::dynamic(1.0));
    ball(&mut e, bad, f32::NAN);
    e.world.apply_impulse(good, Velocity { vx: 4.0, vy: 0.0 });
    tick(&mut e, 1);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
    assert_eq!(e.world.rigid_body(good).unwrap().impulse.vx, 4.0);
    ball(&mut e, bad, 1.0);
    tick(&mut e, 1);
    near(e.unified_body_state(good).unwrap().linear_velocity[0], 2.0);
    near(
        e.unified_body_state(good).unwrap().pose.position[0],
        2.0 / 60.0,
    );
}

#[test]
fn disabled_body_and_fixture_edits_are_applied_without_replacing_body_identity() {
    let mut e = configured([0.0; 3]);
    let id = body(&mut e, 0.0, 0.0, RigidBody::kinematic());
    ball(&mut e, id, 1.0);
    e.world.set_velocity(id, Velocity { vx: 6.0, vy: 0.0 });
    tick(&mut e, 1);
    near(e.unified_body_state(id).unwrap().pose.position[0], 0.1);
    let native = e.unified_body_id(id).unwrap();
    let mut rigid = e.world.rigid_body(id).unwrap();
    rigid.enabled = false;
    e.world.set_rigid_body(id, rigid);
    tick(&mut e, 2);
    near(e.unified_body_state(id).unwrap().pose.position[0], 0.1);
    ball(&mut e, id, 2.0);
    rigid.enabled = true;
    e.world.set_rigid_body(id, rigid);
    tick(&mut e, 1);
    assert_eq!(e.unified_body_id(id).unwrap(), native);
    near(e.unified_body_state(id).unwrap().pose.position[0], 0.2);
    let runtime = e.unified_physics.as_mut().unwrap();
    let hit = runtime
        .physics
        .cast_ray(
            &RayCast {
                origin: [-5.0, 0.0, 0.0],
                direction: [1.0, 0.0, 0.0],
                max_distance: 10.0,
                solid: true,
            },
            &QueryFilter::default(),
        )
        .unwrap()
        .unwrap();
    near(hit.distance, 3.2);
}

#[test]
fn native_and_imported_bodies_share_contacts_and_generation_safe_lifecycle() {
    let mut e = configured([0.0, 9.81, 0.0]);
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [0.0, 3.0, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [10.0, 0.5, 0.5],
        }),
        [0.0; 3],
    )
    .unwrap();
    let id = body(&mut e, 0.0, 0.0, RigidBody::dynamic(1.0));
    ball(&mut e, id, 0.5);
    tick(&mut e, 240);
    near(e.unified_body_state(id).unwrap().pose.position[1], 2.0);
    e.world.despawn(id);
    let next = body(&mut e, 5.0, 0.0, RigidBody::kinematic());
    assert_eq!(id.id, next.id);
    assert_ne!(id.generation, next.generation);
    tick(&mut e, 1);
    assert_eq!(
        e.unified_body_state(id),
        Err(UnifiedPhysicsError::StaleEntity)
    );
    near(e.unified_body_state(next).unwrap().pose.position[0], 5.0);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 2);
}

#[test]
fn compound_density_cannot_change_explicit_planar_mass_and_invalid_material_is_visible() {
    let mut e = configured([0.0; 3]);
    let id = body(&mut e, 0.0, 0.0, RigidBody::dynamic(2.0));
    ball(&mut e, id, 1.0);
    e.world.add_compound_collider(
        id,
        CompoundCollider::new(CompoundColliderShape::Circle(
            CircleCollider::new(5.0, true, CollisionLayer::Wall).with_offset(20.0, 0.0),
        ))
        .with_material(PhysicsMaterial::DEFAULT.with_density(100.0)),
    );
    tick(&mut e, 1);
    e.apply_unified_body_impulse(id, [2.0, 0.0, 0.0]).unwrap();
    tick(&mut e, 1);
    near(e.unified_body_state(id).unwrap().linear_velocity[0], 1.0);
    e.world.set_compound_collider_material(
        id,
        1,
        PhysicsMaterial::DEFAULT.with_contact_position_correction_scale(f32::NAN),
    );
    let before = e.unified_body_state(id).unwrap();
    tick(&mut e, 1);
    assert_eq!(e.unified_body_state(id).unwrap(), before);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidCollider))
    );
}

#[test]
fn every_imported_shape_uses_body_local_offsets_and_matches_legacy_ray_queries() {
    use crate::collision::CollisionSystem;
    use crate::components::{
        CapsuleCollider, ChainCollider, CollisionMask, ConvexPolygonCollider, EdgeCollider,
        OrientedBoxCollider, MAX_CHAIN_COLLIDER_VERTICES, MAX_CONVEX_POLYGON_VERTICES,
    };
    let layer = CollisionLayer::Wall;
    let mut polygon = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    polygon[..4].copy_from_slice(&[
        Transform2D { x: -2.0, y: -0.5 },
        Transform2D { x: 2.0, y: -0.5 },
        Transform2D { x: 2.0, y: 0.5 },
        Transform2D { x: -2.0, y: 0.5 },
    ]);
    let mut chain = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    chain[..3].copy_from_slice(&[
        Transform2D { x: -2.0, y: 0.0 },
        Transform2D { x: 0.0, y: 0.0 },
        Transform2D { x: 2.0, y: 0.0 },
    ]);
    let shapes = [
        CompoundColliderShape::Aabb(
            AabbCollider::new(2.0, 0.5, false, layer).with_offset(2.0, 0.0),
        ),
        CompoundColliderShape::Circle(CircleCollider::new(0.5, false, layer).with_offset(2.0, 0.0)),
        CompoundColliderShape::OrientedBox(
            OrientedBoxCollider::new(2.0, 0.5, 0.2, false, layer).with_offset(2.0, 0.0),
        ),
        CompoundColliderShape::Capsule(
            CapsuleCollider::new(-2.0, 0.0, 2.0, 0.0, 0.5, false, layer).with_offset(2.0, 0.0),
        ),
        CompoundColliderShape::Edge(
            EdgeCollider::new(-2.0, 0.0, 2.0, 0.0, false, layer).with_offset(2.0, 0.0),
        ),
        CompoundColliderShape::Chain(
            ChainCollider::new(chain, 3, false, false, layer).with_offset(2.0, 0.0),
        ),
        CompoundColliderShape::ConvexPolygon(
            ConvexPolygonCollider::new(polygon, 4, false, layer).with_offset(2.0, 0.0),
        ),
    ];
    for (index, shape) in shapes.into_iter().enumerate() {
        let mut e = configured([0.0; 3]);
        let id = body(&mut e, 0.0, 0.0, RigidBody::static_body());
        e.world
            .add_compound_collider(id, CompoundCollider::new(shape));
        for angle in [std::f32::consts::FRAC_PI_2, 0.37] {
            e.world.set_rotation(id, Rotation2D { radians: angle });
            tick(&mut e, 1);
            assert_eq!(e.unified_physics_error(), None, "shape {index}");
            let (s, c) = angle.sin_cos();
            let origin = Transform2D {
                x: 2.0 * c + 5.0 * s,
                y: 2.0 * s - 5.0 * c,
            };
            let direction = Velocity { vx: -s, vy: c };
            let legacy =
                CollisionSystem::raycast(&e.world, origin, direction, 10.0, CollisionMask::ALL)
                    .unwrap_or_else(|| panic!("legacy shape {index}"));
            let native = e
                .unified_physics
                .as_mut()
                .unwrap()
                .physics
                .cast_ray(
                    &RayCast {
                        origin: [origin.x, origin.y, 0.0],
                        direction: [direction.vx, direction.vy, 0.0],
                        max_distance: 10.0,
                        solid: true,
                    },
                    &QueryFilter::default(),
                )
                .unwrap()
                .unwrap_or_else(|| panic!("native shape {index}"));
            near(native.distance, legacy.distance);
            assert!(
                native.distance > 4.0 && native.distance < 5.001,
                "shape {index}: {native:?}"
            );
        }
    }
}

#[test]
fn removing_components_releases_ownership_and_new_kinematic_moves_only_once() {
    let mut e = configured([0.0; 3]);
    let id = body(&mut e, 0.0, 0.0, RigidBody::kinematic());
    e.world.set_velocity(id, Velocity { vx: 6.0, vy: 0.0 });
    tick(&mut e, 1);
    near(e.unified_body_state(id).unwrap().pose.position[0], 0.1);
    e.world.clear_rigid_body(id);
    tick(&mut e, 1);
    assert_eq!(
        e.unified_body_state(id),
        Err(UnifiedPhysicsError::StaleEntity)
    );
    assert!(!e
        .world
        .unified_physics_entities
        .contains(&(id.id, id.generation)));
    tick(&mut e, 1);
    near(e.world.transform(id).unwrap().x, 0.2);
}
