use super::queries::tile_axis_index;
use super::{
    Hd2dRampAxis, Hd2dTileDefinition, Hd2dTileKind, Tilemap, TilemapHd2dSurfaceHit, TilemapLayer,
};
use crate::collision::AabbBounds;
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

    pub(crate) fn hd2d_bridge_surface_along_segment(
        &self,
        start: Transform2D,
        end: Transform2D,
        reference_floor: PhysicsFloorId,
    ) -> Option<TilemapHd2dSurfaceHit> {
        for (layer_index, layer) in self
            .layers
            .iter()
            .enumerate()
            .rev()
            .filter_map(|(index, layer)| layer.as_ref().map(|layer| (index, layer)))
            .filter(|(_, layer)| layer.collision)
        {
            let Some(surface) = self.hd2d_bridge_surface_along_layer_segment(
                layer_index,
                layer,
                start,
                end,
                reference_floor,
            ) else {
                continue;
            };
            return Some(surface);
        }
        None
    }

    fn hd2d_bridge_surface_along_layer_segment(
        &self,
        layer_index: usize,
        layer: &TilemapLayer,
        start: Transform2D,
        end: Transform2D,
        reference_floor: PhysicsFloorId,
    ) -> Option<TilemapHd2dSurfaceHit> {
        let (t_min, t_max) = segment_layer_interval(start, end, layer)?;
        let dx = end.x - start.x;
        let dy = end.y - start.y;
        let start_t = nudge_segment_t(t_min, t_max);
        let end_t = nudge_segment_t(t_max, t_min);
        let mut column = tile_axis_index(
            start.x + dx * start_t,
            layer.origin_x,
            layer.tile_width,
            layer.columns - 1,
        ) as i32;
        let mut row = tile_axis_index(
            start.y + dy * start_t,
            layer.origin_y,
            layer.tile_height,
            layer.rows - 1,
        ) as i32;
        let end_column = tile_axis_index(
            start.x + dx * end_t,
            layer.origin_x,
            layer.tile_width,
            layer.columns - 1,
        ) as i32;
        let end_row = tile_axis_index(
            start.y + dy * end_t,
            layer.origin_y,
            layer.tile_height,
            layer.rows - 1,
        ) as i32;

        let step_column = axis_step(dx);
        let step_row = axis_step(dy);
        let mut next_column_t = next_axis_boundary_t(
            start.x,
            dx,
            layer.origin_x,
            layer.tile_width,
            column,
            step_column,
        );
        let mut next_row_t = next_axis_boundary_t(
            start.y,
            dy,
            layer.origin_y,
            layer.tile_height,
            row,
            step_row,
        );
        let column_t_delta = axis_t_delta(dx, layer.tile_width);
        let row_t_delta = axis_t_delta(dy, layer.tile_height);
        let max_steps = layer.columns as usize + layer.rows as usize + 1;

        for _ in 0..max_steps {
            if column < 0 || row < 0 || column >= layer.columns as i32 || row >= layer.rows as i32 {
                return None;
            }
            if let Some(surface) = self.hd2d_bridge_surface_for_tile(
                layer_index,
                layer,
                column as u32,
                row as u32,
                reference_floor,
            ) {
                return Some(surface);
            }
            if column == end_column && row == end_row {
                return None;
            }

            if next_column_t < next_row_t {
                if next_column_t > t_max {
                    return None;
                }
                column += step_column;
                next_column_t += column_t_delta;
            } else if next_row_t < next_column_t {
                if next_row_t > t_max {
                    return None;
                }
                row += step_row;
                next_row_t += row_t_delta;
            } else {
                if next_column_t > t_max {
                    return None;
                }
                column += step_column;
                row += step_row;
                next_column_t += column_t_delta;
                next_row_t += row_t_delta;
            }
        }

        None
    }

    fn hd2d_bridge_surface_for_tile(
        &self,
        layer_index: usize,
        layer: &TilemapLayer,
        column: u32,
        row: u32,
        reference_floor: PhysicsFloorId,
    ) -> Option<TilemapHd2dSurfaceHit> {
        let tile_index = layer.tile_index(column, row);
        let tile_id = layer.tiles.get(tile_index).copied().unwrap_or(0);
        if tile_id == 0 {
            return None;
        }
        let surface = self.hd2d_surface_hit_for_tile(
            layer_index,
            layer,
            tile_index,
            tile_id,
            layer.tile_center(tile_index),
        )?;
        (surface.kind == Hd2dTileKind::Bridge
            && !surface.blocks_movement
            && surface.floor != reference_floor)
            .then_some(surface)
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

const SEGMENT_T_NUDGE: f32 = 0.000_001;

fn segment_layer_interval(
    start: Transform2D,
    end: Transform2D,
    layer: &TilemapLayer,
) -> Option<(f32, f32)> {
    if !start.x.is_finite() || !start.y.is_finite() || !end.x.is_finite() || !end.y.is_finite() {
        return None;
    }
    let bounds = AabbBounds {
        min_x: layer.origin_x,
        min_y: layer.origin_y,
        max_x: layer.origin_x + layer.columns as f32 * layer.tile_width,
        max_y: layer.origin_y + layer.rows as f32 * layer.tile_height,
    };
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let mut t_min = 0.0;
    let mut t_max = 1.0;
    if !segment_axis_intersects(
        start.x,
        dx,
        bounds.min_x,
        bounds.max_x,
        &mut t_min,
        &mut t_max,
    ) || !segment_axis_intersects(
        start.y,
        dy,
        bounds.min_y,
        bounds.max_y,
        &mut t_min,
        &mut t_max,
    ) {
        return None;
    }
    Some((t_min, t_max))
}

fn nudge_segment_t(t: f32, toward: f32) -> f32 {
    if t < toward {
        (t + SEGMENT_T_NUDGE).min(toward)
    } else if t > toward {
        (t - SEGMENT_T_NUDGE).max(toward)
    } else {
        t
    }
}

fn axis_step(delta: f32) -> i32 {
    if delta > f32::EPSILON {
        1
    } else if delta < -f32::EPSILON {
        -1
    } else {
        0
    }
}

fn next_axis_boundary_t(
    origin: f32,
    delta: f32,
    layer_origin: f32,
    tile_size: f32,
    index: i32,
    step: i32,
) -> f32 {
    if step == 0 {
        return f32::INFINITY;
    }
    let boundary_index = if step > 0 { index + 1 } else { index };
    let boundary = layer_origin + boundary_index as f32 * tile_size;
    let t = (boundary - origin) / delta;
    if t.is_finite() {
        t
    } else {
        f32::INFINITY
    }
}

fn axis_t_delta(delta: f32, tile_size: f32) -> f32 {
    if delta.abs() <= f32::EPSILON {
        f32::INFINITY
    } else {
        tile_size / delta.abs()
    }
}

fn segment_axis_intersects(
    origin: f32,
    delta: f32,
    min: f32,
    max: f32,
    t_min: &mut f32,
    t_max: &mut f32,
) -> bool {
    if delta.abs() <= f32::EPSILON {
        return origin >= min && origin <= max;
    }

    let inv_delta = 1.0 / delta;
    let mut axis_min = (min - origin) * inv_delta;
    let mut axis_max = (max - origin) * inv_delta;
    if axis_min > axis_max {
        core::mem::swap(&mut axis_min, &mut axis_max);
    }
    *t_min = (*t_min).max(axis_min);
    *t_max = (*t_max).min(axis_max);
    *t_min <= *t_max
}
