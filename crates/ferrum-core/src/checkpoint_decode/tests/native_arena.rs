use super::*;
use rapier3d::data::arena::Arena;

// Mirrors the pinned native wire format to inject corrupt metadata without
// exposing the backend's private storage or creating a live invalid Arena.
#[derive(Serialize)]
enum Slot {
    Free { next_free: Option<u32> },
    Occupied { generation: u32, value: u32 },
}
#[derive(Serialize)]
struct Saved {
    items: Vec<Slot>,
    generation: u32,
    free_list_head: Option<u32>,
    len: usize,
}
fn saved(head: Option<u32>, tail: Option<u32>, len: usize) -> Vec<u8> {
    postcard::to_allocvec(&Saved {
        items: vec![
            Slot::Occupied {
                generation: 1,
                value: 17,
            },
            Slot::Free { next_free: Some(2) },
            Slot::Free { next_free: tail },
        ],
        generation: 2,
        free_list_head: head,
        len,
    })
    .unwrap()
}

#[test]
fn decode_admission_native_arena_rejects_corrupt_metadata_before_live_use() {
    for (head, tail, len) in [
        (Some(1), None, 0),
        (Some(1), None, 2),
        (Some(1), None, usize::MAX),
        (None, None, 1),
        (Some(0), None, 1),
        (Some(u32::MAX), None, 1),
        (Some(1), Some(0), 1),
        (Some(1), Some(1), 1),
        (Some(1), Some(2), 1),
        (Some(1), Some(u32::MAX), 1),
        (Some(2), None, 1),
    ] {
        let result = with_limits::<Arena<u32>>(&saved(head, tail, len), Limits::default());
        assert_eq!(result.unwrap_err().kind, ErrorKind::Invalid);
    }
}

#[test]
fn decode_admission_native_arena_preserves_generations_and_allocation_order() {
    let mut arena = with_limits::<Arena<u32>>(&saved(Some(1), None, 1), Limits::default())
        .unwrap()
        .0;
    assert_eq!(arena.len(), 1);
    assert_eq!(arena.iter().rev().count(), 1);
    assert_eq!(arena.insert(31).into_raw_parts(), (1, 2));
    let removed = arena.insert(32);
    assert_eq!(removed.into_raw_parts(), (2, 2));
    assert_eq!(arena.remove(removed), Some(32));
    let bytes = postcard::to_allocvec(&arena).unwrap();
    let mut restored = with_limits::<Arena<u32>>(&bytes, Limits::default())
        .unwrap()
        .0;
    assert_eq!(restored.get(removed), None);
    for value in 40..50 {
        assert_eq!(arena.insert(value), restored.insert(value));
    }
    assert_eq!(
        postcard::to_allocvec(&arena).unwrap(),
        postcard::to_allocvec(&restored).unwrap()
    );
}
