use super::*;

fn profile() -> BuildProfile {
    BuildProfile {
        engine: 0x0102_0304_0506_0708,
        sdk: 0x1112_1314_1516_1718,
        word_bits: 32,
    }
}
fn sections() -> Sections<'static> {
    Sections {
        engine: b"E",
        variables: b"V",
        authoring: b"A",
        resource_manifest: b"R",
        resource_data: b"D",
        dialogue_quest: b"Q",
        host_bindings: b"H",
    }
}
fn reference() -> Vec<u8> {
    // Generated independently with Python struct.pack_into + zlib.crc32.
    include_bytes!("v1-reference.bin").to_vec()
}
fn header_crc(bytes: &mut [u8]) {
    let crc = header_checksum(&bytes[..64]);
    put_u32(bytes, 52, crc);
}
fn directory_crc(bytes: &mut [u8]) {
    let crc = checksum(&bytes[64..288]);
    put_u32(bytes, 48, crc);
    header_crc(bytes);
}

#[test]
fn native_file_container_matches_independent_wire_and_original_section_views() {
    assert_eq!(checksum(b"123456789"), 0xcbf4_3926);
    let bytes = encode(&profile(), &sections(), &Limits::default()).unwrap();
    assert_eq!(bytes, reference());
    let parsed = read(&bytes, &profile(), &Limits::default()).unwrap();
    assert_eq!(parsed.profile(), &profile());
    for (i, kind) in SECTIONS.into_iter().enumerate() {
        assert_eq!(parsed.section(kind), sections().slices()[i]);
        assert!(std::ptr::eq(
            parsed.section(kind).as_ptr(),
            bytes[288 + i..].as_ptr()
        ));
    }
    assert_eq!(
        bytes,
        reference(),
        "reader cannot normalize or mutate input"
    );
}

#[test]
fn native_file_container_every_truncated_prefix_and_appended_payload_are_rejected() {
    let good = reference();
    for end in 0..good.len() {
        assert!(
            read(&good[..end], &profile(), &Limits::default()).is_err(),
            "prefix {end}"
        );
    }
    let mut trailing = good.clone();
    trailing.push(0);
    put_u64(&mut trailing, 24, 296);
    header_crc(&mut trailing);
    assert_eq!(
        read(&trailing, &profile(), &Limits::default()).unwrap_err(),
        Error::InvalidDirectory
    );
    assert_eq!(good, reference());
}

#[test]
fn native_file_container_strict_header_profile_and_checksum_checks() {
    for (at, value, expected) in [
        (8, 2, Error::UnsupportedVersion),
        (12, 32, Error::InvalidHeader),
        (16, 1, Error::InvalidHeader),
        (20, 6, Error::InvalidHeader),
        (20, u32::MAX, Error::InvalidHeader),
        (56, 0, Error::IncompatibleProfile),
        (60, 1, Error::InvalidHeader),
    ] {
        let mut bytes = reference();
        put_u32(&mut bytes, at, value);
        header_crc(&mut bytes);
        assert_eq!(
            read(&bytes, &profile(), &Limits::default()).unwrap_err(),
            expected
        );
    }
    for at in [32, 40, 56] {
        let mut bytes = reference();
        bytes[at] ^= 1;
        header_crc(&mut bytes);
        assert_eq!(
            read(&bytes, &profile(), &Limits::default()).unwrap_err(),
            Error::IncompatibleProfile
        );
    }
    let mut bytes = reference();
    bytes[0] ^= 1;
    assert_eq!(
        read(&bytes, &profile(), &Limits::default()).unwrap_err(),
        Error::BadMagic
    );
    let mut bytes = reference();
    bytes[32] ^= 1;
    assert_eq!(
        read(&bytes, &profile(), &Limits::default()).unwrap_err(),
        Error::CorruptHeader
    );
    let mut bytes = reference();
    bytes[64 + 24] ^= 1;
    assert_eq!(
        read(&bytes, &profile(), &Limits::default()).unwrap_err(),
        Error::CorruptDirectory
    );
    for (i, kind) in SECTIONS.into_iter().enumerate() {
        let mut bytes = reference();
        bytes[288 + i] ^= 1;
        assert_eq!(
            read(&bytes, &profile(), &Limits::default()).unwrap_err(),
            Error::CorruptSection(kind)
        );
    }
}

#[test]
fn native_file_container_checks_real_directory_even_with_valid_crc() {
    for (i, kind) in SECTIONS.into_iter().enumerate() {
        for (field, value) in [(0, 99), (0, 0), (4, 1), (28, 1)] {
            let mut bytes = reference();
            put_u32(&mut bytes, 64 + i * 32 + field, value);
            directory_crc(&mut bytes);
            assert_eq!(
                read(&bytes, &profile(), &Limits::default()).unwrap_err(),
                Error::InvalidDirectory
            );
        }
        for (field, value) in [(8, 0), (8, 289 + i as u64), (8, u64::MAX), (16, u64::MAX)] {
            let mut bytes = reference();
            put_u64(&mut bytes, 64 + i * 32 + field, value);
            directory_crc(&mut bytes);
            assert!(read(&bytes, &profile(), &Limits::default()).is_err());
        }
        let mut bytes = reference();
        put_u64(&mut bytes, 64 + i * 32 + 16, 0);
        directory_crc(&mut bytes);
        assert_eq!(
            read(&bytes, &profile(), &Limits::default()).unwrap_err(),
            Error::SectionLength(kind)
        );
    }
    let mut duplicate = reference();
    put_u32(&mut duplicate, 96, 1);
    directory_crc(&mut duplicate);
    assert_eq!(
        read(&duplicate, &profile(), &Limits::default()).unwrap_err(),
        Error::InvalidDirectory
    );
    let mut missing = reference();
    missing.pop();
    put_u64(&mut missing, 24, 294);
    header_crc(&mut missing);
    assert_eq!(
        read(&missing, &profile(), &Limits::default()).unwrap_err(),
        Error::InvalidDirectory
    );
}

#[test]
fn native_file_container_exact_byte_work_and_section_limits_precede_content_scan() {
    let good = reference();
    let exact = Limits {
        max_file_bytes: 295,
        max_checksum_bytes: 295,
        max_section_bytes: [1; 7],
    };
    assert_eq!(encode(&profile(), &sections(), &exact).unwrap(), good);
    assert!(read(&good, &profile(), &exact).is_ok());
    let mut limits = exact.clone();
    limits.max_file_bytes -= 1;
    assert_eq!(
        read(&good, &profile(), &limits).unwrap_err(),
        Error::Capacity
    );
    assert_eq!(
        encode(&profile(), &sections(), &limits).unwrap_err(),
        Error::Capacity
    );
    let mut limits = exact.clone();
    limits.max_checksum_bytes -= 1;
    let mut corrupt = good.clone();
    corrupt[288] ^= 1;
    assert_eq!(
        read(&corrupt, &profile(), &limits).unwrap_err(),
        Error::ChecksumWorkLimit
    );
    assert_eq!(
        encode(&profile(), &sections(), &limits).unwrap_err(),
        Error::ChecksumWorkLimit
    );
    for i in 0..7 {
        let mut limits = exact.clone();
        limits.max_section_bytes[i] = 0;
        assert_eq!(
            read(&good, &profile(), &limits).unwrap_err(),
            Error::Capacity
        );
        assert_eq!(
            encode(&profile(), &sections(), &limits).unwrap_err(),
            Error::Capacity
        );
    }
    let mut omitted = sections();
    omitted.variables = b"";
    assert_eq!(
        encode(&profile(), &omitted, &Limits::default()).unwrap_err(),
        Error::SectionLength(SectionKind::Variables)
    );
    let limits = Limits {
        max_file_bytes: 257 * 1024 * 1024,
        ..Default::default()
    };
    assert_eq!(
        read(&good, &profile(), &limits).unwrap_err(),
        Error::InvalidLimits
    );
    assert_eq!(good, reference());
}

#[test]
fn native_file_container_transports_actual_engine_bytes_to_a_fresh_engine() {
    use crate::physics3d::{BodyDesc, ColliderDesc, Shape, Space, WorldConfig};
    use std::sync::Arc;
    for space in [Space::PlanarXy, Space::Spatial] {
        let mut source = super::super::Engine::new();
        source.use_data_scene();
        source
            .configure_unified_physics(WorldConfig {
                space,
                gravity: [0.; 3],
                step_seconds: 0.01,
                ..Default::default()
            })
            .unwrap();
        let actor = source
            .create_unified_body(
                BodyDesc {
                    can_sleep: false,
                    ..Default::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.2 }),
                [0.; 3],
            )
            .unwrap();
        source
            .set_unified_body_velocity(actor, [1., 0., 0.], [0.; 3])
            .unwrap();
        source.update(0.013);
        let native = super::super::persistence::encode(&source).unwrap();
        let native_profile = BuildProfile {
            engine: u64::from_le_bytes(native[12..20].try_into().unwrap()),
            sdk: profile().sdk,
            word_bits: usize::BITS,
        };
        let data = Sections {
            engine: &native,
            ..sections()
        };
        let wire = encode(&native_profile, &data, &Limits::default()).unwrap();
        let parsed = read(&wire, &native_profile, &Limits::default()).unwrap();
        // A positive trusted producer fixture exercises the real existing codec.
        // Placeholder SDK sections test framing only, not complete SDK import.
        let mut candidate =
            super::super::persistence::decode(parsed.section(SectionKind::Engine)).unwrap();
        assert!(!Arc::ptr_eq(
            &source.checkpoint_owner,
            &candidate.checkpoint_owner
        ));
        assert_eq!(
            super::super::persistence::encode(&candidate).unwrap(),
            native
        );
        for _ in 0..6 {
            source.update(0.007);
            candidate.update(0.007);
            assert_eq!(
                super::super::persistence::encode(&candidate).unwrap(),
                super::super::persistence::encode(&source).unwrap()
            );
        }
        assert_eq!(parsed.section(SectionKind::Variables), b"V");
    }
}
