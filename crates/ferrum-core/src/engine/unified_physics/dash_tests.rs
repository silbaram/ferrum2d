use super::*;
use crate::components::CollisionMask;
use crate::gameplay_event::*;
use crate::physics3d::{BodyKind, Shape};
fn engine(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn body(
    e: &mut Engine,
    kind: BodyKind,
    p: [f32; 3],
    sensor: bool,
    category: u32,
    velocity: [f32; 3],
    offset: [f32; 3],
) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind,
            pose: Pose {
                position: p,
                ..Pose::default()
            },
            linear_velocity: velocity,
            ..BodyDesc::default()
        },
        ColliderDesc {
            sensor,
            category,
            ..ColliderDesc::new(Shape::Sphere { radius: 0.25 })
        },
        offset,
    )
    .unwrap()
}
fn bind(e: &mut Engine, a: Entity, distance: f32) {
    assert!(e.set_gameplay_action_dash(a.id, a.generation, 77, 1., distance));
    assert!(e.set_input_action_binding(
        77,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
}
fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
}
fn fire(e: &mut Engine) {
    e.set_input(false, false, false, true, false, false, true, -1., -1.);
    tick(e);
}
fn x(e: &Engine, a: Entity) -> f32 {
    e.unified_body_state(a).unwrap().pose.position[0]
}
fn remaining(e: &Engine, a: Entity) -> f32 {
    e.world
        .action_binding(a, 77)
        .unwrap()
        .cooldown
        .remaining_seconds
}
fn wall(e: &mut Engine, x: f32, velocity: f32) -> Entity {
    e.create_unified_body(
        BodyDesc {
            kind: if velocity == 0. {
                BodyKind::Fixed
            } else {
                BodyKind::KinematicVelocity
            },
            pose: Pose {
                position: [x, 1., 0.],
                ..Pose::default()
            },
            linear_velocity: [velocity, 0., 0.],
            ..BodyDesc::default()
        },
        ColliderDesc {
            category: CollisionMask::WALL.bits,
            ..ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 1., 1.],
            })
        },
        [0.; 3],
    )
    .unwrap()
}
#[test]
fn native_dash_kinematic_velocity_preserves_intent_and_ignores_visual_offset() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = engine(space);
        let a = body(
            &mut e,
            BodyKind::KinematicVelocity,
            [0., 1., 0.],
            true,
            1,
            [2., 0., 0.],
            [100., 0., 0.],
        );
        bind(&mut e, a, 4.);
        fire(&mut e);
        assert!((x(&e, a) - (4. + 2. / 60.)).abs() < 0.001, "{}", x(&e, a));
        assert!(remaining(&e, a) > 0.9);
        assert_eq!(
            e.unified_body_state(a).unwrap().linear_velocity,
            [2., 0., 0.]
        );
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
        tick(&mut e);
        assert!((x(&e, a) - (4. + 4. / 60.)).abs() < 0.001);
        assert_eq!(e.unified_physics_error(), None);
    }
}
#[test]
fn native_dash_position_target_is_added_and_does_not_recur_next_tick() {
    let mut e = engine(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::KinematicPosition,
        [0., 1., 0.],
        false,
        1,
        [0.; 3],
        [0.; 3],
    );
    bind(&mut e, a, 3.);
    let id = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_kinematic_target(
            id,
            Pose {
                position: [1., 1., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    fire(&mut e);
    assert!((x(&e, a) - 4.).abs() < 0.001);
    tick(&mut e);
    assert!((x(&e, a) - 4.).abs() < 0.001);
}
#[test]
fn native_dash_sweeps_solids_even_when_the_actor_is_a_sensor() {
    for sensor in [true, false] {
        let mut e = engine(Space::Spatial);
        let a = body(
            &mut e,
            BodyKind::KinematicVelocity,
            [0., 1., 0.],
            sensor,
            1,
            [0.; 3],
            [0.; 3],
        );
        wall(&mut e, 2., 0.);
        bind(&mut e, a, 4.);
        fire(&mut e);
        assert!(x(&e, a) > 1.6 && x(&e, a) < 1.651, "{}", x(&e, a));
        assert!(remaining(&e, a) > 0.9);
        assert_eq!(e.unified_physics_error(), None);
    }
}
#[test]
fn sensor_dash_and_native_ccd_each_respect_collision_filters() {
    let mut e = engine(Space::Spatial);
    let dash = body(
        &mut e,
        BodyKind::KinematicVelocity,
        [0., 1., 0.],
        true,
        1,
        [0.; 3],
        [0.; 3],
    );
    for (z, category, mask, sensor, x) in [
        (0., 1, 0, false, 1.),
        (0., 1, 1, true, 1.3),
        (0., 1, 1, false, 2.),
        (4., 2, 0, false, 1.),
        (4., 2, 2, true, 1.3),
        (4., 2, 2, false, 2.),
    ] {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [x, 1., z],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                category,
                mask,
                sensor,
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [0.1, 1., 0.5],
                })
            },
            [0.; 3],
        )
        .unwrap();
    }
    let ball = e
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [0., 1., 4.],
                    ..Pose::default()
                },
                linear_velocity: [300., 0., 0.],
                ccd: true,
                ..BodyDesc::default()
            },
            ColliderDesc {
                category: 2,
                mask: 2,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.25 })
            },
            [0.; 3],
        )
        .unwrap();

    bind(&mut e, dash, 4.);
    fire(&mut e);
    assert_eq!(e.unified_physics_error(), None);
    assert!(
        (1.6..1.651).contains(&x(&e, dash)),
        "dash x={}",
        x(&e, dash)
    );
    assert!(remaining(&e, dash) > 0.9);
    assert!((1.6..1.66).contains(&x(&e, ball)), "ball x={}", x(&e, ball));
    let clamps = e.unified_ccd_clamps().unwrap();
    assert_eq!(clamps.len(), 1);
    assert_eq!(clamps[0].moving, ball);
}

#[test]
fn native_dash_uses_relative_motion_of_an_incoming_wall() {
    let mut e = engine(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::KinematicVelocity,
        [0., 1., 0.],
        true,
        1,
        [0.; 3],
        [0.; 3],
    );
    let w = wall(&mut e, 3., -120.);
    bind(&mut e, a, 4.);
    fire(&mut e);
    assert!(x(&e, a) > 1.7 && x(&e, a) < 1.8, "{}", x(&e, a));
    assert!((x(&e, w) - x(&e, a) - 0.3501).abs() < 0.001);
    assert_eq!(
        e.unified_physics_step_statistics()
            .unwrap()
            .kinematic_character_stops,
        0
    );
    assert_eq!(e.unified_physics_error(), None);
}
#[test]
fn native_dash_fully_blocked_does_not_commit_cooldown() {
    let mut e = engine(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::KinematicVelocity,
        [0., 1., 0.],
        true,
        1,
        [0.; 3],
        [0.; 3],
    );
    wall(&mut e, 0.35, 0.);
    bind(&mut e, a, 4.);
    fire(&mut e);
    assert!(x(&e, a).abs() < 0.001);
    assert_eq!(remaining(&e, a), 0.);
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_ACTION_FAILED));
}
#[test]
fn native_dash_timer_aims_at_physical_primary_actor_position() {
    let mut e = engine(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::Fixed,
        [5., 1., 0.],
        true,
        1,
        [0.; 3],
        [-100., 0., 0.],
    );
    let enemy = body(
        &mut e,
        BodyKind::KinematicVelocity,
        [0., 1., 0.],
        true,
        2,
        [0.; 3],
        [100., 0., 0.],
    );
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
    assert!(e.set_gameplay_action_dash_with_aim(enemy.id, enemy.generation, 78, 1., 2., 1));
    assert!(e.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 9, 0.1, 78));
    for _ in 0..7 {
        tick(&mut e);
    }
    assert!((x(&e, enemy) - 2.).abs() < 0.001);
    assert_eq!(e.unified_physics_error(), None);
}
#[test]
fn native_dash_planar_legacy_kinematic_import_on_first_tick() {
    use crate::components::{AabbCollider, CollisionLayer, RigidBody, Transform2D};
    let mut e = engine(Space::PlanarXy);
    let a = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 0., y: 1. });
    e.world.set_aabb_collider(
        a,
        AabbCollider::new(0.25, 0.25, true, CollisionLayer::Player),
    );
    e.world.set_rigid_body(a, RigidBody::kinematic());
    wall(&mut e, 2., 0.);
    bind(&mut e, a, 4.);
    fire(&mut e);
    e.unified_physics
        .as_ref()
        .unwrap()
        .physics
        .diagnostic_actual_motion("legacy-import dash first tick");
    eprintln!(
        "C12_ENGINE_DASH state={:?} error={:?} cooldown={}",
        e.unified_body_state(a),
        e.unified_physics_error(),
        remaining(&e, a)
    );
    assert_eq!(
        e.unified_physics_error(),
        None,
        "first checked dash failure"
    );
    assert!(x(&e, a) > 1.6 && x(&e, a) < 1.651, "{}", x(&e, a));
    assert!(remaining(&e, a) > 0.9);
    assert_eq!(e.unified_physics_error(), None);
}
#[test]
fn native_dash_character_preserves_ground_input_and_queued_jump() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut e = engine(space);
        e.set_unified_runtime_settings(
            [0., -10., 0.],
            e.unified_physics.as_ref().unwrap().physics.config().solver,
        )
        .unwrap();
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., -0.5, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [10., 0.5, 10.],
            }),
            [0.; 3],
        )
        .unwrap();
        let a = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [0., 1., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    category: 1,
                    ..ColliderDesc::new(Shape::Capsule {
                        half_height: 0.5,
                        radius: 0.25,
                    })
                },
                [0., -0.75, 0.],
            )
            .unwrap();
        e.enable_unified_character(a, CharacterConfig::default())
            .unwrap();
        for _ in 0..60 {
            tick(&mut e);
        }
        assert!(e.unified_character_state(a).unwrap().grounded);
        bind(&mut e, a, 3.);
        e.set_unified_character_input(
            a,
            CharacterInput {
                velocity: [1., 0., 0.],
                jump_speed: 3.,
            },
        )
        .unwrap();
        fire(&mut e);
        assert!((x(&e, a) - (3. + 1. / 60.)).abs() < 0.003, "{}", x(&e, a));
        assert!(e.unified_character_state(a).unwrap().vertical_speed > 2.8);
        tick(&mut e);
        assert!((x(&e, a) - (3. + 2. / 60.)).abs() < 0.003);
        assert!(e.unified_character_state(a).unwrap().vertical_speed < 2.8);
        assert_eq!(e.unified_physics_error(), None);
    }
}

#[test]
fn native_dash_shared_path_capacity_rejects_before_moving_or_cooldown() {
    let mut e = engine(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::Fixed,
        [1000., 1., 0.],
        true,
        1,
        [0.; 3],
        [0.; 3],
    );
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
    let enemies: Vec<_> = (0..17)
        .map(|i| {
            let b = body(
                &mut e,
                BodyKind::KinematicVelocity,
                [0., 1. + i as f32, 0.],
                true,
                2,
                [0.; 3],
                [0.; 3],
            );
            assert!(e.set_gameplay_action_dash_with_aim(b.id, b.generation, 78, 1., 1., 1));
            assert!(e.set_gameplay_timer_action_trigger(b.id, b.generation, 9, 0.001, 78));
            b
        })
        .collect();
    tick(&mut e);
    for &b in &enemies[..16] {
        assert!(x(&e, b) > 0.99);
        assert!(
            e.world
                .action_binding(b, 78)
                .unwrap()
                .cooldown
                .remaining_seconds
                > 0.9
        );
    }
    assert_eq!(x(&e, enemies[16]), 0.);
    assert_eq!(
        e.world
            .action_binding(enemies[16], 78)
            .unwrap()
            .cooldown
            .remaining_seconds,
        0.
    );
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_ACTION_FAILED && v.source_id == enemies[16].id));
}
#[test]
fn native_dash_opposing_capsules_use_the_shared_character_solver() {
    let mut e = engine(Space::Spatial);
    let mut make = |x| {
        let a = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [x, 1., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.5,
                    radius: 0.25,
                }),
                [0.; 3],
            )
            .unwrap();
        e.enable_unified_character(a, CharacterConfig::default())
            .unwrap();
        a
    };
    let a = make(0.);
    let b = make(4.);
    bind(&mut e, a, 4.);
    assert!(e.set_gameplay_action_dash_with_aim(b.id, b.generation, 78, 1., 4., 1));
    assert!(e.set_gameplay_timer_action_trigger(b.id, b.generation, 9, 0.001, 78));
    fire(&mut e);
    assert!(x(&e, a) > 1.7 && x(&e, a) < 1.76, "{}", x(&e, a));
    assert!(x(&e, b) - x(&e, a) >= 0.499);
    assert!(remaining(&e, a) > 0.9);
    tick(&mut e);
    assert!(x(&e, b) - x(&e, a) >= 0.499);
}
#[test]
fn native_dash_dynamic_body_is_rejected_without_cooldown() {
    let mut e = engine(Space::Spatial);
    let a = body(
        &mut e,
        BodyKind::Dynamic,
        [0., 1., 0.],
        false,
        1,
        [0.; 3],
        [0.; 3],
    );
    bind(&mut e, a, 4.);
    fire(&mut e);
    assert_eq!(x(&e, a), 0.);
    assert_eq!(remaining(&e, a), 0.);
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_ACTION_FAILED));
}
#[test]
fn native_dash_crossing_a_generated_projectile_is_hit_during_the_tick() {
    let mut e = engine(Space::Spatial);
    e.configure_data_scene_camera(400., 240., u32::MAX, 0, false, 0., 0., 0., 0., 0.);
    let a = body(
        &mut e,
        BodyKind::Fixed,
        [0., 1., 0.],
        true,
        1,
        [0.; 3],
        [0.; 3],
    );
    let enemy = body(
        &mut e,
        BodyKind::KinematicVelocity,
        [3., 1., 0.],
        true,
        2,
        [0.; 3],
        [0.; 3],
    );
    e.world.set_health(enemy, 10.);
    assert!(e.configure_data_scene_gameplay_v2(true, a.id, a.generation, 0, true));
    assert!(e.set_gameplay_action_projectile_with_target(
        a.id,
        a.generation,
        77,
        1.,
        1.,
        3.,
        2.,
        0,
        0,
        0
    ));
    assert!(e.set_input_action_binding(
        77,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
    assert!(e.set_gameplay_action_dash_with_aim(enemy.id, enemy.generation, 78, 1., 6., 1));
    assert!(e.set_gameplay_timer_action_trigger(enemy.id, enemy.generation, 9, 0.001, 78));
    let point = e.camera.world_to_screen(Transform2D { x: 10., y: 0. });
    e.set_input(
        false, false, false, false, false, false, true, point.x, point.y,
    );
    tick(&mut e);
    assert!(x(&e, enemy) < -2.99);
    assert_eq!(e.world.health(enemy), Some(7.));
    assert!(e
        .frame_buffers
        .gameplay_events
        .iter()
        .any(|v| v.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE && v.actor_id == enemy.id));
}

#[test]
fn native_dash_angular_winding_is_swept_instead_of_collapsing_to_the_endpoint() {
    let mut e = engine(Space::Spatial);
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [0., 1., 0.],
                    ..Pose::default()
                },
                angular_velocity: [0., 0., std::f32::consts::TAU * 0.99 * 60.],
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                category: 1,
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [1., 0.1, 0.1],
                })
            },
            [0.; 3],
        )
        .unwrap();
    body(
        &mut e,
        BodyKind::Fixed,
        [0., 1.8, 0.],
        false,
        8,
        [0.; 3],
        [0.; 3],
    );
    bind(&mut e, a, 0.1);
    fire(&mut e);
    assert!(x(&e, a) > 0.005 && x(&e, a) < 0.03, "{}", x(&e, a));
    assert_eq!(e.unified_physics_error(), None);
    assert!(e.unified_body_state(a).unwrap().pose.rotation[2].abs() > 0.1);
}
