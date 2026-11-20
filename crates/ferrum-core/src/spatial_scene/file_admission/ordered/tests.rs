use super::*;
use crate::{checkpoint_codec as codec, checkpoint_decode};
use serde::ser::SerializeMap;
use serde::{Serialize, Serializer};

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Strict {
    #[serde(deserialize_with = "super::map")]
    map: BTreeMap<(i32, i32), u32>,
    #[serde(deserialize_with = "super::set")]
    set: BTreeSet<(u32, u32)>,
}
#[derive(Serialize)]
struct Plain<'a> {
    map: &'a BTreeMap<(i32, i32), u32>,
    set: &'a BTreeSet<(u32, u32)>,
}
fn sparse() -> Strict {
    Strict {
        map: [
            ((-101, i32::MAX), 17),
            ((0, -33), 23),
            ((i32::MAX, i32::MIN), 29),
        ]
        .into_iter()
        .collect(),
        set: [(137, 7), (281, u32::MAX)].into_iter().collect(),
    }
}
#[test]
fn file_spatial_ordered_normal_empty_single_sparse_keep_standard_serialize_bytes() {
    for value in [
        Strict {
            map: BTreeMap::new(),
            set: BTreeSet::new(),
        },
        Strict {
            map: [((-1, 7), 5)].into_iter().collect(),
            set: [(3, 2)].into_iter().collect(),
        },
        sparse(),
    ] {
        let normal = codec::encode(&Plain {
            map: &value.map,
            set: &value.set,
        })
        .unwrap();
        assert_eq!(codec::encode(&value).unwrap(), normal);
        let decoded: Strict = codec::decode(&normal).unwrap();
        assert_eq!(decoded, value);
        assert_eq!(codec::encode(&decoded).unwrap(), normal);
    }
}
#[test]
fn file_spatial_ordered_map_and_set_inherit_one_cumulative_decode_quota() {
    let source = codec::encode(&(sparse(), sparse())).unwrap();
    let limits = checkpoint_decode::Limits::default();
    let (decoded, usage) = codec::decode_with_usage::<(Strict, Strict)>(&source, limits).unwrap();
    assert_eq!(codec::encode(&decoded).unwrap(), source);
    let exact = checkpoint_decode::Limits {
        allocation_work: usage.allocation_work,
        values: usage.values,
        depth: usage.peak_depth,
        ..limits
    };
    let (_, repeated) = codec::decode_with_usage::<(Strict, Strict)>(&source, exact).unwrap();
    assert_eq!(repeated, usage);
    for quota in [
        checkpoint_decode::Limits {
            values: usage.values - 1,
            ..exact
        },
        checkpoint_decode::Limits {
            allocation_work: usage.allocation_work - 1,
            ..exact
        },
        checkpoint_decode::Limits {
            depth: usage.peak_depth - 1,
            ..exact
        },
        checkpoint_decode::Limits {
            collection: 2,
            ..exact
        },
    ] {
        assert!(matches!(
            codec::decode_with_limits::<(Strict, Strict)>(&source, quota),
            Err(crate::engine::RuntimeCheckpointError::Capacity)
        ));
        let (_, fresh) = codec::decode_with_usage::<(Strict, Strict)>(&source, exact).unwrap();
        assert_eq!(fresh, usage, "failed scope must not poison a later decode");
    }
    assert_eq!(codec::encode(&decoded).unwrap(), source);
}
#[test]
fn file_spatial_ordered_duplicate_map_key_rejects_before_second_value_deserialization() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static VALUES: AtomicUsize = AtomicUsize::new(0);
    struct Counted;
    impl<'de> Deserialize<'de> for Counted {
        fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
            let _ = u32::deserialize(d)?;
            VALUES.fetch_add(1, Ordering::Relaxed);
            Ok(Self)
        }
    }
    struct Duplicate;
    impl Serialize for Duplicate {
        fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
            let mut map = s.serialize_map(Some(2))?;
            map.serialize_entry(&7u32, &11u32)?;
            map.serialize_entry(&7u32, &13u32)?;
            map.end()
        }
    }
    #[derive(Deserialize)]
    struct Map {
        #[serde(deserialize_with = "super::map")]
        _values: BTreeMap<u32, Counted>,
    }
    #[derive(Serialize)]
    struct Raw {
        _values: Duplicate,
    }
    VALUES.store(0, Ordering::Relaxed);
    let source = codec::encode(&Raw { _values: Duplicate }).unwrap();
    assert!(matches!(
        codec::decode::<Map>(&source),
        Err(crate::engine::RuntimeCheckpointError::InvalidState)
    ));
    assert_eq!(VALUES.load(Ordering::Relaxed), 1);
}
