use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::collision_event::{CollisionEvent, CollisionEventCounts};
use crate::game_state::GameState;
use crate::input::InputState;
use crate::physics::PhysicsCounters;
use crate::tilemap::Tilemap;
use crate::world::World;

use super::ShooterScene;

mod bullets;
mod combat;
mod despawn;
mod effects;
mod enemies;
mod player;
mod waves;

use effects::ShooterRuntimeSinks;
pub(in crate::shooter_scene) use effects::{push_audio_event, CollisionEventSink};
pub(crate) use effects::{ParticleBurstSink, TweenSink};
pub(super) use enemies::NavigationTargetCache;

impl ShooterScene {
    #[cfg(test)]
    pub fn update(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
    ) {
        self.update_internal(
            world,
            camera,
            input,
            audio_events,
            tilemap,
            delta,
            ShooterRuntimeSinks::default(),
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn update_with_counters(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
        physics_counters: &mut PhysicsCounters,
        collision_events: &mut Vec<CollisionEvent>,
        collision_event_counts: &mut CollisionEventCounts,
        hit_particles: Option<ParticleBurstSink<'_>>,
        hit_tweens: Option<TweenSink<'_>>,
    ) {
        self.update_internal(
            world,
            camera,
            input,
            audio_events,
            tilemap,
            delta,
            ShooterRuntimeSinks::with_effects(
                physics_counters,
                collision_events,
                collision_event_counts,
                hit_particles,
                hit_tweens,
            ),
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn update_internal(
        &mut self,
        world: &mut World,
        camera: &mut Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
        tilemap: &Tilemap,
        delta: f32,
        mut sinks: ShooterRuntimeSinks<'_>,
    ) {
        let space_pressed = input.space == 1 && self.previous_space == 0;
        let enter_pressed = input.enter == 1 && self.previous_enter == 0;

        match self.game_state {
            GameState::Title => {
                if space_pressed || enter_pressed {
                    self.game_state = GameState::Playing;
                }
            }
            GameState::GameOver => {
                if space_pressed {
                    self.reset_playing(world, camera, audio_events);
                    self.game_state = GameState::Playing;
                }
            }
            GameState::Playing => {
                self.tick_playing_timers(delta);
                self.advance_wave_if_needed();
                self.camera_elapsed_seconds += delta.max(0.0);
                self.apply_player_input(world, camera, input, audio_events);
                self.update_enemy_velocity(world, tilemap, delta);
                world.update(delta);
                if let Some(counters) = sinks.physics_counters.as_deref_mut() {
                    tilemap.resolve_dynamic_collisions_with_counters(world, counters);
                } else {
                    tilemap.resolve_dynamic_collisions(world);
                }
                self.clamp_player_to_world(world);
                self.update_camera_follow(world, camera);
                self.update_bullets(world, delta);
                self.spawn_enemy_if_needed(world);
                self.handle_collisions(
                    world,
                    tilemap,
                    audio_events,
                    delta,
                    sinks.collision_events.as_mut(),
                    sinks.hit_particles.as_mut(),
                    sinks.hit_tweens.as_mut(),
                );
            }
        }

        self.previous_space = input.space;
        self.previous_enter = input.enter;
    }
}
