//! Cold readonly admission of the entire Tilemap payload. No query/rebuild or
//! resource upload occurs. Native/Engine/resource ownership remain separate.
use super::*;
#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct Usage {
    pub work: u64,
    pub scratch_bytes: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Field {
    Definitions,
    Slopes,
    OneWay,
    Heights,
    Hd2d,
    Portals,
    Layers,
    Rectangles,
    Chunks,
    Counters,
    ScratchScores,
    ScratchVisited,
    ScratchQueue,
    ScratchPath,
    ScratchPoints,
    ScratchFloors,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Problem {
    Length,
    Number,
    Range,
    ZeroSlot,
    Order,
    Reference,
    Shape,
    Membership,
    Coverage,
    Duplicate,
    History,
    Sentinel,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    WorkLimit,
    ScratchLimit,
    Allocation,
    Invalid {
        field: Field,
        index: usize,
        problem: Problem,
    },
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "tilemap file admission rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
pub(super) fn invalid(field: Field, index: usize, problem: Problem) -> Error {
    Error::Invalid {
        field,
        index,
        problem,
    }
}
pub(crate) struct Budget {
    limits: Limits,
    pub(crate) usage: Usage,
}
impl Budget {
    pub(crate) fn new(limits: Limits) -> Self {
        Self {
            limits,
            usage: Usage::default(),
        }
    }
    pub(crate) fn work(&mut self, n: usize) -> Result<(), Error> {
        let next = self
            .usage
            .work
            .checked_add(u64::try_from(n).map_err(|_| Error::WorkLimit)?)
            .ok_or(Error::WorkLimit)?;
        if next > self.limits.max_work {
            return Err(Error::WorkLimit);
        }
        self.usage.work = next;
        Ok(())
    }
    pub(crate) fn sort(&mut self, n: usize) -> Result<(), Error> {
        let log = (usize::BITS - n.saturating_sub(1).leading_zeros()) as usize;
        self.work(n.checked_mul(log + 1).ok_or(Error::WorkLimit)?)
    }
    pub(crate) fn reserve<T>(&mut self, n: usize) -> Result<Vec<T>, Error> {
        let bytes = n
            .checked_mul(std::mem::size_of::<T>())
            .ok_or(Error::ScratchLimit)?;
        let next = self
            .usage
            .scratch_bytes
            .checked_add(bytes)
            .ok_or(Error::ScratchLimit)?;
        if next > self.limits.max_scratch_bytes {
            return Err(Error::ScratchLimit);
        }
        self.usage.scratch_bytes = next;
        let mut v = Vec::new();
        v.try_reserve_exact(n).map_err(|_| Error::Allocation)?;
        Ok(v)
    }
}
pub(crate) fn validate(value: &Tilemap, limits: Limits) -> Result<Usage, Error> {
    let mut budget = Budget::new(limits);
    validate_with_budget(value, &mut budget)?;
    Ok(budget.usage)
}
impl Tilemap {
    /// Borrow the dedicated Data Scene layer without making a snapshot or query.
    pub(crate) fn file_data_scene_layer(&self) -> Result<Option<(&TilemapLayer, &[u32])>, ()> {
        match self.layers.as_slice() {
            [] => Ok(None),
            [Some(layer)] => Ok(Some((layer, &layer.navigation_costs))),
            _ => Err(()),
        }
    }
}
pub(crate) fn validate_with_budget(value: &Tilemap, budget: &mut Budget) -> Result<(), Error> {
    let Tilemap {
        physics_revision: _,
        half_open_hd2d_surfaces: _,
        definitions: _,
        slope_definitions: _,
        one_way_platform_definitions: _,
        height_span_definitions: _,
        hd2d_definitions: _,
        bridge_portal_definitions: _,
        layers: _,
        collision_rects: _,
        collision_rect_chunks: _,
    } = value;

    budget.work(11)?;
    for cap in [
        value.definitions.capacity(),
        value.slope_definitions.capacity(),
        value.one_way_platform_definitions.capacity(),
        value.height_span_definitions.capacity(),
        value.hd2d_definitions.capacity(),
        value.bridge_portal_definitions.capacity(),
        value.layers.capacity(),
        value.collision_rects.capacity(),
        value.collision_rect_chunks.capacity(),
    ] {
        budget.work(cap)?;
    }
    if value.layers.len() != value.collision_rects.len()
        || value.layers.len() != value.collision_rect_chunks.len()
    {
        return Err(invalid(Field::Layers, 0, Problem::Length));
    }
    for (i, d) in value.definitions.iter().enumerate() {
        if let Some(d) = d {
            if i == 0 {
                return Err(invalid(Field::Definitions, i, Problem::ZeroSlot));
            }
            if SpriteFrame::from_values(d.frame.u0, d.frame.v0, d.frame.u1, d.frame.v1).is_none()
                || [d.r, d.g, d.b, d.a]
                    .iter()
                    .any(|x| !x.is_finite() || !(0.0..=1.0).contains(x))
            {
                return Err(invalid(Field::Definitions, i, Problem::Range));
            }
        }
    }
    for (i, d) in value.slope_definitions.iter().enumerate() {
        if let Some(d) = d {
            if i == 0 {
                return Err(invalid(Field::Slopes, i, Problem::ZeroSlot));
            }
            if super::queries::tile_slope_definition_from_values(
                d.local_x0, d.local_y0, d.local_x1, d.local_y1,
            )
            .is_none()
            {
                return Err(invalid(Field::Slopes, i, Problem::Range));
            }
        }
    }
    if value.one_way_platform_definitions.first() == Some(&true) {
        return Err(invalid(Field::OneWay, 0, Problem::ZeroSlot));
    }
    for (i, d) in value.height_span_definitions.iter().enumerate() {
        if let Some(d) = d {
            if i == 0 {
                return Err(invalid(Field::Heights, i, Problem::ZeroSlot));
            }
            if !span(*d) {
                return Err(invalid(Field::Heights, i, Problem::Number));
            }
        }
    }
    for (i, d) in value.hd2d_definitions.iter().enumerate() {
        if let Some(d) = d {
            if i == 0 {
                return Err(invalid(Field::Hd2d, i, Problem::ZeroSlot));
            }
            if !d.occluder_height.is_finite()
                || d.occluder_height < 0.0
                || (d.kind == Hd2dTileKind::Ramp) != d.ramp.is_some()
                || d.ramp
                    .is_some_and(|r| !r.start_elevation.is_finite() || !r.end_elevation.is_finite())
            {
                return Err(invalid(Field::Hd2d, i, Problem::Range));
            }
        }
    }
    for (i, d) in value.bridge_portal_definitions.iter().enumerate() {
        if let Some(d) = d {
            if i == 0 {
                return Err(invalid(Field::Portals, i, Problem::ZeroSlot));
            }
            if d.lower_floor == d.upper_floor
                || !d.lower_elevation.is_finite()
                || !d.upper_elevation.is_finite()
                || d.navigation_cost == 0
            {
                return Err(invalid(Field::Portals, i, Problem::Range));
            }
        }
    }
    for (index, layer) in value.layers.iter().enumerate() {
        let flat = &value.collision_rects[index];
        let chunks = &value.collision_rect_chunks[index];
        let Some(layer) = layer else {
            if flat.is_some() || chunks.is_some() {
                return Err(invalid(Field::Layers, index, Problem::Membership));
            }
            continue;
        };
        budget.work(layer.tiles.capacity())?;
        budget.work(layer.navigation_costs.capacity())?;
        let cells = (layer.columns as usize)
            .checked_mul(layer.rows as usize)
            .ok_or_else(|| invalid(Field::Layers, index, Problem::Shape))?;
        if layer.columns == 0
            || layer.rows == 0
            || u32::try_from(cells).is_err()
            || cells != layer.tiles.len()
            || cells != layer.navigation_costs.len()
        {
            return Err(invalid(Field::Layers, index, Problem::Shape));
        }
        if !layer.tile_width.is_finite()
            || layer.tile_width <= 0.0
            || !layer.tile_height.is_finite()
            || layer.tile_height <= 0.0
            || !layer.origin_x.is_finite()
            || !layer.origin_y.is_finite()
        {
            return Err(invalid(Field::Layers, index, Problem::Number));
        }
        // Raw tile IDs/navigation costs are all u32 values. Missing visual or shape
        // definitions intentionally use the existing consumer fallback semantics.
        if !layer.collision {
            if flat.is_some() || chunks.is_some() {
                return Err(invalid(Field::Layers, index, Problem::Membership));
            }
            continue;
        }
        let (flat, chunks) = match (flat, chunks) {
            (Some(f), Some(c)) => (f, c),
            _ => return Err(invalid(Field::Chunks, index, Problem::Membership)),
        };
        validate_cache(value, layer, index, cells, flat, chunks, budget)?;
    }
    Ok(())
}
pub(super) fn span(s: HeightSpan) -> bool {
    s.elevation.is_finite() && s.height.is_finite() && s.height >= 0.0
}
fn rect(r: &TileCollisionRect, layer: &TilemapLayer, index: usize) -> Result<(u32, u32), Error> {
    let end_column = r
        .min_column
        .checked_add(r.columns)
        .ok_or_else(|| invalid(Field::Rectangles, index, Problem::Range))?;
    let end_row = r
        .min_row
        .checked_add(r.rows)
        .ok_or_else(|| invalid(Field::Rectangles, index, Problem::Range))?;
    if r.columns == 0
        || r.rows == 0
        || end_column > layer.columns
        || end_row > layer.rows
        || r.tile_index != (r.min_row as usize) * (layer.columns as usize) + (r.min_column as usize)
        || r.height_span.is_some_and(|s| !span(s))
    {
        return Err(invalid(Field::Rectangles, index, Problem::Range));
    }
    Ok((end_column, end_row))
}
fn solid(value: &Tilemap, id: u32) -> Option<Option<HeightSpan>> {
    if !super::queries::tile_id_blocks_movement(id, &value.hd2d_definitions)
        || value
            .slope_definitions
            .get(id as usize)
            .is_some_and(Option::is_some)
        || value
            .one_way_platform_definitions
            .get(id as usize)
            .copied()
            .unwrap_or(false)
    {
        None
    } else {
        Some(
            value
                .height_span_definitions
                .get(id as usize)
                .copied()
                .flatten(),
        )
    }
}
fn validate_cache(
    value: &Tilemap,
    layer: &TilemapLayer,
    index: usize,
    cells: usize,
    flat: &Vec<TileCollisionRect>,
    chunks: &TileCollisionChunkCache,
    budget: &mut Budget,
) -> Result<(), Error> {
    budget.work(flat.capacity())?;
    budget.work(chunks.chunks.capacity())?;
    let columns = layer.columns.div_ceil(TILE_COLLISION_CHUNK_SIZE);
    let rows = layer.rows.div_ceil(TILE_COLLISION_CHUNK_SIZE);
    let count = (columns as usize)
        .checked_mul(rows as usize)
        .ok_or_else(|| invalid(Field::Chunks, index, Problem::Shape))?;
    if chunks.chunk_columns != columns || chunks.chunk_rows != rows || chunks.chunks.len() != count
    {
        return Err(invalid(Field::Chunks, index, Problem::Shape));
    }
    if chunks.last_rebuilt_chunks as usize > count
        || chunks.total_rebuilt_chunks < chunks.last_rebuilt_chunks
    {
        return Err(invalid(Field::Counters, index, Problem::History));
    }
    budget.work(cells)?;
    let mut covered = budget.reserve::<u8>(cells)?;
    covered.resize(cells, 0);
    let mut previous = None;
    for r in flat {
        let (end_column, end_row) = rect(r, layer, index)?;
        if previous.is_some_and(|p| p >= r.tile_index) {
            return Err(invalid(Field::Rectangles, index, Problem::Order));
        }
        previous = Some(r.tile_index);
        let area = (r.columns as usize)
            .checked_mul(r.rows as usize)
            .ok_or(Error::WorkLimit)?;
        budget.work(area)?;
        canonical_run(value, layer, index, r, end_column, end_row, budget)?;
        for row in r.min_row..end_row {
            for column in r.min_column..end_column {
                let cell = (row as usize) * (layer.columns as usize) + (column as usize);
                if covered[cell] != 0 || solid(value, layer.tiles[cell]) != Some(r.height_span) {
                    return Err(invalid(Field::Rectangles, index, Problem::Coverage));
                }
                covered[cell] = 1;
            }
        }
    }
    budget.work(cells)?;
    for (cell, &id) in layer.tiles.iter().enumerate() {
        if (covered[cell] == 1) != solid(value, id).is_some() {
            return Err(invalid(Field::Rectangles, index, Problem::Coverage));
        }
    }
    let search = (usize::BITS - flat.len().leading_zeros()) as usize + 1;
    let mut total = 0usize;
    for (chunk_index, entries) in chunks.chunks.iter().enumerate() {
        budget.work(entries.capacity())?;
        budget.work(entries.len().checked_mul(search).ok_or(Error::WorkLimit)?)?;
        total = total.checked_add(entries.len()).ok_or(Error::WorkLimit)?;
        let column = (chunk_index % (columns as usize)) as u32;
        let row = (chunk_index / (columns as usize)) as u32;
        let mut previous = None;
        for r in entries {
            let (end_column, end_row) = rect(r, layer, index)?;
            if previous.is_some_and(|p| p >= r.tile_index) {
                return Err(invalid(Field::Chunks, index, Problem::Order));
            }
            previous = Some(r.tile_index);
            if r.min_column / TILE_COLLISION_CHUNK_SIZE != column
                || r.min_row / TILE_COLLISION_CHUNK_SIZE != row
                || (end_column - 1) / TILE_COLLISION_CHUNK_SIZE != column
                || (end_row - 1) / TILE_COLLISION_CHUNK_SIZE != row
            {
                return Err(invalid(Field::Chunks, index, Problem::Membership));
            }
            let at = flat
                .binary_search_by_key(&r.tile_index, |x| x.tile_index)
                .map_err(|_| invalid(Field::Chunks, index, Problem::Membership))?;
            if flat[at] != *r {
                return Err(invalid(Field::Chunks, index, Problem::Membership));
            }
        }
    }
    if total != flat.len() {
        return Err(invalid(Field::Chunks, index, Problem::Length));
    }
    Ok(())
}
#[cfg(test)]
mod tests;

// Prove the stored run partition locally, without calling the rebuild producer.
// Merely matching occupied cells would accept observable split/merged caches.
fn canonical_run(
    value: &Tilemap,
    layer: &TilemapLayer,
    index: usize,
    r: &TileCollisionRect,
    end_column: u32,
    end_row: u32,
    budget: &mut Budget,
) -> Result<(), Error> {
    let start_column = (r.min_column / TILE_COLLISION_CHUNK_SIZE) * TILE_COLLISION_CHUNK_SIZE;
    let start_row = (r.min_row / TILE_COLLISION_CHUNK_SIZE) * TILE_COLLISION_CHUNK_SIZE;
    let chunk_end_column = start_column
        .saturating_add(TILE_COLLISION_CHUNK_SIZE)
        .min(layer.columns);
    let chunk_end_row = start_row
        .saturating_add(TILE_COLLISION_CHUNK_SIZE)
        .min(layer.rows);
    if end_column > chunk_end_column || end_row > chunk_end_row {
        return Err(invalid(Field::Rectangles, index, Problem::Membership));
    }
    budget.work((r.rows as usize).checked_mul(2).ok_or(Error::WorkLimit)?)?;
    let same = |column: u32, row: u32| {
        solid(
            value,
            layer.tiles[(row as usize) * (layer.columns as usize) + column as usize],
        ) == Some(r.height_span)
    };
    for row in r.min_row..end_row {
        if (r.min_column > start_column && same(r.min_column - 1, row))
            || (end_column < chunk_end_column && same(end_column, row))
        {
            return Err(invalid(Field::Rectangles, index, Problem::Shape));
        }
    }
    let rows = [
        r.min_row.checked_sub(1).filter(|row| *row >= start_row),
        (end_row < chunk_end_row).then_some(end_row),
    ];
    for row in rows.into_iter().flatten() {
        budget.work(r.columns as usize)?;
        let matches = (r.min_column == start_column || !same(r.min_column - 1, row))
            && (end_column == chunk_end_column || !same(end_column, row))
            && (r.min_column..end_column).all(|column| same(column, row));
        if matches {
            return Err(invalid(Field::Rectangles, index, Problem::Shape));
        }
    }
    Ok(())
}
