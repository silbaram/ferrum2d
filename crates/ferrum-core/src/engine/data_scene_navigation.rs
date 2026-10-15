use super::scenes::SceneMode;
use super::Engine;
use crate::collision::{collider_bounds, collider_segment_count_at, collider_shape_at_segment};
use crate::entity::Entity;
use crate::tilemap::Tilemap;
use crate::world::World;
use std::collections::HashSet;
use wasm_bindgen::prelude::*;

#[derive(Default)]
pub(super) struct NavigationObstacles {
    columns: u32,
    rows: u32,
    base_costs: Vec<u32>,
    blockers: Vec<u32>,
    bindings: Vec<NavigationObstacle>,
    geometry: GridGeometry,
}

#[derive(Clone, Copy, Default)]
struct GridGeometry {
    columns: u32,
    rows: u32,
    cell_width: f32,
    cell_height: f32,
    origin_x: f32,
    origin_y: f32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct CellRectangle {
    first_column: u32,
    last_column: u32,
    first_row: u32,
    last_row: u32,
}

struct NavigationObstacle {
    entity: Entity,
    cells: Vec<usize>,
    active: bool,
    automatic: bool,
    rectangle: Option<CellRectangle>,
}

impl NavigationObstacles {
    // Check only explicitly bound handles. No per-frame allocation or world scan.
    pub(super) fn synchronize(&mut self, world: &World, grid: &mut Tilemap) -> bool {
        let mut changed = false;
        for binding in &mut self.bindings {
            let active = world.is_current_entity(binding.entity)
                && world.compound_collider_count(binding.entity) == 1
                && world
                    .rigid_body(binding.entity)
                    .is_none_or(|body| body.enabled)
                && world
                    .compound_collider_ref_at(binding.entity.id as usize, 0)
                    .is_some_and(|collider| collider.enabled() && !collider.is_trigger());
            let rectangle = if active && binding.automatic {
                collider_rectangle(world, binding.entity, self.geometry)
            } else {
                None
            };
            if active == binding.active && rectangle == binding.rectangle {
                continue;
            }
            if binding.active {
                changed |= update_coverage(
                    binding,
                    false,
                    &mut self.blockers,
                    &self.base_costs,
                    grid,
                    self.columns,
                );
            }
            binding.active = active;
            binding.rectangle = rectangle;
            if active {
                changed |= update_coverage(
                    binding,
                    true,
                    &mut self.blockers,
                    &self.base_costs,
                    grid,
                    self.columns,
                );
            }
        }
        changed
    }

    pub(super) fn snapshot(&self) -> Vec<u32> {
        let mut result = Vec::new();
        for binding in &self.bindings {
            result.extend([
                binding.entity.id,
                binding.entity.generation,
                binding.cells.len() as u32,
            ]);
            for &cell in &binding.cells {
                result.extend([cell as u32 % self.columns, cell as u32 / self.columns]);
            }
        }
        result
    }

    pub(super) fn snapshot_costs(&self, snapshot: &mut [f64]) {
        for (value, cost) in snapshot.iter_mut().skip(6).zip(&self.base_costs) {
            *value = f64::from(*cost);
        }
    }
}

impl Engine {
    pub(super) fn synchronize_data_scene_navigation(&mut self) {
        if self.scene_mode == SceneMode::Data
            && self
                .data_scene
                .navigation_obstacles
                .synchronize(&self.world, &mut self.data_scene.navigation)
        {
            self.data_scene.movement.invalidate_route();
            self.frame_buffers.clear_tilemap_navigation_output();
        }
    }
}

#[wasm_bindgen]
impl Engine {
    /// Replaces the scene-owned XY navigation grid. 0 blocks a cell; positive costs are walkable.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_navigation(
        &mut self,
        columns: u32,
        rows: u32,
        cell_width: f32,
        cell_height: f32,
        origin_x: f32,
        origin_y: f32,
        costs: &[u32],
    ) -> bool {
        let cells = u64::from(columns) * u64::from(rows);
        if self.scene_mode != SceneMode::Data
            || cells == 0
            || cells > 4096
            || costs.len() as u64 != cells
            || costs.iter().any(|cost| *cost > 65535)
            || !cell_width.is_finite()
            || cell_width <= 0.0
            || !cell_height.is_finite()
            || cell_height <= 0.0
            || !origin_x.is_finite()
            || !origin_y.is_finite()
            || !(origin_x + columns as f32 * cell_width).is_finite()
            || !(origin_y + rows as f32 * cell_height).is_finite()
        {
            return false;
        }
        let mut grid = Tilemap::default();
        grid.set_layer(
            0,
            columns,
            rows,
            cell_width,
            cell_height,
            origin_x,
            origin_y,
            true,
            costs.iter().map(|cost| u32::from(*cost == 0)).collect(),
        );
        for (index, cost) in costs.iter().copied().enumerate() {
            grid.set_navigation_cost(0, index as u32 % columns, index as u32 / columns, cost);
        }
        self.data_scene.navigation = grid;
        self.data_scene.navigation_obstacles = NavigationObstacles {
            columns,
            rows,
            base_costs: costs.to_vec(),
            blockers: vec![0; costs.len()],
            bindings: Vec::new(),
            geometry: GridGeometry {
                columns,
                rows,
                cell_width,
                cell_height,
                origin_x,
                origin_y,
            },
        };
        self.data_scene.movement.invalidate_route();
        self.frame_buffers.clear_tilemap_navigation_output();
        true
    }

    /// Changes a terrain cost; active obstacle bindings continue to block the cell.
    pub fn set_data_scene_navigation_cost(&mut self, column: u32, row: u32, cost: u32) -> bool {
        if self.scene_mode != SceneMode::Data || cost > 65535 {
            return false;
        }
        let obstacles = &mut self.data_scene.navigation_obstacles;
        if column >= obstacles.columns || row >= obstacles.rows {
            return false;
        }
        let index = (row * obstacles.columns + column) as usize;
        if obstacles.base_costs[index] == cost {
            return false;
        }
        obstacles.base_costs[index] = cost;
        let effective = if obstacles.blockers[index] == 0 {
            cost
        } else {
            0
        };
        let grid = &mut self.data_scene.navigation;
        let tile_changed = grid.set_tile(0, column, row, u32::from(effective == 0));
        let cost_changed = grid.set_navigation_cost(0, column, row, effective);
        if tile_changed || cost_changed {
            self.data_scene.movement.invalidate_route();
            self.frame_buffers.clear_tilemap_navigation_output();
        }
        true
    }

    /// Replaces explicit collider-to-cell bindings in one validated cold-path batch.
    /// Records are id, generation, cell count, then (column, row) pairs. Count 0 derives live collider bounds; empty clears bindings.
    pub fn configure_data_scene_navigation_obstacles(&mut self, values: &[u32]) -> bool {
        let state = &self.data_scene.navigation_obstacles;
        if self.scene_mode != SceneMode::Data || state.base_costs.is_empty() || values.len() > 20480
        {
            return false;
        }
        let Some(bindings) = resolve_obstacles(&self.world, state.columns, state.rows, values)
        else {
            return false;
        };
        let state = &mut self.data_scene.navigation_obstacles;
        // Remove the old overlay, preserving user terrain edits and overlapping bindings.
        for (cell, count) in state.blockers.iter_mut().enumerate() {
            if *count != 0 {
                *count = 0;
                let cost = state.base_costs[cell];
                self.data_scene.navigation.set_tile(
                    0,
                    cell as u32 % state.columns,
                    cell as u32 / state.columns,
                    u32::from(cost == 0),
                );
                self.data_scene.navigation.set_navigation_cost(
                    0,
                    cell as u32 % state.columns,
                    cell as u32 / state.columns,
                    cost,
                );
            }
        }
        state.bindings = bindings;
        state.synchronize(&self.world, &mut self.data_scene.navigation);
        self.data_scene.movement.invalidate_route();
        self.frame_buffers.clear_tilemap_navigation_output();
        true
    }

    /// Atomically replaces terrain and collider bindings; invalid input preserves the old route/grid.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_data_scene_navigation_with_obstacles(
        &mut self,
        columns: u32,
        rows: u32,
        cell_width: f32,
        cell_height: f32,
        origin_x: f32,
        origin_y: f32,
        costs: &[u32],
        values: &[u32],
    ) -> bool {
        let Some(bindings) = resolve_obstacles(&self.world, columns, rows, values) else {
            return false;
        };
        if !self.configure_data_scene_navigation(
            columns,
            rows,
            cell_width,
            cell_height,
            origin_x,
            origin_y,
            costs,
        ) {
            return false;
        }
        self.data_scene.navigation_obstacles.bindings = bindings;
        self.synchronize_data_scene_navigation();
        true
    }

    /// Captures bindings, including original generations of removed obstacles.
    pub fn capture_data_scene_navigation_obstacles(&self) -> Vec<u32> {
        if self.scene_mode != SceneMode::Data {
            return Vec::new();
        }
        self.data_scene.navigation_obstacles.snapshot()
    }

    /// Clears only Data Scene navigation; unsupported scenes are left untouched.
    pub fn clear_data_scene_navigation(&mut self) -> bool {
        if self.scene_mode != SceneMode::Data {
            return false;
        }
        self.data_scene.navigation.clear();
        self.data_scene.navigation_obstacles = NavigationObstacles::default();
        self.data_scene.movement.invalidate_route();
        self.frame_buffers.clear_tilemap_navigation_output();
        true
    }
}

fn resolve_obstacles(
    world: &World,
    columns: u32,
    rows: u32,
    values: &[u32],
) -> Option<Vec<NavigationObstacle>> {
    if columns == 0
        || rows == 0
        || u64::from(columns) * u64::from(rows) > 4096
        || values.len() > 20480
    {
        return None;
    }
    let mut remaining = values;
    let mut bindings = Vec::new();
    let mut seen = HashSet::new();
    let mut total = 0;
    let mut automatic_count = 0;
    while !remaining.is_empty() {
        if remaining.len() < 3 {
            return None;
        }
        let entity = Entity {
            id: remaining[0],
            generation: remaining[1],
        };
        let count = remaining[2] as usize;
        if count.max(1) > 4096 - total
            || count > (remaining.len() - 3) / 2
            || !seen.insert(entity.id)
            || !world.is_current_entity(entity)
            || world.compound_collider_count(entity) != 1
        {
            return None;
        }
        if count == 0 {
            automatic_count += 1;
            if automatic_count > 64 || world.transform(entity).is_none() {
                return None;
            }
        }
        total += count.max(1);
        let mut cells = Vec::with_capacity(count);
        let mut unique = HashSet::with_capacity(count);
        for pair in remaining[3..3 + count * 2].chunks_exact(2) {
            if pair[0] >= columns || pair[1] >= rows {
                return None;
            }
            let cell = (pair[1] * columns + pair[0]) as usize;
            if !unique.insert(cell) {
                return None;
            }
            cells.push(cell);
        }
        bindings.push(NavigationObstacle {
            entity,
            cells,
            active: false,
            automatic: count == 0,
            rectangle: None,
        });
        remaining = &remaining[3 + count * 2..];
    }
    Some(bindings)
}

fn update_coverage(
    binding: &NavigationObstacle,
    add: bool,
    blockers: &mut [u32],
    costs: &[u32],
    grid: &mut Tilemap,
    columns: u32,
) -> bool {
    let mut changed = false;
    let mut apply = |cell: usize| {
        if add {
            blockers[cell] += 1;
        } else {
            blockers[cell] -= 1;
        }
        let cost = if blockers[cell] == 0 { costs[cell] } else { 0 };
        changed |= grid.set_tile(
            0,
            cell as u32 % columns,
            cell as u32 / columns,
            u32::from(cost == 0),
        );
        changed |= grid.set_navigation_cost(0, cell as u32 % columns, cell as u32 / columns, cost);
    };
    if binding.automatic {
        if let Some(rectangle) = binding.rectangle {
            for row in rectangle.first_row..=rectangle.last_row {
                for column in rectangle.first_column..=rectangle.last_column {
                    apply((row * columns + column) as usize);
                }
            }
        }
    } else {
        for &cell in &binding.cells {
            apply(cell);
        }
    }
    changed
}

// Conservative XY bounds, including collider offsets/rotation and all chain segments.
// Cell boundary contact alone does not block a neighboring cell. No heap allocation.
fn collider_rectangle(world: &World, entity: Entity, grid: GridGeometry) -> Option<CellRectangle> {
    let transform = world.transform(entity)?;
    let index = entity.id as usize;
    let mut bounds: Option<crate::collision::AabbBounds> = None;
    for segment in 0..collider_segment_count_at(world, index, 0) {
        let shape = collider_shape_at_segment(world, index, 0, segment)?;
        let next = collider_bounds(transform, shape);
        bounds = Some(match bounds {
            None => next,
            Some(old) => crate::collision::AabbBounds {
                min_x: old.min_x.min(next.min_x),
                min_y: old.min_y.min(next.min_y),
                max_x: old.max_x.max(next.max_x),
                max_y: old.max_y.max(next.max_y),
            },
        });
    }
    let bounds = bounds?;
    let axis =
        |minimum: f32, maximum: f32, origin: f32, size: f32, count: u32| -> Option<(u32, u32)> {
            if !minimum.is_finite() || !maximum.is_finite() || maximum <= minimum {
                return None;
            }
            let first = ((f64::from(minimum) - f64::from(origin)) / f64::from(size)).floor();
            let last = ((f64::from(maximum) - f64::from(origin)) / f64::from(size)).ceil() - 1.0;
            if last < 0.0 || first >= f64::from(count) {
                return None;
            }
            Some((first.max(0.0) as u32, last.min(f64::from(count - 1)) as u32))
        };
    let (first_column, last_column) = axis(
        bounds.min_x,
        bounds.max_x,
        grid.origin_x,
        grid.cell_width,
        grid.columns,
    )?;
    let (first_row, last_row) = axis(
        bounds.min_y,
        bounds.max_y,
        grid.origin_y,
        grid.cell_height,
        grid.rows,
    )?;
    Some(CellRectangle {
        first_column,
        last_column,
        first_row,
        last_row,
    })
}
