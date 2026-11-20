//! Actual wire-only corruptions; never install, query or step malformed state.
use super::*;
use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};
use std::collections::{BTreeMap, BTreeSet};

struct RawMap<'a, K, V>(&'a [(&'a K, &'a V)]);
impl<K: Serialize, V: Serialize> Serialize for RawMap<'_, K, V> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in self.0 {
            m.serialize_entry(k, v)?;
        }
        m.end()
    }
}
struct RawSet<'a, K>(&'a [&'a K]);
impl<K: Serialize> Serialize for RawSet<'_, K> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut m = s.serialize_seq(Some(self.0.len()))?;
        for k in self.0 {
            m.serialize_element(k)?;
        }
        m.end()
    }
}
fn replace(packet: &[u8], old: &[u8], new: &[u8]) -> Vec<u8> {
    let locations: Vec<_> = packet[32..]
        .windows(old.len())
        .enumerate()
        .filter_map(|(i, v)| (v == old).then_some(i + 32))
        .collect();
    assert_eq!(
        locations.len(),
        1,
        "target serialized collection must be unique"
    );
    let start = locations[0];
    let mut out = packet[..start].to_vec();
    out.extend_from_slice(new);
    out.extend_from_slice(&packet[start + old.len()..]);
    let length = (out.len() - 32) as u32;
    out[20..24].copy_from_slice(&length.to_le_bytes());
    let mut crc = !0u32;
    for &v in &out[32..] {
        crc ^= u32::from(v);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
        }
    }
    out[24..28].copy_from_slice(&(!crc).to_le_bytes());
    out
}
pub(in crate::spatial_scene) fn map_packet<K: Ord + Serialize, V: Serialize>(
    packet: &[u8],
    values: &BTreeMap<K, V>,
    duplicate: bool,
) -> Vec<u8> {
    let old = crate::checkpoint_codec::encode(values).unwrap();
    let mut entries: Vec<_> = values.iter().collect();
    assert!(entries.len() >= 2);
    assert_eq!(
        &crate::checkpoint_codec::encode(&RawMap(&entries)).unwrap()[32..],
        &old[32..]
    );
    if duplicate {
        entries.insert(1, entries[0]);
    } else {
        entries.swap(0, 1);
    }
    let new = crate::checkpoint_codec::encode(&RawMap(&entries)).unwrap();
    replace(packet, &old[32..], &new[32..])
}
fn set_packet<K: Ord + Serialize>(packet: &[u8], values: &BTreeSet<K>, duplicate: bool) -> Vec<u8> {
    let old = crate::checkpoint_codec::encode(values).unwrap();
    let mut entries: Vec<_> = values.iter().collect();
    assert!(entries.len() >= 2);
    assert_eq!(
        &crate::checkpoint_codec::encode(&RawSet(&entries)).unwrap()[32..],
        &old[32..]
    );
    if duplicate {
        entries.insert(1, entries[0]);
    } else {
        entries.swap(0, 1);
    }
    let new = crate::checkpoint_codec::encode(&RawSet(&entries)).unwrap();
    replace(packet, &old[32..], &new[32..])
}
impl SpatialScene {
    pub(crate) fn file_collection_packet(
        &self,
        packet: &[u8],
        collection: usize,
        duplicate: bool,
    ) -> Vec<u8> {
        match collection {
            0 => set_packet(packet, &self.preview_hidden_entities, duplicate),
            1 => set_packet(packet, &self.preview_hidden_surfaces, duplicate),
            2 => map_packet(packet, &self.bindings, duplicate),
            3 => self.models.file_collection_packet(packet, duplicate),
            4 => self
                .models
                .streaming
                .file_collection_packet(packet, duplicate),
            5 => self.navigation.file_collection_packet(packet, duplicate),
            _ => unreachable!(),
        }
    }
}
