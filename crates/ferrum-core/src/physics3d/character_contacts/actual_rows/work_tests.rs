use super::*;

fn values(velocities: &[rp::Vector]) -> Vec<(BodyId, rp::Vector)> {
    velocities
        .iter()
        .enumerate()
        .map(|(slot, &velocity)| {
            (
                BodyId {
                    slot: slot as u32,
                    generation: 0,
                },
                velocity,
            )
        })
        .collect()
}
fn pair(a: usize, b: usize) -> Row {
    Row {
        a,
        b: Some(b),
        normal: -rp::Vector::X,
        velocity: rp::Vector::ZERO,
    }
}
fn plane(a: usize, normal: rp::Vector, velocity: rp::Vector) -> Row {
    Row {
        a,
        b: None,
        normal,
        velocity,
    }
}
fn bits(values: &[(BodyId, rp::Vector)]) -> Vec<(BodyId, [u32; 3])> {
    values
        .iter()
        .map(|&(id, v)| (id, v.to_array().map(f32::to_bits)))
        .collect()
}
fn bytes(values: &[(BodyId, rp::Vector)], carry: &[rp::Vector], rows: &[Row]) -> Vec<u8> {
    let carry: Vec<_> = carry
        .iter()
        .map(|v| v.to_array().map(f32::to_bits))
        .collect();
    let rows: Vec<_> = rows
        .iter()
        .map(|r| {
            (
                r.a,
                r.b,
                r.normal.to_array().map(f32::to_bits),
                r.velocity.to_array().map(f32::to_bits),
            )
        })
        .collect();
    postcard::to_allocvec(&(bits(values), carry, rows)).unwrap()
}
fn work() -> Work {
    Work {
        used: 0,
        limit: 1 << 25,
    }
}

#[test]
fn an_already_feasible_64_crowd_pays_one_visited_sweep_and_no_accelerator() {
    let original = values(&[rp::Vector::new(3., 4., 0.); 64]);
    let rows: Vec<_> = (0..63).map(|i| pair(i, i + 1)).collect();
    let mut actual = original.clone();
    let mut w = Work {
        used: 17,
        limit: 17 + 444,
    };
    let mut scratch = Scratch::default();
    scratch
        .solve(&mut actual, &rows, true, &mut w, 1 << 20)
        .unwrap();
    // constructor n+r127 + visited PGS (relax2+convergence1)*r63
    // + finite n64 + atomic caller commit n64 = 444, not 4096 sweeps.
    assert_eq!(w.used, 17 + 444);
    assert_eq!(bits(&actual), bits(&original));
    assert!(scratch.actors.iter().all(|a| a.iterations
        == if a.id.slot == 0 || a.id.slot == 63 {
            1
        } else {
            2
        }));
    let mut empty_rows = original.clone();
    let mut w = Work {
        used: 0,
        limit: 192,
    };
    scratch
        .solve(&mut empty_rows, &[], true, &mut w, 1 << 20)
        .unwrap();
    assert_eq!(w.used, 192);
    assert_eq!(bits(&empty_rows), bits(&original));
}

fn legacy(velocities: &[(BodyId, rp::Vector)], rows: &[Row], planar: bool) -> Vec<Actor> {
    let mut actors: Vec<_> = velocities
        .iter()
        .map(|&(id, velocity)| Actor {
            id,
            collider: rp::ColliderHandle::invalid(),
            velocity,
            applied: rp::Vector::ZERO,
            carry: rp::Vector::ZERO,
            applied_carry: rp::Vector::ZERO,
            previous_velocity: velocity,
            out: Default::default(),
            pair_casts: 0,
            pair_contacts: 0,
            pair_failures: 0,
            iterations: 0,
            limited: false,
            blocked_by_character: false,
        })
        .collect();
    let contacts: Vec<_> = rows
        .iter()
        .map(|r| Constraint {
            a: r.a,
            b: r.b,
            source: rp::ColliderHandle::invalid(),
            target: rp::ColliderHandle::invalid(),
            normal: r.normal,
            velocity: r.velocity,
        })
        .collect();
    assert!(super::super::solver::solve(
        &mut actors,
        &contacts,
        planar,
        1e-6,
        &mut super::super::solver::Scratch::default()
    ));
    actors
}

#[test]
fn actual_cg_admission_keeps_legacy_64_fair_values_order_and_iteration_counts() {
    for planar in [false, true] {
        let mut velocities = [rp::Vector::Y * 4.; 64];
        velocities[0].x = 64.;
        let original = values(&velocities);
        let rows: Vec<_> = (0..63).map(|i| pair(i, i + 1)).collect();
        let expected = legacy(&original, &rows, planar);
        let mut actual = original.clone();
        let mut scratch = Scratch::default();
        let mut w = Work {
            used: 0,
            limit: 100_000,
        };
        scratch
            .solve(&mut actual, &rows, planar, &mut w, 1 << 20)
            .unwrap();
        assert!(actual
            .iter()
            .all(|v| (v.1.x - 1.).abs() < 1e-4 && v.1.y == 4. && v.1.z == 0.));
        assert_eq!(
            bits(&actual),
            expected
                .iter()
                .map(|a| (a.id, a.velocity.to_array().map(f32::to_bits)))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            scratch
                .actors
                .iter()
                .map(|a| a.iterations)
                .collect::<Vec<_>>(),
            expected.iter().map(|a| a.iterations).collect::<Vec<_>>()
        );
        assert!(w.used < 100_000); // Old unexecuted worst reservation was >800k.
        let mut rejected = original.clone();
        let mut limited = Work {
            used: 0,
            limit: 2_000,
        };
        assert_eq!(
            scratch.solve(&mut rejected, &rows, planar, &mut limited, 1 << 20),
            Err(TrajectoryError::WorkLimit)
        );
        // The eight original PGS sweeps ran; a bounded optional CG visit was
        // denied on the same ledger, without publishing its scratch actors.
        assert!(scratch.actors.iter().all(|a| a.iterations >= 8));
        assert_eq!(bits(&rejected), bits(&original));
        assert!(limited.used <= limited.limit);
    }
}

#[test]
fn tagged_physical_exclusion_and_opposing_input_keep_carry_without_new_j() {
    let original = values(&[rp::Vector::new(19., -1., 0.); 2]);
    let carry = [rp::Vector::X * 20.; 2];
    let rows = [
        pair(0, 1),
        plane(1, -rp::Vector::X, rp::Vector::ZERO),
        plane(0, rp::Vector::Y, rp::Vector::Y * 0.5),
        plane(1, rp::Vector::Y, rp::Vector::Y * 0.5),
    ];
    let tags = [Some(rp::Vector::ZERO), Some(rp::Vector::ZERO), None, None];
    let mut actual = original.clone();
    let mut scratch = Scratch::default();
    scratch
        .solve_with_carry(
            &mut actual,
            &carry,
            &tags,
            &rows,
            true,
            &mut work(),
            1 << 20,
        )
        .unwrap()
        .unwrap();
    assert!(actual.iter().all(|v| v.1 == rp::Vector::Y * 0.5));
    assert_eq!(
        scratch.solved_carry().map(|v| v.1).collect::<Vec<_>>(),
        [rp::Vector::X; 2]
    );
    assert_eq!(carry, [rp::Vector::X * 20.; 2]);
    // Geometry rows have no physical participant/impulse API. None marks the
    // existing physical response, which cannot be retagged as carry.
}

#[test]
fn every_budget_denial_keeps_source_bytes_and_exact_offset_retry() {
    let initial = values(&[rp::Vector::new(19., 3., 0.); 2]);
    let carry = [rp::Vector::X * 20.; 2];
    let rows = [pair(0, 1), plane(1, -rp::Vector::X, rp::Vector::ZERO)];
    let tags = [Some(rp::Vector::ZERO); 2];
    let source = bytes(&initial, &carry, &rows);
    let mut expected = initial.clone();
    let mut scratch = Scratch::default();
    let mut full = work();
    let space = scratch
        .solve_with_carry(
            &mut expected,
            &carry,
            &tags,
            &rows,
            true,
            &mut full,
            1 << 20,
        )
        .unwrap()
        .unwrap();
    let carry_expected: Vec<_> = scratch.solved_carry().collect();
    for available in [0, 10, full.used / 2, full.used - 1] {
        let mut rejected = initial.clone();
        let mut w = Work {
            used: 37,
            limit: 37 + available,
        };
        assert_eq!(
            scratch.solve_with_carry(&mut rejected, &carry, &tags, &rows, true, &mut w, space),
            Err(TrajectoryError::WorkLimit)
        );
        assert_eq!(bytes(&rejected, &carry, &rows), source);
        assert!(w.used >= 37 && w.used <= w.limit);
    }
    let mut retry = initial.clone();
    let mut exact = Work {
        used: 37,
        limit: 37 + full.used,
    };
    scratch
        .solve_with_carry(&mut retry, &carry, &tags, &rows, true, &mut exact, space)
        .unwrap()
        .unwrap();
    assert_eq!(exact.used, 37 + full.used);
    assert_eq!(bits(&retry), bits(&expected));
    assert_eq!(scratch.solved_carry().collect::<Vec<_>>(), carry_expected);
    let mut too_small = initial.clone();
    assert_eq!(
        scratch.solve_with_carry(
            &mut too_small,
            &carry,
            &tags,
            &rows,
            true,
            &mut work(),
            space - 1
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(bytes(&too_small, &carry, &rows), source);
}

#[test]
fn strict_revisit_is_billed_only_when_its_original_inward_remainder_exists() {
    let row = [plane(0, rp::Vector::Y, rp::Vector::Y * -9.380261e-6)];
    let initial = values(&[rp::Vector::Y * -9.380281e-6]);
    let mut actual = initial.clone();
    let mut s = Scratch::default();
    let mut w = work();
    let bytes = s
        .solve_with_carry(
            &mut actual,
            &[rp::Vector::ZERO],
            &[Some(rp::Vector::ZERO)],
            &row,
            false,
            &mut w,
            1 << 20,
        )
        .unwrap()
        .unwrap();
    assert!(actual[0].1.y >= row[0].velocity.y);
    assert!(w.used < 128);
    let mut exact = initial.clone();
    s.solve_with_carry(
        &mut exact,
        &[rp::Vector::ZERO],
        &[Some(rp::Vector::ZERO)],
        &row,
        false,
        &mut Work {
            used: 0,
            limit: w.used,
        },
        bytes,
    )
    .unwrap()
    .unwrap();
    assert_eq!(bits(&exact), bits(&actual));
    let mut rejected = initial.clone();
    assert_eq!(
        s.solve_with_carry(
            &mut rejected,
            &[rp::Vector::ZERO],
            &[Some(rp::Vector::ZERO)],
            &row,
            false,
            &mut Work {
                used: 0,
                limit: w.used - 1
            },
            bytes
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(bits(&rejected), bits(&initial));
}

#[test]
fn infeasible_and_memory_failed_rows_never_publish_a_partial_plan() {
    let rows = [
        plane(0, rp::Vector::X, rp::Vector::X),
        plane(0, -rp::Vector::X, -rp::Vector::X),
    ];
    let initial = values(&[rp::Vector::ZERO]);
    let mut actual = initial.clone();
    let mut w = work();
    assert_eq!(
        Scratch::default().solve(&mut actual, &rows, false, &mut w, 1 << 20),
        Err(TrajectoryError::Unresolved)
    );
    assert_eq!(bits(&actual), bits(&initial));
    assert!(w.used > 64 * 2 * 2); // Actual bounded row visits, not a free fallback.
    let mut scratch = Scratch::default();
    let mut w = Work {
        used: 11,
        limit: 1 << 25,
    };
    assert_eq!(
        scratch.solve(&mut actual, &rows, false, &mut w, 0),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(w.used, 11);
    assert_eq!(scratch.actors.capacity(), 0);
    assert_eq!(scratch.contacts.capacity(), 0);
    assert_eq!(bits(&actual), bits(&initial));
}

#[test]
fn tagged_64_external_pusher_keeps_zero_carry_and_exact_shared_work() {
    let initial = values(&[rp::Vector::ZERO; 64]);
    let mut rows: Vec<_> = (0..63).map(|i| pair(i, i + 1)).collect();
    rows.push(plane(0, rp::Vector::X, rp::Vector::X * 20.));
    let tags = vec![Some(rp::Vector::ZERO); rows.len()];
    let carry = [rp::Vector::ZERO; 64];
    let mut actual = initial.clone();
    let mut scratch = Scratch::default();
    let mut w = work();
    let space = scratch
        .solve_with_carry(&mut actual, &carry, &tags, &rows, true, &mut w, 1 << 20)
        .unwrap()
        .unwrap();
    assert!(actual
        .iter()
        .all(|v| (v.1.x - 20.).abs() < 1e-4 && v.1.y == 0. && v.1.z == 0.));
    assert!(scratch.solved_carry().all(|v| v.1 == rp::Vector::ZERO));
    let mut rejected = initial.clone();
    assert_eq!(
        scratch.solve_with_carry(
            &mut rejected,
            &carry,
            &tags,
            &rows,
            true,
            &mut Work {
                used: 0,
                limit: w.used - 1
            },
            space
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(bits(&rejected), bits(&initial));
}
