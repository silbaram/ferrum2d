use super::World;
use crate::entity::Entity;
use crate::gameplay_variables::{
    GameplayVariableComparison, GameplayVariableMutationTrigger,
    GameplayVariableMutationTriggerSet, GameplayVariableScope, GameplayVariableSlab,
    GameplayVariableType,
};

impl World {
    pub(crate) fn clear_gameplay_variables(&mut self) {
        self.gameplay_variables.clear();
    }

    pub(crate) fn configure_gameplay_variable(
        &mut self,
        slot: u32,
        variable_type: GameplayVariableType,
        scope: GameplayVariableScope,
        default_value: f64,
        value: f64,
    ) -> bool {
        self.gameplay_variables
            .configure(slot, variable_type, scope, default_value, value)
    }

    pub(crate) fn gameplay_variable_is_configured(&self, slot: u32) -> bool {
        self.gameplay_variables.is_configured(slot)
    }

    pub(crate) fn gameplay_variable_value(&self, slot: u32) -> Option<f64> {
        self.gameplay_variables.value(slot)
    }

    pub(crate) fn set_gameplay_variable_value(&mut self, slot: u32, value: f64) -> bool {
        self.gameplay_variables.set(slot, value)
    }

    pub(crate) fn increment_gameplay_variable_value(&mut self, slot: u32, amount: f64) -> bool {
        self.gameplay_variables.increment(slot, amount)
    }

    pub(crate) fn gameplay_variable_comparison_matches(
        &self,
        comparison: GameplayVariableComparison,
    ) -> bool {
        self.gameplay_variables.matches(comparison)
    }

    pub(crate) fn gameplay_variable_comparison_is_supported(
        &self,
        comparison: GameplayVariableComparison,
    ) -> bool {
        self.gameplay_variables.supports_comparison(comparison)
    }

    pub(crate) fn gameplay_variable_slab(&self) -> &GameplayVariableSlab {
        &self.gameplay_variables
    }

    pub(crate) fn replace_gameplay_variable_slab(&mut self, slab: GameplayVariableSlab) {
        self.gameplay_variables = slab;
    }

    pub(crate) fn reset_preserving_gameplay_variables(&mut self) {
        let mut variables = std::mem::take(&mut self.gameplay_variables);
        variables.reset_scene_values();
        *self = Self::default();
        self.gameplay_variables = variables;
    }

    pub(crate) fn add_gameplay_variable_mutation_trigger(
        &mut self,
        entity: Entity,
        trigger: GameplayVariableMutationTrigger,
    ) -> bool {
        if !self.gameplay_variables.supports_mutation(
            trigger.slot,
            trigger.operation,
            trigger.value,
        ) {
            return false;
        }
        let Some(index) = self.valid_index(entity) else {
            return false;
        };
        self.reserve_retired_gameplay_variable_mutation_trigger_capacity(index);
        let set = self.gameplay_variable_mutation_triggers[index]
            .get_or_insert_with(GameplayVariableMutationTriggerSet::default);
        set.upsert(trigger)
    }

    pub(crate) fn gameplay_variable_mutation_triggers_at_index(
        &self,
        index: usize,
    ) -> Option<GameplayVariableMutationTriggerSet> {
        self.gameplay_variable_mutation_triggers
            .get(index)
            .cloned()
            .flatten()
    }

    pub(crate) fn gameplay_variable_mutation_triggers(
        &self,
        entity: Entity,
    ) -> Option<GameplayVariableMutationTriggerSet> {
        let index = self.valid_index(entity)?;
        self.gameplay_variable_mutation_triggers[index].clone()
    }

    pub(crate) fn replace_gameplay_variable_mutation_triggers(
        &mut self,
        entity: Entity,
        triggers: Option<GameplayVariableMutationTriggerSet>,
    ) -> bool {
        let Some(index) = self.valid_index(entity) else {
            return false;
        };
        if triggers.is_some() {
            self.reserve_retired_gameplay_variable_mutation_trigger_capacity(index);
        }
        self.gameplay_variable_mutation_triggers[index] = triggers;
        true
    }

    pub(crate) fn clear_gameplay_variable_mutation_triggers(&mut self, entity: Entity) -> bool {
        self.replace_gameplay_variable_mutation_triggers(entity, None)
    }

    pub(crate) fn clear_retired_gameplay_variable_mutation_triggers(&mut self) {
        self.retired_gameplay_variable_mutation_triggers.clear();
    }

    pub(crate) fn rebuild_retired_gameplay_variable_mutation_trigger_capacity(&mut self) {
        self.retired_gameplay_variable_mutation_triggers.clear();
        let required = self
            .gameplay_variable_mutation_triggers
            .iter()
            .filter(|triggers| triggers.is_some())
            .count();
        if self.retired_gameplay_variable_mutation_triggers.capacity() < required {
            self.retired_gameplay_variable_mutation_triggers
                .reserve_exact(required);
        }
    }

    pub(crate) fn retired_gameplay_variable_mutation_trigger_count(&self) -> usize {
        self.retired_gameplay_variable_mutation_triggers.len()
    }

    pub(crate) fn retired_gameplay_variable_mutation_trigger(
        &self,
        index: usize,
    ) -> Option<(Entity, GameplayVariableMutationTriggerSet)> {
        self.retired_gameplay_variable_mutation_triggers
            .get(index)
            .cloned()
    }

    pub(super) fn retire_gameplay_variable_mutation_triggers(
        &mut self,
        entity: Entity,
        index: usize,
    ) {
        let Some(triggers) = self
            .gameplay_variable_mutation_triggers
            .get(index)
            .cloned()
            .flatten()
        else {
            return;
        };
        self.retired_gameplay_variable_mutation_triggers
            .push((entity, triggers));
    }

    fn reserve_retired_gameplay_variable_mutation_trigger_capacity(&mut self, index: usize) {
        if self.gameplay_variable_mutation_triggers[index].is_some() {
            return;
        }
        let active_trigger_sources = self
            .gameplay_variable_mutation_triggers
            .iter()
            .filter(|triggers| triggers.is_some())
            .count();
        let required = self
            .retired_gameplay_variable_mutation_triggers
            .len()
            .saturating_add(active_trigger_sources)
            .saturating_add(1);
        let retired = &mut self.retired_gameplay_variable_mutation_triggers;
        if retired.capacity() < required {
            retired.reserve_exact(required - retired.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn world_reset_preserves_global_values_and_resets_scene_values() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        assert!(world.configure_gameplay_variable(
            1,
            GameplayVariableType::Integer,
            GameplayVariableScope::Global,
            2.0,
            7.0,
        ));
        assert!(world.configure_gameplay_variable(
            2,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            3.0,
            9.0,
        ));

        world.reset_preserving_gameplay_variables();

        assert!(!world.is_current_entity(entity));
        assert_eq!(world.gameplay_variable_value(1), Some(7.0));
        assert_eq!(world.gameplay_variable_value(2), Some(3.0));
    }
}
