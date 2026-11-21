//! Axis-independent finite parameter images and original leaf-query results.
//! This owner is private to one immutable pair/interval. It caches executed
//! readonly work only; every axis retains its original plane/refutation order.
use super::output::Context;
use super::*;

pub(super) struct Cache<'a> {
    context: Context<'a>,
    attempted: bool,
    prepared: Option<Prepared<'a>>,
}
struct Prepared<'a> {
    ia: Image,
    ib: Image,
    poses_a: Poses,
    poses_b: Poses,
    pa: ToiProxy<'a>,
    pb: ToiProxy<'a>,
    axis_work: u64,
    axis_prepaid: bool,
    // None: not visited; Some(None): Native-clear but static proof unavailable;
    // Some(Some(false)): original Native contact; Some(Some(true)): full clear.
    query_result: Option<Option<bool>>,
}
impl<'a> Cache<'a> {
    pub(super) fn new(context: Context<'a>) -> Self {
        Self {
            context,
            attempted: false,
            prepared: None,
        }
    }
    pub(super) fn separated(
        &mut self,
        normal: rp::Vector,
        work: &mut Work,
    ) -> Result<Option<bool>, TrajectoryError> {
        work.charge(1)?;
        if !self.attempted {
            let prepared = prepare(self.context, work)?;
            self.prepared = prepared;
            self.attempted = true;
        }
        let Some(prepared) = self.prepared.as_mut() else {
            return Ok(None);
        };
        // This result covers every admitted pose pair independent of the
        // current axis. A failed or incomplete query still needs that axis:
        // its whole-shape plane can refute a noisy contact.
        if prepared.query_result == Some(Some(true))
            && normal.is_finite()
            && normal != rp::Vector::ZERO
        {
            return Ok(Some(true));
        }
        if prepared.axis_prepaid {
            prepared.axis_prepaid = false;
        } else {
            work.charge(prepared.axis_work)?;
        }
        prepared.separated(
            self.context.sa,
            self.context.sb,
            self.context.clearance,
            normal,
            work,
        )
    }
}
fn prepare<'a>(
    context: Context<'a>,
    work: &mut Work,
) -> Result<Option<Prepared<'a>>, TrajectoryError> {
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        ..
    } = context;
    // Preserve the original first-axis precharge before any pose/point visit.
    work.charge(128)?;
    let (Some(ia), Some(ib)) = (
        Image::complete(a.curve, start, end, work)?,
        Image::complete(b.curve, start, end, work)?,
    ) else {
        return Ok(None);
    };
    let pa = ToiProxy::from_shape(sa).ok_or(TrajectoryError::UnsupportedShape)?;
    let pb = ToiProxy::from_shape(sb).ok_or(TrajectoryError::UnsupportedShape)?;
    let visits = pa
        .points()
        .len()
        .checked_mul(ia.len())
        .and_then(|v| v.checked_mul(if pa.radius > 0. { 1024 } else { 64 }))
        .and_then(|v| {
            pb.points()
                .len()
                .checked_mul(ib.len())
                .and_then(|n| n.checked_mul(if pb.radius > 0. { 1024 } else { 64 }))
                .and_then(|n| v.checked_add(n))
        })
        .ok_or(TrajectoryError::WorkLimit)?;
    let charge = (ia.len() + ib.len())
        .checked_mul(128)
        .and_then(|n| visits.checked_add(n))
        .and_then(|v| v.checked_add(64))
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(u64::try_from(charge).map_err(|_| TrajectoryError::WorkLimit)?)?;
    let poses_a = ia.poses(a)?;
    let poses_b = ib.poses(b)?;
    Ok(Some(Prepared {
        ia,
        ib,
        poses_a,
        poses_b,
        pa,
        pb,
        axis_work: u64::try_from(visits.checked_add(64).ok_or(TrajectoryError::WorkLimit)?)
            .map_err(|_| TrajectoryError::WorkLimit)?,
        axis_prepaid: true,
        query_result: None,
    }))
}
impl Prepared<'_> {
    fn separated(
        &mut self,
        shape_a: &dyn rp::Shape,
        shape_b: &dyn rp::Shape,
        clearance: f32,
        normal: rp::Vector,
        work: &mut Work,
    ) -> Result<Option<bool>, TrajectoryError> {
        let (pa, pb) = (&self.pa, &self.pb);
        let (poses_a, poses_b) = (&self.poses_a, &self.poses_b);
        let mut upper_a = f64::NEG_INFINITY;
        let mut lower_b = f64::INFINITY;
        let mut upper_by_pose = [f64::NEG_INFINITY; 4];
        let mut lower_by_pose = [f64::INFINITY; 4];
        for (index, pose) in poses_a.values[..poses_a.len].iter().enumerate() {
            for &point in pa.points() {
                let Some(bound) = output::full_projection(*pose, *pose, point, pa.radius, normal)
                else {
                    return Ok(None);
                };
                upper_a = upper_a.max(bound.hi);
                upper_by_pose[index] = upper_by_pose[index].max(bound.hi);
            }
        }
        for (index, pose) in poses_b.values[..poses_b.len].iter().enumerate() {
            for &point in pb.points() {
                let Some(bound) = output::full_projection(*pose, *pose, point, pb.radius, normal)
                else {
                    return Ok(None);
                };
                lower_b = lower_b.min(bound.lo);
                lower_by_pose[index] = lower_by_pose[index].min(bound.lo);
            }
        }
        let norm2 = dot(normal, normal);
        if norm2.lo <= 0. || !norm2.hi.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let norm = norm2.sqrt();
        // Each point already includes both original radius interpretations.
        let radius = Bound::exact(f64::from(clearance)).mul(norm);
        let gap = Bound::exact(lower_b)
            .sub(Bound::exact(upper_a))
            .sub(radius)
            .lo;
        if !gap.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if gap >= 0. {
            return Ok(Some(true));
        }
        if let Some(pairs) = common_phase::pairs(&self.ia, &self.ib) {
            work.charge(pairs.len as u64)?;
            // Every reachable common-input tuple has its own whole-shape
            // enclosure. Its nonnegative plane can refute a noisy leaf witness,
            // just like the original union support, without async cross-pairs.
            if pairs.values[..pairs.len].iter().all(|&(a_index, b_index)| {
                Bound::exact(lower_by_pose[b_index])
                    .sub(Bound::exact(upper_by_pose[a_index]))
                    .sub(radius)
                    .lo
                    >= 0.
            }) {
                return Ok(Some(true));
            }
            if let Some(clear) = self.query_result {
                return Ok(clear);
            }
            let mut static_clear = true;
            for &(a_index, b_index) in &pairs.values[..pairs.len] {
                let contact = super::super::leaf_contact(
                    &poses_a.values[a_index],
                    shape_a,
                    &poses_b.values[b_index],
                    shape_b,
                    work,
                )?;
                if !contact.dist.is_finite()
                    || !contact.normal1.is_finite()
                    || !contact.point1.is_finite()
                    || !contact.point2.is_finite()
                {
                    return Err(TrajectoryError::NonFinite);
                }
                if contact.dist <= clearance {
                    self.query_result = Some(Some(false));
                    return Ok(Some(false));
                }
                if static_clear && (pa.radius > 0. || pb.radius > 0.) {
                    let reused = contact.normal1.to_array().map(f32::to_bits)
                        == normal.to_array().map(f32::to_bits);
                    let plane_clear = if reused {
                        work.charge(64)?;
                        Bound::exact(lower_by_pose[b_index])
                            .sub(Bound::exact(upper_by_pose[a_index]))
                            .sub(radius)
                            .lo
                            > 0.
                    } else {
                        false
                    };
                    static_clear = plane_clear
                        || super::output::native_clear_static_eligible_with_proxies(
                            &poses_a.values[a_index],
                            shape_a,
                            pa,
                            &poses_b.values[b_index],
                            shape_b,
                            pb,
                            contact.normal1,
                            clearance,
                            work,
                        )?;
                }
            }
            let result = static_clear.then_some(true);
            self.query_result = Some(result);
            return Ok(result);
        }
        // A common separating axis can fail for the union of two differently
        // oriented rounded poses, although each *possible* full-shape query is
        // outside the original clearance. Exhaust every pair in the finite image.
        // This uses the same authoritative predicate as cast_policy's hit test;
        // unlike endpoint sampling there is no unvisited kernel parameter output.
        if let Some(clear) = self.query_result {
            return Ok(clear);
        }
        let pairs = poses_a
            .len
            .checked_mul(poses_b.len)
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(u64::try_from(pairs).map_err(|_| TrajectoryError::WorkLimit)?)?;
        let mut static_clear = true;
        for (a_index, pose_a) in poses_a.values[..poses_a.len].iter().enumerate() {
            for (b_index, pose_b) in poses_b.values[..poses_b.len].iter().enumerate() {
                // leaf_contact precharges its original support-query bound before
                // every full-shape query. No query or row is published to callers.
                let contact = super::super::leaf_contact(pose_a, shape_a, pose_b, shape_b, work)?;
                if !contact.dist.is_finite()
                    || !contact.normal1.is_finite()
                    || !contact.point1.is_finite()
                    || !contact.point2.is_finite()
                {
                    return Err(TrajectoryError::NonFinite);
                }
                if contact.dist <= clearance {
                    self.query_result = Some(Some(false));
                    return Ok(Some(false));
                }
                if static_clear && (pa.radius > 0. || pb.radius > 0.) {
                    let reused = contact.normal1.to_array().map(f32::to_bits)
                        == normal.to_array().map(f32::to_bits);
                    let plane_clear = if reused {
                        work.charge(64)?;
                        Bound::exact(lower_by_pose[b_index])
                            .sub(Bound::exact(upper_by_pose[a_index]))
                            .sub(radius)
                            .lo
                            > 0.
                    } else {
                        false
                    };
                    static_clear = plane_clear
                        || super::output::native_clear_static_eligible_with_proxies(
                            pose_a,
                            shape_a,
                            pa,
                            pose_b,
                            shape_b,
                            pb,
                            contact.normal1,
                            clearance,
                            work,
                        )?;
                }
            }
        }
        let result = static_clear.then_some(true);
        self.query_result = Some(result);
        Ok(result)
    }
}

#[cfg(test)]
mod tests;
