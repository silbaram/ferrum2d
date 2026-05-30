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

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );

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

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.1,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn bullet_enemy_collision_requires_overlapping_height_span_when_authored() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.set_height_span(b, HeightSpan::new(PhysicsFloorId(1), 16.0, 2.0).unwrap(),));
    assert!(world.set_height_span(e, HeightSpan::new(PhysicsFloorId(1), 0.0, 8.0).unwrap(),));

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );

    assert!(world.alive[b.id as usize]);
    assert!(world.alive[e.id as usize]);
    assert_eq!(scene.score(), 0);

    assert!(world.set_height_span(b, HeightSpan::new(PhysicsFloorId(1), 6.0, 2.0).unwrap(),));
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn projectile_arc_updates_bullet_height_span_before_combat() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let b = world.spawn_bullet(50.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    let e = world.spawn_enemy(52.0, 50.0, DEFAULT_TEXTURE_ID);
    assert!(world.set_height_span(e, HeightSpan::new(PhysicsFloorId(1), 8.0, 4.0).unwrap(),));
    assert!(world.set_projectile_arc(
        b,
        ProjectileArc::new(PhysicsFloorId(1), 0.0, 0.0, 100.0, 0.0, 1.0).unwrap(),
    ));

    scene.update_bullets(&mut world, 0.1);
    assert_eq!(
        world.height_span(b),
        HeightSpan::new(PhysicsFloorId(1), 10.0, 1.0),
    );
    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );

    assert!(!world.alive[b.id as usize]);
    assert!(!world.alive[e.id as usize]);
    assert_eq!(scene.score(), 1);
}

#[test]
fn bullet_is_despawned_by_projectile_blocking_tile() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    let tilemap = projectile_tilemap(true, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
}

#[test]
fn bullet_ignores_tiles_that_do_not_block_projectiles() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(40.0, 50.0, 200.0, 0.0, DEFAULT_TEXTURE_ID);
    let tilemap = projectile_tilemap(false, None);

    world.update(0.1);
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.1,
        None,
        None,
        None,
    );

    assert!(world.alive[bullet.id as usize]);
}

#[test]
fn bullet_tile_collision_requires_overlapping_height_span_when_authored() {
    let (mut scene, mut world, _, mut audio_events) = playing_scene();
    let bullet = world.spawn_bullet(60.0, 50.0, 0.0, 0.0, DEFAULT_TEXTURE_ID);
    assert!(world.set_height_span(
        bullet,
        HeightSpan::new(PhysicsFloorId(2), 0.0, 4.0).unwrap(),
    ));
    let mut tilemap = projectile_tilemap(true, HeightSpan::new(PhysicsFloorId(1), 0.0, 8.0));

    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );
    assert!(world.alive[bullet.id as usize]);

    assert!(tilemap.set_tile_height_span_definition(1, 2, 0.0, 8.0));
    scene.handle_collisions(
        &mut world,
        &tilemap,
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );
    assert!(!world.alive[bullet.id as usize]);
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

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );

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

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );

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

    scene.handle_collisions(
        &mut world,
        &Tilemap::default(),
        &mut audio_events,
        0.0,
        None,
        None,
        None,
    );

    assert!(!world.alive[bullet.id as usize]);
    assert!(!world.alive[first_enemy.id as usize]);
    assert!(world.alive[second_enemy.id as usize]);
    assert_eq!(scene.score(), 1);
}

fn projectile_tilemap(blocks_projectile: bool, height_span: Option<HeightSpan>) -> Tilemap {
    let mut tilemap = Tilemap::default();
    tilemap.set_tile_definition(1, 7, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
    if !blocks_projectile {
        assert!(tilemap.set_tile_hd2d_definition(
            1,
            Hd2dTileKind::Flat.code(),
            true,
            false,
            true,
            height_span.map_or(0.0, |span| span.height),
            false,
            0,
            0.0,
            0.0,
        ));
    }
    if let Some(span) = height_span {
        assert!(tilemap.set_tile_height_span_definition(
            1,
            span.floor.0,
            span.elevation,
            span.height,
        ));
    }
    tilemap.set_layer(0, 1, 1, 32.0, 32.0, 48.0, 34.0, true, vec![1]);
    tilemap
}
