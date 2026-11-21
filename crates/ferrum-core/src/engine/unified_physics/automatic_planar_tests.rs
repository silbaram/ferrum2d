use super::*;
use crate::components::gameplay::{MovementPattern, MovementTarget};
use crate::components::{AabbCollider, CollisionLayer, CollisionMask, RigidBody};
use crate::physics3d::{BodyKind, Shape};

fn actor(e: &mut Engine, x: f32, y: f32) -> Entity {
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x, y });
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(0.25, 0.25, false, CollisionLayer::Player),
    );
    e.world.set_rigid_body(a, RigidBody::kinematic());
    a
}
fn scene() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = actor(&mut e, 0.5, 0.5);
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
    e.configure_physics_spec_planar(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    e.set_auto_rigid_body_step_enabled(true);
    (e, a)
}
fn obstacle(e: &mut Engine, x: f32, y: f32) -> Entity {
    let mut c = ColliderDesc::new(Shape::Box {
        half_extents: [0.25, 4., 2.],
    });
    c.category = CollisionMask::WALL.bits;
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [x, y, 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        c,
        [0.; 3],
    )
    .unwrap()
}
fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(0.01);
        assert_eq!(e.unified_physics_error(), None);
    }
}
fn pos(e: &Engine, a: Entity) -> Transform2D {
    let at = e.world.transform(a).unwrap();
    assert_eq!(
        e.unified_body_state(a).unwrap().pose.position,
        [at.x, at.y, 0.]
    );
    at
}

#[test]
fn automatic_planar_input_velocity_sweeps_slides_and_integrates_once() {
    let (mut e, a) = scene();
    let w = obstacle(&mut e, 2., 2.);
    assert!(e.world.collider(w).is_none());
    let v = Velocity { vx: 300., vy: 200. };
    e.world.set_velocity(a, v);
    e.set_input(false, false, false, true, false, false, false, 0., 0.);
    tick(&mut e, 1);
    let p = pos(&e, a);
    assert!(
        (p.x - 1.5).abs() < 0.002 && (p.y - 2.5).abs() < 0.002,
        "{p:?}"
    );
    assert_eq!(e.world.velocity(a), Some(v));
    assert_eq!(e.physics_counters.kinematic_moves, 1);
    assert!(e.physics_counters.kinematic_entity_hits > 0);
    tick(&mut e, 1);
    let p = pos(&e, a);
    assert!(
        (p.x - 1.5).abs() < 0.002 && (p.y - 4.5).abs() < 0.002,
        "{p:?}"
    );
}

#[test]
fn automatic_planar_removed_wall_checkpoint_preserves_pending_cache_and_chase() {
    let (mut e, player) = scene();
    let wall = obstacle(&mut e, 2., 2.);
    e.world
        .set_velocity(player, Velocity { vx: 300., vy: 200. });
    tick(&mut e, 1);
    let slide = pos(&e, player);
    assert!((slide.x - 1.5).abs() < 0.002 && (slide.y - 2.5).abs() < 0.002);
    e.remove_unified_body(wall).unwrap();

    let enemy = actor(&mut e, 10., 10.);
    let target = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [20., 10., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.1 })
            },
            [-100., 0., 0.],
        )
        .unwrap();
    e.world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: 2.,
        },
    );
    e.world.set_velocity(player, Velocity::default());
    // No cleanup tick may consume the removed collider, new actor or AI input.
    let checkpoint = e.runtime_checkpoint().unwrap();
    let before = crate::engine::runtime_checkpoint::tests::signature(&e);
    let trace: Vec<_> = (0..15)
        .map(|_| {
            tick(&mut e, 1);
            crate::engine::runtime_checkpoint::tests::signature(&e)
        })
        .collect();
    assert!((pos(&e, enemy).x - 10.3).abs() < 0.001);
    assert_eq!(pos(&e, player), slide);
    e.restore_runtime_checkpoint_native(&checkpoint).unwrap();
    assert_eq!(
        crate::engine::runtime_checkpoint::tests::signature(&e),
        before
    );
    for expected in trace {
        tick(&mut e, 1);
        assert_eq!(
            crate::engine::runtime_checkpoint::tests::signature(&e),
            expected
        );
    }
}

#[test]
fn automatic_planar_cold_component_import_moves_once_and_keeps_angular_velocity() {
    let (mut e, _) = scene();
    let a = actor(&mut e, 10., 10.);
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    e.world.set_angular_velocity(
        a,
        AngularVelocity {
            radians_per_second: 1.,
        },
    );
    tick(&mut e, 1);
    assert!((pos(&e, a).x - 10.02).abs() < 0.001);
    assert!((e.world.rotations[a.id as usize].unwrap().radians - 0.01).abs() < 0.001);
}

#[test]
fn automatic_planar_component_ai_targets_native_physical_pose_after_import() {
    let (mut e, _) = scene();
    let a = actor(&mut e, 10., 10.);
    let target = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [20., 10., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
            [-100., 0., 0.],
        )
        .unwrap();
    // Its displayed World position is to the left, its physical position to the right.
    assert!(e.world.transform(target).unwrap().x < 0.);
    e.world.set_movement_pattern(
        a,
        MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: 2.,
        },
    );
    tick(&mut e, 1);
    assert!((pos(&e, a).x - 10.02).abs() < 0.001);
    assert_eq!(e.world.velocity(a).unwrap(), Velocity { vx: 2., vy: 0. });
}

#[test]
fn automatic_planar_ai_acceleration_keeps_previous_native_intent_each_fixed_tick() {
    for dynamic in [false, true] {
        let (mut e, _) = scene();
        let a = actor(&mut e, 10., 10.);
        if dynamic {
            e.world.set_rigid_body(a, RigidBody::dynamic(1.));
        }
        e.world.set_movement_pattern(
            a,
            MovementPattern::Accelerate {
                acceleration_x: 1.,
                acceleration_y: 0.,
                max_speed: 10.,
            },
        );
        tick(&mut e, 3);
        assert_eq!(e.world.velocity(a).unwrap().vx, 3.);
        assert!((pos(&e, a).x - 10.06).abs() < 0.002);
    }
}

#[test]
fn automatic_planar_fixed_remainder_pause_and_checkpoint_replay_match_native_bytes() {
    let (mut e, a) = scene();
    obstacle(&mut e, 2., 2.);
    e.world.set_velocity(a, Velocity { vx: 100., vy: 20. });
    e.update(0.001);
    assert_eq!(pos(&e, a).x, 0.5);
    assert!(e.pause_data_scene());
    e.update(0.1);
    assert_eq!(pos(&e, a).x, 0.5);
    assert!(e.resume_data_scene());
    let checkpoint = e.capture_runtime_checkpoint().unwrap();
    tick(&mut e, 3);
    let expected = pos(&e, a);
    assert!(expected.x > 1.4 && expected.y > 1.);
    let bytes = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .capture_snapshot()
        .unwrap()
        .encoded_bytes()
        .to_vec();
    assert!(e.restore_runtime_checkpoint(&checkpoint));
    tick(&mut e, 3);
    assert_eq!(pos(&e, a), expected);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        bytes
    );
    assert!(e
        .unified_physics
        .as_ref()
        .unwrap()
        .automatic_planar
        .saved
        .is_empty());
}

#[test]
fn automatic_planar_route_handoff_preserves_manual_velocity_without_duplicate_motion() {
    let (mut e, a) = scene();
    assert!(e.configure_data_scene_navigation(12, 2, 1., 1., 0., 0., &[1; 24]));
    assert!(e.move_data_scene_actor_to(9.5, 0.5, 2., 0., CollisionMask::WALL.bits, true));
    e.world.set_velocity(a, Velocity { vx: 5., vy: 0. });
    e.set_input(false, false, false, true, false, false, false, 0., 0.);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_move_status(), 4);
    assert!((pos(&e, a).x - 0.55).abs() < 0.001);
}

#[test]
fn automatic_planar_disabled_and_trigger_bodies_preserve_native_contract() {
    let (mut e, a) = scene();
    let mut rigid = RigidBody::kinematic();
    rigid.enabled = false;
    e.world.set_rigid_body(a, rigid);
    e.world.set_velocity(a, Velocity { vx: 100., vy: 0. });
    tick(&mut e, 1);
    assert_eq!(pos(&e, a).x, 0.5);
    e.world.set_rigid_body(a, RigidBody::kinematic());
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(0.25, 0.25, true, CollisionLayer::Player),
    );
    obstacle(&mut e, 2., 0.5);
    tick(&mut e, 3);
    assert!((pos(&e, a).x - 3.5).abs() < 0.001);
}

#[test]
fn automatic_planar_legacy_navigation_cannot_fall_back_inside_native_world() {
    let (mut e, a) = scene();
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId::DEFAULT, 0., 1.).unwrap());
    assert!(!e.configure_data_scene_gameplay_v4(
        true,
        a.id,
        a.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[1., 1., 1., 0.2, 0., 4.]
    ));
    assert!(e
        .data_scene
        .gameplay
        .combat
        .accepts_native_world(Space::PlanarXy));
}

#[test]
fn automatic_planar_native_ai_does_not_erase_or_repeat_queued_dynamic_impulse() {
    let (mut e, _) = scene();
    let a = actor(&mut e, 10., 10.);
    e.world.set_rigid_body(a, RigidBody::dynamic(1.));
    e.world
        .set_movement_pattern(a, MovementPattern::Linear { vx: 2., vy: 0. });
    e.world.apply_impulse(a, Velocity { vx: 3., vy: 0. });
    tick(&mut e, 1);
    assert!((e.world.velocity(a).unwrap().vx - 5.).abs() < 0.001);
    assert!((pos(&e, a).x - 10.05).abs() < 0.001);
    assert_eq!(e.world.rigid_body(a).unwrap().impulse, Velocity::default());
    tick(&mut e, 1);
    assert!((e.world.velocity(a).unwrap().vx - 2.).abs() < 0.001);
    assert!((pos(&e, a).x - 10.07).abs() < 0.001);
}

#[test]
fn automatic_planar_native_masks_sensors_disable_and_height_filter_obstacles() {
    let (mut e, a) = scene();
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId::DEFAULT, 0., 1.).unwrap());
    for (x, kind) in [(1., 0), (2., 1), (3., 2), (4., 3), (7., 4)] {
        let mut c = ColliderDesc::new(Shape::Box {
            half_extents: [0.25, 4., 2.],
        });
        c.category = CollisionMask::WALL.bits;
        c.sensor = kind == 0;
        if kind == 3 {
            c.mask = 0;
        }
        let target = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: [x, 0.5, 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                c,
                [0.; 3],
            )
            .unwrap();
        let id = e.unified_body_id(target).unwrap();
        let p = &mut e.unified_physics.as_mut().unwrap().physics;
        if kind == 1 {
            p.set_body_options(
                id,
                &crate::physics3d::BodyOptions {
                    enabled: false,
                    ..Default::default()
                },
            )
            .unwrap();
        }
        p.set_planar_collision_span(
            id,
            Some(crate::physics3d::PlanarCollisionSpan {
                floor: if kind == 2 { 9 } else { 0 },
                elevation: 0.,
                height: 1.,
            }),
        )
        .unwrap();
    }
    e.world.set_velocity(a, Velocity { vx: 1000., vy: 0. });
    tick(&mut e, 1);
    assert!((pos(&e, a).x - 6.5).abs() < 0.002);
}

#[test]
fn automatic_planar_rejects_unapproved_height_step_and_keeps_intent() {
    let (mut e, a) = scene();
    e.world.set_transform(a, Transform2D { x: 5., y: 5. });
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId::DEFAULT, 0., 1.).unwrap());
    e.tilemap
        .set_layer(0, 2, 1, 10., 10., 0., 0., true, vec![1, 2]);
    for (id, elevation) in [(1, 0.), (2, 3.)] {
        assert!(e
            .tilemap
            .set_tile_height_span_definition(id, 0, elevation, 0.));
        assert!(e
            .tilemap
            .set_tile_hd2d_definition(id, 0, false, false, false, 0., false, 0, 0., 0.));
    }
    e.world.set_velocity(a, Velocity { vx: 1000., vy: 0. });
    tick(&mut e, 1);
    assert_eq!(pos(&e, a), Transform2D { x: 5., y: 5. });
    assert_eq!(e.world.height_span(a).unwrap().elevation, 0.);
    assert_eq!(e.world.velocity(a).unwrap().vx, 1000.);
}

#[test]
fn automatic_planar_enabling_native_rejects_active_legacy_navigation_atomically() {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_data_scene();
    let a = actor(&mut e, 0., 0.);
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId::DEFAULT, 0., 1.).unwrap());
    assert!(e.configure_data_scene_gameplay_v4(
        true,
        a.id,
        a.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[1., 1., 1., 0.2, 0., 4.]
    ));
    assert_eq!(
        e.configure_unified_physics(WorldConfig {
            space: Space::PlanarXy,
            ..Default::default()
        }),
        Err(UnifiedPhysicsError::Physics(PhysicsError::UnsupportedShape))
    );
    assert!(e.unified_physics.is_none());
    assert_eq!(e.world.transform(a), Some(Transform2D { x: 0., y: 0. }));
    assert!(!e
        .data_scene
        .gameplay
        .combat
        .accepts_native_world(Space::PlanarXy));
}

#[test]
fn automatic_planar_native_mover_keeps_periodic_timer_dispatch() {
    for imported in [true, false] {
        let (mut e, _) = scene();
        let a = if imported {
            actor(&mut e, 10., 10.)
        } else {
            e.create_unified_body(
                BodyDesc {
                    kind: BodyKind::KinematicVelocity,
                    pose: Pose {
                        position: [10., 10., 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
                [0.; 3],
            )
            .unwrap()
        };
        e.world
            .set_movement_pattern(a, MovementPattern::Linear { vx: 2., vy: 0. });
        assert!(e.set_gameplay_action_projectile_with_target(
            a.id,
            a.generation,
            31,
            0.,
            1.,
            1.,
            0.2,
            1,
            1,
            0
        ));
        assert!(e.set_gameplay_timer_action_trigger(a.id, a.generation, 17, 0.01, 31));
        let mut fired = 0;
        for _ in 0..3 {
            e.clear_events();
            tick(&mut e, 1);
            fired += e
                .frame_buffers
                .gameplay_events
                .iter()
                .filter(|event| {
                    event.kind == crate::gameplay_event::GAMEPLAY_EVENT_TIMER
                        && event.actor_id == a.id
                        && event.token_id == 17
                })
                .count();
        }
        assert_eq!(fired, 3, "imported={imported}");
        assert_eq!(e.data_scene_combat_stats()[3], 3);
        assert!((pos(&e, a).x - 10.06).abs() < 0.002);
    }
}

#[test]
fn automatic_planar_rejected_later_move_restores_earlier_mover_and_pending_impulse() {
    let (mut e, a) = scene();
    let bad = actor(&mut e, 999_999., 0.5);
    let dynamic = actor(&mut e, 10., 10.);
    e.world.set_rigid_body(dynamic, RigidBody::dynamic(1.));
    e.world.apply_impulse(dynamic, Velocity { vx: 3., vy: 0. });
    e.world.set_velocity(a, Velocity { vx: 2., vy: 0. });
    e.world.set_velocity(bad, Velocity { vx: 1000., vy: 0. });
    let initial = e.world.transform(a).unwrap();
    e.update(0.01);
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidBody))
    );
    assert_eq!(pos(&e, a), initial);
    assert_eq!(e.world.velocity(a).unwrap(), Velocity { vx: 2., vy: 0. });
    assert_eq!(e.world.rigid_body(dynamic).unwrap().impulse.vx, 3.);
    assert_eq!(
        e.unified_body_state(dynamic).unwrap().linear_velocity,
        [0.; 3]
    );
    e.take_unified_physics_error();
    e.world.set_velocity(bad, Velocity::default());
    tick(&mut e, 1);
    assert!((pos(&e, a).x - initial.x - 0.02).abs() < 0.001);
    assert!((e.world.velocity(dynamic).unwrap().vx - 3.).abs() < 0.001);
    assert_eq!(
        e.world.rigid_body(dynamic).unwrap().impulse,
        Velocity::default()
    );
}
