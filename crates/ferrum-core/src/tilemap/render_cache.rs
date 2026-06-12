use super::{TileDefinition, TileRange, TilemapLayer, TILE_RENDER_CHUNK_SIZE};
use crate::render_command::{SpriteRenderCommand, SPRITE_EFFECT_NONE};

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct TileRenderChunkCache {
    pub(super) chunk_columns: u32,
    pub(super) chunk_rows: u32,
    pub(super) chunks: Vec<TileRenderChunk>,
    pub(super) last_rebuilt_chunks: u32,
    pub(super) total_rebuilt_chunks: u32,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct TileRenderChunk {
    pub(super) range: TileRange,
    pub(super) commands: Vec<SpriteRenderCommand>,
}

impl TileRenderChunkCache {
    pub(super) fn new(chunk_columns: u32, chunk_rows: u32) -> Self {
        let chunk_count = (chunk_columns as usize).saturating_mul(chunk_rows as usize);
        Self {
            chunk_columns,
            chunk_rows,
            chunks: vec![TileRenderChunk::default(); chunk_count],
            last_rebuilt_chunks: 0,
            total_rebuilt_chunks: 0,
        }
    }

    pub(super) fn chunk_index(&self, chunk_column: u32, chunk_row: u32) -> usize {
        (chunk_row * self.chunk_columns + chunk_column) as usize
    }
}

pub(super) fn build_render_chunk_cache_for_layer(
    layer: &TilemapLayer,
    definitions: &[Option<TileDefinition>],
) -> TileRenderChunkCache {
    let chunk_columns = render_chunk_count(layer.columns);
    let chunk_rows = render_chunk_count(layer.rows);
    let mut cache = TileRenderChunkCache::new(chunk_columns, chunk_rows);

    for chunk_row in 0..chunk_rows {
        for chunk_column in 0..chunk_columns {
            let chunk_index = cache.chunk_index(chunk_column, chunk_row);
            let range = tile_range_for_render_chunk(layer, chunk_column, chunk_row);
            cache.chunks[chunk_index] = TileRenderChunk {
                range,
                commands: build_render_commands_for_layer_range(layer, definitions, range),
            };
        }
    }

    let rebuilt_count = chunk_columns.saturating_mul(chunk_rows);
    cache.last_rebuilt_chunks = rebuilt_count;
    cache.total_rebuilt_chunks = rebuilt_count;
    cache
}

pub(super) fn rebuild_render_chunks_for_layer_range(
    layer: &TilemapLayer,
    definitions: &[Option<TileDefinition>],
    changed_range: TileRange,
    cache: &mut TileRenderChunkCache,
) -> u32 {
    let chunk_range = render_chunk_range_for_tile_range(changed_range, cache);
    let mut rebuilt_count = 0;
    for chunk_row in chunk_range.min_row..=chunk_range.max_row {
        for chunk_column in chunk_range.min_column..=chunk_range.max_column {
            let chunk_index = cache.chunk_index(chunk_column, chunk_row);
            let range = tile_range_for_render_chunk(layer, chunk_column, chunk_row);
            if let Some(chunk) = cache.chunks.get_mut(chunk_index) {
                chunk.range = range;
                chunk.commands = build_render_commands_for_layer_range(layer, definitions, range);
                rebuilt_count += 1;
            }
        }
    }
    cache.last_rebuilt_chunks = rebuilt_count;
    cache.total_rebuilt_chunks = cache.total_rebuilt_chunks.saturating_add(rebuilt_count);
    rebuilt_count
}

pub(super) fn rebuild_render_chunks_for_layer_tile_id(
    layer: &TilemapLayer,
    definitions: &[Option<TileDefinition>],
    tile_id: u32,
    cache: &mut TileRenderChunkCache,
) -> u32 {
    if tile_id == 0 {
        cache.last_rebuilt_chunks = 0;
        return 0;
    }

    let mut rebuilt_count = 0;
    for chunk_row in 0..cache.chunk_rows {
        for chunk_column in 0..cache.chunk_columns {
            let range = tile_range_for_render_chunk(layer, chunk_column, chunk_row);
            if !layer_range_contains_tile_id(layer, range, tile_id) {
                continue;
            }
            let chunk_index = cache.chunk_index(chunk_column, chunk_row);
            if let Some(chunk) = cache.chunks.get_mut(chunk_index) {
                chunk.range = range;
                chunk.commands = build_render_commands_for_layer_range(layer, definitions, range);
                rebuilt_count += 1;
            }
        }
    }
    cache.last_rebuilt_chunks = rebuilt_count;
    cache.total_rebuilt_chunks = cache.total_rebuilt_chunks.saturating_add(rebuilt_count);
    rebuilt_count
}

pub(super) fn render_chunk_count(tile_count: u32) -> u32 {
    tile_count.div_ceil(TILE_RENDER_CHUNK_SIZE).max(1)
}

pub(super) fn render_chunk_range_for_tile_range(
    range: TileRange,
    cache: &TileRenderChunkCache,
) -> TileRange {
    TileRange {
        min_column: (range.min_column / TILE_RENDER_CHUNK_SIZE).min(cache.chunk_columns - 1),
        max_column: (range.max_column / TILE_RENDER_CHUNK_SIZE).min(cache.chunk_columns - 1),
        min_row: (range.min_row / TILE_RENDER_CHUNK_SIZE).min(cache.chunk_rows - 1),
        max_row: (range.max_row / TILE_RENDER_CHUNK_SIZE).min(cache.chunk_rows - 1),
    }
}

fn tile_range_for_render_chunk(
    layer: &TilemapLayer,
    chunk_column: u32,
    chunk_row: u32,
) -> TileRange {
    let min_column = chunk_column * TILE_RENDER_CHUNK_SIZE;
    let min_row = chunk_row * TILE_RENDER_CHUNK_SIZE;
    TileRange {
        min_column,
        max_column: (min_column + TILE_RENDER_CHUNK_SIZE - 1).min(layer.columns - 1),
        min_row,
        max_row: (min_row + TILE_RENDER_CHUNK_SIZE - 1).min(layer.rows - 1),
    }
}

fn build_render_commands_for_layer_range(
    layer: &TilemapLayer,
    definitions: &[Option<TileDefinition>],
    range: TileRange,
) -> Vec<SpriteRenderCommand> {
    let capacity = (range.max_column - range.min_column + 1)
        .saturating_mul(range.max_row - range.min_row + 1) as usize;
    let mut commands = Vec::with_capacity(capacity);
    for row in range.min_row..=range.max_row {
        for column in range.min_column..=range.max_column {
            let tile_index = layer.tile_index(column, row);
            let Some(tile_id) = layer.tiles.get(tile_index).copied() else {
                continue;
            };
            if tile_id == 0 {
                continue;
            }
            let Some(definition) = definitions
                .get(tile_id as usize)
                .and_then(|definition| *definition)
            else {
                continue;
            };
            let (u0, v0, u1, v1) = definition.frame.uv();
            commands.push(SpriteRenderCommand {
                x: layer.origin_x + column as f32 * layer.tile_width,
                y: layer.origin_y + row as f32 * layer.tile_height,
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
    bucket_commands_by_texture(&mut commands);
    commands
}

fn layer_range_contains_tile_id(layer: &TilemapLayer, range: TileRange, tile_id: u32) -> bool {
    for row in range.min_row..=range.max_row {
        let row_start = layer.tile_index(range.min_column, row);
        let row_end = layer.tile_index(range.max_column, row) + 1;
        if layer.tiles[row_start..row_end].contains(&tile_id) {
            return true;
        }
    }
    false
}

fn bucket_commands_by_texture(commands: &mut [SpriteRenderCommand]) {
    if commands.len() < 2
        || commands
            .windows(2)
            .all(|pair| pair[0].texture_id <= pair[1].texture_id)
    {
        return;
    }
    commands.sort_unstable_by(|left, right| left.texture_id.total_cmp(&right.texture_id));
}
