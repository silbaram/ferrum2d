use super::*;
use crate::components::{HeightSpan, PhysicsFloorId, Transform2D};
use crate::engine::persistence;
use crate::tilemap::TilemapNavigationScratch;
fn limits() -> Limits {
    Limits {
        max_work: 10_000_000,
        max_scratch_bytes: 10_000_000,
    }
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn check(e: &Engine) {
    assert!(e.capture_runtime_checkpoint().is_some());
    let b = bytes(e);
    validate(e, limits()).unwrap();
    assert_eq!(bytes(e), b);
    let decoded = persistence::decode(&b).unwrap();
    validate(&decoded, limits()).unwrap();
    assert_eq!(bytes(&decoded), b);
}
fn fixture() -> Engine {
    let mut e = Engine::new();
    e.set_shooter_tile(1, u32::MAX, 0.0, 0.0, 1.0, 1.0, 1.0, 0.5, 0.25, 1.0);
    e.set_shooter_tile_slope(4, 1.0, 1.0, 0.0, 0.0);
    e.set_shooter_tile_one_way_platform(5);
    e.set_shooter_tilemap_layer(
        0,
        3,
        3,
        10.0,
        10.0,
        -0.0,
        0.0,
        true,
        vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
    );
    assert!(e.query_tilemap_navigation_path(5.0, 5.0, 25.0, 5.0));
    e
}
#[test]
fn file_tilemap_public_engine_capture_actual_memory_codec_ticks_and_queries_continue() {
    let mut e = fixture();
    check(&e);
    let mut r = persistence::decode(&bytes(&e)).unwrap();
    for dt in [0.0, 0.004, 0.01, 0.025, 0.0, 0.19] {
        e.update_frame(dt, false, false, false);
        r.update_frame(dt, false, false, false);
        assert_eq!(
            e.query_tilemap_navigation_path(5.0, 5.0, 25.0, 5.0),
            r.query_tilemap_navigation_path(5.0, 5.0, 25.0, 5.0)
        );
        check(&e);
        check(&r);
        assert_eq!(bytes(&e), bytes(&r));
    }
}
#[test]
fn file_tilemap_stale_outputs_after_clear_and_failed_hd_request_are_not_rebound() {
    let mut e = fixture();
    let before = crate::checkpoint_codec::encode(&e.tilemap_navigation_scratch).unwrap();
    e.tilemap
        .set_layer(0, 65, 65, 10.0, 10.0, 0.0, 0.0, true, vec![0; 65 * 65]);
    assert!(e
        .tilemap
        .navigation_path_between_height_spans_scratch(
            Transform2D { x: 5.0, y: 5.0 },
            Transform2D { x: 15.0, y: 5.0 },
            HeightSpan::new(PhysicsFloorId(7), 0.0, 1.0).unwrap(),
            HeightSpan::new(PhysicsFloorId(8), 0.0, 1.0).unwrap(),
            &mut e.tilemap_navigation_scratch
        )
        .is_none());
    assert_ne!(
        crate::checkpoint_codec::encode(&e.tilemap_navigation_scratch).unwrap(),
        before
    );
    check(&e);
    e.clear_shooter_tilemap();
    check(&e);
}
#[test]
fn file_tilemap_valid_crc_bad_owner_candidates_reject_and_preserve_original_bytes() {
    let live = fixture();
    let original = bytes(&live);
    for case in 0..6 {
        let mut c = persistence::decode(&original).unwrap();
        if case == 4 {
            c.tilemap_navigation_scratch.corrupt_file_fixture();
        } else if case == 5 {
            c.tilemap_navigation_scratch.corrupt_file_cached_point();
        } else {
            c.tilemap.corrupt_file_fixture(case);
        }
        let malformed = bytes(&c);
        let d = persistence::decode(&malformed).unwrap();
        assert!(matches!(validate(&d, limits()), Err(Error::Invalid { .. })));
        assert_eq!(bytes(&d), malformed);
        assert_eq!(bytes(&live), original);
    }
}
#[test]
fn file_tilemap_engine_exact_and_one_below_budgets_are_readonly() {
    let e = fixture();
    let before = bytes(&e);
    let used = validate(&e, limits()).unwrap();
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: used.work,
                max_scratch_bytes: used.scratch_bytes
            }
        ),
        Ok(used)
    );
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: used.work - 1,
                max_scratch_bytes: used.scratch_bytes
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: used.work,
                max_scratch_bytes: used.scratch_bytes - 1
            }
        ),
        Err(Error::ScratchLimit)
    );
    assert_eq!(bytes(&e), before);
}
#[test]
fn file_tilemap_heap_wire_rejects_before_heapify_with_valid_engine_crc() {
    let mut e = fixture();
    e.tilemap_navigation_scratch = TilemapNavigationScratch::pending_file_fixture();
    let before = bytes(&e);
    let malformed = e.tilemap_navigation_scratch.malformed_heap_packet(&before);
    assert_ne!(before, malformed);
    assert!(matches!(
        persistence::decode(&malformed),
        Err(crate::engine::RuntimeCheckpointError::InvalidState)
    ));
    let good = persistence::decode(&before).unwrap();
    validate(&good, limits()).unwrap();
    assert_eq!(bytes(&good), before);
    assert_eq!(bytes(&e), before);
}

#[test]
fn file_tilemap_unrepresentable_center_returns_false_without_publishing_and_reuses_scratch() {
    type Query = fn(&mut Engine) -> bool;
    let queries: [Query; 5] = [
        |e| e.query_tilemap_navigation_path(0.0, 0.0, 3.0e38, 0.0),
        |e| e.query_tilemap_navigation_path_with_height_span(0.0, 0.0, 3.0e38, 0.0, 0, 0.0, 1.0),
        |e| {
            e.query_tilemap_navigation_path_between_height_spans(
                0.0, 0.0, 3.0e38, 0.0, 0, 0.0, 1.0, 0, 0.0, 1.0,
            )
        },
        |e| e.query_tilemap_navigation_waypoint(0.0, 0.0, 3.0e38, 0.0),
        |e| {
            e.query_tilemap_navigation_waypoint_with_height_span(0.0, 0.0, 3.0e38, 0.0, 0, 0.0, 1.0)
        },
    ];
    for (index, query) in queries.into_iter().enumerate() {
        let mut e = fixture();
        e.set_shooter_tilemap_layer(0, 2, 1, 3.0e38, 1.0, 0.0, 0.0, true, vec![0, 0]);
        assert!(!query(&mut e));
        if index < 3 {
            assert!(e.frame_buffers.tilemap_navigation_path_points.is_empty());
            assert!(e.frame_buffers.tilemap_navigation_debug_lines.is_empty());
        }
        assert!(e
            .frame_buffers
            .tilemap_navigation_path_points
            .iter()
            .all(|v| v.is_finite()));
        assert!(e
            .frame_buffers
            .tilemap_navigation_debug_lines
            .iter()
            .all(|v| [v.x0, v.y0, v.x1, v.y1, v.r, v.g, v.b, v.a]
                .iter()
                .all(|x| x.is_finite())));
        assert_eq!(e.physics_query_result.point_x, 0.0);
        assert_eq!(e.physics_query_result.point_y, 0.0);
        assert_eq!(e.physics_query_result.distance, 0.0);
        check(&e);
        let mut restored = persistence::decode(&bytes(&e)).unwrap();
        assert!(!query(&mut restored));
        assert_eq!(bytes(&restored), bytes(&e));
        for candidate in [&mut e, &mut restored] {
            candidate.set_shooter_tilemap_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, true, vec![0, 0]);
            assert!(candidate.query_tilemap_navigation_path(0.0, 0.0, 10.0, 0.0));
            check(candidate);
        }
        for dt in [0.0, 0.01, 0.025] {
            e.update_frame(dt, false, false, false);
            restored.update_frame(dt, false, false, false);
            assert_eq!(bytes(&e), bytes(&restored));
            check(&e);
        }
    }
}
