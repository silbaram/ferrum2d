use crate::engine::Engine;
use crate::entity::Entity;
use crate::input::InputState;
use crate::physics3d::{
    BodyDesc, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, Pose, Shape, WorldConfig,
};

fn tick(e: &mut Engine, count: usize) {
    for _ in 0..count {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        assert_eq!(e.unified_physics_error(), None);
    }
}
fn capsule(e: &mut Engine, x: f32) -> Entity {
    let actor = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [x, 2., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
            [0., -0.75, 0.],
        )
        .unwrap();
    e.enable_unified_character(actor, CharacterConfig::default())
        .unwrap();
    actor
}
fn setup() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.spatial_scene.camera = crate::spatial_scene::SpatialCamera::new(&[
        0., 0., 8., 10., 0., 0., 0., 20., 0.1, 100., 100., 100.,
    ]);
    e.configure_unified_physics(WorldConfig::default()).unwrap();
    assert!(e.spatial_scene.configure_surfaces(
        &[-10., -10., 20., 20., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    let actor = capsule(&mut e, 0.);
    assert!(e.configure_spatial_actor(actor.id, actor.generation, 2., 0.3, 0.2));
    tick(&mut e, 120);
    assert!(e.unified_character_state(actor).unwrap().grounded);
    (e, actor)
}
fn at(e: &Engine, actor: Entity) -> [f32; 3] {
    e.unified_body_state(actor).unwrap().pose.position
}
fn navigate(e: &mut Engine, x: f32, y: f32) -> bool {
    e.move_data_scene_spatial_actor_to(x, y, 0, 2., 0.5, 0.02, true)
}

#[test]
fn native_actor_uses_fixed_ticks_normalizes_input_and_preserves_jump() {
    let (mut e, actor) = setup();
    assert!(e.world.rigid_body(actor).is_none());
    e.input = InputState {
        d: 1,
        w: 1,
        ..InputState::default()
    };
    tick(&mut e, 60);
    let p = at(&e, actor);
    assert!(
        (p[0] - 2_f32.sqrt()).abs() < 0.02 && (p[2] - p[0]).abs() < 0.001,
        "{p:?}"
    );
    let visual = e.world.transform(actor).unwrap();
    assert_eq!(visual.x, p[0]);
    assert_eq!(visual.y, -p[2]);
    e.set_unified_character_input(
        actor,
        CharacterInput {
            velocity: [9., 0., 9.],
            jump_speed: 4.,
        },
    )
    .unwrap();
    e.fixed_timestep.pause();
    tick(&mut e, 10);
    assert_eq!(at(&e, actor), p);
    e.fixed_timestep.resume();
    e.input = InputState::default();
    tick(&mut e, 1);
    assert!(at(&e, actor)[1] > p[1]);
    assert!(e.unified_character_state(actor).unwrap().vertical_speed > 3.);
    tick(&mut e, 120);
    assert!(e.unified_character_state(actor).unwrap().grounded);
    assert!((at(&e, actor)[0] - p[0]).abs() < 0.001);
}

#[test]
fn native_actor_route_reaches_destination_and_rejection_preserves_route() {
    let (mut e, actor) = setup();
    let before = at(&e, actor);
    assert!(
        navigate(&mut e, 3., 2.),
        "{:?}",
        e.data_scene_spatial_move_diagnostics()
    );
    assert_eq!(at(&e, actor), before);
    let counters = e.data_scene_spatial_move_stats();
    assert!(!navigate(&mut e, f32::NAN, 2.));
    assert_eq!(e.data_scene_spatial_move_stats(), counters);
    assert_eq!(e.data_scene_spatial_move_diagnostics()[1], 2);
    assert_eq!(e.data_scene_spatial_move_status(), 1);
    tick(&mut e, 180);
    let p = at(&e, actor);
    assert_eq!(e.data_scene_spatial_move_status(), 2, "{p:?}");
    assert!((p[0] - 3.).hypot(p[2] + 2.) < 0.03, "{p:?}");
}

#[test]
fn replacing_or_clearing_native_actor_releases_previous_movement() {
    let (mut e, first) = setup();
    let second = capsule(&mut e, -4.);
    e.input = InputState {
        d: 1,
        ..InputState::default()
    };
    tick(&mut e, 10);
    assert!(e.configure_spatial_actor(second.id, second.generation, 2., 0.3, 0.2));
    let stopped = at(&e, first);
    tick(&mut e, 10);
    assert!((at(&e, first)[0] - stopped[0]).abs() < 0.001);
    e.clear_spatial_scene();
    let stopped = at(&e, second);
    tick(&mut e, 10);
    assert!((at(&e, second)[0] - stopped[0]).abs() < 0.001);
}

#[test]
fn native_navigation_detours_around_actual_3d_obstacle() {
    let (mut e, actor) = setup();
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [1.5, 1., 0.],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.3, 1., 0.6],
        }),
        [0.; 3],
    )
    .unwrap();
    assert!(
        navigate(&mut e, 3., 0.),
        "{:?}",
        e.data_scene_spatial_move_diagnostics()
    );
    let mut detour: f32 = 0.;
    for _ in 0..240 {
        tick(&mut e, 1);
        let p = at(&e, actor);
        detour = detour.max(p[2].abs());
        assert!(p[0] < 0.95 || p[0] > 2.05 || p[2].abs() > 0.85, "{p:?}");
    }
    assert!(detour > 0.85);
    assert_eq!(e.data_scene_spatial_move_status(), 2, "{:?}", at(&e, actor));
    assert!((at(&e, actor)[0] - 3.).hypot(at(&e, actor)[2]) < 0.03);
}

#[test]
fn native_navigation_reaches_raised_floor_through_ramp() {
    let (mut e, actor) = setup();
    assert!(e.spatial_scene.configure_surfaces(
        &[
            -10., -10., 11., 20., -1., 0., 0., 1., 1., 1., 1., 1., -10., 2., 20., -1., 0., 1., 1.,
            1., 1., 1., 3., -10., 7., 20., -1., 1., 1., 1., 1., 1., 1.,
        ],
        &[7, 0, 0, 1, 8, 1, 0, 5 | 32, 9, 2, 0, 1]
    ));
    tick(&mut e, 30);
    assert!(
        e.move_data_scene_spatial_actor_to(4., 0., 2, 2., 0.5, 0.02, true),
        "{:?}",
        e.data_scene_spatial_move_diagnostics()
    );
    tick(&mut e, 240);
    let p = at(&e, actor);
    assert_eq!(e.data_scene_spatial_move_status(), 2, "{p:?}");
    assert!(
        (p[0] - 4.).abs() < 0.03 && (p[1] - 1.76).abs() < 0.02,
        "{p:?}"
    );
    assert_eq!(e.world.height_span(actor).unwrap().floor.0, 2);
}

#[test]
fn cold_native_displacement_sweeps_wall_and_preserves_ground_and_jump() {
    let (mut e, actor) = setup();
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [2., 2., 0.],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.1, 2., 5.],
        }),
        [0.; 3],
    )
    .unwrap();
    e.set_unified_character_input(
        actor,
        CharacterInput {
            jump_speed: 4.,
            ..CharacterInput::default()
        },
    )
    .unwrap();
    assert!(e.move_spatial_body(actor.id, actor.generation, 10., 0., 0.3, 0.2));
    let p = at(&e, actor);
    assert!(p[0] > 1.5 && p[0] < 1.66, "{p:?}");
    assert_eq!(e.world.transform(actor).unwrap().x, p[0]);
    assert!(e.unified_character_state(actor).unwrap().grounded);
    assert!(!e.move_spatial_body(actor.id, actor.generation, f32::NAN, 0., 0.3, 0.2));
    assert_eq!(at(&e, actor), p);
    assert_eq!(
        e.take_unified_physics_error(),
        Some(crate::engine::UnifiedPhysicsError::Physics(
            crate::physics3d::PhysicsError::InvalidQuery
        ))
    );
    tick(&mut e, 1);
    assert!(e.unified_character_state(actor).unwrap().vertical_speed > 3.);
    assert!(at(&e, actor)[1] > p[1]);
}

#[test]
fn cold_native_displacement_does_not_reground_a_small_rising_jump() {
    let (mut e, actor) = setup();
    let grounded_height = at(&e, actor)[1];
    e.set_unified_character_input(
        actor,
        CharacterInput {
            jump_speed: 0.5,
            ..CharacterInput::default()
        },
    )
    .unwrap();
    tick(&mut e, 1);
    let speed = e.unified_character_state(actor).unwrap().vertical_speed;
    assert!(speed > 0.);
    assert!(!e.unified_character_state(actor).unwrap().grounded);
    assert!(at(&e, actor)[1] - grounded_height < 0.02);
    assert!(e.move_spatial_body(actor.id, actor.generation, 0.1, 0., 0.3, 0.2));
    assert!(!e.unified_character_state(actor).unwrap().grounded);
    assert!(e.unified_character_state(actor).unwrap().ground.is_none());
    assert_eq!(
        e.unified_character_state(actor).unwrap().vertical_speed,
        speed
    );
    let before = at(&e, actor)[1];
    tick(&mut e, 1);
    assert!(at(&e, actor)[1] > before);
}

#[test]
fn native_navigation_cancels_for_input_teleport_and_explicit_stop() {
    let (mut e, actor) = setup();
    assert!(navigate(&mut e, 4., 0.));
    tick(&mut e, 10);
    assert!(e.cancel_data_scene_spatial_move());
    let stopped = at(&e, actor);
    tick(&mut e, 10);
    assert_eq!(e.data_scene_spatial_move_status(), 4);
    assert!((at(&e, actor)[0] - stopped[0]).abs() < 0.001);
    assert!(navigate(&mut e, 4., 0.));
    e.input = InputState {
        a: 1,
        ..InputState::default()
    };
    tick(&mut e, 1);
    assert_eq!(e.data_scene_spatial_move_status(), 4);
    assert!(at(&e, actor)[0] < stopped[0]);
    e.input = InputState::default();
    assert!(navigate(&mut e, 4., 0.));
    let mut pose = e.unified_body_state(actor).unwrap().pose;
    pose.position[0] = -1.;
    e.set_unified_body_pose(actor, pose).unwrap();
    tick(&mut e, 1);
    assert_eq!(e.data_scene_spatial_move_status(), 4);
    assert!((at(&e, actor)[0] + 1.).abs() < 0.001);
}

#[test]
fn native_navigation_stops_at_new_obstacle_and_keeps_very_slow_progress() {
    let (mut e, actor) = setup();
    assert!(e.move_data_scene_spatial_actor_to(0.01, 0., 0, 0.0003, 0.5, 0., true));
    tick(&mut e, 10);
    assert_eq!(e.data_scene_spatial_move_status(), 1);
    assert!(at(&e, actor)[0] > 0.00004);
    assert!(navigate(&mut e, 4., 0.));
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [2., 2., 0.],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.1, 2., 5.],
        }),
        [0.; 3],
    )
    .unwrap();
    tick(&mut e, 180);
    assert_eq!(e.data_scene_spatial_move_status(), 3);
    assert!(at(&e, actor)[0] < 1.66);
}
