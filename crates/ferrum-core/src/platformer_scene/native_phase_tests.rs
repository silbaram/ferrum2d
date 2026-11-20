use super::*;
use crate::physics::{GroundProbeHit, KinematicMoveResult};

fn playing() -> (PlatformerScene, World, Camera2D) {
    let mut scene = PlatformerScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(800.0, 480.0);
    scene.reset_playing(&mut world, &mut camera);
    (scene, world, camera)
}

fn grounded_result(at: Transform2D) -> PlatformerControllerResult {
    PlatformerControllerResult {
        movement: KinematicMoveResult {
            start: at,
            end: at,
            requested: Velocity::default(),
            remaining: Velocity::default(),
            hit_count: 1,
            blocked_x: false,
            blocked_y: true,
            last_hit: None,
        },
        velocity: Velocity::default(),
        ground_before: None,
        ground_after: Some(GroundProbeHit {
            entity: None,
            tile_layer_index: None,
            tile_index: None,
            distance: 0.0,
            normal_x: 0.0,
            normal_y: -1.0,
        }),
        jumped: false,
        grounded: true,
    }
}

#[test]
fn platformer_phases_title_held_jump_does_not_autojump_and_all_states_observe_hold() {
    let (mut scene, mut world, mut camera) = playing();
    scene.reset_to_title(&mut world, &mut camera);
    let before = scene.player.unwrap();
    let held = InputState {
        space: 1,
        d: 1,
        ..Default::default()
    };
    assert_eq!(
        scene.prepare_native_tick(&mut world, &mut camera, held, 0.1),
        None
    );
    assert_eq!(scene.game_state(), GameState::Playing);
    assert!(!world.is_current_entity(before));
    let player = scene.player.unwrap();
    let start = world.transform(player);
    assert_eq!(world.velocity(player), Some(Velocity::default()));
    assert_eq!(scene.elapsed_play_seconds, 0.0);
    assert_eq!(scene.moving_platform_phase, 0.0);
    assert_eq!(
        scene.prepare_native_tick(&mut world, &mut camera, held, 0.1),
        Some(PlatformerControllerInput::new(1.0, false))
    );
    assert_eq!(world.transform(player), start);
    for state in [GameState::Paused, GameState::LevelComplete] {
        scene.game_state = state;
        scene.jump_was_down = false;
        assert_eq!(
            scene.prepare_native_tick(&mut world, &mut camera, held, 0.1),
            None
        );
        assert!(scene.jump_was_down);
    }
    scene.game_state = GameState::Playing;
    assert_eq!(
        scene.prepare_native_tick(&mut world, &mut camera, InputState::default(), f32::NAN),
        None
    );
    assert!(!scene.jump_was_down);
    assert_eq!(
        scene.prepare_native_tick(&mut world, &mut camera, held, 0.1),
        Some(PlatformerControllerInput::new(1.0, true))
    );
    assert_eq!(scene.score(), 0);
    assert_eq!(world.transform(player), start);
}

#[test]
fn platformer_phases_plan_retains_queued_input_without_resampling_or_consuming_state() {
    let (mut scene, mut world, mut camera) = playing();
    scene.controller_state = PlatformerControllerState {
        coyote_time_remaining: 0.04,
        jump_buffer_remaining: 0.03,
    };
    let input = scene
        .prepare_native_tick(
            &mut world,
            &mut camera,
            InputState {
                a: 1,
                space: 1,
                ..Default::default()
            },
            0.1,
        )
        .unwrap();
    assert_eq!(input, PlatformerControllerInput::new(-1.0, true));
    let player = scene.player.unwrap();
    let player_at = world.transform(player);
    let platform_at = world.transform(scene.moving_platform.unwrap());
    let first = scene.plan_native_step(&world, 0.1, input);
    let again = scene.plan_native_step(&world, 0.1, input);
    assert_eq!(first, again);
    assert_eq!(first.input, input);
    assert_eq!(first.state, scene.controller_state);
    assert_eq!(scene.controller_state.jump_buffer_remaining, 0.03);
    assert_eq!(scene.controller_state.coyote_time_remaining, 0.04);
    assert_eq!(scene.elapsed_play_seconds, 0.0);
    assert_eq!(scene.score(), 0);
    assert_eq!(world.transform(player), player_at);
    assert_eq!(world.transform(scene.moving_platform.unwrap()), platform_at);
}

#[test]
fn platformer_phases_plan_uses_authored_tuning_reverse_path_and_masks_without_motion() {
    let (mut scene, mut world, _) = playing();
    let player = scene.player.unwrap();
    let platform = scene.moving_platform_entity().unwrap();
    let tuning = PlatformerControllerTuning {
        horizontal_speed: 123.0,
        gravity: 600.0,
        jump_speed: 300.0,
        max_fall_speed: 500.0,
        ground_probe_distance: 1.25,
        step_offset: 7.0,
        coyote_time_seconds: 0.12,
        jump_buffer_seconds: 0.15,
    };
    world.set_movement_pattern(player, platformer_input_movement(tuning));
    world.set_movement_pattern(
        platform,
        MovementPattern::Oscillate {
            origin_x: 800.0,
            origin_y: 480.0,
            amplitude_x: 50.0,
            amplitude_y: -20.0,
            phase_speed: -2.0,
        },
    );
    scene.moving_platform_phase = 0.3;
    scene.elapsed_play_seconds = 0.95;
    let before = world.transform(platform).unwrap();
    let plan = scene.plan_native_step(&world, 0.1, PlatformerControllerInput::new(0.5, false));
    let movement = plan.platform.unwrap();
    let phase = (0.3_f32 - 0.2).rem_euclid(TAU);
    assert_eq!(movement.entity, platform);
    assert_eq!(movement.start, before);
    assert!((movement.end.x - (800.0 + phase.sin() * 50.0)).abs() < 0.0001);
    assert!((movement.end.y - (480.0 - phase.sin() * 20.0)).abs() < 0.0001);
    assert_eq!(plan.config, platformer_config(tuning));
    assert_eq!(
        plan.config.solid_mask,
        CollisionMask::WALL.union(CollisionMask::ENEMY)
    );
    assert_eq!(
        plan.config.one_way_platforms.platform_mask,
        CollisionMask::ENEMY
    );
    assert_eq!(plan.config.max_iterations, 4);
    assert!((plan.elapsed_play_seconds - 1.05).abs() < 0.0001);
    assert_eq!(world.transform(platform), Some(before));
    assert_eq!(scene.moving_platform_phase, 0.3);
    assert_eq!(scene.elapsed_play_seconds, 0.95);
}

#[test]
fn platformer_phases_finish_commits_score_state_and_authored_landing_once_without_motion() {
    for authored in [false, true] {
        let (mut scene, mut world, mut camera) = playing();
        let player = scene.player.unwrap();
        let platform = scene.moving_platform.unwrap();
        let at = world.transform(player).unwrap();
        let platform_at = world.transform(platform);
        if !authored {
            world.clear_collision_reactions(player);
        }
        let mut particles = ParticleSystem::with_capacity(64);
        let state = PlatformerControllerState {
            coyote_time_remaining: 0.08,
            jump_buffer_remaining: 0.02,
        };
        let first = scene.plan_native_step(&world, 0.6, PlatformerControllerInput::new(0.0, false));
        let mut sink = PlatformerParticleBurstSink::new(
            &mut particles,
            platformer_landing_dust_particle_preset(),
        );
        scene.finish_native_tick(
            &mut world,
            &mut camera,
            first,
            state,
            Some(grounded_result(at)),
            Some(&mut sink),
        );
        assert!(scene.player_was_grounded);
        assert_eq!(scene.controller_state, state);
        assert_eq!(scene.score(), 0);
        let next = scene.plan_native_step(&world, 0.5, PlatformerControllerInput::new(0.0, false));
        scene.finish_native_tick(
            &mut world,
            &mut camera,
            next,
            state,
            Some(grounded_result(at)),
            Some(&mut sink),
        );
        assert_eq!(scene.score(), 1);
        assert_eq!(scene.elapsed_play_seconds, 1.1);
        assert_eq!(world.transform(player), Some(at));
        assert_eq!(world.transform(platform), platform_at);
        assert_eq!(
            particles.particle_count(),
            if authored {
                LANDING_DUST_PARTICLE_COUNT as usize
            } else {
                0
            }
        );
    }
}

#[test]
fn platformer_phases_missing_entities_preserve_path_phase_and_clear_grounded_state() {
    let (mut scene, mut world, mut camera) = playing();
    scene.moving_platform_phase = 1.25;
    scene.player_was_grounded = true;
    let player = scene.player.unwrap();
    let platform = scene.moving_platform.unwrap();
    world.despawn(player);
    world.despawn(platform);
    let plan = scene.plan_native_step(&world, 0.1, PlatformerControllerInput::new(1.0, true));
    assert_eq!(plan.player, None);
    assert_eq!(plan.platform, None);
    assert_eq!(
        plan.config,
        platformer_config(PlatformerControllerTuning::default())
    );
    assert_eq!(plan.moving_platform_phase, 1.25);
    scene.finish_native_tick(&mut world, &mut camera, plan, plan.state, None, None);
    assert!(!scene.player_was_grounded);
    assert_eq!(scene.moving_platform_phase, 1.25);
    assert_eq!(scene.elapsed_play_seconds, 0.1);
    assert_eq!(scene.game_state(), GameState::Playing);
}

#[test]
fn platformer_phases_loss_and_restart_reset_timers_controller_and_jump_edge() {
    let (mut scene, mut world, mut camera) = playing();
    let player = scene.player.unwrap();
    world.set_transform(
        player,
        Transform2D {
            x: 96.0,
            y: WORLD_HEIGHT + PLAYER_HEIGHT * 2.0 + 1.0,
        },
    );
    scene.elapsed_play_seconds = 4.95;
    scene.controller_state = PlatformerControllerState {
        coyote_time_remaining: 0.07,
        jump_buffer_remaining: 0.04,
    };
    let plan = scene.plan_native_step(&world, 0.1, PlatformerControllerInput::new(0.0, false));
    scene.finish_native_tick(&mut world, &mut camera, plan, plan.state, None, None);
    assert_eq!(scene.game_state(), GameState::GameOver);
    assert_eq!(scene.score(), 5);
    assert_eq!(
        scene.prepare_native_tick(
            &mut world,
            &mut camera,
            InputState {
                space: 1,
                ..Default::default()
            },
            0.1
        ),
        None
    );
    assert_eq!(scene.game_state(), GameState::Playing);
    assert_eq!(scene.score(), 0);
    assert_eq!(scene.elapsed_play_seconds, 0.0);
    assert_eq!(scene.controller_state, PlatformerControllerState::new());
    assert_eq!(scene.moving_platform_phase, 0.0);
    assert!(!scene.player_was_grounded);
    assert!(scene.jump_was_down);
    assert!(!world.is_current_entity(player));
    assert_eq!(
        world.velocity(scene.player.unwrap()),
        Some(Velocity::default())
    );
    assert_eq!(
        scene.prepare_native_tick(
            &mut world,
            &mut camera,
            InputState {
                space: 1,
                ..Default::default()
            },
            0.1
        ),
        Some(PlatformerControllerInput::new(0.0, false))
    );
}
