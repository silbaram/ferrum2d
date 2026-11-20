use super::*;
use crate::components as c;
use crate::physics3d::{Shape, SolverSettings};

fn auto(e: &mut Engine, enabled: bool, gy: f32, threshold: f32) {
    e.configure_auto_rigid_body_step(
        enabled, 0.0, gy, 6, 3, 0.8, 0.01, threshold, 0.2, 120.0, false, true,
    );
}
fn setup(gy: f32) -> (Engine, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0, gy, 0.0],
        ..WorldConfig::default()
    })
    .unwrap();
    let b = e.world.spawn_entity();
    e.world.set_transform(b, Transform2D::default());
    e.world.set_rigid_body(b, c::RigidBody::dynamic(2.0));
    (e, b)
}
fn dt(e: &Engine) -> f32 {
    e.fixed_timestep.config().step_seconds
}
fn tick(e: &mut Engine) {
    e.update(f64::from(dt(e)));
}

#[test]
fn solver_settings_manual_step_uses_native_world_while_auto_disabled_and_preserves_invalid_inputs()
{
    let (mut e, b) = setup(-6.0);
    auto(&mut e, false, -6.0, 1.0);
    e.world.apply_impulse(b, Velocity { vx: 2.0, vy: 0.0 });
    tick(&mut e);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
    e.step_rigid_bodies(dt(&e));
    let s = e.unified_body_state(b).unwrap();
    assert!((s.linear_velocity[0] - 1.0).abs() < 1e-5);
    assert!((s.linear_velocity[1] + 0.1).abs() < 1e-5);
    assert_eq!(e.world.rigid_body(b).unwrap().impulse, Velocity::default());
    tick(&mut e);
    assert_eq!(e.unified_body_state(b).unwrap(), s);
    e.world.apply_impulse(b, Velocity { vx: 2.0, vy: 0.0 });
    for invalid in [0.0, dt(&e) * 2.0, -1.0, f32::NAN] {
        e.step_rigid_bodies(invalid);
        assert_eq!(e.unified_body_state(b).unwrap(), s);
        assert_eq!(e.world.rigid_body(b).unwrap().impulse.vx, 2.0);
    }
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    e.step_rigid_bodies(dt(&e));
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    assert_eq!(
        e.take_unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    assert_eq!(e.unified_physics_error(), None);
    assert!((e.unified_body_state(b).unwrap().linear_velocity[0] - 2.0).abs() < 1e-5);
}

#[test]
fn solver_settings_gravity_change_is_not_cancelled_by_projected_sleep_state() {
    let (mut e, b) = setup(0.0);
    e.world.rigid_bodies[b.id as usize]
        .as_mut()
        .unwrap()
        .is_sleeping = true;
    tick(&mut e);
    assert!(e.unified_body_state(b).unwrap().sleeping);
    assert!(e.world.rigid_body(b).unwrap().is_sleeping);
    auto(&mut e, true, -6.0, 1.0);
    tick(&mut e);
    let s = e.unified_body_state(b).unwrap();
    assert!(!s.sleeping);
    assert!(!e.world.rigid_body(b).unwrap().is_sleeping);
    assert!((s.linear_velocity[1] + 0.1).abs() < 1e-5, "{s:?}");
    let saved = e.auto_rigid_body_step_config;
    auto(&mut e, false, 2e6, 1.0);
    assert_eq!(e.auto_rigid_body_step_config, saved);
    assert!(e.auto_rigid_body_step_enabled);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidConfig))
    );
}

#[test]
fn solver_settings_one_shot_manual_config_preserves_auto_settings_and_fixed_clock_accumulator() {
    let (mut e, b) = setup(-6.0);
    e.update(f64::from(dt(&e) * 0.5));
    let accumulated = e.fixed_timestep.accumulated_seconds();
    let saved = e.auto_rigid_body_step_config;
    e.step_rigid_bodies_with_config(
        dt(&e),
        0.0,
        12.0,
        12,
        4,
        0.8,
        0.01,
        2.0,
        0.2,
        120.0,
        false,
        false,
    );
    assert_eq!(e.fixed_timestep.accumulated_seconds(), accumulated);
    assert_eq!(e.auto_rigid_body_step_config, saved);
    assert_eq!(
        e.unified_physics.as_ref().unwrap().physics.config().gravity,
        [0.0, -6.0, 0.0]
    );
    assert!((e.unified_body_state(b).unwrap().linear_velocity[1] - 0.2).abs() < 1e-5);
    e.update(f64::from(dt(&e) * 0.5));
    assert!((e.unified_body_state(b).unwrap().linear_velocity[1] - 0.1).abs() < 1e-5);
}

#[test]
fn solver_settings_existing_engine_threshold_gates_slow_bounces() {
    for threshold in [1.0, 3.0] {
        let (mut e, b) = setup(0.0);
        e.configure_auto_rigid_body_step(
            true, 0.0, 0.0, 6, 3, 0.0, 0.0, threshold, 0.0, 0.0, false, true,
        );
        e.world.set_transform(b, Transform2D { x: 0.0, y: 0.495 });
        e.world.set_circle_collider(
            b,
            c::CircleCollider::new(0.5, false, c::CollisionLayer::Wall),
        );
        e.world
            .set_collider_material(b, c::PhysicsMaterial::new(0.1, 0.0));
        e.world.set_velocity(b, Velocity { vx: 0.0, vy: -2.0 });
        let floor = e.world.spawn_entity();
        e.world
            .set_transform(floor, Transform2D { x: 0.0, y: -0.5 });
        e.world.set_aabb_collider(
            floor,
            c::AabbCollider::new(5.0, 0.5, false, c::CollisionLayer::Wall),
        );
        tick(&mut e);
        let expected = if threshold == 1.0 { 0.2 } else { 0.0 };
        assert!((e.unified_body_state(b).unwrap().linear_velocity[1] - expected).abs() < 0.005);
    }
}

#[test]
fn solver_settings_spatial_xyz_and_scene_exit_preserve_configuration_ownership() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.activate_data_scene();
    auto(&mut e, false, 42.0, 2.0);
    let previous = e.auto_rigid_body_step_config;
    e.configure_unified_physics(WorldConfig {
        gravity: [0.0, -6.0, 3.0],
        ..WorldConfig::default()
    })
    .unwrap();
    let b = e
        .create_unified_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.0; 3],
        )
        .unwrap();
    auto(&mut e, true, -12.0, 1.0);
    tick(&mut e);
    let s = e.unified_body_state(b).unwrap();
    assert!(
        (s.linear_velocity[1] + 0.2).abs() < 1e-5 && (s.linear_velocity[2] - 0.05).abs() < 1e-5
    );
    e.set_unified_runtime_settings([6.0, 0.0, 0.0], SolverSettings::default())
        .unwrap();
    tick(&mut e);
    assert!((e.unified_body_state(b).unwrap().linear_velocity[0] - 0.1).abs() < 1e-5);
    e.use_breakout_scene();
    assert_eq!(e.auto_rigid_body_step_config, previous);
    assert!(!e.auto_rigid_body_step_enabled);
}
