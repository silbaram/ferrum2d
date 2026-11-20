use super::super::contact_numerics as admission;
use super::*;

fn scene(space: Space) -> (PhysicsWorld3d, BodyId) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space,
        ..WorldConfig::default()
    })
    .unwrap();
    body(
        &mut world,
        BodyKind::Fixed,
        [0.0, -0.5, 0.0],
        Shape::Box {
            half_extents: [5.0, 0.5, 5.0],
        },
    );
    let dynamic = body(
        &mut world,
        BodyKind::Dynamic,
        [0.0, 0.5, 0.0],
        Shape::Sphere { radius: 0.5 },
    );
    step(&mut world, 4);
    assert!(world
        .backend
        .narrow_phase
        .contact_pairs()
        .any(|pair| !pair.solver_manifolds().is_empty()));
    (world, dynamic)
}
fn alter_pair(world: &mut PhysicsWorld3d, alter: impl FnOnce(&mut rp::ContactPair)) {
    let original = world
        .backend
        .narrow_phase
        .contact_pairs()
        .next()
        .unwrap()
        .clone();
    let needle = postcard::to_allocvec(&original).unwrap();
    let mut pair = original.clone();
    alter(&mut pair);
    let replacement = postcard::to_allocvec(&pair).unwrap();
    let mut bytes = postcard::to_allocvec(&world.backend.narrow_phase).unwrap();
    let positions: Vec<_> = bytes
        .windows(needle.len())
        .enumerate()
        .filter_map(|(at, value)| (value == needle).then_some(at))
        .collect();
    assert_eq!(
        positions.len(),
        1,
        "test requires one exact actual serialized pair"
    );
    let at = positions[0];
    bytes.splice(at..at + needle.len(), replacement);
    let (narrow, _) = crate::checkpoint_decode::with_limits::<rp::NarrowPhase>(
        &bytes,
        crate::checkpoint_decode::Limits::default(),
    )
    .unwrap();
    assert_eq!(postcard::to_allocvec(&narrow).unwrap(), bytes);
    world.backend.narrow_phase = narrow;
}
fn tamper(pair: &mut rp::ContactPair, case: usize) {
    let rp::PairContacts::Rigid(pair) = &mut pair.contacts else {
        unreachable!()
    };
    let m = &mut pair.manifolds[0];
    match case {
        0 => m.points[0].local_p1.x = f32::NAN,
        1 => m.points[0].data.warmstart_impulse = f32::NAN,
        2 => m.points[0].data.solver_dp2.z = f32::INFINITY,
        3 => m.local_n1.x = f32::NAN,
        4 => m.data.normal = rp::Vector::ZERO,
        5 => m.data.friction = -1.0,
        6 => m.data.restitution = f32::NAN,
        7 => m.data.contact_correction.velocity_rate = f32::NAN,
        8 => m.data.solver_contacts[0].anchor1.x = f32::NAN,
        9 => m.data.solver_contacts[0].tangent_velocity.y = f32::INFINITY,
        10 => m.data.solver_contacts[0].contact_id = [rp::NEW_CONTACT_BIT | m.points.len() as u32],
        11 => m.data.solver_contacts[0].contact_id = [255],
        12 => m.points[0].data.warmstart_tangent_world.y = f32::NAN,
        13 => m.set_subshape_pos1(Some(rp::Pose::from_translation(rp::Vector::splat(
            f32::NAN,
        )))),
        14 => m.points[0].dist = f32::NAN,
        15 => m.data.solver_contacts[0].dist = f32::NAN,
        16 => m.points[0].data.impulse = f32::INFINITY,
        17 => m.points[0].data.tangent_impulse.x = f32::NAN,
        18 => m.data.contact_correction.enabled = 0.5,
        19 => m.data.normal = rp::Vector::X * 2.0,
        20 => m.data.restitution = -1.0,
        _ => unreachable!(),
    }
}
fn unchecked(world: &PhysicsWorld3d, header: &PhysicsSnapshot) -> PhysicsSnapshot {
    let payload = postcard::to_allocvec(&Capture { world }).unwrap();
    let mut packet = header.clone();
    packet.bytes.truncate(HEADER);
    packet.bytes.extend_from_slice(&payload);
    packet.bytes[20..24].copy_from_slice(&(payload.len() as u32).to_le_bytes());
    packet.bytes[24..28].copy_from_slice(&crc(&payload).to_le_bytes());
    assert!(packet.payload().is_ok());
    packet
}

fn rejects_before_commit(world: &PhysicsWorld3d, header: &PhysicsSnapshot, label: &str) {
    let mut live = PhysicsWorld3d::from_snapshot(header).unwrap();
    let raw = postcard::to_allocvec(&Capture { world }).unwrap();
    let candidate = unchecked(world, header);
    assert_eq!(
        world.capture_snapshot().unwrap_err(),
        PhysicsSnapshotError::InvalidState,
        "capture {label}"
    );
    assert!(
        matches!(
            PhysicsWorld3d::from_snapshot(&candidate),
            Err(PhysicsSnapshotError::InvalidState)
        ),
        "construct {label}"
    );
    assert_eq!(
        live.restore_snapshot(&candidate),
        Err(PhysicsSnapshotError::InvalidState),
        "restore {label}"
    );
    assert_eq!(
        postcard::to_allocvec(&Capture { world }).unwrap(),
        raw,
        "source {label}"
    );
    assert_eq!(
        live.capture_snapshot().unwrap().encoded_bytes(),
        header.encoded_bytes(),
        "live {label}"
    );
    // No corrupted fixture reaches step, constraint generation, or writeback.
}

#[test]
fn native_contact_payloads_reject_before_capture_and_commit() {
    let mut rejected = 0;
    for space in [Space::PlanarXy, Space::Spatial] {
        for case in 0..21 {
            let (mut world, _) = scene(space);
            let before = world.capture_snapshot().unwrap();
            alter_pair(&mut world, |pair| tamper(pair, case));
            // Existing structural/island admission accepts these records. The
            // new float/index pass must reject the actual serialized payload.
            rp::validate_stored_references(&world.backend, REFERENCE_LIMITS).unwrap();
            islands::validate(&world.backend).unwrap();
            rejects_before_commit(&world, &before, &format!("{space:?} case{case}"));
            rejected += 1;
        }
    }
    eprintln!("CONTACT_AFTER captures_rejected={rejected} constructors_rejected={rejected} restores_rejected={rejected} corrupt_steps=0");
}

#[test]
fn native_contact_clustered_hidden_originals_and_solver_records_are_both_checked() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for target in 0..3 {
            let mut world = PhysicsWorld3d::new(WorldConfig {
                space,
                ..WorldConfig::default()
            })
            .unwrap();
            body(
                &mut world,
                BodyKind::Fixed,
                [0.0, -0.5, 0.0],
                Shape::Box {
                    half_extents: [5.0, 0.5, 5.0],
                },
            );
            body(
                &mut world,
                BodyKind::Dynamic,
                [0.0, 0.5, 0.0],
                Shape::Compound {
                    parts: vec![
                        ShapePart {
                            pose: Pose {
                                position: [-0.25, 0.0, 0.0],
                                ..Pose::default()
                            },
                            shape: Shape::Box {
                                half_extents: [0.3, 0.5, 0.4],
                            },
                        },
                        ShapePart {
                            pose: Pose {
                                position: [0.25, 0.0, 0.0],
                                ..Pose::default()
                            },
                            shape: Shape::Box {
                                half_extents: [0.3, 0.5, 0.4],
                            },
                        },
                    ],
                },
            );
            step(&mut world, 4);
            let before = world.capture_snapshot().unwrap();
            alter_pair(&mut world, |pair| {
                let rp::PairContacts::Rigid(pair) = &mut pair.contacts else {
                    unreachable!()
                };
                assert!(!pair.manifolds.is_empty());
                assert!(
                    !pair.solver_clusters.is_empty(),
                    "actual compound producer must create clusters"
                );
                match target {
                    0 => pair.manifolds[0].points[0].data.warmstart_tangent_world.x = f32::NAN,
                    1 => pair.solver_clusters[0].points[0].local_p2.y = f32::INFINITY,
                    2 => pair.solver_clusters[0].data.solver_contacts[0].contact_id = [255],
                    _ => unreachable!(),
                }
            });
            rp::validate_stored_references(&world.backend, REFERENCE_LIMITS).unwrap();
            islands::validate(&world.backend).unwrap();
            rejects_before_commit(
                &world,
                &before,
                &format!("cluster {space:?} target{target}"),
            );
        }
    }
}

#[test]
fn native_contact_work_exact_and_one_below_map_without_mutating_bytes() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (world, _) = scene(space);
        let before = world.capture_snapshot().unwrap();
        let used = rp::validate_stored_contact_numerics(&world.backend, admission::LIMITS).unwrap();
        assert!(used > 0);
        admission::validate_with_limits(
            &world.backend,
            rp::StoredContactNumericLimits { max_work: used },
        )
        .unwrap();
        assert_eq!(
            admission::validate_with_limits(
                &world.backend,
                rp::StoredContactNumericLimits { max_work: used - 1 }
            ),
            Err(PhysicsSnapshotError::Capacity)
        );
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
}

#[test]
fn native_contact_sleep_pending_pose_shape_force_and_signed_history_continue_exactly() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let (mut world, dynamic) = scene(space);
        step(&mut world, 240);
        assert!(world.body_state(dynamic).unwrap().sleeping);
        // Preserve supported signed warm-start state without requiring it to
        // equal freshly recomputed contact geometry or to be positive.
        alter_pair(&mut world, |pair| {
            let rp::PairContacts::Rigid(pair) = &mut pair.contacts else {
                unreachable!()
            };
            let m = &mut pair.manifolds[0];
            m.points[0].data.warmstart_twist_impulse = -0.1;
            m.points[0].data.warmstart_tangent_world.x = -0.05;
            m.data.solver_contacts[0].contact_id[0] |= rp::NEW_CONTACT_BIT;
        });
        let sleeping = world.capture_snapshot().unwrap();
        let mut restored = PhysicsWorld3d::from_snapshot(&sleeping).unwrap();
        same(&world, &restored, &[dynamic]);
        for _ in 0..3 {
            world.step();
            restored.step();
            same(&world, &restored, &[dynamic]);
        }
        world
            .add_force(dynamic, [0.5, 0.25, 0.0], [0.0, 0.0, 0.1])
            .unwrap();
        world.apply_impulse(dynamic, [0.1, 0.0, 0.0]).unwrap();
        world
            .set_pose(
                dynamic,
                Pose {
                    position: [0.05, 0.55, 0.0],
                    ..Pose::default()
                },
            )
            .unwrap();
        let collider = world.collider_ids(dynamic).unwrap().next().unwrap();
        world
            .update_collider(
                collider,
                ColliderDesc {
                    friction: 0.7,
                    restitution: 0.25,
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.45 })
                },
            )
            .unwrap();
        let pending = world.capture_snapshot().unwrap();
        let mut restored = PhysicsWorld3d::from_snapshot(&pending).unwrap();
        same(&world, &restored, &[dynamic]);
        for _ in 0..6 {
            world.step();
            restored.step();
            same(&world, &restored, &[dynamic]);
            events(&mut world, &mut restored);
        }
    }
}

#[test]
fn native_contact_soft_empty_ready_and_excess_solver_lists_reject_without_consumption() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for case in 0..3 {
            let (mut world, _) = scene(space);
            let before = world.capture_snapshot().unwrap();
            alter_pair(&mut world, |pair| match case {
                0 => {
                    pair.contacts = rp::PairContacts::Soft {
                        touching: false,
                        candidates: Box::default(),
                    }
                }
                1 => {
                    let rp::PairContacts::Rigid(pair) = &mut pair.contacts else {
                        unreachable!()
                    };
                    pair.manifolds[0].data.solver_contacts.clear();
                }
                2 => {
                    let rp::PairContacts::Rigid(pair) = &mut pair.contacts else {
                        unreachable!()
                    };
                    let m = &mut pair.manifolds[0];
                    m.data.solver_contacts.resize(5, m.data.solver_contacts[0]);
                }
                _ => unreachable!(),
            });
            // Soft/empty variants may be rejected by the earlier structural or
            // island guards too. This test verifies the combined public path;
            // isolated vendor tests prove this contact pass's individual errors.
            rejects_before_commit(&world, &before, &format!("nonfloat {space:?} case{case}"));
        }
    }
}
