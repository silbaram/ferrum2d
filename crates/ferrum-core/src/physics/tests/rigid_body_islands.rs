use super::*;
use crate::collision::CollisionPair;

#[test]
fn rigid_body_island_stats_reports_active_and_sleeping_islands() {
    let mut world = World::default();
    spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    let sleeping = spawn_dynamic_body(&mut world, 40.0, 0.0, 2.0);
    let static_body = spawn_dynamic_body(&mut world, 80.0, 0.0, 2.0);
    let disabled = spawn_dynamic_body(&mut world, 120.0, 0.0, 2.0);

    let mut sleeping_body = RigidBody::dynamic(1.0);
    sleeping_body.is_sleeping = true;
    sleeping_body.sleep_timer_seconds = 0.5;
    world.set_rigid_body(sleeping, sleeping_body);
    world.set_rigid_body(static_body, RigidBody::static_body());
    world.set_rigid_body(disabled, RigidBody::dynamic(1.0).with_enabled(false));

    assert_eq!(
        PhysicsSystem::analyze_rigid_body_islands(&world),
        RigidBodyIslandStats {
            island_count: 2,
            island_bodies: 2,
            active_islands: 1,
            sleeping_islands: 1,
            largest_island_bodies: 1,
        }
    );
}

#[test]
fn rigid_body_island_stats_unions_contacts_and_enabled_joints() {
    let mut world = World::default();
    spawn_dynamic_body(&mut world, 0.0, 0.0, 5.0);
    spawn_dynamic_body(&mut world, 8.0, 0.0, 5.0);
    let joint_a = spawn_dynamic_body(&mut world, 40.0, 0.0, 2.0);
    let joint_b = spawn_dynamic_body(&mut world, 70.0, 0.0, 2.0);
    spawn_dynamic_body(&mut world, 110.0, 0.0, 2.0);
    world.add_distance_joint(DistanceJoint::new(joint_a, joint_b, 30.0));

    assert_eq!(
        PhysicsSystem::analyze_rigid_body_islands(&world),
        RigidBodyIslandStats {
            island_count: 3,
            island_bodies: 5,
            active_islands: 3,
            sleeping_islands: 0,
            largest_island_bodies: 2,
        }
    );
}

#[test]
fn rigid_body_island_schedule_groups_contacts_and_joints() {
    let mut world = World::default();
    let contact_a = spawn_dynamic_body(&mut world, 0.0, 0.0, 5.0);
    let contact_b = spawn_dynamic_body(&mut world, 8.0, 0.0, 5.0);
    let static_contact_body = spawn_dynamic_body(&mut world, 40.0, 0.0, 2.0);
    let static_wall = spawn_kinematic_body(&mut world, 43.0, 0.0, CollisionLayer::Wall, false);
    world.set_rigid_body(static_wall, RigidBody::static_body());
    let joint_a = spawn_dynamic_body(&mut world, 80.0, 0.0, 2.0);
    let joint_b = spawn_dynamic_body(&mut world, 90.0, 0.0, 2.0);
    let isolated = spawn_dynamic_body(&mut world, 130.0, 0.0, 2.0);
    world.add_distance_joint(DistanceJoint::new(joint_a, joint_b, 10.0));

    let constraints = build_rigid_contact_constraints(&world);
    let schedule = RigidBodyIslandSchedule::from_world_and_contacts(&world, &constraints);
    let contact_root = schedule
        .root_for_pair_indices(contact_a.id as usize, contact_b.id as usize)
        .expect("overlapping dynamic bodies should share a contact island");
    let static_contact_root = schedule
        .root_for_pair_indices(static_contact_body.id as usize, static_wall.id as usize)
        .expect("dynamic-static contact should use the dynamic body island");
    let joint_root = schedule
        .root_for_pair_indices(joint_a.id as usize, joint_b.id as usize)
        .expect("joint-connected dynamic bodies should share an island");
    let isolated_root = schedule
        .entity_root(isolated.id as usize)
        .expect("enabled isolated dynamic body should still have an island root");

    assert_eq!(schedule.roots().count(), 4);
    assert_ne!(contact_root, static_contact_root);
    assert_ne!(contact_root, joint_root);
    assert_ne!(contact_root, isolated_root);
    assert!(schedule.pair_in_island(
        CollisionPair {
            a: contact_a,
            b: contact_b,
        },
        contact_root,
    ));
    assert!(schedule.joint_in_island(joint_a, joint_b, joint_root));
    assert!(schedule.pair_in_island(
        CollisionPair {
            a: static_contact_body,
            b: static_wall,
        },
        static_contact_root,
    ));
    assert!(!schedule.pair_in_island(
        CollisionPair {
            a: contact_a,
            b: contact_b,
        },
        joint_root,
    ));
}

#[test]
fn rigid_body_joint_island_buckets_group_enabled_joint_indices_by_island() {
    let mut world = World::default();
    let joint_a = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    let joint_b = spawn_dynamic_body(&mut world, 10.0, 0.0, 2.0);
    let static_a = spawn_dynamic_body(&mut world, 40.0, 0.0, 2.0);
    let static_b = spawn_dynamic_body(&mut world, 50.0, 0.0, 2.0);
    world.set_rigid_body(static_a, RigidBody::static_body());
    world.set_rigid_body(static_b, RigidBody::static_body());

    let distance_id = world.add_distance_joint(DistanceJoint::new(joint_a, joint_b, 10.0));
    world.add_distance_joint(DistanceJoint::new(joint_a, joint_b, 10.0).with_enabled(false));
    world.add_distance_joint(DistanceJoint::new(joint_a, joint_a, 0.0));
    world.add_distance_joint(DistanceJoint::new(static_a, static_b, 10.0));
    let rope_id = world.add_rope_joint(RopeJoint::new(joint_a, static_a, 12.0));
    let spring_id = world.add_spring_joint(SpringJoint::new(joint_a, joint_b, 10.0));
    let pulley_id = world.add_pulley_joint(PulleyJoint::new(joint_a, joint_b, 20.0));
    let revolute_id = world.add_revolute_joint(RevoluteJoint::new(joint_a, joint_b));
    let prismatic_id = world.add_prismatic_joint(PrismaticJoint::new(joint_a, joint_b));
    let weld_id = world.add_weld_joint(WeldJoint::new(joint_a, joint_b));
    let gear_id = world.add_gear_joint(GearJoint::new(joint_a, joint_b, 1.0));

    let constraints = build_rigid_contact_constraints(&world);
    let schedule = RigidBodyIslandSchedule::from_world_and_contacts(&world, &constraints);
    let buckets = RigidBodyJointIslandBuckets::from_world_and_schedule(&world, &schedule);
    let island_root = schedule
        .root_for_pair_indices(joint_a.id as usize, joint_b.id as usize)
        .expect("joint-connected dynamic bodies should share an island");
    let island = schedule
        .islands()
        .find(|island| island.root() == island_root)
        .expect("joint island should be scheduled");

    assert_eq!(buckets.distance(island), &[distance_id.index as usize]);
    assert_eq!(buckets.rope(island), &[rope_id.index as usize]);
    assert_eq!(buckets.spring(island), &[spring_id.index as usize]);
    assert_eq!(buckets.pulley(island), &[pulley_id.index as usize]);
    assert_eq!(buckets.revolute(island), &[revolute_id.index as usize]);
    assert_eq!(buckets.prismatic(island), &[prismatic_id.index as usize]);
    assert_eq!(buckets.weld(island), &[weld_id.index as usize]);
    assert_eq!(buckets.gear(island), &[gear_id.index as usize]);
}

#[test]
fn rigid_body_joint_island_buckets_use_dense_slot_for_sparse_root() {
    let mut world = World::default();
    let _isolated = spawn_dynamic_body(&mut world, 0.0, 0.0, 2.0);
    let earlier = spawn_dynamic_body(&mut world, 100.0, 0.0, 2.0);
    let later = spawn_dynamic_body(&mut world, 110.0, 0.0, 2.0);
    let distance_id = world.add_distance_joint(DistanceJoint::new(later, earlier, 10.0));

    let constraints = build_rigid_contact_constraints(&world);
    let schedule = RigidBodyIslandSchedule::from_world_and_contacts(&world, &constraints);
    let buckets = RigidBodyJointIslandBuckets::from_world_and_schedule(&world, &schedule);
    let sparse_root = schedule
        .root_for_pair_indices(later.id as usize, earlier.id as usize)
        .expect("joint-connected dynamic bodies should share an island");
    let (slot, island) = schedule
        .islands()
        .enumerate()
        .find(|(_, island)| island.root() == sparse_root)
        .expect("joint island should be scheduled");

    assert_ne!(
        island.root(),
        slot,
        "test setup should keep root id different from dense bucket slot",
    );
    assert_eq!(buckets.distance(island), &[distance_id.index as usize]);
}

#[test]
fn rigid_body_step_solves_contacts_and_joints_across_islands() {
    let mut world = World::default();
    let contact_body = spawn_dynamic_body(&mut world, 0.0, 0.0, 1.0);
    world.set_rigid_body(
        contact_body,
        RigidBody::dynamic_box(1.0, 2.0, 2.0)
            .with_material(PhysicsMaterial::new(0.0, 0.0))
            .with_sleeping_enabled(false),
    );
    let ground =
        spawn_kinematic_body_with_size(&mut world, 0.0, 1.4, CollisionLayer::Wall, false, 4.0, 0.5);
    world.set_rigid_body(
        ground,
        RigidBody::static_body().with_material(PhysicsMaterial::new(0.0, 0.0)),
    );
    let joint_a = spawn_dynamic_body(&mut world, 40.0, 0.0, 1.0);
    let joint_b = spawn_dynamic_body(&mut world, 46.0, 0.0, 1.0);
    world.set_rigid_body(joint_a, RigidBody::static_body());
    world.set_rigid_body(
        joint_b,
        RigidBody::dynamic(1.0).with_sleeping_enabled(false),
    );
    world.add_distance_joint(DistanceJoint::new(joint_a, joint_b, 2.0));

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        0.1,
        RigidBodyStepConfig {
            gravity: Velocity::default(),
            velocity_iterations: 1,
            position_iterations: 1,
            position_correction_percent: 1.0,
            position_correction_slop: 0.0,
            restitution_velocity_threshold: DEFAULT_RESTITUTION_VELOCITY_THRESHOLD,
            contact_baumgarte_bias_factor: DEFAULT_CONTACT_BAUMGARTE_BIAS_FACTOR,
            max_contact_baumgarte_bias_velocity: MAX_CONTACT_BAUMGARTE_BIAS_VELOCITY,
            contact_split_impulse: false,
            continuous: true,
        },
    );

    let contact_velocity = world.velocity(contact_body).unwrap();
    let joint_transform = world.transform(joint_b).unwrap();
    assert_eq!(stats.island_count, 2);
    assert!(stats.velocity_impulses > 0);
    assert!(stats.constraint_position_corrections > 0);
    assert!(
        contact_velocity.vy < 0.0,
        "contact island should solve normal impulse, got {contact_velocity:?}"
    );
    assert!(
        joint_transform.x < 46.0,
        "joint island should solve position correction independently, got {joint_transform:?}"
    );
}

#[test]
fn rigid_body_step_reports_final_island_stats() {
    let mut world = World::default();
    spawn_dynamic_body(&mut world, 0.0, 0.0, 5.0);
    spawn_dynamic_body(&mut world, 8.0, 0.0, 5.0);

    let stats = PhysicsSystem::step_rigid_bodies_with_config(
        &mut world,
        1.0 / 60.0,
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

    assert_eq!(stats.island_count, 1);
    assert_eq!(stats.island_bodies, 2);
    assert_eq!(stats.active_islands, 1);
    assert_eq!(stats.sleeping_islands, 0);
    assert_eq!(stats.largest_island_bodies, 2);
}
