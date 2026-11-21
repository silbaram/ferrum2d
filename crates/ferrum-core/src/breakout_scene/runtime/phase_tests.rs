use super::*;
use crate::breakout_scene::breakout_brick_hit_particle_preset;
use crate::breakout_scene::config::{BRICK_HIT_PARTICLE_COUNT, PADDLE_Y};
use crate::components::{AabbCollider, CollisionLayer};
use crate::particles::ParticleSystem;

fn playing() -> (BreakoutScene, World, Camera2D) {
    let mut scene = BreakoutScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);
    scene.reset_playing(&mut world, &mut camera);
    (scene, world, camera)
}

#[test]
fn breakout_phases_title_and_restart_launch_without_integrating_same_tick() {
    let (mut scene, mut world, mut camera) = playing();
    for state in [GameState::Title, GameState::GameOver] {
        scene.game_state = state;
        scene.score = 25;
        let previous_ball = scene.ball.unwrap();
        world.set_transform(previous_ball, Transform2D { x: 10.0, y: 20.0 });
        assert!(!scene.prepare_native_tick(
            &mut world,
            &mut camera,
            InputState {
                enter: 1,
                d: 1,
                ..Default::default()
            },
            0.1,
        ));
        let ball = scene.ball.unwrap();
        let paddle = scene.paddle.unwrap();
        assert_eq!(scene.game_state(), GameState::Playing);
        assert_eq!(scene.score(), 0);
        assert!(!world.is_current_entity(previous_ball));
        assert_eq!(
            world.transform(ball),
            Some(Transform2D {
                x: WORLD_WIDTH * 0.5,
                y: PADDLE_Y - 28.0
            })
        );
        assert_eq!(
            world.velocity(ball),
            Some(Velocity {
                vx: BALL_SPEED * 0.55,
                vy: -BALL_SPEED
            })
        );
        assert_eq!(world.transform(paddle).unwrap().x, WORLD_WIDTH * 0.5);
        assert_eq!(world.velocity(paddle), Some(Velocity::default()));
        assert_eq!(world.alive_count(), 55);
    }
}

#[test]
fn breakout_phases_prepare_playing_validates_clock_without_moving_or_writing_input() {
    let (mut scene, mut world, mut camera) = playing();
    let paddle = scene.paddle.unwrap();
    let ball = scene.ball.unwrap();
    let before = (
        world.transform(paddle),
        world.velocity(paddle),
        world.transform(ball),
        world.velocity(ball),
    );
    let input = InputState {
        d: 1,
        ..Default::default()
    };
    assert!(scene.prepare_native_tick(&mut world, &mut camera, input, 0.1));
    for delta in [0.0, -0.1, f32::NAN, f32::INFINITY] {
        assert!(!scene.prepare_native_tick(&mut world, &mut camera, input, delta));
    }
    assert_eq!(
        (
            world.transform(paddle),
            world.velocity(paddle),
            world.transform(ball),
            world.velocity(ball)
        ),
        before
    );
}

#[test]
fn breakout_phases_paddle_plan_clamps_position_but_retains_command_velocity() {
    let (scene, mut world, _) = playing();
    let paddle = scene.paddle.unwrap();
    world.set_transform(
        paddle,
        Transform2D {
            x: 730.0,
            y: PADDLE_Y,
        },
    );
    world.set_movement_pattern(paddle, MovementPattern::TopdownInput { speed: 500.0 });
    let input = InputState {
        d: 1,
        ..Default::default()
    };
    let plan = scene.plan_paddle(&world, input, 0.1).unwrap();
    assert_eq!(plan.entity, paddle);
    assert_eq!(
        plan.start,
        Transform2D {
            x: 730.0,
            y: PADDLE_Y
        }
    );
    assert_eq!(
        plan.end,
        Transform2D {
            x: 740.0,
            y: PADDLE_Y
        }
    );
    assert_eq!(plan.velocity, Velocity { vx: 500.0, vy: 0.0 });
    assert_eq!(world.transform(paddle), Some(plan.start));
    assert_eq!(world.velocity(paddle), Some(Velocity::default()));
    world.colliders[paddle.id as usize]
        .as_mut()
        .unwrap()
        .enabled = false;
    let disabled = scene.plan_paddle(&world, input, 0.1).unwrap();
    assert_eq!(disabled.end, disabled.start);
    assert_eq!(disabled.velocity, plan.velocity);
}

#[test]
fn breakout_phases_manual_paddle_plan_uses_stored_horizontal_command_without_input() {
    let (scene, mut world, _) = playing();
    let paddle = scene.paddle.unwrap();
    let start = Transform2D {
        x: 70.0,
        y: PADDLE_Y,
    };
    world.set_transform(paddle, start);
    world.set_velocity(
        paddle,
        Velocity {
            vx: -500.0,
            vy: 100.0,
        },
    );
    let plan = scene.plan_paddle_from_velocity(&world, 0.1).unwrap();
    assert_eq!(plan.start, start);
    assert_eq!(
        plan.end,
        Transform2D {
            x: 60.0,
            y: PADDLE_Y
        }
    );
    assert_eq!(
        plan.velocity,
        Velocity {
            vx: -500.0,
            vy: 0.0
        }
    );
    assert_eq!(world.transform(paddle), Some(start));
    assert_eq!(
        world.velocity(paddle),
        Some(Velocity {
            vx: -500.0,
            vy: 100.0
        })
    );
}

#[test]
fn breakout_phases_targets_preserve_paddle_wall_brick_and_vector_tie_order() {
    let (scene, mut world, _) = playing();
    let ordered: Vec<_> = scene.native_targets().collect();
    assert_eq!(ordered[0], (scene.paddle.unwrap(), BreakoutHitKind::Paddle));
    assert_eq!(
        &ordered[1..4],
        scene
            .walls
            .iter()
            .copied()
            .map(|entity| (entity, BreakoutHitKind::Wall))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        &ordered[4..],
        scene
            .bricks
            .iter()
            .copied()
            .map(|entity| (entity, BreakoutHitKind::Brick))
            .collect::<Vec<_>>()
    );
    for (entity, _) in &ordered {
        world.set_transform(
            *entity,
            Transform2D {
                x: 10000.0,
                y: 10000.0,
            },
        );
    }
    let paddle = scene.paddle.unwrap();
    let wall = scene.walls[0];
    let brick = scene.bricks[0];
    for (entity, layer) in [
        (paddle, CollisionLayer::Player),
        (wall, CollisionLayer::Wall),
        (brick, CollisionLayer::Enemy),
    ] {
        world.set_transform(entity, Transform2D { x: 50.0, y: 50.0 });
        world.set_aabb_collider(entity, AabbCollider::new(4.0, 4.0, true, layer));
    }
    let ball = scene.ball.unwrap();
    world.set_transform(ball, Transform2D { x: 0.0, y: 50.0 });
    world.set_velocity(
        ball,
        Velocity {
            vx: 1000.0,
            vy: 0.0,
        },
    );
    assert_eq!(
        scene.first_ball_hit(&world, ball, 0.1).unwrap().entity,
        paddle
    );
    world.colliders[paddle.id as usize]
        .as_mut()
        .unwrap()
        .enabled = false;
    assert_eq!(
        scene.first_ball_hit(&world, ball, 0.1).unwrap().entity,
        wall
    );
    world.colliders[wall.id as usize].as_mut().unwrap().enabled = false;
    assert_eq!(
        scene.first_ball_hit(&world, ball, 0.1).unwrap().entity,
        brick
    );
}

#[test]
fn breakout_phases_post_brick_hit_applies_effects_score_and_damage_without_motion() {
    let (mut scene, mut world, mut camera) = playing();
    let ball = scene.ball.unwrap();
    let brick = scene.bricks[0];
    let at = world.transform(brick).unwrap();
    world.set_transform(ball, at);
    world.set_velocity(
        ball,
        Velocity {
            vx: 0.0,
            vy: -BALL_SPEED,
        },
    );
    let mut events = Vec::new();
    let mut counts = CollisionEventCounts::default();
    let mut particles = ParticleSystem::new();
    let mut sink =
        BreakoutParticleBurstSink::new(&mut particles, breakout_brick_hit_particle_preset());
    scene.finish_native_tick(
        &mut world,
        &mut camera,
        Some(BreakoutHit {
            entity: brick,
            kind: BreakoutHitKind::Brick,
            time: 0.5,
            normal_x: 0.0,
            normal_y: 1.0,
        }),
        &mut events,
        &mut counts,
        Some(&mut sink),
    );
    assert_eq!(world.transform(ball), Some(at));
    assert_eq!(
        world.velocity(ball),
        Some(Velocity {
            vx: 0.0,
            vy: BALL_SPEED
        })
    );
    assert!(!world.is_current_entity(brick));
    assert_eq!(scene.score(), BRICK_SCORE);
    assert_eq!(scene.remaining_bricks(&world), 49);
    assert_eq!(counts.hit, 1);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, COLLISION_EVENT_HIT);
    assert_eq!(events[0].a_id, ball.id);
    assert_eq!(events[0].b_id, brick.id);
    assert_eq!(events[0].damage(), 0.0);
    assert_eq!(
        particles.particle_count(),
        BRICK_HIT_PARTICLE_COUNT as usize
    );
}

#[test]
fn breakout_phases_post_paddle_contact_uses_contact_offset_without_motion() {
    let (mut scene, mut world, mut camera) = playing();
    let ball = scene.ball.unwrap();
    let paddle = scene.paddle.unwrap();
    let paddle_at = world.transform(paddle).unwrap();
    let at = Transform2D {
        x: paddle_at.x + 24.0,
        y: paddle_at.y - 14.0,
    };
    world.set_transform(ball, at);
    world.set_velocity(
        ball,
        Velocity {
            vx: 10.0,
            vy: 100.0,
        },
    );
    scene.finish_native_tick(
        &mut world,
        &mut camera,
        Some(BreakoutHit {
            entity: paddle,
            kind: BreakoutHitKind::Paddle,
            time: 0.1,
            normal_x: 0.0,
            normal_y: -1.0,
        }),
        &mut Vec::new(),
        &mut CollisionEventCounts::default(),
        None,
    );
    assert_eq!(world.transform(ball), Some(at));
    assert_eq!(
        world.velocity(ball),
        Some(Velocity {
            vx: BALL_SPEED * 0.5,
            vy: -BALL_SPEED
        })
    );
    assert_eq!(scene.score(), 0);
}

#[test]
fn breakout_phases_post_detects_lost_ball_but_retains_missing_ball_early_return() {
    let (mut scene, mut world, mut camera) = playing();
    let ball = scene.ball.unwrap();
    world.set_transform(
        ball,
        Transform2D {
            x: 400.0,
            y: WORLD_HEIGHT + BALL_SIZE + 1.0,
        },
    );
    scene.finish_native_tick(
        &mut world,
        &mut camera,
        None,
        &mut Vec::new(),
        &mut CollisionEventCounts::default(),
        None,
    );
    assert_eq!(scene.game_state(), GameState::GameOver);
    scene.reset_playing(&mut world, &mut camera);
    let ball = scene.ball.unwrap();
    world.despawn(ball);
    scene.finish_native_tick(
        &mut world,
        &mut camera,
        None,
        &mut Vec::new(),
        &mut CollisionEventCounts::default(),
        None,
    );
    assert_eq!(scene.game_state(), GameState::Playing);
}
