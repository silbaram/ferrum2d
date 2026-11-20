//! Actual local response tests: contact witnesses are queried from the complete
//! stored shapes. No continuous interval is declared accepted by these tests.
use super::*;
use crate::physics3d::{
    world::native_id, BodyDesc, BodyKind, CharacterConfig, ColliderDesc, PhysicsWorld3d, Pose,
    Shape, WorldConfig,
};

pub(super) fn entry(handle: rp::RigidBodyHandle, curve: Kernel) -> Entry {
    Entry {
        slot: handle.into_raw_parts().0 as usize,
        value: SolverMotionBody {
            handle,
            end: curve.native.motion.end,
            linear_velocity: curve.native.linear_velocity,
            angular_velocity: curve.native.angular_velocity,
            keep_integrated_endpoint: false,
        },
        curve: Curve::Integrated(curve),
        domain_start: 0.,
        original: curve.native,
        support: None,
        velocity_delta: rp::Vector::ZERO,
        momentum_before: rp::Vector::ZERO,
        momentum_carry: rp::Vector::ZERO,
        carry_correction: rp::Vector::ZERO,
        geometry_delta: rp::Vector::ZERO,
        geometry_credit: rp::Vector::ZERO,
        response_geometry_delta: rp::Vector::ZERO,
        response_geometry_credit: rp::Vector::ZERO,
        blocked_moving: false,
        blocked_character: false,
        hit_ceiling: false,
        stopped_at: None,
    }
}

fn response(
    canonical: rp::Vector,
    geometric: rp::Vector,
    incoming: rp::Vector,
    axis: rp::Vector,
    floor: bool,
    carrier: Option<(rp::Vector, rp::Vector, rp::Vector)>,
) -> (PhysicsWorld3d, BackendMotionScratch, BodyId, BodyId) {
    response_with_mass(canonical, geometric, incoming, axis, floor, carrier, 10.)
}

fn prepared_response_with_mass(
    canonical: rp::Vector,
    geometric: rp::Vector,
    incoming: rp::Vector,
    axis: rp::Vector,
    floor: bool,
    carrier: Option<(rp::Vector, rp::Vector, rp::Vector)>,
    push_mass: f32,
) -> (PhysicsWorld3d, BackendMotionScratch, BodyId, BodyId) {
    prepared_response(
        canonical, geometric, incoming, axis, floor, carrier, push_mass, 0.,
    )
}

#[allow(clippy::too_many_arguments)]
fn prepared_response(
    canonical: rp::Vector,
    geometric: rp::Vector,
    incoming: rp::Vector,
    axis: rp::Vector,
    floor: bool,
    carrier: Option<(rp::Vector, rp::Vector, rp::Vector)>,
    push_mass: f32,
    peer_gap: f32,
) -> (PhysicsWorld3d, BackendMotionScratch, BodyId, BodyId) {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.01,
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
                push_mass,
                ..Default::default()
            },
        )
        .unwrap();
    let peer = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: Pose {
                    position: (-axis
                        * ((if axis == rp::Vector::Y { 0.75 } else { 0.5 }) + peer_gap))
                        .to_array(),
                    ..Default::default()
                },
                linear_velocity: incoming.to_array(),
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc {
                density: 0.,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.25 })
            },
        )
        .unwrap();
    world.backend.bodies[native_id(peer)].set_additional_mass(2., false);
    world.backend.bodies[native_id(peer)]
        .recompute_mass_properties_from_colliders(&world.backend.colliders);
    assert_eq!(world.backend.bodies[native_id(peer)].mass(), 2.);
    let ground = floor.then(|| {
        world
            .create_body(
                BodyDesc {
                    kind: if carrier.is_some() {
                        BodyKind::KinematicVelocity
                    } else {
                        BodyKind::Fixed
                    },
                    pose: Pose {
                        position: [0., -0.6, 0.],
                        ..Default::default()
                    },
                    linear_velocity: carrier.map_or([0.; 3], |(_, v, _)| v.to_array()),
                    angular_velocity: carrier.map_or([0.; 3], |(_, _, v)| v.to_array()),
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Box {
                    half_extents: [5., 0.1, 5.],
                }),
            )
            .unwrap()
    });
    world.refresh_queries();
    let seconds = world.config.step_seconds;
    let planned = carrier.map_or(rp::Vector::ZERO, |(v, _, _)| v);
    let runtime = world.characters.get_mut(&actor).unwrap();
    runtime.free_velocity = (canonical + planned).to_array();
    runtime.free_translation = ((geometric + planned) * seconds).to_array();
    runtime.free_carry_translation = (planned * seconds).to_array();
    let mut scratch = BackendMotionScratch::default();
    world.prepare_backend_motion(&mut scratch, seconds).unwrap();
    let domain = Domain::new(0., Time::from(seconds)).unwrap();
    for id in [
        Some(actor),
        Some(peer),
        ground.filter(|_| carrier.is_some()),
    ]
    .into_iter()
    .flatten()
    {
        let body = &world.backend.bodies[native_id(id)];
        let linear = if id == actor {
            geometric + planned
        } else {
            body.linvel()
        };
        let curve = Kernel::from_velocity(
            native_id(id),
            domain,
            body.position()
                .prepend_translation(body.local_center_of_mass()),
            linear,
            body.angvel(),
        )
        .unwrap();
        let mut value = entry(native_id(id), curve);
        if let Ok(i) = scratch.origins.binary_search_by_key(&id, |o| o.body) {
            value.geometry_credit = scratch.origins[i].geometry_credit;
        }
        scratch.entries.push(value);
    }
    if let Some(ground) = ground.filter(|_| carrier.is_some()) {
        scratch.origins[0].support = Some((ground, None));
        assert_eq!(scratch.origins[0].relative_plan, geometric);
        let mut work = Work {
            used: scratch.used,
            limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
        };
        scratch
            .anchor_characters(
                &world.characters,
                &world.backend.bodies,
                &world.backend.colliders,
                seconds,
                &mut work,
            )
            .unwrap();
        scratch.used = work.used;
    }
    let trajectory = |id: BodyId, scratch: &BackendMotionScratch| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        let curve = scratch.entry_index(Some(native_id(id))).map_or(
            Curve::Constant {
                pose: body
                    .position()
                    .prepend_translation(body.local_center_of_mass()),
                start_time: 0.,
                end_time: Time::from(seconds),
            },
            |i| scratch.entries[i].curve,
        );
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role: if id == actor {
                Role::Character(actor)
            } else if body.is_dynamic() {
                Role::Dynamic
            } else if body.is_fixed() {
                Role::Fixed
            } else {
                Role::Prescribed
            },
            motion: crate::physics3d::solver_trajectory::ShapeMotion {
                curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    for other in [ground, Some(peer)].into_iter().flatten() {
        let a = trajectory(actor, &scratch);
        let b = trajectory(other, &scratch);
        let ca = &world.backend.colliders[a.collider];
        let cb = &world.backend.colliders[b.collider];
        let mut manifold = rapier3d::parry::query::ContactManifold::<(), ()>::default();
        manifold.points.try_reserve(32).unwrap();
        let mut work = Work {
            used: scratch.used,
            limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
        };
        let before = scratch.contacts.len();
        crate::physics3d::solver_trajectory::contacts_full_shapes_with_manifold(
            a.motion,
            ca.shape(),
            b.motion,
            cb.shape(),
            0.,
            0.01,
            &mut work,
            &mut Some(&mut manifold),
            &mut |contact, _, _, _| {
                scratch
                    .contacts
                    .push(actual_scene::ContactSample { a, b, contact });
                Ok(())
            },
        )
        .unwrap();
        assert!(
            scratch.contacts.len() > before,
            "fixture's original full shapes are within the contact skin"
        );
        scratch.used = work.used;
    }
    (world, scratch, actor, peer)
}

fn response_with_mass(
    canonical: rp::Vector,
    geometric: rp::Vector,
    incoming: rp::Vector,
    axis: rp::Vector,
    floor: bool,
    carrier: Option<(rp::Vector, rp::Vector, rp::Vector)>,
    push_mass: f32,
) -> (PhysicsWorld3d, BackendMotionScratch, BodyId, BodyId) {
    respond(prepared_response_with_mass(
        canonical, geometric, incoming, axis, floor, carrier, push_mass,
    ))
}

fn response_with_peer_gap(
    canonical: rp::Vector,
    geometric: rp::Vector,
    incoming: rp::Vector,
    axis: rp::Vector,
    floor: bool,
    peer_gap: f32,
) -> (PhysicsWorld3d, BackendMotionScratch, BodyId, BodyId) {
    respond(prepared_response(
        canonical, geometric, incoming, axis, floor, None, 10., peer_gap,
    ))
}

fn respond(
    (world, mut scratch, actor, peer): (PhysicsWorld3d, BackendMotionScratch, BodyId, BodyId),
) -> (PhysicsWorld3d, BackendMotionScratch, BodyId, BodyId) {
    let seconds = world.config.step_seconds;
    let first = scratch.contacts[0];
    let hit = actual_scene::Hit {
        a: first.a,
        b: first.b,
        cast: crate::physics3d::solver_trajectory::CastHit {
            safe_time: 0.,
            hit_time: 0.,
            contact: first.contact,
            subshape_a: 0,
            subshape_b: 0,
        },
    };
    let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut work = Work {
        used: scratch.used,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    scratch
        .response_at(
            hit,
            0.,
            Time::from(seconds),
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            false,
            1.,
            &mut work,
            world.actual_motion_scratch_bound().unwrap(),
        )
        .unwrap();
    scratch.used = work.used;
    scratch.record_feedback(&mut work).unwrap();
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
    (world, scratch, actor, peer)
}

fn velocity(s: &BackendMotionScratch, id: BodyId) -> rp::Vector {
    s.participants
        .iter()
        .find(|p| p.body == id)
        .unwrap()
        .linear_velocity
}
fn feedback(s: &BackendMotionScratch, id: BodyId) -> rp::Vector {
    s.origins
        .iter()
        .find(|o| o.body == id)
        .unwrap()
        .velocity_delta
}
#[track_caller]
fn near(actual: rp::Vector, expected: rp::Vector) {
    assert!(
        (actual - expected).length() < 1e-5,
        "{actual:?} != {expected:?}"
    );
}

#[test]
fn mixed_floor_and_incoming_normal_keep_finite_momentum_and_geometry_separate() {
    for geometric in [-rp::Vector::Y * 0.125, -rp::Vector::X * 0.125] {
        let (_, s, actor, peer) = response(
            rp::Vector::ZERO,
            geometric,
            rp::Vector::X * 3.,
            rp::Vector::X,
            true,
            None,
        );
        near(velocity(&s, actor), rp::Vector::X * 0.5);
        near(velocity(&s, peer), rp::Vector::X * 0.5);
        near(
            velocity(&s, actor) * 10. + velocity(&s, peer) * 2.,
            rp::Vector::X * 6.,
        );
        near(feedback(&s, actor), rp::Vector::X * 0.5);
        let curve = s.entries[s.entry_index(Some(native_id(actor))).unwrap()].curve;
        near(curve_velocity(curve, 0.).unwrap().0, rp::Vector::X * 0.5);
    }
}

#[test]
fn true_finite_upward_impulse_and_unrelated_tangent_are_preserved() {
    let (_, s, actor, peer) = response(
        rp::Vector::ZERO,
        -rp::Vector::Y * 0.125,
        rp::Vector::Y * 3.,
        rp::Vector::Y,
        false,
        None,
    );
    near(velocity(&s, actor), rp::Vector::Y * 0.5);
    near(
        velocity(&s, actor) * 10. + velocity(&s, peer) * 2.,
        rp::Vector::Y * 6.,
    );
    near(feedback(&s, actor), rp::Vector::Y * 0.5);
    let tangent = rp::Vector::Z * 2.;
    let (_, s, actor, peer) = response(
        tangent,
        tangent - rp::Vector::Y * 0.125,
        rp::Vector::X * 3.,
        rp::Vector::X,
        true,
        None,
    );
    near(velocity(&s, actor), rp::Vector::X * 0.5 + tangent);
    near(velocity(&s, peer), rp::Vector::X * 0.5);
    near(feedback(&s, actor), rp::Vector::X * 0.5);
}

#[test]
fn actual_carrier_point_rate_replaces_planned_average_without_becoming_impulse() {
    for angular in [rp::Vector::ZERO, rp::Vector::Z * 0.7] {
        let carrier = Some((rp::Vector::X * 0.6, rp::Vector::X * 1.2, angular));
        let (_, s, actor, peer) = response(
            rp::Vector::ZERO,
            rp::Vector::ZERO,
            rp::Vector::X * 3.,
            rp::Vector::X,
            true,
            carrier,
        );
        let carry = rp::Vector::X * 1.2 + angular.cross(rp::Vector::Y * 0.6);
        let expected = (carry * 10. + rp::Vector::X * 6.) / 12.;
        near(velocity(&s, actor), expected);
        near(velocity(&s, peer), expected);
        near(feedback(&s, actor), expected - carry);
        near(
            velocity(&s, actor) * 10. + velocity(&s, peer) * 2.,
            carry * 10. + rp::Vector::X * 6.,
        );
    }
}

#[test]
fn only_actual_physical_j_is_published_for_the_committed_local_response() {
    let (world, mut scratch, actor, peer) = response(
        rp::Vector::ZERO,
        -rp::Vector::Y * 0.125,
        rp::Vector::X * 3.,
        rp::Vector::X,
        true,
        None,
    );
    let mut work = Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    let end = Time::from(world.config.step_seconds);
    scratch.impulses.seal(end, &mut work, usize::MAX).unwrap();
    scratch
        .impulses
        .publish_committed(end, &world.events)
        .unwrap();
    let mut out = Vec::new();
    let diagnostics = world.contact_impulses(&mut out);
    assert_eq!(diagnostics.solved_contacts, 1);
    assert_eq!(diagnostics.dropped, 0);
    assert_eq!(out.len(), 1);
    assert!(out[0].first.body == actor || out[0].second.body == actor);
    assert!(out[0].first.body == peer || out[0].second.body == peer);
    assert!((out[0].normal_impulse - 5.).abs() < 1e-5);
    assert_eq!(out[0].tangent_impulse, [0.; 3]);
    assert!((out[0].approach_speed - 3.).abs() < 1e-5);

    let (world, mut scratch, _, _) = response(
        rp::Vector::ZERO,
        -rp::Vector::Y * 0.125,
        rp::Vector::ZERO,
        rp::Vector::X,
        true,
        None,
    );
    scratch.impulses.seal(end, &mut work, usize::MAX).unwrap();
    scratch
        .impulses
        .publish_committed(end, &world.events)
        .unwrap();
    assert_eq!(world.contact_impulses(&mut out).solved_contacts, 0);
    assert!(
        out.is_empty(),
        "geometric floor correction supplies no physical impulse"
    );

    let (world, mut scratch, _, _) = response(
        rp::Vector::ZERO,
        -rp::Vector::Y * 0.125,
        rp::Vector::X * 3.,
        rp::Vector::X,
        true,
        None,
    );
    scratch.impulses.seal(end, &mut work, usize::MAX).unwrap();
    scratch
        .impulses
        .publish_committed(0., &world.events)
        .unwrap();
    assert_eq!(world.contact_impulses(&mut out).solved_contacts, 0);
    assert!(out.is_empty(), "uncommitted local response is discarded");
}

#[test]
fn zero_mass_geometric_response_never_becomes_external_or_contact_momentum() {
    let (mut world, mut scratch, actor, _) = response_with_mass(
        rp::Vector::ZERO,
        -rp::Vector::Y * 0.125,
        rp::Vector::ZERO,
        rp::Vector::X,
        true,
        None,
        0.,
    );
    assert_eq!(feedback(&scratch, actor), rp::Vector::ZERO);
    scratch
        .finish_feedback(&world.characters, &world.backend.bodies)
        .unwrap();
    world
        .publish_backend_motion_feedback(&scratch.feedback, world.config.step_seconds)
        .unwrap();
    assert_eq!(world.characters[&actor].external_velocity, [0.; 3]);
    assert_eq!(world.characters[&actor].contact_velocity, [0.; 3]);
}

fn response_suffix_hit(
    world: &PhysicsWorld3d,
    scratch: &mut BackendMotionScratch,
    work: &mut Work,
) -> Option<actual_scene::Hit> {
    let end = Time::from(world.config.step_seconds);
    scratch.trajectories.clear();
    scratch
        .trajectories
        .extend(scratch.entries.iter().map(|entry| BodyTrajectory {
            body: entry.value.handle,
            curve: entry.curve,
        }));
    let max_scratch = world.actual_motion_scratch_bound().unwrap();
    scratch
        .scene
        .prepare(
            &world.backend.bodies,
            &world.backend.colliders,
            &scratch.trajectories,
            &world.characters,
            0.,
            end,
            max_scratch,
            work,
        )
        .unwrap();
    let max_clearance = world
        .characters
        .values()
        .map(|r| r.config.skin_width)
        .fold(0., f32::max);
    scratch
        .scene
        .first_hit_policy(
            &world.backend.colliders,
            &world.contact_policies,
            0.,
            end,
            max_clearance,
            Time::from((world.config.step_seconds * 1e-6).max(f32::MIN_POSITIVE)),
            work,
            &|a, b| scratch.eligible(a, b, &world.backend.bodies, true),
            &|a, b| effective_pair_clearance(&world.characters, &scratch.origins, a, b),
        )
        .unwrap()
}

/// Certify the remaining full-shape suffix with the production actual-scene
/// consumer before appending any AcceptedCurve.
fn accepted_suffix_end(
    world: &PhysicsWorld3d,
    scratch: &mut BackendMotionScratch,
    actor: BodyId,
) -> rp::Pose {
    let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let end = Time::from(world.config.step_seconds);
    let mut work = Work {
        used: scratch.used,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    let hit = response_suffix_hit(world, scratch, &mut work);
    assert!(
        hit.is_none(),
        "response suffix requires a full original-shape certificate: {hit:?}"
    );
    scratch
        .append_prefix(end, &world.backend.bodies, &mut work)
        .unwrap();
    scratch.used = work.used;
    let accepted = scratch
        .accepted
        .iter()
        .find(|a| a.body == native_id(actor))
        .unwrap();
    assert_eq!(accepted.start_time, 0.);
    assert_eq!(accepted.end_time, end);
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
    accepted.curve.com_pose(end)
}

// Start inside the contact skin for the accepted path control. The exact
// tangent fixture also runs because its original F32 translations can overlap
// despite equal response rates along the contact normal.
const RESPONSE_GAP: f32 = 1. / 128.;

fn check_response_suffix(
    world: &PhysicsWorld3d,
    scratch: &mut BackendMotionScratch,
    actor: BodyId,
    peer: BodyId,
    peer_gap: f32,
    expected: rp::Vector,
) {
    if peer_gap > 0. {
        near(
            accepted_suffix_end(world, scratch, actor).translation,
            expected,
        );
        return;
    }
    let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut work = Work {
        used: scratch.used,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    let hit = response_suffix_hit(world, scratch, &mut work)
        .expect("rounded motion of the original touching shapes overlaps");
    assert!(hit.cast.safe_time < hit.cast.hit_time);
    let (capsule, ball) = if hit.a.parent == Some(native_id(actor)) {
        (hit.a, hit.b)
    } else {
        (hit.b, hit.a)
    };
    assert_eq!(capsule.parent, Some(native_id(actor)));
    assert_eq!(ball.parent, Some(native_id(peer)));
    let at = hit.cast.hit_time;
    let pose = capsule.motion.pose(at);
    assert_eq!(pose.rotation, rp::Rotation::IDENTITY);
    let center = ball.motion.pose(at).translation;
    let capsule = world.backend.colliders[capsule.collider]
        .shape()
        .as_capsule()
        .unwrap();
    let ball = world.backend.colliders[ball.collider]
        .shape()
        .as_ball()
        .unwrap();
    let local_y = (center.y - pose.translation.y).clamp(capsule.segment.a.y, capsule.segment.b.y);
    let core = pose.transform_point(rp::Vector::Y * local_y);
    let distance2 =
        core.to_array()
            .into_iter()
            .zip(center.to_array())
            .fold(0_f64, |sum, (a, b)| {
                let delta = (f64::from(a) - f64::from(b)).abs().next_up();
                (sum + (delta * delta).next_up()).next_up()
            });
    let radius = f64::from(capsule.radius) + f64::from(ball.radius);
    assert!(distance2 < (radius * radius).next_down());
    assert!(scratch.accepted.is_empty());
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
}

#[test]
fn dynamic_support_gravity_credit_does_not_become_upward_accepted_geometry() {
    // Canonical gravity/load is still present for the finite solve. The KCC
    // geometric plan has already consumed its blocked downward displacement.
    let (world, mut scratch, actor, peer) = response(
        -rp::Vector::Y * 0.125,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::Y,
        false,
        None,
    );
    let expected = -rp::Vector::Y * (1.25 / 12.);
    near(velocity(&scratch, actor), expected);
    near(velocity(&scratch, peer), expected);
    near(
        velocity(&scratch, actor) * 10. + velocity(&scratch, peer) * 2.,
        -rp::Vector::Y * 1.25,
    );
    assert!(
        feedback(&scratch, actor).y > 0.,
        "actual finite load reaction remains physical"
    );
    let endpoint = accepted_suffix_end(&world, &mut scratch, actor);
    assert_eq!(
        endpoint.translation.y, 0.,
        "gravity credit is not a new upward path"
    );
}

#[test]
fn true_incoming_response_moves_the_certified_remaining_path_without_changing_tangent_intent() {
    for gap in [0., RESPONSE_GAP] {
        let (world, mut scratch, actor, peer) = response_with_peer_gap(
            rp::Vector::ZERO,
            -rp::Vector::Y * 0.125,
            rp::Vector::Y * 3.,
            rp::Vector::Y,
            false,
            gap,
        );
        near(velocity(&scratch, actor), rp::Vector::Y * 0.5);
        near(velocity(&scratch, peer), rp::Vector::Y * 0.5);
        check_response_suffix(
            &world,
            &mut scratch,
            actor,
            peer,
            gap,
            rp::Vector::Y * (0.5 * world.config.step_seconds),
        );

        let (world, mut scratch, actor, peer) = response_with_peer_gap(
            rp::Vector::Z * 2.,
            rp::Vector::Z - rp::Vector::Y * 0.125,
            rp::Vector::X * 3.,
            rp::Vector::X,
            true,
            gap,
        );
        near(
            velocity(&scratch, actor),
            rp::Vector::X * 0.5 + rp::Vector::Z * 2.,
        );
        near(velocity(&scratch, peer), rp::Vector::X * 0.5);
        near(feedback(&scratch, actor), rp::Vector::X * 0.5);
        check_response_suffix(
            &world,
            &mut scratch,
            actor,
            peer,
            gap,
            (rp::Vector::X * 0.5 + rp::Vector::Z) * world.config.step_seconds,
        );
    }
}

#[test]
fn finite_surface_response_keeps_the_actual_support_curve_and_momentum_separate() {
    let (world, scratch, actor, peer) = response(
        rp::Vector::ZERO,
        -rp::Vector::Y * 0.125,
        rp::Vector::X * 3.,
        rp::Vector::X,
        true,
        Some((rp::Vector::X * 0.6, rp::Vector::X * 1.2, rp::Vector::ZERO)),
    );
    let entry = &scratch.entries[scratch.entry_index(Some(native_id(actor))).unwrap()];
    let support = entry
        .support
        .expect("same actual walkable support contact remains");
    let Curve::Anchored {
        carrier,
        linear_velocity,
        ..
    } = entry.curve
    else {
        panic!("a normal geometry projection must not erase the support kernel");
    };
    assert_eq!(carrier.native.motion.body, support);
    assert_eq!(entry.curve.com_pose(0.).translation, rp::Vector::ZERO);
    near(velocity(&scratch, actor), rp::Vector::X * 1.5);
    near(velocity(&scratch, peer), rp::Vector::X * 1.5);
    near(feedback(&scratch, actor), rp::Vector::X * 0.3);
    near(linear_velocity, rp::Vector::X * 0.3);
    near(
        entry
            .curve
            .com_pose(Time::from(world.config.step_seconds))
            .translation,
        rp::Vector::X * (1.5 * world.config.step_seconds),
    );
    assert_eq!(scratch.origins[0].support.unwrap().0, identity(support));
}

#[test]
fn retained_support_requires_live_walkable_contact_and_nonseparating_motion() {
    let (mut world, mut scratch, actor, _) = response(
        rp::Vector::ZERO,
        -rp::Vector::Y * 0.125,
        rp::Vector::X * 3.,
        rp::Vector::X,
        true,
        Some((rp::Vector::ZERO, rp::Vector::ZERO, rp::Vector::ZERO)),
    );
    let index = scratch.entry_index(Some(native_id(actor))).unwrap();
    let mut work = Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    assert!(scratch
        .retained_support_suffix(
            index,
            0.,
            0.,
            &world.backend.bodies,
            &world.characters,
            &mut work
        )
        .unwrap()
        .is_some());
    world
        .characters
        .get_mut(&actor)
        .unwrap()
        .state
        .vertical_speed = 1.;
    assert!(scratch
        .retained_support_suffix(
            index,
            0.,
            0.,
            &world.backend.bodies,
            &world.characters,
            &mut work
        )
        .unwrap()
        .is_none());
    world
        .characters
        .get_mut(&actor)
        .unwrap()
        .state
        .vertical_speed = 0.;
    let physical = scratch.participants[index].linear_velocity;
    scratch.participants[index].linear_velocity += rp::Vector::Y;
    assert!(
        scratch
            .retained_support_suffix(
                index,
                0.,
                0.,
                &world.backend.bodies,
                &world.characters,
                &mut work
            )
            .unwrap()
            .is_none(),
        "a real upward impulse separates the rider; it must not become carry"
    );
    scratch.participants[index].linear_velocity = physical;
    let support = scratch.entries[index].support.unwrap();
    for contact in scratch
        .contacts
        .iter_mut()
        .filter(|sample| sample.a.parent == Some(support) || sample.b.parent == Some(support))
    {
        contact.contact.normal1 = rp::Vector::X;
    }
    assert!(scratch
        .retained_support_suffix(
            index,
            0.,
            0.,
            &world.backend.bodies,
            &world.characters,
            &mut work
        )
        .unwrap()
        .is_none());
    scratch.contacts.clear();
    assert!(scratch
        .retained_support_suffix(
            index,
            0.,
            0.,
            &world.backend.bodies,
            &world.characters,
            &mut work
        )
        .unwrap()
        .is_none());
}

#[test]
fn nonzero_time_reattachment_keeps_original_carrier_clock_and_tangent_momentum() {
    let (world, mut scratch, actor, _) = response(
        rp::Vector::ZERO,
        -rp::Vector::Y * 0.125,
        rp::Vector::X * 3.,
        rp::Vector::X,
        true,
        Some((rp::Vector::X * 0.6, rp::Vector::X * 1.2, rp::Vector::ZERO)),
    );
    let index = scratch.entry_index(Some(native_id(actor))).unwrap();
    let support = scratch.entries[index].support.unwrap();
    let carrier_index = scratch.entry_index(Some(support)).unwrap();
    let Curve::Anchored {
        carrier: original,
        linear_velocity,
        anchor,
        ..
    } = scratch.entries[index].curve
    else {
        panic!("ground attachment");
    };
    assert!(linear_velocity.x > 0.);
    let end = Time::from(world.config.step_seconds);
    let time = end / 4.;
    let before = scratch.entries[index].curve.com_pose(time);
    let momentum = velocity(&scratch, actor);
    let delta = feedback(&scratch, actor);
    let replacement = Kernel::from_velocity(
        support,
        original.domain,
        original.native.motion.start,
        original.native.linear_velocity + rp::Vector::Z * 0.4,
        original.native.angular_velocity,
    )
    .unwrap();
    assert_eq!(replacement.domain.start, 0.);
    assert_eq!(replacement.domain.end, end);
    assert_eq!(
        replacement.native.integration_seconds.to_bits(),
        original.native.integration_seconds.to_bits()
    );
    scratch.entries[carrier_index].curve = Curve::Integrated(replacement);
    let mut work = Work {
        used: scratch.used,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    scratch
        .refresh_anchors(time, end, &world.backend.bodies, &mut work)
        .unwrap();
    let suffix = scratch.entries[index].curve;
    let Curve::Anchored {
        carrier,
        linear_velocity: relative,
        ..
    } = suffix
    else {
        panic!("ground attachment");
    };
    assert_eq!(carrier.domain.start, original.domain.start);
    assert_eq!(carrier.domain.end, original.domain.end);
    assert_eq!(relative, linear_velocity);
    near(suffix.com_pose(time).translation, before.translation);
    let from = replacement.position_at_time(time);
    let to = replacement.position_at_time(end);
    let expected = before.translation + (to.translation + to.rotation * anchor)
        - (from.translation + from.rotation * anchor)
        + relative * (end - time) as f32;
    near(suffix.com_pose(end).translation, expected);
    assert_eq!(velocity(&scratch, actor), momentum);
    assert_eq!(feedback(&scratch, actor), delta);
    assert_eq!(scratch.entries[index].domain_start, time);
    assert!(scratch
        .accepted
        .iter()
        .any(|path| path.body == native_id(actor)
            && path.start_time == 0.
            && path.end_time == time));
}

#[test]
fn geometric_carry_replaces_the_actual_carrier_rate_without_reapplying_physical_delta() {
    for angular in [rp::Vector::ZERO, rp::Vector::Z * 0.7] {
        let (world, mut scratch, actor, _) = response(
            rp::Vector::Z * 2.,
            rp::Vector::Z * 2.,
            rp::Vector::X * 3.,
            rp::Vector::X,
            true,
            Some((rp::Vector::X * 0.6, rp::Vector::X * 1.2, angular)),
        );
        let index = scratch.entry_index(Some(native_id(actor))).unwrap();
        let mut entry = scratch.entries[index];
        // response() already folded that completed context into origin. A new
        // context's local accepted delta starts empty, as in the producer.
        entry.geometry_delta = rp::Vector::ZERO;
        let support = entry.support.unwrap();
        let carrier = scratch.entry_index(Some(support)).unwrap();
        let physical = scratch.participants[carrier];
        let momentum = velocity(&scratch, actor);
        let delta = feedback(&scratch, actor);
        let Curve::Anchored {
            linear_velocity: relative,
            ..
        } = entry.curve
        else {
            panic!("supported curve");
        };
        let mut work = Work {
            used: 0,
            limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
        };
        let canonical = scratch.origins[0].relative_plan
            + scratch.origins[0].geometry_delta
            + entry.geometry_delta;
        let actual_carry = scratch
            .actual_carrier_rate(entry, 0., &world.backend.bodies, &mut work)
            .unwrap();
        near(
            scratch
                .geometry_after_carrier_response(
                    entry,
                    0.,
                    0.,
                    entry.curve.times().1,
                    &world.backend.bodies,
                    &mut work,
                )
                .unwrap(),
            canonical + actual_carry,
        );
        scratch.participants[carrier].linear_velocity = rp::Vector::ZERO;
        scratch.participants[carrier].angular_velocity = rp::Vector::ZERO;
        let geometry = scratch
            .geometry_after_carrier_response(
                entry,
                0.,
                0.,
                entry.curve.times().1,
                &world.backend.bodies,
                &mut work,
            )
            .unwrap();
        near(geometry, canonical);
        assert_eq!(geometry.z, 2.);
        assert!(relative.is_finite());
        assert_eq!(velocity(&scratch, actor), momentum);
        assert_eq!(feedback(&scratch, actor), delta);
        scratch.participants[carrier] = physical;
        let canonical = scratch.origins[0].relative_plan
            + scratch.origins[0].geometry_delta
            + entry.geometry_delta;
        let actual_carry = scratch
            .actual_carrier_rate(entry, 0., &world.backend.bodies, &mut work)
            .unwrap();
        near(
            scratch
                .geometry_after_carrier_response(
                    entry,
                    0.,
                    0.,
                    entry.curve.times().1,
                    &world.backend.bodies,
                    &mut work,
                )
                .unwrap(),
            canonical + actual_carry,
        );
    }
}

#[test]
fn dynamic_carrier_rate_change_after_wall_counter_carry_does_not_create_backpedal() {
    for relative in [0., -1.] {
        counter_carry_response(relative);
    }
}

fn counter_carry_response(relative: f32) {
    // Two actual local response plans in one controller interval, not a new
    // controller reset or a fabricated negative relative-velocity field.
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let support = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: Pose {
                    position: [0., -0.640625, 0.],
                    ..Default::default()
                },
                ccd: true,
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.125, 2.],
            }),
        )
        .unwrap();
    world
        .set_body_options(
            support,
            &crate::physics3d::BodyOptions {
                kind: BodyKind::Dynamic,
                ccd: true,
                lock_rotation: true,
                can_sleep: false,
                ..Default::default()
            },
        )
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
    let skin = 0.015625;
    world
        .enable_character(
            actor,
            CharacterConfig {
                skin_width: skin,
                push_mass: 0.,
                step_height: 0.,
                ..Default::default()
            },
        )
        .unwrap();
    let head = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0.390625, 0.25, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.125, 0.25, 1.],
            }),
        )
        .unwrap();
    let low = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2.625, -0.640625, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.125, 0.125, 3.],
            }),
        )
        .unwrap();
    world.step_checked().unwrap();
    assert!(world.character_state(actor).unwrap().grounded);
    world.set_velocity(support, [10., 0., 0.], [0.; 3]).unwrap();
    world.begin_fixed_step();
    world.capture_actual_interval_credit().unwrap();
    if relative != 0. {
        world
            .set_character_input(
                actor,
                crate::physics3d::CharacterInput {
                    velocity: [relative, 0., 0.],
                    ..Default::default()
                },
            )
            .unwrap();
    }
    world.step_characters();
    let runtime = &world.characters[&actor];
    assert_eq!(runtime.input_velocity(), [relative, 0., 0.]);
    // KCC move/snap has already resolved this geometric plan. Raw intent is
    // checked above; its small vertical geometry is not raw input momentum.
    let canonical_plan = (rp::Vector::from(runtime.free_translation)
        - rp::Vector::from(runtime.free_carry_translation))
        / world.config.step_seconds;
    assert_eq!(canonical_plan.x, relative);
    assert!(canonical_plan.is_finite());
    if relative == 0. {
        assert_eq!(canonical_plan, rp::Vector::ZERO);
    }
    let seconds = world.config.step_seconds;
    let end = Time::from(seconds);
    let mut scratch = BackendMotionScratch::default();
    let bound = world.prepare_backend_motion(&mut scratch, seconds).unwrap();
    assert_eq!(
        scratch
            .origins
            .iter()
            .find(|o| o.body == actor)
            .unwrap()
            .relative_plan,
        canonical_plan
    );

    for id in [support, actor] {
        let b = &world.backend.bodies[native_id(id)];
        let linear = if id == actor {
            rp::Vector::from(world.characters[&actor].free_translation) / seconds
        } else {
            b.linvel()
        };
        let kernel = Kernel::from_velocity(
            native_id(id),
            Domain::new(0., end).unwrap(),
            b.position().prepend_translation(b.local_center_of_mass()),
            linear,
            b.angvel(),
        )
        .unwrap();
        scratch.entries.push(entry(native_id(id), kernel));
    }
    let mut work = Work {
        used: scratch.used,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    scratch
        .anchor_characters(
            &world.characters,
            &world.backend.bodies,
            &world.backend.colliders,
            seconds,
            &mut work,
        )
        .unwrap();
    let saved = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    response_census(&world, &mut scratch, 0., end, skin, bound, &mut work);
    let first = census_hit(&scratch, actor, head, 0.);
    scratch
        .response_at(
            first,
            0.,
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
    let index = scratch.entry_index(Some(native_id(actor))).unwrap();
    let Curve::Anchored {
        linear_velocity, ..
    } = scratch.entries[index].curve
    else {
        panic!("real floor contact remains");
    };
    assert!(linear_velocity.x < -9.);
    near(
        curve_velocity(scratch.entries[index].curve, 0.).unwrap().0,
        rp::Vector::ZERO,
    );
    let at = end / 2.;
    response_census(&world, &mut scratch, at, end, skin, bound, &mut work);
    let second = census_hit(&scratch, support, low, at);
    scratch
        .response_at(
            second,
            at,
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
    let carrier = scratch.entry_index(Some(native_id(support))).unwrap();
    near(
        scratch.participants[carrier].linear_velocity,
        rp::Vector::ZERO,
    );
    let start = scratch.entries[index].curve.com_pose(at);
    let finish = scratch.entries[index].curve.com_pose(end);
    near(
        finish.translation - start.translation,
        rp::Vector::X * relative * (end - at) as f32,
    );
    near(
        curve_velocity(scratch.entries[index].curve, at).unwrap().0,
        rp::Vector::X * relative,
    );
    near(scratch.character_carry[0], rp::Vector::ZERO);
    assert_eq!(
        scratch
            .origins
            .iter()
            .find(|o| o.body == actor)
            .unwrap()
            .relative_plan,
        canonical_plan
    );
    assert_eq!(scratch.entries[index].velocity_delta, rp::Vector::ZERO);
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), saved);
}

fn response_census(
    world: &PhysicsWorld3d,
    scratch: &mut BackendMotionScratch,
    time: Time,
    end: Time,
    skin: f32,
    bound: usize,
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
            time,
            end,
            bound,
            work,
        )
        .unwrap();
    scratch.contacts.clear();
    let contacts = &mut scratch.contacts;
    scratch
        .scene
        .contacts_at(
            &world.backend.colliders,
            &world.contact_policies,
            time,
            skin,
            work,
            &|a, b| {
                matches!(a.role, Role::Character(_) | Role::Dynamic)
                    || matches!(b.role, Role::Character(_) | Role::Dynamic)
            },
            &mut |sample, _| {
                contacts.push(sample);
                Ok(())
            },
        )
        .unwrap();
}
fn census_hit(
    scratch: &BackendMotionScratch,
    a: BodyId,
    b: BodyId,
    time: Time,
) -> actual_scene::Hit {
    let sample = scratch
        .contacts
        .iter()
        .find(|s| {
            (s.a.parent == Some(native_id(a)) && s.b.parent == Some(native_id(b)))
                || (s.b.parent == Some(native_id(a)) && s.a.parent == Some(native_id(b)))
        })
        .expect("original full shapes touch at this response time");
    actual_scene::Hit {
        a: sample.a,
        b: sample.b,
        cast: crate::physics3d::solver_trajectory::CastHit {
            safe_time: time,
            hit_time: time,
            contact: sample.contact,
            subshape_a: 0,
            subshape_b: 0,
        },
    }
}

#[test]
fn carry_transferred_to_an_unsupported_peer_is_replanned_when_its_driver_stops() {
    let seconds = 0.1;
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: seconds,
        ..Default::default()
    })
    .unwrap();
    let support = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: Pose {
                    position: [0., -0.640625, 0.],
                    ..Default::default()
                },
                ccd: true,
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc {
                category: 4,
                mask: 1 | 8,
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [2., 0.125, 2.],
                })
            },
        )
        .unwrap();
    world
        .set_body_options(
            support,
            &crate::physics3d::BodyOptions {
                kind: BodyKind::Dynamic,
                ccd: true,
                lock_rotation: true,
                can_sleep: false,
                ..Default::default()
            },
        )
        .unwrap();
    let skin = 0.015625;
    let mut actors = Vec::new();
    for (x, category, mask) in [(0., 1, 2 | 4), (0.515625, 2, 1)] {
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
                ColliderDesc {
                    category,
                    mask,
                    ..ColliderDesc::new(Shape::Capsule {
                        half_height: 0.25,
                        radius: 0.25,
                    })
                },
            )
            .unwrap();
        world
            .enable_character(
                actor,
                CharacterConfig {
                    skin_width: skin,
                    push_mass: 0.,
                    step_height: 0.,
                    ..Default::default()
                },
            )
            .unwrap();
        actors.push(actor);
    }
    let wall = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2.625, -0.640625, 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc {
                category: 8,
                mask: 4,
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [0.125, 0.125, 3.],
                })
            },
        )
        .unwrap();
    world.step_checked().unwrap();
    assert!(world.character_state(actors[0]).unwrap().grounded);
    assert!(!world.character_state(actors[1]).unwrap().grounded);
    world.set_velocity(support, [10., 0., 0.], [0.; 3]).unwrap();
    world.begin_fixed_step();
    world.capture_actual_interval_credit().unwrap();
    world.step_characters();
    let end = Time::from(seconds);
    let mut scratch = BackendMotionScratch::default();
    let bound = world.prepare_backend_motion(&mut scratch, seconds).unwrap();
    for id in [support, actors[0], actors[1]] {
        let b = &world.backend.bodies[native_id(id)];
        let linear = world.characters.get(&id).map_or(b.linvel(), |r| {
            rp::Vector::from(r.free_translation) / seconds
        });
        let kernel = Kernel::from_velocity(
            native_id(id),
            Domain::new(0., end).unwrap(),
            b.position().prepend_translation(b.local_center_of_mass()),
            linear,
            b.angvel(),
        )
        .unwrap();
        scratch.entries.push(entry(native_id(id), kernel));
    }
    let mut work = Work {
        used: scratch.used,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    scratch
        .anchor_characters(
            &world.characters,
            &world.backend.bodies,
            &world.backend.colliders,
            seconds,
            &mut work,
        )
        .unwrap();
    let saved = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    response_census(&world, &mut scratch, 0., end, skin, bound, &mut work);
    let first = census_hit(&scratch, actors[0], actors[1], 0.);
    scratch
        .response_at(
            first,
            0.,
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
    for &id in &actors {
        let i = scratch.entry_index(Some(native_id(id))).unwrap();
        near(
            curve_velocity(scratch.entries[i].curve, 0.).unwrap().0,
            rp::Vector::X * 5.,
        );
    }
    near(scratch.character_carry[0], rp::Vector::X * 5.);
    near(scratch.character_carry[1], rp::Vector::X * 5.);
    assert!(
        scratch.entries[scratch.entry_index(Some(native_id(actors[1]))).unwrap()]
            .support
            .is_none()
    );
    let at = end / 2.;
    response_census(&world, &mut scratch, at, end, skin, bound, &mut work);
    let second = census_hit(&scratch, support, wall, at);
    scratch
        .response_at(
            second,
            at,
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
    for &id in &actors {
        let i = scratch.entry_index(Some(native_id(id))).unwrap();
        let e = scratch.entries[i];
        near(curve_velocity(e.curve, at).unwrap().0, rp::Vector::ZERO);
        near(
            e.curve.com_pose(end).translation,
            e.curve.com_pose(at).translation,
        );
        assert_eq!(e.velocity_delta, rp::Vector::ZERO);
    }
    assert_eq!(scratch.character_carry, [rp::Vector::ZERO; 2]);
    scratch
        .append_prefix(end, &world.backend.bodies, &mut work)
        .unwrap();
    for origin in &scratch.origins {
        near(origin.carry, rp::Vector::X * 0.25);
    }
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), saved);
}

#[test]
fn independent_physical_contact_rows_consume_geometry_credit_without_erasing_tangent_or_incoming_j()
{
    for tangent in [rp::Vector::ZERO, rp::Vector::Z * 2.] {
        for gap in [0., RESPONSE_GAP] {
            let (world, mut scratch, actor, peer) = response_with_peer_gap(
                tangent - rp::Vector::Y * 0.125,
                tangent,
                rp::Vector::X * 3.,
                rp::Vector::X,
                true,
                gap,
            );
            near(velocity(&scratch, actor), tangent + rp::Vector::X * 0.5);
            near(velocity(&scratch, peer), rp::Vector::X * 0.5);
            near(
                velocity(&scratch, actor) * 10. + velocity(&scratch, peer) * 2.,
                tangent * 10. + rp::Vector::X * 6.,
            );
            near(
                feedback(&scratch, actor),
                rp::Vector::X * 0.5 + rp::Vector::Y * 0.125,
            );
            let i = scratch.entry_index(Some(native_id(actor))).unwrap();
            near(scratch.entries[i].geometry_delta, rp::Vector::X * 0.5);
            near(scratch.entries[i].geometry_credit, rp::Vector::ZERO);
            check_response_suffix(
                &world,
                &mut scratch,
                actor,
                peer,
                gap,
                (tangent + rp::Vector::X * 0.5) * world.config.step_seconds,
            );
        }
    }
}

#[test]
fn a_real_upward_impact_beyond_consumed_gravity_keeps_its_remaining_accepted_path() {
    for gap in [0., RESPONSE_GAP] {
        let (world, mut scratch, actor, peer) = response_with_peer_gap(
            -rp::Vector::Y * 0.125,
            rp::Vector::ZERO,
            rp::Vector::Y * 3.,
            rp::Vector::Y,
            false,
            gap,
        );
        let expected = rp::Vector::Y * (4.75 / 12.);
        near(velocity(&scratch, actor), expected);
        near(velocity(&scratch, peer), expected);
        near(
            velocity(&scratch, actor) * 10. + velocity(&scratch, peer) * 2.,
            rp::Vector::Y * 4.75,
        );
        near(feedback(&scratch, actor), expected + rp::Vector::Y * 0.125);
        let i = scratch.entry_index(Some(native_id(actor))).unwrap();
        near(scratch.entries[i].geometry_delta, expected);
        near(scratch.entries[i].geometry_credit, rp::Vector::ZERO);
        check_response_suffix(
            &world,
            &mut scratch,
            actor,
            peer,
            gap,
            expected * world.config.step_seconds,
        );
    }
}

#[test]
fn row_credit_is_consumed_once_and_trial_geometry_is_rewound_with_a_pressure_retry() {
    let initial = rp::Vector::Y * 0.125;
    let (left, first) = settle_geometry_credit(initial, rp::Vector::Y * 0.1).unwrap();
    assert_eq!(first, rp::Vector::ZERO);
    let (left, second) = settle_geometry_credit(left, rp::Vector::Y * 0.1).unwrap();
    near(left, rp::Vector::ZERO);
    near(second, rp::Vector::Y * 0.075);
    let (world, mut scratch, actor, _) = response(
        -rp::Vector::Y * 0.125,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::Y,
        false,
        None,
    );
    let i = scratch.entry_index(Some(native_id(actor))).unwrap();
    let before = scratch.entries[i];
    let saved = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let (credit, effective) =
        settle_geometry_credit(before.geometry_credit, rp::Vector::Y * 0.1).unwrap();
    scratch.entries[i].response_geometry_credit = credit;
    scratch.entries[i].response_geometry_delta = effective;
    let mut work = Work {
        used: scratch.used,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    scratch
        .reset_stopped_plan(0., 1., &world.backend.bodies, &mut work)
        .unwrap();
    assert_eq!(scratch.entries[i].geometry_credit, before.geometry_credit);
    assert_eq!(scratch.entries[i].geometry_delta, before.geometry_delta);
    assert_eq!(
        scratch.entries[i].response_geometry_credit,
        before.geometry_credit
    );
    assert_eq!(scratch.entries[i].response_geometry_delta, rp::Vector::ZERO);
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), saved);
}

/// Observation of the first original dynamic-support rejection, not an Engine
/// tick success claim. Same source shapes/Kernel/Anchored tuple, queried at the
/// recorded safe/hit/end times; no pose repair, alternate curve or motion step.
#[test]
fn observed_support_suffix_keeps_original_kernel_and_separates_plane_rate_from_leaf_gaps() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let start = rp::Pose::from_translation(rp::Vector::new(0.14249997, -0.100000136, 0.));
    let finish = rp::Pose::from_translation(rp::Vector::new(0.18999995, -0.10000018, 0.));
    let platform = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: Pose {
                    position: start.translation.to_array(),
                    ..Default::default()
                },
                ccd: true,
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
                ..Default::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            }),
        )
        .unwrap();
    let domain = Domain::new(0.01424999674782157, 0.018999995663762093).unwrap();
    let native = SolverBodyIntegration {
        motion: rapier3d::pipeline::SolverBodyMotion {
            body: native_id(platform),
            start_time: 0.014249997,
            end_time: 0.018999996,
            start,
            end: finish,
        },
        integration_seconds: 0.004749999,
        linear_velocity: rp::Vector::new(10., -9.380261e-6, 0.),
        angular_velocity: rp::Vector::ZERO,
    };
    let carrier = Kernel::from_native(native, domain).unwrap();
    let anchor = rp::Vector::new(0.9999944, 0.09986183, 2.9802322e-6);
    let offset = rp::Vector::new(5.6028366e-6, 0.51013815, -2.9802322e-6);
    let rider = Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    world
        .set_pose(
            actor,
            Pose {
                position: rider.com_pose(domain.start).translation.to_array(),
                ..Default::default()
            },
        )
        .unwrap();
    let safe = 0.015441418681002492;
    let hit = 0.015441423207049092;
    let carrier_rate = curve_velocity(Curve::Integrated(carrier), hit).unwrap().0;
    let rider_rate = curve_velocity(rider, hit).unwrap().0;
    assert_eq!(rider_rate - carrier_rate, rp::Vector::ZERO);
    let platform_collider = world.backend.bodies[native_id(platform)].colliders()[0];
    let actor_collider = world.backend.bodies[native_id(actor)].colliders()[0];
    let a = &world.backend.colliders[platform_collider];
    let b = &world.backend.colliders[actor_collider];
    let motion = |curve, collider: &rp::Collider, body: &rp::RigidBody| {
        crate::physics3d::solver_trajectory::ShapeMotion {
            curve,
            local_center: body.local_center_of_mass(),
            local_pose: collider.position_wrt_parent().copied().unwrap_or_default(),
        }
    };
    let moving = motion(
        Curve::Integrated(carrier),
        a,
        &world.backend.bodies[native_id(platform)],
    );
    let carried = motion(rider, b, &world.backend.bodies[native_id(actor)]);
    let saved = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut work = Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    // This finite census radius is the original complete capsule bound. It is
    // measurement-only; the runtime skin remains .01 and no curve is approved.
    let census = b.shape().compute_local_bounding_sphere().radius;
    for (label, time) in [("safe", safe), ("hit", hit), ("end", domain.end)] {
        let mut gap = None::<f32>;
        crate::physics3d::solver_trajectory::contacts_full_shapes(moving,a.shape(),carried,b.shape(),time,census,&mut work,
            &mut |contact,_,_,_| {
                assert!(contact.dist.is_finite() && contact.normal1.is_finite() && contact.point1.is_finite() && contact.point2.is_finite());
                gap=Some(gap.map_or(contact.dist,|old|old.min(contact.dist)));
                eprintln!("C18_SUPPORT_TUPLE label={label} time={time:.18e} gap={:?} normal={:?} points={:?}/{:?} carrier_pose={:?} actor_pose={:?} anchor={anchor:?} offset={offset:?} kernel_domain={domain:?} native_h={:?}",contact.dist,contact.normal1,contact.point1,contact.point2,moving.pose(time),carried.pose(time),native.integration_seconds);
                Ok(())
            }).unwrap();
        assert!(
            gap.is_some(),
            "observed original full shapes have a finite closest feature at {label}"
        );
    }
    if let Curve::Anchored {
        carrier: retained, ..
    } = rider
    {
        assert_eq!(
            retained.domain.start.to_bits(),
            carrier.domain.start.to_bits()
        );
        assert_eq!(retained.domain.end.to_bits(), carrier.domain.end.to_bits());
        assert_eq!(
            retained.native.integration_seconds.to_bits(),
            native.integration_seconds.to_bits()
        );
        assert_eq!(retained.native.motion.start, native.motion.start);
        assert_eq!(retained.native.motion.end, native.motion.end);
    } else {
        unreachable!();
    }
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), saved);
}

/// The production selector derives its coordinate from the actual deficit and
/// rounding cells. The independent math fixture has a fixed recorded candidate;
/// this test deliberately supplies only the original path/contact to the code.
#[test]
fn representable_ground_phase_proposal_keeps_safe_bits_and_requires_full_shape_approval() {
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
                push_mass: 10.,
                ..Default::default()
            },
        )
        .unwrap();
    let domain = Domain::new(0.01424999674782157, 0.018999995663762093).unwrap();
    let native = SolverBodyIntegration {
        motion: rapier3d::pipeline::SolverBodyMotion {
            body: native_id(platform),
            start_time: 0.014249997,
            end_time: 0.018999996,
            start: rp::Pose::from_translation(rp::Vector::new(0.14249997, -0.100000136, 0.)),
            end: rp::Pose::from_translation(rp::Vector::new(0.18999995, -0.10000018, 0.)),
        },
        integration_seconds: 0.004749999,
        linear_velocity: rp::Vector::new(10., -9.380261e-6, 0.),
        angular_velocity: rp::Vector::ZERO,
    };
    let carrier = Kernel::from_native(native, domain).unwrap();
    let original = Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(0.9999944, 0.09986183, 2.9802322e-6),
        offset: rp::Vector::new(5.6028366e-6, 0.51013815, -2.9802322e-6),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let safe = 0.015441418681002492;
    let hit_time = 0.015441423207049092;
    // This recorded context owns a real support point independently of the
    // geometry phase. Use the actual producer to capture that original anchor.
    let Curve::Anchored {
        anchor: original_anchor,
        ..
    } = original
    else {
        unreachable!()
    };
    world.characters.get_mut(&actor).unwrap().support_motion = Some((
        platform,
        original_anchor + world.backend.bodies[native_id(platform)].local_center_of_mass(),
        rp::Vector::ZERO,
    ));
    world.refresh_queries();
    let mut scratch = BackendMotionScratch::default();
    world
        .prepare_backend_motion(&mut scratch, domain.duration() as f32)
        .unwrap();
    scratch.entries.push(entry(native_id(platform), carrier));
    let mut rider = entry(
        native_id(actor),
        Kernel::from_velocity(
            native_id(actor),
            domain,
            original.com_pose(domain.start),
            curve_velocity(original, hit_time).unwrap().0,
            rp::Vector::ZERO,
        )
        .unwrap(),
    );
    rider.curve = original;
    rider.support = Some(native_id(platform));
    rider.domain_start = domain.start;
    scratch.entries.push(rider);
    let motion = |id, curve| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role: if id == actor {
                Role::Character(actor)
            } else {
                Role::Dynamic
            },
            motion: crate::physics3d::solver_trajectory::ShapeMotion {
                curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let a = motion(platform, Curve::Integrated(carrier));
    let b = motion(actor, original);
    let mut work = Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    crate::physics3d::solver_trajectory::contacts_full_shapes(
        a.motion,
        world.backend.colliders[a.collider].shape(),
        b.motion,
        world.backend.colliders[b.collider].shape(),
        hit_time,
        0.5,
        &mut work,
        &mut |contact, _, _, _| {
            scratch
                .contacts
                .push(actual_scene::ContactSample { a, b, contact });
            Ok(())
        },
    )
    .unwrap();
    let contact = scratch.contacts[0].contact;
    assert!(contact.dist < world.characters[&actor].config.skin_width);
    let hit = actual_scene::Hit {
        a,
        b,
        cast: crate::physics3d::solver_trajectory::CastHit {
            safe_time: safe,
            hit_time,
            contact,
            subshape_a: 0,
            subshape_b: 0,
        },
    };
    for value in &scratch.entries {
        let id = identity(value.value.handle);
        scratch.participants.push(Participant {
            body: id,
            pose: value.curve.com_pose(hit_time),
            linear_velocity: curve_velocity(value.curve, hit_time).unwrap().0,
            angular_velocity: rp::Vector::ZERO,
            mass: if id == actor {
                MassPolicy::Character(10.)
            } else {
                MassPolicy::Native
            },
        });
    }
    let geometry = curve_velocity(original, hit_time).unwrap().0;
    scratch.character_values.push((actor, geometry));
    let saved = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut denied = Work { used: 0, limit: 1 };
    assert!(matches!(
        scratch.representable_suffix(
            1,
            hit,
            safe,
            domain.end,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            geometry,
            &mut denied,
            false
        ),
        Err(TrajectoryError::WorkLimit)
    ));
    let mut select = Work {
        used: 0,
        limit: work.limit,
    };
    let candidate = scratch
        .representable_suffix(
            1,
            hit,
            safe,
            domain.end,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            geometry,
            &mut select,
            false,
        )
        .unwrap()
        .expect("actual deficit has a representable phase proposal");
    let candidate = candidate.curve;
    let bits = |p: rp::Pose| {
        (
            p.translation.to_array().map(f32::to_bits),
            p.rotation.to_array().map(f32::to_bits),
        )
    };
    assert_eq!(
        bits(candidate.com_pose(safe)),
        bits(original.com_pose(safe))
    );
    assert_eq!(
        curve_velocity(candidate, hit_time).unwrap(),
        curve_velocity(original, hit_time).unwrap()
    );
    let Curve::Anchored {
        carrier: after,
        offset: after_offset,
        ..
    } = candidate
    else {
        panic!("existing Anchored representation");
    };
    let Curve::Anchored {
        offset: old_offset, ..
    } = original
    else {
        unreachable!();
    };
    assert_eq!(
        crate::checkpoint_codec::encode(&carrier).unwrap(),
        crate::checkpoint_codec::encode(&after).unwrap()
    );
    assert_eq!(after_offset, old_offset);
    let skin = world.characters[&actor].config.skin_width;
    let candidate_motion = crate::physics3d::solver_trajectory::ShapeMotion {
        curve: candidate,
        ..b.motion
    };
    let tolerance = f64::from((native.motion.end_time - native.motion.start_time) * 1e-6);
    assert!(crate::physics3d::solver_trajectory::cast_full_shapes(
        a.motion,
        world.backend.colliders[a.collider].shape(),
        candidate_motion,
        world.backend.colliders[b.collider].shape(),
        safe,
        domain.end,
        skin,
        tolerance,
        &mut work
    )
    .unwrap()
    .is_none());
    let mut exact = Work {
        used: 0,
        limit: select.used,
    };
    assert!(scratch
        .representable_suffix(
            1,
            hit,
            safe,
            domain.end,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            geometry,
            &mut exact,
            false
        )
        .unwrap()
        .is_some());
    let mut below = Work {
        used: 0,
        limit: select.used - 1,
    };
    assert!(matches!(
        scratch.representable_suffix(
            1,
            hit,
            safe,
            domain.end,
            &world.backend.bodies,
            &world.backend.colliders,
            &world.characters,
            geometry,
            &mut below,
            false
        ),
        Err(TrajectoryError::WorkLimit)
    ));
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), saved);
    assert_eq!(scratch.entries[1].support, Some(native_id(platform)));
    assert_eq!(scratch.entries[1].velocity_delta, rp::Vector::ZERO);
    assert!(scratch.accepted.is_empty()); // Candidate measurement never publishes a prefix.
}

#[test]
fn geometric_native_reference_preserves_finite_momentum_without_ground_or_extra_j() {
    let (world, mut scratch, actor, peer) = response(
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::X * 3.,
        rp::Vector::X,
        false,
        None,
    );
    let index = scratch.entry_index(Some(native_id(actor))).unwrap();
    assert!(
        matches!(scratch.entries[index].curve, Curve::Integrated(_)),
        "a physical change preserves the original ordinary rebase law"
    );
    assert_eq!(scratch.entries[index].support, None);
    assert_eq!(scratch.entries[index].momentum_carry, rp::Vector::ZERO);
    near(velocity(&scratch, actor), rp::Vector::X * 0.5);
    near(velocity(&scratch, peer), rp::Vector::X * 0.5);
    let origin = scratch
        .origins
        .binary_search_by_key(&actor, |o| o.body)
        .unwrap();
    assert_eq!(scratch.origins[origin].support, None);
    assert!(!scratch.origins[origin].anchored);
    assert_eq!(scratch.origins[origin].carry, rp::Vector::ZERO);
    // Model the accepted ledger boundary used by a new response. Real finite
    // momentum already lives in Origin; the old Entry delta is not added twice.
    scratch.entries[index].velocity_delta = rp::Vector::ZERO;
    scratch.entries[index].geometry_delta = rp::Vector::ZERO;
    let end = f64::from(world.config.step_seconds);
    let time = 0.;
    let mut work = Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    response_census(
        &world,
        &mut scratch,
        time,
        end,
        world.characters[&actor].config.skin_width,
        world.actual_motion_scratch_bound().unwrap(),
        &mut work,
    );
    let hit = census_hit(&scratch, actor, peer, time);
    let result = scratch.response_at(
        hit,
        time,
        end,
        &world.backend.bodies,
        &world.backend.colliders,
        &world.characters,
        false,
        1.,
        &mut work,
        world.actual_motion_scratch_bound().unwrap(),
    );
    result.expect("an unchanged co-moving suffix has an exact translation reference");
    let Curve::Anchored {
        carrier, anchor, ..
    } = scratch.entries[index].curve
    else {
        panic!("unchanged suffix reference");
    };
    assert_eq!(carrier.native.motion.body, native_id(peer));
    assert_eq!(anchor, rp::Vector::ZERO);
    // The next contact consumes this frame but cannot infer an extra .5 of
    // physical carry. An identical suffix is an intentional negative here.
    let result = scratch.response_at(
        hit,
        time,
        end,
        &world.backend.bodies,
        &world.backend.colliders,
        &world.characters,
        false,
        1.,
        &mut work,
        world.actual_motion_scratch_bound().unwrap(),
    );
    assert_eq!(result, Err(TrajectoryError::Unresolved));
    near(
        scratch.participants[index].linear_velocity,
        rp::Vector::X * 0.5,
    );
    assert_eq!(scratch.entries[index].momentum_carry, rp::Vector::ZERO);
    assert!(scratch.row_impulses.iter().all(|&j| j == 0.));
}

/// Actual C19 carrier kernel and positive physical/geometry normal-rate gap.
/// This checks the support-lifetime decision and its local carry accounting;
/// the original checked rotating-support world fixture supplies the full-tick
/// continuous/endpoint execution test in the same common batch.
#[test]
fn tiny_physical_normal_rate_retains_real_rotating_support_but_upward_and_jump_detach() {
    let (mut world, mut scratch, actor, _) = response(
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::X * 3.,
        rp::Vector::X,
        true,
        Some((rp::Vector::ZERO, rp::Vector::ZERO, rp::Vector::Y * 2.)),
    );
    let index = scratch.entry_index(Some(native_id(actor))).unwrap();
    let support = scratch.entries[index]
        .support
        .expect("real ground attachment");
    let carrier_index = scratch.entry_index(Some(support)).unwrap();
    world
        .set_body_options(
            identity(support),
            &crate::physics3d::BodyOptions {
                kind: BodyKind::Dynamic,
                can_sleep: false,
                ..Default::default()
            },
        )
        .unwrap();
    let domain = Domain::new(0., f64::from(0.025_f32)).unwrap();
    let native = SolverBodyIntegration {
        motion: rapier3d::pipeline::SolverBodyMotion {
            body: support,
            start_time: 0.,
            end_time: 0.025,
            start: rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
            end: rp::Pose::from_parts(
                rp::Vector::new(0., -0.1, 0.),
                rp::Rotation::from_xyzw(-3.436501e-12, 0.024992192, -6.907454e-11, 0.9996877),
            ),
        },
        integration_seconds: 0.025,
        linear_velocity: rp::Vector::new(0., -7.3886794e-9, 0.),
        angular_velocity: rp::Vector::new(-2.7500596e-10, 2., -5.5276894e-9),
    };
    let carrier = Kernel::from_native(native, domain).unwrap();
    let anchored = Curve::Anchored {
        carrier,
        anchor: rp::Vector::new(1., 0.1, 0.),
        offset: rp::Vector::new(0., 0.51, 0.),
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    // Replacing the fixture's whole Native context must also register its
    // original physical support point; the old response() fallback belongs to
    // a different (0, .6, 0) point and is not this recorded yaw attachment.
    let origin_index = scratch
        .origins
        .binary_search_by_key(&actor, |o| o.body)
        .unwrap();
    scratch.origins[origin_index].support = Some((
        identity(support),
        Some(rp::Vector::new(1., 0.1, 0.) + world.backend.bodies[support].local_center_of_mass()),
    ));
    scratch.entries[carrier_index] = entry(support, carrier);
    scratch.entries[index].curve = anchored;
    scratch.entries[index].domain_start = 0.;
    let geometry = curve_velocity(anchored, 0.).unwrap().0;
    let value = scratch
        .character_values
        .binary_search_by_key(&actor, |v| v.0)
        .unwrap();
    scratch.character_values[value].1 = geometry;
    scratch.participants[carrier_index].linear_velocity = native.linear_velocity;
    scratch.participants[carrier_index].angular_velocity = native.angular_velocity;
    scratch.participants[index].linear_velocity = geometry;
    scratch.participants[index].linear_velocity.y = -1.2805685e-8;
    let physical = scratch.participants[index].linear_velocity;
    assert_eq!(physical.y - geometry.y, 1.106_830_2e-10_f32);
    let make = |id, curve, role| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role,
            motion: crate::physics3d::solver_trajectory::ShapeMotion {
                curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let a = make(identity(support), Curve::Integrated(carrier), Role::Dynamic);
    let b = make(actor, anchored, Role::Character(actor));
    scratch.contacts.clear();
    let mut work = Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    crate::physics3d::solver_trajectory::contacts_full_shapes(
        a.motion,
        world.backend.colliders[a.collider].shape(),
        b.motion,
        world.backend.colliders[b.collider].shape(),
        0.,
        0.02,
        &mut work,
        &mut |contact, _, _, _| {
            assert_eq!(contact.normal1, rp::Vector::Y);
            scratch
                .contacts
                .push(actual_scene::ContactSample { a, b, contact });
            Ok(())
        },
    )
    .unwrap();
    assert!(
        !scratch.contacts.is_empty(),
        "same actual walkable ground contact"
    );
    let saved = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let impulses = scratch.row_impulses.clone();
    let kept = scratch
        .retained_support_suffix(
            index,
            0.,
            0.,
            &world.backend.bodies,
            &world.characters,
            &mut work,
        )
        .unwrap()
        .expect("strict-positive but unrepresented normal post-add does not erase real support")
        .0;
    let bits = |p: rp::Pose| {
        (
            p.translation.to_array().map(f32::to_bits),
            p.rotation.to_array().map(f32::to_bits),
        )
    };
    assert_eq!(bits(kept.com_pose(0.)), bits(anchored.com_pose(0.)));
    let Curve::Anchored {
        carrier: retained,
        anchor,
        offset,
        ..
    } = kept
    else {
        panic!("real support path");
    };
    assert_eq!(anchor, rp::Vector::new(1., 0.1, 0.));
    assert_eq!(
        crate::checkpoint_codec::encode(&carrier).unwrap(),
        crate::checkpoint_codec::encode(&retained).unwrap()
    );
    assert_eq!(offset, rp::Vector::new(0., 0.51, 0.));
    assert_eq!(scratch.entries[index].support, Some(support));
    let start = carrier.position_at_time(domain.start);
    let end = carrier.position_at_time(domain.end);
    let carry =
        (end.translation + end.rotation * anchor) - (start.translation + start.rotation * anchor);
    assert!(
        carry.x.abs() > 0.0001 && carry.z.abs() > 0.01,
        "original yaw point has real XZ transport: {carry:?}"
    );
    let origin = scratch
        .origins
        .binary_search_by_key(&actor, |o| o.body)
        .unwrap();
    scratch.origins[origin].carry = rp::Vector::ZERO;
    scratch.origins[origin].anchored = false;
    scratch.entries[index].curve = kept;
    scratch.entries[index].carry_correction = rp::Vector::ZERO;
    scratch.accepted.try_reserve(1).unwrap();
    scratch
        .stage_curve(
            scratch.entries[index],
            domain.start,
            domain.end,
            &world.backend.bodies,
            &mut work,
        )
        .unwrap();
    assert_eq!(scratch.origins[origin].carry, carry);
    assert!(scratch.origins[origin].anchored);
    assert_eq!(scratch.participants[index].linear_velocity, physical);
    assert_eq!(scratch.row_impulses, impulses);
    // Real representable upward momentum is retained physically and detaches.
    scratch.participants[index].linear_velocity = geometry + rp::Vector::Y;
    assert!(scratch
        .retained_support_suffix(
            index,
            0.,
            0.,
            &world.backend.bodies,
            &world.characters,
            &mut work
        )
        .unwrap()
        .is_none());
    assert_eq!(
        scratch.participants[index].linear_velocity,
        geometry + rp::Vector::Y
    );
    // The original explicit jump branch is independent of invisibility.
    scratch.participants[index].linear_velocity = physical;
    world
        .characters
        .get_mut(&actor)
        .unwrap()
        .state
        .vertical_speed = 1.;
    assert!(scratch
        .retained_support_suffix(
            index,
            0.,
            0.,
            &world.backend.bodies,
            &world.characters,
            &mut work
        )
        .unwrap()
        .is_none());
    world
        .characters
        .get_mut(&actor)
        .unwrap()
        .state
        .vertical_speed = 0.;
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), saved);
    assert_eq!(scratch.row_impulses, impulses);
}

/// Observation only: exact C20 real-support curve, original full leaf witnesses
/// and original fixed-normal certificates share one bounded proof budget. A
/// sampled gap is never a whole-interval approval or an Engine tick success.
#[test]
fn observed_c20_rotating_real_support_distinguishes_actual_gaps_from_certificate_results() {
    use crate::physics3d::solver_trajectory::{self, ShapeMotion};
    let carrier_body = rp::RigidBodyHandle::from_raw_parts(0, 0);
    let actor = BodyId {
        slot: 1,
        generation: 0,
    };
    let domain = Domain::new(0., 0.02500000037252903).unwrap();
    let native = SolverBodyIntegration {
        motion: rapier3d::pipeline::SolverBodyMotion {
            body: carrier_body,
            start_time: 0.,
            end_time: 0.025,
            start: rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
            end: rp::Pose::from_parts(
                rp::Vector::new(0., -0.1, 0.),
                rp::Rotation::from_xyzw(-3.436501e-12, 0.024992192, -6.907454e-11, 0.9996877),
            ),
        },
        integration_seconds: 0.025,
        linear_velocity: rp::Vector::new(0., -7.3886794e-9, 0.),
        angular_velocity: rp::Vector::new(-2.7500596e-10, 2., -5.5276894e-9),
    };
    let carrier = Kernel::from_native(native, domain).unwrap();
    let physical_support_point = rp::Vector::new(0.9999944, 0.09986183, 2.9802322e-6);
    let physical_support_anchor = Some((identity(carrier_body), physical_support_point));
    // C20 has not changed the geometric anchor independently of this original
    // actual support point. Record both authorities instead of conflating them.
    let anchor = rp::Vector::new(0.9999944, 0.09986183, 2.9802322e-6);
    let offset = rp::Vector::new(5.6028366e-6, 0.51013815, -2.9802322e-6);
    let actor_curve = Curve::Anchored {
        carrier,
        anchor,
        offset,
        linear_velocity: rp::Vector::new(0., -3.1974423e-14, 0.),
        rotation: rp::Rotation::IDENTITY,
    };
    let platform = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let carried = ShapeMotion {
        curve: actor_curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let box_shape = rp::SharedShape::cuboid(2., 0.1, 2.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let normal = rp::Vector::Y;
    let skin = 0.01;
    let tolerance = f64::from((native.motion.end_time - native.motion.start_time) * 1e-6);
    let saved = crate::checkpoint_codec::encode(&(
        actor,
        physical_support_anchor,
        carrier,
        platform,
        carried,
        &box_shape,
        &capsule,
    ))
    .unwrap();
    let mut work = Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    let limit = work.limit;
    let mut stage = "header";
    let outcome = (|| -> Result<(), TrajectoryError> {
        work.charge(128)?;
        eprintln!("C21_SUPPORT_HEADER observation_only=true actor={actor:?} physical_support={physical_support_anchor:?} curve={actor_curve:?} native_h={:?} observer=[{:?},{:?}] domain={domain:?} original_normal={normal:?} preferred_skin={skin:?} time_tolerance={tolerance:.18e} quota={limit}",native.integration_seconds,native.motion.start_time,native.motion.end_time);
        let times = [
            domain.start,
            domain.start + domain.duration() * 0.25,
            domain.start + domain.duration() * 0.5,
            domain.start + domain.duration() * 0.75,
            domain.end,
        ];
        let mut initial_gap = None;
        // The original capsule's complete bound is a measurement radius only.
        // It never changes skin, shape, proof clearance or accepted motion.
        let distance = capsule.compute_local_bounding_sphere().radius;
        for (index, time) in times.into_iter().enumerate() {
            stage = "full-leaf-witness";
            work.charge(32)?;
            let before = work.used;
            let mut minimum: Option<f32> = None;
            let mut count = 0usize;
            solver_trajectory::contacts_full_shapes(
                platform,
                box_shape.as_ref(),
                carried,
                capsule.as_ref(),
                time,
                distance,
                &mut work,
                &mut |contact, leaf_a, leaf_b, work| {
                    work.charge(16)?;
                    if !contact.dist.is_finite()
                        || !contact.normal1.is_finite()
                        || !contact.point1.is_finite()
                        || !contact.point2.is_finite()
                    {
                        return Err(TrajectoryError::NonFinite);
                    }
                    count = count.checked_add(1).ok_or(TrajectoryError::WorkLimit)?;
                    // These two original convex shapes have one actual leaf
                    // pair; bound diagnostics instead of dumping a scene.
                    if count > 32 {
                        return Err(TrajectoryError::WorkLimit);
                    }
                    minimum = Some(minimum.map_or(contact.dist, |gap| gap.min(contact.dist)));
                    eprintln!("C21_SUPPORT_WITNESS index={index} time={time:.18e} native_local_dt={:?} logical_relative_dt={:?} leaves={leaf_a}/{leaf_b} dist={:?} original_normal_projection={:?} native_normal={:?} points={:?}/{:?}",carrier.local_delta(time),(time-domain.start) as f32,contact.dist,(contact.point2-contact.point1).dot(normal),contact.normal1,contact.point1,contact.point2);
                    Ok(())
                },
            )?;
            let gap = minimum.ok_or(TrajectoryError::Unresolved)?;
            let baseline = *initial_gap.get_or_insert(gap);
            let classification = if gap < 0. {
                "physical_penetration_at_sample"
            } else if gap < baseline {
                "positive_gap_loss_at_sample"
            } else {
                "no_gap_loss_at_this_sample_only"
            };
            let physical_point = carrier.position_at_time(time).translation
                + carrier.position_at_time(time).rotation * physical_support_point;
            eprintln!("C21_SUPPORT_GAP index={index} time={time:.18e} count={count} minimum={gap:?} initial={baseline:?} below_preferred_skin={} classification={classification} carrier_com={:?} actor_com={:?} original_physical_point={physical_point:?} work={before}->{}",gap<skin,carrier.position_at_time(time),actor_curve.com_pose(time),work.used);
        }
        stage = "original-initial-proof-clearance";
        let margin_before = work.used;
        let raw_margin = solver_trajectory::test_initial_support_clearance(
            platform,
            box_shape.as_ref(),
            carried,
            capsule.as_ref(),
            normal,
            domain.start,
            &mut work,
        )?;
        let proof_margin = raw_margin.min(skin);
        if !raw_margin.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        eprintln!("C21_SUPPORT_MARGIN initial_leaf_gap={initial_gap:?} preferred_skin={skin:?} original_support_margin={raw_margin:?} original_proof_clearance={proof_margin:?} work={margin_before}->{}",work.used);
        // Certificates use the exact production support margin returned by its
        // owner function. No guessed leaf margin or parallel support arithmetic.
        for (label, end) in [
            ("zero_prefix", domain.start),
            ("quarter_prefix", times[1]),
            ("half_prefix", times[2]),
            ("whole_interval", domain.end),
        ] {
            stage = "original-normal-full-shape-certificate";
            work.charge(1)?;
            let before = work.used;
            let certificate = platform.separated(
                box_shape.as_ref(),
                carried,
                capsule.as_ref(),
                normal,
                domain.start,
                end,
                proof_margin,
                &mut work,
            );
            eprintln!("C21_SUPPORT_CERT label={label} domain=[{:.18e},{end:.18e}] clearance={proof_margin:?} result={certificate:?} false_means_not_certified=true work={before}->{}",domain.start,work.used);
            // Err ends this one shared budgeted diagnostic. No quota reset or
            // silent error-to-no-hit conversion, even for observation-only code.
            certificate?;
        }
        stage = "original-full-shape-policy-cast";
        let before = work.used;
        let result = solver_trajectory::cast_full_shapes_policy(
            platform,
            box_shape.as_ref(),
            carried,
            capsule.as_ref(),
            domain.start,
            domain.end,
            skin,
            tolerance,
            &mut work,
            true,
        );
        eprintln!("C21_SUPPORT_CAST allow_existing_contact=true original_domain={domain:?} result={result:?} work={before}->{}",work.used);
        let _observed_hit = result?;
        Ok(())
    })();
    eprintln!("C21_SUPPORT_OUTCOME observation_only=true stage={stage} result={outcome:?} work={}/{} sampled_success_is_not_whole_path_or_engine_success=true",work.used,work.limit);
    assert_eq!(work.limit, limit, "one unchanged proof quota");
    assert!(work.used <= limit);
    if let Err(error) = outcome {
        assert!(
            matches!(
                error,
                TrajectoryError::WorkLimit | TrajectoryError::Unresolved
            ),
            "supported finite original tuple unexpectedly rejected: {error:?}"
        );
    }
    assert_eq!(
        crate::checkpoint_codec::encode(&(
            actor,
            physical_support_anchor,
            carrier,
            platform,
            carried,
            &box_shape,
            &capsule
        ))
        .unwrap(),
        saved
    );
    assert_eq!(physical_support_point, anchor);
    assert_eq!(
        carrier.native.integration_seconds.to_bits(),
        0.025_f32.to_bits()
    );
    assert_eq!(carrier.domain.start.to_bits(), 0_f64.to_bits());
    assert_eq!(
        carrier.domain.end.to_bits(),
        0.02500000037252903_f64.to_bits()
    );
}

#[test]
fn geometry_phase_never_redefines_the_original_support_point_or_finite_impulse() {
    let mut controls = Vec::new();
    for phase_axis in [None, Some(1), Some(0)] {
        let (world, mut scratch, actor, peer) = prepared_response_with_mass(
            rp::Vector::ZERO,
            rp::Vector::ZERO,
            rp::Vector::X * 3.,
            rp::Vector::X,
            true,
            Some((rp::Vector::ZERO, rp::Vector::ZERO, rp::Vector::Y * 2.)),
            10.,
        );
        let saved = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
        let index = scratch.entry_index(Some(native_id(actor))).unwrap();
        let old = scratch.entries[index];
        let time = old.curve.times().1 * 0.4;
        let end = old.curve.times().1;
        let mut work = Work {
            used: scratch.used,
            limit: super::super::trajectory::MAX_PROOF_WORK,
        };
        let before = scratch
            .baseline_support_rate(old, time, &world.backend.bodies, &mut work)
            .unwrap();
        let real_anchor = scratch
            .physical_support_anchor(old, &world.backend.bodies, &mut work)
            .unwrap();
        // Explicit saved local support anchors use the same physical point as
        // the original implicit attachment rule. Neither reads geometry phase.
        let support = old.support.unwrap();
        let origin = scratch
            .origins
            .binary_search_by_key(&actor, |o| o.body)
            .unwrap();
        scratch.origins[origin].support = Some((
            identity(support),
            Some(real_anchor + world.backend.bodies[support].local_center_of_mass()),
        ));
        assert_eq!(
            scratch
                .physical_support_anchor(old, &world.backend.bodies, &mut work)
                .unwrap(),
            real_anchor
        );
        if let Some(axis) = phase_axis {
            let Curve::Anchored {
                carrier,
                mut anchor,
                linear_velocity,
                rotation,
                ..
            } = old.curve
            else {
                panic!()
            };
            anchor[axis] += 0.125;
            let at = carrier.position_at_time(time);
            let relative_dt = linear_velocity * (time - carrier.domain.start) as f32;
            let offset = super::representable::fit_offset(
                at.translation + at.rotation * anchor,
                relative_dt,
                old.curve.com_pose(time).translation,
            )
            .unwrap();
            scratch.entries[index].curve = Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation,
            };
            assert_eq!(
                scratch.entries[index]
                    .curve
                    .com_pose(time)
                    .translation
                    .to_array()
                    .map(f32::to_bits),
                old.curve
                    .com_pose(time)
                    .translation
                    .to_array()
                    .map(f32::to_bits)
            );
            // Axis 0 is an adversarial descriptor, not an admitted normal
            // proposal. Even it cannot redefine the physical support point.
        }
        assert_eq!(
            scratch
                .physical_support_anchor(scratch.entries[index], &world.backend.bodies, &mut work)
                .unwrap(),
            real_anchor
        );
        assert_eq!(
            scratch
                .baseline_support_rate(
                    scratch.entries[index],
                    time,
                    &world.backend.bodies,
                    &mut work
                )
                .unwrap(),
            before
        );
        // The two descriptors have the same real pose at this contact. Query
        // original full shapes and solve exactly once; no World tick is faked.
        let bound = world.actual_motion_scratch_bound().unwrap();
        response_census(&world, &mut scratch, time, end, 0.01, bound, &mut work);
        let hit = census_hit(&scratch, actor, peer, time);
        scratch
            .response_at(
                hit,
                time,
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
        let actor_index = scratch.entry_index(Some(native_id(actor))).unwrap();
        let peer_index = scratch.entry_index(Some(native_id(peer))).unwrap();
        let staged = scratch.entries[actor_index];
        scratch.accepted.try_reserve(1).unwrap();
        scratch
            .stage_curve(
                staged,
                staged.domain_start,
                end,
                &world.backend.bodies,
                &mut work,
            )
            .unwrap();
        let result = (
            scratch.entries[actor_index].momentum_before,
            scratch.participants[actor_index].linear_velocity,
            scratch.participants[peer_index].linear_velocity,
            scratch.row_impulses.clone(),
            scratch.origins[origin].carry,
        );
        near(result.0, rp::Vector::ZERO);
        near(result.1, rp::Vector::X * 0.5);
        near(result.2, rp::Vector::X * 0.5);
        assert!(result.3.iter().any(|j| *j > 0.));
        assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), saved);
        controls.push(result);
    }
    assert_eq!(controls[0], controls[1]);
    assert_eq!(controls[0], controls[2]);
}

#[test]
fn support_physical_state_geometry_continuation_and_retry_have_separate_authorities() {
    // Consumer-level control. The companion physical_momentum tests perform a
    // real positive-inertia Sphere/Character J solve at nonzero contact time.
    let (mut world, mut scratch, actor, _) = prepared_response_with_mass(
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
        rp::Vector::X,
        true,
        Some((rp::Vector::ZERO, rp::Vector::ZERO, rp::Vector::Y * 4.)),
        10.,
    );
    let actor_index = scratch.entry_index(Some(native_id(actor))).unwrap();
    let support = scratch.entries[actor_index].support.unwrap();
    world
        .set_body_options(
            identity(support),
            &crate::physics3d::BodyOptions {
                kind: BodyKind::Dynamic,
                can_sleep: false,
                ..Default::default()
            },
        )
        .unwrap();
    let carrier_index = scratch.entry_index(Some(support)).unwrap();
    let Curve::Integrated(old_carrier) = scratch.entries[carrier_index].curve else {
        panic!()
    };
    let domain = old_carrier.domain;
    let carrier = Kernel::from_velocity(
        support,
        domain,
        old_carrier.native.motion.start,
        rp::Vector::new(0.25, 0., 0.),
        rp::Vector::Y * 4.,
    )
    .unwrap();
    scratch.entries[carrier_index] = entry(support, carrier);
    let anchor = rp::Vector::new(1., 0.6, 0.);
    let origin = scratch
        .origins
        .binary_search_by_key(&actor, |o| o.body)
        .unwrap();
    scratch.origins[origin].support = Some((
        identity(support),
        Some(anchor + world.backend.bodies[support].local_center_of_mass()),
    ));
    scratch.entries[actor_index].curve = Curve::Anchored {
        carrier,
        anchor,
        offset: -rp::Vector::X,
        linear_velocity: rp::Vector::ZERO,
        rotation: rp::Rotation::IDENTITY,
    };
    let safe = domain.duration() * 0.2;
    let time = domain.duration() * 0.4;
    let mut work = Work {
        used: scratch.used,
        limit: super::super::trajectory::MAX_PROOF_WORK,
    };
    let raw = physical_momentum::State::from_native(scratch.entries[carrier_index].value).unwrap();
    let geometric = physical_momentum::State::from_curve(Curve::Integrated(carrier), time).unwrap();
    assert_ne!(
        raw.angular.to_array().map(f32::to_bits),
        geometric.angular.to_array().map(f32::to_bits)
    );
    let point_arm = carrier.position_at_time(time).rotation * anchor;
    let physical_before = scratch
        .baseline_support_rate(
            scratch.entries[actor_index],
            time,
            &world.backend.bodies,
            &mut work,
        )
        .unwrap();
    assert_eq!(physical_before, raw.point_rate(point_arm).unwrap());
    assert_ne!(physical_before, geometric.point_rate(point_arm).unwrap());
    for index in 0..scratch.entries.len() {
        let e = scratch.entries[index];
        let id = identity(e.value.handle);
        let state = if id == actor {
            physical_momentum::State::new(physical_before, rp::Vector::ZERO).unwrap()
        } else {
            scratch
                .native_physical_seed(e, time, &world.backend.bodies, &mut work)
                .unwrap()
        };
        scratch.entries[index].momentum_before = state.linear;
        scratch.participants.push(Participant {
            body: id,
            pose: e.curve.com_pose(time),
            linear_velocity: state.linear,
            angular_velocity: state.angular,
            mass: if id == actor {
                MassPolicy::Character(10.)
            } else {
                MassPolicy::Native
            },
        });
    }
    scratch.entries[actor_index].momentum_carry = physical_before;
    let source = crate::checkpoint_codec::encode(&scratch.entries[carrier_index].original).unwrap();
    let raw_before = scratch.entries[carrier_index].value;
    let saved = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let after =
        physical_momentum::State::new(rp::Vector::new(-0.5, 0.125, 0.), rp::Vector::Y * 2.5)
            .unwrap();
    scratch.participants[carrier_index].linear_velocity = after.linear;
    scratch.participants[carrier_index].angular_velocity = after.angular;
    assert_eq!(
        scratch
            .actual_carrier_rate(
                scratch.entries[actor_index],
                time,
                &world.backend.bodies,
                &mut work,
            )
            .unwrap(),
        after.point_rate(point_arm).unwrap()
    );
    let expected = Kernel::from_velocity(
        support,
        Domain::new(safe, domain.end).unwrap(),
        carrier.position_at_time(safe),
        after.linear,
        after.angular,
    )
    .unwrap();
    let expected_state =
        physical_momentum::State::from_curve(Curve::Integrated(expected), time).unwrap();
    let expected_arm = expected.position_at_time(time).rotation * anchor;
    let carried = scratch
        .geometric_carrier_rate(
            scratch.entries[actor_index],
            safe,
            time,
            domain.end,
            &world.backend.bodies,
            &mut work,
        )
        .unwrap();
    assert_eq!(carried, expected_state.point_rate(expected_arm).unwrap());
    assert_ne!(carried, after.point_rate(point_arm).unwrap());
    assert_eq!(
        scratch.entries[carrier_index].value.angular_velocity,
        raw_before.angular_velocity
    );
    assert_eq!(
        scratch.entries[carrier_index].value.linear_velocity,
        raw_before.linear_velocity
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&scratch.entries[carrier_index].original).unwrap(),
        source
    );
    assert!(scratch.row_impulses.is_empty());
    scratch
        .reset_stopped_plan(time, 1., &world.backend.bodies, &mut work)
        .unwrap();
    assert_eq!(
        scratch.participants[carrier_index]
            .angular_velocity
            .to_array()
            .map(f32::to_bits),
        raw.angular.to_array().map(f32::to_bits)
    );
    assert_eq!(
        scratch.participants[carrier_index]
            .linear_velocity
            .to_array()
            .map(f32::to_bits),
        raw.linear.to_array().map(f32::to_bits)
    );
    assert_eq!(
        scratch.participants[actor_index].linear_velocity,
        physical_before
    );
    assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), saved);
}
