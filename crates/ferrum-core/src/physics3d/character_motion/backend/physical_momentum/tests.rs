use super::super::{actual_scene, identity, momentum_tests, BackendMotionScratch};
use super::*;
use crate::physics3d::{
    solver_trajectory::{CastHit, ShapeMotion, Work},
    world::native_id,
    BodyDesc, BodyId, BodyKind, CharacterConfig, ColliderDesc, PhysicsWorld3d, Pose, Shape,
    WorldConfig,
};

fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}

fn bits(value: rp::Vector) -> [u32; 3] {
    value.to_array().map(f32::to_bits)
}

#[test]
fn native_dynamic_seed_and_prescribed_point_rate_have_distinct_authorities() {
    let mut bodies = rp::RigidBodySet::new();
    let dynamic = bodies.insert(rp::RigidBodyBuilder::dynamic().build());
    let prescribed = bodies.insert(rp::RigidBodyBuilder::kinematic_velocity_based().build());
    let h = 0.025_f32;
    let curve = Kernel::from_velocity(
        dynamic,
        Domain::new(0., Time::from(h)).unwrap(),
        rp::Pose::IDENTITY,
        rp::Vector::X,
        rp::Vector::X * 4.,
    )
    .unwrap();
    let raw = momentum_tests::entry(dynamic, curve).value;
    let physical = State::from_native(raw).unwrap();
    let geometry = State::from_curve(Curve::Integrated(curve), 0.01).unwrap();
    assert_ne!(bits(physical.angular), bits(geometry.angular));
    assert_eq!(physical.angular.x.to_bits(), 4_f32.to_bits());
    assert_eq!(
        participant_seed(&bodies[dynamic], raw, geometry).unwrap(),
        physical
    );
    assert_eq!(
        participant_seed(&bodies[prescribed], raw, geometry).unwrap(),
        geometry
    );
    let arm = rp::Vector::Y * 0.25;
    assert_eq!(
        geometry.point_rate(arm).unwrap(),
        geometry.linear + geometry.angular.cross(arm)
    );
    let participant = Participant {
        body: identity(dynamic),
        pose: curve.position_at_time(0.01),
        linear_velocity: physical.linear,
        angular_velocity: physical.angular,
        mass: super::super::MassPolicy::Native,
    };
    assert_eq!(State::from_participant(&participant).unwrap(), physical);
}

#[test]
fn unchanged_or_geometry_only_state_preserves_original_kernel_and_signed_zero() {
    let handle = rp::RigidBodyHandle::invalid();
    let domain = Domain::new(0., Time::from(0.025_f32)).unwrap();
    let curve = Kernel::from_velocity(
        handle,
        domain,
        rp::Pose::IDENTITY,
        rp::Vector::new(-0., 0., 0.),
        rp::Vector::X * 4.,
    )
    .unwrap();
    let before_bytes = postcard::to_allocvec(&curve).unwrap();
    let before = State::new(curve.native.linear_velocity, curve.native.angular_velocity).unwrap();
    let geometry = State::from_curve(Curve::Integrated(curve), 0.01).unwrap();
    assert_ne!(geometry.angular, before.angular);
    let after = State::new(rp::Vector::ZERO, before.angular).unwrap();
    assert!(continuation(
        handle,
        Curve::Integrated(curve),
        domain,
        curve.native.motion.start,
        before,
        after
    )
    .unwrap()
    .is_none());
    assert_eq!(postcard::to_allocvec(&curve).unwrap(), before_bytes);
    assert_eq!(curve.native.linear_velocity.x.to_bits(), (-0_f32).to_bits());

    let after = State::new(rp::Vector::Y, rp::Vector::X * 3.).unwrap();
    let suffix_domain = Domain::new(0.01, domain.end).unwrap();
    let safe = curve.position_at_time(0.01);
    let suffix = continuation(
        handle,
        Curve::Integrated(curve),
        suffix_domain,
        safe,
        before,
        after,
    )
    .unwrap()
    .unwrap();
    let reference =
        Kernel::from_velocity(handle, suffix_domain, safe, after.linear, after.angular).unwrap();
    assert_eq!(
        postcard::to_allocvec(&suffix).unwrap(),
        postcard::to_allocvec(&reference).unwrap()
    );
    assert_eq!(bits(suffix.native.angular_velocity), bits(after.angular));
    assert_eq!(
        State::from_curve(Curve::Integrated(suffix), 0.02)
            .unwrap()
            .angular,
        suffix.angular_velocity_at_time(0.02)
    );
    assert_eq!(postcard::to_allocvec(&curve).unwrap(), before_bytes);
}

#[test]
fn physical_state_and_continuation_reject_invalid_values_before_returning_a_kernel() {
    let state = State::new(rp::Vector::ZERO, rp::Vector::ZERO).unwrap();
    for bad in [f32::NAN, f32::INFINITY] {
        assert!(matches!(
            State::new(rp::Vector::splat(bad), rp::Vector::ZERO),
            Err(TrajectoryError::NonFinite)
        ));
        assert!(matches!(
            state.point_rate(rp::Vector::splat(bad)),
            Err(TrajectoryError::NonFinite)
        ));
    }
    assert!(matches!(
        continuation(
            rp::RigidBodyHandle::invalid(),
            Curve::Constant {
                pose: rp::Pose::IDENTITY,
                start_time: 0.,
                end_time: 0.01
            },
            Domain { start: 1., end: 0. },
            rp::Pose::IDENTITY,
            state,
            state,
        ),
        Err(TrajectoryError::InvalidTime)
    ));
    assert!(matches!(
        continuation(
            rp::RigidBodyHandle::invalid(),
            Curve::Constant {
                pose: rp::Pose::IDENTITY,
                start_time: 0.,
                end_time: 0.01
            },
            Domain::new(0., 0.01).unwrap(),
            rp::Pose::from_translation(rp::Vector::splat(f32::NAN)),
            state,
            state,
        ),
        Err(TrajectoryError::NonFinite)
    ));
}

struct Fixture {
    world: PhysicsWorld3d,
    scratch: BackendMotionScratch,
    actor: BodyId,
    sphere: BodyId,
    bystander: BodyId,
    hit: actual_scene::Hit,
    end: Time,
}

fn fixture(push_mass: f32) -> Fixture {
    fixture_with_clock(push_mass, 0., Time::from(0.025_f32))
}

fn fixture_with_clock(push_mass: f32, logical_start: Time, logical_seconds: Time) -> Fixture {
    let h = 0.025_f32;
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: h,
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
    let sphere = world
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [-0.51, 0., 0.],
                    ..Default::default()
                },
                linear_velocity: [1., 0., 0.],
                angular_velocity: [4., 0., 0.],
                linear_damping: 0.,
                angular_damping: 0.,
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc {
                density: 1.,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.25 })
            },
        )
        .unwrap();
    let bystander = world
        .create_body(
            BodyDesc {
                pose: Pose {
                    position: [8., 8., 8.],
                    ..Default::default()
                },
                angular_velocity: [1., 2., 3.],
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
        )
        .unwrap();
    for id in [sphere, bystander] {
        world.backend.bodies[native_id(id)]
            .recompute_mass_properties_from_colliders(&world.backend.colliders);
    }
    let native = &world.backend.bodies[native_id(sphere)];
    assert!(native.is_dynamic());
    assert!(native.mass() > 0.);
    let inertia = native
        .mass_properties()
        .local_mprops
        .world_inv_inertia(native.rotation());
    assert!(inertia.m11 > 0. && inertia.m22 > 0. && inertia.m33 > 0.);
    world.refresh_queries();
    let runtime = world.characters.get_mut(&actor).unwrap();
    runtime.free_velocity = [0.; 3];
    runtime.free_translation = [0.; 3];
    let mut scratch = BackendMotionScratch::default();
    world.prepare_backend_motion(&mut scratch, h).unwrap();
    let domain = Domain::new(logical_start, logical_start + logical_seconds).unwrap();
    for id in [actor, sphere, bystander] {
        let body = &world.backend.bodies[native_id(id)];
        let kernel = Kernel::from_velocity_seconds(
            native_id(id),
            domain,
            h,
            body.position()
                .prepend_translation(body.local_center_of_mass()),
            body.linvel(),
            body.angvel(),
        )
        .unwrap();
        let mut value = momentum_tests::entry(native_id(id), kernel);
        value.domain_start = domain.start;
        scratch.entries.push(value);
    }
    let trajectory = |id: BodyId| {
        let body = &world.backend.bodies[native_id(id)];
        let collider = body.colliders()[0];
        let c = &world.backend.colliders[collider];
        actual_scene::ColliderTrajectory {
            collider,
            parent: Some(native_id(id)),
            role: if id == actor {
                actual_scene::Role::Character(id)
            } else {
                actual_scene::Role::Dynamic
            },
            motion: ShapeMotion {
                curve: scratch.entries[scratch.entry_index(Some(native_id(id))).unwrap()].curve,
                local_center: body.local_center_of_mass(),
                local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
            },
            bounds: c.shape().compute_aabb(c.position()),
            sensor: false,
        }
    };
    let a = trajectory(actor);
    let b = trajectory(sphere);
    let mut manifold = rapier3d::parry::query::ContactManifold::<(), ()>::default();
    manifold.points.try_reserve(32).unwrap();
    let mut work = work();
    let contact_time = logical_start + 0.01 * (domain.duration() / Time::from(h));
    crate::physics3d::solver_trajectory::contacts_full_shapes_with_manifold(
        a.motion,
        world.backend.colliders[a.collider].shape(),
        b.motion,
        world.backend.colliders[b.collider].shape(),
        contact_time,
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
        !scratch.contacts.is_empty(),
        "actual full-shape nonzero-time contact"
    );
    assert!(scratch
        .contacts
        .iter()
        .all(|sample| sample.contact.dist.abs() < 1e-6));
    let first = scratch.contacts[0];
    let hit = actual_scene::Hit {
        a,
        b,
        cast: CastHit {
            safe_time: contact_time,
            hit_time: contact_time,
            contact: first.contact,
            subshape_a: 0,
            subshape_b: 0,
        },
    };
    scratch.used += work.used;
    Fixture {
        world,
        scratch,
        actor,
        sphere,
        bystander,
        hit,
        end: domain.end,
    }
}

fn respond(f: &mut Fixture) {
    let before = f.world.capture_snapshot().unwrap().encoded_bytes().to_vec();
    let mut work = Work {
        used: f.scratch.used,
        ..work()
    };
    f.scratch
        .response_at(
            f.hit,
            f.hit.cast.safe_time,
            f.end,
            &f.world.backend.bodies,
            &f.world.backend.colliders,
            &f.world.characters,
            false,
            1.,
            &mut work,
            f.world.actual_motion_scratch_bound().unwrap(),
        )
        .unwrap();
    f.scratch.used = work.used;
    assert_eq!(f.world.capture_snapshot().unwrap().encoded_bytes(), before);
}

#[test]
fn actual_nonzero_time_sphere_impulse_uses_raw_seed_and_preserves_angular_momentum() {
    assert_actual_physical_response(fixture(10.));
}

fn assert_actual_physical_response(mut f: Fixture) -> Fixture {
    let sphere_index = f.scratch.entry_index(Some(native_id(f.sphere))).unwrap();
    let actor_index = f.scratch.entry_index(Some(native_id(f.actor))).unwrap();
    let bystander_index = f.scratch.entry_index(Some(native_id(f.bystander))).unwrap();
    let original = f.scratch.entries[sphere_index];
    let untouched = f.scratch.entries[bystander_index];
    let untouched_curve = postcard::to_allocvec(&untouched.curve).unwrap();
    let source_kernel = postcard::to_allocvec(&original.original).unwrap();
    let raw_before = State::from_native(original.value).unwrap();
    let old_geometry = State::from_curve(original.curve, f.hit.cast.hit_time).unwrap();
    assert_ne!(bits(raw_before.angular), bits(old_geometry.angular));
    let hit_pose = original.curve.com_pose(f.hit.cast.hit_time);
    let native = &f.world.backend.bodies[native_id(f.sphere)];
    let inv_mass = native.mass_properties().local_mprops.inv_mass;
    let world_inv_inertia = native
        .mass_properties()
        .local_mprops
        .world_inv_inertia(&hit_pose.rotation);
    respond(&mut f);

    assert_eq!(f.scratch.rows.len(), f.scratch.row_impulses.len());
    let mut expected_linear = raw_before.linear;
    let mut expected_angular = raw_before.angular;
    let mut total = 0.;
    assert_eq!(
        f.scratch.rows.len(),
        1,
        "one queried Sphere/Capsule normal row"
    );
    for (i, (row, j)) in f
        .scratch
        .rows
        .iter()
        .zip(&f.scratch.row_impulses)
        .enumerate()
    {
        let sign = if row.a == sphere_index {
            1.
        } else if row.b == Some(sphere_index) {
            -1.
        } else {
            continue;
        };
        // The queried row really joins this Sphere to the finite Character.
        assert!(row.a == actor_index || row.b == Some(actor_index));
        let impulse = row.normal * (*j * sign);
        expected_linear += impulse * inv_mass;
        expected_angular += world_inv_inertia * (row.point - hit_pose.translation).cross(impulse);
        total += *j;
        // Read the actual cached node of this exact row's successful solve.
        // A final raw-minus-derivative offset repair cannot satisfy this check.
        let (_, seed_angular) = f
            .scratch
            .response
            .test_solved_row_seed(i, f.sphere)
            .unwrap();
        assert_eq!(seed_angular.x.to_bits(), raw_before.angular.x.to_bits());
    }
    assert!(total > 0., "the actual finite physical solve produces J");
    let row = &f.scratch.rows[0];
    let arm = row.point - hit_pose.translation;
    let angular_jacobian = arm.cross(row.normal);
    let effective_inverse_mass =
        inv_mass + 1. / 10. + angular_jacobian.dot(world_inv_inertia * angular_jacobian);
    let sphere_sign = if row.a == sphere_index { 1. } else { -1. };
    let expected_j = -sphere_sign * raw_before.linear.dot(row.normal) / effective_inverse_mass;
    assert!((total - expected_j).abs() < 2e-6);
    let after = f.scratch.entries[sphere_index];
    assert!((after.value.linear_velocity - expected_linear).length() < 2e-6);
    assert!((after.value.angular_velocity - expected_angular).length() < 2e-6);
    assert_eq!(after.value.angular_velocity.x.to_bits(), 4_f32.to_bits());
    assert_eq!(
        postcard::to_allocvec(&after.original).unwrap(),
        source_kernel
    );
    assert_eq!(
        postcard::to_allocvec(&f.scratch.entries[bystander_index].curve).unwrap(),
        untouched_curve
    );
    assert_eq!(
        bits(f.scratch.entries[bystander_index].value.angular_velocity),
        bits(untouched.value.angular_velocity)
    );
    assert_eq!(
        bits(f.scratch.entries[bystander_index].value.linear_velocity),
        bits(untouched.value.linear_velocity)
    );
    assert_eq!(
        f.scratch.entries[bystander_index].value.end,
        untouched.value.end
    );
    assert_eq!(
        postcard::to_allocvec(&f.scratch.entries[bystander_index].original).unwrap(),
        postcard::to_allocvec(&untouched.original).unwrap()
    );
    // The continuation is evaluated through the original Native law, not by
    // adding impulse Δω to an already differentiated old nlerp curve.
    let Curve::Integrated(kernel) = after.curve else {
        panic!("changed Native sphere must have a Native continuation")
    };
    assert_eq!(
        bits(kernel.native.angular_velocity),
        bits(after.value.angular_velocity)
    );
    assert_eq!(
        bits(kernel.native.linear_velocity),
        bits(after.value.linear_velocity)
    );
    assert_eq!(kernel.position_at_time(kernel.domain.start), hit_pose);
    f
}

#[test]
fn geometry_only_character_projection_does_not_reseed_or_rewrite_spinning_native_body() {
    let mut f = fixture(0.);
    let sphere_index = f.scratch.entry_index(Some(native_id(f.sphere))).unwrap();
    let original = f.scratch.entries[sphere_index];
    let curve = postcard::to_allocvec(&original.curve).unwrap();
    respond(&mut f);
    assert!(f.scratch.rows.is_empty());
    assert!(f.scratch.row_impulses.is_empty());
    let after = f.scratch.entries[sphere_index];
    assert_eq!(postcard::to_allocvec(&after.curve).unwrap(), curve);
    assert_eq!(
        bits(after.value.linear_velocity),
        bits(original.value.linear_velocity)
    );
    assert_eq!(
        bits(after.value.angular_velocity),
        bits(original.value.angular_velocity)
    );
}

#[test]
fn distinct_h_and_nonzero_logical_domain_preserve_original_native_remaining_seconds() {
    let body = rp::RigidBodyHandle::from_raw_parts(7, 3);
    let domain = Domain::new(64., 64.05).unwrap();
    let physical_h = 0.01875_f32;
    let source = Kernel::from_velocity_seconds(
        body,
        domain,
        physical_h,
        rp::Pose::from_translation(rp::Vector::new(2., 0.5, -1.)),
        rp::Vector::X,
        rp::Vector::X * 4.,
    )
    .unwrap();
    let saved = postcard::to_allocvec(&source).unwrap();
    assert_eq!(
        source.physical_span(domain).unwrap().to_bits(),
        physical_h.to_bits()
    );
    let suffix = Domain::new(64.01, domain.end).unwrap();
    let safe = source.position_at_time(suffix.start);
    let before = State::from_native(momentum_tests::entry(body, source).value).unwrap();
    assert!(continuation(
        body,
        Curve::Integrated(source),
        suffix,
        safe,
        before,
        before
    )
    .unwrap()
    .is_none());
    let after = State::new(
        rp::Vector::new(1.5, -0.25, 0.),
        rp::Vector::new(0.5, 3., 0.),
    )
    .unwrap();
    let continued = continuation(body, Curve::Integrated(source), suffix, safe, before, after)
        .unwrap()
        .unwrap();
    let expected_seconds = (f64::from(physical_h) * (suffix.duration() / domain.duration())) as f32;
    assert_ne!(
        expected_seconds.to_bits(),
        (suffix.duration() as f32).to_bits()
    );
    assert_eq!(
        continued.native.integration_seconds.to_bits(),
        expected_seconds.to_bits()
    );
    let native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
        body,
        0.,
        expected_seconds,
        safe,
        after.linear,
        after.angular,
    )
    .unwrap();
    assert_eq!(
        postcard::to_allocvec(&continued.native).unwrap(),
        postcard::to_allocvec(&native).unwrap()
    );
    assert_eq!(continued.domain.start, suffix.start);
    assert_eq!(continued.domain.end, suffix.end);
    assert_eq!(continued.position_at_time(suffix.start), safe);
    assert_eq!(continued.position_at_time(suffix.end), native.motion.end);
    assert_eq!(postcard::to_allocvec(&source).unwrap(), saved);
}

#[test]
fn changed_native_without_same_body_integrated_domain_cannot_invent_physical_seconds() {
    let body = rp::RigidBodyHandle::from_raw_parts(7, 3);
    let foreign = rp::RigidBodyHandle::from_raw_parts(8, 3);
    let domain = Domain::new(64., 64.05).unwrap();
    let other = Kernel::from_velocity_seconds(
        foreign,
        domain,
        0.01875,
        rp::Pose::IDENTITY,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let sources = [
        Curve::Constant {
            pose: rp::Pose::IDENTITY,
            start_time: domain.start,
            end_time: domain.end,
        },
        Curve::Integrated(other),
        Curve::Anchored {
            carrier: other,
            anchor: rp::Vector::ZERO,
            offset: rp::Vector::ZERO,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
    ];
    let before = State::new(rp::Vector::ZERO, rp::Vector::ZERO).unwrap();
    let after = State::new(rp::Vector::X, rp::Vector::ZERO).unwrap();
    let suffix = Domain::new(64.01, domain.end).unwrap();
    for source in sources {
        let saved = postcard::to_allocvec(&source).unwrap();
        assert!(
            continuation(body, source, suffix, rp::Pose::IDENTITY, before, before)
                .unwrap()
                .is_none()
        );
        assert!(matches!(
            continuation(body, source, suffix, rp::Pose::IDENTITY, before, after),
            Err(TrajectoryError::InvalidReference)
        ));
        assert_eq!(postcard::to_allocvec(&source).unwrap(), saved);
    }
}

#[test]
fn actual_same_row_seed_and_response_suffix_keep_independent_physical_and_logical_clocks() {
    let f = fixture_with_clock(10., 8., 0.05);
    let index = f.scratch.entry_index(Some(native_id(f.sphere))).unwrap();
    let Curve::Integrated(original) = f.scratch.entries[index].curve else {
        panic!()
    };
    let logical_suffix = Domain::new(f.hit.cast.safe_time, f.end).unwrap();
    let physical_suffix = original.physical_span(logical_suffix).unwrap();
    assert_ne!(
        physical_suffix.to_bits(),
        (logical_suffix.duration() as f32).to_bits()
    );
    // Reuse every original real-row/cached-seed/J/mass/inertia/raw/bystander
    // assertion, not an endpoint-only replica or a mocked physical response.
    let f = assert_actual_physical_response(f);
    let Curve::Integrated(continued) = f.scratch.entries[index].curve else {
        panic!()
    };
    assert_eq!(
        continued.native.integration_seconds.to_bits(),
        physical_suffix.to_bits()
    );
    assert_eq!(continued.domain.start, logical_suffix.start);
    assert_eq!(continued.domain.end, logical_suffix.end);
    assert!(continued.domain.start >= 8.);
    assert_eq!(
        original.native.integration_seconds.to_bits(),
        0.025_f32.to_bits()
    );
}
