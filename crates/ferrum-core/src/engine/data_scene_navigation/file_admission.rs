use super::*;
use crate::engine::file_data_movement_admission::{invalid, Budget, Error, Owner};

impl NavigationObstacles {
    pub(in crate::engine) fn validate_file(
        &self,
        grid: &Tilemap,
        budget: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            columns: _,
            rows: _,
            base_costs: _,
            blockers: _,
            bindings: _,
            geometry: _,
        } = self;
        let GridGeometry {
            columns: _,
            rows: _,
            cell_width: _,
            cell_height: _,
            origin_x: _,
            origin_y: _,
        } = self.geometry;
        budget.work(6 + 6)?;
        for cap in [
            self.base_costs.capacity(),
            self.blockers.capacity(),
            self.bindings.capacity(),
        ] {
            budget.work(cap)?;
        }
        let layer = grid
            .file_data_scene_layer()
            .map_err(|()| invalid(Owner::Grid, "layers", 0))?;
        let cells = (self.columns as usize)
            .checked_mul(self.rows as usize)
            .ok_or_else(|| invalid(Owner::Obstacles, "dimensions", 0))?;
        if cells == 0 {
            if self.columns != 0
                || self.rows != 0
                || !self.base_costs.is_empty()
                || !self.blockers.is_empty()
                || !self.bindings.is_empty()
                || layer.is_some()
                || self.geometry.columns != 0
                || self.geometry.rows != 0
                || [
                    self.geometry.cell_width,
                    self.geometry.cell_height,
                    self.geometry.origin_x,
                    self.geometry.origin_y,
                ]
                .iter()
                .any(|v| *v != 0.0)
            {
                return Err(invalid(Owner::Obstacles, "empty-grid", 0));
            }
            return Ok(());
        }
        if cells > 4096
            || self.base_costs.len() != cells
            || self.blockers.len() != cells
            || self.bindings.len() > 4096
        {
            return Err(invalid(Owner::Obstacles, "length", 0));
        }
        let (layer, costs) = layer.ok_or_else(|| invalid(Owner::Grid, "missing-layer", 0))?;
        if self.geometry.columns != self.columns
            || self.geometry.rows != self.rows
            || layer.columns != self.columns
            || layer.rows != self.rows
            || !layer.collision
            || costs.len() != cells
            || layer.tiles.len() != cells
            || self.geometry.cell_width.to_bits() != layer.tile_width.to_bits()
            || self.geometry.cell_height.to_bits() != layer.tile_height.to_bits()
            || self.geometry.origin_x.to_bits() != layer.origin_x.to_bits()
            || self.geometry.origin_y.to_bits() != layer.origin_y.to_bits()
        {
            return Err(invalid(Owner::Obstacles, "geometry", 0));
        }
        budget.sort(self.bindings.len())?;
        budget.work(cells.checked_mul(2).ok_or(Error::WorkLimit)?)?;
        let mut ids = budget.reserve::<u32>(self.bindings.len())?;
        let mut expected = budget.reserve::<u32>(cells)?;
        let mut marks = budget.reserve::<u32>(cells)?;
        expected.resize(cells, 0);
        marks.resize(cells, 0);
        let mut authored_cells = 0usize;
        let mut automatic_count = 0usize;
        for (index, binding) in self.bindings.iter().enumerate() {
            let NavigationObstacle {
                entity: _,
                cells: _,
                active: _,
                automatic: _,
                rectangle: _,
            } = binding;
            budget.work(5)?;
            budget.work(binding.cells.capacity())?;
            ids.push(binding.entity.id);
            authored_cells = authored_cells
                .checked_add(binding.cells.len().max(1))
                .ok_or(Error::WorkLimit)?;
            automatic_count += usize::from(binding.automatic);
            if authored_cells > 4096
                || automatic_count > 64
                || binding.automatic != binding.cells.is_empty()
                || (binding.rectangle.is_some() && (!binding.automatic || !binding.active))
            {
                return Err(invalid(Owner::Obstacles, "binding", index));
            }
            for &cell in &binding.cells {
                if cell >= cells || marks[cell] == index as u32 + 1 {
                    return Err(invalid(Owner::Obstacles, "cell", index));
                }
                marks[cell] = index as u32 + 1;
                if binding.active {
                    expected[cell] = expected[cell]
                        .checked_add(1)
                        .ok_or_else(|| invalid(Owner::Obstacles, "coverage", cell))?;
                }
            }
            if let Some(rectangle) = binding.rectangle {
                if rectangle.first_column > rectangle.last_column
                    || rectangle.last_column >= self.columns
                    || rectangle.first_row > rectangle.last_row
                    || rectangle.last_row >= self.rows
                {
                    return Err(invalid(Owner::Obstacles, "rectangle", index));
                }
                let area = ((rectangle.last_column - rectangle.first_column + 1) as usize)
                    .checked_mul((rectangle.last_row - rectangle.first_row + 1) as usize)
                    .ok_or(Error::WorkLimit)?;
                budget.work(area)?; // Before bounded rectangle enumeration.
                for row in rectangle.first_row..=rectangle.last_row {
                    for column in rectangle.first_column..=rectangle.last_column {
                        let cell = (row * self.columns + column) as usize;
                        expected[cell] = expected[cell]
                            .checked_add(1)
                            .ok_or_else(|| invalid(Owner::Obstacles, "coverage", cell))?;
                    }
                }
            }
        }
        ids.sort_unstable();
        if ids.windows(2).any(|w| w[0] == w[1]) {
            return Err(invalid(Owner::Obstacles, "duplicate-entity", 0));
        }
        for (index, (((&base, &blockers), &expected), (&tile, &cost))) in self
            .base_costs
            .iter()
            .zip(&self.blockers)
            .zip(&expected)
            .zip(layer.tiles.iter().zip(costs))
            .enumerate()
        {
            let effective = if blockers == 0 { base } else { 0 };
            if base > 65535
                || blockers != expected
                || cost != effective
                || tile != u32::from(effective == 0)
            {
                return Err(invalid(Owner::Obstacles, "overlay", index));
            }
        }
        // Active flags and rectangles are a synchronized overlay snapshot. A
        // collider edit/despawn can precede synchronize(); never query World here.
        Ok(())
    }

    #[cfg(test)]
    pub(in crate::engine) fn corrupt_file_obstacles_fixture(&mut self, case: u32) {
        match case {
            0 => {
                self.blockers.pop();
            }
            1 => self.geometry.origin_x = f32::NAN,
            2 => self.bindings[0].cells.push(self.base_costs.len()),
            3 => self.blockers[0] = u32::MAX,
            4 => self.base_costs[0] = 65536,
            5 => self.bindings.push(self.bindings[0].clone()),
            _ => unreachable!("known file obstacle test case"),
        }
    }
}
