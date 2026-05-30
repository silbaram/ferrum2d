use super::{
    Hd2dRampAxis, Hd2dTileDefinition, Hd2dTileKind, Tilemap, TilemapHd2dSurfaceHit, TilemapLayer,
};
use crate::components::{HeightSpan, PhysicsFloorId, Transform2D};

impl Tilemap {
    pub fn hd2d_surface_at(
        &self,
        point: Transform2D,
        query_height_span: Option<HeightSpan>,
    ) -> Option<TilemapHd2dSurfaceHit> {
        self.hd2d_surface_at_internal(point, query_height_span, true)
    }

    pub(crate) fn hd2d_surface_at_any_floor(
        &self,
        point: Transform2D,
    ) -> Option<TilemapHd2dSurfaceHit> {
        self.hd2d_surface_at_internal(point, None, false)
    }

    fn hd2d_surface_at_internal(
        &self,
        point: Transform2D,
        query_height_span: Option<HeightSpan>,
        filter_floor: bool,
    ) -> Option<TilemapHd2dSurfaceHit> {
        if !point.x.is_finite() || !point.y.is_finite() {
            return None;
        }

        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .rev()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(tile_index) = layer.cell_at(point) else {
                continue;
            };
            let tile_id = layer.tiles.get(tile_index).copied().unwrap_or(0);
            if tile_id == 0 {
                continue;
            }
            let Some(hit) =
                self.hd2d_surface_hit_for_tile(layer_index, layer, tile_index, tile_id, point)
            else {
                continue;
            };
            if filter_floor
                && query_height_span.is_some_and(|query_span| query_span.floor != hit.floor)
            {
                continue;
            }
            return Some(hit);
        }

        None
    }

    fn hd2d_surface_hit_for_tile(
        &self,
        layer_index: usize,
        layer: &TilemapLayer,
        tile_index: usize,
        tile_id: u32,
        point: Transform2D,
    ) -> Option<TilemapHd2dSurfaceHit> {
        let height_span = self
            .height_span_definitions
            .get(tile_id as usize)
            .copied()
            .flatten()
            .unwrap_or_else(default_surface_span);
        let definition = self
            .hd2d_definitions
            .get(tile_id as usize)
            .copied()
            .flatten()
            .unwrap_or_else(default_tile_definition);
        let elevation = surface_elevation(layer, tile_index, point, height_span, definition)?;

        Some(TilemapHd2dSurfaceHit {
            layer_index,
            tile_index,
            tile_id,
            kind: definition.kind,
            floor: height_span.floor,
            elevation,
            height: height_span.height,
            blocks_movement: definition.blocks_movement,
            blocks_projectile: definition.blocks_projectile,
            blocks_vision: definition.blocks_vision,
            occluder_height: definition.occluder_height,
        })
    }
}

fn default_surface_span() -> HeightSpan {
    HeightSpan::new(PhysicsFloorId::DEFAULT, 0.0, HeightSpan::DEFAULT_HEIGHT)
        .expect("default HD-2D surface span is finite and non-negative")
}

fn default_tile_definition() -> Hd2dTileDefinition {
    Hd2dTileDefinition::new(Hd2dTileKind::Flat, true, true, true, 0.0, None)
        .expect("default HD-2D tile definition is valid")
}

fn surface_elevation(
    layer: &TilemapLayer,
    tile_index: usize,
    point: Transform2D,
    height_span: HeightSpan,
    definition: Hd2dTileDefinition,
) -> Option<f32> {
    let Some(ramp) = definition.ramp else {
        return Some(height_span.elevation);
    };
    let row = tile_index as u32 / layer.columns;
    let column = tile_index as u32 % layer.columns;
    let tile_min_x = layer.origin_x + column as f32 * layer.tile_width;
    let tile_min_y = layer.origin_y + row as f32 * layer.tile_height;
    let t = match ramp.axis {
        Hd2dRampAxis::X => {
            if layer.tile_width <= 0.0 {
                return None;
            }
            (point.x - tile_min_x) / layer.tile_width
        }
        Hd2dRampAxis::Y => {
            if layer.tile_height <= 0.0 {
                return None;
            }
            (point.y - tile_min_y) / layer.tile_height
        }
    }
    .clamp(0.0, 1.0);
    let elevation = ramp.start_elevation + (ramp.end_elevation - ramp.start_elevation) * t;
    elevation.is_finite().then_some(elevation)
}
