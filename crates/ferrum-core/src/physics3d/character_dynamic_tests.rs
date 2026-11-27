use super::*;

fn c12_checked_motion(w: &mut PhysicsWorld3d, label: &str) {
    let result = w.step_checked();
    if result.is_err() {
        w.diagnostic_actual_motion(label);
    }
    assert!(
        result.is_ok(),
        "first actual checked failure: {label} {result:?}"
    );
}

fn actor(w: &mut PhysicsWorld3d, x: f32, mass: f32) -> BodyId {
    let id = w
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
    w.enable_character(
        id,
        CharacterConfig {
            push_mass: mass,
            step_height: 0.,
            ..Default::default()
        },
    )
    .unwrap();
    id
}
fn dynamic(w: &mut PhysicsWorld3d, x: f32) -> BodyId {
    w.create_body(
        BodyDesc {
            kind: BodyKind::Dynamic,
            ccd: true,
            pose: Pose {
                position: [x, 0., 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [0.25, 1., 1.],
        }),
    )
    .unwrap()
}
fn world() -> PhysicsWorld3d {
    PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap()
}

#[test]
fn character_external_impulse_is_consumed_once() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let a = w
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
    w.enable_character(
        a,
        CharacterConfig {
            push_mass: 2.,
            ..Default::default()
        },
    )
    .unwrap();
    w.apply_character_impulse(a, [4., 0., 0.]).unwrap();
    w.step();
    assert!((w.body_state(a).unwrap().pose.position[0] - 0.2).abs() < 1e-5);
    w.step();
    assert!((w.body_state(a).unwrap().pose.position[0] - 0.4).abs() < 1e-5);
}

#[test]
fn finite_mass_dynamic_impact_splits_the_tick_and_conserves_momentum() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    let b = dynamic(&mut w, 1.);
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [10., 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    w.step();
    let actor = w.body_state(a).unwrap();
    let dynamic = w.body_state(b).unwrap();
    assert!(
        (actor.linear_velocity[0] - 5.).abs() < 0.01,
        "{actor:?}; {dynamic:?}"
    );
    assert!(
        (dynamic.linear_velocity[0] - 5.).abs() < 0.01,
        "{actor:?}; {dynamic:?}"
    );
    assert!(
        (actor.pose.position[0] - 0.745).abs() < 0.01,
        "{actor:?}; {dynamic:?}"
    );
    assert!(
        (dynamic.pose.position[0] - 1.255).abs() < 0.01,
        "{actor:?}; {dynamic:?}"
    );
    assert!((2. * actor.linear_velocity[0] + 2. * dynamic.linear_velocity[0] - 20.).abs() < 0.01);
}

#[test]
#[ignore = "P2b measures the finite-mass reaction in the trial and baseline"]
fn p2b_compare_finite_mass_push() {
    for mode in super::p1b_tests::MODES {
        let mut w = world();
        let a = actor(&mut w, 0., 2.);
        let b = dynamic(&mut w, 1.);
        mode.configure(&mut w);
        w.set_character_input(
            a,
            CharacterInput {
                velocity: [10., 0., 0.],
                ..Default::default()
            },
        )
        .unwrap();
        let result = w.step_checked();
        let actor = w.body_state(a).unwrap();
        let dynamic = w.body_state(b).unwrap();
        let momentum = 2. * (actor.linear_velocity[0] + dynamic.linear_velocity[0]);
        println!("P2B_FINITE_PUSH mode={mode:?} result={result:?} actor_x={} actor_vx={} dynamic_x={} dynamic_vx={} momentum={momentum}",
            actor.pose.position[0], actor.linear_velocity[0],
            dynamic.pose.position[0], dynamic.linear_velocity[0]);
    }
}

#[test]
fn p2b_compare_passive_knockback() {
    for space in [Space::PlanarXy, Space::Spatial] {
        for mode in super::p1b_tests::MODES {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                space,
                gravity: [0.; 3],
                step_seconds: 0.01,
                ..WorldConfig::default()
            })
            .unwrap();
            let a = w
                .create_body(
                    BodyDesc {
                        kind: BodyKind::KinematicPosition,
                        pose: Pose {
                            position: [-2., 0., 0.],
                            ..Pose::default()
                        },
                        ..BodyDesc::default()
                    },
                    ColliderDesc::new(Shape::Capsule {
                        half_height: 0.5,
                        radius: 0.25,
                    }),
                )
                .unwrap();
            w.enable_character(
                a,
                CharacterConfig {
                    push_mass: 2.,
                    step_height: 0.,
                    snap_distance: 0.,
                    ..CharacterConfig::default()
                },
            )
            .unwrap();
            let mut fixture = ColliderDesc::new(Shape::Box {
                half_extents: [0.5; 3],
            });
            fixture.density = 2.;
            fixture.friction = 0.;
            let b = w
                .create_body(
                    BodyDesc {
                        can_sleep: false,
                        ..BodyDesc::default()
                    },
                    fixture,
                )
                .unwrap();
            mode.configure(&mut w);
            w.apply_character_impulse(a, [10., 0., 0.]).unwrap();
            for _ in 0..50 {
                w.step_checked().unwrap();
            }
            let actor = w.character_state(a).unwrap();
            let dynamic = w.body_state(b).unwrap();
            let momentum = 2. * (actor.velocity[0] + dynamic.linear_velocity[0]);
            println!("P2B_PASSIVE space={space:?} mode={mode:?} actor_vx={} box_vx={} box_x={} momentum={momentum}",
                actor.velocity[0], dynamic.linear_velocity[0], dynamic.pose.position[0]);
            assert!(
                (momentum - 10.).abs() < 0.1,
                "{space:?} {mode:?}: momentum={momentum}"
            );
        }
    }
}

fn incoming_dynamic_impact_fixture() -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    let b = dynamic(&mut w, 1.);
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [0., 0., 2.],
            ..Default::default()
        },
    )
    .unwrap();
    w.set_velocity(b, [-10., 0., 0.], [0.; 3]).unwrap();
    (w, a, b)
}

#[test]
fn incoming_dynamic_impact_transfers_normal_momentum_and_preserves_tangent() {
    let (mut w, a, b) = incoming_dynamic_impact_fixture();
    c12_checked_motion(
        &mut w,
        "incoming_dynamic_impact_transfers_normal_momentum_and_preserves_tangent",
    );
    let actor = w.body_state(a).unwrap();
    let dynamic = w.body_state(b).unwrap();
    assert!(
        actor.linear_velocity[0] < -4.8 && dynamic.linear_velocity[0] < -4.8,
        "{actor:?}; {dynamic:?}"
    );
    assert!((2. * actor.linear_velocity[0] + 2. * dynamic.linear_velocity[0] + 20.).abs() < 0.01);
    assert!(
        dynamic.angular_velocity[1].abs() > 0.5,
        "off-center impact must transfer angular momentum: {dynamic:?}"
    );
    assert!((actor.pose.position[2] - 0.2).abs() < 0.001, "{actor:?}");
    let before = actor.pose.position[0];
    c12_checked_motion(
        &mut w,
        "incoming_dynamic_impact_transfers_normal_momentum_and_preserves_tangent",
    );
    assert!(
        w.body_state(a).unwrap().pose.position[0] < before - 0.4,
        "dynamic knockback must persist as external velocity"
    );
}

#[test]
fn simultaneous_capsules_share_one_dynamic_body_without_duplicate_impulses() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    let b = actor(&mut w, 0.51, 2.);
    let d = dynamic(&mut w, 1.02);
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [9., 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    w.step();
    let states = [a, b, d].map(|id| w.body_state(id).unwrap());
    for state in &states {
        assert!((state.linear_velocity[0] - 3.).abs() < 0.01, "{states:?}");
    }
    assert!(
        (states
            .iter()
            .map(|s| 2. * s.linear_velocity[0])
            .sum::<f32>()
            - 18.)
            .abs()
            < 0.01
    );
    assert!(states[1].pose.position[0] - states[0].pose.position[0] >= 0.509);
    assert!(states[2].pose.position[0] - states[1].pose.position[0] >= 0.509);
}

#[test]
fn external_force_impulse_preview_and_checkpoint_have_explicit_ownership() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    // A distant prescribed body activates the preview/substep pipeline.
    let p = w
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicVelocity,
                pose: Pose {
                    position: [100., 0., 0.],
                    ..Default::default()
                },
                linear_velocity: [1., 0., 0.],
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [1.; 3],
            }),
        )
        .unwrap();
    w.add_character_force(a, [4., 0., 0.]).unwrap();
    w.apply_character_impulse(a, [2., 0., 0.]).unwrap();
    let checkpoint = w.capture_snapshot().unwrap();
    let mut restored = PhysicsWorld3d::from_snapshot(&checkpoint).unwrap();
    for tick in 0..5 {
        w.step();
        restored.step();
        assert_eq!(w.body_state(a).unwrap(), restored.body_state(a).unwrap());
        assert_eq!(
            w.character_state(a).unwrap(),
            restored.character_state(a).unwrap()
        );
        assert_eq!(w.body_state(p).unwrap(), restored.body_state(p).unwrap());
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            restored.capture_snapshot().unwrap().encoded_bytes()
        );
        let expected = 1. + 0.2 * (tick + 1) as f32;
        assert!((w.body_state(a).unwrap().linear_velocity[0] - expected).abs() < 1e-5);
    }
    w.clear_character_forces(a).unwrap();
    w.step();
    assert!((w.body_state(a).unwrap().linear_velocity[0] - 2.).abs() < 1e-5);
}

#[test]
fn dynamic_force_is_never_consumed_or_applied_twice_by_character_previews() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    let d = dynamic(&mut w, 100.);
    w.add_force(d, [20., 0., 0.], [0.; 3]).unwrap();
    w.apply_character_impulse(a, [2., 0., 0.]).unwrap();
    for tick in 1..=3 {
        w.step();
        assert!((w.body_state(d).unwrap().linear_velocity[0] - tick as f32).abs() < 1e-5);
        assert_eq!(
            w.backend.bodies[super::world::native_id(d)]
                .user_force()
                .to_array(),
            [20., 0., 0.]
        );
    }
}

fn dynamic_support_fixture(
    rotate: bool,
    mode: super::p1b_tests::Mode,
) -> (PhysicsWorld3d, BodyId, BodyId) {
    let mut w = world();
    let p = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                ccd: true,
                pose: Pose {
                    position: [0., -0.1, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.1, 2.],
            }),
        )
        .unwrap();
    let a = actor(&mut w, 1., 2.);
    w.set_pose(
        a,
        Pose {
            position: [1., 0.51, 0.],
            ..Default::default()
        },
    )
    .unwrap();
    mode.configure(&mut w);
    c12_checked_motion(
        &mut w,
        "dynamic_support_carry_uses_actual_solver_pose_and_rotating_contact_anchor",
    );
    assert!(w.character_state(a).unwrap().grounded);
    if rotate {
        w.set_velocity(p, [0.; 3], [0., 2., 0.]).unwrap();
    } else {
        w.set_body_options(
            p,
            &BodyOptions {
                kind: BodyKind::Dynamic,
                ccd: true,
                lock_rotation: true,
                ..Default::default()
            },
        )
        .unwrap();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2.3, 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 2., 3.],
            }),
        )
        .unwrap();
        w.set_velocity(p, [10., 0., 0.], [0.; 3]).unwrap();
    }
    (w, p, a)
}

#[test]
#[ignore = "P2b compares incoming dynamic contact and dynamic support on both paths"]
fn p2b_compare_incoming_impact_and_dynamic_support() {
    for mode in super::p1b_tests::MODES {
        let (mut w, a, b) = incoming_dynamic_impact_fixture();
        mode.configure(&mut w);
        w.step_checked().unwrap();
        let actor_x_velocity = w.body_state(a).unwrap().linear_velocity[0];
        let box_x_velocity = w.body_state(b).unwrap().linear_velocity[0];
        let (mut w, p, a) = dynamic_support_fixture(false, mode);
        let start = w.body_state(p).unwrap().pose.position[0];
        w.step_checked().unwrap();
        let platform_delta = w.body_state(p).unwrap().pose.position[0] - start;
        let carry = w.character_state(a).unwrap().carry_translation[0];
        println!("P2B_INCOMING mode={mode:?} actor_vx={actor_x_velocity} box_vx={box_x_velocity} support_delta={platform_delta} carry={carry}");
    }
}

#[test]
fn dynamic_support_carry_uses_actual_solver_pose_and_rotating_contact_anchor() {
    check_dynamic_support_carry(super::p1b_tests::Mode::Current);
}

#[test]
fn p2b_dynamic_support_carry_uses_actual_rapier_pose() {
    check_dynamic_support_carry(super::p1b_tests::Mode::Kcc);
}

fn check_dynamic_support_carry(mode: super::p1b_tests::Mode) {
    for rotate in [false, true] {
        let (mut w, p, a) = dynamic_support_fixture(rotate, mode);
        let start = super::world::native_pose(w.body_state(p).unwrap().pose);
        let mut anchor = rapier3d::prelude::Vector::new(1., 0., 0.);
        let local_anchor = start.inverse_transform_point(anchor);
        // Later ticks acquire the same material point on an already rotated platform.
        let ticks = if rotate { 3 } else { 1 };
        for _ in 0..ticks {
            let before = w.body_state(a).unwrap().pose.position;
            c12_checked_motion(
                &mut w,
                "dynamic_support_carry_uses_actual_solver_pose_and_rotating_contact_anchor",
            );
            let end = super::world::native_pose(w.body_state(p).unwrap().pose);
            let next_anchor = end * local_anchor;
            let expected = next_anchor - anchor;
            anchor = next_anchor;
            let state = w.character_state(a).unwrap();
            for axis in 0..3 {
                assert!(
                    (state.carry_translation[axis] - expected[axis]).abs() < 0.002,
                    "rotate={rotate}; carry={:?}; expected={expected:?}; platform={:?}",
                    state.carry_translation,
                    w.body_state(p).unwrap()
                );
                assert!(
                    (w.body_state(a).unwrap().pose.position[axis]
                        - before[axis]
                        - state.translation[axis])
                        .abs()
                        < 0.002
                );
            }
            assert_eq!(state.carried_by, Some(p));
            assert!(state.grounded);
        }
    }
}

#[test]
fn force_batch_rejects_late_rows_and_duplicate_overflow_atomically() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    let b = actor(&mut w, 10., 2.);
    let before = w.capture_snapshot().unwrap();
    assert!(w
        .apply_character_force_commands(&[(a, 0, [2., 0., 0.]), (b, 7, [0.; 3])])
        .is_err());
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    assert!(w
        .apply_character_force_commands(&[(a, 0, [1e6, 0., 0.]), (a, 0, [1., 0., 0.])])
        .is_err());
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    assert!(w
        .apply_character_force_commands(&[(a, 2, [1e6, 0., 0.]), (a, 2, [1., 0., 0.])])
        .is_err());
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    w.apply_character_force_commands(&[
        (a, 0, [4., 0., 0.]),
        (a, 1, [0.; 3]),
        (a, 0, [2., 0., 0.]),
        (a, 2, [1., 0., 0.]),
        (a, 2, [1., 0., 0.]),
    ])
    .unwrap();
    w.step();
    assert!((w.body_state(a).unwrap().linear_velocity[0] - 1.1).abs() < 1e-5);
}

#[test]
fn planar_external_commands_reject_out_of_plane_and_zero_mass_is_prescribed() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let a = actor(&mut w, 0., 2.);
    let prescribed = actor(&mut w, 10., 0.);
    let before = w.capture_snapshot().unwrap();
    assert_eq!(
        w.apply_character_impulse(a, [0., 0., 1.]),
        Err(PhysicsError::OutOfPlane)
    );
    assert_eq!(
        w.add_character_force(prescribed, [1., 0., 0.]),
        Err(PhysicsError::InvalidCharacter)
    );
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
    w.apply_character_impulse(a, [2., 0., 0.]).unwrap();
    w.step();
    assert_eq!(w.body_state(a).unwrap().pose.position[2], 0.);
    assert_eq!(w.body_state(prescribed).unwrap().pose.position[0], 10.);
}

#[test]
fn dynamic_collision_reactions_only_follow_accepted_masked_and_clamped_motion() {
    for masked in [false, true] {
        let mut w = world();
        let a = actor(&mut w, 0., 2.);
        let d = dynamic(&mut w, 2.);
        if masked {
            let c = w.collider_ids(d).unwrap().next().unwrap();
            let mut desc = ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 1., 1.],
            });
            desc.category = 2;
            desc.mask = 2;
            w.update_collider(c, desc).unwrap();
            let c = w.collider_ids(a).unwrap().next().unwrap();
            let mut desc = ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            });
            desc.category = 1;
            desc.mask = 1;
            w.update_collider(c, desc).unwrap();
        } else {
            w.create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position: [0.8, 0., 0.],
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [0.1, 2., 2.],
                }),
            )
            .unwrap();
        }
        w.set_character_input(
            a,
            CharacterInput {
                velocity: [30., 0., 0.],
                ..Default::default()
            },
        )
        .unwrap();
        w.step();
        assert_eq!(w.body_state(d).unwrap().linear_velocity, [0.; 3]);
        assert_eq!(w.body_state(d).unwrap().pose.position, [2., 0., 0.]);
        if !masked {
            assert!(w.body_state(a).unwrap().pose.position[0] < 0.451);
        }
    }
}

#[test]
fn dense_finite_mass_chain_has_bounded_work_and_conserves_momentum() {
    for count in [8, 32] {
        let mut w = world();
        let actors: Vec<_> = (0..count)
            .map(|i| actor(&mut w, 0.51 * i as f32, 2.))
            .collect();
        let d = dynamic(&mut w, 0.51 * count as f32);
        w.set_character_input(
            actors[0],
            CharacterInput {
                velocity: [9., 0., 0.],
                ..Default::default()
            },
        )
        .unwrap();
        let checkpoint = w.capture_snapshot().unwrap();
        let mut replay = PhysicsWorld3d::from_snapshot(&checkpoint).unwrap();
        w.step();
        replay.step();
        let expected = 9. / (count + 1) as f32;
        for &a in &actors {
            let state = w.character_state(a).unwrap();
            assert!(
                !state.character_coupling_iteration_limit,
                "count={count}: {state:?}"
            );
            assert!(
                (w.body_state(a).unwrap().linear_velocity[0] - expected).abs() < 0.01,
                "count={count}: {:?}; expected={expected}",
                w.body_state(a).unwrap()
            );
            assert!(
                state.character_coupling_iterations < 20_000,
                "count={count}: {state:?}"
            );
        }
        let total = actors
            .iter()
            .chain([&d])
            .map(|&a| 2. * w.body_state(a).unwrap().linear_velocity[0])
            .sum::<f32>();
        assert!(
            (total - 18.).abs() < 0.01,
            "count={count}: momentum={total}"
        );
        assert!(
            w.step_statistics().backend_steps <= 2,
            "{:?}",
            w.step_statistics()
        );
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            replay.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}

#[test]
fn finite_mass_bounds_distinguish_zero_minimum_and_invalid_values() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    for mass in [0., 0.0001, 10_000.] {
        w.enable_character(
            a,
            CharacterConfig {
                push_mass: mass,
                ..Default::default()
            },
        )
        .unwrap();
    }
    let before = w.capture_snapshot().unwrap();
    for mass in [
        f32::MIN_POSITIVE,
        0.000099,
        -1.,
        f32::NAN,
        f32::INFINITY,
        10_001.,
    ] {
        assert_eq!(
            w.enable_character(
                a,
                CharacterConfig {
                    push_mass: mass,
                    ..Default::default()
                }
            ),
            Err(PhysicsError::InvalidCharacter)
        );
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
    w.enable_character(
        a,
        CharacterConfig {
            push_mass: 0.0001,
            ..Default::default()
        },
    )
    .unwrap();
    w.apply_character_impulse(a, [0.0001, 0., 0.]).unwrap();
    w.step();
    assert!((w.body_state(a).unwrap().linear_velocity[0] - 1.).abs() < 1e-5);
}

#[test]
fn external_knockback_is_consumed_at_walls_and_does_not_relaunch_after_landing() {
    check_external_knockback(super::p1b_tests::Mode::Current);
}

#[test]
fn p2b_wall_consumes_external_knockback() {
    check_external_knockback(super::p1b_tests::Mode::Kcc);
}

fn check_external_knockback(mode: super::p1b_tests::Mode) {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    mode.configure(&mut w);
    let wall = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0.8, 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 2., 2.],
            }),
        )
        .unwrap();
    w.apply_character_impulse(a, [20., 0., 0.]).unwrap();
    w.step();
    let before = w.body_state(a).unwrap().pose.position[0];
    w.remove_body(wall).unwrap();
    w.step();
    assert!((w.body_state(a).unwrap().pose.position[0] - before).abs() < 0.001);

    let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let a = actor(&mut w, 0., 2.);
    mode.configure(&mut w);
    w.set_pose(
        a,
        Pose {
            position: [0., 0.51, 0.],
            ..Default::default()
        },
    )
    .unwrap();
    w.create_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: Pose {
                position: [0., -0.1, 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        ColliderDesc::new(Shape::Box {
            half_extents: [10., 0.1, 10.],
        }),
    )
    .unwrap();
    w.step();
    w.apply_character_impulse(a, [0., 8., 0.]).unwrap();
    let mut highest: f32 = 0.;
    for _ in 0..240 {
        w.step();
        highest = highest.max(w.body_state(a).unwrap().pose.position[1]);
    }
    assert!(highest > 1.);
    assert!(w.character_state(a).unwrap().grounded);
    assert!((w.body_state(a).unwrap().pose.position[1] - 0.51).abs() < 0.002);
}

#[test]
fn finite_character_crate_and_fixed_wall_share_the_accepted_stop() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    let d = dynamic(&mut w, 1.);
    let wall = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [1.8, 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 2., 2.],
            }),
        )
        .unwrap();
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [100., 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    let actor_before = w.body_state(a).unwrap().pose.position[0];
    let crate_before = w.body_state(d).unwrap().pose.position[0];
    w.step_checked()
        .expect("positive finite crate/wall stop must execute");
    assert_eq!(
        w.actual_motion_completed_time(),
        f64::from(w.config.step_seconds)
    );
    assert!(w.body_state(a).unwrap().pose.position[0] > actor_before);
    assert!(w.body_state(d).unwrap().pose.position[0] > crate_before);
    let capsule = &w.backend.colliders
        [super::colliders::native_collider(w.collider_ids(a).unwrap().next().unwrap())];
    let crate_shape = &w.backend.colliders
        [super::colliders::native_collider(w.collider_ids(d).unwrap().next().unwrap())];
    let contact = rapier3d::parry::query::contact(
        capsule.position(),
        capsule.shape(),
        crate_shape.position(),
        crate_shape.shape(),
        1.,
    )
    .unwrap()
    .unwrap();
    let native_slop = w.backend.integration_parameters.allowed_linear_error();
    let skin = w.character_config(a).unwrap().skin_width;
    assert!(
        contact.dist >= -native_slop,
        "actual shapes exceed native contact slop: {contact:?}"
    );
    let wall_shape = &w.backend.colliders
        [super::colliders::native_collider(w.collider_ids(wall).unwrap().next().unwrap())];
    let wall_contact = rapier3d::parry::query::contact(
        crate_shape.position(),
        crate_shape.shape(),
        wall_shape.position(),
        wall_shape.shape(),
        skin + native_slop,
    )
    .unwrap()
    .expect("pushed crate must reach the wall");
    assert!(wall_contact.dist >= -native_slop, "{wall_contact:?}");
    let a = w.body_state(a).unwrap();
    let d = w.body_state(d).unwrap();
    assert!(
        d.pose.position[0] - a.pose.position[0] >= 0.5 - native_slop,
        "character must stop behind the actually stopped crate: {a:?}; {d:?}"
    );
    assert!(d.pose.position[0] <= 1.451, "{d:?}");
}

#[test]
fn p2b_character_push_uses_virtual_mass_and_stores_the_opposite_impulse() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    let b = dynamic(&mut w, 1.);
    super::p1b_tests::Mode::Kcc.configure(&mut w);
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [10., 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    w.step();
    let actor = w.body_state(a).unwrap();
    let dynamic = w.body_state(b).unwrap();
    // A persistent movement command sets speed, so measure the stored reaction
    // separately from the actor's average movement over the tick.
    assert!((0.48..0.5).contains(&actor.pose.position[0]), "{actor:?}");
    assert!(
        (4.5..4.8).contains(&dynamic.linear_velocity[0]),
        "{dynamic:?}"
    );
    assert!(dynamic.pose.position[0] > 1.4);
    let external = w.characters[&a].external_velocity[0];
    assert!((2. * (external + dynamic.linear_velocity[0])).abs() < 0.1);
    assert!(w.p1a_max_overlap() <= 0.005);
}

#[test]
fn p2b_incoming_dynamic_impact_stops_at_the_actor_and_game_code_supplies_knockback() {
    let (mut w, a, b) = incoming_dynamic_impact_fixture();
    super::p1b_tests::Mode::Kcc.configure(&mut w);
    let mut events = Vec::new();
    let mut collision = false;
    let mut max_overlap = 0.0_f32;
    for tick in 1..=3 {
        w.step_checked().unwrap();
        let actor = w.body_state(a).unwrap();
        let projectile = w.body_state(b).unwrap();
        // The capsule is kinematic on incoming contact. The scripted tangent
        // must continue unaffected, even when CCD stops the box.
        assert!(actor.pose.position[0].abs() < 0.00001, "{actor:?}");
        assert!((actor.pose.position[2] - 0.2 * tick as f32).abs() < 0.00001);
        // Rotation and lateral deflection can move the center past the
        // unrotated contact plane. Measure the actual shape penetration.
        assert!(projectile.pose.position[0] > 0.25, "{projectile:?}");
        let overlap = w.p1a_max_overlap();
        max_overlap = max_overlap.max(overlap);
        assert!(
            overlap <= 0.005 + 1e-6,
            "tick={tick}: overlap={overlap}; {projectile:?}"
        );
        w.drain_collision_events(&mut events);
        collision |= events.iter().any(|event| {
            event.phase == CollisionPhase::Enter && (event.first.body, event.second.body) == (a, b)
        });
    }
    assert!(collision, "game code needs a solid collision event");
    let deflected = w.body_state(b).unwrap();
    assert!(deflected.linear_velocity[0] > -2., "{deflected:?}");
    assert!(deflected.angular_velocity[1].abs() > 0.5, "{deflected:?}");
    w.apply_character_impulse(a, [-10., 0., 0.]).unwrap();
    w.step_checked().unwrap();
    let knockback_x = w.body_state(a).unwrap().pose.position[0];
    assert!(knockback_x < -0.49);
    println!(
        "P2B_GAME_IMPULSE overlap={max_overlap} deflected_vx={} knockback_x={knockback_x}",
        deflected.linear_velocity[0]
    );
}

#[test]
fn p2b_a_peer_blocks_the_capsule_without_pushing_the_box_behind_it() {
    let mut w = world();
    let a = actor(&mut w, 0., 2.);
    let b = actor(&mut w, 0.51, 2.);
    let d = dynamic(&mut w, 1.02);
    super::p1b_tests::Mode::Kcc.configure(&mut w);
    w.set_character_input(
        a,
        CharacterInput {
            velocity: [9., 0., 0.],
            ..Default::default()
        },
    )
    .unwrap();
    w.step_checked().unwrap();
    let states = [a, b, d].map(|id| w.body_state(id).unwrap());
    // This no longer transfers momentum through a chain of virtual masses.
    // A proposed KCC push beyond the preceding peer must also be discarded.
    assert!(w.character_state(a).unwrap().blocked_by_character);
    assert!(
        (0.009..=0.01001).contains(&states[0].pose.position[0]),
        "{states:?}"
    );
    assert!(states[1].linear_velocity[0].abs() < 0.00001, "{states:?}");
    assert!(states[2].linear_velocity[0].abs() < 0.00001, "{states:?}");
    assert!(states[1].pose.position[0] - states[0].pose.position[0] >= 0.49999);
    assert!(states[2].pose.position[0] - states[1].pose.position[0] >= 0.509);
}

#[test]
fn p2b_dense_capsule_chain_blocks_without_transferring_momentum() {
    for count in [8, 32] {
        let mut w = world();
        let actors: Vec<_> = (0..count)
            .map(|i| actor(&mut w, 0.51 * i as f32, 2.))
            .collect();
        let d = dynamic(&mut w, 0.51 * count as f32);
        w.set_character_input(
            actors[0],
            CharacterInput {
                velocity: [9., 0., 0.],
                ..Default::default()
            },
        )
        .unwrap();
        super::p1b_tests::Mode::Kcc.configure(&mut w);
        let checkpoint = w.capture_snapshot().unwrap();
        let mut replay = PhysicsWorld3d::from_snapshot(&checkpoint).unwrap();
        super::p1b_tests::Mode::Kcc.configure(&mut replay);
        w.step();
        replay.step();
        // Peers constrain motion geometrically without sharing the lead actor's speed.
        assert!(w.character_state(actors[0]).unwrap().blocked_by_character);
        assert!((0.009..=0.01001).contains(&w.body_state(actors[0]).unwrap().pose.position[0]));
        for (i, &a) in actors.iter().enumerate() {
            let state = w.character_state(a).unwrap();
            assert!(
                !state.character_coupling_iteration_limit,
                "count={count}: {state:?}"
            );
            assert!(
                state.character_pair_casts < count,
                "count={count}: {state:?}"
            );
            if i > 0 {
                assert!(
                    state.velocity[0].abs() < 0.00001,
                    "count={count}: {state:?}"
                );
                let previous = w.body_state(actors[i - 1]).unwrap().pose.position[0];
                assert!(w.body_state(a).unwrap().pose.position[0] - previous >= 0.49999);
            }
        }
        assert!(w.body_state(d).unwrap().linear_velocity[0].abs() < 0.00001);
        assert!(
            w.step_statistics().backend_steps <= 2,
            "{:?}",
            w.step_statistics()
        );
        assert_eq!(
            w.capture_snapshot().unwrap().encoded_bytes(),
            replay.capture_snapshot().unwrap().encoded_bytes()
        );
    }
}
