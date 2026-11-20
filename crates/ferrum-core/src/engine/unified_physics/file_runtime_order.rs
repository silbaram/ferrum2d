use super::*;
use crate::engine::{
    file_candidate, file_engine_section, file_envelope, file_sharing, persistence,
};
use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

const SDK: u64 = 0xa991_8363_4818_fa73;

fn fixture() -> Engine {
    let mut e = Engine::new();
    e.use_data_scene();
    e.configure_unified_physics(WorldConfig {
        space: Space::PlanarXy,
        gravity: [0.; 3],
        ..WorldConfig::default()
    })
    .unwrap();
    for _ in 0..140 {
        e.world.spawn_entity();
    }
    for x in [0., 0.2, 0.4] {
        e.create_unified_body(
            BodyDesc {
                kind: crate::physics3d::BodyKind::Fixed,
                pose: Pose {
                    position: [x, 0., 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(crate::physics3d::Shape::Sphere { radius: 1. })
            },
            [123.25 + x, -456.75, 0.],
        )
        .unwrap();
    }
    e.tilemap.set_layer(
        0,
        9,
        1,
        10.,
        10.,
        30.,
        40.,
        true,
        vec![1, 0, 0, 0, 0, 0, 0, 0, 1],
    );
    e.set_collision_lifecycle_events_enabled(true);
    e.update(1. / 60.);
    assert_eq!(e.unified_physics_error(), None);
    e
}

fn wire(e: &Engine, memory: &[u8]) -> Vec<u8> {
    let (tables, _) = file_sharing::capture(
        e,
        file_sharing::Limits {
            max_work: 128 * 1024 * 1024,
            max_scratch_bytes: 64 * 1024 * 1024,
            max_roots: 64 * 1024 * 1024,
            max_compare_bytes: 128 * 1024 * 1024,
        },
    )
    .unwrap();
    let section = file_engine_section::encode(memory, &tables.arcs, &tables.shapes).unwrap();
    file_envelope::encode(
        &file_candidate::profile(SDK),
        &file_envelope::Sections {
            engine: &section,
            variables: b"{}",
            authoring: b"{}",
            resource_manifest: b"{}",
            resource_data: b"{}",
            dialogue_quest: b"{}",
            host_bindings: b"{}",
        },
        &file_envelope::Limits::default(),
    )
    .unwrap()
}

struct RawMap<'a, K, V>(Vec<(&'a K, &'a V)>);
impl<K: Serialize, V: Serialize> Serialize for RawMap<'_, K, V> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.0.len()))?;
        for (key, value) in &self.0 {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}

fn variants<K: Serialize + Ord, V: Serialize>(map: &BTreeMap<K, V>) -> (Vec<u8>, [Vec<u8>; 2]) {
    let entries: Vec<_> = map.iter().collect();
    assert!(entries.len() >= 2);
    let mut swapped = entries.clone();
    swapped.swap(0, 1);
    let mut duplicate = entries;
    duplicate.insert(1, duplicate[0]);
    (
        postcard::to_allocvec(map).unwrap(),
        [
            postcard::to_allocvec(&RawMap(swapped)).unwrap(),
            postcard::to_allocvec(&RawMap(duplicate)).unwrap(),
        ],
    )
}

fn replace(memory: &[u8], old: &[u8], new: &[u8]) -> Vec<u8> {
    let places: Vec<_> = memory[32..]
        .windows(old.len())
        .enumerate()
        .filter_map(|(at, bytes)| (bytes == old).then_some(at + 32))
        .collect();
    assert_eq!(
        places.len(),
        1,
        "fixture collection must have one actual Engine wire occurrence"
    );
    let at = places[0];
    let mut bytes = memory[..at].to_vec();
    bytes.extend_from_slice(new);
    bytes.extend_from_slice(&memory[at + old.len()..]);
    let mut crc = !0u32;
    for b in &bytes[32..] {
        crc ^= u32::from(*b);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & 0u32.wrapping_sub(crc & 1));
        }
    }
    let length = u32::try_from(bytes.len() - 32).unwrap();
    bytes[20..24].copy_from_slice(&length.to_le_bytes());
    bytes[24..28].copy_from_slice(&(!crc).to_le_bytes());
    bytes
}

#[test]
fn runtime_order_public_engine_fixture_and_six_tick_continuation() {
    let mut source = fixture();
    let memory = persistence::encode(&source).unwrap();
    let file = wire(&source, &memory);
    file_candidate::prepare(&file, SDK, &file_candidate::Limits::default()).unwrap();
    let mut restored = persistence::decode(&memory).unwrap();
    for _ in 0..6 {
        source.update(1. / 60.);
        restored.update(1. / 60.);
        assert_eq!(
            persistence::encode(&source).unwrap(),
            persistence::encode(&restored).unwrap()
        );
    }
}

#[test]
fn runtime_order_actual_engine_raw_maps_are_rejected_before_normalization() {
    let source = fixture();
    let memory = persistence::encode(&source).unwrap();
    let r = source.unified_physics.as_ref().unwrap();
    for (field, (normal, changed)) in [
        ("bindings", variants(&r.bindings)),
        ("entities_by_body", variants(&r.entities_by_body)),
        ("terrain.groups", variants(&r.terrain.groups)),
        ("terrain.registered", variants(&r.terrain.registered)),
        ("terrain.by_collider", variants(&r.terrain.by_collider)),
    ] {
        for (case, changed) in changed.iter().enumerate() {
            let bad = replace(&memory, &normal, changed);
            let before = bad.clone();
            assert!(
                matches!(
                    persistence::decode(&bad),
                    Err(crate::engine::RuntimeCheckpointError::InvalidState)
                ),
                "{field} case{case}"
            );
            let file = wire(&source, &bad);
            file_envelope::read(
                &file,
                &file_candidate::profile(SDK),
                &file_envelope::Limits::default(),
            )
            .unwrap();
            assert!(
                matches!(
                    file_candidate::prepare(&file, SDK, &file_candidate::Limits::default()),
                    Err(file_candidate::Error::EngineSection(_))
                ),
                "{field} case{case}"
            );
            assert_eq!(bad, before);
            assert_eq!(persistence::encode(&source).unwrap(), memory);
        }
    }
}
