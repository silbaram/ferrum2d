use super::*;
use crate::components::{RigidBody, Sprite};
use crate::physics3d::{BodyKind, Shape};

fn engine(config: WorldConfig) -> Engine {
    let mut engine = Engine::new();
    engine.activate_data_scene();
    engine.configure_unified_physics(config).unwrap();
    engine
}

fn ball() -> ColliderDesc {
    ColliderDesc::new(Shape::Sphere { radius: 0.5 })
}
fn tick(engine: &mut Engine, count: usize) {
    let dt = f64::from(engine.fixed_timestep.config().step_seconds);
    for _ in 0..count {
        engine.update(dt);
    }
}

#[test]
fn actual_engine_clock_steps_planar_physics_once_and_renders_the_entity() {
    let mut e = engine(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    });
    e.camera.x = 10.0;
    e.camera.y = 10.0;
    let entity = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [10.0, 10.0, 0.0],
                    ..Pose::default()
                },
                linear_velocity: [2.0, 0.0, 0.0],
                ..BodyDesc::default()
            },
            ball(),
            [0.0; 3],
        )
        .unwrap();
    assert!(e.world.set_sprite_for_test(
        entity,
        Sprite {
            texture_id: 11,
            width: 1.0,
            height: 1.0,
            u0: 0.0,
            v0: 0.0,
            u1: 1.0,
            v1: 1.0,
            r: 1.0,
            g: 1.0,
            b: 1.0,
            a: 1.0,
            rotation_radians: 0.0,
            render_layer: 1000,
            origin_x: 0.5,
            origin_y: 0.5,
            sort_order: 0.0,
            depth_sort: false,
            project_ground: false,
        }
    ));
    let before = e.world.transform(entity).unwrap();
    e.world.update(0.5);
    assert_eq!(e.world.transform(entity), Some(before)); // No legacy velocity integration.
    e.update(0.0);
    let initial_x = e
        .frame_buffers
        .render_commands
        .iter()
        .find(|c| c.texture_id == 11.0)
        .unwrap()
        .x;
    let half = f64::from(e.fixed_timestep.config().step_seconds) * 0.5;
    e.update(half);
    assert_eq!(e.unified_body_state(entity).unwrap().pose.position[0], 10.0);
    e.update(half);
    tick(&mut e, 29);
    let state = e.unified_body_state(entity).unwrap();
    assert!((state.pose.position[0] - 11.0).abs() < 0.001, "{state:?}");
    assert!((e.world.transform(entity).unwrap().x - 11.0).abs() < 0.001);
    let rendered_x = e
        .frame_buffers
        .render_commands
        .iter()
        .find(|c| c.texture_id == 11.0)
        .unwrap()
        .x;
    assert!((rendered_x - initial_x - 1.0).abs() < 0.001);
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn spatial_engine_collides_with_ground_and_projects_elevation_and_negative_z() {
    let mut e = engine(WorldConfig::default());
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [0.0, -0.1, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [10.0, 0.1, 10.0],
        }),
        [0.0; 3],
    )
    .unwrap();
    let body = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [2.0, 4.0, 3.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ball(),
            [0.0, -0.5, 0.0],
        )
        .unwrap();
    tick(&mut e, 240);
    let state = e.unified_body_state(body).unwrap();
    assert!((state.pose.position[1] - 0.5).abs() < 0.025, "{state:?}");
    let at = e.world.transform(body).unwrap();
    assert!((at.x - 2.0).abs() < 0.001 && (at.y + 3.0).abs() < 0.001);
    assert!(e.world.height_span(body).unwrap().elevation.abs() < 0.025);
    assert!(state.linear_velocity[1].abs() < 0.01);
}

#[test]
fn native_character_input_uses_engine_pause_and_fixed_ticks() {
    let mut e = engine(WorldConfig::default());
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [0.0, -0.1, 0.0],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [20.0, 0.1, 20.0],
        }),
        [0.0; 3],
    )
    .unwrap();
    let body = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0.0, 3.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.4,
            }),
            [0.0, -0.9, 0.0],
        )
        .unwrap();
    e.enable_unified_character(body, CharacterConfig::default())
        .unwrap();
    tick(&mut e, 180);
    assert!(e.unified_character_state(body).unwrap().grounded);
    e.set_unified_character_input(
        body,
        CharacterInput {
            velocity: [2.0, 0.0, 0.0],
            jump_speed: 4.0,
        },
    )
    .unwrap();
    e.fixed_timestep.pause();
    let before = e.unified_body_state(body).unwrap();
    tick(&mut e, 30);
    assert_eq!(e.unified_body_state(body).unwrap(), before);
    e.fixed_timestep.resume();
    tick(&mut e, 1);
    assert!(e.unified_character_state(body).unwrap().vertical_speed > 3.0);
    tick(&mut e, 59);
    assert!((e.unified_body_state(body).unwrap().pose.position[0] - 2.0).abs() < 0.03);
    assert!(e.unified_character_state(body).unwrap().grounded);
}

#[test]
fn native_entity_deletion_slot_reuse_and_scene_reset_remove_physics_ownership() {
    let mut e = engine(WorldConfig {
        gravity: [0.0; 3],
        ..WorldConfig::default()
    });
    let old = e
        .create_unified_body(BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    e.world.despawn(old);
    let fresh = e.world.spawn_entity();
    assert_eq!(old.id, fresh.id);
    assert_ne!(old.generation, fresh.generation);
    e.world.set_transform(fresh, Transform2D::default());
    e.world.set_velocity(fresh, Velocity { vx: 2.0, vy: 0.0 });
    assert_eq!(
        e.unified_body_state(old),
        Err(UnifiedPhysicsError::StaleEntity)
    );
    tick(&mut e, 30);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
    assert!((e.world.transform(fresh).unwrap().x - 1.0).abs() < 0.001);
    let body = e
        .create_unified_body(BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    e.reset_game();
    assert_eq!(
        e.unified_body_state(body),
        Err(UnifiedPhysicsError::StaleEntity)
    );
    tick(&mut e, 1);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
    assert!(e.world.unified_physics_entities.is_empty());
}

#[test]
fn rejected_native_creation_and_clock_change_leave_existing_world_intact() {
    let mut e = engine(WorldConfig {
        max_bodies: 1,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    });
    let body = e
        .create_unified_body(BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    let count = e.world.alive_count();
    assert_eq!(
        e.create_unified_body(BodyDesc::default(), ball(), [0.0; 3]),
        Err(UnifiedPhysicsError::Physics(PhysicsError::CapacityExceeded))
    );
    assert_eq!(
        e.create_unified_body(BodyDesc::default(), ball(), [f32::NAN, 0.0, 0.0]),
        Err(UnifiedPhysicsError::InvalidVisualOffset)
    );
    assert_eq!(e.world.alive_count(), count);
    let clock = e.fixed_timestep.config();
    e.configure_fixed_timestep(false, 0.1, 0.25, 4);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::ClockMismatch)
    );
    assert_eq!(e.fixed_timestep.config(), clock);
    assert!(e.fixed_timestep_enabled);
    e.set_unified_body_velocity(body, [1.0, 0.0, 0.0], [0.0; 3])
        .unwrap();
    tick(&mut e, 60);
    assert!((e.unified_body_state(body).unwrap().pose.position[0] - 1.0).abs() < 0.001);
}

#[test]
fn legacy_rigid_components_cannot_silently_select_a_second_solver() {
    let mut e = engine(WorldConfig::default());
    let body = e
        .create_unified_body(BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    let legacy = e.world.spawn_entity();
    e.world.set_transform(legacy, Transform2D::default());
    e.world.set_rigid_body(legacy, RigidBody::dynamic(1.0));
    e.auto_rigid_body_step_enabled = true;
    let before = e.unified_body_state(body).unwrap();
    tick(&mut e, 1);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::LegacyBodiesPresent)
    );
    assert_eq!(e.unified_body_state(body).unwrap(), before);
    assert_eq!(e.world.transform(legacy), Some(Transform2D::default()));
}

#[test]
fn switching_to_a_builtin_scene_releases_native_bindings() {
    for scene in 0..3 {
        let mut e = crate::engine::legacy_test_fixture::engine();
        e.activate_data_scene();
        e.configure_unified_physics(WorldConfig::default()).unwrap();
        let body = e
            .create_unified_body(BodyDesc::default(), ball(), [0.0; 3])
            .unwrap();
        match scene {
            0 => e.activate_built_in_shooter_scene(),
            1 => e.activate_built_in_breakout_scene(),
            _ => e.activate_built_in_platformer_scene(),
        }
        assert!(e.unified_physics.is_none());
        assert!(!e.world.is_current_entity(body));
        assert!(e.world.unified_physics_entities.is_empty());
        assert_eq!(
            e.configure_unified_physics(WorldConfig::default()),
            Err(UnifiedPhysicsError::WrongScene)
        );
    }
}

#[test]
fn native_render_interpolation_never_changes_simulation_and_teleport_invalidates_history() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(WorldConfig {
            space,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        });
        e.configure_physics_render_interpolation(true);
        let entity = e
            .create_unified_body(
                BodyDesc {
                    linear_velocity: [2.0, 2.0, 0.0],
                    ..BodyDesc::default()
                },
                ball(),
                [0.0; 3],
            )
            .unwrap();
        let dt = e.fixed_timestep.config().step_seconds;
        e.update(f64::from(dt) * 1.5);
        let native = e.unified_body_state(entity).unwrap();
        assert!((native.pose.position[0] - 2.0 * dt).abs() < 1.0e-5);
        let rendered = e
            .world
            .render_transform_at_index(entity.id as usize)
            .unwrap();
        assert!((rendered.x - dt).abs() < 1.0e-5, "{rendered:?}");
        if space == Space::Spatial {
            assert!(
                (e.world
                    .render_height_span_at(entity.id as usize)
                    .unwrap()
                    .elevation
                    - dt)
                    .abs()
                    < 1.0e-5
            );
        }
        e.set_unified_body_pose(
            entity,
            Pose {
                position: [5.0, 6.0, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
        assert_eq!(
            e.world
                .render_transform_at_index(entity.id as usize)
                .unwrap()
                .x,
            5.0
        );
        assert_eq!(
            e.unified_body_state(entity).unwrap().pose.position,
            [5.0, 6.0, 0.0]
        );
    }
}

#[test]
fn legacy_snapshots_cannot_report_success_while_omitting_native_state() {
    let mut e = engine(WorldConfig::default());
    let body = e
        .create_unified_body(BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    let before = e.unified_body_state(body).unwrap();
    assert!(!e.begin_physics_restore_transaction());
    assert!(!e.capture_physics_body_snapshot_bulk(vec![body.id, body.generation]));
    assert!(!e.restore_physics_body_snapshot_bulk(vec![], vec![], vec![]));
    assert!(!e.restore_physics_solver_state_bulk(&[], &[], &[], &[]));
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::LegacySnapshotUnsupported)
    );
    assert_eq!(e.unified_body_state(body).unwrap(), before);
    let mut fresh = crate::engine::legacy_test_fixture::engine();
    fresh.activate_data_scene();
    assert!(fresh.begin_physics_restore_transaction());
    assert_eq!(
        fresh.configure_unified_physics(WorldConfig::default()),
        Err(UnifiedPhysicsError::LegacySnapshotUnsupported)
    );
    assert!(fresh.end_physics_restore_transaction(false));
}

#[test]
fn minimum_native_timestep_does_not_advance_on_zero_or_half_a_tick() {
    for step_seconds in [0.0001, 0.001, 1.0 / 60.0] {
        let mut e = engine(WorldConfig {
            step_seconds,
            space: Space::PlanarXy,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        });
        let entity = e
            .create_unified_body(
                BodyDesc {
                    linear_velocity: [2.0, 0.0, 0.0],
                    ..BodyDesc::default()
                },
                ball(),
                [0.0; 3],
            )
            .unwrap();
        e.update(0.0);
        assert_eq!(e.last_fixed_update.steps, 0, "step_seconds={step_seconds}");
        e.update(f64::from(step_seconds) * 0.5);
        assert_eq!(e.last_fixed_update.steps, 0);
        assert_eq!(e.unified_body_state(entity).unwrap().pose.position[0], 0.0);
        e.update(f64::from(step_seconds) * 0.5);
        assert_eq!(e.last_fixed_update.steps, 1);
        assert!(
            (e.unified_body_state(entity).unwrap().pose.position[0] - 2.0 * step_seconds).abs()
                < step_seconds * 0.001
        );
    }
}

#[test]
fn creation_reclaims_deleted_native_bodies_before_the_next_tick() {
    let mut e = engine(WorldConfig {
        max_bodies: 1,
        ..WorldConfig::default()
    });
    let old = e
        .create_unified_body(BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    e.world.despawn(old);
    let fresh = e
        .create_unified_body(BodyDesc::default(), ball(), [0.0; 3])
        .unwrap();
    assert_eq!(old.id, fresh.id);
    assert_ne!(old.generation, fresh.generation);
    assert_eq!(
        e.unified_body_state(old),
        Err(UnifiedPhysicsError::StaleEntity)
    );
    assert!(e.unified_body_state(fresh).is_ok());
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 1);
    e.world.despawn(fresh);
    assert!(e.configure_unified_physics(WorldConfig::default()).is_ok());
}
