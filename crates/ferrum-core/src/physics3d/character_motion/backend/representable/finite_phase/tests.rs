use super::*;
use crate::physics3d::{
    solver_trajectory::{self, CastHit},
    world::native_id,
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, PhysicsWorld3d, Pose, Shape, WorldConfig,
};

// C84 current response, not the earlier C83 impact tuple.
const START: Time = 0.04899999767919063;
const END: Time = 0.04900101794303979;
const SAFE: Time = 0.049000001664596296;
const HIT: Time = 0.049000003657299125;
const H: f32 = 1.0202639e-6;

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
    hit: actual_scene::Hit,
    geometry: rp::Vector,
}
fn fixture() -> Fixture {
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
                pose: Pose {
                    position: [-2.9206275e-8, 0., 0.09799999],
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
                step_height: 0.,
                ..Default::default()
            },
        )
        .unwrap();
    let dynamic = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: Pose {
                    position: [0.51, 0., 0.],
                    ..Default::default()
                },
                linear_velocity: [-5.066886, 0., 0.],
                angular_velocity: [0., 1.3650212, 2.3841858e-7],
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.25, 1., 1.],
            }),
        )
        .unwrap();
    let runtime = world.characters.get_mut(&actor).unwrap();
    runtime.free_velocity = [0., 0., 2.];
    runtime.free_translation = [0., 0., 0.2];
    world.refresh_queries();
    let mut scratch = BackendMotionScratch::default();
    world.prepare_backend_motion(&mut scratch, 0.1).unwrap();
    let geometry = rp::Vector::new(-4.933114, 0., 2.);
    let domain = Domain::new(START, END).unwrap();
    for (id, velocity) in [
        (actor, geometry),
        (dynamic, rp::Vector::new(-5.066886, 0., 0.)),
    ] {
        let body = &world.backend.bodies[native_id(id)];
        let kernel = Kernel::from_velocity_seconds(
            native_id(id),
            domain,
            H,
            body.position()
                .prepend_translation(body.local_center_of_mass()),
            velocity,
            if id == actor {
                rp::Vector::ZERO
            } else {
                body.angvel()
            },
        )
        .unwrap();
        let mut entry = super::super::super::momentum_tests::entry(native_id(id), kernel);
        if id == actor {
            // Already accepted physical J is an immutable input to this purely
            // geometric proposal. It must neither disappear nor be paid again.
            entry.velocity_delta = rp::Vector::new(-4.933114, 0., 0.);
            entry.geometry_delta = entry.velocity_delta;
        }
        scratch.entries.push(entry);
    }
    scratch.character_values = vec![(actor, geometry)];
    scratch.character_carry = vec![rp::Vector::ZERO];
    // Original simultaneous C84 rows; retain their tiny tangent components.
    for vx in [-4.9331136, -4.933114] {
        scratch.character_rows.push(actual_rows::Row {
            a: 0,
            b: None,
            normal: rp::Vector::new(-1., -1.4252922e-15, 8.160245e-9),
            velocity: rp::Vector::new(vx, -6.079674e-8, 0.3480804),
        });
    }
    let trajectory = |id, role, entry: Entry| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role,
            motion: ShapeMotion {
                curve: entry.curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let a = trajectory(actor, Role::Character(actor), scratch.entries[0]);
    let b = trajectory(dynamic, Role::Dynamic, scratch.entries[1]);
    let contact = solver_trajectory::leaf_contact(
        &a.motion.pose(HIT),
        world.backend.colliders[a.collider].shape(),
        &b.motion.pose(HIT),
        world.backend.colliders[b.collider].shape(),
        &mut work(),
    )
    .unwrap();
    assert!(contact.dist < 0.01);
    assert!(contact.normal1.y != 0. && contact.normal1.z != 0.);
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
        hit,
        geometry,
    }
}
impl Fixture {
    fn call(&self, budget: &mut Work) -> Result<Option<Proposal>, TrajectoryError> {
        self.scratch.finite_phase_suffix(
            0,
            self.hit,
            SAFE,
            END,
            &self.world.backend.bodies,
            &self.world.backend.colliders,
            &self.world.characters,
            self.geometry,
            budget,
            false,
        )
    }
    fn immutable_bytes(&self) -> Vec<u8> {
        postcard::to_allocvec(&(
            self.scratch
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
                        e.curve,
                        e.velocity_delta,
                        e.geometry_delta,
                        e.geometry_credit,
                    )
                })
                .collect::<Vec<_>>(),
            self.scratch
                .origins
                .iter()
                .map(|o| {
                    (
                        o.body,
                        o.start,
                        o.relative_momentum,
                        o.relative_plan,
                        o.velocity_delta,
                        o.geometry_delta,
                        o.geometry_credit,
                        o.support,
                    )
                })
                .collect::<Vec<_>>(),
            &self.scratch.character_values,
        ))
        .unwrap()
    }
}

#[test]
fn recorded_c84_finite_translation_phase_preserves_physical_state_tangents_and_whole_future() {
    let f = fixture();
    let before = f.immutable_bytes();
    let world_before = f.world.capture_snapshot().unwrap();
    let mut budget = work();
    let proposal = f.call(&mut budget).unwrap().expect("actual finite phase");
    let price = budget.used;
    let old = f.scratch.entries[0].curve;
    let Curve::Integrated(own) = old else {
        panic!("original Native")
    };
    let Curve::Integrated(donor) = f.scratch.entries[1].curve else {
        panic!("original Dynamic")
    };
    let Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity,
        ..
    } = proposal.curve
    else {
        panic!("geometry-only frame")
    };
    assert!(same_pose(old.com_pose(SAFE), proposal.curve.com_pose(SAFE)));
    assert!(same_clock(own, carrier) && same_clock(donor, carrier));
    assert_eq!(carrier.native.motion.body, native_id(f.actor));
    assert_ne!(carrier.native.motion.body, donor.native.motion.body);
    assert_eq!(carrier.native.angular_velocity, rp::Vector::ZERO);
    assert_eq!(
        donor.native.angular_velocity.to_array(),
        [0., 1.3650212, 2.3841858e-7]
    );
    assert_eq!(
        proposal.rate.to_array().map(f32::to_bits),
        f.geometry.to_array().map(f32::to_bits)
    );
    assert_eq!(curve_velocity(proposal.curve, HIT).unwrap().0, f.geometry);
    for axis in [1, 2] {
        assert_eq!(anchor[axis].to_bits(), 0);
        assert_eq!(offset[axis].to_bits(), 0);
        assert_eq!(linear_velocity[axis].to_bits(), 0);
        assert_eq!(
            carrier.native.motion.start.translation[axis].to_bits(),
            own.native.motion.start.translation[axis].to_bits()
        );
        assert_eq!(
            carrier.native.motion.end.translation[axis].to_bits(),
            own.native.motion.end.translation[axis].to_bits()
        );
        assert_eq!(
            carrier.native.linear_velocity[axis].to_bits(),
            own.native.linear_velocity[axis].to_bits()
        );
    }
    // Endpoint/interior bit controls complement the source all-time argument:
    // identical physical dt law, identical RN tangent operands, then +0 adds.
    for time in [START, SAFE, HIT, (HIT + END) * 0.5, END] {
        for axis in [1, 2] {
            assert_eq!(
                old.com_pose(time).translation[axis].to_bits(),
                proposal.curve.com_pose(time).translation[axis].to_bits()
            );
        }
    }
    let old_gap = gap(
        f.hit.a,
        old,
        f.hit.b,
        f.hit.b.motion.curve,
        &f.world.backend.colliders,
        HIT,
        0.01,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    let new_gap = gap(
        f.hit.a,
        proposal.curve,
        f.hit.b,
        f.hit.b.motion.curve,
        &f.world.backend.colliders,
        HIT,
        0.01,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(new_gap >= 0.01 && new_gap > old_gap);
    assert!(
        correction(
            &com_bounds(old, SAFE, END, &mut work()).unwrap(),
            &com_bounds(proposal.curve, SAFE, END, &mut work()).unwrap(),
            0
        )
        .unwrap()
            <= 0.01_f32 as f64
    );
    // The proposal's internal FullFuture is the same original A/B, real rotating
    // Box, requested skin and Native observer-tolerance policy as its caller.
    assert!(full_future::FullFuture::new(
        f.hit.a,
        old,
        f.hit.b,
        f.hit.b.motion.curve,
        &f.world.backend.colliders,
        carrier,
        SAFE,
        END,
        0.01,
        true,
        &mut work()
    )
    .unwrap()
    .accepts(proposal.curve, &mut work())
    .unwrap());
    for allowance in [price, price - 1] {
        let mut budget = Work {
            used: 41,
            limit: 41 + allowance,
        };
        let result = f.call(&mut budget);
        if allowance == price {
            assert!(same_reference(
                result.unwrap().unwrap().curve,
                proposal.curve
            ));
            assert_eq!(budget.used, 41 + price);
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
    }
    assert_eq!(f.immutable_bytes(), before);
    assert_eq!(
        f.world.capture_snapshot().unwrap().encoded_bytes(),
        world_before.encoded_bytes()
    );
    assert!(f.scratch.rows.is_empty() && f.scratch.row_impulses.is_empty());
}

#[test]
fn finite_translation_phase_requires_original_clocks_stored_bits_and_all_rows() {
    for change in 0..8 {
        let mut f = fixture();
        match change {
            0 => {
                let Curve::Integrated(mut k) = f.scratch.entries[1].curve else {
                    unreachable!()
                };
                k.domain.start = k.domain.start.next_up();
                f.scratch.entries[1].curve = Curve::Integrated(k);
            }
            1 => {
                let Curve::Integrated(mut k) = f.scratch.entries[1].curve else {
                    unreachable!()
                };
                k.native.motion.end_time = k.native.motion.end_time.next_up();
                f.scratch.entries[1].curve = Curve::Integrated(k);
            }
            2 => {
                let Curve::Integrated(mut k) = f.scratch.entries[0].curve else {
                    unreachable!()
                };
                k.native.motion.end.translation.z = k.native.motion.end.translation.z.next_up();
                f.scratch.entries[0].curve = Curve::Integrated(k);
            }
            3 => {
                let Curve::Integrated(mut k) = f.scratch.entries[0].curve else {
                    unreachable!()
                };
                k.native.motion.start.translation.y = -0.;
                f.scratch.entries[0].curve = Curve::Integrated(k);
            }
            4 => {
                f.world
                    .characters
                    .get_mut(&f.actor)
                    .unwrap()
                    .config
                    .push_mass = 0.
            }
            5 => f.world.backend.bodies[native_id(f.actor)]
                .set_locked_axes(rp::LockedAxes::TRANSLATION_LOCKED_X, false),
            6 => f.scratch.character_rows.push(actual_rows::Row {
                a: 0,
                b: None,
                normal: rp::Vector::X,
                velocity: rp::Vector::ZERO,
            }),
            7 => {
                let Curve::Integrated(mut k) = f.scratch.entries[0].curve else {
                    unreachable!()
                };
                k.native.integration_seconds = k.native.integration_seconds.next_up();
                f.scratch.entries[0].curve = Curve::Integrated(k);
            }
            _ => unreachable!(),
        }
        let before = f.immutable_bytes();
        assert!(
            f.call(&mut work()).unwrap().is_none(),
            "qualification {change}"
        );
        assert_eq!(f.immutable_bytes(), before);
    }
    let f = fixture();
    let mut budget = Work {
        used: 17,
        limit: 17,
    };
    assert!(matches!(
        f.call(&mut budget),
        Err(TrajectoryError::WorkLimit)
    ));
    assert_eq!(budget.used, 17);
}

struct SpanFixture {
    fixture: Fixture,
    safe: Time,
    end: Time,
    hit: Time,
}
fn recorded_span(shared: bool) -> SpanFixture {
    let mut f = fixture();
    let dynamic = identity(f.hit.b.parent.unwrap());
    let (safe, end, hit, h, actor_start, donor_start, geometry, physical, donor_v, omega, q0, q1) =
        if shared {
            (
                0.02500000037252903,
                0.05000000074505806,
                0.025000012293458163,
                0.025,
                rp::Vector::new(0.585, 3.223808e-9, 4.298412e-9),
                rp::Vector::new(1.095, -3.2238086e-9, -4.2984114e-9),
                rp::Vector::new(2.9999995, 1.2895232e-7, 1.7193648e-7),
                rp::Vector::new(2.9999998, 1.2895232e-7, 1.7193648e-7),
                rp::Vector::new(2.9999998, -1.2895234e-7, -1.7193645e-7),
                rp::Vector::new(-1.0658141e-14, -1.213669e-7, 1.5464988e-7),
                rp::Rotation::from_xyzw(-1.3322677e-16, -1.5170862e-9, 1.9331237e-9, 1.),
                rp::Rotation::from_xyzw(-2.6645354e-16, -3.0341725e-9, 3.8662473e-9, 1.),
            )
        } else {
            (
                0.06174999940022824,
                0.07450000009685753,
                0.06175000547990234,
                0.012750001,
                rp::Vector::new(0.55375, 2.7402376e-9, 3.6536498e-9),
                rp::Vector::new(1.06375, -2.7402378e-9, -3.6536505e-9),
                rp::Vector::new(4.9999995, 2.1492059e-7, 2.8656075e-7),
                rp::Vector::new(5., 2.1492059e-7, 2.8656078e-7),
                rp::Vector::new(5., -2.149206e-7, -2.865608e-7),
                rp::Vector::new(3.5527137e-15, -2.0227823e-7, 1.1920929e-7),
                rp::Rotation::from_xyzw(2.2648551e-17, -1.2895238e-9, 7.5995926e-10, 1.),
                rp::Rotation::from_xyzw(4.5297102e-17, -2.5790476e-9, 1.5199185e-9, 1.),
            )
        };
    let peer = if shared {
        let peer = f
            .world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [0.074999996, 0., 0.],
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
        f.world
            .enable_character(
                peer,
                CharacterConfig {
                    push_mass: 2.,
                    step_height: 0.,
                    ..Default::default()
                },
            )
            .unwrap();
        Some(peer)
    } else {
        None
    };
    for (id, start, q, v, w) in [
        (
            f.actor,
            actor_start,
            rp::Rotation::IDENTITY,
            physical,
            rp::Vector::ZERO,
        ),
        (dynamic, donor_start, q0, donor_v, omega),
    ] {
        let body = &mut f.world.backend.bodies[native_id(id)];
        body.set_position(rp::Pose::from_parts(start, q), false);
        body.set_linvel(v, false);
        body.set_angvel(w, false);
    }
    f.world.refresh_queries();
    f.scratch = BackendMotionScratch::default();
    f.world.prepare_backend_motion(&mut f.scratch, 0.1).unwrap();
    f.geometry = geometry;
    let domain = Domain::new(safe, end).unwrap();
    for (id, start, q, v, w) in [
        (
            f.actor,
            actor_start,
            rp::Rotation::IDENTITY,
            geometry,
            rp::Vector::ZERO,
        ),
        (dynamic, donor_start, q0, donor_v, omega),
    ] {
        let mut k = Kernel::from_velocity_seconds(
            native_id(id),
            domain,
            h,
            rp::Pose::from_parts(start, q),
            v,
            w,
        )
        .unwrap();
        if id == dynamic {
            k.native.motion.start_time = h;
            k.native.motion.end_time = h + h;
            k.native.motion.end.rotation = q1;
        }
        let mut entry = super::super::super::momentum_tests::entry(native_id(id), k);
        entry.momentum_before = if id == f.actor { physical } else { donor_v };
        entry.value.linear_velocity = entry.momentum_before;
        f.scratch.entries.push(entry);
    }
    if let Some(peer) = peer {
        let k = Kernel::from_velocity_seconds(
            native_id(peer),
            domain,
            h,
            rp::Pose::from_translation(rp::Vector::new(0.074999996, 0., 0.)),
            rp::Vector::new(2.9999995, 0., -4.0189088e-15),
            rp::Vector::ZERO,
        )
        .unwrap();
        let mut e = super::super::super::momentum_tests::entry(native_id(peer), k);
        e.value.linear_velocity = rp::Vector::new(3., 0., 0.);
        e.momentum_before = e.value.linear_velocity;
        f.scratch.entries.push(e);
        f.scratch.character_values = vec![
            (peer, rp::Vector::new(2.9999995, 0., -4.0189088e-15)),
            (f.actor, geometry),
        ];
        f.scratch.character_rows.push(actual_rows::Row {
            a: 0,
            b: Some(1),
            normal: rp::Vector::new(-1., -0., -8.4282625e-9),
            velocity: rp::Vector::ZERO,
        });
        for z in [-2.02885e-7, -2.0288502e-7] {
            f.scratch.character_rows.push(actual_rows::Row {
                a: 1,
                b: None,
                normal: rp::Vector::new(-1., -3.866249e-9, -3.034174e-9),
                velocity: rp::Vector::new(2.9999998, -1.6838806e-7, z),
            });
        }
    } else {
        f.scratch.character_values = vec![(f.actor, geometry)];
        for _ in 0..2 {
            f.scratch.character_rows.push(actual_rows::Row {
                a: 0,
                b: None,
                normal: rp::Vector::new(-1., -1.5199193e-9, -2.579049e-9),
                velocity: rp::Vector::new(5., -2.4531897e-7, -3.3814175e-7),
            });
        }
    }
    f.scratch.character_carry = vec![rp::Vector::ZERO; f.scratch.character_values.len()];
    for origin in &mut f.scratch.origins {
        if origin.body == f.actor {
            origin.start = actor_start;
            origin.relative_momentum = physical;
            origin.relative_plan = if shared {
                rp::Vector::new(3., physical.y, physical.z)
            } else {
                geometry
            };
            origin.velocity_delta = if shared {
                rp::Vector::new(-2.3841858e-7, 0., 0.)
            } else {
                rp::Vector::ZERO
            };
            origin.geometry_delta = origin.velocity_delta;
        }
    }
    let trajectory = |id, role, entry: Entry| {
        let body = &f.world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &f.world.backend.colliders[collider];
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role,
            motion: ShapeMotion {
                curve: entry.curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let a = trajectory(f.actor, Role::Character(f.actor), f.scratch.entries[0]);
    let b = trajectory(dynamic, Role::Dynamic, f.scratch.entries[1]);
    let contact = solver_trajectory::leaf_contact(
        &a.motion.pose(hit),
        f.world.backend.colliders[a.collider].shape(),
        &b.motion.pose(hit),
        f.world.backend.colliders[b.collider].shape(),
        &mut work(),
    )
    .unwrap();
    assert!(contact.dist < 0.01);
    f.hit = actual_scene::Hit {
        a,
        b,
        cast: CastHit {
            safe_time: safe,
            hit_time: hit,
            contact,
            subshape_a: 0,
            subshape_b: 0,
        },
    };
    SpanFixture {
        fixture: f,
        safe,
        end,
        hit,
    }
}
impl SpanFixture {
    fn call(&self, budget: &mut Work) -> Result<Option<Proposal>, TrajectoryError> {
        let f = &self.fixture;
        f.scratch.finite_span_phase_suffix(
            0,
            f.hit,
            self.safe,
            self.end,
            &f.world.backend.bodies,
            &f.world.backend.colliders,
            &f.world.characters,
            f.geometry,
            budget,
            false,
        )
    }
}

#[test]
fn recorded_c89_finite_responses_keep_absolute_labels_physical_state_and_complete_future() {
    for shared in [false, true] {
        let s = recorded_span(shared);
        let f = &s.fixture;
        let before = f.immutable_bytes();
        let snapshot = f.world.capture_snapshot().unwrap();
        let Curve::Integrated(own) = f.scratch.entries[0].curve else {
            unreachable!()
        };
        let Curve::Integrated(donor) = f.scratch.entries[1].curve else {
            unreachable!()
        };
        assert!(!same_clock(own, donor));
        assert!(same_span_clock(own, donor));
        assert!(f
            .scratch
            .finite_phase_suffix(
                0,
                f.hit,
                s.safe,
                s.end,
                &f.world.backend.bodies,
                &f.world.backend.colliders,
                &f.world.characters,
                f.geometry,
                &mut work(),
                false
            )
            .unwrap()
            .is_none());
        let mut budget = work();
        let proposal = s
            .call(&mut budget)
            .unwrap()
            .expect("C89 equal-span finite suffix");
        let price = budget.used;
        let Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            ..
        } = proposal.curve
        else {
            unreachable!()
        };
        assert!(same_clock(own, carrier));
        assert!(!same_clock(donor, carrier));
        assert!(same_pose(
            f.scratch.entries[0].curve.com_pose(s.safe),
            proposal.curve.com_pose(s.safe)
        ));
        assert_eq!(
            proposal.rate.to_array().map(f32::to_bits),
            f.geometry.to_array().map(f32::to_bits)
        );
        assert_eq!(
            curve_velocity(proposal.curve, s.hit)
                .unwrap()
                .0
                .to_array()
                .map(f32::to_bits),
            f.geometry.to_array().map(f32::to_bits)
        );
        assert!(f
            .scratch
            .proposal_rows_feasible_impl(Some((f.actor, proposal.rate)), Some(&mut work()))
            .unwrap());
        let bound = same_dt_correction(
            own,
            carrier,
            anchor.x,
            offset.x,
            linear_velocity.x,
            0,
            &mut work(),
        )
        .unwrap()
        .unwrap();
        assert!(bound < 0.01_f32 as f64);
        // The original independent envelopes count >skin of ordinary travel.
        assert!(
            correction(
                &com_bounds(f.scratch.entries[0].curve, s.safe, s.end, &mut work()).unwrap(),
                &com_bounds(proposal.curve, s.safe, s.end, &mut work()).unwrap(),
                0
            )
            .unwrap()
                > 0.01_f32 as f64
        );
        for time in [s.safe, s.hit, (s.hit + s.end) * 0.5, s.end] {
            let old = f.scratch.entries[0].curve.com_pose(time);
            let new = proposal.curve.com_pose(time);
            assert!(f64::from(new.translation.x - old.translation.x).abs() <= bound);
            for axis in [1, 2] {
                assert_eq!(
                    old.translation[axis].to_bits(),
                    new.translation[axis].to_bits()
                );
            }
        }
        for allowance in [price, price - 1] {
            let result = s.call(&mut Work {
                used: 29,
                limit: 29 + allowance,
            });
            if allowance == price {
                assert!(same_reference(
                    result.unwrap().unwrap().curve,
                    proposal.curve
                ));
            } else {
                assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
            }
        }
        assert_eq!(f.immutable_bytes(), before);
        assert_eq!(
            f.world.capture_snapshot().unwrap().encoded_bytes(),
            snapshot.encoded_bytes()
        );
        assert!(f.scratch.rows.is_empty() && f.scratch.row_impulses.is_empty());
    }
}

#[test]
fn finite_span_phase_declines_changed_maps_rows_and_excess_correction_without_retrying_errors() {
    for change in 0..4 {
        let mut s = recorded_span(false);
        match change {
            0 | 1 => {
                let Curve::Integrated(mut donor) = s.fixture.scratch.entries[1].curve else {
                    unreachable!()
                };
                if change == 0 {
                    donor.native.motion.end_time = donor.native.motion.end_time.next_up();
                } else {
                    donor.domain.end = donor.domain.end.next_up();
                }
                s.fixture.scratch.entries[1].curve = Curve::Integrated(donor);
            }
            2 => s.fixture.scratch.character_rows.push(actual_rows::Row {
                a: 0,
                b: None,
                normal: rp::Vector::new(1., 0., 0.),
                velocity: rp::Vector::new(10., 0., 0.),
            }),
            3 => s.fixture.world.backend.bodies[native_id(s.fixture.actor)]
                .set_locked_axes(rp::LockedAxes::TRANSLATION_LOCKED_X, false),
            _ => unreachable!(),
        }
        let before = s.fixture.immutable_bytes();
        assert!(
            s.call(&mut work()).unwrap().is_none(),
            "qualification {change}"
        );
        assert_eq!(s.fixture.immutable_bytes(), before);
    }
    let s = recorded_span(false);
    let Curve::Integrated(own) = s.fixture.scratch.entries[0].curve else {
        unreachable!()
    };
    let Curve::Integrated(donor) = s.fixture.scratch.entries[1].curve else {
        unreachable!()
    };
    let mut hybrid = own;
    hybrid.native.motion.start.translation.x = donor.native.motion.start.translation.x;
    hybrid.native.motion.end.translation.x = donor.native.motion.end.translation.x;
    hybrid.native.linear_velocity.x = donor.native.linear_velocity.x;
    assert!(
        same_dt_correction(
            own,
            hybrid,
            -donor.native.motion.start.translation.x,
            own.native.motion.start.translation.x + 0.1,
            0.,
            0,
            &mut work()
        )
        .unwrap()
        .unwrap()
            > 0.01_f32 as f64
    );
    let before = s.fixture.immutable_bytes();
    let mut empty = Work {
        used: 17,
        limit: 17,
    };
    assert!(matches!(
        s.call(&mut empty),
        Err(TrajectoryError::WorkLimit)
    ));
    assert_eq!(empty.used, 17);
    assert_eq!(s.fixture.immutable_bytes(), before);
}
