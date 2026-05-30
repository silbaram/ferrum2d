use crate::audio_event::AudioEvent;
use crate::collision::CollisionSystem;
use crate::components::CollisionLayer;
use crate::entity::Entity;
use crate::game_state::GameState;
use crate::tilemap::Tilemap;
use crate::world::World;

use super::super::{
    ShooterScene, DEFAULT_BULLET_DAMAGE, DEFAULT_ENEMY_HEALTH, DEFAULT_SCORE_REWARD,
};
use super::{push_audio_event, CollisionEventSink, ParticleBurstSink, TweenSink};

impl ShooterScene {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::shooter_scene) fn handle_collisions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        audio_events: &mut Vec<AudioEvent>,
        delta: f32,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        hit_particles: Option<&mut ParticleBurstSink<'_>>,
        hit_tweens: Option<&mut TweenSink<'_>>,
    ) {
        self.prepare_collision_scratch(world.alive.len());
        self.handle_bullet_enemy_collisions(
            world,
            tilemap,
            audio_events,
            delta,
            collision_events.as_deref_mut(),
            hit_particles,
            hit_tweens,
        );
        self.handle_player_enemy_collisions(world, audio_events, collision_events);

        self.despawn_pending(world);
    }

    fn prepare_collision_scratch(&mut self, alive_len: usize) {
        self.clear_pending_despawns();
        self.marked_for_despawn.clear();
        self.marked_for_despawn.resize(alive_len, false);
        self.collision_pairs.clear();
    }

    #[allow(clippy::too_many_arguments)]
    fn handle_bullet_enemy_collisions(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        audio_events: &mut Vec<AudioEvent>,
        delta: f32,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
        mut hit_particles: Option<&mut ParticleBurstSink<'_>>,
        mut hit_tweens: Option<&mut TweenSink<'_>>,
    ) {
        self.handle_bullet_tile_collisions(world, tilemap, delta);
        CollisionSystem::build_swept_layer_pairs_into(
            &mut self.collision_scratch,
            world,
            CollisionLayer::Bullet,
            CollisionLayer::Enemy,
            delta,
            &mut self.collision_pairs,
        );
        let hit_sound_id = self.sound_ids.hit;
        let hit_volume = self.config.audio_policy.hit_volume;
        let hit_pitch = self.config.audio_policy.hit_pitch;
        for pair_index in 0..self.collision_pairs.len() {
            let pair = self.collision_pairs[pair_index];
            let bullet_index = pair.a.id as usize;
            let enemy_index = pair.b.id as usize;
            if !Self::is_alive_layer(world, bullet_index, CollisionLayer::Bullet)
                || self.marked_for_despawn[bullet_index]
            {
                continue;
            }
            if !Self::is_alive_layer(world, enemy_index, CollisionLayer::Enemy)
                || self.marked_for_despawn[enemy_index]
            {
                continue;
            }

            let damage = world.damages[bullet_index].unwrap_or(DEFAULT_BULLET_DAMAGE);
            let hit_position = world.transforms[enemy_index].or(world.transforms[bullet_index]);
            if let Some(events) = collision_events.as_mut() {
                events.push_hit(pair.a, pair.b, damage);
            }
            if let Some(position) = hit_position {
                if let Some(particles) = hit_particles.as_deref_mut() {
                    particles.spawn_at(position);
                }
            }
            self.marked_for_despawn[bullet_index] = true;
            self.pending_despawn.push(Entity {
                id: bullet_index as u32,
                generation: world.generations[bullet_index],
            });
            let health = world.healths[enemy_index].get_or_insert(DEFAULT_ENEMY_HEALTH);
            *health -= damage;
            if *health <= 0.0 {
                self.marked_for_despawn[enemy_index] = true;
                self.pending_despawn.push(Entity {
                    id: enemy_index as u32,
                    generation: world.generations[enemy_index],
                });
                let reward = world.score_rewards[enemy_index].unwrap_or(DEFAULT_SCORE_REWARD);
                self.score = self.score.saturating_add(reward);
            } else if let Some(tweens) = hit_tweens.as_deref_mut() {
                tweens.flash_enemy_hit(
                    world,
                    Entity {
                        id: enemy_index as u32,
                        generation: world.generations[enemy_index],
                    },
                );
            }
            push_audio_event(audio_events, hit_sound_id, hit_volume, hit_pitch);
        }
    }

    fn handle_bullet_tile_collisions(&mut self, world: &World, tilemap: &Tilemap, delta: f32) {
        for &bullet_index in world.alive_indices() {
            if !Self::is_alive_layer(world, bullet_index, CollisionLayer::Bullet)
                || self.marked_for_despawn[bullet_index]
            {
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
            if tilemap.projectile_aabb_hits_blocking_tile(
                start,
                velocity,
                collider,
                delta,
                world.height_spans[bullet_index],
            ) {
                self.marked_for_despawn[bullet_index] = true;
                self.pending_despawn.push(Entity {
                    id: bullet_index as u32,
                    generation: world.generations[bullet_index],
                });
            }
        }
    }

    fn handle_player_enemy_collisions(
        &mut self,
        world: &World,
        audio_events: &mut Vec<AudioEvent>,
        mut collision_events: Option<&mut CollisionEventSink<'_>>,
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
        CollisionSystem::build_layer_pairs_into(
            &mut self.collision_scratch,
            world,
            CollisionLayer::Player,
            CollisionLayer::Enemy,
            &mut self.collision_pairs,
        );
        let game_over_sound_id = self.sound_ids.game_over;
        let game_over_volume = self.config.audio_policy.game_over_volume;
        let game_over_pitch = self.config.audio_policy.game_over_pitch;
        for pair_index in 0..self.collision_pairs.len() {
            let pair = self.collision_pairs[pair_index];
            let enemy_index = pair.b.id as usize;
            if pair.a != player
                || !Self::is_alive_layer(world, enemy_index, CollisionLayer::Enemy)
                || self.marked_for_despawn[enemy_index]
            {
                continue;
            }
            if self.game_state != GameState::GameOver {
                self.game_state = GameState::GameOver;
                if let Some(events) = collision_events.as_mut() {
                    events.push_hit(pair.a, pair.b, 0.0);
                }
                push_audio_event(
                    audio_events,
                    game_over_sound_id,
                    game_over_volume,
                    game_over_pitch,
                );
            }
            break;
        }
    }

    fn is_alive_layer(world: &World, index: usize, layer: CollisionLayer) -> bool {
        world.alive.get(index).copied().unwrap_or(false)
            && world.collider_layer_at(index) == Some(layer)
    }
}
