//! Actual Native execution, exact recorded queries and physical dt share a clock
//! contract. The original Native solver remains the physical-state oracle.
use super::*;
use crate::physics3d::{
    solver_trajectory::{Curve, Domain, Kernel},
    world::native_id,
    BodyDesc, BodyId, BodyKind, ColliderDesc, Pose, Shape, WorldConfig,
};

fn sphere(world: &mut PhysicsWorld3d, speed: f32, ccd: bool) -> BodyId {
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                linear_velocity: [speed, 0., 0.],
                angular_velocity: [0., 3., 0.],
                can_sleep: false,
                ccd,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.1 }),
        )
        .unwrap()
}

fn physical_state(body: &rp::RigidBody) -> Vec<u8> {
    postcard::to_allocvec(&(
        *body.position(),
        *body.next_position(),
        body.linvel(),
        body.angvel(),
        body.user_force(),
        body.user_torque(),
    ))
    .unwrap()
}

#[test]
fn exact_split_tick_and_saved_queries_preserve_each_original_native_physical_fragment() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let body = sphere(&mut world, 2., false);
    let native = native_id(body);
    {
        let body = world.backend.bodies.get_mut(native).unwrap();
        body.set_additional_solver_iterations(3);
        body.add_force(rp::Vector::new(1., 2., -0.5), true);
        body.add_torque(rp::Vector::new(0.1, 0.2, -0.3), true);
    }
    world.refresh_queries();
    let mut original: rp::PhysicsWorld =
        postcard::from_bytes(&postcard::to_allocvec(&world.backend).unwrap()).unwrap();
    world.set_step_motion_enabled(true);
    world.begin_fixed_step();
    let tick = Time::from(world.config.step_seconds);
    let physical = [
        f32::from_bits(0x3ba0_902e),
        f32::from_bits(0x3c13_74ff),
        f32::from_bits(0x3db0_552a),
    ];
    assert_ne!(physical.into_iter().map(Time::from).sum::<Time>(), tick);
    let boundaries = [0., 0.004900000123456789, 0.013900062345678901, tick];
    for (i, h) in physical.into_iter().enumerate() {
        let domain = Domain::new(boundaries[i], boundaries[i + 1]).unwrap();
        world.backend.integration_parameters.dt = h;
        original.integration_parameters.dt = h;
        assert!(world.step_backend(h, domain));
        original.step_with_events(&world.contact_policies, &());
        assert_eq!(
            physical_state(&world.backend.bodies[native]),
            physical_state(&original.bodies[native]),
            "logical clock must not rescale Native dt, force or solved velocity"
        );
        assert_eq!(
            world.actual_motion_completed_time().to_bits(),
            domain.end.to_bits()
        );
        {
            let trace = world.events.2.lock().unwrap();
            assert_eq!(
                trace.precise_domain().start.to_bits(),
                domain.start.to_bits()
            );
            assert_eq!(trace.precise_domain().end.to_bits(), domain.end.to_bits());
            let rows: Vec<_> = trace.actual.iter().filter(|r| r.body == native).collect();
            assert!(!rows.is_empty());
            assert_eq!(
                rows.first().unwrap().start_time.to_bits(),
                domain.start.to_bits()
            );
            assert_eq!(
                rows.last().unwrap().end_time.to_bits(),
                domain.end.to_bits()
            );
            assert!(rows.windows(2).all(|p| p[0].end_time == p[1].start_time));
            for row in rows {
                let Curve::Integrated(kernel) = row.curve else {
                    panic!("free Native kernel")
                };
                assert_eq!(kernel.domain.start, row.start_time);
                assert_eq!(kernel.domain.end, row.end_time);
                let intervals = world.backend.integration_parameters.num_solver_iterations + 3;
                assert_eq!(
                    kernel.native.integration_seconds.to_bits(),
                    (h / intervals as f32).to_bits()
                );
            }
        }
        world.record_step_motion_segment(domain.end / tick);
    }
    assert_eq!(
        world.actual_motion_completed_time().to_bits(),
        tick.to_bits()
    );
    let exact: Vec<_> = world
        .step_motion
        .segments
        .iter()
        .filter_map(|s| s.exact.as_ref().map(|e| (s, e)))
        .collect();
    assert!(!exact.is_empty());
    assert_eq!(exact.first().unwrap().0.start_fraction, 0.);
    assert_eq!(exact.last().unwrap().0.end_fraction, 1.);
    assert_eq!(exact.last().unwrap().1.end_time.to_bits(), tick.to_bits());
    assert!(exact
        .windows(2)
        .all(|p| p[0].1.end_time == p[1].1.start_time
            && p[0].0.end_fraction == p[1].0.start_fraction));
    // The saved motion consumes already-certified global domains without a
    // second clock shift or a per-backend-pass fraction renormalization.
    for (segment, exact) in exact {
        assert_eq!(
            segment.start_fraction.to_bits(),
            (exact.start_time / tick).to_bits()
        );
        assert_eq!(
            segment.end_fraction.to_bits(),
            (exact.end_time / tick).to_bits()
        );
    }
    world.finish_fixed_step();
    assert!(world.step_motion.ready);
    assert!(!world.step_motion.exact_failed);
}

#[test]
fn actual_ccd_subpasses_share_nonzero_tick_origin_with_prepared_clamps_and_saved_motion() {
    let mut world = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let body = sphere(&mut world, 80., true);
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [2., 0., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [0.1, 2., 2.],
            }),
        )
        .unwrap();
    world.backend.integration_parameters.max_ccd_substeps = 4;
    world.refresh_queries();
    world.set_step_motion_enabled(true);
    world.begin_fixed_step();
    let tick = Time::from(world.config.step_seconds);
    let split = 0.019_000_000_123_456_79;
    let first = Domain::new(0., split).unwrap();
    world.backend.integration_parameters.dt = split as f32;
    assert!(world.step_backend(split as f32, first));
    world.record_step_motion_segment(split / tick);
    let domain = Domain::new(split, tick).unwrap();
    let h = domain.duration() as f32;
    world.backend.integration_parameters.dt = h;
    assert!(world.step_backend(h, domain));
    assert_eq!(
        world.actual_motion_completed_time().to_bits(),
        tick.to_bits()
    );
    {
        let trace = world.events.2.lock().unwrap();
        assert!(
            trace.precise_passes.len() >= 2,
            "actual Native CCD must split the second pass"
        );
        assert_eq!(
            trace.precise_passes.first().unwrap().start.to_bits(),
            split.to_bits()
        );
        assert_eq!(
            trace.precise_passes.last().unwrap().end.to_bits(),
            tick.to_bits()
        );
        assert!(trace
            .precise_passes
            .windows(2)
            .all(|p| p[0].end == p[1].start));
        let rows: Vec<_> = trace
            .actual
            .iter()
            .filter(|r| r.body == native_id(body))
            .collect();
        assert!(!rows.is_empty());
        assert_eq!(rows.first().unwrap().start_time.to_bits(), split.to_bits());
        assert_eq!(rows.last().unwrap().end_time.to_bits(), tick.to_bits());
        assert!(rows.windows(2).all(|p| p[0].end_time == p[1].start_time));
        assert!(
            rows.iter()
                .any(|r| matches!(r.curve, Curve::Constant { .. })),
            "prepared CCD retains its original clipped constant suffix"
        );
    }
    world.record_step_motion_segment(1.);
    assert!(world.body_state(body).unwrap().pose.position[0] < 1.81);
    world.finish_fixed_step();
    assert!(world.step_motion.ready);
    assert!(!world.step_motion.exact_failed);
}

#[test]
fn logical_partitions_keep_exact_parent_bits_and_native_suffix_uses_original_physical_h() {
    let domain = Domain::new(0.019_000_000_123_456_79, Time::from(0.1_f32)).unwrap();
    for n in [1, 3, 4, 32, 36, 64] {
        let parts: Vec<_> = (0..n).map(|i| domain.partition(i, n).unwrap()).collect();
        assert_eq!(
            parts.first().unwrap().start.to_bits(),
            domain.start.to_bits()
        );
        assert_eq!(parts.last().unwrap().end.to_bits(), domain.end.to_bits());
        assert!(parts
            .windows(2)
            .all(|p| p[0].end.to_bits() == p[1].start.to_bits()));
    }
    assert!(domain.partition(0, 0).is_err());
    assert!(domain.partition(3, 3).is_err());
    let h = 0.025_f32;
    let native = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
        rp::RigidBodyHandle::invalid(),
        0.,
        h,
        rp::Pose::IDENTITY,
        rp::Vector::new(1., 2., 3.),
        rp::Vector::Y * 4.,
    )
    .unwrap();
    let original = postcard::to_allocvec(&native).unwrap();
    let source = Kernel::from_native(native, domain).unwrap();
    assert_eq!(source.physical_span(domain).unwrap().to_bits(), h.to_bits());
    let suffix = Domain::new(domain.boundary(2, 3).unwrap(), domain.end).unwrap();
    let suffix_h = source.physical_span(suffix).unwrap();
    assert_ne!(suffix_h.to_bits(), (suffix.duration() as f32).to_bits());
    let pose = source.position_at_time(suffix.start);
    let after = Kernel::from_velocity_seconds(
        native.motion.body,
        suffix,
        suffix_h,
        pose,
        rp::Vector::X * 3.,
        rp::Vector::Y * 4.,
    )
    .unwrap();
    assert_eq!(after.domain.start.to_bits(), suffix.start.to_bits());
    assert_eq!(after.domain.end.to_bits(), domain.end.to_bits());
    assert_eq!(
        after.native.integration_seconds.to_bits(),
        suffix_h.to_bits()
    );
    assert_eq!(after.native.angular_velocity, native.angular_velocity);
    assert_eq!(postcard::to_allocvec(&source.native).unwrap(), original);
    assert!(source
        .physical_span(Domain::new(0., domain.end).unwrap())
        .is_err());
    assert!(source
        .physical_span(Domain::new(domain.end, domain.end).unwrap())
        .is_err());
}
