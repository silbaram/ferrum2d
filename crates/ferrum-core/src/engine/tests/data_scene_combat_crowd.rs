use super::{
    data_scene_combat_navigation::enemy,
    data_scene_visuals::sprite,
    spatial_navigation::{pose, setup},
    *,
};

fn configure(
    e: &mut Engine,
    actor: Entity,
    sources: &[Entity],
    stops: &[f32],
    padding: f32,
) -> bool {
    let handles: Vec<_> = sources.iter().flat_map(|a| [a.id, a.generation]).collect();
    e.configure_data_scene_gameplay_v5(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 0., 64., padding],
        &handles,
        stops,
    )
}
fn separated(e: &Engine, sources: &[Entity]) -> bool {
    sources.iter().enumerate().all(|(i, a)| {
        sources[i + 1..].iter().all(|b| {
            let pa = pose(e, *a);
            let pb = pose(e, *b);
            pa.2 != pb.2
                || (pa.3 - pb.3).abs() > 8.
                || (pa.0 - pb.0).abs() >= 3.999
                || (pa.1 - pb.1).abs() >= 3.999
        })
    })
}
#[test]
fn combat_crowd_stops_at_individual_distances_without_overshooting_and_resumes_for_moving_target() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let sources = [
        enemy(&mut e, -12., 16., true),
        enemy(&mut e, 12., 16., true),
    ];
    assert!(configure(&mut e, actor, &sources, &[8., 20.], -1.));
    for _ in 0..240 {
        e.update(1. / 60.);
    }
    for (source, stop) in sources.iter().zip([8f64, 20.]) {
        let p = pose(&e, *source);
        assert!(
            ((p.0 as f64).hypot(p.1 as f64 - 96.) - stop).abs() < 0.001,
            "{p:?} stats={:?} crowd={:?}",
            e.data_scene_combat_navigation_stats(),
            e.data_scene_combat_crowd_stats()
        );
    }
    assert_eq!(e.data_scene_combat_crowd_stats()[2], 2);
    let before = pose(&e, sources[0]);
    e.world.set_transform(actor, Transform2D { x: 0., y: 108. });
    for _ in 0..120 {
        e.update(1. / 60.);
    }
    assert!(pose(&e, sources[0]).1 > before.1 + 8.);
}
#[test]
fn combat_crowd_eight_agents_converge_without_new_overlaps() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let sources: Vec<_> = (0..8)
        .map(|i| enemy(&mut e, i as f32 * 4. - 14., 16., true))
        .collect();
    assert!(configure(&mut e, actor, &sources, &[12.; 8], 0.));
    for _ in 0..900 {
        e.update(1. / 60.);
        assert!(
            separated(&e, &sources),
            "{:?}",
            sources.iter().map(|a| pose(&e, *a)).collect::<Vec<_>>()
        );
        assert!(e.data_scene_combat_navigation_stats()[9] <= 1_000_000);
    }
    assert!(
        sources.iter().all(|a| pose(&e, *a).1 > 72.),
        "poses={:?} stats={:?}",
        sources.iter().map(|a| pose(&e, *a)).collect::<Vec<_>>(),
        e.data_scene_combat_navigation_stats()
    );
    let stats = e.data_scene_combat_crowd_stats();
    assert!(stats[4] > 0 && stats[1] == 1, "{stats:?}");
}
#[test]
fn combat_crowd_head_on_traffic_passes_with_native_sweeps() {
    let (mut e, actor) = setup(false);
    let a = enemy(&mut e, -12., 56., true);
    let b = enemy(&mut e, 12., 56., true);
    let left = sprite(&mut e, 73, -12., 56., 0);
    let right = sprite(&mut e, 74, 12., 56., 0);
    for t in [left, right] {
        e.world
            .set_height_span(t, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
    }
    assert!(e.set_gameplay_movement_chase_entity(
        a.id,
        a.generation,
        right.id,
        right.generation,
        32.
    ));
    assert!(e.set_gameplay_movement_chase_entity(
        b.id,
        b.generation,
        left.id,
        left.generation,
        32.
    ));
    assert!(configure(&mut e, actor, &[a, b], &[0., 0.], 0.));
    let mut steered = false;
    for _ in 0..480 {
        e.update(1. / 60.);
        assert!(separated(&e, &[a, b]));
        steered |= e.data_scene_combat_crowd_stats()[6] > 0;
    }
    assert!(
        (pose(&e, a).0 - 12.).abs() < 0.01 && (pose(&e, b).0 + 12.).abs() < 0.01,
        "{:?} {:?}",
        pose(&e, a),
        pose(&e, b)
    );
    assert!(steered);
}
#[test]
fn combat_crowd_overlapping_spawn_separates_without_teleport_and_ignores_other_heights() {
    for other_height in [false, true] {
        let (mut e, actor) = setup(false);
        e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
        let a = enemy(&mut e, 0., 16., true);
        let b = enemy(&mut e, 0., 16., true);
        if other_height {
            e.world
                .set_height_span(b, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
        }
        assert!(configure(&mut e, actor, &[a, b], &[12., 12.], 0.));
        let before = pose(&e, a);
        e.update(1. / 60.);
        let after = pose(&e, a);
        assert!((after.0 - before.0).hypot(after.1 - before.1) <= 64. / 60. + 0.001);

        for _ in 0..120 {
            e.update(1. / 60.);
        }
        if !other_height {
            assert!(separated(&e, &[a, b]));
        }
    }
}
#[test]
fn combat_crowd_follows_ramp_before_applying_stop_radius_and_pause_freezes_it() {
    let (mut e, actor) = setup(true);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
    let a = enemy(&mut e, 0., 16., true);
    assert!(configure(&mut e, actor, &[a], &[12.], 0.));
    for _ in 0..180 {
        e.update(1. / 60.);
    }
    let p = pose(&e, a);
    assert_eq!(p.2, 1);
    assert_eq!(p.3, 32.);
    assert!((p.0.hypot(p.1 - 80.) - 12.).abs() < 0.001, "{p:?}");
    assert!(e.pause_data_scene());
    e.update(5.);
    assert_eq!(pose(&e, a), p);
}
#[test]
fn combat_crowd_configuration_rejects_invalid_bindings_atomically_and_v4_clears_them() {
    let (mut e, actor) = setup(false);
    let a = enemy(&mut e, 0., 16., true);
    assert!(configure(&mut e, actor, &[a], &[12.], 1.));
    let before = e.data_scene_combat_crowd_stats();
    for padding in [-2., f32::INFINITY, 4097.] {
        assert!(!configure(&mut e, actor, &[a], &[12.], padding));
        assert_eq!(e.data_scene_combat_crowd_stats(), before);
    }
    assert!(!configure(&mut e, actor, &[a, a], &[12., 20.], 1.));
    assert!(!configure(&mut e, actor, &[actor], &[12.], 1.));
    assert!(!configure(&mut e, actor, &[a], &[-1.], 1.));
    assert!(e.configure_data_scene_gameplay_v4(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 0., 1.]
    ));
    assert_eq!(e.data_scene_combat_crowd_stats(), vec![1, 0, 0, 0, 0, 0, 0]);
}

#[test]
fn combat_crowd_sidestep_cannot_cut_through_wall_and_filters_can_exclude_peers() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let sources = [enemy(&mut e, -6., 16., true), enemy(&mut e, 6., 16., true)];
    let wall = sprite(&mut e, 76, 0., 56., 0);
    e.world.set_aabb_collider(
        wall,
        AabbCollider::new(18., 4., false, CollisionLayer::Wall),
    );
    e.world
        .set_collision_filter(wall, CollisionFilter::from_layer(CollisionLayer::Wall));
    e.world
        .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
    assert!(configure(&mut e, actor, &sources, &[12., 12.], 0.));
    for _ in 0..600 {
        e.update(1. / 60.);
        for source in sources {
            let p = pose(&e, source);
            assert!(p.0.abs() >= 19.999 || (p.1 - 56.).abs() >= 5.999, "{p:?}");
        }
        assert!(separated(&e, &sources));
    }
    assert!(sources.iter().all(|a| pose(&e, *a).1 > 70.));
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let sources = [enemy(&mut e, 0., 16., true), enemy(&mut e, 0., 16., true)];
    e.world.set_collision_filter(
        sources[1],
        CollisionFilter::new(CollisionMask::ENEMY, CollisionMask::WALL),
    );
    assert!(configure(&mut e, actor, &sources, &[12., 12.], 0.));
    for _ in 0..180 {
        e.update(1. / 60.);
    }
    assert_eq!(pose(&e, sources[0]), pose(&e, sources[1]));
    assert_eq!(e.data_scene_combat_crowd_stats()[6], 0);
}

#[test]
fn combat_crowd_64_agents_share_probe_and_neighbor_budget_across_fixed_substeps() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let sources: Vec<_> = (0..64).map(|_| enemy(&mut e, 0., 16., true)).collect();
    assert!(configure(&mut e, actor, &sources, &[12.; 64], 0.));
    e.configure_fixed_timestep(true, 1. / 120., 1., 16);
    for _ in 0..80 {
        e.update(0.1);
        let nav = e.data_scene_combat_navigation_stats();
        let crowd = e.data_scene_combat_crowd_stats();
        assert!(nav[8] <= 1 && nav[9] <= 1_000_000, "{nav:?}");
        assert!(crowd[5] <= 125_000 && crowd[6] <= 64 * 8 * 16, "{crowd:?}");
        for source in &sources {
            let v = e.world.velocity(*source).unwrap();
            assert!(v.vx.is_finite() && v.vy.is_finite());
        }
    }
    assert!(e.data_scene_combat_crowd_stats()[4] > 0);
}

#[test]
fn combat_crowd_ramp_cannot_treat_a_new_height_intersection_as_existing_overlap() {
    let (mut e, actor) = setup(true);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 1.).unwrap());
    let a = enemy(&mut e, 1., 32., true);
    let b = enemy(&mut e, 0., 32., true);
    e.world
        .set_height_span(a, HeightSpan::new(PhysicsFloorId(0), 0., 1.).unwrap());
    e.world
        .set_height_span(b, HeightSpan::new(PhysicsFloorId(0), 3., 1.).unwrap());
    assert!(configure(&mut e, actor, &[a, b], &[0., 0.], 0.));
    for _ in 0..120 {
        e.update(1. / 60.);
        let pa = pose(&e, a);
        let pb = pose(&e, b);
        if e.world
            .height_span(a)
            .unwrap()
            .overlaps(e.world.height_span(b).unwrap())
        {
            assert!(
                (pa.0 - pb.0).abs() >= 3.999 || (pa.1 - pb.1).abs() >= 3.999,
                "{pa:?} {pb:?}"
            );
        }
    }
}

#[test]
fn combat_crowd_mixed_stop_radii_clear_shared_bridge_waypoints() {
    for (speed, reversed, variable) in [
        (64., false, false),
        (192., false, false),
        (192., true, false),
        (192., true, true),
    ] {
        let (mut e, actor) = setup(true);
        e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
        let mut sources: Vec<_> = (0..8)
            .map(|i| {
                let i = if reversed { 7 - i } else { i };
                enemy(&mut e, i as f32 * 5. - 17.5, 16., true)
            })
            .collect();
        if reversed {
            sources.reverse();
        }
        for source in &sources {
            assert!(e.set_gameplay_movement_chase_primary_actor(
                source.id,
                source.generation,
                speed
            ));
        }
        let stops = [8., 8., 8., 8., 16., 16., 16., 16.];
        assert!(configure(&mut e, actor, &sources, &stops, 0.25));
        e.configure_fixed_timestep(true, 1. / 120., 1., 8);
        for floor in [1, 0] {
            e.world.set_height_span(
                actor,
                HeightSpan::new(PhysicsFloorId(floor), if floor == 1 { 32. } else { 0. }, 8.)
                    .unwrap(),
            );
            let arrived = |engine: &Engine| {
                sources.iter().zip(stops).all(|(source, stop)| {
                    let p = pose(engine, *source);
                    p.2 == floor && (p.0 as f64).hypot(p.1 as f64 - 80.) <= f64::from(stop) + 0.001
                })
            };
            for frame in 0..2400 {
                e.update(if variable {
                    [1. / 144., 1. / 45., 1. / 90., 1. / 60.][frame % 4]
                } else {
                    1. / 60.
                });
                assert!(separated(&e, &sources));
                if arrived(&e) {
                    break;
                }
            }
            assert!(
                arrived(&e),
                "speed={speed} floor={floor} poses={:?} stats={:?} nav={:?}",
                sources.iter().map(|s| pose(&e, *s)).collect::<Vec<_>>(),
                e.data_scene_combat_crowd_stats(),
                e.data_scene_combat_navigation_stats()
            );
        }
    }
}

#[test]
fn combat_crowd_shortcuts_preserve_required_wall_corners() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 24., y: 40. });
    let source = enemy(&mut e, 0., 16., true);
    let wall = sprite(&mut e, 76, 12., 24., 0);
    e.world
        .set_aabb_collider(wall, AabbCollider::new(8., 6., false, CollisionLayer::Wall));
    e.world
        .set_collision_filter(wall, CollisionFilter::from_layer(CollisionLayer::Wall));
    e.world
        .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
    assert!(configure(&mut e, actor, &[source], &[0.], 0.25));
    for _ in 0..600 {
        e.update(1. / 60.);
        let p = pose(&e, source);
        assert!(
            (p.0 - 12.).abs() >= 9.999 || (p.1 - 24.).abs() >= 7.999,
            "{p:?}"
        );
    }
    let p = pose(&e, source);
    assert!(
        (p.0 - 24.).hypot(p.1 - 40.) < 0.01,
        "{p:?} stats={:?}",
        e.data_scene_combat_navigation_stats()
    );
}

#[test]
fn combat_crowd_sub_ulp_overlap_accumulates_representable_motion() {
    let (mut e, actor) = setup(false);
    assert!(e.configure_spatial_terrain(
        &[1020., 0., 64., 64., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    e.world
        .set_transform(actor, Transform2D { x: 1040., y: 16. });
    let sources = [
        enemy(&mut e, 1024., 16., true),
        enemy(&mut e, 1024., 16., true),
    ];
    for source in sources {
        assert!(e.set_gameplay_movement_chase_primary_actor(source.id, source.generation, 0.001));
    }
    assert!(configure(&mut e, actor, &sources, &[0., 0.], 0.));
    for _ in 0..1000 {
        e.update(1. / 60.);
    }
    assert!(
        sources
            .iter()
            .any(|source| (pose(&e, *source).0 - 1024.).abs() > 0.001),
        "{:?}",
        sources.iter().map(|s| pose(&e, *s)).collect::<Vec<_>>()
    );
}

#[test]
fn combat_crowd_lookahead_does_not_veto_gateway_for_peer_below_bridge() {
    let (mut e, actor) = setup(true);
    let surface = |y: f32, depth: f32, elevation: f32| {
        [
            -28., y, 64., depth, 0., elevation, elevation, 1., 1., 1., 1.,
        ]
    };
    assert!(e.configure_spatial_terrain(
        &[
            surface(0., 64., 0.),
            surface(64., 48., 32.),
            surface(64., 48., 0.)
        ]
        .concat(),
        &[1, 0, 16777215, 1, 2, 1, 16777215, 9, 3, 0, 16777215, 1]
    ));
    assert!(e.spatial_scene.configure_connections(&[1, 2]));
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
    let a = enemy(&mut e, 0., 60., true);
    let b = enemy(&mut e, 0., 70., true);
    let marker = sprite(&mut e, 78, 0., 70., 0);
    e.world
        .set_height_span(marker, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
    assert!(e.set_gameplay_movement_chase_entity(
        b.id,
        b.generation,
        marker.id,
        marker.generation,
        64.
    ));
    for x in [-4., 4.] {
        let wall = sprite(&mut e, 79, x, 64., 0);
        e.world.set_aabb_collider(
            wall,
            AabbCollider::new(1., 20., false, CollisionLayer::Wall),
        );
        e.world
            .set_collision_filter(wall, CollisionFilter::from_layer(CollisionLayer::Wall));
    }
    assert!(e.configure_data_scene_gameplay_v5(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 40., 40., 0.5, 0., 64., 0.],
        &[a.id, a.generation, b.id, b.generation],
        &[8., 0.]
    ));
    for _ in 0..300 {
        e.update(1. / 60.);
    }
    let p = pose(&e, a);
    assert!(
        p.2 == 1 && p.3 == 32. && p.1 >= 71.999,
        "{p:?} nav={:?}",
        e.data_scene_combat_navigation_stats()
    );
    assert_eq!(pose(&e, b), (0., 70., 0, 0.));
}

#[test]
fn combat_crowd_enters_stop_ring_through_sparse_peer_corners() {
    let (mut e, actor) = setup(true);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    let positions = [
        (18.91, 85.02),
        (1.68, 87.82),
        (4.97, 73.98),
        (7.8, 81.78),
        (13.87, 86.97),
        (10.42, 91.78),
        (15.65, 76.67),
        (10.31, 67.76),
    ];
    let sources: Vec<_> = positions
        .into_iter()
        .map(|(x, y)| enemy(&mut e, x, y, true))
        .collect();
    let stops = [8., 8., 8., 8., 16., 16., 16., 16.];
    assert!(configure(&mut e, actor, &sources, &stops, 0.25));
    for _ in 0..1200 {
        e.update(1. / 60.);
        assert!(separated(&e, &sources));
    }
    for (source, stop) in sources.iter().zip(stops) {
        let p = pose(&e, *source);
        assert!(
            p.2 == 0 && p.0.hypot(p.1 - 80.) <= stop + 0.001,
            "poses={:?} nav={:?}",
            sources.iter().map(|s| pose(&e, *s)).collect::<Vec<_>>(),
            e.data_scene_combat_navigation_stats()
        );
    }
}

#[test]
fn combat_crowd_route_crosses_actual_shared_edge_at_raised_terrain_corner() {
    let (mut e, actor) = setup(true);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    let source = enemy(&mut e, 32.33, 62.8, true);
    assert!(configure(&mut e, actor, &[source], &[8.], 0.25));
    for _ in 0..600 {
        e.update(1. / 60.);
    }
    let p = pose(&e, source);
    assert!(
        p.2 == 0 && p.3 == 0. && p.0.hypot(p.1 - 80.) <= 8.001,
        "{p:?} nav={:?}",
        e.data_scene_combat_navigation_stats()
    );
}

#[test]
fn combat_crowd_can_stop_at_radius_when_goal_center_is_inside_wall() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let source = enemy(&mut e, 0., 16., true);
    let wall = sprite(&mut e, 76, 0., 96., 0);
    e.world
        .set_aabb_collider(wall, AabbCollider::new(4., 4., false, CollisionLayer::Wall));
    e.world
        .set_collision_filter(wall, CollisionFilter::from_layer(CollisionLayer::Wall));
    e.world
        .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
    assert!(configure(&mut e, actor, &[source], &[12.], 0.25));
    for _ in 0..600 {
        e.update(1. / 60.);
    }
    let p = pose(&e, source);
    assert!(
        (p.0.hypot(p.1 - 96.) - 12.).abs() < 0.001,
        "{p:?} nav={:?} crowd={:?}",
        e.data_scene_combat_navigation_stats(),
        e.data_scene_combat_crowd_stats()
    );
}

#[test]
fn combat_crowd_large_coordinate_never_arrives_outside_representable_stop_radius() {
    let (mut e, actor) = setup(false);
    assert!(e.configure_spatial_terrain(
        &[16_777_200., 0., 64., 64., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    e.world.set_transform(
        actor,
        Transform2D {
            x: 16_777_216.,
            y: 16.,
        },
    );
    let source = enemy(&mut e, 16_777_218., 16., true);
    assert!(e.set_gameplay_movement_chase_primary_actor(source.id, source.generation, 0.25));
    assert!(configure(&mut e, actor, &[source], &[1.25], 0.));
    for _ in 0..100 {
        e.update(1. / 60.);
        assert_eq!(e.data_scene_combat_crowd_stats()[2], 0);
    }
    for _ in 0..600 {
        e.update(1. / 60.);
    }
    let p = pose(&e, source);
    assert!((f64::from(p.0) - 16_777_216.).abs() <= 1.25, "{p:?}");
    assert_eq!(e.data_scene_combat_crowd_stats()[2], 1);
}

#[test]
fn combat_crowd_split_move_replays_requested_segment_without_peer_penetration() {
    let (mut e, actor) = setup(false);
    assert!(e.configure_spatial_terrain(
        &[-64., 12., 128., 8., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 16777215, 1]
    ));
    e.world.set_transform(
        actor,
        Transform2D {
            x: -31.119_001,
            y: 16.,
        },
    );
    let source = enemy(&mut e, -35.61, 16., true);
    let peer = enemy(&mut e, -27.118_998, 16., true);
    assert!(e.set_gameplay_movement_chase_primary_actor(source.id, source.generation, 269.46));
    assert!(configure(&mut e, actor, &[source, peer], &[0., 5.], 0.));
    e.update(1. / 60.);
    let p = pose(&e, source);
    let other = pose(&e, peer);
    assert!(f64::from(other.0) - f64::from(p.0) >= 4., "{p:?} {other:?}");
    assert!(
        p.0 > -31.61,
        "source did not make the validated move: {p:?}"
    );
}

#[test]
fn combat_crowd_bridge_entrance_can_retreat_around_resting_peers_at_support_boundary() {
    let (mut e, actor) = setup(true);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    e.world
        .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
    let positions = [
        (-4.7141256, 65.35631),
        (-1.277794, 72.10271),
        (7.0426054, 76.20505),
        (-7.0716066, 76.25936),
        (-9.38527, 67.04173),
        (0., 64.0008),
        (11.228312, 68.60154),
        (6.4927077, 65.37657),
    ];
    let sources: Vec<_> = positions
        .iter()
        .map(|&(x, y)| {
            let a = enemy(&mut e, x, y, true);
            e.world
                .set_height_span(a, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
            a
        })
        .collect();
    assert!(configure(
        &mut e,
        actor,
        &sources,
        &[8., 8., 8., 8., 16., 16., 16., 16.],
        0.25
    ));
    for _ in 0..1200 {
        e.update(1. / 120.);
        assert!(separated(&e, &sources));
        for (i, &a) in sources.iter().enumerate() {
            for &b in &sources[i + 1..] {
                let pa = pose(&e, a);
                let pb = pose(&e, b);
                assert!(
                    pa.2 != pb.2 || (pa.0 - pb.0).abs() >= 4.249 || (pa.1 - pb.1).abs() >= 4.249
                );
            }
        }
        let nav = e.data_scene_combat_navigation_stats();
        assert!(nav[8] <= 1 && nav[9] <= 1_000_000);

        if e.data_scene_combat_crowd_stats()[2] == 8 {
            return;
        }
    }
    panic!(
        "support boundary trapped follower: {:?} {:?}",
        sources.iter().map(|&a| pose(&e, a)).collect::<Vec<_>>(),
        e.data_scene_combat_navigation_stats()
    );
}
