use super::*;
use crate::components::gameplay::file_payload::{action, cooldown, movement, reaction};
use crate::components::gameplay::*;

pub(super) fn entity(w: &World, i: usize, budget: &mut Budget) -> Result {
    if let Some(v) = w.lifetimes[i] {
        budget.charge(2)?;
        require(v.remaining_seconds.is_finite(), "lifetimes", i, "remaining")?;
    }
    if let Some(v) = w.bullet_lifetimes[i] {
        budget.charge(2)?;
        require(v.is_finite(), "bullet_lifetimes", i, "remaining")?;
    }
    if let Some(v) = w.healths[i] {
        budget.charge(2)?;
        require(v.is_finite(), "healths", i, "health")?;
    }
    if let Some(v) = w.damages[i] {
        budget.charge(2)?;
        require(v.is_finite(), "damages", i, "damage")?;
    }
    // score_rewards, policy/target/tile-impact, Pickup IDs/count/flags have no
    // additional numeric domain: their u32/bool/enums are valid by decoding.
    if let Some(v) = w.gameplay_factions[i] {
        budget.charge(4)?;
        require(
            v.faction_id <= GAMEPLAY_FACTION_MAX_ID,
            "gameplay_factions",
            i,
            "faction-id",
        )?;
    }
    if let Some(v) = w.gameplay_tags[i] {
        budget.charge(4)?;
        require(v.mask != 0, "gameplay_tags", i, "empty-mask")?;
    }
    if let Some(v) = &w.action_bindings[i] {
        budget.charge(1024)?;
        require(
            v.admit_saved_layout().is_ok(),
            "action_bindings",
            i,
            "layout-key",
        )?;
        for binding in v.saved_bindings() {
            require(
                cooldown(binding.cooldown) && action(binding.pattern),
                "action_bindings",
                i,
                "pattern-cooldown",
            )?;
        }
    }
    if let Some(v) = w.interactions[i] {
        budget.charge(16)?;
        require(
            v.radius.is_finite() && v.guard.saved_payload_valid(),
            "interactions",
            i,
            "radius-guard",
        )?;
    }
    if let Some(v) = w.movement_patterns[i] {
        budget.charge(32)?;
        require(movement(v), "movement_patterns", i, "numeric-target-kind")?;
    }
    if let Some(v) = w.collision_reactions[i] {
        budget.charge(2048)?;
        require(
            v.admit_saved_layout().is_ok(),
            "collision_reactions",
            i,
            "layout-key-guard",
        )?;
        require(
            v.checkpoint_reactions().all(reaction),
            "collision_reactions",
            i,
            "reaction-numeric",
        )?;
    }
    if let Some(v) = &w.behavior_state_machines[i] {
        budget.charge(8192)?;
        require(
            v.admit_saved_layout().is_ok(),
            "behavior_state_machines",
            i,
            "layout-transition-guard",
        )?;
    }
    if let Some(v) = &w.behavior_state_enter_actions[i] {
        budget.charge(2048)?;
        require(
            v.admit_saved_layout().is_ok(),
            "behavior_state_enter_actions",
            i,
            "layout-key",
        )?;
    }
    if let Some(v) = w.gameplay_timer_triggers[i] {
        budget.charge(32)?;
        require(
            finite(&[v.duration_seconds, v.remaining_seconds]) && v.guard.saved_payload_valid(),
            "gameplay_timer_triggers",
            i,
            "time-guard",
        )?;
    }
    if let Some(v) = &w.gameplay_variable_mutation_triggers[i] {
        budget.charge(1024)?;
        require(
            v.admit_saved_layout().is_ok(),
            "gameplay_variable_mutation_triggers",
            i,
            "layout-trigger-key",
        )?;
    }
    Ok(())
}
