use super::*;

#[test]
fn frequency_spring_response_is_mass_and_iteration_independent() {
    fn run(mass: f32, iterations: u32, dt: f32) -> (f32, f32) {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        let body = world.spawn_entity();
        world.set_transform(anchor, Transform2D::default());
        world.set_rigid_body(anchor, RigidBody::static_body());
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(mass).with_sleeping_enabled(false));
        world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_frequency(2.0, 1.0));
        for _ in 0..(1.0 / dt).round() as u32 {
            PhysicsSystem::step_rigid_bodies_with_config(
                &mut world,
                dt,
                RigidBodyStepConfig {
                    gravity: Velocity::default(),
                    velocity_iterations: iterations,
                    ..Default::default()
                },
            );
        }
        (
            world.transform(body).unwrap().x,
            world.velocity(body).unwrap().vx,
        )
    }
    let baseline = run(1.0, 1, 1.0 / 60.0);
    for mass in [0.1, 10.0, 100.0] {
        for iterations in [1, 4, 12] {
            let response = run(mass, iterations, 1.0 / 60.0);
            assert!(
                (response.0 - baseline.0).abs() < 0.002 && (response.1 - baseline.1).abs() < 0.002,
                "{mass}/{iterations}: {response:?} vs {baseline:?}"
            );
        }
    }
    for dt in [1.0 / 30.0, 1.0 / 120.0] {
        let response = run(1.0, 4, dt);
        assert!(
            (response.0 - 4.0).abs() < 0.02 && response.1.abs() < 0.1,
            "dt={dt}: {response:?}"
        );
    }
}

#[test]
fn spring_joint_pulls_stretched_body_toward_rest_length() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_stiffness(0.5));

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let velocity = world.velocity(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert!(
        (velocity.vx + 30.0).abs() < 0.001,
        "stretched spring should pull body toward the anchor, got {velocity:?}"
    );
    assert!(velocity.vy.abs() < 0.001);
    assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
}

#[test]
fn spring_joint_stiffness_is_split_across_velocity_iterations() {
    fn run_with_iterations(velocity_iterations: u32) -> (Velocity, RigidBodyStepStats) {
        let mut world = World::default();
        let anchor = world.spawn_entity();
        world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
        world.set_rigid_body(anchor, RigidBody::static_body());
        let body = world.spawn_entity();
        world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
        world.set_rigid_body(body, RigidBody::dynamic(1.0));
        world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_stiffness(0.5));

        let stats = PhysicsSystem::step_rigid_bodies_with_config(
            &mut world,
            0.1,
            RigidBodyStepConfig {
                gravity: Velocity::default(),
                velocity_iterations,
                position_iterations: 1,
                position_correction_percent: 0.0,
                position_correction_slop: 0.0,
                restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
                contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
                max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
                contact_split_impulse: false,
                continuous: true,
            },
        );

        (world.velocity(body).unwrap(), stats)
    }

    let (single_iteration_velocity, single_iteration_stats) = run_with_iterations(1);
    let (multi_iteration_velocity, multi_iteration_stats) = run_with_iterations(4);

    assert_eq!(single_iteration_stats.constraint_velocity_corrections, 1);
    assert_eq!(multi_iteration_stats.constraint_velocity_corrections, 4);
    assert!(
            (single_iteration_velocity.vx - multi_iteration_velocity.vx).abs() < 0.001,
            "spring stiffness should not scale with velocity iteration count: single={single_iteration_velocity:?}, multi={multi_iteration_velocity:?}"
        );
    assert!(
            (single_iteration_velocity.vy - multi_iteration_velocity.vy).abs() < 0.001,
            "spring stiffness should preserve axis velocity across iteration counts: single={single_iteration_velocity:?}, multi={multi_iteration_velocity:?}"
        );
}

#[test]
fn spring_joint_pushes_compressed_body_away_from_rest_length() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 2.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_stiffness(0.5));

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let velocity = world.velocity(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert!(
        (velocity.vx - 10.0).abs() < 0.001,
        "compressed spring should push body away from the anchor, got {velocity:?}"
    );
    assert!(velocity.vy.abs() < 0.001);
}

#[test]
fn spring_joint_damping_reduces_axis_relative_velocity_at_rest_length() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_spring_joint(
        SpringJoint::new(anchor, body, 4.0)
            .with_stiffness(0.0)
            .with_damping(0.5),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let velocity = world.velocity(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert!(
        (velocity.vx - 5.0).abs() < 0.001,
        "damped spring should reduce relative axis velocity, got {velocity:?}"
    );
    assert!(velocity.vy.abs() < 0.001);
}

#[test]
fn spring_joint_partial_stiffness_softens_combined_spring_and_damping_impulse() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_spring_joint(
        SpringJoint::new(anchor, body, 4.0)
            .with_stiffness(0.5)
            .with_damping(0.5),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let velocity = world.velocity(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert!(
        (velocity.vx + 27.5).abs() < 0.001,
        "partial stiffness should soften combined spring+damping impulse, got {velocity:?}"
    );
    assert!(velocity.vy.abs() < 0.001);
}

#[test]
fn spring_joint_damping_applies_angular_impulse_at_local_anchor() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 4.0, y: 0.0 });
    world.set_velocity(body, Velocity { vx: 10.0, vy: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_spring_joint(
        SpringJoint::new(anchor, body, (20.0_f32).sqrt())
            .with_local_anchor_b(0.0, 2.0)
            .with_stiffness(0.0)
            .with_damping(1.0),
    );

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let angular_velocity = world.angular_velocity(body).unwrap();
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert!(
        angular_velocity.radians_per_second > 0.001,
        "off-center spring anchor should transfer impulse into rotation, got {angular_velocity:?}"
    );
}

#[test]
fn spring_joint_breaks_when_stretch_error_exceeds_break_distance() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_break_distance(2.0));

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.broken_joints, 1);
    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(world.spring_joint_count(), 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 10.0, y: 0.0 }));
}

#[test]
fn spring_joint_breaks_when_compression_error_exceeds_break_distance() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 1.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_break_distance(2.0));

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.broken_joints, 1);
    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(world.spring_joint_count(), 0);
    assert_eq!(world.transform(body), Some(Transform2D { x: 1.0, y: 0.0 }));
}

#[test]
fn spring_joint_break_distance_allows_smaller_error() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 5.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    world.add_spring_joint(SpringJoint::new(anchor, body, 4.0).with_break_distance(2.0));

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.broken_joints, 0);
    assert_eq!(stats.constraint_velocity_corrections, 1);
    assert_eq!(world.spring_joint_count(), 1);
}

#[test]
fn spring_joint_clears_despawned_entities() {
    let mut world = World::default();
    let anchor = world.spawn_entity();
    world.set_transform(anchor, Transform2D { x: 0.0, y: 0.0 });
    world.set_rigid_body(anchor, RigidBody::static_body());
    let body = world.spawn_entity();
    world.set_transform(body, Transform2D { x: 10.0, y: 0.0 });
    world.set_rigid_body(body, RigidBody::dynamic(1.0));
    let joint = world.add_spring_joint(SpringJoint::new(anchor, body, 4.0));
    world.despawn(body);

    assert_eq!(world.spring_joint(joint), None);
    assert_eq!(world.spring_joint_count(), 0);

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 0.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    assert_eq!(stats.constraint_velocity_corrections, 0);
    assert_eq!(stats.constraint_position_corrections, 0);
    assert_eq!(world.spring_joint_count(), 0);
}
