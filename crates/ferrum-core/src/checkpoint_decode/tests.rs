use super::*;
use serde::{Deserialize, Serialize};

mod budget_storage;
mod bvh_depth;
mod bvh_refit;
mod geometry;
mod native_arena;
mod shape_boundary;
mod shapes;
mod workspace_boundary;

#[test]
fn decode_admission_declared_length_is_rejected_before_element_construction() {
    let source = postcard::to_allocvec(&vec![0u64; 65]).unwrap();
    let failure = with_limits::<Vec<u64>>(
        &source,
        Limits {
            collection: 64,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(failure.kind, ErrorKind::Limit(Limit::Collection));
    assert_eq!(failure.usage.values, 1);
    // Postcard deliberately hides a length hint exceeding remaining input.
    // Truncation must still fail without a declaration-sized preallocation.
    let truncated = postcard::to_allocvec(&usize::MAX).unwrap();
    let failure = with_limits::<Vec<u64>>(&truncated, Limits::default()).unwrap_err();
    assert_eq!(failure.kind, ErrorKind::Invalid);
    assert!(failure.usage.values <= 2);
}

#[test]
fn decode_admission_large_zero_wire_elements_are_charged_before_construction() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static BUILT: AtomicUsize = AtomicUsize::new(0);
    #[derive(Debug)]
    struct Large {
        _bytes: [u8; 4096],
    }
    impl<'de> Deserialize<'de> for Large {
        fn deserialize<D: de::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
            <()>::deserialize(source)?;
            BUILT.fetch_add(1, Ordering::Relaxed);
            Ok(Self { _bytes: [0; 4096] })
        }
    }
    // Unit payloads need zero wire bytes. A malicious declaration must not cause
    // Vec::with_capacity(100) or construct even one large element first.
    let source = postcard::to_allocvec(&100usize).unwrap();
    let failure = with_limits::<Vec<Large>>(
        &source,
        Limits {
            allocation_work: 8192,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(failure.kind, ErrorKind::Limit(Limit::Allocation));
    assert_eq!(BUILT.load(Ordering::Relaxed), 0);
    assert!(failure.usage.allocation_work <= 8192);
}

#[derive(Debug, Deserialize)]
enum Node {
    End,
    Next(#[allow(dead_code)] Box<Node>),
}

#[test]
fn decode_admission_recursive_enums_stop_before_stack_exhaustion() {
    let mut source = vec![1u8; 1000];
    source.push(0);
    let failure = with_limits::<Node>(
        &source,
        Limits {
            depth: 32,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(failure.kind, ErrorKind::Limit(Limit::Depth));
    assert_eq!(failure.usage.peak_depth, 32);
    assert!(
        from_bytes::<u32>(&[7]).is_ok(),
        "failed scopes must not poison later decodes"
    );
}

#[test]
fn decode_admission_value_limit_is_exact_and_zero_sized_sequences_are_bounded() {
    let source = postcard::to_allocvec(&vec![7u32, 9]).unwrap();
    let (value, usage) = with_limits::<Vec<u32>>(&source, Limits::default()).unwrap();
    assert_eq!(value, [7, 9]);
    assert_eq!(usage.values, 3);
    assert!(with_limits::<Vec<u32>>(
        &source,
        Limits {
            values: 3,
            ..Limits::default()
        }
    )
    .is_ok());
    assert_eq!(
        with_limits::<Vec<u32>>(
            &source,
            Limits {
                values: 2,
                ..Limits::default()
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::Limit(Limit::Values)
    );
    let units = postcard::to_allocvec(&4097usize).unwrap();
    assert_eq!(
        from_bytes::<Vec<()>>(&units).unwrap_err().kind,
        ErrorKind::Limit(Limit::Collection)
    );
}

#[derive(Debug, Serialize, Deserialize)]
struct Reserved {
    #[serde(with = "crate::checkpoint_codec::vector")]
    values: Vec<u32>,
}

#[test]
fn decode_admission_saved_empty_reservations_use_the_same_budget_and_scope_cleans_up() {
    let source = postcard::to_allocvec(&(1024usize, Vec::<u32>::new())).unwrap();
    let failure = with_limits::<Reserved>(
        &source,
        Limits {
            allocation_work: 3000,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(failure.kind, ErrorKind::Limit(Limit::Allocation));
    let value: Reserved = from_bytes(&source).unwrap();
    assert_eq!(value.values.capacity(), 1024);
    assert!(value.values.is_empty());
}

#[derive(Debug, Serialize, Deserialize)]
struct Native {
    #[serde(with = "crate::physics3d::snapshot::checkpoint_state")]
    physics: crate::physics3d::PhysicsWorld3d,
}

#[test]
fn decode_admission_native_blob_inherits_outer_value_and_depth_quotas() {
    let world = crate::physics3d::PhysicsWorld3d::new(Default::default()).unwrap();
    let source = postcard::to_allocvec(&Native { physics: world }).unwrap();
    let failure = with_limits::<Native>(
        &source,
        Limits {
            values: 2,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(failure.kind, ErrorKind::Limit(Limit::Values));
    assert!(with_limits::<Native>(&source, Limits::default()).is_ok());
    let failure = with_limits::<Native>(
        &source,
        Limits {
            depth: 2,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(failure.kind, ErrorKind::Limit(Limit::Depth));
}

#[derive(Debug)]
struct Reset;
impl<'de> Deserialize<'de> for Reset {
    fn deserialize<D: de::Deserializer<'de>>(_: D) -> Result<Self, D::Error> {
        let error = with_limits::<u32>(&[7], Limits::default()).unwrap_err();
        if error.kind == ErrorKind::Invalid {
            return Err(de::Error::custom("nested root denied"));
        }
        Ok(Self)
    }
}

#[test]
fn decode_admission_nested_root_cannot_replace_the_active_budget() {
    assert_eq!(
        from_bytes::<Reset>(&[]).unwrap_err().kind,
        ErrorKind::Invalid
    );
    assert_eq!(from_bytes::<u32>(&[7]).unwrap(), 7);
}

#[derive(Debug)]
struct Swallow;
impl<'de> Deserialize<'de> for Swallow {
    fn deserialize<D: de::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        let _denied = reserve_bytes(4096); // Deliberately swallow a custom visitor error.
        let _ = u32::deserialize(source)?;
        Ok(Self)
    }
}

#[test]
fn decode_admission_limit_failure_stays_sticky_if_a_visitor_ignores_it() {
    let error = with_limits::<Swallow>(
        &[7],
        Limits {
            allocation_work: 1024,
            ..Limits::default()
        },
    )
    .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Limit(Limit::Allocation));
}

#[test]
fn decode_admission_input_and_borrowed_string_are_checked_before_owned_conversion() {
    let source = postcard::to_allocvec("a moderately long string for admission").unwrap();
    assert_eq!(
        with_limits::<String>(
            &source,
            Limits {
                input_bytes: source.len() - 1,
                ..Limits::default()
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::Limit(Limit::Input)
    );
    assert_eq!(
        with_limits::<String>(
            &source,
            Limits {
                allocation_work: 40,
                ..Limits::default()
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::Limit(Limit::Allocation)
    );
    let (borrowed, usage) = with_limits::<&str>(&source, Limits::default()).unwrap();
    assert_eq!(borrowed, "a moderately long string for admission");
    assert!(usage.allocation_work >= borrowed.len());
}
