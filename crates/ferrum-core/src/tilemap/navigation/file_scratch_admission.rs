use super::*;
use crate::tilemap::file_admission::{invalid, span, Budget, Error, Field, Problem};
impl TilemapNavigationScratch {
    pub(crate) fn validate_file(&self, budget: &mut Budget) -> Result<(), Error> {
        let TilemapNavigationScratch {
            came_from: _,
            g_scores: _,
            visited: _,
            open: _,
            path_cells: _,
            path_points: _,
            path_hd2d_points: _,
            navigation_floor_ids: _,
        } = self;

        budget.work(8)?;
        for cap in [
            self.came_from.capacity(),
            self.g_scores.capacity(),
            self.visited.capacity(),
            self.open.capacity(),
            self.path_cells.capacity(),
            self.path_points.capacity(),
            self.path_hd2d_points.capacity(),
            self.navigation_floor_ids.capacity(),
        ] {
            budget.work(cap)?;
        }
        let count = self.came_from.len();
        if count != self.g_scores.len()
            || count > MAX_NAVIGATION_CELLS
            || self.visited.len() > count
            || self.path_cells.len() > count
            || self.path_points.len() > MAX_NAVIGATION_CELLS
            || self.path_hd2d_points.len() > MAX_NAVIGATION_CELLS
        {
            return Err(invalid(Field::ScratchScores, 0, Problem::Length));
        }
        if count == 0 && (!self.path_points.is_empty() || !self.path_hd2d_points.is_empty()) {
            return Err(invalid(Field::ScratchPoints, 0, Problem::History));
        }
        budget.work(count)?;
        let mut dirty = budget.reserve::<u8>(count)?;
        dirty.resize(count, 0);
        for (index, &cell) in self.visited.iter().enumerate() {
            if cell >= count {
                return Err(invalid(Field::ScratchVisited, index, Problem::Reference));
            }
            if dirty[cell] != 0 {
                return Err(invalid(Field::ScratchVisited, index, Problem::Duplicate));
            }
            dirty[cell] = 1;
        }
        let mut roots = 0;
        for (index, (&previous, &score)) in self.came_from.iter().zip(&self.g_scores).enumerate() {
            if score == u32::MAX {
                if previous != UNVISITED_CELL || dirty[index] != 0 {
                    return Err(invalid(Field::ScratchScores, index, Problem::Sentinel));
                }
                continue;
            }
            if dirty[index] == 0 {
                return Err(invalid(Field::ScratchScores, index, Problem::Membership));
            }
            if previous == UNVISITED_CELL {
                if score != 0 {
                    return Err(invalid(Field::ScratchScores, index, Problem::Reference));
                }
                roots += 1;
            } else if previous >= count || self.g_scores[previous] >= score {
                return Err(invalid(Field::ScratchScores, index, Problem::Reference));
            }
        }
        if roots != usize::from(!self.visited.is_empty()) {
            return Err(invalid(Field::ScratchScores, 0, Problem::Reference));
        }
        budget.sort(self.open.len())?;
        let mut open_keys = budget.reserve::<(usize, u32)>(self.open.len())?;
        let heap = self.open.as_slice();
        for (index, node) in heap.iter().enumerate() {
            if node.cell >= count
                || node.g_score == u32::MAX
                || dirty[node.cell] == 0
                || node.g_score < self.g_scores[node.cell]
            {
                return Err(invalid(Field::ScratchQueue, index, Problem::Reference));
            }
            if index > 0 && heap[(index - 1) / 2] < *node {
                return Err(invalid(Field::ScratchQueue, index, Problem::Order));
            }
            // Stale larger g scores are normal; f_score is a raw release-u32 heuristic
            // result, so it is not recomputed and may have wrapped below g_score.
            open_keys.push((node.cell, node.g_score));
        }
        open_keys.sort_unstable();
        if open_keys.windows(2).any(|w| w[0] == w[1]) {
            return Err(invalid(Field::ScratchQueue, 0, Problem::Duplicate));
        }
        budget.sort(self.path_cells.len())?;
        let mut path = budget.reserve::<usize>(self.path_cells.len())?;
        for (index, &cell) in self.path_cells.iter().enumerate() {
            if cell >= count {
                return Err(invalid(Field::ScratchPath, index, Problem::Reference));
            }
            path.push(cell);
        }
        path.sort_unstable();
        if path.windows(2).any(|w| w[0] == w[1]) {
            return Err(invalid(Field::ScratchPath, 0, Problem::Duplicate));
        }
        for (index, p) in self.path_points.iter().enumerate() {
            if !p.x.is_finite() || !p.y.is_finite() {
                return Err(invalid(Field::ScratchPoints, index, Problem::Number));
            }
        }
        for (index, p) in self.path_hd2d_points.iter().enumerate() {
            if !p.x.is_finite() || !p.y.is_finite() || !span(p.height_span()) {
                return Err(invalid(Field::ScratchPoints, index, Problem::Number));
            }
        }
        budget.sort(self.navigation_floor_ids.len())?;
        let mut floors = budget.reserve::<u32>(self.navigation_floor_ids.len())?;
        for f in &self.navigation_floor_ids {
            floors.push(f.0);
        }
        floors.sort_unstable();
        if floors.windows(2).any(|w| w[0] == w[1]) {
            return Err(invalid(Field::ScratchFloors, 0, Problem::Duplicate));
        }
        // Retained paths/floors are history, including failure-before-prepare. No
        // comparison to a current layer, geometry or requested floor is justified.
        Ok(())
    }
}
#[cfg(test)]
mod tests;

/// Same sequence wire as BinaryHeap's serde implementation. Existing checkpoint
/// input/value/collection quotas bound Vec decoding; leaf work/scratch admission
/// is a separate subsequent pass. Check before from(Vec) could repair bad order.
pub(super) fn deserialize_open<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BinaryHeap<PathNode>, D::Error> {
    let values = <Vec<PathNode> as serde::Deserialize>::deserialize(deserializer)?;
    for (index, node) in values.iter().enumerate() {
        if node.cell >= MAX_NAVIGATION_CELLS || node.g_score == u32::MAX {
            return Err(serde::de::Error::custom(
                "invalid stored tilemap navigation node",
            ));
        }
        if index > 0 && values[(index - 1) / 2] < *node {
            return Err(serde::de::Error::custom(
                "invalid stored tilemap navigation heap order",
            ));
        }
    }
    Ok(BinaryHeap::from(values))
}
