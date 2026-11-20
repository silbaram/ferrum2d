use super::*;
use crate::engine::{persistence, Engine};
use crate::entity::Entity;
use crate::gameplay_event::{GameplayEvent, GAMEPLAY_EVENT_SPRITE_ANIMATION_OVERFLOW};
use crate::render_command::{SpriteRenderItem, SpriteRenderSortKey};

type Mutation = fn(&mut EngineFrameBuffers);

fn limits() -> Limits {
    Limits {
        max_work: 1_000_000,
    }
}
fn sprite_command() -> SpriteRenderCommand {
    SpriteRenderCommand {
        x: -0.,
        y: -3.,
        width: -4.,
        height: 5.,
        u0: 2.,
        v0: 1.,
        u1: -1.,
        v1: 0.,
        r: 4.,
        g: 3.,
        b: 2.,
        a: 1.,
        texture_id: 16_777_215.,
        effect_flags: 36.,
        rotation_radians: -2.,
    }
}
fn source() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    let entity = e.world.spawn_entity();
    e.world.set_transform(
        entity,
        crate::components::Transform2D { x: 13.25, y: -12.5 },
    );
    e.update(0.017);
    assert!(e.query_audio_poses(&[entity.id, entity.generation, u32::MAX, 17]));
    e.world.despawn(entity); // Saved valid audio poses and output handles may be retired.
    let b = &mut e.frame_buffers;
    b.render_commands = vec![sprite_command()];
    b.sprite_normal_materials = vec![SpriteNormalMaterial::default()];
    b.sprite_lighting_materials = vec![SpriteLightingMaterial {
        mode: 2,
        alpha_cutoff: 0.25,
    }];
    b.sprite_surface_materials = vec![SpriteSurfaceMaterial {
        flags: 1,
        emission: [64., 2., 1.],
        ..Default::default()
    }];
    b.sprite_light_masks = vec![SpriteLightMasks {
        light_mask: 1,
        shadow_mask: 2,
    }];
    b.render_items = vec![SpriteRenderItem {
        command: sprite_command(),
        normal_material: b.sprite_normal_materials[0],
        lighting_material: b.sprite_lighting_materials[0],
        surface_material: b.sprite_surface_materials[0],
        light_masks: b.sprite_light_masks[0],
        sort_key: SpriteRenderSortKey {
            floor_id: 19,
            elevation: -2.,
            foot_y: 4.,
            render_layer: -7,
            sort_order: -0.,
            stable_id: u32::MAX,
        },
    }];
    b.contact_impacts = vec![crate::components::RigidContactImpulse {
        entity_a: entity,
        entity_b: Entity {
            id: u32::MAX,
            generation: 19,
        },
        point_x: -1.,
        point_y: 2.,
        normal_x: 0.,
        normal_y: 1.,
        normal_impulse: 3.,
        tangent_impulse: -4.,
    }];
    b.contact_impacts_dropped = u32::MAX;
    b.ground_shadow_volumes = vec![
        crate::world::ground_shadow::GroundShadowVolumeVertex {
            x: -0.,
            y: 9.,
            opacity: 0.75,
        };
        3
    ];
    b.ground_shadow_volume_casters = 1;
    b.audio_events = vec![crate::audio_event::AudioEvent {
        sound_id: u32::MAX as f32,
        volume: 4.,
        pitch: 0.5,
        channel_id: 1.,
    }];
    b.effect_events = vec![crate::effect_event::EffectEvent::new(
        entity,
        entity,
        19,
        7,
        crate::components::Transform2D { x: -5., y: 6. },
        4.,
        -1.,
    )];
    b.collision_events = vec![
        crate::collision_event::CollisionEvent::from_entities_with_damage(
            crate::collision_event::COLLISION_EVENT_EXIT,
            entity,
            entity,
            19.25,
        ),
    ];
    b.gameplay_events = vec![
        GameplayEvent {
            kind: 12,
            actor_id: entity.id,
            actor_generation: entity.generation,
            source_id: entity.id,
            source_generation: entity.generation,
            token_id: 1,
            flags: 0,
            payload_bits: u32::MAX,
        }, // Not an f32 NaN: integer frame payload.
        GameplayEvent {
            kind: GAMEPLAY_EVENT_SPRITE_ANIMATION_OVERFLOW,
            actor_id: u32::MAX,
            actor_generation: 0,
            source_id: u32::MAX,
            source_generation: 0,
            token_id: 0,
            flags: 0,
            payload_bits: u32::MAX,
        },
    ];
    b.animation_event_overflow = Some(1);
    let line = crate::collision::PhysicsDebugLine {
        x0: -1.,
        y0: 0.,
        x1: 1.,
        y1: 2.,
        r: 4.,
        g: 3.,
        b: 2.,
        a: 1.,
    };
    b.physics_debug_lines = vec![line];
    b.tilemap_navigation_debug_lines = vec![line];
    b.tilemap_navigation_path_points = vec![-1., 2., u32::MAX as f32, -3., 4.];
    b.native_debug_state = [u32::MAX; 4]; // Stored diagnostics are opaque integer history.
    e
}

#[test]
fn file_frame_admission_preserves_historical_output_sentinels_and_memory_bytes() {
    let mut e = source();
    let memory = persistence::encode(&e).unwrap();
    let mut decoded = persistence::decode(&memory).unwrap();
    let usage = validate(&decoded.frame_buffers, limits()).unwrap();
    assert!(usage.work > 256);
    assert_eq!(validate(&e.frame_buffers, limits()).unwrap(), usage);
    assert_eq!(persistence::encode(&e).unwrap(), memory);
    assert_eq!(persistence::encode(&decoded).unwrap(), memory);
    for _ in 0..6 {
        e.update(0.013);
        decoded.update(0.013);
        validate(&e.frame_buffers, limits()).unwrap();
        validate(&decoded.frame_buffers, limits()).unwrap();
        assert_eq!(
            persistence::encode(&e).unwrap(),
            persistence::encode(&decoded).unwrap()
        );
    }
}

#[test]
fn file_frame_admission_actual_default_and_data_frames_have_valid_nan_height_history() {
    for data in [false, true] {
        let mut e = Engine::new();
        if data {
            e.use_data_scene();
        }
        for _ in 0..60 {
            e.update(0.017);
            validate(&e.frame_buffers, limits()).unwrap();
        }
        let memory = persistence::encode(&e).unwrap();
        let decoded = persistence::decode(&memory).unwrap();
        validate(&decoded.frame_buffers, limits()).unwrap();
        assert_eq!(persistence::encode(&decoded).unwrap(), memory);
    }
}

#[test]
fn file_frame_admission_rejects_each_output_family_after_actual_codec_without_repair() {
    let cases: &[(&str, Mutation)] = &[
        ("render-command", |b| {
            b.render_commands[0].rotation_radians = f32::NAN
        }),
        ("normal", |b| b.sprite_normal_materials[0].flags = 1),
        ("lighting", |b| {
            b.sprite_lighting_materials[0].alpha_cutoff = f32::INFINITY
        }),
        ("surface", |b| {
            b.sprite_surface_materials[0].emission[2] = f32::NAN
        }),
        ("masks", |b| b.sprite_light_masks[0].shadow_mask = 256),
        ("render-item", |b| {
            b.render_items[0].sort_key.sort_order = f32::NAN
        }),
        ("render-item", |b| {
            b.render_items[0].command.x = f32::INFINITY
        }),
        ("render-item", |b| {
            b.render_items[0].normal_material.flags = 1
        }),
        ("render-item", |b| {
            b.render_items[0].lighting_material.mode = 3
        }),
        ("render-item", |b| {
            b.render_items[0].surface_material.roughness = f32::NAN
        }),
        ("render-item", |b| {
            b.render_items[0].light_masks.light_mask = 256
        }),
        ("contact-impact", |b| {
            b.contact_impacts[0].tangent_impulse = f32::NAN
        }),
        ("shadow-vertex", |b| {
            b.ground_shadow_volumes[2].x = f32::INFINITY
        }),
        ("shadow-vertex", |b| {
            b.ground_shadow_volumes[0].opacity = -1.
        }),
        ("audio-event", |b| b.audio_events[0].pitch = f32::NAN),
        ("effect-event", |b| b.effect_events[0].radius = f32::NAN),
        ("collision-event", |b| {
            b.collision_events[0].damage_bits = f32::NAN.to_bits()
        }),
        ("collision-event", |b| b.collision_events[0].kind = 8),
        ("gameplay-event", |b| b.gameplay_events[0].kind = 16),
        ("debug-line", |b| b.physics_debug_lines[0].a = f32::NAN),
        ("navigation-line", |b| {
            b.tilemap_navigation_debug_lines[0].y1 = f32::NAN
        }),
        ("navigation-point", |b| {
            b.tilemap_navigation_path_points[3] = f32::INFINITY
        }),
        ("projection", |b| {
            b.ground_shadow_projection.length_scale = f32::NAN
        }),
        ("projection", |b| b.ground_y_scale = f32::INFINITY),
    ];
    for &(expected, mutate) in cases {
        let mut e = source();
        mutate(&mut e.frame_buffers);
        let original = persistence::encode(&e).unwrap();
        let decoded = persistence::decode(&original).unwrap();
        assert!(
            matches!(validate(&decoded.frame_buffers, limits()),
            Err(Error::Invalid { field, .. }) if field == expected),
            "{expected}"
        );
        assert_eq!(
            persistence::encode(&decoded).unwrap(),
            original,
            "{expected}"
        );
        assert_eq!(persistence::encode(&e).unwrap(), original, "{expected}");
    }
}

#[test]
fn file_frame_admission_checks_output_strides_and_alignment_before_consumer_access() {
    let cases: &[(&str, Mutation)] = &[
        ("normal-alignment", |b| b.sprite_normal_materials.clear()),
        ("lighting-alignment", |b| {
            b.sprite_lighting_materials.push(Default::default())
        }),
        ("surface-alignment", |b| {
            b.sprite_surface_materials.push(Default::default())
        }),
        ("mask-alignment", |b| {
            b.sprite_light_masks.push(Default::default())
        }),
        ("navigation-stride", |b| {
            b.tilemap_navigation_path_points.push(1.)
        }),
        ("shadow-triangles", |b| {
            b.ground_shadow_volumes.pop();
        }),
        ("shadow-triangles", |b| b.ground_shadow_volume_casters = 0),
        ("shadow-triangles", |b| b.ground_shadow_volume_casters = 2),
        ("audio-pose-count", |b| {
            b.audio_poses
                .resize(MAX_AUDIO_POSES + 1, Default::default())
        }),
    ];
    for &(expected, mutate) in cases {
        let mut e = source();
        mutate(&mut e.frame_buffers);
        let bytes = persistence::encode(&e).unwrap();
        let d = persistence::decode(&bytes).unwrap();
        assert!(
            matches!(validate(&d.frame_buffers, limits()),
            Err(Error::Invalid { field, .. }) if field == expected),
            "{expected}"
        );
        assert_eq!(persistence::encode(&d).unwrap(), bytes);
    }
    let mut e = source();
    e.frame_buffers.sprite_lighting_materials.clear();
    e.frame_buffers.sprite_surface_materials.clear();
    e.frame_buffers.sprite_light_masks.clear();
    validate(&e.frame_buffers, limits()).unwrap(); // Optional all-default sidecars.
}

#[test]
fn file_frame_admission_animation_overflow_index_kind_and_sentinel_are_required() {
    let mutations: &[fn(&mut EngineFrameBuffers)] = &[
        |b| b.animation_event_overflow = Some(usize::MAX),
        |b| b.animation_event_overflow = Some(b.gameplay_events.len()),
        |b| b.animation_event_overflow = Some(0),
        |b| b.gameplay_events[1].actor_id = 1,
        |b| b.gameplay_events[1].actor_generation = 1,
        |b| b.gameplay_events[1].source_id = 1,
        |b| b.gameplay_events[1].source_generation = 1,
        |b| b.gameplay_events[1].token_id = 1,
        |b| b.gameplay_events[1].flags = 1,
        |b| b.gameplay_events[1].payload_bits = 0,
    ];
    for mutate in mutations {
        let mut e = source();
        mutate(&mut e.frame_buffers);
        let bytes = persistence::encode(&e).unwrap();
        let d = persistence::decode(&bytes).unwrap();
        assert!(matches!(
            validate(&d.frame_buffers, limits()),
            Err(Error::Invalid {
                field: "animation-overflow",
                ..
            })
        ));
        assert_eq!(persistence::encode(&d).unwrap(), bytes);
    }
}

#[test]
fn file_frame_admission_work_is_precharged_and_exact_boundary_is_stable() {
    let e = source();
    let before = persistence::encode(&e).unwrap();
    let usage = validate(&e.frame_buffers, limits()).unwrap();
    assert_eq!(
        validate(
            &e.frame_buffers,
            Limits {
                max_work: usage.work
            }
        )
        .unwrap(),
        usage
    );
    assert_eq!(
        validate(
            &e.frame_buffers,
            Limits {
                max_work: usage.work - 1
            }
        ),
        Err(Error::WorkLimit)
    );
    let mut invalid = source();
    invalid.frame_buffers.animation_event_overflow = Some(usize::MAX);
    assert_eq!(
        validate(&invalid.frame_buffers, Limits { max_work: 0 }),
        Err(Error::WorkLimit)
    );
    assert_eq!(persistence::encode(&e).unwrap(), before);
}

#[test]
fn file_frame_admission_private_audio_and_telemetry_fields_are_not_opaque() {
    let e = source();
    let pose = &e.frame_buffers.audio_poses[0];
    let mut fields: Vec<u8> = postcard::to_allocvec(pose).unwrap();
    // Pose's four leading integers are varints; decode a scalar tuple to avoid
    // relying on repr(C) offsets in a Serde file.
    type PoseFields = (u32, u32, u32, u32, f32, f32, f32, f32);
    let original: PoseFields = postcard::from_bytes(&fields).unwrap();
    let bad = [
        (
            2, original.1, original.2, original.3, original.4, original.5, original.6, original.7,
        ),
        (
            0, original.1, original.2, original.3, original.4, original.5, original.6, original.7,
        ),
        (
            1,
            original.1,
            original.2,
            original.3,
            f32::NAN,
            original.5,
            original.6,
            original.7,
        ),
    ];
    for row in bad {
        fields = postcard::to_allocvec(&row).unwrap();
        let decoded: crate::engine::audio_poses::AudioPose = postcard::from_bytes(&fields).unwrap();
        assert!(!decoded.file_payload_valid());
    }
    let bytes = postcard::to_allocvec(&e.frame_buffers.frame_telemetry).unwrap();
    let values: Vec<f64> = postcard::from_bytes(&bytes).unwrap();
    assert!(values[34..37].iter().all(|v| v.is_nan()));
    for index in 0..values.len() {
        let mut bad = values.clone();
        bad[index] = if (34..37).contains(&index) {
            f64::INFINITY
        } else {
            f64::NAN
        };
        let bytes = postcard::to_allocvec(&bad).unwrap();
        let decoded: crate::engine::telemetry::frame_stats::FrameTelemetry =
            postcard::from_bytes(&bytes).unwrap();
        assert!(!decoded.file_payload_valid(), "telemetry index {index}");
    }
}
