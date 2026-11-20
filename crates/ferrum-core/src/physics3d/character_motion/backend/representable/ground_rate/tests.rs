use super::super::super::momentum_tests::entry;
use super::*;
use crate::physics3d::{
    solver_trajectory::{self, CastHit, ShapeMotion},
    world::native_id,
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, PhysicsWorld3d, Pose, Shape, WorldConfig,
};

const SAFE: Time = 0.00013647079671130768;
const HIT: Time = 0.0001364946385695731;
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
struct Fixture {
    world: PhysicsWorld3d,
    scratch: BackendMotionScratch,
    actor: BodyId,
    platform: BodyId,
    hit: actual_scene::Hit,
    original: Curve,
    geometry: rp::Vector,
    end: Time,
}
fn fixture() -> Fixture {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let platform = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: Pose {
                    position: [0., -0.1, 0.],
                    ..Default::default()
                },
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.1, 2.],
            }),
        )
        .unwrap();
    let actor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [1., 0.51, 0.],
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
                push_mass: 2.,
                ..Default::default()
            },
        )
        .unwrap();
    let domain = Domain::new(0., f64::from(0.025_f32)).unwrap();
    let kernel = Kernel::from_velocity_seconds(
        native_id(platform),
        domain,
        0.025,
        rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
        rp::Vector::new(0., -7.3886794e-9, 0.),
        rp::Vector::new(-2.7500596e-10, 2., -5.5276894e-9),
    )
    .unwrap();
    let anchor = rp::Vector::new(0.9999944, 0.09986183, 2.9802322e-6);
    let original = Curve::Anchored {
        carrier: kernel,
        anchor,
        offset: rp::Vector::new(5.6028366e-6, 0.51013815, -2.9802322e-6),
        linear_velocity: rp::Vector::new(0., -3.1974423e-14, 0.),
        rotation: rp::Rotation::IDENTITY,
    };
    world.characters.get_mut(&actor).unwrap().support_motion = Some((
        platform,
        anchor + world.backend.bodies[native_id(platform)].local_center_of_mass(),
        rp::Vector::ZERO,
    ));
    world.refresh_queries();
    let mut scratch = BackendMotionScratch::default();
    world.prepare_backend_motion(&mut scratch, 0.025).unwrap();
    scratch.entries.push(entry(native_id(platform), kernel));
    let own = Kernel::from_velocity(
        native_id(actor),
        domain,
        original.com_pose(0.),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let mut rider = entry(native_id(actor), own);
    rider.curve = original;
    rider.support = Some(native_id(platform));
    scratch.entries.push(rider);
    let geometry = curve_velocity(original, HIT).unwrap().0;
    let raw = physical_momentum::State::from_native(scratch.entries[0].value).unwrap();
    let physical_carry = raw
        .point_rate(kernel.position_at_time(HIT).rotation * anchor)
        .unwrap();
    for (id, curve, linear, angular, mass) in [
        (
            platform,
            Curve::Integrated(kernel),
            raw.linear,
            raw.angular,
            MassPolicy::Native,
        ),
        (
            actor,
            original,
            physical_carry,
            rp::Vector::ZERO,
            MassPolicy::Character(2.),
        ),
    ] {
        scratch.participants.push(Participant {
            body: id,
            pose: curve.com_pose(HIT),
            linear_velocity: linear,
            angular_velocity: angular,
            mass,
        });
    }
    scratch.entries[0].momentum_before = raw.linear;
    scratch.entries[1].momentum_before = physical_carry;
    scratch.entries[1].momentum_carry = physical_carry;
    scratch.character_values.push((actor, geometry));
    let motion = |id, curve, role| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role,
            motion: ShapeMotion {
                curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let a = motion(platform, Curve::Integrated(kernel), Role::Dynamic);
    let b = motion(actor, original, Role::Character(actor));
    solver_trajectory::contacts_full_shapes(
        a.motion,
        world.backend.colliders[a.collider].shape(),
        b.motion,
        world.backend.colliders[b.collider].shape(),
        HIT,
        0.5,
        &mut work(),
        &mut |contact, _, _, _| {
            scratch
                .contacts
                .push(actual_scene::ContactSample { a, b, contact });
            Ok(())
        },
    )
    .unwrap();
    let contact = scratch.contacts[0].contact;
    assert!(contact.dist > 0. && contact.dist < 0.01);
    assert_ne!(contact.normal1.x, 0.);
    assert_ne!(contact.normal1.z, 0.);
    scratch.character_rows.push(actual_rows::Row {
        a: 0,
        b: None,
        normal: contact.normal1,
        velocity: geometry,
    });
    let hit = actual_scene::Hit {
        a,
        b,
        cast: CastHit {
            safe_time: SAFE,
            hit_time: HIT,
            contact,
            subshape_a: 0,
            subshape_b: 0,
        },
    };
    Fixture {
        world,
        scratch,
        actor,
        platform,
        hit,
        original,
        geometry,
        end: domain.end,
    }
}
fn invoke(f: &Fixture, w: &mut Work) -> Result<Option<Proposal>, TrajectoryError> {
    f.scratch.representable_suffix(
        1,
        f.hit,
        SAFE,
        f.end,
        &f.world.backend.bodies,
        &f.world.backend.colliders,
        &f.world.characters,
        f.geometry,
        w,
        false,
    )
}
fn bytes(f: &Fixture) -> Vec<u8> {
    f.world.capture_snapshot().unwrap().encoded_bytes().to_vec()
}
fn ledger(f: &Fixture) -> Vec<u8> {
    postcard::to_allocvec(&(
        f.scratch
            .entries
            .iter()
            .map(|e| {
                (
                    (
                        e.value.handle,
                        e.value.end,
                        e.value.linear_velocity,
                        e.value.angular_velocity,
                        e.value.keep_integrated_endpoint,
                    ),
                    e.velocity_delta,
                    e.geometry_delta,
                    e.geometry_credit,
                    e.response_geometry_delta,
                    e.response_geometry_credit,
                )
            })
            .collect::<Vec<_>>(),
        f.scratch
            .origins
            .iter()
            .map(|o| {
                (
                    o.relative_plan,
                    o.relative_momentum,
                    o.geometry_delta,
                    o.geometry_credit,
                    o.velocity_delta,
                )
            })
            .collect::<Vec<_>>(),
    ))
    .unwrap()
}

#[test]
fn actual_495_skin_cell_has_a_real_upward_geometry_candidate_without_a_physical_impulse() {
    let f = fixture();
    let before = bytes(&f);
    let before_ledger = ledger(&f);
    assert!(f
        .scratch
        .original_representable_suffix(
            1,
            f.hit,
            SAFE,
            f.end,
            &f.world.backend.bodies,
            &f.world.backend.colliders,
            &f.world.characters,
            f.geometry,
            &mut work(),
            false,
            None,
        )
        .unwrap()
        .is_none());
    let mut shared = work();
    let p = invoke(&f, &mut shared)
        .unwrap()
        .expect("recorded actual ground rate cell");
    assert!(same_pose(p.curve.com_pose(SAFE), f.original.com_pose(SAFE)));
    assert_eq!(
        p.curve.com_pose(HIT).translation.y.to_bits(),
        f.original.com_pose(HIT).translation.y.next_up().to_bits()
    );
    assert!(p.rate.y > f.geometry.y);
    let Curve::Anchored {
        carrier: old,
        anchor: a,
        offset: o,
        rotation: q,
        ..
    } = f.original
    else {
        unreachable!()
    };
    let Curve::Anchored {
        carrier: new,
        anchor: b,
        offset: r,
        rotation: t,
        ..
    } = p.curve
    else {
        unreachable!()
    };
    assert!(same_kernel(old, new));
    let Curve::Anchored {
        linear_velocity: old_relative,
        ..
    } = f.original
    else {
        unreachable!()
    };
    let Curve::Anchored {
        linear_velocity: new_relative,
        ..
    } = p.curve
    else {
        unreachable!()
    };
    let correction = CorrectionRange::from_curve(old, a, q, SAFE, f.end, 1, &mut work())
        .unwrap()
        .difference(o.y, r.y, old_relative.y, new_relative.y)
        .unwrap();
    let skin = f64::from(f.world.characters[&f.actor].config.skin_width);
    assert!(correction <= skin);
    // The common elevator motion cancels algebraically. Its travel is not
    // subtracted as two independent envelopes or counted as correction.
    let elevator = Kernel::from_velocity_seconds(
        old.native.motion.body,
        old.domain,
        old.native.integration_seconds,
        old.native.motion.start,
        rp::Vector::new(0., 8., 0.),
        old.native.angular_velocity,
    )
    .unwrap();
    assert!(
        (elevator.position_at_time(f.end).translation.y
            - elevator.position_at_time(SAFE).translation.y)
            .abs()
            > skin as f32
    );
    let elevator_delta = CorrectionRange::from_curve(elevator, a, q, SAFE, f.end, 1, &mut work())
        .unwrap()
        .difference(o.y, r.y, old_relative.y, new_relative.y)
        .unwrap();
    assert!(elevator_delta <= skin);
    assert_eq!(new.native.motion.body, native_id(f.platform));
    assert_eq!(
        f.scratch.participants[1].linear_velocity,
        f.scratch.entries[1].momentum_before
    );
    assert_eq!(a, b);
    assert_eq!(
        q.to_array().map(f32::to_bits),
        t.to_array().map(f32::to_bits)
    );
    assert_eq!(o.x.to_bits(), r.x.to_bits());
    assert_eq!(o.z.to_bits(), r.z.to_bits());
    for time in [0., SAFE, HIT, (HIT + f.end) * 0.5, f.end] {
        for axis in [0, 2] {
            assert_eq!(
                p.curve.com_pose(time).translation[axis].to_bits(),
                f.original.com_pose(time).translation[axis].to_bits()
            );
        }
        let after = curve_velocity(p.curve, time).unwrap();
        let before = curve_velocity(f.original, time).unwrap();
        assert_eq!(after.1, before.1);
        for axis in [0, 2] {
            assert_eq!(after.0[axis].to_bits(), before.0[axis].to_bits());
        }
    }
    let next = gap(
        f.hit.b,
        p.curve,
        f.hit.a,
        f.hit.a.motion.curve,
        &f.world.backend.colliders,
        HIT,
        0.01,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(next >= 0.01 && next > f.hit.cast.contact.dist);
    assert!(solver_trajectory::cast_full_shapes_policy(
        f.hit.a.motion,
        f.world.backend.colliders[f.hit.a.collider].shape(),
        ShapeMotion {
            curve: p.curve,
            ..f.hit.b.motion
        },
        f.world.backend.colliders[f.hit.b.collider].shape(),
        SAFE,
        f.end,
        0.01,
        2.5e-8,
        &mut shared,
        true,
    )
    .unwrap()
    .is_none());
    assert_eq!(ledger(&f), before_ledger);
    assert_eq!(bytes(&f), before);
    assert!(f.scratch.rows.is_empty());
    assert!(f.scratch.row_impulses.is_empty());
}

#[test]
fn geometry_bias_is_not_canonical_input_credit_transport_or_a_new_native_kernel() {
    let mut f = fixture();
    let old = ledger(&f);
    let proposal = invoke(&f, &mut work()).unwrap().unwrap();
    f.scratch.accepted.try_reserve_exact(4).unwrap();
    let previous = f.scratch.entries[1];
    f.scratch
        .stage_curve(previous, 0., SAFE, &f.world.backend.bodies, &mut work())
        .unwrap();
    let first = postcard::to_allocvec(&(
        f.scratch.accepted[0].curve,
        f.scratch.accepted[0].start_time,
        f.scratch.accepted[0].end_time,
    ))
    .unwrap();
    f.scratch.entries[1].curve = proposal.curve;
    f.scratch.entries[1].domain_start = SAFE;
    f.scratch.entries[1].value.end = proposal.curve.com_pose(f.end);
    f.scratch.character_values[0].1 = proposal.rate;
    f.scratch
        .refresh_anchors(SAFE, f.end, &f.world.backend.bodies, &mut work())
        .unwrap();
    assert!(same_reference(f.scratch.entries[1].curve, proposal.curve));
    // The next response deliberately reconstructs from canonical/physical
    // sources, not the outgoing derivative stored in the old suffix.
    let rebuilt = f
        .scratch
        .geometry_after_carrier_response(
            f.scratch.entries[1],
            SAFE,
            HIT,
            f.end,
            &f.world.backend.bodies,
            &mut work(),
        )
        .unwrap();
    assert!(rebuilt.y < proposal.rate.y);
    assert_eq!(f.scratch.entries[1].geometry_delta, rp::Vector::ZERO);
    assert_eq!(f.scratch.entries[1].geometry_credit, rp::Vector::ZERO);
    f.scratch
        .stage_curve(
            f.scratch.entries[1],
            SAFE,
            f.end,
            &f.world.backend.bodies,
            &mut work(),
        )
        .unwrap();
    assert_eq!(
        first,
        postcard::to_allocvec(&(
            f.scratch.accepted[0].curve,
            f.scratch.accepted[0].start_time,
            f.scratch.accepted[0].end_time
        ))
        .unwrap()
    );
    let Curve::Anchored {
        carrier, anchor, ..
    } = f.original
    else {
        unreachable!()
    };
    let physical = f
        .scratch
        .physical_support_anchor(f.scratch.entries[1], &f.world.backend.bodies, &mut work())
        .unwrap();
    assert_eq!(physical, anchor);
    let at = |t| {
        carrier.position_at_time(t).translation + carrier.position_at_time(t).rotation * physical
    };
    let expected = (at(SAFE) - at(0.)) + (at(f.end) - at(SAFE));
    assert_eq!(f.scratch.origins[0].carry, expected);
    assert!(same_kernel(
        match f.scratch.entries[0].curve {
            Curve::Integrated(k) => k,
            _ => unreachable!(),
        },
        carrier
    ));
    // Only accepted endpoint/transport may differ; the physical velocity and
    // original input/credit portions captured before installation stay intact.
    assert_ne!(ledger(&f), old); // value.end is the actual proposed geometry.
    assert!(f
        .scratch
        .entries
        .iter()
        .all(|e| e.velocity_delta == rp::Vector::ZERO));
}

#[test]
fn jump_upward_intent_actual_separation_and_noncardinal_up_do_not_get_a_skin_waiver() {
    let f = fixture();
    let Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity,
        rotation,
    } = f.original
    else {
        unreachable!()
    };
    let skin = f64::from(f.world.characters[&f.actor].config.skin_width);
    let near_start = 1.0e-12;
    let mut relative = linear_velocity;
    relative.y = 0.;
    let without_rate = Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity: relative,
        rotation,
    };
    let near_pose = f.original.com_pose(near_start);
    let rates = rate_cells(
        without_rate.com_pose(near_start).translation.y,
        near_pose.translation.y,
        near_start as f32,
        true,
    )
    .unwrap();
    let correction =
        CorrectionRange::from_curve(carrier, anchor, rotation, near_start, f.end, 1, &mut work())
            .unwrap();
    let mut same_safe = false;
    for rate in rates {
        relative.y = rate;
        let candidate = Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity: relative,
            rotation,
        };
        let bound = correction
            .difference(offset.y, offset.y, linear_velocity.y, rate)
            .unwrap();
        assert!(bound > skin);
        if same_pose(candidate.com_pose(near_start), near_pose) {
            same_safe = true;
            let actual_difference = f64::from(candidate.com_pose(f.end).translation.y)
                - f64::from(f.original.com_pose(f.end).translation.y);
            assert!(actual_difference > skin);
            assert!(actual_difference.abs() <= bound);
        }
    }
    assert!(
        same_safe,
        "safe7bits alone must not authorize a huge suffix rise"
    );
    // The raw coefficient difference is below skin, but a final RN add can
    // move by a whole large-coordinate cell. Include that actual F32 jump.
    let large = 524_288_f32;
    let old_rate = 0.03125_f32;
    let new_rate = old_rate.next_up();
    assert!(f64::from(new_rate - old_rate) < skin);
    let actual_jump = f64::from(large + new_rate) - f64::from(large + old_rate);
    assert!(actual_jump > skin);
    let large_bound = CorrectionRange {
        base: [large; 2],
        seconds: [0., 1.],
    }
    .difference(0., 0., old_rate, new_rate)
    .unwrap();
    assert!(large_bound >= actual_jump && large_bound > skin);
    let mut f = fixture();
    f.world
        .characters
        .get_mut(&f.actor)
        .unwrap()
        .state
        .vertical_speed = 1.;
    assert!(invoke(&f, &mut work()).unwrap().is_none());
    let mut f = fixture();
    f.scratch.origins[0].relative_plan = rp::Vector::Y;
    assert!(invoke(&f, &mut work()).unwrap().is_none());
    let mut f = fixture();
    f.scratch.participants[1].linear_velocity.y += 1.;
    assert!(invoke(&f, &mut work()).unwrap().is_none());
    let mut f = fixture();
    f.world.characters.get_mut(&f.actor).unwrap().config.up =
        rp::Vector::new(1., 1., 0.).normalize().to_array();
    assert!(invoke(&f, &mut work()).unwrap().is_none());
}

#[test]
fn all_simultaneous_rows_axis_locks_and_current_support_are_mandatory() {
    let mut f = fixture();
    f.scratch.character_rows.push(actual_rows::Row {
        a: 0,
        b: None,
        normal: -rp::Vector::Y,
        velocity: rp::Vector::ZERO,
    });
    assert!(invoke(&f, &mut work()).unwrap().is_none());
    let mut f = fixture();
    f.world.backend.bodies[native_id(f.actor)]
        .set_locked_axes(rp::LockedAxes::TRANSLATION_LOCKED_Y, true);
    assert!(invoke(&f, &mut work()).unwrap().is_none());
    let mut f = fixture();
    f.hit.a.parent = None;
    assert!(invoke(&f, &mut work()).unwrap().is_none());
    let mut f = fixture();
    f.scratch.entries[1].support = None;
    assert!(f
        .scratch
        .ground_rate_suffix(
            1,
            f.hit,
            SAFE,
            f.end,
            &f.world.backend.bodies,
            &f.world.backend.colliders,
            &f.world.characters,
            f.geometry,
            &mut work(),
            false
        )
        .unwrap()
        .is_none());
    let mut f = fixture();
    f.hit.a.sensor = true;
    assert!(invoke(&f, &mut work()).unwrap().is_none());
}

#[test]
fn exact_work_and_one_below_leave_all_inputs_physical_values_and_j_unpublished() {
    let mut f = fixture();
    f.world
        .add_force(f.platform, [20., 30., 40.], [1., 2., 3.])
        .unwrap();
    let before = bytes(&f);
    let old = ledger(&f);
    let mut measured = work();
    let p = invoke(&f, &mut measured).unwrap().unwrap();
    let mut exact = Work {
        used: 0,
        limit: measured.used,
    };
    let q = invoke(&f, &mut exact).unwrap().unwrap();
    assert!(same_reference(p.curve, q.curve));
    assert_eq!(exact.used, measured.used);
    assert_eq!(
        invoke(
            &f,
            &mut Work {
                used: 0,
                limit: measured.used - 1
            }
        )
        .err(),
        Some(TrajectoryError::WorkLimit)
    );
    assert_eq!(bytes(&f), before);
    assert_eq!(ledger(&f), old);
}
