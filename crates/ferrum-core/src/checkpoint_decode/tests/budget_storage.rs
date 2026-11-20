use super::*;

#[derive(Debug, PartialEq, Eq)]
struct Nested {
    scalar: u32,
    pair: [u32; 2],
}
impl<'de> Deserialize<'de> for Nested {
    fn deserialize<D: de::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        <()>::deserialize(source)?;
        let scalar =
            from_bytes::<u32>(&[7]).map_err(|_| de::Error::custom("nested scalar rejected"))?;
        let pair = from_bytes_in_scope::<[u32; 2]>(&[11, 13])
            .map_err(|_| de::Error::custom("nested pair rejected"))?;
        Ok(Self { scalar, pair })
    }
}

#[test]
fn decode_budget_storage_nested_default_and_explicit_reads_share_exact_usage() {
    let (value, usage) = with_limits::<Nested>(&[], Limits::default()).unwrap();
    assert_eq!(
        value,
        Nested {
            scalar: 7,
            pair: [11, 13]
        }
    );
    assert_eq!(usage.allocation_work, 168);
    assert_eq!(usage.values, 5);
    assert_eq!(usage.peak_depth, 2);
    let exact = Limits {
        allocation_work: usage.allocation_work,
        values: usage.values,
        depth: usage.peak_depth,
        ..Limits::default()
    };
    assert_eq!(with_limits::<Nested>(&[], exact).unwrap().1, usage);
    assert_eq!(
        with_limits::<Nested>(
            &[],
            Limits {
                allocation_work: usage.allocation_work - 1,
                ..exact
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::Limit(Limit::Allocation)
    );
    assert_eq!(
        with_limits::<Nested>(
            &[],
            Limits {
                values: usage.values - 1,
                ..exact
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::Limit(Limit::Values)
    );
    assert_eq!(
        with_limits::<Nested>(
            &[],
            Limits {
                depth: usage.peak_depth - 1,
                ..exact
            }
        )
        .unwrap_err()
        .kind,
        ErrorKind::Limit(Limit::Depth)
    );
}

#[derive(Debug)]
struct DeniedRoot(u32);
impl<'de> Deserialize<'de> for DeniedRoot {
    fn deserialize<D: de::Deserializer<'de>>(source: D) -> Result<Self, D::Error> {
        let denied = with_limits::<u32>(&[9], Limits::default()).unwrap_err();
        assert_eq!(denied.kind, ErrorKind::Invalid);
        assert_eq!(denied.usage, Usage::default());
        Ok(Self(u32::deserialize(source)?))
    }
}

#[test]
fn decode_budget_storage_denied_nested_root_does_not_replace_or_charge_outer_usage() {
    let (value, usage) = with_limits::<DeniedRoot>(&[7], Limits::default()).unwrap();
    let (plain, plain_usage) = with_limits::<u32>(&[7], Limits::default()).unwrap();
    assert_eq!(value.0, plain);
    assert_eq!(usage, plain_usage);
    assert!(ACTIVE.with(|active| active.borrow().is_none()));
}

#[test]
fn decode_budget_storage_all_return_paths_release_the_active_scope() {
    for (source, limits, kind) in [
        (&[7, 0][..], Limits::default(), ErrorKind::Trailing),
        (&[0x80][..], Limits::default(), ErrorKind::Invalid),
        (
            &[7][..],
            Limits {
                allocation_work: 0,
                ..Limits::default()
            },
            ErrorKind::Limit(Limit::Allocation),
        ),
    ] {
        assert_eq!(with_limits::<u32>(source, limits).unwrap_err().kind, kind);
        assert!(ACTIVE.with(|active| active.borrow().is_none()));
        assert_eq!(
            from_bytes_in_scope::<u32>(&[7]).unwrap_err().kind,
            ErrorKind::Invalid
        );
        assert_eq!(from_bytes::<u32>(&[7]).unwrap(), 7);
        assert!(ACTIVE.with(|active| active.borrow().is_none()));
    }
}

#[test]
fn decode_budget_storage_preflight_error_priority_is_preserved() {
    for (input_bytes, depth, values, expected) in [
        (0, 0, 0, Limit::Input),
        (1, 0, 0, Limit::Depth),
        (1, 1, 0, Limit::Values),
        (1, 1, 1, Limit::Allocation),
    ] {
        let rejected = with_limits::<u32>(
            &[7],
            Limits {
                input_bytes,
                depth,
                values,
                allocation_work: 0,
                ..Limits::default()
            },
        )
        .unwrap_err();
        assert_eq!(rejected.kind, ErrorKind::Limit(expected));
        if expected == Limit::Allocation {
            assert_eq!(
                rejected.usage,
                Usage {
                    allocation_work: 0,
                    values: 1,
                    peak_depth: 1,
                }
            );
        } else {
            assert_eq!(rejected.usage, Usage::default());
        }
        assert_eq!(from_bytes::<u32>(&[7]).unwrap(), 7);
    }
}
