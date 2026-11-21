use super::*;
use crate::components::gameplay::{
    ActionBinding, CollisionReaction, CollisionTarget, SpawnAnchor, SpawnPhase,
};
use crate::components::{CollisionLayer, Velocity};
use crate::gameplay_event::GAMEPLAY_EVENT_COLLISION_DAMAGE;
use crate::input::{INPUT_ACTION_ACTIVATION_PRESSED, INPUT_ACTION_CONTROL_ENTER};
use crate::shooter_scene::{EnemyBehavior, DEFAULT_TEXTURE_ID};

fn playing() -> (ShooterScene, World, Camera2D, Vec<AudioEvent>) {
    let mut scene = ShooterScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(800.0, 480.0);
    let mut audio = Vec::new();
    scene.reset_playing(&mut world, &mut camera, &mut audio);
    scene.game_state = GameState::Playing;
    (scene, world, camera, audio)
}

#[test]
fn shooter_phases_title_press_defers_playing_work_until_next_tick() {
    let (mut scene, mut world, mut camera, mut audio) = playing();
    scene.game_state = GameState::Title;
    let player = world.primary_actor_entity().unwrap();
    let start = world.transform(player).unwrap();
    let input = InputState {
        enter: 1,
        d: 1,
        ..InputState::default()
    };
    let mut events = Vec::new();
    let mut effects = Vec::new();
    let actions = InputActionRegistry::default();
    let tiles = Tilemap::default();
    let timer = scene.enemy_spawn_timer;

    assert!(!scene.pre_physics_with_counters(
        &mut world,
        &mut camera,
        input,
        &actions,
        &mut audio,
        &tiles,
        0.1,
        &mut events,
        &mut effects,
    ));
    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(world.transform(player), Some(start));
    assert_eq!(world.velocity(player), Some(Velocity::default()));
    assert_eq!(scene.enemy_spawn_timer, timer);
    assert!(events.is_empty());
    assert!(effects.is_empty());

    assert!(scene.pre_physics_with_counters(
        &mut world,
        &mut camera,
        input,
        &actions,
        &mut audio,
        &tiles,
        0.1,
        &mut events,
        &mut effects,
    ));
    assert_eq!(world.transform(player), Some(start));
    assert!(world.velocity(player).unwrap().vx > 0.0);
    assert!(scene.enemy_spawn_timer < timer);
}

#[test]
fn shooter_phases_game_over_restart_resets_world_without_running_playing_tick() {
    let (mut scene, mut world, mut camera, mut audio) = playing();
    scene.game_state = GameState::GameOver;
    scene.score = 12;
    world.spawn_enemy(25.0, 25.0, DEFAULT_TEXTURE_ID);
    let input = InputState {
        space: 1,
        d: 1,
        ..InputState::default()
    };
    assert!(!scene.pre_physics_with_counters(
        &mut world,
        &mut camera,
        input,
        &InputActionRegistry::default(),
        &mut audio,
        &Tilemap::default(),
        0.25,
        &mut Vec::new(),
        &mut Vec::new(),
    ));
    let player = world.primary_actor_entity().unwrap();
    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(scene.score(), 0);
    assert_eq!(world.alive_indices().len(), 1);
    assert_eq!(world.velocity(player), Some(Velocity::default()));
    assert_eq!(scene.camera_elapsed_seconds, 0.0);
    assert_eq!(scene.previous_input, input);
    assert_eq!(scene.previous_space, 1);
}

#[test]
fn shooter_phases_prepare_intent_then_react_to_integrated_bullet_once() {
    for authored in [false, true] {
        let (mut scene, mut world, mut camera, mut audio) = playing();
        scene.set_enemy_behavior(&mut world, &mut camera, &mut audio, EnemyBehavior::Static);
        let player = world.primary_actor_entity().unwrap();
        let start = world.transform(player).unwrap();
        let bullet = world.spawn_bullet(0.0, 50.0, 1000.0, 0.0, DEFAULT_TEXTURE_ID);
        let enemy = world.spawn_enemy(50.0, 50.0, DEFAULT_TEXTURE_ID);
        if authored {
            assert!(world.add_collision_reaction(
                bullet,
                CollisionReaction::Damage {
                    target: CollisionTarget::OtherEntity
                },
            ));
            assert!(world.add_collision_reaction(
                bullet,
                CollisionReaction::Despawn {
                    target: CollisionTarget::SelfEntity
                },
            ));
        }

        let mut events = Vec::new();
        let mut effects = Vec::new();
        assert!(scene.pre_physics_with_counters(
            &mut world,
            &mut camera,
            InputState {
                d: 1,
                ..InputState::default()
            },
            &InputActionRegistry::default(),
            &mut audio,
            &Tilemap::default(),
            0.1,
            &mut events,
            &mut effects,
        ));
        assert_eq!(world.transform(player), Some(start));
        assert_eq!(world.transform(bullet).unwrap().x, 0.0);
        assert!(world.is_current_entity(enemy));
        assert_eq!(scene.score(), 0);
        assert!(events.is_empty());

        world.update(0.1);
        let moved_player = world.transform(player).unwrap();
        let mut collision_events = Vec::new();
        let mut counts = CollisionEventCounts::default();
        scene.post_physics_with_counters(
            &mut world,
            &mut camera,
            &mut audio,
            &Tilemap::default(),
            0.1,
            false,
            &mut PhysicsCounters::default(),
            &mut collision_events,
            &mut counts,
            &mut events,
            &mut effects,
            None,
            None,
        );
        assert_eq!(world.transform(player), Some(moved_player));
        assert!(!world.is_current_entity(bullet));
        assert!(!world.is_current_entity(enemy));
        assert_eq!(scene.score(), 1);
        assert_eq!(counts.hit, 1);
        assert_eq!(collision_events.len(), 1);
        assert_eq!(
            events
                .iter()
                .filter(|e| e.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE)
                .count(),
            usize::from(authored)
        );
        // The default Shooter hit emits the collision hit buffer only; authored
        // reactions additionally emit gameplay damage and despawn events.
        assert_eq!(events.len(), if authored { 2 } else { 0 });
        if authored {
            let damage = events
                .iter()
                .find(|event| event.kind == GAMEPLAY_EVENT_COLLISION_DAMAGE)
                .unwrap();
            assert_eq!((damage.actor_id, damage.source_id), (enemy.id, bullet.id));
            assert_eq!(damage.payload_bits, 1.0_f32.to_bits());
        }
    }
}

#[test]
fn shooter_phases_pressed_action_uses_previous_pre_tick_input() {
    let (mut scene, mut world, mut camera, mut audio) = playing();
    let player = world.primary_actor_entity().unwrap();
    assert!(world.upsert_action_binding(
        player,
        ActionBinding::spawn_prefab(
            11,
            0.0,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            64.0,
            0.0,
        ),
    ));
    let mut actions = InputActionRegistry::empty();
    assert!(actions.set_binding(
        11,
        0,
        INPUT_ACTION_CONTROL_ENTER,
        INPUT_ACTION_ACTIVATION_PRESSED
    ));
    let pressed = InputState {
        enter: 1,
        ..InputState::default()
    };
    let mut events = Vec::new();
    let mut effects = Vec::new();
    for input in [pressed, pressed, InputState::default(), pressed] {
        assert!(scene.pre_physics_with_counters(
            &mut world,
            &mut camera,
            input,
            &actions,
            &mut audio,
            &Tilemap::default(),
            0.01,
            &mut events,
            &mut effects,
        ));
    }
    let enemies = world
        .alive_indices()
        .iter()
        .filter(|&&i| world.collider_layer_at(i) == Some(CollisionLayer::Enemy))
        .count();
    assert_eq!(enemies, 2);
    assert_eq!(events.len(), 2);
}

#[test]
fn shooter_phases_native_post_skips_legacy_tile_correction() {
    let (mut scene, mut world, mut camera, mut audio) = playing();
    let player = world.primary_actor_entity().unwrap();
    let overlapping = Transform2D { x: 60.0, y: 32.0 };
    world.set_transform(player, overlapping);
    let mut tiles = Tilemap::default();
    tiles.set_layer(0, 2, 1, 64.0, 64.0, 0.0, 0.0, true, vec![0, 1]);
    scene.post_physics_internal(
        &mut world,
        &mut camera,
        &mut audio,
        &tiles,
        0.0,
        false,
        ShooterRuntimeSinks::default(),
    );
    assert_eq!(world.transform(player), Some(overlapping));
    scene.post_physics_internal(
        &mut world,
        &mut camera,
        &mut audio,
        &tiles,
        0.0,
        true,
        ShooterRuntimeSinks::default(),
    );
    assert!(world.transform(player).unwrap().x < overlapping.x);
}
