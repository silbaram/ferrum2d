use crate::collision::AabbBounds;
use crate::components::{HeightSpan, Sprite, Transform2D};
use crate::render_command::{
    SpriteRenderCommand, SpriteRenderItem, SpriteRenderSortKey, SPRITE_EFFECT_NONE,
};

use super::Engine;

impl Engine {
    pub(super) fn build_render_commands(&mut self) {
        self.frame_buffers.clear_render_work_buffers();
        let visible_bounds = self.camera.visible_bounds();

        if self.uses_hd2d_render_sort() {
            self.build_hd2d_render_commands(visible_bounds);
        } else {
            self.build_layered_render_commands(visible_bounds);
        }
    }

    fn build_layered_render_commands(&mut self, visible_bounds: AabbBounds) {
        self.tilemap
            .append_render_commands(&self.camera, &mut self.frame_buffers.render_commands);
        self.append_layered_entity_render_commands(visible_bounds);
        self.particles
            .append_render_commands(&self.camera, &mut self.frame_buffers.render_commands);
    }

    fn build_hd2d_render_commands(&mut self, visible_bounds: AabbBounds) {
        self.tilemap
            .append_render_items(&self.camera, &mut self.frame_buffers.render_items);
        self.append_entity_render_items(visible_bounds);
        self.particles
            .append_render_items(&self.camera, &mut self.frame_buffers.render_items);
        self.frame_buffers
            .render_items
            .sort_unstable_by(|left, right| left.sort_key.cmp_draw_order(right.sort_key));
        self.frame_buffers.render_commands.extend(
            self.frame_buffers
                .render_items
                .iter()
                .map(|item| item.command),
        );
    }

    fn append_layered_entity_render_commands(&mut self, visible_bounds: AabbBounds) {
        self.append_entity_render_items(visible_bounds);
        if entity_render_items_need_layer_sort(&self.frame_buffers.render_items) {
            self.frame_buffers
                .render_items
                .sort_unstable_by(|left, right| {
                    left.sort_key
                        .render_layer
                        .cmp(&right.sort_key.render_layer)
                        .then_with(|| left.sort_key.stable_id.cmp(&right.sort_key.stable_id))
                });
        }
        self.frame_buffers.render_commands.extend(
            self.frame_buffers
                .render_items
                .iter()
                .map(|item| item.command),
        );
        self.frame_buffers.render_items.clear();
    }

    fn append_entity_render_items(&mut self, visible_bounds: AabbBounds) {
        for &i in self.world.alive_indices() {
            let Some((t, s)) = self.world.renderable_sprite_at_index(i) else {
                continue;
            };
            if !sprite_intersects_viewport(t, s, visible_bounds) {
                continue;
            }
            let screen = self.camera.world_to_screen(t);
            self.frame_buffers.render_items.push(SpriteRenderItem {
                command: sprite_render_command(screen, s),
                sort_key: entity_render_sort_key(
                    self.world.height_span_at(i),
                    t.y + s.height * 0.5,
                    s.render_layer,
                    i,
                ),
            });
        }
    }

    fn uses_hd2d_render_sort(&self) -> bool {
        self.tilemap.has_hd2d_render_metadata()
            || self
                .world
                .alive_indices()
                .iter()
                .any(|&index| self.world.height_span_at(index).is_some())
    }
}

fn entity_render_sort_key(
    height_span: Option<HeightSpan>,
    foot_y: f32,
    render_layer: i32,
    entity_index: usize,
) -> SpriteRenderSortKey {
    SpriteRenderSortKey {
        floor_id: height_span.map_or(0, |span| span.floor.0),
        elevation: height_span.map_or(0.0, |span| span.elevation),
        foot_y,
        render_layer,
        stable_id: entity_index as u32,
    }
}

fn sprite_render_command(screen: Transform2D, sprite: Sprite) -> SpriteRenderCommand {
    SpriteRenderCommand {
        x: screen.x - sprite.width * 0.5,
        y: screen.y - sprite.height * 0.5,
        width: sprite.width,
        height: sprite.height,
        u0: sprite.u0,
        v0: sprite.v0,
        u1: sprite.u1,
        v1: sprite.v1,
        r: sprite.r,
        g: sprite.g,
        b: sprite.b,
        a: sprite.a,
        texture_id: sprite.texture_id as f32,
        effect_flags: SPRITE_EFFECT_NONE,
        rotation_radians: sprite.rotation_radians,
    }
}

fn entity_render_items_need_layer_sort(items: &[SpriteRenderItem]) -> bool {
    items
        .windows(2)
        .any(|pair| pair[0].sort_key.render_layer > pair[1].sort_key.render_layer)
}

fn sprite_intersects_viewport(
    transform: Transform2D,
    sprite: Sprite,
    visible_bounds: AabbBounds,
) -> bool {
    let half_width = sprite.width * 0.5;
    let half_height = sprite.height * 0.5;
    let rotation = sprite.rotation_radians;
    let (half_width, half_height) = if rotation == 0.0 || !rotation.is_finite() {
        (half_width, half_height)
    } else {
        let (sin, cos) = rotation.sin_cos();
        (
            cos.abs() * half_width + sin.abs() * half_height,
            sin.abs() * half_width + cos.abs() * half_height,
        )
    };
    AabbBounds::from_center(transform, half_width, half_height)
        .is_some_and(|bounds| bounds.overlaps(visible_bounds))
}
