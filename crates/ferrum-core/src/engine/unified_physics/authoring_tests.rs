use super::*;
use crate::components::{AabbCollider, CollisionLayer, DistanceJoint, RigidBody};

fn configured(space: Space, max_bodies: usize) -> Engine {
    let mut engine = Engine::new();
    engine.activate_data_scene();
    engine
        .configure_unified_physics(WorldConfig {
            space,
            max_bodies,
            gravity: [0.; 3],
            ..Default::default()
        })
        .unwrap();
    engine.set_auto_rigid_body_step_enabled(false);
    engine
}
fn component(engine: &mut Engine, x: f32) -> Entity {
    let entity = engine.world.spawn_entity();
    engine.world.set_transform(entity, Transform2D { x, y: 0. });
    engine.world.set_rigid_body(entity, RigidBody::dynamic(1.));
    engine.world.set_aabb_collider(
        entity,
        AabbCollider::new(0.5, 0.5, false, CollisionLayer::Wall),
    );
    entity
}

#[test]
fn aggregate_authoring_requires_native_data_scene_without_mutating_clock() {
    let mut engine = crate::engine::legacy_test_fixture::engine();
    let time = engine.time();
    assert!(engine.finalize_unified_physics_authoring().is_err());
    assert_eq!(engine.time(), time);
    engine.activate_data_scene();
    assert!(engine.finalize_unified_physics_authoring().is_err());
}

#[test]
fn aggregate_authoring_admits_pending_components_and_joints_without_clock_or_input_consumption() {
    let mut engine = configured(Space::PlanarXy, 8);
    let a = component(&mut engine, 0.);
    let b = component(&mut engine, 3.);
    engine.world.apply_impulse(a, Velocity { vx: 5., vy: 0. });
    engine
        .world
        .add_distance_joint(DistanceJoint::new(a, b, 3.));
    let clock = engine.fixed_timestep.config();
    let time = engine.time();
    engine.finalize_unified_physics_authoring().unwrap();
    let runtime = engine.unified_physics.as_ref().unwrap();
    assert_eq!(runtime.physics.body_count(), 2);
    assert_eq!(runtime.physics.joint_count(), 1);
    let identity = runtime.bindings[&(a.id, a.generation)].body;
    assert_eq!(engine.world.rigid_body(a).unwrap().impulse.vx, 5.);
    assert!(!engine.auto_rigid_body_step_enabled);
    assert_eq!(engine.fixed_timestep.config(), clock);
    assert_eq!(engine.time(), time);
    engine.finalize_unified_physics_authoring().unwrap();
    assert_eq!(
        engine.unified_physics.as_ref().unwrap().bindings[&(a.id, a.generation)].body,
        identity
    );
    assert_eq!(
        engine
            .unified_physics
            .as_ref()
            .unwrap()
            .physics
            .joint_count(),
        1
    );
}

#[test]
fn aggregate_authoring_capacity_failure_preserves_current_staged_world_and_existing_bindings() {
    let mut engine = configured(Space::PlanarXy, 1);
    let a = component(&mut engine, 0.);
    engine.finalize_unified_physics_authoring().unwrap();
    let state = engine.unified_body_state(a).unwrap();
    let identity = engine.unified_physics.as_ref().unwrap().bindings[&(a.id, a.generation)].body;
    let b = component(&mut engine, 3.);
    engine.world.apply_impulse(a, Velocity { vx: 4., vy: 2. });
    let time = engine.time();
    let revision = engine.runtime_checkpoint_revision();
    assert!(engine.finalize_unified_physics_authoring().is_err());
    assert_eq!(engine.runtime_checkpoint_revision(), revision + 1);
    assert_eq!(engine.time(), time);
    assert!(engine.world.is_current_entity(b));
    assert_eq!(
        engine.world.rigid_body(a).unwrap().impulse,
        Velocity { vx: 4., vy: 2. }
    );
    let runtime = engine.unified_physics.as_ref().unwrap();
    assert_eq!(runtime.bindings[&(a.id, a.generation)].body, identity);
    assert!(!runtime.bindings.contains_key(&(b.id, b.generation)));
    assert_eq!(runtime.physics.body_state(identity).unwrap(), state);
}

#[test]
fn aggregate_authoring_spatial_collider_only_components_are_not_silently_ignored() {
    let mut engine = configured(Space::Spatial, 8);
    let entity = engine.world.spawn_entity();
    engine
        .world
        .set_transform(entity, Transform2D { x: 1., y: 2. });
    engine.world.set_aabb_collider(
        entity,
        AabbCollider::new(1., 1., true, CollisionLayer::Wall),
    );
    assert!(engine.finalize_unified_physics_authoring().is_err());
    assert_eq!(
        engine
            .unified_physics
            .as_ref()
            .unwrap()
            .physics
            .body_count(),
        0
    );
    assert!(engine.world.is_current_entity(entity));
    engine.world.clear_collider(entity);
    engine.finalize_unified_physics_authoring().unwrap();
}

#[test]
fn aggregate_authoring_joint_capacity_failure_precedes_component_commit_and_preserves_impulses() {
    let mut engine = Engine::new();
    engine.activate_data_scene();
    engine
        .configure_unified_physics(WorldConfig {
            space: Space::PlanarXy,
            gravity: [0.; 3],
            max_joints: 1,
            ..Default::default()
        })
        .unwrap();
    let a = component(&mut engine, 0.);
    let b = component(&mut engine, 3.);
    let c = component(&mut engine, 6.);
    engine
        .world
        .add_distance_joint(DistanceJoint::new(a, b, 3.));
    engine
        .world
        .add_distance_joint(DistanceJoint::new(b, c, 3.));
    engine.world.apply_impulse(a, Velocity { vx: 7., vy: 0. });
    assert!(engine.finalize_unified_physics_authoring().is_err());
    let runtime = engine.unified_physics.as_ref().unwrap();
    assert_eq!(runtime.physics.body_count(), 0);
    assert_eq!(runtime.physics.joint_count(), 0);
    assert_eq!(engine.world.rigid_body(a).unwrap().impulse.vx, 7.);
    assert!(engine.world.is_current_entity(c));
}
