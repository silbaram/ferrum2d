use super::{TileRange, TileSlopeDefinition, TilemapLayer, TILE_COLLISION_CHUNK_SIZE};
use crate::collision::AabbBounds;
use crate::components::{AabbCollider, CollisionLayer, Transform2D};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct TileCollisionRect {
    pub(super) tile_index: usize,
    pub(super) min_column: u32,
    pub(super) min_row: u32,
    pub(super) columns: u32,
    pub(super) rows: u32,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct TileCollisionChunkCache {
    pub(super) chunk_columns: u32,
    pub(super) chunk_rows: u32,
    pub(super) chunks: Vec<Vec<TileCollisionRect>>,
    pub(super) last_rebuilt_chunks: u32,
    pub(super) total_rebuilt_chunks: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TileRun {
    min_column: u32,
    columns: u32,
}

impl TileCollisionRect {
    pub(super) fn max_column(self) -> u32 {
        self.min_column + self.columns - 1
    }

    pub(super) fn max_row(self) -> u32 {
        self.min_row + self.rows - 1
    }

    pub(super) fn intersects_tile_range(self, range: TileRange) -> bool {
        self.min_column <= range.max_column
            && self.max_column() >= range.min_column
            && self.min_row <= range.max_row
            && self.max_row() >= range.min_row
    }

    pub(super) fn center(self, layer: &TilemapLayer) -> Transform2D {
        Transform2D {
            x: layer.origin_x
                + self.min_column as f32 * layer.tile_width
                + self.columns as f32 * layer.tile_width * 0.5,
            y: layer.origin_y
                + self.min_row as f32 * layer.tile_height
                + self.rows as f32 * layer.tile_height * 0.5,
        }
    }

    pub(super) fn half_width(self, layer: &TilemapLayer) -> f32 {
        self.columns as f32 * layer.tile_width * 0.5
    }

    pub(super) fn half_height(self, layer: &TilemapLayer) -> f32 {
        self.rows as f32 * layer.tile_height * 0.5
    }

    pub(super) fn bounds(self, layer: &TilemapLayer) -> AabbBounds {
        AabbBounds {
            min_x: layer.origin_x + self.min_column as f32 * layer.tile_width,
            min_y: layer.origin_y + self.min_row as f32 * layer.tile_height,
            max_x: layer.origin_x + (self.max_column() + 1) as f32 * layer.tile_width,
            max_y: layer.origin_y + (self.max_row() + 1) as f32 * layer.tile_height,
        }
    }

    pub(super) fn aabb_collider(
        self,
        layer: &TilemapLayer,
        dynamic_layer: CollisionLayer,
    ) -> AabbCollider {
        AabbCollider {
            half_width: self.half_width(layer),
            half_height: self.half_height(layer),
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger: false,
            layer: dynamic_layer,
        }
    }
}

impl TileCollisionChunkCache {
    pub(super) fn new(chunk_columns: u32, chunk_rows: u32) -> Self {
        let chunk_count = (chunk_columns as usize).saturating_mul(chunk_rows as usize);
        Self {
            chunk_columns,
            chunk_rows,
            chunks: vec![Vec::new(); chunk_count],
            last_rebuilt_chunks: 0,
            total_rebuilt_chunks: 0,
        }
    }

    pub(super) fn chunk_index(&self, chunk_column: u32, chunk_row: u32) -> usize {
        (chunk_row * self.chunk_columns + chunk_column) as usize
    }

    pub(super) fn flattened_rects(&self) -> Vec<TileCollisionRect> {
        let mut rects: Vec<_> = self
            .chunks
            .iter()
            .flat_map(|chunk| chunk.iter().copied())
            .collect();
        rects.sort_by_key(|rect| rect.tile_index);
        rects
    }
}

#[cfg(test)]
pub(super) fn build_collision_rects_for_layer(
    layer: &TilemapLayer,
    slope_definitions: &[Option<TileSlopeDefinition>],
    one_way_platform_definitions: &[bool],
) -> Vec<TileCollisionRect> {
    let Some(range) = tile_range_from_rect(layer, 0, 0, layer.columns, layer.rows) else {
        return Vec::new();
    };
    build_collision_rects_for_layer_range(
        layer,
        range,
        slope_definitions,
        one_way_platform_definitions,
    )
}

pub(super) fn build_collision_chunk_cache_for_layer(
    layer: &TilemapLayer,
    slope_definitions: &[Option<TileSlopeDefinition>],
    one_way_platform_definitions: &[bool],
) -> TileCollisionChunkCache {
    let chunk_columns = collision_chunk_count(layer.columns);
    let chunk_rows = collision_chunk_count(layer.rows);
    let mut cache = TileCollisionChunkCache::new(chunk_columns, chunk_rows);

    for chunk_row in 0..chunk_rows {
        for chunk_column in 0..chunk_columns {
            let chunk_index = cache.chunk_index(chunk_column, chunk_row);
            let tile_range = tile_range_for_chunk(layer, chunk_column, chunk_row);
            cache.chunks[chunk_index] = build_collision_rects_for_layer_range(
                layer,
                tile_range,
                slope_definitions,
                one_way_platform_definitions,
            );
        }
    }
    let rebuilt_count = chunk_columns.saturating_mul(chunk_rows);
    cache.last_rebuilt_chunks = rebuilt_count;
    cache.total_rebuilt_chunks = rebuilt_count;
    cache
}

pub(super) fn build_collision_rects_for_layer_range(
    layer: &TilemapLayer,
    range: TileRange,
    slope_definitions: &[Option<TileSlopeDefinition>],
    one_way_platform_definitions: &[bool],
) -> Vec<TileCollisionRect> {
    let mut completed = Vec::new();
    let mut active = Vec::new();
    let mut next_active = Vec::new();
    let mut row_runs = Vec::new();

    for row in range.min_row..=range.max_row {
        next_active.clear();
        write_solid_runs_for_row_range(
            layer,
            row,
            range.min_column,
            range.max_column,
            slope_definitions,
            one_way_platform_definitions,
            &mut row_runs,
        );

        for run in row_runs.iter().copied() {
            if let Some(active_index) = active.iter().position(|rect: &TileCollisionRect| {
                rect.min_column == run.min_column
                    && rect.columns == run.columns
                    && rect.min_row + rect.rows == row
            }) {
                let mut rect = active.swap_remove(active_index);
                rect.rows += 1;
                next_active.push(rect);
            } else {
                next_active.push(TileCollisionRect {
                    tile_index: layer.tile_index(run.min_column, row),
                    min_column: run.min_column,
                    min_row: row,
                    columns: run.columns,
                    rows: 1,
                });
            }
        }
        completed.append(&mut active);
        std::mem::swap(&mut active, &mut next_active);
    }

    completed.append(&mut active);
    completed.sort_by_key(|rect| rect.tile_index);
    completed
}

fn write_solid_runs_for_row_range(
    layer: &TilemapLayer,
    row: u32,
    min_column: u32,
    max_column: u32,
    slope_definitions: &[Option<TileSlopeDefinition>],
    one_way_platform_definitions: &[bool],
    runs: &mut Vec<TileRun>,
) {
    runs.clear();
    if min_column > max_column || row >= layer.rows || min_column >= layer.columns {
        return;
    }
    let max_column = max_column.min(layer.columns - 1);
    let mut column = min_column;
    while column <= max_column {
        while column <= max_column
            && !is_solid_tile(
                layer,
                column,
                row,
                slope_definitions,
                one_way_platform_definitions,
            )
        {
            column += 1;
        }
        if column > max_column {
            break;
        }
        let run_min_column = column;
        while column <= max_column
            && is_solid_tile(
                layer,
                column,
                row,
                slope_definitions,
                one_way_platform_definitions,
            )
        {
            column += 1;
        }
        runs.push(TileRun {
            min_column: run_min_column,
            columns: column - run_min_column,
        });
    }
}

pub(super) fn collision_chunk_count(tile_count: u32) -> u32 {
    tile_count.div_ceil(TILE_COLLISION_CHUNK_SIZE).max(1)
}

pub(super) fn tile_range_from_rect(
    layer: &TilemapLayer,
    column: u32,
    row: u32,
    width: u32,
    height: u32,
) -> Option<TileRange> {
    if width == 0 || height == 0 || column >= layer.columns || row >= layer.rows {
        return None;
    }
    let end_column = column.checked_add(width)?;
    let end_row = row.checked_add(height)?;
    if end_column > layer.columns || end_row > layer.rows {
        return None;
    }
    Some(TileRange {
        min_column: column,
        max_column: end_column - 1,
        min_row: row,
        max_row: end_row - 1,
    })
}

pub(super) fn tile_range_for_chunk(
    layer: &TilemapLayer,
    chunk_column: u32,
    chunk_row: u32,
) -> TileRange {
    let min_column = chunk_column * TILE_COLLISION_CHUNK_SIZE;
    let min_row = chunk_row * TILE_COLLISION_CHUNK_SIZE;
    TileRange {
        min_column,
        max_column: (min_column + TILE_COLLISION_CHUNK_SIZE - 1).min(layer.columns - 1),
        min_row,
        max_row: (min_row + TILE_COLLISION_CHUNK_SIZE - 1).min(layer.rows - 1),
    }
}

pub(super) fn chunk_range_for_tile_range(
    range: TileRange,
    cache: &TileCollisionChunkCache,
) -> TileRange {
    TileRange {
        min_column: (range.min_column / TILE_COLLISION_CHUNK_SIZE).min(cache.chunk_columns - 1),
        max_column: (range.max_column / TILE_COLLISION_CHUNK_SIZE).min(cache.chunk_columns - 1),
        min_row: (range.min_row / TILE_COLLISION_CHUNK_SIZE).min(cache.chunk_rows - 1),
        max_row: (range.max_row / TILE_COLLISION_CHUNK_SIZE).min(cache.chunk_rows - 1),
    }
}

fn is_solid_tile(
    layer: &TilemapLayer,
    column: u32,
    row: u32,
    slope_definitions: &[Option<TileSlopeDefinition>],
    one_way_platform_definitions: &[bool],
) -> bool {
    let tile_id = layer
        .tiles
        .get(layer.tile_index(column, row))
        .copied()
        .unwrap_or(0);
    tile_id != 0
        && slope_definitions
            .get(tile_id as usize)
            .is_none_or(Option::is_none)
        && !one_way_platform_definitions
            .get(tile_id as usize)
            .copied()
            .unwrap_or(false)
}
