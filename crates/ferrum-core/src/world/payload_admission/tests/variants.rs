use super::*;
#[test]
fn all_movement_numeric_fields_are_finite_but_signed_values_are_kept() {
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::TopdownInput { speed: -1. });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::TopdownInput { speed: f32::NAN });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: -1.,
            gravity: -1.,
            jump_speed: -1.,
            max_fall_speed: -1.,
            ground_probe_distance: -1.,
            step_offset: -1.,
            coyote_time_seconds: -1.,
            jump_buffer_seconds: -1.,
        });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: f32::NAN,
            gravity: -1.,
            jump_speed: -1.,
            max_fall_speed: -1.,
            ground_probe_distance: -1.,
            step_offset: -1.,
            coyote_time_seconds: -1.,
            jump_buffer_seconds: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: -1.,
            gravity: f32::NAN,
            jump_speed: -1.,
            max_fall_speed: -1.,
            ground_probe_distance: -1.,
            step_offset: -1.,
            coyote_time_seconds: -1.,
            jump_buffer_seconds: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: -1.,
            gravity: -1.,
            jump_speed: f32::NAN,
            max_fall_speed: -1.,
            ground_probe_distance: -1.,
            step_offset: -1.,
            coyote_time_seconds: -1.,
            jump_buffer_seconds: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: -1.,
            gravity: -1.,
            jump_speed: -1.,
            max_fall_speed: f32::NAN,
            ground_probe_distance: -1.,
            step_offset: -1.,
            coyote_time_seconds: -1.,
            jump_buffer_seconds: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: -1.,
            gravity: -1.,
            jump_speed: -1.,
            max_fall_speed: -1.,
            ground_probe_distance: f32::NAN,
            step_offset: -1.,
            coyote_time_seconds: -1.,
            jump_buffer_seconds: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: -1.,
            gravity: -1.,
            jump_speed: -1.,
            max_fall_speed: -1.,
            ground_probe_distance: -1.,
            step_offset: f32::NAN,
            coyote_time_seconds: -1.,
            jump_buffer_seconds: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: -1.,
            gravity: -1.,
            jump_speed: -1.,
            max_fall_speed: -1.,
            ground_probe_distance: -1.,
            step_offset: -1.,
            coyote_time_seconds: f32::NAN,
            jump_buffer_seconds: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::PlatformerInput {
            horizontal_speed: -1.,
            gravity: -1.,
            jump_speed: -1.,
            max_fall_speed: -1.,
            ground_probe_distance: -1.,
            step_offset: -1.,
            coyote_time_seconds: -1.,
            jump_buffer_seconds: f32::NAN,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Linear { vx: -1., vy: -1. });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Linear {
            vx: f32::NAN,
            vy: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Linear {
            vx: -1.,
            vy: f32::NAN,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Oscillate {
            origin_x: -1.,
            origin_y: -1.,
            amplitude_x: -1.,
            amplitude_y: -1.,
            phase_speed: -1.,
        });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Oscillate {
            origin_x: f32::NAN,
            origin_y: -1.,
            amplitude_x: -1.,
            amplitude_y: -1.,
            phase_speed: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Oscillate {
            origin_x: -1.,
            origin_y: f32::NAN,
            amplitude_x: -1.,
            amplitude_y: -1.,
            phase_speed: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Oscillate {
            origin_x: -1.,
            origin_y: -1.,
            amplitude_x: f32::NAN,
            amplitude_y: -1.,
            phase_speed: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Oscillate {
            origin_x: -1.,
            origin_y: -1.,
            amplitude_x: -1.,
            amplitude_y: f32::NAN,
            phase_speed: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Oscillate {
            origin_x: -1.,
            origin_y: -1.,
            amplitude_x: -1.,
            amplitude_y: -1.,
            phase_speed: f32::NAN,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::MoveToPoint {
            x: -1.,
            y: -1.,
            speed: -1.,
        });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::MoveToPoint {
            x: f32::NAN,
            y: -1.,
            speed: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::MoveToPoint {
            x: -1.,
            y: f32::NAN,
            speed: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::MoveToPoint {
            x: -1.,
            y: -1.,
            speed: f32::NAN,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Chase {
            speed: -1.,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Chase {
            speed: f32::NAN,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::SeekTarget {
            speed: -1.,
            turn_rate: -1.,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::SeekTarget {
            speed: f32::NAN,
            turn_rate: -1.,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::SeekTarget {
            speed: -1.,
            turn_rate: f32::NAN,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Orbit {
            speed: -1.,
            radius: -1.,
            radial_band: -1.,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Orbit {
            speed: f32::NAN,
            radius: -1.,
            radial_band: -1.,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Orbit {
            speed: -1.,
            radius: f32::NAN,
            radial_band: -1.,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Orbit {
            speed: -1.,
            radius: -1.,
            radial_band: f32::NAN,
            target: MovementTarget::Entity(Entity {
                id: u32::MAX,
                generation: u32::MAX,
            }),
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Accelerate {
            acceleration_x: -1.,
            acceleration_y: -1.,
            max_speed: -1.,
        });
        admitted(&copied(&w));
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Accelerate {
            acceleration_x: f32::NAN,
            acceleration_y: -1.,
            max_speed: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Accelerate {
            acceleration_x: -1.,
            acceleration_y: f32::NAN,
            max_speed: -1.,
        });
        rejected(&w);
    }
    {
        let mut w = coverage();
        w.movement_patterns[0] = Some(MovementPattern::Accelerate {
            acceleration_x: -1.,
            acceleration_y: -1.,
            max_speed: f32::NAN,
        });
        rejected(&w);
    }
    let mut w = coverage();
    w.movement_patterns[0] = Some(MovementPattern::Chase {
        target: MovementTarget::NearestFaction(32),
        speed: 1.,
    });
    rejected(&w);
    let mut w = coverage();
    w.movement_patterns[0] = Some(MovementPattern::Chase {
        target: MovementTarget::NearestTag(32),
        speed: 1.,
    });
    rejected(&w);
}
#[test]
fn action_and_reaction_variant_payloads_and_pending_cooldowns_are_checked() {
    let patterns = [
        ActionPattern::Projectile {
            speed: f32::NAN,
            damage: 1.,
            lifetime_seconds: 1.,
            aim: ActionAimSource::Input,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Despawn,
        },
        ActionPattern::Projectile {
            speed: 1.,
            damage: f32::NAN,
            lifetime_seconds: 1.,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Bounce,
        },
        ActionPattern::Projectile {
            speed: 1.,
            damage: 1.,
            lifetime_seconds: f32::NAN,
            aim: ActionAimSource::Input,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::PassThrough,
        },
        ActionPattern::Dash {
            distance: f32::NAN,
            aim: ActionAimSource::Input,
        },
        ActionPattern::Melee {
            range: f32::NAN,
            damage: 1.,
            target: MeleeTarget::Player,
        },
        ActionPattern::Melee {
            range: 1.,
            damage: f32::NAN,
            target: MeleeTarget::Enemies,
        },
        ActionPattern::SpawnPrefab {
            prefab_id: u32::MAX,
            projectile: None,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: f32::NAN,
            offset_y: 0.,
        },
        ActionPattern::SpawnPrefab {
            prefab_id: 0,
            projectile: None,
            anchor: SpawnAnchor::SelfEntity,
            phase: SpawnPhase::PrePhysics,
            offset_x: 0.,
            offset_y: f32::NAN,
        },
    ];
    for pattern in patterns {
        let mut w = coverage();
        let mut set = ActionBindingSet::default();
        set.upsert(ActionBinding {
            action_id: 1,
            pattern,
            cooldown: Cooldown::ready(0.),
        });
        w.action_bindings[0] = Some(set);
        rejected(&w);
    }
    for field in 0..3 {
        let mut payload = SpawnPrefabProjectilePayload {
            speed: 1.,
            damage: 1.,
            lifetime_seconds: 1.,
            aim: ActionAimSource::Input,
            collision_target: ProjectileCollisionTarget::Enemies,
            tile_impact: ProjectileTileImpact::Bounce,
        };
        match field {
            0 => payload.speed = f32::NAN,
            1 => payload.damage = f32::NAN,
            _ => payload.lifetime_seconds = f32::NAN,
        }
        let mut w = coverage();
        let mut set = ActionBindingSet::default();
        set.upsert(ActionBinding {
            action_id: 1,
            pattern: ActionPattern::SpawnPrefab {
                prefab_id: 1,
                projectile: Some(payload),
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: -1.,
                offset_y: 2.,
            },
            cooldown: Cooldown::ready(0.),
        });
        w.action_bindings[0] = Some(set);
        rejected(&w);
    }
    let reactions = [
        CollisionReaction::AreaDamage {
            radius: f32::NAN,
            target_layer: CollisionLayer::Enemy,
        },
        CollisionReaction::Knockback {
            target: CollisionTarget::SelfEntity,
            impulse: f32::NAN,
        },
        CollisionReaction::PlaySound {
            sound_id: 0,
            volume: f32::NAN,
            pitch: 1.,
            cooldown: Cooldown::ready(0.),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        },
        CollisionReaction::PlaySound {
            sound_id: 1,
            volume: 1.,
            pitch: f32::NAN,
            cooldown: Cooldown::ready(0.),
            replace_default: true,
            trigger: CollisionReactionTrigger::Enter,
        },
        CollisionReaction::EmitEffect {
            effect_id: u32::MAX,
            effect_type: u32::MAX,
            target: CollisionTarget::OtherEntity,
            intensity: f32::NAN,
            radius: 1.,
            cooldown: Cooldown::ready(0.),
            trigger: CollisionReactionTrigger::Enter,
        },
        CollisionReaction::EmitEffect {
            effect_id: 0,
            effect_type: 0,
            target: CollisionTarget::SelfEntity,
            intensity: 1.,
            radius: f32::NAN,
            cooldown: Cooldown::ready(0.),
            trigger: CollisionReactionTrigger::Contact,
        },
        CollisionReaction::SpawnPrefab {
            action_id: 0,
            prefab_id: u32::MAX,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(0.),
            trigger: CollisionReactionTrigger::Enter,
            offset_x: f32::NAN,
            offset_y: 1.,
        },
        CollisionReaction::SpawnPrefab {
            action_id: u32::MAX,
            prefab_id: 0,
            target: CollisionTarget::SelfEntity,
            cooldown: Cooldown::ready(0.),
            trigger: CollisionReactionTrigger::Contact,
            offset_x: 1.,
            offset_y: f32::NAN,
        },
        CollisionReaction::SpawnParticle {
            preset_id: 0,
            target: CollisionTarget::OtherEntity,
            cooldown: Cooldown::ready(f32::NAN),
            replace_default: true,
            trigger: CollisionReactionTrigger::Contact,
        },
        CollisionReaction::CameraShake {
            cooldown: Cooldown {
                duration_seconds: 0.,
                remaining_seconds: f32::NAN,
            },
            trigger: CollisionReactionTrigger::Enter,
        },
    ];
    for reaction in reactions {
        let mut w = coverage();
        let mut set = CollisionReactionSet::default();
        set.push(reaction);
        w.collision_reactions[0] = Some(set);
        rejected(&w);
    }
    let mut w = coverage();
    let mut set = ActionBindingSet::default();
    let mut action = ActionBinding::dash(0, -1., -3.);
    action.cooldown.remaining_seconds = -2.;
    set.upsert(action);
    w.action_bindings[0] = Some(set);
    admitted(&copied(&w));
    let mut w = coverage();
    let mut set = ActionBindingSet::default();
    let mut action = ActionBinding::dash(0, 0., -3.);
    action.cooldown.remaining_seconds = f32::NAN;
    set.upsert(action);
    w.action_bindings[0] = Some(set);
    rejected(&w);
    let mut w = coverage();
    w.spring_joints[0].as_mut().unwrap().frequency_hz = Some(f32::NAN);
    rejected(&w);
    let mut w = coverage();
    let mut set = GameplayVariableMutationTriggerSet::default();
    let mut trigger =
        GameplayVariableMutationTrigger::new(0, 0, 1, GameplayVariableMutationOperation::Set, 1.)
            .unwrap();
    trigger.value = f64::NAN;
    set.upsert(trigger);
    w.gameplay_variable_mutation_triggers[0] = Some(set);
    rejected(&w);
}
