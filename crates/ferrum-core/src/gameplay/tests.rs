use super::*;
use crate::components::gameplay::{
    ActionAimSource, ActionBinding, BehaviorStateMachine, BehaviorStateTransition,
    CollisionReactionTrigger, Cooldown, GameplayTimerTrigger, MeleeTarget, MovementPattern,
    MovementTarget, Pickup, ProjectileActionConfig, ProjectileCollisionTarget,
    ProjectileTileImpact, SpawnAnchor, SpawnPhase,
};
use crate::components::AabbCollider;
use crate::gameplay_event::{
    GameplayTileImpactEventPayload, GAMEPLAY_EVENT_PICKUP_COLLECTED, GAMEPLAY_EVENT_TILE_IMPACT,
    GAMEPLAY_EVENT_TIMER,
};
use crate::input::{
    INPUT_ACTION_ACTIVATION_DOWN, INPUT_ACTION_ACTIVATION_PRESSED, INPUT_ACTION_CONTROL_ENTER,
};

fn prepared_action(entity: Entity, binding: ActionBinding) -> PreparedAction {
    PreparedAction::new(
        entity,
        binding.action_id,
        ActionPatternKind::from_pattern(binding.pattern),
        binding,
    )
}
mod actions;
mod behavior;
mod lifecycle;
mod movement;
mod reactions;
mod timers;
