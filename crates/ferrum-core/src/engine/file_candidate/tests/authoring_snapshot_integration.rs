use super::*;
use crate::engine::file_gameplay_authoring_admission as authoring;

#[test]
fn file_candidate_authoring_snapshot_valid_crc_hidden_nan_is_rejected() {
    let (source, actor) = authoring::tests::fixture();
    let original = persistence::encode(&source).unwrap();
    let mut damaged = persistence::decode(&original).unwrap();
    damaged
        .gameplay_authoring_snapshot
        .as_mut()
        .unwrap()
        .corrupt_file_authoring_snapshot_fixture(0);
    let file = wire(&damaged);
    let before = file.clone();
    framing::read(&file, &profile(SDK_BUILD), &Limits::default().framing).unwrap();
    assert!(matches!(
        prepare(&file, SDK_BUILD, &Limits::default()),
        Err(Error::GameplayAuthoring(authoring::Error::Invalid {
            field: "health",
            ..
        }))
    ));
    assert_eq!(damaged.world.health(actor), source.world.health(actor));
    assert_eq!(file, before);
    assert_eq!(persistence::encode(&source).unwrap(), original);
}

#[test]
fn file_candidate_authoring_snapshot_all_sixteen_damaged_fields_are_guard_only() {
    let (source, _) = authoring::tests::fixture();
    let original = persistence::encode(&source).unwrap();
    for case in 0..16 {
        let mut damaged = persistence::decode(&original).unwrap();
        damaged
            .gameplay_authoring_snapshot
            .as_mut()
            .unwrap()
            .corrupt_file_authoring_snapshot_fixture(case);
        let file = wire(&damaged);
        let before = file.clone();
        assert!(
            matches!(
                prepare(&file, SDK_BUILD, &Limits::default()),
                Err(Error::GameplayAuthoring(_))
            ),
            "case {case}"
        );
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&source).unwrap(), original);
    }
    prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
}

#[test]
fn file_candidate_authoring_snapshot_shared_quota_and_trusted_six_tick_continuation() {
    let (mut source, actor) = authoring::tests::fixture();
    let original = persistence::encode(&source).unwrap();
    let file = wire(&source);
    let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    let usage = candidate.usage();
    let exact = Limits {
        max_post_decode_work: usage.post_decode_work,
        max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes,
        ..Limits::default()
    };
    assert_eq!(prepare(&file, SDK_BUILD, &exact).unwrap().usage(), usage);
    assert!(prepare(
        &file,
        SDK_BUILD,
        &Limits {
            max_post_decode_work: usage.post_decode_work - 1,
            ..exact
        }
    )
    .is_err());
    assert_eq!(persistence::encode(&source).unwrap(), original);
    assert!(source.restore_gameplay_authoring_snapshot(actor.id, actor.generation));
    assert!(candidate
        .engine
        .restore_gameplay_authoring_snapshot(actor.id, actor.generation));
    for _ in 0..6 {
        source.update(0.01);
        candidate.engine.update(0.01);
        assert_eq!(
            persistence::encode(&source).unwrap(),
            persistence::encode(&candidate.engine).unwrap()
        );
    }
}
