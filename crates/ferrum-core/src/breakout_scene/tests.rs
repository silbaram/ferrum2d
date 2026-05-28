use crate::camera::Camera2D;
use crate::collision_event::{CollisionEventCounts, COLLISION_EVENT_HIT};
use crate::components::{Transform2D, Velocity};
use crate::game_state::GameState;
use crate::input::InputState;
use crate::particles::ParticleSystem;
use crate::world::World;

use super::config::{
    BALL_SPEED, BRICK_HEIGHT, BRICK_HIT_PARTICLE_COUNT, BRICK_SCORE, WORLD_HEIGHT, WORLD_WIDTH,
};
use super::runtime::is_alive;
use super::{breakout_brick_hit_particle_preset, BreakoutParticleBurstSink, BreakoutScene};

#[test]
fn title_level_spawns_breakout_bodies_without_launching_ball() {
    let mut scene = BreakoutScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);

    scene.reset_to_title(&mut world, &mut camera);

    assert_eq!(scene.game_state(), GameState::Title);
    assert_eq!(scene.score(), 0);
    assert_eq!(scene.remaining_bricks(&world), 50);
    assert_eq!(world.alive_count(), 55);
    let ball = scene.ball.expect("title level creates ball");
    assert_eq!(
        world.velocities[ball.id as usize],
        Some(Velocity::default())
    );
}

#[test]
fn action_starts_breakout_and_launches_ball() {
    let mut scene = BreakoutScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);
    scene.reset_to_title(&mut world, &mut camera);

    scene.update(
        &mut world,
        &mut camera,
        InputState {
            enter: 1,
            ..InputState::default()
        },
        0.016,
        &mut Vec::new(),
        &mut CollisionEventCounts::default(),
        None,
    );

    let ball = scene.ball.expect("playing level creates ball");
    let velocity = world.velocities[ball.id as usize].expect("ball has velocity");
    assert_eq!(scene.game_state(), GameState::Playing);
    assert!(velocity.vy < 0.0);
}

#[test]
fn ball_brick_hit_adds_score_and_records_hit_event() {
    let mut scene = BreakoutScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);
    let mut events = Vec::new();
    let mut counts = CollisionEventCounts::default();
    scene.reset_playing(&mut world, &mut camera);
    let ball = scene.ball.expect("playing level creates ball");
    let brick = *scene.bricks.last().expect("level has bricks");
    let brick_transform = world.transforms[brick.id as usize].expect("brick has transform");
    world.transforms[ball.id as usize] = Some(Transform2D {
        x: brick_transform.x,
        y: brick_transform.y + BRICK_HEIGHT,
    });
    world.velocities[ball.id as usize] = Some(Velocity {
        vx: 0.0,
        vy: -BALL_SPEED,
    });

    scene.update(
        &mut world,
        &mut camera,
        InputState::default(),
        0.1,
        &mut events,
        &mut counts,
        None,
    );

    assert_eq!(scene.score(), BRICK_SCORE);
    assert!(!is_alive(&world, brick));
    assert_eq!(counts.hit, 1);
    assert_eq!(events[0].kind, COLLISION_EVENT_HIT);
}

#[test]
fn ball_brick_hit_spawns_particle_burst_when_sink_is_bound() {
    let mut scene = BreakoutScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(WORLD_WIDTH, WORLD_HEIGHT);
    let mut events = Vec::new();
    let mut counts = CollisionEventCounts::default();
    let mut particles = ParticleSystem::with_capacity(BRICK_HIT_PARTICLE_COUNT as usize);
    let mut hit_particles =
        BreakoutParticleBurstSink::new(&mut particles, breakout_brick_hit_particle_preset());
    scene.reset_playing(&mut world, &mut camera);
    let ball = scene.ball.expect("playing level creates ball");
    let brick = *scene.bricks.last().expect("level has bricks");
    let brick_transform = world.transforms[brick.id as usize].expect("brick has transform");
    world.transforms[ball.id as usize] = Some(Transform2D {
        x: brick_transform.x,
        y: brick_transform.y + BRICK_HEIGHT,
    });
    world.velocities[ball.id as usize] = Some(Velocity {
        vx: 0.0,
        vy: -BALL_SPEED,
    });

    scene.update(
        &mut world,
        &mut camera,
        InputState::default(),
        0.1,
        &mut events,
        &mut counts,
        Some(&mut hit_particles),
    );

    assert_eq!(counts.hit, 1);
    assert_eq!(
        particles.particle_count(),
        BRICK_HIT_PARTICLE_COUNT as usize
    );
    assert!(!is_alive(&world, brick));
}
