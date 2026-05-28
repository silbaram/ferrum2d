use crate::render_command::{SpriteRenderCommand, SPRITE_EFFECT_NONE};

use super::Engine;

impl Engine {
    pub(super) fn build_render_commands(&mut self) {
        self.render_commands.clear();
        self.tilemap
            .append_render_commands(&self.camera, &mut self.render_commands);
        for i in 0..self.world.transforms.len() {
            if !self.world.alive[i] {
                continue;
            }
            if let (Some(t), Some(s)) = (self.world.transforms[i], self.world.sprites[i]) {
                let screen = self.camera.world_to_screen(t);
                self.render_commands.push(SpriteRenderCommand {
                    x: screen.x - s.width * 0.5,
                    y: screen.y - s.height * 0.5,
                    width: s.width,
                    height: s.height,
                    u0: s.u0,
                    v0: s.v0,
                    u1: s.u1,
                    v1: s.v1,
                    r: s.r,
                    g: s.g,
                    b: s.b,
                    a: s.a,
                    texture_id: s.texture_id as f32,
                    effect_flags: SPRITE_EFFECT_NONE,
                });
            }
        }
        self.particles
            .append_render_commands(&self.camera, &mut self.render_commands);
    }
}
