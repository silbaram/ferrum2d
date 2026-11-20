use super::*;
use crate::components::CollisionMask;
use crate::physics3d::BodyKind;

fn fixture(space: Space) -> Engine {
    let mut e = Engine::new();
    e.activate_data_scene();
    e.configure_unified_physics(WorldConfig {
        space,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..WorldConfig::default()
    })
    .unwrap();
    let mut body = |x, category| {
        e.create_unified_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [x, 1., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                category,
                sensor: true,
                ..ColliderDesc::new(Shape::Sphere { radius: 0.2 })
            },
            [0.; 3],
        )
        .unwrap()
    };
    let actor = body(0., CollisionMask::PLAYER.bits);
    let target = body(1., CollisionMask::ENEMY.bits);
    assert!(e.world.set_health(target, 10.));
    assert!(e.set_gameplay_action_melee(actor.id, actor.generation, 77, 1., 2., 2.));
    assert!(e.set_input_action_binding(
        77,
        0,
        crate::input::INPUT_ACTION_CONTROL_MOUSE_LEFT,
        crate::input::INPUT_ACTION_ACTIVATION_PRESSED
    ));
    assert!(e.configure_data_scene_gameplay_v2(true, actor.id, actor.generation, 0, true));
    e.set_input(false, false, false, false, false, false, true, -1., -1.);
    e.update(0.01);
    assert_eq!(e.world.health(target), Some(8.));
    // Both a packed public result and the internal native cache are populated.
    e.query_unified_physics(
        &[0, 35, u32::MAX, u32::MAX, 0, 0, 0, 0, 0, 8, 0, 0],
        &[-1., 1., 0., 0., 0., 0., 1., 1., 0., 0., 5., 0., 0.],
        &[],
        &[],
    )
    .unwrap();
    assert_eq!(e.unified_physics_query_hit_count(), 2);
    e
}

#[test]
fn file_candidate_stored_gameplay_and_runtime_observations_keep_bytes_and_six_ticks() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut e = fixture(space);
        let original = persistence::encode(&e).unwrap();
        let file = wire(&e);
        let before = file.clone();
        let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
        let usage = candidate.usage();
        assert_eq!(persistence::encode(&candidate.engine).unwrap(), original);
        assert_eq!(persistence::encode(&e).unwrap(), original);
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
        for _ in 0..6 {
            e.update(0.01);
            candidate.engine.update(0.01);
            assert_eq!(
                persistence::encode(&candidate.engine).unwrap(),
                persistence::encode(&e).unwrap()
            );
            prepare(&wire(&e), SDK_BUILD, &Limits::default()).unwrap();
        }
        assert_eq!(file, before);
    }
}

#[test]
fn file_candidate_stored_gameplay_valid_crc_damage_is_rejected_without_mutation() {
    let source = fixture(Space::PlanarXy);
    let original = persistence::encode(&source).unwrap();
    for case in [0, 1, 2, 3, 18, 19] {
        let mut damaged = persistence::decode(&original).unwrap();
        damaged.data_scene.gameplay.corrupt_file_fixture(case);
        let raw = persistence::encode(&damaged).unwrap();
        let decoded = persistence::decode(&raw).unwrap();
        assert_eq!(persistence::encode(&decoded).unwrap(), raw);
        let file = wire(&decoded);
        let before = file.clone();
        framing::read(&file, &profile(SDK_BUILD), &Limits::default().framing).unwrap();
        let result = prepare(&file, SDK_BUILD, &Limits::default());
        assert!(
            matches!(result, Err(Error::DataGameplay(_))),
            "case {case}: {result:?}"
        );
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&decoded).unwrap(), raw);
        assert_eq!(persistence::encode(&source).unwrap(), original);
    }
}

#[test]
fn file_candidate_internal_observation_damage_after_public_clear_is_still_rejected() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut source = fixture(space);
        // A rejected query clears public output while retaining previous native caches.
        assert!(source
            .query_unified_physics(&[99; 12], &[0.; 13], &[], &[])
            .is_err());
        assert_eq!(source.unified_physics_query_hit_count(), 0);
        prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
        let original = persistence::encode(&source).unwrap();
        for case in 0..2 {
            let mut damaged = persistence::decode(&original).unwrap();
            damaged
                .unified_physics
                .as_mut()
                .unwrap()
                .corrupt_candidate_observation_fixture(case);
            let raw = persistence::encode(&damaged).unwrap();
            let decoded = persistence::decode(&raw).unwrap();
            physics_output::validate(
                &decoded,
                physics_output::Limits {
                    max_work: 100_000_000,
                    max_scratch_bytes: 64 * MIB,
                },
            )
            .unwrap();
            let file = wire(&decoded);
            let before = file.clone();
            framing::read(&file, &profile(SDK_BUILD), &Limits::default().framing).unwrap();
            let result = prepare(&file, SDK_BUILD, &Limits::default());
            assert!(
                matches!(result, Err(Error::RuntimeObservations(_))),
                "case {case}: {result:?}"
            );
            assert_eq!(file, before);
            assert_eq!(persistence::encode(&decoded).unwrap(), raw);
            assert_eq!(persistence::encode(&source).unwrap(), original);
        }
    }
}
