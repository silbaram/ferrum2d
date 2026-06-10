use std::time::Instant;

use super::*;

const MASS_HORDE_ENEMY_COUNT: usize = 1_000;
const MASS_HORDE_WORLD_WIDTH: f32 = 2_400.0;
const MASS_HORDE_WORLD_HEIGHT: f32 = 1_600.0;
const MASS_HORDE_VIEWPORT_WIDTH: f32 = 2_000.0;
const MASS_HORDE_VIEWPORT_HEIGHT: f32 = 1_200.0;
const MASS_HORDE_COLUMNS: usize = 40;
const MASS_HORDE_SPACING: f32 = 16.0;
const MASS_HORDE_START_X: f32 = 300.0;
const MASS_HORDE_START_Y: f32 = 300.0;
const MASS_HORDE_UPDATE_SECONDS: f64 = 1.0 / 60.0;
const MASS_HORDE_COLLISION_PAIR_BUDGET: u32 = 0;
const MASS_PROJECTILE_COUNT: usize = 512;
const MASS_PROJECTILE_START_Y: f32 = 900.0;
const MASS_PROJECTILE_ROW_SPACING: f32 = 4.0;
const MASS_PROJECTILE_COLLISION_PAIR_BUDGET: u32 = 0;
const MASS_DENSE_ENEMY_COUNT: usize = 128;
const MASS_DENSE_START_X: f32 = 520.0;
const MASS_DENSE_START_Y: f32 = 520.0;

fn start_shooter_playing(engine: &mut Engine) {
    engine.set_input(false, false, false, false, true, false, false, 0.0, 0.0);
    engine.update_frame(0.0, false, false, false);
    engine.set_input(false, false, false, false, false, false, false, 0.0, 0.0);
}

fn configure_mass_horde_engine() -> Engine {
    let mut engine = Engine::new();
    engine.set_shooter_config(
        MASS_HORDE_WORLD_WIDTH,
        MASS_HORDE_WORLD_HEIGHT,
        180.0,
        72.0,
        999.0,
        360.0,
        0.12,
        1.8,
    );
    engine.set_shooter_prefabs(8.0, 8.0, 4.0, 4.0, 2.0, 2.0);
    engine.set_shooter_behavior(EnemyBehavior::Chase as u32);
    engine.set_shooter_spawn_pattern(EnemySpawnPattern::Edge as u32);
    engine.set_viewport_size(MASS_HORDE_VIEWPORT_WIDTH, MASS_HORDE_VIEWPORT_HEIGHT);
    start_shooter_playing(&mut engine);
    engine
}

fn configure_sparse_horde_engine(enemy_count: usize) -> Engine {
    let mut engine = configure_mass_horde_engine();

    for index in 0..enemy_count {
        let column = index % MASS_HORDE_COLUMNS;
        let row = index / MASS_HORDE_COLUMNS;
        let x = MASS_HORDE_START_X + column as f32 * MASS_HORDE_SPACING;
        let y = MASS_HORDE_START_Y + row as f32 * MASS_HORDE_SPACING;
        engine.world.spawn_enemy(x, y, DEFAULT_TEXTURE_ID);
    }

    engine
}

fn configure_dense_lifecycle_horde_engine(enemy_count: usize) -> Engine {
    let mut engine = configure_mass_horde_engine();
    engine.set_collision_lifecycle_events_enabled(true);

    for _ in 0..enemy_count {
        engine
            .world
            .spawn_enemy(MASS_DENSE_START_X, MASS_DENSE_START_Y, DEFAULT_TEXTURE_ID);
    }

    engine
}

fn spawn_projectile_lanes(engine: &mut Engine, projectile_count: usize) {
    for index in 0..projectile_count {
        let column = index % MASS_HORDE_COLUMNS;
        let row = index / MASS_HORDE_COLUMNS;
        let x = MASS_HORDE_START_X + column as f32 * MASS_HORDE_SPACING;
        let y = MASS_PROJECTILE_START_Y + row as f32 * MASS_PROJECTILE_ROW_SPACING;
        engine
            .world
            .spawn_bullet_with_lifetime(x, y, 420.0, 0.0, DEFAULT_TEXTURE_ID, 1.0);
    }
}

fn dense_pair_budget(entity_count: usize) -> u32 {
    (entity_count * (entity_count - 1) / 2) as u32
}

#[test]
fn sparse_visible_horde_updates_one_thousand_enemies_without_pair_growth() {
    let mut engine = configure_sparse_horde_engine(MASS_HORDE_ENEMY_COUNT);
    assert_eq!(
        count_layer(&engine, CollisionLayer::Enemy),
        MASS_HORDE_ENEMY_COUNT
    );

    let started = Instant::now();
    engine.update_frame(MASS_HORDE_UPDATE_SECONDS, true, true, false);
    let update_micros = started.elapsed().as_micros();

    let enemy_count = count_layer(&engine, CollisionLayer::Enemy);
    let entity_count = engine.entity_count();
    let render_commands = engine.render_command_len();
    let collision_pairs = engine.physics_collision_pairs();
    let shooter_collision_pairs = engine.scenes.shooter.last_collision_pair_stats();

    assert_eq!(enemy_count, MASS_HORDE_ENEMY_COUNT);
    assert_eq!(entity_count, MASS_HORDE_ENEMY_COUNT + 1);
    assert!(
        render_commands > MASS_HORDE_ENEMY_COUNT,
        "visible horde should emit at least one render command per player/enemy entity"
    );
    assert_eq!(
        collision_pairs, MASS_HORDE_COLLISION_PAIR_BUDGET,
        "sparse horde layout should not create broad collision pair growth"
    );
    assert_eq!(shooter_collision_pairs.bullet_enemy_swept_pairs, 0);
    assert_eq!(shooter_collision_pairs.bullet_enemy_moving_proxies, 0);
    assert_eq!(
        shooter_collision_pairs.bullet_enemy_target_proxies,
        MASS_HORDE_ENEMY_COUNT
    );
    assert_eq!(shooter_collision_pairs.player_enemy_pairs, 0);
    assert_eq!(
        shooter_collision_pairs.player_enemy_current_proxies,
        MASS_HORDE_ENEMY_COUNT + 1
    );

    println!(
        "MASS_OBJECT_REPORT {{\"scenario\":\"sparse-visible-horde\",\"enemyCount\":{},\"entityCount\":{},\"renderCommandCount\":{},\"collisionPairCount\":{},\"shooterBulletEnemySweptPairCount\":{},\"shooterBulletEnemyMovingProxyCount\":{},\"shooterBulletEnemyTargetProxyCount\":{},\"shooterPlayerEnemyPairCount\":{},\"shooterPlayerEnemyCurrentProxyCount\":{},\"updateMicros\":{}}}",
        enemy_count,
        entity_count,
        render_commands,
        collision_pairs,
        shooter_collision_pairs.bullet_enemy_swept_pairs,
        shooter_collision_pairs.bullet_enemy_moving_proxies,
        shooter_collision_pairs.bullet_enemy_target_proxies,
        shooter_collision_pairs.player_enemy_pairs,
        shooter_collision_pairs.player_enemy_current_proxies,
        update_micros
    );
}

#[test]
fn projectile_lane_horde_updates_projectiles_without_pair_growth() {
    let mut engine = configure_sparse_horde_engine(MASS_HORDE_ENEMY_COUNT);
    spawn_projectile_lanes(&mut engine, MASS_PROJECTILE_COUNT);
    assert_eq!(
        count_layer(&engine, CollisionLayer::Enemy),
        MASS_HORDE_ENEMY_COUNT
    );
    assert_eq!(
        count_layer(&engine, CollisionLayer::Bullet),
        MASS_PROJECTILE_COUNT
    );

    let started = Instant::now();
    engine.update_frame(MASS_HORDE_UPDATE_SECONDS, true, true, false);
    let update_micros = started.elapsed().as_micros();

    let enemy_count = count_layer(&engine, CollisionLayer::Enemy);
    let projectile_count = count_layer(&engine, CollisionLayer::Bullet);
    let entity_count = engine.entity_count();
    let render_commands = engine.render_command_len();
    let collision_pairs = engine.physics_collision_pairs();
    let shooter_collision_pairs = engine.scenes.shooter.last_collision_pair_stats();

    assert_eq!(enemy_count, MASS_HORDE_ENEMY_COUNT);
    assert_eq!(projectile_count, MASS_PROJECTILE_COUNT);
    assert_eq!(
        entity_count,
        MASS_HORDE_ENEMY_COUNT + MASS_PROJECTILE_COUNT + 1
    );
    assert!(
        render_commands > MASS_HORDE_ENEMY_COUNT + MASS_PROJECTILE_COUNT,
        "visible horde projectile lane should emit render commands for player/enemy/projectile entities"
    );
    assert_eq!(
        collision_pairs, MASS_PROJECTILE_COLLISION_PAIR_BUDGET,
        "projectile lane layout should not create broad collision pair growth"
    );
    assert_eq!(shooter_collision_pairs.bullet_enemy_swept_pairs, 0);
    assert_eq!(
        shooter_collision_pairs.bullet_enemy_moving_proxies,
        MASS_PROJECTILE_COUNT
    );
    assert_eq!(
        shooter_collision_pairs.bullet_enemy_target_proxies,
        MASS_HORDE_ENEMY_COUNT
    );
    assert_eq!(shooter_collision_pairs.bullet_player_swept_pairs, 0);
    assert_eq!(
        shooter_collision_pairs.bullet_player_moving_proxies,
        MASS_PROJECTILE_COUNT
    );
    assert_eq!(shooter_collision_pairs.bullet_player_target_proxies, 1);
    assert_eq!(shooter_collision_pairs.player_enemy_pairs, 0);
    assert_eq!(
        shooter_collision_pairs.player_enemy_current_proxies,
        MASS_HORDE_ENEMY_COUNT + MASS_PROJECTILE_COUNT + 1
    );

    println!(
        "MASS_OBJECT_REPORT {{\"scenario\":\"projectile-lane-horde\",\"enemyCount\":{},\"projectileCount\":{},\"entityCount\":{},\"renderCommandCount\":{},\"collisionPairCount\":{},\"shooterBulletEnemySweptPairCount\":{},\"shooterBulletEnemyMovingProxyCount\":{},\"shooterBulletEnemyTargetProxyCount\":{},\"shooterBulletPlayerSweptPairCount\":{},\"shooterBulletPlayerMovingProxyCount\":{},\"shooterBulletPlayerTargetProxyCount\":{},\"shooterPlayerEnemyPairCount\":{},\"shooterPlayerEnemyCurrentProxyCount\":{},\"updateMicros\":{}}}",
        enemy_count,
        projectile_count,
        entity_count,
        render_commands,
        collision_pairs,
        shooter_collision_pairs.bullet_enemy_swept_pairs,
        shooter_collision_pairs.bullet_enemy_moving_proxies,
        shooter_collision_pairs.bullet_enemy_target_proxies,
        shooter_collision_pairs.bullet_player_swept_pairs,
        shooter_collision_pairs.bullet_player_moving_proxies,
        shooter_collision_pairs.bullet_player_target_proxies,
        shooter_collision_pairs.player_enemy_pairs,
        shooter_collision_pairs.player_enemy_current_proxies,
        update_micros
    );
}

#[test]
fn dense_lifecycle_horde_reports_collision_pair_budget() {
    let mut engine = configure_dense_lifecycle_horde_engine(MASS_DENSE_ENEMY_COUNT);
    assert_eq!(
        count_layer(&engine, CollisionLayer::Enemy),
        MASS_DENSE_ENEMY_COUNT
    );

    let started = Instant::now();
    engine.update_frame(MASS_HORDE_UPDATE_SECONDS, true, true, false);
    let update_micros = started.elapsed().as_micros();

    let enemy_count = count_layer(&engine, CollisionLayer::Enemy);
    let entity_count = engine.entity_count();
    let render_commands = engine.render_command_len();
    let collision_pairs = engine.physics_collision_pairs();
    let collision_solid_pairs = engine.physics_collision_solid_pairs();
    let collision_trigger_pairs = engine.physics_collision_trigger_pairs();
    let expected_collision_pairs = dense_pair_budget(MASS_DENSE_ENEMY_COUNT);
    let shooter_collision_pairs = engine.scenes.shooter.last_collision_pair_stats();

    assert_eq!(enemy_count, MASS_DENSE_ENEMY_COUNT);
    assert_eq!(entity_count, MASS_DENSE_ENEMY_COUNT + 1);
    assert!(
        render_commands > MASS_DENSE_ENEMY_COUNT,
        "dense lifecycle horde should emit render commands for player/enemy entities"
    );
    assert_eq!(
        collision_pairs, expected_collision_pairs,
        "dense lifecycle horde should report the expected enemy/enemy pair budget"
    );
    assert_eq!(
        collision_solid_pairs, 0,
        "dense lifecycle horde should not report solid pairs"
    );
    assert_eq!(
        collision_trigger_pairs, expected_collision_pairs,
        "dense lifecycle horde should report all dense enemy/enemy pairs as trigger pairs"
    );
    assert_eq!(shooter_collision_pairs.bullet_enemy_swept_pairs, 0);
    assert_eq!(shooter_collision_pairs.bullet_enemy_moving_proxies, 0);
    assert_eq!(
        shooter_collision_pairs.bullet_enemy_target_proxies,
        MASS_DENSE_ENEMY_COUNT
    );
    assert_eq!(shooter_collision_pairs.player_enemy_pairs, 0);
    assert_eq!(
        shooter_collision_pairs.player_enemy_current_proxies,
        MASS_DENSE_ENEMY_COUNT + 1
    );

    println!(
        "MASS_OBJECT_REPORT {{\"scenario\":\"dense-lifecycle-horde\",\"enemyCount\":{},\"entityCount\":{},\"renderCommandCount\":{},\"collisionPairCount\":{},\"collisionSolidPairCount\":{},\"collisionTriggerPairCount\":{},\"shooterBulletEnemySweptPairCount\":{},\"shooterBulletEnemyMovingProxyCount\":{},\"shooterBulletEnemyTargetProxyCount\":{},\"shooterPlayerEnemyPairCount\":{},\"shooterPlayerEnemyCurrentProxyCount\":{},\"updateMicros\":{}}}",
        enemy_count,
        entity_count,
        render_commands,
        collision_pairs,
        collision_solid_pairs,
        collision_trigger_pairs,
        shooter_collision_pairs.bullet_enemy_swept_pairs,
        shooter_collision_pairs.bullet_enemy_moving_proxies,
        shooter_collision_pairs.bullet_enemy_target_proxies,
        shooter_collision_pairs.player_enemy_pairs,
        shooter_collision_pairs.player_enemy_current_proxies,
        update_micros
    );
}
