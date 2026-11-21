use super::*;
use crate::tilemap::file_admission::{Limits, Usage};
fn limits() -> Limits {
    Limits {
        max_work: 1_000_000,
        max_scratch_bytes: 1_000_000,
    }
}
fn validate(s: &TilemapNavigationScratch) -> Result<Usage, Error> {
    let mut b = Budget::new(limits());
    s.validate_file(&mut b)?;
    Ok(b.usage)
}
impl TilemapNavigationScratch {
    pub(crate) fn pending_file_fixture() -> Self {
        Self {
            came_from: vec![1, UNVISITED_CELL, 1, UNVISITED_CELL, 1, UNVISITED_CELL],
            g_scores: vec![1, 0, 2, u32::MAX, 3, u32::MAX],
            visited: vec![1, 0, 2, 4],
            open: BinaryHeap::from(vec![
                PathNode {
                    cell: 0,
                    g_score: 1,
                    f_score: 3,
                },
                PathNode {
                    cell: 2,
                    g_score: 2,
                    f_score: 4,
                },
                PathNode {
                    cell: 4,
                    g_score: 3,
                    f_score: 3,
                },
            ]),
            navigation_floor_ids: vec![PhysicsFloorId(0xabcdef)],
            ..Default::default()
        }
    }
    pub(crate) fn corrupt_file_cached_point(&mut self) {
        self.path_points[0].x = f32::INFINITY;
    }
    pub(crate) fn corrupt_file_fixture(&mut self) {
        self.g_scores[0] = 0;
    }
    pub(crate) fn malformed_heap_packet(&self, packet: &[u8]) -> Vec<u8> {
        let scratch = crate::checkpoint_codec::encode(self).unwrap();
        let queue = crate::checkpoint_codec::encode(&self.open).unwrap();
        let scratch = &scratch[32..];
        let queue = &queue[32..];
        assert_eq!(queue.len(), 10);
        assert_eq!(queue[0], 3);
        let find = |hay: &[u8], needle: &[u8]| {
            let hits = hay
                .windows(needle.len())
                .enumerate()
                .filter_map(|(i, w)| (w == needle).then_some(i))
                .collect::<Vec<_>>();
            assert_eq!(hits.len(), 1);
            hits[0]
        };
        let start = 32 + find(&packet[32..], scratch) + find(scratch, queue) + 1;
        let at = self
            .open
            .as_slice()
            .iter()
            .position(|n| n.f_score == 4)
            .unwrap();
        assert!(at > 0);
        let mut out = packet.to_vec();
        for i in 0..3 {
            out.swap(start + i, start + at * 3 + i);
        }
        let mut crc = !0u32;
        for &byte in &out[32..] {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
            }
        }
        out[24..28].copy_from_slice(&(!crc).to_le_bytes());
        out
    }
}
#[test]
fn file_tilemap_pending_queue_and_stale_larger_scores_are_readonly() {
    let mut s = TilemapNavigationScratch::pending_file_fixture();
    s.open.push(PathNode {
        cell: 0,
        g_score: 7,
        f_score: 1,
    });
    let before = crate::checkpoint_codec::encode(&s).unwrap();
    validate(&s).unwrap();
    assert_eq!(crate::checkpoint_codec::encode(&s).unwrap(), before);
    // A next prepare legitimately clears this prior work; admission never does it.
    s.prepare(2);
    assert!(s.open.is_empty());
    assert!(s.visited.is_empty());
    validate(&s).unwrap();
}
#[test]
fn file_tilemap_scratch_dirty_queue_path_and_floor_corruption_are_typed() {
    let source = TilemapNavigationScratch::pending_file_fixture();
    type Corruption = (Field, fn(&mut TilemapNavigationScratch));
    let cases: [Corruption; 8] = [
        (Field::ScratchVisited, |s| s.visited.push(1)),
        (Field::ScratchVisited, |s| s.visited[0] = 999),
        (Field::ScratchScores, |s| s.came_from[0] = 0),
        (Field::ScratchScores, |s| s.visited.clear()),
        (Field::ScratchQueue, |s| {
            s.open.push(PathNode {
                cell: 99,
                g_score: 0,
                f_score: 0,
            })
        }),
        (Field::ScratchQueue, |s| {
            s.open.push(*s.open.peek().unwrap())
        }),
        (Field::ScratchPath, |s| s.path_cells = vec![0, 0]),
        (Field::ScratchFloors, |s| {
            s.navigation_floor_ids.push(s.navigation_floor_ids[0])
        }),
    ];
    for (field, corrupt) in cases {
        let mut s = source.clone();
        corrupt(&mut s);
        let before = crate::checkpoint_codec::encode(&s).unwrap();
        assert!(matches!(validate(&s),Err(Error::Invalid{field:f,..})if f==field));
        assert_eq!(crate::checkpoint_codec::encode(&s).unwrap(), before);
    }
}
#[test]
fn file_tilemap_scratch_exact_work_scratch_one_below_and_wrapped_heuristic() {
    let mut s = TilemapNavigationScratch::pending_file_fixture();
    s.open.push(PathNode {
        cell: 0,
        g_score: 99,
        f_score: 0,
    });
    let used = validate(&s).unwrap();
    let before = crate::checkpoint_codec::encode(&s).unwrap();
    for (work, bytes, expected) in [
        (used.work, used.scratch_bytes, Ok(())),
        (used.work - 1, used.scratch_bytes, Err(Error::WorkLimit)),
        (used.work, used.scratch_bytes - 1, Err(Error::ScratchLimit)),
    ] {
        assert_eq!(
            s.validate_file(&mut Budget::new(Limits {
                max_work: work,
                max_scratch_bytes: bytes
            })),
            expected
        );
    }
    assert_eq!(crate::checkpoint_codec::encode(&s).unwrap(), before);
}

#[derive(serde::Deserialize)]
struct Queue(#[serde(deserialize_with = "super::deserialize_open")] BinaryHeap<PathNode>);
#[test]
fn file_tilemap_heap_hook_preserves_existing_sequence_wire_for_valid_heaps() {
    for count in 0..48 {
        let mut heap = BinaryHeap::new();
        for index in 0..count {
            heap.push(PathNode {
                cell: index % 6,
                g_score: index as u32 + 1,
                f_score: (index as u32).wrapping_mul(1_000_000_000),
            });
        }
        let original = crate::checkpoint_codec::encode(&heap).unwrap();
        let decoded = crate::checkpoint_codec::decode::<Queue>(&original)
            .unwrap()
            .0;
        assert_eq!(crate::checkpoint_codec::encode(&decoded).unwrap(), original);
    }
}
#[test]
fn file_tilemap_heap_hook_rejects_raw_numeric_sentinel_and_honors_decode_collection_quota() {
    let heap = BinaryHeap::from(vec![PathNode {
        cell: 0,
        g_score: u32::MAX,
        f_score: 0,
    }]);
    let encoded = crate::checkpoint_codec::encode(&heap).unwrap();
    assert!(crate::checkpoint_codec::decode::<Queue>(&encoded).is_err());
    let heap = TilemapNavigationScratch::pending_file_fixture().open;
    let encoded = crate::checkpoint_codec::encode(&heap).unwrap();
    let small = crate::checkpoint_decode::Limits {
        collection: 2,
        ..Default::default()
    };
    assert!(crate::checkpoint_codec::decode_with_limits::<Queue>(&encoded, small).is_err());
}

#[test]
fn file_tilemap_unrepresentable_center_preserves_raw_width_and_finite_guard() {
    let mut t = Tilemap::default();
    t.set_layer(0, 2, 1, 3.0e38, 1.0, 0.0, 0.0, true, vec![0, 0]);
    let mut scratch = TilemapNavigationScratch::default();
    assert!(t
        .navigation_path_with_scratch(
            Transform2D { x: 0.0, y: 0.0 },
            Transform2D { x: 3.0e38, y: 0.0 },
            &mut scratch
        )
        .is_none());
    assert_eq!(t.layers[0].as_ref().unwrap().tile_width, 3.0e38);
    validate(&scratch).unwrap();
    scratch.path_points.push(Transform2D {
        x: f32::INFINITY,
        y: 0.0,
    });
    let before = crate::checkpoint_codec::encode(&scratch).unwrap();
    let decoded = crate::checkpoint_codec::decode::<TilemapNavigationScratch>(&before).unwrap();
    assert!(matches!(
        validate(&decoded),
        Err(Error::Invalid {
            field: Field::ScratchPoints,
            problem: Problem::Number,
            ..
        })
    ));
    assert_eq!(crate::checkpoint_codec::encode(&decoded).unwrap(), before);
}
