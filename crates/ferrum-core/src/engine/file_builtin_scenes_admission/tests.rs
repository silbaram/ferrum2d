use super::*;
use crate::engine::persistence;
fn limits() -> Limits {
    Limits {
        max_work: 100_000_000,
        max_scratch_bytes: 32 * 1024 * 1024,
    }
}
fn check(e: &Engine) {
    let before = bytes(e);
    validate(e, limits()).unwrap();
    assert_eq!(bytes(e), before);
    let r = persistence::decode(&before).unwrap();
    validate(&r, limits()).unwrap();
    assert_eq!(bytes(&r), before);
}
fn bytes(engine: &Engine) -> Vec<u8> {
    persistence::encode(engine).unwrap()
}
fn fixture() -> Engine {
    let mut e = Engine::new();
    e.reset_game();
    e.set_input(false, false, false, true, true, false, false, 700., 120.);
    for _ in 0..4 {
        e.update(1. / 60.);
    }
    e.use_breakout_scene();
    e.reset_game();
    for _ in 0..4 {
        e.update(1. / 60.);
    }
    e.use_platformer_scene();
    e.reset_game();
    for _ in 0..4 {
        e.update(1. / 60.);
    }
    e
}
#[test]
fn file_builtin_normal_scene_switch_history_private_codec_and_guard_continue() {
    let mut e = fixture();
    check(&e);
    let before = bytes(&e);
    let mut r = persistence::decode(&before).unwrap();
    assert_eq!(bytes(&r), before);
    for dt in [0., 1. / 120., 1. / 60.] {
        e.update(dt);
        r.update(dt);
        check(&e);
        check(&r);
        assert_eq!(bytes(&e), bytes(&r));
    }
}
#[test]
fn file_builtin_valid_crc_private_malformed_scene_payloads_reject_without_mutation() {
    let e = fixture();
    let original = bytes(&e);
    for case in 0..30 {
        let mut candidate = persistence::decode(&original).unwrap();
        match case {
            0..=16 => candidate
                .scenes
                .shooter_mut()
                .corrupt_builtin_file_fixture(case),
            17..=21 => candidate
                .scenes
                .breakout_mut()
                .corrupt_builtin_file_fixture(case - 17),
            _ => candidate
                .scenes
                .platformer_mut()
                .corrupt_builtin_file_fixture(case - 22),
        }
        let malformed = bytes(&candidate);
        assert_ne!(malformed, original);
        let decoded = persistence::decode(&malformed).unwrap();
        assert!(validate(&decoded, limits()).is_err(), "case={case}");
        assert_eq!(bytes(&decoded), malformed);
        assert_eq!(bytes(&e), original);
        println!("BUILTIN_AFTER case={case} cold_guard_rejected=true bytes_preserved=true");
    }
}

#[test]
fn file_builtin_all_slots_default_reset_switch_pending_input_and_exact_common_quotas() {
    let mut e = Engine::new();
    check(&e);
    for mode in 0..4 {
        match mode {
            0 => e.reset_game(),
            1 => e.use_breakout_scene(),
            2 => e.use_platformer_scene(),
            _ => e.use_data_scene(),
        }
        check(&e);
        e.set_input(false, true, false, false, true, true, false, -0., 1.);
        check(&e);
        e.update(0.);
        check(&e);
    }
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
fn file_builtin_native_defaults_all_three_scenes_and_stale_inactive_slots_continue_exactly() {
    use crate::physics3d::{Space, WorldConfig};
    let mut e = Engine::new();
    e.configure_unified_physics_defaults(WorldConfig {
        space: Space::PlanarXy,
        ..Default::default()
    })
    .unwrap();
    for mode in 0..3 {
        if mode == 1 {
            e.use_breakout_scene();
        } else if mode == 2 {
            e.use_platformer_scene();
        }
        e.reset_game();
        check(&e);
        e.set_input(false, false, false, true, false, false, false, 500., 100.);
        for _ in 0..4 {
            e.update(1. / 60.);
            check(&e);
        }
        let mut restored = persistence::decode(&bytes(&e)).unwrap();
        for dt in [0., 1. / 120., 1. / 60.] {
            e.update_frame(dt, false, false, false);
            restored.update_frame(dt, false, false, false);
            check(&e);
            check(&restored);
            assert_eq!(bytes(&e), bytes(&restored));
        }
    }
    e.use_data_scene();
    check(&e);
}
#[test]
fn file_builtin_shooter_sparse_waves_extreme_fps_negative_delta_and_snapshot_raw_history_are_preserved(
) {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.reset_game();
    for index in [7, 2, 64] {
        e.set_shooter_wave(index, 2., 0.125, 2, 30., 0, 0, 1., 1);
        check(&e);
    }
    e.set_shooter_atlas_animation(
        0,
        7,
        36.,
        36.,
        f32::MAX,
        vec![0., 0., 0.5, 1., 0.5, 0., 1., 1.],
        f32::MIN_POSITIVE,
        vec![0., 0., 1., 1.],
    );
    check(&e);
    e.update(1. / 60.);
    check(&e);
    e.update(-0.01);
    check(&e);
    assert!(e.capture_shooter_snapshot());
    let hf = e.shooter_snapshot_header_floats.clone();
    let mut hu = e.shooter_snapshot_header_u32s.clone();
    // Existing packed ABI words5/6: raw wave count and previous space u8.
    hu[5] = u32::MAX;
    hu[6] = u8::MAX as u32;
    assert!(e.restore_shooter_snapshot(
        hf,
        hu,
        e.shooter_snapshot_entity_floats.clone(),
        e.shooter_snapshot_entity_u32s.clone()
    ));
    check(&e);
    let snapshot = e.scenes.shooter().snapshot(&e.world, &e.camera);
    assert_eq!(snapshot.header_u32s[5], u32::MAX);
    assert_eq!(snapshot.header_u32s[6], 1);
    let mut restored = persistence::decode(&bytes(&e)).unwrap();
    e.update(1. / 60.);
    restored.update(1. / 60.);
    check(&e);
    check(&restored);
    assert_eq!(bytes(&e), bytes(&restored));
}

#[test]
fn file_builtin_test_only_direct_scene_update_preserves_full_u8_input_history() {
    use crate::input::InputState;
    let mut e = Engine::new();
    e.reset_game();
    let raw = InputState {
        w: 255,
        a: 254,
        s: 253,
        d: 252,
        space: 255,
        enter: 254,
        mouse_left: 253,
        mouse_x: -0.,
        mouse_y: 7.,
    };
    e.scenes.shooter_mut().update(
        &mut e.world,
        &mut e.camera,
        raw,
        &mut e.frame_buffers.audio_events,
        &e.tilemap,
        0.,
    );
    check(&e);
    let snap = e.scenes.shooter().snapshot(&e.world, &e.camera);
    assert_eq!(snap.header_u32s[6], 255);
    assert_eq!(snap.header_u32s[7], 254);
    assert_eq!(snap.header_u32s[8], 253);
}
fn native_leaf_fixture(platformer: bool) -> Engine {
    use crate::physics3d::{Space, WorldConfig};
    let mut e = Engine::new();
    if platformer {
        e.use_platformer_scene();
    } else {
        e.use_breakout_scene();
    }
    e.reset_game();
    e.configure_unified_physics_defaults(WorldConfig {
        space: Space::PlanarXy,
        ..Default::default()
    })
    .unwrap();
    e.set_auto_rigid_body_step_enabled(false);
    e
}
#[test]
fn file_builtin_native_leaf_valid_crc_malformed_profile_rejects_without_consumption() {
    for case in 0..6 {
        let e = native_leaf_fixture(case >= 2);
        check(&e);
        let original = bytes(&e);
        let mut bad = persistence::decode(&original).unwrap();
        bad.unified_physics
            .as_mut()
            .unwrap()
            .corrupt_builtin_leaf_fixture(case);
        let malformed = bytes(&bad);
        assert_ne!(malformed, original);
        let decoded = persistence::decode(&malformed).unwrap();
        assert!(validate(&decoded, limits()).is_err(), "leafcase={case}");
        assert_eq!(bytes(&decoded), malformed);
        assert_eq!(bytes(&e), original);
        println!("BUILTIN_LEAF_AFTER case={case} cold_guard_rejected=true source_preserved=true");
    }
}

#[test]
fn file_builtin_platformer_manual_jump_release_and_test_only_raw_axis_history_are_preserved() {
    let mut e = native_leaf_fixture(true);
    e.set_input(false, false, false, true, true, false, false, 0., 0.);
    e.update(1. / 60.);
    assert!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .builtin_leaf_input_fixture()
            .1
    );
    check(&e);
    e.set_input(false, false, false, false, false, false, false, 0., 0.);
    e.update(1. / 60.);
    assert!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .builtin_leaf_input_fixture()
            .1
    );
    check(&e);
    // Direct core producer is test-only; release Engine setter emits 0/1.
    // The owner-local writer itself receives all InputState u8 values.
    e.update_native_platformer(
        1. / 60.,
        crate::input::InputState {
            d: 255,
            ..Default::default()
        },
    );
    assert_eq!(
        e.unified_physics
            .as_ref()
            .unwrap()
            .builtin_leaf_input_fixture(),
        (255., true)
    );
    check(&e);
    let original = bytes(&e);
    let r = persistence::decode(&original).unwrap();
    check(&r);
    assert_eq!(bytes(&r), original);
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
}

#[test]
fn file_builtin_native_profile_old_generation_after_public_body_removal_is_readonly() {
    for platformer in [false, true] {
        let mut e = native_leaf_fixture(platformer);
        e.update(1. / 60.);
        check(&e);
        let entity = if platformer {
            e.scenes.platformer().player_entity().unwrap()
        } else {
            e.scenes.breakout().ball_entity().unwrap()
        };
        e.remove_unified_body(entity).unwrap();
        assert!(!e.world.is_current_entity(entity));
        check(&e);
        let mut restored = persistence::decode(&bytes(&e)).unwrap();
        for dt in [0., 1. / 60.] {
            e.update(dt);
            restored.update(dt);
            check(&e);
            check(&restored);
            assert_eq!(bytes(&e), bytes(&restored));
        }
    }
}

#[test]
fn file_builtin_test_only_core_capture_finite_signed_action_payload_pending_codec_and_continuation()
{
    let mut e = Engine::new();
    e.reset_game();
    let source = e.world.primary_actor_entity().unwrap();
    e.scenes
        .shooter_mut()
        .seed_builtin_captured_finite_action_fixture(&e.world, source);
    check(&e);
    let mut restored = persistence::decode(&bytes(&e)).unwrap();
    e.update(0.);
    restored.update(0.);
    check(&e);
    check(&restored);
    assert_eq!(bytes(&e), bytes(&restored));
}
