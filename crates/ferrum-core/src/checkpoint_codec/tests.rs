use super::*;
use serde::{Deserialize, Serialize};

mod fallible_sequences;

#[test]
fn engine_serialization_envelope_rejects_corruption_build_target_and_trailing_payload() {
    let bytes = encode(&vec![1u32, 7, 11]).unwrap();
    assert_eq!(decode::<Vec<u32>>(&bytes).unwrap(), [1, 7, 11]);
    for mode in 0..8 {
        let mut bad = bytes.clone();
        let expected = match mode {
            0 => {
                bad.truncate(10);
                RuntimeCheckpointError::InvalidEnvelope
            }
            1 => {
                bad[0] ^= 1;
                RuntimeCheckpointError::InvalidEnvelope
            }
            2 => {
                bad[8] ^= 1;
                RuntimeCheckpointError::IncompatibleBuild
            }
            3 => {
                bad[12] ^= 1;
                RuntimeCheckpointError::IncompatibleBuild
            }
            4 => {
                bad[28] ^= 1;
                RuntimeCheckpointError::IncompatibleBuild
            }
            5 => {
                bad[HEADER] ^= 1;
                RuntimeCheckpointError::Corrupt
            }
            6 => {
                bad.push(0);
                RuntimeCheckpointError::InvalidEnvelope
            }
            _ => {
                bad.push(0);
                let size = (bad.len() - HEADER) as u32;
                let crc = checksum(&bad[HEADER..]);
                bad[20..24].copy_from_slice(&size.to_le_bytes());
                bad[24..28].copy_from_slice(&crc.to_le_bytes());
                RuntimeCheckpointError::InvalidEnvelope
            }
        };
        assert_eq!(decode::<Vec<u32>>(&bad), Err(expected));
    }
}

#[test]
fn engine_serialization_budget_includes_header_and_rejects_one_byte_over() {
    let value = vec![17u32; 40];
    let bytes = encode(&value).unwrap();
    assert_eq!(encode_with_limit(&value, bytes.len()).unwrap(), bytes);
    assert_eq!(
        encode_with_limit(&value, bytes.len() - 1),
        Err(RuntimeCheckpointError::Capacity)
    );
    assert_eq!(
        encode_with_limit(&value, HEADER - 1),
        Err(RuntimeCheckpointError::Capacity)
    );
    assert_eq!(
        encode_with_limit(&value, MAX_BYTES + 1),
        Err(RuntimeCheckpointError::Capacity)
    );
}

#[derive(Serialize, Deserialize)]
struct Vector {
    #[serde(with = "super::vector")]
    values: Vec<u32>,
}

#[test]
fn engine_serialization_preserves_exact_vector_reservation_and_rejects_invalid_capacity() {
    let mut values = Vec::with_capacity(701);
    values.extend(0..600);
    let source = Vector { values };
    let bytes = encode(&source).unwrap();
    let restored: Vector = decode(&bytes).unwrap();
    assert_eq!(source.values, restored.values);
    assert_eq!(source.values.capacity(), restored.values.capacity());
    assert_eq!(encode(&restored).unwrap(), bytes);
    for capacity in [0usize, MAX_BYTES] {
        let malformed = encode(&(capacity, vec![3u32])).unwrap();
        assert!(matches!(
            decode::<Vector>(&malformed),
            Err(RuntimeCheckpointError::InvalidState)
        ));
    }
}

#[derive(Serialize, Deserialize)]
struct Map {
    #[serde(with = "super::map")]
    values: std::collections::HashMap<u32, u32>,
}

#[test]
fn engine_serialization_map_encoding_is_canonical_and_rejects_duplicate_keys() {
    let mut first = Map {
        values: std::collections::HashMap::with_capacity(16),
    };
    let mut second = Map {
        values: std::collections::HashMap::with_capacity(16),
    };
    for key in [7, 1, 20, 3] {
        first.values.insert(key, key * 2);
    }
    for key in [3, 20, 1, 7] {
        second.values.insert(key, key * 2);
    }
    let bytes = encode(&first).unwrap();
    assert_eq!(encode(&second).unwrap(), bytes);
    let copy: Map = decode(&bytes).unwrap();
    assert_eq!(copy.values, first.values);
    assert_eq!(encode(&copy).unwrap(), bytes);
    let malformed = encode(&(16usize, vec![(1u32, 2u32), (1, 3)])).unwrap();
    assert!(matches!(
        decode::<Map>(&malformed),
        Err(RuntimeCheckpointError::InvalidState)
    ));
}

#[test]
fn engine_serialization_public_sprite_sequence_deserialize_retains_private_count_invariant() {
    use crate::components::{SpriteAnimationFrameSequence, SpriteFrame};
    let sequence = SpriteAnimationFrameSequence::from_frames(&[SpriteFrame::FULL]).unwrap();
    let source = postcard::to_allocvec(&sequence).unwrap();
    for count in [0, 33] {
        let mut bad = source.clone();
        *bad.last_mut().unwrap() = count;
        assert!(postcard::from_bytes::<SpriteAnimationFrameSequence>(&bad).is_err());
    }
    assert_eq!(
        postcard::from_bytes::<SpriteAnimationFrameSequence>(&source).unwrap(),
        sequence
    );
}

#[test]
fn engine_serialization_public_tile_layer_rejects_mismatched_private_navigation_storage() {
    #[derive(Serialize)]
    struct Raw {
        columns: u32,
        rows: u32,
        width: f32,
        height: f32,
        x: f32,
        y: f32,
        collision: bool,
        #[serde(with = "super::vector")]
        tiles: Vec<u32>,
        #[serde(with = "super::vector")]
        navigation: Vec<u32>,
    }
    let mut raw = Raw {
        columns: 2,
        rows: 2,
        width: 1.,
        height: 1.,
        x: 0.,
        y: 0.,
        collision: true,
        tiles: vec![0; 4],
        navigation: vec![0; 4],
    };
    let value: crate::tilemap::TilemapLayer = decode(&encode(&raw).unwrap()).unwrap();
    assert_eq!(value.tiles.len(), 4);
    raw.navigation.pop();
    assert!(matches!(
        decode::<crate::tilemap::TilemapLayer>(&encode(&raw).unwrap()),
        Err(RuntimeCheckpointError::InvalidState)
    ));
}
