use super::*;
use crate::physics3d::{
    solver_trajectory::{CastHit, ShapeMotion},
    world::native_id,
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, PhysicsWorld3d, Pose, Shape, WorldConfig,
};

// Exact adjacent F64 values from the recorded first failing cast.
const SAFE: Time = Time::from_bits(0x3f76_faa5_7c2c_f3f4);
const HIT: Time = Time::from_bits(0x3f76_faa5_7c2c_f3f5);
const START: Time = 0.0056100867805071175;
const END: Time = 0.008333333767950535;
const H: f32 = 0.002723247;
const SKIN: f32 = 0.01;
const RECORDED_STEP: [f32; 3] = [1.5, 0.1, 0.];

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
    fixture_at(RECORDED_STEP, 1.0370698, 0.5, [SAFE, HIT])
}

fn clearance_control() -> Fixture {
    // A longer capsule keeps the lower cap near the stair while widening
    // the represented Y step at the actor origin. Both inverse-add cells
    // remain reachable at the original exact rate and integration duration.
    fixture_at(
        [1.5, f32::from_bits(0x3f10_1c6a), 0.],
        8.000004,
        7.,
        [
            Time::from_bits(0x3f76_faf4_7567_9fa2),
            Time::from_bits(0x3f76_faf4_7567_9fa3),
        ],
    )
}

fn fixture_at(
    step_position: [f32; 3],
    actor_y: f32,
    half_height: f32,
    [safe, hit]: [Time; 2],
) -> Fixture {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    let fixed = |world: &mut PhysicsWorld3d, position, half_extents| {
        world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    pose: Pose {
                        position,
                        ..Default::default()
                    },
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Box { half_extents }),
            )
            .unwrap()
    };
    fixed(&mut world, [0., -0.1, 0.], [20., 0.1, 20.]);
    let step = fixed(&mut world, step_position, [0.5, 0.1, 2.]);
    let actor = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [2.233418, actor_y, 1.1574957e-5],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height,
                radius: 0.4,
            }),
        )
        .unwrap();
    world
        .enable_character(actor, CharacterConfig::default())
        .unwrap();
    assert_eq!(actor.slot, 2);
    assert_eq!(actor.generation, 0);
    world.refresh_queries();
    let runtime = world.characters.get_mut(&actor).unwrap();
    runtime.free_velocity = [2., -1.4874552, 0.];
    runtime.free_translation = (rp::Vector::from(runtime.free_velocity) * H).to_array();
    let mut scratch = BackendMotionScratch::default();
    world.prepare_backend_motion(&mut scratch, H).unwrap();
    let native_actor = &world.backend.bodies[native_id(actor)];
    let original = Kernel::from_velocity(
        native_id(actor),
        Domain::new(START, END).unwrap(),
        native_actor
            .position()
            .prepend_translation(native_actor.local_center_of_mass()),
        rp::Vector::new(2.0479612, -1.4181963, 0.),
        rp::Vector::ZERO,
    )
    .unwrap();
    assert_eq!(original.native.integration_seconds.to_bits(), H.to_bits());
    let mut entry = super::super::super::momentum_tests::entry(native_id(actor), original);
    entry.domain_start = START;
    scratch.entries.push(entry);
    let geometry = curve_velocity(entry.curve, hit).unwrap().0;
    assert_eq!(geometry, rp::Vector::new(2.0479612, -1.4181963, 0.));
    scratch.participants.push(Participant {
        body: actor,
        pose: entry.curve.com_pose(hit),
        linear_velocity: geometry,
        angular_velocity: rp::Vector::ZERO,
        mass: MassPolicy::Native,
    });
    scratch.character_values.push((actor, geometry));
    let trajectory = |id: BodyId, curve| {
        let body = &world.backend.bodies[native_id(id)];
        let handle = body.colliders()[0];
        let collider = &world.backend.colliders[handle];
        ColliderTrajectory {
            collider: handle,
            parent: Some(native_id(id)),
            role: if id == actor {
                Role::Character(id)
            } else {
                Role::Fixed
            },
            motion: ShapeMotion {
                curve,
                local_center: body.local_center_of_mass(),
                local_pose: collider.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: collider.shape().compute_aabb(collider.position()),
            sensor: false,
        }
    };
    let fixed = trajectory(
        step,
        Curve::Constant {
            pose: world.backend.bodies[native_id(step)]
                .position()
                .prepend_translation(world.backend.bodies[native_id(step)].local_center_of_mass()),
            start_time: START,
            end_time: END,
        },
    );
    let actor_motion = trajectory(actor, entry.curve);
    let mut queried = None;
    let mut work = work();
    let mut manifold = rapier3d::parry::query::ContactManifold::<(), ()>::default();
    manifold.points.try_reserve(32).unwrap();
    crate::physics3d::solver_trajectory::contacts_full_shapes_with_manifold(
        fixed.motion,
        world.backend.colliders[fixed.collider].shape(),
        actor_motion.motion,
        world.backend.colliders[actor_motion.collider].shape(),
        hit,
        SKIN,
        &mut work,
        &mut Some(&mut manifold),
        &mut |contact, _, _, _| {
            queried = Some(contact);
            Ok(())
        },
    )
    .unwrap();
    let contact = queried.expect("original full Box/Capsule contact, not a synthetic plane");
    assert!(contact.dist < SKIN, "skin crossing: {contact:?}");
    if step_position == RECORDED_STEP {
        assert_eq!(
            contact.normal1.to_array().map(f32::to_bits),
            [0.5693123_f32, 0.8221213, 0.].map(f32::to_bits)
        );
    }
    assert!(coordinate_normal_axis(contact.normal1).is_none());
    scratch.character_rows.push(actual_rows::Row {
        a: 0,
        b: None,
        normal: contact.normal1,
        velocity: rp::Vector::ZERO,
    });
    assert!(
        geometry.dot(contact.normal1) >= 0.,
        "recorded already feasible geometry"
    );
    let hit = actual_scene::Hit {
        a: fixed,
        b: actor_motion,
        cast: CastHit {
            safe_time: safe,
            hit_time: hit,
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

fn propose(f: &Fixture, work: &mut Work) -> Result<Option<Proposal>, TrajectoryError> {
    f.scratch.representable_suffix(
        0,
        f.hit,
        f.hit.cast.safe_time,
        END,
        &f.world.backend.bodies,
        &f.world.backend.colliders,
        &f.world.characters,
        f.geometry,
        work,
        false,
    )
}

fn validate_clock(f: &Fixture, proposal: Proposal) {
    let safe = f.hit.cast.safe_time;
    let hit = f.hit.cast.hit_time;
    let old = f.scratch.entries[0];
    assert!(same_pose(
        proposal.curve.com_pose(safe),
        old.curve.com_pose(safe)
    ));
    assert_eq!(
        curve_velocity(proposal.curve, hit).unwrap(),
        (f.geometry, rp::Vector::ZERO)
    );
    assert_eq!(
        proposal.rate.to_array().map(f32::to_bits),
        f.geometry.to_array().map(f32::to_bits)
    );
    assert!(f
        .scratch
        .proposal_rows_feasible(Some((f.actor, proposal.rate)))
        .unwrap());
    assert!(old.support.is_none());
    let Curve::Integrated(original) = old.curve else {
        panic!("recorded source Native kernel")
    };
    let Curve::Anchored { carrier, .. } = proposal.curve else {
        panic!("geometry-only own clock")
    };
    assert_eq!(carrier.native.motion.body, old.value.handle);
    assert_eq!(
        postcard::to_allocvec(&carrier).unwrap(),
        postcard::to_allocvec(&original).unwrap()
    );
    assert!([hit, END, safe + (END - safe) * 0.5]
        .into_iter()
        .any(|at| !same_pose(old.curve.com_pose(at), proposal.curve.com_pose(at))));
}

fn hit_gaps(f: &Fixture, candidate: Curve) -> [f32; 2] {
    let mut work = work();
    let old_gap = gap(
        f.hit.b,
        f.scratch.entries[0].curve,
        f.hit.a,
        f.hit.a.motion.curve,
        &f.world.backend.colliders,
        f.hit.cast.hit_time,
        SKIN,
        &mut work,
    )
    .unwrap()
    .unwrap();
    let next_gap = gap(
        f.hit.b,
        candidate,
        f.hit.a,
        f.hit.a.motion.curve,
        &f.world.backend.colliders,
        f.hit.cast.hit_time,
        SKIN,
        &mut work,
    )
    .unwrap()
    .unwrap();
    [old_gap, next_gap]
}

fn assert_corner_is_inside_skin(f: &Fixture, candidate: Curve) {
    let fixed = f.world.backend.colliders[f.hit.a.collider].shape();
    let actor = f.world.backend.colliders[f.hit.b.collider].shape();
    let half = fixed.as_cuboid().unwrap().half_extents;
    let capsule = actor.as_capsule().unwrap();
    let cap_pose = ShapeMotion {
        curve: candidate,
        ..f.hit.b.motion
    }
    .pose(f.hit.cast.hit_time);
    let core = cap_pose * capsule.segment.a;
    let box_pose = f.hit.a.motion.pose(f.hit.cast.hit_time);
    assert_eq!(box_pose.rotation, rp::Rotation::IDENTITY);
    let corner = rp::Vector::new(half.x, half.y, core.z - box_pose.translation.z);
    assert!(corner.abs().cmple(half).all());
    let point = box_pose * corner;
    assert_eq!(core.z.to_bits(), point.z.to_bits());
    let distance_squared = (0..3).fold(0_f64, |sum, i| {
        let delta = (f64::from(core[i]) - f64::from(point[i])).abs().next_up();
        (sum + (delta * delta).next_up()).next_up()
    });
    let reach = (f64::from(capsule.radius) + f64::from(SKIN)).next_down();
    assert!(distance_squared < (reach * reach).next_down());
}

fn validate(f: &Fixture, proposal: Proposal) {
    validate_clock(f, proposal);
    let [old_gap, next_gap] = hit_gaps(f, proposal.curve);
    assert!(
        next_gap >= SKIN && next_gap > old_gap,
        "actual hit improvement: {old_gap:?} -> {next_gap:?}"
    );
}

#[test]
fn recorded_fixed_stair_corner_uses_own_clock_without_changing_exact_free_rate() {
    let f = clearance_control();
    let safe = f.hit.cast.safe_time;
    let hit = f.hit.cast.hit_time;
    assert!(matches!(f.hit.a.role, Role::Fixed));
    assert!(matches!(f.hit.a.motion.curve, Curve::Constant { .. }));
    assert_eq!(safe.next_up(), hit);
    assert_corner_is_inside_skin(&f, f.scratch.entries[0].curve);
    let before = f.world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let original = postcard::to_allocvec(&f.scratch.entries[0].curve).unwrap();
    let proposal = propose(&f, &mut work())
        .unwrap()
        .expect("own Native clock must supply an actual safe-fitting improving candidate");
    validate(&f, proposal);
    assert_eq!(
        postcard::to_allocvec(&f.scratch.entries[0].curve).unwrap(),
        original
    );
    assert_eq!(f.world.capture_snapshot().unwrap().encoded_bytes(), before);
    assert!(f.scratch.rows.is_empty() && f.scratch.row_impulses.is_empty());
    // An independent original full-shape cast checks the exact two-Time cell
    // bracket. The unchanged caller must still certify the complete remaining
    // future; this immediate screen does not stand in for that admission.
    let mut motion = f.hit.b.motion;
    motion.curve = proposal.curve;
    let fixed = &f.world.backend.colliders[f.hit.a.collider];
    let actor = &f.world.backend.colliders[f.hit.b.collider];
    let mut ledger = work();
    assert!(crate::physics3d::solver_trajectory::cast_full_shapes(
        f.hit.a.motion,
        fixed.shape(),
        motion,
        actor.shape(),
        safe,
        hit,
        SKIN,
        hit - safe,
        &mut ledger,
    )
    .unwrap()
    .is_none());
    crate::physics3d::solver_trajectory::admit_endpoint_pair(
        fixed.shape(),
        f.hit.a.motion.pose(safe),
        f.hit.a.motion.pose(END),
        actor.shape(),
        motion.pose(safe),
        motion.pose(END),
        0.,
        &mut ledger,
    )
    .unwrap();
}

#[test]
fn own_reference_is_a_frozen_value_not_live_anchor_or_physical_carry() {
    let mut f = clearance_control();
    let safe = f.hit.cast.safe_time;
    let hit = f.hit.cast.hit_time;
    let proposal = propose(&f, &mut work())
        .unwrap()
        .expect("recorded own clock candidate");
    validate(&f, proposal);
    let serialized = postcard::to_allocvec(&proposal.curve).unwrap();
    let restored: Curve = postcard::from_bytes(&serialized).unwrap();
    for at in [safe, hit, (safe + END) * 0.5, END] {
        assert!(same_pose(
            proposal.curve.com_pose(at),
            restored.com_pose(at)
        ));
    }
    f.scratch.entries[0].curve = proposal.curve;
    // This used to be an Integrated live entry. Keeping its own frozen clock
    // inside the Anchored value must neither follow that entry recursively nor
    // turn it into a grounded attachment at refresh or prefix attribution.
    f.scratch
        .refresh_anchors(safe, END, &f.world.backend.bodies, &mut work())
        .unwrap();
    assert_eq!(
        postcard::to_allocvec(&f.scratch.entries[0].curve).unwrap(),
        serialized
    );
    assert!(f.scratch.entries[0].support.is_none());
    let origin = &f.scratch.origins[0];
    assert!(origin.support.is_none());
    let old_carry = origin.carry;
    let old_anchored = origin.anchored;
    f.scratch.accepted.try_reserve(1).unwrap();
    f.scratch
        .stage_curve(
            f.scratch.entries[0],
            START,
            safe,
            &f.world.backend.bodies,
            &mut work(),
        )
        .unwrap();
    assert_eq!(f.scratch.origins[0].carry, old_carry);
    assert_eq!(f.scratch.origins[0].anchored, old_anchored);
    assert_eq!(old_carry, rp::Vector::ZERO);
    assert!(!old_anchored);
    assert!(f.scratch.rows.is_empty() && f.scratch.row_impulses.is_empty());
    // Reusing the frozen own clock needs no live Integrated donor at all.
    let own = kernel(
        f.scratch.entries[0],
        &f.world.characters,
        safe,
        END,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        postcard::to_allocvec(&own).unwrap(),
        postcard::to_allocvec(&match proposal.curve {
            Curve::Anchored { carrier, .. } => carrier,
            _ => unreachable!(),
        })
        .unwrap()
    );
}

#[test]
fn own_clock_declines_foreign_support_rotation_and_uncovered_logical_domains() {
    let f = fixture();
    let entry = f.scratch.entries[0];
    let Curve::Integrated(original) = entry.curve else {
        panic!("Native source")
    };
    assert!(kernel(entry, &f.world.characters, SAFE, END, &mut work())
        .unwrap()
        .is_some());
    let empty = BTreeMap::new();
    assert!(kernel(entry, &empty, SAFE, END, &mut work())
        .unwrap()
        .is_none());
    let mut attached = entry;
    attached.support = f.hit.a.parent;
    assert!(
        kernel(attached, &f.world.characters, SAFE, END, &mut work())
            .unwrap()
            .is_none()
    );
    let mut foreign = entry;
    let mut k = original;
    k.native.motion.body = native_id(BodyId {
        slot: 99,
        generation: 0,
    });
    foreign.curve = Curve::Integrated(k);
    assert!(kernel(foreign, &f.world.characters, SAFE, END, &mut work())
        .unwrap()
        .is_none());
    assert!(kernel(
        entry,
        &f.world.characters,
        START.next_down(),
        END,
        &mut work()
    )
    .unwrap()
    .is_none());
    assert!(
        kernel(entry, &f.world.characters, SAFE, END.next_up(), &mut work())
            .unwrap()
            .is_none()
    );
    let mut rotating = entry;
    rotating.curve = Curve::Integrated(
        Kernel::from_velocity(
            entry.value.handle,
            original.domain,
            original.native.motion.start,
            original.native.linear_velocity,
            rp::Vector::X,
        )
        .unwrap(),
    );
    assert!(
        kernel(rotating, &f.world.characters, SAFE, END, &mut work())
            .unwrap()
            .is_none()
    );
    let c = std::f32::consts::FRAC_1_SQRT_2;
    let q = rp::Rotation::from_xyzw(
        0.,
        0.,
        c.next_up().next_up().next_up(),
        c.next_up().next_up().next_up(),
    );
    let mut start = original.native.motion.start;
    start.rotation = q;
    let normalization = Kernel::from_velocity(
        entry.value.handle,
        original.domain,
        start,
        original.native.linear_velocity,
        rp::Vector::ZERO,
    )
    .unwrap();
    assert_ne!(
        normalization
            .native
            .motion
            .start
            .rotation
            .to_array()
            .map(f32::to_bits),
        normalization
            .native
            .motion
            .end
            .rotation
            .to_array()
            .map(f32::to_bits)
    );
    let mut normalized = entry;
    normalized.curve = Curve::Integrated(normalization);
    assert!(
        kernel(normalized, &f.world.characters, SAFE, END, &mut work())
            .unwrap()
            .is_none()
    );
    let mut bad = entry;
    let mut nonfinite = original;
    nonfinite.native.angular_velocity.x = f32::NAN;
    bad.curve = Curve::Integrated(nonfinite);
    assert!(matches!(
        kernel(bad, &f.world.characters, SAFE, END, &mut work()),
        Err(TrajectoryError::NonFinite)
    ));
    assert!(matches!(
        kernel(entry, &f.world.characters, Time::NAN, END, &mut work()),
        Err(TrajectoryError::InvalidTime)
    ));
}

#[test]
fn unchanged_future_wrappers_are_rejected_and_residual_neighbors_are_not_total_neighbors() {
    let mut f = fixture();
    let Curve::Integrated(k) = f.scratch.entries[0].curve else {
        panic!("Native source")
    };
    let k = Kernel::from_velocity(
        k.native.motion.body,
        k.domain,
        k.native.motion.start,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let mut old = f.scratch.entries[0];
    old.curve = Curve::Integrated(k);
    f.scratch.entries[0] = old;
    f.scratch.participants[0].linear_velocity = rp::Vector::ZERO;
    f.scratch.character_values[0].1 = rp::Vector::ZERO;
    assert!(
        f.scratch
            .reference_proposal(
                0,
                k,
                rp::Vector::ZERO,
                old.curve,
                rp::Vector::ZERO,
                SAFE,
                HIT,
                false,
                rp::Vector::ZERO,
                f.hit.cast.contact.normal1,
                &mut work(),
                &mut |_, _| Ok(true),
            )
            .unwrap()
            .is_none(),
        "equivalent wrapper is not progress evidence"
    );
    let base = -60_f32;
    let total = base.next_down();
    assert_ne!(total.to_bits(), base.to_bits());
    assert!(neighbors(base - base)
        .into_iter()
        .all(|residual| (base + residual).to_bits() == base.to_bits()));
    assert!(!neighbors(base - base)
        .into_iter()
        .any(|residual| (base + residual).to_bits() == total.to_bits()));
}

#[test]
fn own_clock_precharge_exact_one_below_and_proposal_work_preserve_source_bytes() {
    let f = clearance_control();
    let safe = f.hit.cast.safe_time;
    let entry = f.scratch.entries[0];
    let source = postcard::to_allocvec(&entry.curve).unwrap();
    let before = f.world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut measured = work();
    measured.used = 19;
    let k = kernel(entry, &f.world.characters, safe, END, &mut measured)
        .unwrap()
        .unwrap();
    let spent = measured.used;
    assert_eq!(spent, 19 + KERNEL_WORK + 1);
    let mut exact = Work {
        used: 19,
        limit: spent,
    };
    assert!(kernel(entry, &f.world.characters, safe, END, &mut exact)
        .unwrap()
        .is_some());
    let mut below = Work {
        used: 19,
        limit: spent - 1,
    };
    assert!(matches!(
        kernel(entry, &f.world.characters, safe, END, &mut below),
        Err(TrajectoryError::WorkLimit)
    ));
    assert_eq!(below.used, 19);
    let mut measured = work();
    measured.used = 19;
    let proposal = propose(&f, &mut measured)
        .unwrap()
        .expect("recorded own clock candidate");
    let spent = measured.used;
    validate(&f, proposal);
    let mut exact = Work {
        used: 19,
        limit: spent,
    };
    assert!(propose(&f, &mut exact).unwrap().is_some());
    let mut below = Work {
        used: 19,
        limit: spent - 1,
    };
    assert!(matches!(
        propose(&f, &mut below),
        Err(TrajectoryError::WorkLimit)
    ));
    assert_eq!(postcard::to_allocvec(&entry.curve).unwrap(), source);
    let Curve::Integrated(original) = entry.curve else {
        panic!("original Native kernel")
    };
    assert_eq!(
        postcard::to_allocvec(&k).unwrap(),
        postcard::to_allocvec(&original).unwrap()
    );
    assert_eq!(f.world.capture_snapshot().unwrap().encoded_bytes(), before);
    assert!(f.scratch.entries[0].support.is_none());
    assert!(f.scratch.rows.is_empty() && f.scratch.row_impulses.is_empty());
}

#[test]
fn own_clock_never_bypasses_another_exact_plane_or_mutates_physical_participants() {
    let mut f = clearance_control();
    assert!(propose(&f, &mut work()).unwrap().is_some());
    let before = f.scratch.participants[0];
    let initial_curve = postcard::to_allocvec(&f.scratch.entries[0].curve).unwrap();
    f.scratch.character_rows.push(actual_rows::Row {
        a: 0,
        b: None,
        normal: rp::Vector::X,
        velocity: rp::Vector::X * f.geometry.x.next_up(),
    });
    assert!(!f.scratch.proposal_rows_feasible(None).unwrap());
    assert!(propose(&f, &mut work()).unwrap().is_none());
    assert_eq!(
        f.scratch.participants[0].linear_velocity,
        before.linear_velocity
    );
    assert_eq!(
        f.scratch.participants[0].angular_velocity,
        before.angular_velocity
    );
    assert_eq!(
        postcard::to_allocvec(&f.scratch.entries[0].curve).unwrap(),
        initial_curve
    );
    assert!(f.scratch.entries[0].support.is_none());
}

#[test]
fn recorded_oblique_safe_inverse_has_an_improving_adjacent_offset_cell() {
    let f = fixture();
    let entry = f.scratch.entries[0];
    let carrier = kernel(entry, &f.world.characters, SAFE, END, &mut work())
        .unwrap()
        .unwrap();
    let old = entry.curve.com_pose(SAFE);
    let at = carrier.position_at_time(HIT);
    let anchor = at.rotation.conjugate() * (f.hit.cast.contact.point1 - at.translation);
    let base = carrier.position_at_time(SAFE);
    let relative = fit_relative(carrier.linear_velocity_at_time(), f.geometry).unwrap();
    let relative_dt =
        relative * (SAFE - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
    let base = base.translation + base.rotation * anchor;
    let initial = fit_offset(base, relative_dt, old.translation).unwrap();
    let build = |offset| Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity: relative,
        rotation: old.rotation,
    };
    assert!(coordinate_normal_axis(f.hit.cast.contact.normal1).is_none());
    assert!(
        same_pose(build(initial).com_pose(HIT), entry.curve.com_pose(HIT)),
        "the original first-fit offset cannot improve this recorded hit"
    );
    let candidates = offsets(base, relative_dt, old.translation, initial);
    assert_eq!(candidates.len, 28);
    for candidate in candidates.values.into_iter().flatten() {
        assert!(
            (0..3)
                .filter(|&axis| candidate[axis].to_bits() != initial[axis].to_bits())
                .count()
                <= 1,
            "this is a one-coordinate inverse search, never a Cartesian rate grid"
        );
        assert!(same_pose(build(candidate).com_pose(SAFE), old));
    }
    let improved = candidates
        .values
        .into_iter()
        .flatten()
        .find(|candidate| {
            candidate.y.to_bits() == initial.y.next_up().to_bits()
                && candidate.x.to_bits() == initial.x.to_bits()
                && candidate.z.to_bits() == initial.z.to_bits()
        })
        .expect("the original Y inverse has another safe-fitting adjacent cell");
    let candidate = build(improved);
    assert!(same_pose(candidate.com_pose(SAFE), old));
    assert_eq!(
        candidate.com_pose(HIT).translation.y.to_bits(),
        old.translation.y.to_bits()
    );
    assert_eq!(
        curve_velocity(candidate, HIT)
            .unwrap()
            .0
            .to_array()
            .map(f32::to_bits),
        f.geometry.to_array().map(f32::to_bits)
    );
    validate_clock(
        &f,
        Proposal {
            curve: candidate,
            rate: f.geometry,
        },
    );
    let [old_gap, improved_gap] = hit_gaps(&f, candidate);
    assert!(old_gap < improved_gap && improved_gap < SKIN);

    // This original stair corner and the real capsule radius prove that the
    // improved pose is still inside the skin. Measure the same represented
    // world points independently of the proposal's contact distance.
    assert_corner_is_inside_skin(&f, candidate);
    assert!(propose(&f, &mut work()).unwrap().is_none());
}
