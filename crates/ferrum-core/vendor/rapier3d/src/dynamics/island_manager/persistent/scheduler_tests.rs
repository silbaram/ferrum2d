use super::*;
use crate::prelude::*;

fn fixture(
    count: usize,
    joined: bool,
    can_sleep: bool,
) -> (PhysicsWorld, Vec<RigidBodyHandle>, Vec<ImpulseJointHandle>) {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    let bodies: Vec<_> = (0..count)
        .map(|_| world.insert_body(RigidBodyBuilder::dynamic().can_sleep(can_sleep)))
        .collect();
    let mut joints = Vec::new();
    if joined {
        for &body in &bodies[1..] {
            joints.push(world.insert_impulse_joint(bodies[0], body, FixedJointBuilder::new()));
        }
    }
    world.step();
    (world, bodies, joints)
}

fn check(world: &PhysicsWorld) -> usize {
    super::validation::validate_stored_islands(
        world,
        super::validation::StoredIslandLimits {
            max_work: 1_000_000,
            max_scratch_bytes: 1_000_000,
        },
    )
    .unwrap()
}

fn codec_steps(world: &mut PhysicsWorld, steps: usize) {
    let bytes = bincode::serialize(&*world).unwrap();
    check(world);
    assert_eq!(bincode::serialize(&*world).unwrap(), bytes);
    let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    check(&restored);
    assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    for _ in 0..steps {
        world.step();
        restored.step();
        check(world);
        check(&restored);
        assert_eq!(
            bincode::serialize(&*world).unwrap(),
            bincode::serialize(&restored).unwrap()
        );
    }
}

#[test]
fn stored_scheduler_dirty_saturates_body_remove_merge_and_hot_unlink() {
    for initial in [0, 17, u32::MAX - 1, u32::MAX] {
        let expected = initial.saturating_add(1);
        let (mut world, bodies, _) = fixture(3, true, false);
        let id = world.bodies[bodies[0]].ids.island_id;
        world.islands.persistent.islands[id as usize].constraint_remove_count = initial;
        world.remove_body(bodies[2]).unwrap();
        assert_eq!(
            world.islands.persistent.islands[id as usize].constraint_remove_count,
            expected
        );
        codec_steps(&mut world, 6);

        let (mut world, bodies, _) = fixture(2, false, false);
        for (index, &body) in bodies.iter().enumerate() {
            let id = world.bodies[body].ids.island_id;
            world.islands.persistent.islands[id as usize].constraint_remove_count =
                if index == 0 { initial } else { 1 };
        }
        world.insert_impulse_joint(bodies[0], bodies[1], FixedJointBuilder::new());
        codec_steps(&mut world, 6);
        let id = world.bodies[bodies[0]].ids.island_id;
        assert_eq!(
            world.islands.persistent.islands[id as usize].constraint_remove_count,
            expected
        );

        let (mut world, bodies, joints) = fixture(2, true, false);
        let id = world.bodies[bodies[0]].ids.island_id;
        world.islands.persistent.islands[id as usize].constraint_remove_count = initial;
        world.remove_impulse_joint(joints[0]).unwrap();
        codec_steps(&mut world, 6);
        assert_eq!(
            world.islands.persistent.islands[id as usize].constraint_remove_count,
            expected
        );
    }
}

#[test]
fn stored_scheduler_simultaneous_sleep_preserves_empty_awake_container() {
    let (mut world, bodies, _) = fixture(2, false, true);
    let awake = world.islands.awake_island.unwrap();
    for &body in &bodies {
        let activation = &mut world.bodies.get_mut_internal(body).unwrap().activation;
        activation.time_since_can_sleep = activation.time_until_sleep;
    }
    world.step();
    assert!(bodies.iter().all(|&body| world.bodies[body].is_sleeping()));
    assert_eq!(world.islands.awake_island, Some(awake));
    assert!(world.islands.islands[awake].bodies().is_empty());
    codec_steps(&mut world, 6);
    // This exception belongs only to the designated awake container.
    let mut absent_awake = world.islands.clone();
    absent_awake.awake_island = None;
    let valid = core::mem::replace(&mut world.islands, absent_awake);
    assert_eq!(
        super::validation::validate_stored_islands(
            &world,
            super::validation::StoredIslandLimits {
                max_work: 1_000_000,
                max_scratch_bytes: 1_000_000
            }
        ),
        Err(super::validation::StoredIslandError::ActiveMapping)
    );
    world.islands = valid;
    world.islands.wake_up(&mut world.bodies, bodies[0], true);
    codec_steps(&mut world, 2);
    for body in bodies {
        world.remove_body(body).unwrap();
    }
    check(&world);
    world.insert_body(RigidBodyBuilder::dynamic().can_sleep(false));
    codec_steps(&mut world, 3);
}

#[test]
fn stored_scheduler_dirty_saturates_sleeping_unlink() {
    let (mut world, bodies, joints) = fixture(2, true, true);
    for &body in &bodies {
        let rb = world.bodies.get_mut_internal(body).unwrap();
        rb.activation.time_since_can_sleep = rb.activation.time_until_sleep;
    }
    world.step();
    assert!(bodies.iter().all(|&body| world.bodies[body].is_sleeping()));
    let id = world.bodies[bodies[0]].ids.island_id;
    world.islands.persistent.islands[id as usize].constraint_remove_count = u32::MAX;
    world.impulse_joints.remove(joints[0], false).unwrap();
    codec_steps(&mut world, 6);
    assert!(world.islands.persistent.islands[id as usize].sleeping);
    assert_eq!(
        world.islands.persistent.islands[id as usize].constraint_remove_count,
        u32::MAX
    );
}

#[test]
fn stored_scheduler_dirty_saturates_budget_exhausted_unlink() {
    // The final edge's alternate route needs more than the local 1024-expansion budget.
    let (mut world, bodies, _) = fixture(1030, false, true);
    for edge in bodies.windows(2) {
        world.insert_impulse_joint(edge[0], edge[1], FixedJointBuilder::new());
    }
    let closing = world.insert_impulse_joint(
        bodies[0],
        bodies[bodies.len() - 1],
        FixedJointBuilder::new(),
    );
    world.step();
    let id = world.bodies[bodies[0]].ids.island_id;
    world.islands.persistent.islands[id as usize].constraint_remove_count = u32::MAX;
    world.remove_impulse_joint(closing).unwrap();
    codec_steps(&mut world, 6);
    assert_eq!(
        world.islands.persistent.islands[id as usize].constraint_remove_count,
        u32::MAX
    );
    assert_eq!(world.islands.persistent.islands.len(), 1);
}

#[test]
fn stored_scheduler_all_split_producers_keep_exact_sixteen_ticks() {
    for branch in 0..3 {
        for stamp in [0, u32::MAX - 16, u32::MAX - 15, u32::MAX] {
            let (mut world, bodies, joints) = fixture(if branch == 0 { 1 } else { 2 }, true, false);
            let id = world.bodies[bodies[0]].ids.island_id;
            if branch == 2 {
                world.remove_impulse_joint(joints[0]).unwrap();
                world
                    .islands
                    .persistent
                    .unlink_joint(JointLinkKey::Impulse(joints[0]));
            }
            world.islands.persistent.sleep_scan_stamp = stamp;
            let bytes = bincode::serialize(&world).unwrap();
            check(&world);
            assert_eq!(bincode::serialize(&world).unwrap(), bytes);
            let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
            for candidate in [&mut world, &mut restored] {
                candidate
                    .islands
                    .persistent
                    .split_island_now(&mut candidate.bodies, id);
                let persistent = &mut candidate.islands.persistent;
                assert_eq!(persistent.islands[id as usize].constraint_remove_count, 0);
                assert_eq!(
                    persistent.islands[id as usize].split_denied_until
                        - persistent.sleep_scan_stamp,
                    16
                );
                persistent.islands[id as usize].constraint_remove_count = 1;
            }
            for tick in 0..=16 {
                for candidate in [&mut world, &mut restored] {
                    let persistent = &mut candidate.islands.persistent;
                    assert_eq!(
                        persistent.split_allowed(id),
                        tick == 16,
                        "branch={branch} stamp={stamp} tick={tick}"
                    );
                    if tick < 16 {
                        // Awake never-sleep bodies produce observations on each real pipeline step.
                        candidate.step();
                        check(candidate);
                    }
                }
                assert_eq!(
                    bincode::serialize(&world).unwrap(),
                    bincode::serialize(&restored).unwrap()
                );
            }
        }
    }
}

#[test]
fn stored_scheduler_existing_deadlines_and_default_zero_survive_rebase() {
    let stamp = u32::MAX - 16;
    let deadlines = [0, 1, stamp - 100, stamp, stamp + 1, stamp + 15, stamp + 16];
    let (mut world, bodies, _) = fixture(deadlines.len(), false, false);
    world.islands.persistent.sleep_scan_stamp = stamp;
    let ids: Vec<_> = bodies
        .iter()
        .map(|&body| world.bodies[body].ids.island_id)
        .collect();
    for (&id, deadline) in ids.iter().zip(deadlines) {
        let island = &mut world.islands.persistent.islands[id as usize];
        island.constraint_remove_count = 1;
        island.split_denied_until = deadline;
    }
    // These are real possible old workspace stamps. Reusing stamp 2 must not alias them.
    world.islands.persistent.sleep_scan.fill((2, false));
    let bytes = bincode::serialize(&world).unwrap();
    check(&world);
    assert_eq!(bincode::serialize(&world).unwrap(), bytes);
    let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    for tick in 0..=16 {
        for candidate in [&mut world, &mut restored] {
            let persistent = &mut candidate.islands.persistent;
            for (&id, deadline) in ids.iter().zip(deadlines) {
                assert_eq!(
                    persistent.split_allowed(id),
                    deadline.saturating_sub(stamp) <= tick
                );
            }
            assert_eq!(persistent.islands[ids[0] as usize].split_denied_until, 0);
            if tick < 16 {
                persistent.begin_sleep_scan();
                for &id in &ids {
                    persistent.observe_body_for_sleep(id, true);
                    persistent.observe_body_for_sleep(id, true);
                }
                assert_eq!(persistent.sleep_scan_touched.len(), ids.len());
                assert_eq!(persistent.finish_sleep_scan(), ids);
            }
        }
        assert_eq!(
            bincode::serialize(&world).unwrap(),
            bincode::serialize(&restored).unwrap()
        );
    }
}

#[test]
fn stored_scheduler_restored_wrap_sleep_membership_and_duplicate_observations() {
    for stamp in [u32::MAX - 16, u32::MAX - 1, u32::MAX] {
        let (mut world, bodies, _) = fixture(3, false, true);
        world.insert_impulse_joint(bodies[0], bodies[2], FixedJointBuilder::new());
        world.step();
        let a = world.bodies[bodies[0]].ids.island_id;
        let b = world.bodies[bodies[1]].ids.island_id;
        world.islands.persistent.sleep_scan_stamp = stamp;
        let mut scan = world.islands.persistent.clone();
        scan.begin_sleep_scan();
        scan.observe_body_for_sleep(a, true);
        scan.observe_body_for_sleep(b, true);
        scan.observe_body_for_sleep(a, false);
        scan.observe_body_for_sleep(b, true);
        assert_eq!(scan.sleep_scan_touched.len(), 2);
        assert_eq!(scan.finish_sleep_scan(), [b]);
        for &body in &bodies[..2] {
            let rb = world.bodies.get_mut_internal(body).unwrap();
            rb.activation.time_since_can_sleep = rb.activation.time_until_sleep;
        }
        let bytes = bincode::serialize(&world).unwrap();
        check(&world);
        assert_eq!(bincode::serialize(&world).unwrap(), bytes);
        let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
        for candidate in [&mut world, &mut restored] {
            candidate.step();
            assert!(!candidate.bodies[bodies[0]].is_sleeping());
            assert!(candidate.bodies[bodies[1]].is_sleeping());
            assert!(!candidate.bodies[bodies[2]].is_sleeping());
            let rb = candidate.bodies.get_mut_internal(bodies[2]).unwrap();
            rb.activation.time_since_can_sleep = rb.activation.time_until_sleep;
            candidate.step();
            assert!(
                bodies
                    .iter()
                    .all(|&body| candidate.bodies[body].is_sleeping())
            );
            check(candidate);
        }
        for _ in 0..6 {
            assert_eq!(
                bincode::serialize(&world).unwrap(),
                bincode::serialize(&restored).unwrap()
            );
            world.step();
            restored.step();
        }
    }
}

#[test]
fn stored_scheduler_admission_keeps_complete_u32_history_read_only() {
    for stamp in [0, 1, u32::MAX - 16, u32::MAX - 15, u32::MAX] {
        for deadline in [0, 1, 16, u32::MAX / 2, u32::MAX] {
            for dirty in [0, u32::MAX - 1, u32::MAX] {
                let (mut world, bodies, _) = fixture(1, false, false);
                let id = world.bodies[bodies[0]].ids.island_id;
                let work = check(&world);
                world.islands.persistent.sleep_scan_stamp = stamp;
                let island = &mut world.islands.persistent.islands[id as usize];
                island.constraint_remove_count = dirty;
                island.split_denied_until = deadline;
                let bytes = bincode::serialize(&world).unwrap();
                assert_eq!(check(&world), work);
                assert_eq!(bincode::serialize(&world).unwrap(), bytes);
                codec_steps(&mut world, 2);
            }
        }
    }
}

#[test]
fn stored_scheduler_nonboundary_wire_and_six_step_replay_match_before() {
    let (mut world, bodies, _) = fixture(3, true, false);
    let id = world.bodies[bodies[0]].ids.island_id;
    world.islands.persistent.sleep_scan_stamp = 500;
    world.islands.persistent.islands[id as usize].constraint_remove_count = 17;
    world.islands.persistent.islands[id as usize].split_denied_until = 512;
    world.remove_body(bodies[2]).unwrap();
    let next = world.insert_body(RigidBodyBuilder::dynamic().can_sleep(false));
    world.insert_impulse_joint(bodies[0], next, FixedJointBuilder::new());
    let before = [
        (4308, 0x5f184a67b5e80605),
        (4236, 0xdd1afec1d042fc40),
        (4236, 0xb4a19626e6b51586),
        (4236, 0xdd119a237be0ac98),
        (4236, 0x0bb6b8b91218aa4a),
        (4236, 0x982d13e2385e3930),
        (4236, 0x85e191d8b7b411b6),
    ];
    let bytes = bincode::serialize(&world).unwrap();
    let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    for (tick, expected) in before.into_iter().enumerate() {
        let bytes = bincode::serialize(&world).unwrap();
        let digest = bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
        assert_eq!((bytes.len(), digest), expected);
        assert_eq!(bytes, bincode::serialize(&restored).unwrap());
        check(&world);
        check(&restored);
        if tick < 6 {
            world.step();
            restored.step();
        }
    }
}
