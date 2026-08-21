use wasm_bindgen::prelude::*;

use super::gameplay_authoring::{collision_reaction_trigger_from_code, collision_target_from_code};
use super::{Engine, MAX_PARTICLE_PRESETS};
use crate::components::gameplay::{CollisionReaction, Cooldown, GameplayTimerTrigger, Interaction};
use crate::gameplay_event::{
    GAMEPLAY_EVENT_COLLISION_DAMAGE, GAMEPLAY_EVENT_COLLISION_DESPAWN, GAMEPLAY_EVENT_INTERACTION,
    GAMEPLAY_EVENT_PICKUP_COLLECTED, GAMEPLAY_EVENT_TILE_IMPACT, GAMEPLAY_EVENT_TIMER,
};
use crate::gameplay_variables::{
    GameplayVariableComparison, GameplayVariableComparisonOperator,
    GameplayVariableMutationOperation, GameplayVariableMutationTrigger, GameplayVariableScope,
    GameplayVariableType,
};

#[wasm_bindgen]
impl Engine {
    pub fn clear_gameplay_variables(&mut self) {
        self.world.clear_gameplay_variables();
    }

    pub fn configure_gameplay_variable(
        &mut self,
        slot: u32,
        variable_type: u32,
        scope: u32,
        default_value: f64,
        value: f64,
    ) -> bool {
        let Some(variable_type) = GameplayVariableType::from_code(variable_type) else {
            return false;
        };
        let Some(scope) = GameplayVariableScope::from_code(scope) else {
            return false;
        };
        self.world
            .configure_gameplay_variable(slot, variable_type, scope, default_value, value)
    }

    pub fn gameplay_variable_is_configured(&self, slot: u32) -> bool {
        self.world.gameplay_variable_is_configured(slot)
    }

    pub fn gameplay_variable_value(&self, slot: u32) -> f64 {
        self.world.gameplay_variable_value(slot).unwrap_or(f64::NAN)
    }

    pub fn set_gameplay_variable_value(&mut self, slot: u32, value: f64) -> bool {
        self.world.set_gameplay_variable_value(slot, value)
    }

    pub fn increment_gameplay_variable_value(&mut self, slot: u32, amount: f64) -> bool {
        self.world.increment_gameplay_variable_value(slot, amount)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_variable_mutation_trigger(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        event_kind: u32,
        token_id: u32,
        variable_slot: u32,
        operation: u32,
        value: f64,
    ) -> bool {
        if !valid_variable_trigger_event(event_kind, token_id) {
            return false;
        }
        let Some(operation) = GameplayVariableMutationOperation::from_code(operation) else {
            return false;
        };
        let Some(trigger) = GameplayVariableMutationTrigger::new(
            event_kind,
            token_id,
            variable_slot,
            operation,
            value,
        ) else {
            return false;
        };
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world
            .add_gameplay_variable_mutation_trigger(entity, trigger)
    }

    pub fn clear_gameplay_variable_mutation_triggers(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.clear_gameplay_variable_mutation_triggers(entity)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_interaction_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        radius: f32,
        once: bool,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if action_id == 0 || !Self::valid_positive(radius) {
            return false;
        }
        let Some(guard) =
            gameplay_variable_comparison(left_slot, operator, right_slot, right_literal)
        else {
            return false;
        };
        if !self.world.gameplay_variable_comparison_is_supported(guard) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_interaction(
            entity,
            Interaction::new(action_id, radius, once).guarded(guard),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_timer_trigger_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        timer_id: u32,
        duration_seconds: f32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        self.set_gameplay_timer_trigger_internal(
            entity_id,
            entity_generation,
            timer_id,
            duration_seconds,
            None,
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_gameplay_timer_action_trigger_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        timer_id: u32,
        duration_seconds: f32,
        action_id: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if action_id == 0 {
            return false;
        }
        self.set_gameplay_timer_trigger_internal(
            entity_id,
            entity_generation,
            timer_id,
            duration_seconds,
            Some(action_id),
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_behavior_variable_transition(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        from_state: u32,
        to_state: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if from_state == 0 || to_state == 0 {
            return false;
        }
        let Some(guard) =
            gameplay_variable_comparison(left_slot, operator, right_slot, right_literal)
        else {
            return false;
        };
        if !self.world.gameplay_variable_comparison_is_supported(guard) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.add_behavior_state_transition(
            entity,
            crate::components::gameplay::BehaviorStateTransition::new_variable(
                from_state, to_state, guard,
            ),
        )
    }
}

#[wasm_bindgen]
impl Engine {
    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_damage_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        amount: f32,
        target: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if !Self::valid_positive(amount) {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        if !self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::Damage { target },
            left_slot,
            operator,
            right_slot,
            right_literal,
        ) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_damage(entity, amount)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_area_damage_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        amount: f32,
        radius: f32,
        target_layer_code: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if !Self::valid_positive(amount) || !Self::valid_positive(radius) {
            return false;
        }
        let Some(target_layer) = Self::movement_query_layer_from_code(target_layer_code) else {
            return false;
        };
        if !self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::AreaDamage {
                radius,
                target_layer,
            },
            left_slot,
            operator,
            right_slot,
            right_literal,
        ) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        self.world.set_damage(entity, amount)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_knockback_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: u32,
        impulse: f32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if !Self::valid_positive(impulse) {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::Knockback { target, impulse },
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_pickup_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::Pickup { target },
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_despawn_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        target: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::Despawn { target },
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_sound_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        sound_id: u32,
        volume: f32,
        pitch: f32,
        cooldown_seconds: f32,
        replace_default: bool,
        trigger: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if sound_id == 0
            || !Self::valid_non_negative(volume)
            || !Self::valid_positive(pitch)
            || !Self::valid_non_negative(cooldown_seconds)
        {
            return false;
        }
        let Some(trigger) = collision_reaction_trigger_from_code(trigger) else {
            return false;
        };
        self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::PlaySound {
                sound_id,
                volume,
                pitch,
                cooldown: Cooldown::ready(cooldown_seconds),
                replace_default,
                trigger,
            },
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_particle_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        preset_id: u32,
        target: u32,
        cooldown_seconds: f32,
        replace_default: bool,
        trigger: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if preset_id as usize >= MAX_PARTICLE_PRESETS || !Self::valid_non_negative(cooldown_seconds)
        {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        let Some(trigger) = collision_reaction_trigger_from_code(trigger) else {
            return false;
        };
        self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::SpawnParticle {
                preset_id,
                target,
                cooldown: Cooldown::ready(cooldown_seconds),
                replace_default,
                trigger,
            },
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_camera_shake_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        cooldown_seconds: f32,
        trigger: u32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if !Self::valid_non_negative(cooldown_seconds) {
            return false;
        }
        let Some(trigger) = collision_reaction_trigger_from_code(trigger) else {
            return false;
        };
        self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::CameraShake {
                cooldown: Cooldown::ready(cooldown_seconds),
                trigger,
            },
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_emit_effect_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        effect_id: u32,
        effect_type: u32,
        target: u32,
        cooldown_seconds: f32,
        trigger: u32,
        intensity: f32,
        radius: f32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if !Self::valid_non_negative(cooldown_seconds)
            || !(1..=4).contains(&effect_type)
            || !Self::valid_non_negative(intensity)
            || !Self::valid_non_negative(radius)
        {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        let Some(trigger) = collision_reaction_trigger_from_code(trigger) else {
            return false;
        };
        self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::EmitEffect {
                effect_id,
                effect_type,
                target,
                intensity,
                radius,
                cooldown: Cooldown::ready(cooldown_seconds),
                trigger,
            },
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_gameplay_collision_spawn_prefab_with_guard(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        action_id: u32,
        prefab_id: u32,
        target: u32,
        cooldown_seconds: f32,
        trigger: u32,
        offset_x: f32,
        offset_y: f32,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if action_id == 0
            || prefab_id == 0
            || !self.scenes.shooter().supports_spawn_prefab_id(prefab_id)
            || !Self::valid_non_negative(cooldown_seconds)
            || !offset_x.is_finite()
            || !offset_y.is_finite()
        {
            return false;
        }
        let Some(target) = collision_target_from_code(target) else {
            return false;
        };
        let Some(trigger) = collision_reaction_trigger_from_code(trigger) else {
            return false;
        };
        self.add_guarded_collision_reaction_from_codes(
            entity_id,
            entity_generation,
            CollisionReaction::SpawnPrefab {
                action_id,
                prefab_id,
                target,
                cooldown: Cooldown::ready(cooldown_seconds),
                trigger,
                offset_x,
                offset_y,
            },
            left_slot,
            operator,
            right_slot,
            right_literal,
        )
    }
}

impl Engine {
    #[allow(clippy::too_many_arguments)]
    fn add_guarded_collision_reaction_from_codes(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        reaction: CollisionReaction,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        let Some(guard) =
            gameplay_variable_comparison(left_slot, operator, right_slot, right_literal)
        else {
            return false;
        };
        if !self.world.gameplay_variable_comparison_is_supported(guard) {
            return false;
        }
        self.add_gameplay_guarded_collision_reaction(entity_id, entity_generation, reaction, guard)
    }

    #[allow(clippy::too_many_arguments)]
    fn set_gameplay_timer_trigger_internal(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        timer_id: u32,
        duration_seconds: f32,
        action_id: Option<u32>,
        left_slot: u32,
        operator: u32,
        right_slot: u32,
        right_literal: f64,
    ) -> bool {
        if timer_id == 0 || !Self::valid_positive(duration_seconds) {
            return false;
        }
        let Some(guard) =
            gameplay_variable_comparison(left_slot, operator, right_slot, right_literal)
        else {
            return false;
        };
        if !self.world.gameplay_variable_comparison_is_supported(guard) {
            return false;
        }
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            return false;
        };
        let timer = action_id.map_or_else(
            || GameplayTimerTrigger::new(timer_id, duration_seconds),
            |action_id| GameplayTimerTrigger::with_action(timer_id, duration_seconds, action_id),
        );
        self.world
            .set_gameplay_timer_trigger(entity, timer.guarded(guard))
    }
}

pub(super) fn gameplay_variable_comparison(
    left_slot: u32,
    operator: u32,
    right_slot: u32,
    right_literal: f64,
) -> Option<GameplayVariableComparison> {
    GameplayVariableComparison::new(
        left_slot,
        GameplayVariableComparisonOperator::from_code(operator)?,
        right_slot,
        right_literal,
    )
}

fn valid_variable_trigger_event(event_kind: u32, token_id: u32) -> bool {
    match event_kind {
        GAMEPLAY_EVENT_INTERACTION | GAMEPLAY_EVENT_TIMER | GAMEPLAY_EVENT_PICKUP_COLLECTED => {
            token_id != 0
        }
        GAMEPLAY_EVENT_COLLISION_DAMAGE | GAMEPLAY_EVENT_COLLISION_DESPAWN => token_id == 0,
        GAMEPLAY_EVENT_TILE_IMPACT => token_id <= 2 && token_id != 1,
        _ => false,
    }
}
