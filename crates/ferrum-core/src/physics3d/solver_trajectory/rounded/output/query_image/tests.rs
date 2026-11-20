use super::*;
fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn motion(x: f32) -> ShapeMotion {
    ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::X * x),
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn context<'a>(
    a: ShapeMotion,
    sa: &'a dyn rp::Shape,
    b: ShapeMotion,
    sb: &'a dyn rp::Shape,
) -> Context<'a> {
    Context {
        a,
        sa,
        b,
        sb,
        start: 0.,
        end: 1.,
        clearance: 0.01,
    }
}

#[test]
fn completed_output_images_are_reused_without_repeating_native_geometry() {
    let a = rp::SharedShape::cuboid(0.25, 0.25, 0.25);
    let b = rp::SharedShape::ball(0.25);
    for x in [0.25, 3.] {
        let ctx = context(motion(0.), a.as_ref(), motion(x), b.as_ref());
        let prepared = prepare(ctx, &mut work()).unwrap().unwrap();
        let mut cache = Cache::default();
        let mut used = work();
        let result = cache
            .clear(
                &prepared.a,
                ctx.sa,
                &prepared.b,
                ctx.sb,
                ctx.clearance,
                &mut used,
            )
            .unwrap();
        assert_eq!(result, Some(x > 1.));
        let first = used.used;
        assert!(first > 1);
        assert_eq!(
            cache
                .clear(
                    &prepared.a,
                    ctx.sa,
                    &prepared.b,
                    ctx.sb,
                    ctx.clearance,
                    &mut used
                )
                .unwrap(),
            result
        );
        assert_eq!(used.used - first, 1);
    }
    assert!(!std::mem::needs_drop::<Cache>());
}

#[test]
fn rejected_query_reservations_do_not_install_output_results_and_exact_budget_is_shared() {
    let a = rp::SharedShape::cuboid(0.25, 0.25, 0.25);
    let b = rp::SharedShape::ball(0.25);
    let ctx = context(motion(0.), a.as_ref(), motion(0.25), b.as_ref());
    let prepared = prepare(ctx, &mut work()).unwrap().unwrap();
    let source = postcard::to_allocvec(&(ctx.a, ctx.b)).unwrap();
    let mut measured = work();
    measured.used = 31;
    let result = Cache::default()
        .clear(
            &prepared.a,
            ctx.sa,
            &prepared.b,
            ctx.sb,
            ctx.clearance,
            &mut measured,
        )
        .unwrap();
    let mut exact = Work {
        used: 31,
        limit: measured.used,
    };
    assert_eq!(
        Cache::default()
            .clear(
                &prepared.a,
                ctx.sa,
                &prepared.b,
                ctx.sb,
                ctx.clearance,
                &mut exact
            )
            .unwrap(),
        result
    );
    let mut below = Work {
        used: 31,
        limit: measured.used - 1,
    };
    let mut cache = Cache::default();
    assert_eq!(
        cache.clear(
            &prepared.a,
            ctx.sa,
            &prepared.b,
            ctx.sb,
            ctx.clearance,
            &mut below
        ),
        Err(Error::Leaf(TrajectoryError::WorkLimit))
    );
    assert!(cache.result.is_none());
    let mut empty = Work { used: 0, limit: 0 };
    assert_eq!(
        Cache::default().clear(
            &prepared.a,
            ctx.sa,
            &prepared.b,
            ctx.sb,
            ctx.clearance,
            &mut empty
        ),
        Err(Error::Preparation(TrajectoryError::WorkLimit))
    );
    let mut only_poses = Work {
        used: 0,
        limit: 1 + 2 * 8 * 32 + 1,
    };
    assert_eq!(
        Cache::default().clear(
            &prepared.a,
            ctx.sa,
            &prepared.b,
            ctx.sb,
            ctx.clearance,
            &mut only_poses
        ),
        Err(Error::Leaf(TrajectoryError::WorkLimit))
    );
    assert_eq!(
        cache
            .clear(
                &prepared.a,
                ctx.sa,
                &prepared.b,
                ctx.sb,
                ctx.clearance,
                &mut work()
            )
            .unwrap(),
        result
    );
    assert_eq!(postcard::to_allocvec(&(ctx.a, ctx.b)).unwrap(), source);
}

#[test]
fn unavailable_cartesian_output_is_only_a_decline_and_does_not_borrow_finite_input_proof() {
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let curve = Kernel::from_velocity(
        rp::RigidBodyHandle::invalid(),
        crate::physics3d::solver_trajectory::Domain::new(0., 1.).unwrap(),
        rp::Pose::IDENTITY,
        rp::Vector::X,
        rp::Vector::Y,
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(curve),
        ..motion(0.)
    };
    let ctx = context(a, shape.as_ref(), motion(3.), shape.as_ref());
    let prepared = prepare(ctx, &mut work()).unwrap().unwrap();
    let mut cache = Cache::default();
    let mut used = work();
    assert_eq!(
        cache
            .clear(
                &prepared.a,
                ctx.sa,
                &prepared.b,
                ctx.sb,
                ctx.clearance,
                &mut used
            )
            .unwrap(),
        None
    );
    let first = used.used;
    assert_eq!(
        cache
            .clear(
                &prepared.a,
                ctx.sa,
                &prepared.b,
                ctx.sb,
                ctx.clearance,
                &mut used
            )
            .unwrap(),
        None
    );
    assert_eq!(used.used - first, 1);
    assert_eq!(cache.result, Some(None));
}
