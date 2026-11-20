use super::*;
fn integration() -> SolverBodyIntegration {
    SolverBodyIntegration::from_velocity(
        rp::RigidBodyHandle::from_raw_parts(2, 3),
        0.,
        0.025,
        rp::Pose::IDENTITY,
        rp::Vector::new(0.3, -0.2, 0.1),
        rp::Vector::Z * 7.,
    )
    .unwrap()
}
#[test]
fn exact_trace_preserves_original_serialized_endpoint_bytes_and_observation_count() {
    let m = integration();
    let mut old = MotionTrace::default();
    let mut exact = MotionTrace::default();
    for trace in [&mut old, &mut exact] {
        trace.reset(true);
        trace.begin_pass(0.1);
    }
    old.record(m.motion);
    exact.record_integration(m);
    assert_eq!(old.motions.len(), 1);
    assert_eq!(exact.motions.len(), 1);
    assert_eq!(exact.integrations.len(), 1);
    assert_eq!(
        postcard::to_allocvec(&old).unwrap(),
        postcard::to_allocvec(&exact).unwrap()
    );
    let bytes = postcard::to_allocvec(&exact).unwrap();
    let restored: MotionTrace = postcard::from_bytes(&bytes).unwrap();
    assert!(restored.integrations.is_empty());
    assert!(restored.accepted_clamps.is_empty());
    assert!(!restored.integration_capacity_failed);
}
#[test]
fn exact_trace_interval_capacity_is_explicit_and_keeps_legacy_observations() {
    let m = integration();
    let mut trace = MotionTrace::default();
    trace.begin_pass(0.1);
    trace.record_integration_bounded(m, 1);
    assert!(!trace.integration_capacity_failed);
    assert_eq!(trace.integrations.len(), 1);
    trace.record_integration_bounded(m, 1);
    assert!(trace.integration_capacity_failed);
    assert_eq!(trace.integrations.len(), 1);
    assert_eq!(trace.motions.len(), 2);
    trace.reset(true);
    trace.record_integration_bounded(m, 0);
    assert!(trace.integration_capacity_failed);
    assert!(trace.integrations.is_empty());
}
#[test]
fn exact_trace_repeated_ccd_clamps_retain_latest_original_sweep_and_nested_duration() {
    use rapier3d::parry::query::sweep_toi::Sweep;
    let body = rp::RigidBodyHandle::from_raw_parts(4, 2);
    let start = rp::Pose::IDENTITY;
    let end = rp::Pose::from_parts(
        rp::Vector::X,
        rp::Rotation::from_scaled_axis(rp::Vector::Z * 2.),
    );
    let first = Sweep::from_poses(&start, &end, rp::Vector::ZERO);
    let mid = first.transform_at(0.4);
    let second = Sweep::from_poses(&start, &mid, rp::Vector::ZERO);
    let final_pose = second.transform_at(0.5);
    let mut trace = MotionTrace::default();
    trace.begin_pass(0.1);
    trace.accepted_clamp(body, start, mid, &first, 0.4);
    trace.accepted_clamp(body, start, final_pose, &second, 0.5);
    trace.sort();
    assert_eq!(trace.clamps.len(), 1);
    assert_eq!(trace.clamps[0].fraction, 0.4 * 0.5);
    assert_eq!(trace.accepted_clamps.len(), 1);
    let exact = &trace.accepted_clamps[0];
    assert_eq!(exact.sweep, second);
    assert_eq!(exact.end_time, f64::from(0.1_f32) * f64::from(0.4_f32));
    assert_eq!(exact.fraction, 0.5);
    assert_eq!(exact.sweep.transform_at(exact.fraction), final_pose);
    assert_ne!(first.transform_at(0.4 * 0.5).rotation, final_pose.rotation);
}

#[test]
fn precise_trace_passes_shift_actual_domain_without_changing_native_observer_or_wire() {
    use crate::physics3d::solver_trajectory::{Curve, Domain, Kernel};
    let native = integration();
    let domain = Domain::new(0., f64::from(native.integration_seconds)).unwrap();
    let mut trace = MotionTrace::default();
    trace.reset(true);
    for _ in 0..2 {
        trace.begin_precise_pass(0.025, domain.end);
        trace.record_curve(AcceptedCurve {
            body: native.motion.body,
            curve: Curve::Integrated(Kernel::from_native(native, domain).unwrap()),
            start_time: domain.start,
            end_time: domain.end,
        });
    }
    assert_eq!(trace.actual.len(), 2);
    assert_eq!(trace.actual[0].end_time, trace.actual[1].start_time);
    assert_eq!(
        trace.actual[1].end_time,
        2. * f64::from(native.integration_seconds)
    );
    assert_eq!(trace.precise_elapsed(), trace.actual[1].end_time);
    for row in &trace.actual {
        let Curve::Integrated(kernel) = row.curve else {
            unreachable!()
        };
        assert_eq!(
            postcard::to_allocvec(&kernel.native.motion).unwrap(),
            postcard::to_allocvec(&native.motion).unwrap()
        );
        assert_eq!(
            kernel.native.integration_seconds,
            native.integration_seconds
        );
        assert_eq!(kernel.position_at_time(row.start_time), native.motion.start);
        assert_eq!(kernel.position_at_time(row.end_time), native.motion.end);
    }
    let bytes = postcard::to_allocvec(&trace).unwrap();
    let decoded: MotionTrace = postcard::from_bytes(&bytes).unwrap();
    assert!(decoded.actual.is_empty());
    assert!(decoded.precise_passes.is_empty());
    assert_eq!(decoded.precise_elapsed(), 0.);
    assert_eq!(postcard::to_allocvec(&decoded).unwrap(), bytes);
}
