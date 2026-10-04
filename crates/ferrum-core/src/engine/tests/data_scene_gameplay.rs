use super::data_scene_visuals::sprite;
use super::*;
use crate::gameplay_event::GameplayEvent;

fn scene() -> (Engine, Entity, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = sprite(&mut engine, 1, 100.0, 100.0, 0);
    let site = sprite(&mut engine, 2, 120.0, 100.0, 0);
    assert!(engine.set_gameplay_interaction(site.id, site.generation, 17, 30.0, false));
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 91));
    assert!(engine.set_input_action_binding(
        91,
        0,
        crate::input::INPUT_ACTION_CONTROL_SPACE,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    )); // Space, pressed
    (engine, actor, site)
}

fn space(engine: &mut Engine, down: bool) {
    engine.set_input(false, false, false, false, down, false, false, 0.0, 0.0);
}

#[test]
fn data_scene_interaction_uses_explicit_actor_and_input_token_independently() {
    let (mut engine, actor, site) = scene();
    engine.update(0.02);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
    space(&mut engine, true);
    engine.update(0.02);
    assert_eq!(
        engine.frame_buffers.gameplay_events,
        vec![GameplayEvent::interaction(actor, site, 17, false, false)]
    );
    engine.clear_gameplay_events();
    engine.update(0.02);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
    space(&mut engine, false);
    engine.update(0.02);
    assert!(engine.set_gameplay_interaction(site.id, site.generation, 17, 10.0, false));
    space(&mut engine, true);
    engine.update(0.02);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
}

#[test]
fn data_scene_interaction_pause_and_fixed_steps_do_not_replay_pressed_edges() {
    let (mut engine, _, _) = scene();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    space(&mut engine, true);
    engine.update(0.04);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
    space(&mut engine, false);
    engine.update(0.28);
    assert_eq!(engine.frame_buffers.gameplay_events.len(), 1);
    engine.clear_gameplay_events();
    assert!(engine.pause_data_scene());
    space(&mut engine, true);
    engine.update(0.4);
    assert!(engine.resume_data_scene());
    engine.update(0.4);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
}

#[test]
fn data_scene_interaction_preserves_consecutive_short_presses_between_fixed_steps() {
    let (mut engine, _, _) = scene();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    for _ in 0..2 {
        space(&mut engine, true);
        engine.update(0.04);
        space(&mut engine, false);
        engine.update(0.06);
        assert_eq!(engine.frame_buffers.gameplay_events.len(), 1);
        engine.clear_gameplay_events();
    }
    engine.update(0.1);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
}

#[test]
fn data_scene_gameplay_reconfiguration_discards_pending_old_presses() {
    let (mut engine, actor, _) = scene();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    space(&mut engine, true);
    space(&mut engine, false);
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 91));
    engine.update(0.1);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
    space(&mut engine, true);
    engine.update(0.1);
    assert_eq!(engine.frame_buffers.gameplay_events.len(), 1);
}

#[test]
fn data_scene_changing_step_mode_does_not_keep_synthetic_pressed_state() {
    let (mut engine, _, _) = scene();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    space(&mut engine, true);
    space(&mut engine, false);
    engine.update(0.1);
    assert_eq!(engine.frame_buffers.gameplay_events.len(), 1);
    engine.clear_gameplay_events();
    engine.configure_fixed_timestep(false, 0.1, 1.0, 4);
    space(&mut engine, true);
    engine.update(0.02);
    assert_eq!(engine.frame_buffers.gameplay_events.len(), 1);
    engine.clear_gameplay_events();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    engine.update(0.1);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
}

#[test]
fn data_scene_proximity_once_height_and_nearest_target_contracts() {
    let (mut engine, actor, site) = scene();
    let closer = sprite(&mut engine, 3, 110.0, 100.0, 0);
    assert!(engine.set_gameplay_interaction(closer.id, closer.generation, 18, 30.0, true));
    space(&mut engine, true);
    engine.update(0.02);
    assert_eq!(engine.frame_buffers.gameplay_events[0].source_id, closer.id);
    engine.clear_gameplay_events();
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    engine
        .world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(0), 0.0, 1.0).unwrap());
    engine
        .world
        .set_height_span(site, HeightSpan::new(PhysicsFloorId(1), 0.0, 1.0).unwrap());
    engine.update(0.02);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
    engine
        .world
        .set_height_span(site, HeightSpan::new(PhysicsFloorId(0), 0.0, 1.0).unwrap());
    engine.configure_fixed_timestep(true, 0.01, 1.0, 4);
    engine.update(0.04);
    assert_eq!(engine.frame_buffers.gameplay_events.len(), 1);
    assert_eq!(engine.frame_buffers.gameplay_events[0].source_id, site.id);
}

#[test]
fn data_scene_pickup_collects_generic_items_once_without_collision_telemetry() {
    let (mut engine, actor, _) = scene();
    let pickup = sprite(&mut engine, 3, 100.0, 100.0, 0);
    engine.world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(engine.configure_data_scene_body(actor.id, actor.generation, 1, true, 0, 0.0, 1.0));
    assert!(engine.configure_data_scene_body(pickup.id, pickup.generation, 0, true, 0, 0.0, 1.0));
    assert!(engine.set_gameplay_pickup(pickup.id, pickup.generation, 2, 3, true));
    assert!(!engine.set_gameplay_pickup(pickup.id, pickup.generation, 2, 3, false));
    engine.world.add_collision_reaction(
        actor,
        CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        },
    );
    engine.set_collision_lifecycle_events_enabled(false);
    engine.update(0.02);
    assert_eq!(
        engine.frame_buffers.gameplay_events,
        vec![GameplayEvent::pickup_collected(actor, pickup, 2, 3, true)]
    );
    assert!(!engine.world.is_current_entity(pickup));
    assert_eq!(engine.score(), 0);
    engine.clear_gameplay_events();
    engine.update(0.02);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
}

#[test]
fn data_scene_pickup_preserves_collision_enter_and_exit_when_telemetry_is_enabled() {
    let (mut engine, actor, _) = scene();
    let pickup = sprite(&mut engine, 3, 100.0, 100.0, 0);
    engine.world.set_aabb_collider(
        pickup,
        AabbCollider::new(8.0, 8.0, true, CollisionLayer::Pickup),
    );
    assert!(engine.set_gameplay_pickup(pickup.id, pickup.generation, 2, 1, true));
    engine.world.add_collision_reaction(
        actor,
        CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        },
    );
    engine.set_collision_lifecycle_events_enabled(true);
    engine.update(0.02);
    assert_eq!(engine.frame_buffers.collision_events.len(), 1);
    assert_eq!(
        engine.frame_buffers.collision_events[0].kind,
        COLLISION_EVENT_TRIGGER_ENTER
    );
    assert_eq!(engine.physics_counters.collision_pairs, 1);
    assert_eq!(
        engine.frame_buffers.gameplay_events[0].kind,
        GAMEPLAY_EVENT_PICKUP_COLLECTED
    );
    assert!(!engine.world.is_current_entity(pickup));
    engine.update(0.02);
    assert_eq!(
        engine.frame_buffers.collision_events[0].kind,
        COLLISION_EVENT_TRIGGER_EXIT
    );
}

#[test]
fn data_scene_resume_discards_pause_input_without_a_frozen_update() {
    let (mut engine, _, _) = scene();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 4);
    assert!(engine.pause_data_scene());
    space(&mut engine, true);
    space(&mut engine, false);
    assert!(engine.resume_data_scene());
    engine.update(0.1);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
}

#[test]
fn data_scene_reset_invalidates_actor_and_rejected_configuration_preserves_scene() {
    let (mut engine, actor, _) = scene();
    assert!(engine.configure_data_scene_projection(0.6));
    assert!(!engine.set_shooter_tilemap_navigation_cost(0, 0, 0, 2));
    assert!(!engine.set_shooter_tilemap_tile(0, 0, 0, 1));
    engine.clear_shooter_tilemap();
    assert_eq!(engine.scene_mode, scenes::SceneMode::Data);
    assert_eq!(engine.camera.ground_y_scale, 0.6);
    assert!(engine.world.is_current_entity(actor));
    assert!(!engine.configure_data_scene_gameplay(true, actor.id, actor.generation + 1, 91));
    assert_eq!(engine.world.primary_actor_entity(), Some(actor));
    engine.use_data_scene();
    assert!(!engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 91));
    assert!(engine.world.primary_actor_entity().is_none());
}

#[test]
fn data_scene_navigation_rejects_non_finite_query_coordinates() {
    let (mut engine, _, _) = scene();
    assert!(engine.configure_data_scene_navigation(3, 1, 24.0, 24.0, 0.0, 0.0, &[1, 1, 1]));
    for invalid in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
        for index in 0..4 {
            let mut query = [12.0, 12.0, 60.0, 12.0];
            query[index] = invalid;
            assert!(engine.query_tilemap_navigation_path(12.0, 12.0, 60.0, 12.0));
            assert!(!engine.query_tilemap_navigation_path(query[0], query[1], query[2], query[3]));
            assert!(engine
                .frame_buffers
                .tilemap_navigation_path_points
                .is_empty());
            assert!(
                !engine.query_tilemap_navigation_waypoint(query[0], query[1], query[2], query[3])
            );
        }
    }
}

#[test]
fn data_scene_navigation_is_independent_and_cost_edits_do_not_switch_scene() {
    let (mut engine, actor, _) = scene();
    let mut costs = vec![1; 25];
    costs[12] = 0;
    assert!(engine.configure_data_scene_navigation(5, 5, 24.0, 24.0, 0.0, 0.0, &costs));
    assert!(engine.query_tilemap_navigation_path(12.0, 60.0, 108.0, 60.0));
    assert!(engine
        .frame_buffers
        .tilemap_navigation_path_points
        .chunks_exact(TILEMAP_NAVIGATION_PATH_POINT_FLOATS)
        .any(|p| p[1] != 60.0));
    assert!(
        engine.query_tilemap_navigation_path_with_height_span(12.0, 60.0, 108.0, 60.0, 0, 0.0, 1.0)
    );
    assert!(engine
        .frame_buffers
        .tilemap_navigation_path_points
        .chunks_exact(TILEMAP_NAVIGATION_PATH_POINT_FLOATS)
        .any(|p| p[1] != 60.0));
    assert!(!engine.query_tilemap_navigation_path_between_height_spans(
        12.0, 60.0, 108.0, 60.0, 0, 0.0, 1.0, 1, 0.0, 1.0
    ));
    assert!(engine.set_data_scene_navigation_cost(2, 2, 1));
    assert!(
        engine.query_tilemap_navigation_path_with_height_span(12.0, 60.0, 108.0, 60.0, 0, 0.0, 1.0)
    );
    assert!(engine
        .frame_buffers
        .tilemap_navigation_path_points
        .chunks_exact(TILEMAP_NAVIGATION_PATH_POINT_FLOATS)
        .all(|p| p[1] == 60.0));
    assert!(!engine.configure_data_scene_navigation(5, 5, 24.0, 24.0, 0.0, 0.0, &[1]));
    assert!(!engine.set_data_scene_navigation_cost(9, 9, 0));
    assert!(engine.query_tilemap_navigation_path(12.0, 60.0, 108.0, 60.0));
    assert!(engine.world.is_current_entity(actor));
    assert_eq!(engine.scene_mode, scenes::SceneMode::Data);
    engine.use_data_scene();
    assert!(!engine.query_tilemap_navigation_path(12.0, 60.0, 108.0, 60.0));
}

#[test]
fn data_scene_progress_captures_removed_generations_and_consumed_interactions() {
    let (mut engine, actor, site) = scene();
    assert!(engine.set_gameplay_interaction(site.id, site.generation, 17, 30.0, true));
    space(&mut engine, true);
    engine.update(0.02);
    let epoch = engine.data_scene_epoch();
    let handles = [actor.id, actor.generation, site.id, site.generation];
    assert_eq!(
        engine.capture_data_scene_progress(epoch, &handles),
        vec![1, 3]
    );
    engine.world.despawn(actor);
    let replacement = sprite(&mut engine, 1, 100.0, 100.0, 0);
    assert_eq!(replacement.id, actor.id);
    assert_ne!(replacement.generation, actor.generation);
    assert_eq!(
        engine.capture_data_scene_progress(epoch, &handles),
        vec![0, 3]
    );
    engine.use_data_scene();
    assert_ne!(engine.data_scene_epoch(), epoch);
    assert!(engine
        .capture_data_scene_progress(epoch, &handles)
        .is_empty());
    assert!(!engine.restore_data_scene_progress(epoch, &handles, &[0, 3]));
}

#[test]
fn data_scene_progress_restore_preflights_the_whole_batch() {
    let (mut engine, actor, site) = scene();
    let epoch = engine.data_scene_epoch();
    let handles = [actor.id, actor.generation, site.id, site.generation];
    // site is repeatable, therefore consumed is invalid. Actor must stay alive.
    assert!(!engine.restore_data_scene_progress(epoch, &handles, &[0, 3]));
    assert!(engine.world.is_current_entity(actor));
    assert!(!engine.restore_data_scene_progress(epoch, &handles, &[0, 2]));
    assert!(!engine.restore_data_scene_progress(
        epoch,
        &[actor.id, actor.generation, actor.id, actor.generation],
        &[0, 1]
    ));
    assert!(engine.world.is_current_entity(actor));
    assert!(engine.set_gameplay_interaction(site.id, site.generation, 17, 30.0, true));
    assert!(engine.restore_data_scene_progress(epoch, &handles, &[1, 3]));
    space(&mut engine, true);
    engine.update(0.02);
    assert!(engine.frame_buffers.gameplay_events.is_empty());
    assert!(engine.restore_data_scene_progress(epoch, &handles, &[0, 3]));
    assert!(!engine.world.is_current_entity(actor));
}

#[test]
fn data_scene_navigation_snapshot_retains_replaced_costs_and_clear() {
    let mut engine = Engine::new();
    assert_eq!(engine.data_scene_epoch(), 0);
    engine.use_data_scene();
    assert!(engine.configure_data_scene_navigation(2, 1, 12.5, 24.0, -7.0, 9.0, &[0, 65535]));
    assert_eq!(
        engine.capture_data_scene_navigation(),
        vec![2.0, 1.0, 12.5, 24.0, -7.0, 9.0, 0.0, 65535.0]
    );
    assert!(engine.set_data_scene_navigation_cost(0, 0, 17));
    assert_eq!(engine.capture_data_scene_navigation()[6], 17.0);
    assert!(engine.clear_data_scene_navigation());
    assert!(engine.capture_data_scene_navigation().is_empty());
}
