use super::*;
use serde::Serialize;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Debug, PartialEq, Serialize, Deserialize)]
struct Stored {
    #[serde(deserialize_with = "map")]
    map: BTreeMap<u32, f32>,
    #[serde(deserialize_with = "set")]
    set: BTreeSet<u32>,
    #[serde(deserialize_with = "optional_map")]
    pending: Option<BTreeMap<u32, f32>>,
}

#[derive(Serialize, Deserialize)]
struct Standard {
    map: BTreeMap<u32, f32>,
    set: BTreeSet<u32>,
    pending: Option<BTreeMap<u32, f32>>,
}

#[test]
fn runtime_order_standard_wire_empty_single_sparse_optional_and_signed_zero() {
    for keys in [vec![], vec![u32::MAX], vec![0, 137, 65535, u32::MAX]] {
        for present in [false, true] {
            let source = Standard {
                map: keys.iter().map(|&k| (k, -0.)).collect(),
                set: keys.iter().copied().collect(),
                pending: present.then(|| keys.iter().map(|&k| (k, f32::MAX)).collect()),
            };
            let bytes = postcard::to_allocvec(&source).unwrap();
            let restored: Stored = crate::checkpoint_decode::from_bytes(&bytes).unwrap();
            assert_eq!(postcard::to_allocvec(&restored).unwrap(), bytes);
            assert!(restored
                .map
                .values()
                .all(|v| v.to_bits() == (-0f32).to_bits()));
            assert_eq!(restored.pending.is_some(), present);
        }
    }
}

#[derive(Serialize)]
struct Raw<'a> {
    map: RawMap<'a>,
    set: &'a [u32],
    pending: Option<RawMap<'a>>,
}
struct RawMap<'a>(&'a [(u32, f32)]);
impl Serialize for RawMap<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut result = serializer.serialize_map(Some(self.0.len()))?;
        for (k, v) in self.0 {
            result.serialize_entry(k, v)?;
        }
        result.end()
    }
}

#[test]
fn runtime_order_raw_map_set_and_optional_map_refuse_swap_and_duplicate() {
    for bad in [vec![137, 0], vec![0, 0]] {
        let bad_map: Vec<_> = bad.iter().map(|&k| (k, 0.)).collect();
        for field in 0..3 {
            let raw = Raw {
                map: RawMap(if field == 0 { &bad_map } else { &[] }),
                set: if field == 1 { &bad } else { &[] },
                pending: (field == 2).then_some(RawMap(&bad_map)),
            };
            let bytes = postcard::to_allocvec(&raw).unwrap();
            let before = bytes.clone();
            assert!(crate::checkpoint_decode::from_bytes::<Stored>(&bytes).is_err());
            assert_eq!(bytes, before);
        }
    }
}

#[test]
fn runtime_order_uses_one_cumulative_decode_budget_and_recovers_after_failure() {
    let source = Standard {
        map: [(0, -0.), (137, f32::MAX)].into(),
        set: [0, 137].into(),
        pending: Some([(2, 0.), (u32::MAX, -0.)].into()),
    };
    let bytes = postcard::to_allocvec(&source).unwrap();
    let limits = crate::checkpoint_decode::Limits::default();
    let (_, usage) = crate::checkpoint_decode::with_limits::<Stored>(&bytes, limits).unwrap();
    let (_, standard) = crate::checkpoint_decode::with_limits::<Standard>(&bytes, limits).unwrap();
    assert_eq!(
        usage, standard,
        "adapters must retain standard cumulative charges"
    );
    for allowance in [usage.values, usage.values - 1] {
        let result = crate::checkpoint_decode::with_limits::<Stored>(
            &bytes,
            crate::checkpoint_decode::Limits {
                values: allowance,
                ..limits
            },
        );
        assert_eq!(result.is_ok(), allowance == usage.values);
    }
    crate::checkpoint_decode::with_limits::<Stored>(&bytes, limits).unwrap();
}

static VALUE_READS: AtomicUsize = AtomicUsize::new(0);
struct Counted;
impl<'de> Deserialize<'de> for Counted {
    fn deserialize<D: Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        VALUE_READS.fetch_add(1, Ordering::Relaxed);
        u32::deserialize(source)?;
        Ok(Self)
    }
}
#[derive(Deserialize)]
struct CountedMap(#[serde(deserialize_with = "map")] BTreeMap<u32, Counted>);

#[test]
fn runtime_order_duplicate_key_is_refused_before_reading_its_value() {
    VALUE_READS.store(0, Ordering::Relaxed);
    // Standard postcard map len2, entry(0,0), duplicate key0 with no value.
    let bytes = [2, 0, 0, 0];
    assert!(crate::checkpoint_decode::from_bytes::<CountedMap>(&bytes).is_err());
    assert_eq!(VALUE_READS.load(Ordering::Relaxed), 1);
    let good: CountedMap = crate::checkpoint_decode::from_bytes(&[1, 0, 0]).unwrap();
    assert_eq!(good.0.len(), 1);
}
