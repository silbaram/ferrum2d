use super::*;
use crate::engine::{file_candidate as c, file_envelope as f, persistence};
use crate::particles::ParticlePreset;
use std::sync::Arc;
const SDK: u64 = 0x5245_534f_5552;
fn wire(e: &Engine) -> Vec<u8> {
    let section = c::capture_engine_section(e, &c::Limits::default()).unwrap();
    f::encode(
        &c::profile(SDK),
        &f::Sections {
            engine: &section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &f::Limits::default(),
    )
    .unwrap()
}
fn metadata(e: &Engine) -> (Inventory, Usage) {
    let before = persistence::encode(e).unwrap();
    let file = wire(e);
    let copy = file.clone();
    let candidate = c::prepare(&file, SDK, &c::Limits::default()).unwrap();
    let (r, u) = capture_after_admission(
        e,
        Limits {
            max_work: 100_000_000,
            max_scratch_bytes: 32 * 1024 * 1024,
        },
    )
    .unwrap();
    assert_eq!(candidate.native_resources(), &r);
    assert_eq!(file, copy);
    assert_eq!(persistence::encode(e).unwrap(), before);
    (r, u)
}
fn ids(r: &Inventory, owner: Owner, domain: Domain) -> Vec<StoredId> {
    r.references
        .iter()
        .filter(|v| v.owner == owner && v.domain == domain)
        .map(|v| v.value)
        .collect()
}
fn text(e: &mut Engine, font: u32, texture: u32, id: u32, entity: Option<Entity>) {
    assert!(e.register_bitmap_font(
        font,
        texture,
        10.,
        65,
        &[65],
        &[0., 0., 1., 1., 8., 10., 0., 0., 8.],
        &[],
        &[]
    ));
    let entity = entity.unwrap_or(Entity {
        id: u32::MAX,
        generation: 0,
    });
    assert!(e.set_world_text(
        id,
        font,
        "AA",
        0.,
        0.,
        1.,
        1.,
        1.,
        1.,
        1.,
        0.,
        0,
        0,
        0,
        0.,
        entity.id,
        entity.generation
    ));
}
fn fixture() -> (Engine, Entity) {
    let mut e = Engine::new();
    e.use_data_scene();
    let entity = e.world.spawn_enemy(10., 20., 37);
    e.world.clear_movement_pattern(entity);
    assert!(e.add_gameplay_collision_sound(entity.id, entity.generation, 37, 0.5, 1.));
    assert!(e.add_gameplay_collision_particle(entity.id, entity.generation, 37, 0));
    assert!(e.add_gameplay_collision_emit_effect(entity.id, entity.generation, 37, 1, 0, 0., 0));
    assert!(e.capture_gameplay_authoring_snapshot(entity.id, entity.generation));
    assert!(e.configure_data_scene_sprite_clips(
        entity.id,
        entity.generation,
        &[37., 2., 10., 1.],
        &[0., 0., 0.5, 1., 0.5, 0., 1., 1.],
        37
    ));
    text(&mut e, 37, 91, 1, Some(entity));
    e.tilemap
        .set_tile_definition(8, u32::MAX, 0., 0., 1., 1., 1., 1., 1., 1.);
    let mut p = ParticlePreset::new(81);
    p.burst_count = 2;
    e.particle_presets.resize(38, None);
    e.particle_presets[37] = Some(p);
    e.set_shooter_hit_particle_preset(37);
    assert_eq!(e.spawn_particle_burst(37, 0., 0.), 2);
    assert!(e.configure_physics_impact_feedback(&[
        1.,
        0.,
        0.,
        37.,
        37.,
        1.,
        2.,
        0.,
        0.,
        f64::from(u32::MAX),
        f64::from(u32::MAX),
        1.
    ]));
    (e, entity)
}
#[test]
fn native_resources_actual_namespaces_unloaded_ids_sentinels_and_unused_definitions() {
    let (e, entity) = fixture();
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::WorldSprite, Domain::Texture),
        vec![StoredId::U32(37)]
    );
    assert_eq!(
        ids(&r, Owner::WorldReaction, Domain::DirectSound),
        vec![StoredId::U32(37)]
    );
    assert_eq!(
        ids(&r, Owner::WorldReaction, Domain::ParticlePreset),
        vec![StoredId::U32(37)]
    );
    assert_eq!(
        ids(
            &r,
            Owner::WorldReaction,
            Domain::PresentationEffect { effect_type: 1 }
        ),
        vec![StoredId::U32(37)]
    );
    assert!(r
        .references
        .iter()
        .filter(|v| v.owner == Owner::BitmapText || v.owner == Owner::BitmapCachedCommand)
        .all(|v| v.entity == Some(entity)));
    assert_eq!(
        ids(&r, Owner::BitmapText, Domain::Font),
        vec![StoredId::U32(37)]
    );
    assert_eq!(
        ids(&r, Owner::BitmapFont, Domain::Texture),
        vec![StoredId::U32(91)]
    );
    assert_eq!(
        ids(&r, Owner::BitmapCachedCommand, Domain::Texture),
        vec![StoredId::F32Bits(91f32.to_bits()); 2]
    );
    assert_eq!(
        ids(&r, Owner::TileMain, Domain::Texture),
        vec![StoredId::U32(u32::MAX)]
    );
    assert_eq!(
        ids(&r, Owner::ParticlePreset, Domain::Texture),
        vec![StoredId::U32(81)]
    );
    assert_eq!(
        ids(&r, Owner::Particle, Domain::Texture),
        vec![StoredId::U32(81); 2]
    );
    assert_eq!(
        ids(&r, Owner::ShooterHitPreset, Domain::ParticlePreset),
        vec![StoredId::U32(37)]
    );
    assert!(r.references.iter().any(|v| v.owner == Owner::ImpactFeedback
        && v.role == Role::Sound
        && v.value == StoredId::U32(u32::MAX)
        && v.absence_sentinel == Some(u32::MAX)));
    assert!(r
        .references
        .iter()
        .any(|v| v.owner == Owner::AuthoringSnapshot
            && v.entity == Some(entity)
            && v.domain == Domain::DirectSound));
    assert_eq!(
        ids(&r, Owner::ShooterTextureCatalog, Domain::Texture),
        vec![StoredId::U32(0); 3]
    );
}
#[test]
fn native_resources_retained_authoring_snapshot_and_font_cache_survive_despawn_without_fake_live_rows(
) {
    let (mut e, entity) = fixture();
    e.world.despawn(entity);
    let (r, _) = metadata(&e);
    assert!(r.references.iter().all(|v| v.owner != Owner::WorldSprite
        && v.owner != Owner::WorldPlayback
        && v.owner != Owner::WorldReaction));
    assert_eq!(
        ids(&r, Owner::AuthoringSnapshot, Domain::DirectSound),
        vec![StoredId::U32(37)]
    );
    assert_eq!(
        ids(&r, Owner::BitmapCachedCommand, Domain::Texture).len(),
        2
    );
    let reused = e.world.spawn_enemy(0., 0., 55);
    e.world.clear_movement_pattern(reused);
    assert_eq!(reused.id, entity.id);
    assert_ne!(reused.generation, entity.generation);
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::WorldSprite, Domain::Texture),
        vec![StoredId::U32(55)]
    );
    assert!(r
        .references
        .iter()
        .any(|v| v.owner == Owner::AuthoringSnapshot && v.entity == Some(entity)));
}
#[test]
fn native_resources_future_projectile_and_actor_catalog_retain_texture_clip_and_reactions_after_source_dies(
) {
    let mut e = Engine::new();
    e.use_data_scene();
    let actor = e.world.spawn_player(0., 0., 11);
    let source = e.world.spawn_enemy(20., 0., 72);
    e.world.clear_movement_pattern(source);
    assert!(e.add_gameplay_collision_sound(source.id, source.generation, u32::MAX, 0.5, 1.));
    assert!(e.configure_data_scene_sprite_clips(
        source.id,
        source.generation,
        &[7., 1., 10., 1.],
        &[0., 0., 1., 1.],
        7
    ));
    assert!(e.set_gameplay_action_spawn_prefab(
        actor.id,
        actor.generation,
        77,
        0.,
        1,
        0,
        0,
        0.,
        0.
    ));
    assert!(e.configure_data_scene_gameplay_v7(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[1, 99],
        &[8., 8., 0., 0., 1., 1., 2., 2., 1., 0.1, 0., 1., 1., 1., 1.],
        &[],
        &[],
        &[],
        &[],
        0,
        &[1, source.id, source.generation]
    ));
    e.world.despawn(source);
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::ProjectilePrefab, Domain::Texture),
        vec![StoredId::U32(99)]
    );
    assert_eq!(
        ids(&r, Owner::ActorPrototype, Domain::Texture),
        vec![StoredId::U32(72)]
    );
    assert_eq!(
        ids(&r, Owner::ActorPrototype, Domain::AnimationClip),
        vec![StoredId::U32(7)]
    );
    assert_eq!(
        ids(&r, Owner::ActorPrototype, Domain::DirectSound),
        vec![StoredId::U32(u32::MAX)]
    );
    assert_eq!(
        ids(&r, Owner::AuthoredDefinition, Domain::Texture),
        vec![StoredId::U32(11), StoredId::U32(72)]
    );
    assert!(r
        .references
        .iter()
        .any(|v| v.owner == Owner::ActorPrototype && v.entity == Some(source)));
}
#[test]
fn native_resources_raw_retained_numeric_packets_keep_bits_order_duplicates_and_effect_namespace() {
    let mut e = Engine::new();
    e.use_data_scene();
    e.frame_buffers.audio_events = vec![crate::audio_event::AudioEvent {
        sound_id: -1.5,
        volume: 0.5,
        pitch: 1.,
        channel_id: -0.,
    }];
    let command = crate::render_command::SpriteRenderCommand {
        x: 0.,
        y: 0.,
        width: 1.,
        height: 1.,
        u0: 0.,
        v0: 0.,
        u1: 1.,
        v1: 1.,
        r: 1.,
        g: 1.,
        b: 1.,
        a: 1.,
        texture_id: 2.75,
        effect_flags: -0.,
        rotation_radians: 0.,
    };
    e.frame_buffers.render_commands = vec![command, command];
    e.frame_buffers.sprite_normal_materials = vec![Default::default(); 2];
    let actor = Entity {
        id: u32::MAX,
        generation: 77,
    };
    e.frame_buffers
        .effect_events
        .push(crate::effect_event::EffectEvent::new(
            actor,
            actor,
            37,
            1,
            Default::default(),
            1.,
            0.,
        ));
    e.frame_buffers.gameplay_events.push(
        crate::gameplay_event::GameplayEvent::presentation_effect(actor, actor, 37, 1),
    );
    for kind in [
        crate::gameplay_event::GAMEPLAY_EVENT_SPRITE_ANIMATION_FRAME,
        crate::gameplay_event::GAMEPLAY_EVENT_SPRITE_ANIMATION_COMPLETED,
    ] {
        e.frame_buffers
            .gameplay_events
            .push(crate::gameplay_event::GameplayEvent {
                kind,
                actor_id: actor.id,
                actor_generation: actor.generation,
                source_id: actor.id,
                source_generation: actor.generation,
                token_id: 7,
                flags: 0,
                payload_bits: 0,
            });
    }
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::FrameAudio, Domain::DirectSound),
        vec![StoredId::F32Bits((-1.5f32).to_bits())]
    );
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::FrameCommand)
        .collect();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].path[0], 0);
    assert_eq!(rows[1].path[0], 1);
    assert_eq!(rows[0].value, StoredId::F32Bits(2.75f32.to_bits()));
    assert_eq!(rows[0].flags, (-0f32).to_bits());
    assert_eq!(
        ids(&r, Owner::FrameGameplayClip, Domain::AnimationClip),
        vec![StoredId::U32(7); 2]
    );
    assert_eq!(ids(&r, Owner::FrameEffect, Domain::DirectSound), vec![]);
    assert_eq!(
        ids(
            &r,
            Owner::FrameEffect,
            Domain::PresentationEffect { effect_type: 1 }
        ),
        vec![StoredId::U32(37)]
    );
    assert_eq!(
        ids(
            &r,
            Owner::FrameGameplayEffect,
            Domain::PresentationEffect { effect_type: 1 }
        ),
        vec![StoredId::U32(37)]
    );
}
#[test]
fn native_resources_equal_distinct_and_shared_clips_are_not_rebound_and_bytes_remain_exact() {
    let (mut e, a) = fixture();
    let b = e.world.spawn_enemy(100., 0., 37);
    let d = e.world.spawn_enemy(200., 0., 37);
    e.world.clear_movement_pattern(b);
    e.world.clear_movement_pattern(d);
    let p = e.world.sprite_playbacks[a.id as usize]
        .as_ref()
        .unwrap()
        .clone();
    e.world.sprite_playbacks[b.id as usize] = Some(p.clone());
    let mut distinct = p.clone();
    distinct.clips = Arc::from(p.clips.to_vec());
    e.world.sprite_playbacks[d.id as usize] = Some(distinct);
    let shared = Arc::clone(&p.clips);
    let count = Arc::strong_count(&shared);
    let (r, _) = metadata(&e);
    assert_eq!(Arc::strong_count(&shared), count);
    let get = |entity: Entity| {
        &e.world.sprite_playbacks[entity.id as usize]
            .as_ref()
            .unwrap()
            .clips
    };
    assert!(Arc::ptr_eq(get(a), get(b)));
    assert!(!Arc::ptr_eq(get(a), get(d)));
    assert_eq!(
        ids(&r, Owner::WorldPlayback, Domain::AnimationClip),
        vec![StoredId::U32(37); 3]
    );
}
#[test]
fn native_resources_max_font_keys_and_repeated_fresh_decode_are_deterministic() {
    let mut e = Engine::new();
    e.use_data_scene();
    for id in (0..256).rev() {
        assert!(e.register_bitmap_font(
            id,
            u32::MAX - id,
            10.,
            65,
            &[65],
            &[0., 0., 1., 1., 8., 10., 0., 0., 8.],
            &[],
            &[]
        ));
    }
    let (r, u) = metadata(&e);
    let fonts: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::BitmapFont)
        .collect();
    assert_eq!(fonts.len(), 256);
    assert_eq!(fonts[0].path[0], 0);
    assert_eq!(fonts[255].path[0], 255);
    let file = wire(&e);
    let first = c::prepare(&file, SDK, &c::Limits::default()).unwrap();
    let usage = first.usage();
    for _ in 0..8 {
        let next = c::prepare(&file, SDK, &c::Limits::default()).unwrap();
        assert_eq!(next.native_resources(), &r);
        assert_eq!(next.usage(), usage);
        let (r2, u2) = capture_after_admission(
            &e,
            Limits {
                max_work: u.work,
                max_scratch_bytes: u.scratch_bytes,
            },
        )
        .unwrap();
        assert_eq!(r2, r);
        assert_eq!(u2, u);
    }
}
#[test]
fn native_resources_exact_and_one_below_shared_candidate_quota_reject_without_mutation() {
    let (e, _) = fixture();
    let before = persistence::encode(&e).unwrap();
    let (r, u) = metadata(&e);
    println!(
        "NATIVE_RESOURCE_USAGE rows={} row_size={} header_size={} work={} scratch={}",
        r.references.len(),
        std::mem::size_of::<Reference>(),
        std::mem::size_of::<Inventory>(),
        u.work,
        u.scratch_bytes
    );
    let exact = Limits {
        max_work: u.work,
        max_scratch_bytes: u.scratch_bytes,
    };
    assert_eq!(capture_after_admission(&e, exact).unwrap(), (r, u));
    assert_eq!(
        capture_after_admission(
            &e,
            Limits {
                max_work: u.work - 1,
                ..exact
            }
        ),
        Err(Error::WorkLimit)
    );
    assert_eq!(
        capture_after_admission(
            &e,
            Limits {
                max_scratch_bytes: u.scratch_bytes - 1,
                ..exact
            }
        ),
        Err(Error::ScratchLimit)
    );
    let file = wire(&e);
    let accepted = c::prepare(&file, SDK, &c::Limits::default()).unwrap();
    let usage = accepted.usage();
    let l = c::Limits {
        max_post_decode_work: usage.post_decode_work,
        max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes,
        ..Default::default()
    };
    assert_eq!(c::prepare(&file, SDK, &l).unwrap().usage(), usage);
    assert!(matches!(
        c::prepare(
            &file,
            SDK,
            &c::Limits {
                max_post_decode_work: l.max_post_decode_work - 1,
                ..l.clone()
            }
        ),
        Err(c::Error::NativeResources(Error::WorkLimit))
    ));
    assert!(matches!(
        c::prepare(
            &file,
            SDK,
            &c::Limits {
                max_post_decode_scratch_bytes: l.max_post_decode_scratch_bytes - 1,
                ..l
            }
        ),
        Err(c::Error::NativeResources(Error::ScratchLimit))
    ));
    assert_eq!(persistence::encode(&e).unwrap(), before);
}
#[test]
fn native_resources_valid_crc_damage_rejected_before_metadata_and_only_original_advances_six_ticks()
{
    let (mut e, _) = fixture();
    let healthy = persistence::encode(&e).unwrap();
    let mut damaged = persistence::decode(&healthy).unwrap();
    damaged.bitmap_text.corrupt_file_fixture();
    let file = wire(&damaged);
    let copy = file.clone();
    assert!(matches!(
        c::prepare(&file, SDK, &c::Limits::default()),
        Err(c::Error::Presentation(_))
    ));
    assert_eq!(file, copy);
    assert_eq!(persistence::encode(&e).unwrap(), healthy);
    let mut nonfinite = persistence::decode(&healthy).unwrap();
    nonfinite
        .frame_buffers
        .audio_events
        .push(crate::audio_event::AudioEvent {
            sound_id: f32::NAN,
            volume: 1.,
            pitch: 1.,
            channel_id: 1.,
        });
    let bad = wire(&nonfinite);
    let untouched = bad.clone();
    assert!(matches!(
        c::prepare(&bad, SDK, &c::Limits::default()),
        Err(c::Error::Frame(_))
    ));
    assert_eq!(bad, untouched);
    assert_eq!(persistence::encode(&e).unwrap(), healthy);
    for _ in 0..6 {
        e.update(1. / 60.);
        metadata(&e);
    }
}
#[test]
fn native_resources_program_default_texture_is_separate_from_changed_stored_catalog_and_loaded_claims(
) {
    let mut e = Engine::new();
    e.use_data_scene();
    e.scenes
        .shooter_mut()
        .set_texture_ids(&mut e.world, 51, 52, 53);
    e.scenes.shooter_mut().set_sound_ids(61, 62, 63);
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::ShooterTextureCatalog, Domain::Texture),
        vec![StoredId::U32(51), StoredId::U32(52), StoredId::U32(53)]
    );
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::BuiltinProgramTexture)
        .collect();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].path, [1, 0, 0, 0]);
    assert_eq!(rows[1].path, [2, 0, 0, 0]);
    for v in rows {
        assert_eq!(v.provenance, Provenance::ProgramConstant);
        assert_eq!(v.value, StoredId::U32(0));
        assert_eq!(v.entity, None);
    }
    assert!(r
        .references
        .iter()
        .filter(|v| v.owner != Owner::BuiltinProgramTexture)
        .all(|v| v.provenance == Provenance::StoredField));
}
#[test]
fn native_resources_cleared_preset_keeps_particle_and_missing_historical_preset_links() {
    let (mut e, _) = fixture();
    e.clear_particle_presets();
    let (r, _) = metadata(&e);
    assert_eq!(ids(&r, Owner::ParticlePreset, Domain::Texture), vec![]);
    assert_eq!(
        ids(&r, Owner::ShooterHitPreset, Domain::ParticlePreset),
        vec![]
    );
    assert_eq!(
        ids(&r, Owner::Particle, Domain::Texture),
        vec![StoredId::U32(81); 2]
    );
    assert_eq!(
        ids(&r, Owner::WorldReaction, Domain::ParticlePreset),
        vec![StoredId::U32(37)]
    );
    assert_eq!(
        ids(&r, Owner::ImpactFeedback, Domain::ParticlePreset),
        vec![StoredId::U32(37), StoredId::U32(u32::MAX)]
    );
}
#[test]
fn native_resources_movement_pose_references_keep_owner_local_clip_ids_and_raw_flags() {
    let (mut e, entity) = fixture();
    assert!(e.configure_data_scene_gameplay(true, entity.id, entity.generation, 0));
    let poses: Vec<_> = (0..8).flat_map(|i| [37, i % 2, (i / 2) % 2]).collect();
    assert!(e.configure_data_scene_movement_animation(&poses, 2));
    let (r, _) = metadata(&e);
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::MovementPose)
        .collect();
    assert_eq!(rows.len(), 8);
    for (i, v) in rows.into_iter().enumerate() {
        assert_eq!(v.path[0], i as u32);
        assert_eq!(v.entity, Some(entity));
        assert_eq!(v.value, StoredId::U32(37));
        assert_eq!(v.flags, (i % 2 + (i / 2 % 2) * 2) as u32);
    }
    e.world.despawn(entity);
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::MovementPose, Domain::AnimationClip),
        vec![StoredId::U32(37); 8]
    );
}
#[test]
fn native_resources_spatial_models_keep_base_future_lod_and_retained_old_draw_dependencies() {
    let mut e = Engine::new();
    e.use_data_scene();
    let entity = e.world.spawn_enemy(0., 0., 17);
    e.world.clear_movement_pattern(entity);
    assert!(
        e.configure_spatial_camera(&[0., 0., 10., 10., 0., 0., 0., 100., 0.1, 1000., 800., 600.])
    );
    assert!(e.configure_spatial_terrain(
        &[0., 0., 32., 32., 0., 0., 0., 1., 1., 1., 1.],
        &[1, 0, 59, 1]
    ));
    assert!(e.spatial_scene.models.configure(
        &e.world,
        &[entity.id, entity.generation, 21, 3, 1, 12],
        &[0., 0., 1., -1., -1., -1., 1., 1., 1.]
    ));
    let stream = |asset| {
        [
            entity.id,
            entity.generation,
            21,
            1,
            12,
            0,
            entity.id,
            entity.generation,
            asset,
            1,
            12,
            0,
        ]
    };
    assert!(e.configure_spatial_model_streaming(&[], &stream(22), &[0., 5.]));
    e.build_render_commands();
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::ModelDraw, Domain::Model),
        vec![StoredId::U32(22)]
    );
    assert!(e.configure_spatial_model_streaming(&[], &stream(23), &[0., 5.]));
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::ModelBinding, Domain::Model),
        vec![StoredId::U32(21)]
    );
    assert_eq!(
        ids(&r, Owner::ModelLod, Domain::Model),
        vec![StoredId::U32(21), StoredId::U32(23)]
    );
    assert_eq!(
        ids(&r, Owner::ModelDraw, Domain::Model),
        vec![StoredId::U32(22)]
    );
    assert_eq!(
        ids(&r, Owner::SpatialSurface, Domain::Texture),
        vec![StoredId::U32(59)]
    );
    assert!(r
        .references
        .iter()
        .any(|v| v.owner == Owner::SpatialVertex && v.value == StoredId::F32Bits(59f32.to_bits())));
}
#[test]
fn native_resources_roster_canonical_zero_finite_real_bits_and_raw_audio_negative_zero_are_separate(
) {
    let mut e = Engine::new();
    e.use_data_scene();
    assert!(e.configure_gameplay_variable(1, 1, 0, -0., 0.));
    let tiny = f64::from_bits(0x8000_0000_0000_0001);
    assert!(e.configure_gameplay_variable(2, 1, 0, tiny, 0.));
    assert!(e.configure_gameplay_variable(3, 1, 0, f64::MAX, 0.));
    e.frame_buffers
        .audio_events
        .push(crate::audio_event::AudioEvent {
            sound_id: -0.,
            volume: 1.,
            pitch: 1.,
            channel_id: 1.,
        });
    let file = wire(&e);
    let c = c::prepare(&file, SDK, &c::Limits::default()).unwrap();
    assert_eq!(
        c.native_roster().variables[0].default_value.to_bits(),
        0f64.to_bits() // The public producer canonicalizes -0 before persistence.
    );
    assert_eq!(
        c.native_roster().variables[1].default_value.to_bits(),
        tiny.to_bits()
    );
    assert_eq!(
        c.native_roster().variables[2].default_value.to_bits(),
        f64::MAX.to_bits()
    );
    assert_eq!(
        ids(c.native_resources(), Owner::FrameAudio, Domain::DirectSound),
        vec![StoredId::F32Bits((-0f32).to_bits())]
    );
}
#[test]
fn native_resources_optional_texture_sentinels_and_texture_zero_keep_distinct_roles() {
    let (mut e, entity) = fixture();
    let none = crate::render_command::SPRITE_NORMAL_NONE;
    assert!(e.configure_sprite_normal_materials(&[entity.id, entity.generation, none, 0]));
    assert!(e.configure_sprite_lighting_materials(&[entity.id, entity.generation, 1, 0]));
    assert!(e.configure_sprite_surface_materials(&[
        entity.id,
        entity.generation,
        none,
        0,
        42,
        1,
        0,
        0,
        0,
        0,
        1f32.to_bits(),
        0
    ]));
    let (r, _) = metadata(&e);
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::WorldSprite)
        .collect();
    assert_eq!(rows.len(), 4); // Canonical normal NONE setter detaches the binding.
    assert!(rows.iter().all(|v| v.role != Role::Normal));
    assert!(e.configure_sprite_normal_materials(&[entity.id, entity.generation, 18, 0]));
    let (r, _) = metadata(&e);
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::WorldSprite)
        .collect();
    assert_eq!(rows.len(), 5);
    assert!(rows.iter().any(|v| v.role == Role::Normal
        && v.value == StoredId::U32(18)
        && v.absence_sentinel == Some(none)
        && v.flags == 0));
    assert!(rows.iter().any(|v| v.role == Role::Specular
        && v.value == StoredId::U32(0)
        && v.absence_sentinel == Some(none)
        && v.flags == 1));
    assert!(rows
        .iter()
        .any(|v| v.role == Role::Roughness && v.value == StoredId::U32(42) && v.flags == 1));
}
#[test]
fn native_resources_empty_retained_font_backing_is_charged_before_iteration() {
    let mut clean = Engine::new();
    clean.use_data_scene();
    let (_, clean_usage) = metadata(&clean);
    let mut e = Engine::new();
    e.use_data_scene();
    for id in 0..256 {
        assert!(e.register_bitmap_font(
            id,
            id,
            10.,
            65,
            &[65],
            &[0., 0., 1., 1., 8., 10., 0., 0., 8.],
            &[],
            &[]
        ));
    }
    e.clear_bitmap_fonts();
    let capacity = e.bitmap_text.file_resource_lengths()[0];
    assert!(capacity >= 256);
    let (r, usage) = metadata(&e);
    assert!(ids(&r, Owner::BitmapFont, Domain::Texture).is_empty());
    assert_eq!(usage.work - clean_usage.work, 8 * capacity as u64);
}
#[test]
fn native_resources_pending_and_drained_shooter_commands_keep_captured_old_texture_and_sound_ids() {
    let mut e = Engine::new();
    e.use_data_scene();
    let _actor = e.world.spawn_player(100., 0., 11);
    let source = e.world.spawn_enemy(0., 0., 12);
    e.world.clear_movement_pattern(source);
    e.scenes
        .shooter_mut()
        .set_texture_ids(&mut e.world, 41, 42, 43);
    e.scenes.shooter_mut().set_sound_ids(51, 52, 53);
    e.scenes
        .shooter_mut()
        .seed_file_resource_pending_fixture(&e.world, source);
    e.scenes
        .shooter_mut()
        .set_texture_ids(&mut e.world, 61, 62, 63);
    e.scenes.shooter_mut().set_sound_ids(71, 72, 73);
    let (r, _) = metadata(&e);
    assert_eq!(
        ids(&r, Owner::ShooterSpawnCommand, Domain::Texture),
        vec![
            StoredId::U32(43),
            StoredId::U32(43),
            StoredId::U32(42),
            StoredId::U32(43),
            StoredId::U32(43)
        ]
    );
    assert_eq!(
        ids(&r, Owner::ShooterSpawnCommand, Domain::DirectSound),
        vec![StoredId::U32(51); 3]
    );
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::ShooterSpawnCommand && v.domain == Domain::Texture)
        .collect();
    assert_eq!(
        rows.iter().map(|v| v.path).collect::<Vec<_>>(),
        vec![
            [0, 0, 0, 0],
            [1, 0, 0, 0],
            [1, 1, 1, 0],
            [1, 2, 1, 0],
            [1, 2, 2, 0]
        ]
    );
    assert_eq!(rows[0].entity, None);
    assert_eq!(rows[4].entity, Some(source));
    assert_eq!(
        ids(&r, Owner::ShooterTextureCatalog, Domain::Texture),
        vec![StoredId::U32(61), StoredId::U32(62), StoredId::U32(63)]
    );
}
#[test]
fn native_resources_ground_shadow_stored_cache_shader_bits_and_future_program_constant_are_distinct(
) {
    let mut e = Engine::new();
    e.use_data_scene();
    e.set_viewport_size(800., 600.);
    e.camera.x = 400.;
    e.camera.y = 300.;
    let actor = e.world.spawn_player(300., 300., 11);
    let source = e.world.spawn_enemy(320., 300., 72);
    e.world.clear_movement_pattern(source);
    assert!(e.configure_data_scene_sun(1., 0., 0.5, 2., 512));
    assert!(e.configure_data_scene_ground_shadow(
        source.id,
        source.generation,
        2,
        16.,
        32.,
        0.5,
        false,
        0
    ));
    e.build_render_commands();
    let (r, _) = metadata(&e);
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::WorldGroundShadow)
        .collect();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().any(|v| v.provenance == Provenance::StoredField
        && v.value == StoredId::F32Bits(0f32.to_bits())
        && v.flags == (crate::render_command::SPRITE_PROJECT_GROUND + 16.).to_bits()));
    assert!(rows
        .iter()
        .any(|v| v.provenance == Provenance::ProgramConstant && v.value == StoredId::U32(0)));
    assert!(e.set_gameplay_action_spawn_prefab(
        actor.id,
        actor.generation,
        77,
        0.,
        1,
        0,
        0,
        0.,
        0.
    ));
    assert!(e.configure_data_scene_gameplay_v7(
        true,
        actor.id,
        actor.generation,
        0,
        true,
        &[],
        &[],
        &[],
        &[],
        &[],
        &[],
        0,
        &[1, source.id, source.generation]
    ));
    e.world.despawn(source);
    let (r, _) = metadata(&e);
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::ActorGroundShadow)
        .collect();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].provenance, Provenance::ProgramConstant);
    assert_eq!(rows[0].entity, Some(source));
    assert!(r
        .references
        .iter()
        .all(|v| v.owner != Owner::WorldGroundShadow));
    assert!(r
        .references
        .iter()
        .filter(|v| v.owner == Owner::ActorGroundShadow)
        .all(|v| v.domain == Domain::Texture));
    let mut alpha = Engine::new();
    alpha.use_data_scene();
    alpha.set_viewport_size(800., 600.);
    alpha.camera.x = 400.;
    alpha.camera.y = 300.;
    let a = alpha.world.spawn_enemy(300., 300., 72);
    alpha.world.clear_movement_pattern(a);
    assert!(alpha.configure_data_scene_sun(1., 0., 0.5, 2., 512));
    assert!(alpha.configure_data_scene_ground_shadow(
        a.id,
        a.generation,
        3,
        16.,
        32.,
        0.5,
        false,
        0
    ));
    alpha.build_render_commands();
    let (r, _) = metadata(&alpha);
    let rows: Vec<_> = r
        .references
        .iter()
        .filter(|v| v.owner == Owner::WorldGroundShadow)
        .collect();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].provenance, Provenance::StoredField);
    assert_eq!(rows[0].value, StoredId::F32Bits(0f32.to_bits()));
    assert_eq!(
        rows[0].flags,
        (crate::render_command::SPRITE_PROJECT_GROUND + crate::render_command::SPRITE_SHADOW_ALPHA)
            .to_bits()
    );
    assert!(
        ids(&r, Owner::FrameCommand, Domain::Texture).contains(&StoredId::F32Bits(72f32.to_bits()))
    );
}
