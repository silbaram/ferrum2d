//! File-only persistent Arc topology. Ordinary memory Serde/wire stays unchanged.
//!
//! The file graph is authoritative, not historical authentication. Capture uses
//! identity, never value deduplication. Restore certifies the full census and
//! all same-group values before a single same-value owner backing is rebound.
use super::unified_physics::Point;
use super::Engine;
use crate::entity::Entity;
use crate::world::sprite_playback::SpriteClip;
use std::mem::size_of;
use std::sync::Arc;
mod content;
mod sort;
#[cfg(test)]
mod tests;
const VERSION: u32 = 1;
const ROOT_VISIT_WORK: u64 = 16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Limits {
    pub max_work: u64,
    pub max_scratch_bytes: usize,
    pub max_roots: usize,
    pub max_compare_bytes: usize,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct Usage {
    pub work: u64,
    pub scratch_bytes: usize,
    pub compare_bytes: usize,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Invalid {
    Version,
    Census,
    Location,
    Domain,
    Group,
    Length,
    Value,
    NeedsSplit,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Error {
    Work,
    Scratch,
    Roots,
    CompareBytes,
    Allocation,
    Invalid { root: usize, reason: Invalid },
}
type Result<T = ()> = std::result::Result<T, Error>;
fn invalid(root: usize, reason: Invalid) -> Error {
    Error::Invalid { root, reason }
}
#[derive(
    Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, serde::Serialize, serde::Deserialize,
)]
enum Domain {
    Route,
    Clips,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
enum Location {
    ActorRoute {
        actor: Option<Entity>,
    },
    AgentRoute {
        index: u32,
        entity: Entity,
        route_actor: Option<Entity>,
    },
    Connector {
        entity: Entity,
        target: Entity,
    },
    CacheRoute {
        index: u32,
        target: Entity,
    },
    WorldPlayback {
        index: u32,
        generation: u32,
    },
    ProjectilePrefab {
        index: u32,
    },
    ActorPrototype {
        index: u32,
        id: u32,
        source: Entity,
    },
    Continuity {
        token: u32,
        epoch: u32,
        index: u32,
    },
}
impl Location {
    fn domain(self) -> Domain {
        match self {
            Self::ActorRoute { .. }
            | Self::AgentRoute { .. }
            | Self::Connector { .. }
            | Self::CacheRoute { .. } => Domain::Route,
            _ => Domain::Clips,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
struct Row {
    location: Location,
    domain: Domain,
    first: u32,
    len: u64,
}
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(super) struct Table {
    version: u32,
    #[serde(with = "crate::checkpoint_codec::vector")]
    rows: Vec<Row>,
}
impl Table {
    pub(super) fn root_count(&self) -> usize {
        self.rows.len()
    }
}
struct Budget {
    limits: Limits,
    usage: Usage,
}
impl Budget {
    fn new(limits: Limits) -> Self {
        Self {
            limits,
            usage: Usage::default(),
        }
    }
    fn work(&mut self, n: u64) -> Result {
        let next = self.usage.work.checked_add(n).ok_or(Error::Work)?;
        if next > self.limits.max_work {
            return Err(Error::Work);
        }
        self.usage.work = next;
        Ok(())
    }
    fn scratch(&mut self, n: usize) -> Result {
        if n > self.limits.max_scratch_bytes {
            return Err(Error::Scratch);
        }
        self.usage.scratch_bytes = self.usage.scratch_bytes.max(n);
        Ok(())
    }
    fn compare(&mut self, work: u64, bytes: usize) -> Result {
        let next = self
            .usage
            .compare_bytes
            .checked_add(bytes)
            .ok_or(Error::CompareBytes)?;
        if next > self.limits.max_compare_bytes {
            return Err(Error::CompareBytes);
        }
        self.work(work)?;
        self.usage.compare_bytes = next;
        Ok(())
    }
}
fn reserve<T>(count: usize) -> Result<Vec<T>> {
    let mut v = Vec::new();
    v.try_reserve_exact(count).map_err(|_| Error::Allocation)?;
    Ok(v)
}
fn index(i: usize) -> Result<u32> {
    u32::try_from(i).map_err(|_| Error::Roots)
}
#[derive(Clone, Copy)]
enum Root<'a> {
    Route(&'a Arc<[Point]>),
    Clips(&'a Arc<[SpriteClip]>),
}
impl Root<'_> {
    fn domain(self) -> Domain {
        match self {
            Self::Route(_) => Domain::Route,
            Self::Clips(_) => Domain::Clips,
        }
    }
    fn len(self) -> usize {
        match self {
            Self::Route(v) => v.len(),
            Self::Clips(v) => v.len(),
        }
    }
    fn identity(self) -> usize {
        match self {
            Self::Route(v) => Arc::as_ptr(v) as *const Point as usize,
            Self::Clips(v) => Arc::as_ptr(v) as *const SpriteClip as usize,
        }
    }
    fn prepared(self) -> Prepared {
        match self {
            Self::Route(v) => Prepared::Route(Arc::clone(v)),
            Self::Clips(v) => Prepared::Clips(Arc::clone(v)),
        }
    }
}
#[derive(Clone, Copy)]
struct Descriptor<'a> {
    location: Location,
    root: Root<'a>,
}
enum Prepared {
    Route(Arc<[Point]>),
    Clips(Arc<[SpriteClip]>),
}
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Key {
    domain: Domain,
    pointer: usize,
    len: usize,
    ordinal: usize,
}
fn key(d: Descriptor<'_>, ordinal: usize) -> Key {
    Key {
        domain: d.root.domain(),
        pointer: d.root.identity(),
        len: d.root.len(),
        ordinal,
    }
}
fn same_identity(a: Key, b: Key) -> bool {
    (a.domain, a.pointer, a.len) == (b.domain, b.pointer, b.len)
}

// O(1) owner length metadata; all variable walks are charged BEFORE traversal.
fn scan_work(engine: &Engine) -> Result<u64> {
    let nav = engine
        .data_scene
        .gameplay
        .combat
        .file_native_routes()
        .file_arc_scan_lengths();
    let clips = engine.data_scene.gameplay.combat.file_clip_scan_lengths();
    [
        engine.world.sprite_playbacks.len(),
        nav[0],
        nav[1],
        nav[2],
        clips[0],
        clips[1],
        engine.authoring_continuity.file_clip_scan_len(),
    ]
    .into_iter()
    .try_fold(32u64, |n, v| {
        n.checked_add((v as u64).checked_mul(8).ok_or(Error::Work)?)
            .ok_or(Error::Work)
    })
}
fn walk<'a>(
    engine: &'a Engine,
    budget: &mut Budget,
    mut visit: impl FnMut(Location, Root<'a>) -> Result,
) -> Result {
    budget.work(scan_work(engine)?)?;
    let mut emit = |location, root| {
        budget.work(ROOT_VISIT_WORK)?;
        visit(location, root)
    };
    if let Some(runtime) = &engine.unified_physics {
        if let Some((actor, arc)) = runtime.actor_navigation.file_route_arc() {
            emit(Location::ActorRoute { actor }, Root::Route(arc))?;
        }
    }
    use super::unified_physics::NativeRouteArcLocation as N;
    engine
        .data_scene
        .gameplay
        .combat
        .file_native_routes()
        .visit_file_route_arcs(&mut |location, arc| {
            let location = match location {
                N::Agent {
                    index: i,
                    entity,
                    route_actor,
                } => Location::AgentRoute {
                    index: index(i)?,
                    entity,
                    route_actor,
                },
                N::Connector { entity, target } => Location::Connector { entity, target },
                N::Cache { index: i, target } => Location::CacheRoute {
                    index: index(i)?,
                    target,
                },
            };
            emit(location, Root::Route(arc))
        })?;
    for (i, playback) in engine.world.sprite_playbacks.iter().enumerate() {
        if let Some(playback) = playback {
            let generation = engine
                .world
                .generation_at_index(i)
                .ok_or_else(|| invalid(i, Invalid::Location))?;
            emit(
                Location::WorldPlayback {
                    index: index(i)?,
                    generation,
                },
                Root::Clips(&playback.clips),
            )?;
        }
    }
    use super::data_scene_combat::CatalogClipArcLocation as C;
    engine
        .data_scene
        .gameplay
        .combat
        .visit_file_clip_arcs(&mut |location, arc| {
            let location = match location {
                C::Projectile { index: i } => Location::ProjectilePrefab { index: index(i)? },
                C::Actor {
                    index: i,
                    id,
                    source,
                } => Location::ActorPrototype {
                    index: index(i)?,
                    id,
                    source,
                },
            };
            emit(location, Root::Clips(arc))
        })?;
    engine
        .authoring_continuity
        .visit_file_clip_arcs(&mut |token, epoch, i, arc| {
            emit(
                Location::Continuity {
                    token,
                    epoch,
                    index: index(i)?,
                },
                Root::Clips(arc),
            )
        })
}
fn count(engine: &Engine, budget: &mut Budget) -> Result<usize> {
    let mut count = 0usize;
    let limit = budget.limits.max_roots;
    walk(engine, budget, |_, _| {
        count = count.checked_add(1).ok_or(Error::Roots)?;
        if count > limit || count > u32::MAX as usize {
            return Err(Error::Roots);
        }
        Ok(())
    })?;
    Ok(count)
}
fn collect<'a>(
    engine: &'a Engine,
    budget: &mut Budget,
    descriptors: &mut Vec<Descriptor<'a>>,
    keys: &mut Vec<Key>,
) -> Result {
    walk(engine, budget, |location, root| {
        let ordinal = descriptors.len();
        descriptors.push(Descriptor { location, root });
        keys.push(key(Descriptor { location, root }, ordinal));
        Ok(())
    })
}

pub(super) fn capture(engine: &Engine, limits: Limits) -> Result<(Table, Usage)> {
    let mut budget = Budget::new(limits);
    budget.work(1)?;
    let n = count(engine, &mut budget)?;
    let per = size_of::<Descriptor<'_>>()
        .checked_add(size_of::<Key>())
        .and_then(|n| n.checked_add(size_of::<Row>()))
        .ok_or(Error::Scratch)?;
    budget.scratch(n.checked_mul(per).ok_or(Error::Scratch)?)?;
    let mut descriptors = reserve(n)?;
    let mut keys = reserve(n)?;
    let mut rows = reserve(n)?;
    collect(engine, &mut budget, &mut descriptors, &mut keys)?;
    budget.work((n as u64).checked_mul(8).ok_or(Error::Work)?)?;
    for (i, d) in descriptors.iter().enumerate() {
        rows.push(Row {
            location: d.location,
            domain: d.root.domain(),
            first: index(i)?,
            len: d.root.len() as u64,
        });
    }
    sort::heap(&mut keys, &mut budget)?;
    budget.work(n as u64)?;
    let mut previous = None;
    let mut leader = 0;
    for k in keys {
        if previous.is_none_or(|p| !same_identity(p, k)) {
            leader = k.ordinal;
        }
        rows[k.ordinal].first = index(leader)?;
        previous = Some(k);
    }
    Ok((
        Table {
            version: VERSION,
            rows,
        },
        budget.usage,
    ))
}

pub(super) fn restore(engine: &mut Engine, table: &Table, limits: Limits) -> Result<Usage> {
    let (prepared, usage) = prepare(engine, table, limits)?;
    commit(engine, prepared);
    Ok(usage)
}
fn prepare(engine: &Engine, table: &Table, limits: Limits) -> Result<(Vec<Prepared>, Usage)> {
    let mut budget = Budget::new(limits);
    budget.work(1)?;
    if table.version != VERSION {
        return Err(invalid(0, Invalid::Version));
    }
    if table.rows.len() > limits.max_roots {
        return Err(Error::Roots);
    }
    let n = count(engine, &mut budget)?;
    if table.rows.len() != n {
        return Err(invalid(0, Invalid::Census));
    }
    let per = size_of::<Descriptor<'_>>()
        .checked_add(size_of::<Key>())
        .and_then(|n| n.checked_add(size_of::<Prepared>()))
        .ok_or(Error::Scratch)?;
    budget.scratch(n.checked_mul(per).ok_or(Error::Scratch)?)?;
    let mut descriptors = reserve(n)?;
    let mut keys = reserve(n)?;
    let mut prepared = reserve(n)?;
    collect(engine, &mut budget, &mut descriptors, &mut keys)?;
    budget.work((n as u64).checked_mul(16).ok_or(Error::Work)?)?;
    for (i, (row, d)) in table.rows.iter().zip(&descriptors).enumerate() {
        if row.location != d.location {
            return Err(invalid(i, Invalid::Location));
        }
        if row.domain != d.root.domain() || row.domain != row.location.domain() {
            return Err(invalid(i, Invalid::Domain));
        }
        if row.len != d.root.len() as u64 {
            return Err(invalid(i, Invalid::Length));
        }
        let g = row.first as usize;
        if g > i || table.rows[g].first as usize != g {
            return Err(invalid(i, Invalid::Group));
        }
        if table.rows[g].domain != row.domain {
            return Err(invalid(i, Invalid::Domain));
        }
        if table.rows[g].len != row.len {
            return Err(invalid(i, Invalid::Length));
        }
    }
    sort::heap(&mut keys, &mut budget)?;
    budget.work(n as u64)?;
    // A fresh memory candidate is normally fully detached. If a caller supplies
    // an already-aliased graph across declared distinct groups, splitting would
    // need a fresh allocation: reject rather than silently preserve a false tie.
    for pair in keys.windows(2) {
        if same_identity(pair[0], pair[1])
            && table.rows[pair[0].ordinal].first != table.rows[pair[1].ordinal].first
        {
            return Err(invalid(pair[1].ordinal, Invalid::NeedsSplit));
        }
    }
    for (i, row) in table.rows.iter().enumerate() {
        let g = row.first as usize;
        if i != g && !content::equal(descriptors[i].root, descriptors[g].root, &mut budget)? {
            return Err(invalid(i, Invalid::Value));
        }
    }
    // Reserve commit/clone/drop work before touching any backing. All fallible
    // checks and allocations have completed; no query/step/normalization runs.
    budget.work(scan_work(engine)?)?;
    budget.work(
        (n as u64)
            .checked_mul(ROOT_VISIT_WORK + 8)
            .ok_or(Error::Work)?,
    )?;
    for d in &descriptors {
        if let Root::Clips(arc) = d.root {
            budget.work((arc.len() as u64).checked_mul(4).ok_or(Error::Work)?)?;
        }
    }
    for row in &table.rows {
        prepared.push(descriptors[row.first as usize].root.prepared());
    }
    drop(descriptors);
    Ok((prepared, budget.usage))
}
fn commit(engine: &mut Engine, prepared: Vec<Prepared>) {
    let mut replacements = prepared.into_iter();
    let mut route = |arc: &mut Arc<[Point]>| {
        let Some(Prepared::Route(value)) = replacements.next() else {
            unreachable!("certified route census");
        };
        *arc = value;
    };
    if let Some(runtime) = &mut engine.unified_physics {
        runtime.actor_navigation.rebind_file_route_arc(&mut route);
    }
    engine
        .data_scene
        .gameplay
        .combat
        .file_native_routes_mut()
        .rebind_file_route_arcs(&mut route);
    let mut clips = |arc: &mut Arc<[SpriteClip]>| {
        let Some(Prepared::Clips(value)) = replacements.next() else {
            unreachable!("certified clip census");
        };
        *arc = value;
    };
    for playback in engine.world.sprite_playbacks.iter_mut().flatten() {
        clips(&mut playback.clips);
    }
    engine
        .data_scene
        .gameplay
        .combat
        .rebind_file_clip_arcs(&mut clips);
    engine
        .authoring_continuity
        .rebind_file_clip_arcs(&mut clips);
    debug_assert!(replacements.next().is_none());
}
