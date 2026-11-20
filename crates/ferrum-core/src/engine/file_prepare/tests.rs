use super::*;
use crate::engine::{file_engine_section, file_sharing, persistence};
use crate::physics3d::{BodyDesc, ColliderDesc, Shape, Space, WorldConfig};
const SDK: u64 = 0x1122_3344_5566_7788;
const DEFAULT: f64 = 4_711_338.5;
fn source() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    assert!(e.configure_gameplay_variable(7, 1, 0, DEFAULT, 17.25));
    e.configure_unified_physics(WorldConfig {
        space: Space::Spatial,
        gravity: [0.; 3],
        step_seconds: 0.01,
        ..Default::default()
    })
    .unwrap();
    let body = e
        .create_unified_body(
            BodyDesc {
                can_sleep: false,
                ..Default::default()
            },
            ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
            [0.; 3],
        )
        .unwrap();
    e.set_unified_body_velocity(body, [0.25, 0.125, 0.], [0.; 3])
        .unwrap();
    let old = e.world.spawn_enemy(10., 0., 55);
    e.world.clear_movement_pattern(old);
    e.world.despawn(old);
    let reused = e.world.spawn_enemy(20., 0., 77);
    e.world.clear_movement_pattern(reused);
    assert_eq!(old.id, reused.id);
    assert_ne!(old.generation, reused.generation);
    e.update(0.013);
    e
}
fn file(e: &Engine) -> Vec<u8> {
    capture(e, b"{}{}{}{}{}{}", &[2; 6], SDK, &Limits::default()).unwrap()
}
fn prepared(e: &Engine, target: &Engine) -> NativeFilePrepare {
    NativeFilePrepare::prepare_owned(target, file(e), SDK, Limits::default()).unwrap()
}
fn word(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().unwrap())
}
fn directory(b: &[u8], kind: usize) -> (usize, usize, usize) {
    let at = 16 + (kind - 1) * 16;
    assert_eq!(word(b, at), kind as u32);
    (
        word(b, at + 4) as usize,
        word(b, at + 8) as usize,
        word(b, at + 12) as usize,
    )
}
#[test]
fn native_file_prepare_owned_pointer_and_checked_sections_preserve_original_file() {
    let source = source();
    let target = Engine::new();
    let bytes = file(&source);
    let pointer = bytes.as_ptr();
    let capacity = bytes.capacity();
    let expected = bytes.clone();
    let mut p = NativeFilePrepare::prepare_owned(&target, bytes, SDK, Limits::default()).unwrap();
    assert_eq!(p.file.as_ptr(), pointer);
    assert_eq!(p.file.capacity(), capacity);
    assert_eq!(p.file, expected);
    for kind in 2..=7 {
        assert_eq!(p.sdk_section_bytes(kind).unwrap(), b"{}");
        assert_eq!(p.section_native(kind).unwrap(), b"{}");
    }
    assert_eq!(p.sdk_section_bytes(1).unwrap_err(), Error::Section);
    assert_eq!(p.section_native(8).unwrap_err(), Error::Section);
    assert_eq!(p.file, expected);
}
#[test]
fn native_file_prepare_packet_actual_facts_default_bits_and_cumulative_usage() {
    let source = source();
    let before = persistence::encode(&source).unwrap();
    let target = Engine::new();
    let mut p = prepared(&source, &target);
    let packet = p.metadata_native().unwrap();
    assert_eq!(word(&packet, 0), 0x3150_464e);
    assert_eq!(word(&packet, 4), 1);
    assert_eq!(word(&packet, 8) as usize, packet.len());
    assert_eq!(word(&packet, 12), 14);
    let (stride, count, at) = directory(&packet, 2);
    assert_eq!((stride, count), (20, 1));
    assert_eq!(word(&packet, at), 7);
    assert_eq!(
        u64::from_le_bytes(packet[at + 12..at + 20].try_into().unwrap()),
        DEFAULT.to_bits()
    );
    let (stride, count, at) = directory(&packet, 3);
    assert_eq!(stride, 8);
    assert_eq!(count, p.parts.native_roster.slots.len());
    for (i, s) in p.parts.native_roster.slots.iter().enumerate() {
        assert_eq!(word(&packet, at + i * stride), s.generation);
        assert_eq!(word(&packet, at + i * stride + 4), u32::from(s.alive));
    }
    let (stride, count, at) = directory(&packet, 13);
    assert_eq!(stride, 68);
    assert_eq!(count, p.parts.native_resources.references.len());
    assert!(count > 0);
    assert!(packet[at..at + stride * count]
        .chunks_exact(stride)
        .any(|row| word(row, 52) == 77));
    let (stride, count, at) = directory(&packet, 14);
    assert_eq!((stride, count), (136, 1));
    assert_eq!(
        u64::from_le_bytes(packet[at + 9 * 8..at + 10 * 8].try_into().unwrap()),
        p.output.work
    );
    let first = p.output;
    let _ = p.metadata_native().unwrap();
    assert!(p.output.work > first.work && p.output.scratch > first.scratch);
    assert_eq!(persistence::encode(&source).unwrap(), before);
}
#[test]
fn native_file_prepare_foreign_and_second_install_are_atomic_and_six_tick_continuation_exact() {
    let mut source = source();
    let mut target = Engine::new();
    let mut foreign = Engine::new();
    let mut p = prepared(&source, &target);
    let before = persistence::encode(&foreign).unwrap();
    let usage = p.output;
    assert_eq!(foreign.install_native_file_prepare(&mut p), 10);
    assert_eq!(p.output, usage);
    assert!(!p.installed);
    assert_eq!(persistence::encode(&foreign).unwrap(), before);
    assert_eq!(target.install_native_file_prepare(&mut p), 0);
    assert!(p.parts.engine.is_none());
    assert!(p.is_consumed());
    assert_eq!(
        target.runtime_checkpoint_revision(),
        source.runtime_checkpoint_revision()
    );
    let before = persistence::encode(&target).unwrap();
    assert_eq!(target.install_native_file_prepare(&mut p), 9);
    assert_eq!(persistence::encode(&target).unwrap(), before);
    assert_eq!(p.sdk_section_bytes(2).unwrap_err(), Error::Consumed);
    for _ in 0..6 {
        source.update(0.013);
        target.update(0.013);
        assert_eq!(
            persistence::encode(&target).unwrap(),
            persistence::encode(&source).unwrap()
        );
    }
}
#[test]
fn native_file_prepare_target_revision_change_rejects_without_consuming() {
    let source = source();
    let mut target = Engine::new();
    let mut p = prepared(&source, &target);
    let cp = target.runtime_checkpoint().unwrap();
    target.restore_runtime_checkpoint_native(&cp).unwrap();
    let before = persistence::encode(&target).unwrap();
    assert_eq!(target.install_native_file_prepare(&mut p), 11);
    assert!(!p.installed);
    assert!(p.parts.engine.is_some());
    assert_eq!(persistence::encode(&target).unwrap(), before);
}
#[test]
fn native_file_prepare_copyout_exact_and_one_below_share_work_and_scratch() {
    let source = source();
    let target = Engine::new();
    let p = prepared(&source, &target);
    let bytes = p.plan.bytes;
    let native_work = p.parts.usage.post_decode_work;
    let native_scratch = p.parts.usage.post_decode_scratch_bytes;
    let mut exact = Limits::default();
    exact.native.max_post_decode_work = native_work + 78 + 1 + bytes as u64;
    exact.native.max_post_decode_scratch_bytes = native_scratch + bytes;
    let mut p =
        NativeFilePrepare::prepare_owned(&target, file(&source), SDK, exact.clone()).unwrap();
    assert_eq!(p.metadata_native().unwrap().len(), bytes);
    assert_eq!(p.metadata_native().unwrap_err(), Error::Work);
    exact.native.max_post_decode_work -= 1;
    let mut p = NativeFilePrepare::prepare_owned(&target, file(&source), SDK, exact).unwrap();
    assert_eq!(p.metadata_native().unwrap_err(), Error::Work);
    assert_eq!(p.output.work, 79);
    assert_eq!(p.output.scratch, 0);
    let mut below = Limits::default();
    below.native.max_post_decode_scratch_bytes = native_scratch + bytes - 1;
    let mut p = NativeFilePrepare::prepare_owned(&target, file(&source), SDK, below).unwrap();
    let file = p.file.clone();
    assert_eq!(p.metadata_native().unwrap_err(), Error::Scratch);
    let work = p.output.work;
    assert_eq!(p.metadata_native().unwrap_err(), Error::Scratch);
    assert!(p.output.work > work);
    assert_eq!(p.file, file);
}
#[test]
fn native_file_prepare_output_and_packet_limits_are_cumulative_and_strict() {
    let source = source();
    let target = Engine::new();
    let p = prepared(&source, &target);
    let bytes = p.plan.bytes;
    let limits = Limits {
        max_output_bytes: bytes,
        ..Default::default()
    };
    let mut p = NativeFilePrepare::prepare_owned(&target, file(&source), SDK, limits).unwrap();
    assert_eq!(p.metadata_native().unwrap().len(), bytes);
    assert_eq!(p.metadata_native().unwrap_err(), Error::Output);
    let limits = Limits {
        max_metadata_bytes: bytes - 1,
        ..Default::default()
    };
    assert_eq!(
        NativeFilePrepare::prepare_owned(&target, file(&source), SDK, limits).unwrap_err(),
        Error::Output
    );
    let mut words = Limits::default().words();
    for index in 1..27 {
        let original = words[index];
        words[index] = original + 1;
        assert!(matches!(Limits::parse(&words), Err(Error::InvalidLimits)));
        words[index] = original;
    }
    assert!(Limits::parse(&[]).is_ok());
    assert!(Limits::parse(&[1]).is_err());
}
#[test]
fn native_file_prepare_capture_boundaries_profile_and_original_bytes() {
    let source = source();
    let before = persistence::encode(&source).unwrap();
    let bytes = file(&source);
    let mut limits = Limits {
        max_output_bytes: bytes.len(),
        ..Default::default()
    };
    assert_eq!(
        capture(&source, b"{}{}{}{}{}{}", &[2; 6], SDK, &limits).unwrap(),
        bytes
    );
    limits.max_output_bytes -= 1;
    assert_eq!(
        capture(&source, b"{}{}{}{}{}{}", &[2; 6], SDK, &limits).unwrap_err(),
        Error::Output
    );
    assert_eq!(
        capture(&source, b"{}", &[2; 5], SDK, &Limits::default()).unwrap_err(),
        Error::Section
    );
    let mut checksum_limit = Limits::default();
    checksum_limit.native.max_checksum_work = bytes.len() * 4 - 1;
    assert_eq!(
        capture(&source, b"{}{}{}{}{}{}", &[2; 6], SDK, &checksum_limit).unwrap_err(),
        Error::Capture(candidate::Error::ChecksumWork)
    );
    let target = Engine::new();
    assert!(matches!(
        NativeFilePrepare::prepare_owned(&target, bytes, SDK + 1, Limits::default()),
        Err(Error::Admission(candidate::Error::Framing(
            framing::Error::IncompatibleProfile
        )))
    ));
    assert_eq!(persistence::encode(&source).unwrap(), before);
}
fn crc(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}
#[test]
fn native_file_prepare_actual_valid_crc_numeric_damage_rejects_without_target_or_source_changes() {
    let source = source();
    let mut memory = persistence::encode(&source).unwrap();
    let marker = DEFAULT.to_le_bytes();
    let matches: Vec<_> = memory
        .windows(8)
        .enumerate()
        .filter_map(|(i, v)| (v == marker).then_some(i))
        .collect();
    assert_eq!(matches.len(), 1);
    memory[matches[0]..matches[0] + 8].copy_from_slice(&f64::INFINITY.to_le_bytes());
    let checksum = crc(&memory[32..]);
    memory[24..28].copy_from_slice(&checksum.to_le_bytes());
    let (tables, _) = file_sharing::capture(
        &source,
        file_sharing::Limits {
            max_work: 128 * 1024 * 1024,
            max_scratch_bytes: 64 * 1024 * 1024,
            max_roots: 64 * 1024 * 1024,
            max_compare_bytes: 128 * 1024 * 1024,
        },
    )
    .unwrap();
    let engine = file_engine_section::encode(&memory, &tables.arcs, &tables.shapes).unwrap();
    let bytes = framing::encode(
        &candidate::profile(SDK),
        &framing::Sections {
            engine: &engine,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &framing::Limits::default(),
    )
    .unwrap();
    assert!(framing::read(
        &bytes,
        &candidate::profile(SDK),
        &framing::Limits::default()
    )
    .is_ok());
    let original = bytes.clone();
    let target = Engine::new();
    let before = persistence::encode(&target).unwrap();
    let source_before = persistence::encode(&source).unwrap();
    assert!(matches!(
        NativeFilePrepare::prepare_owned(&target, bytes, SDK, Limits::default()),
        Err(Error::Admission(_))
    ));
    assert_eq!(persistence::encode(&target).unwrap(), before);
    assert_eq!(persistence::encode(&source).unwrap(), source_before);
    assert!(original.len() > 288);
}

#[test]
fn native_file_prepare_install_keeps_saved_max_revision_and_new_owner_invalidates_placeholder_capabilities(
) {
    let mut source = source();
    source.checkpoint_revision = u32::MAX;
    let source_cp = source.runtime_checkpoint().unwrap();
    let mut target = Engine::new();
    let placeholder_cp = target.runtime_checkpoint().unwrap();
    let mut first = prepared(&source, &target);
    let mut other = prepared(&source, &target);
    assert_eq!(target.install_native_file_prepare(&mut first), 0);
    assert_eq!(target.runtime_checkpoint_revision(), u32::MAX);
    assert_eq!(
        persistence::encode(&target).unwrap(),
        persistence::encode(&source).unwrap()
    );
    assert!(matches!(
        target.restore_runtime_checkpoint_native(&placeholder_cp),
        Err(super::super::RuntimeCheckpointError::WrongEngine)
    ));
    assert!(matches!(
        target.restore_runtime_checkpoint_native(&source_cp),
        Err(super::super::RuntimeCheckpointError::WrongEngine)
    ));
    assert_eq!(target.install_native_file_prepare(&mut other), 10);
    assert!(!other.installed);
    let own = target.runtime_checkpoint().unwrap();
    assert!(matches!(
        target.restore_runtime_checkpoint_native(&own),
        Err(super::super::RuntimeCheckpointError::RevisionExhausted)
    ));
}

#[test]
fn native_file_prepare_repack_preserves_retained_engine_bytes_and_shares_cumulative_quota() {
    let source = source();
    let mut target = Engine::new();
    let mut p = prepared(&source, &target);
    let original = p.file.clone();
    let source_before = persistence::encode(&source).unwrap();
    let output = p
        .repack_native(b"[11][22][33][44][55][66]", &[4; 6])
        .unwrap();
    let before = framing::read(
        &original,
        &candidate::profile(SDK),
        &framing::Limits::default(),
    )
    .unwrap();
    let after = framing::read(
        &output,
        &candidate::profile(SDK),
        &framing::Limits::default(),
    )
    .unwrap();
    assert_eq!(
        before.section(framing::SectionKind::Engine),
        after.section(framing::SectionKind::Engine)
    );
    assert_eq!(after.section(framing::SectionKind::Variables), b"[11]");
    let other = Engine::new();
    let q = NativeFilePrepare::prepare_owned(&other, output, SDK, Limits::default()).unwrap();
    assert_eq!(p.parts.native_roster, q.parts.native_roster);
    assert_eq!(p.parts.native_resources, q.parts.native_resources);
    assert_eq!(p.file, original);
    let charged = p.output;
    assert_eq!(p.repack_native(b"{}", &[2; 5]).unwrap_err(), Error::Section);
    assert!(p.output.work > charged.work);
    let remaining = p.limits.max_output_bytes - p.output.bytes;
    p.limits.max_output_bytes = p.output.bytes + original.len() - 1;
    assert_eq!(
        p.repack_native(b"{}{}{}{}{}{}", &[2; 6]).unwrap_err(),
        Error::Output
    );
    assert!(remaining > 0);
    assert_eq!(target.install_native_file_prepare(&mut p), 0);
    assert_eq!(
        p.repack_native(b"{}{}{}{}{}{}", &[2; 6]).unwrap_err(),
        Error::Consumed
    );
    assert_eq!(persistence::encode(&source).unwrap(), source_before);
}

#[test]
fn native_file_prepare_context_current_scalars_match_real_platform_and_builtin_producers() {
    let mut source = Engine::new();
    source.use_data_scene();
    assert!(source.configure_spatial_camera(&[
        0., 48., 120., 120., 48., 16., -32., 240., 0.1, 1000., 800., 480.
    ]));
    assert!(source.configure_spatial_terrain(
        &[
            0., 0., 32., 64., 0., 0., 0., 1., 1., 1., 1., 32., 0., 32., 64., 0., 16., 16., 1., 1.,
            1., 1.
        ],
        &[1, 0, 16777215, 1, 2, 0, 16777215, 3]
    ));
    assert!(source.configure_spatial_moving_platforms(&[2., 1., 0., 0., 4., 1., 0.25, 0.]));
    source.update_frame(0.01, false, false, false);
    assert_ne!(
        source.spatial_terrain_revision(),
        source.spatial_configuration_revision()
    );
    for builtin in [false, true] {
        if builtin {
            source.use_breakout_scene();
            assert_ne!(source.data_scene.epoch, source.data_scene_epoch());
            assert_eq!(source.data_scene_epoch(), 0);
        }
        let before = persistence::encode(&source).unwrap();
        let target = Engine::new();
        let mut p = prepared(&source, &target);
        let packet = p.metadata_native().unwrap();
        let (stride, count, at) = directory(&packet, 1);
        assert_eq!((stride, count), (20, 1));
        assert_eq!(word(&packet, at), u32::from(!builtin));
        assert_eq!(word(&packet, at + 4), source.data_scene.epoch);
        assert_eq!(word(&packet, at + 8), source.spatial_terrain_revision());
        assert_eq!(
            word(&packet, at + 12),
            source.spatial_configuration_revision()
        );
        assert_eq!(word(&packet, at + 16), source.data_scene_epoch());
        assert_eq!(persistence::encode(&source).unwrap(), before);
    }
}
