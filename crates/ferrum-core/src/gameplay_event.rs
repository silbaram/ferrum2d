use crate::entity::Entity;

pub const GAMEPLAY_EVENT_INTERACTION: u32 = 1;
pub const GAMEPLAY_EVENT_COLLISION_DAMAGE: u32 = 2;
pub const GAMEPLAY_EVENT_COLLISION_DESPAWN: u32 = 3;
pub const GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED: u32 = 4;
pub const GAMEPLAY_EVENT_PREFAB_SPAWNED: u32 = 5;
pub const GAMEPLAY_EVENT_ACTION_FAILED: u32 = 6;
pub const GAMEPLAY_EVENT_TIMER: u32 = 7;
pub const GAMEPLAY_EVENT_PICKUP_COLLECTED: u32 = 8;
pub const GAMEPLAY_EVENT_TILE_IMPACT: u32 = 9;
pub const GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED: u32 = 10;
pub const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB: u32 = 1;
pub const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR: u32 = 2;
pub const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE: u32 = 3;
pub const GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM: u32 = 4;
pub const GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL: u32 = 5;
pub const GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH: u32 = 6;
pub const GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT: u32 = 7;
pub const GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING: u32 = 8;
pub const GAMEPLAY_ACTION_FAILURE_COOLING_DOWN: u32 = 9;
pub const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE: u32 = 10;
pub const GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET: u32 = 11;
pub const GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET: u32 = 12;
pub const GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE: u32 =
    GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET;
pub const GAMEPLAY_EVENT_FLAG_ONCE: u32 = 1 << 0;
pub const GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME: u32 = 1 << 1;
pub const GAMEPLAY_EVENT_FLAG_TARGET_REMOVED: u32 = 1 << 2;
pub const GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED: u32 = 1 << 3;
pub const GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED: u32 = 1 << 4;
pub const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT: u32 = 8;
pub const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK: u32 =
    0b111 << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT;
pub const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NONE: u32 = 0;
pub const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X: u32 = 1;
pub const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X: u32 = 2;
pub const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y: u32 = 3;
pub const GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y: u32 = 4;
pub const GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT: u32 = 24;
pub const GAMEPLAY_EVENT_TILE_IMPACT_LAYER_MASK: u32 =
    0xff << GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT;
pub const GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK: u32 = 0x00ff_ffff;
pub const GAMEPLAY_EVENT_PRESENTATION_EFFECT: u32 = 11;
pub const GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND: u32 = 1;
pub const GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE: u32 = 2;
/// Category kept in `payload_bits` so Rust gameplay remains data-driven while TS decides playback.
pub const GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE: u32 = 3;
pub const GAMEPLAY_PRESENTATION_EFFECT_TYPE_CUSTOM: u32 = 4;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GameplayEvent {
    pub kind: u32,
    pub actor_id: u32,
    pub actor_generation: u32,
    pub source_id: u32,
    pub source_generation: u32,
    pub token_id: u32,
    pub flags: u32,
    pub payload_bits: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GameplayTileImpactEventPayload {
    pub projectile: Entity,
    pub tile_impact_code: u32,
    pub layer_index: u32,
    pub tile_index: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub bounced: bool,
    pub target_removed: bool,
}

impl GameplayEvent {
    pub fn interaction(
        actor: Entity,
        source: Entity,
        action_id: u32,
        once: bool,
        consumed_this_frame: bool,
    ) -> Self {
        let mut flags = 0;
        if once {
            flags |= GAMEPLAY_EVENT_FLAG_ONCE;
        }
        if consumed_this_frame {
            flags |= GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME;
        }
        Self {
            kind: GAMEPLAY_EVENT_INTERACTION,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: source.id,
            source_generation: source.generation,
            token_id: action_id,
            flags,
            payload_bits: 0,
        }
    }

    pub fn collision_damage(
        actor: Entity,
        source: Entity,
        damage: f32,
        target_removed: bool,
    ) -> Self {
        let mut flags = 0;
        if target_removed {
            flags |= GAMEPLAY_EVENT_FLAG_TARGET_REMOVED;
        }
        Self {
            kind: GAMEPLAY_EVENT_COLLISION_DAMAGE,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: source.id,
            source_generation: source.generation,
            token_id: 0,
            flags,
            payload_bits: damage.to_bits(),
        }
    }

    pub fn collision_despawn(actor: Entity, source: Entity) -> Self {
        Self {
            kind: GAMEPLAY_EVENT_COLLISION_DESPAWN,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: source.id,
            source_generation: source.generation,
            token_id: 0,
            flags: GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
            payload_bits: 0,
        }
    }

    pub fn presentation_effect(
        actor: Entity,
        source: Entity,
        effect_id: u32,
        effect_type: u32,
    ) -> Self {
        // Keep payload ABI minimal: effect_id in token_id for stable replay/hash ordering.
        // effect_type can be interpreted by the TS presentation layer as a sub-type/category.
        Self {
            kind: GAMEPLAY_EVENT_PRESENTATION_EFFECT,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: source.id,
            source_generation: source.generation,
            token_id: effect_id,
            flags: 0,
            payload_bits: effect_type,
        }
    }

    pub fn behavior_state_changed(entity: Entity, previous_state: u32, next_state: u32) -> Self {
        Self {
            kind: GAMEPLAY_EVENT_BEHAVIOR_STATE_CHANGED,
            actor_id: entity.id,
            actor_generation: entity.generation,
            source_id: entity.id,
            source_generation: entity.generation,
            token_id: next_state,
            flags: 0,
            payload_bits: previous_state,
        }
    }

    pub fn prefab_spawned(actor: Entity, source: Entity, prefab_id: u32, action_id: u32) -> Self {
        Self {
            kind: GAMEPLAY_EVENT_PREFAB_SPAWNED,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: source.id,
            source_generation: source.generation,
            token_id: prefab_id,
            flags: 0,
            payload_bits: action_id,
        }
    }

    pub fn action_failed(actor: Entity, source: Entity, action_id: u32, reason_code: u32) -> Self {
        Self {
            kind: GAMEPLAY_EVENT_ACTION_FAILED,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: source.id,
            source_generation: source.generation,
            token_id: action_id,
            flags: 0,
            payload_bits: reason_code,
        }
    }

    pub fn timer(entity: Entity, timer_id: u32, duration_seconds: f32) -> Self {
        Self {
            kind: GAMEPLAY_EVENT_TIMER,
            actor_id: entity.id,
            actor_generation: entity.generation,
            source_id: entity.id,
            source_generation: entity.generation,
            token_id: timer_id,
            flags: 0,
            payload_bits: duration_seconds.to_bits(),
        }
    }

    pub fn pickup_collected(
        collector: Entity,
        pickup: Entity,
        item_id: u32,
        count: u32,
        target_removed: bool,
    ) -> Self {
        let mut flags = 0;
        if target_removed {
            flags |= GAMEPLAY_EVENT_FLAG_TARGET_REMOVED;
        }
        Self {
            kind: GAMEPLAY_EVENT_PICKUP_COLLECTED,
            actor_id: collector.id,
            actor_generation: collector.generation,
            source_id: pickup.id,
            source_generation: pickup.generation,
            token_id: item_id,
            flags,
            payload_bits: count,
        }
    }

    pub fn tile_impact(payload: GameplayTileImpactEventPayload) -> Self {
        let mut flags = tile_impact_normal_flag(payload.normal_x, payload.normal_y);
        if payload.bounced {
            flags |= GAMEPLAY_EVENT_FLAG_TILE_IMPACT_BOUNCED;
        }
        if payload.target_removed {
            flags |= GAMEPLAY_EVENT_FLAG_TARGET_REMOVED;
        }
        if tile_impact_identity_truncated(payload.layer_index, payload.tile_index) {
            flags |= GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED;
        }
        Self {
            kind: GAMEPLAY_EVENT_TILE_IMPACT,
            actor_id: payload.projectile.id,
            actor_generation: payload.projectile.generation,
            source_id: payload.projectile.id,
            source_generation: payload.projectile.generation,
            token_id: payload.tile_impact_code,
            flags,
            payload_bits: pack_tile_impact_payload(payload.layer_index, payload.tile_index),
        }
    }

    pub fn faction_damage_denied(
        actor: Entity,
        source: Entity,
        source_faction_id: u32,
        target_faction_id: u32,
    ) -> Self {
        Self {
            kind: GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED,
            actor_id: actor.id,
            actor_generation: actor.generation,
            source_id: source.id,
            source_generation: source.generation,
            token_id: source_faction_id,
            flags: 0,
            payload_bits: target_faction_id,
        }
    }
}

pub const fn pack_tile_impact_payload(layer_index: u32, tile_index: u32) -> u32 {
    ((layer_index & 0xff) << GAMEPLAY_EVENT_TILE_IMPACT_LAYER_SHIFT)
        | (tile_index & GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK)
}

pub const fn tile_impact_identity_truncated(layer_index: u32, tile_index: u32) -> bool {
    layer_index > 0xff || tile_index > GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK
}

fn tile_impact_normal_flag(normal_x: f32, normal_y: f32) -> u32 {
    let code = if normal_x > 0.5 {
        GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_X
    } else if normal_x < -0.5 {
        GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X
    } else if normal_y > 0.5 {
        GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_POSITIVE_Y
    } else if normal_y < -0.5 {
        GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_Y
    } else {
        GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NONE
    };
    code << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tile_impact_event_flags_truncated_identity_without_widening_payload() {
        let projectile = Entity {
            id: 7,
            generation: 2,
        };

        let event = GameplayEvent::tile_impact(GameplayTileImpactEventPayload {
            projectile,
            tile_impact_code: 2,
            layer_index: 0x1ff,
            tile_index: GAMEPLAY_EVENT_TILE_IMPACT_TILE_MASK + 9,
            normal_x: -1.0,
            normal_y: 0.0,
            bounced: true,
            target_removed: false,
        });

        assert_eq!(event.kind, GAMEPLAY_EVENT_TILE_IMPACT);
        assert_ne!(
            event.flags & GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED,
            0
        );
        assert_eq!(
            event.flags & GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_MASK,
            GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_NEGATIVE_X << GAMEPLAY_EVENT_TILE_IMPACT_NORMAL_SHIFT
        );
        assert_eq!(event.payload_bits, (0xff << 24) | 8);
    }

    #[test]
    fn tile_impact_event_keeps_identity_flag_clear_within_packed_range() {
        let projectile = Entity {
            id: 7,
            generation: 2,
        };

        let event = GameplayEvent::tile_impact(GameplayTileImpactEventPayload {
            projectile,
            tile_impact_code: 0,
            layer_index: 0xff,
            tile_index: 0x00ff_ffff,
            normal_x: 0.0,
            normal_y: 1.0,
            bounced: false,
            target_removed: true,
        });

        assert_eq!(
            event.flags & GAMEPLAY_EVENT_FLAG_TILE_IMPACT_IDENTITY_TRUNCATED,
            0
        );
        assert_eq!(
            event.flags & GAMEPLAY_EVENT_FLAG_TARGET_REMOVED,
            GAMEPLAY_EVENT_FLAG_TARGET_REMOVED
        );
        assert_eq!(event.payload_bits, 0xffff_ffff);
    }

    #[test]
    fn faction_damage_denied_event_packs_faction_ids_without_extra_flags() {
        let target = Entity {
            id: 5,
            generation: 1,
        };
        let source = Entity {
            id: 9,
            generation: 3,
        };

        let event = GameplayEvent::faction_damage_denied(target, source, 2, 1);

        assert_eq!(event.kind, GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED);
        assert_eq!(event.actor_id, target.id);
        assert_eq!(event.actor_generation, target.generation);
        assert_eq!(event.source_id, source.id);
        assert_eq!(event.source_generation, source.generation);
        assert_eq!(event.token_id, 2);
        assert_eq!(event.flags, 0);
        assert_eq!(event.payload_bits, 1);
    }
}
