use super::*;
use crate::physics3d::{
    character_query::{self, clearance_work},
    world::native_id,
    BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Pose, Shape, ShapePart, WorldConfig,
};

fn work(limit: u64) -> Work {
    Work { used: 0, limit }
}
fn pose(position: [f32; 3]) -> Pose {
    Pose {
        position,
        ..Default::default()
    }
}
fn create(w: &mut PhysicsWorld3d, kind: BodyKind, position: [f32; 3], shape: Shape) -> BodyId {
    w.create_body(
        BodyDesc {
            kind,
            pose: pose(position),
            ..Default::default()
        },
        ColliderDesc::new(shape),
    )
    .unwrap()
}
struct Fixture {
    world: PhysicsWorld3d,
    actors: Vec<BodyId>,
    floor: Option<BodyId>,
}
fn fixture(floor: bool, ceiling: Option<f32>, compound: bool, second_actor: bool) -> Fixture {
    let mut w = PhysicsWorld3d::new(WorldConfig {
        gravity: [0.; 3],
        step_seconds: 0.1,
        ..Default::default()
    })
    .unwrap();
    let actor = create(
        &mut w,
        BodyKind::KinematicPosition,
        [0., 0.51, 0.],
        Shape::Capsule {
            half_height: 0.25,
            radius: 0.25,
        },
    );
    w.enable_character(actor, CharacterConfig::default())
        .unwrap();
    let box_shape = Shape::Box {
        half_extents: [2., 0.1, 2.],
    };
    let ground = floor.then(|| {
        create(
            &mut w,
            BodyKind::Fixed,
            [0., -0.1, 0.],
            if compound {
                Shape::Compound {
                    parts: vec![
                        ShapePart {
                            pose: Pose::default(),
                            shape: box_shape.clone(),
                        },
                        ShapePart {
                            pose: pose([50., 0., 0.]),
                            shape: box_shape.clone(),
                        },
                    ],
                }
            } else {
                box_shape.clone()
            },
        )
    });
    if let Some(y) = ceiling {
        create(&mut w, BodyKind::Fixed, [0., y, 0.], box_shape);
    }
    let mut actors = vec![actor];
    if second_actor {
        let second = create(
            &mut w,
            BodyKind::KinematicPosition,
            [1., 0.51, 0.],
            Shape::Capsule {
                half_height: 0.25,
                radius: 0.25,
            },
        );
        w.enable_character(second, CharacterConfig::default())
            .unwrap();
        actors.push(second);
    }
    w.refresh_queries();
    Fixture {
        world: w,
        actors,
        floor: ground,
    }
}
fn records(w: &PhysicsWorld3d) -> usize {
    w.backend.colliders.len()
        + w.backend
            .colliders
            .iter()
            .map(|(_, c)| c.shape().as_compound().map_or(1, |s| s.shapes().len()))
            .sum::<usize>()
}
fn query(
    f: &Fixture,
    limit: u64,
    allow: bool,
    substitute: Option<&dyn rp::Shape>,
) -> (
    Result<Option<rp::ColliderHandle>, TrajectoryError>,
    Work,
    clearance_work::Work,
) {
    let w = &f.world;
    let id = f.actors[0];
    let r = &w.characters[&id];
    let c = &w.backend.colliders[crate::physics3d::colliders::native_collider(r.collider)];
    let shape = substitute.unwrap_or(c.shape());
    let position = *c.position();
    let predicate = |h, target: &rp::Collider| {
        allow
            && w.contact_policies
                .one_way_allows(h, target, shape, &position)
            && w.contact_policies
                .pair_allows(Some(native_id(id)), target.parent())
    };
    let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
        flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
        groups: Some(c.collision_groups()),
        exclude_rigid_body: Some(native_id(id)),
        predicate: Some(&predicate),
        ..Default::default()
    });
    let _ = clearance_work::take();
    let mut ledger = work(limit);
    let result = character_query::certified_tight_ground_admitted(
        &w.backend,
        &q,
        shape,
        &position,
        &r.config,
        records(w) as u64 * 64,
        &mut ledger,
    );
    (result, ledger, clearance_work::take())
}
fn original(
    f: &Fixture,
    allow: bool,
    substitute: Option<&dyn rp::Shape>,
) -> Option<rp::ColliderHandle> {
    let w = &f.world;
    let id = f.actors[0];
    let r = &w.characters[&id];
    let c = &w.backend.colliders[crate::physics3d::colliders::native_collider(r.collider)];
    let shape = substitute.unwrap_or(c.shape());
    let position = *c.position();
    let predicate = |h, target: &rp::Collider| {
        allow
            && w.contact_policies
                .one_way_allows(h, target, shape, &position)
            && w.contact_policies
                .pair_allows(Some(native_id(id)), target.parent())
    };
    let q = w.backend.query_pipeline_with_filter(rp::QueryFilter {
        flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
        groups: Some(c.collision_groups()),
        exclude_rigid_body: Some(native_id(id)),
        predicate: Some(&predicate),
        ..Default::default()
    });
    character_query::certified_tight_ground(&w.backend, &q, shape, &position, &r.config)
}

#[test]
fn missing_support_or_unsupported_actor_never_reserves_the_unexecuted_geometry_scan() {
    let f = fixture(false, Some(1.115), false, false);
    let (answer, ledger, visits) = query(&f, u64::MAX, true, None);
    assert_eq!(answer.unwrap(), original(&f, true, None));
    assert!(answer.unwrap().is_none());
    assert_eq!(ledger.used, records(&f.world) as u64 * 64);
    assert_eq!((visits.support_scans, visits.scans), (1, 0));
    let ball = rapier3d::parry::shape::Ball::new(0.25);
    let (answer, ledger, visits) = query(&f, 0, true, Some(&ball));
    assert_eq!(answer.unwrap(), original(&f, true, Some(&ball)));
    assert_eq!(ledger.used, 0);
    assert_eq!((visits.support_scans, visits.scans), (0, 0));
}

#[test]
fn compound_support_filters_and_adequate_overhead_preserve_original_results_and_both_prices() {
    for compound in [false, true] {
        for ceiling in [None, Some(1.2), Some(1.115)] {
            let f = fixture(true, ceiling, compound, false);
            let (answer, ledger, visits) = query(&f, u64::MAX, true, None);
            let actual = answer.unwrap();
            assert_eq!(actual, original(&f, true, None));
            assert_eq!(actual.is_some(), ceiling == Some(1.115));
            if let Some(handle) = actual {
                assert_eq!(
                    f.world.backend.colliders[handle].parent(),
                    f.floor.map(native_id)
                );
            }
            assert_eq!(ledger.used, records(&f.world) as u64 * 128);
            assert_eq!((visits.support_scans, visits.scans), (1, 1));
            let (filtered, ledger, visits) = query(&f, u64::MAX, false, None);
            assert_eq!(filtered.unwrap(), original(&f, false, None));
            assert!(filtered.unwrap().is_none());
            assert_eq!(ledger.used, records(&f.world) as u64 * 64);
            assert_eq!((visits.support_scans, visits.scans), (1, 0));
        }
    }
}

#[test]
fn exact_and_one_below_scan_admission_preserve_used_typed_error_and_world_bytes() {
    let f = fixture(true, Some(1.115), true, false);
    let before = f.world.capture_snapshot().unwrap();
    let scan = records(&f.world) as u64 * 64;
    let (exact, ledger, visits) = query(&f, scan * 2, true, None);
    assert!(exact.unwrap().is_some());
    assert_eq!(ledger.used, scan * 2);
    assert_eq!((visits.support_scans, visits.scans), (1, 1));
    let (short, ledger, visits) = query(&f, scan * 2 - 1, true, None);
    assert_eq!(short, Err(TrajectoryError::WorkLimit));
    assert_eq!(ledger.used, scan, "executed support work is never refunded");
    assert_eq!((visits.support_scans, visits.scans), (1, 0));
    let (short, ledger, visits) = query(&f, scan - 1, true, None);
    assert_eq!(short, Err(TrajectoryError::WorkLimit));
    assert_eq!(ledger.used, 0);
    assert_eq!((visits.support_scans, visits.scans), (0, 0));
    assert_eq!(
        f.world.capture_snapshot().unwrap().encoded_bytes(),
        before.encoded_bytes()
    );
}

#[test]
fn sparse_ground_probe_charges_visited_bvh_nodes_and_preserves_possible_support() {
    for floor in [false, true] {
        let mut f = fixture(floor, floor.then_some(1.115), false, false);
        let make_box = |half_extents| Shape::Box { half_extents };
        for i in 0..40 {
            create(
                &mut f.world,
                BodyKind::Fixed,
                [0., 10. + i as f32 * 10., 0.],
                make_box([0.25, 2., 5.]),
            );
        }
        if !floor {
            // The conservative BVH overlaps this side box. Its top face is
            // too high to be the actor's +Y support.
            create(
                &mut f.world,
                BodyKind::Fixed,
                [0.51, 0.51, 0.],
                make_box([0.25, 2., 5.]),
            );
        }
        f.world.refresh_queries();
        let before = f.world.capture_snapshot().unwrap();
        let scan_price = records(&f.world) as u64 * 64;
        let (answer, ledger, visits) = query(&f, u64::MAX, true, None);
        let answer = answer.unwrap();
        assert_eq!(answer, original(&f, true, None));
        if floor {
            assert!(answer.is_some());
            assert_eq!((visits.support_scans, visits.scans), (1, 1));
            assert!(ledger.used > 2 * scan_price && ledger.used <= 2 * scan_price + scan_price / 4);
            let (answer, ledger, _) = query(&f, 2 * scan_price, true, None);
            assert!(
                answer.unwrap().is_some(),
                "retain the exact-price original path"
            );
            assert_eq!(ledger.used, 2 * scan_price);
        } else {
            assert!(answer.is_none());
            assert_eq!((visits.support_scans, visits.scans), (0, 0));
            assert!(ledger.used > 0 && ledger.used < scan_price / 4);
        }
        assert_eq!(
            f.world.capture_snapshot().unwrap().encoded_bytes(),
            before.encoded_bytes()
        );
    }
}

fn enabled(f: &mut Fixture, value: bool) {
    for &id in &f.actors {
        f.world.backend.bodies[native_id(id)].set_enabled(value);
    }
    f.world.refresh_queries();
}
fn origin_bits(s: &BackendMotionScratch) -> Vec<(BodyId, [u32; 3], bool)> {
    s.origins
        .iter()
        .map(|o| {
            (
                o.body,
                o.start.to_array().map(f32::to_bits),
                o.tight_static_epsilon.is_some(),
            )
        })
        .collect()
}

#[test]
fn disabled_actors_and_complete_retained_census_do_not_reserve_or_repeat_scans() {
    let mut f = fixture(true, Some(1.115), false, true);
    enabled(&mut f, false);
    let mut s = BackendMotionScratch::default();
    let _ = clearance_work::take();
    f.world.prepare_backend_motion(&mut s, 0.1).unwrap();
    let visits = clearance_work::take();
    assert!(s.origins.is_empty());
    assert_eq!((visits.support_scans, visits.scans), (0, 0));
    enabled(&mut f, true);
    f.world.prepare_backend_motion(&mut s, 0.1).unwrap();
    let visits = clearance_work::take();
    assert_eq!((visits.support_scans, visits.scans), (2, 2));
    assert_eq!(s.origins.len(), 2);
    assert!(s.origins.iter().all(|o| o.tight_static_epsilon.is_some()));
    let old = origin_bits(&s);
    s.stops.push((f.actors[0], 0.));
    let old_stops = s.stops.clone();
    s.used = super::super::trajectory::MAX_PROOF_WORK - 1;
    assert_eq!(
        f.world.prepare_backend_motion(&mut s, 0.1),
        Err(TrajectoryError::WorkLimit)
    );
    let visits = clearance_work::take();
    assert_eq!((visits.support_scans, visits.scans), (0, 0));
    assert_eq!(
        origin_bits(&s),
        old,
        "retained complete origins are not invalidated"
    );
    assert_eq!(s.stops, old_stops);
}

#[test]
fn late_new_origin_admission_failure_discards_only_the_partial_census() {
    let mut f = fixture(true, Some(1.115), false, true);
    enabled(&mut f, false);
    let mut cold = BackendMotionScratch::default();
    f.world.prepare_backend_motion(&mut cold, 0.1).unwrap();
    let before_scans = cold.used; // unchanged output/storage/character admission
    enabled(&mut f, true);
    let before_world = f.world.capture_snapshot().unwrap();
    let scan = records(&f.world) as u64 * 64;
    let mut s = BackendMotionScratch::default();
    s.stops.push((f.actors[0], 0.));
    s.promoted.push(f.actors[0]);
    let pending = (s.stops.clone(), s.promoted.clone());
    let initial = super::super::trajectory::MAX_PROOF_WORK - (before_scans + scan * 3 - 1);
    s.used = initial;
    let _ = clearance_work::take();
    assert_eq!(
        f.world.prepare_backend_motion(&mut s, 0.1),
        Err(TrajectoryError::WorkLimit)
    );
    let visits = clearance_work::take();
    assert_eq!(
        (visits.support_scans, visits.scans),
        (1, 1),
        "first origin ran; second scan is not executed"
    );
    assert_eq!(s.used, initial + before_scans + scan * 2);
    assert!(
        s.origins.is_empty(),
        "nonempty partial census must never masquerade as complete"
    );
    assert_eq!((s.stops.clone(), s.promoted.clone()), pending);
    assert_eq!(
        f.world.capture_snapshot().unwrap().encoded_bytes(),
        before_world.encoded_bytes()
    );
    let mut recovered = BackendMotionScratch::default();
    f.world.prepare_backend_motion(&mut recovered, 0.1).unwrap();
    assert_eq!(recovered.origins.len(), 2);

    // Late input errors obey the same fresh-census atomicity, without masking
    // their typed cause or damaging an earlier completed census.
    let second = f.actors[1];
    let original_velocity = f.world.characters[&second].free_velocity;
    f.world.characters.get_mut(&second).unwrap().free_velocity[0] = f32::NAN;
    let mut invalid = BackendMotionScratch::default();
    assert_eq!(
        f.world.prepare_backend_motion(&mut invalid, 0.1),
        Err(TrajectoryError::NonFinite)
    );
    assert!(invalid.origins.is_empty());
    f.world.characters.get_mut(&second).unwrap().free_velocity = original_velocity;
    let runtime = f.world.characters.remove(&second).unwrap();
    let stale = BodyId {
        slot: second.slot,
        generation: second.generation + 1,
    };
    f.world.characters.insert(stale, runtime);
    assert_eq!(
        f.world.prepare_backend_motion(&mut invalid, 0.1),
        Err(TrajectoryError::InvalidReference)
    );
    assert!(invalid.origins.is_empty());
    let runtime = f.world.characters.remove(&stale).unwrap();
    f.world.characters.insert(second, runtime);
    assert_eq!(
        f.world.capture_snapshot().unwrap().encoded_bytes(),
        before_world.encoded_bytes()
    );
}
