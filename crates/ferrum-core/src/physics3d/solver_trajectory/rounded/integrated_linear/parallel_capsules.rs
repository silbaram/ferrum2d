//! A transverse plane bounds both radius paths of parallel axial capsules
//! using each body's represented Native translation clock.
mod static_grid;

use super::{
    add_error, finite_shape, grid, half_ulp, same_clock, up_add, Bound, Curve, ShapeMotion, Source,
    Time, ToiProxy, TrajectoryError, Work,
};

fn centered_axis(points: &[super::rp::Vector]) -> Option<usize> {
    let [a, b] = points else { return None };
    let axis = (0..3).find(|&axis| a[axis] != b[axis])?;
    (0..3)
        .all(|i| i == axis || (a[i] == 0. && b[i] == 0.))
        .then_some(axis)
}

fn dot(a: [Bound; 2], b: [Bound; 2]) -> Bound {
    a[0].mul(b[0]).add(a[1].mul(b[1]))
}

fn rounded_radius_error(
    com: [super::rp::Vector; 2],
    axes: [usize; 2],
    direction: [f64; 2],
    radius: f32,
) -> Option<f64> {
    // A disk offset cannot exceed the exact represented radius. At a
    // binade boundary it can round to that radius only from inside, using
    // the finer adjacent spacing rather than the outward next spacing.
    let inner_radius = radius.next_down();
    let local_error = half_ulp([-inner_radius, inner_radius])?;
    let error = |limits: [[f32; 2]; 2]| {
        let mut error = Bound::exact(0.);
        for ((axis, n), local) in axes.into_iter().zip(direction).zip(limits) {
            // Both graphs have a zero transverse core coordinate. The original
            // F32 radial offset and its translated output each contribute one RN.
            let local = [local[0].max(-radius), local[1].min(radius)];
            let shifted = half_ulp([
                com[0][axis].min(com[1][axis]) + local[0],
                com[0][axis].max(com[1][axis]) + local[1],
            ])?;
            error = error.add(Bound::exact(n.abs()).mul(Bound::exact(up_add(
                half_ulp(local)?.min(local_error),
                shifted,
            ))));
        }
        Some(error.hi)
    };
    let whole = error([[-radius, radius]; 2])?;
    let r = f64::from(radius);
    let width = r / 32.;
    let n = direction.map(Bound::exact);
    let length = dot(n, n).sqrt();
    // At least this much projection is lost outside the cap around the
    // exact pole, so even the complete rounding error cannot make it win.
    let deficit = length
        .mul(Bound::exact(width * width))
        .mul(Bound::exact((0.5 / r).next_down()));
    if length.lo <= 0. || deficit.lo <= whole {
        return Some(whole);
    }
    let scale = Bound {
        lo: (r / length.hi).next_down(),
        hi: (r / length.lo).next_up(),
    };
    let limits = n.map(|component| {
        let pole = scale.mul(component);
        [
            (pole.lo - width).next_down() as f32,
            (pole.hi + width).next_up() as f32,
        ]
    });
    error(limits)
}

#[derive(Clone, Copy)]
struct ParallelSource {
    base: Source,
    additions: [super::rp::Vector; 2],
    com: [super::rp::Vector; 2],
}

impl ParallelSource {
    fn new(
        motion: ShapeMotion,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<Option<Self>, TrajectoryError> {
        let (curve, additions) = match motion.curve {
            Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation,
            } if linear_velocity == super::rp::Vector::ZERO
                && rotation.to_array().map(f32::to_bits)
                    == super::rp::Rotation::IDENTITY.to_array().map(f32::to_bits)
                && anchor.is_finite()
                && offset.is_finite() =>
            {
                (Curve::Integrated(carrier), [anchor, offset])
            }
            Curve::Integrated(_) => (motion.curve, [super::rp::Vector::ZERO; 2]),
            _ => return Ok(None),
        };
        let Some(base) = Source::new(ShapeMotion { curve, ..motion }, start, end, work)? else {
            return Ok(None);
        };
        // The original anchored expression still multiplies its zero relative
        // velocity by the elapsed logical time after conversion to f32.
        if matches!(motion.curve, Curve::Anchored { carrier, .. }
            if !((end - carrier.domain.start) as f32).is_finite())
        {
            return Ok(None);
        }
        work.charge(128)?;
        // The admitted zero relative rate adds no displacement. The two
        // original qI anchor additions remain in their original order.
        let com = base.com.map(|p| p + additions[0] + additions[1]);
        Ok(com.iter().all(|v| v.is_finite()).then_some(Self {
            base,
            additions,
            com,
        }))
    }

    fn origin(self, axis: usize) -> Bound {
        Bound::exact(f64::from(self.base.origin[axis]))
            .add(Bound::exact(f64::from(self.additions[0][axis])))
            .add(Bound::exact(f64::from(self.additions[1][axis])))
    }

    fn attachment_error(self, axis: usize) -> Option<f64> {
        let initial = self.base.com.map(|p| p[axis]);
        let shifted = initial.map(|p| p + self.additions[0][axis]);
        let first = add_error(initial, self.additions[0][axis])?;
        let second = add_error(shifted, self.additions[1][axis])?;
        Some(up_add(first, second))
    }

    fn translation_error(self, axis: usize, dt: [f32; 2]) -> Option<f64> {
        Some(up_add(
            self.base.translation_error(axis, dt)?,
            self.attachment_error(axis)?,
        ))
    }

    fn at(self, dt: f32) -> super::rp::Vector {
        self.base.origin + self.base.velocity * dt + self.additions[0] + self.additions[1]
    }
}

// Equal rounded products added to two points on the same binary grid
// produce the same rounded displacement when the shift is even. The even
// shift preserves each ties-to-even decision as well as nearest rounding.
fn equal_rounded_displacement(a: ParallelSource, b: ParallelSource, axis: usize) -> bool {
    if a.base.velocity[axis].to_bits() != b.base.velocity[axis].to_bits()
        || [a, b]
            .iter()
            .any(|v| v.additions.iter().any(|p| p[axis] != 0.))
    {
        return false;
    }
    let x = a.base.origin[axis];
    let y = b.base.origin[axis];
    let spacing = grid(x);
    let same_binade = |v: f32| {
        v.is_normal() && v.is_sign_negative() == x.is_sign_negative() && grid(v) == spacing
    };
    if !same_binade(x)
        || !same_binade(y)
        || a.com
            .into_iter()
            .chain(b.com)
            .any(|v| !same_binade(v[axis]))
    {
        return false;
    }
    // These F32 operands are on the same uniform grid. The low bit gives
    // the parity of their integer grid displacement without division.
    (x.to_bits() ^ y.to_bits()) & 1 == 0
}

// The two transformed cardinal poles are on a known binary grid. Even
// when the worst rounding errors cannot cancel, the resulting gap cannot
// take a value between adjacent points of that grid.
fn cardinal_poles_clear(
    a: ParallelSource,
    b: ParallelSource,
    axis: usize,
    dt: [f32; 2],
    radii: [f32; 2],
    clearance: f32,
) -> Option<bool> {
    let origin = b.origin(axis).sub(a.origin(axis));
    let rate = Bound::exact(f64::from(b.base.velocity[axis]))
        .sub(Bound::exact(f64::from(a.base.velocity[axis])));
    let error = up_add(
        a.translation_error(axis, dt)?,
        b.translation_error(axis, dt)?,
    );
    let translated = origin
        .add(rate.mul(Bound {
            lo: f64::from(dt[0]),
            hi: f64::from(dt[1]),
        }))
        .sub(Bound::exact(error));
    let translated_lower = if a.base.velocity[axis] <= b.base.velocity[axis]
        && [a, b]
            .into_iter()
            .all(|source| source.additions.iter().all(|v| v[axis] == 0.))
    {
        // With one nonnegative clock input, rounding each product preserves
        // their velocity order. Only the independent COM additions can
        // subtract from the resulting gap.
        let e = |source: ParallelSource| {
            add_error(
                dt.map(|t| source.base.velocity[axis] * t),
                source.base.origin[axis],
            )
        };
        translated
            .lo
            .max(origin.sub(Bound::exact(up_add(e(a)?, e(b)?))).lo)
    } else {
        translated.lo
    };
    poles_clear_from_translation(a, b, axis, radii, clearance, translated_lower)
}

fn poles_clear_from_translation(
    a: ParallelSource,
    b: ParallelSource,
    axis: usize,
    radii: [f32; 2],
    clearance: f32,
    translated_lower: f64,
) -> Option<bool> {
    let [ra, rb] = radii.map(|r| Bound::exact(f64::from(r)));
    let gap = Bound::exact(translated_lower).sub(ra).sub(rb);
    let mut world_grid = i32::MAX;
    let mut local_grid = i32::MAX;
    let mut pole_error = 0.;
    let finest_grid = |range: [f32; 2]| {
        if range[0].is_sign_negative() != range[1].is_sign_negative() {
            -149
        } else {
            grid(range[0].abs().min(range[1].abs()))
        }
    };
    for (source, radius) in [(a, radii[0]), (b, -radii[1])] {
        let center = source.com.map(|value| value[axis]);
        let pole = center.map(|value| value + radius);
        if pole.iter().any(|x| !x.is_finite()) {
            return None;
        }
        world_grid = world_grid
            .min(finest_grid(center))
            .min(super::quantum(radius)?);
        local_grid = local_grid.min(finest_grid(pole));
        pole_error = up_add(pole_error, add_error(center, radius)?);
    }
    let local = gap.sub(Bound::exact(pole_error));
    Some(
        super::grid_clear(gap, world_grid, clearance)
            && super::grid_clear(local, local_grid, clearance),
    )
}

#[derive(Clone, Copy)]
struct ClockRange {
    offset: Bound,
    scale: Bound,
    actual: [f32; 2],
    error: f64,
}

impl ClockRange {
    fn new(clock: super::Kernel, start: Time, end: Time) -> Option<Self> {
        let h = f64::from(clock.native.integration_seconds);
        let scale = h / clock.domain.duration();
        let scale = Bound {
            lo: scale.next_down(),
            hi: scale.next_up(),
        };
        let offset = Bound::exact(start)
            .sub(Bound::exact(clock.domain.start))
            .mul(scale);
        let actual = [clock.local_delta(start), clock.local_delta(end)];
        // Same F64 local-clock ledger as mixed_clock_faces. All represented
        // fractions in this in-domain interval lie within [0,1]; rounding
        // and clamping the two endpoints cannot extend past 0 or h.
        let error = up_add(8. * f64::EPSILON * h, half_ulp(actual)?);
        (offset.finite() && scale.finite() && error.is_finite()).then_some(Self {
            offset,
            scale,
            actual,
            error,
        })
    }

    fn project(
        self,
        source: ParallelSource,
        axes: [usize; 2],
        direction: [Bound; 2],
    ) -> Option<([Bound; 2], f64)> {
        let rates = axes.map(|axis| Bound::exact(f64::from(source.base.velocity[axis])));
        let origin = dot(axes.map(|axis| source.origin(axis)), direction);
        let signed_rate = dot(rates, direction);
        let mut error = Bound::exact(0.);
        for ((axis, direction), rate) in axes.into_iter().zip(direction).zip(rates) {
            let displacement = Bound::exact(source.translation_error(axis, self.actual)?)
                .add(Bound::exact(rate.lo.abs()).mul(Bound::exact(self.error)));
            error = error.add(displacement.mul(Bound::exact(direction.lo.abs())));
        }
        Some((
            [
                origin.add(signed_rate.mul(self.offset)),
                signed_rate.mul(self.scale),
            ],
            error.hi,
        ))
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    a: ShapeMotion,
    pa: &ToiProxy<'_>,
    b: ShapeMotion,
    pb: &ToiProxy<'_>,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    separated_graph(a, pa, b, pb, start, end, clearance, false, work)
}

#[allow(clippy::too_many_arguments)]
fn separated_graph(
    a: ShapeMotion,
    pa: &ToiProxy<'_>,
    b: ShapeMotion,
    pb: &ToiProxy<'_>,
    start: Time,
    end: Time,
    clearance: f32,
    real_radius_only: bool,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some(axis) = centered_axis(pa.points()) else {
        return Ok(false);
    };
    if centered_axis(pb.points()) != Some(axis)
        || !pa.radius.is_finite()
        || !pb.radius.is_finite()
        || pa.radius <= 0.
        || pb.radius <= 0.
        || clearance < 0.
    {
        return Ok(false);
    }
    let (Some(a), Some(b)) = (
        ParallelSource::new(a, start, end, work)?,
        ParallelSource::new(b, start, end, work)?,
    ) else {
        return Ok(false);
    };
    let (Some(ka), Some(kb)) = (a.base.clock, b.base.clock) else {
        return Ok(false);
    };
    let common = same_clock(ka, kb);
    let dt = [ka.local_delta(start), ka.local_delta(end)];
    if dt.iter().any(|v| !v.is_finite() || v.is_sign_negative())
        || dt[0] > dt[1]
        || (!common && start.is_sign_negative())
    {
        return Ok(false);
    }
    work.charge(1024)?;
    let hull = |points: &[super::rp::Vector]| [points[0].min(points[1]), points[0].max(points[1])];
    if !finite_shape(
        Source {
            com: a.com,
            ..a.base
        },
        hull(pa.points()),
        pa.radius,
    ) || !finite_shape(
        Source {
            com: b.com,
            ..b.base
        },
        hull(pb.points()),
        pb.radius,
    ) {
        return Ok(false);
    }
    let axes = [(axis + 1) % 3, (axis + 2) % 3];
    let difference = |x: super::rp::Vector, y: super::rp::Vector| {
        axes.map(|i| Bound::exact(f64::from(x[i])).sub(Bound::exact(f64::from(y[i]))))
    };
    let origins = axes.map(|i| b.origin(i).sub(a.origin(i)));
    let relative_origin = origins.map(|v| v.lo.midpoint(v.hi));
    let relative_rate = axes.map(|i| f64::from(b.base.velocity[i]) - f64::from(a.base.velocity[i]));
    let direction = if common {
        // The nearest affine point only nominates a plane. The fixed plane is
        // proved across every represented delta below, including both ends.
        let t = (-(relative_origin[0] * relative_rate[0] + relative_origin[1] * relative_rate[1])
            / (relative_rate[0] * relative_rate[0] + relative_rate[1] * relative_rate[1]))
            .clamp(f64::from(dt[0]), f64::from(dt[1]));
        let t = if t.is_finite() { t } else { f64::from(dt[0]) };
        std::array::from_fn(|j| relative_origin[j] + relative_rate[j] * t)
    } else {
        difference(b.com[0], a.com[0]).map(|v| v.lo.midpoint(v.hi))
    };
    let reach = Bound::exact(f64::from(pa.radius))
        .add(Bound::exact(f64::from(pb.radius)))
        .add(Bound::exact(f64::from(clearance)));
    let unit = direction.map(Bound::exact);
    let target = reach.mul(dot(unit, unit).sqrt());
    let radius_error = if real_radius_only {
        0.
    } else {
        let (Some(ea), Some(eb)) = (
            rounded_radius_error(a.com, axes, direction, pa.radius),
            rounded_radius_error(b.com, axes, direction.map(|x| -x), pb.radius),
        ) else {
            return Ok(false);
        };
        up_add(ea, eb)
    };
    if common {
        let mut error = Bound::exact(radius_error);
        for (axis, n) in axes.into_iter().zip(direction) {
            if equal_rounded_displacement(a, b, axis) {
                continue;
            }
            // Source::new verifies the stored endpoint against the Native
            // expression. With identical operands and clock, its rounded COM
            // cancels exactly; each rider's two subsequent adds still round.
            let shared_com = a.base.origin[axis].to_bits() == b.base.origin[axis].to_bits()
                && a.base.velocity[axis].to_bits() == b.base.velocity[axis].to_bits();
            let error_for = |source: ParallelSource| {
                if shared_com {
                    source.attachment_error(axis)
                } else {
                    source.translation_error(axis, dt)
                }
            };
            let (Some(ea), Some(eb)) = (error_for(a), error_for(b)) else {
                return Ok(false);
            };
            error = error.add(Bound::exact(n.abs()).mul(Bound::exact(up_add(ea, eb))));
        }
        let lower = dot(origins, unit).add(
            dot(difference(b.base.velocity, a.base.velocity), unit).mul(Bound {
                lo: f64::from(dt[0]),
                hi: f64::from(dt[1]),
            }),
        );
        if lower.lo > target.add(error).hi {
            return Ok(true);
        }
        if let Some(j) =
            (0..2).find(|&j| !real_radius_only && direction[j] != 0. && direction[1 - j] == 0.)
        {
            work.charge(512)?;
            let (left, right, radii) = if direction[j] > 0. {
                (a, b, [pa.radius, pb.radius])
            } else {
                (b, a, [pb.radius, pa.radius])
            };
            if cardinal_poles_clear(left, right, axes[j], dt, radii, clearance) == Some(true) {
                return Ok(true);
            }
        }
    }
    if !common {
        work.charge(384)?;
        let Some((ca, cb)) = ClockRange::new(ka, start, end).zip(ClockRange::new(kb, start, end))
        else {
            return Ok(false);
        };
        let Some(([a_origin, va], ea)) = ca.project(a, axes, unit) else {
            return Ok(false);
        };
        let Some(([b_origin, vb], eb)) = cb.project(b, axes, unit) else {
            return Ok(false);
        };
        let span = Bound {
            lo: 0.,
            hi: Bound::exact(end).sub(Bound::exact(start)).hi,
        };
        let lower = b_origin.sub(a_origin).add(vb.sub(va).mul(span));
        if lower.lo
            > target
                .add(Bound::exact(up_add(radius_error, up_add(ea, eb))))
                .hi
        {
            return Ok(true);
        }
        if let Some(j) =
            (0..2).find(|&j| !real_radius_only && direction[j] != 0. && direction[1 - j] == 0.)
        {
            work.charge(512)?;
            let toward = direction[j];
            let scale = 1. / toward.abs();
            let inverse = Bound {
                lo: scale.next_down(),
                hi: scale.next_up(),
            };
            let translated = lower.sub(Bound::exact(up_add(ea, eb))).mul(inverse);
            let (left, right, radii) = if toward > 0. {
                (a, b, [pa.radius, pb.radius])
            } else {
                (b, a, [pb.radius, pa.radius])
            };
            if poles_clear_from_translation(left, right, axes[j], radii, clearance, translated.lo)
                == Some(true)
            {
                return Ok(true);
            }
        }
    }
    // The Native scalar clock may include millions of keys that produce
    // exactly the same translations. Its ordered output range is independently
    // bounded by the differences of the four original F32 coordinates.
    let order = |value: f32| {
        let bits = value.to_bits();
        if value.is_sign_negative() {
            !bits
        } else {
            bits ^ 0x8000_0000
        }
    };
    let changes: u64 = [a, b]
        .into_iter()
        .flat_map(|source| {
            axes.map(|axis| {
                u64::from(order(source.com[0][axis]).abs_diff(order(source.com[1][axis])))
            })
        })
        .sum();
    if changes > 128 {
        return Ok(false);
    }
    // Intermediate input keys can only add conservative checks. A block
    // whose original monotone coordinates have identical endpoints has no
    // third possible translation. Nonempty blocks use all four endpoint
    // ranges before subdivision; they never mix a witness or report a hit.
    let minimum = |left: [super::rp::Vector; 2], right: [super::rp::Vector; 2]| {
        let diff = std::array::from_fn(|j| {
            let i = axes[j];
            let r = Bound {
                lo: f64::from(left[1][i].min(right[1][i])),
                hi: f64::from(left[1][i].max(right[1][i])),
            };
            let l = Bound {
                lo: f64::from(left[0][i].min(right[0][i])),
                hi: f64::from(left[0][i].max(right[0][i])),
            };
            r.sub(l)
        });
        dot(diff, unit).lo
    };
    let threshold = target.add(Bound::exact(radius_error)).hi;
    let at = |key: u64| {
        if common {
            let u = f32::from_bits(key as u32);
            [a.at(u), b.at(u)]
        } else {
            let time = Time::from_bits(key);
            [a.at(ka.local_delta(time)), b.at(kb.local_delta(time))]
        }
    };
    let mut pending = [(
        0,
        0,
        [super::rp::Vector::ZERO; 2],
        [super::rp::Vector::ZERO; 2],
    ); 65];
    let [lo, hi] = if common {
        dt.map(|x| u64::from(x.to_bits()))
    } else {
        [start.to_bits(), end.to_bits()]
    };
    pending[0] = (lo, hi, [a.com[0], b.com[0]], [a.com[1], b.com[1]]);
    let mut count = 1;
    while count != 0 {
        count -= 1;
        let (lo, hi, left, right) = pending[count];
        work.charge(192)?;
        if minimum(left, right) > threshold {
            continue;
        }
        let equal = |first: [super::rp::Vector; 2], second: [super::rp::Vector; 2]| {
            (0..2).all(|j| {
                axes.into_iter()
                    .all(|axis| first[j][axis] == second[j][axis])
            })
        };
        let same = equal(left, right);
        // Only identical output cells or adjacent original input keys can
        // pay for the tight numerical strip. Every nonempty split retains
        // its original serialized Native input and world coordinates.
        if hi - lo <= 1 || same {
            if minimum(left, left) <= threshold
                && (real_radius_only
                    || !static_grid::separated(
                        left,
                        axes,
                        [pa.radius, pb.radius],
                        clearance,
                        work,
                    )?)
            {
                return Ok(false);
            }
            if !same
                && minimum(right, right) <= threshold
                && (real_radius_only
                    || !static_grid::separated(
                        right,
                        axes,
                        [pa.radius, pb.radius],
                        clearance,
                        work,
                    )?)
            {
                return Ok(false);
            }
            continue;
        }
        let mid = lo + (hi - lo) / 2;
        let mid_pose = if mid == lo { left } else { at(mid) };
        let next_pose = if mid + 1 == hi { right } else { at(mid + 1) };
        pending[count] = (mid + 1, hi, next_pose, right);
        pending[count + 1] = (lo, mid, left, mid_pose);
        count += 2;
    }
    Ok(true)
}

/// Search an existing positive contact band only for admitted parallel axial
/// capsules. Both real core segments must overlap axially at the start and
/// the start gap must be within one projected Native translation cell.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn stable_existing(
    a: ShapeMotion,
    sa: &dyn super::rp::Shape,
    b: ShapeMotion,
    sb: &dyn super::rp::Shape,
    start: Time,
    end: Time,
    clearance: f32,
    accepted: bool,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    // During pair ordering an earlier candidate can already be at the
    // start, cropping competing retained pairs to that single pose.
    if start > end || (start == end && !accepted) || clearance <= 0. || !clearance.is_finite() {
        return Ok(false);
    }
    let (Some(ca), Some(cb)) = (sa.as_capsule(), sb.as_capsule()) else {
        return Ok(false);
    };
    let [pa, pb] = [ca, cb].map(|c| ToiProxy::from_array([c.segment.a, c.segment.b], c.radius));
    let Some(axis) = centered_axis(pa.points()) else {
        return Ok(false);
    };
    if centered_axis(pb.points()) != Some(axis) || pa.radius <= 0. || pb.radius <= 0. {
        return Ok(false);
    }
    let (Some(source_a), Some(source_b)) = (
        ParallelSource::new(a, start, end, work)?,
        ParallelSource::new(b, start, end, work)?,
    ) else {
        return Ok(false);
    };
    let (Some(ka), Some(kb)) = (source_a.base.clock, source_b.base.clock) else {
        return Ok(false);
    };
    let common = same_clock(ka, kb);
    work.charge(512)?;
    let [com_a, com_b] = [source_a.com[0], source_b.com[0]];
    let axial_range = |com: super::rp::Vector, c: &super::rp::Capsule| {
        let translation = Bound::exact(f64::from(com[axis]));
        [
            c.segment.a[axis].min(c.segment.b[axis]),
            c.segment.a[axis].max(c.segment.b[axis]),
        ]
        .map(|v| translation.add(Bound::exact(f64::from(v))))
    };
    let [lo_a, hi_a] = axial_range(com_a, ca);
    let [lo_b, hi_b] = axial_range(com_b, cb);
    if lo_a.hi.max(lo_b.hi) > hi_a.lo.min(hi_b.lo) {
        return Ok(false);
    }
    let axes = [(axis + 1) % 3, (axis + 2) % 3];
    let delta =
        axes.map(|i| Bound::exact(f64::from(com_b[i])).sub(Bound::exact(f64::from(com_a[i]))));
    let length = dot(delta, delta).sqrt();
    if !length.finite() || length.lo <= 0. {
        return Ok(false);
    }
    let geometry = length
        .sub(Bound::exact(f64::from(pa.radius)))
        .sub(Bound::exact(f64::from(pb.radius)));
    let margin = f64::from(clearance);
    let mut cell = Bound::exact(0.);
    for (axis, span) in axes.into_iter().zip(delta) {
        let (Some(a), Some(b)) = (half_ulp([com_a[axis]; 2]), half_ulp([com_b[axis]; 2])) else {
            return Ok(false);
        };
        let length = span.lo.abs().max(span.hi.abs());
        cell = cell.add(Bound::exact(2. * up_add(a, b)).mul(Bound::exact(length)));
    }
    let cell = (cell.hi / length.lo).next_up();
    if !cell.is_finite()
        || geometry.lo <= 0.
        || geometry.sub(Bound::exact(margin)).lo < -cell
        || geometry.sub(Bound::exact(margin)).hi > cell
    {
        return Ok(false);
    }
    let lower = (margin - cell).next_up();
    let mut selected = lower as f32;
    if f64::from(selected) < lower {
        selected = selected.next_up();
    }
    if selected <= 0. || selected >= clearance {
        return Ok(false);
    }
    // Only a common clock permits comparing unscaled Native velocities.
    // With different clocks, require a strict starting contact and compare
    // its point velocities in world time. Both paths still have to clear
    // the selected margin for the entire interval.
    if accepted && common {
        let velocity = axes.map(|i| {
            Bound::exact(f64::from(source_b.base.velocity[i]))
                .sub(Bound::exact(f64::from(source_a.base.velocity[i])))
        });
        if dot(delta, velocity).lo < 0. {
            return Ok(false);
        }
    } else if !common || !separated_graph(a, &pa, b, &pb, start, end, clearance, true, work)? {
        use crate::physics3d::solver_trajectory::world_contact::Pair;
        let Some(pair) = Pair::new(sa, sb, work)? else {
            return Ok(false);
        };
        let Some(witness) = pair.at(a, b, start, clearance, work)? else {
            return Ok(false);
        };
        if !witness.strict {
            return Ok(false);
        }
        work.charge(256)?;
        let contact = witness.contact;
        let va = a.point_velocity(start, contact.point1);
        let vb = b.point_velocity(start, contact.point2);
        let rate = (0..3).fold(Bound::exact(0.), |sum, i| {
            sum.add(
                Bound::exact(f64::from(vb[i]))
                    .sub(Bound::exact(f64::from(va[i])))
                    .mul(Bound::exact(f64::from(contact.normal1[i]))),
            )
        });
        if !rate.finite() || rate.lo < 0. {
            return Ok(false);
        }
    }
    separated(a, &pa, b, &pb, start, end, selected, work)
}
