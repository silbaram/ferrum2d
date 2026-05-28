use std::cmp::Ordering;
use std::collections::BinaryHeap;

use super::{Tilemap, TilemapLayer, DEFAULT_NAVIGATION_COST, MAX_NAVIGATION_CELLS, UNVISITED_CELL};
use crate::components::Transform2D;

#[derive(Debug, Default)]
pub(crate) struct TilemapNavigationScratch {
    pub(super) came_from: Vec<usize>,
    pub(super) g_scores: Vec<u32>,
    pub(super) visited: Vec<usize>,
    pub(super) open: BinaryHeap<PathNode>,
    pub(super) path_cells: Vec<usize>,
    pub(super) path_points: Vec<Transform2D>,
}

impl TilemapNavigationScratch {
    pub(super) fn prepare(&mut self, cell_count: usize) {
        self.clear_dirty();
        self.path_cells.clear();
        self.path_points.clear();
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

    pub fn navigation_path(&self, from: Transform2D, to: Transform2D) -> Option<Vec<Transform2D>> {
        let mut scratch = TilemapNavigationScratch::default();
        self.navigation_path_with_scratch(from, to, &mut scratch)
            .map(ToOwned::to_owned)
    }

    pub(crate) fn navigation_waypoint_with_scratch(
        &self,
        from: Transform2D,
        to: Transform2D,
        scratch: &mut TilemapNavigationScratch,
    ) -> Option<Transform2D> {
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            let Some(cell_count) = layer.cell_count() else {
                continue;
            };
            if cell_count > MAX_NAVIGATION_CELLS {
                continue;
            }
            let Some(start) = layer.walkable_cell_at(from) else {
                continue;
            };
            let Some(goal) = layer.walkable_cell_at(to) else {
                continue;
            };
            if start == goal {
                return Some(to);
            }
            let Some(next_cell) = layer.next_path_cell_with_scratch(start, goal, scratch) else {
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
        for layer in self.layers.iter().flatten().filter(|layer| layer.collision) {
            let Some(cell_count) = layer.cell_count() else {
                continue;
            };
            if cell_count > MAX_NAVIGATION_CELLS {
                continue;
            }
            let Some(start) = layer.walkable_cell_at(from) else {
                continue;
            };
            let Some(goal) = layer.walkable_cell_at(to) else {
                continue;
            };
            if start == goal {
                scratch.prepare(cell_count);
                scratch.path_points.push(to);
                return Some(&scratch.path_points);
            }
            if !layer.find_path_cells_with_scratch(start, goal, scratch) {
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

    pub(super) fn walkable_cell_at(&self, transform: Transform2D) -> Option<usize> {
        let cell = self.cell_at(transform)?;
        self.is_walkable(cell).then_some(cell)
    }

    pub(super) fn is_walkable(&self, cell: usize) -> bool {
        self.navigation_cost(cell).is_some()
    }

    pub(super) fn navigation_cost(&self, cell: usize) -> Option<u32> {
        (self.tiles.get(cell).copied().unwrap_or(0) == 0).then(|| {
            self.navigation_costs
                .get(cell)
                .copied()
                .unwrap_or(0)
                .max(DEFAULT_NAVIGATION_COST)
        })
    }

    pub(super) fn next_path_cell_with_scratch(
        &self,
        start: usize,
        goal: usize,
        scratch: &mut TilemapNavigationScratch,
    ) -> Option<usize> {
        self.find_path_cells_with_scratch(start, goal, scratch)
            .then(|| scratch.path_cells.get(1).copied())
            .flatten()
    }

    pub(super) fn find_path_cells_with_scratch(
        &self,
        start: usize,
        goal: usize,
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
                let Some(move_cost) = self.navigation_cost(neighbor) else {
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
