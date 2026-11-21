use super::*;
use crate::components::{CollisionLayer, CollisionMask};
use crate::gameplay_event::*;
use crate::physics3d::{BodyKind, PlanarCollisionSpan, Shape};

#[test]
fn runtime_checkpoint_replays_native_projectile_ownership_input_edge_hit_and_retirement() {
    use crate::engine::runtime_checkpoint::tests::signature;
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, _) = setup(space, 60., 64);
        let target = moving_enemy(
            &mut e,
            Pose {
                position: position(space, 110., 10.),
                ..Pose::default()
            },
            [0.; 3],
            Shape::Sphere { radius: 1. },
        );
        fire(&mut e);
        tick(&mut e);
        release(&mut e);
        assert_eq!(shots(&e).len(), 1);
        let packet = e.runtime_checkpoint().unwrap();
        let before = signature(&e);
        let trace: Vec<_> = (0..20)
            .map(|_| {
                tick(&mut e);
                signature(&e)
            })
            .collect();
        assert_eq!(health(&e, target), 7.);
        assert!(shots(&e).is_empty());
        e.restore_runtime_checkpoint_native(&packet).unwrap();
        assert_eq!(signature(&e), before);
        for expected in trace {
            tick(&mut e);
            assert_eq!(signature(&e), expected);
        }
    }
}

fn position(space: Space, x: f32, height: f32) -> [f32; 3] {
    match space {
        Space::PlanarXy => [x, 100.0, 0.0],
        Space::Spatial => [x, height, -100.0],
    }
}
fn actor(e: &mut Engine, x: f32, height: f32, category: u32, offset: [f32; 3]) -> Entity {
    let space = e.unified_physics.as_ref().unwrap().physics.config().space;
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: position(space, x, height),
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc {
            sensor: true,
            category,
            ..ColliderDesc::new(Shape::Sphere { radius: 1.0 })
        },
        offset,
    )
    .unwrap()
}
fn setup(space: Space, speed: f32, capacity: usize) -> (Engine, Entity) {
    setup_scaled(space, speed, capacity, 1.0)
}
fn setup_scaled(space: Space, speed: f32, capacity: usize, length_unit: f32) -> (Engine, Entity) {
    setup_clock(space, speed, capacity, length_unit, 1.0 / 60.0)
}
fn setup_clock(
    space: Space,
    speed: f32,
    capacity: usize,
    length_unit: f32,
    step_seconds: f32,
) -> (Engine, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_data_scene_camera(400.0, 240.0, u32::MAX, 0, false, 0.0, 0.0, 0.0, 0.0, 0.0);
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.0; 3],
        max_bodies: capacity,
        length_unit,
        step_seconds,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = actor(&mut e, 100.0, 10.0, CollisionMask::PLAYER.bits, [0.0; 3]);
    assert!(e.set_gameplay_action_projectile_with_target(
        a.id,
        a.generation,
        77,
        10.0,
        speed,
        3.0,
        3.0,
        0,
        0,
        0
    ));
    assert!(e.set_input_action_binding(77, 0, 3, 2));
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
    (e, a)
}
fn fire(e: &mut Engine) {
    let screen = e.camera.world_to_screen(Transform2D { x: 300.0, y: 100.0 });
    e.set_input(
        false, false, false, false, false, false, true, screen.x, screen.y,
    );
}
fn release(e: &mut Engine) {
    e.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
}
fn shots(e: &Engine) -> Vec<Entity> {
    e.unified_physics
        .as_ref()
        .unwrap()
        .projectiles
        .keys()
        .map(|&(id, generation)| Entity { id, generation })
        .filter(|&v| e.world.is_current_entity(v))
        .collect()
}
fn health(e: &Engine, target: Entity) -> f32 {
    e.world.health_at_index(target.id as usize).unwrap()
}

fn moving_enemy(e: &mut Engine, pose: Pose, velocity: [f32; 3], shape: Shape) -> Entity {
    let target = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose,
                linear_velocity: velocity,
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                category: CollisionMask::ENEMY.bits,
                ..ColliderDesc::new(shape)
            },
            [0.0; 3],
        )
        .unwrap();
    e.world.set_health(target, 10.0);
    target
}

#[test]
fn native_projectile_hits_target_crossing_between_both_endpoint_bounds() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, _) = setup(space, 6000.0, 64);
        let mut p = position(space, 150.0, 10.0);
        let axis = if space == Space::PlanarXy { 1 } else { 2 };
        p[axis] -= 50.0;
        let mut velocity = [0.0; 3];
        velocity[axis] = 6000.0;
        let target = moving_enemy(
            &mut e,
            Pose {
                position: p,
                ..Pose::default()
            },
            velocity,
            Shape::Sphere { radius: 1.0 },
        );
        fire(&mut e);
        tick(&mut e);
        assert_eq!(health(&e, target), 7.0, "{space:?}");
        assert!(shots(&e).is_empty());
        assert!(e.take_unified_physics_error().is_none());
    }
}

#[test]
fn native_projectile_does_not_hit_co_moving_target_behind_it() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, _) = setup(space, 6000.0, 64);
        let target = moving_enemy(
            &mut e,
            Pose {
                position: position(space, 80.0, 10.0),
                ..Pose::default()
            },
            [6000.0, 0.0, 0.0],
            Shape::Sphere { radius: 1.0 },
        );
        fire(&mut e);
        tick(&mut e);
        assert_eq!(health(&e, target), 10.0, "{space:?}");
        assert_eq!(shots(&e).len(), 1);
    }
}

#[test]
fn native_projectile_spatial_vertical_crossing_uses_relative_height() {
    let (mut e, _) = setup(Space::Spatial, 6000.0, 64);
    let target = moving_enemy(
        &mut e,
        Pose {
            position: [150.0, -40.0, -100.0],
            ..Pose::default()
        },
        [0.0, 6000.0, 0.0],
        Shape::Sphere { radius: 1.0 },
    );
    fire(&mut e);
    tick(&mut e);
    assert_eq!(health(&e, target), 7.0);
}

#[test]
fn native_projectile_hits_rotating_bar_outside_both_endpoint_bounds() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, _) = setup(space, 6000.0, 64);
        let half_angle = std::f32::consts::FRAC_PI_8;
        let rotation = |angle: f32| match space {
            Space::PlanarXy => [0.0, 0.0, angle.sin(), angle.cos()],
            Space::Spatial => [0.0, angle.sin(), 0.0, angle.cos()],
        };
        let center = match space {
            Space::PlanarXy => [150.0, 130.0, 0.0],
            Space::Spatial => [150.0, 10.0, -130.0],
        };
        let target = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: center,
                        rotation: rotation(-half_angle),
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    sensor: true,
                    category: CollisionMask::ENEMY.bits,
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: if space == Space::PlanarXy {
                            [0.3, 30.0, 35.0]
                        } else {
                            [0.3, 3.0, 30.0]
                        },
                    })
                },
                [0.0; 3],
            )
            .unwrap();
        e.world.set_health(target, 10.0);
        let body = e.unified_body_id(target).unwrap();
        e.unified_physics
            .as_mut()
            .unwrap()
            .physics
            .set_kinematic_target(
                body,
                Pose {
                    position: center,
                    rotation: rotation(half_angle),
                },
            )
            .unwrap();
        fire(&mut e);
        tick(&mut e);
        assert_eq!(health(&e, target), 7.0, "{space:?}");
        assert!(shots(&e).is_empty());
        assert!(e.take_unified_physics_error().is_none());
    }
}

#[test]
fn native_projectile_hits_target_that_reverses_inside_the_solver_tick() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, _) = setup_scaled(space, 6000.0, 64, 100.0);
        let axis = if space == Space::PlanarXy { 1 } else { 2 };
        let mut gravity = [0.0; 3];
        gravity[axis] = -720000.0;
        e.set_unified_runtime_settings(
            gravity,
            crate::physics3d::SolverSettings {
                continuous: false,
                ..Default::default()
            },
        )
        .unwrap();
        let mut p = position(space, 125.0, 10.0);
        p[axis] -= 10.0;
        let mut velocity = [0.0; 3];
        velocity[axis] = 6000.0;
        let target = e
            .create_unified_body(
                BodyDesc {
                    pose: Pose {
                        position: p,
                        ..Pose::default()
                    },
                    linear_velocity: velocity,
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    sensor: true,
                    category: CollisionMask::ENEMY.bits,
                    ..ColliderDesc::new(Shape::Sphere { radius: 1.0 })
                },
                [0.0; 3],
            )
            .unwrap();
        e.world.set_health(target, 10.0);
        fire(&mut e);
        tick(&mut e);
        assert!(e.unified_body_state(target).unwrap().pose.position[axis] < p[axis]);
        assert_eq!(health(&e, target), 7.0, "{space:?}");
        assert!(shots(&e).is_empty());
        assert!(e.take_unified_physics_error().is_none());
    }
}

#[test]
fn native_projectile_moves_once_per_tick_and_pauses_with_native_physics() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, _) = setup(space, 60.0, 64);
        fire(&mut e);
        tick(&mut e);
        let shot = shots(&e)[0];
        assert!((e.unified_body_state(shot).unwrap().pose.position[0] - 101.0).abs() < 1e-4);
        assert!(e.world.collider(shot).is_none());
        assert!(e.world.is_unified_physics_index(shot.id as usize));
        release(&mut e);
        tick(&mut e);
        assert!((e.unified_body_state(shot).unwrap().pose.position[0] - 102.0).abs() < 1e-4);
        e.auto_rigid_body_step_enabled = false;
        tick(&mut e);
        assert!((e.unified_body_state(shot).unwrap().pose.position[0] - 102.0).abs() < 1e-4);
        e.auto_rigid_body_step_enabled = true;
        tick(&mut e);
        assert!((e.unified_body_state(shot).unwrap().pose.position[0] - 103.0).abs() < 1e-4);
    }
}

#[test]
fn native_projectile_sweep_hits_thin_target_beyond_both_endpoints_once() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut e, _) = setup(space, 6000.0, 64);
        let enemy = actor(
            &mut e,
            150.0,
            10.0,
            CollisionMask::ENEMY.bits,
            [1000.0, 0.0, 0.0],
        );
        e.world.set_health(enemy, 10.0);
        fire(&mut e);
        tick(&mut e);
        assert_eq!(health(&e, enemy), 7.0);
        assert!(shots(&e).is_empty());
        assert_eq!(
            e.frame_buffers
                .gameplay_events
                .iter()
                .filter(|v| v.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE)
                .count(),
            1
        );
        release(&mut e);
        tick(&mut e);
        assert_eq!(health(&e, enemy), 7.0);
        assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 2);
    }
}

#[test]
fn native_projectile_spatial_height_and_target_masks_filter_actual_geometry() {
    let (mut e, _) = setup(Space::Spatial, 6000.0, 64);
    let high = actor(&mut e, 120.0, 30.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    let blocked = actor(&mut e, 130.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    let target = actor(&mut e, 150.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    let id = e.unified_body_id(blocked).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    let collider = runtime.physics.collider_ids(id).unwrap().next().unwrap();
    runtime
        .physics
        .update_collider(
            collider,
            ColliderDesc {
                sensor: true,
                category: CollisionMask::ENEMY.bits,
                mask: 0,
                ..ColliderDesc::new(Shape::Sphere { radius: 1.0 })
            },
        )
        .unwrap();
    for t in [high, blocked, target] {
        e.world.set_health(t, 10.0);
    }
    fire(&mut e);
    tick(&mut e);
    assert_eq!(health(&e, high), 10.0);
    assert_eq!(health(&e, blocked), 10.0);
    assert_eq!(health(&e, target), 7.0);
}

#[test]
fn native_projectile_planar_floor_and_unspanned_collision_rules_match_bodies() {
    let (mut e, _) = setup(Space::PlanarXy, 6000.0, 64);
    let other = actor(&mut e, 120.0, 0.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    let target = actor(&mut e, 150.0, 0.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    let id = e.unified_body_id(other).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_planar_collision_span(
            id,
            Some(PlanarCollisionSpan {
                floor: 9,
                elevation: 0.0,
                height: 100.0,
            }),
        )
        .unwrap();
    for t in [other, target] {
        e.world.set_health(t, 10.0);
    }
    fire(&mut e);
    tick(&mut e);
    assert_eq!(health(&e, other), 10.0);
    assert_eq!(health(&e, target), 7.0);
}

#[test]
fn native_projectile_ignores_source_compounds_and_selects_nearest_entity() {
    let (mut e, a) = setup(Space::Spatial, 6000.0, 64);
    let source_id = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .add_collider(
            source_id,
            ColliderDesc {
                sensor: true,
                category: CollisionMask::ENEMY.bits,
                ..ColliderDesc::new(Shape::Sphere { radius: 4.0 })
            },
        )
        .unwrap();
    let far = actor(&mut e, 160.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    let near = actor(&mut e, 140.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    for t in [a, near, far] {
        e.world.set_health(t, 10.0);
    }
    fire(&mut e);
    tick(&mut e);
    assert_eq!(health(&e, a), 10.0);
    assert_eq!(health(&e, near), 7.0);
    assert_eq!(health(&e, far), 10.0);
}

#[test]
fn native_projectile_native_mesh_wall_stops_before_enemy() {
    let (mut e, _) = setup(Space::Spatial, 6000.0, 64);
    let enemy = actor(&mut e, 160.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    e.world.set_health(enemy, 10.0);
    let wall = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [130.0, 10.0, -100.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                category: CollisionMask::WALL.bits,
                ..ColliderDesc::new(Shape::TriangleMesh {
                    vertices: vec![
                        [0.0, -5.0, -5.0],
                        [0.0, 5.0, -5.0],
                        [0.0, 5.0, 5.0],
                        [0.0, -5.0, 5.0],
                    ],
                    triangles: vec![[0, 1, 2], [0, 2, 3]],
                })
            },
            [0.0; 3],
        )
        .unwrap();
    fire(&mut e);
    tick(&mut e);
    assert_eq!(health(&e, enemy), 10.0);
    assert!(shots(&e).is_empty());
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_COLLISION_DESPAWN && v.source_id == wall.id));
}

#[test]
fn native_projectile_capacity_rejection_keeps_cooldown_and_scene_unchanged() {
    let (mut e, a) = setup(Space::Spatial, 60.0, 1);
    fire(&mut e);
    tick(&mut e);
    assert_eq!(e.world.alive_indices().len(), 1);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 1);
    assert!(shots(&e).is_empty());
    assert_eq!(
        e.world
            .action_binding(a, 77)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.0
    );
    assert!(!e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_PREFAB_SPAWNED));
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_ACTION_FAILED));
}

#[test]
fn native_projectile_expiry_and_reconfiguration_retire_native_ownership() {
    let (mut e, a) = setup(Space::Spatial, 60.0, 2);
    assert!(e.set_gameplay_action_projectile_with_target(
        a.id,
        a.generation,
        77,
        10.0,
        60.0,
        3.0,
        0.04,
        0,
        0,
        0
    ));
    fire(&mut e);
    tick(&mut e);
    let shot = shots(&e)[0];
    release(&mut e);
    for _ in 0..4 {
        tick(&mut e);
    }
    assert!(!e.world.is_current_entity(shot));
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 1);
    assert!(e.unified_physics.as_ref().unwrap().projectiles.is_empty());
    assert!(e.set_gameplay_action_projectile_with_target(
        a.id,
        a.generation,
        77,
        10.0,
        60.0,
        3.0,
        3.0,
        0,
        0,
        0
    ));
    fire(&mut e);
    tick(&mut e);
    assert_eq!(shots(&e).len(), 1);
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, false));
    tick(&mut e);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 1);
}

#[test]
fn native_projectile_imported_planar_target_works_with_generated_body() {
    use crate::components::AabbCollider;
    let (mut e, _) = setup(Space::PlanarXy, 6000.0, 64);
    let enemy = e.world.spawn_entity();
    e.world
        .set_transform(enemy, Transform2D { x: 150.0, y: 100.0 });
    e.world.set_aabb_collider(
        enemy,
        AabbCollider::new(0.1, 4.0, true, CollisionLayer::Enemy),
    );
    e.world.set_health(enemy, 10.0);
    fire(&mut e);
    tick(&mut e);
    assert_eq!(health(&e, enemy), 7.0);
    assert!(shots(&e).is_empty());
    assert!(e.unified_physics_error().is_none());
}

#[test]
fn native_projectile_high_speed_persists_across_substeps_without_lifting_rigid_speed_cap() {
    let (mut e, _) = setup(Space::Spatial, 6000.0, 64);
    let dynamic = e
        .create_unified_body(
            BodyDesc {
                linear_velocity: [6000.0, 0.0, 0.0],
                pose: Pose {
                    position: [0.0, 100.0, 0.0],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
            [0.0; 3],
        )
        .unwrap();
    fire(&mut e);
    let dt = e.fixed_timestep.config().step_seconds;
    e.update(f64::from(dt) * 3.0);
    let shot = shots(&e)[0];
    let state = e.unified_body_state(shot).unwrap();
    assert!((state.pose.position[0] - 400.0).abs() < 0.001, "{state:?}");
    assert_eq!(state.linear_velocity, [6000.0, 0.0, 0.0]);
    assert!(e.unified_body_state(dynamic).unwrap().linear_velocity[0] <= 400.001);
}

#[test]
fn native_projectile_manual_hits_stop_at_contact_and_are_consumed_once() {
    let (mut e, _) = setup(Space::Spatial, 6000.0, 64);
    let target = actor(&mut e, 150.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    e.world.set_health(target, 10.0);
    e.auto_rigid_body_step_enabled = false;
    fire(&mut e);
    tick(&mut e);
    release(&mut e);
    let shot = shots(&e)[0];
    assert_eq!(e.unified_body_state(shot).unwrap().pose.position[0], 100.0);
    let dt = e.fixed_timestep.config().step_seconds;
    e.step_rigid_bodies(dt);
    let hit = e.unified_body_state(shot).unwrap();
    assert!((hit.pose.position[0] - 147.0).abs() < 0.01, "{hit:?}");
    assert_eq!(hit.linear_velocity, [0.0; 3]);
    assert_eq!(health(&e, target), 10.0);
    let mut pairs = Vec::new();
    e.unified_collision_pairs(&mut pairs).unwrap();
    e.step_rigid_bodies(dt);
    assert_eq!(e.unified_body_state(shot).unwrap().pose, hit.pose);
    tick(&mut e);
    assert!(!e.world.is_current_entity(shot));
    assert_eq!(health(&e, target), 7.0);
    tick(&mut e);
    assert_eq!(health(&e, target), 7.0);
}

#[test]
fn native_projectile_stored_hit_cannot_damage_a_reused_target_generation() {
    let (mut e, _) = setup(Space::Spatial, 6000.0, 64);
    let target = actor(&mut e, 150.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    e.auto_rigid_body_step_enabled = false;
    fire(&mut e);
    tick(&mut e);
    release(&mut e);
    let shot = shots(&e)[0];
    e.step_rigid_bodies(e.fixed_timestep.config().step_seconds);
    e.remove_unified_body(target).unwrap();
    let next = actor(&mut e, 300.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
    assert_eq!(target.id, next.id);
    assert_ne!(target.generation, next.generation);
    e.world.set_health(next, 10.0);
    tick(&mut e);
    assert_eq!(health(&e, next), 10.0);
    assert!(!e.world.is_current_entity(shot));
}

#[test]
fn native_projectile_authored_native_tile_hit_keeps_nearest_hit_precedence() {
    for wall_x in [130.0, 180.0] {
        let (mut e, _) = setup(Space::PlanarXy, 6000.0, 64);
        let target = actor(&mut e, 150.0, 0.0, CollisionMask::ENEMY.bits, [0.0; 3]);
        e.world.set_health(target, 10.0);
        e.tilemap
            .set_tile_definition(1, 1, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        e.tilemap.set_tile_height_span_definition(1, 0, 0.0, 10.0);
        e.tilemap
            .set_layer(0, 1, 1, 2.0, 10.0, wall_x, 95.0, true, vec![1]);
        fire(&mut e);
        tick(&mut e);
        assert!(shots(&e).is_empty());
        assert_eq!(health(&e, target), if wall_x < 150.0 { 10.0 } else { 7.0 });
        assert_eq!(
            e.frame_buffers
                .gameplay_events
                .iter()
                .any(|v| v.kind == GAMEPLAY_EVENT_TILE_IMPACT),
            wall_x < 150.0
        );
    }
}

#[test]
fn native_projectile_timer_aim_uses_physics_positions_instead_of_visual_offsets() {
    let (mut e, a) = setup(Space::Spatial, 60.0, 64);
    let enemy = actor(
        &mut e,
        150.0,
        10.0,
        CollisionMask::ENEMY.bits,
        [-1000.0, 0.0, 0.0],
    );
    assert!(e.set_gameplay_action_projectile_with_target(
        enemy.id,
        enemy.generation,
        88,
        10.0,
        60.0,
        3.0,
        3.0,
        1,
        1,
        0
    ));
    assert!(e.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 99, 0.001, 88));
    tick(&mut e);
    let shot = shots(&e)[0];
    let state = e.unified_body_state(shot).unwrap();
    assert!((state.pose.position[0] - 149.0).abs() < 0.001, "{state:?}");
    assert_eq!(state.linear_velocity, [-60.0, 0.0, 0.0]);
    assert_eq!(
        state.pose.position[1],
        e.unified_body_state(a).unwrap().pose.position[1]
    );
}

#[test]
fn native_projectile_imported_emitter_uses_pending_authored_pose_in_the_same_tick() {
    use crate::components::{CircleCollider, RigidBody};
    let (mut e, old) = setup(Space::PlanarXy, 60.0, 64);
    e.remove_unified_body(old).unwrap();
    let source = e.world.spawn_entity();
    e.world
        .set_transform(source, Transform2D { x: 100.0, y: 100.0 });
    e.world.set_rigid_body(source, RigidBody::kinematic());
    e.world.set_circle_collider(
        source,
        CircleCollider::new(1.0, true, CollisionLayer::Player),
    );
    assert!(e.set_gameplay_action_projectile_with_target(
        source.id,
        source.generation,
        77,
        10.0,
        60.0,
        3.0,
        3.0,
        0,
        0,
        0
    ));
    assert!(e.configure_data_scene_gameplay_v2(true, source.id, source.generation, 0, true));
    tick(&mut e);
    assert_eq!(
        e.unified_body_state(source).unwrap().pose.position[0],
        100.0
    );
    // World is the authoring command surface for imported bodies; the next native
    // tick will synchronize this edit after the input/timer gameplay phase.
    e.world
        .set_transform(source, Transform2D { x: 200.0, y: 100.0 });
    fire(&mut e);
    tick(&mut e);
    assert_eq!(
        e.unified_body_state(source).unwrap().pose.position[0],
        200.0
    );
    let shot = shots(&e)[0];
    assert!((e.unified_body_state(shot).unwrap().pose.position[0] - 201.0).abs() < 0.001);
}

#[test]
fn native_projectile_passes_under_bridge_but_hits_authored_deck() {
    for height in [2.0, 10.0] {
        let (mut e, source) = setup(Space::Spatial, 6000.0, 64);
        e.set_unified_body_pose(
            source,
            Pose {
                position: [100.0, height, -100.0],
                ..Pose::default()
            },
        )
        .unwrap();
        let enemy = actor(&mut e, 170.0, height, CollisionMask::ENEMY.bits, [0.0; 3]);
        e.world.set_health(enemy, 10.0);
        assert!(e.spatial_scene.configure_surfaces(
            &[130.0, 95.0, 10.0, 10.0, 8.0, 12.0, 12.0, 1.0, 1.0, 1.0, 1.0],
            &[47, 0, 0, 9]
        ));
        fire(&mut e);
        tick(&mut e);
        assert!(shots(&e).is_empty());
        assert_eq!(health(&e, enemy), if height < 8.0 { 7.0 } else { 10.0 });
        assert_eq!(
            e.frame_buffers
                .gameplay_events
                .iter()
                .any(|event| event.kind == GAMEPLAY_EVENT_TERRAIN_IMPACT),
            height >= 8.0
        );
        assert_eq!(e.unified_physics_error(), None);
    }
}

#[test]
fn native_projectile_respects_authored_tile_projectile_flag_in_both_spaces() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for blocks in [false, true] {
            let (mut e, _) = setup(space, 6000.0, 64);
            let enemy = actor(&mut e, 170.0, 10.0, CollisionMask::ENEMY.bits, [0.0; 3]);
            e.world.set_health(enemy, 10.0);
            e.tilemap
                .set_layer(0, 1, 1, 5.0, 10.0, 130.0, 95.0, true, vec![1]);
            e.tilemap.set_tile_height_span_definition(1, 0, 0.0, 20.0);
            assert!(e
                .tilemap
                .set_tile_hd2d_definition(1, 0, true, blocks, true, 0.0, false, 0, 0.0, 0.0));
            fire(&mut e);
            tick(&mut e);
            assert_eq!(health(&e, enemy), if blocks { 10.0 } else { 7.0 });
            assert!(shots(&e).is_empty());
            assert_eq!(e.unified_physics_error(), None);
        }
    }
}

#[test]
fn native_projectile_hits_platform_that_crosses_and_returns_inside_one_tick() {
    let (mut e, _) = setup_clock(Space::Spatial, 1.0, 64, 1.0, 0.1);
    assert!(e.spatial_scene.configure_surfaces(
        &[130.0, 95.0, 10.0, 10.0, 8.0, 12.0, 12.0, 1.0, 1.0, 1.0, 1.0],
        &[47, 0, 0, 9]
    ));
    assert!(e.configure_spatial_moving_platforms(&[2.0, 47.0, -40.0, 0.0, 0.0, 0.05, 0.0, 0.0]));
    fire(&mut e);
    tick(&mut e);
    assert_eq!(e.unified_physics_error(), None);
    assert!(shots(&e).is_empty());
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_TERRAIN_IMPACT));
    assert!((e.spatial_scene.surfaces[0].bounds[0] - 130.0).abs() < 0.001);
}

#[test]
fn terrain_integration_projectile_surface_arrival_preserves_xyz_native_generation_and_no_fake_tile()
{
    let (mut e, _) = setup(Space::Spatial, 6000., 64);
    assert!(e.spatial_scene.configure_surfaces(
        &[130., 95., 10., 10., 8., 12., 12., 1., 1., 1., 1.],
        &[47, 0, 0, 9]
    ));
    fire(&mut e);
    tick(&mut e);
    assert_eq!(e.unified_physics_error(), None);
    assert!(shots(&e).is_empty());
    assert!(!e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_TILE_IMPACT));
    let event = e
        .frame_buffers
        .gameplay_events
        .iter()
        .find(|v| v.kind == GAMEPLAY_EVENT_TERRAIN_IMPACT)
        .unwrap();
    let row =
        e.unified_physics.as_ref().unwrap().contacts.terrain_events[event.payload_bits as usize];
    assert_eq!(row.kind, 2);
    assert_eq!(row.terrain, [2, 47, 0]);
    assert_eq!(row.flags, 4);
    assert_eq!(row.actor, [event.actor_id, event.actor_generation]);
    assert_eq!(row.impulse, 0.);
    assert!(row.fraction > 0. && row.fraction < 1.);
    assert!(
        (row.point[0] - 130.).abs() < 0.01
            && (row.point[1] - 10.).abs() < 0.01
            && (row.point[2] + 100.).abs() < 0.01
    );
    assert!(row.normal[0] < -0.99);
    let before = crate::engine::persistence::encode(&e).unwrap();
    let restored = crate::engine::persistence::decode(&before).unwrap();
    assert_eq!(
        crate::engine::persistence::encode(&restored).unwrap(),
        before
    );
}
