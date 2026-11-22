//! Position-only Native CCD over the complete original kernel sequence.
//! Planning is fallible and happens before persistent writeback. Application
//! preserves solved momentum and consumes the original complete slice clock.
use super::actual_scene::{ColliderTrajectory, Role};
use crate::physics3d::{
    character::CharacterRuntime,
    contact_policy::ContactPolicies,
    motion_trace::AcceptedCurve,
    solver_trajectory::{self, CastHit, Curve, Domain, ShapeMotion, Time, TrajectoryError, Work},
    BodyId,
};
use rapier3d::pipeline::{SolverCcdClamp, SolverCcdPlan, SolverMotionContext};
use rapier3d::prelude as rp;
use rapier3d::utils::PoseOps;
use std::collections::BTreeMap;
mod moving;
use moving::{Moving, Source};
const MAX: usize = 1 << 20;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::physics3d) enum PlanStatus {
    Approved,
    Promote,
}
fn id(h: rp::RigidBodyHandle) -> BodyId {
    let (slot, generation) = h.into_raw_parts();
    BodyId { slot, generation }
}
fn reserve<T>(v: &mut Vec<T>, count: usize, max_scratch: usize) -> Result<(), TrajectoryError> {
    if count > MAX
        || count
            .checked_mul(std::mem::size_of::<T>())
            .is_none_or(|b| b > max_scratch)
    {
        return Err(TrajectoryError::WorkLimit);
    }
    v.try_reserve(count.saturating_sub(v.len()))
        .map_err(|_| TrajectoryError::WorkLimit)
}
fn is_mixed(parent: Option<rp::RigidBodyHandle>, mixed: &[BodyId]) -> bool {
    parent.is_some_and(|h| mixed.binary_search(&id(h)).is_ok())
}
/// Potential native tier only. Final fast-body activation uses the actual
/// solved endpoint and vendor helper; no initial omega/speed estimate drops it.
pub(in crate::physics3d) fn defer_pair(
    a: &ColliderTrajectory,
    b: &ColliderTrajectory,
    bodies: &rp::RigidBodySet,
    continuous: bool,
    mixed: &[BodyId],
) -> bool {
    if !continuous
        || matches!(a.role, Role::Character(_))
        || matches!(b.role, Role::Character(_))
        || is_mixed(a.parent, mixed)
        || is_mixed(b.parent, mixed)
    {
        return false;
    }
    let tier = |origin: &ColliderTrajectory, target: &ColliderTrajectory| {
        let Some(rb) = origin.parent.and_then(|h| bodies.get(h)) else {
            return false;
        };
        rp::solver_ccd_body_tier_allows(rb, target.parent.and_then(|h| bodies.get(h)), false)
    };
    tier(a, b) || tier(b, a)
}
fn pair_enabled(
    a: Option<rp::RigidBodyHandle>,
    b: Option<rp::RigidBodyHandle>,
    disabled: &[(BodyId, BodyId)],
) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => {
            let (a, b) = (id(a), id(b));
            let key = if a < b { (a, b) } else { (b, a) };
            disabled.binary_search(&key).is_err()
        }
        _ => true,
    }
}
/// Endpoint bounds only nominate an axis. The original complete support-cloud
/// proof (including stored endpoints and rounded-kernel image) must certify the
/// whole interval before this axis can cull a TOI candidate. No sampled pose is
/// ever accepted as a no-hit proof. Composite/unknown roots use their normal
/// full-leaf cast instead of being silently classified as separated.
#[allow(clippy::too_many_arguments)]
fn separated_candidate(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    use rapier3d::parry::{bounding_volume::BoundingVolume, query::sweep_toi::ToiProxy};
    let (Some(pa), Some(pb)) = (ToiProxy::from_shape(sa), ToiProxy::from_shape(sb)) else {
        return Ok(false);
    };
    work.charge(
        ((pa.points().len() + pb.points().len()) as u64)
            .checked_mul(16)
            .and_then(|v| v.checked_add(16))
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    let aa = sa
        .compute_aabb(&a.pose(start))
        .merged(&sa.compute_aabb(&a.pose(end)));
    let bb = sb
        .compute_aabb(&b.pose(start))
        .merged(&sb.compute_aabb(&b.pose(end)));
    for axis in 0..3 {
        let sign = if aa.maxs[axis] + clearance < bb.mins[axis] {
            1.
        } else if bb.maxs[axis] + clearance < aa.mins[axis] {
            -1.
        } else {
            continue;
        };
        let mut normal = rp::Vector::ZERO;
        normal[axis] = sign;
        if a.separated(sa, b, sb, normal, start, end, clearance, work)? {
            return Ok(true);
        }
    }
    Ok(false)
}
/// End-frame box axes only nominate a possible plane. The original full
/// F32 curve certificate must still prove every time and every real support.
#[allow(clippy::too_many_arguments)]
fn separated_prepared(
    cache: &mut Moving<'_>,
    slot: usize,
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    use rapier3d::parry::{bounding_volume::BoundingVolume, query::sweep_toi::ToiProxy};
    let Some(pb) = ToiProxy::from_shape(sb) else {
        return Ok(false);
    };
    let moving = cache.endpoints(slot, a, start, end, work)?;
    work.charge(
        (pb.points().len() as u64)
            .checked_mul(16)
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    let end_b = b.pose(end);
    let bb = sb
        .compute_aabb(&b.pose(start))
        .merged(&sb.compute_aabb(&end_b));
    for axis in 0..3 {
        let sign = if moving.aabb.maxs[axis] + clearance < bb.mins[axis] {
            1.
        } else if bb.maxs[axis] + clearance < moving.aabb.mins[axis] {
            -1.
        } else {
            continue;
        };
        let mut normal = rp::Vector::ZERO;
        normal[axis] = sign;
        if a.separated(sa, b, sb, normal, start, end, clearance, work)? {
            return Ok(true);
        }
    }
    let Some(cuboid) = sa.as_cuboid() else {
        return Ok(false);
    };
    // End-frame AABB is only a hint, never a no-hit acceptance. Axis
    // rejection here keeps the ordinary full-shape cast for uncertain pairs.
    work.charge(
        (pb.points().len() as u64)
            .checked_mul(16)
            .and_then(|n| n.checked_add(32))
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    let relative = moving.end.inv_mul(&end_b);
    let target = sb.compute_aabb(&relative);
    for axis in 0..3 {
        let sign = if cuboid.half_extents[axis] + clearance < target.mins[axis] {
            1.
        } else if target.maxs[axis] + clearance < -cuboid.half_extents[axis] {
            -1.
        } else {
            continue;
        };
        let normal = cache.axes(slot, work)?[axis] * sign;
        if solver_trajectory::offset_box_ball_separated(
            a, sa, b, sb, normal, start, end, clearance, work,
        )? {
            return Ok(true);
        }
        if a.separated(sa, b, sb, normal, start, end, clearance, work)? {
            return Ok(true);
        }
    }
    Ok(false)
}
fn motion(
    c: &rp::Collider,
    curve: Curve,
    bodies: &rp::RigidBodySet,
) -> Result<ShapeMotion, TrajectoryError> {
    let center = c
        .parent()
        .map(|h| {
            bodies
                .get(h)
                .map(|b| b.local_center_of_mass())
                .ok_or(TrajectoryError::InvalidReference)
        })
        .transpose()?
        .unwrap_or(rp::Vector::ZERO);
    Ok(ShapeMotion {
        curve,
        local_center: center,
        local_pose: c.position_wrt_parent().copied().unwrap_or_default(),
    })
}
/// Visit the complete stored image, including original endpoint branches.
/// Cutting changes only consumer bounds; the original kernel/domain stays intact.
fn pieces(
    c: &rp::Collider,
    bodies: &rp::RigidBodySet,
    tracks: &[AcceptedCurve],
    clamps: &[SolverCcdClamp],
    domain: Domain,
    visit: &mut impl FnMut(ShapeMotion, Time, Time) -> Result<(), TrajectoryError>,
) -> Result<(), TrajectoryError> {
    let parent = c.parent();
    let clamp = parent.and_then(|h| clamps.iter().find(|v| v.body == h));
    let mut found = false;
    let mut end = domain.start;
    let rows = match parent {
        Some(h) => {
            let key = h.into_raw_parts();
            let lo = tracks.partition_point(|r| r.body.into_raw_parts() < key);
            let hi = tracks.partition_point(|r| r.body.into_raw_parts() <= key);
            &tracks[lo..hi]
        }
        None => &[],
    };
    for row in rows {
        found = true;
        if row.start_time != end || row.end_time < row.start_time || row.end_time > domain.end {
            return Err(TrajectoryError::InvalidTime);
        }
        end = row.end_time;
        let cut = clamp.map_or(domain.end, |v| v.cutoff_time);
        if row.start_time < row.end_time.min(cut) {
            visit(
                motion(c, row.curve, bodies)?,
                row.start_time,
                row.end_time.min(cut),
            )?;
        }
        if row.end_time > cut {
            visit(
                motion(
                    c,
                    Curve::Constant {
                        pose: clamp.ok_or(TrajectoryError::InvalidReference)?.end,
                        start_time: cut,
                        end_time: domain.end,
                    },
                    bodies,
                )?,
                row.start_time.max(cut),
                row.end_time,
            )?;
        }
    }
    if found {
        if end != domain.end {
            return Err(TrajectoryError::MissingBodyMotion);
        }
        return Ok(());
    }
    let pose = match parent {
        None => *c.position(),
        Some(h) => {
            let b = bodies.get(h).ok_or(TrajectoryError::InvalidReference)?;
            if !b.is_fixed() && !b.is_sleeping() {
                return Err(TrajectoryError::MissingBodyMotion);
            }
            b.position().prepend_translation(b.local_center_of_mass())
        }
    };
    let m = if parent.is_none() {
        ShapeMotion {
            curve: Curve::Constant {
                pose,
                start_time: domain.start,
                end_time: domain.end,
            },
            local_center: rp::Vector::ZERO,
            local_pose: rp::Pose::IDENTITY,
        }
    } else {
        motion(
            c,
            Curve::Constant {
                pose,
                start_time: domain.start,
                end_time: domain.end,
            },
            bodies,
        )?
    };
    visit(m, domain.start, domain.end)
}
fn tolerance(m: ShapeMotion) -> Time {
    let span = match m.curve {
        Curve::Integrated(k) => k.native.motion.end_time - k.native.motion.start_time,
        Curve::Anchored { carrier, .. } => {
            carrier.native.motion.end_time - carrier.native.motion.start_time
        }
        _ => (m.curve.times().1 - m.curve.times().0) as f32,
    };
    Time::from((span * 1e-6).max(f32::MIN_POSITIVE))
}
#[allow(clippy::too_many_arguments)]
fn pair_hit(
    moving: &mut Moving<'_>,
    ah: rp::ColliderHandle,
    b: &rp::Collider,
    bh: rp::ColliderHandle,
    policies: &ContactPolicies,
    until: Time,
    clearance: f32,
    checks: &mut usize,
    work: &mut Work,
) -> Result<Option<(CastHit, ShapeMotion)>, TrajectoryError> {
    pair_sweep(
        moving, ah, b, bh, policies, until, clearance, checks, work, true,
    )
}
/// Native counts a pseudo (sensor or solver-group excluded) pair sweep, but
/// never clamps at it; its crossings come from the final sensor coverage.
/// Only the candidate census that counts the check is needed, not a cast.
#[allow(clippy::too_many_arguments)]
fn pair_check(
    moving: &mut Moving<'_>,
    ah: rp::ColliderHandle,
    b: &rp::Collider,
    bh: rp::ColliderHandle,
    policies: &ContactPolicies,
    until: Time,
    clearance: f32,
    checks: &mut usize,
    work: &mut Work,
) -> Result<(), TrajectoryError> {
    pair_sweep(
        moving, ah, b, bh, policies, until, clearance, checks, work, false,
    )
    .map(|_| ())
}
#[allow(clippy::too_many_arguments)]
fn pair_sweep(
    moving: &mut Moving<'_>,
    ah: rp::ColliderHandle,
    b: &rp::Collider,
    bh: rp::ColliderHandle,
    policies: &ContactPolicies,
    until: Time,
    clearance: f32,
    checks: &mut usize,
    work: &mut Work,
    cast: bool,
) -> Result<Option<(CastHit, ShapeMotion)>, TrajectoryError> {
    use rapier3d::parry::bounding_volume::BoundingVolume;
    let Source {
        collider: a,
        bodies,
        tracks,
        clamps,
        domain,
    } = moving.source();
    #[cfg(test)]
    let duration = domain.end;
    let count = |parent: Option<rp::RigidBodyHandle>| -> usize {
        parent
            .map_or(1, |h| {
                let key = h.into_raw_parts();
                tracks.partition_point(|r| r.body.into_raw_parts() <= key)
                    - tracks.partition_point(|r| r.body.into_raw_parts() < key)
            })
            .max(1)
    };
    // Prepay binary searches, clamp lookup and complete source-row visits.
    let visits = (count(a.parent()) as u64 + 1)
        .checked_mul(
            count(b.parent()) as u64 + clamps.len() as u64 + 4 * u64::from(usize::BITS) + 4,
        )
        .ok_or(TrajectoryError::WorkLimit)?;
    #[cfg(test)]
    let diagnostic_pair_work_start = work.used;
    work.charge(visits).inspect_err(|_error| {
        #[cfg(test)]
        if super::backend::diagnostic_first_hit_case() {
            eprintln!("C24_NATIVE_PAIR_ERR case={:?} stage=preflight error={_error:?} pair={ah:?}/{bh:?} duration={duration} until={until} checks={} pair_work_start={diagnostic_pair_work_start} requested={visits} work={}/{}",
                std::thread::current().name(),*checks,work.used,work.limit);
        }
    })?;
    let mut first: Option<(CastHit, ShapeMotion)> = None;
    let mut counted = false;
    let mut ordinal = 0usize;
    pieces(a, bodies, tracks, clamps, domain, &mut |ma, sa, ea| {
        let piece = ordinal;
        ordinal = ordinal.checked_add(1).ok_or(TrajectoryError::WorkLimit)?;
        pieces(b, bodies, tracks, clamps, domain, &mut |mb, sb, eb| {
            if !cast && counted {
                return Ok(());
            }
            work.charge(1)?;
            let start = sa.max(sb);
            let end = ea
                .min(eb)
                .min(until)
                .min(first.map_or(until, |v| v.0.hit_time));
            if start >= end {
                return Ok(());
            }
            let (gross, slot) = moving.gross(piece, ma, start, end, work)?;
            if !gross
                .loosened(clearance)
                .intersects(&mb.bounds(b.shape(), start, end, work)?)
            {
                return Ok(());
            }
            if !policies.one_way_allows_at(ah, &ma.pose(start), b.shape(), &mb.pose(start))
                || !policies.one_way_allows_at(bh, &mb.pose(start), a.shape(), &ma.pose(start))
            {
                return Ok(());
            }
            #[cfg(test)]
            let diagnostic_candidate_work_start = work.used;
            let separated = match slot {
                Some(slot)
                    if rapier3d::parry::query::sweep_toi::ToiProxy::from_shape(b.shape())
                        .is_some() =>
                {
                    separated_prepared(
                        moving,
                        slot,
                        ma,
                        a.shape(),
                        mb,
                        b.shape(),
                        start,
                        end,
                        clearance,
                        work,
                    )
                }
                _ => separated_candidate(ma, a.shape(), mb, b.shape(), start, end, clearance, work),
            };
            if separated.inspect_err(|_error| {
                        #[cfg(test)]
                        if super::backend::diagnostic_first_hit_case() {
                            eprintln!("C24_NATIVE_PAIR_ERR case={:?} stage=candidate error={_error:?} pair={ah:?}/{bh:?} shapeA={:?} shapeB={:?} motionA={ma:?} motionB={mb:?} interval=[{start},{end}] clearance={clearance} checks={} pair_work_start={diagnostic_pair_work_start} query_work_start={diagnostic_candidate_work_start} query_work_spent={} work={}/{} phases_a={:?} phases_b={:?}",
                                std::thread::current().name(),a.shape().shape_type(),b.shape().shape_type(),
                                *checks,work.used-diagnostic_candidate_work_start,work.used,work.limit,
                                super::backend::diagnostic_kernel_phases(ma.curve,start,end),
                                super::backend::diagnostic_kernel_phases(mb.curve,start,end));
                        }
                    })? {
                        return Ok(());
                    }
            if !counted {
                *checks = checks.checked_add(1).ok_or(TrajectoryError::WorkLimit)?;
                counted = true;
            }
            if !cast {
                return Ok(());
            }
            #[cfg(test)]
            let diagnostic_query_work_start = work.used;
            let Some(hit) = solver_trajectory::cast_full_shapes_policy(
                        ma,
                        a.shape(),
                        mb,
                        b.shape(),
                        start,
                        end,
                        clearance,
                        tolerance(ma).min(tolerance(mb)),
                        work,
                        true,
                    ).inspect_err(|_error| {
                        #[cfg(test)]
                        if super::backend::diagnostic_first_hit_case() {
                            eprintln!("C24_NATIVE_PAIR_ERR case={:?} stage=cast error={_error:?} pair={ah:?}/{bh:?} shapeA={:?} shapeB={:?} motionA={ma:?} motionB={mb:?} interval=[{start},{end}] clearance={clearance} checks={} pair_work_start={diagnostic_pair_work_start} query_work_start={diagnostic_query_work_start} query_work_spent={} work={}/{} phases_a={:?} phases_b={:?}",
                                std::thread::current().name(),a.shape().shape_type(),b.shape().shape_type(),
                                *checks,work.used-diagnostic_query_work_start,work.used,work.limit,
                                super::backend::diagnostic_kernel_phases(ma.curve,start,end),
                                super::backend::diagnostic_kernel_phases(mb.curve,start,end));
                        }
                    })?
                    else {
                        return Ok(());
                    };
            if !policies.one_way_allows_at(
                ah,
                &ma.pose(hit.hit_time),
                b.shape(),
                &mb.pose(hit.hit_time),
            ) || !policies.one_way_allows_at(
                bh,
                &mb.pose(hit.hit_time),
                a.shape(),
                &ma.pose(hit.hit_time),
            ) {
                return Ok(());
            }
            if first.is_none_or(|old| hit.hit_time < old.0.hit_time) {
                first = Some((hit, ma));
            }
            Ok(())
        })
    })?;
    Ok(first)
}
fn promote(
    body: rp::RigidBodyHandle,
    mixed: &[BodyId],
    promotions: &mut Vec<BodyId>,
    work: &mut Work,
    max: usize,
) -> Result<(), TrajectoryError> {
    let key = id(body);
    work.charge((promotions.len() + 1) as u64)?;
    if mixed.binary_search(&key).is_err() {
        if let Err(at) = promotions.binary_search(&key) {
            reserve(promotions, promotions.len() + 1, max)?;
            promotions.insert(at, key);
        }
    }
    Ok(())
}
/// Native tier/filter/activation is shared with the default vendor CCD path.
/// Mixed origins already have full actual response coverage and never fall back
/// to an endpoint sweep. A late coupling promotion invalidates this entire plan.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d) fn plan(
    context: &dyn SolverMotionContext,
    params: &rp::IntegrationParameters,
    policies: &ContactPolicies,
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    tracks: &[AcceptedCurve],
    mixed: &[BodyId],
    disabled_pairs: &[(BodyId, BodyId)],
    output: &mut SolverCcdPlan,
    promotions: &mut Vec<BodyId>,
    work: &mut Work,
    max_scratch: usize,
) -> Result<PlanStatus, TrajectoryError> {
    output.clear();
    promotions.clear();
    let domain = Domain::new(context.precise_start_time(), context.precise_end_time())?;
    let duration = domain.end;
    if domain.duration() <= 0. {
        return Err(TrajectoryError::InvalidTime);
    }
    let n = context.body_count();
    work.charge((n + tracks.len() + mixed.len() + disabled_pairs.len()) as u64)?;
    if disabled_pairs.windows(2).any(|p| p[0] >= p[1]) || disabled_pairs.iter().any(|p| p.0 >= p.1)
    {
        return Err(TrajectoryError::InvalidReference);
    }
    if tracks.windows(2).any(|p| {
        let key = |r: &AcceptedCurve| (r.body.into_raw_parts(), r.start_time, r.end_time);
        let a = key(&p[0]);
        let b = key(&p[1]);
        a.0 > b.0 || (a.0 == b.0 && (a.1 > b.1 || (a.1 == b.1 && a.2 > b.2)))
    }) {
        return Err(TrajectoryError::InvalidReference);
    }
    if mixed.windows(2).any(|p| p[0] >= p[1]) {
        return Err(TrajectoryError::InvalidReference);
    }
    // Output capacity covers the whole body batch before any query/publication.
    let scratch = n
        .checked_mul(std::mem::size_of::<SolverCcdClamp>())
        .and_then(|v| {
            v.checked_add(
                tracks
                    .len()
                    .checked_mul(std::mem::size_of::<AcceptedCurve>())?,
            )
        })
        .ok_or(TrajectoryError::WorkLimit)?;
    if scratch > max_scratch {
        return Err(TrajectoryError::WorkLimit);
    }
    reserve(&mut output.clamps, n, max_scratch)?;
    // Preserve native non-bullet then bullet ordering, but consume actual
    // already-clamped target paths rather than a target's final-pose chord.
    for bullet in [false, true] {
        for slot in 0..n {
            let solved = context
                .body(slot)
                .ok_or(TrajectoryError::InvalidReference)?;
            let body = context
                .bodies()
                .get(solved.handle)
                .ok_or(TrajectoryError::InvalidReference)?;
            if mixed.binary_search(&id(solved.handle)).is_ok()
                || body.is_ccd_enabled() != bullet
                || !rp::solver_ccd_active(body, context.colliders(), solved.end, params)
            {
                continue;
            }
            let mut chosen: Option<SolverCcdClamp> = None;
            for &moving in body.colliders() {
                let a = context
                    .colliders()
                    .get(moving)
                    .ok_or(TrajectoryError::InvalidReference)?;
                if !rp::solver_ccd_shape_supported(a.shape()) {
                    continue;
                }
                let mut moving_cache = None;
                for (target, b) in context.colliders().iter_enabled() {
                    work.charge(1)?;
                    if !pair_enabled(a.parent(), b.parent(), disabled_pairs) {
                        continue;
                    }
                    let Some(pseudo) = rp::solver_ccd_pair_kind(
                        context.bodies(),
                        context.colliders(),
                        solved.handle,
                        moving,
                        target,
                        policies,
                    ) else {
                        continue;
                    };
                    if !policies.pair_allows(a.parent(), b.parent()) {
                        continue;
                    }
                    if moving_cache.is_none() {
                        moving_cache = Some(Moving::new(
                            Source {
                                collider: a,
                                bodies: context.bodies(),
                                tracks,
                                clamps: &output.clamps,
                                domain,
                            },
                            work,
                        )?);
                    }
                    let moving_cache = moving_cache
                        .as_mut()
                        .ok_or(TrajectoryError::InvalidReference)?;
                    let until = chosen.map_or(duration, |row| row.cutoff_time);
                    // Native clamp_checks includes pseudo/sensor pair sweeps.
                    // Their actual crossings are finalized once by C on the
                    // complete clipped path; they never become solid clamps.
                    if pseudo {
                        pair_check(
                            moving_cache,
                            moving,
                            b,
                            target,
                            policies,
                            until,
                            params.allowed_linear_error(),
                            &mut output.checks,
                            work,
                        )?;
                        continue;
                    }
                    let hit = pair_hit(
                        moving_cache,
                        moving,
                        b,
                        target,
                        policies,
                        until,
                        params.allowed_linear_error(),
                        &mut output.checks,
                        work,
                    )?;
                    let Some((hit, ma)) = hit else {
                        continue;
                    };
                    if is_mixed(b.parent(), mixed)
                        || b.parent()
                            .and_then(|h| context.bodies().get(h))
                            .is_some_and(|b| b.is_sleeping())
                    {
                        promote(solved.handle, mixed, promotions, work, max_scratch)?;
                        if let Some(h) = b.parent() {
                            promote(h, mixed, promotions, work, max_scratch)?;
                        }
                        continue;
                    }
                    if chosen.is_none_or(|v| {
                        hit.safe_time < v.cutoff_time
                            || (hit.safe_time == v.cutoff_time
                                && (moving.into_raw_parts(), target.into_raw_parts())
                                    < (v.moving.into_raw_parts(), v.target.into_raw_parts()))
                    }) {
                        chosen = Some(SolverCcdClamp {
                            body: solved.handle,
                            moving,
                            target,
                            end: ma.curve.com_pose(hit.safe_time),
                            cutoff_time: hit.safe_time,
                            point: hit.contact.point2,
                            normal: hit.contact.normal2,
                        });
                    }
                }
            }
            if let Some(cut) = chosen {
                output.clamps.push(cut);
            }
        }
    }
    // A stopped Native-only path can introduce a new interaction that its raw
    // moving kernel did not have. Check the full clamped image against every
    // mixed participant before publishing any position/impulse/clock.
    for index in 0..output.clamps.len() {
        let cut = output.clamps[index];
        let body = context
            .bodies()
            .get(cut.body)
            .ok_or(TrajectoryError::InvalidReference)?;
        for &moving in body.colliders() {
            let a = context
                .colliders()
                .get(moving)
                .ok_or(TrajectoryError::InvalidReference)?;
            if a.is_sensor() {
                continue;
            }
            let mut moving_cache = None;
            for (target, b) in context.colliders().iter_enabled() {
                work.charge(1)?;
                if !is_mixed(b.parent(), mixed)
                    || b.is_sensor()
                    || a.parent() == b.parent()
                    || !pair_enabled(a.parent(), b.parent(), disabled_pairs)
                    || !a.collision_groups().test(b.collision_groups())
                    || !policies.pair_allows(a.parent(), b.parent())
                {
                    continue;
                }
                let skin = b
                    .parent()
                    .and_then(|h| characters.get(&id(h)))
                    .map_or(params.allowed_linear_error(), |r| r.config.skin_width);
                let mut logical_checks = 0;
                if moving_cache.is_none() {
                    moving_cache = Some(Moving::new(
                        Source {
                            collider: a,
                            bodies: context.bodies(),
                            tracks,
                            clamps: &output.clamps,
                            domain,
                        },
                        work,
                    )?);
                }
                if pair_hit(
                    moving_cache
                        .as_mut()
                        .ok_or(TrajectoryError::InvalidReference)?,
                    moving,
                    b,
                    target,
                    policies,
                    duration,
                    skin,
                    &mut logical_checks,
                    work,
                )?
                .is_some()
                {
                    promote(cut.body, mixed, promotions, work, max_scratch)?;
                }
            }
        }
    }
    if !promotions.is_empty() {
        output.clear();
        return Ok(PlanStatus::Promote);
    }
    work.charge(
        (output.clamps.len() as u64)
            .checked_mul(16 * (usize::BITS as u64 + 1))
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    output
        .clamps
        .sort_unstable_by_key(|v| v.body.into_raw_parts());
    output.covered = true;
    Ok(PlanStatus::Approved)
}
/// Retain each original kernel and its domain/end law. Only the accepted
/// consumer range is clipped, followed by Constant pieces retaining real context boundaries.
pub(in crate::physics3d) fn clip_curves(
    plan: &SolverCcdPlan,
    source: &[AcceptedCurve],
    out: &mut Vec<AcceptedCurve>,
    work: &mut Work,
    max_scratch: usize,
) -> Result<(), TrajectoryError> {
    out.clear();
    let count = source
        .len()
        .checked_add(plan.clamps.len())
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(
        (source.len() as u64)
            .checked_mul(plan.clamps.len() as u64 + 1)
            .ok_or(TrajectoryError::WorkLimit)?,
    )?;
    reserve(out, count, max_scratch)?;
    for &row in source {
        if let Some(cut) = plan.clamps.iter().find(|v| v.body == row.body) {
            if row.start_time < cut.cutoff_time {
                out.push(AcceptedCurve {
                    end_time: row.end_time.min(cut.cutoff_time),
                    ..row
                });
            }
            if row.end_time > cut.cutoff_time {
                // Preserve every real context boundary even on the stationary
                // suffix. These are Constant observations, never fake kernels.
                out.push(AcceptedCurve {
                    body: row.body,
                    curve: Curve::Constant {
                        pose: cut.end,
                        start_time: cut.cutoff_time,
                        end_time: row.curve.times().1.max(row.end_time),
                    },
                    start_time: row.start_time.max(cut.cutoff_time),
                    end_time: row.end_time,
                });
            }
        } else {
            out.push(row);
        }
    }
    let order = |a: &AcceptedCurve, b: &AcceptedCurve| {
        a.body
            .into_raw_parts()
            .cmp(&b.body.into_raw_parts())
            .then(a.start_time.total_cmp(&b.start_time))
            .then(a.end_time.total_cmp(&b.end_time))
    };
    // Native commonly supplies one already ordered row per body. Keep the
    // original sort for unsorted rows and ties, including split clamp rows.
    work.charge((out.len() as u64).saturating_sub(1) * 16)?;
    if !out.windows(2).all(|p| order(&p[0], &p[1]).is_lt()) {
        work.charge(
            (out.len() as u64)
                .checked_mul(16 * (usize::BITS as u64 + 1))
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        out.sort_unstable_by(order);
    }
    Ok(())
}
#[cfg(test)]
mod tests;

/// Synthetic sensor crossings use Native's actual solved fast/tier policy for
/// pure Native origins. Mixed paths retain their already-authoritative policy.
pub(in crate::physics3d) fn sensor_pair(
    context: &dyn SolverMotionContext,
    params: &rp::IntegrationParameters,
    policies: &ContactPolicies,
    a: &ColliderTrajectory,
    b: &ColliderTrajectory,
    mixed: &[BodyId],
    disabled_pairs: &[(BodyId, BodyId)],
) -> bool {
    if !pair_enabled(a.parent, b.parent, disabled_pairs) {
        return false;
    }
    if is_mixed(a.parent, mixed) || is_mixed(b.parent, mixed) {
        return true;
    }
    [(*a, *b), (*b, *a)].into_iter().any(|(origin, target)| {
        let Some(h) = origin.parent else {
            return false;
        };
        let Some(body) = context.bodies().get(h) else {
            return false;
        };
        let Some(solved) = (0..context.body_count())
            .filter_map(|i| context.body(i))
            .find(|v| v.handle == h)
        else {
            return false;
        };
        rp::solver_ccd_active(body, context.colliders(), solved.end, params)
            && rp::solver_ccd_pair_kind(
                context.bodies(),
                context.colliders(),
                h,
                origin.collider,
                target.collider,
                policies,
            )
            .is_some()
    })
}
