use super::*;
use crate::components as c;
fn engine(gravity: [f32; 3]) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity,
        ..WorldConfig::default()
    })
    .unwrap();
    e
}
fn body(e: &mut Engine, x: f32, y: f32, dynamic: bool) -> Entity {
    let id = e.world.spawn_entity();
    e.world.set_transform(id, Transform2D { x, y });
    let mut rigid = if dynamic {
        c::RigidBody::dynamic(1.0)
    } else {
        c::RigidBody::static_body()
    };
    rigid.can_sleep = false;
    e.world.set_rigid_body(id, rigid);
    id
}
fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    assert_eq!(e.unified_physics_error(), None);
}
fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 0.025, "{a} != {b}");
}

#[test]
fn distance_rope_and_frequency_spring_import_into_actual_engine_steps() {
    for kind in 0..3 {
        let mut e = engine([0.0; 3]);
        let a = body(&mut e, 0.0, 0.0, false);
        let b = body(&mut e, 3.0, 0.0, true);
        match kind {
            0 => {
                e.world.add_distance_joint(c::DistanceJoint::new(a, b, 2.0));
            }
            1 => {
                e.world.add_rope_joint(c::RopeJoint::new(a, b, 2.0));
            }
            _ => {
                e.world
                    .add_spring_joint(c::SpringJoint::new(a, b, 2.0).with_frequency(2.0, 1.0));
            }
        }
        tick(&mut e, 180);
        let p = e.world.transform(b).unwrap();
        near(p.x, 2.0);
        near(p.y, 0.0);
        assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 1);
    }
}

#[test]
fn hinge_slider_and_weld_keep_authored_anchors_axes_and_reference_angles() {
    for kind in 0..3 {
        let mut e = engine([0.0; 3]);
        let a = body(&mut e, 0.0, 0.0, false);
        let b = body(&mut e, 1.0, 1.0, true);
        match kind {
            0 => {
                e.world.add_revolute_joint(
                    c::RevoluteJoint::new(a, b)
                        .with_local_anchor_b(-1.0, 0.0)
                        .with_angle_limits(-0.5, 0.5)
                        .with_motor(1.0, 10.0),
                );
            }
            1 => {
                e.world.add_prismatic_joint(
                    c::PrismaticJoint::new(a, b)
                        .with_translation_limits(-2.0, 2.0)
                        .with_motor(1.0, 10.0),
                );
            }
            _ => {
                e.world.add_weld_joint(
                    c::WeldJoint::new(a, b)
                        .with_local_anchor_b(-1.0, 0.0)
                        .with_reference_angle(0.3),
                );
            }
        }
        tick(&mut e, 180);
        let p = e.world.transform(b).unwrap();
        let angle = e.world.rotation(b).unwrap().radians;
        match kind {
            0 => {
                near(p.x, angle.cos());
                near(p.y, angle.sin());
                near(angle, 0.5);
            }
            1 => {
                near(p.x, 2.0);
                near(p.y, 0.0);
                near(angle, 0.0);
            }
            _ => {
                near(p.x, 0.3_f32.cos());
                near(p.y, 0.3_f32.sin());
                near(angle, 0.3);
            }
        }
    }
}

#[test]
fn gear_and_pulley_components_share_body_input_and_continuous_angles() {
    let mut e = engine([0.0; 3]);
    let a = body(&mut e, -2.0, 0.0, true);
    let b = body(&mut e, 2.0, 0.0, true);
    e.world.add_gear_joint(c::GearJoint::new(a, b, 0.5));
    e.world.set_angular_velocity(
        a,
        AngularVelocity {
            radians_per_second: 10.0,
        },
    );
    tick(&mut e, 300);
    let aa = e.world.rotation(a).unwrap().radians;
    let ab = e.world.rotation(b).unwrap().radians;
    assert!(aa > 20.0);
    near(ab + 0.5 * aa, 0.0);
    let mut e = engine([0.0, -10.0, 0.0]);
    let a = body(&mut e, -2.0, -2.0, true);
    let b = body(&mut e, 2.0, -2.0, true);
    e.world.add_pulley_joint(
        c::PulleyJoint::new(a, b, 6.0)
            .with_ground_anchor_a(-2.0, 0.0)
            .with_ground_anchor_b(2.0, 0.0)
            .with_ratio(2.0),
    );
    tick(&mut e, 30);
    let pa = e.world.transform(a).unwrap();
    let pb = e.world.transform(b).unwrap();
    near(-pa.y - 2.0 * pb.y, 6.0);
    assert!(pa.y < -2.2 && pb.y > -1.9);
}

#[test]
fn joint_updates_endpoint_changes_removal_and_generation_reuse_do_not_leak() {
    let mut e = engine([0.0; 3]);
    let a = body(&mut e, 0.0, 0.0, false);
    let b = body(&mut e, 3.0, 0.0, true);
    let c = body(&mut e, 10.0, 0.0, false);
    let old = e.world.add_distance_joint(c::DistanceJoint::new(a, b, 2.0));
    tick(&mut e, 60);
    near(e.world.transform(b).unwrap().x, 2.0);
    e.world
        .set_distance_joint(old, c::DistanceJoint::new(c, b, 3.0));
    // Backend correction speed is capped at 3 units/s; the new target is 5 units away.
    tick(&mut e, 180);
    near(e.world.transform(b).unwrap().x, 7.0);
    e.world.clear_distance_joint(old);
    let next = e.world.add_distance_joint(c::DistanceJoint::new(a, b, 4.0));
    assert_eq!(next.index, old.index);
    assert_ne!(next.generation, old.generation);
    tick(&mut e, 90);
    near(e.world.transform(b).unwrap().x, 4.0);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 1);
    e.world.despawn(a);
    tick(&mut e, 1);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 0);
    assert!(e.world.distance_joint(next).is_none());
}

#[test]
fn force_and_geometry_breaks_remove_world_joints_once_and_never_respawn() {
    let mut e = engine([0.0; 3]);
    let a = body(&mut e, 0.0, 0.0, false);
    let b = body(&mut e, 2.0, 0.0, true);
    let mut joint = c::DistanceJoint::new(a, b, 2.0);
    joint.break_force = 1.0;
    let id = e.world.add_distance_joint(joint);
    e.world.apply_impulse(b, Velocity { vx: 10.0, vy: 0.0 });
    tick(&mut e, 1);
    assert!(e.world.distance_joint(id).is_none());
    assert_eq!(e.world.physics_diagnostics.breaks.len(), 1);
    assert_eq!(e.world.physics_diagnostics.breaks[0][3], 1.0);
    tick(&mut e, 10);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 0);
    assert_eq!(e.world.physics_diagnostics.breaks.len(), 1);
    let id = e
        .world
        .add_distance_joint(c::DistanceJoint::new(a, b, 1.0).with_break_distance(0.1));
    tick(&mut e, 1);
    assert!(e.world.distance_joint(id).is_none());
    assert_eq!(e.world.physics_diagnostics.breaks.last().unwrap()[3], 3.0);
}

#[test]
fn invalid_joint_batch_precedes_body_creation_and_impulse_consumption() {
    let mut e = engine([0.0; 3]);
    let a = body(&mut e, 0.0, 0.0, false);
    let b = body(&mut e, 2.0, 0.0, true);
    let id = e.world.add_gear_joint(c::GearJoint::new(a, b, 1.0));
    e.world
        .set_gear_joint(id, c::GearJoint::new(a, b, 1.0).with_stiffness(f32::NAN));
    e.world.apply_impulse(b, Velocity { vx: 2.0, vy: 0.0 });
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidJoint))
    );
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
    assert_eq!(e.world.rigid_body(b).unwrap().impulse.vx, 2.0);
}

#[test]
fn imported_multiturn_rotation_and_position_edits_keep_authored_turn_count() {
    let mut e = engine([0.0; 3]);
    let b = body(&mut e, 0.0, 0.0, true);
    e.world.set_rotation(b, Rotation2D { radians: 20.0 });
    e.world.set_angular_velocity(
        b,
        AngularVelocity {
            radians_per_second: 2.0,
        },
    );
    tick(&mut e, 60);
    near(e.world.rotation(b).unwrap().radians, 22.0);
    e.world.set_transform(b, Transform2D { x: 10.0, y: 0.0 });
    tick(&mut e, 60);
    near(e.world.rotation(b).unwrap().radians, 24.0);
    near(e.world.transform(b).unwrap().x, 10.0);
}

#[test]
fn continuous_hinge_import_keeps_offset_anchors_limits_updates_and_torque_breaks() {
    let mut e = engine([0.0; 3]);
    let a = body(&mut e, 0.0, 0.0, false);
    let b = body(&mut e, 1.0, 0.0, true);
    e.world.set_rotation(a, Rotation2D { radians: 20.0 });
    e.world.set_rotation(b, Rotation2D { radians: 20.0 });
    let mut joint = c::RevoluteJoint::new(a, b)
        .with_local_anchor_b(-1.0, 0.0)
        .with_angle_limits(-7.0, 7.0)
        .with_continuous_limit(true)
        .with_motor(8.0, 20.0);
    let id = e.world.add_revolute_joint(joint);
    tick(&mut e, 240);
    let angle = e.world.rotation(b).unwrap().radians;
    near(angle, 27.0);
    let p = e.world.transform(b).unwrap();
    near(p.x, angle.cos());
    near(p.y, angle.sin());
    joint.motor_speed = -8.0;
    e.world.set_revolute_joint(id, joint);
    tick(&mut e, 300);
    near(e.world.rotation(b).unwrap().radians, 13.0);
    // Live disable/enable preserves identity; moving past a bound while disabled is legal.
    joint.enabled = false;
    e.world.set_revolute_joint(id, joint);
    e.world.set_angular_velocity(
        b,
        AngularVelocity {
            radians_per_second: -8.0,
        },
    );
    tick(&mut e, 60);
    assert!(e.world.rotation(b).unwrap().radians < 6.0);
    joint.enabled = true;
    joint.break_torque = 0.1;
    e.world.set_revolute_joint(id, joint);
    tick(&mut e, 1);
    assert!(e.world.revolute_joint(id).is_none());
    assert!(e.world.physics_diagnostics.breaks.iter().any(|row| {
        row[0] == 3.0
            && row[1] == f64::from(id.index)
            && row[2] == f64::from(id.generation)
            && row[3] == 2.0
            && row[5] > 0.1
    }));
    tick(&mut e, 1);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 0);
}

#[test]
fn continuous_hinge_invalid_bounds_do_not_consume_any_body_input() {
    let mut e = engine([0.0; 3]);
    let a = body(&mut e, 0.0, 0.0, false);
    let b = body(&mut e, 0.0, 0.0, true);
    e.world.add_revolute_joint(
        c::RevoluteJoint::new(a, b)
            .with_angle_limits(20.0, 10.0)
            .with_continuous_limit(true),
    );
    e.world.apply_impulse(b, Velocity { vx: 3.0, vy: 0.0 });
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidJoint))
    );
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
    assert_eq!(e.world.rigid_body(b).unwrap().impulse.vx, 3.0);
}

#[test]
fn bounded_native_break_events_cannot_recreate_broken_legacy_joint_identities() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        max_events: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = body(&mut e, 0.0, 0.0, false);
    let mut ids = Vec::new();
    for i in 1..4 {
        let b = body(&mut e, i as f32 * 2.0, 0.0, true);
        let mut j = c::DistanceJoint::new(a, b, i as f32 * 2.0);
        j.break_force = 0.1;
        ids.push(e.world.add_distance_joint(j));
        e.world.apply_impulse(b, Velocity { vx: 10.0, vy: 0.0 });
    }
    tick(&mut e, 1);
    assert!(ids.iter().all(|id| e.world.distance_joint(*id).is_none()));
    assert_eq!(e.world.physics_diagnostics.breaks.len(), 1);
    assert_eq!(e.world.physics_diagnostics.breaks_dropped, 2);
    tick(&mut e, 5);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 0);
}

#[test]
fn existing_joint_diagnostic_buffer_reports_native_reaction_without_accumulating_frames() {
    let mut e = engine([0.0, -10.0, 0.0]);
    e.world.physics_diagnostics.enabled = true;
    let a = body(&mut e, 0.0, 0.0, false);
    let b = body(&mut e, 0.0, -2.0, true);
    let id = e.world.add_distance_joint(c::DistanceJoint::new(a, b, 2.0));
    tick(&mut e, 120);
    let rows = &e.world.physics_diagnostics.joints;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0][1], f64::from(id.index));
    assert_eq!(rows[0][2], f64::from(id.generation));
    assert!(rows[0][3] > 9.0 && rows[0][3] < 11.0, "{rows:?}");
    tick(&mut e, 1);
    assert_eq!(e.world.physics_diagnostics.joints.len(), 1);
}

#[test]
fn explicit_joint_removals_do_not_displace_solver_break_events() {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        max_events: 1,
        ..WorldConfig::default()
    })
    .unwrap();
    let a = body(&mut e, 0.0, 0.0, false);
    let mut ids = Vec::new();
    for i in 1..4 {
        let b = body(&mut e, i as f32 * 2.0, 0.0, true);
        ids.push((
            e.world
                .add_distance_joint(c::DistanceJoint::new(a, b, i as f32 * 2.0)),
            b,
        ));
    }
    tick(&mut e, 1);
    e.set_unified_physics_joint_events_enabled(true).unwrap();
    e.world.clear_distance_joint(ids[0].0);
    e.world.clear_distance_joint(ids[1].0);
    let mut breaking = e.world.distance_joint(ids[2].0).unwrap();
    breaking.break_force = 0.1;
    e.world.set_distance_joint(ids[2].0, breaking);
    e.world
        .apply_impulse(ids[2].1, Velocity { vx: 10.0, vy: 0.0 });
    tick(&mut e, 1);
    assert_eq!(e.world.physics_diagnostics.breaks.len(), 1);
    assert_eq!(
        e.world.physics_diagnostics.breaks[0][1],
        f64::from(ids[2].0.index)
    );
    assert_eq!(e.world.physics_diagnostics.breaks_dropped, 0);
    e.drain_unified_physics_joint_events().unwrap();
    assert_eq!(e.unified_physics_joints.events.len(), 1);
    assert_eq!(e.unified_physics_joints.events[0].code, 3); // Explicit removal retained for Web.
    assert_eq!(e.unified_physics_joint_dropped_native(), 1);
    assert_eq!(e.unified_physics_joint_dropped_events(), 1); // Solver break still reached legacy diagnostics.
}
