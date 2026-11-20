use super::*;
use crate::checkpoint_decode::{self as admission, ErrorKind, Limit, Limits};
use std::{cell::Cell, collections::HashMap};

#[derive(Debug, Serialize, Deserialize, PartialEq)]
struct Packet {
    #[serde(with = "super::super::vector")]
    values: Vec<u32>,
    #[serde(with = "super::super::map")]
    entries: HashMap<u32, u32>,
    #[serde(with = "super::super::array")]
    fixed: [u32; 3],
    #[serde(with = "super::super::optional_array")]
    optional: Option<[u32; 2]>,
}

fn packet(n: usize) -> Packet {
    let mut values = Vec::with_capacity(n + 17);
    values.extend((0..n as u32).map(|v| v * 129));
    let mut entries = HashMap::with_capacity(5);
    entries.insert(9, 128);
    entries.insert(1, 127);
    Packet {
        values,
        entries,
        fixed: [0, 127, 128],
        optional: n.is_multiple_of(2).then_some([u32::MAX, 129]),
    }
}

#[test]
fn fallible_sequences_preserve_legacy_wire_capacity_and_all_four_helper_values() {
    for n in [0, 1, 3, 8, 33, 257] {
        let source = packet(n);
        let bytes = encode(&source).unwrap();
        // Independent pre-existing grammar: (capacity, sequence), sorted map
        // (capacity, pairs), sequence, optional sequence. No new wire wrapper.
        let legacy = (
            (source.values.capacity(), source.values.as_slice()),
            (source.entries.capacity(), [(1u32, 127u32), (9, 128)]),
            source.fixed.as_slice(),
            source.optional.as_ref().map(|v| v.as_slice()),
        );
        // Map pairs are a sequence, not an array tuple on the wire.
        let legacy = (
            legacy.0,
            (legacy.1 .0, legacy.1 .1.as_slice()),
            legacy.2,
            legacy.3,
        );
        assert_eq!(&bytes[HEADER..], postcard::to_allocvec(&legacy).unwrap());
        let restored: Packet = decode(&bytes).unwrap();
        assert_eq!(restored, source);
        assert_eq!(restored.values.capacity(), source.values.capacity());
        assert_eq!(restored.entries.capacity(), source.entries.capacity());
        assert_eq!(encode(&restored).unwrap(), bytes);
        // Public value-data Serde can also call the helpers without a TLS scope.
        let independent: Packet = postcard::from_bytes(&bytes[HEADER..]).unwrap();
        assert_eq!(independent, source);
        assert_eq!(encode(&independent).unwrap(), bytes);
    }
}

#[test]
fn fallible_sequences_ignore_hostile_length_hints_instead_of_preallocating() {
    struct Hint(std::ops::Range<u32>);
    impl Iterator for Hint {
        type Item = u32;
        fn next(&mut self) -> Option<u32> {
            self.0.next()
        }
        fn size_hint(&self) -> (usize, Option<usize>) {
            (usize::MAX, Some(usize::MAX))
        }
    }
    let source = serde::de::value::SeqDeserializer::<_, serde::de::value::Error>::new(Hint(0..3));
    let values = super::super::fallible_values::Values::<u32>::deserialize(source).unwrap();
    assert_eq!(values.0, [0, 1, 2]);
    assert!(values.0.capacity() < 1024);
}

#[test]
fn fallible_sequences_keep_exact_shared_decode_limits_and_normal_scope_cleanup() {
    let bytes = encode(&packet(33)).unwrap();
    let (_, usage) = decode_with_usage::<Packet>(&bytes, Limits::default()).unwrap();
    let exact = Limits {
        allocation_work: usage.allocation_work,
        values: usage.values,
        depth: usage.peak_depth,
        ..Limits::default()
    };
    assert_eq!(decode_with_usage::<Packet>(&bytes, exact).unwrap().1, usage);
    for limits in [
        Limits {
            allocation_work: usage.allocation_work - 1,
            ..exact
        },
        Limits {
            values: usage.values - 1,
            ..exact
        },
        Limits {
            depth: usage.peak_depth - 1,
            ..exact
        },
    ] {
        assert_eq!(
            decode_with_limits::<Packet>(&bytes, limits),
            Err(RuntimeCheckpointError::Capacity)
        );
        assert_eq!(decode_with_usage::<Packet>(&bytes, exact).unwrap().1, usage);
    }
}

thread_local! {
    static BUILT: Cell<usize> = const { Cell::new(0) };
    static DROPPED: Cell<usize> = const { Cell::new(0) };
}
#[derive(Debug)]
struct Element(u32);
impl<'de> Deserialize<'de> for Element {
    fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        let value = u32::deserialize(source)?;
        BUILT.with(|n| n.set(n.get() + 1));
        Ok(Self(value))
    }
}
impl Drop for Element {
    fn drop(&mut self) {
        let _ = self.0;
        DROPPED.with(|n| n.set(n.get() + 1));
    }
}
#[derive(Debug, Deserialize)]
struct Partial {
    #[serde(with = "super::super::vector")]
    _values: Vec<Element>,
}

#[test]
fn fallible_sequences_drop_partially_decoded_elements_without_mutating_input() {
    let mut payload = postcard::to_allocvec(&(8usize, vec![1u32, 2, 129])).unwrap();
    payload.pop(); // Truncated third value; two constructed values must drop.
    let before = payload.clone();
    BUILT.with(|n| n.set(0));
    DROPPED.with(|n| n.set(0));
    assert_eq!(
        admission::from_bytes::<Partial>(&payload).unwrap_err().kind,
        ErrorKind::Invalid
    );
    assert_eq!(BUILT.with(Cell::get), 2);
    assert_eq!(DROPPED.with(Cell::get), 2);
    assert_eq!(payload, before);
    assert_eq!(admission::from_bytes::<u32>(&[7]).unwrap(), 7);
}

fn reservation_failure() -> std::collections::TryReserveError {
    // Deterministic real try_reserve layout overflow; not an OOM claim.
    Vec::<u64>::new().try_reserve(usize::MAX).unwrap_err()
}
#[derive(Debug, PartialEq)]
struct Failed;
impl<'de> Deserialize<'de> for Failed {
    fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        <()>::deserialize(source)?;
        Err(admission::allocation_error(reservation_failure()))
    }
}

#[test]
fn fallible_sequences_classify_real_reservation_errors_separately_from_logical_limits() {
    let error = admission::from_bytes::<Failed>(&[]).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Allocation);
    assert_eq!(
        decode::<Failed>(&encode(&()).unwrap()),
        Err(RuntimeCheckpointError::Capacity)
    );
    assert_eq!(
        admission::with_limits::<Failed>(
            &[],
            Limits {
                allocation_work: 0,
                ..Limits::default()
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::Limit(Limit::Allocation)
    );
    assert!(postcard::from_bytes::<Failed>(&[]).is_err());
    assert_eq!(admission::from_bytes::<u32>(&[7]).unwrap(), 7);
}

#[derive(Debug)]
struct IgnoredFailure;
impl<'de> Deserialize<'de> for IgnoredFailure {
    fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        <()>::deserialize(source)?;
        let _: D::Error = admission::allocation_error(reservation_failure());
        // A later logical failure cannot overwrite the first storage failure.
        let _ = admission::reserve_bytes(usize::MAX);
        Ok(Self)
    }
}

#[test]
fn fallible_sequences_storage_failure_stays_sticky_and_preserves_first_failure() {
    assert_eq!(
        admission::from_bytes::<IgnoredFailure>(&[])
            .unwrap_err()
            .kind,
        ErrorKind::Allocation
    );
    #[derive(Debug)]
    struct QuotaFirst;
    impl<'de> Deserialize<'de> for QuotaFirst {
        fn deserialize<D: serde::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
            <()>::deserialize(source)?;
            let _ = admission::reserve_bytes(usize::MAX);
            let _: D::Error = admission::allocation_error(reservation_failure());
            Ok(Self)
        }
    }
    assert_eq!(
        admission::from_bytes::<QuotaFirst>(&[]).unwrap_err().kind,
        ErrorKind::Limit(Limit::Allocation)
    );
    assert_eq!(admission::from_bytes::<u32>(&[7]).unwrap(), 7);
}
