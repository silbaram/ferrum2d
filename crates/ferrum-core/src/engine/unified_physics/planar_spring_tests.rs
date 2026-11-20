use super::*;
use crate::components as c;

fn setup(k: f32, damping: f32, mass: f32) -> (Engine, Entity, c::SpringJointId) {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let a = e.world.spawn_entity();
    let b = e.world.spawn_entity();
    e.world.set_transform(a, Transform2D { x: 0.0, y: 0.0 });
    e.world.set_transform(b, Transform2D { x: 3.0, y: 0.0 });
    e.world.set_rigid_body(a, c::RigidBody::static_body());
    let mut body = c::RigidBody::dynamic(mass);
    body.can_sleep = false;
    e.world.set_rigid_body(b, body);
    let id = e.world.add_spring_joint(
        c::SpringJoint::new(a, b, 2.0)
            .with_stiffness(k)
            .with_damping(damping),
    );
    (e, b, id)
}

fn tick(e: &mut Engine, n: usize) {
    for _ in 0..n {
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
    }
    assert_eq!(e.unified_physics_error(), None);
}

#[test]
fn normalized_spring_actual_engine_keeps_mass_independent_response() {
    let mut trajectories = Vec::new();
    for mass in [1.0, 100.0] {
        let (mut e, b, _) = setup(0.5, 0.8, mass);
        let mut values = Vec::new();
        for _ in 0..180 {
            tick(&mut e, 1);
            values.push(e.world.transform(b).unwrap().x);
        }
        assert!((values.last().unwrap() - 2.0).abs() < 0.002);
        trajectories.push(values);
    }
    for (a, b) in trajectories[0].iter().zip(&trajectories[1]) {
        assert!((a - b).abs() < 0.002);
    }
}

#[test]
fn normalized_spring_zero_stiffness_distinguishes_free_motion_and_pure_damping() {
    for damping in [0.0, 1.0] {
        let (mut e, b, _) = setup(0.0, damping, 1.0);
        e.world.set_velocity(b, Velocity { vx: 2.0, vy: 0.0 });
        tick(&mut e, 60);
        let x = e.world.transform(b).unwrap().x;
        let v = e.world.velocity(b).unwrap().vx;
        if damping == 0.0 {
            assert!((x - 5.0).abs() < 0.002);
            assert_eq!(v, 2.0);
        } else {
            assert!((3.0..3.04).contains(&x), "{x}");
            assert!(v.abs() < 0.001);
        }
    }
}

#[test]
fn normalized_spring_stiffness_and_damping_both_change_actual_response() {
    let (mut weak, bw, _) = setup(0.01, 0.0, 1.0);
    let (mut strong, bs, _) = setup(1.0, 0.0, 1.0);
    tick(&mut weak, 1);
    tick(&mut strong, 1);
    assert!(strong.world.transform(bs).unwrap().x < weak.world.transform(bw).unwrap().x - 0.05);
    let mut energies = Vec::new();
    for damping in [0.0, 1.0] {
        let (mut e, b, _) = setup(0.1, damping, 1.0);
        tick(&mut e, 30);
        let error = e.world.transform(b).unwrap().x - 2.0;
        let velocity = e.world.velocity(b).unwrap().vx;
        energies.push(velocity * velocity + 360.0 * error * error);
    }
    assert!(energies[1] < energies[0] * 0.3, "{energies:?}");
}

#[test]
fn normalized_spring_invalid_batch_keeps_impulses_and_body_capacity_untouched() {
    for (k, d) in [(-0.1, 0.0), (1.1, 0.0), (0.5, f32::NAN), (0.5, 1.1)] {
        let (mut e, b, _) = setup(k, d, 1.0);
        e.world.apply_impulse(b, Velocity { vx: 3.0, vy: 0.0 });
        e.update(f64::from(e.fixed_timestep.config().step_seconds));
        assert_eq!(
            e.unified_physics_error(),
            Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidJoint))
        );
        assert_eq!(e.unified_physics.as_ref().unwrap().physics.body_count(), 0);
        assert_eq!(e.world.rigid_body(b).unwrap().impulse.vx, 3.0);
    }
}

#[test]
fn normalized_spring_live_updates_frequency_switch_and_breaks_preserve_identity() {
    let (mut e, b, id) = setup(0.5, 0.8, 1.0);
    tick(&mut e, 120);
    let mut joint = e.world.spring_joint(id).unwrap();
    joint.enabled = false;
    e.world.set_spring_joint(id, joint);
    e.world.set_velocity(b, Velocity { vx: 2.0, vy: 0.0 });
    tick(&mut e, 60);
    assert!(e.world.transform(b).unwrap().x > 3.9);
    joint.enabled = true;
    joint.frequency_hz = Some(2.0);
    joint.damping_ratio = 1.0;
    e.world.set_spring_joint(id, joint);
    tick(&mut e, 180);
    assert!((e.world.transform(b).unwrap().x - 2.0).abs() < 0.002);
    joint.frequency_hz = None;
    joint.break_force = 0.1;
    e.world.set_spring_joint(id, joint);
    e.world.apply_impulse(b, Velocity { vx: 5.0, vy: 0.0 });
    tick(&mut e, 1);
    assert!(e.world.spring_joint(id).is_none());
    assert!(e
        .world
        .physics_diagnostics
        .breaks
        .iter()
        .any(|row| row[0] == 2.0
            && row[1] == f64::from(id.index)
            && row[2] == f64::from(id.generation)));
    tick(&mut e, 1);
    assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 0);
}

#[test]
fn normalized_gear_tuning_runs_in_engine_and_can_switch_to_rigid() {
    let (mut e, b, spring_id) = setup(0.0, 0.0, 1.0);
    let a = e.world.spring_joint(spring_id).unwrap().entity_a;
    e.world.clear_spring_joint(spring_id);
    e.world.set_rotation(b, Rotation2D { radians: 1.0 });
    let mut gear = c::GearJoint::new(a, b, 1.0)
        .with_stiffness(0.01)
        .with_damping(0.2);
    let id = e.world.add_gear_joint(gear);
    tick(&mut e, 240);
    assert!(e.world.rotation(b).unwrap().radians.abs() < 0.002);
    gear.stiffness = 0.0;
    gear.damping = 0.0;
    e.world.set_gear_joint(id, gear);
    e.world.set_angular_velocity(
        b,
        AngularVelocity {
            radians_per_second: 2.0,
        },
    );
    tick(&mut e, 60);
    assert!((e.world.rotation(b).unwrap().radians - 2.0).abs() < 0.002);
    gear.stiffness = 1.0;
    gear.damping = 1.0;
    e.world.set_gear_joint(id, gear);
    tick(&mut e, 120);
    assert!(e.world.rotation(b).unwrap().radians.abs() < 0.002);
    assert!(e.world.gear_joint(id).is_some());
}

#[test]
fn normalized_pulley_tuning_retains_elastic_stretch_in_engine() {
    let (mut e, b, spring_id) = setup(0.0, 0.0, 1.0);
    let a = e.world.spring_joint(spring_id).unwrap().entity_a;
    e.world.clear_spring_joint(spring_id);
    e.world.set_transform(a, Transform2D { x: -2.0, y: -2.0 });
    e.world.set_transform(b, Transform2D { x: 2.0, y: -2.0 });
    let mut rigid = c::RigidBody::dynamic(1.0);
    rigid.can_sleep = false;
    e.world.set_rigid_body(a, rigid);
    let id = e.world.add_pulley_joint(
        c::PulleyJoint::new(a, b, 4.0)
            .with_ground_anchor_a(-2.0, 0.0)
            .with_ground_anchor_b(2.0, 0.0)
            .with_stiffness(0.01)
            .with_damping(0.2),
    );
    for _ in 0..360 {
        // Existing World force inputs exercise the same one-tick consumption path.
        e.world.apply_force(a, Velocity { vx: 0.0, vy: -10.0 });
        e.world.apply_force(b, Velocity { vx: 0.0, vy: -10.0 });
        tick(&mut e, 1);
    }
    let distance = -e.world.transform(a).unwrap().y - e.world.transform(b).unwrap().y;
    assert!((distance - 4.0 - 20.0 / 36.0).abs() < 0.02, "{distance}");
    let mut joint = e.world.pulley_joint(id).unwrap();
    joint.stiffness = f32::NAN;
    e.world.set_pulley_joint(id, joint);
    e.world.apply_impulse(b, Velocity { vx: 0.0, vy: 3.0 });
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(
        e.unified_physics_error(),
        Some(UnifiedPhysicsError::Physics(PhysicsError::InvalidJoint))
    );
    assert_eq!(e.world.rigid_body(b).unwrap().impulse.vy, 3.0);
}

#[test]
fn normalized_distance_and_rope_tuning_run_in_engine_and_switch_to_rigid() {
    for rope in [false, true] {
        let (mut e, b, spring_id) = setup(0.0, 0.0, 1.0);
        let a = e.world.spring_joint(spring_id).unwrap().entity_a;
        e.world.clear_spring_joint(spring_id);
        let distance_id = if !rope {
            Some(
                e.world.add_distance_joint(
                    c::DistanceJoint::new(a, b, 2.0)
                        .with_stiffness(0.01)
                        .with_damping(0.2),
                ),
            )
        } else {
            None
        };
        let rope_id = if rope {
            Some(
                e.world.add_rope_joint(
                    c::RopeJoint::new(a, b, 2.0)
                        .with_stiffness(0.01)
                        .with_damping(0.2),
                ),
            )
        } else {
            None
        };
        for _ in 0..360 {
            e.world.apply_force(b, Velocity { vx: 10.0, vy: 0.0 });
            tick(&mut e, 1);
        }
        let x = e.world.transform(b).unwrap().x;
        assert!((x - 2.0 - 10.0 / 36.0).abs() < 0.01, "rope={rope}, x={x}");
        // Any valid damping is accepted at full stiffness; the coordinate is then rigid.
        if let Some(id) = distance_id {
            let mut j = e.world.distance_joint(id).unwrap();
            j.stiffness = 1.0;
            j.damping = 0.7;
            e.world.set_distance_joint(id, j);
        }
        if let Some(id) = rope_id {
            let mut j = e.world.rope_joint(id).unwrap();
            j.stiffness = 1.0;
            j.damping = 0.7;
            e.world.set_rope_joint(id, j);
        }
        // Keep the outward load: a rope can go slack when that load is removed.
        for _ in 0..120 {
            e.world.apply_force(b, Velocity { vx: 10.0, vy: 0.0 });
            tick(&mut e, 1);
        }
        assert!(
            (e.world.transform(b).unwrap().x - 2.0).abs() < 0.002,
            "rope={rope}, x={}",
            e.world.transform(b).unwrap().x
        );
        assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 1);
    }
}

#[test]
fn normalized_distance_and_rope_zero_gains_leave_body_motion_free() {
    for rope in [false, true] {
        let (mut e, b, spring_id) = setup(0.0, 0.0, 1.0);
        let a = e.world.spring_joint(spring_id).unwrap().entity_a;
        e.world.clear_spring_joint(spring_id);
        if rope {
            e.world.add_rope_joint(
                c::RopeJoint::new(a, b, 0.0)
                    .with_stiffness(0.0)
                    .with_damping(0.0),
            );
        } else {
            e.world.add_distance_joint(
                c::DistanceJoint::new(a, b, 0.0)
                    .with_stiffness(0.0)
                    .with_damping(0.0),
            );
        }
        e.world.set_velocity(b, Velocity { vx: 2.0, vy: 1.0 });
        tick(&mut e, 60);
        let p = e.world.transform(b).unwrap();
        assert!(
            (p.x - 5.0).abs() < 0.002 && (p.y - 1.0).abs() < 0.002,
            "{p:?}"
        );
    }
}

#[test]
fn full_stiffness_hinge_slider_and_weld_accept_any_valid_damping() {
    for kind in 0..3 {
        let (mut e, b, spring_id) = setup(0.0, 0.0, 1.0);
        let a = e.world.spring_joint(spring_id).unwrap().entity_a;
        e.world.clear_spring_joint(spring_id);
        match kind {
            0 => {
                e.world
                    .add_revolute_joint(c::RevoluteJoint::new(a, b).with_damping(0.3));
            }
            1 => {
                e.world.add_prismatic_joint(
                    c::PrismaticJoint::new(a, b)
                        .with_damping(0.3)
                        .with_angular_damping(0.2),
                );
            }
            _ => {
                e.world.add_weld_joint(
                    c::WeldJoint::new(a, b)
                        .with_damping(0.3)
                        .with_angular_damping(0.2),
                );
            }
        }
        tick(&mut e, 180);
        assert_eq!(e.unified_physics.as_ref().unwrap().physics.joint_count(), 1);
        let p = e.world.transform(b).unwrap();
        if kind == 1 {
            assert!((p.x - 3.0).abs() < 0.002);
        } else {
            assert!(p.x.abs() < 0.002);
        }
        assert!(p.y.abs() < 0.002);
    }
}
