use super::*;

pub(crate) fn prepare_any_action_payload_if_ready(
    world: &World,
    entity: Entity,
    action_id: u32,
) -> Result<(PreparedAction, PreparedActionPayload), ActionReadiness> {
    let readiness = prepare_any_action_if_ready(world, entity, action_id);
    let ActionReadiness::Ready(prepared) = readiness else {
        return Err(readiness);
    };
    Ok((
        prepared,
        prepared_action_payload_from_binding(prepared.binding),
    ))
}

pub(crate) fn prepare_action_trigger_for_dispatch(
    world: &World,
    trigger: ActionTriggerCommand,
    failure_policy: ActionAttemptFailurePolicy,
) -> ActionTriggerPreparation {
    match prepare_any_action_payload_if_ready(world, trigger.source, trigger.action_id) {
        Ok((prepared, payload)) => ActionTriggerPreparation::Ready(PreparedActionTrigger {
            trigger,
            prepared,
            payload,
        }),
        Err(readiness) => {
            debug_assert!(
                !matches!(readiness, ActionReadiness::PatternMismatch),
                "any-action payload preparation cannot produce pattern mismatch"
            );
            match action_readiness_failure_decision_for_policy(readiness, failure_policy) {
                ActionAttemptFailureDecision::Failure(reason_code) => {
                    ActionTriggerPreparation::Failure(action_trigger_failure_event_data(
                        trigger,
                        reason_code,
                    ))
                }
                ActionAttemptFailureDecision::Noop | ActionAttemptFailureDecision::Fallback => {
                    ActionTriggerPreparation::Noop
                }
            }
        }
    }
}

pub(crate) const fn prepared_action_payload_from_binding(
    binding: ActionBinding,
) -> PreparedActionPayload {
    match binding.pattern {
        ActionPattern::Projectile {
            speed,
            damage,
            lifetime_seconds,
            aim,
            collision_target,
            tile_impact,
        } => PreparedActionPayload::Projectile(ProjectileActionPayload {
            speed,
            damage,
            lifetime_seconds,
            aim,
            collision_target,
            tile_impact,
        }),
        ActionPattern::Dash { distance, aim } => {
            PreparedActionPayload::Dash(DashActionPayload { distance, aim })
        }
        ActionPattern::Melee {
            range,
            damage,
            target,
        } => PreparedActionPayload::Melee(MeleeActionPayload {
            range,
            damage,
            target,
        }),
        ActionPattern::SpawnPrefab {
            prefab_id,
            projectile,
            anchor,
            phase,
            offset_x,
            offset_y,
        } => PreparedActionPayload::SpawnPrefab(SpawnPrefabActionPayload {
            prefab_id,
            projectile,
            anchor,
            phase,
            offset_x,
            offset_y,
        }),
    }
}

pub(crate) fn commit_prepared_action(world: &mut World, prepared: PreparedAction) -> bool {
    if prepared.binding.action_id != prepared.action_id {
        return false;
    }
    let Some(candidate) = world.action_binding(prepared.entity, prepared.action_id) else {
        return false;
    };
    if candidate.action_id != prepared.action_id
        || !action_pattern_identity_matches(candidate.pattern, prepared.binding.pattern)
        || !prepared.kind.matches(candidate.pattern)
        || candidate.cooldown.remaining_seconds > 0.0
    {
        return false;
    }
    let Some(triggered) =
        world.commit_action_cooldown_if_ready(prepared.entity, prepared.action_id)
    else {
        return false;
    };
    debug_assert!(action_pattern_identity_matches(
        triggered.pattern,
        prepared.binding.pattern
    ));
    action_pattern_identity_matches(triggered.pattern, prepared.binding.pattern)
}

pub(in crate::gameplay) fn f32_identity_matches(a: f32, b: f32) -> bool {
    a.to_bits() == b.to_bits()
}

pub(in crate::gameplay) fn action_pattern_identity_matches(
    a: ActionPattern,
    b: ActionPattern,
) -> bool {
    match (a, b) {
        (
            ActionPattern::Projectile {
                speed: a_speed,
                damage: a_damage,
                lifetime_seconds: a_lifetime_seconds,
                aim: a_aim,
                collision_target: a_collision_target,
                tile_impact: a_tile_impact,
            },
            ActionPattern::Projectile {
                speed: b_speed,
                damage: b_damage,
                lifetime_seconds: b_lifetime_seconds,
                aim: b_aim,
                collision_target: b_collision_target,
                tile_impact: b_tile_impact,
            },
        ) => {
            f32_identity_matches(a_speed, b_speed)
                && f32_identity_matches(a_damage, b_damage)
                && f32_identity_matches(a_lifetime_seconds, b_lifetime_seconds)
                && a_aim == b_aim
                && a_collision_target == b_collision_target
                && a_tile_impact == b_tile_impact
        }
        (
            ActionPattern::Dash {
                distance: a_distance,
                aim: a_aim,
            },
            ActionPattern::Dash {
                distance: b_distance,
                aim: b_aim,
            },
        ) => f32_identity_matches(a_distance, b_distance) && a_aim == b_aim,
        (
            ActionPattern::Melee {
                range: a_range,
                damage: a_damage,
                target: a_target,
            },
            ActionPattern::Melee {
                range: b_range,
                damage: b_damage,
                target: b_target,
            },
        ) => {
            f32_identity_matches(a_range, b_range)
                && f32_identity_matches(a_damage, b_damage)
                && a_target == b_target
        }
        (
            ActionPattern::SpawnPrefab {
                prefab_id: a_prefab_id,
                projectile: a_projectile,
                anchor: a_anchor,
                phase: a_phase,
                offset_x: a_offset_x,
                offset_y: a_offset_y,
            },
            ActionPattern::SpawnPrefab {
                prefab_id: b_prefab_id,
                projectile: b_projectile,
                anchor: b_anchor,
                phase: b_phase,
                offset_x: b_offset_x,
                offset_y: b_offset_y,
            },
        ) => {
            a_prefab_id == b_prefab_id
                && a_anchor == b_anchor
                && a_phase == b_phase
                && a_projectile == b_projectile
                && f32_identity_matches(a_offset_x, b_offset_x)
                && f32_identity_matches(a_offset_y, b_offset_y)
        }
        _ => false,
    }
}
