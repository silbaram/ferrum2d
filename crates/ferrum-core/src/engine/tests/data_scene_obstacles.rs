use super::*;
use crate::components::{CircleCollider, OrientedBoxCollider};

fn door(engine: &mut Engine) -> Entity {
    let entity = spawn_test_body(&mut engine.world, 30.0, 10.0, CollisionLayer::Wall);
    engine
        .world
        .set_rigid_body(entity, RigidBody::static_body());
    entity
}

fn path(engine: &mut Engine) -> bool {
    engine.query_tilemap_navigation_path(10.0, 10.0, 50.0, 10.0)
}

#[test]
fn automatic_collider_cells_follow_bounds_offsets_resizing_and_removal() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let gate = door(&mut engine);
    engine.world.set_aabb_collider(
        gate,
        AabbCollider::new(10.0, 10.0, false, CollisionLayer::Wall),
    );
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        3,
        1,
        20.0,
        20.0,
        0.0,
        0.0,
        &[1, 7, 1],
        &[gate.id, gate.generation, 0]
    ));
    assert!(!path(&mut engine));
    // Exact [20,40] bounds block only column 1, not touching columns 0/2.
    assert!(engine.query_tilemap_navigation_path(10.0, 10.0, 10.0, 10.0));
    assert!(engine.query_tilemap_navigation_path(50.0, 10.0, 50.0, 10.0));
    engine
        .world
        .set_transform(gate, Transform2D { x: 130.0, y: 10.0 });
    assert!(path(&mut engine));
    engine
        .world
        .set_transform(gate, Transform2D { x: 10.0, y: 10.0 });
    engine.world.set_aabb_collider(
        gate,
        AabbCollider::new(5.0, 5.0, false, CollisionLayer::Wall).with_offset(20.0, 0.0),
    );
    assert!(!path(&mut engine));
    engine.world.set_aabb_collider(
        gate,
        AabbCollider::new(25.0, 5.0, false, CollisionLayer::Wall).with_offset(20.0, 0.0),
    );
    assert!(!engine.query_tilemap_navigation_path(10.0, 10.0, 10.0, 10.0));
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, false));
    assert!(path(&mut engine));
    assert_eq!(engine.capture_data_scene_navigation()[7], 7.0);
    assert_eq!(
        engine.capture_data_scene_navigation_obstacles(),
        [gate.id, gate.generation, 0]
    );
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, true));
    assert!(!path(&mut engine));
    engine.world.despawn(gate);
    assert!(path(&mut engine));
}

#[test]
fn automatic_and_fixed_overlaps_preserve_base_costs_and_bound_resource_limits() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let gate = door(&mut engine);
    let fixed = door(&mut engine);
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        3,
        1,
        20.0,
        20.0,
        0.0,
        0.0,
        &[1; 3],
        &[
            gate.id,
            gate.generation,
            0,
            fixed.id,
            fixed.generation,
            1,
            1,
            0
        ]
    ));
    engine.world.set_transform(
        gate,
        Transform2D {
            x: -100.0,
            y: -100.0,
        },
    );
    assert!(!path(&mut engine));
    assert!(engine.set_data_scene_navigation_cost(1, 0, 31));
    assert!(engine.set_physics_collider_enabled(fixed.id, fixed.generation, false));
    assert!(path(&mut engine));
    let before = engine.capture_data_scene_navigation_obstacles();
    let too_many: Vec<u32> = (0..65)
        .flat_map(|_| {
            let entity = door(&mut engine);
            [entity.id, entity.generation, 0]
        })
        .collect();
    assert!(!engine.configure_data_scene_navigation_obstacles(&too_many));
    assert_eq!(engine.capture_data_scene_navigation_obstacles(), before);
    assert_eq!(engine.capture_data_scene_navigation()[7], 31.0);
}

#[test]
fn automatic_bounds_follow_oriented_box_rotation_and_circle_shape_replacement() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let gate = door(&mut engine);
    engine
        .world
        .set_transform(gate, Transform2D { x: 30.0, y: 30.0 });
    engine.world.clear_collider(gate);
    engine.world.set_oriented_box_collider(
        gate,
        OrientedBoxCollider::new(15.0, 4.0, 0.0, false, CollisionLayer::Wall),
    );
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        3,
        3,
        20.0,
        20.0,
        0.0,
        0.0,
        &[1; 9],
        &[gate.id, gate.generation, 0]
    ));
    assert!(!engine.query_tilemap_navigation_path(10.0, 30.0, 10.0, 30.0));
    assert!(engine.query_tilemap_navigation_path(30.0, 10.0, 30.0, 10.0));
    engine.world.set_oriented_box_collider(
        gate,
        OrientedBoxCollider::new(
            15.0,
            4.0,
            std::f32::consts::FRAC_PI_2,
            false,
            CollisionLayer::Wall,
        ),
    );
    assert!(engine.query_tilemap_navigation_path(10.0, 30.0, 10.0, 30.0));
    assert!(!engine.query_tilemap_navigation_path(30.0, 10.0, 30.0, 10.0));
    engine.world.clear_collider(gate);
    engine
        .world
        .set_circle_collider(gate, CircleCollider::new(5.0, false, CollisionLayer::Wall));
    assert!(engine.query_tilemap_navigation_path(30.0, 10.0, 30.0, 10.0));
    assert!(!engine.query_tilemap_navigation_path(30.0, 30.0, 30.0, 30.0));
}

#[test]
fn collider_only_door_toggle_returns_success_and_progress_restores_navigation() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let gate = spawn_test_body(&mut engine.world, 30.0, 10.0, CollisionLayer::Wall);
    assert!(engine.world.rigid_body(gate).is_none());
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        3,
        1,
        20.0,
        20.0,
        0.0,
        0.0,
        &[1; 3],
        &[gate.id, gate.generation, 1, 1, 0]
    ));
    assert!(!path(&mut engine));
    assert!(!engine.set_physics_collider_enabled(gate.id, gate.generation + 1, false));
    assert!(!path(&mut engine));
    assert!(engine.set_physics_collider_enabled(gate.id, gate.generation, false));
    assert!(path(&mut engine));
    let epoch = engine.data_scene_epoch();
    let states = engine.capture_data_scene_progress(epoch, &[gate.id, gate.generation]);
    assert_eq!(states, [17]); // alive and collider present; no body
    assert!(engine.set_physics_collider_enabled(gate.id, gate.generation, true));
    assert!(!path(&mut engine));
    assert!(engine.restore_data_scene_progress(epoch, &[gate.id, gate.generation], &states));
    assert!(path(&mut engine));
    assert!(engine.world.rigid_body(gate).is_none());
    engine.world.clear_collider(gate);
    assert!(!engine.set_physics_collider_enabled(gate.id, gate.generation, true));
    engine.world.despawn(gate);
    assert!(!engine.set_physics_collider_enabled(gate.id, gate.generation, false));
}

#[test]
fn door_body_collider_removal_and_generation_changes_update_navigation_without_cost_edits() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let gate = door(&mut engine);
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        3,
        1,
        20.0,
        20.0,
        0.0,
        0.0,
        &[1, 7, 1],
        &[gate.id, gate.generation, 1, 1, 0]
    ));
    assert!(!path(&mut engine));
    assert_eq!(engine.capture_data_scene_navigation()[7], 7.0);
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, false));
    assert!(path(&mut engine));
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, true));
    assert!(!path(&mut engine));
    assert!(engine.set_physics_collider_enabled(gate.id, gate.generation, false));
    assert!(path(&mut engine));
    assert!(engine.set_physics_collider_enabled(gate.id, gate.generation, true));
    assert!(!path(&mut engine));
    engine.world.despawn(gate);
    let replacement = door(&mut engine);
    assert_eq!(replacement.id, gate.id);
    assert_ne!(replacement.generation, gate.generation);
    assert!(path(&mut engine));
    assert_eq!(
        engine.capture_data_scene_navigation_obstacles(),
        [gate.id, gate.generation, 1, 1, 0]
    );
}

#[test]
fn overlapping_obstacles_preserve_terrain_edits_and_invalid_batches_are_atomic() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let a = door(&mut engine);
    let b = door(&mut engine);
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        3,
        1,
        20.0,
        20.0,
        0.0,
        0.0,
        &[1; 3],
        &[a.id, a.generation, 1, 1, 0, b.id, b.generation, 1, 1, 0]
    ));
    assert!(engine.set_physics_body_enabled(a.id, a.generation, false));
    assert!(!path(&mut engine));
    let terrain = engine.capture_data_scene_navigation();
    let bindings = engine.capture_data_scene_navigation_obstacles();
    for invalid in [
        vec![a.id, a.generation, 1, 3, 0],
        vec![a.id, a.generation, 2, 1, 0, 1, 0],
        vec![a.id, a.generation, 1, 1, 0, b.id, b.generation + 1, 1, 1, 0],
        vec![a.id, a.generation, u32::MAX],
    ] {
        assert!(!engine.configure_data_scene_navigation_with_obstacles(
            3, 1, 20.0, 20.0, 0.0, 0.0, &[2; 3], &invalid
        ));
        assert_eq!(engine.capture_data_scene_navigation(), terrain);
        assert_eq!(engine.capture_data_scene_navigation_obstacles(), bindings);
        assert!(!path(&mut engine));
    }
    assert!(engine.set_data_scene_navigation_cost(1, 0, 23));
    assert!(!path(&mut engine));
    assert!(engine.set_physics_body_enabled(b.id, b.generation, false));
    assert!(path(&mut engine));
    assert_eq!(engine.capture_data_scene_navigation()[7], 23.0);
    assert!(engine.set_data_scene_navigation_cost(1, 0, 0));
    assert!(!path(&mut engine));
    assert!(engine.configure_data_scene_navigation_obstacles(&[]));
    assert!(!path(&mut engine));
    engine.use_data_scene();
    assert!(engine.capture_data_scene_navigation_obstacles().is_empty());
    assert!(engine.capture_data_scene_navigation().is_empty());
}

#[test]
fn progress_restores_disabled_physics_and_consumed_interaction_after_full_preflight() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let gate = door(&mut engine);
    assert!(engine.set_gameplay_interaction(gate.id, gate.generation, 1, 30.0, true));
    engine
        .world
        .interaction_mut_at_index(gate.id as usize)
        .unwrap()
        .consumed = true;
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, false));
    assert!(engine.set_physics_collider_enabled(gate.id, gate.generation, false));
    let epoch = engine.data_scene_epoch();
    let states = engine.capture_data_scene_progress(epoch, &[gate.id, gate.generation]);
    assert_eq!(states, [23]); // alive, consumed, body present, collider present
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, true));
    assert!(engine.set_physics_collider_enabled(gate.id, gate.generation, true));
    let other = door(&mut engine);
    let handles = [gate.id, gate.generation, other.id, other.generation];
    assert!(!engine.restore_data_scene_progress(epoch, &handles, &[23, 2]));
    assert!(engine.world.rigid_body(gate).unwrap().enabled);
    assert!(engine.world.collider(gate).unwrap().enabled);
    assert!(engine.restore_data_scene_progress(epoch, &[gate.id, gate.generation], &states));
    assert!(!engine.world.rigid_body(gate).unwrap().enabled);
    assert!(!engine.world.collider(gate).unwrap().enabled);
    assert!(
        engine
            .world
            .interaction_at_index(gate.id as usize)
            .unwrap()
            .consumed
    );
    // Legacy alive states retain the authored/current physics settings.
    assert!(engine.restore_data_scene_progress(epoch, &[gate.id, gate.generation], &[1]));
    assert!(!engine.world.rigid_body(gate).unwrap().enabled);
    assert!(!engine.world.collider(gate).unwrap().enabled);
}

#[test]
fn active_native_route_replans_when_a_bound_door_closes_and_opens() {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = spawn_test_body(&mut engine.world, 10.0, 10.0, CollisionLayer::Player);
    engine.world.set_rigid_body(actor, RigidBody::kinematic());
    let gate = door(&mut engine);
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, false));
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(engine.configure_data_scene_navigation_with_obstacles(
        3,
        2,
        20.0,
        20.0,
        0.0,
        0.0,
        &[1; 6],
        &[gate.id, gate.generation, 1, 1, 0]
    ));
    assert!(engine.move_data_scene_actor_to(50.0, 10.0, 20.0, 0.0, u32::MAX, false));
    engine.update(0.1);
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, true));
    engine.update(0.1);
    let position = engine.world.transform(actor).unwrap();
    assert!(position.x <= 12.0); // route returns to the start center before the detour
    assert!(engine.set_physics_body_enabled(gate.id, gate.generation, false));
    for _ in 0..40 {
        engine.update(0.1);
    }
    assert_eq!(engine.data_scene_move_status(), 2);
    assert_eq!(
        engine.world.transform(actor),
        Some(Transform2D { x: 50.0, y: 10.0 })
    );
}
