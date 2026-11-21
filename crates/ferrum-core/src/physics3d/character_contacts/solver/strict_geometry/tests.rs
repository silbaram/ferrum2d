use super::*;
use crate::physics3d::{character_contacts::actual_rows, BodyId};

fn actor(slot: u32, velocity: rp::Vector, carry: rp::Vector) -> Actor {
    Actor {
        id: BodyId {
            slot,
            generation: 0,
        },
        collider: rp::ColliderHandle::invalid(),
        velocity,
        applied: rp::Vector::ZERO,
        carry,
        applied_carry: rp::Vector::ZERO,
        previous_velocity: velocity,
        out: Default::default(),
        pair_casts: 0,
        pair_contacts: 0,
        pair_failures: 0,
        iterations: 0,
        limited: false,
        blocked_by_character: false,
    }
}
fn row(a: usize, b: Option<usize>, normal: rp::Vector, velocity: rp::Vector) -> Constraint {
    Constraint {
        a,
        b,
        target: rp::ColliderHandle::invalid(),
        source: rp::ColliderHandle::invalid(),
        normal,
        velocity,
    }
}
fn v(bits: [u32; 3]) -> rp::Vector {
    rp::Vector::from_array(bits.map(f32::from_bits))
}
fn recorded() -> [Constraint; 3] {
    // C34 actual event-prefix rows, command.log:1090-1092. These are the
    // original represented operands, not an ideal plane or widened tolerance.
    [
        row(
            0,
            None,
            v([0xbf03_6d5b, 0x3f5b_b02e, 0]),
            v([0xc204_6d14, 0x4254_0c3b, 0]),
        ),
        row(0, None, -rp::Vector::Y, rp::Vector::ZERO),
        row(
            0,
            None,
            v([0xbf04_d2f0, 0x3f5a_d8b6, 0]),
            v([0xc201_bb77, 0x4255_c0a5, 0]),
        ),
    ]
}
fn budget() -> Work {
    Work {
        used: 0,
        limit: 1 << 25,
    }
}
fn bits(actors: &[Actor]) -> Vec<([u32; 3], [u32; 3])> {
    actors
        .iter()
        .map(|a| {
            (
                a.velocity.to_array().map(f32::to_bits),
                a.carry.to_array().map(f32::to_bits),
            )
        })
        .collect()
}

#[test]
fn recorded_cap_rows_have_a_strict_adjacent_x_value_after_strong_y_polish_stalls() {
    let rows = recorded();
    let tags = [Some(rp::Vector::ZERO); 3];
    let mut actors = [actor(1, rp::Vector::ZERO, rp::Vector::ZERO)];
    let mut scratch = Scratch::default();
    assert!(solve_tagged(
        &mut actors,
        &rows,
        false,
        1e-6,
        &mut scratch,
        &tags,
        &mut budget()
    )
    .unwrap());
    assert!(!solve_tagged(
        &mut actors,
        &rows,
        false,
        0.,
        &mut scratch,
        &tags,
        &mut budget()
    )
    .unwrap());
    assert!(residual(&rows[0], &actors) > 0.);
    assert_eq!(actors[0].velocity.y, 0.);
    let before = actors[0].velocity;
    assert!(adjacent_feasible(&mut actors, &rows, false, &tags, &mut budget()).unwrap());
    assert_eq!(
        actors[0].velocity.x.to_bits(),
        before.x.next_down().to_bits()
    );
    assert_eq!(actors[0].velocity.x.to_bits(), (-121.719086_f32).to_bits());
    assert_eq!(actors[0].velocity.y.to_bits(), before.y.to_bits());
    assert_eq!(actors[0].velocity.z.to_bits(), before.z.to_bits());
    assert!(rows.iter().all(|c| residual(c, &actors) <= 0.));
    assert_eq!(actors[0].carry, rp::Vector::ZERO);
}

#[test]
fn actual_geometry_callsite_accepts_recorded_rows_without_changing_physical_tolerance() {
    let rows: Vec<_> = recorded()
        .iter()
        .map(|c| actual_rows::Row {
            a: c.a,
            b: c.b,
            normal: c.normal,
            velocity: c.velocity,
        })
        .collect();
    let id = BodyId {
        slot: 1,
        generation: 0,
    };
    let initial = [(id, rp::Vector::ZERO)];
    let mut physical = initial;
    actual_rows::Scratch::default()
        .solve(&mut physical, &rows, false, &mut budget(), 1 << 20)
        .unwrap();
    let original_physical = physical;
    let mut geometric = initial;
    let mut scratch = actual_rows::Scratch::default();
    scratch
        .solve_with_carry(
            &mut geometric,
            &[rp::Vector::ZERO],
            &[Some(rp::Vector::ZERO); 3],
            &rows,
            false,
            &mut budget(),
            1 << 20,
        )
        .unwrap()
        .unwrap();
    assert_eq!(geometric[0].1.x.to_bits(), (-121.719086_f32).to_bits());
    assert!(rows
        .iter()
        .all(|c| -c.normal.dot(geometric[c.a].1 - c.velocity) <= 0.));
    assert_eq!(geometric[0].1.y, 0.);
    assert_eq!(geometric[0].1.z, 0.);
    assert_eq!(
        scratch.solved_carry().next().unwrap(),
        (id, rp::Vector::ZERO)
    );
    // The untagged/physical route remains the established tolerant solve.
    let mut unchanged = initial;
    actual_rows::Scratch::default()
        .solve(&mut unchanged, &rows, false, &mut budget(), 1 << 20)
        .unwrap();
    assert_eq!(unchanged, original_physical);
}

#[test]
fn coupled_correction_is_fair_and_preserves_a_third_body_and_transport_provenance() {
    let c = std::f32::consts::FRAC_1_SQRT_2;
    let y = 1_f32.next_down();
    let mut actors = [
        actor(0, rp::Vector::new(1., y, 0.), rp::Vector::X),
        actor(1, rp::Vector::new(-1., -y, 0.), rp::Vector::ZERO),
        actor(2, rp::Vector::new(7., 8., 9.), rp::Vector::Z * 3.),
    ];
    let rows = [
        row(0, Some(1), rp::Vector::new(-c, c, 0.), rp::Vector::ZERO),
        row(0, None, -rp::Vector::Y, rp::Vector::Y * y),
        row(1, None, rp::Vector::Y, -rp::Vector::Y * y),
        row(2, None, rp::Vector::Y, rp::Vector::Y * 8.),
    ];
    let before = bits(&actors);
    let sum = actors[0].velocity + actors[1].velocity;
    let total_carry = actors[0].carry + actors[1].carry;
    assert!(residual(&rows[0], &actors) > 0.);
    assert!(adjacent_feasible(
        &mut actors,
        &rows,
        false,
        &[Some(rp::Vector::ZERO), None, None, None],
        &mut budget()
    )
    .unwrap());
    assert!(rows.iter().all(|c| residual(c, &actors) <= 0.));
    assert_eq!(actors[0].velocity + actors[1].velocity, sum);
    assert_eq!(actors[0].carry + actors[1].carry, total_carry);
    assert!(actors[0].carry.x < 1. && actors[1].carry.x > 0.);
    assert_eq!(bits(&actors)[2], before[2]);
    assert_eq!(actors[0].velocity.y.to_bits(), before[0].0[1]);
    assert_eq!(actors[1].velocity.y.to_bits(), before[1].0[1]);
}

#[test]
fn every_candidate_checks_all_rows_and_never_chains_failed_axis_steps() {
    let mut actors = [actor(0, rp::Vector::ZERO, rp::Vector::X)];
    let target = f32::from_bits(1);
    let rows = [
        row(0, None, rp::Vector::X, rp::Vector::X * target),
        row(0, None, -rp::Vector::X, rp::Vector::ZERO),
    ];
    let before = bits(&actors);
    assert!(!adjacent_feasible(
        &mut actors,
        &rows,
        false,
        &[Some(rp::Vector::ZERO); 2],
        &mut budget()
    )
    .unwrap());
    assert_eq!(bits(&actors), before);
    let rows = [row(0, None, rp::Vector::X, rp::Vector::X * 1e-3)];
    assert!(!adjacent_feasible(&mut actors, &rows, false, &[None], &mut budget()).unwrap());
    assert_eq!(
        bits(&actors),
        before,
        "one adjacent proposal is not an unbounded walk to a distant feasible value"
    );
}

#[test]
fn planar_locked_axis_is_not_a_candidate_even_when_its_subnormal_neighbor_fits() {
    let target = f32::from_bits(1);
    let mut actors = [actor(0, rp::Vector::new(-2., 3., 0.), rp::Vector::ZERO)];
    let rows = [row(0, None, rp::Vector::Z, rp::Vector::Z * target)];
    let before = bits(&actors);
    assert!(!adjacent_feasible(&mut actors, &rows, true, &[None], &mut budget()).unwrap());
    assert_eq!(bits(&actors), before);
    assert!(adjacent_feasible(&mut actors, &rows, false, &[None], &mut budget()).unwrap());
    assert_eq!(actors[0].velocity.z.to_bits(), target.to_bits());
    assert_eq!(actors[0].velocity.x.to_bits(), before[0].0[0]);
    assert_eq!(actors[0].velocity.y.to_bits(), before[0].0[1]);
}

#[test]
fn unequal_pair_ulp_sizes_do_not_change_the_fair_or_transport_model() {
    let c = std::f32::consts::FRAC_1_SQRT_2;
    let mut actors = [
        actor(0, rp::Vector::X, rp::Vector::X),
        actor(
            1,
            rp::Vector::new(2., 1_f32.next_up(), 0.),
            rp::Vector::ZERO,
        ),
    ];
    let rows = [row(
        0,
        Some(1),
        rp::Vector::new(-c, c, 0.),
        rp::Vector::ZERO,
    )];
    let before = bits(&actors);
    assert!(residual(&rows[0], &actors) > 0.);
    assert!(!adjacent_feasible(
        &mut actors,
        &rows,
        false,
        &[Some(rp::Vector::ZERO)],
        &mut budget()
    )
    .unwrap());
    assert_eq!(bits(&actors), before);
}

#[test]
fn nonfinite_reference_and_work_errors_leave_local_velocities_and_carry_unpublished() {
    let rows = recorded();
    let seed = rp::Vector::new(-121.719_08, 0., 0.);
    let tags = [Some(rp::Vector::ZERO); 3];
    let mut measured_actors = [actor(0, seed, rp::Vector::ZERO)];
    let mut measured = budget();
    assert!(adjacent_feasible(&mut measured_actors, &rows, false, &tags, &mut measured).unwrap());
    for (limit, succeeds) in [(measured.used, true), (measured.used - 1, false)] {
        let mut actors = [actor(0, seed, rp::Vector::ZERO)];
        let before = bits(&actors);
        let result = adjacent_feasible(
            &mut actors,
            &rows,
            false,
            &tags,
            &mut Work { used: 0, limit },
        );
        if succeeds {
            assert_eq!(result, Ok(true));
            assert_eq!(bits(&actors), bits(&measured_actors));
        } else {
            assert_eq!(result, Err(TrajectoryError::WorkLimit));
            assert_eq!(bits(&actors), before);
        }
    }
    let mut actors = [actor(0, seed, rp::Vector::ZERO)];
    let before = bits(&actors);
    let invalid = [row(0, Some(7), rp::Vector::X, rp::Vector::ZERO)];
    assert_eq!(
        adjacent_feasible(&mut actors, &invalid, false, &[None], &mut budget()),
        Err(TrajectoryError::InvalidReference)
    );
    let invalid = [row(
        0,
        None,
        rp::Vector::X,
        rp::Vector::splat(f32::INFINITY),
    )];
    assert_eq!(
        adjacent_feasible(&mut actors, &invalid, false, &[None], &mut budget()),
        Err(TrajectoryError::NonFinite)
    );
    assert_eq!(bits(&actors), before);
    let mut overflow = [actor(0, seed, rp::Vector::X * f32::MAX)];
    let before = bits(&overflow);
    let tags = [Some(-rp::Vector::X * f32::MAX), None, None];
    assert_eq!(
        adjacent_feasible(&mut overflow, &rows, false, &tags, &mut budget()),
        Err(TrajectoryError::NonFinite)
    );
    assert_eq!(bits(&overflow), before);
}

#[test]
fn actual_callsite_keeps_exact_work_scratch_and_one_below_atomic_controls() {
    let rows: Vec<_> = recorded()
        .iter()
        .map(|c| actual_rows::Row {
            a: c.a,
            b: c.b,
            normal: c.normal,
            velocity: c.velocity,
        })
        .collect();
    let id = BodyId {
        slot: 1,
        generation: 0,
    };
    let initial = [(id, rp::Vector::ZERO)];
    let tags = [Some(rp::Vector::ZERO); 3];
    let mut values = initial;
    let mut measured = budget();
    let bytes = actual_rows::Scratch::default()
        .solve_with_carry(
            &mut values,
            &[rp::Vector::ZERO],
            &tags,
            &rows,
            false,
            &mut measured,
            1 << 20,
        )
        .unwrap()
        .unwrap();
    let mut exact = initial;
    assert_eq!(
        actual_rows::Scratch::default().solve_with_carry(
            &mut exact,
            &[rp::Vector::ZERO],
            &tags,
            &rows,
            false,
            &mut Work {
                used: 0,
                limit: measured.used
            },
            bytes
        ),
        Ok(Some(bytes))
    );
    assert_eq!(exact, values);
    let mut short = initial;
    assert_eq!(
        actual_rows::Scratch::default().solve_with_carry(
            &mut short,
            &[rp::Vector::ZERO],
            &tags,
            &rows,
            false,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            },
            bytes
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(short, initial);
    assert_eq!(
        actual_rows::Scratch::default().solve_with_carry(
            &mut short,
            &[rp::Vector::ZERO],
            &tags,
            &rows,
            false,
            &mut budget(),
            bytes - 1
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(short, initial);
}
