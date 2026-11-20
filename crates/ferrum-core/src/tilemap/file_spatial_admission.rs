//! Borrow/Copy projections for the spatial owner's cold source/cache checks.
//! No allocation, simulation, rebuild, mutation or public consumer API.
use super::*;
impl Tilemap {
    pub(crate) fn file_spatial_sizes(&self) -> ([usize; 9], bool) {
        (
            [
                self.definitions.len(),
                self.slope_definitions.len(),
                self.one_way_platform_definitions.len(),
                self.height_span_definitions.len(),
                self.hd2d_definitions.len(),
                self.bridge_portal_definitions.len(),
                self.layers.len(),
                self.collision_rects.len(),
                self.collision_rect_chunks.len(),
            ],
            self.half_open_hd2d_surfaces,
        )
    }
    pub(crate) fn file_spatial_layer(&self, index: usize) -> Option<(&TilemapLayer, bool)> {
        self.layers
            .get(index)?
            .as_ref()
            .map(|v| (v, v.navigation_costs.as_slice() == [0]))
    }
    pub(crate) fn file_spatial_definition(
        &self,
        tile: usize,
    ) -> (
        Option<TileDefinition>,
        Option<HeightSpan>,
        Option<Hd2dTileDefinition>,
    ) {
        (
            self.definitions.get(tile).copied().flatten(),
            self.height_span_definitions.get(tile).copied().flatten(),
            self.hd2d_definitions.get(tile).copied().flatten(),
        )
    }
}
