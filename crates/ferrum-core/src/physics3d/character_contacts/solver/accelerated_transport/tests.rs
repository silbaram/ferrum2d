use super::*;
use crate::physics3d::{
    character_contacts::actual_rows,
    solver_trajectory::{TrajectoryError, Work},
    BodyId,
};

fn values(v: &[rp::Vector]) -> Vec<(BodyId, rp::Vector)> {
    v.iter()
        .enumerate()
        .map(|(i, &v)| {
            (
                BodyId {
                    slot: i as u32,
                    generation: 0,
                },
                v,
            )
        })
        .collect()
}
fn pair(a: usize, b: usize) -> actual_rows::Row {
    actual_rows::Row {
        a,
        b: Some(b),
        normal: -rp::Vector::X,
        velocity: rp::Vector::ZERO,
    }
}
fn wall(a: usize, velocity: rp::Vector) -> actual_rows::Row {
    actual_rows::Row {
        a,
        b: None,
        normal: -rp::Vector::X,
        velocity,
    }
}
fn budget() -> Work {
    Work {
        used: 0,
        limit: 1 << 25,
    }
}
fn run(
    initial: &[rp::Vector],
    carry: &[rp::Vector],
    rows: &[actual_rows::Row],
    tags: &[Option<rp::Vector>],
) -> (Vec<(BodyId, rp::Vector)>, Vec<rp::Vector>, u64, usize) {
    let mut actual = values(initial);
    let mut scratch = actual_rows::Scratch::default();
    let mut work = budget();
    let bytes = scratch
        .solve_with_carry(&mut actual, carry, tags, rows, true, &mut work, 1 << 20)
        .unwrap()
        .unwrap();
    (
        actual,
        scratch.solved_carry().map(|v| v.1).collect(),
        work.used,
        bytes,
    )
}

#[test]
fn recorded_pair_wall_acceleration_keeps_zero_transport_after_actual_stop() {
    // Actual C44: the eighth PGS sweep leaves a small pair residual. CG removes
    // it simultaneously, whereas one sequential tag visit left 20/256 carry.
    let rows = [pair(0, 1), wall(1, rp::Vector::ZERO)];
    let initial = [rp::Vector::X * 20.; 2];
    let (actual, carry, _, _) = run(&initial, &initial, &rows, &[Some(rp::Vector::ZERO); 2]);
    let mut physical = values(&initial);
    actual_rows::Scratch::default()
        .solve(&mut physical, &rows, true, &mut budget(), 1 << 20)
        .unwrap();
    assert_eq!(actual, physical); // Existing CG F32 total is unchanged.
    assert_eq!(
        actual.iter().map(|v| v.1).collect::<Vec<_>>(),
        [rp::Vector::ZERO; 2]
    );
    assert_eq!(carry, [rp::Vector::ZERO; 2]);
}

#[test]
fn opposing_input_survives_coupled_tag_projection_and_can_exceed_total_motion() {
    let rows = [pair(0, 1), wall(1, rp::Vector::ZERO)];
    let initial = [rp::Vector::new(19., 3., 0.); 2];
    let (actual, carry, _, _) = run(
        &initial,
        &[rp::Vector::X * 20.; 2],
        &rows,
        &[Some(rp::Vector::ZERO); 2],
    );
    assert!(actual.iter().all(|v| v.1 == rp::Vector::Y * 3.));
    assert_eq!(carry, [rp::Vector::X; 2]);
    let mut ordinary = values(&initial);
    actual_rows::Scratch::default()
        .solve(&mut ordinary, &rows, true, &mut budget(), 1 << 20)
        .unwrap();
    assert_eq!(ordinary, actual);
    assert!(carry.iter().zip(&actual).all(|(c, v)| c.x > v.1.x));
    for (v, c) in actual.iter().zip(carry) {
        assert_eq!(v.1 - c, rp::Vector::new(-1., 3., 0.));
    }
}

#[test]
fn own_input_and_external_pusher_do_not_become_accelerated_carry() {
    for target in [0., -3.] {
        let rows = [pair(0, 1), wall(1, rp::Vector::X * target)];
        let (actual, carry, _, _) = run(
            &[rp::Vector::X * 20.; 2],
            &[rp::Vector::ZERO; 2],
            &rows,
            &[Some(rp::Vector::ZERO); 2],
        );
        assert!(actual.iter().all(|v| v.1.x == target));
        assert_eq!(carry, [rp::Vector::ZERO; 2]);
        // Actor-side equality alone is insufficient: this affine pusher is not
        // transport. Its target20/tag0 must prevent the all-transport identity.
        let pusher = [actual_rows::Row {
            a: 0,
            b: None,
            normal: rp::Vector::X,
            velocity: rp::Vector::X * 20.,
        }];
        let (actual, carry, _, _) = run(
            &[rp::Vector::ZERO],
            &[rp::Vector::ZERO],
            &pusher,
            &[Some(rp::Vector::ZERO)],
        );
        assert_eq!(actual[0].1, rp::Vector::X * 20.);
        assert_eq!(carry, [rp::Vector::ZERO]);
    }
}

#[test]
fn reversed_row_order_and_long_fair_chain_preserve_transport_and_planar_lock() {
    for reverse in [false, true] {
        let mut rows = vec![pair(0, 1), wall(1, rp::Vector::ZERO)];
        if reverse {
            rows.reverse();
        }
        let (actual, carry, _, _) = run(
            &[rp::Vector::X * 20.; 2],
            &[rp::Vector::X * 20.; 2],
            &rows,
            &[Some(rp::Vector::ZERO); 2],
        );
        assert!(actual.iter().all(|v| v.1 == rp::Vector::ZERO));
        assert_eq!(carry, [rp::Vector::ZERO; 2]);
    }
    let mut initial = [rp::Vector::ZERO; 64];
    initial[0] = rp::Vector::X * 64.;
    let rows: Vec<_> = (0..63).map(|i| pair(i, i + 1)).collect();
    let (actual, carry, used, _) = run(&initial, &initial, &rows, &[Some(rp::Vector::ZERO); 63]);
    // The exact identity uses linear work. It must not reserve 4096 full
    // transport sweeps (~14.5M) when no such sweep is executed.
    assert!(used < 1 << 23);
    assert!(actual
        .iter()
        .all(|v| (v.1.x - 1.).abs() < 1e-5 && v.1.y == 0. && v.1.z == 0.));
    assert_eq!(carry, actual.iter().map(|v| v.1).collect::<Vec<_>>());
}

#[test]
fn physical_rows_have_no_transport_impulse_even_in_a_simultaneous_system() {
    let rows = [pair(0, 1), wall(1, rp::Vector::ZERO)];
    let (actual, carry, _, _) = run(
        &[rp::Vector::X * 20.; 2],
        &[rp::Vector::X * 20.; 2],
        &rows,
        &[None; 2],
    );
    assert!(actual.iter().all(|v| v.1 == rp::Vector::ZERO));
    // This is an explicit physical-row exclusion, not a comparison with total
    // displacement. Real J is accounted by the existing momentum ledger.
    assert_eq!(carry, [rp::Vector::X * 20.; 2]);
}

#[test]
fn exact_shared_work_scratch_and_retry_keep_rejected_values_unpublished() {
    let rows = [pair(0, 1), wall(1, rp::Vector::ZERO)];
    let initial = [rp::Vector::X * 20.; 2];
    let tags = [Some(rp::Vector::ZERO); 2];
    let (expected, expected_carry, used, bytes) = run(&initial, &initial, &rows, &tags);
    let mut scratch = actual_rows::Scratch::default();
    for (limit, space) in [(used - 1, bytes), (used, bytes - 1)] {
        let mut actual = values(&initial);
        let before = actual.clone();
        assert_eq!(
            scratch.solve_with_carry(
                &mut actual,
                &initial,
                &tags,
                &rows,
                true,
                &mut Work { used: 0, limit },
                space
            ),
            Err(TrajectoryError::WorkLimit)
        );
        assert_eq!(actual, before);
    }
    let mut retry = values(&initial);
    scratch
        .solve_with_carry(
            &mut retry,
            &initial,
            &tags,
            &rows,
            true,
            &mut Work {
                used: 0,
                limit: used,
            },
            bytes,
        )
        .unwrap()
        .unwrap();
    assert_eq!(retry, expected);
    assert_eq!(
        scratch.solved_carry().map(|v| v.1).collect::<Vec<_>>(),
        expected_carry
    );
}

#[test]
fn canonical_all_transport_identity_survives_oblique_pgs_rounding() {
    for n in [
        rp::Vector::new(0.6, 0.8, 0.),
        rp::Vector::new(
            std::f32::consts::FRAC_1_SQRT_2,
            std::f32::consts::FRAC_1_SQRT_2,
            0.,
        ),
        rp::Vector::new(0.37, 0.91, 0.).normalize(),
        rp::Vector::new(0.19, 0.83, 0.).normalize(),
    ] {
        let make = || {
            [0, 1].map(|slot| Actor {
                id: BodyId {
                    slot,
                    generation: 0,
                },
                collider: rp::ColliderHandle::invalid(),
                velocity: rp::Vector::X * 20.,
                applied: rp::Vector::ZERO,
                carry: rp::Vector::X * 20.,
                applied_carry: rp::Vector::ZERO,
                previous_velocity: rp::Vector::X * 20.,
                out: Default::default(),
                pair_casts: 0,
                pair_contacts: 0,
                pair_failures: 0,
                iterations: 0,
                limited: false,
                blocked_by_character: false,
            })
        };
        let rows = [
            Constraint {
                a: 0,
                b: Some(1),
                target: rp::ColliderHandle::invalid(),
                source: rp::ColliderHandle::invalid(),
                normal: -n,
                velocity: rp::Vector::ZERO,
            },
            Constraint {
                a: 1,
                b: None,
                target: rp::ColliderHandle::invalid(),
                source: rp::ColliderHandle::invalid(),
                normal: -n,
                velocity: rp::Vector::ZERO,
            },
        ];
        let mut actual = make();
        let mut ordinary = make();
        assert!(super::super::solve_tagged(
            &mut actual,
            &rows,
            true,
            1e-6,
            &mut Scratch::default(),
            &[Some(rp::Vector::ZERO); 2],
            &mut budget()
        )
        .unwrap());
        assert!(super::super::solve(
            &mut ordinary,
            &rows,
            true,
            1e-6,
            &mut Scratch::default()
        ));
        for (a, original) in actual.iter().zip(&ordinary) {
            assert_eq!(
                a.velocity.to_array().map(f32::to_bits),
                original.velocity.to_array().map(f32::to_bits)
            );
            assert_eq!(
                a.carry.to_array().map(f32::to_bits),
                a.velocity.to_array().map(f32::to_bits)
            );
        }
    }
}

#[test]
fn dynamic_transport_sweep_work_exhaustion_stays_typed_and_retry_is_exact() {
    let rows = [pair(0, 1), wall(1, rp::Vector::ZERO)];
    let initial = [rp::Vector::new(19., 3., 0.); 2];
    let carry = [rp::Vector::X * 20.; 2];
    let tags = [Some(rp::Vector::ZERO); 2];
    let (expected, expected_carry, used, bytes) = run(&initial, &carry, &rows, &tags);
    let mut scratch = actual_rows::Scratch::default();
    let mut actual = values(&initial);
    let original = actual.clone();
    assert_eq!(
        scratch.solve_with_carry(
            &mut actual,
            &carry,
            &tags,
            &rows,
            true,
            &mut Work {
                used: 0,
                limit: used - 1
            },
            bytes
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(actual, original);
    scratch
        .solve_with_carry(
            &mut actual,
            &carry,
            &tags,
            &rows,
            true,
            &mut Work {
                used: 0,
                limit: used,
            },
            bytes,
        )
        .unwrap()
        .unwrap();
    assert_eq!(actual, expected);
    assert_eq!(
        scratch.solved_carry().map(|v| v.1).collect::<Vec<_>>(),
        expected_carry
    );
}
