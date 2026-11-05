use super::*;

#[test]
fn ccd_checks_dynamic_target_prefix_before_predicted_interception() {
    for target_first in [false, true] {
        let mut world = World::default();
        let first = spawn_dynamic_body(&mut world, -2.0, 0.0, 0.25);
        let second = spawn_dynamic_body(&mut world, 2.0, -4.0, 0.25);
        let (moving, target) = if target_first {
            (second, first)
        } else {
            (first, second)
        };
        world.set_transform(moving, Transform2D { x: -2.0, y: 0.0 });
        world.set_transform(target, Transform2D { x: 2.0, y: -4.0 });
        let wall = spawn_dynamic_body(&mut world, 2.0, -2.0, 0.1);
        world.set_aabb_collider(
            wall,
            AabbCollider::new(1.0, 0.1, false, CollisionLayer::Wall),
        );
        world.set_rigid_body(wall, RigidBody::static_body());
        world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
        world.set_velocity(target, Velocity { vx: 0.0, vy: 100.0 });
        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                position_correction_percent: 0.0,
                ..Default::default()
            },
        );
        assert!(stats.ccd_hits > 0);
        assert!(
            world.transform(target).unwrap().y <= -2.349,
            "target_first={target_first}, target tunneled before interception: {:?}",
            world.transform(target)
        );
    }
}

#[test]
fn angular_ccd_includes_offset_rotating_geometry_and_near_touch() {
    for (offset, angle, wall_x, wall_y) in [
        (10.0, std::f32::consts::FRAC_PI_2, 11.7, 0.0),
        (0.0, 0.0, 2.0, 0.10005),
    ] {
        let mut world = World::default();
        let bar = spawn_dynamic_oriented_box(
            &mut world,
            0.0,
            0.0,
            OrientedBoxCollider::new(3.0, 0.05, 0.0, false, CollisionLayer::Player)
                .with_offset(offset, 0.0),
        );
        world.set_rigid_body(bar, RigidBody::dynamic_box(1.0, 6.0, 0.1));
        world.set_rotation(bar, Rotation2D { radians: angle });
        world.set_angular_velocity(
            bar,
            AngularVelocity {
                radians_per_second: if offset > 0.0 { -20.0 } else { 30.0 },
            },
        );
        let obstacle = spawn_dynamic_body(&mut world, wall_x, wall_y, 0.05);
        world.set_rigid_body(obstacle, RigidBody::static_body());
        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                ..Default::default()
            },
        );
        assert!(stats.ccd_hits > 0, "offset={offset}, {stats:?}");
    }
}

#[test]
fn ccd_follows_dynamic_impact_target_before_a_thin_wall() {
    let mut world = World::default();
    let moving = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.25);
    let target = spawn_dynamic_body(&mut world, 2.0, 0.0, 0.25);
    let wall = spawn_dynamic_body(&mut world, 4.0, 0.0, 0.1);
    world.set_rigid_body(wall, RigidBody::static_body());
    world.set_velocity(moving, Velocity { vx: 100.0, vy: 0.0 });
    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            position_correction_percent: 0.0,
            ..Default::default()
        },
    );
    assert!(stats.ccd_hits >= 2, "{stats:?}");
    assert!(
        world.transform(target).unwrap().x <= 3.651,
        "target tunneled: {:?}",
        world.transform(target)
    );
    assert!(
        world.transform(moving).unwrap().x <= 3.651,
        "source tunneled: {:?}",
        world.transform(moving)
    );
}

#[test]
fn ccd_detects_a_rotating_bar_that_crosses_a_thin_obstacle_between_endpoints() {
    let mut world = World::default();
    let bar = spawn_dynamic_oriented_box(
        &mut world,
        0.0,
        0.0,
        OrientedBoxCollider::new(3.0, 0.05, 0.0, false, CollisionLayer::Player),
    );
    world.set_rigid_body(bar, RigidBody::dynamic_box(1.0, 6.0, 0.1));
    world.set_rotation(bar, Rotation2D { radians: 0.0 });
    world.set_angular_velocity(
        bar,
        AngularVelocity {
            radians_per_second: std::f32::consts::PI / 0.1,
        },
    );
    let obstacle = spawn_dynamic_body(&mut world, 0.0, 2.0, 0.05);
    world.set_rigid_body(obstacle, RigidBody::static_body());
    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            position_correction_percent: 0.0,
            ..Default::default()
        },
    );
    assert!(
        stats.ccd_hits > 0,
        "rotation swept through the obstacle: {stats:?}"
    );
    assert!(
        world.angular_velocity(bar).unwrap().radians_per_second < 30.0,
        "omega={:?}, pose={:?}, stats={stats:?}",
        world.angular_velocity(bar),
        world.rotation(bar)
    );
}

#[test]
fn ccd_budget_does_not_advance_unchecked_after_repeated_bounces() {
    let mut world = World::default();
    let moving = spawn_dynamic_body(&mut world, 0.0, 0.0, 0.25);
    world.set_rigid_body(
        moving,
        RigidBody::dynamic(1.0).with_material(PhysicsMaterial::new(1.0, 0.0)),
    );
    for x in [-2.0, 2.0] {
        let wall = spawn_dynamic_body(&mut world, x, 0.0, 0.25);
        world.set_rigid_body(
            wall,
            RigidBody::static_body().with_material(PhysicsMaterial::new(1.0, 0.0)),
        );
    }
    world.set_velocity(
        moving,
        Velocity {
            vx: 1000.0,
            vy: 0.0,
        },
    );
    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            position_correction_percent: 0.0,
            ..Default::default()
        },
    );
    assert!(
        stats.ccd_hits >= 4,
        "fixture must exhaust the CCD budget: {stats:?}"
    );
    assert!(
        world.transform(moving).unwrap().x.abs() <= 1.501,
        "unchecked remainder tunneled outside the corridor: {:?}",
        world.transform(moving)
    );
}
