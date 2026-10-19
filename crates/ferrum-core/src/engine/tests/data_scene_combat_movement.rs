use super::{
    data_scene_combat_navigation::enemy,
    spatial_navigation::{pose, setup},
    *,
};
fn configure(e: &mut Engine, actor: Entity, agents: f32) -> bool {
    e.configure_data_scene_gameplay_v6(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 4., agents, -1.],
        &[],
        &[],
        1,
    )
}
#[test]
fn combat_movement_acceleration_uses_authored_step_drop_and_bridge_gateway_both_ways() {
    let (mut e, actor) = setup(true);
    let a = enemy(&mut e, 0., 16., true);
    assert!(e.set_gameplay_movement_accelerate(a.id, a.generation, 0., 2., 64.));
    assert!(configure(&mut e, actor, 1.));
    for _ in 0..240 {
        e.update(1. / 120.);
        let n = e.data_scene_combat_navigation_stats();
        assert!(n[8] <= 1 && n[9] <= 1_000_000);
        if pose(&e, a).1 >= 80. {
            break;
        }
    }
    let p = pose(&e, a);
    assert!(p.1 >= 80. && p.2 == 1 && p.3 == 32., "{p:?}");
    e.world.set_velocity(a, Velocity::default());
    assert!(e.set_gameplay_movement_accelerate(a.id, a.generation, 0., -2., 64.));
    for _ in 0..240 {
        e.update(1. / 120.);
        if pose(&e, a).1 <= 16. {
            break;
        }
    }
    let p = pose(&e, a);
    assert!(p.1 <= 16. && p.2 == 0 && p.3 == 0., "{p:?}");
}
#[test]
fn combat_movement_v6_is_atomic_and_legacy_configuration_disables_extra_ownership() {
    let (mut e, actor) = setup(false);
    let a = enemy(&mut e, 0., 16., true);
    assert!(e.set_gameplay_movement_accelerate(a.id, a.generation, 0., 1., 64.));
    assert!(configure(&mut e, actor, 1.));
    e.update(1. / 60.);
    assert_eq!(e.data_scene_combat_navigation_stats()[2], 1);
    let stats = e.data_scene_combat_navigation_stats();
    assert!(!e.configure_data_scene_gameplay_v6(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 4., 1., -1.],
        &[],
        &[],
        2
    ));
    assert_eq!(e.data_scene_combat_navigation_stats(), stats);
    e.world.set_rigid_body(a, RigidBody::static_body());
    assert!(!configure(&mut e, actor, 1.));
    assert_eq!(e.data_scene_combat_navigation_stats(), stats);
    e.world.set_rigid_body(a, RigidBody::kinematic());
    assert!(e.configure_data_scene_gameplay_v4(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 4., 1.]
    ));
    e.update(1. / 60.);
    assert_eq!(e.data_scene_combat_navigation_stats()[2], 0);
}

#[test]
fn combat_movement_acceleration_yields_to_resting_peers_and_pause_keeps_velocity() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
    let front = enemy(&mut e, 0., 72., true);
    let rear = enemy(&mut e, 0., 16., true);
    assert!(e.set_gameplay_movement_accelerate(rear.id, rear.generation, 0., 2., 64.));
    assert!(e.configure_data_scene_gameplay_v6(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 8., 2., 0.25],
        &[front.id, front.generation],
        &[8.],
        1
    ));
    for _ in 0..600 {
        e.update(1. / 120.);
        assert!(pose(&e, front).1 - pose(&e, rear).1 >= 4.249);
        assert!(e.data_scene_combat_navigation_stats()[9] <= 1_000_000);
    }
    assert!(pose(&e, rear).1 > 60. && pose(&e, rear).1 <= 67.751);
    assert!(e.data_scene_combat_crowd_stats()[3] > 0);
    assert!(e.pause_data_scene());
    let before = pose(&e, rear);
    let velocity = e.world.velocity(rear);
    e.update(10.);
    assert_eq!(pose(&e, rear), before);
    assert_eq!(e.world.velocity(rear), velocity);
    assert!(e.resume_data_scene());
    e.update(1. / 120.);
    assert!(pose(&e, front).1 - pose(&e, rear).1 >= 4.249);
}
#[test]
fn combat_movement_acceleration_64_sources_share_outer_budget_across_fixed_steps() {
    let (mut e, actor) = setup(false);
    let sources: Vec<_> = (0..64)
        .map(|_| {
            let a = enemy(&mut e, 0., 16., true);
            assert!(e.set_gameplay_movement_accelerate(a.id, a.generation, 0., 1., 32.));
            e.world.set_velocity(a, Velocity { vx: 0., vy: 10. });
            a
        })
        .collect();
    assert!(configure(&mut e, actor, 64.));
    e.configure_fixed_timestep(true, 1. / 120., 1., 8);
    for _ in 0..160 {
        e.update(1. / 30.);
        let stats = e.data_scene_combat_navigation_stats();
        assert!(stats[8] <= 1 && stats[9] <= 1_000_000, "{stats:?}");
        assert!(
            sources.iter().all(|&a| e
                .world
                .velocity(a)
                .is_some_and(|v| v.vy >= 10. && v.vy <= 32.)),
            "deferred acceleration lost momentum"
        );
    }
    assert!(sources.iter().all(|&a| pose(&e, a).1 > 16.));
    assert!(sources.iter().all(|&a| e
        .world
        .velocity(a)
        .is_some_and(|v| v.vy.is_finite() && (0. ..=32.).contains(&v.vy))));
}

#[test]
fn combat_movement_v6_validates_sources_against_the_new_primary_actor() {
    let (mut e, old) = setup(false);
    let next = enemy(&mut e, 8., 16., true);
    assert!(e.set_gameplay_movement_accelerate(old.id, old.generation, 0., 1., 32.));
    assert!(configure(&mut e, next, 1.));
    assert_eq!(e.world.primary_actor_entity(), Some(next));
    e.update(1. / 60.);
    assert!(pose(&e, old).1 > 16.);
    assert_eq!(e.data_scene_combat_navigation_stats()[2], 1);
}

#[test]
fn combat_movement_seek_preserves_turn_response_and_zero_turn_stays_at_rest() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let a = enemy(&mut e, 0., 16., true);
    assert!(e.set_gameplay_movement_seek_target_primary_actor(a.id, a.generation, 64., 0.25));
    e.world.set_velocity(a, Velocity { vx: 64., vy: 0. });
    assert!(configure(&mut e, actor, 1.));
    e.update(1. / 60.);
    let p = pose(&e, a);
    assert!(
        (p.0 - 0.8).abs() < 0.001 && (p.1 - 16. - 16. / 60.).abs() < 0.001,
        "{p:?}"
    );
    assert!(e.set_gameplay_movement_seek_target_primary_actor(a.id, a.generation, 64., 0.));
    e.world.set_velocity(a, Velocity::default());
    let before = pose(&e, a);
    for _ in 0..120 {
        e.update(1. / 60.);
    }
    assert_eq!(pose(&e, a), before);
}
#[test]
fn combat_movement_seek_follows_ramp_and_cross_floor_detour_with_gradual_turning() {
    for rate in [1., 0.15] {
        let (mut e, actor) = setup(true);
        e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
        e.world
            .set_height_span(actor, HeightSpan::new(PhysicsFloorId(1), 32., 8.).unwrap());
        let a = enemy(&mut e, -8., 16., true);
        assert!(e.set_gameplay_movement_seek_target_primary_actor(a.id, a.generation, 64., rate));
        assert!(configure(&mut e, actor, 1.));
        for goal_floor in [1, 0] {
            if goal_floor == 0 {
                e.world
                    .set_height_span(actor, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
            }
            let mut arrived = false;
            for _ in 0..1800 {
                e.update(1. / 120.);
                let p = pose(&e, a);
                let n = e.data_scene_combat_navigation_stats();
                assert!(n[8] <= 1 && n[9] <= 1_000_000);
                if p.2 == goal_floor && (p.0 as f64).hypot(p.1 as f64 - 80.) <= 4. {
                    arrived = true;
                    break;
                }
            }
            assert!(
                arrived,
                "rate={rate} floor={goal_floor} pose={:?} nav={:?}",
                pose(&e, a),
                e.data_scene_combat_navigation_stats()
            );
        }
    }
}

#[test]
fn combat_movement_seek_can_reverse_through_exact_zero_interpolated_velocity() {
    let (mut e, actor) = setup(false);
    e.world
        .set_transform(actor, Transform2D { x: -16., y: 16. });
    let a = enemy(&mut e, 0., 16., true);
    e.world.set_velocity(a, Velocity { vx: 64., vy: 0. });
    assert!(e.set_gameplay_movement_seek_target_primary_actor(a.id, a.generation, 64., 0.5));
    assert!(configure(&mut e, actor, 1.));
    e.update(1. / 60.);
    assert_eq!(pose(&e, a).0, 0.);
    assert_eq!(e.world.velocity(a), Some(Velocity::default()));
    e.update(1. / 60.);
    assert!(pose(&e, a).0 < 0.);
}

#[test]
fn combat_movement_seek_turns_away_from_a_wall_without_losing_steering_intent() {
    let (mut e, actor) = setup(false);
    e.world.set_transform(actor, Transform2D { x: 0., y: 96. });
    let wall = super::data_scene_visuals::sprite(&mut e, 73, 0., 48., 0);
    e.world.set_aabb_collider(
        wall,
        AabbCollider::new(12., 8., false, CollisionLayer::Wall),
    );
    e.world
        .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 0., 8.).unwrap());
    e.world
        .set_collision_filter(wall, CollisionFilter::from_layer(CollisionLayer::Wall));
    let a = enemy(&mut e, -14.01, 48., true);
    e.world.set_velocity(a, Velocity { vx: 64., vy: 0. });
    assert!(e.set_gameplay_movement_seek_target_primary_actor(a.id, a.generation, 64., 0.15));
    assert!(configure(&mut e, actor, 1.));
    for _ in 0..1800 {
        e.update(1. / 120.);
        let p = pose(&e, a);
        assert!(p.0.abs() >= 13.999 || (p.1 - 48.).abs() >= 9.999, "{p:?}");
        if f64::from(p.0).hypot(f64::from(p.1) - 96.) <= 4. {
            return;
        }
    }
    panic!("wall-turn stalled: {:?}", pose(&e, a));
}

#[test]
fn combat_movement_seek_stops_at_first_circle_entry_when_both_segment_ends_are_outside() {
    let (mut e, actor) = setup(false);
    let goal = Transform2D { x: 0., y: 16. };
    e.world.set_transform(actor, goal);
    let a = enemy(&mut e, -0.5, 16.9, true);
    let from = e.world.transform(a).unwrap();
    let distance = f64::from(from.x).hypot(f64::from(from.y) - 16.);
    let braking_speed = ((distance - 1.) / f64::from(1_f32 / 30.) * 0.5) as f32;
    let desired = crate::gameplay::velocity_toward(from, goal, braking_speed);
    e.world.set_velocity(
        a,
        Velocity {
            vx: 64.,
            vy: -desired.vy,
        },
    );
    assert!(e.set_gameplay_movement_seek_target_primary_actor(a.id, a.generation, 64., 0.5));
    assert!(e.configure_data_scene_gameplay_v6(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[8., 8., 40., 0.5, 1., 1., -1.],
        &[],
        &[],
        1
    ));
    e.update(1. / 30.);
    let p = pose(&e, a);
    assert!(
        p.0 > -0.5 && p.0 < 0. && (p.1 - 16.9).abs() < 0.0001,
        "{p:?}"
    );
    assert!(f64::from(p.0).hypot(f64::from(p.1) - 16.) <= 1., "{p:?}");
    let arrived = pose(&e, a);
    for _ in 0..30 {
        e.update(1. / 60.);
    }
    assert_eq!(pose(&e, a), arrived);
}

#[test]
fn combat_movement_seek_reaches_zero_arrival_radius_at_representable_goal() {
    for (rate, padding) in [0.15, 0.5, 1.]
        .into_iter()
        .flat_map(|r| [(r, -1.), (r, 0.25)])
    {
        let (mut e, actor) = setup(false);
        e.world.set_transform(actor, Transform2D { x: 0., y: 80. });
        let a = enemy(&mut e, -8., 16., true);
        assert!(e.set_gameplay_movement_seek_target_primary_actor(a.id, a.generation, 64., rate));
        assert!(e.configure_data_scene_gameplay_v6(
            true,
            actor.id,
            actor.generation,
            0,
            true,
            &[],
            &[],
            &[],
            &[8., 8., 40., 0.5, 0., 1., padding],
            &[],
            &[],
            1
        ));
        for _ in 0..3600 {
            e.update(1. / 120.);
            if pose(&e, a).0 == 0. && pose(&e, a).1 == 80. {
                break;
            }
        }
        assert_eq!((pose(&e, a).0, pose(&e, a).1), (0., 80.), "rate={rate}");
    }
}
