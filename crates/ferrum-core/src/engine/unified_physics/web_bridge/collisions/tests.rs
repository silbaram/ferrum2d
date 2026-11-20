use super::*;
use crate::entity::Entity;
use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, Pose, Shape, Space, WorldConfig};

fn engine(space: Space, limit: usize) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        step_seconds: 0.01,
        max_events: limit,
        ..WorldConfig::default()
    })
    .unwrap();
    e.set_unified_physics_collision_events_enabled(true)
        .unwrap();
    e
}
fn body(e: &mut Engine, x: f32, sensor: bool) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: if sensor {
                BodyKind::Fixed
            } else {
                BodyKind::Dynamic
            },
            pose: Pose {
                position: [x, 0.0, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc {
            sensor,
            ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
        },
        [0.0; 3],
    )
    .unwrap()
}
fn tick(e: &mut Engine) {
    e.update(0.01);
}
fn drain(e: &mut Engine) -> Vec<CollisionRecord> {
    e.drain_unified_physics_collision_events().unwrap();
    e.unified_physics_collisions.rows.clone()
}

#[test]
fn native_collision_stream_keeps_solid_sensor_channels_and_entity_telemetry_independent() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut e = engine(space, 32);
        let a = body(&mut e, 0.0, false);
        body(&mut e, 0.99, false);
        body(&mut e, 4.0, false);
        body(&mut e, 4.5, true);
        e.set_collision_lifecycle_events_enabled(true);
        tick(&mut e);
        assert_eq!(e.frame_buffers.collision_events.len(), 2);
        let events = drain(&mut e);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].first.entity, [a.id, a.generation]);
        assert_eq!(events.iter().map(|r| r.flags).collect::<Vec<_>>(), [0, 1]);
        assert!(events.iter().all(|r| r.phase == 0));
        assert_eq!(e.frame_buffers.collision_events.len(), 2);
        let elapsed = e.elapsed_seconds;
        e.query_unified_physics_collision_pairs().unwrap();
        assert_eq!(e.unified_physics_collisions.rows.len(), 2);
        assert!(e
            .unified_physics_collisions
            .rows
            .iter()
            .all(|r| r.phase == 2));
        assert!(drain(&mut e).is_empty());
        assert_eq!(e.elapsed_seconds, elapsed);
        tick(&mut e);
        assert!(drain(&mut e).is_empty()); // No synthesized stay transitions.
        assert_eq!(e.frame_buffers.collision_events.len(), 2);
        e.set_collision_lifecycle_events_enabled(false);
        e.set_unified_body_pose(
            a,
            Pose {
                position: [-5.0, 0.0, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
        tick(&mut e);
        let exit = drain(&mut e);
        assert_eq!(exit.len(), 1);
        assert_eq!((exit[0].phase, exit[0].flags), (1, 0));
    }
}

#[test]
fn native_collision_stream_preserves_removed_generations_and_does_not_drain_on_pair_reads() {
    let mut e = engine(Space::Spatial, 16);
    let a = body(&mut e, 0.0, false);
    let sensor = body(&mut e, 0.5, true);
    tick(&mut e);
    e.query_unified_physics_collision_pairs().unwrap();
    let initial = e.unified_physics_collisions.rows[0];
    e.remove_unified_body(sensor).unwrap();
    let next = body(&mut e, 20.0, true);
    assert_ne!((sensor.id, sensor.generation), (next.id, next.generation));
    e.query_unified_physics_collision_pairs().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 0);
    e.set_collision_lifecycle_events_enabled(true); // Must not discard native observations.
    let events = drain(&mut e);
    assert_eq!(events.len(), 2);
    assert_eq!((events[1].phase, events[1].flags), (1, 3));
    assert_eq!(events[1].first, initial.first);
    assert_eq!(events[1].second, initial.second);
    assert_eq!(events[1].first.entity, [a.id, a.generation]);
    assert_eq!(events[1].second.entity, [sensor.id, sensor.generation]);
    assert!(drain(&mut e).is_empty());
}

#[test]
fn native_collision_stream_reports_backend_and_consumer_overflow_with_full_recovery() {
    let mut e = engine(Space::Spatial, 1);
    body(&mut e, 0.0, false);
    let a = body(&mut e, 0.5, true);
    body(&mut e, 4.0, false);
    body(&mut e, 4.5, true);
    tick(&mut e);
    e.query_unified_physics_collision_pairs().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 2); // Not capped by queue capacity.
    e.remove_unified_body(a).unwrap(); // Another capture before the consumer drains.
    let events = drain(&mut e);
    assert_eq!(events.len(), 1);
    assert_eq!(e.unified_physics_collision_dropped_transitions(), 1);
    assert_eq!(e.unified_physics_collision_dropped_events(), 1);
    e.query_unified_physics_collision_pairs().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 1);
    assert!(drain(&mut e).is_empty());
    assert_eq!(e.unified_physics_collision_dropped_transitions(), 0);
    assert_eq!(e.unified_physics_collision_dropped_events(), 0);
}

#[test]
fn native_collision_stream_retains_entityless_tile_identity_through_retirement() {
    let mut e = engine(Space::PlanarXy, 16);
    e.tilemap
        .set_layer(0, 1, 1, 1.0, 2.0, -1.0, -1.0, true, vec![1]);
    body(&mut e, 0.0, false);
    tick(&mut e);
    let events = drain(&mut e);
    assert_eq!(events.len(), 1);
    let terrain = if events[0].first.terrain[0] == 1 {
        events[0].first
    } else {
        events[0].second
    };
    assert_eq!(terrain.terrain, [1, 0, 0]);
    assert_eq!(terrain.flags & 1, 0);
    e.tilemap
        .set_layer(0, 1, 1, 1.0, 2.0, -1.0, -1.0, true, vec![0]);
    // Query preparation retires geometry but does not advance time.
    e.query_unified_physics(&[], &[], &[], &[]).unwrap();
    let exit = drain(&mut e);
    assert_eq!(exit.len(), 1);
    assert_eq!((exit[0].phase, exit[0].flags), (1, 2));
    let removed = if exit[0].first.terrain[0] == 1 {
        exit[0].first
    } else {
        exit[0].second
    };
    assert_eq!(removed, terrain);
    e.query_unified_physics_collision_pairs().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 0);
}

#[test]
fn native_collision_stream_enable_boundaries_replacement_and_missing_world_clear_results() {
    let mut e = engine(Space::Spatial, 16);
    body(&mut e, 0.0, false);
    let a = body(&mut e, 0.5, true);
    tick(&mut e);
    e.set_unified_physics_collision_events_enabled(true)
        .unwrap(); // Idempotent.
    assert_eq!(drain(&mut e).len(), 1);
    e.set_unified_physics_collision_events_enabled(false)
        .unwrap();
    e.remove_unified_body(a).unwrap();
    assert!(drain(&mut e).is_empty());
    e.set_unified_physics_collision_events_enabled(true)
        .unwrap();
    body(&mut e, 0.5, true);
    tick(&mut e);
    e.set_unified_physics_collision_events_enabled(false)
        .unwrap();
    assert!(drain(&mut e).is_empty()); // Disable explicitly clears pending events.
    e.query_unified_physics_collision_pairs().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 1);
    let bodies: Vec<_> = e
        .unified_physics
        .as_ref()
        .unwrap()
        .entities_by_body
        .values()
        .copied()
        .collect();
    for entity in bodies {
        e.remove_unified_body(entity).unwrap();
    }
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        ..WorldConfig::default()
    })
    .unwrap();
    assert!(drain(&mut e).is_empty());
    e.query_unified_physics_collision_pairs().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 0);
    body(&mut e, 0.0, false);
    body(&mut e, 0.5, true);
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert!(drain(&mut e).is_empty()); // World replacement resets streaming to OFF.
    e.query_unified_physics_collision_pairs().unwrap();
    assert_eq!(e.unified_physics_collision_count(), 1);
    e.set_unified_physics_collision_events_enabled(true)
        .unwrap();
    assert!(drain(&mut e).is_empty()); // Existing overlaps require the snapshot.
    e.query_unified_physics_collision_pairs().unwrap();
    e.unified_physics = None;
    assert!(e.drain_unified_physics_collision_events().is_err());
    assert_eq!(e.unified_physics_collision_count(), 0);
    assert!(e.query_unified_physics_collision_pairs().is_err());
    assert!(e
        .set_unified_physics_collision_events_enabled(true)
        .is_err());
}

#[test]
fn native_collision_stream_retains_spatial_surface_id_on_query_driven_removal() {
    let mut e = engine(Space::Spatial, 16);
    assert!(e.spatial_scene.configure_surfaces(
        &[-1.0, -1.0, 2.0, 2.0, -0.5, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
        &[7, 7, 0, 9],
    ));
    let a = body(&mut e, 0.0, false);
    e.set_unified_body_pose(
        a,
        Pose {
            position: [0.0, 0.49, 0.0],
            ..Pose::default()
        },
    )
    .unwrap();
    tick(&mut e);
    let events = drain(&mut e);
    assert_eq!(events.len(), 1);
    let surface = if events[0].first.terrain[0] == 2 {
        events[0].first
    } else {
        events[0].second
    };
    assert_eq!(surface.terrain, [2, 7, 0]);
    assert_eq!(surface.flags & 1, 0);
    assert!(e.spatial_scene.configure_surfaces(&[], &[]));
    e.query_unified_physics(&[], &[], &[], &[]).unwrap();
    let exit = drain(&mut e);
    assert_eq!(exit.len(), 1);
    assert_eq!((exit[0].phase, exit[0].flags), (1, 2));
    let removed = if exit[0].first.terrain[0] == 2 {
        exit[0].first
    } else {
        exit[0].second
    };
    assert_eq!(removed, surface);
}
