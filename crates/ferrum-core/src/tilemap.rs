use crate::collision::SweptAabbContactHit;
use crate::components::SpriteFrame;
use crate::physics::{SlopeSegment, SlopeSurfaceHit};

mod authoring;
mod collision_cache;
mod collision_candidates;
mod collision_queries;
mod layer;
mod navigation;
mod queries;
mod rendering;

use collision_cache::{TileCollisionChunkCache, TileCollisionRect};
pub(crate) use navigation::TilemapNavigationScratch;

const MAX_NAVIGATION_CELLS: usize = 4096;
const DEFAULT_NAVIGATION_COST: u32 = 1;
const MAX_TILE_COLLISION_RESOLUTION_STEPS: usize = 4;
pub const MAX_TILEMAP_CONTACT_MANIFOLD_POINTS: usize = 2;
const TILE_COLLISION_CHUNK_SIZE: u32 = 16;
const TILE_SWEEP_EPSILON: f32 = 0.0001;
const TILE_GROUND_NORMAL_Y_MIN: f32 = 0.5;
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
    navigation_costs: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Tilemap {
    definitions: Vec<Option<TileDefinition>>,
    slope_definitions: Vec<Option<TileSlopeDefinition>>,
    one_way_platform_definitions: Vec<bool>,
    layers: Vec<Option<TilemapLayer>>,
    collision_rects: Vec<Option<Vec<TileCollisionRect>>>,
    collision_rect_chunks: Vec<Option<TileCollisionChunkCache>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TileRange {
    min_column: u32,
    max_column: u32,
    min_row: u32,
    max_row: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TilemapSweepStats {
    pub candidate_tiles: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct TilemapResolveStats {
    candidate_tiles: u32,
    hit_tiles: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct TilemapSweepHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub contact: SweptAabbContactHit,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapNearestObstacleHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapShapeCastHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapContactHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point_x: f32,
    pub point_y: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TilemapContactPoint {
    pub point_x: f32,
    pub point_y: f32,
    pub penetration: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapContactManifoldHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub point_count: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub points: [TilemapContactPoint; MAX_TILEMAP_CONTACT_MANIFOLD_POINTS],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TileSlopeDefinition {
    pub local_x0: f32,
    pub local_y0: f32,
    pub local_x1: f32,
    pub local_y1: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct TilemapSlopeGroundHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub surface: SlopeSurfaceHit,
    pub vertical_delta: f32,
    pub distance: f32,
}

impl TileSlopeDefinition {
    pub const fn new(local_x0: f32, local_y0: f32, local_x1: f32, local_y1: f32) -> Self {
        Self {
            local_x0,
            local_y0,
            local_x1,
            local_y1,
        }
    }

    fn world_segment(self, layer: &TilemapLayer, column: u32, row: u32) -> SlopeSegment {
        let tile_x = layer.origin_x + column as f32 * layer.tile_width;
        let tile_y = layer.origin_y + row as f32 * layer.tile_height;
        SlopeSegment::new(
            tile_x + self.local_x0 * layer.tile_width,
            tile_y + self.local_y0 * layer.tile_height,
            tile_x + self.local_x1 * layer.tile_width,
            tile_y + self.local_y1 * layer.tile_height,
        )
    }
}

#[cfg(test)]
mod tests;
