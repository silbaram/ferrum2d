//! Read-only authored terrain view shared with the native physics adapter.
use super::{Hd2dTileDefinition, TileSlopeDefinition, Tilemap};
use crate::components::HeightSpan;

#[derive(Debug, Clone, Copy)]
pub(crate) struct TerrainTile {
    pub layer: u32,
    pub tile: u32,
    pub columns: u32,
    pub bounds: [f32; 4],
    pub span: Option<HeightSpan>,
    pub slope: Option<TileSlopeDefinition>,
    pub one_way: bool,
    pub hd: Option<Hd2dTileDefinition>,
}

impl Tilemap {
    pub(crate) fn replace_collision_data(&mut self, mut candidate: Self) -> bool {
        let Some(revision) = self.physics_revision.checked_add(1) else {
            return false;
        };
        candidate.physics_revision = revision;
        *self = candidate;
        true
    }

    pub(crate) fn physics_revision(&self) -> u64 {
        self.physics_revision
    }

    pub(crate) fn terrain_tiles(&self) -> impl Iterator<Item = TerrainTile> + '_ {
        self.layers
            .iter()
            .enumerate()
            .filter_map(|(index, layer)| {
                layer
                    .as_ref()
                    .filter(|layer| layer.collision)
                    .map(|layer| (index, layer))
            })
            .flat_map(move |(index, layer)| {
                layer
                    .tiles
                    .iter()
                    .enumerate()
                    .filter_map(move |(tile, &id)| {
                        if id == 0 {
                            return None;
                        }
                        let id = id as usize;
                        let col = tile as u32 % layer.columns;
                        let row = tile as u32 / layer.columns;
                        Some(TerrainTile {
                            layer: index as u32,
                            tile: tile as u32,
                            columns: layer.columns,
                            bounds: [
                                layer.origin_x + col as f32 * layer.tile_width,
                                layer.origin_y + row as f32 * layer.tile_height,
                                layer.tile_width,
                                layer.tile_height,
                            ],
                            span: self.height_span_definitions.get(id).copied().flatten(),
                            slope: self.slope_definitions.get(id).copied().flatten(),
                            one_way: self
                                .one_way_platform_definitions
                                .get(id)
                                .copied()
                                .unwrap_or(false),
                            hd: self.hd2d_definitions.get(id).copied().flatten(),
                        })
                    })
            })
    }
}
