use super::*;

fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
struct Fixture {
    scratch: BackendMotionScratch,
    carrier: Kernel,
    old: Curve,
    target: rp::Vector,
}
fn fixture() -> Fixture {
    let id = BodyId {
        slot: 0,
        generation: 0,
    };
    let domain = Domain::new(0., 1.).unwrap();
    let carrier = Kernel::from_velocity(
        rp::RigidBodyHandle::from_raw_parts(1, 0),
        domain,
        rp::Pose::IDENTITY,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let target = rp::Vector::Y;
    let old = Curve::Integrated(
        Kernel::from_velocity(
            crate::physics3d::world::native_id(id),
            domain,
            rp::Pose::IDENTITY,
            target,
            rp::Vector::ZERO,
        )
        .unwrap(),
    );
    let mut scratch = BackendMotionScratch::default();
    scratch.participants.push(Participant {
        body: id,
        pose: rp::Pose::IDENTITY,
        linear_velocity: rp::Vector::new(3., 2., -1.),
        angular_velocity: rp::Vector::ZERO,
        mass: MassPolicy::Character(10.),
    });
    scratch.character_values.push((id, target));
    scratch.character_rows.push(actual_rows::Row {
        a: 0,
        b: None,
        normal: rp::Vector::Y,
        velocity: target,
    });
    Fixture {
        scratch,
        carrier,
        old,
        target,
    }
}
fn source(f: &Fixture) -> Vec<u8> {
    let values: Vec<_> = f
        .scratch
        .participants
        .iter()
        .map(|p| {
            (
                p.body,
                p.pose,
                p.linear_velocity.to_array().map(f32::to_bits),
                p.angular_velocity.to_array().map(f32::to_bits),
            )
        })
        .collect();
    let rows: Vec<_> = f
        .scratch
        .character_rows
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
    postcard::to_allocvec(&(
        f.carrier,
        f.old,
        f.target,
        values,
        &f.scratch.character_values,
        rows,
    ))
    .unwrap()
}
fn propose(f: &Fixture, own: bool, w: &mut Work) -> Result<Option<Proposal>, TrajectoryError> {
    f.scratch.reference_proposal_core(
        0,
        f.carrier,
        rp::Vector::ZERO,
        f.old,
        f.target,
        0.,
        0.,
        true,
        rp::Vector::new(1., 0., 1.),
        rp::Vector::Y,
        own,
        w,
        &mut |_, _| Ok(true),
    )
}

#[test]
fn first_ordered_external_inverse_keeps_the_original_selected_bits() {
    let f = fixture();
    let before = source(&f);
    let own = false; // Actual external path admits adjacent total rates.
    let mut w = work();
    let actual = propose(&f, own, &mut w).unwrap().unwrap();
    // Original neighbors visit center, up, down. Center is the unchanged
    // future, then up is the first legal changed rate along the exact Y row.
    let expected_rate = rp::Vector::Y * 1_f32.next_up();
    let expected = Curve::Anchored {
        carrier: f.carrier,
        anchor: rp::Vector::ZERO,
        offset: rp::Vector::ZERO,
        linear_velocity: expected_rate,
        rotation: rp::Rotation::IDENTITY,
    };
    assert_eq!(
        actual.rate.to_array().map(f32::to_bits),
        expected_rate.to_array().map(f32::to_bits)
    );
    assert_eq!(
        postcard::to_allocvec(&actual.curve).unwrap(),
        postcard::to_allocvec(&expected).unwrap()
    );
    assert!(same_pose(actual.curve.com_pose(0.), f.old.com_pose(0.)));
    assert!(w.used < 1 + 27 * 10 * (1024 + 16));
    assert_eq!(source(&f), before);
}

#[test]
fn exact_shared_work_one_below_and_offset_retry_leave_the_source_unpublished() {
    let f = fixture();
    let before = source(&f);
    let own = false; // First positive selection uses the real external-rate path.
    let mut full = work();
    let expected = propose(&f, own, &mut full).unwrap().unwrap();
    for available in [0, 1, 1024, full.used - 1] {
        let mut limited = Work {
            used: 37,
            limit: 37 + available,
        };
        assert!(matches!(
            propose(&f, own, &mut limited),
            Err(TrajectoryError::WorkLimit)
        ));
        assert!(limited.used >= 37 && limited.used <= limited.limit);
        assert_eq!(source(&f), before);
    }
    let mut exact = Work {
        used: 37,
        limit: 37 + full.used,
    };
    let actual = propose(&f, own, &mut exact).unwrap().unwrap();
    assert_eq!(exact.used, 37 + full.used);
    assert_eq!(actual.rate, expected.rate);
    assert_eq!(
        postcard::to_allocvec(&actual.curve).unwrap(),
        postcard::to_allocvec(&expected.curve).unwrap()
    );
    assert_eq!(source(&f), before);
    let mut observed = 0;
    let rejected = f.scratch.reference_proposal_core(
        0,
        f.carrier,
        rp::Vector::ZERO,
        f.old,
        f.target,
        0.,
        0.,
        true,
        rp::Vector::new(1., 0., 1.),
        rp::Vector::Y,
        false,
        &mut work(),
        &mut |_, _| {
            observed += 1;
            Err(TrajectoryError::InvalidReference)
        },
    );
    assert!(matches!(rejected, Err(TrajectoryError::InvalidReference)));
    assert_eq!(observed, 1);
    assert_eq!(source(&f), before);
}

#[test]
fn raw_none_and_duplicate_slots_pay_visits_but_rows_pay_only_the_visited_prefix() {
    let mut f = fixture();
    let offsets = self_reference::offsets(
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    );
    let some: Vec<_> = offsets
        .values
        .iter()
        .flatten()
        .map(|v| v.to_array().map(f32::to_bits))
        .collect();
    assert!(
        some.len() < offsets.len
            || some
                .iter()
                .enumerate()
                .any(|(i, value)| some[..i].contains(value))
    );
    for own in [false, true] {
        let carrier = if own {
            let Curve::Integrated(kernel) = f.old else {
                unreachable!()
            };
            kernel
        } else {
            f.carrier
        };
        let mut w = work();
        // Every descriptor has the old total at the three original screens.
        // Real raw slots are still visited and billed, even without a row walk.
        let none = f
            .scratch
            .reference_proposal_core(
                0,
                carrier,
                rp::Vector::ZERO,
                f.old,
                f.target,
                0.,
                0.,
                false,
                rp::Vector::new(1., 0., 1.),
                rp::Vector::Y,
                own,
                &mut w,
                &mut |_, _| panic!("no unchanged descriptor can reach acceptance"),
            )
            .unwrap();
        assert!(none.is_none());
        let slots = if own { 28 } else { 10 };
        assert_eq!(w.used, 1 + 27 * slots * 1024);
    }
    f.scratch.character_values[0].1 = rp::Vector::ZERO;
    f.scratch.character_rows.push(actual_rows::Row {
        a: usize::MAX,
        b: None,
        normal: rp::Vector::Y,
        velocity: rp::Vector::ZERO,
    });
    let before = source(&f);
    let mut exact = Work {
        used: 17,
        limit: 33,
    };
    assert!(!f
        .scratch
        .proposal_rows_feasible_impl(None, Some(&mut exact))
        .unwrap());
    assert_eq!(exact.used, 33); // First real row rejects before invalid second row.
    assert!(!f.scratch.proposal_rows_feasible(None).unwrap());
    let mut below = Work {
        used: 17,
        limit: 32,
    };
    assert!(matches!(
        f.scratch
            .proposal_rows_feasible_impl(None, Some(&mut below)),
        Err(TrajectoryError::WorkLimit)
    ));
    assert_eq!(below.used, 17);
    assert_eq!(source(&f), before);
}

#[test]
fn static_tangent_cells_reuse_the_original_external_inverse_order() {
    let mut f = fixture();
    let domain = Domain::new(0., f64::from(0.1234567_f32)).unwrap();
    f.carrier = Kernel::from_velocity(
        f.carrier.native.motion.body,
        domain,
        rp::Pose::from_translation(rp::Vector::Y),
        f.target,
        rp::Vector::ZERO,
    )
    .unwrap();
    let search = |f: &Fixture, accept, w: &mut Work| {
        f.scratch.reference_proposal_core(
            0,
            f.carrier,
            rp::Vector::ZERO,
            f.old,
            f.target,
            0.,
            0.,
            true,
            rp::Vector::new(1., 0., 1.),
            rp::Vector::Y,
            false,
            w,
            &mut |_, _| Ok(accept),
        )
    };
    let selected = search(&f, true, &mut work()).unwrap().unwrap();
    let mut fast = work();
    assert!(search(&f, false, &mut fast).unwrap().is_none());

    // This extra row admits all the original candidates. Its different axis
    // forces the general path to retain the original full tangent traversal.
    f.scratch.character_rows.push(actual_rows::Row {
        a: 0,
        b: None,
        normal: rp::Vector::X,
        velocity: -rp::Vector::X,
    });
    let generic = search(&f, true, &mut work()).unwrap().unwrap();
    let mut full = work();
    assert!(search(&f, false, &mut full).unwrap().is_none());
    assert_eq!(selected.rate, generic.rate);
    assert_eq!(
        postcard::to_allocvec(&selected.curve).unwrap(),
        postcard::to_allocvec(&generic.curve).unwrap()
    );
    assert!(fast.used < full.used / 4);
}

#[test]
fn stationary_external_reference_cannot_republish_an_identical_future() {
    let mut f = fixture();
    let domain = Domain::new(0., 0.125).unwrap();
    f.target = rp::Vector::ZERO;
    f.carrier = Kernel::from_velocity(
        f.carrier.native.motion.body,
        domain,
        rp::Pose::from_translation(rp::Vector::Y),
        f.target,
        rp::Vector::ZERO,
    )
    .unwrap();
    let mut actor = Kernel::from_velocity(
        crate::physics3d::world::native_id(f.scratch.participants[0].body),
        domain,
        rp::Pose::IDENTITY,
        f.target,
        rp::Vector::ZERO,
    )
    .unwrap();
    f.old = Curve::Integrated(actor);
    f.scratch.character_rows[0].velocity = f.target;
    f.scratch.character_values[0].1 = f.target;

    let before = source(&f);
    let mut bounded = work();
    assert!(propose(&f, false, &mut bounded).unwrap().is_none());
    assert!(bounded.used < 2048);
    assert_eq!(source(&f), before);

    // A distinct stored Native endpoint invalidates constant-pose authority.
    actor.native.motion.end.translation.y = f32::MIN_POSITIVE;
    f.old = Curve::Integrated(actor);
    let selected = propose(&f, false, &mut work()).unwrap().unwrap();
    assert!(same_pose(selected.curve.com_pose(0.), f.old.com_pose(0.)));
    assert!(!same_pose(
        selected.curve.com_pose(domain.end),
        f.old.com_pose(domain.end)
    ));
}
