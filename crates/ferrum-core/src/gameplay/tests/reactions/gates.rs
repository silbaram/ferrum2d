use super::*;

#[test]
fn collision_reaction_pair_resolves_targets_and_reverses_direction() {
    let source = Entity {
        id: 2,
        generation: 7,
    };
    let other = Entity {
        id: 5,
        generation: 11,
    };
    let pair = CollisionReactionPair::new(2, 5, source, other);

    assert_eq!(pair.target_index(CollisionTarget::SelfEntity), 2);
    assert_eq!(pair.target_index(CollisionTarget::OtherEntity), 5);
    assert_eq!(pair.target_entity(CollisionTarget::SelfEntity), source);
    assert_eq!(pair.target_entity(CollisionTarget::OtherEntity), other);
    assert_eq!(
        pair.reversed(),
        CollisionReactionPair::new(5, 2, other, source),
    );
}

#[test]
fn collision_damage_allowed_respects_optional_faction_masks() {
    use crate::components::gameplay::{
        GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_NEUTRAL, GAMEPLAY_FACTION_PLAYER,
    };

    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_entity();

    assert!(collision_damage_allowed(
        &world,
        source.id as usize,
        target.id as usize,
    ));

    world.set_gameplay_faction(
        source,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
    );
    world.set_gameplay_faction(
        target,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );
    assert!(!collision_damage_allowed(
        &world,
        source.id as usize,
        target.id as usize,
    ));
    let denial = faction_damage_denial(&world, source.id as usize, target.id as usize)
        .expect("damage should be denied by source faction mask");
    assert_eq!(denial.source, source);
    assert_eq!(denial.target, target);
    assert_eq!(denial.source_faction_id, GAMEPLAY_FACTION_PLAYER);
    assert_eq!(denial.target_faction_id, GAMEPLAY_FACTION_ENEMY);

    world.set_gameplay_faction(
        source,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
    );
    assert!(collision_damage_allowed(
        &world,
        source.id as usize,
        target.id as usize,
    ));
    assert_eq!(
        faction_damage_denial(&world, source.id as usize, target.id as usize),
        None
    );

    world.set_gameplay_faction(
        source,
        GameplayFaction::new(GAMEPLAY_FACTION_NEUTRAL, 0).unwrap(),
    );
    assert!(!collision_damage_allowed(
        &world,
        source.id as usize,
        target.id as usize,
    ));
    let neutral_denial = faction_damage_denial(&world, source.id as usize, target.id as usize)
        .expect("neutral source with empty damage mask should be denied");
    assert_eq!(neutral_denial.source, source);
    assert_eq!(neutral_denial.target, target);
    assert_eq!(neutral_denial.source_faction_id, GAMEPLAY_FACTION_NEUTRAL);
    assert_eq!(neutral_denial.target_faction_id, GAMEPLAY_FACTION_ENEMY);
}

#[test]
fn collision_damage_allowed_uses_relation_table_when_enabled() {
    use crate::components::gameplay::{
        FactionRelation, GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };

    let mut world = World::default();
    let source = world.spawn_entity();
    let target = world.spawn_entity();
    world.set_gameplay_faction(
        source,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
    );
    world.set_gameplay_faction(
        target,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );

    assert!(!collision_damage_allowed(
        &world,
        source.id as usize,
        target.id as usize,
    ));

    assert!(world.set_gameplay_faction_relation(
        GAMEPLAY_FACTION_PLAYER,
        GAMEPLAY_FACTION_ENEMY,
        FactionRelation::Hostile,
    ));
    assert!(collision_damage_allowed(
        &world,
        source.id as usize,
        target.id as usize,
    ));

    assert!(world.set_gameplay_faction_relation(
        GAMEPLAY_FACTION_PLAYER,
        GAMEPLAY_FACTION_ENEMY,
        FactionRelation::Friendly,
    ));
    let friendly_denial = faction_damage_denial(&world, source.id as usize, target.id as usize)
        .expect("friendly relation should deny damage");
    assert_eq!(friendly_denial.source_faction_id, GAMEPLAY_FACTION_PLAYER);
    assert_eq!(friendly_denial.target_faction_id, GAMEPLAY_FACTION_ENEMY);

    assert!(world.set_gameplay_faction_relation(
        GAMEPLAY_FACTION_PLAYER,
        GAMEPLAY_FACTION_ENEMY,
        FactionRelation::Neutral,
    ));
    assert!(!collision_damage_allowed(
        &world,
        source.id as usize,
        target.id as usize,
    ));

    world.clear_gameplay_faction(target);
    assert!(collision_damage_allowed(
        &world,
        source.id as usize,
        target.id as usize,
    ));
}

#[test]
fn collision_damage_allowed_respects_directed_relation_table() {
    use crate::components::gameplay::{
        FactionRelation, GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };

    let mut world = World::default();
    let player = world.spawn_entity();
    let enemy = world.spawn_entity();
    world.set_gameplay_faction(
        player,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
    );
    world.set_gameplay_faction(
        enemy,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );
    world.set_gameplay_faction_default_relation(FactionRelation::Neutral);
    assert!(world.set_gameplay_faction_relation(
        GAMEPLAY_FACTION_PLAYER,
        GAMEPLAY_FACTION_ENEMY,
        FactionRelation::Hostile,
    ));

    assert!(collision_damage_allowed(
        &world,
        player.id as usize,
        enemy.id as usize,
    ));
    assert!(!collision_damage_allowed(
        &world,
        enemy.id as usize,
        player.id as usize,
    ));
}

#[test]
fn default_projectile_damage_allowed_checks_target_and_faction_gate() {
    use crate::components::gameplay::{
        GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };

    let mut world = World::default();
    let projectile = world.spawn_entity();
    let enemy = world.spawn_entity();

    assert_eq!(
        projectile_collision_target_at(&world, projectile.id as usize),
        ProjectileCollisionTarget::Enemies,
    );
    assert!(default_projectile_damage_allowed(
        &world,
        projectile.id as usize,
        enemy.id as usize,
        ProjectileCollisionTarget::Enemies,
    ));
    assert!(!default_projectile_damage_allowed(
        &world,
        projectile.id as usize,
        enemy.id as usize,
        ProjectileCollisionTarget::Player,
    ));

    world.set_projectile_collision_target_at(
        projectile.id as usize,
        ProjectileCollisionTarget::Player,
    );
    assert_eq!(
        projectile_collision_target_at(&world, projectile.id as usize),
        ProjectileCollisionTarget::Player,
    );
    assert!(default_projectile_damage_allowed(
        &world,
        projectile.id as usize,
        enemy.id as usize,
        ProjectileCollisionTarget::Player,
    ));

    world.set_gameplay_faction(
        projectile,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
    );
    world.set_gameplay_faction(
        enemy,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );
    assert!(!default_projectile_damage_allowed(
        &world,
        projectile.id as usize,
        enemy.id as usize,
        ProjectileCollisionTarget::Player,
    ));
}

#[test]
fn default_melee_damage_allowed_checks_optional_faction_gate() {
    use crate::components::gameplay::{
        GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };

    let mut world = World::default();
    let attacker = world.spawn_entity();
    let target = world.spawn_entity();

    assert!(default_melee_damage_allowed(
        &world,
        attacker.id as usize,
        target.id as usize,
    ));

    world.set_gameplay_faction(
        attacker,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 0).unwrap(),
    );
    world.set_gameplay_faction(
        target,
        GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 1 << GAMEPLAY_FACTION_PLAYER).unwrap(),
    );
    assert!(!default_melee_damage_allowed(
        &world,
        attacker.id as usize,
        target.id as usize,
    ));

    world.set_gameplay_faction(
        attacker,
        GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
    );
    assert!(default_melee_damage_allowed(
        &world,
        attacker.id as usize,
        target.id as usize,
    ));
}

#[test]
fn collision_pair_query_helpers_reuse_scratch_and_match_requested_layers() {
    let mut world = World::default();
    let player = world.spawn_player(0.0, 0.0, 1);
    let enemy = world.spawn_enemy(0.0, 0.0, 1);
    let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let mut scratch = CollisionScratch::default();
    let mut pairs = Vec::new();

    build_collision_layer_pairs(
        &mut scratch,
        &world,
        CollisionLayer::Player,
        CollisionLayer::Enemy,
        &mut pairs,
    );
    assert_eq!(
        pairs,
        vec![CollisionPair {
            a: player,
            b: enemy
        }]
    );

    build_swept_collision_layer_pairs(
        &mut scratch,
        &world,
        CollisionLayer::Bullet,
        CollisionLayer::Enemy,
        0.016,
        &mut pairs,
    );
    assert_eq!(
        pairs,
        vec![CollisionPair {
            a: bullet,
            b: enemy
        }]
    );
}

#[test]
fn collision_reaction_pair_for_layer_pair_filters_stale_layer_and_marked_pairs() {
    let mut world = World::default();
    let bullet = world.spawn_bullet(0.0, 0.0, 0.0, 0.0, 1);
    let enemy = world.spawn_enemy(0.0, 0.0, 1);
    let pair = CollisionPair {
        a: bullet,
        b: enemy,
    };
    let mut marked = vec![false; world.entity_capacity()];

    assert_eq!(
        collision_reaction_pair_for_layer_pair(
            &world,
            pair,
            CollisionLayer::Bullet,
            CollisionLayer::Enemy,
            &marked,
        ),
        Some(CollisionReactionPair::new(
            bullet.id as usize,
            enemy.id as usize,
            bullet,
            enemy,
        )),
    );

    marked[bullet.id as usize] = true;
    assert_eq!(
        collision_reaction_pair_for_layer_pair(
            &world,
            pair,
            CollisionLayer::Bullet,
            CollisionLayer::Enemy,
            &marked,
        ),
        None,
    );
    marked[bullet.id as usize] = false;

    assert_eq!(
        collision_reaction_pair_for_layer_pair(
            &world,
            pair,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
            &marked,
        ),
        None,
    );

    world.despawn(bullet);
    assert_eq!(
        collision_reaction_pair_for_layer_pair(
            &world,
            pair,
            CollisionLayer::Bullet,
            CollisionLayer::Enemy,
            &marked,
        ),
        None,
    );
}
