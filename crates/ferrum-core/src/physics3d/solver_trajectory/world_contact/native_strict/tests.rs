use super::*;
use crate::physics3d::solver_trajectory::{leaf_contact, rp, Curve};

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}

fn constant(pose: rp::Pose) -> ShapeMotion {
    ShapeMotion {
        curve: Curve::Constant {
            pose,
            start_time: 0.,
            end_time: 1.,
        },
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}

fn bits(contact: rapier3d::parry::query::Contact) -> Vec<u32> {
    [
        contact.point1,
        contact.point2,
        contact.normal1,
        contact.normal2,
    ]
    .into_iter()
    .flat_map(|v| v.to_array().map(f32::to_bits))
    .chain([contact.dist.to_bits(), contact.subshape1, contact.subshape2])
    .collect()
}

#[test]
fn rotated_actual_point_marker_preserves_native_contact_and_charges_its_work() {
    let box_shape = rp::SharedShape::cuboid(3., 0.1, 3.);
    let cap_shape = rp::SharedShape::capsule_y(0.25, 0.25);
    for rotation in [
        rp::Rotation::from_rotation_y(0.3),
        rp::Rotation::from_xyzw(0.02, 0.125, -0.01, 1.),
    ] {
        let pa = rp::Pose::from_parts(rp::Vector::new(0., -0.1, 0.), rotation);
        let point = pa * rp::Vector::new(1., 0.1, 0.);
        let pb = rp::Pose::from_translation(point + rp::Vector::Y * 0.5);
        let a = constant(pa);
        let b = constant(pb);
        let before = postcard::to_allocvec(&(a, b, &box_shape, &cap_shape)).unwrap();
        let native = leaf_contact(
            &pa,
            box_shape.as_ref(),
            &pb,
            cap_shape.as_ref(),
            &mut work(),
        )
        .unwrap();
        let pair = Pair::new(box_shape.as_ref(), cap_shape.as_ref(), &mut work())
            .unwrap()
            .unwrap();
        // The existing optional normal-cone producer still declines rotations.
        assert!(pair.at(a, b, 0.5, 0.0625, &mut work()).unwrap().is_none());
        let mut charged = work();
        assert!(pair
            .native_strict_at(a, b, 0.5, 0.0625, &mut charged)
            .unwrap());
        assert!(charged.used > 0);
        let mut exact = Work {
            used: 0,
            limit: charged.used,
        };
        assert!(pair
            .native_strict_at(a, b, 0.5, 0.0625, &mut exact)
            .unwrap());
        assert_eq!(exact.used, charged.used);
        let mut insufficient = Work {
            used: 0,
            limit: charged.used - 1,
        };
        assert_eq!(
            pair.native_strict_at(a, b, 0.5, 0.0625, &mut insufficient),
            Err(TrajectoryError::WorkLimit)
        );
        let reverse = Pair::new(cap_shape.as_ref(), box_shape.as_ref(), &mut work())
            .unwrap()
            .unwrap();
        assert!(reverse
            .native_strict_at(b, a, 0.5, 0.0625, &mut work())
            .unwrap());
        assert_eq!(
            bits(native),
            bits(
                leaf_contact(
                    &pa,
                    box_shape.as_ref(),
                    &pb,
                    cap_shape.as_ref(),
                    &mut work()
                )
                .unwrap()
            )
        );
        assert_eq!(
            postcard::to_allocvec(&(a, b, &box_shape, &cap_shape)).unwrap(),
            before
        );
    }
}

#[test]
fn native_marker_uses_real_radius_strict_inequality_and_original_time_admission() {
    let box_shape = rp::SharedShape::cuboid(0., 0., 0.);
    let cap_shape = rp::SharedShape::capsule_y(0., 0.25);
    let a = constant(rp::Pose::from_parts(
        rp::Vector::ZERO,
        rp::Rotation::from_xyzw(0., 0.25, 0., 0.5),
    ));
    let pair = Pair::new(box_shape.as_ref(), cap_shape.as_ref(), &mut work())
        .unwrap()
        .unwrap();
    let cap = |x| {
        constant(rp::Pose::from_parts(
            rp::Vector::X * x,
            rp::Rotation::from_xyzw(0., 0., 0., 2.),
        ))
    };
    assert!(pair
        .native_strict_at(a, cap(0.3125), 0.5, 0.125, &mut work())
        .unwrap());
    assert!(!pair
        .native_strict_at(a, cap(0.375), 0.5, 0.125, &mut work())
        .unwrap());
    // A scaled capsule quaternion must not scale its original world radius.
    assert!(!pair
        .native_strict_at(a, cap(0.75), 0.5, 0.125, &mut work())
        .unwrap());
    assert!(!pair
        .native_strict_at(a, cap(0.3125), 0.5, -0.125, &mut work())
        .unwrap());
    assert_eq!(
        pair.native_strict_at(a, cap(0.3125), 1.1, 0.125, &mut work()),
        Err(TrajectoryError::InvalidTime)
    );
    assert_eq!(
        pair.native_strict_at(a, cap(0.3125), 0.5, f32::NAN, &mut work()),
        Err(TrajectoryError::NonFinite)
    );
}
