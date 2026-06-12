use crate::collision::SweptAabbContactHit;
use crate::components::{HeightSpan, PhysicsFloorId, SpriteFrame, Transform2D};
use crate::physics::{SlopeSegment, SlopeSurfaceHit};

mod authoring;
mod collision_cache;
mod collision_candidates;
mod collision_queries;
mod hd2d_surface;
mod layer;
mod navigation;
mod queries;
mod render_cache;
mod rendering;

use collision_cache::{TileCollisionChunkCache, TileCollisionRect};
pub(crate) use navigation::TilemapNavigationScratch;
use render_cache::TileRenderChunkCache;

const MAX_NAVIGATION_CELLS: usize = 4096;
const DEFAULT_NAVIGATION_COST: u32 = 1;
const MAX_TILE_COLLISION_RESOLUTION_STEPS: usize = 4;
pub const MAX_TILEMAP_CONTACT_MANIFOLD_POINTS: usize = 2;
const TILE_COLLISION_CHUNK_SIZE: u32 = 16;
const TILE_RENDER_CHUNK_SIZE: u32 = 16;
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hd2dTileKind {
    Flat,
    Stair,
    Ramp,
    Ledge,
    Bridge,
}

impl Hd2dTileKind {
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Flat),
            1 => Some(Self::Stair),
            2 => Some(Self::Ramp),
            3 => Some(Self::Ledge),
            4 => Some(Self::Bridge),
            _ => None,
        }
    }

    pub fn code(self) -> u32 {
        match self {
            Self::Flat => 0,
            Self::Stair => 1,
            Self::Ramp => 2,
            Self::Ledge => 3,
            Self::Bridge => 4,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hd2dRampAxis {
    X,
    Y,
}

impl Hd2dRampAxis {
    pub fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::X),
            1 => Some(Self::Y),
            _ => None,
        }
    }

    pub fn code(self) -> u32 {
        match self {
            Self::X => 0,
            Self::Y => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hd2dRampDefinition {
    pub axis: Hd2dRampAxis,
    pub start_elevation: f32,
    pub end_elevation: f32,
}

impl Hd2dRampDefinition {
    pub fn new(axis: Hd2dRampAxis, start_elevation: f32, end_elevation: f32) -> Option<Self> {
        if !start_elevation.is_finite() || !end_elevation.is_finite() {
            return None;
        }
        Some(Self {
            axis,
            start_elevation,
            end_elevation,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hd2dTileDefinition {
    pub kind: Hd2dTileKind,
    pub blocks_movement: bool,
    pub blocks_projectile: bool,
    pub blocks_vision: bool,
    pub occluder_height: f32,
    pub ramp: Option<Hd2dRampDefinition>,
}

impl Hd2dTileDefinition {
    pub fn new(
        kind: Hd2dTileKind,
        blocks_movement: bool,
        blocks_projectile: bool,
        blocks_vision: bool,
        occluder_height: f32,
        ramp: Option<Hd2dRampDefinition>,
    ) -> Option<Self> {
        if !occluder_height.is_finite() || occluder_height < 0.0 {
            return None;
        }
        if (kind == Hd2dTileKind::Ramp) != ramp.is_some() {
            return None;
        }
        Some(Self {
            kind,
            blocks_movement,
            blocks_projectile,
            blocks_vision,
            occluder_height,
            ramp,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hd2dBridgePortalDefinition {
    pub lower_floor: PhysicsFloorId,
    pub upper_floor: PhysicsFloorId,
    pub lower_elevation: f32,
    pub upper_elevation: f32,
    pub navigation_cost: u32,
}

impl Hd2dBridgePortalDefinition {
    pub fn new(
        lower_floor: PhysicsFloorId,
        upper_floor: PhysicsFloorId,
        lower_elevation: f32,
        upper_elevation: f32,
        navigation_cost: u32,
    ) -> Option<Self> {
        if lower_floor == upper_floor
            || !lower_elevation.is_finite()
            || !upper_elevation.is_finite()
        {
            return None;
        }
        Some(Self {
            lower_floor,
            upper_floor,
            lower_elevation,
            upper_elevation,
            navigation_cost: navigation_cost.max(DEFAULT_NAVIGATION_COST),
        })
    }

    pub fn height_span_for_floor(self, floor: PhysicsFloorId, height: f32) -> Option<HeightSpan> {
        if floor == self.lower_floor {
            HeightSpan::new(floor, self.lower_elevation, height)
        } else if floor == self.upper_floor {
            HeightSpan::new(floor, self.upper_elevation, height)
        } else {
            None
        }
    }

    pub fn target_floor(self, floor: PhysicsFloorId) -> Option<PhysicsFloorId> {
        if floor == self.lower_floor {
            Some(self.upper_floor)
        } else if floor == self.upper_floor {
            Some(self.lower_floor)
        } else {
            None
        }
    }
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
    height_span_definitions: Vec<Option<HeightSpan>>,
    hd2d_definitions: Vec<Option<Hd2dTileDefinition>>,
    bridge_portal_definitions: Vec<Option<Hd2dBridgePortalDefinition>>,
    layers: Vec<Option<TilemapLayer>>,
    collision_rects: Vec<Option<Vec<TileCollisionRect>>>,
    collision_rect_chunks: Vec<Option<TileCollisionChunkCache>>,
    render_chunks: Vec<Option<TileRenderChunkCache>>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct TileRange {
    min_column: u32,
    max_column: u32,
    min_row: u32,
    max_row: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TilemapSweepStats {
    pub candidate_tiles: u32,
    pub hd2d_filtered_tiles: u32,
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
pub struct TilemapHd2dSurfaceHit {
    pub layer_index: usize,
    pub tile_index: usize,
    pub tile_id: u32,
    pub kind: Hd2dTileKind,
    pub floor: crate::components::PhysicsFloorId,
    pub elevation: f32,
    pub height: f32,
    pub blocks_movement: bool,
    pub blocks_projectile: bool,
    pub blocks_vision: bool,
    pub occluder_height: f32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TilemapNavigationPathPoint {
    pub x: f32,
    pub y: f32,
    pub floor: PhysicsFloorId,
    pub elevation: f32,
    pub height: f32,
}

impl TilemapNavigationPathPoint {
    pub fn new(transform: Transform2D, height_span: HeightSpan) -> Self {
        Self {
            x: transform.x,
            y: transform.y,
            floor: height_span.floor,
            elevation: height_span.elevation,
            height: height_span.height,
        }
    }

    pub fn transform(self) -> Transform2D {
        Transform2D {
            x: self.x,
            y: self.y,
        }
    }

    pub fn height_span(self) -> HeightSpan {
        HeightSpan {
            floor: self.floor,
            elevation: self.elevation,
            height: self.height,
        }
    }
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
