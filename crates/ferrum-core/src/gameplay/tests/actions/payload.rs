use super::*;

#[test]
fn commit_prepared_action_wrong_kind_does_not_consume_cooldown() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::dash(21, 0.5, 96.0);
    assert!(world.upsert_action_binding(source, action));

    assert!(!commit_prepared_action(
        &mut world,
        PreparedAction::new(source, 21, ActionPatternKind::Projectile, action)
    ));
    assert_eq!(
        world
            .action_binding(source, 21)
            .expect("action binding should remain")
            .cooldown
            .remaining_seconds,
        0.0,
    );
    assert!(commit_prepared_action(
        &mut world,
        prepared_action(source, action)
    ));
    assert!(
        (world
            .action_binding(source, 21)
            .expect("action binding should remain")
            .cooldown
            .remaining_seconds
            - 0.5)
            .abs()
            < 0.001
    );
}

#[test]
fn commit_prepared_action_rejects_changed_binding_between_prepare_and_commit() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let prepared_binding = ActionBinding::dash(21, 0.5, 96.0);
    let replacement = ActionBinding::dash(21, 0.5, 128.0);
    assert!(world.upsert_action_binding(source, prepared_binding));
    let ActionReadiness::Ready(prepared) =
        prepare_action_if_ready(&world, source, 21, ActionPatternKind::Dash)
    else {
        panic!("dash action should be ready");
    };

    assert!(world.upsert_action_binding(source, replacement));
    assert!(!commit_prepared_action(&mut world, prepared));
    assert_eq!(
        world
            .action_binding(source, 21)
            .expect("replacement binding should remain")
            .cooldown
            .remaining_seconds,
        0.0,
    );
    assert!(commit_prepared_action(
        &mut world,
        prepared_action(source, replacement)
    ));
}

#[test]
fn commit_prepared_action_accepts_same_nan_payload_bit_identity() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::dash(21, 0.5, f32::NAN);
    assert!(world.upsert_action_binding(source, action));
    let ActionReadiness::Ready(prepared) =
        prepare_action_if_ready(&world, source, 21, ActionPatternKind::Dash)
    else {
        panic!("dash action should be ready");
    };

    assert!(commit_prepared_action(&mut world, prepared));
    assert!(
        world
            .action_binding(source, 21)
            .expect("action binding should remain")
            .cooldown
            .remaining_seconds
            > 0.0
    );
}

#[test]
fn commit_prepared_action_rejects_different_nan_payload_bit_identity() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::dash(21, 0.5, f32::from_bits(0x7fc0_0001));
    assert!(world.upsert_action_binding(source, action));

    assert!(!commit_prepared_action(
        &mut world,
        PreparedAction::new(
            source,
            21,
            ActionPatternKind::Dash,
            ActionBinding::dash(21, 0.5, f32::from_bits(0x7fc0_0002))
        )
    ));
    assert_eq!(
        world
            .action_binding(source, 21)
            .expect("action binding should remain")
            .cooldown
            .remaining_seconds,
        0.0,
    );
}

#[test]
fn commit_prepared_action_rejects_binding_action_id_mismatch() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::dash(21, 0.5, 96.0);
    assert!(world.upsert_action_binding(source, action));

    assert!(!commit_prepared_action(
        &mut world,
        PreparedAction::new(
            source,
            21,
            ActionPatternKind::Dash,
            ActionBinding::dash(22, 0.5, 96.0)
        )
    ));
    assert_eq!(
        world
            .action_binding(source, 21)
            .expect("action binding should remain")
            .cooldown
            .remaining_seconds,
        0.0,
    );
}

#[test]
fn commit_prepared_action_rejects_consumed_cooldown_before_commit() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::dash(21, 0.5, 96.0);
    assert!(world.upsert_action_binding(source, action));
    let ActionReadiness::Ready(prepared) =
        prepare_action_if_ready(&world, source, 21, ActionPatternKind::Dash)
    else {
        panic!("dash action should be ready");
    };

    assert!(world.commit_action_cooldown_if_ready(source, 21).is_some());
    assert!(!commit_prepared_action(&mut world, prepared));
}

#[test]
fn commit_prepared_action_rejects_reused_entity_between_prepare_and_commit() {
    let mut world = World::default();
    let source = world.spawn_entity();
    let action = ActionBinding::dash(21, 0.5, 96.0);
    assert!(world.upsert_action_binding(source, action));
    let ActionReadiness::Ready(prepared) =
        prepare_action_if_ready(&world, source, 21, ActionPatternKind::Dash)
    else {
        panic!("dash action should be ready");
    };

    world.despawn(source);
    let reused = world.spawn_entity();
    assert_eq!(reused.id, source.id);
    assert_ne!(reused.generation, source.generation);
    assert!(world.upsert_action_binding(reused, action));
    assert!(!commit_prepared_action(&mut world, prepared));
    assert_eq!(
        world
            .action_binding(reused, 21)
            .expect("reused entity binding should remain")
            .cooldown
            .remaining_seconds,
        0.0,
    );
}
