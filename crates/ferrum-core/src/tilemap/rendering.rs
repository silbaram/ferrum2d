use super::{TileDefinition, Tilemap, TilemapLayer};
use crate::camera::Camera2D;
use crate::render_command::{SpriteRenderCommand, SPRITE_EFFECT_NONE};

impl Tilemap {
    pub fn append_render_commands(
        &self,
        camera: &Camera2D,
        render_commands: &mut Vec<SpriteRenderCommand>,
    ) {
        for layer in self.layers.iter().flatten() {
            self.append_layer_render_commands(layer, camera, render_commands);
        }
    }

    fn append_layer_render_commands(
        &self,
        layer: &TilemapLayer,
        camera: &Camera2D,
        render_commands: &mut Vec<SpriteRenderCommand>,
    ) {
        for (tile_index, tile_id) in layer.tiles.iter().copied().enumerate() {
            if tile_id == 0 {
                continue;
            }
            let Some(definition) = self.tile_definition(tile_id) else {
                continue;
            };
            let center = layer.tile_center(tile_index);
            let screen = camera.world_to_screen(center);
            let (u0, v0, u1, v1) = definition.frame.uv();
            render_commands.push(SpriteRenderCommand {
                x: screen.x - layer.tile_width * 0.5,
                y: screen.y - layer.tile_height * 0.5,
                width: layer.tile_width,
                height: layer.tile_height,
                u0,
                v0,
                u1,
                v1,
                r: definition.r,
                g: definition.g,
                b: definition.b,
                a: definition.a,
                texture_id: definition.texture_id as f32,
                effect_flags: SPRITE_EFFECT_NONE,
            });
        }
    }

    fn tile_definition(&self, tile_id: u32) -> Option<TileDefinition> {
        self.definitions
            .get(tile_id as usize)
            .and_then(|definition| *definition)
    }
}
