use crate::camera::Camera2D;
use crate::components::{AabbCollider, CollisionLayer, SpriteFrame, Transform2D};
use crate::render_command::SpriteRenderCommand;
use crate::world::World;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TileDefinition {
    pub texture_id: u32,
    pub frame: SpriteFrame,
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TilemapLayer {
    pub columns: u32,
    pub rows: u32,
    pub tile_width: f32,
    pub tile_height: f32,
    pub origin_x: f32,
    pub origin_y: f32,
    pub collision: bool,
    pub tiles: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Tilemap {
    definitions: Vec<Option<TileDefinition>>,
    layers: Vec<Option<TilemapLayer>>,
}

impl Tilemap {
    pub fn clear(&mut self) {
        self.definitions.clear();
        self.layers.clear();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_tile_definition(
        &mut self,
        tile_id: u32,
        texture_id: u32,
        u0: f32,
        v0: f32,
        u1: f32,
        v1: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
    ) {
        if tile_id == 0 {
            return;
        }
        let Some(frame) = SpriteFrame::from_values(u0, v0, u1, v1) else {
            return;
        };

        let index = tile_id as usize;
        if index >= self.definitions.len() {
            self.definitions.resize(index + 1, None);
        }
        self.definitions[index] = Some(TileDefinition {
            texture_id,
            frame,
            r: normalized_or_default(r, 1.0),
            g: normalized_or_default(g, 1.0),
            b: normalized_or_default(b, 1.0),
            a: normalized_or_default(a, 1.0),
        });
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_layer(
        &mut self,
        index: u32,
        columns: u32,
        rows: u32,
        tile_width: f32,
        tile_height: f32,
        origin_x: f32,
        origin_y: f32,
        collision: bool,
        tiles: Vec<u32>,
    ) {
        let Some(layer) = TilemapLayer::from_values(
            columns,
            rows,
            tile_width,
            tile_height,
            origin_x,
            origin_y,
            collision,
            tiles,
        ) else {
            return;
        };

        let index = index as usize;
        if index >= self.layers.len() {
            self.layers.resize_with(index + 1, || None);
        }
        self.layers[index] = Some(layer);
    }

    pub fn resolve_dynamic_collisions(&self, world: &mut World) {
        for entity_index in 0..world.transforms.len() {
            if !world.alive[entity_index] {
                continue;
            }
            let Some(collider) = world.colliders[entity_index] else {
                continue;
            };
            if !is_tilemap_blocked_layer(collider.layer) {
                continue;
            }
            let Some(mut transform) = world.transforms[entity_index] else {
                continue;
            };
            self.resolve_transform_against_solid_tiles(&mut transform, collider);
            world.transforms[entity_index] = Some(transform);
        }
    }

    pub fn append_render_commands(
        &self,
        camera: &Camera2D,
        render_commands: &mut Vec<SpriteRenderCommand>,
    ) {
        for layer in self.layers.iter().flatten() {
            self.append_layer_render_commands(layer, camera, render_commands);
        }
    }

    fn resolve_transform_against_solid_tiles(
        &self,
        transform: &mut Transform2D,
        collider: AabbCollider,
    ) {
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            for (tile_index, tile_id) in layer.tiles.iter().copied().enumerate() {
                if tile_id == 0 {
                    continue;
                }
                let tile_center = layer.tile_center(tile_index);
                resolve_dynamic_aabb_against_static(
                    transform,
                    collider,
                    tile_center,
                    layer.tile_width * 0.5,
                    layer.tile_height * 0.5,
                );
            }
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
            });
        }
    }

    fn tile_definition(&self, tile_id: u32) -> Option<TileDefinition> {
        self.definitions
            .get(tile_id as usize)
            .and_then(|definition| *definition)
    }
}

impl TilemapLayer {
    #[allow(clippy::too_many_arguments)]
    fn from_values(
        columns: u32,
        rows: u32,
        tile_width: f32,
        tile_height: f32,
        origin_x: f32,
        origin_y: f32,
        collision: bool,
        mut tiles: Vec<u32>,
    ) -> Option<Self> {
        if columns == 0 || rows == 0 || !is_positive(tile_width) || !is_positive(tile_height) {
            return None;
        }
        let expected_len = (columns as usize).checked_mul(rows as usize)?;
        tiles.resize(expected_len, 0);
        tiles.truncate(expected_len);

        Some(Self {
            columns,
            rows,
            tile_width,
            tile_height,
            origin_x: finite_or_default(origin_x, 0.0),
            origin_y: finite_or_default(origin_y, 0.0),
            collision,
            tiles,
        })
    }

    fn tile_center(&self, tile_index: usize) -> Transform2D {
        let column = (tile_index as u32 % self.columns) as f32;
        let row = (tile_index as u32 / self.columns) as f32;
        Transform2D {
            x: self.origin_x + column * self.tile_width + self.tile_width * 0.5,
            y: self.origin_y + row * self.tile_height + self.tile_height * 0.5,
        }
    }
}

fn is_tilemap_blocked_layer(layer: CollisionLayer) -> bool {
    matches!(layer, CollisionLayer::Player | CollisionLayer::Enemy)
}

fn resolve_dynamic_aabb_against_static(
    transform: &mut Transform2D,
    collider: AabbCollider,
    static_center: Transform2D,
    static_half_width: f32,
    static_half_height: f32,
) {
    let dx = transform.x - static_center.x;
    let overlap_x = collider.half_width + static_half_width - dx.abs();
    if overlap_x <= 0.0 {
        return;
    }

    let dy = transform.y - static_center.y;
    let overlap_y = collider.half_height + static_half_height - dy.abs();
    if overlap_y <= 0.0 {
        return;
    }

    if overlap_x < overlap_y {
        transform.x += if dx >= 0.0 { overlap_x } else { -overlap_x };
    } else {
        transform.y += if dy >= 0.0 { overlap_y } else { -overlap_y };
    }
}

fn is_positive(value: f32) -> bool {
    value.is_finite() && value > 0.0
}

fn finite_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        default
    }
}

fn normalized_or_default(value: f32, default: f32) -> f32 {
    if value.is_finite() && (0.0..=1.0).contains(&value) {
        value
    } else {
        default
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tilemap_appends_static_tile_render_commands() {
        let mut tilemap = Tilemap::default();
        tilemap.set_tile_definition(1, 7, 0.25, 0.0, 0.5, 0.25, 0.8, 0.7, 0.6, 1.0);
        tilemap.set_layer(0, 2, 1, 32.0, 16.0, 10.0, 20.0, false, vec![1, 0]);
        let camera = Camera2D::new(320.0, 240.0);
        let mut commands = Vec::new();

        tilemap.append_render_commands(&camera, &mut commands);

        assert_eq!(commands.len(), 1);
        let command = commands[0];
        assert_eq!(command.texture_id, 7.0);
        assert_eq!(command.width, 32.0);
        assert_eq!(command.height, 16.0);
        assert_eq!(command.u0, 0.25);
        assert_eq!(command.v1, 0.25);
        assert_eq!(command.r, 0.8);
        assert!((command.x - 10.0).abs() < 0.01);
        assert!((command.y - 20.0).abs() < 0.01);
    }

    #[test]
    fn undefined_tiles_are_skipped() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 3, 1, 16.0, 16.0, 0.0, 0.0, false, vec![0, 2, 0]);
        let camera = Camera2D::new(320.0, 240.0);
        let mut commands = Vec::new();

        tilemap.append_render_commands(&camera, &mut commands);

        assert!(commands.is_empty());
    }

    #[test]
    fn collision_layers_resolve_player_overlap() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, true, vec![1]);
        let mut world = World::default();
        let player = world.spawn_player(20.0, 16.0, 0);

        tilemap.resolve_dynamic_collisions(&mut world);

        let transform = world.transforms[player.id as usize].unwrap();
        assert_eq!(transform.x, 50.0);
        assert_eq!(transform.y, 16.0);
    }

    #[test]
    fn non_collision_layers_do_not_block_player() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 0.0, 0.0, false, vec![1]);
        let mut world = World::default();
        let player = world.spawn_player(20.0, 16.0, 0);

        tilemap.resolve_dynamic_collisions(&mut world);

        assert_eq!(
            world.transforms[player.id as usize],
            Some(Transform2D { x: 20.0, y: 16.0 })
        );
    }
}
