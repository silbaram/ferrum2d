use super::*;
use crate::collision::{file_scratch_admission::test_support, CollisionSystem};

#[test]
fn file_candidate_actual_collision_and_rigid_scratch_damage_rejects_without_publication() {
    let mut source = crate::engine::legacy_test_fixture::engine();
    source.world = test_support::fixture().0;
    for _ in 0..2 {
        source.step_rigid_bodies_with_config(
            0.01, 0.0, 10.0, 6, 3, 0.8, 0.01, 1.0, 0.2, 120.0, true, true,
        );
    }
    CollisionSystem::build_pairs_into(
        &mut source.physics_debug_collision_scratch,
        &source.world,
        &mut Vec::new(),
    );
    CollisionSystem::build_pairs_into(
        &mut source.physics_collision_query_scratch,
        &source.world,
        &mut Vec::new(),
    );
    let original = persistence::encode(&source).unwrap();
    let valid = wire(&source);
    prepare(&valid, SDK_BUILD, &Limits::default()).unwrap();
    for case in 0..3 {
        let mut candidate = persistence::decode(&original).unwrap();
        match case {
            0 => candidate
                .physics_debug_collision_scratch
                .file_corrupt_fixture(),
            1 => candidate
                .physics_collision_query_scratch
                .file_corrupt_fixture(),
            _ => candidate.rigid_body_step_scratch.file_corrupt_fixture(),
        }
        let file = wire(&candidate);
        let before = file.clone();
        assert!(
            matches!(
                prepare(&file, SDK_BUILD, &Limits::default()),
                Err(Error::Scratch(_))
            ),
            "case {case}"
        );
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&source).unwrap(), original);
    }
    prepare(&valid, SDK_BUILD, &Limits::default()).unwrap();
}
