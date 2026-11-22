use super::*;
use rapier3d::parry::shape::SupportMap;
use rapier3d::pipeline::{SolverBodyIntegration, SolverBodyMotion};

fn moving(center: [f32; 3], linear: [f32; 3], angular: [f32; 3]) -> ShapeMotion {
    let start = rp::Pose::from_translation(center.into());
    let omega = rp::Vector::from(angular);
    let half = omega * 0.5;
    let end = rp::Pose::from_parts(
        start.translation + rp::Vector::from(linear),
        (rp::Rotation::from_xyzw(half.x, half.y, half.z, 1.) * start.rotation).normalize(),
    );
    ShapeMotion {
        curve: Curve::Integrated(Kernel {
            native: SolverBodyIntegration {
                motion: SolverBodyMotion {
                    body: rp::RigidBodyHandle::invalid(),
                    start_time: 0.,
                    end_time: 1.,
                    start,
                    end,
                },
                integration_seconds: 1.,
                linear_velocity: linear.into(),
                angular_velocity: angular.into(),
            },
            domain: Domain { start: 0., end: 1. },
        }),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn work() -> Work {
    Work {
        used: 0,
        limit: 16 * 1024 * 1024,
    }
}

#[test]
fn anchored_polynomial_cannot_certify_regrouped_native_rounding_cells() {
    let domain = Domain {
        start: 0.012500000651925802,
        end: 0.01666666753590107,
    };
    let carrier = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        0.004166667,
        rp::Pose::from_translation(rp::Vector::Y * f32::from_bits(0x3dbbbbbb)),
        rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let driver = ShapeMotion {
        curve: Curve::Integrated(carrier),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let actor = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::Y * f32::from_bits(0xbd3bbb80),
            offset: rp::Vector::Y * f32::from_bits(0x3f87258a),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        ..driver
    };
    let floor = rp::SharedShape::cuboid(3., 0.1, 3.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.4);
    let skin = 0.01;
    let before = crate::checkpoint_codec::encode(&(carrier, actor.curve)).unwrap();

    // The old rational polynomial's minimum is positive: its Anchored center
    // uses RN(start+offset), then adds anchor in F64. This is not the actual
    // RN(RN(T+anchor)+offset) COM operation below.
    let pa = ToiProxy::from_shape(floor.as_ref()).unwrap();
    let pb = ToiProxy::from_shape(capsule.as_ref()).unwrap();
    let ma = driver.polynomial(domain.start, domain.end).unwrap();
    let mb = actor.polynomial(domain.start, domain.end).unwrap();
    for &a in pa.points() {
        for &b in pb.points() {
            let na = ma.project(a, rp::Vector::Y, ma.center);
            let nb = mb.project(b, rp::Vector::Y, ma.center);
            let an = mul(&na, &mb.denominator);
            let bn = mul(&nb, &ma.denominator);
            let denominator = mul(&ma.denominator, &mb.denominator);
            let radius = f64::from(pa.radius) + f64::from(pb.radius) + f64::from(skin);
            let separation = std::array::from_fn(|i| bn[i] - an[i] - radius * denominator[i]);
            assert!(nonnegative_bernstein(separation).unwrap());
        }
    }

    let target_y = f32::from_bits(0x3dbbbbbe);
    let time = domain.start + f64::from(target_y - carrier.native.motion.start.translation.y) * 0.5;
    let floor_pose = driver.pose(time);
    let actor_pose = actor.pose(time);
    assert_eq!(floor_pose.translation.y.to_bits(), target_y.to_bits());
    // The original closed local Box point and original Capsule core point
    // give an independent full-world-radius gap inside the unmodified skin.
    let point = floor_pose * (rp::Vector::Y * 0.1);
    let core = actor_pose * (rp::Vector::NEG_Y * 0.5);
    let world_gap = f64::from(core.y) - f64::from(0.4_f32) - f64::from(point.y);
    assert_eq!(world_gap, 0.009999990463256836);
    assert!(world_gap < f64::from(skin));
    assert!(!driver
        .analytic_separated(
            floor.as_ref(),
            actor,
            capsule.as_ref(),
            rp::Vector::Y,
            domain.start,
            domain.end,
            skin,
            &mut work(),
        )
        .unwrap());
    assert!(!driver
        .separated(
            floor.as_ref(),
            actor,
            capsule.as_ref(),
            rp::Vector::Y,
            domain.start,
            domain.end,
            skin,
            &mut work(),
        )
        .unwrap());
    assert_eq!(
        crate::checkpoint_codec::encode(&(carrier, actor.curve)).unwrap(),
        before
    );
    assert!(matches!(
        driver.analytic_separated(
            floor.as_ref(),
            actor,
            capsule.as_ref(),
            rp::Vector::Y,
            domain.start - 1.,
            domain.end,
            skin,
            &mut work(),
        ),
        Err(TrajectoryError::InvalidTime)
    ));
}

#[test]
fn full_interval_certificate_keeps_stationary_tangent_away_and_signed_directions() {
    let a = moving([0.; 3], [0.; 3], [0.; 3]);
    let shape = rp::SharedShape::ball(0.25);
    for sign in [-1., 1.] {
        let b = moving([sign * 0.5, 0., 0.], [sign * 0.1, 0.7, 0.], [0.; 3]);
        assert!(a
            .separated(
                shape.as_ref(),
                b,
                shape.as_ref(),
                rp::Vector::X * sign,
                0.,
                1.,
                0.,
                &mut work()
            )
            .unwrap());
        assert!(cast(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            0.,
            1.,
            0.,
            1e-6,
            &mut work()
        )
        .unwrap()
        .is_none());
    }
}

#[test]
fn rotating_bar_cannot_use_disjoint_endpoints_as_a_whole_interval_certificate() {
    let bar = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let capsule = rp::SharedShape::capsule_y(0.1, 0.1);
    let a = moving([0.; 3], [0.; 3], [0., 0., 8.]);
    let b = moving([0., 1.5, 0.], [0.; 3], [0.; 3]);
    for t in [0., 1.] {
        assert!(
            rapier3d::parry::query::contact(
                &a.pose(t),
                bar.as_ref(),
                &b.pose(t),
                capsule.as_ref(),
                10.
            )
            .unwrap()
            .unwrap()
            .dist
                > 0.
        );
    }
    // q(t)=normalize(0,0,4t,1), so rotation reaches pi/2 at t=1/4.
    assert!(
        rapier3d::parry::query::contact(
            &a.pose(0.25),
            bar.as_ref(),
            &b.pose(0.25),
            capsule.as_ref(),
            10.
        )
        .unwrap()
        .unwrap()
        .dist
            < 0.
    );
    assert!(!a
        .separated(
            bar.as_ref(),
            b,
            capsule.as_ref(),
            rp::Vector::Y,
            0.,
            1.,
            0.,
            &mut work()
        )
        .unwrap());
    let hit = cast(
        a,
        bar.as_ref(),
        b,
        capsule.as_ref(),
        0.,
        1.,
        0.001,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(hit.hit_time > 0. && hit.hit_time < 0.25);
    assert!(hit.safe_time <= hit.hit_time);
    assert!(hit.hit_time - hit.safe_time <= 1e-6);
    assert!(hit.contact.dist <= 0.001);
}

#[test]
fn support_certificate_checks_entire_capsule_and_original_radius() {
    let floor = rp::SharedShape::cuboid(2., 0.1, 2.);
    let capsule = rp::SharedShape::capsule_y(0.5, 0.25);
    let a = moving([0.; 3], [0.; 3], [0.; 3]);
    let b = moving([0., 0.86, 0.], [0.2, 0., 0.], [0.; 3]);
    assert!(a
        .separated(
            floor.as_ref(),
            b,
            capsule.as_ref(),
            rp::Vector::Y,
            0.,
            1.,
            0.005,
            &mut work()
        )
        .unwrap());
    let too_low = moving([0., 0.84, 0.], [0.2, 0., 0.], [0.; 3]);
    assert!(!a
        .separated(
            floor.as_ref(),
            too_low,
            capsule.as_ref(),
            rp::Vector::Y,
            0.,
            1.,
            0.,
            &mut work()
        )
        .unwrap());
}

fn assert_exact_support_work(a: ShapeMotion, b: ShapeMotion, expected_work: u64) {
    let shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let mut actual = work();
    assert!(a
        .separated(
            shape.as_ref(),
            b,
            shape.as_ref(),
            rp::Vector::X,
            0.,
            1.,
            0.,
            &mut actual
        )
        .unwrap());
    assert_eq!(actual.used, expected_work);
    let mut exact = Work {
        used: 0,
        limit: actual.used,
    };
    assert!(a
        .separated(
            shape.as_ref(),
            b,
            shape.as_ref(),
            rp::Vector::X,
            0.,
            1.,
            0.,
            &mut exact
        )
        .unwrap());
    let mut short = Work {
        used: 0,
        limit: actual.used - 1,
    };
    assert_eq!(
        a.separated(
            shape.as_ref(),
            b,
            shape.as_ref(),
            rp::Vector::X,
            0.,
            1.,
            0.,
            &mut short
        ),
        Err(TrajectoryError::WorkLimit)
    );
    assert!(short.used <= short.limit);
}

#[test]
fn support_work_exact_and_one_below_reject_before_complete_vertex_pair() {
    let constant = |x| ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::X * x),
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    // Eight vertices on each box, precharged one complete pair at a time.
    assert_exact_support_work(constant(0.), constant(2.), 1 + 8 * 8 * 128);
}

#[test]
fn integrated_support_work_admits_both_complete_clouds_at_exact_budget() {
    let a = moving([0.; 3], [0.; 3], [0.; 3]);
    let b = moving([2., 0., 0.], [0.; 3], [0.; 3]);
    // Native integration uses a complete rounded linear proof. It precharges
    // the header, both operand scopes, two eight-vertex clouds and projection.
    let expected_work = 1 + 128 + 2 * 256 + 512 + (8 + 8) * 64;
    assert_exact_support_work(a, b, expected_work);
}

#[test]
fn ccd_prefix_retains_original_sweep_time_law_instead_of_shortened_endpoint_nlerp() {
    let start = rp::Pose::IDENTITY;
    let end = rp::Pose::from_parts(
        rp::Vector::new(1., 0., 0.),
        rp::Rotation::from_scaled_axis(rp::Vector::Z * 2.),
    );
    let sweep = Sweep::from_poses(&start, &end, rp::Vector::ZERO);
    let path = ShapeMotion {
        curve: Curve::Ccd {
            sweep,
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let accepted_fraction = 0.4;
    let prefix_end = sweep.transform_at(accepted_fraction);
    let shortened = Sweep::from_poses(&start, &prefix_end, rp::Vector::ZERO);
    assert_ne!(
        path.pose(f64::from(accepted_fraction * 0.5)).rotation,
        shortened.transform_at(0.5).rotation
    );
    assert_eq!(path.pose(f64::from(accepted_fraction)), prefix_end);
}

#[test]
fn upright_rotating_support_follows_actual_anchor_arc_and_detects_intermediate_wall() {
    let carrier = match moving([0.; 3], [0.; 3], [0., 8., 0.]).curve {
        Curve::Integrated(m) => m,
        _ => unreachable!(),
    };
    let actor = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::X,
            offset: rp::Vector::Y,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let capsule = rp::SharedShape::capsule_y(0.25, 0.1);
    let wall = rp::SharedShape::cuboid(0.1, 1., 0.025);
    let target = moving([0., 1., -1.], [0.; 3], [0.; 3]);
    assert_eq!(actor.pose(0.).rotation, rp::Rotation::IDENTITY);
    assert_eq!(actor.pose(1.).rotation, rp::Rotation::IDENTITY);
    let quarter = actor.pose(0.25).translation;
    assert!(quarter.x.abs() < 1e-6 && (quarter.z + 1.).abs() < 1e-6);
    for t in [0., 1.] {
        assert!(
            rapier3d::parry::query::contact(
                &target.pose(t),
                wall.as_ref(),
                &actor.pose(t),
                capsule.as_ref(),
                10.
            )
            .unwrap()
            .unwrap()
            .dist
                > 0.
        );
    }
    let hit = cast_full_shapes(
        target,
        wall.as_ref(),
        actor,
        capsule.as_ref(),
        0.,
        1.,
        0.001,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(hit.hit_time > 0. && hit.hit_time < 0.25);
    assert_eq!(actor.pose(hit.hit_time).rotation, rp::Rotation::IDENTITY);
    let velocity = actor.point_velocity(0.25, actor.pose(0.25).translation);
    assert!(velocity.x < 0. && velocity.y == 0.);
}

#[test]
fn continuous_full_compound_cast_keeps_real_wall_leaf_and_analytical_hit_time() {
    let shape = rp::SharedShape::compound(vec![
        (
            rp::Pose::from_translation(rp::Vector::new(0., 20., 0.)),
            rp::SharedShape::cuboid(0.1, 0.5, 0.5),
        ),
        (rp::Pose::IDENTITY, rp::SharedShape::cuboid(0.1, 2., 2.)),
    ]);
    let ball = rp::SharedShape::ball(0.25);
    let a = moving([0.; 3], [0.; 3], [0.; 3]);
    let b = moving([2., 0.2, 0.], [-4., 0., 0.], [0.; 3]);
    let hit = cast_full_shapes(
        a,
        shape.as_ref(),
        b,
        ball.as_ref(),
        0.,
        1.,
        0.001,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    let expected = (2. - 0.1 - 0.25 - 0.001) / 4.;
    assert!((hit.hit_time - expected).abs() < 2e-6);
    assert!(hit.safe_time <= expected + 1e-6);
    assert_eq!(hit.subshape_a, 1);
    assert!(hit.contact.normal1.x > 0.999);
}

#[test]
fn full_mesh_and_heightfield_leaf_queries_keep_analytical_toi_and_native_source_bytes() {
    use crate::physics3d::{BodyDesc, BodyKind, ColliderDesc, PhysicsWorld3d, Shape, WorldConfig};
    for mesh in [false, true] {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..Default::default()
        })
        .unwrap();
        let geometry = if mesh {
            Shape::TriangleMesh {
                vertices: vec![[-2., 0., -2.], [2., 0., -2.], [2., 0., 2.], [-2., 0., 2.]],
                triangles: vec![[0, 2, 1], [0, 3, 2]],
            }
        } else {
            Shape::Heightfield {
                rows: 2,
                columns: 2,
                heights: vec![0.; 4],
                size: [4., 4.],
            }
        };
        let body = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Fixed,
                    ..Default::default()
                },
                ColliderDesc::new(geometry),
            )
            .unwrap();
        let backend = &world.backend.bodies[crate::physics3d::world::native_id(body)];
        let shape = world.backend.colliders[backend.colliders()[0]]
            .shared_shape()
            .clone();
        let bytes = world.capture_snapshot().unwrap();
        let ball = rp::SharedShape::ball(0.25);
        let a = moving([0.; 3], [0.; 3], [0.; 3]);
        let b = moving([0.2, 2., 0.], [0., -4., 0.], [0.; 3]);
        let hit = cast_full_shapes(
            a,
            shape.as_ref(),
            b,
            ball.as_ref(),
            0.,
            1.,
            0.001,
            1e-6,
            &mut work(),
        )
        .unwrap()
        .unwrap();
        let expected = (2. - 0.25 - 0.001) / 4.;
        assert!(
            (hit.hit_time - expected).abs() < 2e-6,
            "mesh={mesh} hit={hit:?}"
        );
        assert!(hit.contact.normal1.y > 0.999);
        assert_eq!(
            world.capture_snapshot().unwrap().encoded_bytes(),
            bytes.encoded_bytes()
        );
    }
}

#[test]
fn face_axis_certificate_covers_full_tangent_contact_without_ignoring_a_box_or_radius() {
    let floor = rp::SharedShape::cuboid(5., 0.5, 5.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let a = moving([0., -0.5, 0.], [0.; 3], [0.; 3]);
    let b = moving([0., 0.5, 0.], [0.7, 0., -0.4], [0.; 3]);
    let noisy = rp::Vector::new(0.178, 0.984, 0.).normalize();
    assert!(!a
        .separated(
            floor.as_ref(),
            b,
            capsule.as_ref(),
            noisy,
            0.,
            1.,
            0.,
            &mut work()
        )
        .unwrap());
    assert!(certified_separation(
        a,
        floor.as_ref(),
        b,
        capsule.as_ref(),
        noisy,
        0.,
        1.,
        0.,
        &mut work()
    )
    .unwrap());
    assert!(cast(
        a,
        floor.as_ref(),
        b,
        capsule.as_ref(),
        0.,
        1.,
        0.,
        1e-6,
        &mut work()
    )
    .unwrap()
    .is_none());
    let nonfit = moving([0., 0.499, 0.], [0.7, 0., -0.4], [0.; 3]);
    assert!(!certified_separation(
        a,
        floor.as_ref(),
        nonfit,
        capsule.as_ref(),
        noisy,
        0.,
        1.,
        0.,
        &mut work()
    )
    .unwrap());
    let hit = cast(
        a,
        floor.as_ref(),
        nonfit,
        capsule.as_ref(),
        0.,
        1.,
        0.,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(hit.contact.dist <= 0.);
}

#[test]
fn native_resting_overlap_is_only_preserved_by_a_continuous_nonworsening_support_bound() {
    let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let a = moving([0., 0., 0.], [0.; 3], [0.; 3]);
    let tangent = moving([0.9999, 0., 0.], [0., 0.2, 0.], [0.; 3]);
    assert!(cast_full_shapes_policy(
        a,
        box_shape.as_ref(),
        tangent,
        box_shape.as_ref(),
        0.,
        1.,
        0.,
        1e-6,
        &mut work(),
        true
    )
    .unwrap()
    .is_none());
    let deeper = moving([0.9999, 0., 0.], [-0.2, 0.2, 0.], [0.; 3]);
    let hit = cast_full_shapes_policy(
        a,
        box_shape.as_ref(),
        deeper,
        box_shape.as_ref(),
        0.,
        1.,
        0.,
        1e-6,
        &mut work(),
        true,
    )
    .unwrap()
    .unwrap();
    assert_eq!(hit.hit_time, 0.);
    assert!(hit.contact.dist < 0.);
    // Query/preview policy still asks for physical zero clearance, rather than
    // silently inheriting the native solver's existing-penetration allowance.
    assert!(cast_full_shapes(
        a,
        box_shape.as_ref(),
        tangent,
        box_shape.as_ref(),
        0.,
        1.,
        0.,
        1e-6,
        &mut work()
    )
    .unwrap()
    .is_some());
}

#[test]
fn support_certificate_checks_stored_near_unit_endpoint_instead_of_assuming_exact_unit_type() {
    let q = rp::Rotation::from_xyzw(
        0.,
        0.,
        std::f32::consts::FRAC_1_SQRT_2 * 1.000002,
        std::f32::consts::FRAC_1_SQRT_2 * 1.000002,
    );
    assert!((q.length_squared() - 1.).abs() <= 1e-5);
    let source = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let target = rp::SharedShape::ball(0.1);
    let start = rp::Pose::from_parts(rp::Vector::ZERO, q);
    let m = SolverBodyIntegration::from_velocity(
        rp::RigidBodyHandle::invalid(),
        0.,
        1.,
        start,
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(Kernel::from_native(m, Domain { start: 0., end: 1. }).unwrap()),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let actual_hi = (a.pose(0.) * rp::Vector::new(2., -0.025, 0.)).y;
    let target_y = actual_hi + 0.1 - 2e-6;
    let b = moving([0., target_y, 0.], [0.; 3], [0.; 3]);
    let normalized_hi = (a.pose(1.) * rp::Vector::new(2., -0.025, 0.)).y;
    assert!(actual_hi > target_y - 0.1 && target_y - 0.1 > normalized_hi);
    assert!(!a
        .separated(
            source.as_ref(),
            b,
            target.as_ref(),
            rp::Vector::Y,
            0.,
            1.,
            0.,
            &mut work()
        )
        .unwrap());
}

#[test]
fn endpoint_placement_cannot_spend_one_compound_leafs_overlap_in_another_leaf() {
    let shape = rp::SharedShape::compound(vec![
        (
            rp::Pose::from_translation(rp::Vector::X * -2.),
            rp::SharedShape::cuboid(0.25, 1., 1.),
        ),
        (
            rp::Pose::from_translation(rp::Vector::X * 2.),
            rp::SharedShape::cuboid(0.25, 1., 1.),
        ),
    ]);
    let ball = rp::SharedShape::ball(0.3);
    let left = rp::Pose::from_translation(rp::Vector::X * -2.);
    let right = rp::Pose::from_translation(rp::Vector::X * 2.);
    assert_eq!(
        admit_endpoint_pair(
            shape.as_ref(),
            rp::Pose::IDENTITY,
            rp::Pose::IDENTITY,
            ball.as_ref(),
            left,
            right,
            0.001,
            &mut work()
        ),
        Err(TrajectoryError::Unresolved)
    );
    let improved = rp::Pose::from_translation(rp::Vector::X * 2.1);
    assert!(admit_endpoint_pair(
        shape.as_ref(),
        rp::Pose::IDENTITY,
        rp::Pose::IDENTITY,
        ball.as_ref(),
        right,
        improved,
        0.001,
        &mut work()
    )
    .is_ok());
    let mut allowance = work();
    admit_endpoint_pair(
        shape.as_ref(),
        rp::Pose::IDENTITY,
        rp::Pose::IDENTITY,
        ball.as_ref(),
        right,
        improved,
        0.001,
        &mut allowance,
    )
    .unwrap();
    let mut exact = Work {
        used: 0,
        limit: allowance.used,
    };
    assert!(admit_endpoint_pair(
        shape.as_ref(),
        rp::Pose::IDENTITY,
        rp::Pose::IDENTITY,
        ball.as_ref(),
        right,
        improved,
        0.001,
        &mut exact
    )
    .is_ok());
    let mut short = Work {
        used: 0,
        limit: allowance.used - 1,
    };
    assert_eq!(
        admit_endpoint_pair(
            shape.as_ref(),
            rp::Pose::IDENTITY,
            rp::Pose::IDENTITY,
            ball.as_ref(),
            right,
            improved,
            0.001,
            &mut short
        ),
        Err(TrajectoryError::WorkLimit)
    );
}

#[test]
fn full_round_radius_witness_matches_the_rotating_face_and_keeps_exact_query_budgets() {
    let bar = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let capsule = rp::SharedShape::capsule_y(0.1, 0.1);
    let a = moving([0.; 3], [0.; 3], [0., 0., 8.]);
    let b = moving([0., 1.5, 0.], [0.; 3], [0.; 3]);
    // Exact old failure interval endpoint, not a more permissive clearance.
    let time = f64::from(f32::from_bits(0x3e69e8c0));
    let pose_a = a.pose(time);
    let pose_b = b.pose(time);
    let mut used = work();
    let contact =
        leaf_contact(&pose_a, bar.as_ref(), &pose_b, capsule.as_ref(), &mut used).unwrap();
    // The closest capsule segment end projects strictly inside this box face.
    let local_end = pose_a.inverse_transform_point(rp::Vector::new(0., 1.4, 0.));
    assert!(local_end.x.abs() < 2. && local_end.z.abs() < 0.1);
    let expected = local_end.y - 0.025 - 0.1;
    assert!(
        (contact.dist - expected).abs() < 4.0e-7,
        "{contact:?} expected={expected:?}"
    );
    assert!((contact.normal1 - pose_a.rotation * rp::Vector::Y).length() < 4.0e-6);
    assert!(((contact.point2 - contact.point1).dot(contact.normal1) - contact.dist).abs() < 2.0e-7);
    let mut exact = Work {
        used: 0,
        limit: used.used,
    };
    assert_eq!(
        leaf_contact(&pose_a, bar.as_ref(), &pose_b, capsule.as_ref(), &mut exact).unwrap(),
        contact
    );
    let mut below = Work {
        used: 0,
        limit: used.used - 1,
    };
    assert_eq!(
        leaf_contact(&pose_a, bar.as_ref(), &pose_b, capsule.as_ref(), &mut below),
        Err(TrajectoryError::WorkLimit)
    );
}

#[test]
fn first_actual_round_contact_keeps_signed_direction_and_short_backend_time_domains() {
    let bar = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let capsule = rp::SharedShape::capsule_y(0.1, 0.1);
    let ratio = (1.4_f64 - (0.025_f64 + 0.1 + 0.001)) / (1.4 + 0.025 + 0.1 + 0.001);
    let expected_fraction = ratio.sqrt() / 4.;
    for sign in [-1., 1.] {
        for (observer_start, observer_end) in [(0_f32, 1_f32), (0.0052500004_f32, 0.007_f32)] {
            let (start, end) = (f64::from(observer_start), f64::from(observer_end));
            let remap = |mut motion: ShapeMotion| {
                if let Curve::Integrated(ref mut integration) = motion.curve {
                    integration.native.motion.start_time = observer_start;
                    integration.native.motion.end_time = observer_end;
                    integration.domain.start = start;
                    integration.domain.end = end;
                }
                motion
            };
            let a = remap(moving([0.; 3], [0.; 3], [0., 0., sign * 8.]));
            let b = remap(moving([0., sign * 1.5, 0.], [0.; 3], [0.; 3]));
            let tolerance = f64::from((observer_end - observer_start) * 1.0e-6);
            let hit = cast(
                a,
                bar.as_ref(),
                b,
                capsule.as_ref(),
                start,
                end,
                0.001,
                tolerance,
                &mut work(),
            )
            .unwrap()
            .unwrap();
            let expected = start + (end - start) * expected_fraction;
            assert!((hit.hit_time - expected).abs() < tolerance * 2.);
            assert!(hit.safe_time <= hit.hit_time && hit.hit_time - hit.safe_time <= tolerance);
            assert!(hit.contact.dist <= 0.001);
            // Ending strictly before the contact must remain a proven no-hit.
            let before = start + (end - start) * 0.22;
            assert!(cast(
                a,
                bar.as_ref(),
                b,
                capsule.as_ref(),
                start,
                before,
                0.001,
                tolerance,
                &mut work()
            )
            .unwrap()
            .is_none());
        }
    }
}

#[test]
fn local_core_witness_preserves_the_original_plane_before_world_conversion() {
    use rapier3d::parry::query::sweep_toi::{
        proxy_distance, proxy_distance_with_local_witness, SimplexCache,
    };
    let floor = rp::SharedShape::cuboid(20., 0.1, 20.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let a = ToiProxy::from_shape(floor.as_ref()).unwrap();
    let b = ToiProxy::from_shape(capsule.as_ref()).unwrap();
    for x in [-10., 10.] {
        for z in [0., 10.] {
            let pa = rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.));
            let pb = rp::Pose::from_translation(rp::Vector::new(x, 0.51, z));
            let relative = pa.inv_mul(&pb);
            let old = proxy_distance(&relative, &a, &b, false, &mut SimplexCache::default());
            let (same, local_a, local_b) =
                proxy_distance_with_local_witness(&relative, &a, &b, &mut SimplexCache::default());
            // Existing public distance output is byte-for-value unchanged.
            assert_eq!(same.point_a, old.point_a);
            assert_eq!(same.point_b, old.point_b);
            assert_eq!(same.normal, old.normal);
            assert_eq!(same.distance.to_bits(), old.distance.to_bits());
            assert_eq!(same.iterations, old.iterations);
            assert_eq!(local_a.y, 0.1);
            assert_eq!(local_b.y, -0.25);
            let contact =
                leaf_contact(&pa, floor.as_ref(), &pb, capsule.as_ref(), &mut work()).unwrap();
            assert_eq!(contact.point1.y, 0.);
            assert_eq!(contact.point2.y, (pb.translation.y - 0.25) - 0.25);
            assert!(contact.dist <= 0.01, "{contact:?}");
            assert!((contact.dist - (pb.translation.y - 0.5)).abs() <= f32::EPSILON);
        }
    }
}

#[test]
fn actual_near_skin_clock_keeps_full_radius_contact_and_proven_prefix() {
    use rapier3d::pipeline::SolverBodyMotion;
    let floor = rp::SharedShape::cuboid(20., 0.1, 20.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    // Exact native producer curve from the failing .007-second interval.
    let a = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
            start_time: f64::from(0.0052500004_f32),
            end_time: f64::from(0.007_f32),
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Integrated(Kernel {
            native: SolverBodyIntegration {
                motion: SolverBodyMotion {
                    body: rp::RigidBodyHandle::invalid(),
                    start_time: 0.0052500004,
                    end_time: 0.007,
                    start: rp::Pose::from_translation(rp::Vector::new(-10., 0.51002383, 10.002626)),
                    end: rp::Pose::from_translation(rp::Vector::new(-10., 0.50999844, 10.003502)),
                },
                integration_seconds: 0.00175,
                linear_velocity: rp::Vector::new(0., -0.014500958, 0.4999978),
                angular_velocity: rp::Vector::ZERO,
            },
            domain: Domain {
                start: f64::from(0.0052500004_f32),
                end: f64::from(0.007_f32),
            },
        }),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let hit = cast(
        a,
        floor.as_ref(),
        b,
        capsule.as_ref(),
        f64::from(0.0052500004_f32),
        f64::from(0.007_f32),
        0.01,
        1.7499998e-9,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(hit.hit_time >= hit.safe_time && hit.hit_time - hit.safe_time <= 1.7499998e-9);
    assert!(hit.contact.dist <= 0.01);
    assert_eq!(hit.contact.point1.y, 0.);
    let at = b.pose(hit.hit_time);
    assert_eq!(hit.contact.point2.y, (at.translation.y - 0.25) - 0.25);
    assert!(a
        .separated(
            floor.as_ref(),
            b,
            capsule.as_ref(),
            rp::Vector::Y,
            0.0052500004,
            hit.safe_time,
            0.01,
            &mut work()
        )
        .unwrap());
}

#[test]
fn full_shape_row_census_retains_the_actual_round_witness_at_the_original_skin() {
    let floor = rp::SharedShape::cuboid(20., 0.1, 20.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let a = moving([0., -0.1, 0.], [0.; 3], [0.; 3]);
    let b = moving([-10., 0.51, 10.], [0.; 3], [0.; 3]);
    let mut manifold = rapier3d::parry::query::ContactManifold::<(), ()>::default();
    let mut rows = 0;
    contacts_full_shapes_with_manifold(
        a,
        floor.as_ref(),
        b,
        capsule.as_ref(),
        0.,
        0.01,
        &mut work(),
        &mut Some(&mut manifold),
        &mut |contact, _, _, _| {
            assert!(contact.dist <= 0.01);
            assert!(contact.point1.is_finite() && contact.point2.is_finite());
            rows += 1;
            Ok(())
        },
    )
    .unwrap();
    assert!(
        rows > 0,
        "an actual skin contact cannot vanish from its row census"
    );
}

#[test]
fn tight_existing_gap_uses_the_full_support_proof_instead_of_a_noisy_tangent_sign() {
    let ceiling = rp::SharedShape::cuboid(1., 0.1, 1.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    // Use the actual public tight-fit fixture arithmetic, including its tiny
    // representational contact at zero headroom; do not change its geometry.
    let y = 0.5097955;
    let roof = y + 0.5;
    let a = moving([-10., roof + 0.1, 0.], [0.; 3], [0.; 3]);
    let b = moving([-10., y, 0.], [-0.0035, 0., 0.], [0.; 3]);
    assert!(cast_policy(
        a,
        ceiling.as_ref(),
        b,
        capsule.as_ref(),
        0.,
        1.,
        0.01,
        1e-6,
        &mut work(),
        true
    )
    .unwrap()
    .is_none());
    let worse = moving([-10., y, 0.], [-0.0035, 0.001, 0.], [0.; 3]);
    assert!(cast_policy(
        a,
        ceiling.as_ref(),
        worse,
        capsule.as_ref(),
        0.,
        1.,
        0.01,
        1e-6,
        &mut work(),
        true
    )
    .unwrap()
    .is_some());
}

#[test]
fn touching_box_floor_uses_real_sat_feature_instead_of_zero_normal() {
    let floor = rp::SharedShape::cuboid(20., 0.1, 20.);
    let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let pa = rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.));
    let pb = rp::Pose::from_translation(rp::Vector::new(0., 0.5, 0.));
    let hit = leaf_contact(&pa, floor.as_ref(), &pb, box_shape.as_ref(), &mut work()).unwrap();
    assert_eq!(hit.normal1, rp::Vector::Y);
    assert_eq!(hit.dist, 0.);
    assert_eq!(hit.point1.y, 0.);
    assert_eq!(hit.point2.y, 0.);
}

#[test]
fn full_box_capsule_face_rows_preserve_tangent_without_manufacturing_upward_momentum() {
    use crate::physics3d::{
        character_dynamics::actual_impulse::{MassPolicy, Participant, Row, Scratch},
        world::native_id,
        BodyId,
    };
    let floor = rp::SharedShape::cuboid(20., 0.1, 20.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    for sign in [-1., 1.] {
        let pa = rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.));
        let pb = rp::Pose::from_translation(rp::Vector::new(-10., 0.51, sign * 10.010489));
        let motion = |pose| ShapeMotion {
            curve: Curve::Constant {
                pose,
                start_time: 0.,
                end_time: 0.,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        let mut rows = Vec::new();
        let mut manifold = rapier3d::parry::query::ContactManifold::<(), ()>::default();
        contacts_full_shapes_with_manifold(
            motion(pa),
            floor.as_ref(),
            motion(pb),
            capsule.as_ref(),
            0.,
            0.01,
            &mut work(),
            &mut Some(&mut manifold),
            &mut |contact, _, _, _| {
                assert_eq!(contact.normal1, rp::Vector::Y);
                assert!(contact.dist <= 0.01);
                rows.push(Row {
                    a: 0,
                    b: None,
                    point: contact.point2,
                    normal: contact.normal1,
                    target_velocity: rp::Vector::ZERO,
                    minimum_velocity: 0.,
                });
                Ok(())
            },
        )
        .unwrap();
        assert!(!rows.is_empty());
        let mut bodies = rp::RigidBodySet::new();
        let handle = bodies.insert(
            rp::RigidBodyBuilder::kinematic_position_based()
                .pose(pb)
                .build(),
        );
        let (slot, generation) = handle.into_raw_parts();
        let id = BodyId { slot, generation };
        assert!(bodies.get(native_id(id)).is_some());
        let mut values = [Participant {
            body: id,
            pose: pb,
            linear_velocity: rp::Vector::new(0., -0.0047626956, sign * 0.49999788),
            angular_velocity: rp::Vector::ZERO,
            mass: MassPolicy::Character(10.),
        }];
        let original = postcard::to_allocvec(&bodies).unwrap();
        Scratch::default()
            .solve(&bodies, &mut values, &rows, false, &mut work(), usize::MAX)
            .unwrap();
        assert_eq!(values[0].linear_velocity.y, 0.);
        assert_eq!(values[0].linear_velocity.z, sign * 0.49999788);
        assert_eq!(postcard::to_allocvec(&bodies).unwrap(), original);
    }
}

#[test]
fn touching_rotating_box_uses_all_features_instead_of_a_receding_single_corner() {
    let floor = rp::SharedShape::cuboid(20., 0.1, 20.);
    let shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let start = rp::Pose::from_translation(rp::Vector::new(0., 0.5, 0.));
    let end = 1. / 240.;
    let native = SolverBodyIntegration::from_velocity(
        rp::RigidBodyHandle::invalid(),
        0.,
        end,
        start,
        rp::Vector::new(0., -0.00096324645, 0.),
        rp::Vector::new(-0.010536704, 0., 0.012452472),
    )
    .unwrap();
    let a = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.)),
            start_time: 0.,
            end_time: f64::from(end),
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Integrated(
            Kernel::from_native(
                native,
                Domain {
                    start: 0.,
                    end: f64::from(end),
                },
            )
            .unwrap(),
        ),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let hit = cast_policy(
        a,
        floor.as_ref(),
        b,
        shape.as_ref(),
        0.,
        f64::from(end),
        0.,
        f64::from(end * 1e-6),
        &mut work(),
        true,
    )
    .unwrap()
    .unwrap();
    assert_eq!(hit.safe_time, 0.);
    assert_eq!(hit.hit_time, 0.);
    assert_eq!(hit.contact.dist, 0.);
    assert_eq!(hit.contact.normal1, rp::Vector::Y);
}

#[test]
fn positive_inplane_gjk_residual_cannot_replace_actual_touching_box_floor_sat_axis() {
    let floor = rp::SharedShape::cuboid(10., 0.1, 10.);
    let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let floor_pose = rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.));
    let box_pose = rp::Pose::from_parts(
        rp::Vector::new(0., f32::from_bits(0x3f000096), 0.),
        rp::Rotation::from_xyzw(-2.4860997e-6, 0., 6.477283e-6, 1.),
    );
    // This original scalar-f32 full-shape support touches y=0. The old
    // positive GJK witness was displaced only in the floor's X/Z plane.
    let support = box_pose
        * box_shape
            .as_cuboid()
            .unwrap()
            .local_support_point(box_pose.rotation.inverse() * -rp::Vector::Y);
    assert_eq!(support.y, 0.);
    let c = leaf_contact(
        &floor_pose,
        floor.as_ref(),
        &box_pose,
        box_shape.as_ref(),
        &mut work(),
    )
    .unwrap();
    assert_eq!(c.normal1, rp::Vector::Y);
    assert_eq!(c.normal2, -rp::Vector::Y);
    assert_eq!(c.dist, (c.point2 - c.point1).dot(rp::Vector::Y));
    assert_eq!(c.dist, 0.);
}

#[test]
fn actual_local_clock_resolves_first_hit_below_absolute_observer_f32_ulp() {
    let observer_start = 0.008_823_521_f32;
    let observer_end = 0.009_075_622_f32;
    let physical_h = f32::from_bits(0x39842c5f);
    let duration = f64::from(observer_end);
    let domain = Domain::new(duration * 35. / 36., duration).unwrap();
    let mut native = SolverBodyIntegration::from_velocity(
        rp::RigidBodyHandle::invalid(),
        0.,
        physical_h,
        rp::Pose::from_parts(
            rp::Vector::ZERO,
            rp::Rotation::from_xyzw(0., 0., 0.175_554_41, 0.984_469_7),
        ),
        rp::Vector::ZERO,
        rp::Vector::new(0., 0., 40.),
    )
    .unwrap();
    native.motion.start_time = observer_start;
    native.motion.end_time = observer_end;
    let kernel = Kernel::from_native(native, domain).unwrap();
    let tolerance = f64::from((observer_end - observer_start) * 1e-6);
    let next = f32::from_bits(observer_start.to_bits() + 1);
    assert!(f64::from(next - observer_start) > tolerance);
    let bar = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let a = ShapeMotion {
        curve: Curve::Integrated(kernel),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let b = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::new(1.2, 1., 0.)),
            start_time: domain.start,
            end_time: domain.end,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let hit = cast_full_shapes(
        a,
        bar.as_ref(),
        b,
        capsule.as_ref(),
        domain.start,
        domain.end,
        0.01,
        tolerance,
        &mut work(),
    )
    .unwrap()
    .expect("actual face crosses original skin within this native kernel");
    assert!(hit.safe_time < hit.hit_time);
    assert!(hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= 0.01);
    let same = leaf_contact(
        &a.pose(hit.hit_time),
        bar.as_ref(),
        &b.pose(hit.hit_time),
        capsule.as_ref(),
        &mut work(),
    )
    .unwrap();
    if same.dist <= 0.01 {
        assert_eq!(same, hit.contact);
    } else {
        // This original represented pose admits a full-shape hit before
        // the Native leaf crosses the unchanged margin. Independently
        // reconstruct one point pair in the two closed original shapes.
        let bar_point = rp::Vector::from_array([0x3fb1_6baf, 0x3ccc_cccd, 0].map(f32::from_bits));
        let cap_point = rp::Vector::from_array([0x3db2_5a49, 0xbef7_fb9f, 0].map(f32::from_bits));
        let radius = capsule.as_capsule().unwrap().radius;
        let core = capsule.as_capsule().unwrap().segment.a;
        let d = |p: rp::Vector, q: rp::Vector| {
            (0..3).fold(0_f64, |sum, i| {
                let delta = (f64::from(p[i]) - f64::from(q[i])).abs().next_up();
                (sum + (delta * delta).next_up()).next_up()
            })
        };
        assert!(bar_point
            .abs()
            .cmple(bar.as_cuboid().unwrap().half_extents)
            .all());
        assert!(d(cap_point, core) < f64::from(radius).powi(2));
        assert!(
            d(
                a.pose(hit.hit_time) * bar_point,
                b.pose(hit.hit_time) * cap_point
            ) < f64::from(0.01_f32).powi(2)
        );
        assert!(d(hit.contact.point1, hit.contact.point2) < f64::from(0.01_f32).powi(2));
        assert_eq!(hit.safe_time.next_up(), hit.hit_time);
    }
    let middle = (domain.start + domain.end) * 0.5;
    let local = (((middle - domain.start) / domain.duration()) * f64::from(physical_h)) as f32;
    assert_eq!(
        kernel.position_at_time(middle),
        native.position_at_integration_time(local)
    );
}

#[test]
fn cuboid_penetration_uses_selected_finite_face_even_when_vertex_is_on_other_boundaries() {
    use rapier3d::parry::query::details::contact_cuboid_cuboid;
    let cube = rp::Cuboid::new(rp::Vector::splat(0.5));
    for axis in 0..3 {
        for sign in [-1_f32, 1.] {
            let mut shift = rp::Vector::ZERO;
            shift[axis] = sign * 0.9999;
            let pose = rp::Pose::from_translation(shift);
            let c = contact_cuboid_cuboid(&pose, &cube, &cube, 1.).unwrap();
            let mut normal = rp::Vector::ZERO;
            normal[axis] = sign;
            assert_eq!(c.normal1, normal);
            assert_eq!(c.dist, 0.9999_f32 - 1.);
            assert_eq!((pose * c.point2 - c.point1).dot(normal), c.dist);
            for coordinate in 0..3 {
                assert!(c.point1[coordinate].abs() <= 0.5);
                assert!(c.point2[coordinate].abs() <= 0.5);
            }
        }
    }
    // A separated diagonal still uses the original closest finite features.
    let separated = rp::Pose::from_translation(rp::Vector::new(1.1, 1.1, 0.));
    let c = contact_cuboid_cuboid(&separated, &cube, &cube, 1.).unwrap();
    assert!(c.dist > 0.14 && c.dist < 0.142);
    assert!(c.normal1.x > 0.7 && c.normal1.y > 0.7);
}

#[test]
fn positive_box_faces_use_the_nearest_finite_features_not_a_distant_support_corner() {
    // The original planar-span small mover and large wall have overlapping
    // tangent faces. The wall's support corner (y=5,z=.5) is not the closest
    // point to the mover's finite face (y,z <= .1).
    let small = rp::SharedShape::cuboid(0.1, 0.1, 0.1);
    let wall = rp::SharedShape::cuboid(0.05, 5., 0.5);
    let a = rp::Pose::from_translation(rp::Vector::new(-0.155, 0., 0.));
    let b = rp::Pose::IDENTITY;
    let c = leaf_contact(&a, small.as_ref(), &b, wall.as_ref(), &mut work()).unwrap();
    assert_eq!(c.normal1, rp::Vector::X);
    assert!(c.dist > 0.00499 && c.dist < 0.00501);
    assert_eq!((c.point2 - c.point1).dot(c.normal1), c.dist);
    assert_eq!(c.point1.y, c.point2.y);
    assert_eq!(c.point1.z, c.point2.z);
    let swapped = leaf_contact(&b, wall.as_ref(), &a, small.as_ref(), &mut work()).unwrap();
    assert_eq!(swapped.normal1, -rp::Vector::X);
    assert_eq!(swapped.dist, c.dist);
    assert_eq!(swapped.normal2, -swapped.normal1);
    let mover = moving([-2., 0., 0.], [4., 0., 0.], [0.; 3]);
    let fixed = moving([0.; 3], [0.; 3], [0.; 3]);
    let hit = cast(
        mover,
        small.as_ref(),
        fixed,
        wall.as_ref(),
        0.,
        1.,
        0.0001,
        1e-6,
        &mut work(),
    )
    .unwrap()
    .unwrap();
    assert!(hit.safe_time < 0.4625 && hit.hit_time > 0.46 && hit.hit_time < 0.4625);
    assert!(hit.hit_time - hit.safe_time <= 1e-6);
    assert!(hit.contact.dist <= 0.0001);
}

#[test]
fn finite_capsule_face_witness_matches_world_gap_and_preserves_overlap_sign() {
    let floor = rp::SharedShape::cuboid(20., 0.1, 20.);
    let capsule = rp::SharedShape::capsule_y(0.3, 0.3);
    let pa = rp::Pose::from_translation(rp::Vector::new(0., -0.1, 0.));
    for x in [-10., 0., 10.] {
        for y in [0.61_f32, 0.6, 0.59] {
            let pb = rp::Pose::from_translation(rp::Vector::new(x, y, 0.010489));
            let c = leaf_contact(&pa, floor.as_ref(), &pb, capsule.as_ref(), &mut work()).unwrap();
            assert_eq!(c.normal1, rp::Vector::Y);
            assert_eq!(c.normal2, -rp::Vector::Y);
            assert_eq!(c.dist, y + (-0.3_f32 - 0.3));
            assert_eq!((c.point2 - c.point1).dot(c.normal1), c.dist);
            assert_eq!(c.point1.x, c.point2.x);
            assert_eq!(c.point1.z, c.point2.z);
            let reversed =
                leaf_contact(&pb, capsule.as_ref(), &pa, floor.as_ref(), &mut work()).unwrap();
            assert_eq!(reversed, c.flipped());
        }
    }
}

#[test]
fn original_finite_feature_query_precharges_exact_work_and_keeps_source_shapes() {
    let small = rp::SharedShape::cuboid(0.1, 0.1, 0.1);
    let wall = rp::SharedShape::cuboid(0.05, 5., 0.5);
    let a = rp::Pose::from_translation(rp::Vector::new(-0.155, 0., 0.));
    let b = rp::Pose::IDENTITY;
    let source = crate::checkpoint_codec::encode(&(a, b, &small, &wall)).unwrap();
    let mut used = work();
    let expected = leaf_contact(&a, small.as_ref(), &b, wall.as_ref(), &mut used).unwrap();
    let mut exact = Work {
        used: 0,
        limit: used.used,
    };
    assert_eq!(
        leaf_contact(&a, small.as_ref(), &b, wall.as_ref(), &mut exact).unwrap(),
        expected
    );
    assert_eq!(exact.used, used.used);
    let mut below = Work {
        used: 0,
        limit: used.used - 1,
    };
    assert_eq!(
        leaf_contact(&a, small.as_ref(), &b, wall.as_ref(), &mut below),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &small, &wall)).unwrap(),
        source
    );
}

#[test]
fn existing_tangent_contact_refines_its_certified_prefix_before_later_native_rotation() {
    let floor = rp::SharedShape::cuboid(10., 0.1, 10.);
    let ball = rp::SharedShape::ball(0.5);
    let a = moving([0., -0.1, 0.], [0.; 3], [0.; 3]);
    let carrier = Kernel::from_velocity(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        Domain::new(0., 1.).unwrap(),
        rp::Pose::IDENTITY,
        rp::Vector::ZERO,
        rp::Vector::Z,
    )
    .unwrap();
    let b = ShapeMotion {
        curve: Curve::Anchored {
            carrier,
            anchor: rp::Vector::Y,
            offset: rp::Vector::new(0., -0.49, 0.),
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let source = crate::checkpoint_codec::encode(&(a, b)).unwrap();
    let mut budget = work();
    let skin = 0.01;
    let tolerance = 1e-6;
    let initial = leaf_contact(
        &a.pose(0.),
        floor.as_ref(),
        &b.pose(0.),
        ball.as_ref(),
        &mut budget,
    )
    .unwrap();
    assert!(initial.dist > 0. && initial.dist < skin);
    assert_eq!(
        (b.point_velocity(0., initial.point2) - a.point_velocity(0., initial.point1))
            .dot(initial.normal1),
        0.
    );
    let admitted = test_initial_support_clearance(
        a,
        floor.as_ref(),
        b,
        ball.as_ref(),
        initial.normal1,
        0.,
        &mut budget,
    )
    .unwrap()
    .min(skin);
    assert!(
        leaf_contact(
            &a.pose(0.25),
            floor.as_ref(),
            &b.pose(0.25),
            ball.as_ref(),
            &mut budget,
        )
        .unwrap()
        .dist
            < 0.
    );
    let hit = cast_full_shapes_policy(
        a,
        floor.as_ref(),
        b,
        ball.as_ref(),
        0.,
        1.,
        skin,
        tolerance,
        &mut budget,
        true,
    )
    .unwrap()
    .expect("later real approach after an initially tangent rounded pose");
    assert!(
        hit.safe_time > 0.,
        "a complete unchanged prefix must not become start/start: {hit:?}"
    );
    assert!(hit.safe_time <= hit.hit_time && hit.hit_time < 0.25);
    assert!(hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= admitted);
    assert!(
        a.separated(
            floor.as_ref(),
            b,
            ball.as_ref(),
            initial.normal1,
            0.,
            hit.safe_time,
            admitted,
            &mut budget,
        )
        .unwrap(),
        "every accepted prefix still needs a complete original full-shape proof"
    );

    // Strict query policy keeps its original closed-set contact at the start.
    let strict = cast_full_shapes(
        a,
        floor.as_ref(),
        b,
        ball.as_ref(),
        0.,
        1.,
        skin,
        tolerance,
        &mut budget,
    )
    .unwrap()
    .unwrap();
    assert_eq!((strict.safe_time, strict.hit_time), (0., 0.));

    // A genuine inward initial velocity keeps the existing immediate response.
    let inward = moving([0., 0.51, 0.], [0., -0.2, 0.], [0.; 3]);
    let immediate = cast_full_shapes_policy(
        a,
        floor.as_ref(),
        inward,
        ball.as_ref(),
        0.,
        1.,
        skin,
        tolerance,
        &mut budget,
        true,
    )
    .unwrap()
    .unwrap();
    assert_eq!((immediate.safe_time, immediate.hit_time), (0., 0.));
    assert_eq!(crate::checkpoint_codec::encode(&(a, b)).unwrap(), source);
}

// Diagnostic only: the original angular first-error log's cast and response
// rows were evaluated at different logical times. Compare all three existing
// queries at exactly the same original Kernel pose before selecting a fix.
#[test]
fn angular_cuboid_sphere_same_pose_contact_comparison() {
    use rapier3d::parry::query::{DefaultQueryDispatcher, PersistentQueryDispatcher};
    let bar = rp::SharedShape::cuboid(2., 0.025, 0.1);
    let sphere = rp::SharedShape::ball(0.015);
    let target = rp::Pose::from_translation(rp::Vector::new(1.99, 0., 0.));
    let pose =
        |p: [f32; 3], z, w| rp::Pose::from_parts(p.into(), rp::Rotation::from_xyzw(0., 0., z, w));
    let captured = |domain: Domain,
                    labels: [f32; 2],
                    h,
                    start: rp::Pose,
                    end: rp::Pose,
                    linear: [f32; 3],
                    omega| ShapeMotion {
        curve: Curve::Integrated(
            Kernel::from_native(
                SolverBodyIntegration {
                    motion: SolverBodyMotion {
                        body: rp::RigidBodyHandle::from_raw_parts(0, 0),
                        start_time: labels[0],
                        end_time: labels[1],
                        start,
                        end,
                    },
                    integration_seconds: h,
                    linear_velocity: linear.into(),
                    angular_velocity: rp::Vector::new(0., 0., omega),
                },
                domain,
            )
            .unwrap(),
        ),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    // Decimal-f32 literals are the round-trip values printed by the original
    // Native kernel, including each captured endpoint; no target interpolation
    // or slerp is substituted for the original normalized-Euler law.
    let initial = captured(
        Domain::new(0.02500000037252903, 0.05000000074505806).unwrap(),
        [0.025, 0.05],
        0.025,
        pose([0.; 3], -0.09832924, 0.9951539),
        pose([0.; 3], -0.000627244, 0.99999976),
        [0.; 3],
        7.8539796,
    );
    let response = captured(
        Domain::new(0.04757931303351093, 0.05000000074505806).unwrap(),
        [0., 0.0024206878],
        0.0024206878,
        pose([0.; 3], -0.010050777, 0.9999495),
        pose([-0.0001900989, -0.009455583, 0.], -0.0076741404, 0.99997056),
        [-0.078530945, -3.9061553, 0.],
        1.9636855,
    );
    let suffix = captured(
        Domain::new(0.04845813097139218, 0.05000000074505806).unwrap(),
        [0., 0.0015418698],
        0.0015418698,
        pose([-0.00006901441, -0.0034327996, 0.], -0.009187956, 0.9999578),
        pose([-0.00019009993, -0.009455639, 0.], -0.0076741814, 0.9999706),
        [-0.078531615, -3.9061918, 0.],
        1.9636295,
    );
    for (label, a, time) in [
        ("first-safe", initial, 0.04757931303351093),
        ("first-hit", initial, 0.047579336875369194),
        ("second-safe", response, 0.04845813097139218),
        ("second-hit", response, 0.048458149439773765),
        ("suffix-start", suffix, 0.04845813097139218),
        ("suffix-middle", suffix, 0.04922906585822562),
        ("suffix-end", suffix, 0.05000000074505806),
    ] {
        let before = postcard::to_allocvec(&a).unwrap();
        let pa = a.pose(time);
        let old_cast =
            leaf_contact(&pa, bar.as_ref(), &target, sphere.as_ref(), &mut work()).unwrap();
        let mut native = rapier3d::parry::query::details::contact_convex_polyhedron_ball(
            &pa.inv_mul(&target),
            bar.as_ref(),
            sphere.as_ball().unwrap(),
            f32::MAX,
        )
        .unwrap();
        let native_relative_dist = native.dist;
        native.transform_by_mut(&pa, &target);
        let native_world_dist = (native.point2 - native.point1).dot(native.normal1);
        let mut manifold = rapier3d::parry::query::ContactManifold::<(), ()>::default();
        DefaultQueryDispatcher
            .contact_manifold_convex_convex(
                &pa.inv_mul(&target),
                bar.as_ref(),
                sphere.as_ref(),
                None,
                None,
                0.005,
                &mut manifold,
            )
            .unwrap();
        let mut rows = Vec::new();
        let b = ShapeMotion {
            curve: Curve::Constant {
                pose: target,
                start_time: time,
                end_time: time,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        };
        contacts_full_shapes_with_manifold(
            a,
            bar.as_ref(),
            b,
            sphere.as_ref(),
            time,
            0.005,
            &mut work(),
            &mut Some(&mut manifold),
            &mut |contact, _, _, _| {
                rows.push(contact);
                Ok(())
            },
        )
        .unwrap();
        let row_world_dist: Vec<_> = rows
            .iter()
            .map(|c| (c.point2 - c.point1).dot(c.normal1))
            .collect();
        eprintln!(
            "B_SAME_POSE label={label} time={time:.18e} pose={pa:?} cast={old_cast:?} native={native:?} native_relative_dist={native_relative_dist:.18e} native_world_dist={native_world_dist:.18e} rows={rows:?} row_world_dist={row_world_dist:?}"
        );
        assert!(old_cast.dist.is_finite() && native_world_dist.is_finite());
        assert_eq!(postcard::to_allocvec(&a).unwrap(), before);
    }
    let end = 0.05000000074505806;
    let b = ShapeMotion {
        curve: Curve::Constant {
            pose: target,
            start_time: 0.04845813097139218,
            end_time: end,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let mut bounded = Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    };
    let result = cast_policy(
        suffix,
        bar.as_ref(),
        b,
        sphere.as_ref(),
        0.04845813097139218,
        end,
        0.,
        f64::from((0.05_f32 - 0.025_f32) * 1e-6),
        &mut bounded,
        true,
    );
    eprintln!("B_SAME_POSE suffix_cast={result:?} work={bounded:?}");
}

#[test]
fn recorded_anchored_phase_alias_preserves_safe_pose_and_full_geometry_suffix() {
    // Pure full-shape math regression, not an Engine tick/J success claim.
    // Original C18 identity/zero-angular Native tuple. +5 is a fixed test
    // input from the independent finite-image receipt; production must derive
    // candidates from the actual obstruction/representability, never this id.
    let native = SolverBodyIntegration {
        motion: SolverBodyMotion {
            body: rp::RigidBodyHandle::from_raw_parts(0, 0),
            start_time: 0.014249997,
            end_time: 0.018999996,
            start: rp::Pose::from_translation(rp::Vector::new(0.14249997, -0.100000136, 0.)),
            end: rp::Pose::from_translation(rp::Vector::new(0.18999995, -0.10000018, 0.)),
        },
        integration_seconds: 0.004749999,
        linear_velocity: rp::Vector::new(10., -9.380261e-6, 0.),
        angular_velocity: rp::Vector::ZERO,
    };
    let domain = Domain::new(0.01424999674782157, 0.018999995663762093).unwrap();
    let carrier = Kernel::from_native(native, domain).unwrap();
    let safe = 0.015441418681002492;
    let known_hit = 0.015441423207049092;
    let skin = 0.01;
    let tolerance = f64::from(
        ((native.motion.end_time - native.motion.start_time) * 1.0e-6).max(f32::MIN_POSITIVE),
    );
    let original_anchor = rp::Vector::new(0.9999944, f32::from_bits(0x3dcc845c), 2.9802322e-6);
    let candidate_anchor = rp::Vector::new(
        original_anchor.x,
        f32::from_bits(original_anchor.y.to_bits() + 5),
        original_anchor.z,
    );
    let offset = rp::Vector::new(5.6028366e-6, 0.51013815, -2.9802322e-6);
    let shape_motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let carried = |anchor, linear_velocity| {
        shape_motion(Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation: rp::Rotation::IDENTITY,
        })
    };
    let platform = shape_motion(Curve::Integrated(carrier));
    let original = carried(original_anchor, rp::Vector::ZERO);
    let candidate = carried(candidate_anchor, rp::Vector::ZERO);
    let floor = rp::SharedShape::cuboid(2., 0.1, 2.);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let proof = || Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    };
    let contact = |motion: ShapeMotion, time| {
        leaf_contact(
            &platform.pose(time),
            floor.as_ref(),
            &motion.pose(time),
            capsule.as_ref(),
            &mut proof(),
        )
        .unwrap()
    };
    let pose_bits = |pose: rp::Pose| {
        (
            pose.translation.to_array().map(f32::to_bits),
            pose.rotation.to_array().map(f32::to_bits),
        )
    };
    let source = crate::checkpoint_codec::encode(&(
        carrier, platform, original, candidate, &floor, &capsule,
    ))
    .unwrap();
    for (time, expected) in [
        (safe, f32::from_bits(0x3c23d718)),
        (known_hit, f32::from_bits(0x3c23d6e0)),
        (domain.end, f32::from_bits(0x3c23d700)),
    ] {
        let actual = contact(original, time);
        assert_eq!(
            actual.dist.to_bits(),
            expected.to_bits(),
            "original time={time:.18e} contact={actual:?}"
        );
        assert_eq!(actual.normal1, rp::Vector::Y);
    }
    assert!(contact(original, safe).dist > skin);
    assert!(contact(original, known_hit).dist < skin);
    assert!(contact(original, domain.end).dist < skin);
    let original_hit = cast(
        platform,
        floor.as_ref(),
        original,
        capsule.as_ref(),
        safe,
        domain.end,
        skin,
        tolerance,
        &mut proof(),
    )
    .unwrap()
    .expect("original full-shape suffix really hits");
    assert!(original_hit.safe_time >= safe && original_hit.hit_time <= domain.end);
    assert!(original_hit.safe_time <= original_hit.hit_time);
    assert!(original_hit.hit_time - original_hit.safe_time <= tolerance);
    assert!(original_hit.contact.dist <= skin);
    assert_eq!(
        pose_bits(candidate.pose(safe)),
        pose_bits(original.pose(safe))
    );
    assert!(contact(candidate, known_hit).dist > skin);
    assert!(contact(candidate, known_hit).dist > contact(original, known_hit).dist);
    assert!(contact(candidate, domain.end).dist > skin);
    // This is a whole-interval assertion. Failure to certify the real curve
    // is an error, not a reason to replace it by safe/hit/end samples.
    assert!(platform
        .separated(
            floor.as_ref(),
            candidate,
            capsule.as_ref(),
            rp::Vector::Y,
            safe,
            domain.end,
            skin,
            &mut proof()
        )
        .unwrap());
    assert!(cast(
        platform,
        floor.as_ref(),
        candidate,
        capsule.as_ref(),
        safe,
        domain.end,
        skin,
        tolerance,
        &mut proof()
    )
    .unwrap()
    .is_none());
    // Real inward relative motion remains a real later collision even though
    // its initial perturbation rounds away at the exact same safe pose.
    let inward = carried(candidate_anchor, rp::Vector::Y * -1.0e-5);
    assert_eq!(
        pose_bits(inward.pose(safe)),
        pose_bits(candidate.pose(safe))
    );
    assert!(contact(inward, domain.end).dist < skin);
    assert!(!platform
        .separated(
            floor.as_ref(),
            inward,
            capsule.as_ref(),
            rp::Vector::Y,
            safe,
            domain.end,
            skin,
            &mut proof()
        )
        .unwrap());
    assert!(cast(
        platform,
        floor.as_ref(),
        inward,
        capsule.as_ref(),
        safe,
        domain.end,
        skin,
        tolerance,
        &mut proof()
    )
    .unwrap()
    .is_some());
    assert_eq!(
        crate::checkpoint_codec::encode(&(
            carrier, platform, original, candidate, &floor, &capsule
        ))
        .unwrap(),
        source
    );
}

#[test]
fn bounded_axis_plan_preserves_original_box_order_and_finite_census() {
    let a = moving([0.; 3], [0.; 3], [0.; 3]);
    let mut b = a;
    let q = rp::Rotation::from_rotation_x(0.2)
        * rp::Rotation::from_rotation_y(0.3)
        * rp::Rotation::from_rotation_z(0.4);
    b.curve = Curve::Constant {
        pose: rp::Pose::from_rotation(q),
        start_time: 0.,
        end_time: 1.,
    };
    let first = rp::Vector::new(0.2, 0.3, 0.4).normalize();
    let right = rp::Vector::new(0.4, 0.3, 0.2).normalize();
    let mut plan = SeparationAxes::single(first);
    plan.source = Some(AxisSource {
        a,
        b,
        box_a: true,
        box_b: true,
        start: 0.,
        right: Some(right),
    });
    let mut used = work();
    plan.ensure_all(&mut used).unwrap();
    assert_eq!(plan.len, MAX_SEPARATION_AXES);
    assert_eq!(used.used, 12);
    assert_eq!(plan.values[0].normal, first);
    let faces = [
        rp::Vector::X,
        -rp::Vector::X,
        rp::Vector::Y,
        -rp::Vector::Y,
        rp::Vector::Z,
        -rp::Vector::Z,
    ];
    for (i, n) in faces.into_iter().enumerate() {
        assert_eq!(plan.values[i + 1].normal, n);
        assert_eq!(plan.values[i + 7].normal, q * n);
    }
    assert_eq!(plan.values[13].normal, right);
    let once = used.used;
    plan.ensure_all(&mut used).unwrap();
    assert_eq!(used.used, once);
    assert_eq!(
        plan.push(rp::Vector::new(0.3, 0.4, 0.5)),
        Err(TrajectoryError::WorkLimit)
    );
}

struct CellCuePair {
    a: ShapeMotion,
    b: ShapeMotion,
    sa: rp::SharedShape,
    sb: rp::SharedShape,
}
fn cell_cue_pair(gravity: bool) -> CellCuePair {
    let domain = if gravity {
        Domain::new(0.004166666883975267, 0.008333333767950535).unwrap()
    } else {
        Domain::new(0.008333333767950535, 0.012500000651925802).unwrap()
    };
    let mut k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(0, 0),
        domain,
        0.004166667,
        rp::Pose::from_translation(
            rp::Vector::Y * f32::from_bits(if gravity { 0xbdbbbbbc } else { 0xbc88888c }),
        ),
        rp::Vector::Y * 2.,
        rp::Vector::ZERO,
    )
    .unwrap();
    k.native.motion.start_time = domain.start as f32;
    k.native.motion.end_time = domain.end as f32;
    let k = Kernel::from_native(k.native, domain).unwrap();
    let a = ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    CellCuePair {
        a,
        b: ShapeMotion {
            curve: Curve::Anchored {
                carrier: k,
                anchor: rp::Vector::Y
                    * f32::from_bits(if gravity { 0x3f8258bf } else { 0x3dccccdf }),
                offset: rp::Vector::Y
                    * f32::from_bits(if gravity { 0xbc088840 } else { 0x3f68f5c1 }),
                linear_velocity: if gravity {
                    rp::Vector::Y * f32::from_bits(0xbc553adf)
                } else {
                    rp::Vector::ZERO
                },
                rotation: rp::Rotation::IDENTITY,
            },
            ..a
        },
        sa: rp::SharedShape::cuboid(3., 0.1, 3.),
        sb: rp::SharedShape::capsule_y(0.5, 0.4),
    }
}
fn cell_cue_work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn observed_cell_cue(
    p: &CellCuePair,
    work: &mut Work,
) -> Result<(IntervalCertificate, usize), TrajectoryError> {
    let (start, end) = p.a.curve.times();
    let pair = world_contact::Pair::new(p.sa.as_ref(), p.sb.as_ref(), work)?.unwrap();
    let mut calls = 0;
    let mut observe = |time: Time, work: &mut Work| {
        calls += 1;
        let Some(witness) = pair.at(p.a, p.b, time, 0.01, work)? else {
            return Ok(None);
        };
        if !witness.strict {
            return Ok(None);
        }
        let native = leaf_contact(
            &p.a.pose(time),
            p.sa.as_ref(),
            &p.b.pose(time),
            p.sb.as_ref(),
            work,
        )?;
        Ok(Some(if native.dist <= 0.01 {
            native
        } else {
            witness.contact
        }))
    };
    let proof = certified_separation_axes_observed(
        p.a,
        p.sa.as_ref(),
        p.b,
        p.sb.as_ref(),
        if p.sa.as_cuboid().is_some() {
            rp::Vector::Y
        } else {
            rp::Vector::NEG_Y
        },
        None,
        start,
        end,
        0.01,
        work,
        Some(&mut observe),
    )?;
    Ok((proof, calls))
}

#[test]
fn actual_c65_cell_counter_is_a_point_cue_and_preserves_chronological_safe_prefix() {
    let original = cell_cue_pair(false);
    let (start, end) = original.a.curve.times();
    let nominated = 0.011668468825519085;
    let witness = world_contact::Pair::new(
        original.sa.as_ref(),
        original.sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap()
    .unwrap()
    .at(
        original.a,
        original.b,
        nominated,
        0.01,
        &mut cell_cue_work(),
    )
    .unwrap()
    .expect("the original forward point graph is strictly inside the selected margin");
    assert!(witness.strict && witness.contact.dist < 0.01);
    assert_eq!(
        original.a.pose(nominated).translation.y.to_bits(),
        0xbc23c7f4
    );
    assert_eq!(
        original.b.pose(nominated).translation.y.to_bits(),
        0x3f80001e
    );
    for reverse in [false, true] {
        let p = if reverse {
            CellCuePair {
                a: original.b,
                b: original.a,
                sa: original.sb.clone(),
                sb: original.sa.clone(),
            }
        } else {
            CellCuePair {
                a: original.a,
                b: original.b,
                sa: original.sa.clone(),
                sb: original.sb.clone(),
            }
        };
        let before = crate::checkpoint_codec::encode(&(p.a, p.b)).unwrap();
        let mut full = cell_cue_work();
        let (proof, calls) = observed_cell_cue(&p, &mut full).unwrap();
        let IntervalCertificate::Point { time, contact } = proof else {
            panic!("an unproved prefix must not be promoted to a whole proof: {proof:?}");
        };
        assert_eq!(calls, 1);
        assert!(time > start && time < end && contact.dist <= 0.01);
        for limit in [full.used, full.used - 1] {
            let result = observed_cell_cue(&p, &mut Work { used: 0, limit });
            if limit == full.used {
                assert!(matches!(
                    result.unwrap(),
                    (IntervalCertificate::Point { .. }, 1)
                ));
            } else {
                assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
            }
        }
        let tolerance = f64::from(0.004166667_f32 * 1e-6);
        let hit = cast_full_shapes_policy(
            p.a,
            p.sa.as_ref(),
            p.b,
            p.sb.as_ref(),
            start,
            end,
            0.01,
            tolerance,
            &mut cell_cue_work(),
            true,
        )
        .unwrap()
        .expect("a validated interior point still needs the original prefix search");
        assert!(hit.safe_time >= 0.011653646441118326);
        assert!(hit.hit_time > hit.safe_time && hit.hit_time <= nominated);
        assert!(hit.hit_time - hit.safe_time <= tolerance);
        assert!(hit.contact.dist <= 0.01);
        assert_eq!(
            crate::checkpoint_codec::encode(&(p.a, p.b)).unwrap(),
            before
        );
    }

    // The same original scalar geometry can traverse T in the opposite
    // direction. A verified point near a query's old end must narrow the end
    // and then use its midpoint, rather than repeatedly choosing that point
    // as a split which leaves an almost-full-size left child.
    let mut decreasing = cell_cue_pair(false);
    let Curve::Integrated(source) = decreasing.a.curve else {
        unreachable!()
    };
    let mut reversed_start = source.native.motion.end;
    // The old end's real world radius is already inside skin. Use this
    // adjacent clear RN cell so the decreasing control cannot pass by an
    // immediate initial hit instead of its chronological point search.
    reversed_start.translation.y = f32::from_bits(0xbc08886f);
    let mut k = Kernel::from_velocity_seconds(
        source.native.motion.body,
        source.domain,
        source.native.integration_seconds,
        reversed_start,
        -source.native.linear_velocity,
        rp::Vector::ZERO,
    )
    .unwrap();
    k.native.motion.start_time = source.native.motion.start_time;
    k.native.motion.end_time = source.native.motion.end_time;
    let k = Kernel::from_native(k.native, k.domain).unwrap();
    decreasing.a.curve = Curve::Integrated(k);
    if let Curve::Anchored { carrier, .. } = &mut decreasing.b.curve {
        *carrier = k;
    }
    let target = f32::from_bits(0xbc23c7f4);
    let dt = (k.native.motion.start.translation.y - target) * 0.5;
    let time = start + f64::from(dt);
    assert_eq!(
        decreasing.a.pose(time).translation.y.to_bits(),
        target.to_bits()
    );
    assert!(k.native.linear_velocity.y < 0.);
    let pair = world_contact::Pair::new(
        decreasing.sa.as_ref(),
        decreasing.sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap()
    .unwrap();
    let point = pair
        .at(decreasing.a, decreasing.b, time, 0.01, &mut cell_cue_work())
        .unwrap()
        .unwrap();
    assert!(point.strict);
    let near_end = time + (time - start) * 0.001;
    assert!(near_end < end && time > start + (near_end - start) * 0.99);
    let left = leaf_contact(
        &decreasing.a.pose(start),
        decreasing.sa.as_ref(),
        &decreasing.b.pose(start),
        decreasing.sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    assert!(left.dist > 0.01);
    assert!(pair
        .at(
            decreasing.a,
            decreasing.b,
            start,
            0.01,
            &mut cell_cue_work()
        )
        .unwrap()
        .is_none());
    let right = leaf_contact(
        &decreasing.a.pose(near_end),
        decreasing.sa.as_ref(),
        &decreasing.b.pose(near_end),
        decreasing.sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    let interval = SearchInterval {
        start,
        end: near_end,
        left,
        right,
        left_world_strict: false,
        right_world_strict: false,
        depth: 7,
    };
    let narrowed = interval.close_at_point(time, point.contact);
    let middle = narrowed.start + (narrowed.end - narrowed.start) * 0.5;
    assert_eq!(narrowed.start.to_bits(), interval.start.to_bits());
    assert_eq!(narrowed.depth, interval.depth);
    assert!(narrowed.right_world_strict && narrowed.right.dist < 0.01);
    assert!(middle - narrowed.start <= (interval.end - interval.start) * 0.5);
    assert!(narrowed.end - middle <= (interval.end - interval.start) * 0.5);
    let before = crate::checkpoint_codec::encode(&(decreasing.a, decreasing.b)).unwrap();
    let tolerance = f64::from(0.004166667_f32 * 1e-6);
    let hit = cast_full_shapes_policy(
        decreasing.a,
        decreasing.sa.as_ref(),
        decreasing.b,
        decreasing.sb.as_ref(),
        start,
        near_end,
        0.01,
        tolerance,
        &mut cell_cue_work(),
        true,
    )
    .unwrap()
    .expect("decreasing Native T retains the real point and original prefix search");
    assert!(hit.safe_time >= start && hit.hit_time > start && hit.hit_time <= time);
    assert!(hit.safe_time <= hit.hit_time && hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= 0.01);
    assert_eq!(
        crate::checkpoint_codec::encode(&(decreasing.a, decreasing.b)).unwrap(),
        before
    );
}

#[test]
fn counterfactual_product_probe_is_rejected_once_without_a_false_hit_or_clearance() {
    let p = cell_cue_pair(true);
    let before = crate::checkpoint_codec::encode(&(p.a, p.b)).unwrap();
    let (start, end) = p.a.curve.times();
    let pair = world_contact::Pair::new(p.sa.as_ref(), p.sb.as_ref(), &mut cell_cue_work())
        .unwrap()
        .unwrap();
    let mut calls = 0;
    let mut observe = |time: Time, work: &mut Work| {
        calls += 1;
        assert!(time > start && time < end);
        assert!(pair.at(p.a, p.b, time, 0.01, work)?.is_none());
        Ok(None)
    };
    let proof = certified_separation_axes_observed(
        p.a,
        p.sa.as_ref(),
        p.b,
        p.sb.as_ref(),
        rp::Vector::Y,
        None,
        start,
        end,
        0.01,
        &mut cell_cue_work(),
        Some(&mut observe),
    )
    .unwrap();
    assert_eq!(calls, 1);
    assert!(!matches!(
        proof,
        IntervalCertificate::Separated | IntervalCertificate::Point { .. }
    ));

    let mut changed = cell_cue_pair(true);
    if let Curve::Anchored { carrier, .. } = &mut changed.b.curve {
        carrier.domain.end = carrier.domain.end.next_up();
    }
    let mut axes = SeparationAxes::single(rp::Vector::Y);
    let mut cache = rounded::AxisCache::new(
        changed.a,
        changed.sa.as_ref(),
        changed.b,
        changed.sb.as_ref(),
        start,
        end,
        0.01,
    );
    let mut unexpected = 0;
    let mut observe = |_: Time, _: &mut Work| {
        unexpected += 1;
        Ok(None)
    };
    let result = rounded::separated_cached_observed(
        0,
        &mut cell_cue_work(),
        &mut axes,
        &mut cache,
        Some(&mut observe),
    );
    assert!(!matches!(result, Ok(IntervalCertificate::Point { .. })));
    assert_eq!(unexpected, 0);
    assert_eq!(
        crate::checkpoint_codec::encode(&(p.a, p.b)).unwrap(),
        before
    );
}

fn midpoint_static_motion(translation: rp::Vector) -> ShapeMotion {
    ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(translation),
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn midpoint_contact_bits(contact: rapier3d::parry::query::Contact) -> [u32; 15] {
    let vectors = [
        contact.point1,
        contact.point2,
        contact.normal1,
        contact.normal2,
    ];
    std::array::from_fn(|i| match i {
        0..12 => vectors[i / 3][i % 3].to_bits(),
        12 => contact.dist.to_bits(),
        13 => contact.subshape1,
        _ => contact.subshape2,
    })
}

#[test]
fn midpoint_observed_none_skips_only_the_same_actual_query_and_exact_work() {
    let a = midpoint_static_motion(rp::Vector::ZERO);
    let b = midpoint_static_motion(rp::Vector::Y * 1.02);
    let sa = rp::SharedShape::cuboid(3., 0.1, 3.);
    let sb = rp::SharedShape::capsule_y(0.5, 0.4);
    let before = crate::checkpoint_codec::encode(&(a, b)).unwrap();
    let pair = world_contact::Pair::new(sa.as_ref(), sb.as_ref(), &mut cell_cue_work())
        .unwrap()
        .unwrap();
    let time = 0.5;
    let margin = 0.01;
    let native = leaf_contact(
        &a.pose(time),
        sa.as_ref(),
        &b.pose(time),
        sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    assert!(native.dist > margin);

    let mut old_calls = 0;
    let mut old_work = cell_cue_work();
    let mut query = |work: &mut Work| {
        old_calls += 1;
        pair.at(a, b, time, margin, work)
    };
    assert!(query(&mut old_work).unwrap().is_none());
    let first_cost = old_work.used;
    // Both real-radius endpoints are outside the cheap cardinal envelope.
    assert_eq!(first_cost, 32 + 512 + 640 + 64);
    let old = observed_contact_after_native(time, native, margin, None, &mut old_work, &mut query)
        .unwrap();
    assert_eq!(old_calls, 2);
    assert_eq!(old_work.used, 2 * first_cost);

    for limit in [first_cost, first_cost - 1] {
        let mut calls = 0;
        let mut work = Work { used: 0, limit };
        let result = (|| {
            calls += 1;
            let observed = pair.at(a, b, time, margin, &mut work)?;
            observed_contact_after_native(
                time,
                native,
                margin,
                Some((time, margin, observed)),
                &mut work,
                |work| {
                    calls += 1;
                    pair.at(a, b, time, margin, work)
                },
            )
        })();
        if limit == first_cost {
            let (contact, strict) = result.unwrap();
            assert_eq!(midpoint_contact_bits(contact), midpoint_contact_bits(old.0));
            assert!(!strict && !old.1);
            assert_eq!(work.used, first_cost);
        } else {
            assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
        }
        assert_eq!(calls, 1); // First-query failure also cannot publish a memo.
    }
    // Different time bits or selected margin are fresh requests even when
    // this particular constant shape pair happens to produce the same None.
    for (at, selected) in [(time.next_up(), margin), (time, 0.005)] {
        let mut calls = 0;
        let mut work = cell_cue_work();
        let result = observed_contact_after_native(
            at,
            native,
            selected,
            Some((time, margin, None)),
            &mut work,
            |work| {
                calls += 1;
                pair.at(a, b, at, selected, work)
            },
        )
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(work.used, first_cost);
        assert_eq!(
            midpoint_contact_bits(result.0),
            midpoint_contact_bits(native)
        );
    }
    assert_eq!(crate::checkpoint_codec::encode(&(a, b)).unwrap(), before);
}

#[test]
fn midpoint_reuse_keeps_native_priority_initial_world_contact_and_later_true_hit() {
    let a = midpoint_static_motion(rp::Vector::new(1.5, 0.1, 0.));
    let b = midpoint_static_motion(rp::Vector::new(0.65435594, 0.9205225, -3.079389e-6));
    let sa = rp::SharedShape::cuboid(0.5, 0.1, 2.);
    let sb = rp::SharedShape::capsule_y(0.5, 0.4);
    let before = crate::checkpoint_codec::encode(&(a, b)).unwrap();
    let pair = world_contact::Pair::new(sa.as_ref(), sb.as_ref(), &mut cell_cue_work())
        .unwrap()
        .unwrap();
    let time = 0.5;
    let native = leaf_contact(
        &a.pose(time),
        sa.as_ref(),
        &b.pose(time),
        sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    assert_eq!(native.dist.to_bits(), 0.010000011_f32.to_bits());
    let mut work = cell_cue_work();
    let first = pair.at(a, b, time, 0.01, &mut work).unwrap().unwrap();
    assert!(first.strict);
    let paid = work.used;
    let mut calls = 0;
    let observed = observed_contact_after_native(
        time,
        native,
        0.01,
        Some((time, 0.01, Some(first))),
        &mut work,
        |work| {
            calls += 1;
            pair.at(a, b, time, 0.01, work)
        },
    )
    .unwrap();
    assert_eq!(calls, 0);
    assert_eq!(work.used, paid);
    assert!(observed.1);
    assert_eq!(
        midpoint_contact_bits(observed.0),
        midpoint_contact_bits(first.contact)
    );
    let flat_a = midpoint_static_motion(rp::Vector::ZERO);
    let flat_b = midpoint_static_motion(rp::Vector::Y * 1.01);
    let flat_pair = world_contact::Pair::new(sa.as_ref(), sb.as_ref(), &mut cell_cue_work())
        .unwrap()
        .unwrap();
    let point = flat_a.pose(time) * (rp::Vector::Y * 0.1);
    let core = flat_b.pose(time) * (rp::Vector::NEG_Y * 0.5);
    let real_gap = f64::from(core.y) - f64::from(point.y) - f64::from(0.4_f32);
    let equal_margin = real_gap as f32;
    assert_eq!(f64::from(equal_margin), real_gap);
    let flat_native = leaf_contact(
        &flat_a.pose(time),
        sa.as_ref(),
        &flat_b.pose(time),
        sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    assert!(flat_native.dist > equal_margin);
    let mut flat_work = cell_cue_work();
    let equality = flat_pair
        .at(flat_a, flat_b, time, equal_margin, &mut flat_work)
        .unwrap()
        .unwrap();
    assert!(!equality.strict);
    let paid = flat_work.used;
    let selected = observed_contact_after_native(
        time,
        flat_native,
        equal_margin,
        Some((time, equal_margin, Some(equality))),
        &mut flat_work,
        |_| panic!("the same nonstrict world observation was already evaluated"),
    )
    .unwrap();
    assert!(!selected.1);
    assert_eq!(flat_work.used, paid);
    assert_eq!(
        midpoint_contact_bits(selected.0),
        midpoint_contact_bits(equality.contact)
    );
    assert!(cast(
        flat_a,
        sa.as_ref(),
        flat_b,
        sb.as_ref(),
        time,
        time,
        equal_margin,
        1e-6,
        &mut cell_cue_work()
    )
    .unwrap()
    .is_none());
    // A Native contact inside the actual selected margin still wins without
    // performing a world request. No reused witness can replace its metadata.
    let mut untouched = cell_cue_work();
    let chosen =
        observed_contact_after_native(time, native, native.dist, None, &mut untouched, |_| {
            Err(TrajectoryError::InvalidReference)
        })
        .unwrap();
    assert!(!chosen.1);
    assert_eq!(untouched.used, 0);
    assert_eq!(
        midpoint_contact_bits(chosen.0),
        midpoint_contact_bits(native)
    );
    let initial = cast(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        0.,
        0.,
        0.01,
        1e-6,
        &mut cell_cue_work(),
    )
    .unwrap()
    .unwrap();
    assert_eq!((initial.safe_time, initial.hit_time), (0., 0.));
    assert_eq!(
        midpoint_contact_bits(initial.contact),
        midpoint_contact_bits(first.contact)
    );
    assert_eq!(crate::checkpoint_codec::encode(&(a, b)).unwrap(), before);

    // A prior observed absence belongs only to its interval. The unchanged
    // complete search must still find this later original C65 world contact.
    let p = cell_cue_pair(false);
    let before = crate::checkpoint_codec::encode(&(p.a, p.b)).unwrap();
    let (start, end) = p.a.curve.times();
    let tolerance = f64::from(0.004166667_f32 * 1e-6);
    let hit = cast_full_shapes_policy(
        p.a,
        p.sa.as_ref(),
        p.b,
        p.sb.as_ref(),
        start,
        end,
        0.01,
        tolerance,
        &mut cell_cue_work(),
        true,
    )
    .unwrap()
    .unwrap();
    assert!(hit.safe_time >= 0.011653646441118326);
    assert!(hit.hit_time > hit.safe_time && hit.hit_time <= 0.011668468825519085);
    assert!(hit.hit_time - hit.safe_time <= tolerance && hit.contact.dist <= 0.01);
    assert_eq!(
        crate::checkpoint_codec::encode(&(p.a, p.b)).unwrap(),
        before
    );
}

struct C82PairCost {
    ids: [u32; 2],
    a: ShapeMotion,
    b: ShapeMotion,
    sa: rp::SharedShape,
    sb: rp::SharedShape,
    until: Time,
    old_work: u64,
    right_strict: bool,
    has_hit: bool,
}
fn c82_pair_costs() -> [C82PairCost; 5] {
    let domain = Domain::new(0.07500000111758709, 0.10000000149011612).unwrap();
    let source = |id, x, vx| {
        let mut k = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(id, 0),
            domain,
            0.025,
            rp::Pose::from_translation(rp::Vector::new(x, 0., 0.)),
            rp::Vector::new(vx, 0., 0.),
            rp::Vector::ZERO,
        )
        .unwrap();
        k.native.motion.start_time = 0.075;
        k.native.motion.end_time = 0.1;
        ShapeMotion {
            curve: Curve::Integrated(k),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        }
    };
    let cap = || rp::SharedShape::capsule_y(0.25, 0.25);
    [
        C82PairCost {
            ids: [0, 8],
            a: source(0, -8.632492, -115.099884),
            b: source(8, -7.5, -140.),
            sa: cap(),
            sb: rp::SharedShape::cuboid(0.25, 2., 5.),
            until: 0.09999965969473124,
            old_work: 3_833_676,
            right_strict: true,
            has_hit: true,
        },
        C82PairCost {
            ids: [2, 1],
            a: source(2, -9.8974905, -105.29988),
            b: source(1, -9.264992, -110.19989),
            sa: cap(),
            sb: cap(),
            until: 0.09999970439821482,
            old_work: 2_525_338,
            right_strict: false,
            has_hit: true,
        },
        C82PairCost {
            ids: [4, 3],
            a: source(4, -11.162491, -95.499886),
            b: source(3, -10.529992, -100.39989),
            sa: cap(),
            sb: cap(),
            until: 0.09999970439821482,
            old_work: 2_512_182,
            right_strict: true,
            has_hit: true,
        },
        C82PairCost {
            ids: [6, 5],
            a: source(6, -12.427491, -85.69988),
            b: source(5, -11.794992, -90.599884),
            sa: cap(),
            sb: cap(),
            until: 0.09999970439821482,
            old_work: 2_334_088,
            right_strict: false,
            has_hit: false,
        },
        C82PairCost {
            ids: [7, 6],
            a: source(7, -13.05999, -80.79988),
            b: source(6, -12.427491, -85.69988),
            sa: cap(),
            sb: cap(),
            until: domain.end,
            old_work: 2_237_918,
            right_strict: true,
            has_hit: true,
        },
    ]
}

#[test]
fn noninitial_native_contacts_keep_metadata_and_require_an_actual_strict_world_marker() {
    let c = c82_pair_costs().into_iter().next().unwrap();
    let time = c.until;
    let margin = 0.01;
    let before = crate::checkpoint_codec::encode(&(c.a, c.b, &c.sa, &c.sb)).unwrap();
    let native = leaf_contact(
        &c.a.pose(time),
        c.sa.as_ref(),
        &c.b.pose(time),
        c.sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    assert!(native.dist <= margin);
    let pair = world_contact::Pair::new(c.sa.as_ref(), c.sb.as_ref(), &mut cell_cue_work())
        .unwrap()
        .unwrap();
    let mut measured = cell_cue_work();
    let mut calls = 0;
    let observed = noninitial_observed_contact_after_native(
        time,
        native,
        margin,
        None,
        &mut measured,
        |work| {
            calls += 1;
            pair.at(c.a, c.b, time, margin, work)
        },
    )
    .unwrap();
    assert_eq!(calls, 1);
    assert!(observed.1);
    assert_eq!(
        midpoint_contact_bits(observed.0),
        midpoint_contact_bits(native)
    );
    let exact_cost = 32 + 512 + 640 + 64 + 2048;
    assert_eq!(measured.used, exact_cost);
    for limit in [exact_cost, exact_cost - 1] {
        let result = noninitial_observed_contact_after_native(
            time,
            native,
            margin,
            None,
            &mut Work {
                used: 1000,
                limit: 1000 + limit,
            },
            |work| pair.at(c.a, c.b, time, margin, work),
        );
        if limit == exact_cost {
            let result = result.unwrap();
            assert!(result.1);
            assert_eq!(
                midpoint_contact_bits(result.0),
                midpoint_contact_bits(native)
            );
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    // The initial Native block and its priority/price remain the old behavior.
    let mut initial_work = Work { used: 0, limit: 0 };
    let initial =
        observed_contact_after_native(time, native, margin, None, &mut initial_work, |_| {
            panic!("initial Native-positive policy must remain unchanged")
        })
        .unwrap();
    assert!(!initial.1);
    assert_eq!(
        midpoint_contact_bits(initial.0),
        midpoint_contact_bits(native)
    );
    assert_eq!(initial_work.used, 0);
    let witness = pair
        .at(c.a, c.b, time, margin, &mut cell_cue_work())
        .unwrap()
        .unwrap();
    let mut cached = Work { used: 0, limit: 0 };
    let reused = noninitial_observed_contact_after_native(
        time,
        native,
        margin,
        Some((time, margin, Some(witness))),
        &mut cached,
        |_| panic!("same actual point has already been verified"),
    )
    .unwrap();
    assert!(reused.1 && cached.used == 0);
    assert_eq!(
        midpoint_contact_bits(reused.0),
        midpoint_contact_bits(native)
    );
    // Equality gives no strict world marker, while the Native contact stays
    // first even if its independent point data differs from the world witness.
    let equal_margin = witness.contact.dist;
    let equality = noninitial_observed_contact_after_native(
        time,
        native,
        equal_margin,
        None,
        &mut cell_cue_work(),
        |work| pair.at(c.a, c.b, time, equal_margin, work),
    )
    .unwrap();
    assert!(!equality.1);
    if native.dist <= equal_margin {
        assert_eq!(
            midpoint_contact_bits(equality.0),
            midpoint_contact_bits(native)
        );
    } else {
        let world = pair
            .at(c.a, c.b, time, equal_margin, &mut cell_cue_work())
            .unwrap()
            .unwrap();
        assert!(!world.strict);
        assert_eq!(
            midpoint_contact_bits(equality.0),
            midpoint_contact_bits(world.contact)
        );
    }

    // Actual Native contact with an unsupported optional world expression.
    // Neither a Native-positive value nor a cached observed None is strict.
    let mut other = midpoint_static_motion(rp::Vector::new(0.505, 0., 0.));
    let Curve::Constant { pose, .. } = &mut other.curve else {
        unreachable!()
    };
    pose.rotation = rp::Rotation::from_rotation_z(0.1);
    let fixed = midpoint_static_motion(rp::Vector::ZERO);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let unsupported =
        world_contact::Pair::new(capsule.as_ref(), capsule.as_ref(), &mut cell_cue_work())
            .unwrap()
            .unwrap();
    let native = leaf_contact(
        &fixed.pose(0.5),
        capsule.as_ref(),
        &other.pose(0.5),
        capsule.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    assert!(native.dist <= margin);
    let mut price = cell_cue_work();
    assert!(unsupported
        .at(fixed, other, 0.5, margin, &mut price)
        .unwrap()
        .is_none());
    assert_eq!(price.used, 672);
    let result = noninitial_observed_contact_after_native(
        0.5,
        native,
        margin,
        Some((0.5, margin, None)),
        &mut Work { used: 0, limit: 0 },
        |_| panic!("cached actual None must not repeat a world request"),
    )
    .unwrap();
    assert!(!result.1);
    assert_eq!(
        midpoint_contact_bits(result.0),
        midpoint_contact_bits(native)
    );
    for (at, selected) in [(0.5_f64.next_up(), margin), (0.5, 0.005)] {
        let mut calls = 0;
        let mut work = cell_cue_work();
        let result = noninitial_observed_contact_after_native(
            at,
            native,
            selected,
            Some((0.5, margin, None)),
            &mut work,
            |work| {
                calls += 1;
                unsupported.at(fixed, other, at, selected, work)
            },
        )
        .unwrap();
        assert_eq!(calls, 1);
        assert_eq!(work.used, price.used);
        assert!(!result.1);
        assert_eq!(
            midpoint_contact_bits(result.0),
            midpoint_contact_bits(native)
        );
    }
    assert_eq!(
        crate::checkpoint_codec::encode(&(c.a, c.b, &c.sa, &c.sb)).unwrap(),
        before
    );
}

#[test]
fn recorded_c82_pair_searches_preserve_the_real_prefix_and_separate_positive_right_costs() {
    for c in c82_pair_costs() {
        let before = crate::checkpoint_codec::encode(&(c.a, c.b, &c.sa, &c.sb)).unwrap();
        let (start, _) = c.a.curve.times();
        let pair = world_contact::Pair::new(c.sa.as_ref(), c.sb.as_ref(), &mut cell_cue_work())
            .unwrap()
            .unwrap();
        let right = pair
            .at(c.a, c.b, c.until, 0.01, &mut cell_cue_work())
            .unwrap();
        assert_eq!(right.is_some_and(|w| w.strict), c.right_strict);
        let native_right = leaf_contact(
            &c.a.pose(c.until),
            c.sa.as_ref(),
            &c.b.pose(c.until),
            c.sb.as_ref(),
            &mut cell_cue_work(),
        )
        .unwrap();
        if c.right_strict {
            assert!(native_right.dist <= 0.01);
        }
        let tolerance = f64::from((0.1_f32 - 0.075_f32) * 1e-6_f32);
        let mut charged = cell_cue_work();
        let result = cast_full_shapes_policy(
            c.a,
            c.sa.as_ref(),
            c.b,
            c.sb.as_ref(),
            start,
            c.until,
            0.01,
            tolerance,
            &mut charged,
            true,
        )
        .unwrap();
        assert_eq!(result.is_some(), c.has_hit, "pair {:?}", c.ids);
        if let Some(hit) = result {
            assert!(hit.safe_time >= start && hit.safe_time < hit.hit_time);
            assert!(hit.hit_time <= c.until && hit.hit_time - hit.safe_time <= tolerance);
            assert!(hit.contact.dist <= 0.01);
            let native = leaf_contact(
                &c.a.pose(hit.hit_time),
                c.sa.as_ref(),
                &c.b.pose(hit.hit_time),
                c.sb.as_ref(),
                &mut cell_cue_work(),
            )
            .unwrap();
            if native.dist <= 0.01 {
                assert_eq!(
                    midpoint_contact_bits(hit.contact),
                    midpoint_contact_bits(native)
                );
            } else {
                assert!(
                    pair.at(c.a, c.b, hit.hit_time, 0.01, &mut cell_cue_work())
                        .unwrap()
                        .unwrap()
                        .strict
                );
            }
        }
        // Only actual positive-right cases claim this particular scheduling
        // reduction. The clear-right interior-hit 2/1 and NoHit6/5 stay distinct.
        if c.right_strict {
            assert!(charged.used < c.old_work, "pair {:?}", c.ids);
        }
        eprintln!(
            "C83_RECORDED_PAIR pair={:?} old_work={} new_work={} right_strict={} hit={}",
            c.ids,
            c.old_work,
            charged.used,
            c.right_strict,
            result.is_some()
        );
        assert_eq!(
            crate::checkpoint_codec::encode(&(c.a, c.b, &c.sa, &c.sb)).unwrap(),
            before
        );
    }
}

#[test]
fn verified_strict_right_keeps_the_original_exact_tangent_contact_cell_before_rebase() {
    let domain = Domain::new(0.07500000111758709, 0.10000000149011612).unwrap();
    let source = |id, x, z, vx, vz| {
        let mut k = Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(id, 0),
            domain,
            0.025,
            rp::Pose::from_translation(rp::Vector::new(x, 0., z)),
            rp::Vector::new(vx, 0., vz),
            rp::Vector::ZERO,
        )
        .unwrap();
        k.native.motion.start_time = 0.075;
        k.native.motion.end_time = 0.1;
        ShapeMotion {
            curve: Curve::Integrated(k),
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        }
    };
    let a = source(0, -2.6324983, 0.15, -35.099976, 2.);
    let b = source(2, -1.5, 0., -60., 0.);
    let sa = rp::SharedShape::capsule_y(0.25, 0.25);
    let sb = rp::SharedShape::cuboid(0.25, 2., 5.);
    let before = crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap();
    let tolerance = f64::from((0.1_f32 - 0.075_f32) * 1e-6_f32);
    let pair = world_contact::Pair::new(sa.as_ref(), sb.as_ref(), &mut cell_cue_work())
        .unwrap()
        .unwrap();
    let native_right = leaf_contact(
        &a.pose(domain.end),
        sa.as_ref(),
        &b.pose(domain.end),
        sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    assert!(native_right.dist <= 0.01);
    assert!(
        pair.at(a, b, domain.end, 0.01, &mut cell_cue_work())
            .unwrap()
            .unwrap()
            .strict
    );
    let cast = |work: &mut Work| {
        cast_full_shapes_policy(
            a,
            sa.as_ref(),
            b,
            sb.as_ref(),
            domain.start,
            domain.end,
            0.01,
            tolerance,
            work,
            true,
        )
    };
    let mut charged = cell_cue_work();
    let hit = cast(&mut charged).unwrap().unwrap();
    // These are the original C82 complete-walker first-state boundary bits,
    // not an arbitrary earlier safe point chosen inside the accepted tolerance.
    assert_eq!(hit.safe_time.to_bits(), 0.09999989997595549_f64.to_bits());
    assert_eq!(hit.hit_time.to_bits(), 0.0999998999759555_f64.to_bits());
    assert_eq!(hit.hit_time.to_bits(), hit.safe_time.next_up().to_bits());
    assert!(hit.hit_time - hit.safe_time <= tolerance);
    assert_eq!(
        a.pose(hit.safe_time).translation.z.to_bits(),
        0.19999981_f32.to_bits()
    );
    let native_hit = leaf_contact(
        &a.pose(hit.hit_time),
        sa.as_ref(),
        &b.pose(hit.hit_time),
        sb.as_ref(),
        &mut cell_cue_work(),
    )
    .unwrap();
    assert_eq!(
        midpoint_contact_bits(hit.contact),
        midpoint_contact_bits(native_hit)
    );
    assert!(native_hit.dist <= 0.01);
    // Exact initial Native priority is still independent of any search marker.
    let initial = cast_full_shapes_policy(
        a,
        sa.as_ref(),
        b,
        sb.as_ref(),
        hit.hit_time,
        hit.hit_time,
        0.01,
        tolerance,
        &mut cell_cue_work(),
        false,
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        (initial.safe_time, initial.hit_time),
        (hit.hit_time, hit.hit_time)
    );
    assert_eq!(
        midpoint_contact_bits(initial.contact),
        midpoint_contact_bits(native_hit)
    );
    assert!(charged.used < 6_031_743); // original complete first scene query cost
    for limit in [charged.used, charged.used - 1] {
        let result = cast(&mut Work { used: 0, limit });
        if limit == charged.used {
            let exact = result.unwrap().unwrap();
            assert_eq!(
                (exact.safe_time.to_bits(), exact.hit_time.to_bits()),
                (hit.safe_time.to_bits(), hit.hit_time.to_bits())
            );
            assert_eq!(
                midpoint_contact_bits(exact.contact),
                midpoint_contact_bits(hit.contact)
            );
        } else {
            assert_eq!(result.unwrap_err(), TrajectoryError::WorkLimit);
        }
    }
    assert_eq!(
        crate::checkpoint_codec::encode(&(a, b, &sa, &sb)).unwrap(),
        before
    );
}

#[test]
fn angular_ccd_original_third_sdk_tick_preserves_the_first_contact_bracket() {
    // Original 25 ms solver integration recorded on the third 100 ms SDK
    // step. Keeping these packed F32 inputs independent of earlier clamp
    // choices reproduces the grazing trajectory even if a prior tick changes.
    original_sdk_box_sphere_bracket(
        rp::Vector::new(-2.12013e-8, -9.3732757e-7, 0.),
        rp::Rotation::from_xyzw(0., 0., -0.011307023, 0.9999361),
        rp::Vector::new(-9.350029e-10, -1.8339338e-10, 1.9797177),
    );
}

#[test]
fn angular_ccd_original_twenty_eighth_sdk_tick_preserves_the_first_contact_bracket() {
    // The Z=5 pair hit the shared work ceiling on this recorded integration.
    original_sdk_box_sphere_bracket(
        rp::Vector::new(-3.8777384e-7, -4.265605e-5, 5.),
        rp::Rotation::from_xyzw(-4.1329218e-14, -4.4826488e-14, -0.01129654, 0.9999362),
        rp::Vector::new(-4.8923546e-8, -5.352007e-8, 1.9797312),
    );
}

fn original_sdk_box_sphere_bracket(
    origin: rp::Vector,
    rotation: rp::Rotation,
    angular: rp::Vector,
) {
    let h = 0.025_f32;
    let domain = Domain::new(0., f64::from(h)).unwrap();
    let k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        domain,
        h,
        rp::Pose::from_parts(origin, rotation),
        rp::Vector::new(-0.034592994, -3.9369435, 9.094946e-11),
        angular,
    )
    .unwrap();
    let cube = ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let target = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::new(1.99, 0., origin.z)),
            start_time: 0.,
            end_time: f64::from(0.1_f32),
        },
        ..cube
    };
    let tol = 2.5000000292152436e-8;
    let mut work = Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    };
    let hit = cast_full_shapes_policy(
        cube,
        &rp::Cuboid::new(rp::Vector::new(2., 0.025, 0.1)),
        target,
        &rp::Ball::new(0.015),
        0.,
        domain.end,
        0.005,
        tol,
        &mut work,
        true,
    )
    .unwrap()
    .unwrap();
    assert!(hit.safe_time > 0. && hit.hit_time > hit.safe_time);
    assert!(hit.hit_time - hit.safe_time <= tol && hit.contact.dist <= 0.005);
}

/// Captured from the starter feature-lab ball at a 1/30 s step: a spinning
/// ball approaches a fixed wall whose face coordinate puts its last clear f32
/// state 4.88e-6 above the 0.005 margin, below the rotated-sphere slack.
#[test]
fn spinning_centered_ball_resolves_a_sub_ulp_wall_margin_with_its_translation_twin() {
    let native = SolverBodyIntegration {
        motion: SolverBodyMotion {
            body: rp::RigidBodyHandle::invalid(),
            start_time: 0.016666668,
            end_time: 0.025000002,
            start: rp::Pose::from_parts(
                rp::Vector::new(428.3279, 84.17843, 0.),
                rp::Rotation::from_xyzw(0., 0., 0.41693202, 0.90893775),
            ),
            end: rp::Pose::from_parts(
                rp::Vector::new(431.1799, 82.831665, 0.),
                rp::Rotation::from_xyzw(0., 0., 0.42162058, 0.90677243),
            ),
        },
        integration_seconds: 0.008333334,
        linear_velocity: rp::Vector::new(342.23715, -161.612, 0.),
        angular_velocity: rp::Vector::new(0., 0., 1.2394774),
    };
    let domain = Domain {
        start: 0.01666666753590107,
        end: 0.025000001303851604,
    };
    let ball = ShapeMotion {
        curve: Curve::Integrated(Kernel::from_native(native, domain).unwrap()),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let wall = ShapeMotion {
        curve: Curve::Constant {
            pose: rp::Pose::from_translation(rp::Vector::new(320., 64., 0.)),
            start_time: 0.,
            end_time: 0.03333333507180214,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let sphere = rp::Ball::new(16.);
    let cuboid = rp::Cuboid::new(rp::Vector::new(224., 4., 225.0357));

    // Only a spinning ball centered on its body has a twin, and the twin keeps
    // every original center bit, including the stored endpoints.
    let twin = ball.centered_ball_translation_twin(&sphere).unwrap();
    for fraction in [0., 0.125, 0.25, 0.5, 0.75, 1.] {
        let time = domain.start + (domain.end - domain.start) * fraction;
        assert_eq!(
            twin.pose(time).translation.to_array().map(f32::to_bits),
            ball.pose(time).translation.to_array().map(f32::to_bits)
        );
    }
    assert!(wall.centered_ball_translation_twin(&cuboid).is_none());
    assert!(ball.centered_ball_translation_twin(&cuboid).is_none());
    assert!(twin.centered_ball_translation_twin(&sphere).is_none());
    let offset = ShapeMotion {
        local_pose: rp::Pose::from_translation(rp::Vector::X),
        ..ball
    };
    assert!(offset.centered_ball_translation_twin(&sphere).is_none());

    let tolerance = 8.333334911014845e-9;
    let mut work = Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    };
    // This query previously bisected to two adjacent logical times, both
    // 0.005004883 from the wall, and returned Unresolved.
    let hit = cast_full_shapes_policy(
        ball,
        &sphere,
        wall,
        &cuboid,
        domain.start,
        domain.end,
        0.005,
        tolerance,
        &mut work,
        true,
    )
    .unwrap()
    .unwrap();
    assert!(hit.safe_time > domain.start && hit.hit_time > hit.safe_time);
    assert!(hit.hit_time - hit.safe_time <= tolerance);
    assert!(hit.contact.dist <= 0.005 && hit.contact.normal1.y < -0.99);
}
