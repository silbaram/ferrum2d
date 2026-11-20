use super::*;
use crate::components as c;

fn setup() -> (Engine, Entity, Entity) {
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
    for entity in [a, b] {
        e.world
            .set_transform(entity, Transform2D { x: 0.0, y: 0.0 });
    }
    e.world.set_rigid_body(a, c::RigidBody::static_body());
    let mut body = c::RigidBody::dynamic(1.0);
    body.can_sleep = false;
    body.inertia = 1.0;
    e.world.set_rigid_body(b, body);
    (e, a, b)
}

fn tick(e: &mut Engine) {
    e.update(f64::from(e.fixed_timestep.config().step_seconds));
    assert_eq!(e.unified_physics_error(), None);
}

fn near(actual: f32, expected: f32) {
    assert!((actual - expected).abs() < 0.003, "{actual} != {expected}");
}

#[test]
fn planar_frame_tuning_produces_independent_linear_and_angular_stretch_in_engine() {
    for slider in [false, true] {
        let (mut e, a, b) = setup();
        if slider {
            e.world.add_prismatic_joint(
                c::PrismaticJoint::new(a, b)
                    .with_stiffness(0.01)
                    .with_damping(0.2)
                    .with_angular_stiffness(0.04)
                    .with_angular_damping(0.4),
            );
        } else {
            e.world.add_weld_joint(
                c::WeldJoint::new(a, b)
                    .with_stiffness(0.01)
                    .with_damping(0.2)
                    .with_angular_stiffness(0.04)
                    .with_angular_damping(0.4),
            );
        }
        for _ in 0..300 {
            e.world.apply_force(b, Velocity { vx: 0.0, vy: 3.6 });
            e.world.apply_torque(b, 28.8);
            tick(&mut e);
        }
        near(e.world.transform(b).unwrap().y, 0.1);
        near(e.world.rotation(b).unwrap().radians, 0.2);
        near(e.world.velocity(b).unwrap().vy, 0.0);
        near(e.world.angular_velocity(b).unwrap().radians_per_second, 0.0);
    }
}

#[test]
fn planar_soft_hinge_preserves_normal_and_continuous_limits_and_motor() {
    for continuous in [false, true] {
        let (mut e, a, b) = setup();
        let center = if continuous {
            4.0 * std::f32::consts::TAU
        } else {
            0.0
        };
        e.world.set_rotation(b, c::Rotation2D { radians: center });
        e.world.add_revolute_joint(
            c::RevoluteJoint::new(a, b)
                .with_stiffness(0.01)
                .with_damping(0.2)
                .with_angle_limits(center - 0.3, center + 0.4)
                .with_continuous_limit(continuous)
                .with_motor(1.0, 10.0),
        );
        for _ in 0..300 {
            e.world.apply_force(b, Velocity { vx: 3.6, vy: 0.0 });
            tick(&mut e);
        }
        near(e.world.transform(b).unwrap().x, 0.1);
        near(e.world.rotation(b).unwrap().radians, center + 0.4);
        near(e.world.angular_velocity(b).unwrap().radians_per_second, 0.0);
    }
}

#[test]
fn planar_frame_zero_angular_gain_releases_rotation_and_live_rigid_update_restores_it() {
    let (mut e, a, b) = setup();
    let mut joint = c::WeldJoint::new(a, b)
        .with_angular_stiffness(0.0)
        .with_angular_damping(0.0);
    let id = e.world.add_weld_joint(joint);
    e.world.set_velocity(b, Velocity { vx: 1.0, vy: 0.0 });
    e.world.set_angular_velocity(
        b,
        c::AngularVelocity {
            radians_per_second: 1.0,
        },
    );
    for _ in 0..60 {
        tick(&mut e);
    }
    near(e.world.transform(b).unwrap().x, 0.0);
    near(e.world.rotation(b).unwrap().radians, 1.0);
    joint.angular_stiffness = 1.0;
    e.world.set_weld_joint(id, joint);
    for _ in 0..120 {
        tick(&mut e);
    }
    near(e.world.rotation(b).unwrap().radians, 0.0);
    assert!(e.world.weld_joint(id).is_some());
}

#[test]
fn invalid_planar_angular_response_keeps_all_body_inputs_unconsumed() {
    let (mut e, a, b) = setup();
    e.world
        .add_prismatic_joint(c::PrismaticJoint::new(a, b).with_angular_damping(f32::NAN));
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
fn planar_soft_slider_keeps_its_rotated_axis_and_motor_limits() {
    let (mut e, a, b) = setup();
    e.world.add_prismatic_joint(
        c::PrismaticJoint::new(a, b)
            .with_local_axis_a(0.0, 1.0)
            .with_reference_angle(0.4)
            .with_translation_limits(-0.3, 0.4)
            .with_motor(1.0, 10.0)
            .with_stiffness(0.01)
            .with_damping(0.2)
            .with_angular_stiffness(0.01)
            .with_angular_damping(0.2),
    );
    for _ in 0..300 {
        e.world.apply_force(b, Velocity { vx: 3.6, vy: 0.0 });
        tick(&mut e);
    }
    near(e.world.transform(b).unwrap().x, 0.1);
    near(e.world.transform(b).unwrap().y, 0.4);
    near(e.world.rotation(b).unwrap().radians, 0.4);
    near(e.world.velocity(b).unwrap().vy, 0.0);
}
