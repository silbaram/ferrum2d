use super::super::tests::{capsule, pos, setup, tick};
use super::*;
use crate::physics3d::{BodyKind, Shape};

fn configure(
    e: &mut Engine,
    p: Entity,
    padding: f32,
    radius: f32,
    handles: &[u32],
    distances: &[f32],
) {
    assert!(e.configure_data_scene_gameplay_v6(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, radius, 64., padding],
        handles,
        distances,
        1
    ));
}
fn seek(p: Entity, rate: f32) -> MovementPattern {
    MovementPattern::SeekTarget {
        target: MovementTarget::Entity(p),
        speed: 2.,
        turn_rate: rate,
    }
}

#[test]
fn native_patterns_seek_applies_turn_rate_once_per_fixed_tick_and_zero_rate_waits() {
    for rate in [0., 0.25, 1.] {
        let (mut e, p, a) = setup();
        e.world.set_movement_pattern(a, seek(p, rate));
        configure(&mut e, p, -1., 1., &[], &[]);
        let dt = e.fixed_timestep.config().step_seconds;
        tick(&mut e, 1);
        let first = pos(&e, a)[0] / dt;
        assert!(
            (first - 2. * rate).abs() < 0.001,
            "rate={rate},first={first}"
        );
        tick(&mut e, 1);
        let second = pos(&e, a)[0] / dt - first;
        assert!(
            (second - (2. * rate + (2. - 2. * rate) * rate)).abs() < 0.002,
            "rate={rate},second={second}"
        );
        if rate == 0. {
            tick(&mut e, 30);
            assert_eq!(pos(&e, a)[0], 0.);
            assert_eq!(e.data_scene_combat_navigation_stats()[5], 1);
        }
    }
}
#[test]
fn native_patterns_seek_uses_fixed_route_to_detour_wall_and_reach_target() {
    let (mut e, p, a) = setup();
    e.world.set_movement_pattern(a, seek(p, 0.2));
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
    configure(&mut e, p, -1., 1., &[], &[]);
    let mut deviation = 0f32;
    for _ in 0..600 {
        tick(&mut e, 1);
        deviation = deviation.max(pos(&e, a)[2].abs());
    }
    let at = pos(&e, a);
    assert!(
        at[0] > 3. && (at[0] - 4.).hypot(at[2]) <= 1.01 && deviation > 0.8,
        "{at:?},dev={deviation}"
    );
}
#[test]
fn native_patterns_seek_ignores_stale_chase_distance_binding_after_runtime_switch() {
    let (mut e, p, a) = setup();
    configure(&mut e, p, -1., 1., &[a.id, a.generation], &[2.]);
    e.world.set_movement_pattern(a, seek(p, 1.));
    tick(&mut e, 200);
    assert!(pos(&e, a)[0] > 3., "{:?}", pos(&e, a));
}
#[test]
fn native_patterns_acceleration_increments_once_and_caps_both_ground_axes() {
    let (mut e, p, a) = setup();
    e.world.set_movement_pattern(
        a,
        MovementPattern::Accelerate {
            acceleration_x: 0.3,
            acceleration_y: 0.4,
            max_speed: 1.,
        },
    );
    configure(&mut e, p, -1., 1., &[], &[]);
    let dt = e.fixed_timestep.config().step_seconds;
    let mut previous = pos(&e, a);
    for expected in [[0.3, -0.4], [0.6, -0.8], [0.6, -0.8]] {
        tick(&mut e, 1);
        let current = pos(&e, a);
        assert!(
            ((current[0] - previous[0]) / dt - expected[0]).abs() < 0.001,
            "{current:?}"
        );
        assert!(
            ((current[2] - previous[2]) / dt - expected[1]).abs() < 0.001,
            "{current:?}"
        );
        previous = current;
    }
    assert_eq!(e.data_scene_combat_navigation_stats()[5], 0);
}
#[test]
fn native_patterns_acceleration_stops_before_wall_and_unsupported_ledge() {
    for wall in [false, true] {
        let (mut e, p, a) = setup();
        if wall {
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
                    half_extents: [0.3, 1., 5.],
                }),
                [0.; 3],
            )
            .unwrap();
        } else {
            assert!(e.spatial_scene.configure_surfaces(
                &[-10., -10., 12., 20., -1., 0., 0., 1., 1., 1., 1.],
                &[7, 0, 0, 1]
            ));
        }
        e.world.set_movement_pattern(
            a,
            MovementPattern::Accelerate {
                acceleration_x: 1.,
                acceleration_y: 0.,
                max_speed: 3.,
            },
        );
        configure(&mut e, p, -1., 1., &[], &[]);
        tick(&mut e, 300);
        let at = pos(&e, a);
        assert!(
            at[1] > 0.74 && at[0] > 0.2 && at[0] < if wall { 0.96 } else { 2. },
            "wall={wall},{at:?}"
        );
    }
}
#[test]
fn native_patterns_mixed_actors_share_substep_budget_and_keep_input_ownership() {
    let (mut e, p, a) = setup();
    e.world.set_movement_pattern(a, seek(p, 0.5));
    let b = capsule(&mut e, -2., 2.);
    e.world.set_movement_pattern(
        b,
        MovementPattern::Accelerate {
            acceleration_x: 0.1,
            acceleration_y: 0.,
            max_speed: 2.,
        },
    );
    let controlled = capsule(&mut e, -4., -2.);
    let chaser = capsule(&mut e, -2., -2.);
    e.world.set_movement_pattern(
        chaser,
        MovementPattern::Chase {
            target: MovementTarget::Entity(p),
            speed: 2.,
        },
    );
    e.world.set_movement_pattern(controlled, seek(p, 0.5));
    assert!(e.configure_spatial_actor(controlled.id, controlled.generation, 2., 0.3, 0.2));
    for _ in 0..120 {
        e.step_unified_manually(e.fixed_timestep.config().step_seconds, None);
    }
    assert!(e.configure_data_scene_gameplay_v6(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, 1., 3., 0.1],
        &[],
        &[],
        1
    ));
    let before = e.data_scene_combat_stats()[3];
    let dt = e.fixed_timestep.config().step_seconds;
    e.update(f64::from(dt) * 4.);
    assert_eq!(e.data_scene_combat_stats()[3] - before, 12);
    let stats = e.data_scene_combat_navigation_stats();
    assert_eq!(stats[2], 3);
    assert!(stats[8] <= 1 && stats[9] <= FRAME_WORK as u32);
    assert_eq!(pos(&e, controlled)[0], -4.);
    assert!(pos(&e, b)[0] > -2.);
}

#[test]
fn native_patterns_seek_and_acceleration_preserve_queued_jump_and_airborne_locomotion() {
    for acceleration in [false, true] {
        let (mut e, p, a) = setup();
        e.world.set_movement_pattern(
            a,
            if acceleration {
                MovementPattern::Accelerate {
                    acceleration_x: 0.1,
                    acceleration_y: 0.,
                    max_speed: 2.,
                }
            } else {
                seek(p, 0.5)
            },
        );
        configure(&mut e, p, 0.1, 1., &[], &[]);
        tick(&mut e, 5);
        e.set_unified_character_input(
            a,
            CharacterInput {
                velocity: [0.; 3],
                jump_speed: 5.,
            },
        )
        .unwrap();
        let before = pos(&e, a);
        tick(&mut e, 1);
        let after = pos(&e, a);
        assert!(
            after[0] > before[0] && after[1] > before[1],
            "accel={acceleration},{before:?},{after:?}"
        );
        tick(&mut e, 1);
        assert!(pos(&e, a)[0] > after[0] && pos(&e, a)[1] > after[1]);
    }
}
#[test]
fn native_patterns_all_mode_rejects_incompatible_sources_before_reconfiguration() {
    let (mut e, p, a) = setup();
    let bad = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [-3., 1., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
            [0.; 3],
        )
        .unwrap();
    e.world.set_movement_pattern(bad, seek(p, 0.5));
    let before = e.data_scene_combat_navigation_stats();
    let at = pos(&e, bad);
    assert!(!e.configure_data_scene_gameplay_v6(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, 1., 64., -1.],
        &[],
        &[],
        1
    ));
    assert_eq!(e.data_scene_combat_navigation_stats(), before);
    assert_eq!(pos(&e, bad), at);
    e.world.clear_movement_pattern(a);
    e.world.clear_movement_pattern(bad);
    assert!(!e.configure_data_scene_gameplay_v6(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 10001., 0.2, 0.1, 1., 64., -1.],
        &[],
        &[],
        1
    ));
    assert_eq!(e.data_scene_combat_navigation_stats(), before);
}

#[test]
fn native_patterns_offset_capsule_search_and_seek_follow_actual_ramp_support() {
    let (mut e, p, a) = setup();
    e.world.clear_movement_pattern(a);
    assert!(e.spatial_scene.configure_surfaces(
        &[-10., -10., 30., 20., -1., 0., 3., 1., 1., 1., 1.],
        &[7, 0, 0, 5 | 32]
    ));
    let body = e.unified_body_id(a).unwrap();
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
                position: [0., 4., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    tick(&mut e, 180);
    e.world.set_movement_pattern(a, seek(p, 0.3));
    configure(&mut e, p, 0.1, 1.2, &[], &[]);
    tick(&mut e, 400);
    let at = pos(&e, a);
    let target = pos(&e, p);
    assert!(
        at[0] > 2.7 && (at[0] - target[0]).hypot(at[2] - target[2]) <= 1.2001 && at[1] > 2.,
        "at={at:?}, target={target:?}, nav={:?}",
        e.data_scene_combat_navigation_stats()
    );
    assert!(e.unified_character_state(a).unwrap().grounded);
}
#[test]
fn native_patterns_acceleration_uses_crowd_without_corrupting_canonical_momentum() {
    let (mut e, p, a) = setup();
    let b = capsule(&mut e, 1.5, 0.);
    e.world.set_movement_pattern(
        b,
        MovementPattern::Chase {
            target: MovementTarget::Entity(p),
            speed: 2.,
        },
    );
    e.world.set_movement_pattern(
        a,
        MovementPattern::Accelerate {
            acceleration_x: 0.2,
            acceleration_y: 0.,
            max_speed: 2.,
        },
    );
    configure(&mut e, p, 0.1, 1., &[b.id, b.generation], &[2.6]);
    let mut deviation = 0f32;
    for _ in 0..300 {
        tick(&mut e, 1);
        let at = pos(&e, a);
        let peer = pos(&e, b);
        assert!((at[0] - peer[0]).hypot(at[2] - peer[2]) >= 0.49);
        deviation = deviation.max(at[2].abs());
    }
    assert!(
        pos(&e, a)[0] > 2.5 && deviation > 0.3,
        "{:?},dev={deviation}",
        pos(&e, a)
    );
    assert!(e.data_scene_combat_crowd_stats()[4] > 0);
}
#[test]
fn native_patterns_acceleration_teleport_resets_observed_momentum_and_removal_releases_input() {
    let (mut e, p, a) = setup();
    e.world.set_movement_pattern(
        a,
        MovementPattern::Accelerate {
            acceleration_x: 0.1,
            acceleration_y: 0.,
            max_speed: 2.,
        },
    );
    configure(&mut e, p, -1., 1., &[], &[]);
    tick(&mut e, 10);
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_pose(
            body,
            Pose {
                position: [-3., 0.76, 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    tick(&mut e, 1);
    let dt = e.fixed_timestep.config().step_seconds;
    assert!(
        ((pos(&e, a)[0] + 3.) / dt - 0.1).abs() < 0.002,
        "{:?}",
        pos(&e, a)
    );
    e.world.clear_movement_pattern(a);
    tick(&mut e, 1);
    let at = pos(&e, a);
    tick(&mut e, 10);
    assert_eq!(pos(&e, a), at);
}
#[test]
fn native_patterns_fast_seek_clips_first_entry_to_stop_circle() {
    let (mut e, p, a) = setup();
    e.world.set_movement_pattern(
        a,
        MovementPattern::Accelerate {
            acceleration_x: 1000.,
            acceleration_y: 0.,
            max_speed: 1000.,
        },
    );
    configure(&mut e, p, -1., 1., &[], &[]);
    tick(&mut e, 1);
    e.world.set_movement_pattern(
        a,
        MovementPattern::SeekTarget {
            target: MovementTarget::Entity(p),
            speed: 1000.,
            turn_rate: 0.01,
        },
    );
    tick(&mut e, 2);
    let at = pos(&e, a);
    assert!(at[0] >= 2.99 && (at[0] - 4.).hypot(at[2]) <= 1.01, "{at:?}");
}
#[test]
fn native_patterns_budget_defer_does_not_accumulate_acceleration() {
    let (mut e, _, a) = setup();
    let runtime = e.unified_physics.as_mut().unwrap();
    let mut nav = NativeCombatNavigation {
        used: FRAME_WORK,
        ..NativeCombatNavigation::default()
    };
    nav.agents.push(Agent {
        entity: a,
        target: None,
        goal: [0.; 3],
        floor: 0,
        speed: 0.,
        cooldown: 0.,
        route: ActorNavigation::default(),
        detour: None,
        intent: Velocity::default(),
        pattern: None,
        last_pose: None,
        velocity_moving: false,
    });
    let c = NativeNavigationConfig {
        cell: 0.5,
        step: 0.3,
        drop: 0.2,
        interval: 0.1,
        radius: 1.,
        agents: 64,
        avoidance: None,
        all_patterns: true,
    };
    accelerate(runtime, &mut nav, &e.spatial_scene, 0, c, 0.25, 0., 2.);
    assert_eq!(nav.agents[0].intent, Velocity::default());
    nav.used = 0;
    accelerate(runtime, &mut nav, &e.spatial_scene, 0, c, 0.25, 0., 2.);
    assert_eq!(nav.agents[0].intent, Velocity { vx: 0.25, vy: 0. });
}
