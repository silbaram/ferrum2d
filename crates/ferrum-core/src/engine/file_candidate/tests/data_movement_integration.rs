use super::*;
use crate::engine::file_data_movement_admission::{self as movement, Owner};

#[test]
fn file_candidate_data_movement_real_grid_route_animation_and_shared_quota() {
    let (mut source, _, _) = movement::tests::fixture(false);
    source.update(0.1);
    let original = persistence::encode(&source).unwrap();
    let file = wire(&source);
    let before = file.clone();
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
            ..exact.clone()
        }
    )
    .is_err());
    assert!(prepare(
        &file,
        SDK_BUILD,
        &Limits {
            max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes - 1,
            ..exact
        }
    )
    .is_err());
    assert_eq!(persistence::encode(&source).unwrap(), original);
    for _ in 0..6 {
        source.update(0.01);
        candidate.engine.update(0.01);
        assert_eq!(
            persistence::encode(&source).unwrap(),
            persistence::encode(&candidate.engine).unwrap()
        );
    }
    assert_eq!(file, before);
}

#[test]
fn file_candidate_data_movement_valid_crcs_do_not_hide_late_owner_damage() {
    let (source, _, _) = movement::tests::fixture(false);
    let original = persistence::encode(&source).unwrap();
    for owner in [Owner::Movement, Owner::Animation, Owner::Obstacles] {
        let mut damaged = persistence::decode(&original).unwrap();
        match owner {
            Owner::Movement => damaged.data_scene.movement.corrupt_file_movement_fixture(0),
            Owner::Animation => damaged
                .data_scene
                .movement_animation
                .corrupt_file_animation_fixture(0),
            Owner::Obstacles => damaged
                .data_scene
                .navigation_obstacles
                .corrupt_file_obstacles_fixture(3),
            Owner::Grid => unreachable!(),
        }
        let file = wire(&damaged); // Actual Engine and outer CRCs computed normally.
        let before = file.clone();
        assert!(matches!(prepare(&file, SDK_BUILD, &Limits::default()),
            Err(Error::DataMovement(movement::Error::Invalid { owner: actual, .. })) if actual == owner));
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&source).unwrap(), original);
    }
    prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
}

#[test]
fn file_candidate_data_movement_rejects_nested_sweep_under_the_same_budget() {
    let (source, _, _) = movement::tests::fixture(false);
    let original = persistence::encode(&source).unwrap();
    let mut damaged = persistence::decode(&original).unwrap();
    damaged.data_scene.movement.corrupt_file_movement_fixture(5);
    let file = wire(&damaged);
    let before = file.clone();
    assert!(matches!(
        prepare(&file, SDK_BUILD, &Limits::default()),
        Err(Error::DataMovement(movement::Error::Sweep(_)))
    ));
    assert_eq!(file, before);
    assert_eq!(persistence::encode(&source).unwrap(), original);
}
