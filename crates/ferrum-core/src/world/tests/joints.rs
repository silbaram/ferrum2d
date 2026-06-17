use super::*;

#[test]
fn distance_joint_handles_add_update_clear_and_reuse_storage() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let first = world.add_distance_joint(DistanceJoint::new(a, b, 12.0).with_break_distance(3.0));

    assert_eq!(world.distance_joint_count(), 1);
    assert_eq!(
        world.distance_joint(first).map(|joint| joint.rest_length),
        Some(12.0)
    );
    assert_eq!(
        world
            .distance_joint(first)
            .map(|joint| joint.break_distance),
        Some(3.0)
    );

    world.set_distance_joint(
        first,
        DistanceJoint::new(a, b, 6.0)
            .with_break_distance(2.0)
            .without_break_distance()
            .with_damping(0.5),
    );

    assert_eq!(
        world.distance_joint(first).map(|joint| joint.rest_length),
        Some(6.0)
    );
    assert_eq!(
        world
            .distance_joint(first)
            .map(|joint| joint.break_distance),
        Some(f32::INFINITY)
    );
    assert_eq!(
        world.distance_joint(first).map(|joint| joint.damping),
        Some(0.5)
    );

    assert!(world.clear_distance_joint(first).is_some());
    assert_eq!(world.distance_joint(first), None);
    assert_eq!(world.distance_joint_count(), 0);

    let second = world.add_distance_joint(DistanceJoint::new(a, b, 4.0));

    assert_eq!(second.index, first.index);
    assert_ne!(second.generation, first.generation);
    assert_eq!(
        world.distance_joint(second).map(|joint| joint.rest_length),
        Some(4.0)
    );
}

#[test]
fn rope_joint_handles_add_update_clear_and_reuse_storage() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let first = world.add_rope_joint(RopeJoint::new(a, b, 12.0).with_break_distance(3.0));

    assert_eq!(world.rope_joint_count(), 1);
    assert_eq!(
        world.rope_joint(first).map(|joint| joint.max_length),
        Some(12.0)
    );
    assert_eq!(
        world.rope_joint(first).map(|joint| joint.break_distance),
        Some(3.0)
    );

    world.set_rope_joint(
        first,
        RopeJoint::new(a, b, 6.0)
            .with_break_distance(2.0)
            .without_break_distance()
            .with_damping(0.5),
    );

    assert_eq!(
        world.rope_joint(first).map(|joint| joint.max_length),
        Some(6.0)
    );
    assert_eq!(
        world.rope_joint(first).map(|joint| joint.break_distance),
        Some(f32::INFINITY)
    );
    assert_eq!(
        world.rope_joint(first).map(|joint| joint.damping),
        Some(0.5)
    );

    assert!(world.clear_rope_joint(first).is_some());
    assert_eq!(world.rope_joint(first), None);
    assert_eq!(world.rope_joint_count(), 0);

    let second = world.add_rope_joint(RopeJoint::new(a, b, 4.0));

    assert_eq!(second.index, first.index);
    assert_ne!(second.generation, first.generation);
    assert_eq!(
        world.rope_joint(second).map(|joint| joint.max_length),
        Some(4.0)
    );
}

#[test]
fn spring_joint_handles_add_update_clear_and_reuse_storage() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let first = world.add_spring_joint(SpringJoint::new(a, b, 12.0).with_break_distance(3.0));

    assert_eq!(world.spring_joint_count(), 1);
    assert_eq!(
        world.spring_joint(first).map(|joint| joint.rest_length),
        Some(12.0)
    );
    assert_eq!(
        world.spring_joint(first).map(|joint| joint.break_distance),
        Some(3.0)
    );

    world.set_spring_joint(
        first,
        SpringJoint::new(a, b, 6.0)
            .with_break_distance(2.0)
            .without_break_distance()
            .with_damping(0.5),
    );

    assert_eq!(
        world.spring_joint(first).map(|joint| joint.rest_length),
        Some(6.0)
    );
    assert_eq!(
        world.spring_joint(first).map(|joint| joint.break_distance),
        Some(f32::INFINITY)
    );
    assert_eq!(
        world.spring_joint(first).map(|joint| joint.damping),
        Some(0.5)
    );

    assert!(world.clear_spring_joint(first).is_some());
    assert_eq!(world.spring_joint(first), None);
    assert_eq!(world.spring_joint_count(), 0);

    let second = world.add_spring_joint(SpringJoint::new(a, b, 4.0));

    assert_eq!(second.index, first.index);
    assert_ne!(second.generation, first.generation);
    assert_eq!(
        world.spring_joint(second).map(|joint| joint.rest_length),
        Some(4.0)
    );
}

#[test]
fn pulley_joint_handles_add_update_clear_and_reuse_storage() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let first = world.add_pulley_joint(
        PulleyJoint::new(a, b, 12.0)
            .with_ground_anchor_a(-4.0, 2.0)
            .with_ground_anchor_b(4.0, 2.0)
            .with_ratio(2.0)
            .with_break_distance(3.0),
    );

    assert_eq!(world.pulley_joint_count(), 1);
    assert_eq!(
        world.pulley_joint(first).map(|joint| joint.rest_length),
        Some(12.0)
    );
    assert_eq!(
        world.pulley_joint(first).map(|joint| joint.ratio),
        Some(2.0)
    );
    assert_eq!(
        world.pulley_joint(first).map(|joint| (
            joint.ground_anchor_a_x,
            joint.ground_anchor_a_y,
            joint.ground_anchor_b_x,
            joint.ground_anchor_b_y,
        )),
        Some((-4.0, 2.0, 4.0, 2.0))
    );

    world.set_pulley_joint(
        first,
        PulleyJoint::new(a, b, 6.0)
            .with_ratio(1.5)
            .with_break_distance(2.0)
            .without_break_distance()
            .with_damping(0.5),
    );

    assert_eq!(
        world.pulley_joint(first).map(|joint| joint.rest_length),
        Some(6.0)
    );
    assert_eq!(
        world.pulley_joint(first).map(|joint| joint.break_distance),
        Some(f32::INFINITY)
    );
    assert_eq!(
        world.pulley_joint(first).map(|joint| joint.damping),
        Some(0.5)
    );

    assert!(world.clear_pulley_joint(first).is_some());
    assert_eq!(world.pulley_joint(first), None);
    assert_eq!(world.pulley_joint_count(), 0);

    let second = world.add_pulley_joint(PulleyJoint::new(a, b, 4.0));

    assert_eq!(second.index, first.index);
    assert_ne!(second.generation, first.generation);
    assert_eq!(
        world.pulley_joint(second).map(|joint| joint.rest_length),
        Some(4.0)
    );
}

#[test]
fn revolute_joint_handles_add_update_clear_and_reuse_storage() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let first = world.add_revolute_joint(
        RevoluteJoint::new(a, b)
            .with_local_anchor_a(1.0, 2.0)
            .with_local_anchor_b(3.0, 4.0)
            .with_break_distance(9.0)
            .with_angle_limits(-0.5, 0.75)
            .with_continuous_limit(true)
            .with_motor(2.0, 8.0),
    );

    assert_eq!(world.revolute_joint_count(), 1);
    assert_eq!(
        world.revolute_joint(first).map(|joint| (
            joint.local_anchor_a_x,
            joint.local_anchor_a_y,
            joint.local_anchor_b_x,
            joint.local_anchor_b_y,
        )),
        Some((1.0, 2.0, 3.0, 4.0))
    );
    assert_eq!(
        world
            .revolute_joint(first)
            .map(|joint| joint.break_distance),
        Some(9.0)
    );
    assert_eq!(
        world.revolute_joint(first).map(|joint| (
            joint.limit_enabled,
            joint.continuous_limit,
            joint.lower_angle,
            joint.upper_angle,
        )),
        Some((true, true, -0.5, 0.75))
    );
    assert_eq!(
        world.revolute_joint(first).map(|joint| (
            joint.motor_enabled,
            joint.motor_speed,
            joint.max_motor_torque,
        )),
        Some((true, 2.0, 8.0))
    );

    world.set_revolute_joint(
        first,
        RevoluteJoint::new(a, b)
            .with_local_anchor_a(6.0, 7.0)
            .with_break_distance(4.0)
            .without_break_distance()
            .with_angle_limits(-1.0, 1.0)
            .with_angle_limit_enabled(false)
            .with_continuous_limit(false)
            .with_motor(-3.0, 5.0)
            .with_motor_enabled(false)
            .with_damping(0.5),
    );

    assert_eq!(
        world
            .revolute_joint(first)
            .map(|joint| (joint.local_anchor_a_x, joint.local_anchor_a_y)),
        Some((6.0, 7.0))
    );
    assert_eq!(
        world.revolute_joint(first).map(|joint| joint.damping),
        Some(0.5)
    );
    assert_eq!(
        world
            .revolute_joint(first)
            .map(|joint| joint.break_distance),
        Some(f32::INFINITY)
    );
    assert_eq!(
        world.revolute_joint(first).map(|joint| (
            joint.limit_enabled,
            joint.continuous_limit,
            joint.lower_angle,
            joint.upper_angle,
        )),
        Some((false, false, -1.0, 1.0))
    );
    assert_eq!(
        world.revolute_joint(first).map(|joint| (
            joint.motor_enabled,
            joint.motor_speed,
            joint.max_motor_torque,
        )),
        Some((false, -3.0, 5.0))
    );

    assert!(world.clear_revolute_joint(first).is_some());
    assert_eq!(world.revolute_joint(first), None);
    assert_eq!(world.revolute_joint_count(), 0);

    let second = world.add_revolute_joint(RevoluteJoint::new(a, b));

    assert_eq!(second.index, first.index);
    assert_ne!(second.generation, first.generation);
    assert_eq!(
        world.revolute_joint(second).map(|joint| joint.entity_b),
        Some(b)
    );
}

#[test]
fn prismatic_joint_handles_add_update_clear_and_reuse_storage() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let first = world.add_prismatic_joint(
        PrismaticJoint::new(a, b)
            .with_local_anchor_a(1.0, 2.0)
            .with_local_anchor_b(3.0, 4.0)
            .with_local_axis_a(0.0, 1.0)
            .with_break_distance(9.0)
            .with_reference_angle(0.25)
            .with_translation_limits(-2.0, 8.0)
            .with_motor(3.0, 20.0),
    );

    assert_eq!(world.prismatic_joint_count(), 1);
    assert_eq!(
        world.prismatic_joint(first).map(|joint| (
            joint.local_anchor_a_x,
            joint.local_anchor_a_y,
            joint.local_anchor_b_x,
            joint.local_anchor_b_y,
        )),
        Some((1.0, 2.0, 3.0, 4.0))
    );
    assert_eq!(
        world.prismatic_joint(first).map(|joint| (
            joint.local_axis_a_x,
            joint.local_axis_a_y,
            joint.reference_angle,
        )),
        Some((0.0, 1.0, 0.25))
    );
    assert_eq!(
        world
            .prismatic_joint(first)
            .map(|joint| joint.break_distance),
        Some(9.0)
    );
    assert_eq!(
        world.prismatic_joint(first).map(|joint| (
            joint.limit_enabled,
            joint.lower_translation,
            joint.upper_translation,
        )),
        Some((true, -2.0, 8.0))
    );
    assert_eq!(
        world.prismatic_joint(first).map(|joint| (
            joint.motor_enabled,
            joint.motor_speed,
            joint.max_motor_force,
        )),
        Some((true, 3.0, 20.0))
    );

    world.set_prismatic_joint(
        first,
        PrismaticJoint::new(a, b)
            .with_local_axis_a(1.0, 0.0)
            .with_break_distance(4.0)
            .without_break_distance()
            .with_damping(0.5)
            .with_angular_damping(0.25)
            .with_translation_limits(-4.0, 4.0)
            .with_translation_limit_enabled(false)
            .with_motor(-2.0, 10.0)
            .with_motor_enabled(false),
    );

    assert_eq!(
        world
            .prismatic_joint(first)
            .map(|joint| (joint.local_axis_a_x, joint.local_axis_a_y)),
        Some((1.0, 0.0))
    );
    assert_eq!(
        world.prismatic_joint(first).map(|joint| joint.damping),
        Some(0.5)
    );
    assert_eq!(
        world
            .prismatic_joint(first)
            .map(|joint| joint.break_distance),
        Some(f32::INFINITY)
    );
    assert_eq!(
        world
            .prismatic_joint(first)
            .map(|joint| joint.angular_damping),
        Some(0.25)
    );
    assert_eq!(
        world.prismatic_joint(first).map(|joint| (
            joint.limit_enabled,
            joint.lower_translation,
            joint.upper_translation
        )),
        Some((false, -4.0, 4.0))
    );
    assert_eq!(
        world.prismatic_joint(first).map(|joint| (
            joint.motor_enabled,
            joint.motor_speed,
            joint.max_motor_force
        )),
        Some((false, -2.0, 10.0))
    );

    assert!(world.clear_prismatic_joint(first).is_some());
    assert_eq!(world.prismatic_joint(first), None);
    assert_eq!(world.prismatic_joint_count(), 0);

    let second = world.add_prismatic_joint(PrismaticJoint::new(a, b));

    assert_eq!(second.index, first.index);
    assert_ne!(second.generation, first.generation);
    assert_eq!(
        world.prismatic_joint(second).map(|joint| joint.entity_b),
        Some(b)
    );
}

#[test]
fn gear_joint_handles_add_update_clear_and_reuse_storage() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let first = world.add_gear_joint(
        GearJoint::new(a, b, 2.0)
            .with_reference_angle(0.5)
            .with_break_angle(0.75),
    );

    assert_eq!(world.gear_joint_count(), 1);
    assert_eq!(
        world.gear_joint(first).map(|joint| (
            joint.ratio,
            joint.reference_angle,
            joint.break_angle
        )),
        Some((2.0, 0.5, 0.75))
    );

    world.set_gear_joint(
        first,
        GearJoint::new(a, b, -3.0)
            .with_reference_angle(-0.25)
            .with_break_angle(0.5)
            .without_break_angle()
            .with_stiffness(0.25)
            .with_damping(0.75)
            .with_enabled(false),
    );

    assert_eq!(
        world.gear_joint(first).map(|joint| (
            joint.ratio,
            joint.reference_angle,
            joint.break_angle,
            joint.stiffness,
            joint.damping,
            joint.enabled,
        )),
        Some((-3.0, -0.25, f32::INFINITY, 0.25, 0.75, false))
    );

    assert!(world.clear_gear_joint(first).is_some());
    assert_eq!(world.gear_joint(first), None);
    assert_eq!(world.gear_joint_count(), 0);

    let second = world.add_gear_joint(GearJoint::new(a, b, 1.0));

    assert_eq!(second.index, first.index);
    assert_ne!(second.generation, first.generation);
    assert_eq!(
        world.gear_joint(second).map(|joint| joint.entity_b),
        Some(b)
    );
}
