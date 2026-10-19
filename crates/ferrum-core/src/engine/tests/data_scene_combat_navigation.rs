use super::{
    data_scene_visuals::sprite,
    spatial_navigation::{pose, setup},
    *,
};

pub(super) fn enemy(e: &mut Engine, x: f32, y: f32, trigger: bool) -> Entity {
    let entity = sprite(e, 72, x, y, 0);
    e.world.set_aabb_collider(
        entity,
        AabbCollider::new(2., 2., trigger, CollisionLayer::Enemy),
    );
    e.world
        .set_collision_filter(entity, CollisionFilter::from_layer(CollisionLayer::Enemy));
    assert!(e.configure_data_scene_body(entity.id, entity.generation, 1, true, 0, 0., 8.));
    assert!(e.set_gameplay_movement_chase_primary_actor(entity.id, entity.generation, 64.));
    entity
}
fn configure(e: &mut Engine, actor: Entity, agents: f32) -> bool {
    e.configure_data_scene_gameplay_v4(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 0., agents],
    )
}
fn reach(e: &mut Engine, entity: Entity, floor: u32, y: f32) {
    for _ in 0..1200 {
        e.update(1. / 60.);
        let p = pose(e, entity);
        let stats = e.data_scene_combat_navigation_stats();
        assert!(stats[8] <= 1 && stats[9] <= 1_000_000, "{stats:?}");
        if p.2 == floor && (p.1 - y).abs() < 0.01 {
            return;
        }
    }
    panic!(
        "pose={:?} stats={:?}",
        pose(e, entity),
        e.data_scene_combat_navigation_stats()
    );
}
#[test]
fn combat_navigation_routes_trigger_and_solid_chasers_up_and_down_and_same_xy_other_floor() {
    for trigger in [false, true] {
        let (mut e, actor) = setup(true);
        let chaser = enemy(&mut e, 0., 16., trigger);
        e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
        e.world
            .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
        assert!(configure(&mut e, actor, 4.));
        reach(&mut e, chaser, 1, 80.);
        assert_eq!(pose(&e, chaser).3, 32.);
        // Same XY on the lower surface must travel via the ramp and side path.
        e.world
            .set_height_span(actor, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
        e.update(1. / 60.);
        assert_eq!(pose(&e, chaser).2, 1);
        reach(&mut e, chaser, 0, 80.);
        assert_eq!(pose(&e, chaser).3, 0.);
        assert_eq!(
            e.data_scene_spatial_move_status(),
            0,
            "AI must not own player route"
        );
    }
}
#[test]
fn combat_navigation_stops_without_connection_and_retries_after_topology_change() {
    let (mut e, actor) = setup(true);
    let chaser = enemy(&mut e, 0., 16., true);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
    assert!(e.spatial_scene.configure_connections(&[]));
    assert!(configure(&mut e, actor, 1.));
    for _ in 0..120 {
        e.update(1. / 60.);
    }
    assert_eq!(pose(&e, chaser), (0., 16., 0, 0.));
    assert!(e.data_scene_combat_navigation_stats()[6] > 0);
    assert!(e.spatial_scene.configure_connections(&[2, 3]));
    reach(&mut e, chaser, 1, 80.);
}
#[test]
fn combat_navigation_fixed_substeps_share_search_and_work_limits_and_pause_does_not_catch_up() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let chasers: Vec<_> = (0..8)
        .map(|i| enemy(&mut e, i as f32 * 2. - 8., 16., true))
        .collect();
    assert!(configure(&mut e, actor, 8.));
    e.configure_fixed_timestep(true, 1. / 120., 1., 16);
    for _ in 0..16 {
        e.update(0.1);
        let stats = e.data_scene_combat_navigation_stats();
        assert!(stats[8] <= 1 && stats[9] <= 1_000_000, "{stats:?}");
    }
    assert!(chasers.iter().all(|a| pose(&e, *a).1 > 16.));
    assert!(e.pause_data_scene());
    let before: Vec<_> = chasers.iter().map(|a| pose(&e, *a)).collect();
    e.update(10.);
    assert_eq!(
        before,
        chasers.iter().map(|a| pose(&e, *a)).collect::<Vec<_>>()
    );
    assert!(e.resume_data_scene());
    e.update(1. / 120.);
    for (i, a) in chasers.iter().enumerate() {
        assert!((pose(&e, *a).1 - before[i].1).abs() < 9.);
    }
}
#[test]
fn combat_navigation_configuration_is_atomic_and_old_configuration_disables_it() {
    let (mut e, actor) = setup(false);
    let chaser = enemy(&mut e, 0., 16., true);
    assert!(configure(&mut e, actor, 1.));
    let before = e.data_scene_combat_navigation_stats();
    for bad in [
        &[8., 8., 40., 0., 0., 1.][..],
        &[8., 8., 40., 0.5, 0., 0.],
        &[8., 8., 40., 0.5, 0., 65.],
    ] {
        assert!(!e.configure_data_scene_gameplay_v4(
            true,
            actor.id,
            actor.generation,
            0,
            true,
            &[],
            &[],
            &[],
            bad
        ));
        assert_eq!(e.data_scene_combat_navigation_stats(), before);
    }
    e.world.set_rigid_body(chaser, RigidBody::static_body());
    assert!(!configure(&mut e, actor, 1.));
    assert_eq!(e.data_scene_combat_navigation_stats(), before);
    assert!(e.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    assert_eq!(e.data_scene_combat_navigation_stats()[1], 0);
}
#[test]
fn combat_navigation_target_generation_cancels_stale_paths() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let chaser = enemy(&mut e, 0., 16., true);
    assert!(configure(&mut e, actor, 1.));
    e.update(1. / 60.);
    assert!(pose(&e, chaser).1 > 16.);
    e.world.despawn(actor);
    let before = pose(&e, chaser);
    e.update(0.1);
    assert_eq!(pose(&e, chaser), before);
    let replacement = sprite(&mut e, 73, 0., 96., 0);
    assert_eq!(replacement.id, actor.id);
    assert_ne!(replacement.generation, actor.generation);
    e.update(0.1);
    assert_eq!(
        pose(&e, chaser),
        before,
        "reused slot is not the old target"
    );
}

#[test]
fn combat_navigation_wall_detour_respects_mutual_masks_and_height() {
    for filtered in [false, true] {
        let (mut e, actor) = setup(false);
        e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
        let chaser = enemy(&mut e, 0., 16., true);
        let wall = sprite(&mut e, 73, 0., 56., 0);
        e.world.set_aabb_collider(
            wall,
            AabbCollider::new(12., 8., false, CollisionLayer::Wall),
        );
        e.world
            .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
        e.world
            .set_collision_filter(wall, CollisionFilter::from_layer(CollisionLayer::Wall));
        if filtered {
            e.world.set_collision_filter(
                wall,
                CollisionFilter::new(CollisionMask::WALL, CollisionMask::PLAYER),
            );
        }
        assert!(configure(&mut e, actor, 1.));
        let mut detoured = false;
        for _ in 0..600 {
            e.update(1. / 60.);
            let p = pose(&e, chaser);
            detoured |= p.0.abs() > 1.;
            if (p.1 - 96.).abs() < 0.01 {
                break;
            }
        }
        assert!((pose(&e, chaser).1 - 96.).abs() < 0.01);
        assert_eq!(detoured, !filtered);
    }
}

#[test]
fn combat_navigation_64_agents_stay_fair_and_charge_teleport_query_cancellation() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let chasers: Vec<_> = (0..64).map(|_| enemy(&mut e, 0., 16., true)).collect();
    assert!(configure(&mut e, actor, 64.));
    e.configure_fixed_timestep(true, 1. / 120., 1., 16);
    for _ in 0..80 {
        e.update(1. / 30.);
        let s = e.data_scene_combat_navigation_stats();
        assert!(s[8] <= 1 && s[9] <= 1_000_000, "{s:?}");
    }
    assert!(chasers.iter().all(|a| pose(&e, *a).1 > 16.));
    for chaser in &chasers {
        e.world
            .set_transform(*chaser, Transform2D { x: 8., y: 24. });
    }
    e.update(1e-40);
    e.update(1. / 30.);
    let s = e.data_scene_combat_navigation_stats();
    assert!(s[8] <= 1 && s[9] <= 1_000_000 && s[9] > 64, "{s:?}");
    for chaser in &chasers {
        let v = e.world.velocity(*chaser).unwrap();
        assert!(v.vx.is_finite() && v.vy.is_finite());
    }
}

#[test]
fn combat_navigation_nearest_tag_keeps_entity_floor_instead_of_xy_only() {
    let (mut e, actor) = setup(true);
    let chaser = enemy(&mut e, 0., 16., true);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
    e.world
        .set_gameplay_tags(actor, GameplayTags::new(1 << 5).unwrap());
    assert!(e.set_gameplay_movement_chase_nearest_tag(chaser.id, chaser.generation, 5, 64.));
    assert!(configure(&mut e, actor, 1.));
    reach(&mut e, chaser, 1, 80.);
}

#[test]
fn combat_navigation_render_only_frames_do_not_starve_half_the_repath_slots() {
    let (mut e, actor) = setup(false);
    let chasers: Vec<_> = (0..64).map(|_| enemy(&mut e, 0., 16., true)).collect();
    assert!(configure(&mut e, actor, 64.));
    e.configure_fixed_timestep(true, 1. / 60., 1., 8);
    // 120Hz render / 60Hz simulation. Continually moving target makes old routes repath due.
    for frame in 0..256 {
        e.world.set_transform(
            actor,
            Transform2D {
                x: if frame % 4 < 2 { -16. } else { 16. },
                y: 96.,
            },
        );
        e.update(1. / 120.);
        let stats = e.data_scene_combat_navigation_stats();
        assert!(stats[8] <= 1 && stats[9] <= 1_000_000);
    }
    assert!(
        chasers.iter().all(|a| pose(&e, *a).1 > 16.),
        "render-only frames starved a chaser"
    );
}

fn scheduler(e: &Engine) -> Vec<u32> {
    e.data_scene_combat_navigation_scheduler_stats()
}
#[test]
fn combat_navigation_shared_goal_reuses_routes_and_rejects_footprint_mismatch() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let followers: Vec<_> = (0..64).map(|_| enemy(&mut e, 0., 16., true)).collect();
    assert!(configure(&mut e, actor, 64.));
    for _ in 0..80 {
        e.update(1. / 60.);
    }
    let s = scheduler(&e);
    assert!(s[4] >= 60, "{s:?}");
    assert!(
        e.data_scene_combat_navigation_stats()[5] <= 4,
        "shared routes should replace searches"
    );
    assert!(followers.iter().all(|&a| pose(&e, a).1 > 16.));
    let large = followers[0];
    e.world.set_aabb_collider(
        large,
        AabbCollider::new(3., 3., true, CollisionLayer::Enemy),
    );
    e.world.set_transform(large, Transform2D { x: 0., y: 16. });
    e.update(1. / 60.); // The follower cancels an external teleport.
    let hits = scheduler(&e)[4];
    for _ in 0..64 {
        e.update(1. / 60.);
    }
    assert_eq!(
        scheduler(&e)[4],
        hits,
        "different collider must not reuse a small actor's route"
    );
    assert!(pose(&e, large).1 > 16.);
}
fn slow_search() -> (Engine, Entity, Entity) {
    let (mut e, actor) = setup(false);
    assert!(e.configure_spatial_terrain(
        &[-128., 0., 256., 256., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    e.world.set_transform(actor, Transform2D { x: 0., y: 240. });
    let follower = enemy(&mut e, 0., 16., true);
    for (i, (x, y, w, h)) in [
        (-40., 64., 80., 4.),
        (40., 128., 80., 4.),
        (-40., 192., 80., 4.),
    ]
    .into_iter()
    .enumerate()
    {
        let wall = sprite(&mut e, 74 + i as u32, x, y, 0);
        e.world
            .set_aabb_collider(wall, AabbCollider::new(w, h, false, CollisionLayer::Wall));
        e.world
            .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
        e.world
            .set_collision_filter(wall, CollisionFilter::from_layer(CollisionLayer::Wall));
    }
    assert!(configure(&mut e, actor, 1.));
    (e, actor, follower)
}
#[test]
fn combat_navigation_long_job_yields_restores_pose_and_finishes_under_both_budgets() {
    let (mut e, _, a) = slow_search();
    let initial = pose(&e, a);
    let mut pending = false;
    for frame in 0..1800 {
        let before = pose(&e, a);
        e.update(1. / 60.);
        let s = scheduler(&e);
        let n = e.data_scene_combat_navigation_stats();
        assert!(
            n[8] <= 1 && n[9] <= 1_000_000 && s[8] <= 262_144 && s[9] <= 8_000_000,
            "frame={frame} {n:?} {s:?}"
        );
        if s[2] == 1 {
            pending = true;
            assert_eq!(
                pose(&e, a),
                before,
                "a query slice leaked a hypothetical body pose"
            );
        }
        if (pose(&e, a).1 - 240.).abs() < 0.01 {
            assert!(
                pending && s[6] > 0 && s[5] > 1,
                "search never actually yielded: {s:?}"
            );
            return;
        }
    }
    panic!(
        "initial={initial:?} final={:?} nav={:?} scheduler={:?}",
        pose(&e, a),
        e.data_scene_combat_navigation_stats(),
        scheduler(&e)
    );
}
#[test]
fn combat_navigation_pending_job_cancels_on_target_generation_source_teleport_and_topology() {
    for mode in 0..3 {
        let (mut e, target, source) = slow_search();
        e.update(1. / 60.);
        assert_eq!(scheduler(&e)[2], 1, "test needs a genuinely pending job");
        match mode {
            0 => {
                e.world.despawn(target);
            }
            1 => {
                e.world.set_transform(source, Transform2D { x: 8., y: 16. });
            }
            _ => {
                assert!(e.spatial_scene.configure_connections(&[]));
            }
        }
        e.update(1. / 60.);
        assert!(scheduler(&e)[7] > 0, "{mode}: {:?}", scheduler(&e));
        if mode == 0 {
            assert_eq!(scheduler(&e)[2], 0);
        }
        assert!(e.data_scene_combat_navigation_stats()[9] <= 1_000_000);
    }
}
#[test]
fn combat_navigation_pending_pause_freezes_and_old_config_discards_scheduler_state() {
    let (mut e, actor, a) = slow_search();
    e.update(1. / 60.);
    assert_eq!(scheduler(&e)[2], 1);
    assert!(e.pause_data_scene());
    let before = scheduler(&e);
    let p = pose(&e, a);
    e.update(1.);
    // Per-frame counters may reset, but the pending job does no work and keeps its owner.
    assert_eq!(&scheduler(&e)[..8], &before[..8]);
    assert_eq!(pose(&e, a), p);
    assert!(e.resume_data_scene());
    assert!(e.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    assert_eq!(scheduler(&e), vec![1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

#[test]
fn combat_navigation_repeated_pending_owner_cancellation_does_not_starve_other_sources() {
    let (mut e, actor, first) = slow_search();
    assert!(configure(&mut e, actor, 2.));
    e.update(1. / 60.);
    assert_eq!(scheduler(&e)[2], 1);
    let second = enemy(&mut e, 8., 16., true);
    for frame in 0..240 {
        e.world.set_transform(
            first,
            Transform2D {
                x: (frame % 2 + 1) as f32,
                y: 16.,
            },
        );
        e.update(1. / 60.);
        if pose(&e, second).1 > 16.01 {
            assert!(scheduler(&e)[7] > 0);
            return;
        }
    }
    panic!(
        "cancelled owner starved another source: {:?}",
        scheduler(&e)
    );
}

#[test]
fn combat_navigation_incremental_admission_keeps_owner_and_restores_pose_on_short_frame() {
    use crate::spatial_scene::{CombatNavigationRequest, SpatialNavigation};
    let (mut e, actor, a) = slow_search();
    let mut route = SpatialNavigation::default();
    let mut scratch = SpatialNavigation::default();
    let initial = pose(&e, a);
    let mut pending = false;
    for frame in 0..64 {
        let short = frame == 1;
        let r = route.advance_combat_search(
            &mut scratch,
            &mut e.spatial_scene,
            &mut e.world,
            CombatNavigationRequest {
                actor: a,
                goal: Transform2D { x: 0., y: 240. },
                floor: 0,
                speed: 64.,
                cell: 8.,
                radius: 0.,
                step: 8.,
                drop: 40.,
                work_limit: if short { 128 } else { 262144 },
                preparation_bound: 1024,
                precise_stop: false,
                crowd: None,
                preserve_credit: false,
            },
        );
        assert_eq!(pose(&e, a), initial);
        assert!(r.work <= if short { 128 } else { 262144 });
        if short {
            assert!(r.pending && scratch.has_combat_search());
        }
        if r.accepted {
            assert!(pending && frame > 1);
            assert!(e.world.is_current_entity(actor));
            return;
        }
        pending |= r.pending;
        assert!(
            r.pending,
            "frame={frame} status={} work={}",
            r.status, r.work
        );
    }
    panic!("job did not finish after a temporary short-frame deferral");
}

#[test]
fn combat_navigation_large_preparation_keeps_legacy_search_admission_under_600k() {
    use crate::spatial_scene::{CombatNavigationRequest, SpatialNavigation};
    let (mut e, _, a) = slow_search();
    let mut route = SpatialNavigation::default();
    let mut scratch = SpatialNavigation::default();
    let before = pose(&e, a);
    let r = route.advance_combat_search(
        &mut scratch,
        &mut e.spatial_scene,
        &mut e.world,
        CombatNavigationRequest {
            actor: a,
            goal: Transform2D { x: 0., y: 240. },
            floor: 0,
            speed: 64.,
            cell: 8.,
            radius: 0.,
            step: 8.,
            drop: 40.,
            work_limit: 600000,
            preparation_bound: 300000,
            precise_stop: false,
            crowd: None,
            preserve_credit: false,
        },
    );
    assert!(
        r.accepted && !r.pending && r.work > 262144 && r.work <= 600000,
        "status={} work={}",
        r.status,
        r.work
    );
    assert_eq!(pose(&e, a), before);
}
