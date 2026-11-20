use super::*;
use crate::engine::persistence;
use crate::entity::Entity;

pub(in crate::engine) fn fixture() -> (Engine, Entity) {
    let (mut e, actor, _) = crate::engine::file_data_movement_admission::tests::fixture(false);
    let (id, generation) = (actor.id, actor.generation);
    assert!(e.set_gameplay_health(id, generation, 100.0));
    assert!(e.set_gameplay_damage(id, generation, 2.0));
    assert!(e.set_gameplay_lifetime(id, generation, 30.0));
    assert!(e.set_gameplay_score_reward(id, generation, u32::MAX));
    assert!(e.set_gameplay_faction(id, generation, 31, u32::MAX));
    assert!(e.set_gameplay_tags(id, generation, 0x8000_0001));
    assert!(e.set_gameplay_pickup(id, generation, 1, u32::MAX, true));
    assert!(e.set_gameplay_interaction(id, generation, 7, 2.0, false));
    assert!(e.set_gameplay_timer_trigger(id, generation, 7, 100.0));
    assert!(e.set_gameplay_movement_to_point(id, generation, 90.0, 50.0, 3.0));
    assert!(e.configure_gameplay_variable(1, 0, 0, 0.0, 0.0));
    for i in 1..=16 {
        assert!(e.set_gameplay_action_projectile(id, generation, i, 0.25, 3.0, 1.0, 2.0));
        assert!(e.add_gameplay_collision_sound_with_cooldown(id, generation, i, 0.5, 1.0, 0.25));
        assert!(e.add_gameplay_variable_mutation_trigger(
            id,
            generation,
            crate::gameplay_event::GAMEPLAY_EVENT_TIMER,
            i,
            1,
            0,
            1.0
        ));
    }
    assert!(e.capture_gameplay_authoring_snapshot(id, generation));
    (e, actor)
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn limits() -> Limits {
    Limits {
        max_work: 10_000_000,
    }
}
fn check(e: &Engine) -> Usage {
    let original = bytes(e);
    let usage = validate(e, limits()).unwrap();
    assert_eq!(bytes(e), original);
    let restored = persistence::decode(&original).unwrap();
    assert_eq!(validate(&restored, limits()), Ok(usage));
    assert_eq!(bytes(&restored), original);
    usage
}

#[test]
fn file_authoring_snapshot_public_capture_codec_restore_and_six_tick_continuation() {
    let (mut e, actor) = fixture();
    check(&e);
    assert!(e.set_gameplay_health(actor.id, actor.generation, 1.0));
    let mut r = persistence::decode(&bytes(&e)).unwrap();
    assert!(e.restore_gameplay_authoring_snapshot(actor.id, actor.generation));
    assert!(r.restore_gameplay_authoring_snapshot(actor.id, actor.generation));
    assert_eq!(e.world.health(actor), Some(100.0));
    assert_eq!(bytes(&e), bytes(&r));
    for _ in 0..6 {
        e.update(0.01);
        r.update(0.01);
        check(&e);
        assert_eq!(bytes(&e), bytes(&r));
    }
}

#[test]
fn file_authoring_snapshot_stale_generation_is_preserved_and_public_restore_refuses() {
    let (mut e, actor) = fixture();
    e.world.despawn(actor);
    assert!(!e.world.is_current_entity(actor));
    let replacement = e.world.spawn_entity();
    assert_eq!(replacement.id, actor.id);
    assert_ne!(replacement.generation, actor.generation);
    check(&e);
    let original = bytes(&e);
    assert!(!e.restore_gameplay_authoring_snapshot(actor.id, actor.generation));
    assert!(!e.restore_gameplay_authoring_snapshot(replacement.id, replacement.generation));
    assert_eq!(bytes(&e), original);
}

#[test]
fn file_authoring_snapshot_actual_valid_crc_sixteen_hidden_payload_damage_cases_reject() {
    let (e, _) = fixture();
    let original = bytes(&e);
    for case in 0..16 {
        let mut d = persistence::decode(&original).unwrap();
        d.gameplay_authoring_snapshot
            .as_mut()
            .unwrap()
            .corrupt_file_authoring_snapshot_fixture(case);
        let malformed = bytes(&d);
        let r = persistence::decode(&malformed).unwrap();
        assert!(
            matches!(validate(&r, limits()), Err(Error::Invalid { .. })),
            "case {case}"
        );
        assert_eq!(bytes(&r), malformed);
        assert_eq!(bytes(&e), original);
    }
}

#[test]
fn file_authoring_snapshot_raw_finite_signed_and_unresolved_tokens_match_world_policy() {
    let (mut e, _) = fixture();
    e.gameplay_authoring_snapshot
        .as_mut()
        .unwrap()
        .raw_file_authoring_snapshot_fixture();
    check(&e);
}

#[test]
fn file_authoring_snapshot_exact_one_below_and_empty_work_limits_are_readonly() {
    let empty = Engine::new();
    assert_eq!(
        validate(&empty, Limits { max_work: 1 }),
        Ok(Usage { work: 1 })
    );
    assert_eq!(
        validate(&empty, Limits { max_work: 0 }),
        Err(Error::WorkLimit)
    );
    let (e, _) = fixture();
    let before = bytes(&e);
    let used = check(&e);
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: used.work
            }
        ),
        Ok(used)
    );
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: used.work - 1
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(bytes(&e), before);
}
