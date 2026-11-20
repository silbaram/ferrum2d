use super::*;
use crate::components::gameplay::MovementTarget;
use crate::engine::{
    file_controller_admission as guard, file_prepare::NativeFilePrepare, persistence,
};
use crate::physics3d::{BodyKind, Shape};

fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn file_clone(e: &Engine) -> Engine {
    let before = bytes(e);
    let file = e
        .capture_native_file(b"{}{}{}{}{}{}", &[2; 6], 7, 9, &[])
        .unwrap();
    let mut target = Engine::new();
    let mut prepared = NativeFilePrepare::new(&target, file, 7, 9, &[]).unwrap();
    assert_eq!(target.install_native_file_prepare(&mut prepared), 0);
    assert_eq!(bytes(&target), before);
    assert_eq!(bytes(e), before);
    target
}
fn point(x: f32, z: f32) -> Point {
    Point {
        pose: Pose {
            position: [x, 0.76, z],
            ..Default::default()
        },
        surface: 7,
    }
}

#[test]
fn native_cached_connector_retains_certified_bends_and_reuses_only_identical_direct_join() {
    let shared: Arc<[Point]> = vec![point(2., 0.), point(3., 0.), point(4., 0.)].into();
    let direct = join_route(vec![point(2., 0.)], Arc::clone(&shared)).unwrap();
    assert!(Arc::ptr_eq(&direct, &shared));
    let bent = join_route(
        vec![point(0., 2.), point(2., 2.), point(2., 0.)],
        Arc::clone(&shared),
    )
    .unwrap();
    assert_eq!(bent.len(), 5);
    assert_eq!(bent[0].pose, point(0., 2.).pose);
    assert_eq!(bent[1].pose, point(2., 2.).pose);
    assert_eq!(bent[2].pose, point(2., 0.).pose);
    assert_eq!(bent[4].pose, point(4., 0.).pose);
    assert!(!Arc::ptr_eq(&bent, &shared));
    let signed: Arc<[Point]> = vec![point(-0., 0.)].into();
    let distinct = join_route(vec![point(0., 0.)], Arc::clone(&signed)).unwrap();
    assert_eq!(distinct.len(), 2);
    assert_eq!(distinct[0].pose.position[0].to_bits(), 0.0f32.to_bits());
    assert_eq!(distinct[1].pose.position[0].to_bits(), (-0.0f32).to_bits());
    assert!(!Arc::ptr_eq(&distinct, &signed));
    let suffix = route_suffix(Arc::clone(&shared), point(3.1, 0.).pose);
    assert_eq!(suffix.len(), 2);
    assert_eq!(suffix[0].pose, point(3., 0.).pose);
    assert_eq!(shared.len(), 3);
    let large: Arc<[Point]> = vec![point(2., 0.); 4096].into();
    assert!(join_route(vec![point(0., 1.), point(2., 0.)], large).is_none());
}

#[test]
fn native_cached_actual_connector_around_second_wall_reaches_goal_and_keeps_file_continuation() {
    let (mut e, primary, first) = super::tests::setup();
    e.world.set_movement_pattern(first, MovementPattern::Static);
    for (position, half_extents) in [
        ([1.5, 1., 0.], [0.3, 1., 0.6]),
        ([0., 1., 1.5], [0.7, 1., 0.2]),
    ] {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position,
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box { half_extents }),
            [0.; 3],
        )
        .unwrap();
    }
    // Finalize the complete geometry/controller roster before producing a cache.
    // A newly falling controller and changing supports are not a shared-route
    // fixture: both bodies must first reach their actual steady support pose.
    let follower = super::tests::capsule(&mut e, 0., 3.);
    super::tests::tick(&mut e, 120);
    e.world.set_movement_pattern(
        first,
        MovementPattern::Chase {
            target: MovementTarget::Entity(primary),
            speed: 2.,
        },
    );
    for _ in 0..120 {
        super::tests::tick(&mut e, 1);
        if e.data_scene_combat_navigation_scheduler_stats()[3] > 0 {
            break;
        }
    }
    assert!(e.data_scene_combat_navigation_scheduler_stats()[3] > 0);
    // Use exactly the public navigation configuration which the normal producer
    // installs before its lookup; prove the cache/profile precondition explicitly.
    let key = {
        let runtime = e.unified_physics.as_mut().unwrap();
        let body = runtime.spatial_actor_body(follower).unwrap();
        runtime
            .physics
            .set_character_traversal(body, 0.3, 0.2)
            .unwrap();
        cache::Key {
            target: primary,
            goal: runtime.gameplay_position(&e.world, primary).unwrap(),
            floor: 0,
            radius: 1.,
            cell: 0.5,
            profile: runtime.physics.character_route_profile(body).unwrap(),
        }
    };
    assert!(
        e.data_scene
            .gameplay
            .combat
            .file_native_routes_mut()
            .cache
            .find(&key)
            .is_some(),
        "the settled follower must match the actual cached target/profile before activation"
    );
    e.world.set_movement_pattern(
        follower,
        MovementPattern::Chase {
            target: MovementTarget::Entity(primary),
            speed: 2.,
        },
    );
    let mut deviation = 0f32;
    let mut active_file_checked = false;
    for _ in 0..480 {
        super::tests::tick(&mut e, 1);
        let at = super::tests::pos(&e, follower);
        deviation = deviation.max(at[0].abs());
        let active_join = {
            let nav = e.data_scene.gameplay.combat.file_native_routes_mut();
            nav.cache_hits > 0
                && nav.agents.iter().any(|a| {
                    a.entity == follower
                        && a.route.status == SpatialMoveStatus::Moving
                        && a.route
                            .file_route_arc()
                            .is_some_and(|(_, points)| points.len() > 1)
                })
        };
        if active_join && !active_file_checked {
            let mut restored = file_clone(&e);
            for _ in 0..6 {
                super::tests::tick(&mut e, 1);
                super::tests::tick(&mut restored, 1);
                assert_eq!(bytes(&e), bytes(&restored));
            }
            active_file_checked = true;
        }
    }
    assert!(
        active_file_checked,
        "an active certified multi-point join must survive actual file prepare/install: navigation={:?}, scheduler={:?}",
        e.data_scene_combat_navigation_stats(), e.data_scene_combat_navigation_scheduler_stats(),
    );
    let at = super::tests::pos(&e, follower);
    assert!(
        (at[0] - 4.).hypot(at[2]) <= 1.02,
        "follower={at:?},detour={deviation}"
    );
    assert!(e.data_scene_combat_navigation_scheduler_stats()[4] > 0);
    let mut restored = file_clone(&e);
    for _ in 0..6 {
        super::tests::tick(&mut e, 1);
        super::tests::tick(&mut restored, 1);
        assert_eq!(bytes(&e), bytes(&restored));
    }
}

fn dense() -> (Engine, Vec<Entity>) {
    dense_with_config(WorldConfig::default())
}

fn dense_with_config(config: WorldConfig) -> (Engine, Vec<Entity>) {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(config).unwrap();
    assert!(e.configure_spatial_terrain(
        &[-20., -20., 60., 40., -1., 0., 0., 1., 1., 1., 1.],
        &[7, 0, 0, 1]
    ));
    let primary = e
        .create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [20., 0.76, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.1 })
            },
            [0.; 3],
        )
        .unwrap();
    let mut actors = Vec::new();
    for row in 0..8 {
        for column in 0..8 {
            let actor = e
                .create_unified_body(
                    BodyDesc {
                        kind: BodyKind::KinematicPosition,
                        pose: Pose {
                            position: [
                                -6. + column as f32 * 0.55,
                                0.76,
                                -1.925 + row as f32 * 0.55,
                            ],
                            ..Default::default()
                        },
                        ..Default::default()
                    },
                    ColliderDesc::new(Shape::Capsule {
                        half_height: 0.5,
                        radius: 0.25,
                    }),
                    [100., -0.75, 0.],
                )
                .unwrap();
            e.enable_unified_character(actor, CharacterConfig::default())
                .unwrap();
            actors.push(actor);
        }
    }
    for _ in 0..4 {
        e.update(1. / 60.);
    }
    for &actor in &actors {
        assert!(e.unified_character_state(actor).unwrap().grounded);
        assert!(e.set_gameplay_movement_chase_entity(
            actor.id,
            actor.generation,
            primary.id,
            primary.generation,
            2.
        ));
    }
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
        &[],
        &[]
    ));
    (e, actors)
}
fn positions(e: &Engine, actors: &[Entity]) -> Vec<[f32; 3]> {
    actors
        .iter()
        .map(|&a| e.unified_body_state(a).unwrap().pose.position)
        .collect()
}
fn no_overlap(positions: &[[f32; 3]]) {
    for (i, a) in positions.iter().enumerate() {
        for b in &positions[..i] {
            assert!(
                (a[0] - b[0]).hypot(a[2] - b[2]) >= 0.49,
                "overlap {a:?}/{b:?}"
            );
        }
    }
}

#[test]
fn native_dense_sixty_four_actor_service_is_fair_bounded_nonoverlapping_and_advances_every_actor() {
    let (mut e, actors) = dense();
    let initial = positions(&e, &actors);
    let goal = e
        .unified_body_state(e.world.primary_actor_entity().unwrap())
        .unwrap()
        .pose
        .position;
    let mut cursors = [false; 64];
    for _ in 0..240 {
        let previous_cursor = e.data_scene.gameplay.combat.file_native_routes_mut().cursor;
        e.update(1. / 60.);
        assert_eq!(e.unified_physics_error(), None);
        let nav = e.data_scene.gameplay.combat.file_native_routes_mut();
        assert_eq!(nav.agents.len(), 64);
        assert_eq!(
            nav.cursor,
            (previous_cursor + 1) % 64,
            "motion service must rotate even without a search completion"
        );
        assert!(nav.used <= FRAME_WORK);
        assert!(nav.frame_searches <= 1);
        assert!(nav.frame_search_work <= SLICE_WORK as u32);
        cursors[nav.cursor] = true;
        no_overlap(&positions(&e, &actors));
    }
    assert!(cursors.into_iter().all(|seen| seen));
    let final_positions = positions(&e, &actors);
    let mut total_goal_progress = 0.;
    for (i, (before, after)) in initial.iter().zip(&final_positions).enumerate() {
        let distance = |p: &[f32; 3]| {
            (f64::from(p[0]) - f64::from(goal[0])).hypot(f64::from(p[2]) - f64::from(goal[2]))
        };
        let progress = distance(before) - distance(after);
        assert!(
            progress > 0.,
            "no goal progress actor={i},before={before:?},after={after:?},goal={goal:?}"
        );
        total_goal_progress += progress;
    }
    // Preserve the previous aggregate minimum advancement, while allowing a
    // serviced actor to make a real lateral detour before further X movement.
    assert!(
        total_goal_progress > actors.len() as f64 * 0.1,
        "{total_goal_progress}"
    );
    guard::validate(
        &e,
        guard::Limits {
            max_work: 16_000_000,
            max_scratch_bytes: 16_000_000,
        },
    )
    .unwrap();
    let mut restored = file_clone(&e);
    for _ in 0..6 {
        e.update(1. / 60.);
        restored.update(1. / 60.);
        no_overlap(&positions(&e, &actors));
        assert_eq!(bytes(&e), bytes(&restored));
    }
}

#[test]
fn native_dense_active_routes_and_partial_job_checkpoint_replays_without_rebuilding() {
    let (mut e, actors) = dense();
    for _ in 0..8 {
        e.update(1. / 60.);
    }
    let checkpoint = e.capture_runtime_checkpoint().unwrap();
    let trace: Vec<_> = (0..6)
        .map(|_| {
            e.update(1. / 60.);
            (
                positions(&e, &actors),
                e.data_scene_combat_navigation_stats(),
                e.data_scene_combat_navigation_scheduler_stats(),
            )
        })
        .collect();
    assert!(e.restore_runtime_checkpoint(&checkpoint));
    for (poses, stats, scheduler) in trace {
        e.update(1. / 60.);
        assert_eq!(positions(&e, &actors), poses);
        assert_eq!(e.data_scene_combat_navigation_stats(), stats);
        assert_eq!(e.data_scene_combat_navigation_scheduler_stats(), scheduler);
    }
}

fn steering_agent(entity: Entity) -> Agent {
    Agent {
        entity,
        target: None,
        goal: [4., 0.76, 0.],
        floor: 0,
        speed: 2.,
        cooldown: 0.,
        route: ActorNavigation::default(),
        detour: None,
        intent: Velocity { vx: 0.25, vy: -0.5 },
        pattern: None,
        last_pose: None,
        velocity_moving: false,
    }
}

#[test]
fn native_crowd_blocked_peer_charges_only_peer_phase_with_exact_and_one_below_budget() {
    let (mut e, _, actor) = super::tests::setup();
    let at = super::tests::pos(&e, actor);
    let peer = super::tests::capsule(&mut e, at[0] + 0.4, at[2]);
    let body = e.unified_body_id(actor).unwrap();
    let peer_body = e.unified_body_id(peer).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    assert!(runtime.physics.character_state(body).unwrap().grounded);
    let before = runtime.physics.capture_snapshot().unwrap();
    // The overlap in padding is approached by the first candidate. Its peer
    // verdict is complete without executing or admitting any terrain segment.
    let peer_cost = 2 * 32 + 128;
    for allowance in [peer_cost - 1, peer_cost] {
        let mut nav = NativeCombatNavigation {
            agents: vec![steering_agent(actor)],
            used: FRAME_WORK - allowance,
            peers: vec![
                crate::physics3d::CharacterCrowdPeer {
                    body,
                    velocity: [0.; 3],
                },
                crate::physics3d::CharacterCrowdPeer {
                    body: peer_body,
                    velocity: [0.; 3],
                },
            ],
            ..Default::default()
        };
        let scratch = postcard::to_allocvec(&nav.crowd_scratch).unwrap();
        let result = crowd::steer(
            runtime,
            &mut nav,
            &e.spatial_scene,
            0,
            [2., 0., 0.],
            0.5,
            Some(0.1),
            false,
            None,
        );
        assert_eq!(result.velocity, [0.; 3]);
        assert_eq!(result.admitted, allowance == peer_cost);
        assert_eq!(
            nav.used,
            FRAME_WORK - allowance
                + if result.admitted {
                    128 + u64::from(nav.crowd_stats[2]) * 16
                } else {
                    0
                }
        );
        assert_eq!(nav.crowd_stats[2], u32::from(result.admitted));
        assert_eq!(nav.crowd_stats[3], nav.crowd_stats[2]);
        assert!(nav.deferred > 0);
        assert_eq!(postcard::to_allocvec(&nav.crowd_scratch).unwrap(), scratch);
        assert_eq!(
            runtime.physics.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
}

#[test]
fn native_crowd_clear_peer_phase_still_requires_terrain_budget_before_probe() {
    let (mut e, _, actor) = super::tests::setup();
    let at = super::tests::pos(&e, actor);
    let peer = super::tests::capsule(&mut e, at[0], at[2] + 6.);
    let body = e.unified_body_id(actor).unwrap();
    let peer_body = e.unified_body_id(peer).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    assert!(runtime.physics.character_state(body).unwrap().grounded);
    let config = runtime.physics.character_config(body).unwrap();
    let travel = 0.1 * runtime.physics.config().step_seconds;
    assert!(travel <= config.step_min_width.min(0.5).max(config.skin_width * 2.));
    let terrain_cost =
        runtime.physics.collider_count() as u64 * 32 + e.spatial_scene.surfaces.len() as u64 + 8;
    // Both successful forecasts visit one non-self peer. Their reservation is
    // 2 peers * 32; only the reported 2 visits * 16 are actually spent.
    let peer_spent = 128 + 2 * 16;
    // The newly created peer leaves scene-query bounds pending. Prepare them
    // with the public cold query before taking the byte-preservation baseline.
    runtime
        .physics
        .cast_ray(
            &crate::physics3d::RayCast {
                origin: [at[0], 5., at[2]],
                direction: [0., -1., 0.],
                max_distance: 10.,
                solid: true,
            },
            &crate::physics3d::QueryFilter::default(),
        )
        .unwrap();
    let before = runtime.physics.capture_snapshot().unwrap();
    for allowance in [peer_spent + terrain_cost - 1, peer_spent + terrain_cost] {
        let mut nav = NativeCombatNavigation {
            agents: vec![steering_agent(actor)],
            used: FRAME_WORK - allowance,
            peers: vec![
                crate::physics3d::CharacterCrowdPeer {
                    body,
                    velocity: [0.; 3],
                },
                crate::physics3d::CharacterCrowdPeer {
                    body: peer_body,
                    velocity: [0.; 3],
                },
            ],
            ..Default::default()
        };
        let scratch = postcard::to_allocvec(&nav.crowd_scratch).unwrap();
        let result = crowd::steer(
            runtime,
            &mut nav,
            &e.spatial_scene,
            0,
            [0.1, 0., 0.],
            0.5,
            Some(0.1),
            false,
            None,
        );
        let complete = allowance == peer_spent + terrain_cost;
        assert_eq!(result.admitted, complete);
        assert_eq!(
            result.velocity,
            if complete { [0.1, 0., 0.] } else { [0.; 3] }
        );
        assert_eq!(
            nav.used,
            if complete {
                FRAME_WORK
            } else {
                FRAME_WORK - terrain_cost + 1
            }
        );
        assert_eq!(nav.crowd_stats[2], 2);
        assert_eq!(nav.crowd_stats[3], 2);
        assert_eq!(nav.deferred, u32::from(!complete));
        if !complete {
            assert_eq!(postcard::to_allocvec(&nav.crowd_scratch).unwrap(), scratch);
        }
        assert_eq!(
            runtime.physics.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
}

#[test]
fn native_crowd_failed_peer_query_keeps_its_whole_unknown_cost_reservation() {
    let (mut e, _, actor) = super::tests::setup();
    let at = super::tests::pos(&e, actor);
    let peer = super::tests::capsule(&mut e, at[0], at[2] + 6.);
    let body = e.unified_body_id(actor).unwrap();
    let peer_body = e.unified_body_id(peer).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    let before = runtime.physics.capture_snapshot().unwrap();
    let reservation = 128 + 2 * 32;
    let mut nav = NativeCombatNavigation {
        agents: vec![steering_agent(actor)],
        used: FRAME_WORK - reservation,
        peers: vec![
            crate::physics3d::CharacterCrowdPeer {
                body,
                velocity: [0.; 3],
            },
            crate::physics3d::CharacterCrowdPeer {
                body: peer_body,
                // Exercise the private query's typed error, not a valid saved
                // peer payload. Errors do not report their partial visit count.
                velocity: [f32::NAN, 0., 0.],
            },
        ],
        ..Default::default()
    };
    let scratch = postcard::to_allocvec(&nav.crowd_scratch).unwrap();
    let result = crowd::steer(
        runtime,
        &mut nav,
        &e.spatial_scene,
        0,
        [2., 0., 0.],
        0.5,
        Some(0.1),
        false,
        None,
    );
    assert_eq!(result.velocity, [0.; 3]);
    assert!(result.admitted);
    assert_eq!(nav.used, FRAME_WORK);
    assert_eq!(nav.crowd_stats[2], 0);
    assert_eq!(nav.deferred, 1);
    assert_eq!(postcard::to_allocvec(&nav.crowd_scratch).unwrap(), scratch);
    assert_eq!(
        runtime.physics.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn native_crowd_terrain_budget_defer_does_not_advance_acceleration_intent() {
    let (mut e, _, actor) = super::tests::setup();
    let mut nav = NativeCombatNavigation {
        agents: vec![steering_agent(actor)],
        used: FRAME_WORK - 128,
        ..Default::default()
    };
    let before = nav.agents[0].intent;
    patterns::accelerate(
        e.unified_physics.as_mut().unwrap(),
        &mut nav,
        &e.spatial_scene,
        0,
        NativeNavigationConfig {
            cell: 0.5,
            step: 0.3,
            drop: 0.2,
            interval: 0.1,
            radius: 1.,
            agents: 64,
            avoidance: None,
            all_patterns: true,
        },
        0.1,
        0.2,
        2.,
    );
    assert_eq!(nav.agents[0].intent, before);
    assert!(!nav.agents[0].velocity_moving);
    assert_eq!(nav.used, FRAME_WORK);
    assert_eq!(nav.deferred, 1);
    assert_eq!(nav.crowd_stats[2], 0);
}

#[test]
fn native_dense_fixed_hundred_hz_multi_substep_frames_advance_all_sixty_four_actors_in_four_seconds(
) {
    for outer_seconds in [1. / 60., 0.05] {
        let (mut e, actors) = dense_with_config(WorldConfig {
            gravity: [0., -10., 0.],
            step_seconds: 0.01,
            ..Default::default()
        });
        assert!(e.fixed_timestep_enabled);
        assert_eq!(e.fixed_timestep.config().step_seconds, 0.01);
        assert_eq!(actors.len(), 64);
        let initial = positions(&e, &actors);
        let goal = e
            .unified_body_state(e.world.primary_actor_entity().unwrap())
            .unwrap()
            .pose
            .position;
        let updates = (4.0f64 / outer_seconds).round() as usize;
        let mut multiple_steps = false;
        let mut fixed_steps = 0;
        let mut max_work = 0;
        let mut max_slice = 0;
        for _ in 0..updates {
            e.update(outer_seconds);
            assert_eq!(e.unified_physics_error(), None);
            let nav = e.data_scene.gameplay.combat.file_native_routes_mut();
            assert_eq!(nav.agents.len(), 64);
            assert!(nav.used <= FRAME_WORK);
            assert!(nav.frame_searches <= 1);
            assert!(nav.frame_search_work <= SLICE_WORK as u32);
            max_work = max_work.max(nav.used);
            max_slice = max_slice.max(nav.frame_search_work);
            multiple_steps |= e.last_fixed_update.steps > 1;
            fixed_steps += e.last_fixed_update.steps;
            if outer_seconds == 0.05 {
                assert_eq!(e.last_fixed_update.steps, 5);
            }
            no_overlap(&positions(&e, &actors));
        }
        assert!(
            multiple_steps,
            "outer={outer_seconds} must exercise actual fixed substeps"
        );
        assert_eq!(
            fixed_steps, 400,
            "outer={outer_seconds} must execute four actual seconds"
        );
        let final_positions = positions(&e, &actors);
        let mut total_progress = 0.;
        let mut minimum_progress = f64::INFINITY;
        for (index, (before, after)) in initial.iter().zip(&final_positions).enumerate() {
            let distance = |p: &[f32; 3]| {
                (f64::from(p[0]) - f64::from(goal[0])).hypot(f64::from(p[2]) - f64::from(goal[2]))
            };
            let progress = distance(before) - distance(after);
            assert!(progress > 0., "outer={outer_seconds}, actor={index}, before={before:?}, after={after:?}, goal={goal:?}");
            total_progress += progress;
            minimum_progress = minimum_progress.min(progress);
        }
        assert!(
            total_progress > actors.len() as f64 * 0.1,
            "outer={outer_seconds}, progress={total_progress}"
        );
        println!("native-crowd-fixed-budget: outer={outer_seconds}, agents=64, updates={updates}, min_goal_progress={minimum_progress}, total_goal_progress={total_progress}, max_work={max_work}, max_search_slice={max_slice}");
        let mut restored = file_clone(&e);
        for _ in 0..6 {
            e.update(outer_seconds);
            restored.update(outer_seconds);
            no_overlap(&positions(&e, &actors));
            assert_eq!(bytes(&e), bytes(&restored));
        }
    }
}

#[test]
fn native_crowd_chase_can_choose_existing_peer_clear_retreat_with_bounded_detour() {
    let (mut e, _, actor) = super::tests::setup();
    let at = super::tests::pos(&e, actor);
    let front = super::tests::capsule(&mut e, at[0] + 0.55, at[2]);
    let north = super::tests::capsule(&mut e, at[0], at[2] + 0.55);
    let body = e.unified_body_id(actor).unwrap();
    let front_body = e.unified_body_id(front).unwrap();
    let north_body = e.unified_body_id(north).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    let before = runtime.physics.body_state(body).unwrap().pose;
    assert!(runtime.physics.character_state(body).unwrap().grounded);
    let mut nav = NativeCombatNavigation {
        agents: vec![steering_agent(actor)],
        peers: [body, front_body, north_body]
            .into_iter()
            .map(|body| crate::physics3d::CharacterCrowdPeer {
                body,
                velocity: [0.; 3],
            })
            .collect(),
        ..Default::default()
    };
    // Padding-overlapped front/north peers reject every forward or perpendicular
    // candidate. An existing diagonal retreat separates from both peers.
    let desired = [2., 0., 0.1];
    let result = crowd::steer(
        runtime,
        &mut nav,
        &e.spatial_scene,
        0,
        desired,
        0.5,
        Some(0.1),
        false,
        None,
    );
    assert!(result.admitted);
    assert!(result.velocity[0] < 0. && result.velocity[2] < 0.);
    assert!(
        f64::from(result.velocity[0]) * f64::from(desired[0])
            + f64::from(result.velocity[2]) * f64::from(desired[2])
            < 0.
    );
    let (heading, left) = nav.agents[0].detour.unwrap();
    assert!(heading.iter().all(|v| v.is_finite()));
    let radius = runtime.physics.character_crowd_radius(body).unwrap();
    assert_eq!(left, radius * 2. + 0.1);
    assert!(nav.used <= FRAME_WORK);
    assert_eq!(nav.deferred, 0);
    assert_eq!(
        runtime.physics.body_state(body).unwrap().pose.position,
        before.position
    );
}

#[test]
fn native_crowd_chase_retries_clear_forward_before_active_detour_while_seek_keeps_heading() {
    let (mut e, _, actor) = super::tests::setup();
    let at = super::tests::pos(&e, actor);
    let peer = super::tests::capsule(&mut e, at[0] + 0.55, at[2]);
    let body = e.unified_body_id(actor).unwrap();
    let peer_body = e.unified_body_id(peer).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    let mut nav = NativeCombatNavigation {
        agents: vec![steering_agent(actor)],
        peers: [body, peer_body]
            .into_iter()
            .map(|body| crate::physics3d::CharacterCrowdPeer {
                body,
                velocity: [0.; 3],
            })
            .collect(),
        ..Default::default()
    };
    let desired = [2., 0., 0.];
    // Produce active steering from an actual padding-overlapped front peer.
    let initial = crowd::steer(
        runtime,
        &mut nav,
        &e.spatial_scene,
        0,
        desired,
        0.5,
        Some(0.1),
        false,
        None,
    );
    assert!(initial.admitted);
    assert_eq!(initial.velocity, [0., 0., 2.]);
    let active = nav.clone();
    let (heading, left) = active.agents[0].detour.unwrap();
    let travel = 2. * runtime.physics.config().step_seconds;
    // While forward remains blocked, Chase consumes active candidate1's
    // remaining distance instead of resetting it as a new detour.
    nav.begin_frame();
    let blocked = crowd::steer(
        runtime,
        &mut nav,
        &e.spatial_scene,
        0,
        desired,
        0.5,
        Some(0.1),
        false,
        None,
    );
    assert_eq!(blocked.velocity, initial.velocity);
    assert_eq!(nav.agents[0].detour, Some((heading, left - travel)));
    let mut peer_pose = runtime.physics.body_state(peer_body).unwrap().pose;
    peer_pose.position[0] += 6.;
    runtime.physics.set_pose(peer_body, peer_pose).unwrap();
    for detours in [false, true] {
        let mut next = active.clone();
        next.begin_frame();
        let result = crowd::steer(
            runtime,
            &mut next,
            &e.spatial_scene,
            0,
            desired,
            0.5,
            Some(0.1),
            detours,
            None,
        );
        assert!(result.admitted);
        if detours {
            assert_eq!(result.velocity, initial.velocity);
            assert_eq!(next.agents[0].detour, Some((heading, left - travel)));
        } else {
            assert_eq!(result.velocity, desired);
            assert_eq!(next.agents[0].detour, None);
        }
        assert!(next.used <= FRAME_WORK);
        assert_eq!(next.deferred, 0);
    }
}

#[test]
fn native_crowd_chase_prefers_clear_forward_diagonal_to_clear_active_retreat_with_stable_ties() {
    let (mut e, _, actor) = super::tests::setup();
    let at = super::tests::pos(&e, actor);
    let front = super::tests::capsule(&mut e, at[0] + 0.55, at[2]);
    let north = super::tests::capsule(&mut e, at[0], at[2] + 0.55);
    let body = e.unified_body_id(actor).unwrap();
    let front_body = e.unified_body_id(front).unwrap();
    let north_body = e.unified_body_id(north).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    let mut nav = NativeCombatNavigation {
        agents: vec![steering_agent(actor)],
        peers: [body, front_body, north_body]
            .into_iter()
            .map(|body| crate::physics3d::CharacterCrowdPeer {
                body,
                velocity: [0.; 3],
            })
            .collect(),
        ..Default::default()
    };
    // Real close peers first produce the existing bounded retreat state.
    let retreat = crowd::steer(
        runtime,
        &mut nav,
        &e.spatial_scene,
        0,
        [2., 0., 0.1],
        0.5,
        Some(0.1),
        false,
        None,
    );
    assert!(retreat.admitted && retreat.velocity[0] < 0. && retreat.velocity[2] < 0.);
    let (heading, left) = nav.agents[0].detour.unwrap();
    let mut front_pose = runtime.physics.body_state(front_body).unwrap().pose;
    front_pose.position[0] = at[0] + 1.;
    runtime.physics.set_pose(front_body, front_pose).unwrap();
    let mut north_pose = runtime.physics.body_state(north_body).unwrap().pose;
    north_pose.position[2] = at[2] + 6.;
    runtime.physics.set_pose(north_body, north_pose).unwrap();
    let desired = [2., 0., 0.];
    let mut seek = nav.clone();
    seek.begin_frame();
    let unchanged_seek = crowd::steer(
        runtime,
        &mut seek,
        &e.spatial_scene,
        0,
        desired,
        0.5,
        Some(0.1),
        true,
        None,
    );
    assert!(unchanged_seek.admitted && unchanged_seek.velocity[0] < 0.);
    assert_eq!(
        seek.agents[0].detour,
        Some((heading, left - 2. * runtime.physics.config().step_seconds))
    );
    nav.begin_frame();
    let result = crowd::steer(
        runtime,
        &mut nav,
        &e.spatial_scene,
        0,
        desired,
        0.5,
        Some(0.1),
        false,
        None,
    );
    assert!(result.admitted);
    // Straight is blocked by the long forecast, both forward diagonals are
    // clear, and their exact equal projection must keep the original +45 index.
    let diagonal = 2. * std::f32::consts::FRAC_1_SQRT_2;
    assert_eq!(result.velocity, [diagonal, 0., diagonal]);
    assert!(nav.agents[0].detour.unwrap().0[0] > 0.);
    assert!(nav.used <= FRAME_WORK);
    assert_eq!(nav.deferred, 0);
}

#[test]
fn native_crowd_cohort_uses_current_chase_nonzero_intent_and_exact_target_rows() {
    let (e, target, actor) = super::tests::setup();
    let body = e.unified_body_id(actor).unwrap();
    let before = e
        .unified_physics
        .as_ref()
        .unwrap()
        .physics
        .capture_snapshot()
        .unwrap();
    let chase = MovementPattern::Chase {
        target: MovementTarget::Entity(target),
        speed: 2.,
    };
    let seek = MovementPattern::SeekTarget {
        target: MovementTarget::Entity(target),
        speed: 2.,
        turn_rate: 1.,
    };
    let acceleration = MovementPattern::Accelerate {
        acceleration_x: 1.,
        acceleration_y: 0.,
        max_speed: 2.,
    };
    let mut agent = steering_agent(actor);
    agent.target = Some(target);
    agent.pattern = Some(chase);
    assert_eq!(crowd::cohort_target(&agent, Some(chase)), Some(target));
    // No native velocity enters eligibility: ongoing canonical intent survives
    // a budget-deferred zero accepted velocity in the peer snapshot.
    for stopped in [Velocity::default(), Velocity { vx: -0., vy: -0. }] {
        agent.intent = stopped;
        assert_eq!(crowd::cohort_target(&agent, Some(chase)), None);
    }
    agent.intent = Velocity { vx: 2., vy: 0. };
    assert_eq!(crowd::cohort_target(&agent, Some(seek)), None);
    assert_eq!(crowd::cohort_target(&agent, Some(acceleration)), None);
    assert_eq!(
        crowd::cohort_target(&agent, Some(MovementPattern::Static)),
        None
    );
    agent.pattern = Some(seek);
    assert_eq!(crowd::cohort_target(&agent, Some(seek)), None);
    agent.pattern = Some(acceleration);
    assert_eq!(crowd::cohort_target(&agent, Some(acceleration)), None);
    agent.pattern = Some(chase);
    let other = actor;
    agent.target = Some(other);
    assert_eq!(crowd::cohort_target(&agent, Some(chase)), Some(other));

    let mut targets = [None; 64];
    targets[0] = Some(target);
    targets[1] = crowd::cohort_target(&agent, Some(chase));
    targets[63] = Some(target); // Outside this two-row peer snapshot.
    let peers = vec![
        crate::physics3d::CharacterCrowdPeer {
            body,
            velocity: [0.; 3],
        },
        crate::physics3d::CharacterCrowdPeer {
            body,
            velocity: [0.; 3],
        },
    ];
    for allowance in [9, 10] {
        let mut nav = NativeCombatNavigation {
            peers: peers.clone(),
            used: FRAME_WORK - allowance,
            ..Default::default()
        };
        let input = postcard::to_allocvec(&nav.peers).unwrap();
        assert_eq!(
            crowd::cohort_mask(&mut nav, target, &targets),
            (allowance == 10).then_some(1)
        );
        assert_eq!(
            nav.used,
            FRAME_WORK - allowance + if allowance == 10 { 10 } else { 0 }
        );
        assert_eq!(nav.crowd_stats[2], 0);
        assert_eq!(postcard::to_allocvec(&nav.peers).unwrap(), input);
    }
    let mut nav = NativeCombatNavigation {
        peers: (0..64).map(|_| peers[0].clone()).collect(),
        ..Default::default()
    };
    assert_eq!(
        crowd::cohort_mask(&mut nav, target, &[Some(target); 64]),
        Some(u64::MAX)
    );
    assert_eq!(nav.used, 64 + 8);
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn native_crowd_cohort_queries_short_once_refunds_skipped_long_and_requires_both_admissions() {
    let (mut e, target, actor) = super::tests::setup();
    let at = super::tests::pos(&e, actor);
    let peer = super::tests::capsule(&mut e, at[0] + 1.2, at[2]);
    let body = e.unified_body_id(actor).unwrap();
    let peer_body = e.unified_body_id(peer).unwrap();
    let runtime = e.unified_physics.as_mut().unwrap();
    runtime
        .physics
        .cast_ray(
            &crate::physics3d::RayCast {
                origin: [at[0], 5., at[2]],
                direction: [0., -1., 0.],
                max_distance: 10.,
                solid: true,
            },
            &crate::physics3d::QueryFilter::default(),
        )
        .unwrap();
    let before = runtime.physics.capture_snapshot().unwrap();
    let peers = vec![
        crate::physics3d::CharacterCrowdPeer {
            body,
            velocity: [0.; 3],
        },
        crate::physics3d::CharacterCrowdPeer {
            body: peer_body,
            velocity: [0.; 3],
        },
    ];
    let input = postcard::to_allocvec(&peers).unwrap();
    let mut targets = [None; 64];
    targets[1] = Some(target);
    let mask_work = 2 + 8;
    let reservation = 2 * 32 + 128;
    let spent = 128 + 16;
    let terrain_cost =
        runtime.physics.collider_count() as u64 * 32 + e.spatial_scene.surfaces.len() as u64 + 8;
    for allowance in [
        mask_work + reservation - 1,
        mask_work + spent + terrain_cost - 1,
        mask_work + spent + terrain_cost,
    ] {
        let mut nav = NativeCombatNavigation {
            agents: vec![steering_agent(actor)],
            peers: peers.clone(),
            used: FRAME_WORK - allowance,
            ..Default::default()
        };
        let intent = nav.agents[0].intent;
        let mask = crowd::cohort_mask(&mut nav, target, &targets).unwrap();
        assert_eq!(mask, 0b10);
        let result = crowd::steer_with_cohort(
            runtime,
            &mut nav,
            &e.spatial_scene,
            0,
            [2., 0., 0.],
            0.5,
            Some(0.1),
            false,
            None,
            mask,
        );
        let queried = allowance != mask_work + reservation - 1;
        let complete = allowance == mask_work + spent + terrain_cost;
        assert_eq!(result.admitted, complete);
        assert_eq!(
            result.velocity,
            if complete { [2., 0., 0.] } else { [0.; 3] }
        );
        assert_eq!(nav.crowd_stats[2], u32::from(queried));
        assert_eq!(
            nav.used,
            FRAME_WORK - allowance
                + mask_work
                + if queried { spent } else { 0 }
                + if complete { terrain_cost } else { 0 }
        );
        assert_eq!(nav.agents[0].intent, intent);
        assert_eq!(postcard::to_allocvec(&nav.peers).unwrap(), input);
        assert_eq!(
            runtime.physics.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
    // The unchanged wrapper's mask is zero: resting/different-target peers keep
    // their long forecast, and Seek/Accelerate never opt into the cohort entry.
    for detours in [false, true] {
        let mut nav = NativeCombatNavigation {
            agents: vec![steering_agent(actor)],
            peers: peers.clone(),
            ..Default::default()
        };
        let result = crowd::steer(
            runtime,
            &mut nav,
            &e.spatial_scene,
            0,
            [2., 0., 0.],
            0.5,
            Some(0.1),
            detours,
            None,
        );
        assert_ne!(result.velocity, [2., 0., 0.]);
    }
    runtime
        .physics
        .set_pose(
            peer_body,
            Pose {
                position: [at[0] + 0.63, at[1], at[2]],
                ..Default::default()
            },
        )
        .unwrap();
    runtime
        .physics
        .cast_ray(
            &crate::physics3d::RayCast {
                origin: [at[0], 5., at[2]],
                direction: [0., -1., 0.],
                max_distance: 10.,
                solid: true,
            },
            &crate::physics3d::QueryFilter::default(),
        )
        .unwrap();
    let before = runtime.physics.capture_snapshot().unwrap();
    let mut nav = NativeCombatNavigation {
        agents: vec![steering_agent(actor)],
        peers,
        used: FRAME_WORK - reservation,
        ..Default::default()
    };
    let result = crowd::steer_with_cohort(
        runtime,
        &mut nav,
        &e.spatial_scene,
        0,
        [2., 0., 0.],
        0.5,
        Some(0.1),
        false,
        None,
        0b10,
    );
    assert!(result.admitted);
    assert_eq!(
        result.velocity, [0.; 3],
        "the actual-dt short collision is never skipped"
    );
    assert_eq!(nav.crowd_stats[2], 1);
    assert_eq!(nav.used, FRAME_WORK - reservation + spent);
    assert_eq!(
        runtime.physics.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn native_route_intent_cost_is_constant_while_seek_terrain_keeps_collider_wide_admission() {
    fn prepared(
        extra_colliders: usize,
        seek: bool,
    ) -> (
        Engine,
        NativeCombatNavigation,
        NativeNavigationConfig,
        crate::physics3d::BodyId,
    ) {
        let (mut e, target, actor) = super::tests::setup();
        let carrier = e
            .create_unified_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: [100., 1., 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc {
                    sensor: true,
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.1 })
                },
                [0.; 3],
            )
            .unwrap();
        let carrier_body = e.unified_body_id(carrier).unwrap();
        let actor_body = e.unified_body_id(actor).unwrap();
        if seek {
            e.world.set_movement_pattern(
                actor,
                MovementPattern::SeekTarget {
                    target: MovementTarget::Entity(target),
                    speed: 2.,
                    turn_rate: 1.,
                },
            );
        }
        let config = NativeNavigationConfig {
            cell: 0.5,
            step: 0.3,
            drop: 0.2,
            interval: 0.1,
            radius: 1.,
            agents: 8,
            avoidance: None,
            all_patterns: true,
        };
        let runtime = e.unified_physics.as_mut().unwrap();
        for index in 0..extra_colliders {
            runtime
                .physics
                .add_collider(
                    carrier_body,
                    ColliderDesc {
                        pose: Pose {
                            position: [index as f32 * 2., 0., 0.],
                            ..Default::default()
                        },
                        sensor: true,
                        ..ColliderDesc::new(Shape::Sphere { radius: 0.1 })
                    },
                )
                .unwrap();
        }
        // Produce the actual route/cache/controller metadata with the owner.
        // Keep the next measured call in its completed-planning phase; no fake
        // route roster or query result stands in for a successfully built route.
        let mut nav = NativeCombatNavigation::default();
        runtime.step_combat_navigation(
            &mut nav,
            &e.world,
            &e.spatial_scene,
            config,
            &BTreeMap::new(),
        );
        assert_eq!(nav.agents.len(), 1);
        assert!(nav.agents[0].route.status == SpatialMoveStatus::Moving);
        assert!(nav.agents[0].route.target().is_some_and(|p| {
            let at = runtime
                .physics
                .body_state(actor_body)
                .unwrap()
                .pose
                .position;
            (p.position[0] - at[0]).hypot(p.position[2] - at[2]) > config.cell
        }));
        assert!(nav.pending.is_none());
        nav.used = 0;
        nav.advanced = true;
        (e, nav, config, actor_body)
    }

    for seek in [false, true] {
        let mut counts = Vec::new();
        for extra in [0, 8, 24] {
            let (mut e, prepared, config, body) = prepared(extra, seek);
            let alive = e.world.alive_indices().len() as u64;
            let surfaces = e.spatial_scene.surfaces.len() as u64;
            let runtime = e.unified_physics.as_mut().unwrap();
            let colliders = runtime.physics.collider_count() as u64;
            counts.push(colliders);
            let admission = alive * (config.agents as u64 + 3) + 1;
            let cache = colliders * 4 + surfaces + 9;
            let actor_visit = alive + surfaces + 1;
            let prefix = admission + cache + actor_visit;
            let terrain = colliders * 32 + surfaces + 8;
            let from = runtime.physics.body_state(body).unwrap().pose;

            let mut unlimited = prepared.clone();
            runtime.step_combat_navigation(
                &mut unlimited,
                &e.world,
                &e.spatial_scene,
                config,
                &BTreeMap::new(),
            );
            let real_probe_cost = if seek { 128 + terrain } else { 0 };
            assert_eq!(
                unlimited.used - prefix - real_probe_cost,
                1,
                "seek={seek}, colliders={colliders}"
            );
            assert_eq!(unlimited.deferred, 0);
            assert_eq!(runtime.physics.body_state(body).unwrap().pose, from);

            // One unit, rather than collider_count*32+1, admits the intent and
            // O(1) shortcut-target lookup. No geometry is admitted by this unit.
            for intent_allowance in [0, 1] {
                let mut nav = prepared.clone();
                nav.used = FRAME_WORK - prefix - intent_allowance;
                nav.deferred = 0;
                let scratch = postcard::to_allocvec(&nav.crowd_scratch).unwrap();
                runtime.step_combat_navigation(
                    &mut nav,
                    &e.world,
                    &e.spatial_scene,
                    config,
                    &BTreeMap::new(),
                );
                assert_eq!(nav.used, FRAME_WORK);
                assert_eq!(nav.crowd_stats[2], 0);
                assert_eq!(postcard::to_allocvec(&nav.crowd_scratch).unwrap(), scratch);
                assert_eq!(runtime.physics.body_state(body).unwrap().pose, from);
                assert_eq!(nav.deferred, u32::from(intent_allowance == 0 || seek));
            }

            if seek {
                // The lookahead target is far away, so no shortcut geometry is
                // needed. The actual crowd terrain probe still requires every
                // collider's existing conservative unit before execution.
                for allowance in [prefix + 1 + 128 + terrain - 1, prefix + 1 + 128 + terrain] {
                    let mut nav = prepared.clone();
                    nav.used = FRAME_WORK - allowance;
                    nav.deferred = 0;
                    let intent = nav.agents[0].intent;
                    let scratch = postcard::to_allocvec(&nav.crowd_scratch).unwrap();
                    runtime.step_combat_navigation(
                        &mut nav,
                        &e.world,
                        &e.spatial_scene,
                        config,
                        &BTreeMap::new(),
                    );
                    let exact = allowance == prefix + 1 + 128 + terrain;
                    assert_eq!(nav.deferred, u32::from(!exact));
                    assert_eq!(
                        nav.used,
                        if exact {
                            FRAME_WORK
                        } else {
                            FRAME_WORK - terrain + 1
                        }
                    );
                    if !exact {
                        assert_eq!(nav.agents[0].intent, intent);
                        assert_eq!(postcard::to_allocvec(&nav.crowd_scratch).unwrap(), scratch);
                    }
                    assert_eq!(runtime.physics.body_state(body).unwrap().pose, from);
                }
            }
        }
        assert_eq!(counts[1] - counts[0], 8);
        assert_eq!(counts[2] - counts[0], 24);
    }
}
