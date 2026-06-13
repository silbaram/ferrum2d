use super::*;
use crate::audio_event::AUDIO_CHANNEL_SFX;
use crate::collision::CollisionSystem;
use crate::components::gameplay::{
    ActionAimSource, ActionBinding, CollisionReaction, CollisionReactionTrigger, CollisionTarget,
    Cooldown, GameplayFaction, MeleeTarget, MovementPattern, MovementTarget, Pickup,
    ProjectileActionConfig, ProjectileCollisionTarget, ProjectileTileImpact, SpawnAnchor,
    SpawnPhase, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_NEUTRAL, GAMEPLAY_FACTION_PLAYER,
    GAMEPLAY_PICKUP_ITEM_SCORE,
};
use crate::components::{
    AabbCollider, CollisionLayer, HeightSpan, PhysicsFloorId, PhysicsMaterial, ProjectileArc,
    Transform2D, Velocity,
};
use crate::gameplay_event::{
    GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT, GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
    GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH, GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB, GAMEPLAY_EVENT_ACTION_FAILED,
    GAMEPLAY_EVENT_COLLISION_DAMAGE, GAMEPLAY_EVENT_COLLISION_DESPAWN,
    GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED, GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
    GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED, GAMEPLAY_EVENT_PICKUP_COLLECTED,
    GAMEPLAY_EVENT_PREFAB_SPAWNED, GAMEPLAY_EVENT_PRESENTATION_EFFECT, GAMEPLAY_EVENT_TILE_IMPACT,
    GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X, GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT,
    GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE, GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
};
use crate::input::{
    InputActionRegistry, InputState, INPUT_ACTION_ACTIVATION_PRESSED, INPUT_ACTION_CONTROL_ENTER,
};
use crate::particles::{ParticlePreset, ParticleSystem};
use crate::tilemap::{Hd2dTileKind, Tilemap};
use crate::tweens::TweenSystem;
use crate::world::EntityTemplateColliderShape;

use super::runtime::{CollisionEventSink, GameplayEventSink, TweenSink};

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
        .alive_indices()
        .iter()
        .filter(|&&idx| world.collider_layer_at(idx) == Some(layer))
        .count()
}
