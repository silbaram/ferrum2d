//! An edge can separate along its actual contact normal even when neither
//! incident box face alone clears the full capsule.
use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    ideal: &IdealTransform,
    normal: rp::Vector,
    delta: [Bound; 3],
    half: rp::Vector,
    cores: [rp::Vector; 2],
    radius: f32,
    clearance: f32,
    errors: [f64; 3],
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(2048)?;
    let n = normal.to_array().map(exact);
    let project =
        |point: [Bound; 3]| (0..3).fold(Bound::exact(0.), |sum, i| sum.add(point[i].mul(n[i])));
    let norm = project(n).sqrt();
    if !norm.finite() || norm.lo <= 0. {
        return Ok(false);
    }
    // The quaternion acts linearly on the complete cuboid prior to its
    // rounded point graph. Each half extent contributes its full projected
    // column in either sign, including every point on an edge or face.
    let mut extent = Bound::exact(0.);
    for (i, unit) in [rp::Vector::X, rp::Vector::Y, rp::Vector::Z]
        .into_iter()
        .enumerate()
    {
        let column = project(ideal.point(unit));
        if !column.finite() {
            return Ok(false);
        }
        extent = extent.add(exact(half[i]).mul(Bound::exact(magnitude(column))));
    }
    let reach = extent.add(norm.mul(exact(radius).add(exact(clearance))));
    let loss = (0..3).fold(0., |sum, i| {
        upper_add(sum, upper_mul(errors[i], magnitude(n[i])))
    });
    // Delta encloses both clocks' actual relative centers. The endpoint
    // minimum covers the full core segment. The shared errors enclose the
    // rounded box and both orders of applying the capsule radius.
    Ok(reach.finite()
        && loss.is_finite()
        && cores.into_iter().all(|p| {
            let gap = project(std::array::from_fn(|i| delta[i].add(exact(p[i])))).sub(reach);
            gap.finite() && gap.lo > loss
        }))
}

#[cfg(test)]
#[test]
fn rotating_cuboid_edge_separates_the_full_supported_capsule() {
    use crate::physics3d::solver_trajectory::{leaf_contact, Domain};
    let domain = Domain::new(0.008333333767950535, 0.012500000651925802).unwrap();
    let kernel = |id, pose, v, w| {
        Kernel::from_velocity_seconds(
            rp::RigidBodyHandle::from_raw_parts(id, 0),
            domain,
            0.004166667,
            pose,
            v,
            w,
        )
        .unwrap()
    };
    let motion = |curve| ShapeMotion {
        curve,
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let body = motion(Curve::Integrated(kernel(
        3,
        rp::Pose::from_parts(
            rp::Vector::new(-10.002845, 0.25555617, 0.663571),
            rp::Rotation::from_xyzw(0.41923293, -0.00079695805, 0.00027697627, 0.9078784),
        ),
        rp::Vector::new(-0.0038992611, -0.7111738, 1.12571),
        rp::Vector::new(4.0684423, 0.039102398, 0.042048622),
    )));
    let carrier = kernel(
        0,
        rp::Pose::translation(0., -0.1, 0.),
        rp::Vector::ZERO,
        rp::Vector::ZERO,
    );
    let cap = rp::SharedShape::capsule_y(0.25, 0.25);
    let cube = rp::SharedShape::cuboid(0.08, 0.3, 0.08);
    let actor = |z, linear_velocity| {
        motion(Curve::Anchored {
            carrier,
            anchor: rp::Vector::new(-9.999808, 0.6097955, z),
            offset: rp::Vector::ZERO,
            linear_velocity,
            rotation: rp::Rotation::IDENTITY,
        })
    };
    let slow = actor(0.16252676, rp::Vector::new(0.00024227682, 0., 0.3429528));
    let mut work = Work {
        used: 0,
        limit: 2 * 1024 * 1024,
    };
    let contact = leaf_contact(
        &slow.pose(domain.start),
        cap.as_ref(),
        &body.pose(domain.start),
        cube.as_ref(),
        &mut work,
    )
    .unwrap();
    let through = crate::physics3d::solver_trajectory::supported_capsule_face::prefix(
        slow,
        cap.as_ref(),
        body,
        cube.as_ref(),
        contact.normal1,
        domain.start,
        domain.end,
        0.01,
        &mut work,
    )
    .unwrap();
    assert_eq!(through, Some(domain.end));

    let (start, end) = (0.010315156583036673, 0.010331810556272691);
    for (z, clear) in [(0.16252676, true), (0.16260676, false)] {
        let actor = actor(z, rp::Vector::new(9.7031825e-6, 0., 0.49533972));
        for (a, sa, b, sb) in [
            (actor, cap.as_ref(), body, cube.as_ref()),
            (body, cube.as_ref(), actor, cap.as_ref()),
        ] {
            let mut work = Work {
                used: 0,
                limit: 512 * 1024,
            };
            let contact = leaf_contact(&a.pose(start), sa, &b.pose(start), sb, &mut work).unwrap();
            assert_eq!(contact.dist > 0.01, clear);
            let through = crate::physics3d::solver_trajectory::supported_capsule_face::prefix(
                a,
                sa,
                b,
                sb,
                contact.normal1,
                start,
                end,
                0.01,
                &mut work,
            )
            .unwrap();
            assert_eq!(through == Some(end), clear);

            let middle = start + (end - start) * 0.5;
            for (lo, hi) in [(start, middle), (middle, end)] {
                let ctx = AxisCache::new(a, sa, b, sb, lo, hi, 0.01);
                let rotation = body.pose(lo).rotation;
                let local = rotation.inverse() * contact.normal1;
                let major = local.abs().max_position();
                let mut axis = rp::Vector::ZERO;
                axis[major] = local[major].signum();
                assert!(!super::separated(&ctx, rotation * axis, &mut work).unwrap());
                assert_eq!(
                    super::separated(&ctx, contact.normal1, &mut work).unwrap(),
                    clear
                );
            }
        }
    }
}
