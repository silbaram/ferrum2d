use super::*;

fn reject(arena: Arena<u32>) {
    let bytes = bincode::serialize(&arena).unwrap();
    assert!(bincode::deserialize::<Arena<u32>>(&bytes).is_err());
    let value = serde_json::to_value(&arena).unwrap();
    assert!(serde_json::from_value::<Arena<u32>>(value).is_err());
}

#[test]
fn arena_serde_rejects_saved_length_mismatch() {
    for length in [0, 2, usize::MAX] {
        let mut arena = Arena::with_capacity(3);
        arena.insert(17);
        arena.len = length;
        reject(arena);
    }
}

#[test]
fn arena_serde_rejects_invalid_free_head() {
    for head in [None, Some(0), Some(3), Some(u32::MAX)] {
        let mut arena = Arena::with_capacity(3);
        arena.insert(17);
        arena.free_list_head = head;
        reject(arena);
    }
}

#[test]
fn arena_serde_rejects_cyclic_free_chain() {
    for tail in [Some(0), Some(1), Some(2)] {
        let mut arena = Arena::<u32>::with_capacity(3);
        arena.items[2] = Entry::Free { next_free: tail };
        reject(arena);
    }
}

#[test]
fn arena_serde_rejects_dangling_or_occupied_free_link() {
    for link in [Some(0), Some(3), Some(u32::MAX)] {
        let mut arena = Arena::with_capacity(3);
        arena.insert(17);
        arena.items[2] = Entry::Free { next_free: link };
        reject(arena);
    }
}

#[test]
fn arena_serde_rejects_unreachable_free_slots() {
    for head in [None, Some(1), Some(2)] {
        let mut arena = Arena::<u32>::with_capacity(3);
        arena.free_list_head = head;
        reject(arena);
    }
}

#[test]
fn arena_serde_rejects_free_head_in_full_arena_and_zero_slot_state() {
    let mut full = Arena::with_capacity(1);
    full.insert(17);
    full.free_list_head = Some(0);
    reject(full);
    reject(Arena {
        items: Vec::new(),
        generation: 0,
        free_list_head: None,
        len: 0,
    });
}

#[test]
fn arena_serde_preserves_valid_wire_identity_and_free_order() {
    let mut arena = Arena::with_capacity(4);
    let ids: Vec<_> = (0..4).map(|value| arena.insert(value)).collect();
    arena.remove(ids[1]);
    arena.remove(ids[3]);
    arena.reserve(2);
    let bytes = bincode::serialize(&arena).unwrap();
    // This tuple is the pre-patch derived binary representation.
    let legacy = bincode::serialize(&(
        &arena.items,
        arena.generation,
        arena.free_list_head,
        arena.len,
    ))
    .unwrap();
    assert_eq!(bytes, legacy);
    let mut restored: Arena<u32> = bincode::deserialize(&legacy).unwrap();
    assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
    assert_eq!(restored.iter().len(), 2);
    assert_eq!(restored.iter().rev().count(), 2);
    assert_eq!(restored.get(ids[1]), None);
    for value in 20..30 {
        assert_eq!(arena.insert(value), restored.insert(value));
    }
    assert_eq!(
        bincode::serialize(&arena).unwrap(),
        bincode::serialize(&restored).unwrap()
    );
}

#[test]
fn arena_serde_accepts_empty_full_and_cleared_constructor_states() {
    let mut arena = Arena::<u32>::with_capacity(1);
    for i in 0..3 {
        let bytes = bincode::serialize(&arena).unwrap();
        let restored: Arena<u32> = bincode::deserialize(&bytes).unwrap();
        assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
        let value = serde_json::to_value(&arena).unwrap();
        let restored: Arena<u32> = serde_json::from_value(value).unwrap();
        assert_eq!(bincode::serialize(&restored).unwrap(), bytes);
        if i == 0 {
            arena.insert(17);
        } else {
            arena.clear();
        }
    }
}
