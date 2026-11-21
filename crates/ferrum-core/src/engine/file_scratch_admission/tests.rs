use super::*;
use crate::collision::file_scratch_admission::{test_support as t, Error};
use crate::collision::{CollisionScratch, CollisionSystem};
use crate::engine::persistence;
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn source() -> Engine {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.world = t::fixture().0;
    for _ in 0..2 {
        e.step_rigid_bodies_with_config(
            0.01, 0.0, 10.0, 6, 3, 0.8, 0.01, 1.0, 0.2, 120.0, true, true,
        );
    }
    assert!(e.rigid_body_step_scratch.file_test_populated_counts()[0] > 0);
    CollisionSystem::build_pairs_into(
        &mut e.physics_debug_collision_scratch,
        &e.world,
        &mut Vec::new(),
    );
    CollisionSystem::build_pairs_into(
        &mut e.physics_collision_query_scratch,
        &e.world,
        &mut Vec::new(),
    );
    e
}
fn check(e: &Engine) {
    assert!(e.capture_runtime_checkpoint().is_some());
    let before = bytes(e);
    validate(e, t::limits()).unwrap();
    assert_eq!(bytes(e), before);
    let r = persistence::decode(&before).unwrap();
    validate(&r, t::limits()).unwrap();
    assert_eq!(bytes(&r), before);
}
#[test]
fn file_scratch_default_actual_engine_codec_is_readonly() {
    let e = Engine::new();
    check(&e);
    let empty = CollisionScratch::default();
    empty.validate_file(&e.world, t::limits()).unwrap();
}
#[test]
fn file_scratch_public_engine_actual_codec_and_six_tick_continuation() {
    let mut e = source();
    check(&e);
    let mut r = persistence::decode(&bytes(&e)).unwrap();
    for dt in [0.0, 0.001, 0.01, 0.025, 0.01, 0.0] {
        e.step_rigid_bodies(dt);
        r.step_rigid_bodies(dt);
        e.update_frame(f64::from(dt), false, false, false);
        r.update_frame(f64::from(dt), false, false, false);
        check(&e);
        check(&r);
        assert_eq!(bytes(&e), bytes(&r));
    }
}
#[test]
fn file_scratch_valid_engine_crc_cannot_hide_bad_collision_or_solver_payload() {
    let e = source();
    let original = bytes(&e);
    for case in 0..3 {
        let mut c = persistence::decode(&original).unwrap();
        match case {
            0 => c.physics_debug_collision_scratch.file_corrupt_fixture(),
            1 => c.physics_collision_query_scratch.file_corrupt_fixture(),
            _ => c.rigid_body_step_scratch.file_corrupt_fixture(),
        };
        let malformed = bytes(&c);
        let d = persistence::decode(&malformed).unwrap();
        assert!(matches!(
            validate(&d, t::limits()),
            Err(Error::Invalid { .. })
        ));
        assert_eq!(bytes(&d), malformed);
        assert_eq!(bytes(&e), original);
    }
}
#[test]
fn file_scratch_engine_exact_and_one_below_budgets_preserve_source() {
    let e = source();
    let before = bytes(&e);
    t::check_budgets(|limits| validate(&e, limits));
    assert_eq!(bytes(&e), before);
}
