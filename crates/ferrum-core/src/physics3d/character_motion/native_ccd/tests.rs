use super::*;
use crate::physics3d::{
    solver_trajectory::{Domain, Kernel},
    BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Shape, WorldConfig,
};
use rapier3d::pipeline::{SolverMotionBody, SolverMotionWriteError};
struct View<'a> {
    world: &'a PhysicsWorld3d,
    rows: Vec<SolverMotionBody>,
    dt: f32,
}
impl SolverMotionContext for View<'_> {
    fn bodies(&self) -> &rp::RigidBodySet {
        &self.world.backend.bodies
    }
    fn colliders(&self) -> &rp::ColliderSet {
        &self.world.backend.colliders
    }
    fn start_time(&self) -> f32 {
        0.
    }
    fn end_time(&self) -> f32 {
        self.dt
    }
    fn precise_start_time(&self) -> Time {
        0.
    }
    fn precise_end_time(&self) -> Time {
        Time::from(self.dt)
    }
    fn is_last_interval(&self) -> bool {
        true
    }
    fn prescribed_motion_resolved(&self, _: usize) -> Option<bool> {
        Some(false)
    }
    fn body_count(&self) -> usize {
        self.rows.len()
    }
    fn body(&self, i: usize) -> Option<SolverMotionBody> {
        self.rows.get(i).copied()
    }
    fn write_body(&mut self, _: usize, _: SolverMotionBody) -> Result<(), SolverMotionWriteError> {
        Err(SolverMotionWriteError::Index)
    }
    fn write_bodies(
        &mut self,
        _: &[(usize, SolverMotionBody)],
    ) -> Result<(), SolverMotionWriteError> {
        Err(SolverMotionWriteError::Index)
    }
}
fn kernel(body: rp::RigidBodyHandle, start: rp::Pose, from: Time, to: Time) -> Kernel {
    Kernel::from_velocity(
        body,
        Domain::new(from, to).unwrap(),
        start,
        rp::Vector::new(0.3, 0., 0.),
        rp::Vector::new(0., 0., 7.5),
    )
    .unwrap()
}
fn cut(body: rp::RigidBodyHandle, curve: Curve, time: Time) -> SolverCcdClamp {
    SolverCcdClamp {
        body,
        moving: rp::ColliderHandle::from_raw_parts(0, 0),
        target: rp::ColliderHandle::from_raw_parts(1, 0),
        end: curve.com_pose(time),
        cutoff_time: time,
        point: rp::Vector::ZERO,
        normal: rp::Vector::Y,
    }
}
#[test]
fn clipping_preserves_original_kernel_domain_and_end_law() {
    let body = rp::RigidBodyHandle::from_raw_parts(0, 0);
    let original = kernel(body, rp::Pose::IDENTITY, 0., 0.1);
    let curve = Curve::Integrated(original);
    let mut plan = SolverCcdPlan {
        covered: true,
        ..Default::default()
    };
    plan.clamps.push(cut(body, curve, 0.043));
    let source = [AcceptedCurve {
        body,
        curve,
        start_time: 0.,
        end_time: 0.1,
    }];
    let before = crate::checkpoint_codec::encode(&original).unwrap();
    let mut out = Vec::new();
    let mut work = Work {
        used: 0,
        limit: u64::MAX,
    };
    clip_curves(&plan, &source, &mut out, &mut work, 1 << 20).unwrap();
    assert_eq!(out.len(), 2);
    let Curve::Integrated(retained) = out[0].curve else {
        panic!("original kernel required")
    };
    assert_eq!(crate::checkpoint_codec::encode(&retained).unwrap(), before);
    assert_eq!(out[0].end_time, 0.043);
    assert_eq!(out[1].start_time, 0.043);
    assert_eq!(out[1].end_time, 0.1);
    assert_eq!(out[1].curve.com_pose(0.1), curve.com_pose(0.043));
    assert_eq!(out[0].curve.com_pose(0.02), curve.com_pose(0.02));
    let requested = work.used;
    assert!(requested > 0);
    let mut exact = Work {
        used: 0,
        limit: requested,
    };
    clip_curves(&plan, &source, &mut out, &mut exact, 1 << 20).unwrap();
    assert_eq!(exact.used, requested);
    let mut short = Work {
        used: 0,
        limit: requested - 1,
    };
    assert_eq!(
        clip_curves(&plan, &source, &mut out, &mut short, 1 << 20),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(crate::checkpoint_codec::encode(&original).unwrap(), before);
}
#[test]
fn private_cutoff_does_not_roundtrip_through_fraction_one() {
    let body = rp::RigidBodyHandle::from_raw_parts(0, 0);
    let duration = Time::from(0.01f32);
    let original = kernel(body, rp::Pose::IDENTITY, 0., duration);
    let time = duration * (1. - 1e-9);
    assert_eq!((time / duration) as f32, 1.);
    let curve = Curve::Integrated(original);
    let mut plan = SolverCcdPlan {
        covered: true,
        ..Default::default()
    };
    plan.clamps.push(cut(body, curve, time));
    let mut out = Vec::new();
    let mut work = Work {
        used: 0,
        limit: 1 << 20,
    };
    clip_curves(
        &plan,
        &[AcceptedCurve {
            body,
            curve,
            start_time: 0.,
            end_time: duration,
        }],
        &mut out,
        &mut work,
        1 << 20,
    )
    .unwrap();
    assert!(out[0].end_time < duration);
    assert_eq!(out[0].end_time, time);
    assert_eq!(out[1].start_time, time);
}
fn fixture(
    bullet: bool,
) -> (
    PhysicsWorld3d,
    rp::RigidBodyHandle,
    Vec<AcceptedCurve>,
    SolverMotionBody,
) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let angle = -std::f32::consts::FRAC_PI_8;
    let body = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: crate::physics3d::Pose {
                    position: [0.; 3],
                    rotation: [0., 0., (angle * 0.5).sin(), (angle * 0.5).cos()],
                },
                ccd: bullet,
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.025, 0.1],
            }),
        )
        .unwrap();
    w.create_body(
        BodyDesc {
            kind: BodyKind::Fixed,
            pose: crate::physics3d::Pose {
                position: [1.99, 0., 0.],
                ..Default::default()
            },
            ..Default::default()
        },
        ColliderDesc::new(Shape::Sphere { radius: 0.015 }),
    )
    .unwrap();
    // Run the unchanged Native producer once with zero motion so mass/CCD
    // metadata is initialized; the following plan itself never advances it.
    w.backend.step();
    let h = crate::physics3d::world::native_id(body);
    let mut pose = *w.backend.bodies[h].position();
    let velocity = rp::Vector::new(0., 0., std::f32::consts::FRAC_PI_4 / 0.1);
    let mut tracks = Vec::new();
    let d = Time::from(0.1f32);
    for i in 0..4 {
        let from = d * i as Time / 4.;
        let to = d * (i + 1) as Time / 4.;
        let k = Kernel::from_velocity(
            h,
            Domain::new(from, to).unwrap(),
            pose,
            rp::Vector::ZERO,
            velocity,
        )
        .unwrap();
        pose = k.native.motion.end;
        tracks.push(AcceptedCurve {
            body: h,
            curve: Curve::Integrated(k),
            start_time: from,
            end_time: to,
        });
    }
    let row = SolverMotionBody {
        handle: h,
        end: pose,
        linear_velocity: rp::Vector::ZERO,
        angular_velocity: velocity,
        keep_integrated_endpoint: false,
    };
    (w, h, tracks, row)
}
#[test]
fn original_four_kernels_native_plan_is_readonly_and_exactly_budgeted() {
    for bullet in [false, true] {
        let (w, h, tracks, row) = fixture(bullet);
        let view = View {
            world: &w,
            rows: vec![row],
            dt: 0.1,
        };
        let bytes = crate::checkpoint_codec::encode(&w.backend.bodies).unwrap();
        let mut output = SolverCcdPlan::default();
        let mut promotions = Vec::new();
        let mut work = Work {
            used: 0,
            limit: 1 << 25,
        };
        assert_eq!(
            plan(
                &view,
                &w.backend.integration_parameters,
                &w.contact_policies,
                &w.characters,
                &tracks,
                &[],
                &[],
                &mut output,
                &mut promotions,
                &mut work,
                1 << 24
            ),
            Ok(PlanStatus::Approved)
        );
        assert!(output.covered);
        assert_eq!(output.checks, 1);
        assert_eq!(output.clamps.len(), 1);
        assert_eq!(output.clamps[0].body, h);
        assert!(output.clamps[0].cutoff_time > 0.025 && output.clamps[0].cutoff_time < 0.05);
        assert!(output.clamps[0].end.rotation.z < 0.);
        assert_eq!(
            crate::checkpoint_codec::encode(&w.backend.bodies).unwrap(),
            bytes
        );
        let required = work.used;
        let mut exact = Work {
            used: 0,
            limit: required,
        };
        assert_eq!(
            plan(
                &view,
                &w.backend.integration_parameters,
                &w.contact_policies,
                &w.characters,
                &tracks,
                &[],
                &[],
                &mut output,
                &mut promotions,
                &mut exact,
                1 << 24
            ),
            Ok(PlanStatus::Approved)
        );
        assert_eq!(exact.used, required);
        let mut short = Work {
            used: 0,
            limit: required - 1,
        };
        assert_eq!(
            plan(
                &view,
                &w.backend.integration_parameters,
                &w.contact_policies,
                &w.characters,
                &tracks,
                &[],
                &[],
                &mut output,
                &mut promotions,
                &mut short,
                1 << 24
            ),
            Err(TrajectoryError::WorkLimit)
        );
        assert_eq!(
            crate::checkpoint_codec::encode(&w.backend.bodies).unwrap(),
            bytes
        );
    }
}

#[test]
fn pseudo_sweep_is_counted_without_a_position_or_impulse_override() {
    let (mut w, _, tracks, row) = fixture(false);
    let target = w
        .backend
        .colliders
        .iter()
        .find(|(_, c)| c.parent() != Some(row.handle))
        .map(|(h, _)| h)
        .unwrap();
    w.backend.colliders[target].set_sensor(true);
    let before = crate::checkpoint_codec::encode(&w.backend.bodies).unwrap();
    let view = View {
        world: &w,
        rows: vec![row],
        dt: 0.1,
    };
    let mut output = SolverCcdPlan::default();
    let mut promotions = Vec::new();
    let mut work = Work {
        used: 0,
        limit: 1 << 25,
    };
    assert_eq!(
        plan(
            &view,
            &w.backend.integration_parameters,
            &w.contact_policies,
            &w.characters,
            &tracks,
            &[],
            &[],
            &mut output,
            &mut promotions,
            &mut work,
            1 << 24
        ),
        Ok(PlanStatus::Approved)
    );
    assert_eq!(output.checks, 1);
    assert!(output.clamps.is_empty());
    assert!(output.crossings.is_empty());
    assert_eq!(
        crate::checkpoint_codec::encode(&w.backend.bodies).unwrap(),
        before
    );
}
#[test]
fn native_groups_reject_before_counting_the_pair_sweep() {
    let (mut w, _, tracks, row) = fixture(true);
    let target = w
        .backend
        .colliders
        .iter()
        .find(|(_, c)| c.parent() != Some(row.handle))
        .map(|(h, _)| h)
        .unwrap();
    w.backend.colliders[target].set_collision_groups(rp::InteractionGroups::none());
    let view = View {
        world: &w,
        rows: vec![row],
        dt: 0.1,
    };
    let mut output = SolverCcdPlan::default();
    let mut promotions = Vec::new();
    let mut work = Work {
        used: 0,
        limit: 1 << 25,
    };
    assert_eq!(
        plan(
            &view,
            &w.backend.integration_parameters,
            &w.contact_policies,
            &w.characters,
            &tracks,
            &[],
            &[],
            &mut output,
            &mut promotions,
            &mut work,
            1 << 24
        ),
        Ok(PlanStatus::Approved)
    );
    assert_eq!(output.checks, 0);
    assert!(output.clamps.is_empty());
}

#[test]
fn closest_prefix_bounds_the_query_without_retiming_any_original_kernel() {
    let (w, h, tracks, row) = fixture(true);
    let view = View {
        world: &w,
        rows: vec![row],
        dt: 0.1,
    };
    let moving = w.backend.bodies[h].colliders()[0];
    let (target, b) = w
        .backend
        .colliders
        .iter()
        .find(|(_, c)| c.parent() != Some(h))
        .unwrap();
    let a = &w.backend.colliders[moving];
    let d = Time::from(view.dt);
    let mut checks = 0;
    let mut work = Work {
        used: 0,
        limit: 1 << 25,
    };
    let mut cache = Moving::new(
        Source {
            collider: a,
            bodies: view.bodies(),
            tracks: &tracks,
            clamps: &[],
            domain: Domain::new(0., d).unwrap(),
        },
        &mut work,
    )
    .unwrap();
    assert!(pair_hit(
        &mut cache,
        moving,
        b,
        target,
        &w.contact_policies,
        d,
        0.005,
        &mut checks,
        &mut work
    )
    .unwrap()
    .is_some());
    let mut prefix_checks = 0;
    let mut prefix_work = Work {
        used: 0,
        limit: 1 << 25,
    };
    let mut prefix_cache = Moving::new(
        Source {
            collider: a,
            bodies: view.bodies(),
            tracks: &tracks,
            clamps: &[],
            domain: Domain::new(0., d).unwrap(),
        },
        &mut prefix_work,
    )
    .unwrap();
    assert!(pair_hit(
        &mut prefix_cache,
        moving,
        b,
        target,
        &w.contact_policies,
        d / 4.,
        0.005,
        &mut prefix_checks,
        &mut prefix_work
    )
    .unwrap()
    .is_none());
    assert!(prefix_work.used < work.used);
    assert_eq!(tracks.last().unwrap().end_time, d);
    assert!(matches!(tracks.last().unwrap().curve,Curve::Integrated(k) if k.domain.end==d));
}

#[test]
fn disabled_joint_pair_is_rejected_before_native_and_mixed_sensor_policy() {
    let (w, h, tracks, row) = fixture(true);
    let view = View {
        world: &w,
        rows: vec![row],
        dt: 0.1,
    };
    let moving = w.backend.bodies[h].colliders()[0];
    let (target, b) = w
        .backend
        .colliders
        .iter()
        .find(|(_, c)| c.parent() != Some(h))
        .unwrap();
    let target_body = b.parent().unwrap();
    let (a_id, b_id) = (id(h), id(target_body));
    let disabled = [if a_id < b_id {
        (a_id, b_id)
    } else {
        (b_id, a_id)
    }];
    let mut output = SolverCcdPlan::default();
    let mut promotions = Vec::new();
    let mut work = Work {
        used: 0,
        limit: 1 << 25,
    };
    assert_eq!(
        plan(
            &view,
            &w.backend.integration_parameters,
            &w.contact_policies,
            &w.characters,
            &tracks,
            &[],
            &disabled,
            &mut output,
            &mut promotions,
            &mut work,
            1 << 24
        ),
        Ok(PlanStatus::Approved)
    );
    assert_eq!(output.checks, 0);
    assert!(output.clamps.is_empty());
    let a = &w.backend.colliders[moving];
    let shape_motion = motion(a, tracks[0].curve, &w.backend.bodies).unwrap();
    let ca = ColliderTrajectory {
        collider: moving,
        parent: Some(h),
        role: Role::Dynamic,
        motion: shape_motion,
        bounds: a.shape().compute_aabb(a.position()),
        sensor: false,
    };
    let mb = motion(
        b,
        Curve::Constant {
            pose: *w.backend.bodies[target_body].position(),
            start_time: 0.,
            end_time: Time::from(view.dt),
        },
        &w.backend.bodies,
    )
    .unwrap();
    let cb = ColliderTrajectory {
        collider: target,
        parent: Some(target_body),
        role: Role::Fixed,
        motion: mb,
        bounds: b.shape().compute_aabb(b.position()),
        sensor: true,
    };
    assert!(sensor_pair(
        &view,
        &w.backend.integration_parameters,
        &w.contact_policies,
        &ca,
        &cb,
        &[id(h)],
        &[]
    ));
    assert!(!sensor_pair(
        &view,
        &w.backend.integration_parameters,
        &w.contact_policies,
        &ca,
        &cb,
        &[id(h)],
        &disabled
    ));
}

#[test]
fn active_native_no_hit_pass_counts_independently_of_clamps() {
    for bullet in [false, true] {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            step_seconds: 0.1,
            ..Default::default()
        })
        .unwrap();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                angular_velocity: [0., 0., std::f32::consts::FRAC_PI_4 / 0.1],
                ccd: bullet,
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [2., 0.025, 0.1],
            }),
        )
        .unwrap();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: crate::physics3d::Pose {
                    position: [50., 50., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.015 }),
        )
        .unwrap();
        w.step_checked().unwrap();
        let stats = w.step_statistics();
        assert_eq!(stats.ccd_clamps, 0);
        assert_eq!(stats.ccd_clamp_checks, 0);
        assert_eq!(stats.ccd_substeps, 1);
        assert_eq!(w.actual_motion_completed_time(), Time::from(0.1f32));
    }
}

#[test]
fn moving_preparation_is_lazy_shared_and_exactly_budgeted_without_mutating_sources() {
    use rapier3d::parry::bounding_volume::BoundingVolume;
    let (w, h, tracks, row) = fixture(true);
    let view = View {
        world: &w,
        rows: vec![row],
        dt: 0.1,
    };
    let a = &view.colliders()[view.bodies()[h].colliders()[0]];
    let d = Time::from(view.dt);
    let end = tracks[0].end_time;
    let ma = motion(a, tracks[0].curve, view.bodies()).unwrap();
    let track_payload = || {
        tracks
            .iter()
            .map(|r| (r.body, r.curve, r.start_time, r.end_time))
            .collect::<Vec<_>>()
    };
    let original = crate::checkpoint_codec::encode(&(track_payload(), &w.backend.bodies)).unwrap();
    let source = Source {
        collider: a,
        bodies: view.bodies(),
        tracks: &tracks,
        clamps: &[],
        domain: Domain::new(0., d).unwrap(),
    };
    let mut work = Work {
        used: 0,
        limit: 1 << 25,
    };
    let mut cache = Moving::new(source, &mut work).unwrap();
    let (gross, slot) = cache.gross(0, ma, 0., end, &mut work).unwrap();
    let slot = slot.unwrap();
    assert_eq!(
        gross,
        ma.bounds(
            a.shape(),
            0.,
            end,
            &mut Work {
                used: 0,
                limit: 1 << 25
            }
        )
        .unwrap()
    );
    let ends = cache.endpoints(slot, ma, 0., end, &mut work).unwrap();
    assert_eq!(
        ends.aabb,
        a.shape()
            .compute_aabb(&ma.pose(0.))
            .merged(&a.shape().compute_aabb(&ma.pose(end)))
    );
    let axes = cache.axes(slot, &mut work).unwrap();
    let required = work.used;
    let before = work.used;
    assert_eq!(cache.gross(0, ma, 0., end, &mut work).unwrap().0, gross);
    assert_eq!(
        work.used - before,
        8,
        "only the fixed key scan was executed"
    );
    let before = work.used;
    cache.endpoints(slot, ma, 0., end, &mut work).unwrap();
    assert_eq!(cache.axes(slot, &mut work).unwrap(), axes);
    assert_eq!(work.used, before);
    let mut exact = Work {
        used: 0,
        limit: required,
    };
    let mut cache = Moving::new(source, &mut exact).unwrap();
    let slot = cache.gross(0, ma, 0., end, &mut exact).unwrap().1.unwrap();
    cache.endpoints(slot, ma, 0., end, &mut exact).unwrap();
    assert_eq!(cache.axes(slot, &mut exact).unwrap(), axes);
    assert_eq!(exact.used, required);
    let mut short = Work {
        used: 0,
        limit: required - 1,
    };
    let mut cache = Moving::new(source, &mut short).unwrap();
    let slot = cache.gross(0, ma, 0., end, &mut short).unwrap().1.unwrap();
    cache.endpoints(slot, ma, 0., end, &mut short).unwrap();
    assert_eq!(
        cache.axes(slot, &mut short),
        Err(TrajectoryError::WorkLimit)
    );
    short.limit = required;
    let before = short.used;
    assert_eq!(cache.axes(slot, &mut short).unwrap(), axes);
    assert_eq!(short.used - before, 128, "a rejected prep was not cached");
    assert_eq!(
        crate::checkpoint_codec::encode(&(track_payload(), &w.backend.bodies)).unwrap(),
        original
    );
}

#[test]
fn clipped_interval_keys_and_eight_slot_eviction_only_recompute_original_bounds() {
    let (w, h, tracks, row) = fixture(true);
    let view = View {
        world: &w,
        rows: vec![row],
        dt: 0.1,
    };
    let a = &view.colliders()[view.bodies()[h].colliders()[0]];
    let end = tracks[0].end_time;
    let ma = motion(a, tracks[0].curve, view.bodies()).unwrap();
    let mut work = Work {
        used: 0,
        limit: 1 << 25,
    };
    let mut cache = Moving::new(
        Source {
            collider: a,
            bodies: view.bodies(),
            tracks: &tracks,
            clamps: &[],
            domain: Domain::new(0., Time::from(view.dt)).unwrap(),
        },
        &mut work,
    )
    .unwrap();
    let (original, slot) = cache.gross(0, ma, 0., end, &mut work).unwrap();
    let slot = slot.unwrap();
    let old = cache.endpoints(slot, ma, 0., end, &mut work).unwrap();
    let cut = end * 0.5;
    let newslot = cache.gross(0, ma, 0., cut, &mut work).unwrap().1.unwrap();
    assert_ne!(slot, newslot);
    let clipped = cache.endpoints(newslot, ma, 0., cut, &mut work).unwrap();
    assert_ne!(
        old.end.rotation.to_array().map(f32::to_bits),
        clipped.end.rotation.to_array().map(f32::to_bits)
    );
    for i in 1..10 {
        cache
            .gross(0, ma, 0., end * i as Time / 10., &mut work)
            .unwrap();
    }
    let before = work.used;
    let (recomputed, _) = cache.gross(0, ma, 0., end, &mut work).unwrap();
    assert!(work.used - before > 8);
    assert_eq!(recomputed, original);
    // A fresh owner scope invalidates the same ordinal when the accepted
    // force/velocity kernel changes, even with the same collider and bounds.
    let Curve::Integrated(oldk) = tracks[0].curve else {
        unreachable!()
    };
    let freshk = Kernel::from_velocity(
        h,
        oldk.domain,
        oldk.native.motion.start,
        rp::Vector::X * 100.,
        oldk.native.angular_velocity,
    )
    .unwrap();
    let freshtracks = [AcceptedCurve {
        body: h,
        curve: Curve::Integrated(freshk),
        start_time: 0.,
        end_time: end,
    }];
    let freshmotion = motion(a, freshtracks[0].curve, view.bodies()).unwrap();
    let mut fresh = Moving::new(
        Source {
            collider: a,
            bodies: view.bodies(),
            tracks: &freshtracks,
            clamps: &[],
            domain: Domain::new(0., end).unwrap(),
        },
        &mut work,
    )
    .unwrap();
    let (newgross, _) = fresh.gross(0, freshmotion, 0., end, &mut work).unwrap();
    assert_eq!(
        newgross,
        freshmotion
            .bounds(
                a.shape(),
                0.,
                end,
                &mut Work {
                    used: 0,
                    limit: 1 << 25
                }
            )
            .unwrap()
    );
    assert_ne!(newgross, original);
}

#[test]
fn separated_end_pose_nominates_a_plane_but_cannot_hide_a_real_interior_hit() {
    use rapier3d::parry::bounding_volume::BoundingVolume;
    let (w, h, _, row) = fixture(true);
    let d = Time::from(0.1_f32);
    let k = Kernel::from_velocity(
        h,
        Domain::new(0., d).unwrap(),
        *w.backend.bodies[h].position(),
        rp::Vector::ZERO,
        rp::Vector::Z * (std::f32::consts::FRAC_PI_4 / 0.1),
    )
    .unwrap();
    let tracks = [AcceptedCurve {
        body: h,
        curve: Curve::Integrated(k),
        start_time: 0.,
        end_time: d,
    }];
    let view = View {
        world: &w,
        rows: vec![SolverMotionBody {
            end: k.native.motion.end,
            ..row
        }],
        dt: 0.1,
    };
    let a = &view.colliders()[view.bodies()[h].colliders()[0]];
    let b = view
        .colliders()
        .iter()
        .find(|(_, b)| b.parent() != Some(h))
        .unwrap()
        .1;
    let ma = motion(a, tracks[0].curve, view.bodies()).unwrap();
    let mb = motion(
        b,
        Curve::Constant {
            pose: b
                .position()
                .prepend_translation(view.bodies()[b.parent().unwrap()].local_center_of_mass()),
            start_time: 0.,
            end_time: d,
        },
        view.bodies(),
    )
    .unwrap();
    assert!(!a
        .shape()
        .compute_aabb(&ma.pose(d))
        .loosened(0.005)
        .intersects(&b.shape().compute_aabb(&mb.pose(d))));
    let mut work = Work {
        used: 0,
        limit: 1 << 25,
    };
    let mut cache = Moving::new(
        Source {
            collider: a,
            bodies: view.bodies(),
            tracks: &tracks,
            clamps: &[],
            domain: Domain::new(0., d).unwrap(),
        },
        &mut work,
    )
    .unwrap();
    let slot = cache.gross(0, ma, 0., d, &mut work).unwrap().1.unwrap();
    assert!(!separated_prepared(
        &mut cache,
        slot,
        ma,
        a.shape(),
        mb,
        b.shape(),
        0.,
        d,
        0.005,
        &mut work
    )
    .unwrap());
    let before = work.used;
    cache.axes(slot, &mut work).unwrap();
    assert_eq!(work.used, before, "the end-face stage was reached");
    let hit = solver_trajectory::cast_full_shapes_policy(
        ma,
        a.shape(),
        mb,
        b.shape(),
        0.,
        d,
        0.005,
        tolerance(ma).min(tolerance(mb)),
        &mut work,
        true,
    )
    .unwrap()
    .unwrap();
    assert!(hit.hit_time > 0. && hit.hit_time < d);
}

#[test]
fn target_and_clearance_are_not_part_of_cached_moving_geometry_or_results() {
    let (w, h, _, row) = fixture(true);
    let d = Time::from(0.1_f32);
    let curve = Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: 0.,
        end_time: d,
    };
    let tracks = [AcceptedCurve {
        body: h,
        curve,
        start_time: 0.,
        end_time: d,
    }];
    let view = View {
        world: &w,
        rows: vec![SolverMotionBody {
            end: rp::Pose::IDENTITY,
            ..row
        }],
        dt: 0.1,
    };
    let a = &view.colliders()[view.bodies()[h].colliders()[0]];
    let b = view
        .colliders()
        .iter()
        .find(|(_, b)| b.parent() != Some(h))
        .unwrap()
        .1;
    let ma = motion(a, curve, view.bodies()).unwrap();
    let target = |y| ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::Y * y),
            start_time: 0.,
            end_time: d,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let mut work = Work {
        used: 0,
        limit: 1 << 25,
    };
    let mut cache = Moving::new(
        Source {
            collider: a,
            bodies: view.bodies(),
            tracks: &tracks,
            clamps: &[],
            domain: Domain::new(0., d).unwrap(),
        },
        &mut work,
    )
    .unwrap();
    let slot = cache.gross(0, ma, 0., d, &mut work).unwrap().1.unwrap();
    assert!(separated_prepared(
        &mut cache,
        slot,
        ma,
        a.shape(),
        target(0.05),
        b.shape(),
        0.,
        d,
        0.005,
        &mut work
    )
    .unwrap());
    assert!(!separated_prepared(
        &mut cache,
        slot,
        ma,
        a.shape(),
        target(0.05),
        b.shape(),
        0.,
        d,
        0.02,
        &mut work
    )
    .unwrap());
    assert!(!separated_prepared(
        &mut cache,
        slot,
        ma,
        a.shape(),
        target(0.),
        b.shape(),
        0.,
        d,
        0.005,
        &mut work
    )
    .unwrap());
}

/// Captured from the physics-sandbox contacts-sensors scene: a box spinning at
/// 12.8 rad/s about 42 units inside a fixed sensor ball. Native counts this
/// pseudo sweep but never clamps at it. Proving its unused existing-overlap
/// cast previously exhausted the whole tick's proof ledger.
#[test]
fn spinning_box_deep_inside_a_sensor_is_counted_without_an_unused_cast() {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        space: crate::physics3d::Space::PlanarXy,
        gravity: [0.; 3],
        step_seconds: 1. / 60.,
        length_unit: 1.,
        ..Default::default()
    })
    .unwrap();
    let start = rp::Pose::from_parts(
        rp::Vector::new(376.24384, 344.87656, 0.),
        rp::Rotation::from_xyzw(0., 0., 0.684713, 0.7288128),
    );
    let body = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Dynamic,
                pose: crate::physics3d::Pose {
                    position: start.translation.to_array(),
                    rotation: start.rotation.to_array(),
                },
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [20., 20., 29.284271],
            }),
        )
        .unwrap();
    let sensor = w
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: crate::physics3d::Pose {
                    position: [400., 284., 0.],
                    ..Default::default()
                },
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 82. }),
        )
        .unwrap();
    let h = crate::physics3d::world::native_id(body);
    let target = w.backend.bodies[crate::physics3d::world::native_id(sensor)].colliders()[0];
    w.backend.colliders[target].set_sensor(true);
    // Initialize Native mass/CCD metadata with zero motion, as the fixture does.
    w.backend.step();
    let d = Time::from(1f32 / 60.);
    let mut pose = start;
    let mut tracks = Vec::new();
    let (linear, angular) = (
        rp::Vector::new(143.68181, 200.51222, 0.),
        rp::Vector::new(0., 0., 12.828751),
    );
    for i in 0..4 {
        let from = d * i as Time / 4.;
        let to = d * (i + 1) as Time / 4.;
        let k = Kernel::from_velocity(h, Domain::new(from, to).unwrap(), pose, linear, angular)
            .unwrap();
        pose = k.native.motion.end;
        tracks.push(AcceptedCurve {
            body: h,
            curve: Curve::Integrated(k),
            start_time: from,
            end_time: to,
        });
    }
    let view = View {
        world: &w,
        rows: vec![SolverMotionBody {
            handle: h,
            end: pose,
            linear_velocity: linear,
            angular_velocity: angular,
            keep_integrated_endpoint: false,
        }],
        dt: 1. / 60.,
    };
    let mut params = w.backend.integration_parameters;
    params.dt = 1. / 60.;
    assert!(rp::solver_ccd_active(
        &w.backend.bodies[h],
        &w.backend.colliders,
        pose,
        &params
    ));
    let mut output = SolverCcdPlan::default();
    let mut promotions = Vec::new();
    let mut work = Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    };
    assert_eq!(
        plan(
            &view,
            &params,
            &w.contact_policies,
            &w.characters,
            &tracks,
            &[],
            &[],
            &mut output,
            &mut promotions,
            &mut work,
            1 << 24
        ),
        Ok(PlanStatus::Approved)
    );
    assert_eq!(output.checks, 1);
    assert!(output.clamps.is_empty() && promotions.is_empty());
    assert!(work.used < 1 << 20, "work={}", work.used);
}
