use super::{TileDefinition, TileRange, Tilemap, TilemapLayer};
use crate::camera::Camera2D;
use crate::components::HeightSpan;
use crate::render_command::{
    SpriteRenderCommand, SpriteRenderItem, SpriteRenderSortKey, SPRITE_EFFECT_NONE,
};

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

    pub(crate) fn append_render_items(
        &self,
        camera: &Camera2D,
        render_items: &mut Vec<SpriteRenderItem>,
    ) {
        for (layer_index, layer) in self.layers.iter().enumerate() {
            let Some(layer) = layer else {
                continue;
            };
            self.append_layer_render_items(layer_index, layer, camera, render_items);
        }
    }

    pub(crate) fn has_hd2d_render_metadata(&self) -> bool {
        self.height_span_definitions.iter().any(Option::is_some)
            || self.bridge_portal_definitions.iter().any(Option::is_some)
    }

    fn append_layer_render_commands(
        &self,
        layer: &TilemapLayer,
        camera: &Camera2D,
        render_commands: &mut Vec<SpriteRenderCommand>,
    ) {
        let Some(range) = visible_tile_range(layer, camera) else {
            return;
        };
        let layer_command_start = render_commands.len();
        for row in range.min_row..=range.max_row {
            for column in range.min_column..=range.max_column {
                let tile_index = layer.tile_index(column, row);
                let Some(tile_id) = layer.tiles.get(tile_index).copied() else {
                    continue;
                };
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
                    rotation_radians: 0.0,
                });
            }
        }
        bucket_layer_commands_by_texture(&mut render_commands[layer_command_start..]);
    }

    fn append_layer_render_items(
        &self,
        layer_index: usize,
        layer: &TilemapLayer,
        camera: &Camera2D,
        render_items: &mut Vec<SpriteRenderItem>,
    ) {
        let Some(range) = visible_tile_range(layer, camera) else {
            return;
        };
        for row in range.min_row..=range.max_row {
            for column in range.min_column..=range.max_column {
                let tile_index = layer.tile_index(column, row);
                let Some(tile_id) = layer.tiles.get(tile_index).copied() else {
                    continue;
                };
                if tile_id == 0 {
                    continue;
                }
                let Some(definition) = self.tile_definition(tile_id) else {
                    continue;
                };
                let center = layer.tile_center(tile_index);
                let screen = camera.world_to_screen(center);
                let (u0, v0, u1, v1) = definition.frame.uv();
                render_items.push(SpriteRenderItem {
                    command: SpriteRenderCommand {
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
                        rotation_radians: 0.0,
                    },
                    sort_key: self.tile_render_sort_key(
                        tile_id,
                        center.y + layer.tile_height * 0.5,
                        layer_index,
                        tile_index,
                    ),
                });
            }
        }
    }

    fn tile_definition(&self, tile_id: u32) -> Option<TileDefinition> {
        self.definitions
            .get(tile_id as usize)
            .and_then(|definition| *definition)
    }

    fn tile_render_sort_key(
        &self,
        tile_id: u32,
        foot_y: f32,
        layer_index: usize,
        tile_index: usize,
    ) -> SpriteRenderSortKey {
        let height_span = self.tile_render_height_span(tile_id);
        SpriteRenderSortKey {
            floor_id: height_span.map_or(0, |span| span.floor.0),
            elevation: height_span.map_or(0.0, |span| span.elevation),
            foot_y,
            render_layer: layer_index.min(i32::MAX as usize) as i32,
            stable_id: (layer_index as u32)
                .saturating_mul(1_000_000)
                .saturating_add(tile_index as u32),
        }
    }

    fn tile_render_height_span(&self, tile_id: u32) -> Option<HeightSpan> {
        self.height_span_definitions
            .get(tile_id as usize)
            .and_then(|height_span| *height_span)
            .or_else(|| {
                self.bridge_portal_definitions
                    .get(tile_id as usize)
                    .and_then(|portal| *portal)
                    .and_then(|portal| portal.height_span_for_floor(portal.upper_floor, 0.0))
            })
    }
}

fn visible_tile_range(layer: &TilemapLayer, camera: &Camera2D) -> Option<TileRange> {
    layer.candidate_tile_range_for_bounds(camera.visible_bounds())
}

fn bucket_layer_commands_by_texture(commands: &mut [SpriteRenderCommand]) {
    if commands.len() < 2 || commands_are_texture_grouped(commands) {
        return;
    }
    commands.sort_unstable_by(|left, right| left.texture_id.total_cmp(&right.texture_id));
}

fn commands_are_texture_grouped(commands: &[SpriteRenderCommand]) -> bool {
    commands
        .windows(2)
        .all(|pair| pair[0].texture_id <= pair[1].texture_id)
}
