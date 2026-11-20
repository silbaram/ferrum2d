use super::*;
use crate::physics3d::{types::valid_pose, Pose};
use rapier3d::parry::{query::sweep_toi::Sweep, utils::Array2};

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn motion(curve: Curve) -> ShapeMotion {
    ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}
fn constant(pose: rp::Pose) -> ShapeMotion {
    motion(Curve::Constant {
        pose,
        start_time: 0.,
        end_time: 1.,
    })
}
fn contains(bounds: Aabb, point: rp::Vector) {
    for axis in 0..3 {
        assert!(
            bounds.mins[axis] <= point[axis] && point[axis] <= bounds.maxs[axis],
            "axis={axis} point={point:?} bounds={bounds:?}"
        );
    }
}
fn proxy_oracle(bounds: Aabb, shape: &dyn rp::Shape, pose: rp::Pose) {
    let proxy = ToiProxy::from_shape(shape).unwrap();
    for &core in proxy.points() {
        contains(bounds, pose * core);
        for axis in [rp::Vector::X, rp::Vector::Y, rp::Vector::Z] {
            for sign in [-1., 1.] {
                // Direct original local-radius shape point; the bound must
                // also include the real world-scalar radius extent below.
                contains(bounds, pose * (core + axis * (sign * proxy.radius)));
                let center = pose * core;
                let index = if axis.x != 0. {
                    0
                } else if axis.y != 0. {
                    1
                } else {
                    2
                };
                let exact = f64::from(center[index]) + f64::from(sign * proxy.radius);
                assert!(
                    f64::from(bounds.mins[index]) <= exact
                        && exact <= f64::from(bounds.maxs[index])
                );
            }
        }
    }
}
fn anchored_counter() -> ShapeMotion {
    let center = 524_288.;
    let h = 1. / 64.;
    let start = rp::Pose::from_translation(rp::Vector::X * center);
    assert!(valid_pose(Pose {
        position: start.translation.to_array(),
        rotation: start.rotation.to_array()
    }));
    assert!((0.0001..=0.1).contains(&h));
    let carrier = Kernel::from_velocity(
        rp::RigidBodyHandle::invalid(),
        crate::physics3d::solver_trajectory::Domain::new(0., h).unwrap(),
        start,
        rp::Vector::X * 16.,
        rp::Vector::ZERO,
    )
    .unwrap();
    motion(Curve::Anchored {
        carrier,
        anchor: rp::Vector::ZERO,
        offset: rp::Vector::X * -center,
        linear_velocity: rp::Vector::X * -16.,
        rotation: rp::Rotation::IDENTITY,
    })
}

#[test]
fn scaled_valid_anchored_cancellation_encloses_interior_not_only_equal_endpoints() {
    let moving = anchored_counter();
    let h = 1. / 64.;
    let sphere = rp::SharedShape::ball(1. / 128.);
    let before = postcard::to_allocvec(&moving).unwrap();
    assert_eq!(moving.curve.com_pose(0.).translation, rp::Vector::ZERO);
    assert_eq!(moving.curve.com_pose(h).translation, rp::Vector::ZERO);
    assert_eq!(moving.curve.com_pose(h / 8.).translation.x, -1. / 32.);
    assert_eq!(moving.curve.com_pose(3. * h / 8.).translation.x, 1. / 32.);
    let bound = moving.bounds(sphere.as_ref(), 0., h, &mut work()).unwrap();
    // The previous endpoint COM sphere was only [-1/128,+1/128].
    assert!(bound.mins.x <= -1. / 32. - 1. / 128.);
    assert!(bound.maxs.x >= 1. / 32. + 1. / 128.);
    for i in 0..=128 {
        proxy_oracle(bound, sphere.as_ref(), moving.pose(h * i as f64 / 128.));
    }
    assert_eq!(postcard::to_allocvec(&moving).unwrap(), before);
}

#[test]
fn original_native_endpoints_and_nonunit_local_and_real_world_radii_are_included() {
    let c = std::f32::consts::FRAC_1_SQRT_2
        .next_up()
        .next_up()
        .next_up();
    let q = rp::Rotation::from_xyzw(0., 0., c, c);
    assert!(valid_pose(Pose {
        position: [0.; 3],
        rotation: q.to_array()
    }));
    let start = rp::Pose::from_parts(rp::Vector::new(0., 0., 8192.), q);
    let kernel = Kernel::from_velocity(
        rp::RigidBodyHandle::invalid(),
        crate::physics3d::solver_trajectory::Domain::new(0., 1. / 64.).unwrap(),
        start,
        rp::Vector::X * 16.,
        rp::Vector::ZERO,
    )
    .unwrap();
    let moving = motion(Curve::Integrated(kernel));
    let sphere = rp::SharedShape::ball(2_f32.powi(-12));
    let bound = moving
        .bounds(sphere.as_ref(), 0., 1. / 64., &mut work())
        .unwrap();
    assert!(f64::from(bound.mins.z) <= 8192. - 2_f64.powi(-12));
    assert!(f64::from(bound.maxs.z) >= 8192. + 2_f64.powi(-12));
    for t in [0., 1. / 1024., 1. / 128., 1. / 64.] {
        proxy_oracle(bound, sphere.as_ref(), moving.pose(t));
    }
    let tiny = rp::SharedShape::ball(f32::from_bits(1));
    let bound = constant(start)
        .bounds(tiny.as_ref(), 0., 1., &mut work())
        .unwrap();
    assert!(bound.mins.z < 8192. && bound.maxs.z > 8192.);
}

#[test]
fn adaptive_nlerp_partition_handles_original_zero_minimum_cartesian_norm() {
    let sweep = Sweep {
        local_center: rp::Vector::new(0.125, -0.25, 0.5),
        c1: rp::Vector::ZERO,
        c2: rp::Vector::new(1., 0.5, -1.),
        q1: rp::Rotation::from_xyzw(1., 0., 0., 0.),
        q2: rp::Rotation::from_xyzw(0., 1., 0., 0.),
    };
    let mut moving = motion(Curve::Ccd {
        sweep,
        start_time: 0.,
        end_time: 1.,
    });
    moving.local_center = rp::Vector::new(0.25, 0., -0.125);
    moving.local_pose = rp::Pose::from_parts(
        rp::Vector::new(-0.5, 1., 0.25),
        rp::Rotation::from_rotation_z(0.2),
    );
    assert!(frames(moving.curve, 0., 1., &mut work()).unwrap().is_none());
    let shape = rp::SharedShape::capsule_y(0.5, 0.125);
    let bound = moving.bounds(shape.as_ref(), 0., 1., &mut work()).unwrap();
    for i in 0..=256 {
        proxy_oracle(bound, shape.as_ref(), moving.pose(i as f64 / 256.));
    }
}

#[test]
fn every_supported_proxy_and_convex_interior_uses_original_local_pose_graph() {
    let points = [
        rp::Vector::new(-0.5, -0.25, -0.125),
        rp::Vector::X,
        rp::Vector::Y,
        rp::Vector::Z,
    ];
    let shapes = [
        rp::SharedShape::ball(0.125),
        rp::SharedShape::cuboid(0.5, 0.25, 0.125),
        rp::SharedShape::round_cuboid(0.5, 0.25, 0.125, 0.0625),
        rp::SharedShape::capsule_x(0.5, 0.125),
        rp::SharedShape::segment(points[0], points[1]),
        rp::SharedShape::triangle(points[0], points[1], points[2]),
        rp::SharedShape::round_triangle(points[0], points[1], points[2], 0.0625),
        rp::SharedShape::convex_hull(&points).unwrap(),
        rp::SharedShape::round_convex_hull(&points, 0.0625).unwrap(),
    ];
    let mut moving = anchored_counter();
    moving.local_center = rp::Vector::new(0.125, -0.5, 0.25);
    moving.local_pose = rp::Pose::from_parts(
        rp::Vector::new(1., -0.25, 0.5),
        rp::Rotation::from_rotation_y(0.3),
    );
    for shape in shapes {
        let bound = moving
            .bounds(shape.as_ref(), 0., 1. / 64., &mut work())
            .unwrap();
        for i in 0..=32 {
            let pose = moving.pose(i as f64 / 2048.);
            proxy_oracle(bound, shape.as_ref(), pose);
            let proxy = ToiProxy::from_shape(shape.as_ref()).unwrap();
            for &a in proxy.points() {
                for &b in proxy.points() {
                    for t in [0.125, 0.5, 0.875] {
                        contains(bound, pose * (a * (1. - t) + b * t));
                    }
                }
            }
        }
    }
}

#[test]
fn compound_mesh_and_heightfield_keep_all_real_leaves_and_both_composition_orders() {
    let mut moving = anchored_counter();
    moving.local_center = rp::Vector::new(0.125, -0.25, 0.5);
    moving.local_pose = rp::Pose::from_parts(
        rp::Vector::new(0.25, 1., -0.5),
        rp::Rotation::from_rotation_y(0.2),
    );
    let children = vec![
        (
            rp::Pose::from_translation(rp::Vector::new(2., 0., 0.)),
            rp::SharedShape::ball(0.25),
        ),
        (
            rp::Pose::from_parts(
                rp::Vector::new(-1., 0.25, 0.5),
                rp::Rotation::from_rotation_z(0.3),
            ),
            rp::SharedShape::cuboid(0.5, 0.25, 0.125),
        ),
    ];
    let compound = rp::SharedShape::compound(children.clone());
    let vertices = vec![
        rp::Vector::new(-2., 0., 0.),
        rp::Vector::new(2., 0., 0.),
        rp::Vector::new(0., 1., 1.),
        rp::Vector::new(0., -1., 2.),
    ];
    let mesh = rp::SharedShape::trimesh(vertices.clone(), vec![[0, 1, 2], [0, 1, 3]]).unwrap();
    let field = rp::SharedShape::heightfield(
        Array2::new(3, 3, vec![0., 0.25, 0.5, -0.25, 1., 0.125, 0., 0.5, 0.]),
        rp::Vector::new(2., 1., 4.),
    );
    for shape in [&compound, &mesh, &field] {
        let bound = moving
            .bounds(shape.as_ref(), 0., 1. / 64., &mut work())
            .unwrap();
        for i in 0..=32 {
            let t = i as f64 / 2048.;
            match shape.as_typed_shape() {
                TypedShape::Compound(_) => {
                    for (local, part) in &children {
                        proxy_oracle(bound, part.as_ref(), moving.pose(t) * *local);
                        let composed = ShapeMotion {
                            local_pose: moving.local_pose * *local,
                            ..moving
                        };
                        proxy_oracle(bound, part.as_ref(), composed.pose(t));
                    }
                }
                TypedShape::TriMesh(_) => {
                    for &point in &vertices {
                        contains(bound, moving.pose(t) * point);
                    }
                }
                TypedShape::HeightField(field) => {
                    for tri in field.triangles() {
                        for point in [tri.a, tri.b, tri.c] {
                            contains(bound, moving.pose(t) * point);
                        }
                    }
                }
                _ => unreachable!(),
            }
        }
    }
}

#[test]
fn shared_work_exact_one_below_and_failures_leave_original_bytes_unchanged() {
    let moving = anchored_counter();
    let shape = rp::SharedShape::capsule_y(0.5, 0.125);
    let original = postcard::to_allocvec(&moving).unwrap();
    let mut measured = work();
    measured.used = 17;
    let expected = moving
        .bounds(shape.as_ref(), 0., 1. / 64., &mut measured)
        .unwrap();
    let total = measured.used;
    assert!(total > 17);
    let mut exact = Work {
        used: 17,
        limit: total,
    };
    assert_eq!(
        moving
            .bounds(shape.as_ref(), 0., 1. / 64., &mut exact)
            .unwrap(),
        expected
    );
    assert_eq!(exact.used, total);
    let mut short = Work {
        used: 17,
        limit: total - 1,
    };
    assert_eq!(
        moving.bounds(shape.as_ref(), 0., 1. / 64., &mut short),
        Err(TrajectoryError::WorkLimit)
    );
    let mut none = Work {
        used: 17,
        limit: 17,
    };
    assert_eq!(
        moving.bounds(shape.as_ref(), 0., 1. / 64., &mut none),
        Err(TrajectoryError::WorkLimit)
    );
    assert_eq!(none.used, 17);
    assert_eq!(postcard::to_allocvec(&moving).unwrap(), original);
    for (start, end) in [
        (f64::NAN, 0.),
        (0., f64::INFINITY),
        (-1., 0.),
        (0., 1.),
        (0.01, 0.),
    ] {
        assert_eq!(
            moving.bounds(shape.as_ref(), start, end, &mut work()),
            Err(TrajectoryError::InvalidTime)
        );
    }
    let invalid = constant(rp::Pose::from_translation(rp::Vector::new(
        f32::NAN,
        0.,
        0.,
    )));
    assert_eq!(
        invalid.bounds(shape.as_ref(), 0.5, 0.5, &mut work()),
        Err(TrajectoryError::NonFinite)
    );
}

#[test]
fn straight_primitives_match_complete_frame_bounds_bitwise() {
    let original = rp::Pose::from_translation(rp::Vector::new(-0., 129., -524_288.));
    let mut k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::invalid(),
        crate::physics3d::solver_trajectory::Domain::new(2., 3.).unwrap(),
        0.25,
        original,
        rp::Vector::new(-3., 0., 0.125),
        rp::Vector::ZERO,
    )
    .unwrap();
    // The stored end is a separate Native branch.
    k.native.motion.end.translation.x = 4.;
    let shapes = [
        rp::SharedShape::cuboid(0.125, 0.25, 1.),
        rp::SharedShape::capsule_y(0.25, 0.125),
        rp::SharedShape::capsule(
            rp::Vector::new(-0., -0.25, 0.),
            rp::Vector::new(0.125, 0.25, 0.),
            0.01,
        ),
    ];
    let bits = |a: Aabb| {
        [
            a.mins.to_array().map(f32::to_bits),
            a.maxs.to_array().map(f32::to_bits),
        ]
    };
    for mut moving in [constant(original), motion(Curve::Integrated(k))] {
        moving.local_center = rp::Vector::new(-0., -0.2, 0.125);
        moving.local_pose.translation = rp::Vector::new(0., 0.125, 0.);
        let (lo, hi) = moving.curve.times();
        for (start, end) in [
            (lo, hi),
            (lo, lo.midpoint(hi)),
            (lo.midpoint(hi), hi),
            (hi.next_down(), hi),
        ] {
            for shape in &shapes {
                let native_hull = hull(shape.as_ref(), &mut work()).unwrap();
                let expected =
                    leaf_bounds(moving, None, native_hull, start, end, &mut work()).unwrap();
                let actual =
                    straight_primitive_bounds(moving, shape.as_ref(), start, end, &mut work())
                        .unwrap()
                        .unwrap();
                assert_eq!(bits(actual), bits(expected));
                for t in [start, start.midpoint(end), end] {
                    assert!(crate::physics3d::solver_trajectory::same_pose_bits(
                        moving.pose(t),
                        moving.metered_pose(t, &mut work()).unwrap()
                    ));
                    proxy_oracle(actual, shape.as_ref(), moving.pose(t));
                }
            }
        }
    }
}
