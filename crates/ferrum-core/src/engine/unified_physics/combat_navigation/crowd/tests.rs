use super::super::tests::{capsule, pos, setup, tick};
use super::*;
use crate::components::gameplay::MovementTarget;
use crate::physics3d::{BodyKind, Shape};

fn configure(e: &mut Engine, primary: Entity, handles: &[u32], radii: &[f32]) {
    assert!(e.configure_data_scene_gameplay_v5(
        true,
        primary.id,
        primary.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, 1., 64., 0.1],
        handles,
        radii
    ));
}
#[test]
fn native_crowd_routes_around_resting_peer_and_reaches_target() {
    let (mut e, primary, actor) = setup();
    let peer = capsule(&mut e, 1.5, 0.);
    e.world.set_movement_pattern(
        peer,
        MovementPattern::Chase {
            target: MovementTarget::Entity(primary),
            speed: 2.,
        },
    );
    configure(&mut e, primary, &[peer.id, peer.generation], &[2.6]);
    let mut steered = 0;
    let mut deviation = 0f32;
    for _ in 0..600 {
        tick(&mut e, 1);
        let a = pos(&e, actor);
        let b = pos(&e, peer);
        assert!((a[0] - b[0]).hypot(a[2] - b[2]) >= 0.49, "a={a:?},b={b:?}");
        assert!((a[1] - 0.76).abs() < 0.02, "{a:?}");
        deviation = deviation.max(a[2].abs());
        steered += e.data_scene_combat_crowd_stats()[6];
    }
    assert!(
        pos(&e, actor)[0] > 3. && deviation > 0.3,
        "{:?}, deviation={deviation}",
        pos(&e, actor)
    );
    assert!(steered > 0);
    assert!((pos(&e, peer)[0] - 1.5).abs() <= 0.005);
    let stats = e.data_scene_combat_crowd_stats();
    assert_eq!(&stats[..2], &[1, 1]);
    assert!(stats[2] >= 2 && stats[4] > 0, "{stats:?}");
}
#[test]
fn native_crowd_head_on_agents_pass_each_other_without_overlap() {
    let (mut e, primary, actor) = setup();
    let p = e.unified_body_id(primary).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_pose(
            p,
            Pose {
                position: [10., 0.76, 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    let peer = capsule(&mut e, 4., 0.);
    let target = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., 0.76, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.1 })
            },
            [0.; 3],
        )
        .unwrap();
    e.world.set_movement_pattern(
        peer,
        MovementPattern::Chase {
            target: MovementTarget::Entity(target),
            speed: 2.,
        },
    );
    configure(&mut e, primary, &[], &[]);
    let mut deviation = 0f32;
    for _ in 0..900 {
        tick(&mut e, 1);
        let a = pos(&e, actor);
        let b = pos(&e, peer);
        assert!((a[0] - b[0]).hypot(a[2] - b[2]) >= 0.49, "{a:?},{b:?}");
        deviation = deviation.max(a[2].abs()).max(b[2].abs());
    }
    assert!(
        pos(&e, actor)[0] > 9. && pos(&e, peer)[0] < 1. && deviation > 0.15,
        "a={:?}, b={:?}, deviation={deviation}",
        pos(&e, actor),
        pos(&e, peer)
    );
}
#[test]
fn native_crowd_waits_in_narrow_supported_corridor_without_falling_or_crossing() {
    let (mut e, primary, actor) = setup();
    assert!(e.spatial_scene.configure_surfaces(
        &[-10., -0.26, 30., 0.52, -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    let peer = capsule(&mut e, 1.5, 0.);
    e.world.set_movement_pattern(
        peer,
        MovementPattern::Chase {
            target: MovementTarget::Entity(primary),
            speed: 2.,
        },
    );
    configure(&mut e, primary, &[peer.id, peer.generation], &[2.6]);
    tick(&mut e, 300);
    let a = pos(&e, actor);
    assert!(a[0] < 1. && a[1] > 0.74 && a[2].abs() < 0.27, "{a:?}");
    assert!(e.data_scene_combat_crowd_stats()[4] > 0);
    assert!(e.data_scene_combat_navigation_stats()[5] < 10);
}

#[test]
fn native_crowd_surrounded_actor_yields_without_restarting_its_route() {
    let (mut e, primary, actor) = setup();
    let mut handles = Vec::new();
    for i in 0..8 {
        let angle = i as f32 * std::f32::consts::FRAC_PI_4;
        let peer = capsule(&mut e, angle.cos() * 0.8, angle.sin() * 0.8);
        e.world.set_movement_pattern(
            peer,
            MovementPattern::Chase {
                target: MovementTarget::Entity(primary),
                speed: 2.,
            },
        );
        handles.extend([peer.id, peer.generation]);
    }
    configure(&mut e, primary, &handles, &[10.; 8]);
    tick(&mut e, 120);
    let a = pos(&e, actor);
    assert!(a[0].abs() < 0.001 && a[2].abs() < 0.001, "{a:?}");
    let stats = e.data_scene_combat_crowd_stats();
    assert!(stats[2] >= 8 && stats[3] > 0, "{stats:?}");
    assert_eq!(e.data_scene_combat_navigation_stats()[5], 1);
}

#[test]
fn native_crowd_preserves_queued_jump_and_releases_control_when_disabled() {
    let (mut e, primary, actor) = setup();
    configure(&mut e, primary, &[], &[]);
    tick(&mut e, 5);
    let body = e.unified_body_id(actor).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_character_input(
            body,
            CharacterInput {
                velocity: [0.; 3],
                jump_speed: 5.,
            },
        )
        .unwrap();
    let before = pos(&e, actor);
    tick(&mut e, 1);
    let after = pos(&e, actor);
    assert!(
        after[0] > before[0] && after[1] > before[1],
        "{before:?},{after:?}"
    );
    assert!(e.configure_data_scene_gameplay_v2(true, primary.id, primary.generation, 0, false));
    let x = pos(&e, actor)[0];
    tick(&mut e, 3);
    assert!((pos(&e, actor)[0] - x).abs() < 0.001);
    assert_eq!(e.data_scene_combat_crowd_stats()[1], 0);
}
#[test]
fn native_crowd_budget_defer_preserves_pose_and_does_not_probe_peers() {
    let (mut e, _, actor) = setup();
    let runtime = e.unified_physics.as_mut().unwrap();
    let mut nav = NativeCombatNavigation {
        used: FRAME_WORK,
        ..NativeCombatNavigation::default()
    };
    nav.agents.push(Agent {
        entity: actor,
        target: None,
        goal: [4., 0.76, 0.],
        floor: 0,
        speed: 2.,
        cooldown: 0.,
        route: ActorNavigation::default(),
        detour: None,
        intent: Velocity::default(),
        pattern: None,
        last_pose: None,
        velocity_moving: false,
    });
    let before = runtime
        .physics
        .body_state(runtime.spatial_actor_body(actor).unwrap())
        .unwrap();
    assert_eq!(
        steer(
            runtime,
            &mut nav,
            &e.spatial_scene,
            0,
            [2., 0., 0.],
            0.5,
            Some(0.1),
            false,
            None
        )
        .velocity,
        [0.; 3]
    );
    assert_eq!(nav.used, FRAME_WORK);
    assert_eq!(nav.crowd_stats[2], 0);
    assert!(nav.deferred > 0);
    assert_eq!(
        runtime
            .physics
            .body_state(runtime.spatial_actor_body(actor).unwrap())
            .unwrap(),
        before
    );
}

#[test]
fn native_crowd_offset_capsule_admits_supported_motion_on_ramp() {
    let (mut e, _, actor) = setup();
    assert!(e.spatial_scene.configure_surfaces(
        &[-10., -10., 30., 20., -1., 0., 3., 1., 1., 1., 1.],
        &[7, 0, 0, 5 | 32]
    ));
    let body = e.unified_body_id(actor).unwrap();
    let physics = &mut e.unified_physics.as_mut().unwrap().physics;
    let collider = physics.collider_ids(body).unwrap().next().unwrap();
    physics
        .update_collider(
            collider,
            ColliderDesc {
                pose: Pose {
                    position: [0.5, 0., 0.],
                    ..Pose::default()
                },
                ..ColliderDesc::new(Shape::Capsule {
                    half_height: 0.5,
                    radius: 0.25,
                })
            },
        )
        .unwrap();
    physics
        .set_pose(
            body,
            Pose {
                position: [0., 3., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    e.world.clear_movement_pattern(actor);
    tick(&mut e, 120);
    let runtime = e.unified_physics.as_mut().unwrap();
    let start = runtime.physics.body_state(body).unwrap().pose;
    assert!(runtime.physics.character_state(body).unwrap().grounded);
    assert!(
        terrain_clear(
            runtime,
            &e.spatial_scene,
            body,
            start,
            [0.02, 0., 0.],
            1,
            &mut CharacterProbeScratch::default()
        ),
        "{start:?}"
    );
}
