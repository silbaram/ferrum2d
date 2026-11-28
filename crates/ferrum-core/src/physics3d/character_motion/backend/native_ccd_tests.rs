use super::*;

#[test]
fn observation_off_linear_sphere_and_locked_box_keep_actual_force_kernels_and_native_momentum() {
    use crate::physics3d::{BodyDesc, BodyOptions, ColliderDesc, Shape, WorldConfig};
    for locked in [false, true] {
        for ccd in [false, true] {
            let mut world = PhysicsWorld3d::new(WorldConfig {
                gravity: [0.; 3],
                step_seconds: 0.1,
                ..Default::default()
            })
            .unwrap();
            let desc = BodyDesc {
                ccd,
                can_sleep: false,
                ..Default::default()
            };
            let body = world
                .create_body(
                    desc.clone(),
                    ColliderDesc::new(if locked {
                        Shape::Box {
                            half_extents: [0.25; 3],
                        }
                    } else {
                        Shape::Sphere { radius: 0.25 }
                    }),
                )
                .unwrap();
            world
                .set_body_options(
                    body,
                    &BodyOptions {
                        lock_rotation: locked,
                        ..BodyOptions::from(&desc)
                    },
                )
                .unwrap();
            world.add_force(body, [0.125, 0., 0.], [0.; 3]).unwrap();
            let saved = world.capture_snapshot().unwrap();
            let mut native_reference = PhysicsWorld3d::from_snapshot(&saved).unwrap();
            world.force_rigid_motion_proof();
            assert!(!world.step_motion.enabled);
            assert!(world.backend_motion_enabled(), "locked={locked} ccd={ccd}");
            let id = crate::physics3d::world::native_id(body);
            let force = world.backend.bodies[id].user_force();
            // Unchanged vendor/default handler is the independent momentum
            // reference. No collider can cause a CCD clamp in this control.
            native_reference
                .backend
                .step_with_events(&native_reference.contact_policies, &native_reference.events);
            world.step_checked().unwrap();
            assert_eq!(
                world.body_state(body).unwrap(),
                native_reference.body_state(body).unwrap()
            );
            assert_eq!(world.backend.bodies[id].user_force(), force);
            let paths: Vec<_> = world
                .character_motion
                .backend_motion
                .ccd_source
                .iter()
                .filter(|r| r.body == id)
                .collect();
            assert!(
                paths.len() >= 2,
                "multiple force kernels must exist with observation off"
            );
            assert!(paths
                .windows(2)
                .any(|p| curve_velocity(p[0].curve, p[0].start_time).unwrap().0
                    != curve_velocity(p[1].curve, p[1].start_time).unwrap().0));
            let middle = Time::from(world.config.step_seconds) * 0.5;
            let row = paths
                .iter()
                .find(|r| r.start_time <= middle && r.end_time >= middle)
                .unwrap();
            let actual = row.curve.com_pose(middle).translation.x;
            let end = world.body_state(body).unwrap().pose.position[0];
            assert!(
                actual < end * 0.5,
                "accelerating kernels differ from endpoint chord"
            );
            assert!(
                world.events.2.lock().unwrap().actual.is_empty(),
                "public observation stays off"
            );
        }
    }
}

#[test]
fn disabled_joint_pair_does_not_disable_an_unrelated_native_ccd_target() {
    use crate::physics3d::{
        BodyDesc, BodyKind, ColliderDesc, JointDesc, JointKind, Pose, Shape, WorldConfig,
    };
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let anchor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [-0.25, 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25; 3],
            }),
        )
        .unwrap();
    let mover = world
        .create_body(
            BodyDesc {
                linear_velocity: [10., 0., 0.],
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
        )
        .unwrap();
    let target = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [1.2, 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 1., 1.],
            }),
        )
        .unwrap();
    // The slack cable disables the connected pair without constraining the mover.
    // The unrelated wall first contacts in the final pass (.75 -> 1).
    let joint = world
        .create_joint(JointDesc::new(
            anchor,
            mover,
            JointKind::Rope { max_length: 10. },
        ))
        .unwrap();
    assert!(!world.backend_motion_enabled());
    world.step_checked().unwrap();
    let state = world.body_state(mover).unwrap();
    assert!((state.pose.position[0] - 0.855).abs() < 0.0001, "{state:?}");
    assert_eq!(world.ccd_clamps().len(), 1);
    assert_eq!(world.ccd_clamps()[0].target.body, target);
    assert_eq!(world.step_statistics().ccd_clamp_checks, 3);
    assert_eq!(state.linear_velocity, [10., 0., 0.]);
    assert_eq!(world.joint_state(joint).unwrap().force, 0.);
    let mut impulses = Vec::new();
    assert_eq!(world.contact_impulses(&mut impulses).solved_contacts, 0);
    assert!(impulses.is_empty());
}

#[test]
fn late_promotion_returns_zero_time_command_credit_before_a_fresh_plan() {
    use crate::physics3d::{
        BodyDesc, BodyKind, CharacterConfig, CharacterInput, ColliderDesc, PhysicsError, Shape,
        WorldConfig,
    };
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let actor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
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
                push_mass: 2.,
                ..Default::default()
            },
        )
        .unwrap();
    world
        .set_character_input(
            actor,
            CharacterInput {
                velocity: [2., 0., 0.],
                ..Default::default()
            },
        )
        .unwrap();
    world.apply_character_impulse(actor, [0., 2., 0.]).unwrap();
    world.add_character_force(actor, [0., 20., 0.]).unwrap();
    let queued = world.characters[&actor].pending_impulse;
    let native = crate::physics3d::world::native_id(actor);
    let initial_velocity = world.backend.bodies[native].linvel();
    world.capture_actual_interval_credit().unwrap();
    world.step_characters();
    let once = (
        world.characters[&actor].external_velocity,
        world.characters[&actor].free_velocity,
        *world.backend.bodies[native].next_position(),
    );
    assert_eq!(world.characters[&actor].pending_impulse, [0.; 3]);
    world.character_motion.backend_motion.promoted.push(actor);
    world.character_motion.backend_motion.promotion_pending = true;
    assert_eq!(
        world.finish_actual_interval_credit(0.),
        Err(PhysicsError::UnresolvedMotion)
    );
    assert_eq!(world.characters[&actor].pending_impulse, queued);
    assert_eq!(world.backend.bodies[native].linvel(), initial_velocity);
    assert_eq!(world.actual_motion_completed_time(), 0.);
    assert!(matches!(
        world.retry_actual_wake(0.1).unwrap(),
        Some(WakeRetry::Promoted)
    ));
    assert_eq!(world.character_motion.backend_motion.promoted, [actor]);
    world.capture_actual_interval_credit().unwrap();
    world.step_characters();
    assert_eq!(
        once,
        (
            world.characters[&actor].external_velocity,
            world.characters[&actor].free_velocity,
            *world.backend.bodies[native].next_position()
        )
    );
    assert_eq!(world.characters[&actor].pending_impulse, [0.; 3]);
}

#[test]
fn actual_contact_component_promotes_once_without_joining_through_a_fixed_wall() {
    let mut world = rp::PhysicsWorld::new();
    let mut handles = Vec::new();
    for x in [0., 1., 10.] {
        let (body, _) = world.insert(
            rp::RigidBodyBuilder::dynamic()
                .translation(rp::Vector::X * x)
                .can_sleep(false),
            rp::ColliderBuilder::ball(0.5),
        );
        handles.push(body);
    }
    world.insert(
        rp::RigidBodyBuilder::fixed().translation(-rp::Vector::Y),
        rp::ColliderBuilder::cuboid(20., 0.5, 1.),
    );
    let source = crate::checkpoint_codec::encode(&world).unwrap();
    let characters = BTreeMap::new();
    let policies = ContactPolicies::default();
    let tracks: Vec<_> = handles
        .iter()
        .map(|&body| BodyTrajectory {
            body,
            curve: Curve::Constant {
                pose: *world.bodies[body].position(),
                start_time: 0.,
                end_time: 0.1,
            },
        })
        .collect();
    let mut scene = actual_scene::Scratch::default();
    let mut work = Work {
        used: 0,
        limit: super::super::trajectory::MAX_PROOF_WORK,
    };
    scene
        .prepare(
            &world.bodies,
            &world.colliders,
            &tracks,
            &characters,
            0.,
            0.1,
            usize::MAX,
            &mut work,
        )
        .unwrap();
    let mut scratch = BackendMotionScratch::default();
    scene
        .contacts_at(
            &world.colliders,
            &policies,
            0.,
            0.001,
            &mut work,
            &|_, _| true,
            &mut |sample, _| {
                scratch.contacts.push(sample);
                Ok(())
            },
        )
        .unwrap();
    assert!(scratch
        .contacts
        .iter()
        .any(|s| [s.a.parent, s.b.parent].contains(&Some(handles[2]))));
    scratch.affected.push(identity(handles[0]));
    scratch.prepare_mixed().unwrap();
    assert!(scratch
        .contact_component(&mut work, world.bodies.len())
        .unwrap());
    assert!(scratch.needs_promotion());
    assert_eq!(scratch.promoted, [identity(handles[1])]);
    assert!(!scratch.mixed.contains(&identity(handles[2])));
    let used = work.used;
    scratch.reset();
    scratch.prepare_mixed().unwrap();
    assert!(!scratch.needs_promotion());
    assert!(!scratch
        .contact_component(&mut work, world.bodies.len())
        .unwrap());
    assert!(work.used > used);
    assert!(!scratch
        .contacts
        .iter()
        .any(|s| [s.a.parent, s.b.parent].contains(&Some(handles[2]))));
    assert_eq!(source, crate::checkpoint_codec::encode(&world).unwrap());
}

#[test]
fn classification_budget_rejects_before_replacing_existing_tags() {
    let body = BodyId {
        slot: 7,
        generation: 2,
    };
    let mut scratch = BackendMotionScratch::default();
    scratch.affected.push(body);
    scratch.prepare_mixed().unwrap();
    let required = scratch.used;
    let mut exact = BackendMotionScratch::default();
    exact.affected.push(body);
    exact.used = super::super::trajectory::MAX_PROOF_WORK - required;
    exact.prepare_mixed().unwrap();
    assert_eq!(exact.mixed, [body]);
    let mut below = BackendMotionScratch::default();
    below.affected.push(body);
    below.mixed.push(BodyId {
        slot: 9,
        generation: 3,
    });
    below.used = super::super::trajectory::MAX_PROOF_WORK;
    let before = below.mixed.clone();
    assert_eq!(below.prepare_mixed(), Err(TrajectoryError::WorkLimit));
    assert_eq!(below.mixed, before);
}

#[test]
fn path_origin_sensor_request_survives_actual_rotation_and_never_creates_an_impulse() {
    use crate::physics3d::{
        BodyDesc, BodyKind, ColliderDesc, KinematicPath, Pose, Shape, WorldConfig,
    };
    for (requested, target_sensor, target_kind, stopped) in [
        (true, false, BodyKind::Fixed, true),
        (false, false, BodyKind::Fixed, false),
        (true, true, BodyKind::Fixed, false),
        (true, false, BodyKind::Dynamic, false),
    ] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            step_seconds: 0.1,
            ..Default::default()
        })
        .unwrap();
        let mover = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [0., 1., 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc {
                    sensor: true,
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: [1., 0.1, 0.1],
                    })
                },
            )
            .unwrap();
        world
            .create_body(
                BodyDesc {
                    kind: target_kind,
                    can_sleep: false,
                    pose: Pose {
                        position: [0., 1.45, 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc {
                    sensor: target_sensor,
                    ..ColliderDesc::new(Shape::Sphere { radius: 0.25 })
                },
            )
            .unwrap();
        world.set_step_motion_enabled(true);
        let path = KinematicPath {
            body: mover,
            sweep_sensors: requested,
            knots: (1..=4)
                .map(|i| {
                    let fraction = i as f32 / 4.;
                    let half_angle = std::f32::consts::PI * fraction;
                    (
                        fraction,
                        Pose {
                            position: [0.1 * fraction, 1., 0.],
                            rotation: [0., 0., half_angle.sin(), half_angle.cos()],
                        },
                    )
                })
                .collect(),
        };
        world.step_with_kinematic_paths(&[path]).unwrap();
        let progress = world.kinematic_path_progress_precise(mover);
        assert_eq!(
            progress.1, stopped,
            "request={requested} target_sensor={target_sensor} kind={target_kind:?}"
        );
        if stopped {
            assert!(progress.0 > 0. && progress.0 < 0.25, "{progress:?}");
            let state = world.body_state(mover).unwrap();
            assert!(
                state.pose.position[0] > 0. && state.pose.position[0] < 0.03,
                "{state:?}"
            );
            let exact = world
                .step_motion
                .test_exact_segments(crate::physics3d::world::native_id(mover));
            assert!(
                exact.iter().any(|(motion, from, to, _, _)| {
                    *from < *to && matches!(motion.curve, Curve::Constant { .. })
                }),
                "sensor stop must retain an exact stationary suffix: {exact:?}"
            );
        } else {
            assert_eq!(progress, (1., false));
        }
        let mut impulses = Vec::new();
        world.contact_impulses(&mut impulses);
        assert!(
            impulses.is_empty(),
            "a requested sensor sweep has no physical J: {impulses:?}"
        );
    }
}
