use super::*;
use crate::engine::persistence;
use crate::particles::{ParticlePreset, ParticleRange};
use crate::tweens::{SpriteTint, TweenEasing};
fn limits() -> Limits {
    Limits {
        max_work: 1_000_000,
        max_scratch_bytes: 1_000_000,
    }
}
fn bytes(e: &Engine) -> Vec<u8> {
    persistence::encode(e).unwrap()
}
fn checked(e: &Engine) -> Usage {
    assert!(e.capture_runtime_checkpoint().is_some());
    let before = bytes(e);
    let usage = validate(e, limits()).unwrap();
    assert_eq!(bytes(e), before);
    let candidate = persistence::decode(&before).unwrap();
    assert_eq!(validate(&candidate, limits()), Ok(usage));
    assert_eq!(bytes(&candidate), before);
    usage
}
fn sprite(e: &mut Engine) -> Entity {
    assert!(e.spawn_data_scene_entity(
        10.0,
        20.0,
        0.0,
        0,
        1,
        32.0,
        32.0,
        0.0,
        0.0,
        1.0,
        1.0,
        0,
        0.0,
        crate::engine::PHYSICS_LAYER_PLAYER,
        crate::engine::PHYSICS_COLLIDER_TYPE_NONE,
        0.0,
        0.0,
        false,
        false,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
        vec![]
    ));
    Entity {
        id: e.data_scene_entity_id(),
        generation: e.data_scene_entity_generation(),
    }
}
fn preset(e: &mut Engine) {
    e.set_particle_seed(7);
    e.set_particle_preset(
        0,
        u32::MAX,
        0.0,
        0.0,
        1.0,
        1.0,
        2,
        4.0,
        4.0,
        0.0,
        0.0,
        6.0,
        6.0,
        2.0,
        2.0,
        2.0,
        -1.0,
        3.0,
        1.0,
        1.0,
        0.5,
        0.25,
        0.0,
        0.0,
        0.0,
        -3.0,
    );
}
fn populated() -> (Engine, Entity, Entity) {
    let mut e = crate::engine::legacy_test_fixture::engine();
    e.use_data_scene();
    let a = sprite(&mut e);
    let b = sprite(&mut e);
    e.world.set_aabb_collider(
        a,
        crate::components::AabbCollider::new(
            1.0,
            1.0,
            false,
            crate::components::CollisionLayer::Player,
        ),
    );
    e.world.set_aabb_collider(
        b,
        crate::components::AabbCollider::new(
            1.0,
            1.0,
            false,
            crate::components::CollisionLayer::Wall,
        ),
    );
    preset(&mut e);
    assert_eq!(e.spawn_particle_burst(0, 20.0, 30.0), 2);
    assert!(e.register_bitmap_font(
        u32::MAX,
        u32::MAX,
        8.0,
        u32::MAX,
        &[65, 66],
        &[
            0.0, 0.0, 0.5, 1.0, 3.0, 4.0, -1.0, -2.0, 3.0, 0.5, 0.0, 1.0, 1.0, 3.0, 4.0, 0.0, 0.0,
            3.0
        ],
        &[65, 66],
        &[-1.0]
    ));
    assert!(e.set_world_text(
        3,
        u32::MAX,
        "AB\nA🙂",
        -0.0,
        2.0,
        1.0,
        1.0,
        0.5,
        0.25,
        1.0,
        20.0,
        1,
        -1,
        u32::MAX,
        -3.0,
        a.id,
        a.generation
    ));
    assert!(e.tweens.flash_sprite_tint(
        &mut e.world,
        a,
        SpriteTint::new(2.0, -1.0, 3.0, 1.0),
        0.4,
        TweenEasing::EaseOut
    ));
    assert!(e.configure_physics_impact_feedback(&[u32::MAX as f64, 1.0, 0.2, 7.0, 0.0, 0.5]));
    e.world.record_contact_impact(
        crate::components::RigidContactImpulse {
            entity_a: a,
            entity_b: b,
            normal_impulse: 5.0,
            point_x: 0.0,
            point_y: 0.0,
            normal_x: 1.0,
            normal_y: 0.0,
            tangent_impulse: 0.0,
        },
        10.0,
    );
    e.process_physics_impact_feedback(0.1);
    assert_eq!(e.physics_impact_feedback_stats()[0], 1);
    (e, a, b)
}
#[test]
fn file_presentation_public_engine_changes_capture_actual_codec_and_continuation() {
    let (mut e, _, _) = populated();
    checked(&e);
    let mut restored = persistence::decode(&bytes(&e)).unwrap();
    for dt in [0.0, 0.004, 0.01, 0.025, 0.0, 0.19, 0.3] {
        e.update_frame(dt, false, false, false);
        restored.update_frame(dt, false, false, false);
        checked(&e);
        checked(&restored);
        assert_eq!(bytes(&e), bytes(&restored));
    }
}
#[test]
fn file_presentation_stale_entities_cleared_presets_removed_fonts_and_output_history_are_legal() {
    let (mut e, a, _) = populated();
    let output = e.frame_buffers.audio_events.clone();
    assert!(e.remove_bitmap_font(u32::MAX));
    assert!(e.despawn_physics_entity(a.id, a.generation));
    e.clear_particle_presets();
    e.set_shooter_hit_particle_preset(255);
    assert_eq!(e.physics_impact_feedback_stats()[2], 1);
    assert_eq!(e.tweens.tween_count(), 1);
    assert!(e.particle_count() > 0);
    checked(&e);
    assert_eq!(e.frame_buffers.audio_events, output);
    assert_eq!(e.tweens.tween_count(), 1);
    let mut restored = persistence::decode(&bytes(&e)).unwrap();
    for dt in [0.0, 0.01, 0.3] {
        e.update_frame(dt, false, false, false);
        restored.update_frame(dt, false, false, false);
        checked(&e);
        assert_eq!(bytes(&e), bytes(&restored));
    }
}
#[test]
fn file_presentation_raw_finite_dormant_range_hdr_max_ids_and_burst_count_are_preserved() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_particle_preset(
        255,
        u32::MAX,
        0.0,
        0.0,
        1.0,
        1.0,
        u32::MAX,
        -3.0,
        -9.0,
        8.0,
        -4.0,
        -8.0,
        -2.0,
        -1.0,
        -5.0,
        9.0,
        -1.0,
        4.0,
        0.0,
        8.0,
        7.0,
        -2.0,
        -0.0,
        -100.0,
        100.0,
        -99.0,
    );
    e.set_shooter_hit_particle_preset(254);
    let before = bytes(&e);
    let usage = validate(
        &e,
        Limits {
            max_work: u64::MAX,
            max_scratch_bytes: 0,
        },
    )
    .unwrap();
    assert!(usage.work > u64::from(u32::MAX));
    assert_eq!(bytes(&e), before);
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: usage.work - 1,
                max_scratch_bytes: 0
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(bytes(&e), before);
    // Burst is dormant. Admission never samples/normalizes or loops MAX times.
}
#[test]
fn file_presentation_exact_work_scratch_and_one_below_are_readonly() {
    let (e, _, _) = populated();
    let before = bytes(&e);
    let usage = checked(&e);
    assert!(usage.scratch_bytes > 0);
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: usage.work,
                max_scratch_bytes: usage.scratch_bytes
            }
        ),
        Ok(usage)
    );
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: usage.work - 1,
                max_scratch_bytes: usage.scratch_bytes
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(
        validate(
            &e,
            Limits {
                max_work: usage.work,
                max_scratch_bytes: usage.scratch_bytes - 1
            }
        ),
        Err(Error::ScratchLimit)
    );
    assert_eq!(bytes(&e), before);
}
#[test]
fn file_presentation_valid_crc_malformed_leaf_candidates_reject_without_changing_live_bytes() {
    let (live, _, _) = populated();
    let original = bytes(&live);
    type Case = (Owner, Problem, fn(&mut Engine));
    let cases: [Case; 5] = [
        (Owner::Particles, Problem::Number, |e| {
            e.particles.corrupt_file_fixture()
        }),
        (Owner::Fonts, Problem::Reference, |e| {
            e.bitmap_text.corrupt_file_fixture()
        }),
        (Owner::Tweens, Problem::Range, |e| {
            e.tweens.corrupt_file_fixture()
        }),
        (Owner::Presets, Problem::Number, |e| {
            e.particle_presets[0].as_mut().unwrap().damping = f32::NAN
        }),
        (Owner::ImpactCooldowns, Problem::Clock, |e| {
            e.impact_feedback.corrupt_file_fixture()
        }),
    ];
    for (owner, problem, mutate) in cases {
        let mut candidate = persistence::decode(&original).unwrap();
        mutate(&mut candidate);
        let malformed = bytes(&candidate);
        let decoded = persistence::decode(&malformed)
            .expect("actual codec CRC is valid; semantic rejection must happen in the owner");
        assert!(
            matches!(validate(&decoded,limits()),Err(Error::Invalid{owner:o,problem:p,..})if o==owner&&p==problem)
        );
        assert_eq!(bytes(&decoded), malformed);
        assert_eq!(bytes(&live), original);
        assert_eq!(
            validate(
                &decoded,
                Limits {
                    max_work: 0,
                    max_scratch_bytes: 0
                }
            ),
            Err(Error::WorkLimit)
        );
    }
}
#[test]
fn file_presentation_numeric_text_update_preserves_layout_cache_and_revision() {
    let (mut e, a, _) = populated();
    let revision = e.bitmap_text.layout_revision();
    assert!(e.update_world_text(
        3,
        u32::MAX,
        -90.0,
        12.0,
        1.0,
        1.0,
        0.5,
        0.25,
        1.0,
        20.0,
        1,
        i32::MIN,
        u32::MAX,
        -0.0,
        a.id,
        a.generation
    ));
    assert_eq!(e.bitmap_text.layout_revision(), revision);
    checked(&e);
    assert_eq!(e.bitmap_text.layout_revision(), revision);
}
#[test]
fn file_presentation_spatial_particle_metadata_and_underflow_glyph_output_are_preserved() {
    let mut e = Engine::new();
    e.use_data_scene();
    let mut p = ParticlePreset::new(u32::MAX);
    p.burst_count = 1;
    p.lifetime_seconds = ParticleRange::constant(1.0);
    assert_eq!(e.particles.spawn_spatial_burst(p, 0.0, -0.0, -5.0, 0.5), 1);
    assert!(e.register_bitmap_font(
        42,
        u32::MAX,
        f32::MIN_POSITIVE,
        u32::MAX,
        &[65],
        &[
            0.0,
            0.0,
            1.0,
            1.0,
            f32::MIN_POSITIVE,
            f32::MIN_POSITIVE,
            0.0,
            0.0,
            f32::MIN_POSITIVE
        ],
        &[],
        &[]
    ));
    assert!(e.set_world_text(
        0,
        42,
        "A",
        0.0,
        0.0,
        f32::MIN_POSITIVE,
        1.0,
        1.0,
        1.0,
        1.0,
        0.0,
        0,
        0,
        0,
        0.0,
        u32::MAX,
        u32::MAX
    ));
    checked(&e);
}

#[test]
fn file_presentation_clone_compacted_backing_keeps_capacity_and_future_growth() {
    let (mut e, _, _) = populated();
    e.particles = e.particles.clone();
    e.tweens = e.tweens.clone();
    checked(&e);
    let mut restored = persistence::decode(&bytes(&e)).unwrap();
    assert_eq!(
        e.spawn_particle_burst(0, 0.0, 0.0),
        restored.spawn_particle_burst(0, 0.0, 0.0)
    );
    let a = sprite(&mut e);
    let b = sprite(&mut restored);
    assert_eq!(a, b);
    assert!(e.tweens.flash_sprite_tint(
        &mut e.world,
        a,
        SpriteTint::new(1.0, 0.0, 0.0, 1.0),
        1.0,
        TweenEasing::Linear
    ));
    assert!(restored.tweens.flash_sprite_tint(
        &mut restored.world,
        b,
        SpriteTint::new(1.0, 0.0, 0.0, 1.0),
        1.0,
        TweenEasing::Linear
    ));
    checked(&e);
    checked(&restored);
    assert_eq!(bytes(&e), bytes(&restored));
}
