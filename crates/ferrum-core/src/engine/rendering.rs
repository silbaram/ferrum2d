use crate::collision::AabbBounds;
use crate::components::{HeightSpan, Sprite, Transform2D};
use crate::render_command::{
    SpriteRenderCommand, SpriteRenderItem, SpriteRenderSortKey, SPRITE_EFFECT_NONE,
};

use super::Engine;

impl Engine {
    pub(super) fn build_render_commands(&mut self) {
        self.render_commands.clear();
        self.render_items.clear();
        let visible_bounds = self.camera.visible_bounds();

        if self.uses_hd2d_render_sort() {
            self.build_hd2d_render_commands(visible_bounds);
        } else {
            self.build_layered_render_commands(visible_bounds);
        }
    }

    fn build_layered_render_commands(&mut self, visible_bounds: AabbBounds) {
        self.tilemap
            .append_render_commands(&self.camera, &mut self.render_commands);
        self.append_entity_render_commands(visible_bounds);
        self.particles
            .append_render_commands(&self.camera, &mut self.render_commands);
    }

    fn build_hd2d_render_commands(&mut self, visible_bounds: AabbBounds) {
        self.tilemap
            .append_render_items(&self.camera, &mut self.render_items);
        self.append_entity_render_items(visible_bounds);
        self.particles
            .append_render_items(&self.camera, &mut self.render_items);
        self.render_items
            .sort_unstable_by(|left, right| left.sort_key.cmp_draw_order(right.sort_key));
        self.render_commands
            .extend(self.render_items.iter().map(|item| item.command));
    }

    fn append_entity_render_commands(&mut self, visible_bounds: AabbBounds) {
        for &i in self.world.alive_indices() {
            if let (Some(t), Some(s)) = (self.world.transforms[i], self.world.sprites[i]) {
                if !sprite_intersects_viewport(t, s, visible_bounds) {
                    continue;
                }
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
    }

    fn append_entity_render_items(&mut self, visible_bounds: AabbBounds) {
        for &i in self.world.alive_indices() {
            if let (Some(t), Some(s)) = (self.world.transforms[i], self.world.sprites[i]) {
                if !sprite_intersects_viewport(t, s, visible_bounds) {
                    continue;
                }
                let screen = self.camera.world_to_screen(t);
                self.render_items.push(SpriteRenderItem {
                    command: SpriteRenderCommand {
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
                    },
                    sort_key: entity_render_sort_key(
                        self.world.height_spans[i],
                        t.y + s.height * 0.5,
                        i,
                    ),
                });
            }
        }
    }

    fn uses_hd2d_render_sort(&self) -> bool {
        self.tilemap.has_hd2d_render_metadata()
            || self
                .world
                .alive_indices()
                .iter()
                .any(|&index| self.world.height_spans[index].is_some())
    }
}

fn entity_render_sort_key(
    height_span: Option<HeightSpan>,
    foot_y: f32,
    entity_index: usize,
) -> SpriteRenderSortKey {
    SpriteRenderSortKey {
        floor_id: height_span.map_or(0, |span| span.floor.0),
        elevation: height_span.map_or(0.0, |span| span.elevation),
        foot_y,
        render_layer: 1_000,
        stable_id: entity_index as u32,
    }
}

fn sprite_intersects_viewport(
    transform: Transform2D,
    sprite: Sprite,
    visible_bounds: AabbBounds,
) -> bool {
    AabbBounds::from_center(transform, sprite.width * 0.5, sprite.height * 0.5)
        .is_some_and(|bounds| bounds.overlaps(visible_bounds))
}
