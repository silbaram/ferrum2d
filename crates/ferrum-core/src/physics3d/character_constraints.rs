//! Closest feasible velocity for the small set of simultaneous capsule contacts.
use rapier3d::prelude as rp;
#[derive(Clone, Copy, Default)]
pub(super) struct Plane {
    pub normal: rp::Vector,
    pub offset: f32,
}
pub(super) fn project(desired: rp::Vector, planes: &[Plane]) -> Option<rp::Vector> {
    let feasible = |v: rp::Vector| {
        // Stricter than the sweep's approach threshold, otherwise a zero-time
        // contact could be rediscovered while projection leaves velocity unchanged.
        v.is_finite() && planes.iter().all(|p| p.normal.dot(v) >= p.offset - 1.0e-7)
    };
    if feasible(desired) {
        return Some(desired);
    }
    let mut best = None;
    let mut cost = f32::INFINITY;
    let mut consider = |v: rp::Vector| {
        let distance = (v - desired).length_squared();
        if distance < cost && feasible(v) {
            best = Some(v);
            cost = distance;
        }
    };
    // In three dimensions the nearest point lies on at most three independent
    // active planes. Enumeration also detects incompatible opposing constraints.
    for (i, a) in planes.iter().enumerate() {
        let aa = a.normal.length_squared();
        if aa > 1.0e-12 {
            consider(desired + a.normal * ((a.offset - a.normal.dot(desired)) / aa));
        }
        for (j, b) in planes.iter().enumerate().skip(i + 1) {
            let bb = b.normal.length_squared();
            let ab = a.normal.dot(b.normal);
            let det = aa * bb - ab * ab;
            if det > 1.0e-6 * aa * bb {
                let da = a.offset - a.normal.dot(desired);
                let db = b.offset - b.normal.dot(desired);
                consider(
                    desired
                        + a.normal * ((da * bb - db * ab) / det)
                        + b.normal * ((db * aa - da * ab) / det),
                );
            }
            for c in &planes[j + 1..] {
                let cross = b.normal.cross(c.normal);
                let det = a.normal.dot(cross);
                // Use the same squared independence threshold as the pair
                // solve. Nearly opposing normals plus a planar lock must not
                // amplify GJK roundoff into an enormous tangential escape.
                if det * det > 1.0e-6 * aa * bb * c.normal.length_squared() {
                    consider(
                        (cross * a.offset
                            + c.normal.cross(a.normal) * b.offset
                            + a.normal.cross(b.normal) * c.offset)
                            / det,
                    );
                }
            }
        }
    }
    best
}
