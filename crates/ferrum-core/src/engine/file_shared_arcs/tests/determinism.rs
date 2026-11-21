use super::*;
#[test]
fn sort_quota_is_n_based_for_all_tested_address_orders_and_rejects_before_sort() {
    for n in [0, 1, 2, 3, 7, 8, 17, 64] {
        let bound = sort::work_bound(n).unwrap();
        for variant in 0..5 {
            let mut keys = (0..n)
                .map(|i| Key {
                    domain: if i % 3 == 0 {
                        Domain::Route
                    } else {
                        Domain::Clips
                    },
                    pointer: match variant {
                        0 => i,
                        1 => n - i,
                        2 => (i * 17) ^ 31,
                        3 => i % 4,
                        _ => (i * 13 + 7) % 31,
                    },
                    len: i % 3,
                    ordinal: i,
                })
                .collect::<Vec<_>>();
            let before = keys.clone();
            let mut expected = keys.clone();
            expected.sort();
            let mut budget = Budget::new(Limits {
                max_work: bound,
                ..limits()
            });
            sort::heap(&mut keys, &mut budget).unwrap();
            assert!(keys == expected);
            assert_eq!(budget.usage.work, bound);
            if bound > 0 {
                let mut failed = before.clone();
                let mut budget = Budget::new(Limits {
                    max_work: bound - 1,
                    ..limits()
                });
                assert_eq!(sort::heap(&mut failed, &mut budget), Err(Error::Work));
                assert!(failed == before);
            }
        }
    }
    if usize::BITS == 64 {
        assert_eq!(sort::work_bound(usize::MAX), Err(Error::Work));
    } else {
        assert_eq!(
            sort::work_bound(usize::MAX),
            Ok(8 * u64::from(u32::MAX) * 33)
        );
    }
}
#[test]
fn fixed_file_fresh_decode_repeatedly_has_identical_usage_quota_and_graph() {
    let (source, _) = simple();
    let source_bytes = bytes(&source);
    let table = graph(&source);
    let table_bytes = crate::checkpoint_codec::encode(&table).unwrap();
    let mut expected_usage = None;
    let mut retained = Vec::new();
    for iteration in 0..24 {
        let mut candidate = persistence::decode(&source_bytes).unwrap();
        let declared: Table = crate::checkpoint_codec::decode(&table_bytes).unwrap();
        let before = bytes(&candidate);
        let (plan, usage) = prepare(&candidate, &declared, limits()).unwrap();
        drop(plan);
        if let Some(expected) = expected_usage {
            assert_eq!(usage, expected);
        } else {
            expected_usage = Some(usage);
        }
        let exact = Limits {
            max_work: usage.work,
            max_scratch_bytes: usage.scratch_bytes,
            max_roots: declared.root_count(),
            max_compare_bytes: usage.compare_bytes,
        };
        assert_eq!(
            restore(
                &mut candidate,
                &declared,
                Limits {
                    max_work: usage.work - 1,
                    ..exact
                }
            ),
            Err(Error::Work)
        );
        assert_eq!(bytes(&candidate), before);
        assert_eq!(restore(&mut candidate, &declared, exact).unwrap(), usage);
        assert_eq!(graph(&candidate), table);
        assert_eq!(bytes(&candidate), source_bytes);
        assert_eq!(bytes(&source), source_bytes);
        // Keep a small, bounded set of whole candidates alive so fresh loads
        // encounter different allocator reuse/ordering. File bytes never vary.
        if iteration % 6 == 0 {
            retained.push(candidate);
        }
    }
    assert_eq!(retained.len(), 4);
}
