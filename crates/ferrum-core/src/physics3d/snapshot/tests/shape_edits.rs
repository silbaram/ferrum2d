use super::*;

fn scene(space: Space, flipped: bool) -> (PhysicsWorld3d, BodyId, ColliderId) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        space,
        gravity: [0.0; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    let floor = Shape::Box {
        half_extents: [5.0, 0.5, 5.0],
    };
    let moving = Shape::Compound {
        parts: vec![
            ShapePart {
                pose: Pose {
                    position: [-0.2, 0.0, 0.0],
                    ..Pose::default()
                },
                shape: Shape::Sphere { radius: 0.5 },
            },
            ShapePart {
                pose: Pose {
                    position: [0.2, 0.0, 0.0],
                    ..Pose::default()
                },
                shape: Shape::Sphere { radius: 0.5 },
            },
        ],
    };
    let id;
    if flipped {
        id = body(&mut world, BodyKind::Dynamic, [0.0, 0.5, 0.0], moving);
        body(&mut world, BodyKind::Fixed, [0.0, -0.5, 0.0], floor);
    } else {
        body(&mut world, BodyKind::Fixed, [0.0, -0.5, 0.0], floor);
        id = body(&mut world, BodyKind::Dynamic, [0.0, 0.5, 0.0], moving);
    }
    step(&mut world, 4);
    let collider = world.collider_ids(id).unwrap().next().unwrap();
    (world, id, collider)
}
#[test]
fn native_shape_edits_small_sphere_free_motion_has_no_ghost_impulse_in_both_spaces() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for flipped in [false, true] {
            let (mut world, id, collider) = scene(space, flipped);
            let owner = world.collider_owner(collider).unwrap();
            world
                .update_collider(collider, ColliderDesc::new(Shape::Sphere { radius: 0.1 }))
                .unwrap();
            world.set_velocity(id, [0.0, -1.0, 0.0], [0.0; 3]).unwrap();
            let pending = world.capture_snapshot().unwrap();
            let mut restored = PhysicsWorld3d::from_snapshot(&pending).unwrap();
            assert_eq!(
                world.capture_snapshot().unwrap().encoded_bytes(),
                pending.encoded_bytes()
            );
            for tick in 1..=6 {
                world.step();
                restored.step();
                same(&world, &restored, &[id]);
                events(&mut world, &mut restored);
                let state = world.body_state(id).unwrap();
                assert!((state.linear_velocity[1] + 1.0).abs() < 1.0e-6);
                assert!(
                    (state.pose.position[1] - (0.5 - tick as f32 * world.config().step_seconds))
                        .abs()
                        < 2.0e-6
                );
                let mut contacts = Vec::new();
                assert_eq!(world.contact_impulses(&mut contacts).solved_contacts, 0);
                assert!(contacts.is_empty());
                assert_eq!(world.collider_owner(collider).unwrap(), owner);
            }
            std::eprintln!(
                "SHAPE_EDIT_PUBLIC {space:?} flip{flipped} y={} vy={} ghost_impulses=0",
                world.body_state(id).unwrap().pose.position[1],
                world.body_state(id).unwrap().linear_velocity[1]
            );
        }
    }
}

#[test]
fn native_shape_edits_continuous_contact_exit_sensor_and_solid_lifecycle_keep_identity() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for flipped in [false, true] {
            let (mut world, id, collider) = scene(space, flipped);
            let owner = world.collider_owner(collider).unwrap();
            let mut first = Vec::new();
            world.drain_collision_events(&mut first);
            assert_eq!(first.len(), 1);
            assert_eq!(first[0].phase, CollisionPhase::Enter);
            for stage in 0..4 {
                let before = world.capture_snapshot().unwrap();
                assert_eq!(
                    before.encoded_bytes(),
                    world.capture_snapshot().unwrap().encoded_bytes()
                );
                let (radius, sensor) = if stage == 1 {
                    (0.1, false)
                } else {
                    (0.5, stage == 2)
                };
                world
                    .update_collider(
                        collider,
                        ColliderDesc {
                            sensor,
                            ..ColliderDesc::new(Shape::Sphere { radius })
                        },
                    )
                    .unwrap();
                if stage == 2 {
                    world
                        .set_pose(
                            id,
                            Pose {
                                position: [0.0, 0.45, 0.0],
                                ..Pose::default()
                            },
                        )
                        .unwrap();
                }
                let pending = world.capture_snapshot().unwrap();
                let mut restored = PhysicsWorld3d::from_snapshot(&pending).unwrap();
                same(&world, &restored, &[id]);
                world.step();
                restored.step();
                same(&world, &restored, &[id]);
                let (mut actual, mut expected) = (Vec::new(), Vec::new());
                world.drain_collision_events(&mut actual);
                restored.drain_collision_events(&mut expected);
                assert_eq!(actual, expected);
                assert!(actual.iter().all(|event| !event.removed));
                match stage {
                    0 => assert!(
                        actual.is_empty(),
                        "kept contact must not restart: {actual:?}"
                    ),
                    1 => {
                        assert_eq!(actual.len(), 1);
                        assert_eq!(actual[0].phase, CollisionPhase::Exit);
                        assert!(!actual[0].sensor);
                    }
                    2 => {
                        assert_eq!(actual.len(), 1);
                        assert_eq!(actual[0].phase, CollisionPhase::Enter);
                        assert!(actual[0].sensor);
                    }
                    3 => {
                        assert_eq!(
                            actual.len(),
                            2,
                            "sensor-to-solid must stop old/start new: {actual:?}"
                        );
                        assert_eq!(actual[0].phase, CollisionPhase::Exit);
                        assert!(actual[0].sensor);
                        assert_eq!(actual[1].phase, CollisionPhase::Enter);
                        assert!(!actual[1].sensor);
                    }
                    _ => unreachable!(),
                }
                let mut active = Vec::new();
                world.active_collision_pairs(&mut active);
                assert_eq!(active.len(), usize::from(stage != 1));
                if let Some(pair) = active.first() {
                    assert_eq!(pair.sensor, sensor);
                }
                assert_eq!(
                    world.collider_owner(collider).unwrap().collider,
                    owner.collider
                );
                assert_eq!(world.collider_owner(collider).unwrap().body, owner.body);
                for _ in 0..2 {
                    world.step();
                    restored.step();
                    same(&world, &restored, &[id]);
                    let (mut a, mut b) = (Vec::new(), Vec::new());
                    world.drain_collision_events(&mut a);
                    restored.drain_collision_events(&mut b);
                    assert_eq!(a, b);
                    assert!(
                        a.is_empty(),
                        "stable active/absent phase has no duplicate transitions: {a:?}"
                    );
                }
            }
        }
    }
}
fn alter_root(world: &mut PhysicsWorld3d, case: usize) {
    let mut pair = world
        .backend
        .narrow_phase
        .contact_pairs()
        .next()
        .unwrap()
        .clone();
    let needle = postcard::to_allocvec(&pair).unwrap();
    let rp::PairContacts::Rigid(data) = &mut pair.contacts else {
        unreachable!()
    };
    match case {
        0 => data.manifolds[0].subshape1 = 99,
        1 => data.manifolds[0].subshape2 = 99,
        2 => data.manifolds[0].set_subshape_pos1(Some(rp::Pose::IDENTITY)),
        3 => data.manifolds[0].set_subshape_pos2(Some(rp::Pose::IDENTITY)),
        _ => unreachable!(),
    }
    let replacement = postcard::to_allocvec(&pair).unwrap();
    let mut bytes = postcard::to_allocvec(&world.backend.narrow_phase).unwrap();
    let positions: Vec<_> = bytes
        .windows(needle.len())
        .enumerate()
        .filter_map(|(i, bytes)| (bytes == needle).then_some(i))
        .collect();
    assert_eq!(positions.len(), 1);
    let at = positions[0];
    bytes.splice(at..at + needle.len(), replacement);
    world.backend.narrow_phase =
        crate::checkpoint_decode::with_limits(&bytes, crate::checkpoint_decode::Limits::default())
            .unwrap()
            .0;
}
#[test]
fn native_shape_edits_none_root_context_rejects_valid_crc_without_mutating_live_world() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for case in 0..4 {
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
                Shape::Sphere { radius: 0.5 },
            );
            step(&mut world, 4);
            let saved = world.capture_snapshot().unwrap();
            let mut live = PhysicsWorld3d::from_snapshot(&saved).unwrap();
            alter_root(&mut world, case);
            rp::validate_stored_references(&world.backend, REFERENCE_LIMITS).unwrap();
            islands::validate(&world.backend).unwrap();
            super::super::contact_numerics::validate(&world.backend).unwrap();
            let raw = postcard::to_allocvec(&Capture { world: &world }).unwrap();
            let mut bad = saved.clone();
            bad.bytes.truncate(HEADER);
            bad.bytes.extend_from_slice(&raw);
            bad.bytes[20..24].copy_from_slice(&(raw.len() as u32).to_le_bytes());
            bad.bytes[24..28].copy_from_slice(&crc(&raw).to_le_bytes());
            assert!(bad.payload().is_ok());
            assert_eq!(
                world.capture_snapshot().unwrap_err(),
                PhysicsSnapshotError::InvalidState
            );
            assert_eq!(
                live.restore_snapshot(&bad),
                Err(PhysicsSnapshotError::InvalidState)
            );
            assert_eq!(
                postcard::to_allocvec(&Capture { world: &world }).unwrap(),
                raw
            );
            assert_eq!(
                live.capture_snapshot().unwrap().encoded_bytes(),
                saved.encoded_bytes()
            );
            // Mutated fixture only reaches cold admission; never step/query it.
        }
    }
}
