//! Complete support with one shared *actual* RN(v*Native_dt) input. It is
//! never an ideal-velocity analytic shortcut. Cardinal support is a component
//! inequality only; every original normal tangent term remains in the plane.
use super::*;

fn qi(q: rp::Rotation) -> bool {
    q.to_array().map(f32::to_bits) == rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
}
fn identity_frame(m: ShapeMotion) -> bool {
    m.local_center == rp::Vector::ZERO
        && m.local_pose.translation == rp::Vector::ZERO
        && qi(m.local_pose.rotation)
}
fn stationary_rotation(k: Kernel) -> bool {
    k.native.angular_velocity.to_array().map(f32::to_bits) == [0; 3]
        && qi(k.native.motion.start.rotation)
        && qi(k.native.motion.end.rotation)
}
fn same_clock(a: Kernel, b: Kernel) -> bool {
    a.domain.start.to_bits() == b.domain.start.to_bits()
        && a.domain.end.to_bits() == b.domain.end.to_bits()
        && a.native.integration_seconds.to_bits() == b.native.integration_seconds.to_bits()
        && a.native.motion.start_time.to_bits() == b.native.motion.start_time.to_bits()
        && a.native.motion.end_time.to_bits() == b.native.motion.end_time.to_bits()
}
fn stored_xyz(k: Kernel) -> bool {
    let expected =
        k.native.motion.start.translation + k.native.linear_velocity * k.native.integration_seconds;
    expected.is_finite()
        && expected.to_array().map(f32::to_bits)
            == k.native.motion.end.translation.to_array().map(f32::to_bits)
}
fn normal_core(capsule: &rapier3d::parry::shape::Capsule, axis: usize) -> bool {
    capsule.segment.a.is_finite()
        && capsule.segment.b.is_finite()
        && capsule.segment.a[axis] == 0.
        && capsule.segment.b[axis] == 0.
}
fn within(v: Float, lo: f64, hi: f64) -> bool {
    v.finite() && f64::from(v.lo) >= lo && f64::from(v.hi) < hi
}

// Every p_axis map is nondecreasing at fixed actual q when S>0: the
// q_axis*p_axis then q_axis*dot products reverse order together for q_axis<0;
// the normal cross term does not contain p_axis. Thus two complete free-face
// ranges bound ALL represented interior points, not only the eight vertices.
fn unchanged_box_normal(
    m: ShapeMotion,
    shape: &rapier3d::parry::shape::Cuboid,
    axis: usize,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    box_normal(m, shape, axis, start, end, None, work)
}

#[allow(clippy::too_many_arguments)]
fn box_normal(
    m: ShapeMotion,
    shape: &rapier3d::parry::shape::Cuboid,
    axis: usize,
    start: Time,
    end: Time,
    // When the Box COM is on the proved coarser grid, this is half
    // the finest spacing of the translated near face (before rounding).
    near_face_tolerance: Option<f64>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some(mut phases) = frames(m.curve, start, end, work)? else {
        return Ok(false);
    };
    let cost = phases.values[..phases.len]
        .iter()
        .try_fold(0_u64, |sum, f| {
            sum.checked_add(if f.rotation.exact.is_some() {
                128
            } else {
                1024
            })
            .ok_or(TrajectoryError::WorkLimit)
        })?;
    work.charge(cost)?;
    phases.shape(m);
    if phases.len == 0 {
        return Ok(false);
    }
    for phase in &phases.values[..phases.len] {
        work.charge(128)?;
        let q = phase.rotation.components;
        let b2 = q[0].mul(q[0]).add(q[1].mul(q[1])).add(q[2].mul(q[2]));
        let scale = q[3].mul(q[3]).sub(b2);
        if !scale.finite() || scale.lo <= 0. {
            return Ok(false);
        }
        let rotation = Frame {
            translation: [Float::ZERO; 3],
            ..*phase
        };
        let face_count = if near_face_tolerance.is_some() { 1 } else { 2 };
        for sign in [-1., 1.].into_iter().take(face_count) {
            work.charge(4096)?; // one actual whole-face scalar hull transform
            let input = std::array::from_fn(|i| {
                Value::input(if i == axis {
                    Float::exact(sign * shape.half_extents[i])
                } else {
                    Float::span(-shape.half_extents[i], shape.half_extents[i])
                })
            });
            let output = transform(rotation, input);
            if output.iter().any(|v| !v.finite()) {
                return Ok(false);
            }
            let target = sign * shape.half_extents[axis];
            let actual = output[axis].actual;
            let contained = if let Some(half_spacing) = near_face_tolerance {
                // The translated near face is on an even index of its
                // finest adjacent grid. The lower halfway point rounds to
                // that face too. Both the power-of-two face and its spacing
                // are exact in F64, including the boundary subtraction.
                f64::from(actual.lo) >= f64::from(target) - half_spacing
            } else {
                exact_value(actual, target)
            };
            if !contained {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

// r is an original normal power-of-two radius, not a substituted shape.
// g is its F32 binade grid. The two branches cover complete RN output binades.
fn axial_gap(a0: f32, b0: f32, product: Float, r: f32) -> Option<Bound> {
    let real_r = f64::from(r);
    let g = f64::from(r.next_up()) - real_r;
    let a = Float::exact(a0).add(product);
    let b = Float::exact(b0).add(product);
    let pole = a.add(Float::exact(r));
    let base = Bound::exact(f64::from(b0))
        .sub(Bound::exact(f64::from(a0)))
        .sub(Bound::exact(real_r))
        .sub(Bound::exact(real_r));
    if a0 == 0.
        && within(pole, real_r, 2. * real_r)
        && f64::from(b0) >= 2. * real_r
        && within(b, 2. * real_r, 4. * real_r)
    {
        // A=P exactly. B's grid is 2g, and B-r is exact/aligned.
        // A'=RN(P+r) is on grid g; B0-r is on grid 2g. For even
        // A'/g, RN(B0+P)-A'=B0-r. For odd A'/g it is B0-r +/-g.
        // |(P+r)-A'|<=g/2 includes every ties-even case. Both the
        // local-pole and the separate real-radius gap are >=base-g.
        Some(base.sub(Bound::exact(g)))
    } else if f64::from(a0) >= real_r
        && within(a, real_r, 3. * real_r)
        && within(pole, 2. * real_r, 4. * real_r)
        && f64::from(b0) >= 4. * real_r
        && within(b, 4. * real_r, 8. * real_r)
    {
        // B's COM grid is 4g; B-r is exact on every smaller output grid.
        // Below 2r, A's first error<=g/2 and its pole error<=g. At/above
        // 2r, A's COM grid is 2g and adding r is exact (pole<4r), so its
        // total error<=g. Complete union: actor pole error<=3g/2.
        // World real-radius error is only <=g. Both are covered by 7g/2.
        let actor_error = if f64::from(a.lo) >= 2. * real_r {
            g
        } else {
            1.5 * g
        };
        Some(base.sub(Bound::exact(2. * g + actor_error)))
    } else {
        None
    }
}

// A response can advance only the capsule's start and leave the dynamic
// Box on its original time map. Admit this family separately from the
// equal-clock product proof, including both original time conversions.
fn staggered_pair(context: Context<'_>) -> Option<(ShapeMotion, Kernel, ShapeMotion, Kernel)> {
    let (cap, box_motion) = if context.sa.as_capsule().is_some() && context.sb.as_cuboid().is_some()
    {
        (context.a, context.b)
    } else if context.sb.as_capsule().is_some() && context.sa.as_cuboid().is_some() {
        (context.b, context.a)
    } else {
        return None;
    };
    let (Curve::Integrated(a), Curve::Integrated(b)) = (cap.curve, box_motion.curve) else {
        return None;
    };
    // Positive starts within a factor of two make the logical elapsed
    // subtractions and both stored domain durations exact (Sterbenz).
    (a.domain.start >= b.domain.start
        && !same_clock(a, b)
        && b.domain.start > 0.
        && a.domain.end.to_bits() == b.domain.end.to_bits()
        && b.domain.end <= b.domain.start * 2.
        && stationary_rotation(a)
        && identity_frame(cap)
        && identity_frame(box_motion))
    .then_some((cap, a, box_motion, b))
}

pub(in crate::physics3d::solver_trajectory::rounded::output) fn early_applicable(
    context: Context<'_>,
) -> bool {
    (matches!(context.a.curve, Curve::Anchored { .. })
        || matches!(context.b.curve, Curve::Anchored { .. }))
        && applicable(context)
        || staggered_pair(context).is_some_and(|(_, a, _, b)| {
            (0..3).any(|i| {
                a.native.linear_velocity[i] > 0.
                    && b.native.linear_velocity[i] > 0.
                    && a.native.motion.start.translation[i] > 0.
                    && b.native.motion.start.translation[i] > a.native.motion.start.translation[i]
            })
        })
}

// Upper bound on the actual product difference, with independent F32
// errors after cancellation of the two ideal times at the same instant.
fn staggered_product_drift(a: Kernel, b: Kernel, start: Time, end: Time, axis: usize) -> Bound {
    let inputs = |k: Kernel| {
        let h = f64::from(k.native.integration_seconds);
        let v = k.native.linear_velocity[axis];
        let reciprocal = k.domain.duration().recip();
        let rate = Bound {
            lo: reciprocal.next_down(),
            hi: reciprocal.next_up(),
        }
        .mul(Bound::exact(h))
        .mul(Bound::exact(f64::from(v)));

        let dt = Float::span(k.local_delta(start), k.local_delta(end));
        let products = Float::span(v * dt.lo, v * dt.hi);
        // The F64 division and multiplication on ratios in [0,1]
        // contribute at most h*2^-51 absolute error. The F32 time
        // conversion and velocity product have their own rounded cells.
        let dt_error = upper_add(h * 2_f64.powi(-51), half_ulp(dt));
        let error = upper_add(upper_mul(f64::from(v), dt_error), half_ulp(products));
        (rate, error)
    };
    let (ar, ea) = inputs(a);
    let (br, eb) = inputs(b);
    let at = |t| {
        ar.mul(Bound::exact(t - a.domain.start))
            .sub(br.mul(Bound::exact(t - b.domain.start)))
    };
    let (first, last) = (at(start), at(end));
    Bound {
        lo: first.lo.min(last.lo),
        hi: first.hi.max(last.hi),
    }
    .add(Bound {
        lo: -upper_add(ea, eb),
        hi: upper_add(ea, eb),
    })
}

fn staggered_box_clear(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some((cap, a, box_motion, b)) = staggered_pair(context) else {
        return Ok(false);
    };
    let (cap_shape, box_shape, n) = if let (Some(cap), Some(cuboid)) =
        (context.sa.as_capsule(), context.sb.as_cuboid())
    {
        (cap, cuboid, normal)
    } else if let (Some(cuboid), Some(cap)) = (context.sa.as_cuboid(), context.sb.as_capsule()) {
        (cap, cuboid, -normal)
    } else {
        return Ok(false);
    };
    let axis = (0..3)
        .max_by(|&i, &j| n[i].abs().total_cmp(&n[j].abs()))
        .ok_or(TrajectoryError::InvalidReference)?;
    let a0 = a.native.motion.start.translation[axis];
    let b0 = b.native.motion.start.translation[axis];
    let radius = cap_shape.radius;
    let r = f64::from(radius);
    if !n.is_finite()
        || n[axis] <= 0.
        || !normal_core(cap_shape, axis)
        || !radius.is_normal()
        || radius <= 0.
        || radius.to_bits() & 0x7f_ffff != 0
        || !box_shape.half_extents.is_finite()
        || box_shape.half_extents.min_element() <= 0.
        || box_shape.half_extents[axis].to_bits() != radius.to_bits()
        || !(2. * r..4. * r).contains(&f64::from(a0))
        || !(4. * r..8. * r).contains(&f64::from(b0))
        || a.native.linear_velocity[axis] <= 0.
        || b.native.linear_velocity[axis] <= 0.
    {
        return Ok(false);
    }
    work.charge(1024)?;
    Kernel::from_native(a.native, a.domain)?;
    Kernel::from_native(b.native, b.domain)?;
    if !context.start.is_finite()
        || !context.end.is_finite()
        || context.start > context.end
        || context.start < a.domain.start
        || context.end > a.domain.end
        || !context.clearance.is_finite()
        || context.clearance < 0.
        || !stored_xyz(a)
        || !stored_xyz(b)
    {
        return Ok(false);
    }
    let bound = |k: Kernel| {
        Float::span(
            k.position_at_time(context.start).translation[axis],
            k.position_at_time(context.end).translation[axis],
        )
    };
    let a_span = bound(a);
    let b_span = bound(b);
    if !within(a_span, 2. * r, 4. * r) || !within(b_span, 4. * r, 8. * r) {
        return Ok(false);
    }
    let g = f64::from(radius.next_up()) - r;
    // The capsule's saved start can be late in the Box's Native
    // interval. Choose the Box's actual coordinate at that same
    // time as the reference and retain the remaining product residual.
    // Both Box coordinates are on the original 4g grid.
    let reference = f64::from(b.position_at_time(a.domain.start).translation[axis]);
    if !(4. * r..8. * r).contains(&reference) {
        return Ok(false);
    }
    let origin_shift = Bound::exact(reference).sub(Bound::exact(f64::from(b0)));
    let drift = staggered_product_drift(a, b, context.start, context.end, axis).add(origin_shift);
    if !drift.finite() {
        return Ok(false);
    }
    let loss = if drift.hi < -g {
        0.
    } else if drift.hi < g {
        2. * g
    } else {
        return Ok(false);
    };
    // B=T and reference are on grid 4g. With D=T-reference,
    // PB <= D + origin_shift + 2g. The bounds give PA<D+g or
    // PA<D+3g, so the A COM is <=a0+D or <=a0+D+2g. Strictness
    // at the upper midpoint avoids any assumption about A's parity.
    let maximum = f64::from(a0) + (f64::from(b_span.hi) - reference) + loss;
    if maximum >= 4. * r {
        return Ok(false);
    }
    // The capsule COM bound is on grid 2g. Its local pole is exact
    // below 4r and can round out by at most 2g on the next grid.
    // This extra term also conservatively covers the real-radius pole.
    let pole_error = if maximum + r >= 4. * r { 2. * g } else { 0. };
    let gap = Bound::exact(reference)
        .sub(Bound::exact(f64::from(a0)))
        .sub(Bound::exact(2. * r + loss + pole_error));
    if gap.lo <= f64::from(context.clearance)
        || !box_normal(
            box_motion,
            box_shape,
            axis,
            context.start,
            context.end,
            Some(g),
            work,
        )?
    {
        return Ok(false);
    }
    let direction = [rp::Vector::X, rp::Vector::Y, rp::Vector::Z][axis];
    // Use the cardinal plane whose entire normal support was checked.
    // The same full-shape range check retains finiteness on both tangents.
    plane_clear(
        context, cap, cap_shape, box_motion, box_shape, direction, axis, gap, work,
    )
}

/// Find a proved prefix only for the staggered-clock Box pair. A failed
/// check just moves the trial boundary; it never identifies a contact.
pub(in crate::physics3d::solver_trajectory::rounded::output) fn staggered_prefix(
    context: Context<'_>,
    normal: rp::Vector,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    if staggered_pair(context).is_none() {
        return Ok(None);
    }
    // The full interval can still be cheap on the original selected margin.
    if staggered_box_clear(context, normal, work)? {
        return Ok(Some(context.end));
    }
    let (mut low, mut high) = (context.start, context.end);
    for _ in 0..24 {
        work.charge(8)?;
        if high - low <= tolerance * 0.125 {
            break;
        }
        let middle = low + (high - low) * 0.5;
        if middle <= low || middle >= high {
            break;
        }
        if staggered_box_clear(
            Context {
                end: middle,
                ..context
            },
            normal,
            work,
        )? {
            low = middle;
        } else {
            high = middle;
        }
    }
    Ok((low > context.start).then_some(low))
}

// Fixed cheap pair header, once before visiting any existing direction. It
// keeps unrelated free/rotation clocks out of all per-axis preparation work.
pub(in crate::physics3d::solver_trajectory::rounded::output) fn applicable(
    context: Context<'_>,
) -> bool {
    if !(context.sa.as_capsule().is_some() || context.sb.as_capsule().is_some()) {
        return false;
    }
    if let (Curve::Integrated(a), Curve::Integrated(b)) = (context.a.curve, context.b.curve) {
        return staggered_pair(context).is_some()
            || same_clock(a, b)
                && (0..3).any(|i| {
                    a.native.linear_velocity[i] > 0.
                        && a.native.linear_velocity[i].to_bits()
                            == b.native.linear_velocity[i].to_bits()
                        && a.native.motion.start.translation[i]
                            != b.native.motion.start.translation[i]
                });
    }
    let anchored_box = |cap: ShapeMotion,
                        shape: &dyn rp::Shape,
                        box_motion: ShapeMotion,
                        box_shape: &dyn rp::Shape| {
        let (Curve::Anchored { carrier, .. }, Curve::Integrated(b), Some(capsule), Some(cuboid)) = (
            cap.curve,
            box_motion.curve,
            shape.as_capsule(),
            box_shape.as_cuboid(),
        ) else {
            return false;
        };
        let r = f64::from(capsule.radius);
        (0..3).any(|i| {
            let v = b.native.linear_velocity[i];
            v > 0.
                && v.to_bits() == carrier.native.linear_velocity[i].to_bits()
                && cuboid.half_extents[i] == capsule.radius
                && (4. * r..8. * r).contains(&f64::from(b.native.motion.start.translation[i]))
        })
    };
    let anchored_capsules = |left: ShapeMotion, right: ShapeMotion, radius: f32| {
        let (Curve::Integrated(a), Curve::Anchored { carrier, .. }) = (left.curve, right.curve)
        else {
            return false;
        };
        let r = f64::from(radius);
        same_clock(a, carrier)
            && (0..3).any(|i| {
                let va = a.native.linear_velocity[i];
                va > 0.
                    && va <= carrier.native.linear_velocity[i]
                    && (r * 0.25..r * 0.5)
                        .contains(&f64::from(a.native.motion.start.translation[i]))
                    && (4. * r..8. * r)
                        .contains(&f64::from(carrier.native.motion.start.translation[i]))
            })
    };
    anchored_box(context.a, context.sa, context.b, context.sb)
        || anchored_box(context.b, context.sb, context.a, context.sa)
        || (context
            .sa
            .as_capsule()
            .zip(context.sb.as_capsule())
            .is_some_and(|(a, b)| {
                a.radius.to_bits() == b.radius.to_bits()
                    && (anchored_capsules(context.a, context.b, a.radius)
                        || anchored_capsules(context.b, context.a, a.radius))
            }))
}

pub(in crate::physics3d::solver_trajectory::rounded::output) fn separated(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let axis = (0..3)
        .max_by(|&i, &j| normal[i].abs().total_cmp(&normal[j].abs()))
        .ok_or(TrajectoryError::InvalidReference)?;
    let (left, ls, right, rs, n) = if normal[axis] > 0. {
        (context.a, context.sa, context.b, context.sb, normal)
    } else if normal[axis] < 0. {
        (context.b, context.sb, context.a, context.sa, -normal)
    } else {
        return Ok(false);
    };
    let Some(cap) = ls.as_capsule() else {
        return Ok(false);
    };
    let (Curve::Integrated(a), Curve::Integrated(b)) = (left.curve, right.curve) else {
        return if rs.as_cuboid().is_some() {
            anchored_box_gap(context, n, axis, left, ls, right, rs, work)
        } else {
            anchored_capsule_gap(context, n, axis, left, ls, right, rs, work)
        };
    };
    if !same_clock(a, b) {
        return staggered_box_clear(context, normal, work);
    }
    // Keep every previous success and unsupported negative-velocity family
    // free of new work. All arithmetic certification below is prepaid.
    if a.native.linear_velocity[axis].to_bits() != b.native.linear_velocity[axis].to_bits()
        || a.native.linear_velocity[axis] <= 0.
        || !same_clock(a, b)
        || !identity_frame(left)
        || !identity_frame(right)
        || !stationary_rotation(a)
        || !normal_core(cap, axis)
    {
        return Ok(false);
    }
    let radius = cap.radius;
    let bits = radius.to_bits();
    if !radius.is_finite() || radius <= 0. || bits & 0x7f_ffff != 0 || bits >> 23 == 0 {
        return Ok(false);
    }
    let is_box = if let Some(other) = rs.as_capsule() {
        if other.radius.to_bits() != bits || !normal_core(other, axis) || !stationary_rotation(b) {
            return Ok(false);
        }
        false
    } else if let Some(other) = rs.as_cuboid() {
        if !other.half_extents.is_finite()
            || other.half_extents.min_element() <= 0.
            || other.half_extents[axis].to_bits() != bits
        {
            return Ok(false);
        }
        true
    } else {
        return Ok(false);
    };
    work.charge(512)?;
    Kernel::from_native(a.native, a.domain)?;
    Kernel::from_native(b.native, b.domain)?;
    if !normal.is_finite() || !context.clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if !context.start.is_finite()
        || !context.end.is_finite()
        || context.start > context.end
        || context.start < a.domain.start
        || context.end > a.domain.end
    {
        return Err(TrajectoryError::InvalidTime);
    }
    if context.clearance < 0. || !stored_xyz(a) || !stored_xyz(b) {
        return Ok(false);
    }
    let dt = [a.local_delta(context.start), a.local_delta(context.end)];
    let product = Float::span(
        a.native.linear_velocity[axis] * dt[0],
        a.native.linear_velocity[axis] * dt[1],
    );
    if !product.finite() || product.lo < 0. {
        return Ok(false);
    }
    let Some(gap) = axial_gap(
        a.native.motion.start.translation[axis],
        b.native.motion.start.translation[axis],
        product,
        radius,
    ) else {
        return Ok(false);
    };
    if gap.lo <= f64::from(context.clearance) {
        return Ok(false);
    }
    if is_box
        && !unchanged_box_normal(
            right,
            rs.as_cuboid().ok_or(TrajectoryError::InvalidReference)?,
            axis,
            context.start,
            context.end,
            work,
        )?
    {
        return Ok(false);
    }
    plane_clear(context, left, ls, right, rs, n, axis, gap, work)
}

// In the qualifying binades the Box COM is on a grid twice as coarse as
// the capsule pole. Subtracting the start COM is exact by Sterbenz. The
// whole residual plus the offset and the capsule pole then fit exactly on
// the finer grid. No independent COM interval is subtracted from another.
#[allow(clippy::too_many_arguments)]
fn anchored_box_gap(
    context: Context<'_>,
    n: rp::Vector,
    axis: usize,
    left: ShapeMotion,
    ls: &dyn rp::Shape,
    right: ShapeMotion,
    rs: &dyn rp::Shape,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity: relative,
            rotation,
        },
        Curve::Integrated(b),
        Some(cap),
        Some(cuboid),
    ) = (left.curve, right.curve, ls.as_capsule(), rs.as_cuboid())
    else {
        return Ok(false);
    };
    let origin = b.native.motion.start.translation[axis];
    let v = b.native.linear_velocity[axis];
    let radius = cap.radius;
    let r = f64::from(radius);
    let zero_anchor = anchor == rp::Vector::ZERO;
    if !identity_frame(left)
        || !identity_frame(right)
        || !qi(rotation)
        || (!zero_anchor && !stationary_rotation(carrier))
        || !normal_core(cap, axis)
        || !relative.is_finite()
        || relative[axis] > 0.
        || v <= 0.
        || v.to_bits() != carrier.native.linear_velocity[axis].to_bits()
        || origin.to_bits() != carrier.native.motion.start.translation[axis].to_bits()
        || (!zero_anchor && anchor[axis].to_bits() != (-origin).to_bits())
        || carrier.domain.start.to_bits() != b.domain.start.to_bits()
        || carrier.domain.end.to_bits() != b.domain.end.to_bits()
        || carrier.native.integration_seconds.to_bits() != b.native.integration_seconds.to_bits()
        || !radius.is_normal()
        || radius <= 0.
        || radius.to_bits() & 0x7f_ffff != 0
        || cuboid.half_extents[axis].to_bits() != radius.to_bits()
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() <= 0.
        || !(4. * r..8. * r).contains(&f64::from(origin))
        || !(2. * r..4. * r).contains(&f64::from(if zero_anchor {
            -offset[axis]
        } else {
            offset[axis]
        }))
    {
        return Ok(false);
    }

    work.charge(512)?;
    Kernel::from_native(carrier.native, carrier.domain)?;
    Kernel::from_native(b.native, b.domain)?;
    if !context.start.is_finite()
        || !context.end.is_finite()
        || context.start > context.end
        || context.start < b.domain.start
        || context.end > b.domain.end
    {
        return Err(TrajectoryError::InvalidTime);
    }
    if !n.is_finite() || !context.clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let logical_end = (context.end - b.domain.start).clamp(0., b.domain.duration()) as f32;
    if context.clearance < 0.
        || !stored_xyz(carrier)
        || !stored_xyz(b)
        || !(relative * logical_end).is_finite()
    {
        return Ok(false);
    }
    let com = Float::span(
        b.position_at_time(context.start).translation[axis],
        b.position_at_time(context.end).translation[axis],
    );
    if !within(com, 4. * r, 8. * r) {
        return Ok(false);
    }
    let shifted = if zero_anchor {
        // The bounded original quaternion graph maps the zero anchor to
        // zero in every represented phase. Translation with the offset
        // is exact on the finer binade grid admitted below.
        let Some(phases) = frames(Curve::Integrated(carrier), context.start, context.end, work)?
        else {
            return Ok(false);
        };
        work.charge(128 * phases.len as u64)?;
        if phases.len == 0
            || phases.values[..phases.len].iter().any(|phase| {
                phase
                    .rotation
                    .components
                    .iter()
                    .any(|q| !q.finite() || q.lo < -2. || q.hi > 2.)
            })
        {
            return Ok(false);
        }
        com.add(Float::exact(offset[axis]))
    } else {
        com.add(Float::exact(-origin))
            .add(Float::exact(offset[axis]))
    };
    if !within(shifted, 2. * r, 4. * r) {
        return Ok(false);
    }
    let pole = shifted.add(Float::exact(radius));
    if !within(pole, 2. * r, 4. * r) {
        return Ok(false);
    }
    // A nonpositive relative product can only reduce either capsule support.
    // Box COM minus radius is exact on the same or a finer binade grid.
    let base = if zero_anchor { 0. } else { f64::from(origin) };
    let gap = Bound::exact(base)
        .sub(Bound::exact(f64::from(offset[axis])))
        .sub(Bound::exact(2. * r));
    // The exact near face (COM-r) is at least 3r. Its smallest
    // adjacent spacing is twice the spacing at r. Both the COM and
    // radius are multiples of four spacings at r, so the near face
    // keeps an even index on that finer grid. A lower half-cell tie
    // rounds to the face and larger inputs cannot lower its output.
    // The normal coordinate is monotone in local p_axis.
    let half_spacing = f64::from(radius.next_up()) - r;
    if gap.lo <= f64::from(context.clearance)
        || !box_normal(
            right,
            cuboid,
            axis,
            context.start,
            context.end,
            Some(half_spacing),
            work,
        )?
    {
        return Ok(false);
    }
    plane_clear(context, left, ls, right, rs, n, axis, gap, work)
}

// The right capsule uses the Box's coarser RN COM as a translation
// carrier. At each represented carrier COM, bound the left capsule with
// the same T and the upper half of T's rounding cell. Translation by T's
// grid step preserves both the fine COM and the pole's ties-even grids.
#[allow(clippy::too_many_arguments)]
fn anchored_capsule_gap(
    context: Context<'_>,
    n: rp::Vector,
    axis: usize,
    left: ShapeMotion,
    ls: &dyn rp::Shape,
    right: ShapeMotion,
    rs: &dyn rp::Shape,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (
        Curve::Integrated(a),
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity: relative,
            rotation,
        },
        Some(cap_a),
        Some(cap_b),
    ) = (left.curve, right.curve, ls.as_capsule(), rs.as_capsule())
    else {
        return Ok(false);
    };
    let radius = cap_a.radius;
    let r = f64::from(radius);
    let a0 = a.native.motion.start.translation[axis];
    let b0 = carrier.native.motion.start.translation[axis];
    let va = a.native.linear_velocity[axis];
    let vb = carrier.native.linear_velocity[axis];
    if !radius.is_normal()
        || radius <= 0.
        || radius.to_bits() & 0x7f_ffff != 0
        || cap_b.radius.to_bits() != radius.to_bits()
        || !normal_core(cap_a, axis)
        || !normal_core(cap_b, axis)
        || !identity_frame(left)
        || !identity_frame(right)
        || !qi(rotation)
        || !stationary_rotation(a)
        || !stationary_rotation(carrier)
        || !same_clock(a, carrier)
        || !relative.is_finite()
        || !(va > 0. && va <= vb)
        || anchor[axis].to_bits() != (-b0).to_bits()
        || !a0.is_normal()
        || !(r * 0.25..r * 0.5).contains(&f64::from(a0))
        || !(4. * r..8. * r).contains(&f64::from(b0))
        || !(2. * r..4. * r).contains(&f64::from(offset[axis]))
    {
        return Ok(false);
    }

    work.charge(512)?;
    Kernel::from_native(a.native, a.domain)?;
    Kernel::from_native(carrier.native, carrier.domain)?;
    if !context.start.is_finite()
        || !context.end.is_finite()
        || context.start > context.end
        || context.start < a.domain.start
        || context.end > a.domain.end
    {
        return Err(TrajectoryError::InvalidTime);
    }
    if !n.is_finite() || !context.clearance.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    if context.clearance < 0. || !stored_xyz(a) || !stored_xyz(carrier) {
        return Ok(false);
    }
    let a_span = Float::span(
        a.position_at_time(context.start).translation[axis],
        a.position_at_time(context.end).translation[axis],
    );
    let b_span = Float::span(
        carrier.position_at_time(context.start).translation[axis],
        carrier.position_at_time(context.end).translation[axis],
    );
    let g = f64::from(radius.next_up()) - r;
    if !within(a_span, r * 0.25, r) || !within(b_span, 4. * r, 8. * r) {
        return Ok(false);
    }
    let shifted = b_span
        .add(Float::exact(-b0))
        .add(Float::exact(offset[axis]));
    let logical = (context.end - a.domain.start).clamp(0., a.domain.duration()) as f32;
    let relative_product = relative * logical;
    if !within(shifted, 2. * r, 4. * r)
        || f64::from(shifted.lo) <= 2. * r
        || !relative_product.is_finite()
        || f64::from(relative_product[axis]).abs() >= g
    {
        return Ok(false);
    }
    // T is on grid 4g. All right post-adds are exact in their
    // admitted binades and the relative product stays inside half a cell.
    // Since va <= vb and dt is nonnegative, RN(va*dt) <= RN(vb*dt).
    // RN(vb*dt) <= (T-b0)+2g, including ties.
    let ceiling = f64::from(a0) + 2. * g;
    let a_pole_upper = [g * 0.25, g * 0.5].into_iter().fold(0_f64, |high, grid| {
        let rounded_com = (ceiling / grid).round_ties_even() * grid;
        let pole = rounded_com + r;
        high.max(pole).max((pole / g).round_ties_even() * g)
    });
    let gap = Bound::exact(f64::from(offset[axis]))
        .sub(Bound::exact(r))
        .sub(Bound::exact(a_pole_upper));
    if gap.lo <= f64::from(context.clearance) {
        return Ok(false);
    }
    plane_clear(context, left, ls, right, rs, n, axis, gap, work)
}

#[allow(clippy::too_many_arguments)]
fn plane_clear(
    context: Context<'_>,
    left: ShapeMotion,
    ls: &dyn rp::Shape,
    right: ShapeMotion,
    rs: &dyn rp::Shape,
    n: rp::Vector,
    axis: usize,
    gap: Bound,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    // Complete original full-shape ranges protect every tangent and every
    // local/world-radius interpretation. No same-time endpoint inference.
    let la = left.bounds(ls, context.start, context.end, work)?;
    let rb = right.bounds(rs, context.start, context.end, work)?;
    if !la.mins.is_finite() || !la.maxs.is_finite() || !rb.mins.is_finite() || !rb.maxs.is_finite()
    {
        return Err(TrajectoryError::NonFinite);
    }
    let mut plane = gap.mul(Bound::exact(f64::from(n[axis])));
    for i in 0..3 {
        if i == axis {
            continue;
        }
        let difference = Bound {
            lo: Bound::exact(f64::from(rb.mins[i]))
                .sub(Bound::exact(f64::from(la.maxs[i])))
                .lo,
            hi: Bound::exact(f64::from(rb.maxs[i]))
                .sub(Bound::exact(f64::from(la.mins[i])))
                .hi,
        };
        plane = plane.add(difference.mul(Bound::exact(f64::from(n[i]))));
    }
    let norm2 = super::super::super::dot(n, n);
    if norm2.lo <= 0. || !norm2.hi.is_finite() {
        return Ok(false);
    }
    let margin = Bound::exact(f64::from(context.clearance)).mul(norm2.sqrt());
    Ok(plane.sub(margin).lo > 0.)
}
#[cfg(test)]
mod tests;
