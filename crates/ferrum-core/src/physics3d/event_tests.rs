use super::*;

fn world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap()
}

fn ball(sensor: bool) -> ColliderDesc {
    ColliderDesc {
        sensor,
        ..ColliderDesc::new(Shape::Sphere { radius: 0.5 })
    }
}

fn fixed(x: f32) -> BodyDesc {
    BodyDesc {
        kind: BodyKind::Fixed,
        pose: Pose {
            position: [x, 0.0, 0.0],
            ..Pose::default()
        },
        ..BodyDesc::default()
    }
}

#[test]
fn sensor_events_survive_queries_and_do_not_duplicate_after_refresh() {
    let mut world = world();
    let trigger = world.create_body(fixed(0.0), ball(true)).unwrap();
    let body = world.create_body(BodyDesc::default(), ball(false)).unwrap();
    let initial = world.body_state(body).unwrap();
    let ray = RayCast {
        origin: [-3.0, 0.0, 0.0],
        direction: [1.0, 0.0, 0.0],
        max_distance: 6.0,
        solid: true,
    };
    assert_eq!(
        world
            .cast_ray(&ray, &QueryFilter::default())
            .unwrap()
            .unwrap()
            .target
            .body,
        body
    );
    assert_eq!(world.body_state(body).unwrap(), initial);
    let mut events = Vec::new();
    world.drain_collision_events(&mut events);
    assert!(events.is_empty()); // Queries do not create out-of-tick collision transitions.
    world.step();
    assert_eq!(world.drain_collision_events(&mut events), 0);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].phase, CollisionPhase::Enter);
    assert!(events[0].sensor);
    assert_eq!(events[0].first.body, trigger);
    assert_eq!(events[0].second.body, body);
    assert_eq!(world.drain_collision_events(&mut events), 0);
    assert!(events.is_empty());
    for _ in 0..3 {
        world.step();
    }
    world.drain_collision_events(&mut events);
    assert!(events.is_empty());
    world
        .set_pose(
            body,
            Pose {
                position: [3.0, 0.0, 0.0],
                ..Pose::default()
            },
        )
        .unwrap();
    world.cast_ray(&ray, &QueryFilter::default()).unwrap();
    world.step();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].phase, CollisionPhase::Exit);
    assert!(!events[0].removed);
    world.set_pose(body, Pose::default()).unwrap();
    world.step();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].phase, CollisionPhase::Enter);
}

#[test]
fn removal_emits_one_exit_with_old_generations_even_after_slot_reuse() {
    let mut world = world();
    world.create_body(fixed(0.0), ball(true)).unwrap();
    let body = world.create_body(BodyDesc::default(), ball(false)).unwrap();
    let collider = world.collider_ids(body).unwrap().next().unwrap();
    let mut events = Vec::new();
    world.step();
    world.drain_collision_events(&mut events);
    world.remove_body(body).unwrap();
    let replacement = world.create_body(BodyDesc::default(), ball(false)).unwrap();
    assert_ne!(body, replacement);
    world.step();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 2, "{events:?}");
    assert_eq!(events[0].phase, CollisionPhase::Exit);
    assert!(events[0].removed);
    assert_eq!(events[0].second.body, body);
    assert_eq!(events[0].second.collider, collider);
    assert_eq!(events[1].phase, CollisionPhase::Enter);
    assert_eq!(events[1].second.body, replacement);
    world.step();
    world.drain_collision_events(&mut events);
    assert!(events.is_empty());
    world.clear();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1);
    assert!(events[0].removed);
    assert_eq!(events[0].phase, CollisionPhase::Exit);
    world.step();
    world.drain_collision_events(&mut events);
    assert!(events.is_empty());
}

#[test]
fn collider_removal_preserves_the_owner_and_other_contact_pairs() {
    let mut world = world();
    world.create_body(fixed(0.0), ball(true)).unwrap();
    let body = world.create_body(BodyDesc::default(), ball(false)).unwrap();
    let extra = world.add_collider(body, ball(false)).unwrap();
    let mut events = Vec::new();
    world.step();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 2); // Colliders sharing a body do not collide with each other.
    world.remove_collider(extra).unwrap();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].second.collider, extra);
    assert!(events[0].removed);
    assert!(world.body_state(body).is_ok());
    world.step();
    world.drain_collision_events(&mut events);
    assert!(events.is_empty());
}

#[test]
fn filter_and_sensor_edits_update_collision_transitions() {
    let mut world = world();
    let trigger = world.create_body(fixed(0.0), ball(true)).unwrap();
    let collider = world.collider_ids(trigger).unwrap().next().unwrap();
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                ..BodyDesc::default()
            },
            ball(false),
        )
        .unwrap();
    let mut events = Vec::new();
    world.step();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1);
    world
        .update_collider(
            collider,
            ColliderDesc {
                mask: 0,
                ..ball(true)
            },
        )
        .unwrap();
    world.step();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].phase, CollisionPhase::Exit);
    world.update_collider(collider, ball(false)).unwrap();
    world.step();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 1, "{events:?}");
    assert_eq!(events[0].phase, CollisionPhase::Enter);
    assert!(!events[0].sensor);
    world.update_collider(collider, ball(true)).unwrap();
    world.step();
    world.drain_collision_events(&mut events);
    assert_eq!(events.len(), 2, "{events:?}");
    assert_eq!(events[0].phase, CollisionPhase::Exit);
    assert!(!events[0].sensor);
    assert_eq!(events[1].phase, CollisionPhase::Enter);
    assert!(events[1].sensor);
}

#[test]
fn overflow_reports_losses_but_keeps_pair_lifecycle_consistent() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        max_events: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    for _ in 0..3 {
        world.create_body(fixed(0.0), ball(true)).unwrap();
    }
    let mut events = Vec::new();
    world.step();
    assert_eq!(world.drain_collision_events(&mut events), 2);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].phase, CollisionPhase::Enter);
    assert_eq!(world.drain_collision_events(&mut events), 0);
    assert!(events.is_empty());
    world.clear();
    assert_eq!(world.drain_collision_events(&mut events), 2);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].phase, CollisionPhase::Exit);
    assert!(events[0].removed);
    assert_eq!(world.drain_collision_events(&mut events), 0);
    assert!(events.is_empty());
}

#[test]
fn planar_forces_torques_and_explicit_sleep_preserve_motion_constraints() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        space: Space::PlanarXy,
        ..WorldConfig::default()
    })
    .unwrap();
    let body = world
        .create_body(
            BodyDesc::default(),
            ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            }),
        )
        .unwrap();
    world
        .add_force(body, [6.0, 0.0, 50.0], [50.0, 40.0, 1.0])
        .unwrap();
    for _ in 0..60 {
        world.step();
    }
    let state = world.body_state(body).unwrap();
    assert!((state.linear_velocity[0] - 6.0).abs() < 0.001, "{state:?}");
    assert_eq!(state.pose.position[2], 0.0);
    assert_eq!(state.angular_velocity[0], 0.0);
    assert_eq!(state.angular_velocity[1], 0.0);
    assert!(state.angular_velocity[2] > 1.0);
    world.clear_forces(body).unwrap();
    for _ in 0..30 {
        world.step();
    }
    let after = world.body_state(body).unwrap();
    assert!((after.linear_velocity[0] - state.linear_velocity[0]).abs() < 0.001);
    world.set_sleeping(body, true).unwrap();
    assert!(world.body_state(body).unwrap().sleeping);
    assert_eq!(world.body_state(body).unwrap().linear_velocity, [0.0; 3]);
    world
        .apply_torque_impulse(body, [100.0, 100.0, 1.0])
        .unwrap();
    assert!(!world.body_state(body).unwrap().sleeping);
    let after = world.body_state(body).unwrap();
    assert_eq!(after.angular_velocity[0], 0.0);
    assert_eq!(after.angular_velocity[1], 0.0);
    assert!(after.angular_velocity[2] > 1.0);
}

#[test]
fn active_pair_snapshot_is_complete_after_overflow_and_does_not_drain_transitions() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.0; 3],
        max_events: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = world.create_body(fixed(0.0), ball(true)).unwrap();
    let b = world.create_body(fixed(0.1), ball(true)).unwrap();
    world.create_body(fixed(0.2), ball(true)).unwrap();
    let mut active = Vec::new();
    world.active_collision_pairs(&mut active);
    assert!(active.is_empty());
    world.step();
    world.active_collision_pairs(&mut active);
    assert_eq!(active.len(), 3);
    assert!(active
        .iter()
        .all(|p| p.sensor && p.first.collider < p.second.collider));
    assert!(active
        .windows(2)
        .all(|w| (w[0].first.collider, w[0].second.collider)
            < (w[1].first.collider, w[1].second.collider)));
    let mut events = Vec::new();
    assert_eq!(world.drain_collision_events(&mut events), 2);
    assert_eq!(events.len(), 1);
    world.active_collision_pairs(&mut active);
    assert_eq!(active.len(), 3);
    world.remove_body(b).unwrap();
    world.active_collision_pairs(&mut active);
    assert_eq!(active.len(), 1);
    assert!(active
        .iter()
        .all(|p| p.first.body != b && p.second.body != b));
    assert_eq!(world.drain_collision_events(&mut events), 1);
    assert!(events[0].removed);
    world.remove_body(a).unwrap();
    world.active_collision_pairs(&mut active);
    assert!(active.is_empty());
}
