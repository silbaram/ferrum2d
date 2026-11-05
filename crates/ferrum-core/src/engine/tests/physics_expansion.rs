use super::*;
use crate::components::{
    AngularVelocity, DistanceJoint, HeightSpan, PhysicsFloorId, RigidBody, Rotation2D, Velocity,
};
use crate::physics::{PhysicsSystem, RigidBodyStepConfig};

fn body(e: &mut Engine, x: f32, y: f32, dynamic: bool) -> Entity {
    let id = e.world.spawn_entity();
    e.world.set_transform(id, Transform2D { x, y });
    e.world.set_rigid_body(
        id,
        if dynamic {
            RigidBody::dynamic(2.0).with_inertia(3.0)
        } else {
            RigidBody::static_body()
        },
    );
    e.world.set_aabb_collider(
        id,
        AabbCollider::new(1.0, 1.0, false, CollisionLayer::Player),
    );
    id
}
#[test]
fn fixed_rotation_keeps_translation_and_recovers_authored_inertia() {
    let mut e = Engine::new();
    e.use_data_scene();
    let id = body(&mut e, 0.0, 0.0, true);
    e.world.set_velocity(id, Velocity { vx: 2.0, vy: 0.0 });
    e.world.set_angular_velocity(
        id,
        AngularVelocity {
            radians_per_second: 4.0,
        },
    );
    assert!(e.set_physics_body_fixed_rotation(id.id, id.generation, true));
    e.world.apply_torque(id, 100.0);
    e.world.apply_angular_impulse(id, 100.0);
    PhysicsSystem::step_rigid_bodies_with_config(
        &mut e.world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            ..Default::default()
        },
    );
    assert!(e.world.transform(id).unwrap().x > 0.1);
    assert_eq!(e.world.rotation(id).unwrap(), Rotation2D::default());
    assert_eq!(e.world.rigid_body(id).unwrap().inverse_inertia, 0.0);
    assert!(e.set_physics_body_fixed_rotation(id.id, id.generation, false));
    assert!((e.world.rigid_body(id).unwrap().inverse_inertia - 1.0 / 3.0).abs() < 1e-6);
    e.world.apply_angular_impulse(id, 3.0);
    PhysicsSystem::step_rigid_bodies(&mut e.world, 0.1);
    assert!(e.world.rotation(id).unwrap().radians > 0.05);
    e.world.despawn(id);
    assert!(!e.set_physics_body_fixed_rotation(id.id, id.generation, true));
}
#[test]
fn joint_load_break_is_bounded_consuming_and_uses_substep_seconds() {
    for iterations in [1, 4, 12] {
        let mut e = Engine::new();
        e.use_data_scene();
        e.configure_physics_diagnostics(true);
        let a = body(&mut e, 0.0, 0.0, false);
        let b = body(&mut e, 10.0, 0.0, true);
        let id = e
            .world
            .add_distance_joint(DistanceJoint::new(a, b, 10.0).with_damping(1.0));
        assert!(e.set_physics_joint_load_limits(0, id.index, id.generation, 10.0, f32::INFINITY));
        e.world.set_velocity(b, Velocity { vx: 10.0, vy: 0.0 });
        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut e.world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations: iterations,
                ..Default::default()
            },
        );
        assert_eq!(stats.broken_joints, 1);
        let events = e.drain_physics_joint_breaks();
        assert_eq!(events.len(), 7);
        assert_eq!(events[4], 1.0);
        assert!((events[5] - 200.0).abs() < 0.01);
        assert_eq!(e.drain_physics_joint_breaks(), vec![0.0]);
        assert!(!e.set_physics_joint_load_limits(0, id.index, id.generation, 1.0, 1.0));
        assert_eq!(e.query_physics_diagnostics()[2], 1.0);
    }
}
#[test]
fn batch_cast_matches_single_and_rejects_entire_invalid_batch() {
    let mut e = Engine::new();
    e.use_data_scene();
    body(&mut e, 5.0, 0.0, false);
    body(&mut e, 10.0, 0.0, false);
    e.raycast_bodies(0.0, 0.0, 1.0, 0.0, 20.0, u32::MAX);
    let expected = e.physics_raycast_hits.clone();
    let mut rows = vec![0.0; 96];
    for row in rows.chunks_exact_mut(48) {
        row[1] = u32::MAX as f64;
        row[4] = 1.0;
        row[13] = 1.0;
        row[15] = 20.0;
    }
    let data = e.batch_cast_bodies(&rows);
    assert_eq!(data[0], 2.0);
    assert_eq!(data[1], 2.0);
    assert_eq!(data[2], 1.0);
    assert_eq!(data[3], expected[0].entity_id as f64);
    assert_eq!(data[5], expected[0].distance as f64);
    rows[48] = 99.0;
    assert!(e.batch_cast_bodies(&rows).is_empty());
    assert!(e.batch_cast_bodies(&vec![0.0; 48 * 129]).is_empty());
    assert_eq!(e.batch_cast_bodies(&[]), vec![0.0]);
}
#[test]
fn impact_feedback_deduplicates_pairs_and_independent_report_filter() {
    let mut e = Engine::new();
    e.use_data_scene();
    let a = body(&mut e, 0.0, 0.0, true);
    let b = body(&mut e, 10.0, 0.0, false);
    assert!(e.configure_physics_impact_feedback(&[
        u32::MAX as f64,
        1.0,
        0.2,
        7.0,
        u32::MAX as f64,
        0.5
    ]));
    e.configure_physics_contact_impacts(false, 0.0);
    let hit = crate::components::RigidContactImpulse {
        entity_a: a,
        entity_b: b,
        normal_impulse: 5.0,
        point_x: 0.0,
        point_y: 0.0,
        normal_x: 1.0,
        normal_y: 0.0,
        tangent_impulse: 0.0,
    };
    e.world.record_contact_impact(hit, 10.0);
    e.world.record_contact_impact(hit, 10.0);
    assert!(e.world.contact_impacts.is_empty());
    e.process_physics_impact_feedback(0.1);
    assert_eq!(e.physics_impact_feedback_stats()[0], 1);
    assert_eq!(e.frame_buffers.audio_events.len(), 1);
    e.process_physics_impact_feedback(0.05);
    assert_eq!(e.frame_buffers.audio_events.len(), 1);
    e.process_physics_impact_feedback(0.2);
    assert_eq!(e.frame_buffers.audio_events.len(), 2);
    assert!(!e.configure_physics_impact_feedback(&[1.0, 1.0, -1.0, 7.0, u32::MAX as f64, 1.0]));
    e.use_data_scene();
    assert_eq!(e.physics_impact_feedback_stats(), vec![0, 0, 0]);
}

fn configure_feedback(e: &mut Engine) {
    assert!(e.configure_physics_impact_feedback(&[
        u32::MAX as f64,
        1.0,
        60.0,
        7.0,
        u32::MAX as f64,
        0.5,
    ]));
    e.configure_physics_contact_impacts(false, 0.0);
}

fn approaching_pair(e: &mut Engine, y: f32, continuous: bool) -> Entity {
    let mover = body(e, 0.0, y, true);
    let wall = body(e, if continuous { 50.0 } else { 2.5 }, y, false);
    e.world.set_aabb_collider(
        wall,
        AabbCollider::new(1.0, 1.0, false, CollisionLayer::Wall),
    );
    e.world.set_velocity(
        mover,
        Velocity {
            vx: if continuous { 1000.0 } else { 10.0 },
            vy: 0.0,
        },
    );
    mover
}

fn feedback_step(e: &mut Engine, continuous: bool) {
    e.step_rigid_bodies_with_config(
        0.1, 0.0, 0.0, 8, 3, 0.8, 0.01, 1.0, 0.2, 120.0, false, continuous,
    );
}

#[test]
fn discrete_and_ccd_feedback_work_without_contact_reports_and_after_reset() {
    for continuous in [false, true] {
        let mut e = Engine::new();
        e.use_data_scene();
        configure_feedback(&mut e);
        for reset in [false, true] {
            if reset {
                e.reset_game();
            }
            approaching_pair(&mut e, 0.0, continuous);
            feedback_step(&mut e, continuous);
            assert!(e.world.contact_impacts.is_empty());
            assert_eq!(e.physics_impact_feedback_stats()[0], 1);
            assert_eq!(e.frame_buffers.audio_events.len(), 1);
            assert_eq!(e.frame_buffers.audio_events[0].sound_id, 7.0);
        }
    }
}

#[test]
fn manual_physics_steps_share_the_frame_feedback_budget() {
    let mut e = Engine::new();
    e.use_data_scene();
    configure_feedback(&mut e);
    for batch in 0..2 {
        for pair in 0..32 {
            approaching_pair(&mut e, (batch * 32 + pair) as f32 * 10.0, false);
        }
        feedback_step(&mut e, false);
        assert_eq!(e.frame_buffers.audio_events.len(), 32);
        assert_eq!(e.physics_impact_feedback_stats()[0], 32);
    }
    assert!(e.physics_impact_feedback_stats()[1] >= 32);
    e.clear_audio_events();
    e.update_frame(0.0, false, false, false);
    approaching_pair(&mut e, 1000.0, false);
    feedback_step(&mut e, false);
    assert_eq!(e.frame_buffers.audio_events.len(), 1);
    assert_eq!(e.physics_impact_feedback_stats()[0], 1);
}

#[test]
fn feedback_cooldowns_clear_on_restore_commit_but_not_rollback_or_despawn() {
    let mut e = Engine::new();
    e.use_data_scene();
    configure_feedback(&mut e);
    let mover = approaching_pair(&mut e, 0.0, false);
    feedback_step(&mut e, false);
    assert_eq!(e.physics_impact_feedback_stats()[2], 1);
    let unrelated = body(&mut e, 100.0, 100.0, false);
    assert!(e.despawn_physics_entity(unrelated.id, unrelated.generation));
    assert_eq!(e.physics_impact_feedback_stats()[2], 1);
    assert!(e.begin_physics_restore_transaction());
    assert!(e.end_physics_restore_transaction(false));
    assert_eq!(e.physics_impact_feedback_stats()[2], 1);
    assert!(e.begin_physics_restore_transaction());
    assert!(e.end_physics_restore_transaction(true));
    assert_eq!(e.physics_impact_feedback_stats(), vec![0, 0, 0]);
    e.clear_audio_events();
    e.world.set_transform(mover, Transform2D { x: 0.0, y: 0.0 });
    e.world.set_velocity(mover, Velocity { vx: 10.0, vy: 0.0 });
    feedback_step(&mut e, false);
    assert_eq!(e.frame_buffers.audio_events.len(), 1);
}

fn platform(e: &mut Engine) -> Entity {
    e.use_data_scene();
    assert!(e.spatial_scene.configure_surfaces(
        &[0.0, 0.0, 20.0, 20.0, -2.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0],
        &[1, 0, 16777215, 1]
    ));
    let id = body(e, 10.0, 10.0, false);
    e.world.set_rigid_body(id, RigidBody::kinematic());
    e.world
        .set_height_span(id, HeightSpan::new(PhysicsFloorId(0), 0.0, 4.0).unwrap());
    assert!(e.configure_spatial_moving_platforms(&[2.0, 1.0, 10.0, 0.0, 8.0, 1.0, 0.0, 0.0]));
    id
}
#[test]
fn spatial_platform_carries_riders_and_releases_when_they_leave() {
    let mut e = Engine::new();
    let rider = platform(&mut e);
    let revision = e.spatial_configuration_revision();
    e.spatial_scene.step_moving_platforms(&mut e.world, 0.5);
    assert_eq!(e.spatial_moving_platform_stats(), vec![1, 0]);
    assert!((e.world.transform(rider).unwrap().x - 15.0).abs() < 0.01);
    assert!((e.world.height_span(rider).unwrap().elevation - 4.0).abs() < 0.01);
    assert_eq!(e.spatial_configuration_revision(), revision);
    e.world
        .set_transform(rider, Transform2D { x: 100.0, y: 100.0 });
    e.spatial_scene.step_moving_platforms(&mut e.world, 0.25);
    assert_eq!(e.spatial_moving_platform_stats(), vec![0, 0]);
    assert_eq!(e.world.transform(rider).unwrap().x, 100.0);
}
#[test]
fn spatial_platform_blocked_carry_rolls_back_surface_phase_and_rider() {
    let mut e = Engine::new();
    let rider = platform(&mut e);
    let wall = body(&mut e, 12.0, 10.0, false);
    e.world
        .set_height_span(wall, HeightSpan::new(PhysicsFloorId(0), 0.0, 50.0).unwrap());
    let before = e.capture_spatial_moving_platforms();
    e.spatial_scene.step_moving_platforms(&mut e.world, 0.5);
    assert_eq!(e.spatial_moving_platform_stats(), vec![0, 1]);
    assert_eq!(e.capture_spatial_moving_platforms(), before);
    assert_eq!(e.world.transform(rider).unwrap().x, 10.0);
    assert_eq!(e.world.height_span(rider).unwrap().elevation, 0.0);
}

#[test]
fn spatial_platform_co_riders_move_as_one_batch_in_both_spawn_orders() {
    for reverse in [false, true] {
        let mut e = Engine::new();
        let first = platform(&mut e);
        let second = body(&mut e, 13.0, 10.0, false);
        e.world.set_rigid_body(second, RigidBody::kinematic());
        e.world.set_height_span(
            second,
            HeightSpan::new(PhysicsFloorId(0), 0.0, 4.0).unwrap(),
        );
        if reverse {
            e.world
                .set_transform(first, Transform2D { x: 13.0, y: 10.0 });
            e.world
                .set_transform(second, Transform2D { x: 10.0, y: 10.0 });
        }
        e.spatial_scene.step_moving_platforms(&mut e.world, 0.5);
        assert_eq!(e.spatial_moving_platform_stats(), vec![2, 0]);
        assert!(
            (e.world.transform(first).unwrap().x - if reverse { 18.0 } else { 15.0 }).abs() < 0.01
        );
    }
}
