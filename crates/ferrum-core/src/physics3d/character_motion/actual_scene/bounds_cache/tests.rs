use super::*;
use crate::physics3d::{
    solver_trajectory::{Domain, Kernel},
    world::native_id,
    BodyDesc, BodyId, BodyKind, ColliderDesc, PhysicsWorld3d, Pose, Shape, ShapePart, WorldConfig,
};

fn work() -> Work {
    Work {
        used: 0,
        limit: crate::physics3d::character_motion::trajectory::MAX_PROOF_WORK,
    }
}
fn body(w: &mut PhysicsWorld3d, kind: BodyKind, position: [f32; 3], shape: Shape) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: Pose {
                position,
                ..Default::default()
            },
            ..Default::default()
        },
        ColliderDesc::new(shape),
    )
    .unwrap()
}
fn fixture() -> (PhysicsWorld3d, BodyId) {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        ..Default::default()
    })
    .unwrap();
    body(
        &mut w,
        BodyKind::Fixed,
        [0.; 3],
        Shape::Sphere { radius: 1. },
    );
    let b = body(
        &mut w,
        BodyKind::KinematicPosition,
        [1.5, 1.5, 0.],
        Shape::Sphere { radius: 1. },
    );
    (w, b)
}
fn kernel(w: &PhysicsWorld3d, id: BodyId, start: Time, end: Time, velocity: rp::Vector) -> Kernel {
    Kernel::from_velocity_seconds(
        native_id(id),
        Domain::new(start, end).unwrap(),
        1.,
        *w.backend.bodies[native_id(id)].position(),
        velocity,
        rp::Vector::ZERO,
    )
    .unwrap()
}
fn init(cache: &mut BoundsCache, count: usize) -> usize {
    let full = 1 << 20;
    let layout = BoundsCache::layout(full, count, cache.retained_bytes().unwrap()).unwrap();
    cache.prepare_epoch(layout, &mut work()).unwrap();
    assert!(cache.retained_bytes().unwrap() <= layout.reserved());
    full - layout.reserved()
}
fn prepare(
    w: &PhysicsWorld3d,
    scene: &mut Scratch,
    cache: &mut BoundsCache,
    tracks: &[BodyTrajectory],
    start: Time,
    end: Time,
    ledger: &mut Work,
) {
    scene
        .prepare_cached(
            &w.backend.bodies,
            &w.backend.colliders,
            tracks,
            &w.characters,
            start,
            end,
            1 << 20,
            ledger,
            cache,
        )
        .unwrap();
}
fn bits(bounds: Aabb) -> ([u32; 3], [u32; 3]) {
    (
        bounds.mins.to_array().map(f32::to_bits),
        bounds.maxs.to_array().map(f32::to_bits),
    )
}
type SceneBits = Vec<(rp::ColliderHandle, ([u32; 3], [u32; 3]))>;
fn scene_bits(scene: &Scratch) -> SceneBits {
    scene
        .colliders
        .iter()
        .map(|c| (c.collider, bits(c.bounds)))
        .collect()
}
fn hit_bits(hit: Option<Hit>) -> Option<(rp::ColliderHandle, rp::ColliderHandle, u64, u64, u32)> {
    hit.map(|h| {
        (
            h.a.collider,
            h.b.collider,
            h.cast.safe_time.to_bits(),
            h.cast.hit_time.to_bits(),
            h.cast.contact.dist.to_bits(),
        )
    })
}

#[test]
fn exact_scene_rebuild_reuses_whole_bounds_and_preserves_query_filters_order_and_world_bytes() {
    let (w, b) = fixture();
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel(&w, b, 0., 1., rp::Vector::X * 0.1)),
    }];
    let mut cache = BoundsCache::default();
    init(&mut cache, w.backend.colliders.len());
    let mut scene = Scratch::default();
    let original = w.capture_snapshot().unwrap();
    let mut cold = work();
    prepare(&w, &mut scene, &mut cache, &tracks, 0., 1., &mut cold);
    let first = scene_bits(&scene);
    let before_hits = cache.hits;
    let mut warm = work();
    prepare(&w, &mut scene, &mut cache, &tracks, 0., 1., &mut warm);
    assert_eq!(scene_bits(&scene), first);
    assert_eq!(cache.hits - before_hits, 2);
    assert!(warm.used < cold.used);
    let mut fresh = Scratch::default();
    fresh
        .prepare(
            &w.backend.bodies,
            &w.backend.colliders,
            &tracks,
            &w.characters,
            0.,
            1.,
            1 << 20,
            &mut work(),
        )
        .unwrap();
    assert_eq!(scene_bits(&scene), scene_bits(&fresh));
    for enabled in [true, false] {
        let query = |s: &Scratch| {
            s.first_hit_policy(
                &w.backend.colliders,
                &w.contact_policies,
                0.,
                1.,
                0.01,
                1e-6,
                &mut work(),
                &|_, _| enabled,
                &|_, _| 0.01,
            )
            .unwrap()
        };
        assert_eq!(hit_bits(query(&scene)), hit_bits(query(&fresh)));
    }
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        original.encoded_bytes()
    );
    cache.invalidate(); // the same operation used by begin_tick
    init(&mut cache, w.backend.colliders.len());
    assert!(cache.slots.iter().all(Option::is_none));
    prepare(&w, &mut scene, &mut cache, &tracks, 0., 1., &mut work());
    assert_eq!(cache.hits, 0, "a new tick cannot consume a previous epoch");
    assert_eq!(scene_bits(&scene), first);
}

#[test]
fn narrower_queries_recompute_exact_bounds_order_and_hits_and_changed_inputs_miss() {
    let (mut w, b) = fixture();
    let source = kernel(&w, b, 0., 1., rp::Vector::X * 0.1);
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(source),
    }];
    let mut cache = BoundsCache::default();
    init(&mut cache, w.backend.colliders.len());
    let mut scene = Scratch::default();
    prepare(&w, &mut scene, &mut cache, &tracks, 0., 1., &mut work());
    let record = *scene
        .colliders
        .iter()
        .find(|c| c.parent == Some(native_id(b)))
        .unwrap();
    let shape = w.backend.colliders[record.collider].shape();
    let old_hits = cache.hits;
    let old_misses = cache.misses;
    let reused = cache
        .bounds(&record, shape, 0.25, 0.75, &mut work())
        .unwrap();
    let fresh = record
        .motion
        .bounds(shape, 0.25, 0.75, &mut work())
        .unwrap();
    assert_eq!(cache.hits, old_hits);
    assert_eq!(cache.misses, old_misses + 1);
    assert_eq!(bits(reused), bits(fresh));
    let mut narrow_scene = Scratch::default();
    prepare(
        &w,
        &mut narrow_scene,
        &mut cache,
        &tracks,
        0.25,
        0.75,
        &mut work(),
    );
    let mut narrow_fresh = Scratch::default();
    narrow_fresh
        .prepare(
            &w.backend.bodies,
            &w.backend.colliders,
            &tracks,
            &w.characters,
            0.25,
            0.75,
            1 << 20,
            &mut work(),
        )
        .unwrap();
    assert_eq!(scene_bits(&narrow_scene), scene_bits(&narrow_fresh));
    let narrow_hit = |s: &Scratch| {
        s.first_hit_policy(
            &w.backend.colliders,
            &w.contact_policies,
            0.25,
            0.75,
            0.01,
            1e-6,
            &mut work(),
            &|_, _| true,
            &|_, _| 0.01,
        )
        .unwrap()
    };
    assert_eq!(
        hit_bits(narrow_hit(&narrow_scene)),
        hit_bits(narrow_hit(&narrow_fresh))
    );
    for change in 0..6 {
        let mut changed = record;
        if change < 4 {
            let mut k = source;
            match change {
                0 => k.native.linear_velocity.x += 0.01,
                1 => k.native.integration_seconds = k.native.integration_seconds.next_up(),
                2 => k.native.motion.end.translation.x += 0.2,
                _ => k.domain.end = k.domain.end.next_up(),
            }
            changed.motion.curve = Curve::Integrated(k);
        } else if change == 4 {
            changed.motion.local_pose.translation.x = 0.25;
        } else {
            let (i, g) = record.collider.into_raw_parts();
            changed.collider = rp::ColliderHandle::from_raw_parts(i, g + 1);
        }
        let hits = cache.hits;
        let actual = cache.bounds(&changed, shape, 0., 1., &mut work()).unwrap();
        let expected = changed.motion.bounds(shape, 0., 1., &mut work()).unwrap();
        assert_eq!(bits(actual), bits(expected));
        assert_eq!(cache.hits, hits);
    }
    w.backend
        .colliders
        .get_mut(record.collider)
        .unwrap()
        .set_shape(rp::SharedShape::ball(0.75));
    let shape = w.backend.colliders[record.collider].shape();
    let hits = cache.hits;
    assert_eq!(
        bits(cache.bounds(&record, shape, 0., 1., &mut work()).unwrap()),
        bits(record.motion.bounds(shape, 0., 1., &mut work()).unwrap())
    );
    assert_eq!(cache.hits, hits);
    let inward = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel(&w, b, 0., 1., rp::Vector::new(-1., -1., 0.))),
    }];
    prepare(&w, &mut scene, &mut cache, &inward, 0., 1., &mut work());
    let mut fresh = Scratch::default();
    fresh
        .prepare(
            &w.backend.bodies,
            &w.backend.colliders,
            &inward,
            &w.characters,
            0.,
            1.,
            1 << 20,
            &mut work(),
        )
        .unwrap();
    let query = |s: &Scratch| {
        s.first_hit_policy(
            &w.backend.colliders,
            &w.contact_policies,
            0.,
            1.,
            0.01,
            1e-6,
            &mut work(),
            &|_, _| true,
            &|_, _| 0.01,
        )
        .unwrap()
    };
    let hit = query(&scene).unwrap();
    assert!(hit.cast.hit_time < 1. && hit.cast.contact.dist <= 0.01);
    assert_eq!(hit_bits(Some(hit)), hit_bits(query(&fresh)));
}

#[test]
fn native_retry_clocks_are_separate_ways_and_constant_domains_do_not_fake_a_clock_key() {
    let (w, b) = fixture();
    let mut cache = BoundsCache::default();
    init(&mut cache, w.backend.colliders.len());
    let mut scene = Scratch::default();
    let mut originals = Vec::new();
    for phase in 0..4 {
        let start = f64::from(phase);
        let end = start + 1.;
        let tracks = [BodyTrajectory {
            body: native_id(b),
            curve: Curve::Integrated(kernel(&w, b, start, end, rp::Vector::X * 0.1)),
        }];
        prepare(&w, &mut scene, &mut cache, &tracks, start, end, &mut work());
        originals.push(
            *scene
                .colliders
                .iter()
                .find(|c| c.parent == Some(native_id(b)))
                .unwrap(),
        );
    }
    let hits = cache.hits;
    for (phase, source) in originals.iter().enumerate() {
        let shape = w.backend.colliders[source.collider].shape();
        let start = phase as f64;
        let actual = cache
            .bounds(source, shape, start, start + 1., &mut work())
            .unwrap();
        assert_eq!(bits(actual), bits(source.bounds));
    }
    assert_eq!(cache.hits, hits + 4);
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel(&w, b, 4., 5., rp::Vector::X * 0.1)),
    }];
    prepare(&w, &mut scene, &mut cache, &tracks, 4., 5., &mut work());
    let source = originals[0];
    let shape = w.backend.colliders[source.collider].shape();
    let hits = cache.hits;
    assert_eq!(
        bits(cache.bounds(&source, shape, 0., 1., &mut work()).unwrap()),
        bits(source.bounds)
    );
    assert_eq!(
        cache.hits, hits,
        "fifth clock evicted a bounded way, never skipped a bound"
    );
    assert!(cache.slots.len() <= MAX_BUCKETS * WAYS);
}

#[test]
fn rebased_zero_rate_kernel_reuses_the_original_bound_at_lower_work() {
    let (w, b) = fixture();
    let before = w.capture_snapshot().unwrap();
    let mut cache = BoundsCache::default();
    init(&mut cache, w.backend.colliders.len());
    let mut scene = Scratch::default();
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel(&w, b, 0., 1., rp::Vector::ZERO)),
    }];
    prepare(&w, &mut scene, &mut cache, &tracks, 0., 1., &mut work());
    let mut source = *scene
        .colliders
        .iter()
        .find(|c| c.parent == Some(native_id(b)))
        .unwrap();
    source.motion.curve = Curve::Integrated(kernel(&w, b, 2., 3., rp::Vector::ZERO));
    let shape = w.backend.colliders[source.collider].shape();
    let mut original_work = work();
    let original = source
        .motion
        .bounds(shape, 2., 3., &mut original_work)
        .unwrap();
    assert_eq!(bits(source.bounds), bits(original));
    let hits = cache.hits;
    let mut reused_work = work();
    let reused = cache
        .bounds(&source, shape, 2., 3., &mut reused_work)
        .unwrap();
    assert_eq!(bits(reused), bits(original));
    assert_eq!(cache.hits, hits + 1);
    assert!(reused_work.used < original_work.used);
    assert_eq!(
        w.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn exact_one_below_work_keeps_failed_entries_unpublished_and_scene_unavailable() {
    let (w, b) = fixture();
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel(&w, b, 0., 1., rp::Vector::ZERO)),
    }];
    let mut scene = Scratch::default();
    scene
        .prepare(
            &w.backend.bodies,
            &w.backend.colliders,
            &tracks,
            &w.characters,
            0.,
            1.,
            1 << 20,
            &mut work(),
        )
        .unwrap();
    let source = *scene
        .colliders
        .iter()
        .find(|c| c.parent == Some(native_id(b)))
        .unwrap();
    let shape = w.backend.colliders[source.collider].shape();
    let mut cache = BoundsCache::default();
    init(&mut cache, w.backend.colliders.len());
    let mut measured = work();
    let expected = cache.bounds(&source, shape, 0., 1., &mut measured).unwrap();
    let mut exact = BoundsCache::default();
    init(&mut exact, w.backend.colliders.len());
    let mut ledger = Work {
        used: 0,
        limit: measured.used,
    };
    assert_eq!(
        bits(exact.bounds(&source, shape, 0., 1., &mut ledger).unwrap()),
        bits(expected)
    );
    assert_eq!(ledger.used, measured.used);
    let mut short = BoundsCache::default();
    init(&mut short, w.backend.colliders.len());
    let result = short.bounds(
        &source,
        shape,
        0.,
        1.,
        &mut Work {
            used: 0,
            limit: measured.used - 1,
        },
    );
    assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
    assert!(short.slots.iter().all(Option::is_none));
    let result = scene.prepare_cached(
        &w.backend.bodies,
        &w.backend.colliders,
        &tracks,
        &w.characters,
        0.,
        1.,
        1 << 20,
        &mut Work { used: 0, limit: 0 },
        &mut cache,
    );
    assert!(matches!(result, Err(TrajectoryError::WorkLimit)));
    assert!(!scene.ready && !cache.valid);
    assert_eq!(
        scene
            .first_hit_policy(
                &w.backend.colliders,
                &w.contact_policies,
                0.,
                1.,
                0.01,
                1e-6,
                &mut work(),
                &|_, _| true,
                &|_, _| 0.01
            )
            .err(),
        Some(TrajectoryError::InvalidReference)
    );
}

#[test]
fn epoch_and_actual_retained_capacity_stay_in_the_existing_partition() {
    let mut cache = BoundsCache::default();
    let full = 1 << 20;
    let layout = BoundsCache::layout(full, 60, cache.retained_bytes().unwrap()).unwrap();
    assert!(layout.reserved() <= full / 8);
    let mut measured = work();
    cache.prepare_epoch(layout, &mut measured).unwrap();
    assert_eq!(layout.slots, MAX_BUCKETS * WAYS);
    let bytes = cache.retained_bytes().unwrap();
    assert!(bytes <= layout.reserved());
    cache.invalidate();
    let small = BoundsCache::layout(full, 1, bytes).unwrap();
    assert!(small.reserved() >= bytes);
    cache.prepare_epoch(small, &mut work()).unwrap();
    assert!(cache.retained_bytes().unwrap() <= small.reserved());
    let mut untouched = BoundsCache::default();
    assert!(matches!(
        untouched.prepare_epoch(layout, &mut Work { used: 0, limit: 0 }),
        Err(TrajectoryError::WorkLimit)
    ));
    assert!(untouched.slots.is_empty() && !untouched.valid);
    assert!(matches!(
        BoundsCache::layout(1, 1, bytes),
        Err(TrajectoryError::WorkLimit)
    ));
    let disabled = BoundsCache::layout(256, 1, std::mem::size_of::<BoundsCache>()).unwrap();
    assert_eq!(disabled.slots, 0);
    assert!(disabled.reserved() <= 256);
    let mut growing = BoundsCache::default();
    let initial = BoundsCache::layout(full, 1, growing.retained_bytes().unwrap()).unwrap();
    growing.prepare_epoch(initial, &mut work()).unwrap();
    assert!(growing.slots.capacity() > 0);
    let enlarged = BoundsCache::layout(full, 60, growing.retained_bytes().unwrap()).unwrap();
    let growth_price = 8
        + std::mem::size_of::<BoundsCache>()
        + enlarged.slots * std::mem::size_of::<Option<Entry>>()
        + enlarged.stationary_slots * StationaryPairs::slot_bytes();
    let mut exact_growth = Work {
        used: 0,
        limit: growth_price as u64,
    };
    growing.prepare_epoch(enlarged, &mut exact_growth).unwrap();
    assert_eq!(exact_growth.used, exact_growth.limit);
    assert_eq!(
        growing.old_backing_before_growth, 0,
        "the old request is released before the enlarged request"
    );
    assert!(growing.retained_bytes().unwrap() <= enlarged.reserved());
}

#[test]
fn unsupported_and_ccd_geometry_keep_the_original_bound_and_error_path() {
    let (mut w, b) = fixture();
    body(
        &mut w,
        BodyKind::Fixed,
        [10., 0., 0.],
        Shape::Compound {
            parts: vec![ShapePart {
                pose: Pose::default(),
                shape: Shape::Box {
                    half_extents: [1.; 3],
                },
            }],
        },
    );
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel(&w, b, 0., 1., rp::Vector::ZERO)),
    }];
    let mut scene = Scratch::default();
    scene
        .prepare(
            &w.backend.bodies,
            &w.backend.colliders,
            &tracks,
            &w.characters,
            0.,
            1.,
            1 << 20,
            &mut work(),
        )
        .unwrap();
    let mut cache = BoundsCache::default();
    init(&mut cache, w.backend.colliders.len());
    let compound = *scene
        .colliders
        .iter()
        .find(|c| {
            w.backend.colliders[c.collider]
                .shape()
                .as_compound()
                .is_some()
        })
        .unwrap();
    let shape = w.backend.colliders[compound.collider].shape();
    assert_eq!(
        bits(cache.bounds(&compound, shape, 0., 1., &mut work()).unwrap()),
        bits(compound.bounds)
    );
    assert!(cache.slots.iter().all(Option::is_none));
    let mut source = *scene
        .colliders
        .iter()
        .find(|c| c.parent == Some(native_id(b)))
        .unwrap();
    source.motion.curve = Curve::Ccd {
        sweep: rapier3d::parry::query::sweep_toi::Sweep::from_poses(
            &rp::Pose::from_translation(rp::Vector::new(1.5, 1.5, 0.)),
            &rp::Pose::from_translation(rp::Vector::new(1.6, 1.5, 0.)),
            rp::Vector::ZERO,
        ),
        start_time: 0.,
        end_time: 1.,
    };
    let shape = w.backend.colliders[source.collider].shape();
    let expected = source.motion.bounds(shape, 0., 1., &mut work()).map(bits);
    assert_eq!(
        cache.bounds(&source, shape, 0., 1., &mut work()).map(bits),
        expected
    );
    assert!(cache.slots.iter().all(Option::is_none));
    source.motion.curve = Curve::Constant {
        pose: rp::Pose::IDENTITY,
        start_time: f64::NAN,
        end_time: 1.,
    };
    let expected = source.motion.bounds(shape, 0., 1., &mut work()).map(bits);
    assert_eq!(
        cache.bounds(&source, shape, 0., 1., &mut work()).map(bits),
        expected
    );
}

#[test]
fn prepared_primitive_cast_preserves_filters_hit_and_exact_bound_identity() {
    let (w, b) = fixture();
    let tracks = [BodyTrajectory {
        body: native_id(b),
        curve: Curve::Integrated(kernel(&w, b, 0., 1., rp::Vector::new(-1., -1., 0.))),
    }];
    let mut cache = BoundsCache::default();
    let colliders = &w.backend.colliders;
    init(&mut cache, colliders.len());
    let mut scene = Scratch::default();
    prepare(&w, &mut scene, &mut cache, &tracks, 0., 1., &mut work());
    for source in &scene.colliders {
        let shape = colliders[source.collider].shape();
        assert_eq!(
            cache
                .prepared(source, shape, 0., 1., &mut work())
                .unwrap()
                .map(bits),
            Some(bits(source.bounds))
        );
        assert!(cache
            .prepared(source, shape, 0., 0.75, &mut work())
            .unwrap()
            .is_none());
        assert!(cache
            .prepared(
                source,
                &rapier3d::parry::shape::Ball::new(2.),
                0.,
                1.,
                &mut work()
            )
            .unwrap()
            .is_none());
    }
    let mut events = Vec::new();
    let mut run = |prepared, enabled| {
        let mut memo = PairQueries::new(colliders, &w.contact_policies, 0., 1.).unwrap();
        memo.fit_for_scene(1 << 20, colliders.len(), &mut work())
            .unwrap();
        let mut ledger = work();
        let result = scene
            .first_hit_memoized_policy(
                colliders,
                &w.contact_policies,
                0.,
                1.,
                0.01,
                1e-6,
                &mut ledger,
                &|_, _| enabled,
                &|_, _| super::super::PairClearance::Distance(0.01),
                &|_| false,
                &mut |a, b, event, _| {
                    events.push((a.collider, b.collider, event));
                    Ok(())
                },
                &mut memo,
                prepared,
                0.,
                &[],
            )
            .unwrap();
        (result, std::mem::take(&mut events), ledger.used)
    };
    let (cold, cold_events, cold_work) = run(None, true);
    let (prepared, prepared_events, prepared_work) = run(Some(&cache), true);
    assert_eq!(hit_bits(cold), hit_bits(prepared));
    let cold = cold.unwrap().cast;
    let prepared = prepared.unwrap().cast;
    assert_eq!(cold.contact.point1, prepared.contact.point1);
    assert_eq!(cold.contact.point2, prepared.contact.point2);
    assert_eq!(cold.contact.normal1, prepared.contact.normal1);
    assert_eq!(
        (cold.subshape_a, cold.subshape_b),
        (prepared.subshape_a, prepared.subshape_b)
    );
    assert_eq!(cold_events, prepared_events);
    assert!(
        prepared_work < cold_work,
        "prepared {prepared_work}, original {cold_work}"
    );
    let (disabled, events, _) = run(Some(&cache), false);
    assert!(disabled.is_none() && events.is_empty());
}
