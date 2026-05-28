use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::components::{CollisionLayer, Transform2D, Velocity};
use crate::game_state::GameState;
use crate::world::World;

use super::{finite_or_default, non_negative_or_default, positive_or_default, ShooterScene};
use super::{
    SHOOTER_SNAPSHOT_ENTITY_BULLET, SHOOTER_SNAPSHOT_ENTITY_ENEMY, SHOOTER_SNAPSHOT_ENTITY_FLOATS,
    SHOOTER_SNAPSHOT_ENTITY_PLAYER, SHOOTER_SNAPSHOT_ENTITY_U32S, SHOOTER_SNAPSHOT_HEADER_FLOATS,
    SHOOTER_SNAPSHOT_HEADER_U32S, SHOOTER_SNAPSHOT_VERSION,
};

#[derive(Clone, Debug, PartialEq)]
pub struct ShooterSceneSnapshot {
    pub header_floats: [f32; SHOOTER_SNAPSHOT_HEADER_FLOATS],
    pub header_u32s: [u32; SHOOTER_SNAPSHOT_HEADER_U32S],
    pub entities: Vec<ShooterEntitySnapshot>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShooterEntitySnapshot {
    pub floats: [f32; SHOOTER_SNAPSHOT_ENTITY_FLOATS],
    pub u32s: [u32; SHOOTER_SNAPSHOT_ENTITY_U32S],
}

fn game_state_code(game_state: GameState) -> u32 {
    match game_state {
        GameState::Title => 0,
        GameState::Playing => 1,
        GameState::GameOver => 2,
    }
}

fn game_state_from_code(code: u32) -> Option<GameState> {
    match code {
        0 => Some(GameState::Title),
        1 => Some(GameState::Playing),
        2 => Some(GameState::GameOver),
        _ => None,
    }
}

fn shooter_snapshot_entity_kind(layer: Option<CollisionLayer>) -> Option<u32> {
    match layer? {
        CollisionLayer::Player => Some(SHOOTER_SNAPSHOT_ENTITY_PLAYER),
        CollisionLayer::Enemy => Some(SHOOTER_SNAPSHOT_ENTITY_ENEMY),
        CollisionLayer::Bullet => Some(SHOOTER_SNAPSHOT_ENTITY_BULLET),
        CollisionLayer::Wall => None,
    }
}

fn valid_shooter_snapshot_entity(entity: ShooterEntitySnapshot) -> bool {
    matches!(
        entity.u32s[0],
        SHOOTER_SNAPSHOT_ENTITY_PLAYER
            | SHOOTER_SNAPSHOT_ENTITY_ENEMY
            | SHOOTER_SNAPSHOT_ENTITY_BULLET
    ) && entity.floats.iter().all(|value| value.is_finite())
}

impl ShooterScene {
    pub fn snapshot(&self, world: &World, camera: &Camera2D) -> ShooterSceneSnapshot {
        let mut entities = Vec::new();
        for index in 0..world.transforms.len() {
            let Some(kind) = shooter_snapshot_entity_kind(world.collider_layer_at(index)) else {
                continue;
            };
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            let velocity = world.velocities[index].unwrap_or_default();
            entities.push(ShooterEntitySnapshot {
                floats: [
                    transform.x,
                    transform.y,
                    velocity.vx,
                    velocity.vy,
                    world.healths[index].unwrap_or(0.0),
                    world.damages[index].unwrap_or(0.0),
                    world.bullet_lifetimes[index].unwrap_or(0.0),
                ],
                u32s: [kind, world.score_rewards[index].unwrap_or(0)],
            });
        }

        ShooterSceneSnapshot {
            header_floats: [
                self.fire_cooldown_seconds,
                self.enemy_spawn_timer,
                self.wave_elapsed_seconds,
                self.camera_elapsed_seconds,
                camera.x,
                camera.y,
            ],
            header_u32s: [
                SHOOTER_SNAPSHOT_VERSION,
                game_state_code(self.game_state),
                self.score,
                self.spawn_index,
                self.active_wave_index as u32,
                self.wave_spawned_count,
                self.previous_space as u32,
                self.previous_enter as u32,
            ],
            entities,
        }
    }

    pub fn restore_snapshot(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        audio_events: &mut Vec<AudioEvent>,
        snapshot: &ShooterSceneSnapshot,
    ) -> bool {
        if snapshot.header_u32s[0] != SHOOTER_SNAPSHOT_VERSION {
            return false;
        }
        let Some(game_state) = game_state_from_code(snapshot.header_u32s[1]) else {
            return false;
        };
        if !snapshot.entities.iter().any(|entity| {
            entity.u32s[0] == SHOOTER_SNAPSHOT_ENTITY_PLAYER
                && entity.floats.iter().all(|value| value.is_finite())
        }) {
            return false;
        }
        if snapshot
            .entities
            .iter()
            .any(|entity| !valid_shooter_snapshot_entity(*entity))
        {
            return false;
        }

        self.score = snapshot.header_u32s[2];
        self.fire_cooldown_seconds = non_negative_or_default(snapshot.header_floats[0], 0.0);
        self.enemy_spawn_timer =
            non_negative_or_default(snapshot.header_floats[1], self.active_spawn_interval());
        self.previous_space = (snapshot.header_u32s[6] != 0) as u8;
        self.previous_enter = (snapshot.header_u32s[7] != 0) as u8;
        self.game_state = game_state;
        self.spawn_index = snapshot.header_u32s[3];
        self.active_wave_index = if self.waves.is_empty() {
            0
        } else {
            (snapshot.header_u32s[4] as usize).min(self.waves.len() - 1)
        };
        self.wave_elapsed_seconds = non_negative_or_default(snapshot.header_floats[2], 0.0);
        self.wave_spawned_count = snapshot.header_u32s[5];
        self.camera_elapsed_seconds = non_negative_or_default(snapshot.header_floats[3], 0.0);
        self.navigation_targets.clear();
        self.collision_pairs.clear();
        self.pending_despawn.clear();
        self.marked_for_despawn.clear();
        audio_events.clear();

        *world = World::default();
        for entity in snapshot.entities.iter().copied() {
            self.restore_snapshot_entity(world, entity);
        }
        camera.x = finite_or_default(snapshot.header_floats[4], camera.x);
        camera.y = finite_or_default(snapshot.header_floats[5], camera.y);
        true
    }

    fn restore_snapshot_entity(&self, world: &mut World, snapshot: ShooterEntitySnapshot) {
        let transform = Transform2D {
            x: snapshot.floats[0],
            y: snapshot.floats[1],
        };
        let velocity = Velocity {
            vx: snapshot.floats[2],
            vy: snapshot.floats[3],
        };
        match snapshot.u32s[0] {
            SHOOTER_SNAPSHOT_ENTITY_PLAYER => {
                let entity = world.spawn_player_from_template(
                    transform.x,
                    transform.y,
                    self.texture_ids.player,
                    self.config.player_template,
                );
                world.velocities[entity.id as usize] = Some(velocity);
            }
            SHOOTER_SNAPSHOT_ENTITY_ENEMY => {
                let entity = world.spawn_enemy_from_template(
                    transform.x,
                    transform.y,
                    self.texture_ids.enemy,
                    self.config.enemy_template,
                    positive_or_default(snapshot.floats[4], self.config.enemy_health),
                    snapshot.u32s[1],
                );
                world.velocities[entity.id as usize] = Some(velocity);
            }
            SHOOTER_SNAPSHOT_ENTITY_BULLET => {
                world.spawn_bullet_from_template(
                    transform,
                    velocity,
                    self.texture_ids.bullet,
                    positive_or_default(snapshot.floats[6], self.config.bullet_lifetime),
                    self.config.bullet_template,
                    positive_or_default(snapshot.floats[5], self.config.bullet_damage),
                );
            }
            _ => {}
        }
    }
}
