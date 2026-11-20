use super::*;
fn crc(bytes: &[u8]) -> u32 {
    let mut value = !0u32;
    for byte in bytes {
        value ^= u32::from(*byte);
        for _ in 0..8 {
            value = (value >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(value & 1));
        }
    }
    !value
}
#[test]
fn controller_admission_codec_rejects_invalid_heap_without_normalizing() {
    let (engine, actor, _) = setup(false);
    let mut source = job(&engine, actor, 4., 0.);
    let first = Open {
        node: 0,
        score: 11311.25,
    };
    let second = Open {
        node: 1,
        score: 22522.5,
    };
    source.open = BinaryHeap::from(vec![first, second]);
    let mut n = source.nodes[0].clone();
    n.parent = Some(0);
    n.cell = (1, 0);
    n.cost = 1.;
    source.nodes.push(n);
    source.known.insert((1, 0, source.start.surface), 1);
    let original = crate::checkpoint_codec::encode(&source).unwrap();
    let ordered = crate::checkpoint_codec::encode(&vec![first, second]).unwrap();
    let reversed = crate::checkpoint_codec::encode(&vec![second, first]).unwrap();
    let pattern = &ordered[32..];
    let matches = original
        .windows(pattern.len())
        .enumerate()
        .filter_map(|(i, b)| (b == pattern).then_some(i))
        .collect::<Vec<_>>();
    assert_eq!(matches.len(), 1);
    let mut damaged = original.clone();
    let at = matches[0];
    damaged[at..at + pattern.len()].copy_from_slice(&reversed[32..]);
    let checksum = crc(&damaged[32..]);
    damaged[24..28].copy_from_slice(&checksum.to_le_bytes());
    assert_eq!(
        crate::checkpoint_codec::decode::<Search>(&damaged).err(),
        Some(crate::engine::RuntimeCheckpointError::InvalidState)
    );
    let restored: Search = crate::checkpoint_codec::decode(&original).unwrap();
    assert_eq!(
        crate::checkpoint_codec::encode(&restored).unwrap(),
        original
    );
}

struct MapWire(Vec<((i32, i32, u32), usize)>);
impl serde::Serialize for MapWire {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(Some(self.0.len()))?;
        for (k, v) in &self.0 {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}
#[test]
fn controller_admission_codec_rejects_reordered_and_duplicate_known_keys() {
    let (engine, actor, _) = setup(false);
    let mut source = job(&engine, actor, 4., 0.);
    let mut n = source.nodes[0].clone();
    n.parent = Some(0);
    n.cell = (1, 0);
    n.cost = 1.;
    source.nodes.push(n);
    source.known.insert((1, 0, source.start.surface), 1);
    let original = crate::checkpoint_codec::encode(&source).unwrap();
    let entries = source
        .known
        .iter()
        .map(|(k, v)| (*k, *v))
        .collect::<Vec<_>>();
    let ordered = crate::checkpoint_codec::encode(&source.known).unwrap();
    let pattern = &ordered[32..];
    let positions = original
        .windows(pattern.len())
        .enumerate()
        .filter_map(|(i, b)| (b == pattern).then_some(i))
        .collect::<Vec<_>>();
    assert_eq!(positions.len(), 1);
    for case in 0..2 {
        let mut raw = entries.clone();
        if case == 0 {
            raw.reverse()
        } else {
            raw.push(entries[1]);
        }
        let wire = crate::checkpoint_codec::encode(&MapWire(raw)).unwrap();
        let mut damaged = original.clone();
        damaged.splice(
            positions[0]..positions[0] + pattern.len(),
            wire[32..].iter().copied(),
        );
        let length = (damaged.len() - 32) as u32;
        damaged[20..24].copy_from_slice(&length.to_le_bytes());
        let checksum = crc(&damaged[32..]);
        damaged[24..28].copy_from_slice(&checksum.to_le_bytes());
        assert_eq!(
            crate::checkpoint_codec::decode::<Search>(&damaged).err(),
            Some(crate::engine::RuntimeCheckpointError::InvalidState)
        );
        let restored: Search = crate::checkpoint_codec::decode(&original).unwrap();
        assert_eq!(
            crate::checkpoint_codec::encode(&restored).unwrap(),
            original
        );
    }
}

fn admit(
    search: &Search,
    engine: &Engine,
    work: u64,
    scratch: usize,
) -> crate::engine::file_controller_admission::Result<crate::engine::file_controller_admission::Usage>
{
    use crate::engine::file_controller_admission::{Budget, Limits};
    let mut b = Budget::new(Limits {
        max_work: work,
        max_scratch_bytes: scratch,
    });
    search.validate_file_controller(&engine.spatial_scene, &mut b)?;
    Ok(b.usage())
}
#[test]
fn controller_admission_actual_search_every_checkpoint_is_pure_and_continues() {
    let (mut engine, actor, _) = setup(true);
    let mut expected = job(&engine, actor, 3., 0.);
    let (route, _) = finish(&mut engine, &mut expected, MAX_WORK);
    let mut source = job(&engine, actor, 3., 0.);
    let mut checkpoints = 0;
    loop {
        let bytes = crate::checkpoint_codec::encode(&source).unwrap();
        let world = crate::engine::persistence::encode(&engine).unwrap();
        let usage = admit(&source, &engine, 2_000_000, 1_000_000).unwrap();
        assert!(usage.work > 0);
        assert_eq!(crate::checkpoint_codec::encode(&source).unwrap(), bytes);
        assert_eq!(crate::engine::persistence::encode(&engine).unwrap(), world);
        let restored: Search = crate::checkpoint_codec::decode(&bytes).unwrap();
        assert_eq!(crate::checkpoint_codec::encode(&restored).unwrap(), bytes);
        admit(&restored, &engine, 2_000_000, 1_000_000).unwrap();
        checkpoints += 1;
        if let Some(actual) = advance(&mut engine, &mut source, 257).unwrap() {
            assert_eq!(points(&actual), points(&route));
            break;
        }
        assert!(checkpoints < 20_000);
    }
    assert!(checkpoints > 5);
    admit(&source, &engine, 2_000_000, 1_000_000).unwrap();
}
#[test]
fn controller_admission_search_valid_crc_corruption_is_guard_only() {
    let (mut engine, actor, _) = setup(true);
    let mut source = job(&engine, actor, 3., 0.);
    for _ in 0..5000 {
        if source.nodes.len() >= 3 {
            break;
        }
        assert!(advance(&mut engine, &mut source, 257).unwrap().is_none());
    }
    assert!(source.nodes.len() >= 3);
    admit(&source, &engine, 2_000_000, 1_000_000).unwrap();
    let pristine = crate::checkpoint_codec::encode(&source).unwrap();
    for case in 0..26 {
        let mut bad = source.clone();
        match case {
            0 => bad.nodes[0].parent = Some(0),
            1 => *bad.known.values_mut().next().unwrap() = usize::MAX,
            2 => bad.open.push(Open {
                node: usize::MAX,
                score: 0.,
            }),
            3 => bad.nodes[1].cost = f64::NAN,
            4 => bad.floor = 65536,
            5 => bad.cell = 0.,
            6 => bad.stride = 0.,
            7 => bad.probes = MAX_PROBES + 1,
            8 => {
                bad.phase = Phase::GoalEdges {
                    node: usize::MAX,
                    next: 0,
                }
            }
            9 => {
                bad.phase = Phase::Neighbors {
                    node: 0,
                    direction: 9,
                    surface: 0,
                }
            }
            10 => {
                bad.phase = Phase::Route {
                    next: Some(usize::MAX),
                    points: vec![bad.start],
                }
            }
            11 => bad.phase = Phase::Reverse(Vec::new()),
            12 => bad.phase = Phase::GoalSupports { next: 257 },
            13 => bad.skin *= 2.,
            14 => {
                bad.snapshot = None;
                bad.phase = Phase::Pop;
            }
            15 => {
                bad.open = BinaryHeap::from(vec![Open {
                    node: 0,
                    score: -1.,
                }])
            }
            16 => {
                bad.nodes.truncate(3);
                bad.known.retain(|_, v| *v < 3);
                bad.open.clear();
                bad.phase = Phase::Pop;
                bad.nodes[1].closed = true;
                bad.nodes[2].closed = true;
                bad.expanded = 3;
                bad.nodes[1].parent = Some(2);
                bad.nodes[2].parent = Some(1);
                bad.nodes[1].cost = 1.;
                bad.nodes[2].cost = 1.;
            }
            17 => bad.expanded += 1,
            19 => {
                assert!(bad.nodes[1].cost > 0.);
                bad.open = BinaryHeap::from(vec![Open { node: 1, score: 0. }]);
            }
            20 => bad.phase = Phase::GoalSupports { next: 0 },
            21 => bad.phase = Phase::Reverse(vec![bad.start]),
            22 => {
                bad.phase = Phase::Route {
                    next: Some(0),
                    points: vec![bad.start; bad.nodes.len() + 1],
                }
            }
            23 => bad.phase = Phase::Preparation,
            24 => {
                bad.phase = Phase::Commit {
                    accepted: false,
                    destination: Destination::Neighbor {
                        node: 0,
                        point: bad.goals[0],
                        cell: (1, 0),
                    },
                    next: Cursor::Neighbors {
                        node: 0,
                        direction: 0,
                        surface: 1,
                    },
                }
            }
            25 => {
                let mut point = bad.goals[0];
                point.pose.position[0] += 1.;
                bad.phase = Phase::Commit {
                    accepted: true,
                    destination: Destination::Goal { node: 0, point },
                    next: Cursor::Goals { node: 0, next: 1 },
                };
            }
            _ => {
                let point = bad.goals[0];
                let mut edge = bad.edge(bad.start, point).unwrap();
                edge.count = 0;
                bad.phase = Phase::Edge {
                    edge,
                    destination: Destination::Goal { node: 0, point },
                    next: Cursor::Goals { node: 0, next: 1 },
                };
            }
        }
        let wire = crate::checkpoint_codec::encode(&bad).unwrap();
        let candidate: Search = crate::checkpoint_codec::decode(&wire).unwrap();
        assert!(
            matches!(
                admit(&candidate, &engine, 2_000_000, 1_000_000),
                Err(crate::engine::file_controller_admission::Error::Invalid { .. })
            ),
            "case{case}"
        );
        if case == 16 {
            assert!(matches!(
                admit(&candidate, &engine, 2_000_000, 1_000_000),
                Err(crate::engine::file_controller_admission::Error::Invalid {
                    field: "parent-cycle",
                    ..
                })
            ));
        }
        assert_eq!(crate::checkpoint_codec::encode(&candidate).unwrap(), wire);
        assert_eq!(crate::checkpoint_codec::encode(&source).unwrap(), pristine);
    }
}
#[test]
fn controller_admission_search_structural_maximum_and_exact_limits() {
    let (engine, actor, _) = setup(false);
    let mut source = job(&engine, actor, 4., 0.);
    source.nodes.clear();
    source.known.clear();
    for i in 0..MAX_NODES {
        let mut point = source.start;
        point.pose.position[0] += i as f32 * source.cell;
        source.nodes.push(Node {
            point,
            cost: i as f64,
            parent: i.checked_sub(1),
            closed: i + 1 < MAX_NODES,
            cell: (i as i32, 0),
        });
        source.known.insert((i as i32, 0, point.surface), i);
    }
    source.expanded = (MAX_NODES - 1) as u32;
    source.probes = MAX_PROBES;
    source.work = MAX_WORK;
    source.goals = vec![source.start];
    source.open = BinaryHeap::from(vec![
        Open {
            node: MAX_NODES - 1,
            score: 100_000.
        };
        MAX_OPEN
    ]);
    source.phase = Phase::Pop;
    source.snapshot = Some(
        engine
            .unified_physics
            .as_ref()
            .unwrap()
            .physics
            .capture_character_query_snapshot(source.body, false)
            .unwrap(),
    );
    let wire = crate::checkpoint_codec::encode(&source).unwrap();
    let candidate: Search = crate::checkpoint_codec::decode(&wire).unwrap();
    let usage = admit(&candidate, &engine, 2_000_000, 1_000_000).unwrap();
    assert_eq!(usage.scratch_bytes, MAX_NODES);
    assert_eq!(
        admit(&candidate, &engine, usage.work, usage.scratch_bytes).unwrap(),
        usage
    );
    assert_eq!(
        admit(&candidate, &engine, usage.work - 1, usage.scratch_bytes),
        Err(crate::engine::file_controller_admission::Error::Work)
    );
    assert_eq!(
        admit(&candidate, &engine, usage.work, usage.scratch_bytes - 1),
        Err(crate::engine::file_controller_admission::Error::Scratch)
    );
    assert_eq!(crate::checkpoint_codec::encode(&candidate).unwrap(), wire);
    let mut extra = source.clone();
    extra.nodes.push(extra.nodes[0].clone());
    assert!(admit(&extra, &engine, 2_000_000, 1_000_000).is_err());
    let mut extra = source;
    extra.open.push(Open {
        node: 0,
        score: 100_000.,
    });
    let bytes = crate::checkpoint_codec::encode(&extra).unwrap();
    assert!(crate::checkpoint_codec::decode::<Search>(&bytes).is_err());
}
#[test]
fn controller_admission_stale_search_snapshot_is_valid_then_runtime_cancels() {
    let (mut engine, actor, wall) = setup(true);
    let mut source = job(&engine, actor, 3., 0.);
    assert!(advance(&mut engine, &mut source, 32).unwrap().is_none());
    assert!(source.snapshot.is_some());
    engine.remove_unified_body(wall.unwrap()).unwrap();
    let before = crate::checkpoint_codec::encode(&source).unwrap();
    admit(&source, &engine, 2_000_000, 1_000_000).unwrap();
    assert_eq!(crate::checkpoint_codec::encode(&source).unwrap(), before);
    assert_eq!(advance(&mut engine, &mut source, 32).err(), Some(8));
}
#[test]
fn controller_admission_all_retained_phase_payload_variants_keep_wire() {
    let (mut e, a, _) = setup(true);
    let mut source = job(&e, a, 3., 0.);
    for _ in 0..5000 {
        if source.nodes.len() >= 3 {
            break;
        }
        assert!(advance(&mut e, &mut source, 257).unwrap().is_none());
    }
    let point = source.goals[0];
    let from = source.nodes[0].point;
    let edge = source.edge(from, point).unwrap();
    let goal = Destination::Goal { node: 0, point };
    let next = Cursor::Goals { node: 0, next: 1 };
    let neighbor = Destination::Neighbor {
        node: 0,
        point,
        cell: (-1, -1),
    };
    let neighbor_next = Cursor::Neighbors {
        node: 0,
        direction: 0,
        surface: 1,
    };
    let phases = [
        Phase::Pop,
        Phase::GoalEdges { node: 0, next: 0 },
        Phase::Neighbors {
            node: 0,
            direction: 0,
            surface: 0,
        },
        Phase::Edge {
            edge: edge.clone(),
            destination: goal,
            next,
        },
        Phase::Commit {
            accepted: true,
            destination: goal,
            next,
        },
        Phase::Commit {
            accepted: false,
            destination: neighbor,
            next: neighbor_next,
        },
        Phase::Edge {
            edge,
            destination: neighbor,
            next: neighbor_next,
        },
        Phase::Route {
            next: Some(0),
            points: vec![point],
        },
        Phase::Reverse(vec![point, from]),
        Phase::Done,
    ];
    for phase in phases {
        let mut candidate = source.clone();
        candidate.phase = phase;
        let wire = crate::checkpoint_codec::encode(&candidate).unwrap();
        let c: Search = crate::checkpoint_codec::decode(&wire).unwrap();
        admit(&c, &e, 2_000_000, 1_000_000).unwrap();
        assert_eq!(crate::checkpoint_codec::encode(&c).unwrap(), wire);
    }
    // Preparation is a separate genuine freshly constructed job, with no snapshot.
    let initial = job(&e, a, 3., 0.);
    admit(&initial, &e, 2_000_000, 1_000_000).unwrap();
    let mut supported = job(&e, a, 3., 0.);
    let prep = (supported.target_count + e.spatial_scene.surfaces.len() + 1) as u64;
    assert!(advance(&mut e, &mut supported, prep).unwrap().is_none());
    assert!(matches!(supported.phase, Phase::GoalSupports { next: 0 }));
    admit(&supported, &e, 2_000_000, 1_000_000).unwrap();
}
