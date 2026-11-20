//! Actual proxy work admission; original Native query arithmetic is the oracle.
use super::*;
use rapier3d::parry::query::sweep_toi::{
    proxy_distance, proxy_distance_with_local_witness, proxy_distance_with_local_witness_metered,
    ProxyDistanceOutput, ProxyDistanceWork, SimplexCache,
};

fn work() -> Work {
    Work {
        used: 0,
        limit: 32 * 1024 * 1024,
    }
}
fn cache_bits(cache: &SimplexCache) -> Vec<u32> {
    let mut bits = vec![cache.metric.to_bits(), u32::from(cache.count)];
    bits.extend(cache.index_a);
    bits.extend(cache.index_b);
    bits
}
fn output_bits(output: ProxyDistanceOutput, a: rp::Vector, b: rp::Vector) -> Vec<u32> {
    let mut bits = Vec::new();
    for value in [output.point_a, output.point_b, output.normal, a, b] {
        bits.extend(value.to_array().map(f32::to_bits));
    }
    bits.extend([output.distance.to_bits(), output.iterations]);
    bits
}
fn contact_bits(contact: rapier3d::parry::query::Contact) -> Vec<u32> {
    let mut bits = Vec::new();
    for point in [
        contact.point1,
        contact.point2,
        contact.normal1,
        contact.normal2,
    ] {
        bits.extend(point.to_array().map(f32::to_bits));
    }
    bits.push(contact.dist.to_bits());
    bits
}

#[test]
fn metered_proxy_preserves_original_output_and_cache_bits_for_cold_warm_and_overlap_queries() {
    for (sa, sb, pos) in [
        (
            rp::SharedShape::cuboid(0.5, 0.25, 0.75),
            rp::SharedShape::ball(0.1),
            rp::Pose::from_translation(rp::Vector::X * 3.),
        ),
        (
            rp::SharedShape::capsule_y(0.5, 0.2),
            rp::SharedShape::capsule_y(0.25, 0.3),
            rp::Pose::from_parts(
                rp::Vector::new(1., 0.2, 0.3),
                rp::Rotation::from_rotation_z(0.3),
            ),
        ),
        (
            rp::SharedShape::ball(0.2),
            rp::SharedShape::ball(0.3),
            rp::Pose::IDENTITY,
        ),
    ] {
        let a = ToiProxy::from_shape(sa.as_ref()).unwrap();
        let b = ToiProxy::from_shape(sb.as_ref()).unwrap();
        let bytes = crate::checkpoint_codec::encode(&(&sa, &sb, pos)).unwrap();
        let mut original = SimplexCache::default();
        for _ in 0..3 {
            let mut metered = original;
            let mut plain = original;
            let expected = proxy_distance_with_local_witness(&pos, &a, &b, &mut original);
            let native = proxy_distance(&pos, &a, &b, false, &mut plain);
            let mut events = Vec::new();
            let actual = proxy_distance_with_local_witness_metered(
                &pos,
                &a,
                &b,
                &mut metered,
                &mut |event| {
                    events.push(event);
                    Ok::<_, TrajectoryError>(())
                },
            )
            .unwrap();
            assert_eq!(
                output_bits(expected.0, expected.1, expected.2),
                output_bits(actual.0, actual.1, actual.2)
            );
            assert_eq!(
                output_bits(native, rp::Vector::ZERO, rp::Vector::ZERO),
                output_bits(expected.0, rp::Vector::ZERO, rp::Vector::ZERO)
            );
            assert_eq!(cache_bits(&metered), cache_bits(&original));
            assert_eq!(cache_bits(&plain), cache_bits(&original));
            assert_eq!(events.first(), Some(&ProxyDistanceWork::Bootstrap));
            assert_eq!(events.last(), Some(&ProxyDistanceWork::Finish));
            let iterations = events
                .iter()
                .filter(|e| matches!(e, ProxyDistanceWork::Iteration { .. }))
                .count();
            assert!((1..=32).contains(&iterations));
            for event in events {
                if let ProxyDistanceWork::Support { points_a, points_b } = event {
                    assert_eq!((points_a, points_b), (a.points().len(), b.points().len()));
                }
            }
        }
        assert_eq!(
            crate::checkpoint_codec::encode(&(&sa, &sb, pos)).unwrap(),
            bytes
        );
    }
}

#[test]
fn every_proxy_admission_error_leaves_cache_unchanged_and_exact_quota_commits_once() {
    let sa = rp::SharedShape::cuboid(0.5, 0.25, 0.75);
    let sb = rp::SharedShape::ball(0.1);
    let a = ToiProxy::from_shape(sa.as_ref()).unwrap();
    let b = ToiProxy::from_shape(sb.as_ref()).unwrap();
    let pos = rp::Pose::from_translation(rp::Vector::new(3., 0.2, 0.1));
    let mut warm = SimplexCache::default();
    proxy_distance_with_local_witness(&pos, &a, &b, &mut warm);
    for initial in [
        SimplexCache::default(),
        warm,
        SimplexCache { count: 255, ..warm },
    ] {
        let mut result_cache = initial;
        let mut events = Vec::new();
        let expected = proxy_distance_with_local_witness_metered(
            &pos,
            &a,
            &b,
            &mut result_cache,
            &mut |event| {
                events.push(event);
                Ok::<_, u32>(())
            },
        )
        .unwrap();
        for denied in 0..events.len() {
            let mut cache = initial;
            let mut calls = 0;
            let error =
                proxy_distance_with_local_witness_metered(&pos, &a, &b, &mut cache, &mut |event| {
                    let index = calls;
                    calls += 1;
                    assert_eq!(event, events[index]);
                    if index == denied {
                        Err(71_u32)
                    } else {
                        Ok(())
                    }
                })
                .unwrap_err();
            assert_eq!(error, 71);
            assert_eq!(calls, denied + 1);
            assert_eq!(cache_bits(&cache), cache_bits(&initial));
        }
        let mut cache = initial;
        let mut exact = Work {
            used: 0,
            limit: events.len() as u64,
        };
        let actual =
            proxy_distance_with_local_witness_metered(&pos, &a, &b, &mut cache, &mut |_| {
                exact.charge(1)
            })
            .unwrap();
        assert_eq!(
            output_bits(actual.0, actual.1, actual.2),
            output_bits(expected.0, expected.1, expected.2)
        );
        assert_eq!(cache_bits(&cache), cache_bits(&result_cache));
        assert_eq!(exact.used, exact.limit);
        let mut cache = initial;
        let mut short = Work {
            used: 0,
            limit: events.len() as u64 - 1,
        };
        assert!(matches!(
            proxy_distance_with_local_witness_metered(&pos, &a, &b, &mut cache, &mut |_| short
                .charge(1)),
            Err(TrajectoryError::WorkLimit)
        ));
        assert_eq!(cache_bits(&cache), cache_bits(&initial));
    }
}

#[test]
fn zero_reported_iterations_still_admits_the_actual_simplex_and_finish_before_return() {
    let shape = rp::SharedShape::ball(0.5);
    let proxy = ToiProxy::from_shape(shape.as_ref()).unwrap();
    let mut events = Vec::new();
    let mut cache = SimplexCache::default();
    let result = proxy_distance_with_local_witness_metered(
        &rp::Pose::IDENTITY,
        &proxy,
        &proxy,
        &mut cache,
        &mut |stage| {
            events.push(stage);
            Ok::<_, TrajectoryError>(())
        },
    )
    .unwrap();
    assert_eq!(result.0.iterations, 0);
    assert_eq!(
        events,
        vec![
            ProxyDistanceWork::Bootstrap,
            ProxyDistanceWork::Iteration {
                simplex_vertices: 1
            },
            ProxyDistanceWork::Finish
        ]
    );
    assert_eq!(cache_bits(&cache), cache_bits(&SimplexCache::default()));
}

#[test]
fn specialized_finite_contacts_do_not_pay_or_construct_an_unused_proxy_gjk() {
    let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let capsule = rp::SharedShape::capsule_y(0.25, 0.25);
    let origin = rp::Pose::IDENTITY;
    let away = rp::Pose::from_translation(rp::Vector::X * 3.);
    let mut finite = work();
    let expected = feature_contact::cuboids(
        &origin,
        box_shape.as_cuboid().unwrap(),
        &away,
        box_shape.as_cuboid().unwrap(),
        &mut finite,
    )
    .unwrap()
    .unwrap();
    let mut actual = work();
    let result = leaf_contact(
        &origin,
        box_shape.as_ref(),
        &away,
        box_shape.as_ref(),
        &mut actual,
    )
    .unwrap();
    assert_eq!(contact_bits(result), contact_bits(expected));
    assert_eq!(actual.used, 32 + finite.used);
    let mut finite = work();
    let expected = feature_contact::cuboid_capsule(
        &origin,
        box_shape.as_cuboid().unwrap(),
        &away,
        capsule.as_capsule().unwrap(),
        &mut finite,
    )
    .unwrap()
    .unwrap();
    let mut actual = work();
    let result = leaf_contact(
        &origin,
        box_shape.as_ref(),
        &away,
        capsule.as_ref(),
        &mut actual,
    )
    .unwrap();
    assert_eq!(contact_bits(result), contact_bits(expected));
    assert_eq!(actual.used, finite.used);
}

#[test]
fn leaf_meter_exact_quota_keeps_full_native_fallback_work_and_inputs_unchanged() {
    let box_shape = rp::SharedShape::cuboid(0.5, 0.5, 0.5);
    let sphere = rp::SharedShape::ball(0.25);
    let a = rp::Pose::IDENTITY;
    for b in [
        rp::Pose::from_translation(rp::Vector::X * 3.),
        rp::Pose::IDENTITY,
    ] {
        let source = crate::checkpoint_codec::encode(&(&box_shape, &sphere, a, b)).unwrap();
        let mut measured = work();
        let expected =
            leaf_contact(&a, box_shape.as_ref(), &b, sphere.as_ref(), &mut measured).unwrap();
        if b == rp::Pose::IDENTITY {
            let mut fallback = work();
            let native = rapier3d::parry::query::contact_point_cloud_metered(
                &a,
                box_shape.as_ref(),
                &b,
                sphere.as_ref(),
                f32::MAX,
                &mut |event| native_contact_work(event, &mut fallback),
            )
            .unwrap()
            .unwrap();
            assert_eq!(contact_bits(native), contact_bits(expected));
            assert!(fallback.used > 0 && measured.used > fallback.used);
        }
        let mut exact = Work {
            used: 0,
            limit: measured.used,
        };
        let actual = leaf_contact(&a, box_shape.as_ref(), &b, sphere.as_ref(), &mut exact).unwrap();
        assert_eq!(contact_bits(actual), contact_bits(expected));
        assert_eq!(exact.used, measured.used);
        assert!(matches!(
            leaf_contact(
                &a,
                box_shape.as_ref(),
                &b,
                sphere.as_ref(),
                &mut Work {
                    used: 0,
                    limit: measured.used - 1
                }
            ),
            Err(TrajectoryError::WorkLimit)
        ));
        assert_eq!(
            crate::checkpoint_codec::encode(&(&box_shape, &sphere, a, b)).unwrap(),
            source
        );
    }
}

fn optional_contact_bits(contact: Option<rapier3d::parry::query::Contact>) -> Option<Vec<u32>> {
    contact.map(contact_bits)
}

#[test]
fn native_meter_preserves_dispatch_bits_for_every_point_cloud_leaf_in_both_orders() {
    use rapier3d::parry::query::{contact, contact_point_cloud_metered};
    let vertices = [
        rp::Vector::new(-0.5, -0.3, -0.4),
        rp::Vector::new(0.6, -0.3, -0.4),
        rp::Vector::new(0., 0.7, -0.4),
        rp::Vector::new(0., 0., 0.8),
    ];
    let shapes = vec![
        rp::SharedShape::ball(0.3),
        rp::SharedShape::segment(rp::Vector::Y * -0.4, rp::Vector::Y * 0.4),
        rp::SharedShape::triangle(vertices[0], vertices[1], vertices[2]),
        rp::SharedShape::cuboid(0.5, 0.3, 0.4),
        rp::SharedShape::capsule_y(0.4, 0.2),
        rp::SharedShape::convex_hull(&vertices).unwrap(),
        rp::SharedShape::round_cuboid(0.5, 0.3, 0.4, 0.1),
        rp::SharedShape::round_triangle(vertices[0], vertices[1], vertices[2], 0.1),
        rp::SharedShape::round_convex_hull(&vertices, 0.1).unwrap(),
    ];
    let ball = rp::SharedShape::ball(0.25);
    for shape in &shapes {
        assert!(ToiProxy::from_shape(shape.as_ref()).is_some());
        for reverse in [false, true] {
            let (a, b) = if reverse {
                (&ball, shape)
            } else {
                (shape, &ball)
            };
            for displacement in [
                rp::Vector::new(3., 0.2, 0.1),
                rp::Vector::new(0.1, 0.2, 0.15),
            ] {
                let pa = rp::Pose::from_parts(
                    rp::Vector::new(0.25, -0.125, 0.5),
                    rp::Rotation::from_rotation_y(0.2),
                );
                let pb = rp::Pose::from_parts(
                    pa.translation + displacement,
                    rp::Rotation::from_rotation_z(0.3),
                );
                let source = crate::checkpoint_codec::encode(&(a, b, pa, pb)).unwrap();
                let expected = contact(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX).unwrap();
                let mut used = work();
                let actual = contact_point_cloud_metered(
                    &pa,
                    a.as_ref(),
                    &pb,
                    b.as_ref(),
                    f32::MAX,
                    &mut |event| native_contact_work(event, &mut used),
                )
                .unwrap();
                assert_eq!(
                    optional_contact_bits(actual),
                    optional_contact_bits(expected)
                );
                assert!(used.used > 0);
                assert_eq!(
                    crate::checkpoint_codec::encode(&(a, b, pa, pb)).unwrap(),
                    source
                );
            }
        }
    }
    // The non-ball dispatcher takes the same support-map path for all pairs.
    for a in &shapes {
        for b in &shapes {
            let pa = rp::Pose::IDENTITY;
            let pb = rp::Pose::from_parts(
                rp::Vector::new(3., 0.2, 0.1),
                rp::Rotation::from_rotation_y(0.2),
            );
            let expected = contact(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX).unwrap();
            let mut used = work();
            let actual = contact_point_cloud_metered(
                &pa,
                a.as_ref(),
                &pb,
                b.as_ref(),
                f32::MAX,
                &mut |event| native_contact_work(event, &mut used),
            )
            .unwrap();
            assert_eq!(
                optional_contact_bits(actual),
                optional_contact_bits(expected)
            );
        }
    }
}

#[test]
fn native_epa_every_admission_error_discards_local_storage_and_preserves_input_bytes() {
    use rapier3d::parry::query::{
        contact, contact_point_cloud_metered, NativeContactError, NativeContactPhase as Phase,
        NativeContactWork as Event,
    };
    let a = rp::SharedShape::cuboid(0.7, 0.5, 0.4);
    let b = rp::SharedShape::capsule_y(0.4, 0.25);
    let pa = rp::Pose::IDENTITY;
    let pb = rp::Pose::from_parts(
        rp::Vector::new(0.1, 0.2, 0.15),
        rp::Rotation::from_rotation_z(0.3),
    );
    let bytes = crate::checkpoint_codec::encode(&(&a, &b, pa, pb)).unwrap();
    let expected = contact(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX).unwrap();
    let mut events = Vec::new();
    let actual =
        contact_point_cloud_metered(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX, &mut |event| {
            events.push(event);
            Ok::<_, u32>(())
        })
        .unwrap();
    assert_eq!(
        optional_contact_bits(actual),
        optional_contact_bits(expected)
    );
    for required in [
        Phase::GjkBootstrap,
        Phase::GjkIteration,
        Phase::EpaBootstrap,
        Phase::EpaExpansion,
    ] {
        assert!(
            events.contains(&Event::Fixed(required)),
            "missing {required:?}"
        );
    }
    assert!(events.iter().any(|e| matches!(e, Event::HeapVisits(_))));
    assert!(events.iter().any(|e| matches!(e, Event::EdgeVisit)));
    assert!(events.iter().any(|e| matches!(e, Event::FaceVisit)));
    assert!(events.iter().any(|e| matches!(e, Event::Storage { .. })));
    for denied in 0..events.len() {
        let mut calls = 0;
        let error =
            contact_point_cloud_metered(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX, &mut |event| {
                let at = calls;
                calls += 1;
                assert_eq!(event, events[at]);
                if at == denied {
                    Err(93_u32)
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
        assert!(matches!(error, NativeContactError::Admission(93)));
        assert_eq!(calls, denied + 1);
        assert_eq!(
            crate::checkpoint_codec::encode(&(&a, &b, pa, pb)).unwrap(),
            bytes
        );
    }
    // An ordinary query after any cancelled local workspace sees the same data.
    assert_eq!(
        optional_contact_bits(contact(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX).unwrap()),
        optional_contact_bits(expected)
    );
}

#[test]
fn native_meter_uses_one_shared_work_ledger_for_phases_storage_and_exact_one_below() {
    use rapier3d::parry::query::{
        contact_point_cloud_metered, NativeContactError, NativeContactWork as Event,
    };
    let a = rp::SharedShape::capsule_y(0.5, 0.3);
    let b = rp::SharedShape::cuboid(0.6, 0.7, 0.5);
    let pa = rp::Pose::IDENTITY;
    let pb = rp::Pose::from_parts(
        rp::Vector::new(0.2, 0.1, 0.1),
        rp::Rotation::from_rotation_z(0.2),
    );
    let mut measured = work();
    let mut requested = 0_usize;
    let expected =
        contact_point_cloud_metered(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX, &mut |event| {
            if let Event::Storage {
                requested_bytes, ..
            } = event
            {
                requested += requested_bytes;
            }
            native_contact_work(event, &mut measured)
        })
        .unwrap();
    assert!(requested > 0);
    assert!(measured.used >= requested as u64);
    let mut exact = Work {
        used: 17,
        limit: 17 + measured.used,
    };
    let actual =
        contact_point_cloud_metered(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX, &mut |event| {
            native_contact_work(event, &mut exact)
        })
        .unwrap();
    assert_eq!(
        optional_contact_bits(actual),
        optional_contact_bits(expected)
    );
    assert_eq!(exact.used, exact.limit);
    let mut below = Work {
        used: 17,
        limit: 16 + measured.used,
    };
    assert!(matches!(
        contact_point_cloud_metered(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX, &mut |event| {
            native_contact_work(event, &mut below)
        }),
        Err(NativeContactError::Admission(TrajectoryError::WorkLimit))
    ));
    assert!(below.used <= below.limit);
    let mut overflow = Work {
        used: u64::MAX,
        limit: u64::MAX,
    };
    assert!(matches!(
        contact_point_cloud_metered(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX, &mut |event| {
            native_contact_work(event, &mut overflow)
        }),
        Err(NativeContactError::Admission(TrajectoryError::WorkLimit))
    ));
    assert_eq!(overflow.used, u64::MAX);
}

#[test]
fn native_degenerate_zero_support_keeps_original_six_direction_bootstrap_and_contact() {
    use rapier3d::parry::query::{
        contact, contact_point_cloud_metered, NativeContactPhase as Phase,
        NativeContactWork as Event,
    };
    // Vendor-supported degenerate leaves; this is not a new public BodyDesc policy.
    let shape = rp::SharedShape::segment(rp::Vector::ZERO, rp::Vector::ZERO);
    let pose = rp::Pose::IDENTITY;
    let expected = contact(&pose, shape.as_ref(), &pose, shape.as_ref(), f32::MAX).unwrap();
    let mut events = Vec::new();
    let actual = contact_point_cloud_metered(
        &pose,
        shape.as_ref(),
        &pose,
        shape.as_ref(),
        f32::MAX,
        &mut |event| {
            events.push(event);
            Ok::<_, TrajectoryError>(())
        },
    )
    .unwrap();
    assert_eq!(
        optional_contact_bits(actual),
        optional_contact_bits(expected)
    );
    assert_eq!(
        events
            .iter()
            .filter(|e| matches!(e, Event::Support { .. }))
            .count(),
        7
    );
    assert!(events.contains(&Event::Fixed(Phase::GjkBootstrap)));
    assert!(events.contains(&Event::Fixed(Phase::EpaBootstrap)));
    assert!(!events.contains(&Event::Fixed(Phase::GjkIteration)));
    assert!(!events.contains(&Event::Fixed(Phase::EpaExpansion)));
}

#[test]
fn native_epa_backing_requests_grow_geometrically_without_changing_contacts() {
    use rapier3d::parry::query::{
        contact, contact_point_cloud_metered, NativeContactStorage as Storage,
        NativeContactWork as Event,
    };
    let a = rp::SharedShape::cuboid(0.7, 0.5, 0.4);
    let b = rp::SharedShape::capsule_y(0.4, 0.25);
    let pa = rp::Pose::IDENTITY;
    let pb = rp::Pose::from_parts(
        rp::Vector::new(0.1, 0.2, 0.15),
        rp::Rotation::from_rotation_z(0.3),
    );
    let expected = contact(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX).unwrap();
    let mut storage_events = Vec::new();
    let mut measured = work();
    let actual =
        contact_point_cloud_metered(&pa, a.as_ref(), &pb, b.as_ref(), f32::MAX, &mut |event| {
            if let Event::Storage {
                storage,
                requested_bytes,
                relocated_elements,
                relocated_bytes,
            } = event
            {
                storage_events.push((
                    storage,
                    requested_bytes,
                    relocated_elements,
                    relocated_bytes,
                ));
            }
            native_contact_work(event, &mut measured)
        })
        .unwrap();
    assert_eq!(
        optional_contact_bits(actual),
        optional_contact_bits(expected)
    );
    assert!(storage_events.iter().any(|e| e.0 == Storage::Vertices));
    assert!(storage_events.iter().any(|e| e.0 == Storage::Heap));
    let mut grown = false;
    for (_, requested, moved, moved_bytes) in storage_events {
        if moved == 0 {
            assert!(requested >= 4);
        } else {
            // Growth occurs only at len==capacity; request twice that backing.
            assert_eq!(requested, moved_bytes * 2);
            grown = true;
        }
    }
    assert!(
        grown,
        "the actual overlapping EPA fixture must exercise a growth request"
    );
}
