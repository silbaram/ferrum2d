use super::*;
use crate::components::{CircleCollider, CollisionLayer, RigidBody, Transform2D};
use crate::physics3d::{
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Pose, Shape, Space, WorldConfig,
};

fn engine(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn body(e: &mut Engine) -> Entity {
    e.create_unified_body(
        BodyDesc::default(),
        ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
        [0.0; 3],
    )
    .unwrap()
}
fn fixture(e: &Engine, b: Entity) -> [u32; 4] {
    let c = e
        .query_unified_physics_colliders(b.id, b.generation)
        .unwrap();
    [b.id, b.generation, c[0], c[1]]
}
fn values() -> [f32; 18] {
    let mut v = [0.0; 18];
    v[6] = 1.0;
    v[7] = 1.0;
    v[8] = 0.5;
    v
}

#[test]
fn body_settings_preserve_motion_and_reject_invalid_values_before_mutation() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut e = engine(space);
        let b = body(&mut e);
        e.set_unified_body_velocity(b, [2.0, 0.0, 0.0], [0.0, 0.0, 3.0])
            .unwrap();
        let before = e.unified_body_state(b).unwrap();
        for (m, v) in [
            (vec![0, 3], vec![1.0, -1.0, 0.0]),
            (vec![0, 16], vec![0.0; 3]),
            (vec![4, 3], vec![0.0; 3]),
            (vec![0, 3], vec![f32::NAN, 0.0, 0.0]),
        ] {
            assert!(e
                .set_unified_physics_body_options(b.id, b.generation, &m, &v)
                .is_err());
            assert_eq!(e.unified_body_state(b).unwrap(), before);
            let r = e.unified_physics.as_ref().unwrap();
            assert_eq!(
                r.physics.body_kind(e.unified_body_id(b).unwrap()).unwrap(),
                BodyKind::Dynamic
            );
        }
        e.set_unified_physics_body_options(b.id, b.generation, &[1, 15], &[1.0, 0.0, 0.0])
            .unwrap();
        let s = e.unified_body_state(b).unwrap();
        assert_eq!(s.linear_velocity, before.linear_velocity);
        assert_eq!(s.angular_velocity, [0.0; 3]);
        assert!(e
            .set_unified_body_velocity(b, [0.0; 3], [0.0, 0.0, 1.0])
            .is_err());
        e.set_unified_physics_body_options(b.id, b.generation, &[1, 3], &[1.0, 0.0, 0.0])
            .unwrap();
        e.set_unified_body_velocity(b, [0.0; 3], [0.0, 0.0, 1.0])
            .unwrap();
        if space == Space::PlanarXy {
            assert!(e
                .set_unified_body_velocity(b, [0.0, 0.0, 1.0], [0.0; 3])
                .is_err());
        }
        e.remove_unified_body(b).unwrap();
        assert!(e
            .set_unified_physics_body_options(b.id, b.generation, &[1, 3], &[1.0, 0.0, 0.0])
            .is_err());
    }
}

#[test]
fn collider_edits_preserve_identity_enforce_owner_and_update_mass_immediately() {
    let mut e = engine(Space::Spatial);
    let b = body(&mut e);
    let other = body(&mut e);
    let h = fixture(&e, b);
    let mut v = values();
    v[7] = 0.0;
    e.update_unified_physics_collider(&h, &[0, 1, u32::MAX], &v, &[1], &[1.0])
        .unwrap();
    e.set_unified_physics_mass_properties(
        b.id,
        b.generation,
        &[2.0, 4.0, 4.0, 4.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0],
    )
    .unwrap();
    e.command_unified_physics_bodies(4, &[b.id, b.generation], &[4.0, 0.0, 0.0, 0.0, 0.0, 8.0])
        .unwrap();
    let s = e.unified_body_state(b).unwrap();
    assert!((s.linear_velocity[0] - 2.0).abs() < 1e-5);
    assert!((s.angular_velocity[2] - 2.0).abs() < 1e-5);
    assert_eq!(fixture(&e, b), h);
    assert!(e
        .remove_unified_physics_collider(other.id, other.generation, h[2], h[3])
        .is_err());
    assert!(e
        .update_unified_physics_collider(&h, &[0, 1, u32::MAX], &v, &[1], &[-1.0])
        .is_err());
    assert!(e
        .set_unified_physics_mass_properties(b.id, b.generation, &[0.0; 11])
        .is_err()); // Invalid unit quaternion.
    e.remove_unified_physics_collider(b.id, b.generation, h[2], h[3])
        .unwrap();
    assert!(e
        .query_unified_physics_colliders(b.id, b.generation)
        .unwrap()
        .is_empty());
    let c = e
        .add_unified_physics_collider(b.id, b.generation, &[0, 1, u32::MAX], &v, &[1], &[0.25])
        .unwrap();
    assert_ne!(c, &h[2..]);
    assert!(e
        .update_unified_physics_collider(&h, &[0, 1, u32::MAX], &v, &[1], &[0.5])
        .is_err());
}

#[test]
fn imported_component_ownership_rejects_mutation_without_partial_edits() {
    let mut e = Engine::new();
    e.activate_data_scene();
    let b = e.world.spawn_entity();
    e.world.set_transform(b, Transform2D { x: 0.0, y: 0.0 });
    e.world.set_rigid_body(b, RigidBody::dynamic(2.0));
    e.world
        .set_circle_collider(b, CircleCollider::new(1.0, false, CollisionLayer::Wall));
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        ..WorldConfig::default()
    })
    .unwrap();
    let h = fixture(&e, b);
    assert!(e
        .set_unified_physics_body_options(b.id, b.generation, &[0, 3], &[1.0, 0.0, 0.0])
        .unwrap_err()
        .contains("BodyOwnershipConflict"));
    assert!(e
        .add_unified_physics_collider(
            b.id,
            b.generation,
            &[0, 1, u32::MAX],
            &values(),
            &[1],
            &[1.0]
        )
        .is_err());
    assert!(e
        .update_unified_physics_collider(&h, &[0, 1, u32::MAX], &values(), &[1], &[2.0])
        .is_err());
    assert!(e
        .remove_unified_physics_collider(b.id, b.generation, h[2], h[3])
        .is_err());
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(fixture(&e, b), h);
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn controller_geometry_and_terrain_kind_rules_remain_native() {
    let mut e = engine(Space::Spatial);
    let b = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
            [0.0; 3],
        )
        .unwrap();
    e.enable_unified_character(b, CharacterConfig::default())
        .unwrap();
    let h = fixture(&e, b);
    assert!(e
        .set_unified_physics_body_options(b.id, b.generation, &[1, 3], &[1.0, 0.0, 0.0])
        .is_err());
    assert!(e
        .remove_unified_physics_collider(b.id, b.generation, h[2], h[3])
        .is_err());
    assert!(e
        .update_unified_physics_collider(&h, &[0, 1, u32::MAX], &values(), &[1], &[0.5])
        .is_err());
    assert!(e
        .add_unified_physics_collider(
            b.id,
            b.generation,
            &[0, 1, u32::MAX],
            &values(),
            &[1],
            &[0.5]
        )
        .is_err());
    let sensor = e
        .add_unified_physics_collider(
            b.id,
            b.generation,
            &[1, 1, u32::MAX],
            &values(),
            &[1],
            &[0.5],
        )
        .unwrap();
    e.remove_unified_physics_collider(b.id, b.generation, sensor[0], sensor[1])
        .unwrap();
    e.configure_unified_physics_character(b.id, b.generation, &[])
        .unwrap();
    e.set_unified_physics_body_options(b.id, b.generation, &[0, 3], &[1.0, 0.0, 0.0])
        .unwrap();
    e.update_unified_physics_collider(
        &h,
        &[0, 1, u32::MAX],
        &values(),
        &[4, 3, 1, 0, 1, 2],
        &[-1.0, 0.0, -1.0, 1.0, 0.0, -1.0, 0.0, 0.0, 1.0],
    )
    .unwrap();
    assert!(e
        .set_unified_physics_body_options(b.id, b.generation, &[1, 3], &[1.0, 0.0, 0.0])
        .is_err());
}

#[test]
fn removed_fixture_exit_keeps_old_identity_after_reuse() {
    let mut e = engine(Space::Spatial);
    e.set_unified_physics_collision_events_enabled(true)
        .unwrap();
    let b = body(&mut e);
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [0.5, 0.0, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc {
            sensor: true,
            ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
        },
        [0.0; 3],
    )
    .unwrap();
    e.update(0.01);
    e.drain_unified_physics_collision_events().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 1);
    let h = fixture(&e, b);
    e.remove_unified_physics_collider(b.id, b.generation, h[2], h[3])
        .unwrap();
    let new = e
        .add_unified_physics_collider(
            b.id,
            b.generation,
            &[0, 1, u32::MAX],
            &values(),
            &[1],
            &[0.5],
        )
        .unwrap();
    assert_ne!(&h[2..], new);
    e.drain_unified_physics_collision_events().unwrap();
    let rows = &e.unified_physics_collisions.rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].phase, 1);
    assert_eq!(rows[0].first.collider, [h[2], h[3]]);
}
