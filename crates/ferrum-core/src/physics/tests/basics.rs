use super::*;

#[test]
fn slope_segment_samples_surface_height_and_normal() {
    let slope = SlopeSegment::new(0.0, 10.0, 10.0, 5.0);

    let hit = slope
        .surface_at_x(5.0)
        .expect("surface point inside segment should be sampled");

    assert_eq!(hit.x, 5.0);
    assert!((hit.y - 7.5).abs() < 0.001);
    assert!((hit.t - 0.5).abs() < 0.001);
    assert!((hit.normal_x - 0.447).abs() < 0.001);
    assert!((hit.normal_y - 0.894).abs() < 0.001);
    assert!((hit.angle_radians - 0.464).abs() < 0.001);

    let reversed = SlopeSegment::new(10.0, 5.0, 0.0, 10.0);
    let reversed_hit = reversed
        .surface_at_x(5.0)
        .expect("reversed segment should use the same surface range");

    assert!((reversed_hit.y - hit.y).abs() < 0.001);
    assert!((reversed_hit.normal_x - hit.normal_x).abs() < 0.001);
    assert!((reversed_hit.normal_y - hit.normal_y).abs() < 0.001);
    assert!((reversed_hit.t - 0.5).abs() < 0.001);
}

#[test]
fn slope_segment_rejects_invalid_or_out_of_range_samples() {
    assert!(SlopeSegment::new(0.0, 0.0, 0.0, 10.0)
        .surface_at_x(0.0)
        .is_none());
    assert!(SlopeSegment::new(0.0, 0.0, 10.0, 0.0)
        .surface_at_x(-0.1)
        .is_none());
    assert!(SlopeSegment::new(0.0, 0.0, 10.0, 0.0)
        .surface_at_x(10.1)
        .is_none());
    assert!(SlopeSegment::new(0.0, f32::NAN, 10.0, 0.0)
        .surface_at_x(5.0)
        .is_none());
    assert!(SlopeSegment::new(0.0, 0.0, 10.0, 0.0)
        .surface_at_x(f32::NAN)
        .is_none());
}

#[test]
fn slope_segment_walkable_uses_max_angle() {
    let flat = SlopeSegment::new(0.0, 10.0, 10.0, 10.0);
    let gentle = SlopeSegment::new(0.0, 10.0, 10.0, 5.0);
    let steep = SlopeSegment::new(0.0, 10.0, 1.0, 0.0);

    assert!(flat.is_walkable(0.0));
    assert!(gentle.is_walkable(0.5));
    assert!(!gentle.is_walkable(0.4));
    assert!(!steep.is_walkable(0.5));
    assert!(!gentle.is_walkable(-0.1));
    assert!(!gentle.is_walkable(f32::NAN));
    assert!(!SlopeSegment::new(0.0, 0.0, 0.0, 10.0).is_walkable(1.0));
}

#[test]
fn integrate_applies_velocity_to_alive_entities() {
    let mut world = World::default();
    let moving = world.spawn_entity();
    let despawned = world.spawn_entity();
    world.set_transform(moving, Transform2D { x: 2.0, y: 4.0 });
    world.set_velocity(moving, Velocity { vx: 10.0, vy: -6.0 });
    world.set_transform(despawned, Transform2D { x: 1.0, y: 1.0 });
    world.set_velocity(
        despawned,
        Velocity {
            vx: 100.0,
            vy: 100.0,
        },
    );
    world.despawn(despawned);

    PhysicsSystem::integrate(&mut world, 0.5);

    assert_eq!(
        world.transform(moving),
        Some(Transform2D { x: 7.0, y: 1.0 })
    );
    assert_eq!(world.transform(despawned), None);
}

#[test]
fn clamp_entity_to_bounds_uses_collider_extents() {
    let mut world = World::default();
    let player = world.spawn_player(-20.0, 200.0, 0);

    PhysicsSystem::clamp_entity_to_bounds(
        &mut world,
        player,
        PhysicsBounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 800.0,
            max_y: 480.0,
        },
    );

    let transform = world
        .transform(player)
        .expect("player should keep transform after bounds clamp");
    assert_eq!(transform.x, 18.0);
    assert_eq!(transform.y, 200.0);
}

#[test]
fn clamp_entity_to_bounds_respects_collider_offset() {
    let mut world = World::default();
    let player = world.spawn_player(-20.0, 200.0, 0);
    world.set_aabb_collider(
        player,
        AabbCollider::new(10.0, 10.0, true, CollisionLayer::Player).with_offset(5.0, 8.0),
    );

    PhysicsSystem::clamp_entity_to_bounds(
        &mut world,
        player,
        PhysicsBounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 100.0,
            max_y: 100.0,
        },
    );

    let transform = world
        .transform(player)
        .expect("player should keep transform after bounds clamp");
    assert_eq!(transform.x, 5.0);
    assert_eq!(transform.y, 82.0);
}

#[test]
fn clamp_entity_to_small_bounds_uses_axis_center() {
    let mut world = World::default();
    let player = world.spawn_player(20.0, 30.0, 0);

    PhysicsSystem::clamp_entity_to_bounds(
        &mut world,
        player,
        PhysicsBounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 10.0,
            max_y: 12.0,
        },
    );

    let transform = world
        .transform(player)
        .expect("player should keep transform after bounds clamp");
    assert_eq!(transform.x, 5.0);
    assert_eq!(transform.y, 6.0);
}

#[test]
fn fixed_timestep_accumulates_and_reports_alpha() {
    let mut timestep = FixedTimestep::new(FixedTimestepConfig {
        step_seconds: 0.1,
        max_frame_seconds: 1.0,
        max_steps_per_update: 4,
    });

    let update = timestep.advance(0.25);

    assert_eq!(update.steps, 2);
    assert!((update.consumed_seconds - 0.2).abs() < 0.001);
    assert!((update.alpha - 0.5).abs() < 0.001);
    assert!((timestep.accumulated_seconds() - 0.05).abs() < 0.001);
    assert_eq!(update.dropped_seconds, 0.0);
}

#[test]
fn fixed_timestep_clamps_frame_delta_and_reports_drop() {
    let mut timestep = FixedTimestep::new(FixedTimestepConfig {
        step_seconds: 0.1,
        max_frame_seconds: 0.2,
        max_steps_per_update: 8,
    });

    let update = timestep.advance(1.0);

    assert_eq!(update.steps, 2);
    assert!((update.dropped_seconds - 0.8).abs() < 0.001);
    assert!(timestep.accumulated_seconds().abs() < 0.001);
}

#[test]
fn fixed_timestep_drops_backlog_after_step_cap() {
    let mut timestep = FixedTimestep::new(FixedTimestepConfig {
        step_seconds: 0.1,
        max_frame_seconds: 1.0,
        max_steps_per_update: 3,
    });

    let update = timestep.advance(0.75);

    assert_eq!(update.steps, 3);
    assert!(update.dropped_seconds > 0.39);
    assert!(update.alpha < 1.0);
}

#[test]
fn fixed_timestep_pause_discards_delta_without_backlog() {
    let mut timestep = FixedTimestep::new(FixedTimestepConfig {
        step_seconds: 0.1,
        max_frame_seconds: 1.0,
        max_steps_per_update: 4,
    });

    let first = timestep.advance(0.05);
    assert_eq!(first.steps, 0);
    assert!((first.alpha - 0.5).abs() < 0.001);
    assert!(!timestep.is_paused());

    timestep.pause();
    assert!(timestep.is_paused());
    let paused = timestep.advance(1.0);
    assert_eq!(paused.steps, 0);
    assert_eq!(paused.consumed_seconds, 0.0);
    assert_eq!(paused.dropped_seconds, 0.0);
    assert!((paused.alpha - 0.5).abs() < 0.001);
    assert!((timestep.accumulated_seconds() - 0.05).abs() < 0.001);

    timestep.resume();
    assert!(!timestep.is_paused());
    let resumed = timestep.advance(0.05);
    assert_eq!(resumed.steps, 1);
    assert!((timestep.accumulated_seconds()).abs() < 0.001);

    timestep.set_paused(true);
    assert!(timestep.is_paused());
    timestep.set_paused(false);
    assert!(!timestep.is_paused());
}
