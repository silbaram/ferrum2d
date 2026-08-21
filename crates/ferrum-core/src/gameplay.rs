use crate::collision::{CircleQueryHit, CollisionPair, CollisionScratch, CollisionSystem};
use crate::components::gameplay::{
    ActionAimSource, ActionBinding, ActionPattern, CollisionReaction, CollisionReactionSet,
    CollisionTarget, GameplayFaction, GameplayTimerTrigger, MeleeTarget, MovementPattern,
    MovementTarget, ProjectileCollisionTarget, ProjectileTileImpact, SpawnAnchor, SpawnPhase,
    SpawnPrefabProjectilePayload, GAMEPLAY_PICKUP_ITEM_SCORE, MAX_COLLISION_REACTIONS_PER_ENTITY,
};
use crate::components::{
    AabbCollider, CollisionLayer, CollisionMask, HeightSpan, ProjectileArc, Transform2D, Velocity,
};
use crate::entity::Entity;
use crate::gameplay_event::{
    GameplayEvent, GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT, GAMEPLAY_ACTION_FAILURE_COOLING_DOWN,
    GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING, GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM, GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
    GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
};
use crate::input::{InputActionRegistry, InputState};
use crate::tilemap::{Tilemap, TilemapContactHit};
use crate::world::{EntityTemplate, ProjectileSpawnRequest, World};

mod actions;
mod behavior;
mod lifecycle;
mod movement;
mod reactions;
mod timers;
mod variables;

pub(crate) use actions::*;
pub(crate) use behavior::*;
pub(crate) use lifecycle::*;
pub(crate) use movement::*;
pub(crate) use reactions::*;
pub(crate) use timers::*;
pub(crate) use variables::*;

#[cfg(test)]
mod tests;
