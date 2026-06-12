use super::World;
use crate::components::{SpriteAnimationFrameEvent, MAX_SPRITE_ANIMATION_FRAME_EVENTS};
use crate::entity::Entity;
use crate::gameplay_event::GameplayEvent;

impl World {
    pub(super) fn update_sprite_animations(&mut self, delta: f32) {
        self.sprite_animation_events.clear();
        let alive_count = self.alive_indices().len();
        for alive_position in 0..alive_count {
            let i = self.alive_indices()[alive_position];
            let Some(animation) = self.sprite_animations[i].as_mut() else {
                continue;
            };
            let Some(sprite) = self.sprites[i].as_mut() else {
                continue;
            };

            let is_moving = self.velocities[i].is_some_and(|velocity| {
                velocity.vx * velocity.vx + velocity.vy * velocity.vy > 0.01
            });
            let mut frame_events =
                [SpriteAnimationFrameEvent::default(); MAX_SPRITE_ANIMATION_FRAME_EVENTS];
            let event_count = animation.advance_collect_events(delta, is_moving, &mut frame_events);
            let (u0, v0, u1, v1) = animation.uv();
            sprite.u0 = u0;
            sprite.v0 = v0;
            sprite.u1 = u1;
            sprite.v1 = v1;
            let entity = Entity {
                id: i as u32,
                generation: self.generations[i],
            };
            self.sprite_animation_events.extend(
                frame_events.iter().copied().take(event_count).map(|event| {
                    GameplayEvent::animation_frame(
                        entity,
                        event.token_id,
                        event.event_kind,
                        event.clip_id,
                        event.frame,
                    )
                }),
            );
        }
    }

    pub(crate) fn drain_sprite_animation_events(&mut self, output: &mut Vec<GameplayEvent>) {
        output.append(&mut self.sprite_animation_events);
    }
}
