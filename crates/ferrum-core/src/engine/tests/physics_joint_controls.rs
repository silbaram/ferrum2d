use super::*;
use crate::components::{
    AngularVelocity, DistanceJoint, GearJoint, PrismaticJoint, PulleyJoint, RevoluteJoint,
    RopeJoint, Rotation2D, SpringJoint, WeldJoint,
};
use crate::entity::Entity;

#[test]
fn engine_spawn_physics_joints_and_controls_for_wasm() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();

    assert!(engine.spawn_physics_aabb_body(
        0.0,
        0.0,
        2.0,
        2.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        false,
        PHYSICS_LAYER_PLAYER,
        CollisionMask::PLAYER.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let entity_a_id = engine.physics_entity_id();
    let entity_a_generation = engine.physics_entity_generation();
    assert!(engine.spawn_physics_aabb_body(
        20.0,
        0.0,
        2.0,
        2.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        false,
        PHYSICS_LAYER_ENEMY,
        CollisionMask::ENEMY.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let entity_b_id = engine.physics_entity_id();
    let entity_b_generation = engine.physics_entity_generation();

    assert!(engine.spawn_physics_distance_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        -1.0,
        0.5,
        1.0,
        -0.5,
        10.0,
        1.0,
        0.25,
        f32::INFINITY,
        true,
    ));
    let distance_index = engine.physics_joint_index();
    let distance_generation = engine.physics_joint_generation();
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_DISTANCE);
    assert_eq!(engine.physics_joint_entity_a_id(), entity_a_id);
    assert_eq!(engine.physics_joint_entity_b_id(), entity_b_id);
    assert_eq!(engine.physics_joint_local_anchor_a_x(), -1.0);
    assert_eq!(engine.physics_joint_local_anchor_a_y(), 0.5);
    assert_eq!(engine.physics_joint_local_anchor_b_x(), 1.0);
    assert_eq!(engine.physics_joint_local_anchor_b_y(), -0.5);
    assert_eq!(engine.physics_joint_rest_length(), 10.0);
    assert_eq!(engine.physics_joint_damping(), 0.25);
    assert!(engine.physics_joint_enabled());

    engine.step_rigid_bodies(1.0 / 60.0);
    assert!(engine.rigid_body_step_constraint_position_corrections() > 0);

    assert!(engine.set_physics_joint_enabled(
        PHYSICS_JOINT_DISTANCE,
        distance_index,
        distance_generation,
        false,
    ));
    assert!(!engine.physics_joint_enabled());
    assert!(engine.query_physics_joint(
        PHYSICS_JOINT_DISTANCE,
        distance_index,
        distance_generation,
    ));
    assert!(!engine.physics_joint_enabled());

    assert!(engine.spawn_physics_rope_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        -0.5,
        0.25,
        0.5,
        -0.25,
        12.0,
        0.5,
        0.1,
        4.0,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_ROPE);
    assert_eq!(engine.physics_joint_local_anchor_a_x(), -0.5);
    assert_eq!(engine.physics_joint_local_anchor_b_y(), -0.25);
    assert_eq!(engine.physics_joint_max_length(), 12.0);
    assert_eq!(engine.physics_joint_break_distance(), 4.0);

    assert!(engine.spawn_physics_spring_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        -0.25,
        0.75,
        0.25,
        -0.75,
        8.0,
        0.75,
        0.5,
        f32::INFINITY,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_SPRING);
    assert_eq!(engine.physics_joint_local_anchor_a_y(), 0.75);
    assert_eq!(engine.physics_joint_local_anchor_b_x(), 0.25);
    assert_eq!(engine.physics_joint_rest_length(), 8.0);
    assert_eq!(engine.physics_joint_stiffness(), 0.75);

    assert!(engine.spawn_physics_pulley_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        -4.0,
        10.0,
        24.0,
        10.0,
        0.0,
        0.0,
        0.0,
        0.0,
        30.0,
        2.0,
        0.8,
        0.25,
        5.0,
        true,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_PULLEY);
    assert_eq!(engine.physics_joint_rest_length(), 30.0);
    assert_eq!(engine.physics_joint_ratio(), 2.0);
    assert!(engine.physics_joint_slack());
    assert_eq!(engine.physics_joint_ground_anchor_a_x(), -4.0);
    assert_eq!(engine.physics_joint_ground_anchor_b_y(), 10.0);
    assert_eq!(engine.physics_joint_break_distance(), 5.0);

    assert!(engine.spawn_physics_revolute_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        -1.0,
        0.0,
        1.0,
        0.0,
        0.8,
        0.6,
        5.0,
        true,
        true,
        -0.5,
        0.5,
        true,
        1.5,
        3.0,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_REVOLUTE);
    assert_eq!(engine.physics_joint_local_anchor_a_x(), -1.0);
    assert!(engine.physics_joint_limit_enabled());
    assert!(engine.physics_joint_continuous_limit());
    assert!(engine.physics_joint_motor_enabled());
    assert_eq!(engine.physics_joint_max_motor_torque(), 3.0);

    assert!(engine.spawn_physics_prismatic_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.25,
        0.9,
        0.4,
        0.7,
        0.3,
        6.0,
        true,
        -2.0,
        2.0,
        true,
        4.0,
        5.0,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_PRISMATIC);
    assert_eq!(engine.physics_joint_reference_angle(), 0.25);
    assert_eq!(engine.physics_joint_local_axis_a_x(), 1.0);
    assert_eq!(engine.physics_joint_angular_stiffness(), 0.7);
    assert_eq!(engine.physics_joint_max_motor_force(), 5.0);

    assert!(engine.spawn_physics_gear_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        2.0,
        0.5,
        0.8,
        0.2,
        1.5,
        true,
    ));
    assert_eq!(engine.physics_joint_type(), PHYSICS_JOINT_GEAR);
    assert_eq!(engine.physics_joint_ratio(), 2.0);
    assert_eq!(engine.physics_joint_reference_angle(), 0.5);
    assert_eq!(engine.physics_joint_break_angle(), 1.5);

    assert!(engine.clear_physics_joint(
        PHYSICS_JOINT_DISTANCE,
        distance_index,
        distance_generation,
    ));
    assert!(!engine.query_physics_joint(
        PHYSICS_JOINT_DISTANCE,
        distance_index,
        distance_generation,
    ));
    assert!(!engine.spawn_physics_distance_joint(
        entity_a_id,
        entity_a_generation,
        999,
        0,
        0.0,
        0.0,
        0.0,
        0.0,
        10.0,
        1.0,
        0.0,
        f32::INFINITY,
        true,
    ));
}

#[test]
fn engine_despawn_physics_entity_cascades_connected_joint_cleanup() {
    let mut engine = Engine::new();
    engine.world = World::default();
    engine.clear_physics_history();

    assert!(engine.spawn_physics_aabb_body(
        0.0,
        0.0,
        2.0,
        2.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        false,
        PHYSICS_LAYER_PLAYER,
        CollisionMask::PLAYER.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let entity_a_id = engine.physics_entity_id();
    let entity_a_generation = engine.physics_entity_generation();

    assert!(engine.spawn_physics_aabb_body(
        10.0,
        0.0,
        2.0,
        2.0,
        PHYSICS_BODY_TYPE_DYNAMIC,
        1.0,
        false,
        PHYSICS_LAYER_ENEMY,
        CollisionMask::ENEMY.bits,
        CollisionMask::ALL.bits,
        false,
        true,
        true,
        false,
    ));
    let entity_b_id = engine.physics_entity_id();
    let entity_b_generation = engine.physics_entity_generation();

    assert!(engine.spawn_physics_distance_joint(
        entity_a_id,
        entity_a_generation,
        entity_b_id,
        entity_b_generation,
        0.0,
        0.0,
        0.0,
        0.0,
        10.0,
        1.0,
        0.0,
        f32::INFINITY,
        true,
    ));
    let joint_index = engine.physics_joint_index();
    let joint_generation = engine.physics_joint_generation();

    assert!(engine.despawn_physics_entity(entity_b_id, entity_b_generation));
    assert!(engine.query_physics_entity(entity_a_id, entity_a_generation));
    assert!(!engine.query_physics_joint(PHYSICS_JOINT_DISTANCE, joint_index, joint_generation));
    assert!(!engine.clear_physics_joint(PHYSICS_JOINT_DISTANCE, joint_index, joint_generation));
    assert!(!engine.despawn_physics_entity(entity_b_id, entity_b_generation));
}

fn add_joint_for_dispatch_test(world: &mut World, code: u32, a: Entity, b: Entity) -> (u32, u32) {
    match code {
        0 => {
            let id = world.add_distance_joint(DistanceJoint::new(a, b, 1.0));
            (id.index, id.generation)
        }
        1 => {
            let id = world.add_rope_joint(RopeJoint::new(a, b, 1.0));
            (id.index, id.generation)
        }
        2 => {
            let id = world.add_spring_joint(SpringJoint::new(a, b, 1.0));
            (id.index, id.generation)
        }
        3 => {
            let id = world.add_revolute_joint(RevoluteJoint::new(a, b));
            (id.index, id.generation)
        }
        4 => {
            let id = world.add_prismatic_joint(PrismaticJoint::new(a, b));
            (id.index, id.generation)
        }
        5 => {
            let id = world.add_gear_joint(GearJoint::new(a, b, 2.0));
            (id.index, id.generation)
        }
        6 => {
            let id = world.add_weld_joint(WeldJoint::new(a, b));
            (id.index, id.generation)
        }
        7 => {
            let id = world.add_pulley_joint(PulleyJoint::new(a, b, 1.0));
            (id.index, id.generation)
        }
        _ => panic!("test fixture requires a known joint code"),
    }
}

#[test]
fn engine_joint_dispatch_preserves_clear_handles_and_snapshot_policy_for_all_kinds() {
    let codes = [
        PHYSICS_JOINT_DISTANCE,
        PHYSICS_JOINT_ROPE,
        PHYSICS_JOINT_SPRING,
        PHYSICS_JOINT_REVOLUTE,
        PHYSICS_JOINT_PRISMATIC,
        PHYSICS_JOINT_GEAR,
        PHYSICS_JOINT_WELD,
        PHYSICS_JOINT_PULLEY,
    ];
    assert_eq!(codes, [0, 1, 2, 3, 4, 5, 6, 7]);
    for code in codes {
        let mut engine = Engine::new();
        engine.world = World::default();
        let a = engine.world.spawn_entity();
        let b = engine.world.spawn_entity();
        let (index, generation) = add_joint_for_dispatch_test(&mut engine.world, code, a, b);
        assert!(engine.query_physics_joint(code, index, generation));
        for (invalid_code, invalid_index, invalid_generation) in [
            (8, index, generation),
            (u32::MAX, index, generation),
            (code, u32::MAX, generation),
            (code, index, generation + 1),
        ] {
            assert!(!engine.clear_physics_joint(invalid_code, invalid_index, invalid_generation));
            assert_eq!(engine.physics_joint_type(), code);
            assert_eq!(engine.physics_joint_entity_b_id(), b.id);
            assert!(
                engine.physics_joint_enabled(),
                "failed clear must preserve the snapshot"
            );
        }
        assert!(engine.clear_physics_joint(code, index, generation));
        assert!(!engine.physics_joint_enabled());
        assert_eq!(engine.physics_joint_entity_b_id(), 0);
        assert_eq!(engine.physics_joint_break_force(), 0.0);
        assert!(!engine.query_physics_joint(code, index, generation));

        let (reused_index, reused_generation) =
            add_joint_for_dispatch_test(&mut engine.world, code, a, b);
        assert_eq!(reused_index, index);
        assert_eq!(reused_generation, generation + 1);
        assert!(engine.query_physics_joint(code, reused_index, reused_generation));
        assert!(!engine.clear_physics_joint(code, index, generation));
        assert_eq!(engine.physics_joint_generation(), reused_generation);
        assert!(engine.physics_joint_enabled());
        assert!(engine.clear_physics_joint(code, reused_index, reused_generation));
    }
}

#[test]
fn engine_joint_dispatch_breaks_all_kinds_by_measured_force_and_torque() {
    let errors = [4.0, 4.0, 4.0, 5.0, 4.0, 1.0, 0.5, 4.0];
    for (code, error) in errors.into_iter().enumerate() {
        let code = code as u32;
        for reason in [1, 2] {
            let mut engine = Engine::new();
            engine.world = World::default();
            engine.configure_physics_diagnostics(true);
            let a = engine.world.spawn_entity();
            let b = engine.world.spawn_entity();
            engine
                .world
                .set_transform(b, Transform2D { x: 3.0, y: 4.0 });
            engine.world.set_rotation(b, Rotation2D { radians: 0.5 });
            engine.world.set_rigid_body(b, RigidBody::dynamic(1.0));
            let (index, generation) = add_joint_for_dispatch_test(&mut engine.world, code, a, b);
            let key = (code, index, generation);
            let (force_limit, torque_limit) = if reason == 1 {
                (1.0, f32::INFINITY)
            } else {
                (f32::INFINITY, 1.0)
            };
            // Exercise the measurement -> load-limit -> shared clear path without
            // coupling this dispatch regression to each constraint's solver tuning.
            let sample = engine
                .world
                .begin_joint_measure(key, a, b, force_limit, torque_limit);
            if reason == 1 {
                engine.world.set_velocity(b, Velocity { vx: 2.0, vy: 0.0 });
            } else {
                engine.world.set_angular_velocity(
                    b,
                    AngularVelocity {
                        radians_per_second: 2.0,
                    },
                );
            }
            engine.world.finish_joint_measure(sample);
            assert_eq!(
                engine.world.finish_joint_loads(1.0),
                1,
                "kind {code}, reason {reason}"
            );
            let (force, torque) = if reason == 1 { (2.0, 0.0) } else { (0.0, 2.0) };
            assert_eq!(
                engine.world.physics_diagnostics.joints,
                vec![[
                    code as f64,
                    index as f64,
                    generation as f64,
                    force,
                    torque,
                    error
                ]]
            );
            assert_eq!(
                engine.world.physics_diagnostics.breaks,
                vec![[
                    code as f64,
                    index as f64,
                    generation as f64,
                    reason as f64,
                    force,
                    torque
                ]]
            );
            assert!(!engine.query_physics_joint(code, index, generation));
            assert_eq!(engine.world.finish_joint_loads(1.0), 0);
            assert_eq!(engine.world.physics_diagnostics.breaks.len(), 1);

            let (reused_index, reused_generation) =
                add_joint_for_dispatch_test(&mut engine.world, code, a, b);
            assert_eq!((reused_index, reused_generation), (index, generation + 1));
            assert_eq!(engine.world.finish_joint_loads(1.0), 0);
            assert_eq!(engine.world.physics_diagnostics.breaks.len(), 1);
            assert!(!engine.clear_physics_joint(code, index, generation));
            assert!(engine.query_physics_joint(code, reused_index, reused_generation));
        }
    }
}

#[test]
fn engine_joint_dispatch_unknown_load_codes_do_not_clear_valid_joints() {
    for code in [8, u32::MAX] {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.configure_physics_diagnostics(true);
        let a = engine.world.spawn_entity();
        let b = engine.world.spawn_entity();
        engine.world.set_rigid_body(b, RigidBody::dynamic(1.0));
        let (index, generation) = add_joint_for_dispatch_test(&mut engine.world, 0, a, b);
        let sample =
            engine
                .world
                .begin_joint_measure((code, index, generation), a, b, 1.0, f32::INFINITY);
        engine.world.set_velocity(b, Velocity { vx: 2.0, vy: 0.0 });
        engine.world.finish_joint_measure(sample);
        assert_eq!(engine.world.finish_joint_loads(1.0), 0);
        assert!(engine.world.physics_diagnostics.breaks.is_empty());
        assert_eq!(engine.world.physics_diagnostics.joints[0][5], 0.0);
        assert!(engine.query_physics_joint(0, index, generation));
    }
}

#[test]
fn engine_joint_dispatch_pending_load_cannot_break_reused_endpoint_and_joint() {
    for code in 0..8 {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.configure_physics_diagnostics(true);
        let a = engine.world.spawn_entity();
        let b = engine.world.spawn_entity();
        engine.world.set_rigid_body(b, RigidBody::dynamic(1.0));
        let (index, generation) = add_joint_for_dispatch_test(&mut engine.world, code, a, b);
        let sample =
            engine
                .world
                .begin_joint_measure((code, index, generation), a, b, 1.0, f32::INFINITY);
        engine.world.set_velocity(b, Velocity { vx: 2.0, vy: 0.0 });
        engine.world.finish_joint_measure(sample);
        assert_eq!(engine.world.physics_diagnostics.loads.len(), 1);

        assert!(engine.despawn_physics_entity(b.id, b.generation));
        assert!(!engine.query_physics_joint(code, index, generation));
        let next_b = engine.world.spawn_entity();
        assert_eq!(next_b.id, b.id);
        assert_eq!(next_b.generation, b.generation + 1);
        engine.world.set_rigid_body(next_b, RigidBody::dynamic(1.0));
        let (next_index, next_generation) =
            add_joint_for_dispatch_test(&mut engine.world, code, a, next_b);
        assert_eq!((next_index, next_generation), (index, generation + 1));
        assert_eq!(engine.world.physics_diagnostics.loads.len(), 1);

        assert_eq!(engine.world.finish_joint_loads(1.0), 0, "kind {code}");
        assert_eq!(engine.drain_physics_joint_breaks(), vec![0.0]);
        assert!(engine.world.rigid_body(b).is_none());
        assert!(engine.world.rigid_body(next_b).is_some());
        assert!(engine.query_physics_joint(code, next_index, next_generation));
        assert_eq!(engine.physics_joint_snapshot.entity_b_id, next_b.id);
        assert_eq!(
            engine.physics_joint_snapshot.entity_b_generation,
            next_b.generation
        );
        assert!(!engine.clear_physics_joint(code, index, generation));
        assert!(engine.clear_physics_joint(code, next_index, next_generation));
    }
}

#[test]
fn engine_joint_dispatch_full_restore_discards_pending_loads_and_break_queue() {
    for code in 0..8 {
        let mut engine = Engine::new();
        engine.world = World::default();
        engine.configure_physics_diagnostics(true);
        let a = engine.world.spawn_entity();
        let b = engine.world.spawn_entity();
        engine.world.set_rigid_body(b, RigidBody::dynamic(1.0));
        let (index, generation) = add_joint_for_dispatch_test(&mut engine.world, code, a, b);
        let before = engine.world.snapshot();
        let sample =
            engine
                .world
                .begin_joint_measure((code, index, generation), a, b, 1.0, f32::INFINITY);
        engine.world.set_velocity(b, Velocity { vx: 2.0, vy: 0.0 });
        engine.world.finish_joint_measure(sample);
        assert_eq!(engine.world.finish_joint_loads(1.0), 1);
        assert_eq!(engine.world.physics_diagnostics.loads.len(), 1);
        assert_eq!(engine.world.physics_diagnostics.breaks.len(), 1);
        let (next_index, next_generation) =
            add_joint_for_dispatch_test(&mut engine.world, code, a, b);
        assert_eq!((next_index, next_generation), (index, generation + 1));

        // Restoring the old generation makes its pending load key valid again.
        // A full restore must discard that load rather than break the restored joint.
        engine.world.restore_snapshot(&before);
        assert_eq!(engine.world.snapshot(), before);
        assert!(engine.physics_diagnostics_enabled());
        assert!(engine.world.physics_diagnostics.loads.is_empty());
        assert_eq!(engine.query_physics_diagnostics(), vec![0.0, 0.0, 0.0]);
        assert_eq!(engine.drain_physics_joint_breaks(), vec![0.0]);
        assert_eq!(engine.world.finish_joint_loads(1.0), 0, "kind {code}");
        assert!(!engine.query_physics_joint(code, next_index, next_generation));
        assert!(engine.query_physics_joint(code, index, generation));
        assert_eq!(engine.drain_physics_joint_breaks(), vec![0.0]);
        assert!(engine.clear_physics_joint(code, index, generation));
    }
}
