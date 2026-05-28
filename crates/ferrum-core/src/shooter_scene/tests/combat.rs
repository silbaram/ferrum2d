use super::*;

#[test]
fn bullet_lifetime_despawns() {
    let (mut scene, mut world, _, _) = playing_scene();
    let b = world.spawn_bullet(30.0, 30.0, 10.0, 0.0, DEFAULT_TEXTURE_ID);

    scene.update_bullets(&mut world, crate::world::BULLET_LIFETIME + 0.1);

    assert!(!world.alive[b.id as usize]);
}

#[test]
fn bullet_enemy_collision_increments_score() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);

    scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn fast_bullet_enemy_collision_uses_swept_physics() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(0.0, 50.0, 1000.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(50.0, 50.0, DEFAULT_TEXTURE_ID);

    world.update(0.1);
    assert!(!CollisionSystem::overlaps(
        world.transforms[b.id as usize].unwrap(),
        world.colliders[b.id as usize].unwrap(),
        world.transforms[e.id as usize].unwrap(),
        world.colliders[e.id as usize].unwrap(),
    ));

    scene.handle_collisions(&mut world, &mut audio_events, 0.1, None, None, None);

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn bullet_damage_reduces_enemy_health_before_death() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 3.0, 1.0, 5);
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy_from_template(
        52.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );

    scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

    assert!(!world.alive[b.id as usize]);
    assert!(world.alive[e.id as usize]);
    assert_eq!(world.healths[e.id as usize], Some(2.0));
    assert_eq!(scene.score(), 0);
}

#[test]
fn score_reward_is_added_when_enemy_dies() {
    let (mut scene, mut world, mut camera, mut audio_events) = playing_scene();
    scene.set_combat(&mut world, &mut camera, &mut audio_events, 2.0, 2.0, 7);
    let b = world.spawn_bullet_from_template(
        Transform2D { x: 50.0, y: 50.0 },
        Velocity::default(),
        DEFAULT_TEXTURE_ID,
        DEFAULT_BULLET_LIFETIME,
        scene.config.bullet_template,
        scene.config.bullet_damage,
    );
    let e = world.spawn_enemy_from_template(
        52.0,
        50.0,
        DEFAULT_TEXTURE_ID,
        scene.config.enemy_template,
        scene.config.enemy_health,
        scene.config.score_reward,
    );

    scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 7);
}

#[test]
fn one_bullet_scores_once_when_overlapping_multiple_enemies() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let first_enemy = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    let second_enemy = world.spawn_enemy(54.0, 50.0, DEFAULT_TEXTURE_ID);

    scene.handle_collisions(&mut world, &mut audio_events, 0.0, None, None, None);

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[first_enemy.id as usize]);
    assert!(world.alive[second_enemy.id as usize]);
    assert_eq!(scene.score(), 1);
}
