use super::*;
use crate::components::gameplay::MovementPattern;
use crate::components::{AabbCollider, CircleCollider, CollisionLayer, RigidBody};
use crate::physics3d::{BodyKind, SolverSettings};

fn scene() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_physics_spec_planar(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        solver: SolverSettings {
            velocity_iterations: 1,
            position_iterations: 1,
            continuous: false,
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap();
    e.set_auto_rigid_body_step_enabled(true);
    e
}
fn actor(e: &mut Engine, x: f32, y: f32) -> Entity {
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x, y });
    e.world
        .set_circle_collider(a, CircleCollider::new(0.25, false, CollisionLayer::Enemy));
    a
}
fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(0.01);
        assert_eq!(e.unified_physics_error(), None);
    }
}
fn consistent(e: &Engine, a: Entity, x: f32, y: f32) {
    let p = e.world.transform(a).unwrap();
    assert!((p.x - x).abs() < 0.002 && (p.y - y).abs() < 0.002, "{p:?}");
    assert_eq!(
        e.unified_body_state(a).unwrap().pose.position,
        [p.x, p.y, 0.]
    );
}

#[test]
fn arcade_native_cold_collider_only_velocity_moves_exactly_once() {
    let mut e = scene();
    let a = actor(&mut e, 10., 10.);
    e.world.set_velocity(a, Velocity { vx: 2., vy: 1. });
    tick(&mut e, 1);
    consistent(&e, a, 10.02, 10.01);
    assert!(e.world.rigid_body(a).is_none());
    let id = e.unified_body_id(a).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .body_kind(id)
            .unwrap(),
        BodyKind::KinematicVelocity
    );
    tick(&mut e, 2);
    consistent(&e, a, 10.06, 10.03);
}

#[test]
fn arcade_native_non_physics_velocity_and_static_colliders_keep_their_owners() {
    let mut e = scene();
    let wall = actor(&mut e, 10., 10.);
    let logical = e.world.spawn_entity();
    e.world
        .set_transform(logical, Transform2D { x: 20., y: 20. });
    e.world.set_velocity(logical, Velocity { vx: 2., vy: 0. });
    tick(&mut e, 2);
    consistent(&e, wall, 10., 10.);
    let id = e.unified_body_id(wall).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .body_kind(id)
            .unwrap(),
        BodyKind::Fixed
    );
    assert!((e.world.transform(logical).unwrap().x - 20.04).abs() < 0.002);
    assert!(e.unified_body_id(logical).is_err());
}

#[test]
fn arcade_native_ai_without_rigid_component_steers_and_accelerates_once() {
    let mut e = scene();
    let primary = actor(&mut e, 100., 100.);
    assert!(e.configure_data_scene_gameplay_v2(true, primary.id, primary.generation, 0, true));
    let a = actor(&mut e, 10., 10.);
    e.world.set_movement_pattern(
        a,
        MovementPattern::Accelerate {
            acceleration_x: 1.,
            acceleration_y: 0.,
            max_speed: 10.,
        },
    );
    tick(&mut e, 3);
    consistent(&e, a, 10.06, 10.);
    assert_eq!(e.world.velocity(a).unwrap().vx, 3.);
    assert!(e.world.rigid_body(a).is_none());
}

#[test]
fn arcade_native_implicit_convex_motion_sweeps_against_native_wall() {
    let mut e = scene();
    let a = actor(&mut e, 0.5, 0.5);
    e.world.set_velocity(a, Velocity { vx: 300., vy: 200. });
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [2., 2., 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        ColliderDesc::new(crate::physics3d::Shape::Box {
            half_extents: [0.25, 4., 2.],
        }),
        [0.; 3],
    )
    .unwrap();
    tick(&mut e, 1);
    consistent(&e, a, 1.5, 2.5);
    assert_eq!(e.world.velocity(a), Some(Velocity { vx: 300., vy: 200. }));
}

#[test]
fn arcade_native_implicit_role_survives_zero_velocity_checkpoint_and_restarts() {
    let mut e = scene();
    let a = actor(&mut e, 10., 10.);
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    tick(&mut e, 1);
    e.world.set_velocity(a, Velocity::default());
    tick(&mut e, 1);
    let id = e.unified_body_id(a).unwrap();
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .body_kind(id)
            .unwrap(),
        BodyKind::KinematicVelocity
    );
    let cp = e.capture_runtime_checkpoint().unwrap();
    e.world.set_velocity(a, Velocity { vx: 3., vy: 0. });
    tick(&mut e, 2);
    let expected = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .capture_snapshot()
        .unwrap()
        .encoded_bytes()
        .to_vec();
    assert!(e.restore_runtime_checkpoint(&cp));
    e.world.set_velocity(a, Velocity { vx: 3., vy: 0. });
    tick(&mut e, 2);
    assert_eq!(e.unified_body_id(a).unwrap(), id);
    consistent(&e, a, 10.08, 10.);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        expected
    );
}

#[test]
fn arcade_native_manual_mode_freezes_physics_until_explicit_step() {
    let mut e = scene();
    e.set_auto_rigid_body_step_enabled(false);
    let a = actor(&mut e, 10., 10.);
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    e.update(0.02);
    assert_eq!(e.world.transform(a), Some(Transform2D { x: 10., y: 10. }));
    e.step_rigid_bodies(0.01);
    consistent(&e, a, 10.02, 10.);
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn arcade_native_explicit_type_wins_and_removed_rigid_drops_controller_overrides() {
    let mut e = scene();
    let a = actor(&mut e, 10., 10.);
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    tick(&mut e, 1);
    let id = e.unified_body_id(a).unwrap();
    e.world.set_rigid_body(a, RigidBody::kinematic());
    assert!(e.configure_data_scene_kinematic_controller(
        a.id,
        a.generation,
        false,
        u32::MAX,
        8,
        4.,
        4.,
        true
    ));
    e.world.clear_rigid_body(a);
    tick(&mut e, 1);
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .settings
        .is_empty());
    e.world.set_rigid_body(a, RigidBody::static_body());
    e.world.set_velocity(a, Velocity::default());
    tick(&mut e, 1);
    assert_eq!(e.unified_body_id(a).unwrap(), id);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .body_kind(id)
            .unwrap(),
        BodyKind::Fixed
    );
}

#[test]
fn arcade_native_cold_invalid_component_does_not_move_before_rejected_import() {
    let mut e = scene();
    let a = actor(&mut e, 10., 10.);
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(f32::NAN, 1., false, CollisionLayer::Enemy),
    );
    e.update(0.01);
    assert!(e.unified_physics_error().is_some());
    assert_eq!(e.world.transform(a), Some(Transform2D { x: 10., y: 10. }));
    assert!(e.unified_body_id(a).is_err());
}

#[test]
fn arcade_native_legacy_variable_scene_does_not_implicitly_enable_a_backend() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_data_scene();
    let a = actor(&mut e, 10., 10.);
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    e.update(0.25);
    assert!((e.world.transform(a).unwrap().x - 10.5).abs() < 0.002);
    assert!(!e.physics_spec_backend_active());
    assert!(!e.fixed_timestep_enabled);
}

#[test]
fn arcade_native_spatial_world_does_not_claim_unimported_planar_collider_motion() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    let a = actor(&mut e, 10., 10.);
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    tick(&mut e, 1);
    assert!((e.world.transform(a).unwrap().x - 10.02).abs() < 0.002);
    assert!(e.unified_body_id(a).is_err());
}

#[test]
fn arcade_native_angular_only_collider_keeps_unwrapped_rotation_and_stable_role() {
    let mut e = scene();
    let a = actor(&mut e, 10., 10.);
    let angle = 4. * std::f32::consts::PI;
    e.world.set_rotation(a, Rotation2D { radians: angle });
    e.world.set_angular_velocity(
        a,
        AngularVelocity {
            radians_per_second: 1.,
        },
    );
    tick(&mut e, 1);
    let id = e.unified_body_id(a).unwrap();
    consistent(&e, a, 10., 10.);
    assert!((e.world.rotations[a.id as usize].unwrap().radians - angle - 0.01).abs() < 0.002);
    e.world.set_angular_velocity(a, AngularVelocity::default());
    tick(&mut e, 1);
    assert_eq!(e.unified_body_id(a).unwrap(), id);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .body_kind(id)
            .unwrap(),
        BodyKind::KinematicVelocity
    );
    assert!((e.world.rotations[a.id as usize].unwrap().radians - angle - 0.01).abs() < 0.002);
}
