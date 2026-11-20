//! Finite features of the original boxes, convex faces and capsule segment, without a
//! heap manifold or a smooth-support convergence approximation. A positive
//! box SAT axis selects a separating face, not necessarily a closest vertex:
//! a large incident face's arbitrary corner can be far outside the other box.
use super::{TrajectoryError, Work};
use rapier3d::parry::{
    query::Contact,
    shape::{Capsule, ConvexPolyhedron, Cuboid, Segment, Triangle},
};
use rapier3d::prelude as rp;

const EDGES: [(usize, usize); 12] = [
    (0, 1),
    (2, 3),
    (4, 5),
    (6, 7),
    (0, 2),
    (1, 3),
    (4, 6),
    (5, 7),
    (0, 4),
    (1, 5),
    (2, 6),
    (3, 7),
];

pub(super) fn vertices(cuboid: &Cuboid) -> [rp::Vector; 8] {
    std::array::from_fn(|i| {
        rp::Vector::new(
            if i & 1 == 0 {
                -cuboid.half_extents.x
            } else {
                cuboid.half_extents.x
            },
            if i & 2 == 0 {
                -cuboid.half_extents.y
            } else {
                cuboid.half_extents.y
            },
            if i & 4 == 0 {
                -cuboid.half_extents.z
            } else {
                cuboid.half_extents.z
            },
        )
    })
}

fn interpolate(segment: &Segment, t: f64) -> rp::Vector {
    let t = t as f32;
    if t <= 0. {
        segment.a
    } else if t >= 1. {
        segment.b
    } else {
        segment.a + (segment.b - segment.a) * t
    }
}

// The finite feature minimization has no short-edge/parallel epsilon. The
// original f32 world endpoints are promoted only for the scalar minimizer;
// witnesses are reconstructed in their own original local segments. A cross
// product denominator avoids subtracting two nearly equal squared lengths.
fn segment_points(
    pa: &rp::Pose,
    a: &Segment,
    pb: &rp::Pose,
    b: &Segment,
) -> (rp::Vector, rp::Vector) {
    let p = (*pa * a.a).to_array().map(f64::from);
    let q = (*pb * b.a).to_array().map(f64::from);
    let end_a = (*pa * a.b).to_array().map(f64::from);
    let end_b = (*pb * b.b).to_array().map(f64::from);
    let d = std::array::from_fn::<_, 3, _>(|i| end_a[i] - p[i]);
    let e = std::array::from_fn::<_, 3, _>(|i| end_b[i] - q[i]);
    let r = std::array::from_fn::<_, 3, _>(|i| p[i] - q[i]);
    let dot = |a: [f64; 3], b: [f64; 3]| a.into_iter().zip(b).map(|(x, y)| x * y).sum::<f64>();
    let cross = |a: [f64; 3], b: [f64; 3]| {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let aa = dot(d, d);
    let ee = dot(e, e);
    let f = dot(e, r);
    let (s, t) = if aa == 0. && ee == 0. {
        (0., 0.)
    } else if aa == 0. {
        (0., (f / ee).clamp(0., 1.))
    } else {
        let c = dot(d, r);
        if ee == 0. {
            ((-c / aa).clamp(0., 1.), 0.)
        } else {
            let b = dot(d, e);
            let perpendicular = cross(d, e);
            let denominator = dot(perpendicular, perpendicular);
            let s = if denominator > 0. {
                (dot(cross(e, r), perpendicular) / denominator).clamp(0., 1.)
            } else {
                0.
            };
            let t = (b * s + f) / ee;
            if t < 0. {
                ((-c / aa).clamp(0., 1.), 0.)
            } else if t > 1. {
                (((b - c) / aa).clamp(0., 1.), 1.)
            } else {
                (s, t)
            }
        }
    };
    (interpolate(a, s), interpolate(b, t))
}

#[derive(Clone, Copy)]
struct Candidate {
    a: rp::Vector,
    b: rp::Vector,
    face: Option<rp::Vector>,
    squared: f64,
}

struct Closest<'a> {
    pa: &'a rp::Pose,
    pb: &'a rp::Pose,
    value: Option<Candidate>,
    invalid: bool,
}
impl<'a> Closest<'a> {
    fn new(pa: &'a rp::Pose, pb: &'a rp::Pose) -> Self {
        Self {
            pa,
            pb,
            value: None,
            invalid: false,
        }
    }
    fn add(&mut self, a: rp::Vector, b: rp::Vector, face: Option<rp::Vector>) {
        let world_a = (*self.pa * a).to_array().map(f64::from);
        let world_b = (*self.pb * b).to_array().map(f64::from);
        let squared = world_b
            .into_iter()
            .zip(world_a)
            .map(|(b, a)| (b - a) * (b - a))
            .sum::<f64>();
        self.invalid |= !squared.is_finite();
        if squared.is_finite() && self.value.is_none_or(|old| squared < old.squared) {
            self.value = Some(Candidate {
                a,
                b,
                face,
                squared,
            });
        }
    }
    fn contact(
        self,
        radius: f32,
        touching_normal: Option<rp::Vector>,
    ) -> Result<Option<Contact>, TrajectoryError> {
        if self.invalid {
            return Err(TrajectoryError::NonFinite);
        }
        let Candidate {
            a: local_a,
            b: local_b,
            face,
            squared,
        } = self.value.ok_or(TrajectoryError::NonFinite)?;
        let a = *self.pa * local_a;
        let core_b = *self.pb * local_b;
        if squared == 0. && touching_normal.is_none() {
            // A zero core distance needs the existing full-shape penetration
            // query; it is never turned into a manufactured zero TOI.
            return Ok(None);
        }
        let normal = face
            .or_else(|| {
                (squared > 0.).then(|| {
                    rp::Vector::from_array(std::array::from_fn(|i| {
                        ((f64::from(core_b[i]) - f64::from(a[i])) / squared.sqrt()) as f32
                    }))
                })
            })
            .or(touching_normal)
            .ok_or(TrajectoryError::NonFinite)?;
        // Keep the capsule witness in its original local frame, including
        // the radius offset. No relative-frame/world-frame round trip.
        let local_normal = (self.pb.rotation.inverse() * -normal)
            .try_normalize()
            .ok_or(TrajectoryError::NonFinite)?;
        let point_b = *self.pb * (local_b + local_normal * radius);
        let dist = (point_b - a).dot(normal);
        if !a.is_finite() || !point_b.is_finite() || !dist.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(Some(Contact::new(a, point_b, normal, -normal, dist)))
    }
}

// The projected point belongs to this original finite box. A sole clamped
// coordinate identifies a real face normal; do not derive its direction from
// two independently rounded, nearly coincident world witnesses.
fn project(
    cuboid: &Cuboid,
    pose: &rp::Pose,
    point: rp::Vector,
) -> (rp::Vector, Option<rp::Vector>) {
    let local = pose.inverse() * point;
    let projected = local.clamp(-cuboid.half_extents, cuboid.half_extents);
    let mut face = rp::Vector::ZERO;
    let mut outside = 0;
    for i in 0..3 {
        if local[i] != projected[i] {
            face[i] = if local[i] > projected[i] { 1. } else { -1. };
            outside += 1;
        }
    }
    (
        projected,
        (outside == 1)
            .then(|| pose.rotation * face)
            .and_then(|n| n.try_normalize()),
    )
}

// Every edge of a box fixes two coordinates on its boundary. If the
// other entire box is strictly inside two axis spans by more than our best
// distance, even its closest possible edge point loses the comparison.
fn edges_outside_face(
    floor: (&rp::Pose, &Cuboid),
    other: (&rp::Pose, &Cuboid),
    squared: f64,
) -> bool {
    let (pose, face) = floor;
    if pose.rotation != rp::Rotation::IDENTITY || squared <= 0. {
        return false;
    }
    // The edge interpolator may form twice a local half extent. Retain the
    // exhaustive path when any intermediate feature calculation can overflow.
    let limit = f32::MAX.sqrt();
    if [
        pose.translation,
        other.0.translation,
        face.half_extents,
        other.1.half_extents,
    ]
    .iter()
    .any(|p| p.abs().max_element() >= limit)
    {
        return false;
    }
    let Some(extents) = super::rounded::rounded_box_extents(*other.0, other.1.half_extents) else {
        return false;
    };
    let lo = *pose * -face.half_extents;
    let hi = *pose * face.half_extents;
    (0..3)
        .filter(|&i| {
            let gap = (f64::from(extents[i].0) - f64::from(lo[i]))
                .min(f64::from(hi[i]) - f64::from(extents[i].1));
            gap > 0. && gap * gap > squared
        })
        .count()
        >= 2
}

pub(super) fn cuboids(
    pa: &rp::Pose,
    a: &Cuboid,
    pb: &rp::Pose,
    b: &Cuboid,
    work: &mut Work,
) -> Result<Option<Contact>, TrajectoryError> {
    // Visit the vertex/face candidates first in their original order.
    work.charge(16 * 256 + 128)?;
    let va = vertices(a);
    let vb = vertices(b);
    let mut best = Closest::new(pa, pb);
    for &v in &va {
        let world = *pa * v;
        let (other, face) = project(b, pb, world);
        best.add(v, other, face.map(|n| -n));
    }
    for &v in &vb {
        let world = *pb * v;
        let (other, face) = project(a, pa, world);
        best.add(other, v, face);
    }
    if let Some(candidate) = best.value {
        if !best.invalid
            && (pa.rotation == rp::Rotation::IDENTITY || pb.rotation == rp::Rotation::IDENTITY)
        {
            work.charge(256)?;
            if edges_outside_face((pa, a), (pb, b), candidate.squared)
                || edges_outside_face((pb, b), (pa, a), candidate.squared)
            {
                return best.contact(0., None);
            }
        }
    }
    work.charge(144 * 256)?;
    let relative = pa.inv_mul(pb);
    for &(a0, a1) in &EDGES {
        let sa = Segment::new(va[a0], va[a1]);
        for &(b0, b1) in &EDGES {
            let sb = Segment::new(vb[b0], vb[b1]);
            let (la, lb) = segment_points(pa, &sa, pb, &sb);
            best.add(la, lb, None);
        }
    }
    // A zero world distance is an actual shared feature point. Use the real
    // SAT axis for its normal instead of normalizing the zero delta.
    use rapier3d::parry::query::sat;
    let reverse = relative.inverse();
    let one = sat::cuboid_cuboid_find_local_separating_normal_oneway(a, b, &relative);
    let two = sat::cuboid_cuboid_find_local_separating_normal_oneway(b, a, &reverse);
    let edge = sat::cuboid_cuboid_find_local_separating_edge_twoway(a, b, &relative);
    let mut axis = one;
    if two.0 > axis.0 {
        axis = (two.0, relative.rotation * -two.1);
    }
    if edge.0 > axis.0 {
        axis = edge;
    }
    best.contact(0., (pa.rotation * axis.1).try_normalize())
}

fn intersects_box(segment: &Segment, relative: &rp::Pose, cuboid: &Cuboid) -> bool {
    let a = *relative * segment.a;
    let b = *relative * segment.b;
    let mut from: f64 = 0.;
    let mut to: f64 = 1.;
    for i in 0..3 {
        let origin = f64::from(a[i]);
        let delta = f64::from(b[i]) - origin;
        let half = f64::from(cuboid.half_extents[i]);
        if delta == 0. {
            if origin < -half || origin > half {
                return false;
            }
        } else {
            let lo = (-half - origin) / delta;
            let hi = (half - origin) / delta;
            from = from.max(lo.min(hi));
            to = to.min(lo.max(hi));
            if from > to {
                return false;
            }
        }
    }
    true
}

fn first_point_minimizes_aligned_box(best: &Closest<'_>, a: &Cuboid, b: &Capsule) -> bool {
    let Some(first) = best.value else {
        return false;
    };
    let identity = rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
    if best.pa.rotation.to_array().map(f32::to_bits) != identity
        || best.pb.rotation.to_array().map(f32::to_bits) != identity
    {
        return false;
    }
    // Leave ample range for the original lerp, both world transforms and the
    // inverse translation in project(). A skipped edge must not hide an
    // overflow at an extreme coordinate.
    let limit = f32::MAX / 8.;
    if [
        best.pa.translation,
        best.pb.translation,
        a.half_extents,
        b.segment.a,
        b.segment.b,
    ]
    .into_iter()
    .any(|v| !v.abs().cmple(rp::Vector::splat(limit)).all())
    {
        return false;
    }
    let point = *best.pa * first.a;
    let core = *best.pb * first.b;
    // An upright segment entirely above the box has a fixed projection
    // onto its top in Y. The original endpoint/edge candidates keep X and Z
    // constant, and the lower endpoint attains the least world Y gap.
    if b.segment.a.x == b.segment.b.x
        && b.segment.a.z == b.segment.b.z
        && b.segment.a.y <= b.segment.b.y
        && first.a.y == a.half_extents.y
        && core.y >= point.y
    {
        return true;
    }
    let Some(normal) = first.face else {
        return false;
    };
    let axis = normal.abs().max_position();
    if normal[axis].abs() != 1. || b.segment.a[axis] != b.segment.b[axis] {
        return false;
    }
    // Every other segment point keeps the same normal coordinate, and
    // project() clamps it to the same face. The first original candidate
    // attains that squared gap with zero tangential contribution. Later
    // candidates cannot improve it, and ties already retain the first.
    (0..3).all(|i| i == axis || point[i] == core[i])
}

pub(super) fn cuboid_capsule(
    pa: &rp::Pose,
    a: &Cuboid,
    pb: &rp::Pose,
    b: &Capsule,
    work: &mut Work,
) -> Result<Option<Contact>, TrajectoryError> {
    // A separated segment/box minimum is endpoint/face or segment/edge.
    // A parallel segment/face minimum also occurs at one of those boundaries.
    // A core entering the box needs the original penetration dispatcher.
    work.charge(128)?;
    let relative = pa.inv_mul(pb);
    if intersects_box(&b.segment, &relative, a) {
        return Ok(None);
    }
    let mut best = Closest::new(pa, pb);
    work.charge(256 + 96)?;
    let (point, face) = project(a, pa, *pb * b.segment.a);
    best.add(point, b.segment.a, face);
    if first_point_minimizes_aligned_box(&best, a, b) {
        return best.contact(b.radius, None);
    }
    work.charge(13 * 256)?;
    let (point, face) = project(a, pa, *pb * b.segment.b);
    best.add(point, b.segment.b, face);
    let va = vertices(a);
    for &(a0, a1) in &EDGES {
        let edge = Segment::new(va[a0], va[a1]);
        let (_, local) = segment_points(pa, &edge, pb, &b.segment);
        // Project that original segment point onto the whole finite box.
        // This retains the exact selected face normal when the segment is
        // parallel to a face; an edge's independently rounded world delta
        // must not manufacture a tangent component of the normal.
        let (point, face) = project(a, pa, *pb * local);
        best.add(point, local, face);
    }
    best.contact(b.radius, None)
}

#[derive(Clone, Copy)]
pub(super) enum RampFaces<'a> {
    Hull(&'a ConvexPolyhedron),
    Triangle(&'a Triangle),
}

impl<'a> RampFaces<'a> {
    pub(super) fn from_shape(shape: &'a dyn rp::Shape) -> Option<Self> {
        if let Some(hull) = shape.as_convex_polyhedron() {
            Some(Self::Hull(hull))
        } else {
            shape.as_triangle().map(Self::Triangle)
        }
    }

    fn points(self) -> &'a [rp::Vector] {
        match self {
            Self::Hull(hull) => hull.points(),
            Self::Triangle(triangle) => triangle.vertices(),
        }
    }

    fn face(self, index: usize) -> (&'a [u32], Option<rp::Vector>) {
        match self {
            Self::Hull(hull) => {
                let face = &hull.faces()[index];
                let start = face.first_vertex_or_edge as usize;
                let end = start + face.num_vertices_or_edges as usize;
                (&hull.vertices_adj_to_face()[start..end], Some(face.normal))
            }
            // A mesh leaf has two sides and exactly three original vertices.
            Self::Triangle(_) if index == 0 => (&[0, 1, 2], None),
            Self::Triangle(_) => (&[0, 2, 1], None),
        }
    }
}

pub(super) fn ramp_capsule_contact(
    pa: &rp::Pose,
    ramp: RampFaces<'_>,
    pb: &rp::Pose,
    capsule: &Capsule,
    clearance: Option<f32>,
    work: &mut Work,
) -> Result<Option<Contact>, TrajectoryError> {
    if pa.rotation != rp::Rotation::IDENTITY
        || pb.rotation != rp::Rotation::IDENTITY
        || !capsule.radius.is_finite()
        || capsule.radius <= 0.
    {
        return Ok(None);
    }
    let axis = [capsule.segment.a, capsule.segment.b];
    let point_at = |point: rp::Vector| (*pa * point).as_dvec3();
    let outward_distance = |value: f64| {
        let rounded = value as f32;
        if f64::from(rounded) < value {
            rounded.next_up()
        } else {
            rounded
        }
    };
    let points = ramp.points();
    let face_count = match ramp {
        RampFaces::Hull(hull) => hull.faces().len(),
        RampFaces::Triangle(_) => 2,
    };
    for index in 0..face_count {
        work.charge(160)?;
        let (indices, outward) = ramp.face(index);
        let count = indices.len();
        if count < 3 {
            continue;
        }
        let vertex = |i: usize| point_at(points[indices[i] as usize]);
        let origin = vertex(0);
        let plane = (vertex(1) - origin).cross(vertex(2) - origin);
        if !plane.is_finite()
            || outward.is_some_and(|n| plane.dot(n.as_dvec3()) <= 0.)
            || plane.to_array().into_iter().filter(|&v| v != 0.).count() != 2
        {
            continue;
        }
        let normal = plane.normalize();
        let distance = |point: rp::Vector| ((*pb * point).as_dvec3() - origin).dot(normal);
        let [a, b] = axis.map(distance);
        let (core, distance) = if a <= b { (axis[0], a) } else { (axis[1], b) };
        if !distance.is_finite() || distance <= 0. {
            continue;
        }
        // A nearest core endpoint inside a supporting face attains the
        // plane's distance bound. Edges and core overlap keep the old query.
        let core_world = (*pb * core).as_dvec3();
        let projected = core_world - normal * distance;
        work.charge(count as u64 * 32)?;
        if (0..count).any(|i| {
            let from = vertex(i);
            let to = vertex((i + 1) % count);
            plane.dot(from - origin) != 0. || (to - from).cross(projected - from).dot(plane) <= 0.
        }) {
            continue;
        }
        work.charge(points.len() as u64 * 24)?;
        if points.iter().any(|&v| plane.dot(point_at(v) - origin) > 0.) {
            continue;
        }
        let n = normal.as_vec3();
        let radius = f64::from(capsule.radius);
        let mut contact = Contact::new(
            projected.as_vec3(),
            (core_world - normal * radius).as_vec3(),
            n,
            -n,
            outward_distance((distance - radius).next_up()),
        );
        let major = n.abs().max_position();
        let tangent = (0..3).find(|&i| i != major && n[i] != 0.);
        let Some(tangent) = tangent else {
            return Ok(Some(contact));
        };
        let sign = -n[major].signum();
        let translate = sign * pb.translation[major];
        let end = sign * core[major];
        let center = sign * (*pb * (core - n * capsule.radius))[major];
        let sq_radius = radius * radius;
        let cell_start = |value: f32| (f64::from(value) + f64::from(value.next_down())) * 0.5;
        for cell in [center.next_down(), center, center.next_up()] {
            work.charge(256)?;
            // Find an actual point on the round end that reaches this
            // neighboring rounded world coordinate. Check both original
            // additions, since a tie can pick either adjacent coordinate.
            let mut local = outward_distance(cell_start(cell) - f64::from(translate));
            if translate + local < cell {
                local = local.next_up();
            }
            let mut axial = outward_distance(cell_start(local) - f64::from(end));
            if end + axial < local {
                axial = axial.next_up();
            }
            let squared = f64::from(axial) * f64::from(axial);
            if !squared.is_finite() || squared >= sq_radius {
                continue;
            }
            let tangent_offset = (sq_radius - squared).next_down().sqrt() as f32;
            let tangent_offset =
                if (f64::from(tangent_offset).powi(2) + squared).next_up() > sq_radius {
                    tangent_offset.next_down()
                } else {
                    tangent_offset
                };
            let mut offset = rp::Vector::ZERO;
            offset[major] = sign * axial;
            offset[tangent] = -n[tangent].signum() * tangent_offset;
            let point2 = *pb * (core + offset);
            let distance = (point2.as_dvec3() - origin).dot(normal);
            let dist = outward_distance(distance.next_up());
            if !dist.is_finite() || dist >= contact.dist {
                continue;
            }
            let projected = point2.as_dvec3() - normal * distance;
            work.charge(count as u64 * 32)?;
            if (0..count).any(|i| {
                let from = vertex(i);
                let to = vertex((i + 1) % count);
                (to - from).cross(projected - from).dot(plane) <= 0.
            }) {
                continue;
            }
            contact = Contact::new(projected.as_vec3(), point2, n, -n, dist);
        }
        if let Some(clearance) = clearance.filter(|&limit| contact.dist > limit) {
            let inward = -plane.as_vec3();
            if inward.as_dvec3() != -plane {
                return Ok(Some(contact));
            }
            let target = inward.as_dvec3().dot(origin) - f64::from(clearance) * plane.length();
            if let Some(point2) = super::rounded::rounded_cap_plane_witness(
                pb.translation,
                core,
                capsule.radius,
                inward,
                target,
                |_| true,
                work,
            )? {
                let distance = (point2.as_dvec3() - origin).dot(normal);
                let dist = outward_distance(distance.next_up());
                let projected = point2.as_dvec3() - normal * distance;
                work.charge(count as u64 * 32)?;
                if dist <= clearance
                    && (0..count).all(|i| {
                        let from = vertex(i);
                        let to = vertex((i + 1) % count);
                        (to - from).cross(projected - from).dot(plane) > 0.
                    })
                {
                    return Ok(Some(Contact::new(projected.as_vec3(), point2, n, -n, dist)));
                }
            }
        }
        return Ok(Some(contact));
    }
    match ramp {
        RampFaces::Hull(hull) => convex_edge_capsule(pa, hull, pb, capsule, clearance, work),
        RampFaces::Triangle(_) => Ok(None),
    }
}

fn convex_edge_capsule(
    pa: &rp::Pose,
    hull: &ConvexPolyhedron,
    pb: &rp::Pose,
    capsule: &Capsule,
    clearance: Option<f32>,
    work: &mut Work,
) -> Result<Option<Contact>, TrajectoryError> {
    let local = [capsule.segment.a, capsule.segment.b];
    let axis = (local[1] - local[0]).abs().max_position();
    if (0..3).any(|i| i != axis && local[0][i] != local[1][i]) {
        return Ok(None);
    }
    let core = local.map(|point| (*pb * point).as_dvec3());
    let point = |i| (*pa * hull.points()[i as usize]).as_dvec3();
    let radius = f64::from(capsule.radius);
    let outward = |value: f64| {
        let rounded = value as f32;
        if f64::from(rounded) < value {
            rounded.next_up()
        } else {
            rounded
        }
    };
    for edge in hull.edges() {
        work.charge(128)?;
        let [a, b] = edge.vertices.map(point);
        let tangent = (b - a).abs().max_position();
        if tangent == axis
            || (0..3).any(|i| i != tangent && a[i] != b[i])
            || core[0][tangent] <= a[tangent].min(b[tangent])
            || core[0][tangent] >= a[tangent].max(b[tangent])
        {
            continue;
        }
        let ia = usize::from((core[1][axis] - a[axis]).abs() < (core[0][axis] - a[axis]).abs());
        if (core[0][axis] - a[axis]) * (core[1][axis] - a[axis]) <= 0. {
            continue;
        }
        let mut edge_point = a;
        edge_point[tangent] = core[ia][tangent];
        let offset = core[ia] - edge_point;
        let distance = offset.length();
        if !distance.is_finite()
            || distance <= radius
            || offset.to_array().into_iter().filter(|&v| v != 0.).count() != 2
        {
            continue;
        }
        work.charge(hull.points().len() as u64 * 24)?;
        if hull
            .points()
            .iter()
            .any(|&v| ((*pa * v).as_dvec3() - edge_point).dot(offset) > 0.)
        {
            continue;
        }
        let normal = offset / distance;
        let n = normal.as_vec3();
        let point1 = edge_point.as_vec3();
        let dist = outward((distance - radius).next_up());
        if let Some(clearance) = clearance.filter(|&margin| dist > margin) {
            let inward = -offset.as_vec3();
            if inward.as_dvec3() == -offset {
                let margin = f64::from(clearance);
                let target = inward.as_dvec3().dot(edge_point) - margin * distance;
                let gap = |p: rp::Vector| (p.as_dvec3() - edge_point).length().next_up();
                if let Some(witness) = super::rounded::rounded_cap_plane_witness(
                    pb.translation,
                    local[ia],
                    capsule.radius,
                    inward,
                    target,
                    |p| gap(p) <= margin,
                    work,
                )? {
                    return Ok(Some(Contact::new(
                        point1,
                        witness,
                        n,
                        -n,
                        outward(gap(witness)),
                    )));
                }
            }
        }
        let point2 = (core[ia] - normal * radius).as_vec3();
        return Ok(Some(Contact::new(point1, point2, n, -n, dist)));
    }
    Ok(None)
}

#[test]
fn sloped_convex_face_distinguishes_adjacent_capsule_contact_cells() {
    let hull = ConvexPolyhedron::from_convex_hull(&[
        rp::Vector::new(-15., -2., -10.),
        rp::Vector::new(-15., -2., 10.),
        rp::Vector::new(-15., -1., -10.),
        rp::Vector::new(-15., -1., 10.),
        rp::Vector::new(15., -2., -10.),
        rp::Vector::new(15., -2., 10.),
        rp::Vector::new(15., 2., -10.),
        rp::Vector::new(15., 2., 10.),
    ])
    .unwrap();
    let ramp = rp::Pose::from_translation(rp::Vector::new(5., 1., 0.));
    let capsule = Capsule::new_y(0.5, 0.25);
    let mut work = Work {
        used: 0,
        limit: 16 * 1024,
    };
    let mut at = |height, z| {
        let pose = rp::Pose::from_translation(rp::Vector::new(0.5, height, z));
        ramp_capsule_contact(
            &ramp,
            RampFaces::Hull(&hull),
            &pose,
            &capsule,
            None,
            &mut work,
        )
        .unwrap()
    };
    let y = 1.8112969_f32;
    let clear = at(y, 0.).unwrap();
    let touching = at(y.next_down(), 0.).unwrap();
    assert!(clear.dist > 0.01 && touching.dist < 0.01);
    assert_eq!(clear.normal1, touching.normal1);
    assert!(at(y, 10.5).is_none());
}

#[test]
fn triangle_ramp_capsule_contacts_use_both_finite_faces_and_keep_edges() {
    let triangle = Triangle::new(
        rp::Vector::new(0., 0., -2.),
        rp::Vector::new(0., 0., 2.),
        rp::Vector::new(4., 2., 2.),
    );
    let capsule = Capsule::new_y(0.5, 0.4);
    let mut work = Work {
        used: 0,
        limit: 256 * 1024,
    };
    let mut at = |triangle: &Triangle, center: rp::Vector| {
        ramp_capsule_contact(
            &rp::Pose::IDENTITY,
            RampFaces::Triangle(triangle),
            &rp::Pose::from_translation(center),
            &capsule,
            Some(0.01),
            &mut work,
        )
        .unwrap()
    };
    let normal = triangle.normal().unwrap();
    let point = rp::Vector::new(1., 0.5, 1.);
    for tri in [triangle, Triangle::new(triangle.a, triangle.c, triangle.b)] {
        for sign in [-1., 1.] {
            for gap in [0.00999, 0.01001] {
                let center = point + (normal * (0.4 + gap) + rp::Vector::Y * 0.5) * sign;
                let contact = at(&tri, center).unwrap();
                assert_eq!(contact.dist <= 0.01, gap <= 0.01);
                assert!(contact.normal1.dot(normal) * sign > 0.9999);
            }
        }
        let original = rp::Vector::new(-0.072434485, 0.9221787, -1.7876147e-6);
        assert!(at(&tri, original).unwrap().dist > 0.01);
        assert!(at(&tri, original - 1.0e-5 * rp::Vector::Y).unwrap().dist < 0.01);
        assert!(at(&tri, original + 5. * rp::Vector::Z).is_none());
    }
    let near_edge = rp::Pose::from_translation(rp::Vector::new(-0.405, 0.5, 0.));
    assert!(at(&triangle, near_edge.translation).is_none());
    let edge = super::leaf_contact(
        &rp::Pose::IDENTITY,
        &triangle,
        &near_edge,
        &capsule,
        &mut work,
    )
    .unwrap();
    assert!(edge.dist > 0. && edge.dist < 0.01);
}

#[test]
fn aligned_box_face_and_edge_keep_exhaustive_first_witness_bits() {
    let cube = Cuboid::new(rp::Vector::new(0.25, 2., 5.));
    let capsule = Capsule::new_y(0.25, 0.25);
    let bits = |c: Contact| {
        [c.point1, c.point2, c.normal1, c.normal2].map(|v| v.to_array().map(f32::to_bits))
    };
    let pa = rp::Pose::from_translation(rp::Vector::Y * 90.);
    for (x, y) in [
        ((-0.51_f32).next_up(), 90.),
        (0.51_f32.next_up(), 90.),
        (0.35, 92.5),
    ] {
        let pb = rp::Pose::from_translation(rp::Vector::new(x, y, 0.));
        let mut reference = Closest::new(&pa, &pb);
        let mut project_point = |local| {
            let (point, face) = project(&cube, &pa, pb * local);
            reference.add(point, local, face);
        };
        for local in [capsule.segment.a, capsule.segment.b] {
            project_point(local);
        }
        let corners = vertices(&cube);
        for (a, b) in EDGES {
            let edge = Segment::new(corners[a], corners[b]);
            let (_, local) = segment_points(&pa, &edge, &pb, &capsule.segment);
            project_point(local);
        }
        let reference = reference.contact(capsule.radius, None).unwrap().unwrap();
        let mut work = Work {
            used: 0,
            limit: 1024,
        };
        let fast = cuboid_capsule(&pa, &cube, &pb, &capsule, &mut work)
            .unwrap()
            .unwrap();
        assert_eq!(bits(fast), bits(reference));
        assert_eq!(fast.dist.to_bits(), reference.dist.to_bits());
    }
}

#[test]
fn rotated_box_over_a_wide_face_preserves_the_nearest_vertex_in_both_orders() {
    let floor = Cuboid::new(rp::Vector::new(20., 0.1, 20.));
    let floor_pose = rp::Pose::from_translation(-0.1 * rp::Vector::Y);
    let cube = Cuboid::new(rp::Vector::new(0.08, 0.3, 0.08));
    let pose = rp::Pose::from_parts(
        rp::Vector::new(-10., 0.5, 0.4),
        rp::Rotation::from_rotation_x(0.2) * rp::Rotation::from_rotation_z(0.07),
    );
    let lowest = vertices(&cube)
        .map(|p| pose * p)
        .into_iter()
        .min_by(|a, b| a.y.total_cmp(&b.y))
        .unwrap();
    for flip in [false, true] {
        let mut work = Work {
            used: 0,
            limit: 5000,
        };
        let hit = if flip {
            cuboids(&pose, &cube, &floor_pose, &floor, &mut work)
                .unwrap()
                .unwrap()
                .flipped()
        } else {
            cuboids(&floor_pose, &floor, &pose, &cube, &mut work)
                .unwrap()
                .unwrap()
        };
        assert_eq!(hit.point2, lowest);
        assert_eq!(hit.point1, rp::Vector::new(lowest.x, 0., lowest.z));
        assert_eq!(hit.normal1, rp::Vector::Y);
        assert_eq!(hit.dist, lowest.y);
    }
    let edge = rp::Pose::from_parts(rp::Vector::new(20., 0.5, 0.4), pose.rotation);
    assert!(!edges_outside_face(
        (&floor_pose, &floor),
        (&edge, &cube),
        1.
    ));
}
