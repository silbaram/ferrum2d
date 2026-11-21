use super::*;
use crate::engine::{file_candidate, file_envelope, file_physics_output_admission, persistence};

fn query(e: &mut Engine) {
    e.query_unified_physics(
        &[0, 35, u32::MAX, u32::MAX, 0, 0, 0, 0, 0, 8, 0, 0],
        &[0., 0., 0., 0., 0., 0., 1., 1., 0., 0., 5., 0., 0.],
        &[],
        &[],
    )
    .unwrap();
    assert_eq!(e.unified_physics_query_hit_count(), 1);
    assert_eq!(e.unified_physics_query_hit_stride_words(), 19);
    let hit = &e.unified_physics_queries.hits[0];
    assert_eq!(hit.value, 0.);
    assert_eq!(hit.point, [0.; 3]);
    assert!(hit.normal.iter().all(|v| v.is_finite()));
    assert_eq!(hit.normal, [0.; 3]);
}

fn admitted(e: &Engine) {
    let memory = persistence::encode(e).unwrap();
    let restored = persistence::decode(&memory).unwrap();
    assert_eq!(persistence::encode(&restored).unwrap(), memory);
    file_physics_output_admission::validate(
        e,
        file_physics_output_admission::Limits {
            max_work: 50_000_000,
            max_scratch_bytes: 50_000_000,
        },
    )
    .unwrap();
    let l = file_candidate::Limits::default();
    let section = file_candidate::capture_engine_section(e, &l).unwrap();
    let sdk = 0x7bb2_4829_2744_0286;
    let file = file_envelope::encode(
        &file_candidate::profile(sdk),
        &file_envelope::Sections {
            engine: &section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &l.framing,
    )
    .unwrap();
    file_candidate::prepare(&file, sdk, &l).unwrap();
    assert_eq!(persistence::encode(e).unwrap(), memory);
}

#[test]
fn native_ray_sphere_center_packed_finite_result_can_save_and_replay_six_ticks() {
    for space in [Space::Spatial, Space::PlanarXy] {
        let mut e = engine(space);
        ball(&mut e, [0.; 3]);
        query(&mut e);
        admitted(&e);
        let mut restored = persistence::decode(&persistence::encode(&e).unwrap()).unwrap();
        for _ in 0..6 {
            e.update(0.01);
            restored.update(0.01);
            assert_eq!(
                persistence::encode(&e).unwrap(),
                persistence::encode(&restored).unwrap()
            );
            admitted(&e);
        }
    }
}

#[test]
fn native_ray_sphere_center_invalid_followup_keeps_finite_internal_cache() {
    let mut e = engine(Space::Spatial);
    ball(&mut e, [0.; 3]);
    query(&mut e);
    let native = e.unified_physics.as_ref().unwrap().native_ray_hits.clone();
    assert!(e
        .query_unified_physics(&[99; 12], &[0.; 13], &[], &[])
        .is_err());
    assert_eq!(e.unified_physics_query_hit_count(), 0);
    let cache = &e.unified_physics.as_ref().unwrap().native_ray_hits;
    assert_eq!(cache, &native);
    assert!(cache
        .iter()
        .all(|hit| hit.normal.iter().all(|v| v.is_finite())));
    admitted(&e);
}
