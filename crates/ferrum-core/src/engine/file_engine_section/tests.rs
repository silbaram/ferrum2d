use super::*;

type Tables = Decoded<Vec<u32>, Vec<u32>>;
fn source() -> Engine {
    let mut engine = Engine::new();
    engine.use_data_scene();
    assert!(engine.configure_gameplay_variable(7, 1, 0, 1.25, 2.75));
    engine.update(0.017);
    engine
}

#[test]
fn file_engine_section_versioned_codec_keeps_memory_wire_and_owned_tables() {
    let mut engine = source();
    let memory = persistence::encode(&engine).unwrap();
    let bytes = encode(&memory, &vec![0u32, 0, 2], &vec![0u32, 1]).unwrap();
    let original = bytes.clone();
    let mut decoded: Tables = decode(&bytes, Default::default()).unwrap();
    assert_eq!(decoded.arcs, [0, 0, 2]);
    assert_eq!(decoded.shapes, [0, 1]);
    assert_eq!(persistence::encode(&decoded.engine).unwrap(), memory);
    assert_eq!(persistence::encode(&engine).unwrap(), memory);
    for _ in 0..6 {
        engine.update(0.013);
        decoded.engine.update(0.013);
        assert_eq!(
            persistence::encode(&engine).unwrap(),
            persistence::encode(&decoded.engine).unwrap()
        );
    }
    assert_eq!(bytes, original);
}

#[test]
fn file_engine_section_engine_and_both_tables_share_one_decode_allowance() {
    let engine = source();
    let memory = persistence::encode(&engine).unwrap();
    let empty = encode(&memory, &Vec::<u32>::new(), &Vec::<u32>::new()).unwrap();
    let (_, baseline) =
        decode_with_usage::<Vec<u32>, Vec<u32>>(&empty, Default::default()).unwrap();
    let full = encode(&memory, &vec![0u32; 4096], &vec![0u32; 4096]).unwrap();
    let (_, usage) = decode_with_usage::<Vec<u32>, Vec<u32>>(&full, Default::default()).unwrap();
    assert!(usage.allocation_work > baseline.allocation_work);
    let insufficient = crate::checkpoint_decode::Limits {
        allocation_work: baseline.allocation_work + 1,
        ..Default::default()
    };
    assert!(matches!(
        decode::<Vec<u32>, Vec<u32>>(&full, insufficient),
        Err(Error::Payload(RuntimeCheckpointError::Capacity))
    ));
    let exact = crate::checkpoint_decode::Limits {
        allocation_work: usage.allocation_work,
        ..Default::default()
    };
    let (_, repeated) = decode_with_usage::<Vec<u32>, Vec<u32>>(&full, exact).unwrap();
    assert_eq!(usage, repeated);
    let below = crate::checkpoint_decode::Limits {
        allocation_work: usage.allocation_work - 1,
        ..exact
    };
    assert!(matches!(
        decode::<Vec<u32>, Vec<u32>>(&full, below),
        Err(Error::Payload(RuntimeCheckpointError::Capacity))
    ));
    decode::<Vec<u32>, Vec<u32>>(&full, Default::default()).unwrap();
    assert_eq!(persistence::encode(&engine).unwrap(), memory);
}

#[test]
fn file_engine_section_rejects_prefix_version_body_corruption_and_trailing_bytes() {
    let memory = persistence::encode(&source()).unwrap();
    let bytes = encode(&memory, &Vec::<u32>::new(), &Vec::<u32>::new()).unwrap();
    for n in 0..PREFIX {
        assert!(matches!(
            decode::<Vec<u32>, Vec<u32>>(&bytes[..n], Default::default()),
            Err(Error::InvalidPrefix)
        ));
    }
    let mut version = bytes.clone();
    version[8] = 2;
    assert!(matches!(
        decode::<Vec<u32>, Vec<u32>>(&version, Default::default()),
        Err(Error::UnsupportedVersion)
    ));
    let mut reserved = bytes.clone();
    reserved[12] = 1;
    assert!(matches!(
        decode::<Vec<u32>, Vec<u32>>(&reserved, Default::default()),
        Err(Error::InvalidPrefix)
    ));
    let mut corrupt = bytes.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    assert!(matches!(
        decode::<Vec<u32>, Vec<u32>>(&corrupt, Default::default()),
        Err(Error::Payload(RuntimeCheckpointError::Corrupt))
    ));
    let mut trailing = bytes.clone();
    trailing.push(0);
    assert!(matches!(
        decode::<Vec<u32>, Vec<u32>>(&trailing, Default::default()),
        Err(Error::Payload(RuntimeCheckpointError::InvalidEnvelope))
    ));
    assert!(matches!(
        decode::<Vec<u32>, Vec<u32>>(&memory, Default::default()),
        Err(Error::InvalidPrefix)
    ));
}

#[test]
fn file_engine_section_nested_decoder_cannot_start_a_new_default_budget() {
    let engine = source();
    let memory = persistence::encode(&engine).unwrap();
    assert!(matches!(
        persistence::decode_in_scope(&memory),
        Err(RuntimeCheckpointError::InvalidState)
    ));
    let file = encode(&memory, &Vec::<u32>::new(), &Vec::<u32>::new()).unwrap();
    let too_small = crate::checkpoint_decode::Limits {
        allocation_work: 0,
        ..Default::default()
    };
    assert!(matches!(
        decode::<Vec<u32>, Vec<u32>>(&file, too_small),
        Err(Error::Payload(RuntimeCheckpointError::Capacity))
    ));
    decode::<Vec<u32>, Vec<u32>>(&file, Default::default()).unwrap();
}
