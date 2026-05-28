use super::collision_cache::{
    chunk_range_for_tile_range, TileCollisionChunkCache, TileCollisionRect,
};
use super::{TileRange, Tilemap};

impl Tilemap {
    pub(super) fn visit_collision_rect_candidates(
        &self,
        layer_index: usize,
        range: TileRange,
        visit: impl FnMut(TileCollisionRect) -> bool,
    ) {
        let cache = self
            .collision_rect_chunks
            .get(layer_index)
            .and_then(Option::as_ref);
        let fallback_rects = self
            .collision_rects
            .get(layer_index)
            .and_then(Option::as_ref)
            .map(Vec::as_slice);
        visit_rect_candidates(cache, fallback_rects, range, visit);
    }

    pub(super) fn collect_collision_rect_candidates_in_tile_order(
        &self,
        layer_index: usize,
        range: TileRange,
        output: &mut Vec<TileCollisionRect>,
    ) {
        output.clear();
        self.visit_collision_rect_candidates(layer_index, range, |rect| {
            output.push(rect);
            true
        });
        if output.len() > 1 {
            output.sort_by_key(|rect| rect.tile_index);
        }
    }
}

fn visit_rect_candidates(
    cache: Option<&TileCollisionChunkCache>,
    fallback_rects: Option<&[TileCollisionRect]>,
    range: TileRange,
    mut visit: impl FnMut(TileCollisionRect) -> bool,
) {
    if let Some(cache) = cache {
        let chunk_range = chunk_range_for_tile_range(range, cache);
        for chunk_row in chunk_range.min_row..=chunk_range.max_row {
            for chunk_column in chunk_range.min_column..=chunk_range.max_column {
                let chunk_index = cache.chunk_index(chunk_column, chunk_row);
                let Some(chunk) = cache.chunks.get(chunk_index) else {
                    continue;
                };
                for rect in chunk
                    .iter()
                    .copied()
                    .filter(|rect| rect.intersects_tile_range(range))
                {
                    if !visit(rect) {
                        return;
                    }
                }
            }
        }
        return;
    }

    if let Some(rects) = fallback_rects {
        for rect in rects
            .iter()
            .copied()
            .filter(|rect| rect.intersects_tile_range(range))
        {
            if !visit(rect) {
                return;
            }
        }
    }
}
