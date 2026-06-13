use super::World;
use crate::components::gameplay::{
    ActionBinding, ActionBindingSet, BehaviorStateEnterAction, BehaviorStateMachine,
    BehaviorStateTransition, CollisionReaction, CollisionReactionSet, FactionRelation,
    FactionRelationTable, GameplayFaction, GameplayTags, GameplayTimerTrigger, Interaction,
    MovementPattern, Pickup,
};
use crate::components::{AngularVelocity, Rotation2D, Sprite, Transform2D, Velocity};
use crate::entity::Entity;

impl World {
    pub(crate) fn player_entity(&self) -> Option<Entity> {
        let player = self.player?;
        self.valid_index(player)?;
        Some(player)
    }

    #[cfg(test)]
    pub(crate) fn set_raw_player_entity_for_test(&mut self, player: Option<Entity>) {
        self.player = player;
    }

    pub fn transform(&self, entity: Entity) -> Option<Transform2D> {
        let i = self.valid_index(entity)?;
        self.transforms[i]
    }

    pub(crate) fn transform_at_index(&self, index: usize) -> Option<Transform2D> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.transforms.get(index).copied().flatten()
    }

    pub(crate) fn renderable_sprite_at_index(&self, index: usize) -> Option<(Transform2D, Sprite)> {
        if !self.is_alive_index(index) {
            return None;
        }
        let transform = self.transforms.get(index).copied().flatten()?;
        let sprite = self.sprites.get(index).copied().flatten()?;
        Some((transform, sprite))
    }

    pub(crate) fn sprite_at_index(&self, index: usize) -> Option<Sprite> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.sprites.get(index).copied().flatten()
    }

    pub(crate) fn sprite_mut_at_index(&mut self, index: usize) -> Option<&mut Sprite> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.sprites.get_mut(index)?.as_mut()
    }

    pub(crate) fn transform_mut_at_index(&mut self, index: usize) -> Option<&mut Transform2D> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.transforms.get_mut(index)?.as_mut()
    }

    pub(crate) fn set_transform_at_index(&mut self, index: usize, transform: Transform2D) -> bool {
        if !self.is_alive_index(index) {
            return false;
        }
        let Some(slot) = self.transforms.get_mut(index) else {
            return false;
        };
        *slot = Some(transform);
        true
    }

    #[cfg(test)]
    pub(crate) fn clear_transform_for_test(&mut self, entity: Entity) -> bool {
        let Some(index) = self.valid_index(entity) else {
            return false;
        };
        self.transforms[index] = None;
        true
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

    pub(crate) fn velocity_at_index(&self, index: usize) -> Option<Velocity> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.velocities.get(index).copied().flatten()
    }

    pub(crate) fn velocity_at_index_or_default(&self, index: usize) -> Velocity {
        self.velocity_at_index(index).unwrap_or_default()
    }

    pub fn set_velocity(&mut self, entity: Entity, velocity: Velocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.velocities[i] = Some(velocity);
    }

    pub(crate) fn set_velocity_at_index(&mut self, index: usize, velocity: Velocity) -> bool {
        if !self.is_alive_index(index) {
            return false;
        }
        let Some(slot) = self.velocities.get_mut(index) else {
            return false;
        };
        *slot = Some(velocity);
        true
    }

    pub fn rotation(&self, entity: Entity) -> Option<Rotation2D> {
        let i = self.valid_index(entity)?;
        self.rotations[i]
    }

    pub(crate) fn rotation_at_index(&self, index: usize) -> Option<Rotation2D> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.rotations.get(index).copied().flatten()
    }

    pub(crate) fn rotation_at_index_or_default(&self, index: usize) -> Rotation2D {
        self.rotation_at_index(index).unwrap_or_default()
    }

    pub(crate) fn rotation_mut_at_index(&mut self, index: usize) -> Option<&mut Rotation2D> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.rotations.get_mut(index)?.as_mut()
    }

    pub(crate) fn rotation_mut_or_insert_default_at_index(
        &mut self,
        index: usize,
    ) -> Option<&mut Rotation2D> {
        if !self.is_alive_index(index) {
            return None;
        }
        Some(
            self.rotations
                .get_mut(index)?
                .get_or_insert_with(Rotation2D::default),
        )
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

    pub(crate) fn angular_velocity_at_index(&self, index: usize) -> Option<AngularVelocity> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.angular_velocities.get(index).copied().flatten()
    }

    pub(crate) fn angular_velocity_at_index_or_default(&self, index: usize) -> AngularVelocity {
        self.angular_velocity_at_index(index).unwrap_or_default()
    }

    pub fn set_angular_velocity(&mut self, entity: Entity, angular_velocity: AngularVelocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.angular_velocities[i] = Some(angular_velocity);
    }

    pub(crate) fn set_angular_velocity_at_index(
        &mut self,
        index: usize,
        angular_velocity: AngularVelocity,
    ) -> bool {
        if !self.is_alive_index(index) {
            return false;
        }
        let Some(slot) = self.angular_velocities.get_mut(index) else {
            return false;
        };
        *slot = Some(angular_velocity);
        true
    }

    pub(crate) fn health(&self, entity: Entity) -> Option<f32> {
        let i = self.valid_index(entity)?;
        self.healths[i]
    }

    pub(crate) fn health_at_index(&self, index: usize) -> Option<f32> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.healths.get(index).copied().flatten()
    }

    pub(crate) fn set_health(&mut self, entity: Entity, health: f32) -> bool {
        self.replace_health(entity, Some(health))
    }

    pub(crate) fn replace_health(&mut self, entity: Entity, health: Option<f32>) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.healths[i] = health;
        true
    }

    pub(crate) fn apply_damage_to_health_at_index(
        &mut self,
        index: usize,
        damage: f32,
        default_health: f32,
    ) -> Option<f32> {
        if !self.is_alive_index(index) {
            return None;
        }
        let health = self.healths.get_mut(index)?.get_or_insert(default_health);
        *health -= damage;
        Some(*health)
    }

    pub(crate) fn clear_health(&mut self, entity: Entity) -> bool {
        self.replace_health(entity, None)
    }

    pub(crate) fn damage(&self, entity: Entity) -> Option<f32> {
        let i = self.valid_index(entity)?;
        self.damages[i]
    }

    pub(crate) fn damage_at_index(&self, index: usize) -> Option<f32> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.damages.get(index).copied().flatten()
    }

    pub(crate) fn set_damage(&mut self, entity: Entity, damage: f32) -> bool {
        self.replace_damage(entity, Some(damage))
    }

    pub(crate) fn replace_damage(&mut self, entity: Entity, damage: Option<f32>) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.damages[i] = damage;
        true
    }

    pub(crate) fn clear_damage(&mut self, entity: Entity) -> bool {
        self.replace_damage(entity, None)
    }

    pub(crate) fn score_reward(&self, entity: Entity) -> Option<u32> {
        let i = self.valid_index(entity)?;
        self.score_rewards[i]
    }

    pub(crate) fn score_reward_at_index(&self, index: usize) -> Option<u32> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.score_rewards.get(index).copied().flatten()
    }

    pub(crate) fn set_score_reward(&mut self, entity: Entity, reward: u32) -> bool {
        self.replace_score_reward(entity, Some(reward))
    }

    pub(crate) fn replace_score_reward(&mut self, entity: Entity, reward: Option<u32>) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.score_rewards[i] = reward;
        true
    }

    pub(crate) fn clear_score_reward(&mut self, entity: Entity) -> bool {
        self.replace_score_reward(entity, None)
    }

    pub(crate) fn movement_pattern(&self, entity: Entity) -> Option<MovementPattern> {
        let i = self.valid_index(entity)?;
        self.movement_patterns[i]
    }

    pub(crate) fn movement_pattern_at_index(&self, index: usize) -> Option<MovementPattern> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.movement_patterns.get(index).copied().flatten()
    }

    pub(crate) fn set_movement_pattern(&mut self, entity: Entity, movement: MovementPattern) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.movement_patterns[i] = Some(movement);
    }

    pub(crate) fn replace_movement_pattern(
        &mut self,
        entity: Entity,
        movement: Option<MovementPattern>,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.movement_patterns[i] = movement;
        true
    }

    pub(crate) fn clear_movement_pattern(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.movement_patterns[i] = None;
    }

    pub(crate) fn collision_reactions(
        &self,
        entity: Entity,
    ) -> Option<crate::components::gameplay::CollisionReactionSet> {
        let i = self.valid_index(entity)?;
        self.collision_reactions[i]
    }

    pub(crate) fn collision_reactions_at_index(
        &self,
        index: usize,
    ) -> Option<CollisionReactionSet> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.collision_reactions.get(index).copied().flatten()
    }

    pub(crate) fn replace_collision_reactions(
        &mut self,
        entity: Entity,
        reactions: Option<CollisionReactionSet>,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.collision_reactions[i] = reactions;
        true
    }

    pub(crate) fn replace_collision_reactions_at_index(
        &mut self,
        index: usize,
        reactions: Option<CollisionReactionSet>,
    ) -> bool {
        if !self.is_alive_index(index) {
            return false;
        }
        let Some(slot) = self.collision_reactions.get_mut(index) else {
            return false;
        };
        *slot = reactions;
        true
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

    pub(crate) fn collision_reactions_mut(
        &mut self,
        entity: Entity,
    ) -> Option<(usize, &mut CollisionReactionSet)> {
        let i = self.valid_index(entity)?;
        self.collision_reactions[i]
            .as_mut()
            .map(|reactions| (i, reactions))
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

    pub(crate) fn gameplay_faction_at_index(&self, index: usize) -> Option<GameplayFaction> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.gameplay_factions.get(index).copied().flatten()
    }

    pub(crate) fn set_gameplay_faction(&mut self, entity: Entity, faction: GameplayFaction) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.set_gameplay_faction_at_index(i, faction);
    }

    pub(crate) fn replace_gameplay_faction(
        &mut self,
        entity: Entity,
        faction: Option<GameplayFaction>,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        if let Some(faction) = faction {
            self.set_gameplay_faction_at_index(i, faction);
        } else {
            self.clear_gameplay_faction_at_index(i);
        }
        true
    }

    pub(crate) fn clear_gameplay_faction(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.clear_gameplay_faction_at_index(i);
    }

    pub(crate) fn clear_gameplay_faction_relations(&mut self) {
        self.gameplay_faction_relations.clear();
    }

    pub(crate) fn set_gameplay_faction_default_relation(&mut self, relation: FactionRelation) {
        self.gameplay_faction_relations
            .set_default_relation(relation);
    }

    pub(crate) fn set_gameplay_faction_relation(
        &mut self,
        source_faction_id: u32,
        target_faction_id: u32,
        relation: FactionRelation,
    ) -> bool {
        self.gameplay_faction_relations
            .set_relation(source_faction_id, target_faction_id, relation)
    }

    #[cfg(test)]
    pub(crate) fn gameplay_faction_relation(
        &self,
        source_faction_id: u32,
        target_faction_id: u32,
    ) -> Option<FactionRelation> {
        self.gameplay_faction_relations
            .relation(source_faction_id, target_faction_id)
    }

    #[cfg(test)]
    pub(crate) fn gameplay_faction_default_relation(&self) -> FactionRelation {
        self.gameplay_faction_relations.default_relation()
    }

    pub(crate) fn gameplay_factions_can_damage(
        &self,
        source: GameplayFaction,
        target: GameplayFaction,
    ) -> bool {
        if self.gameplay_faction_relations.enabled() {
            self.gameplay_faction_relations
                .can_damage(source.faction_id, target.faction_id)
        } else {
            source.can_damage(target)
        }
    }

    pub(crate) fn write_gameplay_faction_relations_snapshot(&self, output: &mut [u32]) -> bool {
        self.gameplay_faction_relations.write_snapshot(output)
    }

    pub(crate) fn replace_gameplay_faction_relations(&mut self, relations: FactionRelationTable) {
        self.gameplay_faction_relations = relations;
    }

    pub(crate) fn gameplay_tags(&self, entity: Entity) -> Option<GameplayTags> {
        let i = self.valid_index(entity)?;
        self.gameplay_tags[i]
    }

    pub(crate) fn gameplay_tags_at_index(&self, index: usize) -> Option<GameplayTags> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.gameplay_tags.get(index).copied().flatten()
    }

    pub(crate) fn set_gameplay_tags(&mut self, entity: Entity, tags: GameplayTags) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.set_gameplay_tags_at_index(i, tags);
    }

    pub(crate) fn replace_gameplay_tags(
        &mut self,
        entity: Entity,
        tags: Option<GameplayTags>,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        if let Some(tags) = tags {
            self.set_gameplay_tags_at_index(i, tags);
        } else {
            self.clear_gameplay_tags_at_index(i);
        }
        true
    }

    pub(crate) fn clear_gameplay_tags(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.clear_gameplay_tags_at_index(i);
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

    pub(crate) fn replace_action_bindings(
        &mut self,
        entity: Entity,
        bindings: Option<ActionBindingSet>,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.action_bindings[i] = bindings;
        true
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

    pub(crate) fn behavior_state_machine(&self, entity: Entity) -> Option<BehaviorStateMachine> {
        let i = self.valid_index(entity)?;
        self.behavior_state_machines[i]
    }

    pub(crate) fn has_behavior_state_machines(&self) -> bool {
        self.behavior_state_machines.iter().any(Option::is_some)
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

    pub(crate) fn behavior_state_enter_actions(
        &self,
        entity: Entity,
    ) -> Option<crate::components::gameplay::BehaviorStateEnterActionSet> {
        let i = self.valid_index(entity)?;
        self.behavior_state_enter_actions[i]
    }

    pub(crate) fn has_behavior_state_enter_actions(&self) -> bool {
        self.behavior_state_enter_actions
            .iter()
            .any(Option::is_some)
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

    pub(crate) fn gameplay_timer_trigger(&self, entity: Entity) -> Option<GameplayTimerTrigger> {
        let i = self.valid_index(entity)?;
        self.gameplay_timer_triggers[i]
    }

    pub(crate) fn gameplay_timer_trigger_mut_at_index(
        &mut self,
        index: usize,
    ) -> Option<&mut GameplayTimerTrigger> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.gameplay_timer_triggers.get_mut(index)?.as_mut()
    }

    pub(crate) fn has_gameplay_timer_triggers(&self) -> bool {
        self.gameplay_timer_triggers.iter().any(Option::is_some)
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

    pub(crate) fn replace_gameplay_timer_trigger(
        &mut self,
        entity: Entity,
        timer: Option<GameplayTimerTrigger>,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.gameplay_timer_triggers[i] = timer;
        true
    }

    pub(crate) fn clear_gameplay_timer_trigger(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.gameplay_timer_triggers[i] = None;
    }

    pub(crate) fn pickup(&self, entity: Entity) -> Option<Pickup> {
        let i = self.valid_index(entity)?;
        self.pickups[i]
    }

    pub(crate) fn pickup_at_index(&self, index: usize) -> Option<Pickup> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.pickups.get(index).copied().flatten()
    }

    pub(crate) fn has_pickups(&self) -> bool {
        self.pickups.iter().any(Option::is_some)
    }

    pub(crate) fn set_pickup(&mut self, entity: Entity, pickup: Pickup) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.pickups[i] = Some(pickup);
        true
    }

    pub(crate) fn replace_pickup(&mut self, entity: Entity, pickup: Option<Pickup>) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.pickups[i] = pickup;
        true
    }

    pub(crate) fn clear_pickup(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.pickups[i] = None;
    }

    pub(crate) fn interaction(&self, entity: Entity) -> Option<Interaction> {
        let i = self.valid_index(entity)?;
        self.interactions[i]
    }

    pub(crate) fn interaction_at_index(&self, index: usize) -> Option<Interaction> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.interactions.get(index).copied().flatten()
    }

    pub(crate) fn interaction_mut_at_index(&mut self, index: usize) -> Option<&mut Interaction> {
        if !self.is_alive_index(index) {
            return None;
        }
        self.interactions.get_mut(index)?.as_mut()
    }

    pub(crate) fn has_interactions(&self) -> bool {
        self.interactions.iter().any(Option::is_some)
    }

    pub(crate) fn set_interaction(&mut self, entity: Entity, interaction: Interaction) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.interactions[i] = Some(interaction);
        true
    }

    pub(crate) fn replace_interaction(
        &mut self,
        entity: Entity,
        interaction: Option<Interaction>,
    ) -> bool {
        let Some(i) = self.valid_index(entity) else {
            return false;
        };
        self.interactions[i] = interaction;
        true
    }

    pub(crate) fn clear_interaction(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.interactions[i] = None;
    }
}
