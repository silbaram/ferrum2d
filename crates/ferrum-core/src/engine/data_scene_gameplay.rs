use wasm_bindgen::prelude::*;

use crate::collision::{CollisionPair, CollisionScratch, CollisionSystem};
use crate::components::gameplay::{CollisionReaction, CollisionTarget};
use crate::entity::Entity;
use crate::gameplay_event::GameplayEvent;
use crate::input::{InputActionRegistry, InputState};
use crate::world::World;

use super::scenes::SceneMode;
use super::Engine;

/// Scene-owned gameplay execution; no Shooter state or browser callbacks.
#[derive(Default)]
pub(super) struct DataSceneGameplay {
    enabled: bool,
    interaction_input_action: u32,
    previous_input: InputState,
    collision_scratch: CollisionScratch,
    collision_pairs: Vec<CollisionPair>,
}

impl DataSceneGameplay {
    pub(super) fn observe_input(&mut self, input: InputState) {
        self.previous_input = input;
    }

    pub(super) fn update(
        &mut self,
        world: &mut World,
        actions: &InputActionRegistry,
        input: InputState,
        latched_presses: InputState,
        events: &mut Vec<GameplayEvent>,
    ) {
        // A new sampled press remains an edge even when the preceding fixed step
        // also consumed a short pulse and therefore ended with a synthetic down state.
        let previous = InputState {
            space: self.previous_input.space & !latched_presses.space,
            enter: self.previous_input.enter & !latched_presses.enter,
            mouse_left: self.previous_input.mouse_left & !latched_presses.mouse_left,
            ..self.previous_input
        };
        let interact = self.interaction_input_action == 0
            || actions.is_action_active(self.interaction_input_action, input, previous);
        self.previous_input = input;
        if !self.enabled {
            return;
        }
        if interact {
            self.interactions(world, events);
        }
        if !world.has_pickups() {
            return;
        }
        CollisionSystem::build_pairs_into(
            &mut self.collision_scratch,
            world,
            &mut self.collision_pairs,
        );
        for pair in &self.collision_pairs {
            Self::collect(world, pair.a, pair.b, events);
            Self::collect(world, pair.b, pair.a, events);
        }
    }

    fn interactions(&self, world: &mut World, events: &mut Vec<GameplayEvent>) {
        let Some(actor) = world.primary_actor_entity() else {
            return;
        };
        let Some(position) = world.transform(actor) else {
            return;
        };
        let mut nearest: Option<(Entity, f32)> = None;
        for index in 0..world.entity_capacity() {
            let Some(interaction) = world.interaction_at_index(index) else {
                continue;
            };
            if (interaction.once && interaction.consumed)
                || !world.gameplay_variable_comparison_matches(interaction.guard)
                || !world.height_spans_allow_at(actor.id as usize, index)
            {
                continue;
            }
            let Some(source) = world.entity_at_index(index) else {
                continue;
            };
            if source == actor {
                continue;
            }
            let Some(target) = world.transform(source) else {
                continue;
            };
            let distance = (target.x - position.x).powi(2) + (target.y - position.y).powi(2);
            if distance > interaction.radius * interaction.radius {
                continue;
            }
            if self.interaction_input_action == 0 {
                Self::emit_interaction(world, actor, source, events);
            } else if nearest.is_none_or(|(_, best)| distance < best) {
                nearest = Some((source, distance));
            }
        }
        if let Some((source, _)) = nearest {
            Self::emit_interaction(world, actor, source, events);
        }
    }

    fn emit_interaction(
        world: &mut World,
        actor: Entity,
        source: Entity,
        events: &mut Vec<GameplayEvent>,
    ) {
        let Some(interaction) = world.interaction_at_index(source.id as usize) else {
            return;
        };
        let event = GameplayEvent::interaction(
            actor,
            source,
            interaction.action_id,
            interaction.once,
            interaction.once,
        );
        // Fixed substeps must not duplicate a proximity event in the same output frame.
        if !events.contains(&event) {
            events.push(event);
        }
        if interaction.once {
            if let Some(stored) = world.interaction_mut_at_index(source.id as usize) {
                stored.consumed = true;
            }
        }
    }

    fn collect(world: &mut World, source: Entity, other: Entity, events: &mut Vec<GameplayEvent>) {
        if !world.is_current_entity(source) || !world.is_current_entity(other) {
            return;
        }
        let Some(mut reactions) = world.collision_reactions(source) else {
            return;
        };
        for (reaction, guard) in reactions.iter_mut_with_guards() {
            let CollisionReaction::Pickup { target } = reaction else {
                continue;
            };
            if !world.gameplay_variable_comparison_matches(guard) {
                continue;
            }
            let (pickup_entity, collector) = match target {
                CollisionTarget::SelfEntity => (source, other),
                CollisionTarget::OtherEntity => (other, source),
            };
            let Some(pickup) = world.pickup(pickup_entity) else {
                continue;
            };
            if pickup.item_id == 0 || !pickup.despawn_on_collect {
                continue;
            }
            events.push(GameplayEvent::pickup_collected(
                collector,
                pickup_entity,
                pickup.item_id,
                pickup.count,
                true,
            ));
            // World preserves this entity's variable triggers until the frame event phase.
            world.despawn(pickup_entity);
            break;
        }
    }
}

#[wasm_bindgen]
impl Engine {
    /// Enables generic Data Scene gameplay. Action 0 selects automatic proximity interaction.
    pub fn configure_data_scene_gameplay(
        &mut self,
        has_actor: bool,
        id: u32,
        generation: u32,
        interaction_input_action: u32,
    ) -> bool {
        if self.scene_mode != SceneMode::Data {
            return false;
        }
        let actor = if has_actor {
            let Some(entity) = self.entity_from_handle(id, generation) else {
                return false;
            };
            if self.world.transform(entity).is_none() {
                return false;
            }
            Some(entity)
        } else {
            if interaction_input_action != 0 {
                return false;
            }
            None
        };
        if let Some(actor) = actor {
            self.world.set_primary_actor_entity(actor);
        } else if let Some(current) = self.world.primary_actor_entity() {
            self.world.clear_primary_actor_entity(current);
        }
        self.data_scene.gameplay.enabled = true;
        self.data_scene.gameplay.interaction_input_action = interaction_input_action;
        self.data_scene.gameplay.observe_input(self.input);
        self.fixed_timestep_input_latch.clear();
        self.previous_input_sample = self.input;
        true
    }
}

impl Engine {
    pub(super) fn update_data_scene_gameplay(
        &mut self,
        input: InputState,
        latched_presses: InputState,
    ) {
        if self.scene_mode == SceneMode::Data {
            self.data_scene.gameplay.update(
                &mut self.world,
                &self.input_actions,
                input,
                latched_presses,
                &mut self.frame_buffers.gameplay_events,
            );
        }
    }
}
