use super::*;
use crate::prelude::*;

fn check(world: &PhysicsWorld) -> Result<usize> {
    validate_stored_islands(
        world,
        StoredIslandLimits {
            max_work: 1_000_000,
            max_scratch_bytes: 1_000_000,
        },
    )
}
fn fixture(contact: bool) -> (PhysicsWorld, [RigidBodyHandle; 3], ImpulseJointHandle, u32) {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    let a = world.insert_body(RigidBodyBuilder::dynamic().can_sleep(false));
    let b = world.insert_body(
        RigidBodyBuilder::dynamic()
            .can_sleep(false)
            .translation(Vector::X * 0.9),
    );
    let c = world.insert_body(
        RigidBodyBuilder::dynamic()
            .can_sleep(false)
            .translation(Vector::X * 10.0),
    );
    let mut joint = ImpulseJointHandle::invalid();
    if contact {
        world.insert_collider(ColliderBuilder::ball(0.5), Some(a));
        world.insert_collider(ColliderBuilder::ball(0.5), Some(b));
    } else {
        joint = world.insert_impulse_joint(
            a,
            b,
            FixedJointBuilder::new().local_anchor1(Vector::X * 0.9),
        );
    }
    world.step();
    check(&world).unwrap();
    assert!(world.islands.persistent.bootstrapped);
    assert_eq!(world.bodies[a].ids.island_id, world.bodies[b].ids.island_id);
    assert_ne!(world.bodies[a].ids.island_id, world.bodies[c].ids.island_id);
    let edge = if contact {
        world
            .narrow_phase
            .contact_graph()
            .graph
            .edges
            .iter()
            .position(|edge| edge.weight.has_any_active_contact())
            .unwrap() as u32
    } else {
        u32::MAX
    };
    (world, [a, b, c], joint, edge)
}
fn move_member(world: &mut PhysicsWorld, body: RigidBodyHandle, destination: u32) {
    let ids = world.bodies[body].ids;
    let island = &mut world.islands.persistent.islands[ids.island_id as usize];
    island.bodies.swap_remove(ids.island_index as usize);
    if let Some(&moved) = island.bodies.get(ids.island_index as usize) {
        world
            .bodies
            .get_mut_internal(moved)
            .unwrap()
            .ids
            .island_index = ids.island_index;
    }
    let target = &mut world.islands.persistent.islands[destination as usize];
    let index = target.bodies.len() as u32;
    target.bodies.push(body);
    let rb = world.bodies.get_mut_internal(body).unwrap();
    rb.ids.island_id = destination;
    rb.ids.island_index = index;
}
fn corrupt(
    world: &mut PhysicsWorld,
    bodies: [RigidBodyHandle; 3],
    joint: ImpulseJointHandle,
    edge: u32,
    contact: bool,
    mode: u8,
) {
    let source = world.bodies[bodies[0]].ids.island_id;
    let destination = world.bodies[bodies[2]].ids.island_id;
    if mode == 2 {
        move_member(world, bodies[1], destination);
        return;
    }
    let persistent = &mut world.islands.persistent;
    if contact {
        if mode == 0 {
            persistent.unlink_contact(edge);
        } else {
            let link = persistent.islands[source as usize]
                .contact_links
                .pop()
                .unwrap();
            let target = &mut persistent.islands[destination as usize];
            let index = target.contact_links.len() as u32;
            target.contact_links.push(link);
            persistent.contact_link_locs[edge as usize] = (destination, index);
        }
    } else if mode == 0 {
        persistent.unlink_joint(JointLinkKey::Impulse(joint));
    } else {
        let link = persistent.islands[source as usize]
            .joint_links
            .pop()
            .unwrap();
        let target = &mut persistent.islands[destination as usize];
        let index = target.joint_links.len() as u32;
        target.joint_links.push(link);
        persistent
            .joint_link_locs
            .insert(JointLinkKey::Impulse(joint), (destination, index));
    }
}

fn codec_steps(world: &mut PhysicsWorld, steps: usize) {
    let bytes = bincode::serialize(&*world).unwrap();
    check(world).unwrap();
    assert_eq!(bincode::serialize(&*world).unwrap(), bytes);
    let mut restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
    check(&restored).unwrap();
    assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    for _ in 0..steps {
        world.step();
        restored.step();
        check(world).unwrap();
        check(&restored).unwrap();
        assert_eq!(
            bincode::serialize(&*world).unwrap(),
            bincode::serialize(&restored).unwrap()
        );
    }
}
#[test]
fn stored_eligible_enabled_joint_missing_wrong_owner_and_split_endpoints_reject_read_only() {
    for mode in 0..3 {
        let (mut world, bodies, joint, edge) = fixture(false);
        corrupt(&mut world, bodies, joint, edge, false, mode);
        let bytes = bincode::serialize(&world).unwrap();
        assert_eq!(check(&world), Err(StoredIslandError::JointLink));
        assert_eq!(bincode::serialize(&world).unwrap(), bytes);
        let restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
        assert_eq!(check(&restored), Err(StoredIslandError::JointLink));
        assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    }
}
#[test]
fn stored_eligible_active_contact_missing_wrong_owner_and_split_endpoints_reject_read_only() {
    for mode in 0..3 {
        let (mut world, bodies, joint, edge) = fixture(true);
        corrupt(&mut world, bodies, joint, edge, true, mode);
        let bytes = bincode::serialize(&world).unwrap();
        assert_eq!(check(&world), Err(StoredIslandError::ContactLink));
        assert_eq!(bincode::serialize(&world).unwrap(), bytes);
        let restored: PhysicsWorld = bincode::deserialize(&bytes).unwrap();
        assert_eq!(check(&restored), Err(StoredIslandError::ContactLink));
        assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    }
}
#[test]
fn stored_eligible_joint_pending_link_unlink_rewire_mutable_and_all_modified_continue() {
    let (mut world, bodies, joint, _) = fixture(false);
    world.insert_impulse_joint(bodies[1], bodies[2], FixedJointBuilder::new());
    codec_steps(&mut world, 6);
    world
        .impulse_joints
        .set_bodies(joint, bodies[0], bodies[2], true)
        .unwrap();
    codec_steps(&mut world, 6);
    world
        .impulse_joints
        .get_mut(joint, true)
        .unwrap()
        .data
        .set_enabled(false);
    codec_steps(&mut world, 6);
    world
        .impulse_joints
        .get_mut(joint, true)
        .unwrap()
        .data
        .set_enabled(true);
    codec_steps(&mut world, 6);
    for (_, joint) in world.impulse_joints.iter_mut() {
        joint.data.set_enabled(false);
    }
    codec_steps(&mut world, 6);
    // Re-enable while all_modified is persisted and every required cache link is still absent.
    for (_, joint) in world.impulse_joints.iter_mut() {
        joint.data.set_enabled(true);
    }
    codec_steps(&mut world, 6);
    world.remove_impulse_joint(joint).unwrap();
    codec_steps(&mut world, 6);
}
#[test]
fn stored_eligible_pending_body_type_enable_and_sleep_changes_continue() {
    for contact in [false, true] {
        let (mut world, bodies, _, _) = fixture(contact);
        world
            .bodies
            .get_mut(bodies[0])
            .unwrap()
            .set_body_type(RigidBodyType::Fixed, true);
        codec_steps(&mut world, 6);
        world
            .bodies
            .get_mut(bodies[0])
            .unwrap()
            .set_body_type(RigidBodyType::Dynamic, true);
        codec_steps(&mut world, 6);
        world.bodies.get_mut(bodies[0]).unwrap().set_enabled(false);
        codec_steps(&mut world, 6);
        world.bodies.get_mut(bodies[0]).unwrap().set_enabled(true);
        codec_steps(&mut world, 6);
    }
}
#[test]
fn stored_eligible_contact_reparent_sensor_disable_and_removed_generation_continue() {
    for change in 0..4 {
        let (mut world, bodies, _, edge) = fixture(true);
        let collider = world.narrow_phase.contact_graph().graph.edges[edge as usize]
            .weight
            .collider1;
        match change {
            0 => world
                .colliders
                .set_parent(collider, Some(bodies[2]), &mut world.bodies),
            1 => world.colliders.get_mut(collider).unwrap().set_sensor(true),
            2 => world
                .colliders
                .get_mut(collider)
                .unwrap()
                .set_enabled(false),
            _ => {
                world
                    .colliders
                    .remove(
                        collider,
                        &mut world.islands,
                        &mut world.bodies,
                        &mut world.soft_bodies,
                        false,
                    )
                    .unwrap();
                world.insert_collider(ColliderBuilder::ball(0.2), Some(bodies[2]));
            }
        }
        codec_steps(&mut world, 6);
    }
    let (mut world, bodies, _, _) = fixture(true);
    world.remove_body(bodies[0]).unwrap();
    world.insert_body(RigidBodyBuilder::dynamic());
    codec_steps(&mut world, 6);
}
#[test]
fn stored_eligible_cycles_and_deferred_disconnected_components_remain_legal() {
    let (mut world, bodies, _, _) = fixture(false);
    world.insert_impulse_joint(bodies[1], bodies[2], FixedJointBuilder::new());
    world.insert_impulse_joint(bodies[2], bodies[0], FixedJointBuilder::new());
    codec_steps(&mut world, 6);
    let (mut world, bodies, joint, _) = fixture(false);
    world.remove_impulse_joint(joint).unwrap();
    world.step();
    assert_eq!(
        world.bodies[bodies[0]].ids.island_id,
        world.bodies[bodies[1]].ids.island_id
    );
    assert!(
        world.islands.persistent.islands[world.bodies[bodies[0]].ids.island_id as usize]
            .constraint_remove_count
            > 0
    );
    codec_steps(&mut world, 6);
}
#[test]
fn stored_eligible_pending_keys_do_not_blanket_exempt_unrelated_links_or_stable_sides() {
    let (mut world, bodies, joint, edge) = fixture(false);
    world.insert_impulse_joint(bodies[1], bodies[2], FixedJointBuilder::new());
    corrupt(&mut world, bodies, joint, edge, false, 0);
    assert_eq!(check(&world), Err(StoredIslandError::JointLink));
    let (mut world, bodies, joint, edge) = fixture(false);
    world.impulse_joints.get_mut(joint, true).unwrap();
    corrupt(&mut world, bodies, joint, edge, false, 1);
    assert_eq!(check(&world), Err(StoredIslandError::JointLink));
    let (mut world, bodies, joint, edge) = fixture(true);
    world
        .bodies
        .get_mut(bodies[0])
        .unwrap()
        .set_body_type(RigidBodyType::Fixed, true);
    corrupt(&mut world, bodies, joint, edge, true, 1);
    assert_eq!(check(&world), Err(StoredIslandError::ContactLink));
}
#[test]
fn stored_eligible_bootstrap_pending_reuse_and_work_scratch_limits_are_explicit() {
    let mut world = PhysicsWorld::new();
    world.gravity = Vector::ZERO;
    let a = world.insert_body(RigidBodyBuilder::dynamic());
    let b = world.insert_body(RigidBodyBuilder::dynamic());
    world.insert_impulse_joint(a, b, FixedJointBuilder::new());
    assert!(!world.islands.persistent.bootstrapped);
    codec_steps(&mut world, 6);
    let (mut world, bodies, joint, _) = fixture(false);
    world.remove_impulse_joint(joint).unwrap();
    let new = world.insert_impulse_joint(bodies[0], bodies[2], FixedJointBuilder::new());
    assert_eq!(joint.into_raw_parts().0, new.into_raw_parts().0);
    assert_ne!(joint.into_raw_parts().1, new.into_raw_parts().1);
    codec_steps(&mut world, 6);
    let used = check(&world).unwrap();
    let bytes = bincode::serialize(&world).unwrap();
    assert_eq!(
        validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_work: used,
                max_scratch_bytes: 1_000_000
            }
        ),
        Ok(used)
    );
    assert_eq!(
        validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_work: used - 1,
                max_scratch_bytes: 1_000_000
            }
        ),
        Err(StoredIslandError::WorkLimit)
    );
    assert_eq!(
        validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_work: 1_000_000,
                max_scratch_bytes: 0
            }
        ),
        Err(StoredIslandError::ScratchLimit)
    );
    assert_eq!(bincode::serialize(&world).unwrap(), bytes);
}

#[test]
fn stored_eligible_sleep_wake_and_removed_body_reuse_preserve_links_and_bytes() {
    for contact in [false, true] {
        let mut world = PhysicsWorld::new();
        world.gravity = Vector::ZERO;
        let a = world.insert_body(RigidBodyBuilder::dynamic());
        let b = world.insert_body(RigidBodyBuilder::dynamic().translation(Vector::X * 0.9));
        let c = world.insert_body(
            RigidBodyBuilder::dynamic()
                .can_sleep(false)
                .translation(Vector::X * 10.0),
        );
        if contact {
            world.insert_collider(ColliderBuilder::ball(0.5), Some(a));
            world.insert_collider(ColliderBuilder::ball(0.5), Some(b));
        } else {
            world.insert_impulse_joint(
                a,
                b,
                FixedJointBuilder::new().local_anchor1(Vector::X * 0.9),
            );
        }
        world.step();
        for handle in [a, b] {
            let body = world.bodies.get_mut_internal(handle).unwrap();
            body.vels.linvel = Vector::ZERO;
            body.vels.angvel = Vector::ZERO;
            // Model a stationary producer history, including its pose-drift sample.
            body.activation.sleep_prev_pose = body.pos.position;
            body.activation.time_since_can_sleep = body.activation.time_until_sleep;
        }
        world.step();
        assert!(world.bodies[a].is_sleeping() && world.bodies[b].is_sleeping());
        assert!(!world.bodies[c].is_sleeping());
        codec_steps(&mut world, 6);
        world.wake_up(a, false);
        codec_steps(&mut world, 6);
        world.remove_body(b).unwrap();
        let next = world.insert_body(RigidBodyBuilder::dynamic().can_sleep(false));
        assert_eq!(b.into_raw_parts().0, next.into_raw_parts().0);
        assert_ne!(b.into_raw_parts().1, next.into_raw_parts().1);
        codec_steps(&mut world, 6);
    }
}

#[test]
fn stored_eligible_stale_generation_and_unrelated_material_changes_do_not_hide_missing_links() {
    let (mut world, bodies, old, _) = fixture(false);
    world.remove_impulse_joint(old).unwrap();
    let current = world.insert_impulse_joint(bodies[0], bodies[1], FixedJointBuilder::new());
    world.step();
    world
        .impulse_joints
        .island_events
        .push(super::super::ImpulseJointIslandEvent::Unlink { handle: old });
    world
        .islands
        .persistent
        .unlink_joint(JointLinkKey::Impulse(current));
    assert_eq!(check(&world), Err(StoredIslandError::JointLink));
    let (mut world, bodies, joint, edge) = fixture(true);
    let collider = world.narrow_phase.contact_graph().graph.edges[edge as usize]
        .weight
        .collider1;
    world.colliders.get_mut(collider).unwrap().set_friction(0.7);
    corrupt(&mut world, bodies, joint, edge, true, 0);
    assert_eq!(check(&world), Err(StoredIslandError::ContactLink));
}

#[test]
fn stored_eligible_pending_collider_scratch_threshold_and_work_are_checked_before_use() {
    let (mut world, bodies, _, edge) = fixture(true);
    let collider = world.narrow_phase.contact_graph().graph.edges[edge as usize]
        .weight
        .collider1;
    world
        .colliders
        .set_parent(collider, Some(bodies[2]), &mut world.bodies);
    let bytes = bincode::serialize(&world).unwrap();
    let work = check(&world).unwrap();
    let mut low = 0usize;
    let mut high = 1_000_000usize;
    while low < high {
        let middle = low + (high - low) / 2;
        match validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_work: work,
                max_scratch_bytes: middle,
            },
        ) {
            Ok(_) => high = middle,
            Err(StoredIslandError::ScratchLimit) => low = middle + 1,
            other => panic!("unexpected bounded admission result: {other:?}"),
        }
    }
    assert!(low > 0);
    assert_eq!(
        validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_work: work,
                max_scratch_bytes: low
            }
        ),
        Ok(work)
    );
    assert_eq!(
        validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_work: work,
                max_scratch_bytes: low - 1
            }
        ),
        Err(StoredIslandError::ScratchLimit)
    );
    assert_eq!(
        validate_stored_islands(
            &world,
            StoredIslandLimits {
                max_work: work - 1,
                max_scratch_bytes: low
            }
        ),
        Err(StoredIslandError::WorkLimit)
    );
    assert_eq!(bincode::serialize(&world).unwrap(), bytes);
}
