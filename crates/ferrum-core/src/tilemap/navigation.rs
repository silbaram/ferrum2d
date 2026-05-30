use std::cmp::Ordering;
use std::collections::BinaryHeap;

use super::queries::{tile_id_blocks_movement, tile_id_height_span_allows};
use super::{
    Hd2dBridgePortalDefinition, Hd2dTileDefinition, Tilemap, TilemapLayer,
    TilemapNavigationPathPoint, DEFAULT_NAVIGATION_COST, MAX_NAVIGATION_CELLS, UNVISITED_CELL,
};
use crate::components::{HeightSpan, PhysicsFloorId, Transform2D};

#[derive(Debug, Default)]
pub(crate) struct TilemapNavigationScratch {
    pub(super) came_from: Vec<usize>,
    pub(super) g_scores: Vec<u32>,
    pub(super) visited: Vec<usize>,
    pub(super) open: BinaryHeap<PathNode>,
    pub(super) path_cells: Vec<usize>,
    pub(super) path_points: Vec<Transform2D>,
    pub(super) path_hd2d_points: Vec<TilemapNavigationPathPoint>,
    pub(super) navigation_floor_ids: Vec<PhysicsFloorId>,
}

impl TilemapNavigationScratch {
    pub(super) fn prepare(&mut self, cell_count: usize) {
        self.clear_dirty();
        self.path_cells.clear();
        self.path_points.clear();
        self.path_hd2d_points.clear();
        if self.came_from.len() < cell_count {
            self.came_from.resize(cell_count, UNVISITED_CELL);
        }
        if self.g_scores.len() < cell_count {
            self.g_scores.resize(cell_count, u32::MAX);
        }
    }

    pub(super) fn set_score(&mut self, cell: usize, previous: usize, g_score: u32) {
        if self.g_scores[cell] == u32::MAX {
            self.visited.push(cell);
        }
        self.came_from[cell] = previous;
        self.g_scores[cell] = g_score;
    }

    pub(super) fn clear_dirty(&mut self) {
        for cell in self.visited.drain(..) {
            if cell < self.came_from.len() {
                self.came_from[cell] = UNVISITED_CELL;
            }
            if cell < self.g_scores.len() {
                self.g_scores[cell] = u32::MAX;
            }
        }
        self.open.clear();
    }
}

impl Tilemap {
    pub fn navigation_waypoint(&self, from: Transform2D, to: Transform2D) -> Option<Transform2D> {
        let mut scratch = TilemapNavigationScratch::default();
        self.navigation_waypoint_with_scratch(from, to, &mut scratch)
    }

    pub fn navigation_waypoint_with_height_span(
        &self,
        from: Transform2D,
        to: Transform2D,
        height_span: HeightSpan,
    ) -> Option<Transform2D> {
        let mut scratch = TilemapNavigationScratch::default();
        self.navigation_waypoint_with_height_span_scratch(from, to, height_span, &mut scratch)
    }

    pub fn navigation_path(&self, from: Transform2D, to: Transform2D) -> Option<Vec<Transform2D>> {
        let mut scratch = TilemapNavigationScratch::default();
        self.navigation_path_with_scratch(from, to, &mut scratch)
            .map(ToOwned::to_owned)
    }

    pub fn navigation_path_with_height_span(
        &self,
        from: Transform2D,
        to: Transform2D,
        height_span: HeightSpan,
    ) -> Option<Vec<Transform2D>> {
        let mut scratch = TilemapNavigationScratch::default();
        self.navigation_path_with_height_span_scratch(from, to, height_span, &mut scratch)
            .map(ToOwned::to_owned)
    }

    pub fn navigation_path_between_height_spans(
        &self,
        from: Transform2D,
        to: Transform2D,
        from_height_span: HeightSpan,
        to_height_span: HeightSpan,
    ) -> Option<Vec<TilemapNavigationPathPoint>> {
        let mut scratch = TilemapNavigationScratch::default();
        self.navigation_path_between_height_spans_scratch(
            from,
            to,
            from_height_span,
            to_height_span,
            &mut scratch,
        )
        .map(ToOwned::to_owned)
    }

    pub(crate) fn navigation_waypoint_with_scratch(
        &self,
        from: Transform2D,
        to: Transform2D,
        scratch: &mut TilemapNavigationScratch,
    ) -> Option<Transform2D> {
        self.navigation_waypoint_with_optional_height_span_scratch(from, to, None, scratch)
    }

    pub(crate) fn navigation_waypoint_with_height_span_scratch(
        &self,
        from: Transform2D,
        to: Transform2D,
        height_span: HeightSpan,
        scratch: &mut TilemapNavigationScratch,
    ) -> Option<Transform2D> {
        self.navigation_waypoint_with_optional_height_span_scratch(
            from,
            to,
            Some(height_span),
            scratch,
        )
    }

    fn navigation_waypoint_with_optional_height_span_scratch(
        &self,
        from: Transform2D,
        to: Transform2D,
        height_span: Option<HeightSpan>,
        scratch: &mut TilemapNavigationScratch,
    ) -> Option<Transform2D> {
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            let Some(cell_count) = layer.cell_count() else {
                continue;
            };
            if cell_count > MAX_NAVIGATION_CELLS {
                continue;
            }
            let Some(start) = layer.walkable_cell_at_with_height_span(
                from,
                &self.height_span_definitions,
                &self.hd2d_definitions,
                height_span,
            ) else {
                continue;
            };
            let Some(goal) = layer.walkable_cell_at_with_height_span(
                to,
                &self.height_span_definitions,
                &self.hd2d_definitions,
                height_span,
            ) else {
                continue;
            };
            if start == goal {
                return Some(to);
            }
            let Some(next_cell) = layer.next_path_cell_with_height_span_scratch(
                start,
                goal,
                &self.height_span_definitions,
                &self.hd2d_definitions,
                height_span,
                scratch,
            ) else {
                continue;
            };
            return Some(layer.tile_center(next_cell));
        }
        None
    }

    pub(crate) fn navigation_path_with_scratch<'a>(
        &self,
        from: Transform2D,
        to: Transform2D,
        scratch: &'a mut TilemapNavigationScratch,
    ) -> Option<&'a [Transform2D]> {
        self.navigation_path_with_optional_height_span_scratch(from, to, None, scratch)
    }

    pub(crate) fn navigation_path_with_height_span_scratch<'a>(
        &self,
        from: Transform2D,
        to: Transform2D,
        height_span: HeightSpan,
        scratch: &'a mut TilemapNavigationScratch,
    ) -> Option<&'a [Transform2D]> {
        self.navigation_path_with_optional_height_span_scratch(from, to, Some(height_span), scratch)
    }

    pub(crate) fn navigation_path_between_height_spans_scratch<'a>(
        &self,
        from: Transform2D,
        to: Transform2D,
        from_height_span: HeightSpan,
        to_height_span: HeightSpan,
        scratch: &'a mut TilemapNavigationScratch,
    ) -> Option<&'a [TilemapNavigationPathPoint]> {
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            if layer.cell_count().is_none() {
                continue;
            }
            let Some(start) = layer.walkable_cell_at_with_height_span(
                from,
                &self.height_span_definitions,
                &self.hd2d_definitions,
                Some(from_height_span),
            ) else {
                continue;
            };
            let Some(goal) = layer.walkable_cell_at_with_height_span(
                to,
                &self.height_span_definitions,
                &self.hd2d_definitions,
                Some(to_height_span),
            ) else {
                continue;
            };
            if !self.find_hd2d_path_points_for_layer_scratch(
                layer,
                start,
                goal,
                from_height_span,
                to_height_span,
                scratch,
            ) {
                continue;
            }
            if scratch.path_hd2d_points.is_empty() {
                scratch
                    .path_hd2d_points
                    .push(TilemapNavigationPathPoint::new(to, to_height_span));
            }
            return Some(&scratch.path_hd2d_points);
        }
        None
    }

    fn navigation_path_with_optional_height_span_scratch<'a>(
        &self,
        from: Transform2D,
        to: Transform2D,
        height_span: Option<HeightSpan>,
        scratch: &'a mut TilemapNavigationScratch,
    ) -> Option<&'a [Transform2D]> {
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            let Some(cell_count) = layer.cell_count() else {
                continue;
            };
            if cell_count > MAX_NAVIGATION_CELLS {
                continue;
            }
            let Some(start) = layer.walkable_cell_at_with_height_span(
                from,
                &self.height_span_definitions,
                &self.hd2d_definitions,
                height_span,
            ) else {
                continue;
            };
            let Some(goal) = layer.walkable_cell_at_with_height_span(
                to,
                &self.height_span_definitions,
                &self.hd2d_definitions,
                height_span,
            ) else {
                continue;
            };
            if start == goal {
                scratch.prepare(cell_count);
                scratch.path_points.push(to);
                return Some(&scratch.path_points);
            }
            if !layer.find_path_cells_with_height_span_scratch(
                start,
                goal,
                &self.height_span_definitions,
                &self.hd2d_definitions,
                height_span,
                scratch,
            ) {
                continue;
            }
            scratch.path_points.clear();
            for cell in scratch.path_cells.iter().copied().skip(1) {
                scratch.path_points.push(layer.tile_center(cell));
            }
            return Some(&scratch.path_points);
        }
        None
    }

    fn find_hd2d_path_points_for_layer_scratch(
        &self,
        layer: &TilemapLayer,
        start: usize,
        goal: usize,
        from_height_span: HeightSpan,
        to_height_span: HeightSpan,
        scratch: &mut TilemapNavigationScratch,
    ) -> bool {
        let Some(cell_count) = layer.cell_count() else {
            return false;
        };
        collect_navigation_floor_ids(
            layer,
            &self.bridge_portal_definitions,
            from_height_span.floor,
            to_height_span.floor,
            &mut scratch.navigation_floor_ids,
        );
        let floor_count = scratch.navigation_floor_ids.len();
        let Some(state_count) = cell_count.checked_mul(floor_count) else {
            return false;
        };
        if state_count > MAX_NAVIGATION_CELLS {
            return false;
        }
        let Some(start_floor_index) =
            floor_index(&scratch.navigation_floor_ids, from_height_span.floor)
        else {
            return false;
        };
        let Some(goal_floor_index) =
            floor_index(&scratch.navigation_floor_ids, to_height_span.floor)
        else {
            return false;
        };
        let start_state = navigation_state_index(start_floor_index, cell_count, start);
        let goal_state = navigation_state_index(goal_floor_index, cell_count, goal);

        scratch.prepare(state_count);
        scratch.g_scores[start_state] = 0;
        scratch.visited.push(start_state);
        scratch.open.push(PathNode {
            cell: start_state,
            g_score: 0,
            f_score: hd2d_navigation_distance(layer, cell_count, start_state, goal_state),
        });

        let mut found = false;
        while let Some(node) = scratch.open.pop() {
            if node.cell == goal_state {
                found = reconstruct_path_cells(
                    start_state,
                    goal_state,
                    &scratch.came_from,
                    &mut scratch.path_cells,
                );
                break;
            }
            if node.g_score != scratch.g_scores[node.cell] {
                continue;
            }

            let (current_floor_index, cell) = navigation_state_parts(cell_count, node.cell);
            let floor = scratch.navigation_floor_ids[current_floor_index];
            let height_span = representative_height_span_for_cell(
                layer,
                cell,
                &self.bridge_portal_definitions,
                floor,
                from_height_span,
                to_height_span,
            );

            for neighbor in layer.neighbor_indices(cell).into_iter().flatten() {
                let Some(move_cost) = layer.navigation_cost_with_height_span(
                    neighbor,
                    &self.height_span_definitions,
                    &self.hd2d_definitions,
                    Some(height_span),
                ) else {
                    continue;
                };
                let neighbor_state =
                    navigation_state_index(current_floor_index, cell_count, neighbor);
                push_navigation_state(
                    layer,
                    cell_count,
                    node.cell,
                    neighbor_state,
                    goal_state,
                    node.g_score,
                    move_cost,
                    scratch,
                );
            }

            let tile_id = layer.tiles.get(cell).copied().unwrap_or(0);
            let Some(portal) = bridge_portal_definition(tile_id, &self.bridge_portal_definitions)
            else {
                continue;
            };
            let Some(target_floor) = portal.target_floor(floor) else {
                continue;
            };
            let Some(target_floor_index) = floor_index(&scratch.navigation_floor_ids, target_floor)
            else {
                continue;
            };
            let Some(target_height_span) = portal.height_span_for_floor(
                target_floor,
                from_height_span.height.max(to_height_span.height),
            ) else {
                continue;
            };
            if layer
                .navigation_cost_with_height_span(
                    cell,
                    &self.height_span_definitions,
                    &self.hd2d_definitions,
                    Some(target_height_span),
                )
                .is_none()
            {
                continue;
            }
            let target_state = navigation_state_index(target_floor_index, cell_count, cell);
            push_navigation_state(
                layer,
                cell_count,
                node.cell,
                target_state,
                goal_state,
                node.g_score,
                portal.navigation_cost,
                scratch,
            );
        }

        scratch.clear_dirty();
        if !found {
            scratch.path_hd2d_points.clear();
            return false;
        }

        scratch.path_hd2d_points.clear();
        for state in scratch.path_cells.iter().copied().skip(1) {
            let (floor_index, cell) = navigation_state_parts(cell_count, state);
            let floor = scratch.navigation_floor_ids[floor_index];
            let height_span = if state == goal_state {
                to_height_span
            } else {
                representative_height_span_for_cell(
                    layer,
                    cell,
                    &self.bridge_portal_definitions,
                    floor,
                    from_height_span,
                    to_height_span,
                )
            };
            scratch
                .path_hd2d_points
                .push(TilemapNavigationPathPoint::new(
                    layer.tile_center(cell),
                    height_span,
                ));
        }
        true
    }
}

impl TilemapLayer {
    pub(super) fn cell_count(&self) -> Option<usize> {
        (self.columns as usize).checked_mul(self.rows as usize)
    }

    pub(super) fn cell_at(&self, transform: Transform2D) -> Option<usize> {
        let max_x = self.origin_x + self.columns as f32 * self.tile_width;
        let max_y = self.origin_y + self.rows as f32 * self.tile_height;
        if transform.x < self.origin_x
            || transform.x > max_x
            || transform.y < self.origin_y
            || transform.y > max_y
        {
            return None;
        }

        let column = ((transform.x - self.origin_x) / self.tile_width)
            .floor()
            .clamp(0.0, (self.columns - 1) as f32) as u32;
        let row = ((transform.y - self.origin_y) / self.tile_height)
            .floor()
            .clamp(0.0, (self.rows - 1) as f32) as u32;
        Some((row * self.columns + column) as usize)
    }

    pub(super) fn walkable_cell_at_with_height_span(
        &self,
        transform: Transform2D,
        height_span_definitions: &[Option<HeightSpan>],
        hd2d_definitions: &[Option<Hd2dTileDefinition>],
        query_height_span: Option<HeightSpan>,
    ) -> Option<usize> {
        let cell = self.cell_at(transform)?;
        self.is_walkable_with_height_span(
            cell,
            height_span_definitions,
            hd2d_definitions,
            query_height_span,
        )
        .then_some(cell)
    }

    pub(super) fn is_walkable_with_height_span(
        &self,
        cell: usize,
        height_span_definitions: &[Option<HeightSpan>],
        hd2d_definitions: &[Option<Hd2dTileDefinition>],
        query_height_span: Option<HeightSpan>,
    ) -> bool {
        self.navigation_cost_with_height_span(
            cell,
            height_span_definitions,
            hd2d_definitions,
            query_height_span,
        )
        .is_some()
    }

    pub(super) fn navigation_cost_with_height_span(
        &self,
        cell: usize,
        height_span_definitions: &[Option<HeightSpan>],
        hd2d_definitions: &[Option<Hd2dTileDefinition>],
        query_height_span: Option<HeightSpan>,
    ) -> Option<u32> {
        let tile_id = self.tiles.get(cell).copied().unwrap_or(0);
        let blocks_navigation = tile_id_blocks_movement(tile_id, hd2d_definitions)
            && tile_id_height_span_allows(tile_id, height_span_definitions, query_height_span);
        (!blocks_navigation).then(|| {
            self.navigation_costs
                .get(cell)
                .copied()
                .unwrap_or(0)
                .max(DEFAULT_NAVIGATION_COST)
        })
    }

    pub(super) fn next_path_cell_with_height_span_scratch(
        &self,
        start: usize,
        goal: usize,
        height_span_definitions: &[Option<HeightSpan>],
        hd2d_definitions: &[Option<Hd2dTileDefinition>],
        query_height_span: Option<HeightSpan>,
        scratch: &mut TilemapNavigationScratch,
    ) -> Option<usize> {
        self.find_path_cells_with_height_span_scratch(
            start,
            goal,
            height_span_definitions,
            hd2d_definitions,
            query_height_span,
            scratch,
        )
        .then(|| scratch.path_cells.get(1).copied())
        .flatten()
    }

    pub(super) fn find_path_cells_with_height_span_scratch(
        &self,
        start: usize,
        goal: usize,
        height_span_definitions: &[Option<HeightSpan>],
        hd2d_definitions: &[Option<Hd2dTileDefinition>],
        query_height_span: Option<HeightSpan>,
        scratch: &mut TilemapNavigationScratch,
    ) -> bool {
        let Some(cell_count) = self.cell_count() else {
            return false;
        };
        scratch.prepare(cell_count);
        scratch.g_scores[start] = 0;
        scratch.visited.push(start);
        scratch.open.push(PathNode {
            cell: start,
            g_score: 0,
            f_score: self.manhattan_distance(start, goal),
        });

        let mut found = false;
        while let Some(node) = scratch.open.pop() {
            if node.cell == goal {
                found = reconstruct_path_cells(
                    start,
                    goal,
                    &scratch.came_from,
                    &mut scratch.path_cells,
                );
                break;
            }
            if node.g_score != scratch.g_scores[node.cell] {
                continue;
            }
            for neighbor in self.neighbor_indices(node.cell).into_iter().flatten() {
                let Some(move_cost) = self.navigation_cost_with_height_span(
                    neighbor,
                    height_span_definitions,
                    hd2d_definitions,
                    query_height_span,
                ) else {
                    continue;
                };
                let next_g_score = node.g_score.saturating_add(move_cost);
                if next_g_score >= scratch.g_scores[neighbor] {
                    continue;
                }
                scratch.set_score(neighbor, node.cell, next_g_score);
                scratch.open.push(PathNode {
                    cell: neighbor,
                    g_score: next_g_score,
                    f_score: next_g_score + self.manhattan_distance(neighbor, goal),
                });
            }
        }

        scratch.clear_dirty();
        found
    }

    pub(super) fn neighbor_indices(&self, cell: usize) -> [Option<usize>; 4] {
        let column = cell as u32 % self.columns;
        let row = cell as u32 / self.columns;
        [
            (column > 0).then(|| cell - 1),
            (column + 1 < self.columns).then(|| cell + 1),
            (row > 0).then(|| cell - self.columns as usize),
            (row + 1 < self.rows).then(|| cell + self.columns as usize),
        ]
    }

    pub(super) fn manhattan_distance(&self, from: usize, to: usize) -> u32 {
        let from_column = from as u32 % self.columns;
        let from_row = from as u32 / self.columns;
        let to_column = to as u32 % self.columns;
        let to_row = to as u32 / self.columns;
        from_column.abs_diff(to_column) + from_row.abs_diff(to_row)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) struct PathNode {
    cell: usize,
    g_score: u32,
    f_score: u32,
}

impl Ord for PathNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .f_score
            .cmp(&self.f_score)
            .then_with(|| other.g_score.cmp(&self.g_score))
            .then_with(|| self.cell.cmp(&other.cell))
    }
}

impl PartialOrd for PathNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn reconstruct_path_cells(
    start: usize,
    goal: usize,
    came_from: &[usize],
    out: &mut Vec<usize>,
) -> bool {
    out.clear();
    let mut current = goal;
    out.push(current);

    while current != start {
        let Some(previous) = came_from.get(current).copied() else {
            out.clear();
            return false;
        };
        if previous == UNVISITED_CELL {
            out.clear();
            return false;
        }
        current = previous;
        out.push(current);
    }

    out.reverse();
    true
}

fn collect_navigation_floor_ids(
    layer: &TilemapLayer,
    bridge_portals: &[Option<Hd2dBridgePortalDefinition>],
    from_floor: PhysicsFloorId,
    to_floor: PhysicsFloorId,
    out: &mut Vec<PhysicsFloorId>,
) {
    out.clear();
    push_unique_floor(out, from_floor);
    push_unique_floor(out, to_floor);
    for tile_id in layer.tiles.iter().copied().filter(|tile_id| *tile_id != 0) {
        if let Some(portal) = bridge_portal_definition(tile_id, bridge_portals) {
            push_unique_floor(out, portal.lower_floor);
            push_unique_floor(out, portal.upper_floor);
        }
    }
}

fn push_unique_floor(out: &mut Vec<PhysicsFloorId>, floor: PhysicsFloorId) {
    if !out.contains(&floor) {
        out.push(floor);
    }
}

fn floor_index(floors: &[PhysicsFloorId], floor: PhysicsFloorId) -> Option<usize> {
    floors.iter().position(|candidate| *candidate == floor)
}

fn bridge_portal_definition(
    tile_id: u32,
    bridge_portals: &[Option<Hd2dBridgePortalDefinition>],
) -> Option<Hd2dBridgePortalDefinition> {
    bridge_portals.get(tile_id as usize).copied().flatten()
}

fn representative_height_span_for_cell(
    layer: &TilemapLayer,
    cell: usize,
    bridge_portals: &[Option<Hd2dBridgePortalDefinition>],
    floor: PhysicsFloorId,
    from_height_span: HeightSpan,
    to_height_span: HeightSpan,
) -> HeightSpan {
    if floor == from_height_span.floor {
        return from_height_span;
    }
    if floor == to_height_span.floor {
        return to_height_span;
    }
    let tile_id = layer.tiles.get(cell).copied().unwrap_or(0);
    if let Some(portal) = bridge_portal_definition(tile_id, bridge_portals) {
        if let Some(height_span) =
            portal.height_span_for_floor(floor, from_height_span.height.max(to_height_span.height))
        {
            return height_span;
        }
    }
    HeightSpan {
        floor,
        elevation: 0.0,
        height: from_height_span.height.max(to_height_span.height),
    }
}

fn navigation_state_index(floor_index: usize, cell_count: usize, cell: usize) -> usize {
    floor_index * cell_count + cell
}

fn navigation_state_parts(cell_count: usize, state: usize) -> (usize, usize) {
    (state / cell_count, state % cell_count)
}

fn hd2d_navigation_distance(
    layer: &TilemapLayer,
    cell_count: usize,
    from_state: usize,
    to_state: usize,
) -> u32 {
    let (from_floor, from_cell) = navigation_state_parts(cell_count, from_state);
    let (to_floor, to_cell) = navigation_state_parts(cell_count, to_state);
    layer.manhattan_distance(from_cell, to_cell) + u32::from(from_floor != to_floor)
}

#[allow(clippy::too_many_arguments)]
fn push_navigation_state(
    layer: &TilemapLayer,
    cell_count: usize,
    previous_state: usize,
    next_state: usize,
    goal_state: usize,
    current_g_score: u32,
    move_cost: u32,
    scratch: &mut TilemapNavigationScratch,
) {
    let next_g_score = current_g_score.saturating_add(move_cost);
    if next_g_score >= scratch.g_scores[next_state] {
        return;
    }
    scratch.set_score(next_state, previous_state, next_g_score);
    scratch.open.push(PathNode {
        cell: next_state,
        g_score: next_g_score,
        f_score: next_g_score + hd2d_navigation_distance(layer, cell_count, next_state, goal_state),
    });
}
