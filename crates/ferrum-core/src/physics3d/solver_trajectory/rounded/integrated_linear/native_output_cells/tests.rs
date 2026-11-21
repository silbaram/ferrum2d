use super::super::rp;
use super::*;
use crate::physics3d::solver_trajectory::{
    cast_full_shapes_policy, leaf_contact, world_contact, Curve, Domain, Kernel, ShapeMotion,
};

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn motion(id: u32, domain: Domain, h: f32, origin: f32, velocity: f32) -> ShapeMotion {
    let mut k = Kernel::from_velocity_seconds(
        rp::RigidBodyHandle::from_raw_parts(id, 0),
        domain,
        h,
        rp::Pose::from_translation(rp::Vector::X * origin),
        rp::Vector::X * velocity,
        rp::Vector::ZERO,
    )
    .unwrap();
    k.native.motion.start_time = domain.start as f32;
    k.native.motion.end_time = domain.end as f32;
    ShapeMotion {
        curve: Curve::Integrated(k),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    }
}

#[test]
fn complete_native_output_cells_cover_large_input_images_and_exact_work() {
    let d = Domain::new(0., 1.).unwrap();
    let a = motion(0, d, 1., -32., -1.);
    let b = motion(1, d, 1., -31.48, -1.);
    let dt = [f32::from_bits(1_f32.to_bits() - 4096), 1.];
    let source = |m| {
        Source::new(m, f64::from(dt[0]), 1., &mut work())
            .unwrap()
            .unwrap()
    };
    let sa = source(a);
    let sb = source(b);
    let before = crate::checkpoint_codec::encode(&(a, b)).unwrap();
    let call = |w: &mut Work| separated(sa, sb, dt, 0, 1., 0., 0., 0.25, 0.25, 0.01, w);
    let mut paid = work();
    assert!(call(&mut paid).unwrap());
    assert!(paid.used < 4097 * 256);
    assert!(separated(sb, sa, dt, 0, -1., 0., 0., 0.25, 0.25, 0.01, &mut work()).unwrap());
    // Independent original world-point distance over EVERY input, not just
    // the output-cell nominees used by the certificate.
    for key in dt[0].to_bits()..=dt[1].to_bits() {
        let time = f64::from(f32::from_bits(key));
        let ca = a.pose(time) * rp::Vector::ZERO;
        let cb = b.pose(time) * rp::Vector::ZERO;
        assert!(f64::from(cb.x) - f64::from(ca.x) - 0.5 > f64::from(0.01_f32));
    }
    for limit in [paid.used, paid.used - 1] {
        let result = call(&mut Work { used: 0, limit });
        if limit == paid.used {
            assert!(result.unwrap());
        } else {
            assert_eq!(result, Err(TrajectoryError::WorkLimit));
        }
    }
    assert_eq!(crate::checkpoint_codec::encode(&(a, b)).unwrap(), before);
}

#[test]
fn output_cell_proof_declines_real_contact_equality_and_incomplete_partitions() {
    let d = Domain::new(0., 1.).unwrap();
    let dt = [f32::from_bits(1_f32.to_bits() - 4096), 1.];
    let source = |id, origin, v| {
        Source::new(
            motion(id, d, 1., origin, v),
            f64::from(dt[0]),
            1.,
            &mut work(),
        )
        .unwrap()
        .unwrap()
    };
    let a = source(0, -32., -1.);
    for (origin, margin) in [(-31.5, 0.), (-31.51, 0.01)] {
        assert!(!separated(
            a,
            source(1, origin, -1.),
            dt,
            0,
            1.,
            0.,
            0.,
            0.25,
            0.25,
            margin,
            &mut work()
        )
        .unwrap());
    }
    // Both output spans exceed the fixed cap; an absent certificate is not
    // clearance, even for a visibly distant pair.
    assert!(!separated(
        source(0, -32., -1024.),
        source(1, -30., -1024.),
        dt,
        0,
        1.,
        0.,
        0.,
        0.25,
        0.25,
        0.01,
        &mut work()
    )
    .unwrap());
    // The first graph crosses zero and the other has too many output cells.
    assert!(!separated(
        source(0, 1., -1.),
        source(1, 2., -1.),
        dt,
        0,
        1.,
        0.,
        0.,
        0.25,
        0.25,
        0.01,
        &mut work()
    )
    .unwrap());
}

#[test]
fn recorded_clear_right_pairs_keep_interior_contact_and_reduce_nohit_search_work() {
    let d = Domain::new(0.07500000111758709, 0.10000000149011612).unwrap();
    let end = 0.09999970439821482;
    let shape = rp::SharedShape::capsule_y(0.25, 0.25);
    let tolerance = f64::from((0.1_f32 - 0.075_f32) * 1e-6);
    for (ids, origins, rates, has_hit, old_work) in [
        (
            [2, 1],
            [-9.8974905, -9.264992],
            [-105.29988, -110.19989],
            true,
            2_525_338,
        ),
        (
            [6, 5],
            [-12.427491, -11.794992],
            [-85.69988, -90.599884],
            false,
            2_334_088,
        ),
    ] {
        let a = motion(ids[0], d, 0.025, origins[0], rates[0]);
        let b = motion(ids[1], d, 0.025, origins[1], rates[1]);
        let before = crate::checkpoint_codec::encode(&(a, b, &shape)).unwrap();
        let mut paid = work();
        let found = cast_full_shapes_policy(
            a,
            shape.as_ref(),
            b,
            shape.as_ref(),
            d.start,
            end,
            0.01,
            tolerance,
            &mut paid,
            true,
        )
        .unwrap();
        assert_eq!(found.is_some(), has_hit, "pair={ids:?}");
        if let Some(hit) = found {
            assert!(
                d.start <= hit.safe_time && hit.safe_time < hit.hit_time && hit.hit_time <= end
            );
            assert!(hit.hit_time - hit.safe_time <= tolerance);
            let native = leaf_contact(
                &a.pose(hit.hit_time),
                shape.as_ref(),
                &b.pose(hit.hit_time),
                shape.as_ref(),
                &mut work(),
            )
            .unwrap();
            assert!(
                native.dist <= 0.01
                    || world_contact::Pair::new(shape.as_ref(), shape.as_ref(), &mut work())
                        .unwrap()
                        .unwrap()
                        .at(a, b, hit.hit_time, 0.01, &mut work())
                        .unwrap()
                        .is_some_and(|w| w.strict)
            );
        }
        assert!(
            paid.used < old_work,
            "pair={ids:?} before={old_work} after={}",
            paid.used
        );
        eprintln!(
            "NATIVE_OUTPUT_CELL_RECORDED pair={ids:?} old={old_work} new={} has_hit={has_hit}",
            paid.used
        );
        assert_eq!(
            crate::checkpoint_codec::encode(&(a, b, &shape)).unwrap(),
            before
        );
    }
}
