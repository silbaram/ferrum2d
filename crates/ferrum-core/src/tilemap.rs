use std::cmp::Ordering;
use std::collections::BinaryHeap;

use crate::camera::Camera2D;
use crate::components::{AabbCollider, CollisionLayer, SpriteFrame, Transform2D};
use crate::render_command::SpriteRenderCommand;
use crate::world::World;

const MAX_NAVIGATION_CELLS: usize = 4096;
const UNVISITED_CELL: usize = usize::MAX;

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

    pub fn navigation_waypoint(&self, from: Transform2D, to: Transform2D) -> Option<Transform2D> {
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            let Some(cell_count) = layer.cell_count() else {
                continue;
            };
            if cell_count > MAX_NAVIGATION_CELLS {
                continue;
            }
            let Some(start) = layer.walkable_cell_at(from) else {
                continue;
            };
            let Some(goal) = layer.walkable_cell_at(to) else {
                continue;
            };
            if start == goal {
                return Some(to);
            }
            let Some(next_cell) = layer.next_path_cell(start, goal) else {
                continue;
            };
            return Some(layer.tile_center(next_cell));
        }
        None
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

    fn cell_count(&self) -> Option<usize> {
        (self.columns as usize).checked_mul(self.rows as usize)
    }

    fn cell_at(&self, transform: Transform2D) -> Option<usize> {
        let max_x = self.origin_x + self.columns as f32 * self.tile_width;
        let max_y = self.origin_y + self.rows as f32 * self.tile_height;
        if transform.x < self.origin_x
            || transform.x > max_x
            || transform.y < self.origin_y
            || transform.y > max_y
        {
            return None;
        }

        let column = ((transform.x - self.origin_x) / self.tile_width)
            .floor()
            .clamp(0.0, (self.columns - 1) as f32) as u32;
        let row = ((transform.y - self.origin_y) / self.tile_height)
            .floor()
            .clamp(0.0, (self.rows - 1) as f32) as u32;
        Some((row * self.columns + column) as usize)
    }

    fn walkable_cell_at(&self, transform: Transform2D) -> Option<usize> {
        let cell = self.cell_at(transform)?;
        self.is_walkable(cell).then_some(cell)
    }

    fn is_walkable(&self, cell: usize) -> bool {
        self.tiles.get(cell).copied().unwrap_or(0) == 0
    }

    fn next_path_cell(&self, start: usize, goal: usize) -> Option<usize> {
        let cell_count = self.cell_count()?;
        let mut came_from = vec![UNVISITED_CELL; cell_count];
        let mut g_scores = vec![u32::MAX; cell_count];
        let mut open = BinaryHeap::new();
        g_scores[start] = 0;
        open.push(PathNode {
            cell: start,
            g_score: 0,
            f_score: self.manhattan_distance(start, goal),
        });

        while let Some(node) = open.pop() {
            if node.cell == goal {
                return reconstruct_next_cell(start, goal, &came_from);
            }
            if node.g_score != g_scores[node.cell] {
                continue;
            }
            for neighbor in self.neighbor_indices(node.cell).into_iter().flatten() {
                if !self.is_walkable(neighbor) {
                    continue;
                }
                let next_g_score = node.g_score.saturating_add(1);
                if next_g_score >= g_scores[neighbor] {
                    continue;
                }
                came_from[neighbor] = node.cell;
                g_scores[neighbor] = next_g_score;
                open.push(PathNode {
                    cell: neighbor,
                    g_score: next_g_score,
                    f_score: next_g_score + self.manhattan_distance(neighbor, goal),
                });
            }
        }

        None
    }

    fn neighbor_indices(&self, cell: usize) -> [Option<usize>; 4] {
        let column = cell as u32 % self.columns;
        let row = cell as u32 / self.columns;
        [
            (column > 0).then(|| cell - 1),
            (column + 1 < self.columns).then(|| cell + 1),
            (row > 0).then(|| cell - self.columns as usize),
            (row + 1 < self.rows).then(|| cell + self.columns as usize),
        ]
    }

    fn manhattan_distance(&self, from: usize, to: usize) -> u32 {
        let from_column = from as u32 % self.columns;
        let from_row = from as u32 / self.columns;
        let to_column = to as u32 % self.columns;
        let to_row = to as u32 / self.columns;
        from_column.abs_diff(to_column) + from_row.abs_diff(to_row)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PathNode {
    cell: usize,
    g_score: u32,
    f_score: u32,
}

impl Ord for PathNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .f_score
            .cmp(&self.f_score)
            .then_with(|| other.g_score.cmp(&self.g_score))
            .then_with(|| self.cell.cmp(&other.cell))
    }
}

impl PartialOrd for PathNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn reconstruct_next_cell(start: usize, goal: usize, came_from: &[usize]) -> Option<usize> {
    let mut current = goal;
    let mut previous = came_from.get(current).copied()?;
    if previous == UNVISITED_CELL {
        return None;
    }

    while previous != start {
        current = previous;
        previous = came_from.get(current).copied()?;
        if previous == UNVISITED_CELL {
            return None;
        }
    }

    Some(current)
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

    #[test]
    fn navigation_waypoint_uses_collision_layer_path() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(
            0,
            3,
            3,
            10.0,
            10.0,
            0.0,
            0.0,
            true,
            vec![0, 1, 0, 0, 1, 0, 0, 0, 0],
        );

        let waypoint = tilemap
            .navigation_waypoint(
                Transform2D { x: 5.0, y: 5.0 },
                Transform2D { x: 25.0, y: 5.0 },
            )
            .unwrap();

        assert_eq!(waypoint, Transform2D { x: 5.0, y: 15.0 });
    }

    #[test]
    fn navigation_waypoint_is_none_without_collision_layer() {
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 2, 1, 10.0, 10.0, 0.0, 0.0, false, vec![0, 0]);

        assert_eq!(
            tilemap.navigation_waypoint(
                Transform2D { x: 5.0, y: 5.0 },
                Transform2D { x: 15.0, y: 5.0 },
            ),
            None
        );
    }
}
