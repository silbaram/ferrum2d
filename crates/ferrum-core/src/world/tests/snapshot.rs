use super::*;

#[test]
fn world_snapshot_restores_physics_state_and_storage_generations() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let joint = world.add_distance_joint(DistanceJoint::new(a, b, 12.0).with_damping(0.25));

    world.set_transform(a, Transform2D { x: 2.0, y: 3.0 });
    world.set_transform(b, Transform2D { x: 8.0, y: 13.0 });
    world.set_velocity(a, Velocity { vx: 1.0, vy: -2.0 });
    world.set_aabb_collider(
        a,
        AabbCollider::new(4.0, 5.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(a, RigidBody::dynamic(3.0));
    world.apply_force(a, Velocity { vx: 10.0, vy: -4.0 });
    world.apply_impulse(a, Velocity { vx: 2.0, vy: 6.0 });
    world.apply_torque(a, 7.0);
    world.apply_angular_impulse(a, 3.0);
    let body = world.rigid_bodies[a.id as usize].as_mut().unwrap();
    body.sleep_timer_seconds = 0.5;
    body.is_sleeping = true;
    world.rigid_contact_impulses.push(RigidContactImpulse {
        entity_a: a,
        entity_b: b,
        point_x: 4.0,
        point_y: 5.0,
        normal_x: 0.0,
        normal_y: 1.0,
        normal_impulse: 0.75,
        tangent_impulse: 0.25,
    });

    let expected_body = world.rigid_body(a).unwrap();
    let snapshot = world.snapshot();

    let extra = world.spawn_entity();
    world.set_transform(b, Transform2D { x: 99.0, y: 100.0 });
    world.clear_distance_joint(joint);
    world.rigid_contact_impulses.clear();
    world.despawn(a);

    assert_ne!(world.rigid_body(a), Some(expected_body));

    world.restore_snapshot(&snapshot);

    assert_eq!(world.alive_count(), 2);
    assert_eq!(world.transform(a), Some(Transform2D { x: 2.0, y: 3.0 }));
    assert_eq!(world.transform(b), Some(Transform2D { x: 8.0, y: 13.0 }));
    assert_eq!(world.velocity(a), Some(Velocity { vx: 1.0, vy: -2.0 }));
    assert_eq!(world.rigid_body(a), Some(expected_body));
    assert_eq!(
        world.distance_joint(joint),
        Some(DistanceJoint::new(a, b, 12.0).with_damping(0.25))
    );
    assert_eq!(world.rigid_contact_impulse_count(), 1);
    assert_eq!(
        world.rigid_contact_impulse_at(0),
        Some(RigidContactImpulse {
            entity_a: a,
            entity_b: b,
            point_x: 4.0,
            point_y: 5.0,
            normal_x: 0.0,
            normal_y: 1.0,
            normal_impulse: 0.75,
            tangent_impulse: 0.25,
        })
    );

    let after_restore = world.spawn_entity();
    assert_eq!(after_restore, extra);
}
