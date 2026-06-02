use super::World;
use crate::components::gameplay::{
    ActionBinding, ActionBindingSet, BehaviorStateEnterAction, BehaviorStateMachine,
    BehaviorStateTransition, CollisionReaction, GameplayFaction, GameplayTimerTrigger, Interaction,
    MovementPattern, Pickup,
};
use crate::components::{AngularVelocity, Rotation2D, Transform2D, Velocity};
use crate::entity::Entity;

impl World {
    pub(crate) fn player_entity(&self) -> Option<Entity> {
        let player = self.player?;
        self.valid_index(player)?;
        Some(player)
    }

    pub fn transform(&self, entity: Entity) -> Option<Transform2D> {
        let i = self.valid_index(entity)?;
        self.transforms[i]
    }

    pub fn set_transform(&mut self, entity: Entity, transform: Transform2D) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.transforms[i] = Some(transform);
    }

    pub fn velocity(&self, entity: Entity) -> Option<Velocity> {
        let i = self.valid_index(entity)?;
        self.velocities[i]
    }

    pub fn set_velocity(&mut self, entity: Entity, velocity: Velocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.velocities[i] = Some(velocity);
    }

    pub fn rotation(&self, entity: Entity) -> Option<Rotation2D> {
        let i = self.valid_index(entity)?;
        self.rotations[i]
    }

    pub fn set_rotation(&mut self, entity: Entity, rotation: Rotation2D) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.rotations[i] = Some(rotation);
    }

    pub fn angular_velocity(&self, entity: Entity) -> Option<AngularVelocity> {
        let i = self.valid_index(entity)?;
        self.angular_velocities[i]
    }

    pub fn set_angular_velocity(&mut self, entity: Entity, angular_velocity: AngularVelocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.angular_velocities[i] = Some(angular_velocity);
    }

    #[cfg(test)]
    pub(crate) fn movement_pattern(&self, entity: Entity) -> Option<MovementPattern> {
        let i = self.valid_index(entity)?;
        self.movement_patterns[i]
    }

    pub(crate) fn set_movement_pattern(&mut self, entity: Entity, movement: MovementPattern) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.movement_patterns[i] = Some(movement);
    }

    pub(crate) fn clear_movement_pattern(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.movement_patterns[i] = None;
    }

    #[cfg(test)]
    pub(crate) fn collision_reactions(
        &self,
        entity: Entity,
    ) -> Option<crate::components::gameplay::CollisionReactionSet> {
        let i = self.valid_index(entity)?;
        self.collision_reactions[i]
    }

    pub(crate) fn add_collision_reaction(
        &mut self,
        entity: Entity,
        reaction: CollisionReaction,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        let reactions = self.collision_reactions[i].get_or_insert_with(Default::default);
        reactions.push(reaction)
    }

    pub(crate) fn clear_collision_reactions(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.collision_reactions[i] = None;
    }

    pub(crate) fn gameplay_faction(&self, entity: Entity) -> Option<GameplayFaction> {
        let i = self.valid_index(entity)?;
        self.gameplay_factions[i]
    }

    pub(crate) fn set_gameplay_faction(&mut self, entity: Entity, faction: GameplayFaction) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.gameplay_factions[i] = Some(faction);
    }

    pub(crate) fn clear_gameplay_faction(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.gameplay_factions[i] = None;
    }

    pub(crate) fn tick_collision_reaction_cooldowns(&mut self, delta: f32) {
        for index in self.alive_indices.iter().copied() {
            if let Some(reactions) = self.collision_reactions[index].as_mut() {
                reactions.tick_cooldowns(delta);
            }
        }
    }

    pub(crate) fn action_bindings(&self, entity: Entity) -> Option<ActionBindingSet> {
        let i = self.valid_index(entity)?;
        self.action_bindings[i]
    }

    pub(crate) fn action_binding(&self, entity: Entity, action_id: u32) -> Option<ActionBinding> {
        let i = self.valid_index(entity)?;
        self.action_bindings[i]?.get(action_id)
    }

    pub(crate) fn upsert_action_binding(&mut self, entity: Entity, binding: ActionBinding) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        let bindings = self.action_bindings[i].get_or_insert_with(Default::default);
        bindings.upsert(binding)
    }

    pub(crate) fn tick_action_cooldowns(&mut self, delta: f32) {
        for index in self.alive_indices.iter().copied() {
            if let Some(bindings) = self.action_bindings[index].as_mut() {
                bindings.tick_cooldowns(delta);
            }
        }
    }

    pub(crate) fn commit_action_cooldown_if_ready(
        &mut self,
        entity: Entity,
        action_id: u32,
    ) -> Option<ActionBinding> {
        let i = self.valid_index(entity)?;
        self.action_bindings[i]
            .as_mut()?
            .commit_cooldown_if_ready(action_id)
    }

    pub(crate) fn clear_action_bindings(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.action_bindings[i] = None;
    }

    #[cfg(test)]
    pub(crate) fn behavior_state_machine(&self, entity: Entity) -> Option<BehaviorStateMachine> {
        let i = self.valid_index(entity)?;
        self.behavior_state_machines[i]
    }

    pub(crate) fn set_behavior_state_machine(
        &mut self,
        entity: Entity,
        machine: BehaviorStateMachine,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.behavior_state_machines[i] = Some(machine);
        true
    }

    pub(crate) fn add_behavior_state_transition(
        &mut self,
        entity: Entity,
        transition: BehaviorStateTransition,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        let Some(machine) = self.behavior_state_machines[i].as_mut() else {
            return false;
        };
        machine.push_transition(transition)
    }

    pub(crate) fn clear_behavior_state_machine(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.behavior_state_machines[i] = None;
    }

    #[cfg(test)]
    pub(crate) fn behavior_state_enter_actions(
        &self,
        entity: Entity,
    ) -> Option<crate::components::gameplay::BehaviorStateEnterActionSet> {
        let i = self.valid_index(entity)?;
        self.behavior_state_enter_actions[i]
    }

    pub(crate) fn add_behavior_state_enter_action(
        &mut self,
        entity: Entity,
        action: BehaviorStateEnterAction,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        let mut actions = self.behavior_state_enter_actions[i].unwrap_or_default();
        if !actions.upsert(action) {
            return false;
        }
        self.behavior_state_enter_actions[i] = Some(actions);
        true
    }

    pub(crate) fn clear_behavior_state_enter_actions(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.behavior_state_enter_actions[i] = None;
    }

    #[cfg(test)]
    pub(crate) fn gameplay_timer_trigger(&self, entity: Entity) -> Option<GameplayTimerTrigger> {
        let i = self.valid_index(entity)?;
        self.gameplay_timer_triggers[i]
    }

    pub(crate) fn set_gameplay_timer_trigger(
        &mut self,
        entity: Entity,
        timer: GameplayTimerTrigger,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.gameplay_timer_triggers[i] = Some(timer);
        true
    }

    pub(crate) fn clear_gameplay_timer_trigger(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.gameplay_timer_triggers[i] = None;
    }

    #[cfg(test)]
    pub(crate) fn pickup(&self, entity: Entity) -> Option<Pickup> {
        let i = self.valid_index(entity)?;
        self.pickups[i]
    }

    pub(crate) fn set_pickup(&mut self, entity: Entity, pickup: Pickup) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.pickups[i] = Some(pickup);
        true
    }

    pub(crate) fn clear_pickup(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.pickups[i] = None;
    }

    #[cfg(test)]
    pub(crate) fn interaction(&self, entity: Entity) -> Option<Interaction> {
        let i = self.valid_index(entity)?;
        self.interactions[i]
    }

    pub(crate) fn set_interaction(&mut self, entity: Entity, interaction: Interaction) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.interactions[i] = Some(interaction);
        true
    }

    pub(crate) fn clear_interaction(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.interactions[i] = None;
    }
}
