use super::*;

#[test]
fn collision_contact_tracker_reports_enter_once_and_preserves_current_contacts() {
    let first = Entity {
        id: 4,
        generation: 1,
    };
    let second = Entity {
        id: 9,
        generation: 2,
    };
    let mut previous = Vec::new();
    let mut current = Vec::new();

    assert!(register_collision_contact(
        &previous,
        &mut current,
        8,
        first,
        second,
    ));
    assert!(!register_collision_contact(
        &previous,
        &mut current,
        8,
        second,
        first,
    ));
    assert_eq!(current.len(), 1);

    finish_collision_contacts(&mut previous, &mut current);
    assert!(current.is_empty());
    assert!(!register_collision_contact(
        &previous,
        &mut current,
        8,
        second,
        first,
    ));
    assert_eq!(current.len(), 1);
}

#[test]
fn collision_contact_tracker_state_object_preserves_enter_and_capacity() {
    let first = Entity {
        id: 4,
        generation: 1,
    };
    let second = Entity {
        id: 9,
        generation: 2,
    };
    let mut tracker = CollisionContactTracker::with_capacity(1);

    assert!(tracker.register(first, second));
    assert!(!tracker.register(second, first));
    assert_eq!(tracker.current_len(), 1);
    assert!(tracker.current_capacity() >= 1);

    tracker.finish();
    assert!(!tracker.register(first, second));
    assert!(!tracker.register(
        Entity {
            id: 10,
            generation: 0
        },
        second
    ));
    assert_eq!(tracker.current_len(), 1);

    tracker.clear();
    assert!(tracker.register(first, second));
}

#[test]
fn collision_contact_tracker_respects_capacity_without_recording_contact() {
    let first = Entity {
        id: 1,
        generation: 0,
    };
    let second = Entity {
        id: 2,
        generation: 0,
    };
    let mut current = Vec::new();

    assert!(!register_collision_contact(
        &[],
        &mut current,
        0,
        first,
        second,
    ));
    assert!(current.is_empty());
}
