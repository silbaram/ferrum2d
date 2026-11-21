use super::*;

#[test]
fn file_candidate_runtime_payload_full_planar_history_and_spatial_bytes_replay_six_ticks() {
    for mut source in [
        Engine::runtime_payload_fixture_for_file_candidate(),
        source(Space::Spatial),
    ] {
        let memory = persistence::encode(&source).unwrap();
        let file = wire(&source);
        let original = file.clone();
        let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
        assert_eq!(persistence::encode(&candidate.engine).unwrap(), memory);
        assert_eq!(persistence::encode(&source).unwrap(), memory);
        for _ in 0..6 {
            source.update(0.013);
            candidate.engine.update(0.013);
            assert_eq!(
                persistence::encode(&candidate.engine).unwrap(),
                persistence::encode(&source).unwrap()
            );
            prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
        }
        assert_eq!(file, original);
    }
}

#[test]
fn file_candidate_runtime_payload_uses_common_exact_and_one_below_allowances() {
    let source = Engine::runtime_payload_fixture_for_file_candidate();
    let file = wire(&source);
    let memory = persistence::encode(&source).unwrap();
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
    assert_eq!(persistence::encode(&source).unwrap(), memory);
}
