//! One finite core-feature direction for capsule pairs whose GJK endpoint
//! witness normal need not separate the full segments. It is only a hint:
//! every time, full core and both original radius graphs still pass through
//! the existing whole-F32 support certificate. No query result is replaced.
use super::*;
use crate::physics3d::solver_trajectory::rounded::integrated_linear::shared_yaw_capsule_centers;
use rapier3d::parry::query::details::closest_points_segment_segment_with_locations_nD;

// One bounded phase: two original shape poses, four endpoint transforms,
// the original fixed-branch segment procedure and one normalization. Logical
// work only; this is not an instruction, elapsed-time or RSS upper bound.
const CANDIDATE_WORK: u64 = 1024;

pub(in crate::physics3d::solver_trajectory::rounded::output) fn capsule_separation(
    context: Context<'_>,
    a: &Frames,
    b: &Frames,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (Some(ca), Some(cb)) = (context.sa.as_capsule(), context.sb.as_capsule()) else {
        return Ok(false);
    };
    work.charge(CANDIDATE_WORK)?;
    let pose_a = context.a.pose(context.start);
    let pose_b = context.b.pose(context.start);
    let sa = ca.segment.transformed(&pose_a);
    let sb = cb.segment.transformed(&pose_b);
    if [sa.a, sa.b, sb.a, sb.b].iter().any(|p| !p.is_finite()) {
        return Ok(false);
    }
    let (la, lb) = closest_points_segment_segment_with_locations_nD((&sa.a, &sa.b), (&sb.a, &sb.b));
    let first = sa.point_at(&la);
    let second = sb.point_at(&lb);
    let Some(normal) = (second - first).try_normalize() else {
        // Coincident/degenerate cores or overflow in this optional hint do
        // not establish contact, separation or a new mandatory error path.
        return Ok(false);
    };
    if !normal.is_finite() {
        return Ok(false);
    }
    if normal.y == 0. && normal.x != 0. && normal.z != 0. && a.len != 0 && b.len != 0 {
        if let Some(centers) = shared_yaw_capsule_centers(
            context.a,
            context.b,
            normal,
            context.start,
            context.end,
            work,
        )? {
            work.charge(4096 + (a.len + b.len) as u64 * 64)?;
            let upper = capsule_ball::centered_support(
                union(a),
                [ca.segment.a, ca.segment.b],
                ca.radius,
                normal,
            );
            let lower = capsule_ball::centered_support(
                union(b),
                [cb.segment.a, cb.segment.b],
                cb.radius,
                -normal,
            );
            if let (Some(upper), Some(reverse)) = (upper, lower) {
                let length = super::super::super::dot(normal, normal).sqrt();
                if centers
                    .sub(Bound::exact(upper))
                    .sub(Bound::exact(reverse))
                    .sub(Bound::exact(f64::from(context.clearance)).mul(length))
                    .lo
                    > 0.
                {
                    return Ok(true);
                }
            }
        }
    }
    let pa = ToiProxy::from_array([ca.segment.a, ca.segment.b], ca.radius);
    let pb = ToiProxy::from_array([cb.segment.a, cb.segment.b], cb.radius);
    // A separate single record leaves the original <=14 witness/box-axis
    // plan and its order unchanged. All cloud/point visits prepay the same
    // caller ledger in separated_axes; no default allowance is introduced.
    let mut axis = super::super::super::super::SeparationAxis {
        normal,
        ..super::super::super::super::SeparationAxis::EMPTY
    };
    separated_axes(
        a,
        &pa,
        b,
        &pb,
        std::slice::from_mut(&mut axis),
        context.clearance,
        work,
    )?;
    if axis.full_support.unwrap_or(false) {
        return Ok(true);
    }
    axial_pole(a, ca, b, cb, sb.a - sa.a, context.clearance, work)
}

fn axial_pole(
    a: &Frames,
    ca: &rp::Capsule,
    b: &Frames,
    cb: &rp::Capsule,
    mut core_delta: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if clearance <= 0. || a.len == 0 || b.len == 0 {
        return Ok(false);
    }
    let ax = (0..3).find(|&i| ca.segment.a[i] != ca.segment.b[i]);
    let Some(ax) = ax else { return Ok(false) };
    if (0..3).any(|i| {
        i != ax && (ca.segment.a[i] != ca.segment.b[i] || cb.segment.a[i] != cb.segment.b[i])
    }) {
        return Ok(false);
    }
    let spins_about_core = |frame: Frame| {
        let q = frame.rotation.components;
        !exact_value(q[ax], 0.) && (0..3).all(|i| i == ax || exact_value(q[i], 0.))
    };
    if !spins_about_core(a.values[0]) || !spins_about_core(b.values[0]) {
        return Ok(false);
    }
    work.charge((a.len + b.len) as u64 * 64)?;
    let fa = union(a);
    let fb = union(b);
    if !spins_about_core(fa) || !spins_about_core(fb) {
        return Ok(false);
    }
    // The closest-segment nominee may include an axial component from the
    // rounded endpoints. A transverse axis avoids extending that error
    // along both full cores. The sphere support still covers both RN graphs.
    work.charge(4096)?;
    core_delta[ax] = 0.;
    let Some(n) = core_delta.try_normalize() else {
        return Ok(false);
    };
    let length = super::super::super::dot(n, n).sqrt();
    let Some(upper) = capsule_ball::rounded_support(fa, [ca.segment.a, ca.segment.b], ca.radius, n)
    else {
        return Ok(false);
    };
    let Some(lower) =
        capsule_ball::rounded_support(fb, [cb.segment.a, cb.segment.b], cb.radius, -n)
    else {
        return Ok(false);
    };
    Ok(Bound::exact(-lower)
        .sub(Bound::exact(upper))
        .sub(Bound::exact(f64::from(clearance)).mul(length))
        .lo
        > 0.)
}

#[cfg(test)]
mod tests;
