use crate::audio_event::AudioEvent;
use crate::camera::Camera2D;
use crate::components::{Transform2D, Velocity};
use crate::entity::Entity;
use crate::input::InputState;
use crate::physics::{PhysicsBounds, PhysicsSystem};
use crate::world::World;

use super::super::ShooterScene;
use super::push_audio_event;

impl ShooterScene {
    pub(in crate::shooter_scene) fn normalized_input_direction(input: InputState) -> Velocity {
        let mut x: f32 = 0.0;
        let mut y: f32 = 0.0;
        if input.w == 1 {
            y -= 1.0;
        }
        if input.s == 1 {
            y += 1.0;
        }
        if input.a == 1 {
            x -= 1.0;
        }
        if input.d == 1 {
            x += 1.0;
        }
        let len = (x * x + y * y).sqrt();
        if len > 0.0 {
            Velocity {
                vx: x / len,
                vy: y / len,
            }
        } else {
            Velocity::default()
        }
    }

    pub(in crate::shooter_scene) fn apply_player_input(
        &mut self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        let Some(player) = world.player else {
            return;
        };
        let dir = Self::normalized_input_direction(input);
        world.velocities[player.id as usize] = Some(Velocity {
            vx: dir.vx * self.config.player_speed,
            vy: dir.vy * self.config.player_speed,
        });
        let wants_fire = input.space == 1 || input.mouse_left == 1;
        if wants_fire && self.fire_cooldown_seconds <= 0.0 {
            self.fire_bullet_toward_mouse(world, camera, input, player, audio_events);
            self.fire_cooldown_seconds = self.config.fire_cooldown;
        }
    }

    pub(in crate::shooter_scene) fn fire_bullet_toward_mouse(
        &self,
        world: &mut World,
        camera: &Camera2D,
        input: InputState,
        player: Entity,
        audio_events: &mut Vec<AudioEvent>,
    ) {
        let Some(player_t) = world.transforms[player.id as usize] else {
            return;
        };
        let target = camera.screen_to_world(Transform2D {
            x: input.mouse_x,
            y: input.mouse_y,
        });
        let dx = target.x - player_t.x;
        let dy = target.y - player_t.y;
        let len = (dx * dx + dy * dy).sqrt();
        let (nx, ny) = if len > 0.0001 {
            (dx / len, dy / len)
        } else {
            (1.0, 0.0)
        };
        let spawn_offset = self
            .config
            .player_template
            .sprite_width
            .max(self.config.player_template.sprite_height)
            * 0.5
            + self
                .config
                .bullet_template
                .sprite_width
                .max(self.config.bullet_template.sprite_height)
                * 0.5;
        world.spawn_bullet_from_template(
            Transform2D {
                x: player_t.x + nx * spawn_offset,
                y: player_t.y + ny * spawn_offset,
            },
            Velocity {
                vx: nx * self.config.bullet_speed,
                vy: ny * self.config.bullet_speed,
            },
            self.texture_ids.bullet,
            self.config.bullet_lifetime,
            self.config.bullet_template,
            self.config.bullet_damage,
        );
        push_audio_event(
            audio_events,
            self.sound_ids.shoot,
            self.config.audio_policy.shoot_volume,
            self.config.audio_policy.shoot_pitch,
        );
    }

    pub(in crate::shooter_scene) fn clamp_player_to_world(&self, world: &mut World) {
        let Some(player) = world.player else {
            return;
        };
        PhysicsSystem::clamp_entity_to_bounds(
            world,
            player,
            PhysicsBounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: self.config.world_width,
                max_y: self.config.world_height,
            },
        );
    }
}
