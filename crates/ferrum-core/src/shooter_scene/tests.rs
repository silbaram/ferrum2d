use super::*;
use crate::audio_event::AUDIO_CHANNEL_SFX;
use crate::collision::CollisionSystem;
use crate::components::{CollisionLayer, PhysicsMaterial, Transform2D, Velocity};
use crate::input::InputState;
use crate::tilemap::Tilemap;
use crate::world::EntityTemplateColliderShape;

mod audio_events;
mod combat;
mod config_prefabs;
mod enemy_behaviors;
mod state_player;
mod waves;

fn playing_scene() -> (ShooterScene, World, Camera2D, Vec<AudioEvent>) {
    let mut scene = ShooterScene::new();
    let mut world = World::default();
    let mut camera = Camera2D::new(800.0, 480.0);
    let mut audio_events = Vec::new();
    scene.reset_playing(&mut world, &mut camera, &mut audio_events);
    scene.game_state = GameState::Playing;
    (scene, world, camera, audio_events)
}

fn count_layer(world: &World, layer: CollisionLayer) -> usize {
    world
        .alive
        .iter()
        .enumerate()
        .filter(|(idx, alive)| **alive && world.collider_layer_at(*idx) == Some(layer))
        .count()
}
