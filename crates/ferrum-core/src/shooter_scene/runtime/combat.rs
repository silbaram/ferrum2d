use crate::audio_event::AudioEvent;
use crate::components::gameplay::{
    CollisionTarget, MeleeTarget, ProjectileCollisionTarget, ProjectileTileImpact,
};
use crate::components::{CollisionLayer, Transform2D, Velocity};
use crate::entity::Entity;
use crate::gameplay::{
    action_failure_event_data, apply_collision_pickup_reaction_for_pair,
    apply_collision_reaction_sets_for_pair, apply_default_collision_damage_hit,
    apply_default_collision_game_over_hit, apply_pickup_collision_reaction_sets_for_pair,
    apply_tile_collision_reaction_set, build_collision_layer_pairs,
    build_swept_collision_layer_pairs, collision_gameplay_events_for_reaction_outcome,
    collision_hit_presentation_payload, collision_reaction_pair_for_layer_pair,
    collision_side_effect_payload, commit_collision_spawn_prefab_reaction_cooldown,
    damage_at_or_default, default_collision_damage_gameplay_event_payload,
    default_collision_damage_score_delta, default_melee_damage_allowed,
    default_projectile_damage_allowed, drain_deferred_commands_into, faction_damage_denial,
    has_collision_reaction_sets_for_pair, melee_attack_attacker_can_resolve,
    melee_attack_target_can_receive_hit, projectile_collision_target_at, push_action_failure_event,
    queue_marked_despawn, run_melee_attack_query, should_emit_default_game_over_audio,
    summarize_collision_reaction_set_outcome,
    target_only_default_collision_damage_hit_presentation_payload, CollisionDamageReactionDefaults,
    CollisionHitPresentationPayload, CollisionReactionOutcomeSummary, CollisionReactionPair,
    CollisionReactionSetOutcome, CollisionReactionTargetRole, CollisionSideEffectEvaluation,
    CollisionSideEffectPayload, CollisionSpawnPrefabEvaluation, DefaultCollisionDamageHitOutcome,
    PickupCollisionReactionSetOutcome,
};
use crate::gameplay_event::{
    GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE, GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
    GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
};
use crate::tilemap::Tilemap;
use crate::world::World;

use super::super::{
    ShooterScene, DEFAULT_BULLET_DAMAGE, DEFAULT_ENEMY_HEALTH, DEFAULT_SCORE_REWARD,
};
use super::{
    push_audio_event, push_game_over_audio_event, push_hit_audio_event, CollisionEventSink,
    GameplayEventSink, ParticleBurstSink, TweenSink,
};

#[derive(Debug, Clone, Copy, PartialEq)]
struct AuthoredCollisionReactionOutcome {
    summary: CollisionReactionOutcomeSummary,
    game_over_entered: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct CollisionHitPresentationDispatchResult {
    collision_event_pushed: bool,
    particles_spawned: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct MeleeHitSideEffectDispatchResult {
    collision_event_pushed: bool,
    gameplay_event_pushed: bool,
    particles_spawned: usize,
    hit_tween_started: bool,
    hit_audio_event_pushed: bool,
    score_delta: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PendingMeleeAttackDrainResult {
    command_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PendingEnemyTargetMeleeResolutionResult {
    targets_damaged: usize,
    targets_removed: usize,
    score_delta: u32,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct PendingPlayerTargetMeleeResolutionResult {
    game_over_entered: bool,
    collision_event_pushed: bool,
    game_over_audio_pushed: bool,
}

impl ShooterScene {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn handle_collisions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        audio_events: &mut Vec<AudioEvent>,
        delta: f32,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
        mut hit_tweens: Option<&mut TweenSink<'_>>,
    ) {
        self.prepare_collision_scratch(world.alive.len());
        self.last_collision_pair_stats = Default::default();
        self.handle_pending_melee_attacks(
            world,
            audio_events,
            collision_events.as_deref_mut(),
            gameplay_events.as_deref_mut(),
            hit_particles.as_deref_mut(),
            hit_tweens.as_deref_mut(),
        );
        self.handle_bullet_enemy_collisions(
            world,
            tilemap,
            audio_events,
            delta,
            collision_events.as_deref_mut(),
            gameplay_events.as_deref_mut(),
            hit_particles.as_deref_mut(),
            hit_tweens,
        );
        self.handle_bullet_player_collisions(
            world,
            audio_events,
            delta,
            collision_events.as_deref_mut(),
            gameplay_events.as_deref_mut(),
        );
        self.handle_player_enemy_collisions(
            world,
            tilemap,
            audio_events,
            collision_events,
            gameplay_events.as_deref_mut(),
            hit_particles.as_deref_mut(),
        );
        self.handle_player_pickup_collisions(
            world,
            tilemap,
            audio_events,
            gameplay_events,
            hit_particles,
        );

        self.despawn_pending(world);
        self.finish_authored_collision_contacts();
    }

    fn prepare_collision_scratch(&mut self, alive_len: usize) {
        self.clear_pending_despawns();
        self.marked_for_despawn.clear();
        self.marked_for_despawn.resize(alive_len, false);
        self.bounced_projectiles_this_frame.clear();
        self.bounced_projectiles_this_frame.resize(alive_len, false);
        self.collision_pairs.clear();
        self.authored_collision_contacts.clear_current();
    }

    fn register_authored_collision_contact(&mut self, first: Entity, second: Entity) -> bool {
        self.authored_collision_contacts.register(first, second)
    }

    fn finish_authored_collision_contacts(&mut self) {
        self.authored_collision_contacts.finish();
    }

    fn record_bullet_enemy_swept_collision_query(&mut self) {
        let usage = self.collision_scratch.usage();
        self.last_collision_pair_stats.bullet_enemy_swept_pairs = self.collision_pairs.len();
        self.last_collision_pair_stats.bullet_enemy_moving_proxies = usage.moving_proxies;
        self.last_collision_pair_stats.bullet_enemy_target_proxies = usage.target_proxies;
    }

    fn record_bullet_player_swept_collision_query(&mut self) {
        let usage = self.collision_scratch.usage();
        self.last_collision_pair_stats.bullet_player_swept_pairs = self.collision_pairs.len();
        self.last_collision_pair_stats.bullet_player_moving_proxies = usage.moving_proxies;
        self.last_collision_pair_stats.bullet_player_target_proxies = usage.target_proxies;
    }

    fn record_player_enemy_collision_query(&mut self) {
        let usage = self.collision_scratch.usage();
        self.last_collision_pair_stats.player_enemy_pairs = self.collision_pairs.len();
        self.last_collision_pair_stats.player_enemy_current_proxies = usage.current_proxies;
    }

    fn record_player_pickup_collision_query(&mut self) {
        let usage = self.collision_scratch.usage();
        self.last_collision_pair_stats.player_pickup_pairs = self.collision_pairs.len();
        self.last_collision_pair_stats.player_pickup_current_proxies = usage.current_proxies;
    }

    fn handle_pending_melee_attacks(
        &mut self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
        mut hit_tweens: Option<&mut TweenSink<'_>>,
    ) {
        let drain = self.drain_pending_melee_attacks_for_phase();
        if drain.command_count == 0 {
            return;
        }

        for command_index in 0..drain.command_count {
            let command = self.melee_attack_commands[command_index];
            if !melee_attack_attacker_can_resolve(
                world,
                command.attacker,
                command.target,
                &self.marked_for_despawn,
            ) {
                continue;
            }
            if command.target == MeleeTarget::Enemies {
                self.handle_pending_enemy_target_melee(
                    world,
                    command,
                    audio_events,
                    collision_events.as_deref_mut(),
                    gameplay_events.as_deref_mut(),
                    hit_particles.as_deref_mut(),
                    hit_tweens.as_deref_mut(),
                );
            } else {
                self.handle_pending_player_target_melee(
                    world,
                    command,
                    audio_events,
                    collision_events.as_deref_mut(),
                    gameplay_events.as_deref_mut(),
                );
            }
        }
        self.melee_attack_commands.clear();
    }

    fn drain_pending_melee_attacks_for_phase(&mut self) -> PendingMeleeAttackDrainResult {
        let command_count = drain_deferred_commands_into(
            &mut self.pending_melee_attacks,
            &mut self.melee_attack_commands,
        );
        PendingMeleeAttackDrainResult { command_count }
    }

    #[allow(clippy::too_many_arguments)]
    fn handle_pending_enemy_target_melee(
        &mut self,
        world: &mut World,
        command: super::MeleeAttackCommand,
        audio_events: &mut Vec<AudioEvent>,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
        mut hit_tweens: Option<&mut TweenSink<'_>>,
    ) -> PendingEnemyTargetMeleeResolutionResult {
        run_melee_attack_query(
            world,
            command.center,
            command.range,
            command.target,
            command.height_span,
            &mut self.melee_hits,
        );
        let hit_sound_id = self.sound_ids.hit;
        let hit_volume = self.config.audio_policy.hit_volume;
        let hit_pitch = self.config.audio_policy.hit_pitch;
        let mut result = PendingEnemyTargetMeleeResolutionResult {
            targets_damaged: 0,
            targets_removed: 0,
            score_delta: 0,
        };
        for hit_index in 0..self.melee_hits.len() {
            let enemy = self.melee_hits[hit_index].entity;
            if enemy == command.attacker {
                continue;
            }
            let enemy_index = enemy.id as usize;
            if !melee_attack_target_can_receive_hit(
                world,
                enemy,
                MeleeTarget::Enemies,
                &self.marked_for_despawn,
            ) {
                continue;
            }
            if !default_melee_damage_allowed(world, command.attacker.id as usize, enemy_index) {
                if let Some(denial) =
                    faction_damage_denial(world, command.attacker.id as usize, enemy_index)
                {
                    if let Some(events) = gameplay_events.as_deref_mut() {
                        events.push_faction_damage_denied(
                            denial.target,
                            denial.source,
                            denial.source_faction_id,
                            denial.target_faction_id,
                        );
                    }
                }
                continue;
            }
            let Some(damage_outcome) = apply_default_collision_damage_hit(
                world,
                command.attacker.id as usize,
                enemy_index,
                command.damage,
                DEFAULT_ENEMY_HEALTH,
                DEFAULT_SCORE_REWARD,
                false,
                true,
                &mut self.marked_for_despawn,
                &mut self.pending_despawn,
            ) else {
                continue;
            };
            let hit_side_effects = self.dispatch_melee_enemy_hit_side_effects(
                world,
                audio_events,
                collision_events.as_deref_mut(),
                gameplay_events.as_deref_mut(),
                hit_particles.as_deref_mut(),
                hit_tweens.as_deref_mut(),
                damage_outcome,
                hit_sound_id,
                hit_volume,
                hit_pitch,
            );
            result.targets_damaged += 1;
            if damage_outcome.target_removed {
                result.targets_removed += 1;
            }
            result.score_delta = result
                .score_delta
                .saturating_add(hit_side_effects.score_delta);
        }
        result
    }

    fn handle_pending_player_target_melee(
        &mut self,
        world: &mut World,
        command: super::MeleeAttackCommand,
        audio_events: &mut Vec<AudioEvent>,
        collision_events: Option<&mut CollisionEventSink<'_>>,
        gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> PendingPlayerTargetMeleeResolutionResult {
        let Some(player) = world.player else {
            return PendingPlayerTargetMeleeResolutionResult::default();
        };
        if !melee_attack_target_can_receive_hit(
            world,
            player,
            MeleeTarget::Player,
            &self.marked_for_despawn,
        ) {
            return PendingPlayerTargetMeleeResolutionResult::default();
        }
        run_melee_attack_query(
            world,
            command.center,
            command.range,
            command.target,
            command.height_span,
            &mut self.melee_hits,
        );
        if !self.melee_hits.iter().any(|hit| hit.entity == player) {
            return PendingPlayerTargetMeleeResolutionResult::default();
        }
        if !default_melee_damage_allowed(world, command.attacker.id as usize, player.id as usize) {
            if let Some(denial) =
                faction_damage_denial(world, command.attacker.id as usize, player.id as usize)
            {
                if let Some(events) = gameplay_events {
                    events.push_faction_damage_denied(
                        denial.target,
                        denial.source,
                        denial.source_faction_id,
                        denial.target_faction_id,
                    );
                }
            }
            return PendingPlayerTargetMeleeResolutionResult::default();
        }
        let game_over_entered = self.enter_game_over();
        let should_emit_game_over_audio =
            should_emit_default_game_over_audio(game_over_entered, None);
        let mut collision_event_pushed = false;
        let mut game_over_audio_pushed = false;
        if should_emit_game_over_audio {
            if let Some(events) = collision_events {
                events.push_hit(command.attacker, player, command.damage);
                collision_event_pushed = true;
            }
            let audio_event_count_before = audio_events.len();
            push_game_over_audio_event(
                audio_events,
                self.sound_ids.game_over,
                self.config.audio_policy,
            );
            game_over_audio_pushed = audio_events.len() > audio_event_count_before;
        }
        PendingPlayerTargetMeleeResolutionResult {
            game_over_entered,
            collision_event_pushed,
            game_over_audio_pushed,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn dispatch_melee_enemy_hit_side_effects(
        &mut self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
        collision_events: Option<&mut CollisionEventSink<'_>>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        hit_particles: Option<&mut ParticleBurstSink<'_>>,
        mut hit_tweens: Option<&mut TweenSink<'_>>,
        damage_outcome: DefaultCollisionDamageHitOutcome,
        hit_sound_id: u32,
        hit_volume: f32,
        hit_pitch: f32,
    ) -> MeleeHitSideEffectDispatchResult {
        let hit_presentation =
            target_only_default_collision_damage_hit_presentation_payload(world, damage_outcome);
        let presentation_result = dispatch_collision_hit_presentation_payload(
            collision_events,
            hit_particles,
            hit_presentation,
        );
        let gameplay_event_pushed = gameplay_events.as_mut().is_some_and(|events| {
            events
                .push_collision_payload(default_collision_damage_gameplay_event_payload(
                    damage_outcome,
                ))
                .event_pushed
        });
        let score_delta = default_collision_damage_score_delta(damage_outcome);
        self.commit_score_delta(score_delta);
        let hit_tween_started = if damage_outcome.killed {
            false
        } else {
            hit_tweens.as_mut().is_some_and(|tweens| {
                tweens
                    .flash_enemy_hit_payload(world, hit_presentation)
                    .tween_started
            })
        };
        let hit_audio_event_pushed = push_hit_audio_event(
            audio_events,
            hit_presentation,
            hit_sound_id,
            hit_volume,
            hit_pitch,
        )
        .audio_event_pushed;
        MeleeHitSideEffectDispatchResult {
            collision_event_pushed: presentation_result.collision_event_pushed,
            gameplay_event_pushed,
            particles_spawned: presentation_result.particles_spawned,
            hit_tween_started,
            hit_audio_event_pushed,
            score_delta,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn handle_bullet_enemy_collisions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        audio_events: &mut Vec<AudioEvent>,
        delta: f32,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
        mut hit_tweens: Option<&mut TweenSink<'_>>,
    ) {
        self.handle_bullet_tile_collisions(
            world,
            tilemap,
            delta,
            audio_events,
            gameplay_events.as_deref_mut(),
            hit_particles.as_deref_mut(),
        );
        build_swept_collision_layer_pairs(
            &mut self.collision_scratch,
            world,
            CollisionLayer::Bullet,
            CollisionLayer::Enemy,
            delta,
            &mut self.collision_pairs,
        );
        self.record_bullet_enemy_swept_collision_query();
        let hit_sound_id = self.sound_ids.hit;
        let hit_volume = self.config.audio_policy.hit_volume;
        let hit_pitch = self.config.audio_policy.hit_pitch;
        for pair_index in 0..self.collision_pairs.len() {
            let pair = self.collision_pairs[pair_index];
            let Some(reaction_pair) = collision_reaction_pair_for_layer_pair(
                world,
                pair,
                CollisionLayer::Bullet,
                CollisionLayer::Enemy,
                &self.marked_for_despawn,
            ) else {
                continue;
            };
            let bullet_index = reaction_pair.source_index;
            let enemy_index = reaction_pair.other_index;
            if self.bounced_projectiles_this_frame[bullet_index] {
                continue;
            }
            if projectile_collision_target_at(world, bullet_index)
                != ProjectileCollisionTarget::Enemies
            {
                continue;
            }

            let authored_outcome = self.apply_authored_collision_reactions(
                world,
                tilemap,
                reaction_pair.source,
                reaction_pair.other,
                audio_events,
                gameplay_events.as_deref_mut(),
                hit_particles.as_deref_mut(),
            );
            let overrides_default_gameplay = authored_outcome
                .as_ref()
                .is_some_and(|outcome| outcome.summary.overrides_default_gameplay);
            let damage = if overrides_default_gameplay {
                authored_outcome
                    .as_ref()
                    .map_or(0.0, |outcome| outcome.summary.total_damage)
            } else {
                if !default_projectile_damage_allowed(
                    world,
                    bullet_index,
                    enemy_index,
                    ProjectileCollisionTarget::Enemies,
                ) {
                    if let Some(denial) = faction_damage_denial(world, bullet_index, enemy_index) {
                        if let Some(events) = gameplay_events.as_deref_mut() {
                            events.push_faction_damage_denied(
                                denial.target,
                                denial.source,
                                denial.source_faction_id,
                                denial.target_faction_id,
                            );
                        }
                    }
                    continue;
                }
                damage_at_or_default(world, bullet_index, DEFAULT_BULLET_DAMAGE)
            };
            if authored_outcome
                .as_ref()
                .is_some_and(|outcome| outcome.summary.faction_damage_denied)
            {
                continue;
            }
            let hit_presentation = collision_hit_presentation_payload(
                world,
                reaction_pair,
                damage,
                authored_outcome.as_ref().map(|outcome| &outcome.summary),
            );
            dispatch_collision_hit_presentation_payload(
                collision_events.as_deref_mut(),
                hit_particles.as_deref_mut(),
                hit_presentation,
            );
            if let Some(outcome) = authored_outcome
                .as_ref()
                .filter(|outcome| outcome.summary.overrides_default_gameplay)
            {
                if outcome.summary.enemy_damaged && !outcome.summary.enemy_removed {
                    if let Some(tweens) = hit_tweens.as_deref_mut() {
                        tweens.flash_enemy_hit_payload(world, hit_presentation);
                    }
                }
            } else {
                let Some(default_outcome) = apply_default_collision_damage_hit(
                    world,
                    bullet_index,
                    enemy_index,
                    damage,
                    DEFAULT_ENEMY_HEALTH,
                    DEFAULT_SCORE_REWARD,
                    true,
                    true,
                    &mut self.marked_for_despawn,
                    &mut self.pending_despawn,
                ) else {
                    continue;
                };
                let score_delta = default_collision_damage_score_delta(default_outcome);
                self.commit_score_delta(score_delta);
                if !default_outcome.killed {
                    if let Some(tweens) = hit_tweens.as_deref_mut() {
                        tweens.flash_enemy_hit_payload(world, hit_presentation);
                    }
                }
            }
            push_hit_audio_event(
                audio_events,
                hit_presentation,
                hit_sound_id,
                hit_volume,
                hit_pitch,
            );
        }
    }

    fn handle_bullet_player_collisions(
        &mut self,
        world: &mut World,
        audio_events: &mut Vec<AudioEvent>,
        delta: f32,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) {
        let Some(player) = world.player else {
            return;
        };
        let player_index = player.id as usize;
        if !Self::is_alive_layer(world, player_index, CollisionLayer::Player)
            || self.marked_for_despawn[player_index]
        {
            return;
        }
        build_swept_collision_layer_pairs(
            &mut self.collision_scratch,
            world,
            CollisionLayer::Bullet,
            CollisionLayer::Player,
            delta,
            &mut self.collision_pairs,
        );
        self.record_bullet_player_swept_collision_query();
        for pair_index in 0..self.collision_pairs.len() {
            let pair = self.collision_pairs[pair_index];
            let Some(reaction_pair) = collision_reaction_pair_for_layer_pair(
                world,
                pair,
                CollisionLayer::Bullet,
                CollisionLayer::Player,
                &self.marked_for_despawn,
            ) else {
                continue;
            };
            let bullet_index = reaction_pair.source_index;
            if reaction_pair.other != player {
                continue;
            }
            if self.bounced_projectiles_this_frame[bullet_index] {
                continue;
            }
            if projectile_collision_target_at(world, bullet_index)
                != ProjectileCollisionTarget::Player
            {
                continue;
            }
            if !default_projectile_damage_allowed(
                world,
                bullet_index,
                player_index,
                ProjectileCollisionTarget::Player,
            ) {
                if let Some(denial) = faction_damage_denial(world, bullet_index, player_index) {
                    if let Some(events) = gameplay_events.as_deref_mut() {
                        events.push_faction_damage_denied(
                            denial.target,
                            denial.source,
                            denial.source_faction_id,
                            denial.target_faction_id,
                        );
                    }
                }
                continue;
            }
            let damage = damage_at_or_default(world, bullet_index, DEFAULT_BULLET_DAMAGE);
            let Some(default_outcome) = apply_default_collision_game_over_hit(
                world,
                bullet_index,
                player_index,
                damage,
                true,
                &mut self.marked_for_despawn,
                &mut self.pending_despawn,
            ) else {
                continue;
            };
            if should_emit_default_game_over_audio(self.enter_game_over(), None) {
                if let Some(events) = collision_events.as_mut() {
                    events.push_hit(reaction_pair.source, player, default_outcome.damage);
                }
                push_game_over_audio_event(
                    audio_events,
                    self.sound_ids.game_over,
                    self.config.audio_policy,
                );
            }
            break;
        }
    }

    fn handle_bullet_tile_collisions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        delta: f32,
        audio_events: &mut Vec<AudioEvent>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
    ) {
        let alive_count = world.alive_indices().len();
        for alive_position in 0..alive_count {
            let bullet_index = world.alive_indices()[alive_position];
            if !Self::is_alive_layer(world, bullet_index, CollisionLayer::Bullet)
                || self.marked_for_despawn[bullet_index]
            {
                continue;
            }
            let tile_impact = projectile_tile_impact(world, bullet_index);
            if tile_impact == ProjectileTileImpact::PassThrough {
                continue;
            }
            let Some(collider) = world.colliders[bullet_index] else {
                continue;
            };
            let Some(transform) = world.transforms[bullet_index] else {
                continue;
            };
            let velocity = world.velocities[bullet_index].unwrap_or_default();
            let start = if delta.is_finite() && delta > 0.0 {
                crate::components::Transform2D {
                    x: transform.x - velocity.vx * delta,
                    y: transform.y - velocity.vy * delta,
                }
            } else {
                transform
            };
            let Some(tile_hit) = tilemap.projectile_aabb_blocking_tile_hit(
                start,
                velocity,
                collider,
                delta,
                world.height_spans[bullet_index],
            ) else {
                continue;
            };
            let impact_center = tile_impact_center(start, velocity, delta, tile_hit);
            {
                let reactions = world
                    .collision_reactions
                    .get(bullet_index)
                    .copied()
                    .flatten();
                let authored_self_despawn = if let Some(mut reactions) = reactions {
                    let outcome = apply_tile_collision_reaction_set(
                        world,
                        bullet_index,
                        impact_center,
                        &mut reactions,
                        &mut self.area_damage_hits,
                        &mut self.marked_for_despawn,
                        &mut self.pending_despawn,
                        Self::collision_damage_defaults,
                    );
                    world.collision_reactions[bullet_index] = Some(reactions);

                    let reaction_summary =
                        summarize_collision_reaction_set_outcome(outcome.reaction_outcome(), {
                            |target_index| Self::collision_reaction_target_role(world, target_index)
                        });
                    self.commit_score_delta(reaction_summary.score_delta);
                    if reaction_summary.player_game_over {
                        self.enter_game_over();
                    }

                    let projectile_entity = Entity {
                        id: bullet_index as u32,
                        generation: world.generations.get(bullet_index).copied().unwrap_or(0),
                    };
                    if let Some(events) = gameplay_events.as_mut() {
                        let context = CollisionReactionPair::new(
                            bullet_index,
                            bullet_index,
                            projectile_entity,
                            projectile_entity,
                        );
                        let payloads = collision_gameplay_events_for_reaction_outcome(
                            context,
                            outcome.reaction_outcome(),
                        );
                        for payload in payloads.events() {
                            events.push_collision_payload(payload);
                        }
                    }

                    if let Some(despawn_outcome) = outcome.despawn_outcome {
                        if let Some(events) = gameplay_events.as_mut() {
                            events.push_collision_despawn(
                                despawn_outcome.target,
                                despawn_outcome.target,
                            );
                        }
                    }
                    for side_effect in outcome.side_effects() {
                        Self::apply_collision_side_effect(
                            world,
                            side_effect,
                            audio_events,
                            hit_particles.as_deref_mut(),
                            gameplay_events.as_deref_mut(),
                            projectile_entity,
                            projectile_entity,
                        );
                    }
                    for spawn in outcome.spawn_prefabs() {
                        self.apply_collision_spawn_prefab(
                            world,
                            tilemap,
                            spawn,
                            gameplay_events.as_deref_mut(),
                        );
                    }
                    outcome.queued_self_despawn
                } else {
                    false
                };
                if tile_impact == ProjectileTileImpact::Bounce {
                    let bounced = !authored_self_despawn;
                    if let Some(events) = gameplay_events.as_mut() {
                        if let Some(projectile) = entity_at(world, bullet_index) {
                            events.push_tile_impact(
                                projectile,
                                tile_impact.code(),
                                tile_hit.layer_index as u32,
                                tile_hit.tile_index as u32,
                                tile_hit.contact.normal_x,
                                tile_hit.contact.normal_y,
                                bounced,
                                authored_self_despawn,
                            );
                        }
                    }
                    if bounced {
                        bounce_projectile_off_tile(
                            world,
                            bullet_index,
                            start,
                            velocity,
                            delta,
                            tile_hit,
                        );
                        self.bounced_projectiles_this_frame[bullet_index] = true;
                    }
                    continue;
                }
                if !authored_self_despawn {
                    queue_marked_despawn(
                        world,
                        bullet_index,
                        &mut self.marked_for_despawn,
                        &mut self.pending_despawn,
                    );
                }
                if let Some(events) = gameplay_events.as_mut() {
                    if let Some(projectile) = entity_at(world, bullet_index) {
                        events.push_tile_impact(
                            projectile,
                            tile_impact.code(),
                            tile_hit.layer_index as u32,
                            tile_hit.tile_index as u32,
                            tile_hit.contact.normal_x,
                            tile_hit.contact.normal_y,
                            false,
                            true,
                        );
                    }
                }
            }
        }
    }

    fn handle_player_enemy_collisions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        audio_events: &mut Vec<AudioEvent>,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
    ) {
        let Some(player) = world.player else {
            return;
        };
        let player_index = player.id as usize;
        if !Self::is_alive_layer(world, player_index, CollisionLayer::Player)
            || self.marked_for_despawn[player_index]
        {
            return;
        }
        build_collision_layer_pairs(
            &mut self.collision_scratch,
            world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
            &mut self.collision_pairs,
        );
        self.record_player_enemy_collision_query();
        for pair_index in 0..self.collision_pairs.len() {
            let pair = self.collision_pairs[pair_index];
            let Some(reaction_pair) = collision_reaction_pair_for_layer_pair(
                world,
                pair,
                CollisionLayer::Player,
                CollisionLayer::Enemy,
                &self.marked_for_despawn,
            ) else {
                continue;
            };
            let enemy_index = reaction_pair.other_index;
            if reaction_pair.source != player {
                continue;
            }
            let authored_outcome = self.apply_authored_collision_reactions(
                world,
                tilemap,
                reaction_pair.source,
                reaction_pair.other,
                audio_events,
                gameplay_events.as_deref_mut(),
                hit_particles.as_deref_mut(),
            );
            if let Some(outcome) = authored_outcome
                .as_ref()
                .filter(|outcome| outcome.summary.overrides_default_gameplay)
            {
                if outcome.summary.faction_damage_denied {
                    continue;
                }
                if let Some(events) = collision_events.as_mut() {
                    events.push_hit(
                        reaction_pair.source,
                        reaction_pair.other,
                        outcome.summary.total_damage,
                    );
                }
                if outcome.summary.player_game_over {
                    if !should_emit_default_game_over_audio(
                        outcome.game_over_entered,
                        Some(&outcome.summary),
                    ) {
                        break;
                    }
                    push_game_over_audio_event(
                        audio_events,
                        self.sound_ids.game_over,
                        self.config.audio_policy,
                    );
                    break;
                }
                continue;
            }
            let game_over_entered = self.enter_game_over();
            if game_over_entered {
                let Some(default_outcome) = apply_default_collision_game_over_hit(
                    world,
                    player_index,
                    enemy_index,
                    0.0,
                    false,
                    &mut self.marked_for_despawn,
                    &mut self.pending_despawn,
                ) else {
                    continue;
                };
                if let Some(events) = collision_events.as_mut() {
                    events.push_hit(
                        reaction_pair.source,
                        reaction_pair.other,
                        default_outcome.damage,
                    );
                }
                if should_emit_default_game_over_audio(
                    game_over_entered,
                    authored_outcome.as_ref().map(|outcome| &outcome.summary),
                ) {
                    push_game_over_audio_event(
                        audio_events,
                        self.sound_ids.game_over,
                        self.config.audio_policy,
                    );
                }
            }
            break;
        }
    }

    fn handle_player_pickup_collisions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        audio_events: &mut Vec<AudioEvent>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
    ) {
        let Some(player) = world.player else {
            return;
        };
        let player_index = player.id as usize;
        if !Self::is_alive_layer(world, player_index, CollisionLayer::Player)
            || self.marked_for_despawn[player_index]
        {
            return;
        }
        if !world.pickups.iter().any(Option::is_some) {
            return;
        }

        build_collision_layer_pairs(
            &mut self.collision_scratch,
            world,
            CollisionLayer::Player,
            CollisionLayer::Pickup,
            &mut self.collision_pairs,
        );
        self.record_player_pickup_collision_query();
        for pair_index in 0..self.collision_pairs.len() {
            let pair = self.collision_pairs[pair_index];
            let Some(reaction_pair) = collision_reaction_pair_for_layer_pair(
                world,
                pair,
                CollisionLayer::Player,
                CollisionLayer::Pickup,
                &self.marked_for_despawn,
            ) else {
                continue;
            };
            if reaction_pair.source != player {
                continue;
            }
            let pickup_index = reaction_pair.other_index;
            if world.pickups[pickup_index].is_none() {
                continue;
            }
            let pickup_entity = reaction_pair.other;
            if self.apply_authored_pickup_collision_reactions(
                world,
                tilemap,
                reaction_pair.source,
                reaction_pair.other,
                audio_events,
                gameplay_events.as_deref_mut(),
                hit_particles.as_deref_mut(),
            ) {
                continue;
            }
            self.apply_collision_pickup_reaction(
                world,
                CollisionReactionPair::new(pickup_index, player_index, pickup_entity, player),
                CollisionTarget::SelfEntity,
                gameplay_events.as_deref_mut(),
            );
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_authored_pickup_collision_reactions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        first: Entity,
        second: Entity,
        audio_events: &mut Vec<AudioEvent>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
    ) -> bool {
        let first_index = first.id as usize;
        let second_index = second.id as usize;
        let pair = CollisionReactionPair::new(first_index, second_index, first, second);
        if !has_collision_reaction_sets_for_pair(world, pair) {
            return false;
        }
        let contact_entered = self.register_authored_collision_contact(first, second);
        let Some(reaction_outcomes) = apply_pickup_collision_reaction_sets_for_pair(
            world,
            pair,
            contact_entered,
            &mut self.marked_for_despawn,
            &mut self.pending_despawn,
        ) else {
            return false;
        };
        for applied in reaction_outcomes.outcomes() {
            self.apply_pickup_collision_reaction_set_outcome(
                world,
                tilemap,
                pair,
                applied.outcome,
                audio_events,
                gameplay_events.as_deref_mut(),
                hit_particles.as_deref_mut(),
            );
        }
        reaction_outcomes.handled_pickup
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_pickup_collision_reaction_set_outcome(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        context: CollisionReactionPair,
        outcome: PickupCollisionReactionSetOutcome,
        audio_events: &mut Vec<AudioEvent>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
    ) {
        for pickup_outcome in outcome.pickup_outcomes() {
            self.commit_score_delta(pickup_outcome.count);
            if let Some(events) = gameplay_events.as_mut() {
                events.push_pickup_collected(
                    pickup_outcome.collector,
                    pickup_outcome.pickup,
                    pickup_outcome.item_id,
                    pickup_outcome.count,
                    pickup_outcome.target_removed,
                );
            }
        }
        for side_effect in outcome.side_effects() {
            Self::apply_collision_side_effect(
                world,
                side_effect,
                audio_events,
                hit_particles.as_deref_mut(),
                gameplay_events.as_deref_mut(),
                context.source,
                context.other,
            );
        }
        for spawn in outcome.spawn_prefabs() {
            self.apply_collision_spawn_prefab(
                world,
                tilemap,
                spawn,
                gameplay_events.as_deref_mut(),
            );
        }
    }

    fn is_alive_layer(world: &World, index: usize, layer: CollisionLayer) -> bool {
        world.alive.get(index).copied().unwrap_or(false)
            && world.collider_layer_at(index) == Some(layer)
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_authored_collision_reactions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        first: Entity,
        second: Entity,
        audio_events: &mut Vec<AudioEvent>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
    ) -> Option<AuthoredCollisionReactionOutcome> {
        let first_index = first.id as usize;
        let second_index = second.id as usize;
        let contact_entered = self.register_authored_collision_contact(first, second);
        let mut outcome = CollisionReactionOutcomeSummary::default();
        let mut game_over_entered = false;
        let pair = CollisionReactionPair::new(first_index, second_index, first, second);
        let reaction_outcomes = apply_collision_reaction_sets_for_pair(
            world,
            pair,
            contact_entered,
            &mut self.area_damage_hits,
            &mut self.marked_for_despawn,
            &mut self.pending_despawn,
            Self::collision_damage_defaults,
        )?;
        for applied in reaction_outcomes.outcomes() {
            game_over_entered |= self.apply_authored_collision_reaction_outcome(
                world,
                tilemap,
                applied.pair,
                applied.outcome,
                &mut outcome,
                audio_events,
                gameplay_events.as_deref_mut(),
                hit_particles.as_deref_mut(),
            );
        }
        Some(AuthoredCollisionReactionOutcome {
            summary: outcome,
            game_over_entered,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn apply_authored_collision_reaction_outcome(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        context: CollisionReactionPair,
        reaction_outcome: CollisionReactionSetOutcome,
        outcome: &mut CollisionReactionOutcomeSummary,
        audio_events: &mut Vec<AudioEvent>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
    ) -> bool {
        let reaction_summary =
            summarize_collision_reaction_set_outcome(&reaction_outcome, |target_index| {
                Self::collision_reaction_target_role(world, target_index)
            });
        outcome.merge(reaction_summary);
        self.commit_score_delta(reaction_summary.score_delta);
        let game_over_entered = reaction_summary.player_game_over && self.enter_game_over();

        if let Some(events) = gameplay_events.as_mut() {
            let gameplay_event_payloads =
                collision_gameplay_events_for_reaction_outcome(context, &reaction_outcome);
            for payload in gameplay_event_payloads.events() {
                events.push_collision_payload(payload);
            }
        }

        for side_effect in reaction_outcome.side_effects() {
            Self::apply_collision_side_effect(
                world,
                side_effect,
                audio_events,
                hit_particles.as_deref_mut(),
                gameplay_events.as_deref_mut(),
                context.source,
                context.other,
            );
        }

        for spawn in reaction_outcome.spawn_prefabs() {
            self.apply_collision_spawn_prefab(
                world,
                tilemap,
                spawn,
                gameplay_events.as_deref_mut(),
            );
        }

        game_over_entered
    }

    fn collision_reaction_target_role(
        world: &World,
        target_index: usize,
    ) -> CollisionReactionTargetRole {
        match world.collider_layer_at(target_index) {
            Some(CollisionLayer::Player) => CollisionReactionTargetRole::Player,
            Some(CollisionLayer::Enemy) => CollisionReactionTargetRole::Enemy,
            _ => CollisionReactionTargetRole::Other,
        }
    }

    fn collision_damage_defaults(
        world: &World,
        target_index: usize,
    ) -> CollisionDamageReactionDefaults {
        let target_layer = world.collider_layer_at(target_index);
        CollisionDamageReactionDefaults {
            health: if target_layer == Some(CollisionLayer::Enemy) {
                DEFAULT_ENEMY_HEALTH
            } else {
                1.0
            },
            score_reward: if target_layer == Some(CollisionLayer::Enemy) {
                DEFAULT_SCORE_REWARD
            } else {
                0
            },
            despawn_on_kill: target_layer != Some(CollisionLayer::Player),
        }
    }

    fn apply_collision_spawn_prefab(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        evaluation: CollisionSpawnPrefabEvaluation,
        gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> bool {
        let command = match self.collision_spawn_prefab_command(
            world,
            evaluation.source,
            evaluation.anchor,
            evaluation.action_id,
            evaluation.prefab_id,
            evaluation.offset_x,
            evaluation.offset_y,
        ) {
            Ok(command) => command,
            Err(reason_code) => {
                push_action_failure_event(
                    gameplay_events,
                    action_failure_event_data(
                        evaluation.source,
                        evaluation.source,
                        evaluation.action_id,
                        reason_code,
                    ),
                );
                return false;
            }
        };
        match self.commit_prefab_spawn_with_pre_commit_gate(tilemap, command, || {
            commit_collision_spawn_prefab_reaction_cooldown(world, evaluation)
        }) {
            Ok(prefab_queued) => prefab_queued,
            Err(reason_code) => {
                push_action_failure_event(
                    gameplay_events,
                    action_failure_event_data(
                        evaluation.source,
                        evaluation.source,
                        evaluation.action_id,
                        reason_code,
                    ),
                );
                false
            }
        }
    }

    fn apply_collision_side_effect(
        world: &World,
        evaluation: CollisionSideEffectEvaluation,
        audio_events: &mut Vec<AudioEvent>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
        actor: Entity,
        source: Entity,
    ) {
        match collision_side_effect_payload(world, evaluation) {
            Some(CollisionSideEffectPayload::PlaySound {
                sound_id,
                volume,
                pitch,
            }) => {
                if let Some(events) = gameplay_events.as_mut() {
                    let position = effect_position_for(world, actor, source);
                    events.push_presentation_effect_at(
                        actor,
                        source,
                        sound_id,
                        GAMEPLAY_PRESENTATION_EFFECT_TYPE_SOUND,
                        position,
                        1.0,
                        0.0,
                    );
                }
                push_audio_event(audio_events, sound_id, volume, pitch);
            }
            Some(CollisionSideEffectPayload::SpawnParticleAt {
                preset_id,
                position,
            }) => {
                if let Some(events) = gameplay_events.as_mut() {
                    events.push_presentation_effect_at(
                        actor,
                        source,
                        preset_id,
                        GAMEPLAY_PRESENTATION_EFFECT_TYPE_PARTICLE,
                        position,
                        1.0,
                        0.0,
                    );
                }
                if let Some(particles) = hit_particles.as_mut() {
                    particles.spawn_preset_at(preset_id, position);
                }
            }
            Some(CollisionSideEffectPayload::CameraShake) => {
                if let Some(events) = gameplay_events.as_mut() {
                    let position = effect_position_for(world, actor, source);
                    events.push_presentation_effect_at(
                        actor,
                        source,
                        0,
                        GAMEPLAY_PRESENTATION_EFFECT_TYPE_CAMERA_SHAKE,
                        position,
                        1.0,
                        0.0,
                    );
                }
            }
            Some(CollisionSideEffectPayload::PresentationEffect {
                actor: effect_actor,
                effect_id,
                effect_type,
                intensity,
                radius,
            }) => {
                if let Some(events) = gameplay_events.as_mut() {
                    let position = effect_position_for(world, effect_actor, source);
                    events.push_presentation_effect_at(
                        effect_actor,
                        source,
                        effect_id,
                        effect_type,
                        position,
                        intensity,
                        radius,
                    );
                }
            }
            None => {}
        }
    }

    fn apply_collision_pickup_reaction(
        &mut self,
        world: &World,
        context: CollisionReactionPair,
        target: CollisionTarget,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> bool {
        let Some(outcome) = apply_collision_pickup_reaction_for_pair(
            world,
            context,
            target,
            &mut self.marked_for_despawn,
            &mut self.pending_despawn,
        ) else {
            return false;
        };
        self.commit_score_delta(outcome.count);
        if let Some(events) = gameplay_events.as_mut() {
            events.push_pickup_collected(
                outcome.collector,
                outcome.pickup,
                outcome.item_id,
                outcome.count,
                outcome.target_removed,
            );
        }
        true
    }
}

fn dispatch_collision_hit_presentation_payload(
    mut collision_events: Option<&mut CollisionEventSink<'_>>,
    mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
    payload: CollisionHitPresentationPayload,
) -> CollisionHitPresentationDispatchResult {
    let collision_event_pushed = if let Some(events) = collision_events.as_mut() {
        events.push_hit_payload(payload);
        true
    } else {
        false
    };
    let particles_spawned = hit_particles
        .as_mut()
        .map_or(0, |particles| particles.spawn_hit_payload(payload));
    CollisionHitPresentationDispatchResult {
        collision_event_pushed,
        particles_spawned,
    }
}

fn projectile_tile_impact(world: &World, index: usize) -> ProjectileTileImpact {
    world.projectile_tile_impact_at(index)
}

fn entity_at(world: &World, index: usize) -> Option<crate::entity::Entity> {
    if !world.alive.get(index).copied().unwrap_or(false) {
        return None;
    }
    Some(crate::entity::Entity {
        id: index as u32,
        generation: *world.generations.get(index)?,
    })
}

fn effect_position_for(world: &World, actor: Entity, source: Entity) -> Transform2D {
    transform_for_entity(world, actor)
        .or_else(|| transform_for_entity(world, source))
        .unwrap_or_default()
}

fn transform_for_entity(world: &World, entity: Entity) -> Option<Transform2D> {
    let index = entity.id as usize;
    if entity_at(world, index) != Some(entity) {
        return None;
    }
    world.transforms.get(index).copied().flatten()
}

fn tile_impact_center(
    start: Transform2D,
    velocity: Velocity,
    delta: f32,
    tile_hit: crate::tilemap::TilemapSweepHit,
) -> Transform2D {
    let travel = if delta.is_finite() && delta > 0.0 {
        delta * tile_hit.contact.time.clamp(0.0, 1.0)
    } else {
        0.0
    };
    Transform2D {
        x: start.x + velocity.vx * travel,
        y: start.y + velocity.vy * travel,
    }
}

fn bounce_projectile_off_tile(
    world: &mut World,
    bullet_index: usize,
    start: Transform2D,
    velocity: Velocity,
    delta: f32,
    tile_hit: crate::tilemap::TilemapSweepHit,
) {
    let normal = Velocity {
        vx: tile_hit.contact.normal_x,
        vy: tile_hit.contact.normal_y,
    };
    let normal_len_sq = normal.vx * normal.vx + normal.vy * normal.vy;
    if !normal_len_sq.is_finite() || normal_len_sq <= f32::EPSILON {
        return;
    }
    let dot = velocity.vx * normal.vx + velocity.vy * normal.vy;
    if !dot.is_finite() {
        return;
    }
    world.velocities[bullet_index] = Some(Velocity {
        vx: velocity.vx - 2.0 * dot * normal.vx,
        vy: velocity.vy - 2.0 * dot * normal.vy,
    });
    if let Some(transform) = world
        .transforms
        .get_mut(bullet_index)
        .and_then(Option::as_mut)
    {
        let travel = if delta.is_finite() && delta > 0.0 {
            delta * tile_hit.contact.time.clamp(0.0, 1.0)
        } else {
            0.0
        };
        transform.x = start.x + velocity.vx * travel - normal.vx * 0.001;
        transform.y = start.y + velocity.vy * travel - normal.vy * 0.001;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collision_event::{CollisionEventCounts, COLLISION_EVENT_HIT};
    use crate::components::gameplay::{
        GameplayFaction, GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };
    use crate::entity::Entity;
    use crate::game_state::GameState;
    use crate::gameplay::MeleeAttackCoreData;
    use crate::gameplay_event::{
        GAMEPLAY_EVENT_COLLISION_DAMAGE, GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED,
    };
    use crate::particles::{ParticlePreset, ParticleSystem};
    use crate::shooter_scene::{DEFAULT_TEXTURE_ID, MAX_AUTHORED_COLLISION_CONTACTS};
    use crate::tweens::TweenSystem;

    fn entity(id: u32) -> Entity {
        Entity { id, generation: 0 }
    }

    fn melee_core_data(attacker: Entity, x: f32) -> MeleeAttackCoreData {
        MeleeAttackCoreData {
            attacker,
            center: Transform2D { x, y: 24.0 },
            range: 32.0,
            damage: 1.0,
            target: MeleeTarget::Enemies,
            height_span: None,
        }
    }

    #[test]
    fn authored_collision_contact_cache_tracks_enter_without_duplicate_current_hits() {
        let mut scene = ShooterScene::default();
        let first = entity(10);
        let second = entity(20);

        assert!(scene.register_authored_collision_contact(first, second));
        assert!(!scene.register_authored_collision_contact(first, second));
        assert!(!scene.register_authored_collision_contact(second, first));

        scene.finish_authored_collision_contacts();
        assert!(!scene.register_authored_collision_contact(first, second));

        scene.finish_authored_collision_contacts();
        scene.finish_authored_collision_contacts();
        assert!(scene.register_authored_collision_contact(first, second));
    }

    #[test]
    fn authored_collision_contact_cache_is_bounded() {
        let mut scene = ShooterScene::default();

        for offset in 0..MAX_AUTHORED_COLLISION_CONTACTS as u32 {
            assert!(
                scene.register_authored_collision_contact(entity(offset), entity(offset + 10_000))
            );
        }

        assert!(!scene.register_authored_collision_contact(entity(20_000), entity(20_001)));
        assert_eq!(
            scene.authored_collision_contacts.current_len(),
            MAX_AUTHORED_COLLISION_CONTACTS,
        );
        assert!(
            scene.authored_collision_contacts.current_capacity() >= MAX_AUTHORED_COLLISION_CONTACTS
        );
    }

    #[test]
    fn pending_melee_attack_drain_preserves_order_and_reuses_scratch() {
        let mut scene = ShooterScene::default();
        let stale = scene
            .queue_melee_attack(melee_core_data(entity(1), 8.0))
            .queued;
        scene.melee_attack_commands.push(stale);
        scene.pending_melee_attacks.clear();

        let first = scene
            .queue_melee_attack(melee_core_data(entity(10), 16.0))
            .queued;
        let second = scene
            .queue_melee_attack(melee_core_data(entity(20), 32.0))
            .queued;

        let result = scene.drain_pending_melee_attacks_for_phase();

        assert_eq!(result, PendingMeleeAttackDrainResult { command_count: 2 });
        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(scene.melee_attack_commands.as_slice(), &[first, second]);
        assert!(scene.melee_attack_commands.capacity() >= 2);
    }

    #[test]
    fn handle_collisions_clears_melee_attack_scratch_after_phase() {
        let mut scene = ShooterScene::default();
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let player = world.spawn_player(16.0, 24.0, 0);

        scene.queue_melee_attack(melee_core_data(player, 16.0));
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            None,
            None,
        );

        assert!(scene.pending_melee_attacks.is_empty());
        assert!(scene.melee_attack_commands.is_empty());
    }

    #[test]
    fn pending_enemy_target_melee_resolution_reports_damage_removal_and_score() {
        let mut scene = ShooterScene::default();
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let player = world.spawn_player(16.0, 24.0, 0);
        let enemy = world.spawn_enemy(32.0, 24.0, 0);
        world.healths[enemy.id as usize] = Some(1.0);
        world.score_rewards[enemy.id as usize] = Some(7);
        scene.prepare_collision_scratch(world.alive.len());
        let command = scene
            .queue_melee_attack(melee_core_data(player, 16.0))
            .queued;
        scene.pending_melee_attacks.clear();

        let result = scene.handle_pending_enemy_target_melee(
            &mut world,
            command,
            &mut audio_events,
            None,
            None,
            None,
            None,
        );

        assert_eq!(
            result,
            PendingEnemyTargetMeleeResolutionResult {
                targets_damaged: 1,
                targets_removed: 1,
                score_delta: 7,
            }
        );
        assert_eq!(scene.score(), 7);
        assert!(scene.marked_for_despawn[enemy.id as usize]);
        assert_eq!(scene.pending_despawn.as_slice(), &[enemy]);
    }

    #[test]
    fn pending_player_target_melee_resolution_reports_game_over_audio_and_hit_event() {
        let mut scene = ShooterScene::default();
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let mut collision_events = Vec::new();
        let mut collision_counts = CollisionEventCounts::default();
        let player = world.spawn_player(16.0, 24.0, 0);
        let enemy = world.spawn_enemy(32.0, 24.0, 0);
        scene.set_sound_ids(0, 0, 9);
        scene.prepare_collision_scratch(world.alive.len());
        let mut command = scene
            .queue_melee_attack(melee_core_data(enemy, 32.0))
            .queued;
        command.target = MeleeTarget::Player;

        let result = {
            let mut collision_sink =
                CollisionEventSink::new(&mut collision_events, &mut collision_counts);
            scene.handle_pending_player_target_melee(
                &mut world,
                command,
                &mut audio_events,
                Some(&mut collision_sink),
                None,
            )
        };

        assert_eq!(
            result,
            PendingPlayerTargetMeleeResolutionResult {
                game_over_entered: true,
                collision_event_pushed: true,
                game_over_audio_pushed: true,
            }
        );
        assert_eq!(collision_counts.hit, 1);
        assert_eq!(collision_events.len(), 1);
        assert_eq!(collision_events[0].kind, COLLISION_EVENT_HIT);
        assert_eq!(collision_events[0].a_id, enemy.id);
        assert_eq!(collision_events[0].b_id, player.id);
        assert_eq!(collision_events[0].damage(), command.damage);
        assert_eq!(audio_events.len(), 1);

        let result = {
            let mut collision_sink =
                CollisionEventSink::new(&mut collision_events, &mut collision_counts);
            scene.handle_pending_player_target_melee(
                &mut world,
                command,
                &mut audio_events,
                Some(&mut collision_sink),
                None,
            )
        };

        assert_eq!(
            result,
            PendingPlayerTargetMeleeResolutionResult {
                game_over_entered: false,
                collision_event_pushed: false,
                game_over_audio_pushed: false,
            }
        );
        assert_eq!(collision_counts.hit, 1);
        assert_eq!(collision_events.len(), 1);
        assert_eq!(audio_events.len(), 1);
    }

    #[test]
    fn pending_player_target_melee_resolution_respects_faction_gate() {
        let mut scene = ShooterScene {
            game_state: GameState::Playing,
            ..Default::default()
        };
        let mut world = World::default();
        let mut audio_events = Vec::new();
        let mut collision_events = Vec::new();
        let mut collision_counts = CollisionEventCounts::default();
        let mut gameplay_events = Vec::new();
        let player = world.spawn_player(16.0, 24.0, 0);
        let enemy = world.spawn_enemy(32.0, 24.0, 0);
        world.set_gameplay_faction(
            enemy,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
        );
        world.set_gameplay_faction(
            player,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
        );
        scene.prepare_collision_scratch(world.alive.len());
        let mut command = scene
            .queue_melee_attack(melee_core_data(enemy, 32.0))
            .queued;
        command.target = MeleeTarget::Player;

        let result = {
            let mut collision_sink =
                CollisionEventSink::new(&mut collision_events, &mut collision_counts);
            let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
            scene.handle_pending_player_target_melee(
                &mut world,
                command,
                &mut audio_events,
                Some(&mut collision_sink),
                Some(&mut gameplay_sink),
            )
        };

        assert_eq!(result, PendingPlayerTargetMeleeResolutionResult::default());
        assert_eq!(scene.score(), 0);
        assert_eq!(scene.game_state(), GameState::Playing);
        assert_eq!(collision_counts.hit, 0);
        assert!(collision_events.is_empty());
        assert!(audio_events.is_empty());
        assert_eq!(gameplay_events.len(), 1);
        assert_eq!(
            gameplay_events[0].kind,
            GAMEPLAY_EVENT_FACTION_DAMAGE_DENIED
        );
        assert_eq!(gameplay_events[0].actor_id, player.id);
        assert_eq!(gameplay_events[0].source_id, enemy.id);
        assert_eq!(gameplay_events[0].token_id, GAMEPLAY_FACTION_ENEMY);
        assert_eq!(gameplay_events[0].payload_bits, GAMEPLAY_FACTION_PLAYER);
    }

    #[test]
    fn dispatch_melee_enemy_hit_side_effects_reports_policy_outcomes() {
        let mut scene = ShooterScene::default();
        let mut world = World::default();
        let player = world.spawn_player(16.0, 24.0, DEFAULT_TEXTURE_ID);
        let enemy = world.spawn_enemy(32.0, 24.0, DEFAULT_TEXTURE_ID);
        let mut audio_events = Vec::new();
        let mut collision_events = Vec::new();
        let mut collision_counts = CollisionEventCounts::default();
        let mut gameplay_events = Vec::new();
        let mut particles = ParticleSystem::with_capacity(8);
        let mut hit_preset = ParticlePreset::new(7);
        hit_preset.burst_count = 3;
        let mut tweens = TweenSystem::new();
        let damage_outcome = DefaultCollisionDamageHitOutcome {
            source_index: player.id as usize,
            source: player,
            source_removed: false,
            target_index: enemy.id as usize,
            target: enemy,
            damage: 2.0,
            killed: true,
            target_removed: false,
            score_reward: 7,
        };

        let result = {
            let mut collision_sink =
                CollisionEventSink::new(&mut collision_events, &mut collision_counts);
            let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
            let mut particle_sink =
                ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &[]);
            let mut tween_sink = TweenSink::new(&mut tweens);
            scene.dispatch_melee_enemy_hit_side_effects(
                &mut world,
                &mut audio_events,
                Some(&mut collision_sink),
                Some(&mut gameplay_sink),
                Some(&mut particle_sink),
                Some(&mut tween_sink),
                damage_outcome,
                9,
                0.5,
                1.25,
            )
        };

        assert_eq!(
            result,
            MeleeHitSideEffectDispatchResult {
                collision_event_pushed: true,
                gameplay_event_pushed: true,
                particles_spawned: 3,
                hit_tween_started: false,
                hit_audio_event_pushed: true,
                score_delta: 7,
            }
        );
        assert_eq!(scene.score(), 7);
        assert_eq!(collision_counts.hit, 1);
        assert_eq!(collision_events.len(), 1);
        assert_eq!(collision_events[0].a_id, player.id);
        assert_eq!(collision_events[0].b_id, enemy.id);
        assert_eq!(gameplay_events.len(), 1);
        assert_eq!(gameplay_events[0].kind, GAMEPLAY_EVENT_COLLISION_DAMAGE);
        assert_eq!(particles.particle_count(), 3);
        assert_eq!(tweens.tween_count(), 0);
        assert_eq!(audio_events.len(), 1);
        assert_eq!(audio_events[0].sound_id, 9.0);
        assert_eq!(audio_events[0].volume, 0.5);
        assert_eq!(audio_events[0].pitch, 1.25);
    }

    #[test]
    fn dispatch_melee_enemy_hit_side_effects_reports_non_lethal_tween_without_score() {
        let mut scene = ShooterScene::default();
        let mut world = World::default();
        let player = world.spawn_player(16.0, 24.0, DEFAULT_TEXTURE_ID);
        let enemy = world.spawn_enemy(32.0, 24.0, DEFAULT_TEXTURE_ID);
        let mut audio_events = Vec::new();
        let mut collision_events = Vec::new();
        let mut collision_counts = CollisionEventCounts::default();
        let mut gameplay_events = Vec::new();
        let mut particles = ParticleSystem::with_capacity(8);
        let mut hit_preset = ParticlePreset::new(7);
        hit_preset.burst_count = 2;
        let mut tweens = TweenSystem::new();
        let damage_outcome = DefaultCollisionDamageHitOutcome {
            source_index: player.id as usize,
            source: player,
            source_removed: false,
            target_index: enemy.id as usize,
            target: enemy,
            damage: 0.5,
            killed: false,
            target_removed: false,
            score_reward: 7,
        };

        let result = {
            let mut collision_sink =
                CollisionEventSink::new(&mut collision_events, &mut collision_counts);
            let mut gameplay_sink = GameplayEventSink::new(&mut gameplay_events);
            let mut particle_sink =
                ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &[]);
            let mut tween_sink = TweenSink::new(&mut tweens);
            scene.dispatch_melee_enemy_hit_side_effects(
                &mut world,
                &mut audio_events,
                Some(&mut collision_sink),
                Some(&mut gameplay_sink),
                Some(&mut particle_sink),
                Some(&mut tween_sink),
                damage_outcome,
                9,
                0.5,
                1.25,
            )
        };

        assert_eq!(
            result,
            MeleeHitSideEffectDispatchResult {
                collision_event_pushed: true,
                gameplay_event_pushed: true,
                particles_spawned: 2,
                hit_tween_started: true,
                hit_audio_event_pushed: true,
                score_delta: 0,
            }
        );
        assert_eq!(scene.score(), 0);
        assert_eq!(collision_counts.hit, 1);
        assert_eq!(gameplay_events.len(), 1);
        assert_eq!(particles.particle_count(), 2);
        assert_eq!(tweens.tween_count(), 1);
        assert_eq!(audio_events.len(), 1);
    }

    #[test]
    fn dispatch_collision_hit_presentation_payload_pushes_event_and_particles() {
        let source = entity(10);
        let target = entity(20);
        let mut collision_events = Vec::new();
        let mut collision_event_counts = CollisionEventCounts::default();
        let mut particles = ParticleSystem::with_capacity(8);
        let mut hit_preset = ParticlePreset::new(7);
        hit_preset.burst_count = 3;
        let payload = CollisionHitPresentationPayload {
            source,
            target,
            damage: 2.5,
            emit_audio: false,
            particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
        };

        let result = {
            let mut collision_sink =
                CollisionEventSink::new(&mut collision_events, &mut collision_event_counts);
            let mut particle_sink =
                ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &[]);
            dispatch_collision_hit_presentation_payload(
                Some(&mut collision_sink),
                Some(&mut particle_sink),
                payload,
            )
        };

        assert_eq!(
            result,
            CollisionHitPresentationDispatchResult {
                collision_event_pushed: true,
                particles_spawned: 3,
            }
        );
        assert_eq!(collision_event_counts.hit, 1);
        assert_eq!(collision_events.len(), 1);
        assert_eq!(collision_events[0].kind, COLLISION_EVENT_HIT);
        assert_eq!(collision_events[0].a_id, source.id);
        assert_eq!(collision_events[0].b_id, target.id);
        assert_eq!(collision_events[0].damage(), 2.5);
        assert_eq!(particles.particle_count(), 3);
    }

    #[test]
    fn dispatch_collision_hit_presentation_payload_reports_missing_sinks() {
        let result = dispatch_collision_hit_presentation_payload(
            None,
            None,
            CollisionHitPresentationPayload {
                source: entity(10),
                target: entity(20),
                damage: 2.5,
                emit_audio: false,
                particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
            },
        );

        assert_eq!(
            result,
            CollisionHitPresentationDispatchResult {
                collision_event_pushed: false,
                particles_spawned: 0,
            }
        );
    }

    #[test]
    fn dispatch_collision_hit_presentation_payload_supports_event_only_sink() {
        let source = entity(10);
        let target = entity(20);
        let mut collision_events = Vec::new();
        let mut collision_event_counts = CollisionEventCounts::default();

        let result = {
            let mut collision_sink =
                CollisionEventSink::new(&mut collision_events, &mut collision_event_counts);
            dispatch_collision_hit_presentation_payload(
                Some(&mut collision_sink),
                None,
                CollisionHitPresentationPayload {
                    source,
                    target,
                    damage: 2.5,
                    emit_audio: false,
                    particle_position: Some(Transform2D { x: 4.0, y: 5.0 }),
                },
            )
        };

        assert_eq!(
            result,
            CollisionHitPresentationDispatchResult {
                collision_event_pushed: true,
                particles_spawned: 0,
            }
        );
        assert_eq!(collision_event_counts.hit, 1);
        assert_eq!(collision_events.len(), 1);
        assert_eq!(collision_events[0].kind, COLLISION_EVENT_HIT);
    }

    #[test]
    fn dispatch_collision_hit_presentation_payload_reports_particle_position_skip() {
        let mut particles = ParticleSystem::with_capacity(8);
        let mut hit_preset = ParticlePreset::new(7);
        hit_preset.burst_count = 3;

        let result = {
            let mut particle_sink =
                ParticleBurstSink::with_presets(&mut particles, Some(hit_preset), &[]);
            dispatch_collision_hit_presentation_payload(
                None,
                Some(&mut particle_sink),
                CollisionHitPresentationPayload {
                    source: entity(10),
                    target: entity(20),
                    damage: 2.5,
                    emit_audio: false,
                    particle_position: None,
                },
            )
        };

        assert_eq!(
            result,
            CollisionHitPresentationDispatchResult {
                collision_event_pushed: false,
                particles_spawned: 0,
            }
        );
        assert_eq!(particles.particle_count(), 0);
    }
}
