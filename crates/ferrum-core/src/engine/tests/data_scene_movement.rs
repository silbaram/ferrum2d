use super::*;

fn scene() -> (Engine, Entity) {
    let mut engine = Engine::new();
    engine.use_data_scene();
    let actor = spawn_test_body(&mut engine.world, 10.0, 50.0, CollisionLayer::Player);
    engine.world.set_rigid_body(actor, RigidBody::kinematic());
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert!(engine.configure_data_scene_navigation(5, 5, 20.0, 20.0, 0.0, 0.0, &[1; 25]));
    (engine, actor)
}

fn move_to(engine: &mut Engine, x: f32, y: f32, speed: f32) -> bool {
    engine.move_data_scene_actor_to(x, y, speed, 0.0, u32::MAX, true)
}

fn position(engine: &Engine, actor: Entity) -> Transform2D {
    engine.world.transform(actor).unwrap()
}

#[test]
fn data_scene_move_follows_corners_and_exact_endpoint_without_overshoot() {
    let (mut engine, actor) = scene();
    assert!(engine.set_data_scene_navigation_cost(2, 2, 0));
    let wall = spawn_test_body(&mut engine.world, 50.0, 50.0, CollisionLayer::Wall);
    engine.world.set_rigid_body(wall, RigidBody::static_body());
    let mut collider = engine.world.collider(wall).unwrap();
    collider.half_width = 10.0;
    collider.half_height = 10.0;
    engine.world.set_aabb_collider(wall, collider);
    // Off-center start and target must first/last go through their cell centers.
    engine
        .world
        .set_transform(actor, Transform2D { x: 13.0, y: 53.0 });
    assert!(move_to(&mut engine, 93.0, 53.0, 1000.0));
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 2);
    assert_eq!(position(&engine, actor), Transform2D { x: 93.0, y: 53.0 });
    engine.update(1.0);
    assert_eq!(position(&engine, actor), Transform2D { x: 93.0, y: 53.0 });
    assert_eq!(engine.world.velocity(actor), Some(Velocity::default()));
}

#[test]
fn data_scene_move_spends_distance_once_with_auto_physics_and_fixed_substeps() {
    for auto_physics in [false, true] {
        for fixed in [false, true] {
            let (mut engine, actor) = scene();
            engine.auto_rigid_body_step_enabled = auto_physics;
            engine.configure_fixed_timestep(fixed, 0.1, 2.0, 20);
            engine
                .world
                .set_velocity(actor, Velocity { vx: 900.0, vy: 0.0 });
            assert!(move_to(&mut engine, 90.0, 50.0, 20.0));
            engine.update(1.0);
            let at = position(&engine, actor);
            assert!(
                (at.x - 30.0).abs() < 0.0001,
                "auto={auto_physics} fixed={fixed}: {at:?}"
            );
            assert_eq!(at.y, 50.0);
            assert_eq!(engine.data_scene_move_status(), 1);
        }
    }
}

#[test]
fn data_scene_move_rejects_invalid_requests_without_replacing_the_route() {
    let (mut engine, actor) = scene();
    assert!(engine.set_data_scene_navigation_cost(2, 2, 0));
    assert!(move_to(&mut engine, 90.0, 50.0, 1000.0));
    for (x, y, speed) in [
        (50.0, 50.0, 1.0),
        (-1.0, 0.0, 1.0),
        (90.0, 50.0, 0.0),
        (f32::NAN, 50.0, 1.0),
        (90.0, f32::INFINITY, 1.0),
    ] {
        assert!(!move_to(&mut engine, x, y, speed));
        assert_eq!(engine.data_scene_move_status(), 1);
        assert_eq!(position(&engine, actor), Transform2D { x: 10.0, y: 50.0 });
    }
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 2);
    assert_eq!(position(&engine, actor), Transform2D { x: 90.0, y: 50.0 });
}

#[test]
fn data_scene_move_respects_pause_zero_steps_complete_reset_and_manual_handoff() {
    let (mut engine, actor) = scene();
    engine.configure_fixed_timestep(true, 0.1, 1.0, 10);
    assert!(move_to(&mut engine, 90.0, 50.0, 20.0));
    engine.update(0.01);
    assert_eq!(position(&engine, actor).x, 10.0);
    assert!(engine.pause_data_scene());
    engine.update(0.5);
    assert_eq!(position(&engine, actor).x, 10.0);
    assert_eq!(engine.data_scene_move_status(), 1);
    assert!(engine.resume_data_scene());
    engine.update(0.1);
    assert_eq!(position(&engine, actor).x, 12.0);
    engine.set_input(false, false, false, true, false, false, false, 0.0, 0.0);
    engine
        .world
        .set_velocity(actor, Velocity { vx: 10.0, vy: 0.0 });
    engine.update(0.1);
    assert_eq!(engine.data_scene_move_status(), 4);
    assert_eq!(
        position(&engine, actor).x,
        13.0,
        "manual velocity must survive cancellation in the input sample"
    );
    assert!(!engine.cancel_data_scene_move());
    assert!(engine.move_data_scene_actor_to(90.0, 50.0, 20.0, 0.0, u32::MAX, false));
    engine.update(0.1);
    assert_eq!(engine.data_scene_move_status(), 1);
    assert!(engine.complete_data_scene());
    assert_eq!(engine.data_scene_move_status(), 4);
    assert!(!move_to(&mut engine, 90.0, 50.0, 20.0));
    engine.reset_game();
    assert_eq!(engine.data_scene_move_status(), 0);
}

#[test]
fn data_scene_move_replans_cost_changes_teleports_and_stops_on_missing_grid() {
    let (mut engine, actor) = scene();
    assert!(move_to(&mut engine, 90.0, 50.0, 20.0));
    engine.update(0.25);
    assert_eq!(position(&engine, actor).x, 15.0);
    assert!(engine.set_data_scene_navigation_cost(1, 2, 0));
    engine.update(1.0);
    assert!(
        position(&engine, actor).y != 50.0,
        "route must leave the blocked row"
    );
    assert!(engine.set_physics_body_position(actor.id, actor.generation, 10.0, 10.0));
    engine.update(0.1);
    assert_eq!(engine.data_scene_move_status(), 1);
    assert!(engine.set_data_scene_navigation_cost(4, 2, 0));
    let before = position(&engine, actor);
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 3);
    assert_eq!(position(&engine, actor), before);
    assert!(engine.set_data_scene_navigation_cost(4, 2, 1));
    assert!(move_to(&mut engine, 90.0, 50.0, 20.0));
    assert!(engine.clear_data_scene_navigation());
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 3);
    assert_eq!(position(&engine, actor), before);
}

#[test]
fn data_scene_move_sweeps_aabb_solids_and_obeys_height_filter_and_triggers() {
    for (trigger, other_floor, mask, should_block) in [
        (false, false, u32::MAX, true),
        (true, false, u32::MAX, false),
        (false, true, u32::MAX, false),
        (false, false, 0, false),
    ] {
        let (mut engine, actor) = scene();
        let wall = spawn_test_body_with_trigger(
            &mut engine.world,
            50.0,
            50.0,
            CollisionLayer::Wall,
            trigger,
        );
        engine.world.set_rigid_body(wall, RigidBody::static_body());
        assert!(engine.world.set_height_span_parts(actor, 1, 0.0, 1.0));
        assert!(engine.world.set_height_span_parts(
            wall,
            if other_floor { 2 } else { 1 },
            0.0,
            1.0
        ));
        assert!(engine.move_data_scene_actor_to(90.0, 50.0, 1000.0, 0.0, mask, true));
        engine.update(1.0);
        assert_eq!(
            engine.data_scene_move_status(),
            if should_block { 3 } else { 2 }
        );
        assert_eq!(
            position(&engine, actor).x,
            if should_block { 40.0 } else { 90.0 }
        );
    }
}

#[test]
fn data_scene_move_cancels_stale_actor_and_rebinding_without_touching_new_generation() {
    let (mut engine, actor) = scene();
    assert!(move_to(&mut engine, 90.0, 50.0, 20.0));
    assert!(engine.configure_data_scene_gameplay(true, actor.id, actor.generation, 0));
    assert_eq!(engine.data_scene_move_status(), 4);
    assert!(move_to(&mut engine, 90.0, 50.0, 20.0));
    engine.world.despawn(actor);
    let replacement = spawn_test_body(&mut engine.world, 10.0, 10.0, CollisionLayer::Player);
    engine
        .world
        .set_rigid_body(replacement, RigidBody::kinematic());
    assert_eq!(actor.id, replacement.id);
    assert_ne!(actor.generation, replacement.generation);
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 4);
    assert_eq!(
        position(&engine, replacement),
        Transform2D { x: 10.0, y: 10.0 }
    );
}

#[test]
fn data_scene_move_collects_on_arrival_in_the_same_simulation_step() {
    let (mut engine, actor) = scene();
    let pickup =
        spawn_test_body_with_trigger(&mut engine.world, 90.0, 50.0, CollisionLayer::Pickup, true);
    assert!(engine.set_gameplay_pickup(pickup.id, pickup.generation, 2, 3, true));
    engine.world.add_collision_reaction(
        actor,
        CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        },
    );
    assert!(move_to(&mut engine, 90.0, 50.0, 1000.0));
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 2);
    assert!(!engine.world.is_current_entity(pickup));
    assert_eq!(engine.frame_buffers.gameplay_events.len(), 1);
    assert_eq!(
        engine.frame_buffers.gameplay_events[0].kind,
        GAMEPLAY_EVENT_PICKUP_COLLECTED
    );
}

#[test]
fn data_scene_move_accumulates_sub_epsilon_and_sub_float32_distances() {
    for (origin, speed, minimum_travel) in [(0.0, 0.001, 0.0018), (100000.0, 0.1, 0.19)] {
        let (mut engine, actor) = scene();
        assert!(engine.configure_data_scene_navigation(5, 5, 20.0, 20.0, origin, 0.0, &[1; 25]));
        assert!(engine.set_physics_body_position(actor.id, actor.generation, origin + 10.0, 50.0));
        assert!(move_to(&mut engine, origin + 90.0, 50.0, speed));
        for _ in 0..120 {
            engine.update(1.0 / 60.0);
        }
        let travel = position(&engine, actor).x - (origin + 10.0);
        assert!(
            travel >= minimum_travel,
            "origin={origin}, speed={speed}, travel={travel}"
        );
        assert!((travel - 2.0 * speed).abs() < 0.01);
        assert_eq!(engine.data_scene_move_status(), 1);
    }
}

#[test]
fn data_scene_move_preserves_small_grid_corners() {
    let (mut engine, actor) = scene();
    let cell = 2.0_f32.powi(-14);
    assert!(engine.configure_data_scene_navigation(
        3,
        3,
        cell,
        cell,
        0.0,
        0.0,
        &[1, 1, 1, 1, 0, 1, 1, 1, 1]
    ));
    engine.world.set_transform(
        actor,
        Transform2D {
            x: 0.5 * cell,
            y: 1.5 * cell,
        },
    );
    let goal = Transform2D {
        x: 2.5 * cell,
        y: 1.5 * cell,
    };
    assert!(engine.move_data_scene_actor_to(goal.x, goal.y, cell, 0.0, 0, true));
    for _ in 0..20 {
        let before = position(&engine, actor);
        engine.update(1.0);
        let after = position(&engine, actor);
        for sample in 0..=20 {
            let t = sample as f32 / 20.0;
            let x = before.x + (after.x - before.x) * t;
            let y = before.y + (after.y - before.y) * t;
            assert!(
                !(x > cell && x < 2.0 * cell && y > cell && y < 2.0 * cell),
                "crossed blocked cell: {before:?} -> {after:?}"
            );
        }
    }
    assert_eq!(engine.data_scene_move_status(), 2);
    assert_eq!(position(&engine, actor), goal);
}

#[test]
fn data_scene_move_finishes_at_sweep_epsilon_rounding_boundary() {
    let (mut engine, actor) = scene();
    assert!(engine.configure_data_scene_navigation(1, 1, 1.0, 1.0, 0.0, 0.0, &[1]));
    engine.world.set_transform(actor, Transform2D::default());
    let goal = Transform2D {
        x: f32::from_bits(0x38b92f45),
        y: f32::from_bits(0x3844d8a4),
    };
    assert!(engine.move_data_scene_actor_to(goal.x, goal.y, 1.0, 0.0, 0, true));
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 2);
    assert_eq!(position(&engine, actor), goal);
}

#[test]
fn data_scene_move_does_not_round_displacement_past_a_waypoint() {
    for horizontal in [true, false] {
        for sign in [-1.0, 1.0] {
            let (mut engine, actor) = scene();
            let origin = if sign > 0.0 { 1.0 } else { -200000000.0 };
            assert!(engine.configure_data_scene_navigation(
                1,
                1,
                if horizontal { 200000000.0 } else { 1.0 },
                if horizontal { 1.0 } else { 200000000.0 },
                if horizontal { origin } else { 0.0 },
                if horizontal { 0.0 } else { origin },
                &[1]
            ));
            let start = if horizontal {
                Transform2D {
                    x: sign * 100000000.0,
                    y: 0.5,
                }
            } else {
                Transform2D {
                    x: 0.5,
                    y: sign * 100000000.0,
                }
            };
            let goal = if horizontal {
                Transform2D { x: sign, y: 0.5 }
            } else {
                Transform2D { x: 0.5, y: sign }
            };
            engine.world.set_transform(actor, start);
            assert!(engine.move_data_scene_actor_to(goal.x, goal.y, 100000000.0, 0.0, 0, true));
            engine.update(1.0);
            let at = position(&engine, actor);
            assert!(
                if horizontal {
                    at.x * sign >= 1.0
                } else {
                    at.y * sign >= 1.0
                },
                "passed waypoint: {start:?} -> {at:?}, goal={goal:?}"
            );
            engine.update(1.0);
            assert_eq!(engine.data_scene_move_status(), 2);
            assert_eq!(position(&engine, actor), goal);
        }
    }
}

#[test]
fn data_scene_move_rejects_unrepresentable_cell_centers_without_replacing_route() {
    let (mut engine, actor) = scene();
    let origin = 16777216.0;
    assert!(engine.configure_data_scene_navigation(
        3,
        2,
        2.0,
        2.0,
        origin,
        0.0,
        &[1, 1, 1, 1, 1, 0]
    ));
    engine
        .world
        .set_transform(actor, Transform2D { x: origin, y: 1.0 });
    assert!(engine.move_data_scene_actor_to(origin, 3.0, 2.0, 0.0, 0, true));
    // Goal center rounds into a blocked neighbor; intermediate center also must be checked.
    for goal in [
        Transform2D {
            x: origin + 2.0,
            y: 3.0,
        },
        Transform2D {
            x: origin + 4.0,
            y: 1.0,
        },
    ] {
        assert!(!engine.move_data_scene_actor_to(goal.x, goal.y, 2.0, 0.0, 0, true));
        assert_eq!(engine.data_scene_move_status(), 1);
    }
    engine.update(1.0);
    assert_eq!(engine.data_scene_move_status(), 2);
    assert_eq!(position(&engine, actor), Transform2D { x: origin, y: 3.0 });
}

#[test]
fn navigation_sweep_blocks_sub_epsilon_obstacles_on_both_axes() {
    for horizontal in [true, false] {
        for sign in [-1.0, 1.0] {
            let (mut engine, actor) = scene();
            engine.world.set_transform(actor, Transform2D::default());
            let wall = spawn_test_body(
                &mut engine.world,
                if horizontal { sign * 3e-5 } else { 0.0 },
                if horizontal { 0.0 } else { sign * 3e-5 },
                CollisionLayer::Wall,
            );
            for entity in [actor, wall] {
                let mut collider = engine.world.collider(entity).unwrap();
                collider.half_width = 1e-5;
                collider.half_height = 1e-5;
                engine.world.set_aabb_collider(entity, collider);
            }
            let delta = if horizontal {
                Velocity {
                    vx: sign * 2e-5,
                    vy: 1e-6,
                }
            } else {
                Velocity {
                    vx: 1e-6,
                    vy: sign * 2e-5,
                }
            };
            let result = PhysicsSystem::move_navigation_actor_with_scratch(
                &mut engine.world,
                actor,
                delta,
                CollisionMask::ALL,
                &mut crate::physics::KinematicSweepScratch::default(),
                &mut PhysicsCounters::default(),
            );
            assert_eq!(result.hit_count, 1);
            let along = if horizontal {
                result.end.x
            } else {
                result.end.y
            };
            assert!((along - sign * 1e-5).abs() < 1e-10);
        }
    }
}

#[test]
fn data_scene_move_blocked_retry_cannot_cross_a_touching_wall() {
    let (mut engine, actor) = scene();
    spawn_test_body(&mut engine.world, 50.0, 50.0, CollisionLayer::Wall);
    for _ in 0..3 {
        assert!(move_to(&mut engine, 90.0, 50.0, 1000.0));
        engine.update(1.0);
        assert_eq!(engine.data_scene_move_status(), 3);
        assert_eq!(position(&engine, actor).x, 40.0);
    }
}

#[test]
fn navigation_sweep_keeps_close_contacts_but_allows_separating_and_tangent_motion() {
    for horizontal in [true, false] {
        for sign in [-1.0, 1.0] {
            for gap in [0.0, 0.0001] {
                for (along, across, blocked) in
                    [(20.0, 0.0, true), (-20.0, 0.0, false), (0.0, 20.0, false)]
                {
                    let (mut engine, actor) = scene();
                    let wall = spawn_test_body(&mut engine.world, 50.0, 50.0, CollisionLayer::Wall);
                    let mut collider = engine.world.collider(wall).unwrap();
                    // The contact decision must use collider centers, including offsets.
                    collider.offset_x = 3.0;
                    collider.offset_y = -2.0;
                    engine.world.set_aabb_collider(wall, collider);
                    let at = if horizontal {
                        Transform2D {
                            x: 53.0 - sign * (10.0 + gap),
                            y: 48.0,
                        }
                    } else {
                        Transform2D {
                            x: 53.0,
                            y: 48.0 - sign * (10.0 + gap),
                        }
                    };
                    engine.world.set_transform(actor, at);
                    let delta = if horizontal {
                        Velocity {
                            vx: sign * along,
                            vy: across,
                        }
                    } else {
                        Velocity {
                            vx: across,
                            vy: sign * along,
                        }
                    };
                    let result = PhysicsSystem::move_navigation_actor_with_scratch(
                        &mut engine.world,
                        actor,
                        delta,
                        CollisionMask::ALL,
                        &mut crate::physics::KinematicSweepScratch::default(),
                        &mut PhysicsCounters::default(),
                    );
                    assert_eq!(
                        result.hit_count > 0,
                        blocked,
                        "horizontal={horizontal} sign={sign} gap={gap} delta={delta:?}"
                    );
                    let travelled = (result.end.x - at.x).hypot(result.end.y - at.y);
                    assert!((travelled - if blocked { gap } else { 20.0 }).abs() < 0.00001);
                }
            }
        }
    }
}

#[test]
fn data_scene_move_rejects_unsupported_actor_and_scene_without_activation() {
    let mut engine = Engine::new();
    assert!(!move_to(&mut engine, 90.0, 50.0, 20.0));
    assert_eq!(engine.data_scene_move_status(), u32::MAX);
    for mode in 0..4 {
        let (mut engine, actor) = scene();
        match mode {
            0 => {
                engine.world.set_rigid_body(actor, RigidBody::static_body());
            }
            1 => {
                let mut body = RigidBody::kinematic();
                body.enabled = false;
                engine.world.set_rigid_body(actor, body);
            }
            _ => {
                let mut collider = engine.world.collider(actor).unwrap();
                if mode == 2 {
                    collider.is_trigger = true;
                } else {
                    collider.enabled = false;
                }
                engine.world.set_aabb_collider(actor, collider);
            }
        }
        assert!(!move_to(&mut engine, 90.0, 50.0, 20.0));
        assert_eq!(engine.data_scene_move_status(), 0);
        assert_eq!(position(&engine, actor), Transform2D { x: 10.0, y: 50.0 });
    }
}
