use super::*;

fn fixture(native: bool) -> Engine {
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
    if native {
        e.configure_unified_physics_defaults(WorldConfig {
            space: Space::PlanarXy,
            ..WorldConfig::default()
        })
        .unwrap();
        e.set_auto_rigid_body_step_enabled(false);
    }
    e
}

#[test]
fn file_candidate_builtin_active_inactive_slots_native_leaf_and_six_tick_bytes() {
    for native in [false, true] {
        let mut source = fixture(native);
        let original = persistence::encode(&source).unwrap();
        let file = wire(&source);
        let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
        assert_eq!(persistence::encode(&candidate.engine).unwrap(), original);
        for _ in 0..6 {
            source.update(1. / 60.);
            candidate.engine.update(1. / 60.);
            assert_eq!(
                persistence::encode(&candidate.engine).unwrap(),
                persistence::encode(&source).unwrap()
            );
            prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
        }
    }
}

#[test]
fn file_candidate_builtin_valid_crc_thirty_scene_and_six_native_leaf_failures_are_isolated() {
    let source = fixture(false);
    let original = persistence::encode(&source).unwrap();
    for case in 0..30 {
        let mut damaged = persistence::decode(&original).unwrap();
        match case {
            0..=16 => damaged
                .scenes
                .shooter_mut()
                .corrupt_builtin_file_fixture(case),
            17..=21 => damaged
                .scenes
                .breakout_mut()
                .corrupt_builtin_file_fixture(case - 17),
            _ => damaged
                .scenes
                .platformer_mut()
                .corrupt_builtin_file_fixture(case - 22),
        }
        let file = wire(&damaged);
        let before = file.clone();
        framing::read(&file, &profile(SDK_BUILD), &Limits::default().framing).unwrap();
        let rejected = prepare(&file, SDK_BUILD, &Limits::default());
        if case == 28 {
            // The earlier root pass already checks the cached Platformer player.
            assert!(matches!(
                rejected,
                Err(Error::Root(root_settings::Error::EntityHistory(
                    root_settings::Reference::PlatformerPlayer
                )))
            ));
        } else {
            assert!(
                matches!(rejected, Err(Error::Builtin(_))),
                "scene case{case}: {rejected:?}"
            );
        }
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&source).unwrap(), original);
    }
    for case in 0..6 {
        let mut e = Engine::new();
        if case < 2 {
            e.use_breakout_scene();
        } else {
            e.use_platformer_scene();
        }
        e.reset_game();
        e.configure_unified_physics_defaults(WorldConfig {
            space: Space::PlanarXy,
            ..Default::default()
        })
        .unwrap();
        e.set_auto_rigid_body_step_enabled(false);
        let original = persistence::encode(&e).unwrap();
        let mut damaged = persistence::decode(&original).unwrap();
        damaged
            .unified_physics
            .as_mut()
            .unwrap()
            .corrupt_builtin_leaf_fixture(case);
        let file = wire(&damaged);
        let before = file.clone();
        framing::read(&file, &profile(SDK_BUILD), &Limits::default().framing).unwrap();
        assert!(
            matches!(
                prepare(&file, SDK_BUILD, &Limits::default()),
                Err(Error::Builtin(_))
            ),
            "leaf case{case}"
        );
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&e).unwrap(), original);
    }
}

#[test]
fn file_candidate_builtin_uses_common_exact_and_one_below_allowances() {
    let source = fixture(true);
    let file = wire(&source);
    let usage = prepare(&file, SDK_BUILD, &Limits::default())
        .unwrap()
        .usage();
    let exact = Limits {
        max_post_decode_work: usage.post_decode_work,
        max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes,
        ..Limits::default()
    };
    assert_eq!(prepare(&file, SDK_BUILD, &exact).unwrap().usage(), usage);
    assert!(matches!(
        prepare(
            &file,
            SDK_BUILD,
            &Limits {
                max_post_decode_work: usage.post_decode_work - 1,
                ..exact.clone()
            }
        ),
        Err(Error::NativeResources(native_resources::Error::WorkLimit))
    ));
    assert!(matches!(
        prepare(
            &file,
            SDK_BUILD,
            &Limits {
                max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes - 1,
                ..exact
            }
        ),
        Err(Error::NativeResources(
            native_resources::Error::ScratchLimit
        ))
    ));
}
