use super::*;
use crate::physics3d::world::native_id;
use crate::physics3d::{
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Pose, Shape, WorldConfig,
};

const D: f32 = 0.1;

fn fixture() -> (PhysicsWorld3d, BackendMotionScratch, [BodyId; 3], Work) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: D,
        ..Default::default()
    })
    .unwrap();
    let mut actors = Vec::new();
    for x in [0., -0.5100007] {
        let actor = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [x, 0., 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                }),
            )
            .unwrap();
        world
            .enable_character(
                actor,
                CharacterConfig {
                    push_mass: 0.,
                    step_height: 0.,
                    ..Default::default()
                },
            )
            .unwrap();
        let runtime = world.characters.get_mut(&actor).unwrap();
        runtime.free_translation = [0., 0., 2. * D];
        runtime.free_velocity = [0., 0., 2.];
        actors.push(actor);
    }
    let driver = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [0.5100007, 0., 0.],
                    ..Default::default()
                },
                linear_velocity: [-60., 0., 0.],
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 2., 5.],
            }),
        )
        .unwrap();
    let ids = [actors[0], actors[1], driver];
    let mut scratch = BackendMotionScratch::default();
    world.prepare_backend_motion(&mut scratch, D).unwrap();
    let domain = Domain::new(0., Time::from(D)).unwrap();
    for id in ids {
        let body = &world.backend.bodies[native_id(id)];
        let curve = Kernel::from_velocity(
            native_id(id),
            domain,
            body.position()
                .prepend_translation(body.local_center_of_mass()),
            if id == driver {
                -rp::Vector::X * 60.
            } else {
                rp::Vector::Z * 2.
            },
            rp::Vector::ZERO,
        )
        .unwrap();
        scratch
            .entries
            .push(super::super::momentum_tests::entry(native_id(id), curve));
    }
    let mut work = Work {
        used: scratch.used,
        limit: super::super::super::trajectory::MAX_PROOF_WORK,
    };
    prepare(&world, &mut scratch, &mut work);
    (world, scratch, ids, work)
}

fn prepare(world: &PhysicsWorld3d, scratch: &mut BackendMotionScratch, work: &mut Work) {
    prepare_at(world, scratch, 0., work);
}

fn prepare_at(
    world: &PhysicsWorld3d,
    scratch: &mut BackendMotionScratch,
    start: Time,
    work: &mut Work,
) {
    let tracks: Vec<_> = scratch
        .entries
        .iter()
        .map(|e| BodyTrajectory {
            body: e.value.handle,
            curve: e.curve,
        })
        .collect();
    scratch
        .scene
        .prepare(
            &world.backend.bodies,
            &world.backend.colliders,
            &tracks,
            &world.characters,
            start,
            Time::from(D),
            world.actual_motion_scratch_bound().unwrap(),
            work,
        )
        .unwrap();
}

fn contact(
    world: &PhysicsWorld3d,
    scratch: &BackendMotionScratch,
    ids: [BodyId; 2],
    time: Time,
    distance: f32,
    work: &mut Work,
) -> actual_scene::ContactSample {
    let handles = ids.map(|id| world.backend.bodies[native_id(id)].colliders()[0]);
    scratch
        .scene
        .contact_pair_at(
            &world.backend.colliders,
            &world.contact_policies,
            (handles[0], handles[1]),
            time,
            distance,
            work,
            &|_, _| true,
        )
        .unwrap()
        .unwrap()
}

fn hit(sample: actual_scene::ContactSample, safe_time: Time, hit_time: Time) -> actual_scene::Hit {
    actual_scene::Hit {
        a: sample.a,
        b: sample.b,
        cast: crate::physics3d::solver_trajectory::CastHit {
            safe_time,
            hit_time,
            contact: sample.contact,
            subshape_a: 0,
            subshape_b: 0,
        },
    }
}

fn first_response(
    world: &PhysicsWorld3d,
    scratch: &mut BackendMotionScratch,
    ids: [BodyId; 3],
    work: &mut Work,
) {
    let sample = contact(world, scratch, [ids[0], ids[2]], 2e-8, 0.01, work);
    scratch.contacts = vec![sample];
    scratch
        .response_at(
            hit(sample, 0., 2e-8),
            0.,
            Time::from(D),
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            false,
            1.,
            work,
            world.actual_motion_scratch_bound().unwrap(),
        )
        .unwrap();
    scratch
        .remember_active_contacts(
            0.,
            2e-8,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            work,
            world.actual_motion_scratch_bound().unwrap(),
        )
        .unwrap();
    assert_eq!(scratch.active_contacts.len(), 1);
    assert!(scratch.active_contacts[0].envelope > 0.01);
}

#[test]
fn accepted_driver_and_new_peer_are_projected_together_without_replacing_free_plan() {
    let (world, mut scratch, ids, mut work) = fixture();
    let saved = world.capture_snapshot().unwrap();
    let original: Vec<_> = scratch.origins.iter().map(|o| o.relative_plan).collect();
    first_response(&world, &mut scratch, ids, &mut work);
    let envelope = scratch.active_contacts[0].envelope.to_bits();
    prepare(&world, &mut scratch, &mut work);
    let actor = scratch.entry_index(Some(native_id(ids[0]))).unwrap();
    assert_eq!(
        curve_velocity(scratch.entries[actor].curve, 1.2e-8)
            .unwrap()
            .0,
        rp::Vector::new(-60., 0., 2.)
    );
    let safe_peer = contact(
        &world,
        &scratch,
        [ids[0], ids[1]],
        1e-8,
        f32::MAX,
        &mut work,
    );
    assert!(safe_peer.contact.dist > 0.01);
    // The old Box face is outside the preferred skin after safe-pose rebasing;
    // the current census legitimately contains only the new capsule pair.
    let old = contact(
        &world,
        &scratch,
        [ids[0], ids[2]],
        1.2e-8,
        f32::MAX,
        &mut work,
    );
    assert!(old.contact.dist > 0.01);
    assert_eq!(
        old.contact.dist.to_bits(),
        envelope,
        "actual fullshape row must lie within the fixed safe envelope"
    );
    let separating = (old.b.motion.point_velocity(1.2e-8, old.contact.point2)
        - old.a.motion.point_velocity(1.2e-8, old.contact.point1))
    .dot(old.contact.normal1);
    assert_eq!(separating, 0.);
    let peer = contact(&world, &scratch, [ids[0], ids[1]], 1.2e-8, 0.01, &mut work);
    scratch.contacts = vec![peer];
    scratch
        .refresh_active_contacts(
            1.2e-8,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &world.contact_policies,
            true,
            &mut work,
        )
        .unwrap();
    assert_eq!(scratch.active_contacts.len(), 1);
    assert!(scratch.active_contacts[0].visible);
    assert_eq!(scratch.active_contacts[0].envelope.to_bits(), envelope);
    let bound = scratch
        .active_remaining(world.actual_motion_scratch_bound().unwrap())
        .unwrap();
    scratch
        .response_at(
            hit(peer, 1e-8, 1.2e-8),
            1e-8,
            Time::from(D),
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            false,
            1.,
            &mut work,
            bound,
        )
        .unwrap();
    for id in &ids[..2] {
        let i = scratch.entry_index(Some(native_id(*id))).unwrap();
        assert_eq!(
            curve_velocity(scratch.entries[i].curve, 1.2e-8).unwrap().0,
            rp::Vector::new(-60., 0., 2.)
        );
        let end = scratch.entries[i].curve.com_pose(Time::from(D));
        assert!(end.translation.x < -5.99);
        assert!((end.translation.z - 0.2).abs() < 1e-6);
        assert_eq!(scratch.entries[i].velocity_delta, rp::Vector::ZERO);
    }
    assert_eq!(
        scratch
            .origins
            .iter()
            .map(|o| o.relative_plan)
            .collect::<Vec<_>>(),
        original
    );
    assert!(scratch.rows.is_empty());
    assert!(scratch.row_impulses.is_empty());
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        saved.encoded_bytes()
    );
    let restored = PhysicsWorld3d::from_snapshot(&saved).unwrap();
    assert!(restored
        .character_motion
        .backend_motion
        .active_contacts
        .is_empty());
    assert_eq!(
        restored
            .character_motion
            .backend_motion
            .active_contacts
            .capacity(),
        0
    );
    // The same accepted-safe clock as the real backend: both actor suffix
    // kernels now start at 1e-8, while the original driver keeps its domain.
    prepare_at(&world, &mut scratch, 1e-8, &mut work);
    let later = contact(
        &world,
        &scratch,
        [ids[0], ids[2]],
        4e-8,
        f32::MAX,
        &mut work,
    );
    assert!(later.contact.dist > f32::from_bits(envelope),
        "actual F32 surface gap exceeds the fixed envelope; this is release, not a skin enlargement");
    scratch.contacts.clear();
    scratch
        .refresh_active_contacts(
            4e-8,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &world.contact_policies,
            true,
            &mut work,
        )
        .unwrap();
    assert!(scratch.active_contacts.is_empty());
}

#[test]
fn separating_peer_projection_keeps_row_for_incoming_free_geometry() {
    let (world, mut scratch, ids, mut work) = fixture();
    let peer = contact(&world, &scratch, [ids[0], ids[1]], 0., f32::MAX, &mut work);
    scratch.contacts = vec![peer];
    scratch
        .remember_active_contacts(
            0.,
            0.,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &mut work,
            world.actual_motion_scratch_bound().unwrap(),
        )
        .unwrap();
    assert_eq!(scratch.active_contacts.len(), 1);

    let index = scratch.entry_index(peer.b.parent).unwrap();
    let entry = &mut scratch.entries[index];
    entry.curve = Curve::Integrated(
        Kernel::from_velocity(
            entry.value.handle,
            Domain::new(0., Time::from(D)).unwrap(),
            entry.curve.com_pose(0.),
            rp::Vector::Z * 2. + peer.contact.normal1,
            rp::Vector::ZERO,
        )
        .unwrap(),
    );
    let origin = scratch
        .origins
        .iter()
        .position(|origin| origin.body == ids[1])
        .unwrap();
    scratch.origins[origin].relative_plan = rp::Vector::Z * 2. - peer.contact.normal1;
    prepare(&world, &mut scratch, &mut work);
    scratch.contacts.clear();

    let refresh = |scratch: &mut BackendMotionScratch, work: &mut Work| {
        scratch
            .refresh_active_contacts(
                0.,
                &world.backend.bodies,
                &world.backend.colliders,
                &world.characters,
                &world.contact_policies,
                true,
                work,
            )
            .unwrap();
    };
    refresh(&mut scratch, &mut work);
    assert!(scratch.active_contacts[0].visible);

    scratch.origins[origin].relative_plan = rp::Vector::Z * 2. + peer.contact.normal1;
    refresh(&mut scratch, &mut work);
    assert!(scratch.active_contacts.is_empty());
}

#[test]
fn driver_separation_filter_generation_and_shape_changes_release_history() {
    for control in 0..6 {
        let (mut world, mut scratch, ids, mut work) = fixture();
        first_response(&world, &mut scratch, ids, &mut work);
        let driver = native_id(ids[2]);
        let collider = world.backend.bodies[driver].colliders()[0];
        match control {
            0 => {
                let i = scratch.entry_index(Some(driver)).unwrap();
                let kernel = Kernel::from_velocity(
                    driver,
                    Domain::new(0., Time::from(D)).unwrap(),
                    world.backend.bodies[driver]
                        .position()
                        .prepend_translation(world.backend.bodies[driver].local_center_of_mass()),
                    rp::Vector::ZERO,
                    rp::Vector::ZERO,
                )
                .unwrap();
                scratch.entries[i].curve = Curve::Integrated(kernel);
            }
            1 => world.backend.colliders[collider]
                .set_collision_groups(rp::InteractionGroups::none()),
            2 => scratch.disabled_pairs.push(pair(ids[0], ids[2])),
            3 => world.backend.colliders[collider].set_shape(rp::SharedShape::cuboid(0.2, 2., 5.)),
            4 => {
                world.backend.colliders[collider].set_enabled(false);
            }
            _ => {
                // Removing and reusing the arena slot cannot reuse generation.
                world.remove_body(ids[2]).unwrap();
                scratch.entries.retain(|e| e.value.handle != driver);
                let replacement = world
                    .create_body(
                        BodyDesc {
                            kind: BodyKind::KinematicVelocity,
                            pose: Pose {
                                position: [0.5100007, 0., 0.],
                                ..Default::default()
                            },
                            linear_velocity: [-60., 0., 0.],
                            ..Default::default()
                        },
                        ColliderDesc::new(Shape::Box {
                            half_extents: [0.25, 2., 5.],
                        }),
                    )
                    .unwrap();
                assert_ne!(native_id(replacement), driver);
                let body = &world.backend.bodies[native_id(replacement)];
                let kernel = Kernel::from_velocity(
                    native_id(replacement),
                    Domain::new(0., Time::from(D)).unwrap(),
                    body.position()
                        .prepend_translation(body.local_center_of_mass()),
                    -rp::Vector::X * 60.,
                    rp::Vector::ZERO,
                )
                .unwrap();
                scratch.entries.push(super::super::momentum_tests::entry(
                    native_id(replacement),
                    kernel,
                ));
            }
        }
        prepare(&world, &mut scratch, &mut work);
        scratch.contacts.clear();
        scratch
            .refresh_active_contacts(
                4e-8,
                &world.backend.bodies,
                &world.backend.colliders,
                &world.characters,
                &world.contact_policies,
                true,
                &mut work,
            )
            .unwrap();
        assert!(scratch.active_contacts.is_empty(), "control {control}");
        assert!(scratch
            .origins
            .iter()
            .all(|o| o.relative_plan == rp::Vector::Z * 2.));
        assert!(scratch.rows.is_empty());
        let peer = contact(&world, &scratch, [ids[0], ids[1]], 4e-8, 0.01, &mut work);
        scratch.contacts = vec![peer];
        let bound = scratch
            .active_remaining(world.actual_motion_scratch_bound().unwrap())
            .unwrap();
        scratch
            .response_at(
                hit(peer, 2e-8, 4e-8),
                2e-8,
                Time::from(D),
                &world.backend.bodies,
                &world.backend.colliders,
                &world.characters,
                false,
                1.,
                &mut work,
                bound,
            )
            .unwrap();
        for actor in &ids[..2] {
            let i = scratch.entry_index(Some(native_id(*actor))).unwrap();
            assert_eq!(
                curve_velocity(scratch.entries[i].curve, 4e-8).unwrap().0,
                rp::Vector::Z * 2.,
                "canonical input resumes after release {control}"
            );
            assert_eq!(scratch.entries[i].velocity_delta, rp::Vector::ZERO);
        }
    }
}

#[test]
fn finite_or_rotating_sources_never_become_geometry_history_drivers() {
    for control in 0..3 {
        let (mut world, mut scratch, ids, mut work) = fixture();
        let sample = contact(&world, &scratch, [ids[0], ids[2]], 2e-8, 0.01, &mut work);
        scratch.contacts = vec![sample];
        if control == 1 {
            world.characters.get_mut(&ids[0]).unwrap().config.push_mass = 10.;
        } else if control == 0 {
            let mut sample = sample;
            let kernel = Kernel::from_velocity(
                native_id(ids[2]),
                Domain::new(0., Time::from(D)).unwrap(),
                sample.b.motion.curve.com_pose(0.),
                -rp::Vector::X * 60.,
                rp::Vector::Y,
            )
            .unwrap();
            sample.b.motion.curve = Curve::Integrated(kernel);
            scratch.contacts[0] = sample;
        } else {
            world.backend.bodies[native_id(ids[2])]
                .set_body_type(rp::RigidBodyType::Dynamic, false);
            prepare(&world, &mut scratch, &mut work);
            scratch.contacts[0] =
                contact(&world, &scratch, [ids[0], ids[2]], 2e-8, 0.01, &mut work);
            assert_eq!(scratch.contacts[0].b.role, Role::Dynamic);
        }
        scratch
            .remember_active_contacts(
                0.,
                2e-8,
                &world.backend.bodies,
                &world.backend.colliders,
                &world.characters,
                &mut work,
                world.actual_motion_scratch_bound().unwrap(),
            )
            .unwrap();
        assert!(scratch.active_contacts.is_empty());
    }
}

#[test]
fn history_admission_is_before_reservation_and_all_context_boundaries_clear_it() {
    let (world, mut scratch, ids, mut work) = fixture();
    let sample = contact(&world, &scratch, [ids[0], ids[2]], 2e-8, 0.01, &mut work);
    scratch.contacts = vec![sample];
    let old = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let bytes = scratch.active_bytes(4).unwrap();
    let contact_bytes = std::mem::size_of::<actual_scene::ContactSample>();
    assert_eq!(
        scratch.remember_active_contacts(
            0.,
            2e-8,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &mut work,
            bytes + contact_bytes - 1
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(scratch.active_contacts.capacity(), 0);
    let mut denied = Work {
        used: work.used,
        limit: work.used,
    };
    assert_eq!(
        scratch.remember_active_contacts(
            0.,
            2e-8,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &mut denied,
            usize::MAX
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(scratch.active_contacts.capacity(), 0);
    scratch
        .remember_active_contacts(
            0.,
            2e-8,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &mut work,
            bytes + contact_bytes,
        )
        .unwrap();
    let retained = scratch.active_bytes(0).unwrap();
    assert_eq!(
        scratch.active_remaining(retained - 1),
        Err(TrajectoryError::WorkLimit)
    );
    let record = scratch.active_contacts[0];
    scratch.begin_tick();
    assert!(scratch.active_contacts.is_empty());
    scratch.active_contacts.push(record);
    scratch.begin_controller_interval();
    assert!(scratch.active_contacts.is_empty());
    scratch.active_contacts.push(record);
    scratch.begin_pass();
    assert!(scratch.active_contacts.is_empty());
    scratch.active_contacts.push(record);
    scratch.reject_current_pass();
    assert!(scratch.active_contacts.is_empty());
    scratch.active_contacts.push(record);
    scratch.reset();
    assert!(scratch.active_contacts.is_empty());
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), old);
}

/// The immutable C79 response-2 curves, before the recorded capsule response.
fn recorded_c79_driver_phase() -> (
    PhysicsWorld3d,
    BackendMotionScratch,
    [BodyId; 3],
    Time,
    Time,
    Work,
) {
    let (world, mut scratch, ids, _) = fixture();
    let safe = 0.09999989997595549;
    let hit_time = 0.09999991266522556543;
    let end = 0.10000000149011612;
    let mut driver = Kernel::from_velocity_seconds(
        native_id(ids[2]),
        Domain::new(0.07500000111758709, end).unwrap(),
        0.025,
        rp::Pose::from_translation(rp::Vector::new(-1.5, 0., 0.)),
        rp::Vector::new(-60., 0., 0.),
        rp::Vector::ZERO,
    )
    .unwrap();
    driver.native.motion.start_time = 0.075;
    driver.native.motion.end_time = 0.1;
    scratch.entries.clear();
    for (id, x, velocity) in [
        (ids[0], -3.509994, rp::Vector::new(-60., 0., 2.)),
        (ids[1], -4.0199947, rp::Vector::new(0., 0., 2.)),
    ] {
        let kernel = Kernel::from_velocity_seconds(
            native_id(id),
            Domain::new(safe, end).unwrap(),
            (end - safe) as f32,
            rp::Pose::from_translation(rp::Vector::new(x, 0., 0.19999981)),
            velocity,
            rp::Vector::ZERO,
        )
        .unwrap();
        let mut entry = super::super::momentum_tests::entry(native_id(id), kernel);
        entry.domain_start = safe;
        if id == ids[0] {
            entry.curve = Curve::Anchored {
                carrier: driver,
                anchor: rp::Vector::ZERO,
                offset: rp::Vector::new(-0.5100002, 0., 0.15),
                linear_velocity: rp::Vector::new(0., 0., 2.),
                rotation: rp::Rotation::IDENTITY,
            };
        }
        scratch.entries.push(entry);
    }
    scratch.entries.push(super::super::momentum_tests::entry(
        native_id(ids[2]),
        driver,
    ));
    let mut work = Work {
        used: 12_646_763,
        limit: super::super::super::trajectory::MAX_PROOF_WORK,
    };
    prepare_at(&world, &mut scratch, safe, &mut work);
    let wall = contact(
        &world,
        &scratch,
        [ids[0], ids[2]],
        safe,
        f32::MAX,
        &mut work,
    );
    scratch.contacts = vec![wall];
    scratch
        .remember_active_contacts(
            safe,
            safe,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &mut work,
            world.actual_motion_scratch_bound().unwrap(),
        )
        .unwrap();
    let peer = contact(
        &world,
        &scratch,
        [ids[1], ids[0]],
        hit_time,
        0.01,
        &mut work,
    );
    scratch.contacts = vec![peer];
    scratch
        .refresh_active_contacts(
            hit_time,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &world.contact_policies,
            true,
            &mut work,
        )
        .unwrap();
    assert_eq!(scratch.active_contacts.len(), 1);
    assert!(scratch.active_contacts[0].visible);
    (world, scratch, ids, safe, hit_time, work)
}

#[test]
fn recorded_c79_peer_response_retains_admitted_driver_phase_and_finishes_the_real_suffix() {
    let (world, mut scratch, ids, safe, hit_time, mut work) = recorded_c79_driver_phase();
    let end = Time::from(D);
    let index = scratch.entry_index(Some(native_id(ids[0]))).unwrap();
    let admitted = postcard::to_allocvec(&scratch.entries[index].curve).unwrap();
    let origins = postcard::to_allocvec(
        &scratch
            .origins
            .iter()
            .map(|o| (o.relative_plan, o.relative_momentum, o.velocity_delta))
            .collect::<Vec<_>>(),
    )
    .unwrap();
    let snapshot = world.capture_snapshot().unwrap();
    let sample = scratch.contacts[0];
    let bound = scratch
        .active_remaining(world.actual_motion_scratch_bound().unwrap())
        .unwrap();
    scratch
        .response_at(
            hit(sample, safe, hit_time),
            safe,
            end,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            false,
            1.,
            &mut work,
            bound,
        )
        .unwrap();
    // The fresh-row virtual participant is not physical J. Complete simultaneous
    // rows admit the existing wall phase with the original free tangent 2.
    assert_eq!(
        postcard::to_allocvec(&scratch.entries[index].curve).unwrap(),
        admitted
    );
    assert_eq!(
        curve_velocity(scratch.entries[index].curve, hit_time)
            .unwrap()
            .0,
        rp::Vector::new(-60., 0., 2.)
    );
    scratch.verify_selected_geometry_rows(&mut work).unwrap();
    scratch
        .remember_active_contacts(
            safe,
            hit_time,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            &mut work,
            world.actual_motion_scratch_bound().unwrap(),
        )
        .unwrap();
    // A small bounded real scene continuation, not an assertion that avoiding
    // the old descriptor alone constitutes whole-future approval.
    let mut time = safe;
    let mut completed = false;
    for _ in 0..8 {
        prepare_at(&world, &mut scratch, time, &mut work);
        let next = scratch
            .scene
            .first_hit(
                &world.backend.colliders,
                &world.contact_policies,
                time,
                end,
                0.01,
                f64::from((0.1_f32 - 0.075_f32) * 1e-6),
                &mut work,
                &|_, _| true,
            )
            .unwrap();
        let Some(next) = next else {
            completed = true;
            break;
        };
        scratch.contacts.clear();
        let contacts = &mut scratch.contacts;
        scratch
            .scene
            .contacts_at(
                &world.backend.colliders,
                &world.contact_policies,
                next.cast.hit_time,
                0.01,
                &mut work,
                &|_, _| true,
                &mut |sample, _| {
                    contacts.push(sample);
                    Ok(())
                },
            )
            .unwrap();
        scratch
            .refresh_active_contacts(
                next.cast.hit_time,
                &world.backend.bodies,
                &world.backend.colliders,
                &world.characters,
                &world.contact_policies,
                true,
                &mut work,
            )
            .unwrap();
        let bound = scratch
            .active_remaining(world.actual_motion_scratch_bound().unwrap())
            .unwrap();
        scratch
            .response_at(
                next,
                next.cast.safe_time,
                end,
                &world.backend.bodies,
                &world.backend.colliders,
                &world.characters,
                false,
                1.,
                &mut work,
                bound,
            )
            .unwrap();
        scratch
            .remember_active_contacts(
                next.cast.safe_time,
                next.cast.hit_time,
                &world.backend.bodies,
                &world.backend.colliders,
                &world.characters,
                &mut work,
                world.actual_motion_scratch_bound().unwrap(),
            )
            .unwrap();
        time = next.cast.safe_time;
    }
    assert!(
        completed,
        "the actual whole scene must clear within eight responses"
    );
    assert!(work.used < work.limit);
    for id in &ids[..2] {
        let entry = &scratch.entries[scratch.entry_index(Some(native_id(*id))).unwrap()];
        assert!((entry.curve.com_pose(end).translation.z - 0.2).abs() < 1e-6);
        assert_eq!(entry.velocity_delta, rp::Vector::ZERO);
    }
    assert!(scratch.rows.is_empty());
    assert!(scratch.row_impulses.is_empty());
    assert_eq!(
        postcard::to_allocvec(
            &scratch
                .origins
                .iter()
                .map(|o| (o.relative_plan, o.relative_momentum, o.velocity_delta))
                .collect::<Vec<_>>()
        )
        .unwrap(),
        origins
    );
    assert_eq!(
        world.capture_snapshot().unwrap().encoded_bytes(),
        snapshot.encoded_bytes()
    );
}

#[test]
fn retained_driver_phase_requires_current_planes_canonical_tangents_and_exact_budget() {
    let (world, mut scratch, ids, safe, hit_time, _) = recorded_c79_driver_phase();
    let actor = scratch.entry_index(Some(native_id(ids[0]))).unwrap();
    let peer = scratch.entry_index(Some(native_id(ids[1]))).unwrap();
    let projected = rp::Vector::new(-60., 0., 1.9999983);
    let peer_projected = rp::Vector::new(-60., 0., 2.0000017);
    scratch.participants = scratch
        .entries
        .iter()
        .map(|entry| Participant {
            body: identity(entry.value.handle),
            pose: entry.curve.com_pose(hit_time),
            linear_velocity: rp::Vector::new(-30., 0., 2.),
            angular_velocity: rp::Vector::ZERO,
            mass: MassPolicy::Native,
        })
        .collect();
    scratch.character_values = vec![(ids[0], projected), (ids[1], peer_projected)];
    scratch.character_carry = vec![rp::Vector::ZERO; 2];
    let sample = scratch.contacts[0];
    scratch.character_rows = vec![
        actual_rows::Row {
            a: peer,
            b: Some(actor),
            normal: -sample.contact.normal1,
            velocity: rp::Vector::ZERO,
        },
        actual_rows::Row {
            a: actor,
            b: None,
            normal: -rp::Vector::X,
            velocity: rp::Vector::new(-60., 0., 0.),
        },
    ];
    let previous_rate = curve_velocity(scratch.entries[actor].curve, hit_time).unwrap();
    let call = |s: &BackendMotionScratch, w: &PhysicsWorld3d, budget: &mut Work| {
        s.retain_driver_phase(
            actor,
            hit(sample, safe, hit_time),
            safe,
            Time::from(D),
            &w.backend.bodies,
            &w.backend.colliders,
            &w.characters,
            projected,
            previous_rate,
            false,
            budget,
        )
    };
    let before =
        postcard::to_allocvec(&(scratch.entries[actor].curve, &scratch.character_values)).unwrap();
    let mut budget = Work {
        used: 0,
        limit: super::super::super::trajectory::MAX_PROOF_WORK,
    };
    assert!(call(&scratch, &world, &mut budget).unwrap());
    let price = budget.used;
    for allowance in [price, price - 1] {
        let mut budget = Work {
            used: 1000,
            limit: 1000 + allowance,
        };
        let result = call(&scratch, &world, &mut budget);
        if allowance == price {
            assert!(result.unwrap());
            assert_eq!(budget.used, budget.limit);
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
        assert_eq!(
            postcard::to_allocvec(&(scratch.entries[actor].curve, &scratch.character_values))
                .unwrap(),
            before
        );
    }
    // Each removal is tested on the same immutable captured row/curve state.
    let old = scratch.entries[actor].support;
    scratch.entries[actor].support = Some(native_id(ids[2]));
    assert!(!call(
        &scratch,
        &world,
        &mut Work {
            used: 0,
            limit: 10000
        }
    )
    .unwrap());
    scratch.entries[actor].support = old;
    scratch.character_carry[actor] = rp::Vector::Z;
    assert!(!call(
        &scratch,
        &world,
        &mut Work {
            used: 0,
            limit: 10000
        }
    )
    .unwrap());
    scratch.character_carry[actor] = rp::Vector::ZERO;
    let plan = scratch.origins[actor].relative_plan;
    scratch.origins[actor].relative_plan.z = 3.;
    assert!(!call(
        &scratch,
        &world,
        &mut Work {
            used: 0,
            limit: 10000
        }
    )
    .unwrap());
    scratch.origins[actor].relative_plan = plan;
    let driver = scratch.entry_index(Some(native_id(ids[2]))).unwrap();
    scratch.entries[driver].stopped_at = Some(safe);
    assert!(!call(
        &scratch,
        &world,
        &mut Work {
            used: 0,
            limit: 10000
        }
    )
    .unwrap());
    scratch.entries[driver].stopped_at = None;
    let current = scratch.entries[driver].curve;
    scratch.entries[driver].curve = Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: safe,
        end_time: Time::from(D),
    };
    assert!(!call(
        &scratch,
        &world,
        &mut Work {
            used: 0,
            limit: 10000
        }
    )
    .unwrap());
    scratch.entries[driver].curve = current;
    let records = std::mem::take(&mut scratch.active_contacts);
    assert!(!call(
        &scratch,
        &world,
        &mut Work {
            used: 0,
            limit: 10000
        }
    )
    .unwrap());
    scratch.active_contacts = records;
    // The original projected value satisfies this plane; restoring tangent 2
    // would not. No previous descriptor may overrule a current inequality.
    scratch.character_rows.push(actual_rows::Row {
        a: actor,
        b: None,
        normal: -rp::Vector::Z,
        velocity: rp::Vector::Z * 1.999999,
    });
    assert!(!call(
        &scratch,
        &world,
        &mut Work {
            used: 0,
            limit: 10000
        }
    )
    .unwrap());
    scratch.character_rows.pop();
    let mut finite = world;
    finite.characters.get_mut(&ids[0]).unwrap().config.push_mass = 1.;
    assert!(!call(
        &scratch,
        &finite,
        &mut Work {
            used: 0,
            limit: 10000
        }
    )
    .unwrap());
}
