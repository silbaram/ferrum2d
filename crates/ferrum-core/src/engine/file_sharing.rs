//! File-only persistent Arc coordination. A file declares its graph; it does not
//! authenticate a past process. Restore consumes a NEW detached Engine, so an
//! error drops it without returning partly rebound state to a live owner.
use super::Engine;
use super::{
    file_engine_section, file_shared_arcs as arcs, unified_physics::file_admission as native,
};
use crate::physics3d::file_shared_shapes as shapes;
use std::fmt;

pub(super) type Decoded = file_engine_section::Decoded<arcs::Table, Option<shapes::Table>>;
pub(super) struct Tables {
    pub arcs: arcs::Table,
    pub shapes: Option<shapes::Table>,
}
#[derive(Clone, Copy, Debug)]
pub(super) struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
    pub max_roots: usize,
    pub max_compare_bytes: usize,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Usage {
    pub work: u64,
    /// Sum of logical scratch requests, not allocator/RSS measurement.
    pub scratch_bytes: usize,
    /// Sum of owner comparison byte models, not file wire length.
    pub compare_bytes: usize,
    pub roots: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Error {
    Work,
    Scratch,
    Roots,
    Compare,
    ShapePresence,
    Arcs(arcs::Error),
    Shapes(shapes::Error),
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "file sharing rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
fn remaining(limits: Limits, usage: Usage) -> Result<Limits, Error> {
    Ok(Limits {
        max_work: limits.max_work.checked_sub(usage.work).ok_or(Error::Work)?,
        max_scratch_bytes: limits
            .max_scratch_bytes
            .checked_sub(usage.scratch_bytes)
            .ok_or(Error::Scratch)?,
        max_roots: limits
            .max_roots
            .checked_sub(usage.roots)
            .ok_or(Error::Roots)?,
        max_compare_bytes: limits
            .max_compare_bytes
            .checked_sub(usage.compare_bytes)
            .ok_or(Error::Compare)?,
    })
}
fn arc_limits(l: Limits) -> arcs::Limits {
    arcs::Limits {
        max_work: l.max_work,
        max_scratch_bytes: l.max_scratch_bytes,
        max_roots: l.max_roots,
        max_compare_bytes: l.max_compare_bytes,
    }
}
fn shape_limits(l: Limits) -> shapes::Limits {
    shapes::Limits {
        max_work: l.max_work,
        max_scratch_bytes: l.max_scratch_bytes,
        max_roots: l.max_roots,
        max_compare_bytes: l.max_compare_bytes,
    }
}
fn begin(limits: Limits) -> Result<Usage, Error> {
    let usage = Usage {
        work: 4,
        ..Default::default()
    };
    remaining(limits, usage)?;
    Ok(usage)
}
fn add_arcs(usage: &mut Usage, value: arcs::Usage, roots: usize) -> Result<(), Error> {
    usage.work = usage.work.checked_add(value.work).ok_or(Error::Work)?;
    usage.scratch_bytes = usage
        .scratch_bytes
        .checked_add(value.scratch_bytes)
        .ok_or(Error::Scratch)?;
    usage.compare_bytes = usage
        .compare_bytes
        .checked_add(value.compare_bytes)
        .ok_or(Error::Compare)?;
    usage.roots = usage.roots.checked_add(roots).ok_or(Error::Roots)?;
    Ok(())
}
fn add_shapes(usage: &mut Usage, value: shapes::Usage, roots: usize) -> Result<(), Error> {
    usage.work = usage.work.checked_add(value.work).ok_or(Error::Work)?;
    usage.scratch_bytes = usage
        .scratch_bytes
        .checked_add(value.scratch_bytes)
        .ok_or(Error::Scratch)?;
    usage.compare_bytes = usage
        .compare_bytes
        .checked_add(value.compare_bytes)
        .ok_or(Error::Compare)?;
    usage.roots = usage.roots.checked_add(roots).ok_or(Error::Roots)?;
    Ok(())
}
/// Identity is captured from the ORIGINAL Engine, before memory decode splits
/// aliases. The Rust borrow covers both tables; SDK capture fences are separate.
/// Usage covers these tables, not the memory encoder's bounded output buffers.
pub(super) fn capture(engine: &Engine, limits: Limits) -> Result<(Tables, Usage), Error> {
    let mut usage = begin(limits)?;
    let (arcs, value) =
        arcs::capture(engine, arc_limits(remaining(limits, usage)?)).map_err(Error::Arcs)?;
    add_arcs(&mut usage, value, arcs.root_count())?;
    let shapes = if let Some(runtime) = &engine.unified_physics {
        let (table, value) =
            native::capture_shape_aliases(runtime, shape_limits(remaining(limits, usage)?))
                .map_err(Error::Shapes)?;
        add_shapes(&mut usage, value, table.root_count())?;
        Some(table)
    } else {
        None
    };
    remaining(limits, usage)?;
    Ok((Tables { arcs, shapes }, usage))
}
/// World/root/native admission precedes this pass. Both tables came from the
/// same decoder budget. Ownership prevents a second-owner failure from exposing
/// the first owner's successful changes to a caller's live Engine.
pub(super) fn restore(
    mut engine: Box<Engine>,
    tables: Tables,
    limits: Limits,
) -> Result<(Box<Engine>, Usage), Error> {
    let mut usage = begin(limits)?;
    if engine.unified_physics.is_some() != tables.shapes.is_some() {
        return Err(Error::ShapePresence);
    }
    let roots = tables
        .arcs
        .root_count()
        .checked_add(tables.shapes.as_ref().map_or(0, |v| v.root_count()))
        .ok_or(Error::Roots)?;
    if roots > limits.max_roots {
        return Err(Error::Roots);
    }
    let value = arcs::restore(
        &mut engine,
        &tables.arcs,
        arc_limits(remaining(limits, usage)?),
    )
    .map_err(Error::Arcs)?;
    add_arcs(&mut usage, value, tables.arcs.root_count())?;
    if let (Some(runtime), Some(table)) = (&mut engine.unified_physics, &tables.shapes) {
        let value =
            native::restore_shape_aliases(runtime, table, shape_limits(remaining(limits, usage)?))
                .map_err(Error::Shapes)?;
        add_shapes(&mut usage, value, table.root_count())?;
    }
    remaining(limits, usage)?;
    Ok((engine, usage))
}
