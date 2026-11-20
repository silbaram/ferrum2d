use super::*;
use crate::components::gameplay::{MovementPattern, MovementTarget};
use crate::physics3d::{BodyKind, Shape};

pub(super) fn capsule(e: &mut Engine, x: f32, z: f32) -> Entity {
    let a = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [x, 1., z],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
            [100., 0., 0.],
        )
        .unwrap();
    e.enable_unified_character(a, CharacterConfig::default())
        .unwrap();
    a
}
pub(super) fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        assert_eq!(e.unified_physics_error(), None);
        let s = e.data_scene_combat_navigation_stats();
        assert!(s[8] <= 1 && s[9] <= FRAME_WORK as u32, "{s:?}");
    }
}
pub(super) fn pos(e: &Engine, a: Entity) -> [f32; 3] {
    e.unified_body_state(a).unwrap().pose.position
}
fn config(e: &mut Engine, p: Entity, agents: f32, radius: f32) -> bool {
    e.configure_data_scene_gameplay_v4(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, radius, agents],
    )
}
pub(super) fn setup() -> (Engine, Entity, Entity) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig::default()).unwrap();
    assert!(e.spatial_scene.configure_surfaces(
        &[-10., -10., 30., 20., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    let player = capsule(&mut e, 4., 0.);
    let enemy = capsule(&mut e, 0., 0.);
    for _ in 0..120 {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    e.world.set_movement_pattern(
        enemy,
        MovementPattern::Chase {
            target: MovementTarget::Entity(player),
            speed: 2.,
        },
    );
    assert!(config(&mut e, player, 8., 1.));
    (e, player, enemy)
}

#[test]
fn native_combat_navigation_detours_fixed_wall_and_stops_at_solid_target() {
    let (mut e, p, a) = setup();
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
    let mut detour = 0_f32;
    for _ in 0..300 {
        tick(&mut e, 1);
        detour = detour.max(pos(&e, a)[2].abs());
    }
    let at = pos(&e, a);
    let target = pos(&e, p);
    assert!(detour > 0.85, "{at:?}");
    assert!(
        (at[0] - target[0]).hypot(at[2] - target[2]) <= 1.01,
        "{at:?}"
    );
    let stop = pos(&e, a);
    tick(&mut e, 60);
    assert_eq!(pos(&e, a), stop);
    assert!(e.data_scene_combat_navigation_stats()[5] > 0);
}

#[test]
fn native_combat_navigation_multiple_agents_share_search_token_and_reach_target() {
    let (mut e, p, a) = setup();
    let b = capsule(&mut e, 0., 3.);
    e.world.set_movement_pattern(
        b,
        MovementPattern::Chase {
            target: MovementTarget::PrimaryActor,
            speed: 2.,
        },
    );
    assert!(config(&mut e, p, 8., 1.5));
    tick(&mut e, 360);
    for actor in [a, b] {
        let at = pos(&e, actor);
        let target = pos(&e, p);
        assert!(
            (at[0] - target[0]).hypot(at[2] - target[2]) <= 1.52,
            "{at:?}"
        );
    }
    let s = e.data_scene_combat_navigation_stats();
    assert_eq!(s[2], 2);
    assert_eq!(s[5], 1);
    assert!(e.data_scene_combat_navigation_scheduler_stats()[4] > 0);
}

#[test]
fn native_combat_navigation_moving_obstacle_remains_a_real_controller_collision() {
    let (mut e, _, a) = setup();
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::KinematicVelocity,
            pose: Pose {
                position: [1.5, 1., 0.],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.1, 1., 20.],
        }),
        [0.; 3],
    )
    .unwrap();
    for _ in 0..180 {
        tick(&mut e, 1);
        assert!(pos(&e, a)[0] < 1.16, "{:?}", pos(&e, a));
    }
    assert!(pos(&e, a)[0] > 1.0);
    assert!(e.data_scene_combat_navigation_stats()[5] > 0);
}

#[test]
fn native_combat_navigation_manual_steps_and_pause_do_not_run_ai_search() {
    let (mut e, _, a) = setup();
    let before = pos(&e, a);
    for _ in 0..20 {
        e.step_unified_manually(e.fixed_timestep.config().step_seconds, None);
    }
    assert_eq!(pos(&e, a), before);
    assert_eq!(e.data_scene_combat_navigation_stats()[5], 0);
    e.fixed_timestep.pause();
    tick(&mut e, 10);
    assert_eq!(pos(&e, a), before);
    e.fixed_timestep.resume();
    tick(&mut e, 10);
    assert!(pos(&e, a)[0] > before[0]);
    assert!(e.data_scene_combat_stats()[3] > 0);
}

#[test]
fn native_combat_navigation_reconfigure_and_pattern_removal_release_input() {
    let (mut e, p, a) = setup();
    tick(&mut e, 20);
    e.world.clear_movement_pattern(a);
    tick(&mut e, 1);
    let stopped = pos(&e, a);
    tick(&mut e, 10);
    assert_eq!(pos(&e, a), stopped);
    e.world.set_movement_pattern(
        a,
        MovementPattern::Chase {
            target: MovementTarget::Entity(p),
            speed: 2.,
        },
    );
    tick(&mut e, 10);
    assert!(e.configure_data_scene_gameplay_v2(true, p.id, p.generation, 0, false));
    let stopped = pos(&e, a);
    tick(&mut e, 10);
    assert_eq!(pos(&e, a), stopped);
}

#[test]
fn native_combat_navigation_outer_update_shares_budget_across_fixed_substeps() {
    let (mut e, _, a) = setup();
    let dt = e.fixed_timestep.config().step_seconds;
    e.update(f64::from(dt) * 4.);
    let stats = e.data_scene_combat_navigation_stats();
    assert_eq!(stats[8], 1);
    assert!(stats[9] <= FRAME_WORK as u32);
    assert!(pos(&e, a)[0] > 0.05);
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn native_combat_navigation_rejects_invalid_crowd_atomically() {
    let (mut e, p, _) = setup();
    let before = e.data_scene_combat_navigation_stats();
    assert!(!e.configure_data_scene_gameplay_v5(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, 1., 8., f32::NAN],
        &[],
        &[]
    ));
    assert_eq!(e.data_scene_combat_navigation_stats(), before);
}

fn checkpoint_pending_search_fixture() -> (Engine, Entity, Entity) {
    let (mut e, p, a) = setup();
    assert!(e.spatial_scene.configure_surfaces(
        &[-10., -10., 80., 20., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    let id = e.unified_body_id(p).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_pose(
            id,
            Pose {
                position: [40., 1., 0.],
                ..Pose::default()
            },
        )
        .unwrap();
    let peer = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [10., 1., 5.],
                    ..Pose::default()
                },
                linear_velocity: [0.1, 0., 0.],
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
            [0.; 3],
        )
        .unwrap();
    for i in 0..1400 {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [500. + i as f32, 1., 0.],
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
    }
    for _ in 0..120 {
        e.step_unified_manually(e.fixed_timestep.config().step_seconds, None);
    }
    (e, a, peer)
}

#[test]
fn native_combat_navigation_pending_search_survives_fixed_ticks_and_moving_peer() {
    let (mut e, a, peer) = checkpoint_pending_search_fixture();
    let before = pos(&e, peer);
    let mut pending = false;
    for _ in 0..10 {
        tick(&mut e, 1);
        pending |= e.data_scene_combat_navigation_scheduler_stats()[2] != 0;
    }
    let stats = e.data_scene_combat_navigation_scheduler_stats();
    assert!(pending, "{stats:?}");
    assert!(pos(&e, a)[0] > 0.05, "{:?} {stats:?}", pos(&e, a));
    assert_eq!(
        stats[7], 0,
        "unrelated mobile peers must not cancel fixed-geometry search"
    );
    assert!(pos(&e, peer)[0] > before[0]);
}

#[test]
fn native_combat_navigation_does_not_follow_reused_target_generation() {
    let (mut e, p, a) = setup();
    tick(&mut e, 10);
    e.world.despawn(p);
    let replacement = capsule(&mut e, -4., 0.);
    assert_eq!(replacement.id, p.id);
    assert_ne!(replacement.generation, p.generation);
    tick(&mut e, 1);
    let at = pos(&e, a);
    tick(&mut e, 30);
    assert_eq!(pos(&e, a), at);
}

#[test]
fn native_combat_navigation_keeps_route_locomotion_during_a_queued_jump() {
    let (mut e, _, a) = setup();
    tick(&mut e, 15);
    e.set_unified_character_input(
        a,
        CharacterInput {
            velocity: [0.; 3],
            jump_speed: 4.,
        },
    )
    .unwrap();
    tick(&mut e, 1);
    let jumped = pos(&e, a);
    assert!(e.unified_character_state(a).unwrap().vertical_speed > 3.);
    tick(&mut e, 10);
    assert!(
        pos(&e, a)[0] > jumped[0] + 0.3,
        "{:?} -> {:?}",
        jumped,
        pos(&e, a)
    );
    assert!(pos(&e, a)[1] > jumped[1]);
}

#[test]
fn native_combat_navigation_teleport_cancels_previous_route_before_steering() {
    let (mut e, _, a) = setup();
    tick(&mut e, 1);
    let body = e.unified_body_id(a).unwrap();
    e.unified_physics
        .as_mut()
        .unwrap()
        .physics
        .set_pose(
            body,
            Pose {
                position: [-3., 0.76, 3.],
                ..Pose::default()
            },
        )
        .unwrap();
    tick(&mut e, 1);
    let at = pos(&e, a);
    assert!(
        (at[0] + 3.).abs() < 0.001 && (at[2] - 3.).abs() < 0.001,
        "{at:?}"
    );
}

#[test]
fn native_combat_navigation_authoring_capacity_excludes_spatial_input_actor() {
    let (mut e, p, _) = setup();
    let controlled = capsule(&mut e, -4., 0.);
    e.world.set_movement_pattern(
        controlled,
        MovementPattern::Chase {
            target: MovementTarget::Entity(p),
            speed: 2.,
        },
    );
    assert!(e.configure_spatial_actor(controlled.id, controlled.generation, 2., 0.3, 0.2));
    assert!(config(&mut e, p, 1., 1.));
    tick(&mut e, 10);
    assert_eq!(e.data_scene_combat_navigation_stats()[2], 1);
    assert!((pos(&e, controlled)[0] + 4.).abs() < 0.001);
    assert_eq!(e.data_scene_native_combat_navigation_version(), 1);
}

#[test]
fn native_route_cache_incompatible_capsule_profiles_require_separate_searches() {
    for variant in 0..4 {
        let (mut e, p, _) = setup();
        let b = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [0., 1., 3.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    category: if variant == 1 { 2 } else { 1 },
                    pose: Pose {
                        position: if variant == 2 { [0.1, 0., 0.] } else { [0.; 3] },
                        ..Pose::default()
                    },
                    ..ColliderDesc::new(Shape::Capsule {
                        half_height: 0.5,
                        radius: if variant == 0 { 0.35 } else { 0.25 },
                    })
                },
                [0.; 3],
            )
            .unwrap();
        e.enable_unified_character(
            b,
            CharacterConfig {
                max_slope_angle: if variant == 3 {
                    0.6
                } else {
                    std::f32::consts::FRAC_PI_4
                },
                ..CharacterConfig::default()
            },
        )
        .unwrap();
        e.world.set_movement_pattern(
            b,
            MovementPattern::Chase {
                target: MovementTarget::Entity(p),
                speed: 2.,
            },
        );
        assert!(config(&mut e, p, 8., 1.5));
        tick(&mut e, 240);
        assert_eq!(
            e.data_scene_combat_navigation_stats()[5],
            2,
            "variant {variant}"
        );
        assert_eq!(
            e.data_scene_combat_navigation_scheduler_stats()[4],
            0,
            "variant {variant}"
        );
        assert!(pos(&e, b)[0] > 1.);
    }
}

#[test]
fn native_route_cache_searches_certified_connector_around_blocked_direct_join() {
    let (mut e, p, _) = setup();
    e.create_unified_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [-1.5, 1., 0.],
                ..Pose::default()
            },
            ..BodyDesc::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.1, 1., 2.],
        }),
        [0.; 3],
    )
    .unwrap();
    tick(&mut e, 160);
    assert_eq!(e.data_scene_combat_navigation_stats()[5], 1);
    assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[3], 1);
    let b = capsule(&mut e, -3., 0.);
    e.world.set_movement_pattern(
        b,
        MovementPattern::Chase {
            target: MovementTarget::Entity(p),
            speed: 2.,
        },
    );
    for _ in 0..120 {
        e.step_unified_manually(e.fixed_timestep.config().step_seconds, None);
    }
    let before = pos(&e, b);
    tick(&mut e, 1);
    let first = pos(&e, b);
    assert!(
        (first[0] - before[0]).hypot(first[2] - before[2])
            <= 2. * e.fixed_timestep.config().step_seconds + 1e-5
    );
    assert!(first[0] < -1.85);
    assert_eq!(e.data_scene_combat_navigation_stats()[5], 1);
    assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[4], 1);
    let mut detour = 0_f32;
    for _ in 0..400 {
        tick(&mut e, 1);
        detour = detour.max(pos(&e, b)[2].abs());
    }
    // A blocked direct edge now uses the bounded connector search and reuses
    // the certified suffix instead of discarding the cache and searching twice.
    assert_eq!(e.data_scene_combat_navigation_stats()[5], 1);
    assert!(
        detour > 2.2 && pos(&e, b)[0] > 0.,
        "{:?}, {detour}",
        pos(&e, b)
    );
}

#[test]
fn native_route_cache_invalidates_pose_shape_enablement_and_one_way_edits() {
    use crate::physics3d::{BodyOptions, TerrainOneWay};
    for edit in 0..4 {
        let (mut e, _, _) = setup();
        let fixed = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: [20., 1., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
                [0.; 3],
            )
            .unwrap();
        tick(&mut e, 160);
        assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[3], 1);
        let body = e.unified_body_id(fixed).unwrap();
        let runtime = e.unified_physics.as_mut().unwrap();
        let collider = runtime.physics.collider_ids(body).unwrap().next().unwrap();
        match edit {
            0 => runtime
                .physics
                .set_pose(
                    body,
                    Pose {
                        position: [21., 1., 0.],
                        ..Pose::default()
                    },
                )
                .unwrap(),
            1 => runtime
                .physics
                .update_collider(collider, ColliderDesc::new(Shape::Sphere { radius: 0.3 }))
                .unwrap(),
            2 => runtime
                .physics
                .set_body_options(
                    body,
                    &BodyOptions {
                        kind: BodyKind::Fixed,
                        enabled: false,
                        ..BodyOptions::default()
                    },
                )
                .unwrap(),
            _ => runtime
                .physics
                .set_terrain_one_way(
                    collider,
                    Some(TerrainOneWay {
                        point: [0.; 3],
                        normal: [0., 1., 0.],
                    }),
                )
                .unwrap(),
        }
        tick(&mut e, 1);
        assert_eq!(
            e.data_scene_combat_navigation_scheduler_stats()[3],
            0,
            "edit {edit}"
        );
    }
}

#[test]
fn native_route_cache_prunes_removed_target_generations() {
    let (mut e, p, _) = setup();
    tick(&mut e, 160);
    assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[3], 1);
    e.world.despawn(p);
    let replacement = capsule(&mut e, 4., 0.);
    assert_eq!(p.id, replacement.id);
    assert_ne!(p.generation, replacement.generation);
    tick(&mut e, 1);
    assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[3], 0);
}

#[test]
fn native_route_cache_is_bounded_across_distinct_controller_profiles() {
    let (mut e, p, _) = setup();
    for i in 0..10 {
        let b = capsule(&mut e, -0.8 * i as f32, 2.);
        e.enable_unified_character(
            b,
            CharacterConfig {
                max_slope_angle: 0.5 + i as f32 * 0.01,
                ..CharacterConfig::default()
            },
        )
        .unwrap();
        e.world.set_movement_pattern(
            b,
            MovementPattern::Chase {
                target: MovementTarget::Entity(p),
                speed: 2.,
            },
        );
    }
    assert!(config(&mut e, p, 32., 1.));
    let mut peak = 0;
    for _ in 0..180 {
        tick(&mut e, 1);
        let n = e.data_scene_combat_navigation_scheduler_stats()[3];
        assert!(n <= 8);
        peak = peak.max(n);
    }
    assert_eq!(peak, 8);
    assert!(e.data_scene_combat_navigation_stats()[5] >= 10);
}

#[test]
fn native_route_cache_fixed_membership_swaps_invalidate_even_at_equal_count() {
    use crate::physics3d::BodyOptions;
    let (mut e, _, _) = setup();
    let mut bodies = Vec::new();
    for (i, kind) in [BodyKind::Fixed, BodyKind::KinematicVelocity]
        .into_iter()
        .enumerate()
    {
        bodies.push(
            e.create_unified_body(
                BodyDesc {
                    kind,
                    pose: Pose {
                        position: [20. + i as f32, 1., 0.],
                        ..Pose::default()
                    },
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
                [0.; 3],
            )
            .unwrap(),
        );
    }
    tick(&mut e, 160);
    assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[3], 1);
    let ids = bodies
        .into_iter()
        .map(|b| e.unified_body_id(b).unwrap())
        .collect::<Vec<_>>();
    let runtime = e.unified_physics.as_mut().unwrap();
    for (id, kind) in ids
        .into_iter()
        .zip([BodyKind::KinematicVelocity, BodyKind::Fixed])
    {
        runtime
            .physics
            .set_body_options(
                id,
                &BodyOptions {
                    kind,
                    ..BodyOptions::default()
                },
            )
            .unwrap();
    }
    tick(&mut e, 1);
    assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[3], 0);
}

#[test]
fn runtime_checkpoint_pending_native_search_replays_without_geometry_cancellation() {
    use crate::engine::runtime_checkpoint::tests::signature;
    let (mut e, _, _) = checkpoint_pending_search_fixture();
    for _ in 0..10 {
        tick(&mut e, 1);
        if e.data_scene_combat_navigation_scheduler_stats()[2] != 0 {
            break;
        }
    }
    assert_ne!(e.data_scene_combat_navigation_scheduler_stats()[2], 0);
    crate::engine::persistence::assert_encoding_roundtrip(&e);
    let packet = e.runtime_checkpoint().unwrap();
    let before = signature(&e);
    let trace: Vec<_> = (0..12)
        .map(|_| {
            tick(&mut e, 1);
            signature(&e)
        })
        .collect();
    e.restore_runtime_checkpoint_native(&packet).unwrap();
    assert_eq!(signature(&e), before);
    for expected in trace {
        tick(&mut e, 1);
        assert_eq!(signature(&e), expected);
    }
    assert_eq!(e.data_scene_combat_navigation_scheduler_stats()[7], 0);
}

#[test]
fn runtime_checkpoint_stale_native_search_stays_stale_after_equal_shape_replacement() {
    use crate::engine::runtime_checkpoint::tests::signature;
    let (mut e, _, _) = checkpoint_pending_search_fixture();
    let desc = ColliderDesc {
        sensor: true,
        ..ColliderDesc::new(Shape::Sphere { radius: 0.1 })
    };
    let marker = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [4000., 1., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            desc.clone(),
            [0.; 3],
        )
        .unwrap();
    for _ in 0..10 {
        tick(&mut e, 1);
        if e.data_scene_combat_navigation_scheduler_stats()[2] != 0 {
            break;
        }
    }
    assert_ne!(e.data_scene_combat_navigation_scheduler_stats()[2], 0);
    let id = e.unified_body_id(marker).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    let collider = runtime.physics.collider_ids(id).unwrap().next().unwrap();
    runtime.physics.update_collider(collider, desc).unwrap();
    // Checkpoint a job that is already stale, before the scheduler observes the edit.
    let cancelled = e.data_scene_combat_navigation_scheduler_stats()[7];
    let before = signature(&e);
    let packet = e.runtime_checkpoint().unwrap();
    let trace: Vec<_> = (0..12)
        .map(|_| {
            tick(&mut e, 1);
            signature(&e)
        })
        .collect();
    assert!(e.data_scene_combat_navigation_scheduler_stats()[7] > cancelled);
    e.restore_runtime_checkpoint_native(&packet).unwrap();
    assert_eq!(signature(&e), before);
    for expected in trace {
        tick(&mut e, 1);
        assert_eq!(signature(&e), expected);
    }
}

#[test]
fn runtime_checkpoint_native_cache_seek_and_acceleration_keep_canonical_intent() {
    use crate::engine::runtime_checkpoint::tests::signature;
    let (mut e, p, a) = setup();
    let b = capsule(&mut e, -2., 2.);
    let c = capsule(&mut e, -3., -3.);
    for id in [a, b] {
        e.world.set_movement_pattern(
            id,
            MovementPattern::SeekTarget {
                target: MovementTarget::Entity(p),
                speed: 2.,
                turn_rate: 0.2,
            },
        );
    }
    e.world.set_movement_pattern(
        c,
        MovementPattern::Accelerate {
            acceleration_x: 1.,
            acceleration_y: 0.,
            max_speed: 1.5,
        },
    );
    assert!(e.configure_data_scene_gameplay_v6(
        true,
        p.id,
        p.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[0.5, 0.3, 0.2, 0.1, 1., 64., 0.1],
        &[],
        &[],
        1
    ));
    tick(&mut e, 17);
    let packet = e.runtime_checkpoint().unwrap();
    let before = signature(&e);
    let trace: Vec<_> = (0..90)
        .map(|_| {
            tick(&mut e, 1);
            signature(&e)
        })
        .collect();
    assert!(e.data_scene_combat_navigation_scheduler_stats()[4] > 0);
    assert!(pos(&e, c)[0] > -2.9);
    e.restore_runtime_checkpoint_native(&packet).unwrap();
    assert_eq!(signature(&e), before);
    for expected in trace {
        tick(&mut e, 1);
        assert_eq!(signature(&e), expected);
    }
}
