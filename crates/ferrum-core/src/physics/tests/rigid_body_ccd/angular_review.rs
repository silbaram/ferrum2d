use super::*;
use crate::collision::{AngularSweepResult, ColliderShapeRef, CollisionSystem, ShapeMotion};

#[test]
fn angular_review_offset_near_touch_uses_collider_rotation_origin() {
    let moving = ShapeMotion {
        start: Transform2D::default(),
        shape: ColliderShapeRef::OrientedBox(
            OrientedBoxCollider::new(3.0, 0.05, 0.0, false, CollisionLayer::Player)
                .with_offset(-10.0, 0.0),
            0.0,
        ),
        velocity: Velocity::default(),
        angular_velocity: 30.0,
    };
    let target = ShapeMotion {
        start: Transform2D {
            x: -8.0,
            y: 0.10005,
        },
        shape: ColliderShapeRef::Aabb(AabbCollider::new(0.05, 0.05, false, CollisionLayer::Wall)),
        velocity: Velocity::default(),
        angular_velocity: 0.0,
    };
    let result = CollisionSystem::angular_swept_shape_contact(moving, target, 0.1);
    assert!(
        matches!(result, Some(AngularSweepResult::Contact(hit)) if hit.time == 0.0),
        "{result:?}"
    );
}

#[test]
fn angular_review_offset_rotation_applies_an_opposing_impulse() {
    for convex in [false, true] {
        for direction in [-1.0, 1.0] {
            let mut world = World::default();
            world.configure_contact_impacts(Some(40.0));
            world.impact_feedback_enabled = true;
            let moving = if convex {
                let collider = convex_polygon_collider(&[
                    (-3.0, -0.05),
                    (3.0, -0.05),
                    (3.0, 0.05),
                    (-3.0, 0.05),
                ])
                .with_offset(10.0 * direction, 0.0);
                spawn_static_convex_polygon(&mut world, 0.0, 0.0, collider)
            } else {
                spawn_dynamic_oriented_box(
                    &mut world,
                    0.0,
                    0.0,
                    OrientedBoxCollider::new(3.0, 0.05, 0.0, false, CollisionLayer::Player)
                        .with_offset(10.0 * direction, 0.0),
                )
            };
            world.set_rotation(moving, Rotation2D::default());
            world.set_rigid_body(moving, RigidBody::dynamic_box(1.0, 6.0, 0.1));
            world.set_angular_velocity(
                moving,
                AngularVelocity {
                    radians_per_second: -30.0 * direction,
                },
            );
            let wall = spawn_dynamic_body(&mut world, 8.0 * direction, 0.101, 0.05);
            world.set_rigid_body(wall, RigidBody::static_body());
            let stats = PhysicsSystem::step_rigid_bodies_with_config(
                &mut world,
                0.1,
                RigidBodyStepConfig {
                    gravity: Velocity::default(),
                    position_correction_percent: 0.0,
                    ..Default::default()
                },
            );
            let omega = world.angular_velocity(moving).unwrap().radians_per_second;
            assert!(stats.ccd_hits > 0, "convex={convex}, {stats:?}");
            assert!(
                stats.velocity_impulses > 0 && omega.abs() < 30.0,
                "convex={convex}, omega={omega}, {stats:?}"
            );
            assert!(!world.contact_impacts.is_empty());
            assert!(!world.impact_feedback_impacts.is_empty());
            assert!(world.velocity(moving).unwrap().vy < 0.0);
        }
    }
}

#[test]
fn angular_review_round_contact_point_is_on_both_touching_surfaces() {
    let moving = ShapeMotion {
        start: Transform2D::default(),
        shape: ColliderShapeRef::OrientedBox(
            OrientedBoxCollider::new(1.0, 1.0, 0.0, false, CollisionLayer::Player)
                .with_offset(5.0, 0.0),
            0.0,
        ),
        velocity: Velocity::default(),
        angular_velocity: 1.0,
    };
    let target = ShapeMotion {
        start: Transform2D { x: 8.0, y: 0.0 },
        shape: ColliderShapeRef::Circle(CircleCollider {
            radius: 2.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: CollisionLayer::Wall,
        }),
        velocity: Velocity::default(),
        angular_velocity: 0.0,
    };
    let point = CollisionSystem::angular_contact_point(moving, target, 0.0).unwrap();
    assert!((point.x - 6.0).abs() < 0.0001, "contact={point:?}");
    assert!(point.y.abs() < 0.0001, "contact={point:?}");
    assert_eq!(
        point,
        CollisionSystem::angular_contact_point(target, moving, 0.0).unwrap()
    );
    let capsule_target = ShapeMotion {
        shape: ColliderShapeRef::Capsule(CapsuleCollider::new(
            0.0,
            -0.5,
            0.0,
            0.5,
            2.0,
            false,
            CollisionLayer::Wall,
        )),
        ..target
    };
    let point = CollisionSystem::angular_contact_point(moving, capsule_target, 0.0).unwrap();
    assert!((point.x - 6.0).abs() < 0.0001, "capsule contact={point:?}");
    assert_eq!(
        point,
        CollisionSystem::angular_contact_point(capsule_target, moving, 0.0).unwrap()
    );
}

fn parallel_motion(
    kinematic_wall: bool,
    angular_velocity: f32,
) -> (f32, RigidBodyStepStats, Vec<[f64; 3]>, usize) {
    let mut world = World::default();
    world.physics_diagnostics.enabled = true;
    world.impact_feedback_enabled = true;
    world.configure_contact_impacts(Some(0.0));
    let wall = spawn_dynamic_body(&mut world, 0.0, 1.001, 0.5);
    world.set_aabb_collider(
        wall,
        AabbCollider::new(20.0, 0.5, false, CollisionLayer::Wall),
    );
    world.set_rigid_body(
        wall,
        if kinematic_wall {
            RigidBody::kinematic()
        } else {
            RigidBody::static_body()
        },
    );
    let moving = spawn_dynamic_oriented_box(
        &mut world,
        0.0,
        0.0,
        OrientedBoxCollider::new(1.0, 0.5, 0.0, false, CollisionLayer::Player),
    );
    world.set_velocity(
        moving,
        Velocity {
            vx: 100.0,
            vy: -0.001,
        },
    );
    world.set_angular_velocity(
        moving,
        AngularVelocity {
            radians_per_second: angular_velocity,
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
    let impacts = world.contact_impacts.len() + world.impact_feedback_impacts.len();
    (
        world.transform(moving).unwrap().x,
        stats,
        world.physics_diagnostics.ccd,
        impacts,
    )
}

#[test]
fn angular_review_separating_motion_does_not_stop_at_static_wall() {
    let (x, stats, diagnostics, impacts) = parallel_motion(false, -0.00001);
    assert!(
        (x - 10.0).abs() < 0.001,
        "x={x}, stats={stats:?}, diagnostics={diagnostics:?}"
    );
    assert_eq!(stats.ccd_hits, 0);
    assert!(diagnostics.is_empty());
    assert_eq!(impacts, 0);
}

#[test]
fn angular_review_separating_motion_does_not_stop_at_completed_wall() {
    let (x, stats, diagnostics, impacts) = parallel_motion(true, -0.00001);
    assert!(
        (x - 10.0).abs() < 0.001,
        "x={x}, stats={stats:?}, diagnostics={diagnostics:?}"
    );
    assert_eq!(stats.ccd_hits, 0);
    assert!(diagnostics.is_empty());
    assert_eq!(impacts, 0);
}

#[test]
fn angular_review_advancement_limit_clips_without_an_impact_and_reports_diagnostics() {
    for kinematic_wall in [false, true] {
        let (x, stats, diagnostics, impacts) = parallel_motion(kinematic_wall, 1.0);
        assert!(
            x > 0.0 && x < 0.1,
            "x={x}, stats={stats:?}, diagnostics={diagnostics:?}"
        );
        assert_eq!(stats.ccd_hits, 0);
        assert_eq!(stats.velocity_impulses, 0);
        assert_eq!(impacts, 0);
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0][2], 1.0);
    }
}
