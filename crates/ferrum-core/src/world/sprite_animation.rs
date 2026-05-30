use super::World;

impl World {
    pub(super) fn update_sprite_animations(&mut self, delta: f32) {
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
            animation.advance(delta, is_moving);
            let (u0, v0, u1, v1) = animation.uv();
            sprite.u0 = u0;
            sprite.v0 = v0;
            sprite.u1 = u1;
            sprite.v1 = v1;
        }
    }
}
