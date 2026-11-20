use super::*;
use crate::gameplay_variables::{GameplayVariableScope, GameplayVariableType};
use crate::physics3d::{BodyDesc, ColliderDesc, Pose, Shape, Space, WorldConfig};
use std::sync::Arc;

mod actual_native_ccd;
mod authoring_snapshot_integration;
mod builtin_integration;
mod controller_output_integration;
mod data_movement_integration;
mod runtime_payload_integration;
mod scratch_integration;
mod sharing_integration;
mod spatial_integration;
mod stored_owners_integration;

const SDK_BUILD: u64 = 0x1122_3344_5566_7788;
const UNIQUE_DEFAULT: f64 = 4_711_338.5;
const UNIQUE_OFFSET: [f32; 3] = [123.25, 456.5, 0.];

fn source(space: Space) -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    engine
        .configure_unified_physics(WorldConfig {
            space,
            gravity: [0.; 3],
            step_seconds: 0.01,
            ..Default::default()
        })
        .unwrap();
    let body = engine
        .create_unified_body(
            BodyDesc {
                pose: Pose {
                    position: [1., 2., 0.],
                    ..Default::default()
                },
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
            UNIQUE_OFFSET,
        )
        .unwrap();
    engine
        .set_unified_body_velocity(body, [0.125, 0.25, 0.], [0.; 3])
        .unwrap();
    assert!(engine.configure_gameplay_variable(7, 1, 0, UNIQUE_DEFAULT, 17.25));
    assert!(engine.configure_gameplay_variable(2, 0, 1, -3., -10.));
    assert!(engine.configure_gameplay_variable(64, 2, 1, 1., 0.));
    engine.update(0.013);
    engine
}

fn wire_section(section: &[u8]) -> Vec<u8> {
    framing::encode(
        &profile(SDK_BUILD),
        &framing::Sections {
            engine: section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &framing::Limits::default(),
    )
    .unwrap()
}

fn wire(engine: &Engine) -> Vec<u8> {
    wire_section(&capture_engine_section(engine, &Limits::default()).unwrap())
}

// Malformed memory remains exactly as supplied. Identity metadata comes from
// the original known source, never from decoding/repairing those damaged bytes.
fn wire_with_memory(engine: &Engine, memory: &[u8]) -> Vec<u8> {
    let limits = Limits::default();
    let (tables, _) = sharing::capture(
        engine,
        limits.sharing(
            limits.max_post_decode_work,
            limits.max_post_decode_scratch_bytes,
        ),
    )
    .unwrap();
    let section = engine_section::encode(memory, &tables.arcs, &tables.shapes).unwrap();
    wire_section(&section)
}

fn crc(bytes: &[u8]) -> u32 {
    let mut value = !0u32;
    for byte in bytes {
        value ^= u32::from(*byte);
        for _ in 0..8 {
            value = (value >> 1) ^ (0xedb8_8320 & 0u32.wrapping_sub(value & 1));
        }
    }
    !value
}

fn replace_unique(bytes: &mut [u8], original: &[u8], replacement: &[u8]) {
    assert_eq!(original.len(), replacement.len());
    let positions: Vec<_> = bytes
        .windows(original.len())
        .enumerate()
        .filter_map(|(index, value)| (value == original).then_some(index))
        .collect();
    assert_eq!(positions.len(), 1, "fixture marker must be unambiguous");
    let at = positions[0];
    bytes[at..at + replacement.len()].copy_from_slice(replacement);
    let checksum = crc(&bytes[32..]);
    bytes[24..28].copy_from_slice(&checksum.to_le_bytes());
}

#[test]
fn file_candidate_new_owner_actual_sparse_layout_and_trusted_continuation() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut source = source(space);
        let native = persistence::encode(&source).unwrap();
        let file = wire(&source);
        let original = file.clone();
        let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
        assert!(!Arc::ptr_eq(
            &source.checkpoint_owner,
            &candidate.engine.checkpoint_owner
        ));
        assert_eq!(persistence::encode(&source).unwrap(), native);
        assert_eq!(persistence::encode(&candidate.engine).unwrap(), native);
        let configured: Vec<_> = candidate.variable_layout().iter().flatten().collect();
        assert_eq!(
            configured.iter().map(|v| v.slot).collect::<Vec<_>>(),
            [2, 7, 64]
        );
        assert_eq!(configured[0].variable_type, GameplayVariableType::Integer);
        assert_eq!(configured[0].scope, GameplayVariableScope::Scene);
        assert_eq!(configured[1].default_value, UNIQUE_DEFAULT);
        assert_eq!(configured[2].variable_type, GameplayVariableType::Bool);
        assert_eq!(candidate.engine.gameplay_variable_value(7), 17.25);
        assert_eq!(candidate.engine.gameplay_variable_value(64), 0.);
        assert_eq!(
            candidate.sdk_section(framing::SectionKind::Variables),
            Ok(&b"{}"[..])
        );
        assert_eq!(
            candidate.sdk_section(framing::SectionKind::Engine),
            Err(Error::EngineSectionUnavailable)
        );
        // A trusted producer fixture can inspect the private Engine in this child
        // test. No such access/continuation API exists for candidate callers.
        for _ in 0..6 {
            source.update(0.007);
            candidate.engine.update(0.007);
            assert_eq!(
                persistence::encode(&source).unwrap(),
                persistence::encode(&candidate.engine).unwrap()
            );
        }
        assert_eq!(file, original);
    }
}

#[test]
fn file_candidate_valid_outer_and_engine_crcs_cannot_hide_bad_values_or_bindings() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let source = source(space);
        let original = persistence::encode(&source).unwrap();
        let mut bad_variable = original.clone();
        replace_unique(
            &mut bad_variable,
            &UNIQUE_DEFAULT.to_le_bytes(),
            &f64::NAN.to_le_bytes(),
        );
        let file = wire_with_memory(&source, &bad_variable);
        framing::read(&file, &profile(SDK_BUILD), &framing::Limits::default()).unwrap();
        let file_before = file.clone();
        assert_eq!(
            prepare(&file, SDK_BUILD, &Limits::default()).unwrap_err(),
            Error::Variables(variables::Error {
                slot: 7,
                field: variables::Field::Default,
                reason: variables::InvalidValue::NonFinite,
            })
        );
        assert_eq!(file, file_before);
        assert_eq!(persistence::encode(&source).unwrap(), original);

        let mut bad_binding = original.clone();
        let marker: Vec<_> = UNIQUE_OFFSET.iter().flat_map(|v| v.to_le_bytes()).collect();
        let mut replacement = marker.clone();
        replacement[..4].copy_from_slice(&f32::NAN.to_le_bytes());
        replace_unique(&mut bad_binding, &marker, &replacement);
        let file = wire_with_memory(&source, &bad_binding);
        framing::read(&file, &profile(SDK_BUILD), &framing::Limits::default()).unwrap();
        let file_before = file.clone();
        assert_eq!(
            prepare(&file, SDK_BUILD, &Limits::default()).unwrap_err(),
            Error::Bindings(bindings::Error::RenderOffset)
        );
        assert_eq!(file, file_before);
        assert_eq!(persistence::encode(&source).unwrap(), original);
        prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
    }
}

#[test]
fn file_candidate_profile_crc_and_decode_limits_precede_candidate_validation() {
    let source = source(Space::PlanarXy);
    let native = persistence::encode(&source).unwrap();
    let file = wire(&source);
    let original = file.clone();
    assert_eq!(
        prepare(&file, SDK_BUILD ^ 1, &Limits::default()).unwrap_err(),
        Error::Framing(framing::Error::IncompatibleProfile)
    );
    let mut corrupt = file.clone();
    corrupt[288 + 32] ^= 1;
    assert_eq!(
        prepare(&corrupt, SDK_BUILD, &Limits::default()).unwrap_err(),
        Error::Framing(framing::Error::CorruptSection(framing::SectionKind::Engine))
    );
    let mut incompatible = native.clone();
    incompatible[12] ^= 1;
    assert_eq!(
        prepare(
            &wire_with_memory(&source, &incompatible),
            SDK_BUILD,
            &Limits::default()
        )
        .unwrap_err(),
        // The nested memory codec rejects the build; Serde reports a typed
        // outer invalid state. This private file codec never accepts it.
        Error::EngineSection(engine_section::Error::Payload(
            RuntimeCheckpointError::InvalidState
        ))
    );
    let no_decode = Limits {
        decode: crate::checkpoint_decode::Limits {
            allocation_work: 0,
            ..Default::default()
        },
        ..Default::default()
    };
    assert_eq!(
        prepare(&file, SDK_BUILD, &no_decode).unwrap_err(),
        Error::EngineSection(engine_section::Error::Payload(
            RuntimeCheckpointError::Capacity
        ))
    );
    let no_entity = Limits {
        max_entity_slots: 0,
        ..Default::default()
    };
    assert_eq!(
        prepare(&file, SDK_BUILD, &no_entity).unwrap_err(),
        Error::World(world_payload::WorldPayloadAdmissionError::Storage(
            world_storage::WorldStorageAdmissionError::Limit(
                world_storage::WorldStorageAdmissionLimit::EntitySlots
            )
        ))
    );
    prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    assert_eq!(file, original);
    assert_eq!(persistence::encode(&source).unwrap(), native);
}

#[test]
fn file_candidate_explicit_aggregate_work_scratch_and_checksum_boundaries() {
    for space in [Space::PlanarXy, Space::Spatial] {
        let source = source(space);
        let native = persistence::encode(&source).unwrap();
        let file = wire(&source);
        let usage = prepare(&file, SDK_BUILD, &Limits::default())
            .unwrap()
            .usage();
        assert_eq!(usage.checksum_work_reserved, file.len() * 4);
        assert_eq!(
            usage.engine_section_bytes,
            capture_engine_section(&source, &Limits::default())
                .unwrap()
                .len()
        );
        let exact = Limits {
            max_checksum_work: usage.checksum_work_reserved,
            max_post_decode_work: usage.post_decode_work,
            max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes,
            ..Default::default()
        };
        assert_eq!(prepare(&file, SDK_BUILD, &exact).unwrap().usage(), usage);
        let checksum = Limits {
            max_checksum_work: usage.checksum_work_reserved - 1,
            ..exact.clone()
        };
        assert_eq!(
            prepare(&file, SDK_BUILD, &checksum).unwrap_err(),
            Error::ChecksumWork
        );
        let work = Limits {
            max_post_decode_work: usage.post_decode_work - 1,
            ..exact.clone()
        };
        assert!(matches!(
            prepare(&file, SDK_BUILD, &work).unwrap_err(),
            Error::NativeResources(native_resources::Error::WorkLimit)
        ));
        let scratch = Limits {
            max_post_decode_scratch_bytes: usage.post_decode_scratch_bytes - 1,
            ..exact
        };
        assert!(matches!(
            prepare(&file, SDK_BUILD, &scratch).unwrap_err(),
            Error::NativeResources(native_resources::Error::ScratchLimit)
        ));
        assert_eq!(persistence::encode(&source).unwrap(), native);
    }
}

#[test]
fn file_candidate_absolute_policies_cannot_be_disabled_by_caller_limits() {
    let bad_depth = Limits {
        decode: crate::checkpoint_decode::Limits {
            depth: 97,
            ..Default::default()
        },
        ..Default::default()
    };
    assert_eq!(
        prepare(b"bad", SDK_BUILD, &bad_depth).unwrap_err(),
        Error::InvalidLimits
    );
    let allocation = Limits {
        max_allocation_work: MAX_ALLOCATION_WORK - 1,
        ..Default::default()
    };
    assert_eq!(
        prepare(b"bad", SDK_BUILD, &allocation).unwrap_err(),
        Error::AllocationAllowance
    );
    let bad_work = Limits {
        max_post_decode_work: MAX_POST_DECODE_WORK + 1,
        ..Default::default()
    };
    assert_eq!(
        prepare(b"bad", SDK_BUILD, &bad_work).unwrap_err(),
        Error::InvalidLimits
    );
}

#[test]
fn file_candidate_does_not_claim_or_parse_remaining_sdk_payloads() {
    let source = source(Space::Spatial);
    let native = persistence::encode(&source).unwrap();
    let engine_section = capture_engine_section(&source, &Limits::default()).unwrap();
    let metadata = b"\xff unvalidated SDK bytes";
    let file = framing::encode(
        &profile(SDK_BUILD),
        &framing::Sections {
            engine: &engine_section,
            variables: metadata,
            authoring: metadata,
            resource_manifest: metadata,
            resource_data: metadata,
            dialogue_quest: metadata,
            host_bindings: metadata,
        },
        &framing::Limits::default(),
    )
    .unwrap();
    let candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    assert_eq!(
        candidate.sdk_section(framing::SectionKind::Authoring),
        Ok(&metadata[..])
    );
    assert!(format!("{candidate:?}").contains("unvalidated_sdk_sections: 6"));
    assert_eq!(persistence::encode(&source).unwrap(), native);
}

#[test]
fn file_candidate_world_payload_and_root_settings_are_required_before_return() {
    let mut source = source(Space::Spatial);
    let entity = source.world.spawn_entity();
    source.world.set_velocity(
        entity,
        crate::components::Velocity {
            vx: f32::NAN,
            vy: 0.,
        },
    );
    let bad_world = persistence::encode(&source).unwrap();
    let file = wire_with_memory(&source, &bad_world);
    assert!(matches!(
        prepare(&file, SDK_BUILD, &Limits::default()).unwrap_err(),
        Error::World(world_payload::WorldPayloadAdmissionError::Invalid { .. })
    ));
    assert_eq!(persistence::encode(&source).unwrap(), bad_world);
    source
        .world
        .set_velocity(entity, crate::components::Velocity { vx: 0., vy: 0. });
    source.elapsed_seconds = f64::NAN;
    let bad_root = persistence::encode(&source).unwrap();
    assert_eq!(
        prepare(
            &wire_with_memory(&source, &bad_root),
            SDK_BUILD,
            &Limits::default()
        )
        .unwrap_err(),
        Error::Root(root_settings::Error::Elapsed)
    );
    assert_eq!(persistence::encode(&source).unwrap(), bad_root);
}

#[test]
fn file_candidate_extreme_animation_producer_survives_decode_and_actual_engine_ticks() {
    let mut source = source(Space::PlanarXy);
    let template = crate::world::EntityTemplate::new(16., 16.).with_animation(2, f32::MAX);
    let entity = source
        .world
        .spawn_player_from_template(64., 64., 0, template);
    let native = persistence::encode(&source).unwrap();
    let file = wire(&source);
    let mut candidate = prepare(&file, SDK_BUILD, &Limits::default()).unwrap();
    assert_eq!(persistence::encode(&source).unwrap(), native);
    assert_eq!(persistence::encode(&candidate.engine).unwrap(), native);
    // The old advance loop does not terminate for this actual producer with an
    // ordinary positive tick. The fixed path permits the same constructor range.
    for _ in 0..6 {
        source.update(0.007);
        candidate.engine.update(0.007);
        assert_eq!(
            persistence::encode(&source).unwrap(),
            persistence::encode(&candidate.engine).unwrap()
        );
    }
    let sprite = source.world.sprite_at_index(entity.id as usize).unwrap();
    assert_eq!(sprite.u1 - sprite.u0, 0.5, "animation actually advanced");
}

#[test]
fn file_candidate_saved_output_overflow_cannot_bypass_connected_frame_admission() {
    let mut source = source(Space::PlanarXy);
    source.frame_buffers.animation_event_overflow = Some(usize::MAX);
    let memory = persistence::encode(&source).unwrap();
    let file = wire(&source);
    let before = file.clone();
    assert_eq!(
        prepare(&file, SDK_BUILD, &Limits::default()).unwrap_err(),
        Error::Frame(frame_output::Error::Invalid {
            field: "animation-overflow",
            index: usize::MAX,
        })
    );
    assert_eq!(file, before);
    assert_eq!(persistence::encode(&source).unwrap(), memory);
    source.frame_buffers.animation_event_overflow = None;
    prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
}

#[test]
fn file_candidate_all_five_presentation_owners_are_checked_before_return() {
    use crate::particles::ParticlePreset;
    use crate::tweens::{SpriteTint, TweenEasing};
    for owner in [
        presentation::Owner::Particles,
        presentation::Owner::Presets,
        presentation::Owner::Fonts,
        presentation::Owner::Tweens,
        presentation::Owner::ImpactCooldowns,
    ] {
        let mut source = source(Space::PlanarXy);
        let mut preset = ParticlePreset::new(u32::MAX);
        preset.burst_count = 1;
        source.particle_presets = vec![Some(preset)];
        assert_eq!(source.particles.spawn_burst(preset, 1., 2.), 1);
        assert!(source.register_bitmap_font(
            1,
            2,
            8.,
            u32::MAX,
            &[65],
            &[0., 0., 1., 1., 3., 4., 0., 0., 3.],
            &[],
            &[]
        ));
        let entity = source.world.spawn_enemy(0., 0., 1);
        assert!(source.tweens.flash_sprite_tint(
            &mut source.world,
            entity,
            SpriteTint::new(2., -1., 3., 1.),
            1.,
            TweenEasing::Linear
        ));
        prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
        match owner {
            presentation::Owner::Particles => source.particles.corrupt_file_fixture(),
            presentation::Owner::Presets => {
                source.particle_presets[0].as_mut().unwrap().damping = f32::NAN
            }
            presentation::Owner::Fonts => source.bitmap_text.corrupt_file_fixture(),
            presentation::Owner::Tweens => source.tweens.corrupt_file_fixture(),
            presentation::Owner::ImpactCooldowns => source.impact_feedback.corrupt_file_fixture(),
            _ => unreachable!("explicit owner cases"),
        }
        let memory = persistence::encode(&source).unwrap();
        let file = wire(&source);
        let before = file.clone();
        assert!(
            matches!(prepare(&file, SDK_BUILD, &Limits::default()),
            Err(Error::Presentation(presentation::Error::Invalid { owner: rejected, .. }))
                if owner == rejected),
            "{owner:?}"
        );
        assert_eq!(file, before);
        assert_eq!(persistence::encode(&source).unwrap(), memory);
    }
}

#[test]
fn file_candidate_tilemap_guard_rejects_valid_crc_without_rebuilding_cached_history() {
    const WIDTH: f32 = 27_113.25;
    const COLOR: f32 = 0.683_915;
    let mut source = Engine::new();
    source.set_shooter_tile(1, 2, 0., 0., 1., 1., COLOR, 0.5, 0.25, 1.);
    source.set_shooter_tilemap_layer(0, 2, 1, WIDTH, 1., 0., 0., true, vec![0, 0]);
    assert!(source.query_tilemap_navigation_path(0., 0., WIDTH, 0.));
    let memory = persistence::encode(&source).unwrap();
    prepare(&wire(&source), SDK_BUILD, &Limits::default()).unwrap();
    let mut bad = memory.clone();
    // Layer dimensions are already checked by their Deserialize owner. A raw
    // definition color reaches the new post-decode guard without that shortcut.
    replace_unique(&mut bad, &COLOR.to_le_bytes(), &f32::NAN.to_le_bytes());
    let file = wire_with_memory(&source, &bad);
    let before = file.clone();
    assert!(matches!(
        prepare(&file, SDK_BUILD, &Limits::default()),
        Err(Error::Tilemap(tilemap::Error::Invalid {
            field: crate::tilemap::file_admission::Field::Definitions,
            index: 1,
            problem: crate::tilemap::file_admission::Problem::Range,
        }))
    ));
    assert_eq!(file, before);
    assert_eq!(persistence::encode(&source).unwrap(), memory);
}
