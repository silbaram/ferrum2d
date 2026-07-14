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

#[test]
fn despawn_clears_all_connected_joint_types_and_reuses_their_handles() {
    let mut world = World::default();
    let removed = world.spawn_entity();
    let connected = world.spawn_entity();
    let unrelated_a = world.spawn_entity();
    let unrelated_b = world.spawn_entity();
    let unconnected = world.spawn_entity();

    let distance = world.add_distance_joint(DistanceJoint::new(removed, connected, 8.0));
    let rope = world.add_rope_joint(RopeJoint::new(connected, removed, 8.0));
    let spring = world.add_spring_joint(SpringJoint::new(removed, connected, 8.0));
    let pulley = world.add_pulley_joint(PulleyJoint::new(connected, removed, 8.0));
    let revolute = world.add_revolute_joint(RevoluteJoint::new(removed, connected));
    let prismatic = world.add_prismatic_joint(PrismaticJoint::new(connected, removed));
    let weld = world.add_weld_joint(WeldJoint::new(removed, connected));
    let gear = world.add_gear_joint(GearJoint::new(connected, removed, 1.0));
    let unrelated_distance =
        world.add_distance_joint(DistanceJoint::new(unrelated_a, unrelated_b, 4.0));

    assert!(world.has_incident_joints(removed));
    assert!(world.has_incident_joints(connected));
    assert!(world.has_incident_joints(unrelated_a));
    assert!(world.has_incident_joints(unrelated_b));
    assert!(!world.has_incident_joints(unconnected));

    world.despawn(unconnected);
    assert!(world.distance_joint(distance).is_some());
    assert!(world.gear_joint(gear).is_some());

    world.despawn(Entity {
        id: removed.id,
        generation: removed.generation + 1,
    });

    assert!(world.distance_joint(distance).is_some());
    assert!(world.rope_joint(rope).is_some());
    assert!(world.spring_joint(spring).is_some());
    assert!(world.pulley_joint(pulley).is_some());
    assert!(world.revolute_joint(revolute).is_some());
    assert!(world.prismatic_joint(prismatic).is_some());
    assert!(world.weld_joint(weld).is_some());
    assert!(world.gear_joint(gear).is_some());
    assert!(world.has_incident_joints(removed));

    world.despawn(removed);

    assert_eq!(world.distance_joint(distance), None);
    assert_eq!(world.rope_joint(rope), None);
    assert_eq!(world.spring_joint(spring), None);
    assert_eq!(world.pulley_joint(pulley), None);
    assert_eq!(world.revolute_joint(revolute), None);
    assert_eq!(world.prismatic_joint(prismatic), None);
    assert_eq!(world.weld_joint(weld), None);
    assert_eq!(world.gear_joint(gear), None);
    assert!(world.distance_joint(unrelated_distance).is_some());
    assert_eq!(world.distance_joint_count(), 1);
    assert_eq!(world.rope_joint_count(), 0);
    assert_eq!(world.spring_joint_count(), 0);
    assert_eq!(world.pulley_joint_count(), 0);
    assert_eq!(world.revolute_joint_count(), 0);
    assert_eq!(world.prismatic_joint_count(), 0);
    assert_eq!(world.weld_joint_count(), 0);
    assert_eq!(world.gear_joint_count(), 0);
    assert!(!world.has_incident_joints(removed));
    assert!(!world.has_incident_joints(connected));
    assert!(world.has_incident_joints(unrelated_a));
    assert!(world.has_incident_joints(unrelated_b));

    let replacement = world.spawn_entity();
    assert_eq!(replacement.id, removed.id);
    assert_ne!(replacement.generation, removed.generation);
    assert!(!world.has_incident_joints(replacement));

    let next_distance = world.add_distance_joint(DistanceJoint::new(replacement, connected, 6.0));
    let next_rope = world.add_rope_joint(RopeJoint::new(replacement, connected, 6.0));
    let next_spring = world.add_spring_joint(SpringJoint::new(replacement, connected, 6.0));
    let next_pulley = world.add_pulley_joint(PulleyJoint::new(replacement, connected, 6.0));
    let next_revolute = world.add_revolute_joint(RevoluteJoint::new(replacement, connected));
    let next_prismatic = world.add_prismatic_joint(PrismaticJoint::new(replacement, connected));
    let next_weld = world.add_weld_joint(WeldJoint::new(replacement, connected));
    let next_gear = world.add_gear_joint(GearJoint::new(replacement, connected, 1.0));

    assert!(world.has_incident_joints(replacement));
    assert!(world.has_incident_joints(connected));

    assert_eq!(next_distance.index, distance.index);
    assert_ne!(next_distance.generation, distance.generation);
    assert_eq!(next_rope.index, rope.index);
    assert_ne!(next_rope.generation, rope.generation);
    assert_eq!(next_spring.index, spring.index);
    assert_ne!(next_spring.generation, spring.generation);
    assert_eq!(next_pulley.index, pulley.index);
    assert_ne!(next_pulley.generation, pulley.generation);
    assert_eq!(next_revolute.index, revolute.index);
    assert_ne!(next_revolute.generation, revolute.generation);
    assert_eq!(next_prismatic.index, prismatic.index);
    assert_ne!(next_prismatic.generation, prismatic.generation);
    assert_eq!(next_weld.index, weld.index);
    assert_ne!(next_weld.generation, weld.generation);
    assert_eq!(next_gear.index, gear.index);
    assert_ne!(next_gear.generation, gear.generation);
}

#[test]
fn incident_joint_gate_tracks_endpoint_updates_snapshot_restore_and_clear_capacity() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let unconnected = world.spawn_entity();

    assert!(!world.has_incident_joints(a));
    assert!(!world.has_incident_joints(b));
    assert!(!world.has_incident_joints(unconnected));

    let moved = world.add_distance_joint(DistanceJoint::new(a, b, 4.0));
    assert!(world.has_incident_joints(a));
    assert!(world.has_incident_joints(b));
    assert!(world.try_set_distance_joint(moved, DistanceJoint::new(unconnected, b, 6.0)));
    assert!(!world.has_incident_joints(a));
    assert!(world.has_incident_joints(b));
    assert!(world.has_incident_joints(unconnected));
    assert!(world.clear_distance_joint(moved).is_some());
    assert!(!world.has_incident_joints(a));
    assert!(!world.has_incident_joints(b));
    assert!(!world.has_incident_joints(unconnected));

    world.add_distance_joint(DistanceJoint::new(a, b, 4.0));
    world.add_rope_joint(RopeJoint::new(a, b, 4.0));
    world.add_spring_joint(SpringJoint::new(a, b, 4.0));
    world.add_pulley_joint(PulleyJoint::new(a, b, 4.0));
    world.add_revolute_joint(RevoluteJoint::new(a, b));
    world.add_prismatic_joint(PrismaticJoint::new(a, b));
    world.add_weld_joint(WeldJoint::new(a, b));
    world.add_gear_joint(GearJoint::new(a, b, 1.0));

    assert!(world.has_incident_joints(a));
    assert!(world.has_incident_joints(b));
    assert!(!world.has_incident_joints(unconnected));
    assert_joint_free_list_clear_capacity(&world);

    let snapshot = world.snapshot();

    world.despawn(unconnected);
    assert_eq!(world.distance_joint_count(), 1);
    assert_eq!(world.rope_joint_count(), 1);
    assert_eq!(world.spring_joint_count(), 1);
    assert_eq!(world.pulley_joint_count(), 1);
    assert_eq!(world.revolute_joint_count(), 1);
    assert_eq!(world.prismatic_joint_count(), 1);
    assert_eq!(world.weld_joint_count(), 1);
    assert_eq!(world.gear_joint_count(), 1);

    world.clear_distance_joints();
    world.clear_rope_joints();
    world.clear_spring_joints();
    world.clear_pulley_joints();
    world.clear_revolute_joints();
    world.clear_prismatic_joints();
    world.clear_weld_joints();
    world.clear_gear_joints();

    assert!(!world.has_incident_joints(a));
    assert!(!world.has_incident_joints(b));

    world.restore_snapshot(&snapshot);

    assert!(world.has_incident_joints(a));
    assert!(world.has_incident_joints(b));
    assert!(!world.has_incident_joints(unconnected));
    assert_joint_free_list_clear_capacity(&world);
}

#[test]
fn all_joint_setters_move_incident_membership_to_new_endpoints() {
    let mut world = World::default();
    let previous = world.spawn_entity();
    let shared = world.spawn_entity();
    let replacement = world.spawn_entity();

    let distance = world.add_distance_joint(DistanceJoint::new(previous, shared, 4.0));
    let rope = world.add_rope_joint(RopeJoint::new(previous, shared, 4.0));
    let spring = world.add_spring_joint(SpringJoint::new(previous, shared, 4.0));
    let pulley = world.add_pulley_joint(PulleyJoint::new(previous, shared, 4.0));
    let revolute = world.add_revolute_joint(RevoluteJoint::new(previous, shared));
    let prismatic = world.add_prismatic_joint(PrismaticJoint::new(previous, shared));
    let weld = world.add_weld_joint(WeldJoint::new(previous, shared));
    let gear = world.add_gear_joint(GearJoint::new(previous, shared, 1.0));

    assert!(world.try_set_distance_joint(distance, DistanceJoint::new(replacement, shared, 6.0)));
    assert!(world.try_set_rope_joint(rope, RopeJoint::new(replacement, shared, 6.0)));
    assert!(world.try_set_spring_joint(spring, SpringJoint::new(replacement, shared, 6.0)));
    assert!(world.try_set_pulley_joint(pulley, PulleyJoint::new(replacement, shared, 6.0)));
    assert!(world.try_set_revolute_joint(revolute, RevoluteJoint::new(replacement, shared)));
    assert!(world.try_set_prismatic_joint(prismatic, PrismaticJoint::new(replacement, shared)));
    assert!(world.try_set_weld_joint(weld, WeldJoint::new(replacement, shared)));
    assert!(world.try_set_gear_joint(gear, GearJoint::new(replacement, shared, 1.0)));

    assert!(!world.has_incident_joints(previous));
    assert!(world.has_incident_joints(shared));
    assert!(world.has_incident_joints(replacement));

    world.despawn(previous);

    assert_eq!(world.distance_joint_count(), 1);
    assert_eq!(world.rope_joint_count(), 1);
    assert_eq!(world.spring_joint_count(), 1);
    assert_eq!(world.pulley_joint_count(), 1);
    assert_eq!(world.revolute_joint_count(), 1);
    assert_eq!(world.prismatic_joint_count(), 1);
    assert_eq!(world.weld_joint_count(), 1);
    assert_eq!(world.gear_joint_count(), 1);

    world.despawn(replacement);

    assert_eq!(world.distance_joint_count(), 0);
    assert_eq!(world.rope_joint_count(), 0);
    assert_eq!(world.spring_joint_count(), 0);
    assert_eq!(world.pulley_joint_count(), 0);
    assert_eq!(world.revolute_joint_count(), 0);
    assert_eq!(world.prismatic_joint_count(), 0);
    assert_eq!(world.weld_joint_count(), 0);
    assert_eq!(world.gear_joint_count(), 0);
    assert!(!world.has_incident_joints(shared));
}

#[test]
fn checked_joint_mutation_rejects_non_current_endpoints_without_storage_changes() {
    let mut world = World::default();
    let a = world.spawn_entity();
    let b = world.spawn_entity();
    let future = Entity {
        id: 2,
        generation: 0,
    };

    assert_eq!(
        world.try_add_distance_joint(DistanceJoint::new(a, future, 4.0)),
        None
    );
    assert_eq!(
        world.try_add_rope_joint(RopeJoint::new(a, future, 4.0)),
        None
    );
    assert_eq!(
        world.try_add_spring_joint(SpringJoint::new(a, future, 4.0)),
        None
    );
    assert_eq!(
        world.try_add_pulley_joint(PulleyJoint::new(a, future, 4.0)),
        None
    );
    assert_eq!(
        world.try_add_revolute_joint(RevoluteJoint::new(a, future)),
        None
    );
    assert_eq!(
        world.try_add_prismatic_joint(PrismaticJoint::new(a, future)),
        None
    );
    assert_eq!(world.try_add_weld_joint(WeldJoint::new(a, future)), None);
    assert_eq!(
        world.try_add_gear_joint(GearJoint::new(a, future, 1.0)),
        None
    );
    assert_eq!(world.distance_joint_count(), 0);
    assert_eq!(world.rope_joint_count(), 0);
    assert_eq!(world.spring_joint_count(), 0);
    assert_eq!(world.pulley_joint_count(), 0);
    assert_eq!(world.revolute_joint_count(), 0);
    assert_eq!(world.prismatic_joint_count(), 0);
    assert_eq!(world.weld_joint_count(), 0);
    assert_eq!(world.gear_joint_count(), 0);
    assert!(!world.has_incident_joints(a));

    let spawned_future = world.spawn_entity();
    assert_eq!(spawned_future, future);
    world.despawn(spawned_future);

    let distance = world.add_distance_joint(DistanceJoint::new(a, b, 4.0));
    let rope = world.add_rope_joint(RopeJoint::new(a, b, 4.0));
    let spring = world.add_spring_joint(SpringJoint::new(a, b, 4.0));
    let pulley = world.add_pulley_joint(PulleyJoint::new(a, b, 4.0));
    let revolute = world.add_revolute_joint(RevoluteJoint::new(a, b));
    let prismatic = world.add_prismatic_joint(PrismaticJoint::new(a, b));
    let weld = world.add_weld_joint(WeldJoint::new(a, b));
    let gear = world.add_gear_joint(GearJoint::new(a, b, 1.0));
    let another_future = Entity {
        id: 3,
        generation: 0,
    };

    assert!(!world.try_set_distance_joint(distance, DistanceJoint::new(another_future, b, 6.0)));
    assert!(!world.try_set_rope_joint(rope, RopeJoint::new(another_future, b, 6.0)));
    assert!(!world.try_set_spring_joint(spring, SpringJoint::new(another_future, b, 6.0)));
    assert!(!world.try_set_pulley_joint(pulley, PulleyJoint::new(another_future, b, 6.0)));
    assert!(!world.try_set_revolute_joint(revolute, RevoluteJoint::new(another_future, b)));
    assert!(!world.try_set_prismatic_joint(prismatic, PrismaticJoint::new(another_future, b)));
    assert!(!world.try_set_weld_joint(weld, WeldJoint::new(another_future, b)));
    assert!(!world.try_set_gear_joint(gear, GearJoint::new(another_future, b, 1.0)));
    assert!(world.has_incident_joints(a));
    assert!(world.has_incident_joints(b));
    assert!(!world.has_incident_joints(another_future));

    world.despawn(a);

    assert_eq!(world.distance_joint_count(), 0);
    assert_eq!(world.rope_joint_count(), 0);
    assert_eq!(world.spring_joint_count(), 0);
    assert_eq!(world.pulley_joint_count(), 0);
    assert_eq!(world.revolute_joint_count(), 0);
    assert_eq!(world.prismatic_joint_count(), 0);
    assert_eq!(world.weld_joint_count(), 0);
    assert_eq!(world.gear_joint_count(), 0);

    assert_eq!(
        world.try_add_distance_joint(DistanceJoint::new(spawned_future, b, 4.0)),
        None
    );
    let panic_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        world.add_distance_joint(DistanceJoint::new(spawned_future, b, 4.0));
    }));
    assert!(panic_result.is_err());
    assert_eq!(world.distance_joint_count(), 0);
    assert!(!world.has_incident_joints(b));
}

fn assert_joint_free_list_clear_capacity(world: &World) {
    assert!(world.distance_joint_free_list.capacity() >= world.distance_joints.len());
    assert!(world.rope_joint_free_list.capacity() >= world.rope_joints.len());
    assert!(world.spring_joint_free_list.capacity() >= world.spring_joints.len());
    assert!(world.pulley_joint_free_list.capacity() >= world.pulley_joints.len());
    assert!(world.revolute_joint_free_list.capacity() >= world.revolute_joints.len());
    assert!(world.prismatic_joint_free_list.capacity() >= world.prismatic_joints.len());
    assert!(world.weld_joint_free_list.capacity() >= world.weld_joints.len());
    assert!(world.gear_joint_free_list.capacity() >= world.gear_joints.len());
}
