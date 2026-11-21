//! Cold local scratch admission after bounded decode and World/native admission.
//! Work is logical precharged traversal/backing/sort work. Scratch is cumulative
//! fallible payload reservation requests, not allocator RSS or decode admission.
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
pub(crate) enum Owner {
    Collision,
    Kinematic,
    Rigid,
    Graph,
    Schedule,
    Buckets,
    Sleep,
    Constraint,
    ContactCache,
    Split,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Problem {
    Length,
    Number,
    Range,
    Order,
    Duplicate,
    Reference,
    Geometry,
    Membership,
    Cycle,
    Key,
    History,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Error {
    WorkLimit,
    ScratchLimit,
    Allocation,
    Invalid {
        owner: Owner,
        field: &'static str,
        index: usize,
        problem: Problem,
    },
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "scratch file admission rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
pub(crate) fn require(
    ok: bool,
    owner: Owner,
    field: &'static str,
    index: usize,
    problem: Problem,
) -> Result<(), Error> {
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid {
            owner,
            field,
            index,
            problem,
        })
    }
}
pub(crate) struct Budget {
    limits: Limits,
    pub usage: Usage,
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
    pub(crate) fn vector<T>(&mut self, v: &Vec<T>) -> Result<(), Error> {
        self.work(v.capacity())?;
        self.work(v.len())
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
pub(crate) fn finite(v: &[f32]) -> bool {
    v.iter().all(|x| x.is_finite())
}
pub(crate) fn span(v: crate::components::HeightSpan) -> bool {
    finite(&[v.elevation, v.height]) && v.height >= 0.0
}
pub(crate) fn key(k: ColliderKey) -> bool {
    u32::try_from(k.entity_index).is_ok()
        && k.segment_index < crate::components::MAX_CHAIN_COLLIDER_VERTICES
}
pub(crate) fn key_tuple(k: ColliderKey) -> (usize, usize, usize) {
    (k.entity_index, k.collider_index, k.segment_index)
}
pub(crate) fn pair(p: CollisionPair) -> bool {
    p.a.id != p.b.id
}
pub(crate) fn collider_pair(p: ColliderPair) -> bool {
    key(p.a) && key(p.b) && p.a.entity_index != p.b.entity_index
}
pub(crate) fn pair_corresponds(c: ColliderPair, p: CollisionPair) -> bool {
    collider_pair(c)
        && pair(p)
        && c.a.entity_index == p.a.id as usize
        && c.b.entity_index == p.b.id as usize
}
pub(crate) fn contact(c: ColliderCollisionContact) -> bool {
    pair_corresponds(c.collider_pair, c.contact.pair)
        && finite(&[
            c.contact.normal_x,
            c.contact.normal_y,
            c.contact.penetration,
            c.contact.point_x,
            c.contact.point_y,
        ])
        && c.contact.penetration >= 0.0
}
pub(crate) fn manifold(c: ColliderCollisionManifold) -> bool {
    let v = c.manifold;
    pair_corresponds(c.collider_pair, v.pair)
        && v.point_count as usize <= MAX_COLLISION_MANIFOLD_POINTS
        && finite(&[v.normal_x, v.normal_y, v.penetration])
        && v.penetration >= 0.0
        && v.points
            .iter()
            .all(|p| finite(&[p.point_x, p.point_y, p.penetration]) && p.penetration >= 0.0)
}
pub(crate) fn impulse(v: crate::components::RigidContactImpulse) -> bool {
    v.entity_a.id != v.entity_b.id
        && finite(&[
            v.point_x,
            v.point_y,
            v.normal_x,
            v.normal_y,
            v.normal_impulse,
            v.tangent_impulse,
        ])
}
pub(crate) fn shape(v: ColliderShapeRef) -> bool {
    if !collider_shape_is_valid(v) {
        return false;
    }
    match v {
        ColliderShapeRef::Aabb(c) => finite(&[c.half_width, c.half_height, c.offset_x, c.offset_y]),
        ColliderShapeRef::Circle(c) => finite(&[c.radius, c.offset_x, c.offset_y]),
        ColliderShapeRef::OrientedBox(c, r) => finite(&[
            c.half_width,
            c.half_height,
            c.offset_x,
            c.offset_y,
            c.rotation_radians,
            r,
        ]),
        ColliderShapeRef::Capsule(c) => finite(&[
            c.start_x, c.start_y, c.end_x, c.end_y, c.radius, c.offset_x, c.offset_y,
        ]),
        ColliderShapeRef::Edge(c) => finite(&[
            c.start_x, c.start_y, c.end_x, c.end_y, c.offset_x, c.offset_y,
        ]),
        ColliderShapeRef::ConvexPolygon(c, r) => {
            finite(&[c.offset_x, c.offset_y, c.rotation_radians, r])
                && c.vertices.iter().all(|p| finite(&[p.x, p.y]))
        }
    }
}
pub(crate) fn keys(
    v: &Vec<ColliderKey>,
    b: &mut Budget,
    owner: Owner,
    field: &'static str,
) -> Result<(), Error> {
    b.vector(v)?;
    for (i, &k) in v.iter().enumerate() {
        require(key(k), owner, field, i, Problem::Range)?;
        if i > 0 {
            require(
                key_tuple(v[i - 1]) < key_tuple(k),
                owner,
                field,
                i,
                Problem::Order,
            )?;
        }
    }
    Ok(())
}
pub(crate) fn unique_indices(
    v: &Vec<usize>,
    b: &mut Budget,
    owner: Owner,
    field: &'static str,
) -> Result<(), Error> {
    b.vector(v)?;
    b.sort(v.len())?;
    let mut copy = b.reserve::<usize>(v.len())?;
    for (i, &x) in v.iter().enumerate() {
        require(u32::try_from(x).is_ok(), owner, field, i, Problem::Range)?;
        copy.push(x);
    }
    copy.sort_unstable();
    require(
        !copy.windows(2).any(|w| w[0] == w[1]),
        owner,
        field,
        0,
        Problem::Duplicate,
    )
}

#[cfg(test)]
pub(crate) mod test_support;
