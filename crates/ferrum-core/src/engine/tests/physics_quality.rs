use super::*;
use crate::components::{AngularVelocity, Rotation2D};

#[test]
fn physics_render_interpolation_resume_and_follow_camera_use_displayed_pose() {
    let mut e = Engine::new();
    e.use_data_scene();
    let body = super::data_scene_visuals::sprite(&mut e, 1, 100.0, 100.0, 0);
    e.world
        .set_rigid_body(body, RigidBody::dynamic(1.0).with_sleeping_enabled(false));
    e.world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    e.auto_rigid_body_step_enabled = true;
    e.auto_rigid_body_step_config.gravity = Velocity::default();
    e.configure_fixed_timestep(true, 0.1, 1.0, 8);
    e.configure_physics_render_interpolation(true);
    assert!(e.configure_data_scene_camera(
        100.0,
        100.0,
        body.id,
        body.generation,
        false,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0
    ));
    e.update(0.15);
    assert!((e.camera.x - 100.5).abs() < 0.001);
    assert!((e.world.transform(body).unwrap().x - 101.0).abs() < 0.001);
    assert!(e.pause_data_scene());
    e.update(0.01);
    assert!((e.camera.x - 101.0).abs() < 0.001);
    assert!(e.resume_data_scene());
    e.update(0.01);
    assert_eq!(e.last_fixed_update.steps, 0);
    assert!(
        (e.camera.x - 101.0).abs() < 0.001,
        "resume must not reactivate the old sample"
    );
    let old = body;
    e.world.despawn(old);
    let replacement = super::data_scene_visuals::sprite(&mut e, 1, 500.0, 500.0, 0);
    assert_eq!(old.id, replacement.id);
    e.update(0.0);
    assert!(
        (e.camera.x - 101.0).abs() < 0.001,
        "follow must not bind to a recycled slot"
    );
    assert_eq!(
        e.world.render_transform_at_index(replacement.id as usize),
        e.world.transform(replacement)
    );
}

#[test]
fn physics_render_interpolation_leaves_simulation_and_teleports_untouched() {
    let mut e = Engine::new();
    e.use_data_scene();
    let body = super::data_scene_visuals::sprite(&mut e, 1, 100.0, 100.0, 0);
    e.world
        .set_rigid_body(body, RigidBody::dynamic(1.0).with_sleeping_enabled(false));
    e.world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    e.world.set_rotation(body, Rotation2D { radians: 3.1 });
    e.world.set_angular_velocity(
        body,
        AngularVelocity {
            radians_per_second: 1.0,
        },
    );
    e.auto_rigid_body_step_enabled = true;
    e.auto_rigid_body_step_config.gravity = Velocity::default();
    e.configure_fixed_timestep(true, 0.1, 1.0, 8);
    e.configure_physics_render_interpolation(true);
    e.update(0.15);
    assert!((e.world.transform(body).unwrap().x - 101.0).abs() < 0.001);
    assert!(
        (e.world
            .render_transform_at_index(body.id as usize)
            .unwrap()
            .x
            - 100.5)
            .abs()
            < 0.001
    );
    assert!((e.world.render_rotation_at_index(body.id as usize).radians - 3.15).abs() < 0.001);
    let snapshot = e.world.snapshot();
    e.world
        .set_transform(body, Transform2D { x: 400.0, y: 100.0 });
    assert_eq!(
        e.world
            .render_transform_at_index(body.id as usize)
            .unwrap()
            .x,
        400.0
    );
    e.world.restore_snapshot(&snapshot);
    assert_eq!(
        e.world.render_transform_at_index(body.id as usize),
        e.world.transform(body)
    );
    assert!(e.pause_data_scene());
    e.update(0.01);
    assert_eq!(
        e.world.render_transform_at_index(body.id as usize),
        e.world.transform(body)
    );
}

#[test]
fn physics_solver_state_restores_accumulators_and_rejects_whole_invalid_batch() {
    let mut e = Engine::new();
    e.world = World::default();
    let a = spawn_test_body(&mut e.world, 0.0, 0.0, CollisionLayer::Player);
    let b = spawn_test_body(&mut e.world, 50.0, 0.0, CollisionLayer::Player);
    for body in [a, b] {
        e.world.set_rigid_body(body, RigidBody::dynamic(2.0));
    }
    e.world.apply_force(a, Velocity { vx: 20.0, vy: 4.0 });
    e.world.apply_impulse(a, Velocity { vx: 2.0, vy: 1.0 });
    let handles = [a.id, a.generation, b.id, b.generation];
    let values = e.capture_physics_solver_state_bulk(&handles);
    let initial = e.world.snapshot();
    let config = crate::physics::RigidBodyStepConfig {
        gravity: Velocity::default(),
        ..Default::default()
    };
    PhysicsSystem::step_rigid_bodies_with_config(&mut e.world, 0.1, config);
    let expected = (e.world.transform(a), e.world.velocity(a));
    e.world.restore_snapshot(&initial);
    e.world.rigid_bodies[a.id as usize].as_mut().unwrap().force = Velocity::default();
    assert!(e.restore_physics_solver_state_bulk(&handles, &values, &[], &[]));
    PhysicsSystem::step_rigid_bodies_with_config(&mut e.world, 0.1, config);
    assert_eq!(expected, (e.world.transform(a), e.world.velocity(a)));
    let before = e.capture_physics_solver_state_bulk(&handles);
    let mut invalid = values.clone();
    invalid[0] = 123.0;
    invalid[15] = 2.0;
    assert!(!e.restore_physics_solver_state_bulk(&handles, &invalid, &[], &[]));
    assert_eq!(before, e.capture_physics_solver_state_bulk(&handles));
}

#[test]
fn physics_body_bulk_restore_rejects_collider_type_without_mutating_any_body() {
    for body_count in [1, 2] {
        for invalid_type in [
            PHYSICS_COLLIDER_TYPE_NONE,
            PHYSICS_COLLIDER_TYPE_CIRCLE,
            u32::MAX,
        ] {
            let mut e = Engine::new();
            e.world = World::default();
            let mut handles = Vec::new();
            for index in 0..body_count {
                let body = spawn_test_body(
                    &mut e.world,
                    index as f32 * 50.0,
                    0.0,
                    CollisionLayer::Player,
                );
                e.world.set_rigid_body(body, RigidBody::dynamic(1.0));
                handles.extend([body.id, body.generation]);
            }
            assert!(e.capture_physics_body_snapshot_bulk(handles.clone()));
            let mut floats = e.physics_body_snapshot_floats.clone();
            let mut u32s = e.physics_body_snapshot_u32s.clone();
            for index in 0..body_count {
                let offset = index * PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY;
                floats[offset] = 100.0 + index as f32;
                floats[offset + 2] = 40.0;
            }
            // The last invalid entry must also prevent earlier valid entries
            // from changing position, velocity, or any other world component.
            u32s[(body_count - 1) * PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY
                + PHYSICS_BODY_SNAPSHOT_U32_COLLIDER_TYPE] = invalid_type;
            let before = e.world.snapshot();
            assert!(!e.restore_physics_body_snapshot_bulk(handles, floats, u32s));
            assert_eq!(e.world.snapshot(), before);
        }
    }
}

#[test]
fn physics_body_bulk_restore_validates_all_entries_before_mutating() {
    let mut e = Engine::new();
    e.world = World::default();
    let a = spawn_test_body(&mut e.world, 0.0, 0.0, CollisionLayer::Player);
    let b = spawn_test_body(&mut e.world, 50.0, 0.0, CollisionLayer::Player);
    for body in [a, b] {
        e.world.set_rigid_body(body, RigidBody::dynamic(1.0));
    }
    let handles = [a.id, a.generation, b.id, b.generation];
    assert!(e.capture_physics_body_snapshot_bulk(handles.to_vec()));
    let mut floats = e.physics_body_snapshot_floats.clone();
    let u32s = e.physics_body_snapshot_u32s.clone();
    floats[0] = 100.0;
    floats[PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY] = f32::NAN;
    assert!(!e.restore_physics_body_snapshot_bulk(handles.to_vec(), floats, u32s));
    assert_eq!(e.world.transform(a).unwrap().x, 0.0);
    assert!(e.begin_physics_restore_transaction());
    assert!(!e.begin_physics_restore_transaction());
    e.world.set_transform(a, Transform2D { x: 123.0, y: 0.0 });
    assert!(e.end_physics_restore_transaction(false));
    assert_eq!(e.world.transform(a).unwrap().x, 0.0);
}

#[test]
fn physics_restore_rollback_preserves_pending_breaks_and_impact_queues() {
    use crate::components::{DistanceJoint, RigidContactImpulse};

    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_physics_diagnostics(true);
    let a = spawn_test_body(&mut e.world, 0.0, 0.0, CollisionLayer::Player);
    let b = spawn_test_body(&mut e.world, 20.0, 0.0, CollisionLayer::Player);
    e.world.set_rigid_body(a, RigidBody::static_body());
    e.world.set_rigid_body(b, RigidBody::dynamic(1.0));
    let joint = e
        .world
        .add_distance_joint(DistanceJoint::new(a, b, 20.0).with_damping(1.0));
    assert!(e.set_physics_joint_load_limits(0, joint.index, joint.generation, 1.0, f32::INFINITY));
    e.world.set_velocity(b, Velocity { vx: 10.0, vy: 0.0 });
    e.step_rigid_bodies_with_config(
        0.1, 0.0, 0.0, 8, 3, 0.8, 0.01, 1.0, 0.2, 120.0, false, false,
    );
    assert_eq!(e.world.physics_diagnostics.breaks.len(), 1);

    e.configure_physics_contact_impacts(true, 2.0);
    assert!(e.configure_physics_impact_feedback(&[
        u32::MAX as f64,
        1.0,
        0.2,
        7.0,
        u32::MAX as f64,
        0.5,
    ]));
    let impact = RigidContactImpulse {
        entity_a: a,
        entity_b: b,
        point_x: 10.0,
        point_y: 0.0,
        normal_x: 1.0,
        normal_y: 0.0,
        normal_impulse: 5.0,
        tangent_impulse: 0.0,
    };
    e.world.record_contact_impact(impact, 10.0);
    e.world.contact_impacts_dropped = 3;
    e.world.impact_feedback_dropped = 4;
    e.world.physics_diagnostics.breaks_dropped = 2;
    let before = e.world.snapshot();
    let diagnostics = e.query_physics_diagnostics();
    let breaks = e.world.physics_diagnostics.breaks.clone();

    assert!(e.begin_physics_restore_transaction());
    e.configure_physics_diagnostics(false);
    e.configure_physics_contact_impacts(false, 0.0);
    e.world.impact_feedback_enabled = false;
    e.world.impact_feedback_impacts.clear();
    assert!(e.end_physics_restore_transaction(false));

    assert_eq!(e.world.snapshot(), before);
    assert!(e.physics_diagnostics_enabled());
    assert_eq!(e.query_physics_diagnostics(), diagnostics);
    assert_eq!(e.world.physics_diagnostics.breaks, breaks);
    assert_eq!(e.world.physics_diagnostics.breaks_dropped, 2);
    assert_eq!(e.world.contact_impact_min_speed, Some(2.0));
    assert_eq!(e.world.contact_impacts, vec![impact]);
    assert_eq!(e.world.contact_impacts_dropped, 3);
    assert!(e.world.impact_feedback_enabled);
    assert_eq!(e.world.impact_feedback_impacts, vec![impact]);
    assert_eq!(e.world.impact_feedback_dropped, 4);
    assert_eq!(e.drain_physics_joint_breaks().len(), 7);
    assert_eq!(e.drain_physics_joint_breaks(), vec![0.0]);

    // A normal restore still starts fresh output queues; only rollback preserves them.
    e.world.restore_snapshot(&before);
    assert!(e.physics_diagnostics_enabled());
    assert_eq!(e.query_physics_diagnostics(), vec![0.0, 0.0, 0.0]);
    assert!(e.world.contact_impacts.is_empty());
    assert_eq!(e.world.contact_impacts_dropped, 0);
    assert!(e.world.impact_feedback_impacts.is_empty());
    assert_eq!(e.world.impact_feedback_dropped, 0);
}

#[test]
fn physics_contact_impacts_include_ccd_and_clear_each_frame() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = spawn_test_body(&mut e.world, 0.0, 0.0, CollisionLayer::Player);
    let wall = spawn_test_body(&mut e.world, 50.0, 0.0, CollisionLayer::Wall);
    e.world.set_rigid_body(a, RigidBody::dynamic(1.0));
    e.world.set_rigid_body(wall, RigidBody::static_body());
    e.world.set_velocity(
        a,
        Velocity {
            vx: 1000.0,
            vy: 0.0,
        },
    );
    e.configure_physics_contact_impacts(true, 1.0);
    e.step_rigid_bodies_with_config(0.1, 0.0, 0.0, 8, 3, 0.8, 0.01, 1.0, 0.2, 120.0, false, true);
    assert_eq!(e.query_physics_contact_impacts(), 1);
    let hit = e.frame_buffers.contact_impacts[0];
    assert!(hit.normal_impulse > 900.0);
    assert!(hit.point_x.is_finite() && hit.normal_x > 0.99);
    assert_eq!(
        e.query_physics_contact_impacts(),
        1,
        "query is non-destructive"
    );
    e.update(0.0);
    assert_eq!(e.query_physics_contact_impacts(), 0);
}
