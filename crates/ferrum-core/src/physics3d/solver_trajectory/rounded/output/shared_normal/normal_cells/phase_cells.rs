//! Complete equal-output cells on the positive scalar rotation branch.
use super::{
    last_true, normalized_action, point_action as action, Clock, Float, NormalProjection,
    RawEndpoint, RawRange, Time, TrajectoryError, Work, MAX_RANGES,
};

#[derive(Clone, Copy)]
struct Phase {
    raw: RawEndpoint,
    axial: f32,
    factor: f32,
    scale: f32,
    scalar_squared: f32,
}

impl Phase {
    fn new(raw: RawEndpoint) -> Self {
        Self::with_scalar_square(raw, raw.scalar * raw.scalar)
    }

    fn with_scalar_square(raw: RawEndpoint, raw_scalar_squared: f32) -> Self {
        // Original Native scalar norm and normalization. The other two axis
        // terms are numeric zero under the projection's existing guard.
        let norm = raw.axial * raw.axial + raw_scalar_squared;
        let factor = norm.sqrt().recip();
        let axial = raw.axial * factor;
        let scalar = raw.scalar * factor;
        let scalar_squared = scalar * scalar;
        let scale = scalar_squared - axial * axial;
        Self {
            raw,
            axial,
            factor,
            scale,
            scalar_squared,
        }
    }

    fn outputs(self, projection: &NormalProjection) -> [f32; 2] {
        [
            action(projection.half, self.axial, self.scale) + projection.translation.hi,
            (projection.center_height() + action(projection.anchor, self.axial, self.scale))
                + projection.offset,
        ]
    }

    fn finite(self) -> bool {
        self.factor.is_finite()
            && self.factor > 0.
            && self.axial.is_finite()
            && self.scale.is_finite()
    }

    fn valid(self) -> bool {
        self.finite() && self.scale >= 0.
    }
}

#[derive(Clone, Copy)]
enum Boundary {
    RawPair,
    Normalization,
    Scale,
}

impl Boundary {
    fn same(self, a: Phase, b: Phase) -> bool {
        match self {
            Self::RawPair => {
                a.raw.scalar.to_bits() == b.raw.scalar.to_bits()
                    && a.raw.axial.to_bits() == b.raw.axial.to_bits()
            }
            Self::Normalization => {
                a.raw.scalar.to_bits() == b.raw.scalar.to_bits()
                    && a.factor.to_bits() == b.factor.to_bits()
            }
            Self::Scale => a.scale.to_bits() == b.scale.to_bits(),
        }
    }

    fn next_input(self, phase: Phase, rotation: InputRotation, last: u32) -> Option<u32> {
        let to_bits = |dt: f32| {
            let bits = dt.to_bits();
            (dt.is_finite() && bits > phase.raw.input && bits <= last).then_some(bits)
        };
        match self {
            Self::RawPair => [
                to_input(rotation.scalar_step(phase.raw.scalar), rotation.angular),
                from_axial(
                    phase.raw.axial.next_up(),
                    rotation.axial,
                    rotation.scalar,
                    rotation.angular,
                ),
            ]
            .into_iter()
            .filter_map(to_bits)
            .min(),
            Self::Normalization => rotation
                .normalization_inputs(phase)
                .into_iter()
                .filter_map(to_bits)
                .min(),
            Self::Scale => to_bits(rotation.scale_input(phase)),
        }
    }
}

#[derive(Clone, Copy)]
struct InputRotation {
    axial: f32,
    scalar: f32,
    angular: f32,
}

fn lower_edge(x: f32) -> f64 {
    (f64::from(x) + f64::from(x.next_down())) * 0.5
}

fn even(x: f32) -> bool {
    x.to_bits() & 1 == 0
}

fn rounded_above(value: f64, include_equal: bool) -> f32 {
    let rounded = value as f32;
    let widened = f64::from(rounded);
    if widened < value || (!include_equal && widened == value) {
        rounded.next_up()
    } else {
        rounded
    }
}

fn to_input(hang: f32, angular: f32) -> f32 {
    rounded_above(lower_edge(hang) / f64::from(angular), even(hang)) * 2.
}

fn axial_step(axial: f32, initial: f32, scalar: f32) -> f32 {
    let product = rounded_above(lower_edge(axial) - f64::from(initial), even(axial));
    rounded_above(lower_edge(product) / f64::from(scalar), even(product))
}

fn from_axial(axial: f32, initial: f32, scalar: f32, angular: f32) -> f32 {
    to_input(axial_step(axial, initial, scalar), angular)
}

// Invert the first rounded norm change that can decrease the factor.
fn next_norm_component(factor: f32, fixed_square: f32) -> f32 {
    let length = rounded_above(1. / lower_edge(factor), even(factor.next_down()));
    let norm = rounded_above(lower_edge(length).powi(2), even(length));
    let square = rounded_above(lower_edge(norm) - f64::from(fixed_square), even(norm));
    rounded_above(lower_edge(square).sqrt(), even(square))
}

impl InputRotation {
    fn for_projection(projection: &NormalProjection) -> Option<Self> {
        let initial = projection.kernel.native.motion.start.rotation.to_array();
        let rotation = Self {
            axial: initial[projection.axis],
            scalar: initial[3],
            angular: projection.kernel.native.angular_velocity[projection.axis],
        };
        (rotation.axial > 0. && rotation.scalar > 0. && rotation.angular > 0.).then_some(rotation)
    }

    // These inverses nominate inputs. Both original neighboring outputs
    // still have to confirm each change.
    fn scalar_step(self, w: f32) -> f32 {
        let w_product = rounded_above(f64::from(self.scalar) - lower_edge(w), even(w.next_down()));
        rounded_above(
            lower_edge(w_product) / f64::from(self.axial),
            even(w_product),
        )
    }

    fn step(self, dt: u32) -> f32 {
        self.angular * (f32::from_bits(dt) * 0.5)
    }

    fn scalar_at(self, step: f32) -> f32 {
        self.scalar - step * self.axial
    }

    fn axial_at(self, step: f32) -> f32 {
        self.axial + step * self.scalar
    }

    fn normalization_inputs(self, phase: Phase) -> [f32; 2] {
        let w = phase.raw.scalar;
        let w_input = to_input(self.scalar_step(w), self.angular);
        let y = next_norm_component(phase.factor, w * w);
        let norm_input = from_axial(y, self.axial, self.scalar, self.angular);
        [w_input, norm_input]
    }

    fn scale_input(self, phase: Phase) -> f32 {
        let scale_squared = rounded_above(
            f64::from(phase.scalar_squared) - lower_edge(phase.scale),
            even(phase.scale.next_down()),
        );
        let normalized_y = rounded_above(lower_edge(scale_squared).sqrt(), even(scale_squared));
        let raw_y = rounded_above(
            lower_edge(normalized_y) / f64::from(phase.factor),
            even(normalized_y),
        );
        from_axial(raw_y, self.axial, self.scalar, self.angular)
    }
}

#[derive(Clone, Copy)]
struct Sample {
    at: u64,
    phase: Phase,
}

fn sample(projection: &NormalProjection, clock: Clock, at: u64) -> Sample {
    let dt = match clock {
        Clock::Physical => at as u32,
        Clock::Logical => projection.kernel.local_delta(Time::from_bits(at)).to_bits(),
    };
    Sample {
        at,
        phase: Phase::new(projection.raw_endpoint(dt)),
    }
}

fn logical_guess(projection: &NormalProjection, physical: u32) -> u64 {
    let k = projection.kernel;
    let fraction = lower_edge(f32::from_bits(physical)) / f64::from(k.native.integration_seconds);
    (k.domain.start + k.domain.duration() * fraction).to_bits()
}

fn phase_end(
    projection: &NormalProjection,
    clock: Clock,
    current: Sample,
    end: Sample,
    rotation: InputRotation,
    boundary: Boundary,
    work: &mut Work,
) -> Result<(Sample, Option<Sample>), TrajectoryError> {
    let same = |sample: Sample| boundary.same(current.phase, sample.phase);
    if same(end) {
        return Ok((end, None));
    }
    let at = |input| sample(projection, clock, input);
    work.charge(match boundary {
        Boundary::RawPair | Boundary::Normalization => 160,
        Boundary::Scale => 128,
    })?;
    if let Some(physical) = boundary.next_input(current.phase, rotation, end.phase.raw.input) {
        let (guess, attempts) = match clock {
            Clock::Physical => (u64::from(physical), 1),
            Clock::Logical => (logical_guess(projection, physical), 8),
        };
        let mut candidate = guess.clamp(current.at + 1, end.at);
        for _ in 0..attempts {
            work.charge(64)?;
            let next = at(candidate);
            if same(next) {
                if candidate >= end.at {
                    break;
                }
                candidate += 1;
                continue;
            }
            work.charge(64)?;
            let previous = at(candidate - 1);
            // W decreases and raw Y increases. With W fixed, the factor
            // decreases as Y increases. With W and the factor fixed, S
            // decreases. The logical clock uses a monotone dt mapping.
            if same(previous) {
                return Ok((previous, Some(next)));
            }
            if candidate <= current.at + 1 {
                break;
            }
            candidate -= 1;
        }
    }
    let last = last_true(current.at, end.at, work, |input| same(at(input)))?;
    work.charge(128)?;
    Ok((at(last), Some(at(last + 1))))
}

// When the scale is negative the usual face-and-corner bounds need a full
// slab check. A fixed raw pair leaves only the separate logical displacement
// to vary inside each chronological cell.
fn scan_signed(
    projection: &NormalProjection,
    clock: Clock,
    mut current: Sample,
    end: Sample,
    rotation: InputRotation,
    checked: &mut Option<u64>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let limit = match clock {
        Clock::Logical => MAX_RANGES,
        // Refine the first ambiguous scalar group after the bulk pass.
        Clock::Physical => 8,
    };
    for _ in 0..limit {
        if !current.phase.finite() {
            break;
        }
        work.charge(96)?;
        let mut outputs = current.phase.outputs(projection);
        if current.phase.scale < 0. {
            let Some(top) = normalized_action::signed_face_upper(
                projection.half,
                current.phase.axial,
                current.phase.scale,
                work,
            )?
            else {
                break;
            };
            outputs[0] = top + projection.translation.hi;
        }
        let (last, next) = phase_end(
            projection,
            clock,
            current,
            end,
            rotation,
            Boundary::RawPair,
            work,
        )?;
        let Some(passed) = projection.fixed_prefix(outputs, clock, current.at, last.at, work)?
        else {
            break;
        };
        *checked = Some(passed);
        if passed != last.at {
            break;
        }
        let Some(next) = next else {
            return Ok(true);
        };
        current = next;
    }
    Ok(false)
}

fn group_clear(projection: &NormalProjection, clock: Clock, first: Sample, last: Sample) -> bool {
    if !last.phase.valid() {
        return false;
    }
    // With W and the factor fixed, normalized Y increases and the
    // rounded S decreases. The original positive action is monotone
    // in each argument. Bound the whole face and anchor separately.
    let top =
        action(projection.half, last.phase.axial, first.phase.scale) + projection.translation.hi;
    let center = (projection.center_height()
        + action(projection.anchor, first.phase.axial, last.phase.scale))
        + projection.offset;
    projection.separates(
        [top, center],
        [top, center],
        [
            projection.relative(clock, first.at),
            projection.relative(clock, last.at),
        ],
    )
}

// The paired comparison needs only a directed lower gap. A
// downward step at each subtraction covers even the non-Sterbenz cases.
fn image_separates(projection: &NormalProjection, [top, center]: [f32; 2]) -> bool {
    let world = (f64::from(center + projection.core) - f64::from(projection.radius)).next_down();
    let local = f64::from(center + projection.pole);
    world.is_finite()
        && local.is_finite()
        && top.is_finite()
        && (world.min(local) - f64::from(top)).next_down() > f64::from(projection.clearance)
}

fn action_on_physical_range(
    projection: &NormalProjection,
    range: RawRange,
    coordinate: f32,
    work: &mut Work,
) -> Result<Option<[f32; 2]>, TrajectoryError> {
    let dt = Float {
        lo: f32::from_bits(range.first.input),
        hi: f32::from_bits(range.last.input),
    };
    if !(0. < dt.lo && dt.lo <= dt.hi && dt.hi < projection.kernel.native.integration_seconds) {
        return Ok(None);
    }
    let Some(action) =
        normalized_action::interior(projection.kernel, projection.axis, dt, coordinate, work)?
    else {
        return Ok(None);
    };
    Ok(super::super::represented_action_range(action))
}

/// Precompute a sufficient center for the fixed worst box height. The
/// original plane comparisons are monotone over these nonnegative F32 inputs.
fn center_for_box_ceiling(
    projection: &NormalProjection,
    physical: RawRange,
    face_mask: u32,
    work: &mut Work,
) -> Result<Option<f32>, TrajectoryError> {
    let mut remaining = face_mask;
    let mut upper = f32::NEG_INFINITY;
    while remaining != 0 {
        let index = remaining.trailing_zeros();
        remaining &= remaining - 1;
        let point = f32::from_bits(projection.half.to_bits() - index);
        let Some([_, high]) = action_on_physical_range(projection, physical, point, work)? else {
            return Ok(None);
        };
        upper = upper.max(high);
    }
    let top = upper + projection.translation.hi;
    work.charge(64)?;
    if !image_separates(projection, [top, f32::MAX]) {
        return Ok(None);
    }
    let mut low = 0_u32;
    let mut high = f32::MAX.to_bits();
    while low < high {
        work.charge(32)?;
        let mid = low + (high - low) / 2;
        if image_separates(projection, [top, f32::from_bits(mid)]) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }
    Ok(Some(f32::from_bits(low)))
}

const MAX_IMAGES: u32 = 8;
// The coupled traversal still shares the same global image limit, but a
// single slowly changing axial value may own many nearby scalar values.
const MAX_COUPLED_GROUP: u32 = 64;

struct ProjectedImages<'a> {
    projection: &'a NormalProjection,
    face_mask: u32,
    upper_center: Option<f32>,
    fixed_center: Option<f32>,
}

impl ProjectedImages<'_> {
    fn clear(
        &self,
        range: RawRange,
        relative: Option<f32>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let (first, last) = varying_bits(range);
        let scalar_squared = range.first.scalar * range.first.scalar;
        work.charge(u64::from(last - first + 1) * 32)?;
        for bits in first..=last {
            let phase = Phase::with_scalar_square(
                RawEndpoint {
                    axial: f32::from_bits(bits),
                    ..range.first
                },
                scalar_squared,
            );
            if !phase.finite() || !self.clear_phase(phase.axial, phase.scale, relative, work)? {
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn clear_fixed_axial(
        &self,
        range: RawRange,
        remaining: u32,
        relative: Option<f32>,
        work: &mut Work,
    ) -> Result<Option<u32>, TrajectoryError> {
        let (first, last) = varying_bits(range);
        let raw_axial = range.first.axial;
        work.charge(16)?;
        let raw_square = raw_axial * raw_axial;
        let mut norm = f32::NAN;
        let mut factor = 0.;
        let mut axial = 0.;
        let mut axial_square = 0.;
        let mut last_projection = None;
        let mut count = 0;
        for bits in first..=last {
            work.charge(8)?;
            let raw_scalar = f32::from_bits(bits);
            let next_norm = raw_square + raw_scalar * raw_scalar;
            if next_norm != norm {
                work.charge(16)?;
                norm = next_norm;
                factor = norm.sqrt().recip();
                axial = raw_axial * factor;
                axial_square = axial * axial;
                if !(factor > 0. && factor.is_finite() && axial.is_finite()) {
                    return Ok(None);
                }
            }
            let scalar = raw_scalar * factor;
            let scale = scalar * scalar - axial_square;
            let projection = (axial.to_bits(), scale.to_bits());
            // A fixed normalized axis and scale give the same two rounded
            // support expressions. The translation and relative term are
            // also immutable inside this projected image.
            if last_projection == Some(projection) {
                continue;
            }
            if count == remaining {
                return Ok(None);
            }
            count += 1;
            work.charge(8)?;
            if !self.clear_phase(axial, scale, relative, work)? {
                return Ok(None);
            }
            last_projection = Some(projection);
        }
        Ok(Some(count))
    }

    fn clear_axial_scale_cells(
        &self,
        range: RawRange,
        remaining: u32,
        relative: Option<f32>,
        work: &mut Work,
    ) -> Result<Option<u32>, TrajectoryError> {
        let (mut first, last) = varying_bits(range);
        let raw = range.first;
        let phase_at = |bits| {
            Phase::new(RawEndpoint {
                scalar: f32::from_bits(bits),
                ..raw
            })
        };
        let remaining = remaining.min(MAX_COUPLED_GROUP);
        let mut count = 0;
        let mut previous = None;
        loop {
            work.charge(96)?;
            let phase = phase_at(first);
            if !phase.finite() {
                return Ok(None);
            }
            // For a fixed positive raw axis, increasing the nonnegative
            // scalar increases the rounded squared norm. The normalization
            // factor is therefore nonincreasing throughout this range.
            let same = |bits| phase_at(bits).factor.to_bits() == phase.factor.to_bits();
            let right = if same(last) {
                last
            } else {
                let next = next_norm_component(phase.factor, raw.axial * raw.axial).to_bits();
                work.charge(128)?;
                if first < next && next <= last && same(next - 1) && !same(next) {
                    next - 1
                } else {
                    last_true(u64::from(first), u64::from(last - 1), work, |bits| {
                        same(bits as u32)
                    })? as u32
                }
            };
            let end = phase_at(right);
            if !end.finite() {
                return Ok(None);
            }
            // Equal factors give identical normalized axes. The scalar
            // product, its square and the subtraction are monotone here.
            // Certify every represented scale between the two endpoints.
            let mut scale = phase.scale;
            loop {
                let projection = (phase.axial.to_bits(), scale.to_bits());
                if previous != Some(projection) {
                    if count == remaining {
                        return Ok(None);
                    }
                    count += 1;
                    work.charge(8)?;
                    if !self.clear_phase(phase.axial, scale, relative, work)? {
                        return Ok(None);
                    }
                    previous = Some(projection);
                }
                if scale >= end.scale {
                    break;
                }
                scale = scale.next_up();
            }
            if right == last {
                return Ok(Some(count));
            }
            first = right + 1;
        }
    }

    fn clear_phase(
        &self,
        axial: f32,
        scale: f32,
        relative: Option<f32>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        if !scale.is_finite() || (scale < 0. && self.face_mask == 1) {
            return Ok(false);
        }
        let projection = self.projection;
        let mut center = self.fixed_center.unwrap_or_else(|| {
            (projection.center_height() + action(projection.anchor, axial, scale))
                + projection.offset
        });
        if let Some(relative) = relative {
            center += relative;
        }
        if self
            .upper_center
            .is_some_and(|minimum| center.is_finite() && center >= minimum)
        {
            return Ok(true);
        }
        work.charge(16)?;
        let mut top = action(projection.half, axial, scale);
        if scale < 0. {
            let mut nearby = self.face_mask & !1;
            work.charge(8 * u64::from(nearby.count_ones()))?;
            while nearby != 0 {
                let index = nearby.trailing_zeros();
                nearby &= nearby - 1;
                let point = f32::from_bits(projection.half.to_bits() - index);
                top = top.max(action(point, axial, scale));
            }
        }
        if !image_separates(projection, [top + projection.translation.hi, center]) {
            return Ok(false);
        }
        Ok(true)
    }
}

#[derive(Clone, Copy)]
enum RawComponent {
    Scalar,
    Axial,
}

impl RawComponent {
    fn value(self, raw: RawEndpoint) -> f32 {
        match self {
            Self::Scalar => raw.scalar,
            Self::Axial => raw.axial,
        }
    }

    fn encloses(self, rotation: InputRotation, step: f32, frontier: f32) -> bool {
        match self {
            Self::Scalar => rotation.scalar_at(step) >= frontier,
            Self::Axial => rotation.axial_at(step) <= frontier,
        }
    }
}

struct CoupledRaw {
    component: RawComponent,
    group_origin: f64,
    other_origin: f64,
    ratio: [f64; 2],
    error: f64,
}

impl CoupledRaw {
    fn new(rotation: InputRotation, range: RawRange, component: RawComponent) -> Option<Self> {
        let exponent = |value: f32| (value.to_bits() >> 23) & 255;
        let (group_origin, other_origin, group_max, edge, group_rate, other_rate) = match component
        {
            RawComponent::Scalar => (
                rotation.scalar,
                rotation.axial,
                range.first.scalar,
                range.last.scalar,
                rotation.axial,
                rotation.scalar,
            ),
            RawComponent::Axial => (
                rotation.axial,
                rotation.scalar,
                range.last.axial,
                range.last.axial,
                rotation.scalar,
                rotation.axial,
            ),
        };
        let e = exponent(group_origin);
        if e == 0
            || e == 255
            || e != exponent(edge)
            || !(0. < range.first.axial && range.first.axial <= range.last.axial)
            || !(0. < range.last.scalar && range.last.scalar <= range.first.scalar)
        {
            return None;
        }
        let half_ulp = |value: f32| (f64::from(value.next_up()) - f64::from(value)) * 0.5;
        let step = rotation.step(range.last.input);
        let ratio = f64::from(other_rate) / f64::from(group_rate);
        let ratio = [ratio.next_down(), ratio.next_up()];
        // The rounded change in the grouped component bounds the common
        // step. Propagate its two roundings and the other product's rounding
        // before converting the remaining component to its original F32 grid.
        let group_error = (half_ulp(group_max) + half_ulp(step * group_rate)).next_up();
        let product_error = (group_error * ratio[1]).next_up();
        let error = (product_error + half_ulp(step * other_rate)).next_up();
        (ratio[1].is_finite() && error.is_finite()).then_some(Self {
            component,
            group_origin: f64::from(group_origin),
            other_origin: f64::from(other_origin),
            ratio,
            error,
        })
    }

    fn image(&self, group: f32, range: RawRange) -> RawRange {
        // These same-binade subtractions are exact. Scalar decreases as the
        // axis increases, so they share the same nonnegative displacement.
        let distance = (self.group_origin - f64::from(group)).abs();
        let change_lo = (distance * self.ratio[0]).next_down();
        let change_hi = (distance * self.ratio[1]).next_up();
        let (low, high) = match self.component {
            RawComponent::Scalar => (
                (self.other_origin + change_lo).next_down(),
                (self.other_origin + change_hi).next_up(),
            ),
            RawComponent::Axial => (
                (self.other_origin - change_hi).next_down(),
                (self.other_origin - change_lo).next_up(),
            ),
        };
        let lower = (low - self.error).next_down() as f32;
        let upper = (high + self.error).next_up() as f32;
        match self.component {
            RawComponent::Scalar => RawRange {
                first: RawEndpoint {
                    axial: lower.max(range.first.axial),
                    scalar: group,
                    ..range.first
                },
                last: RawEndpoint {
                    axial: upper.min(range.last.axial),
                    scalar: group,
                    ..range.last
                },
            },
            RawComponent::Axial => RawRange {
                first: RawEndpoint {
                    axial: group,
                    scalar: lower.max(range.last.scalar),
                    ..range.first
                },
                last: RawEndpoint {
                    axial: group,
                    scalar: upper.min(range.first.scalar),
                    ..range.last
                },
            },
        }
    }
}

fn varying_bits(range: RawRange) -> (u32, u32) {
    if range.first.scalar == range.last.scalar {
        (range.first.axial.to_bits(), range.last.axial.to_bits())
    } else {
        (range.first.scalar.to_bits(), range.last.scalar.to_bits())
    }
}

fn coupled_prefix(
    image: &ProjectedImages<'_>,
    rotation: InputRotation,
    range: RawRange,
    remaining: &mut u32,
    falling_end: Option<Time>,
    work: &mut Work,
) -> Result<Option<(RawComponent, f32)>, TrajectoryError> {
    let axes = range
        .last
        .axial
        .to_bits()
        .saturating_sub(range.first.axial.to_bits());
    let scalars = range
        .first
        .scalar
        .to_bits()
        .saturating_sub(range.last.scalar.to_bits());
    let axial = (axes < scalars / 2)
        .then(|| CoupledRaw::new(rotation, range, RawComponent::Axial))
        .flatten();
    let Some(coupled) = axial.or_else(|| CoupledRaw::new(rotation, range, RawComponent::Scalar))
    else {
        return Ok(None);
    };
    work.charge(256)?;
    let first = coupled.component.value(range.first).to_bits();
    let last = coupled.component.value(range.last).to_bits();
    let last_step = rotation.step(range.last.input);
    let mut proved = None;
    for delta in 0..=first.abs_diff(last) {
        work.charge(48)?;
        let bits = match coupled.component {
            RawComponent::Scalar => first - delta,
            RawComponent::Axial => first + delta,
        };
        let group = f32::from_bits(bits);
        let range = coupled.image(group, range);
        let (first, last) = varying_bits(range);
        if first > last {
            // This rounded group cannot contain an original rotation.
            proved = Some((coupled.component, group));
            continue;
        }
        let relative = if let Some(end) = falling_end {
            work.charge(160)?;
            let beyond = match coupled.component {
                RawComponent::Scalar => rotation.scalar_step(group),
                RawComponent::Axial => axial_step(group.next_up(), rotation.axial, rotation.scalar),
            };
            // A forward evaluation outside the inclusive group establishes
            // an upper time bound by monotonicity. Inverse estimates alone
            // cannot select a lower displacement bound.
            let right = if beyond.is_finite()
                && beyond >= 0.
                && !coupled.component.encloses(rotation, beyond, group)
            {
                beyond.min(last_step)
            } else {
                last_step
            };
            Some(falling_displacement(image.projection, rotation, right, end))
        } else {
            None
        };
        let images = last - first + 1;
        let count = if range.first.scalar == range.last.scalar {
            if images > MAX_COUPLED_GROUP
                || images > *remaining
                || !image.clear(range, relative, work)?
            {
                break;
            }
            images
        } else {
            // The global allowance counts the distinct proved projections.
            // Every examined original scalar still charges the shared Work.
            let covered = if images <= MAX_COUPLED_GROUP {
                image.clear_fixed_axial(range, *remaining, relative, work)?
            } else {
                image.clear_axial_scale_cells(range, *remaining, relative, work)?
            };
            let Some(count) = covered else {
                break;
            };
            count
        };
        *remaining -= count;
        proved = Some((coupled.component, group));
    }
    Ok(proved)
}

// Walk the original rounded angular step. Each verified W cell encloses all
// physical inputs that map into it, even if some step values are skipped.
// Translate a certified step back to a physical time only at the frontier.
#[allow(clippy::too_many_arguments)]
fn scalar_image_prefix(
    projection: &NormalProjection,
    rotation: InputRotation,
    first: RawEndpoint,
    last: RawEndpoint,
    face_mask: u32,
    falling_end: Option<Time>,
    fixed_center: Option<f32>,
    work: &mut Work,
) -> Result<Option<f32>, TrajectoryError> {
    // Same maximum number of quaternion images as the per-physical-cell
    // scan. Charge the W boundaries and each bounded image to shared Work.
    let scalar_span = first.scalar.to_bits().saturating_sub(last.scalar.to_bits());
    let axial_span = last.axial.to_bits().saturating_sub(first.axial.to_bits());
    let full_physical_scan = scalar_span >= 4096;
    let wide_falling_scan = scalar_span / (axial_span + 1) >= MAX_COUPLED_GROUP;
    let upper_center = if full_physical_scan && falling_end.is_none() {
        center_for_box_ceiling(projection, RawRange { first, last }, face_mask, work)?
    } else {
        None
    };
    // Some signed rotations have enough clearance even at the lowest
    // represented capsule center and the highest supported box point.
    // This proof covers all original rotations in the physical scan.
    if upper_center
        .zip(fixed_center)
        .is_some_and(|(minimum, center)| center >= minimum)
    {
        return Ok(Some(rotation.step(last.input)));
    }
    if let Some(minimum) = upper_center.filter(|_| face_mask != 1 && fixed_center.is_none()) {
        if let Some([low, _]) = action_on_physical_range(
            projection,
            RawRange { first, last },
            projection.anchor,
            work,
        )? {
            let lower_center = (projection.center_height() + low) + projection.offset;
            if lower_center.is_finite() && lower_center >= minimum {
                return Ok(Some(rotation.step(last.input)));
            }
        }
    }
    let image = ProjectedImages {
        projection,
        face_mask,
        upper_center,
        fixed_center,
    };
    let mut remaining = MAX_RANGES as u32 * MAX_IMAGES;
    let mut step = rotation.step(first.input);
    let end = rotation.step(last.input);
    let mut scalar = first.scalar;
    let mut proved = None;
    if full_physical_scan && (falling_end.is_none() || wide_falling_scan) {
        if let Some((component, covered)) = coupled_prefix(
            &image,
            rotation,
            RawRange { first, last },
            &mut remaining,
            falling_end,
            work,
        )? {
            if covered == component.value(last) {
                return Ok(Some(end));
            }
            // Only the frontier needs the original physical time mapping.
            let input = last_true(u64::from(first.input), u64::from(last.input), work, |dt| {
                component.encloses(rotation, rotation.step(dt as u32), covered)
            })? as u32;
            proved = Some(rotation.step(input));
            step = rotation.step(input + 1);
            scalar = rotation.scalar_at(step);
        }
    }
    while remaining != 0 {
        work.charge(96)?;
        let (right, next) = if scalar == last.scalar {
            (end, None)
        } else {
            let next_step = rotation.scalar_step(scalar);
            if !(step < next_step && next_step <= end) {
                break;
            }
            let previous_step = next_step.next_down();
            let next_scalar = rotation.scalar_at(next_step);
            if rotation.scalar_at(previous_step) != scalar || next_scalar >= scalar {
                break;
            }
            (previous_step, Some((next_step, next_scalar)))
        };
        let axial = rotation.axial_at(step);
        let axial_end = rotation.axial_at(right);
        if !(axial > 0. && axial <= axial_end && axial_end.is_finite()) {
            break;
        }
        let first_bits = axial.to_bits();
        let last_bits = axial_end.to_bits();
        let images = last_bits - first_bits + 1;
        if images > remaining || (images > MAX_IMAGES && !(face_mask == 1 && images <= 128)) {
            break;
        }
        let relative = if let Some(end) = falling_end {
            work.charge(128)?;
            Some(falling_displacement(projection, rotation, right, end))
        } else {
            None
        };
        let raw = RawEndpoint {
            axial,
            scalar,
            ..first
        };
        let clear = if images <= MAX_IMAGES {
            if image.clear(
                RawRange {
                    first: raw,
                    last: RawEndpoint {
                        axial: axial_end,
                        scalar,
                        ..last
                    },
                },
                relative,
                work,
            )? {
                remaining -= images;
                true
            } else {
                false
            }
        } else {
            clear_scalar_block(
                &image,
                raw,
                first_bits,
                last_bits,
                relative,
                &mut remaining,
                work,
            )?
        };
        if !clear {
            break;
        }
        proved = Some(right);
        let Some(continuation) = next else {
            break;
        };
        (step, scalar) = continuation;
    }
    Ok(proved)
}

// Nominate a time beyond this angular step. Verify it on the original
// logical clock before using its downward displacement for the whole cell.
fn falling_displacement(
    projection: &NormalProjection,
    rotation: InputRotation,
    right: f32,
    end: Time,
) -> f32 {
    let kernel = projection.kernel;
    let domain = kernel.domain;
    let input = to_input(right.next_up(), rotation.angular).next_up();
    let later = domain.start
        + domain.duration() * (f64::from(input) / f64::from(kernel.native.integration_seconds));
    let bound = if later.is_finite()
        && later < end
        && rotation.step(kernel.local_delta(later).to_bits()) > right
    {
        later
    } else {
        end
    };
    projection.relative(Clock::Logical, bound.to_bits())
}

pub(super) fn moving_phase_prefix(
    projection: &NormalProjection,
    first: u64,
    last: u64,
    work: &mut Work,
) -> Result<Option<u64>, TrajectoryError> {
    let Some(rotation) = InputRotation::for_projection(projection) else {
        let mut checked = None;
        scan_dominant_axis(
            projection,
            Clock::Logical,
            first,
            last,
            None,
            &mut checked,
            work,
        )?;
        return Ok(checked);
    };
    work.charge(512)?;
    let left = sample(projection, Clock::Logical, first).phase;
    let right = sample(projection, Clock::Logical, last).phase;
    if !left.finite() || !right.finite() || right.raw.scalar <= 0. {
        return Ok(None);
    }
    let values = if left.scale >= 0. && right.scale >= 0. {
        1
    } else {
        let Some(values) = signed_face_mask(projection, left, right, work)? else {
            return Ok(None);
        };
        values
    };
    let Some(proved) = scalar_image_prefix(
        projection,
        rotation,
        left.raw,
        right.raw,
        values,
        Some(Time::from_bits(last)),
        None,
        work,
    )?
    else {
        return Ok(None);
    };
    let passed = last_true(first, last, work, |at| {
        rotation.step(projection.kernel.local_delta(Time::from_bits(at)).to_bits()) <= proved
    })?;
    Ok(Some(passed))
}

fn signed_face_mask(
    projection: &NormalProjection,
    first: Phase,
    last: Phase,
    work: &mut Work,
) -> Result<Option<u32>, TrajectoryError> {
    let y = Float::span(first.raw.axial, last.raw.axial);
    let w = Float::span(first.raw.scalar, last.raw.scalar);
    let norm = y.mul(y).add(w.mul(w));
    if !norm.finite() || norm.lo <= 0. {
        return Ok(None);
    }
    let factor = Float::span(norm.hi.sqrt().recip(), norm.lo.sqrt().recip());
    let y = y.mul(factor);
    let w = w.mul(factor);
    let scale = w.mul(w).sub(y.mul(y));
    normalized_action::signed_face_mask(projection.half, y, scale, work)
}

/// A bounded reservation of actual raw-pair boundaries after a clear start.
/// Unlike the clear-prefix scanner, this can only ask the original witness
/// owner to reject a response proposal.
pub(super) fn signed_conflict(
    projection: &NormalProjection,
    start: Time,
    end: Time,
    prior: Option<Time>,
    search_interior: bool,
    work: &mut Work,
    mut confirm: impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Time>, TrajectoryError> {
    let Some(rotation) = InputRotation::for_projection(projection) else {
        return Ok(None);
    };
    let kernel = projection.kernel;
    let h = kernel.native.integration_seconds;
    let physical = |at| kernel.local_delta(Time::from_bits(at));
    if start.is_sign_negative()
        || !(kernel.domain.start <= start && start < end && end <= kernel.domain.end)
        || !(0. < physical(start.to_bits()) && physical(start.to_bits()) < h)
    {
        return Ok(None);
    }
    let clock = Clock::Logical;
    let current = sample(projection, clock, start.to_bits());
    if !current.phase.finite() || current.phase.scale >= 0. {
        return Ok(None);
    }
    work.charge(256)?;
    let last = last_true(current.at, end.to_bits(), work, |at| physical(at) < h)?;
    let last = sample(projection, clock, last);
    if last.phase.raw.scalar <= 0. {
        return Ok(None);
    }
    const NEARBY_CELLS: usize = 64;
    const EXTENDED_PREFIX_CELLS: usize = 192;
    let mut prefix = Some(current);
    if prior.is_none() {
        let early = signed_conflict_cells(
            projection,
            &mut prefix,
            last,
            rotation,
            start,
            NEARBY_CELLS,
            work,
            &mut confirm,
        )?;
        if early.is_some() || !search_interior {
            return Ok(early);
        }
    }
    // Sparse contacts can fall between coarse probes when the face and
    // anchor products use different F32 grids. Start just before the
    // original quarter probe or the previous pair's hit, and visit actual
    // neighboring raw pairs of the candidate under test.
    work.charge(256)?;
    let center = prior.unwrap_or_else(|| start + (end - start) * 0.25);
    let midpoint = projection.raw_endpoint(kernel.local_delta(center).to_bits());
    let axial = f32::from_bits(midpoint.axial.to_bits().saturating_sub(8));
    let dt = from_axial(axial, rotation.axial, rotation.scalar, rotation.angular);
    let at = kernel.domain.start + kernel.domain.duration() * (f64::from(dt) / f64::from(h));
    if start < at && at < Time::from_bits(last.at) {
        let mut nearby = Some(sample(projection, clock, at.to_bits()));
        let hit = signed_conflict_cells(
            projection,
            &mut nearby,
            last,
            rotation,
            start,
            NEARBY_CELLS,
            work,
            &mut confirm,
        )?;
        if hit.is_some() {
            return Ok(hit);
        }
    }
    // Check the early raw rotation states even when the previous candidate
    // contacted elsewhere. Continue a prefix already visited without
    // revisiting any cells.
    let remaining = if prior.is_some() {
        NEARBY_CELLS + EXTENDED_PREFIX_CELLS
    } else {
        EXTENDED_PREFIX_CELLS
    };
    if let Some(hit) = signed_conflict_cells(
        projection,
        &mut prefix,
        last,
        rotation,
        start,
        remaining,
        work,
        &mut confirm,
    )? {
        return Ok(Some(hit));
    }
    let Some(first) = prefix else { return Ok(None) };
    physical_conflict_cells(projection, first, last, rotation, start, work, &mut confirm)
}

fn physical_conflict_cells(
    projection: &NormalProjection,
    first: Sample,
    last: Sample,
    rotation: InputRotation,
    start: Time,
    work: &mut Work,
    confirm: &mut impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Time>, TrajectoryError> {
    const MAX_CELLS: usize = 8192;
    const MAX_PROBES: usize = 8;
    // Two sample visits and a fallback bisection of a U32 input are
    // bounded by this amount. Leave most of the caller's Work for its cast.
    const MAX_CELL_WORK: u64 = 4096;
    let probe_limit = work.used + (work.limit - work.used) / 4;
    let clock = Clock::Physical;
    let mut current = sample(projection, clock, u64::from(first.phase.raw.input));
    let end = sample(projection, clock, u64::from(last.phase.raw.input));
    let kernel = projection.kernel;
    let domain = kernel.domain;
    let h = f64::from(kernel.native.integration_seconds);
    let mut probes = 0;
    for _ in 0..MAX_CELLS {
        if probe_limit.saturating_sub(work.used) < MAX_CELL_WORK || !current.phase.finite() {
            break;
        }
        work.charge(96)?;
        // Equal raw pairs have equal stationary support projections. Run
        // the logical clock only for states that nominate a real query.
        if projects_conflict(projection, current.phase) {
            let fraction = f64::from(f32::from_bits(current.phase.raw.input)) / h;
            let at = domain.start + domain.duration() * fraction;
            if start < at && at <= Time::from_bits(last.at) {
                if confirm(at, work)? {
                    return Ok(Some(at));
                }
                probes += 1;
                if probes == MAX_PROBES {
                    break;
                }
            }
        }
        let (_, next) = phase_end(
            projection,
            clock,
            current,
            end,
            rotation,
            Boundary::RawPair,
            work,
        )?;
        let Some(next) = next else { break };
        current = next;
    }
    Ok(None)
}

fn projects_conflict(projection: &NormalProjection, phase: Phase) -> bool {
    let [top, center] = phase.outputs(projection);
    let gap = f64::from(center + projection.core) - f64::from(projection.radius) - f64::from(top);
    gap < f64::from(projection.clearance)
}

#[allow(clippy::too_many_arguments)]
fn signed_conflict_cells(
    projection: &NormalProjection,
    cursor: &mut Option<Sample>,
    last: Sample,
    rotation: InputRotation,
    start: Time,
    cells: usize,
    work: &mut Work,
    confirm: &mut impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Time>, TrajectoryError> {
    const MAX_PROBES: usize = 8;
    let mut probes = 0;
    for _ in 0..cells {
        let Some(current) = *cursor else { break };
        work.charge(96)?;
        let at = Time::from_bits(current.at);
        if start < at && projects_conflict(projection, current.phase) {
            if confirm(at, work)? {
                return Ok(Some(at));
            }
            probes += 1;
            if probes == MAX_PROBES {
                *cursor = None;
                break;
            }
        }
        let (_, next) = phase_end(
            projection,
            Clock::Logical,
            current,
            last,
            rotation,
            Boundary::RawPair,
            work,
        )?;
        *cursor = next;
    }
    Ok(None)
}

/// Nominate times on both sides of a previously confirmed contact. The
/// scalar screen can only ask for a new full world witness.
pub(super) fn nearby_conflict(
    projection: &NormalProjection,
    start: Time,
    end: Time,
    prior: Time,
    work: &mut Work,
    mut confirm: impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Time>, TrajectoryError> {
    const NEIGHBORS: i64 = 64;
    const MAX_CONFIRMATIONS: usize = 8;
    let k = projection.kernel;
    let initial = k.native.motion.start.rotation.to_array();
    let angular = k.native.angular_velocity[projection.axis];
    let axial = initial[projection.axis];
    if !(axial > 0. && initial[3] > 0. && angular > 0.) {
        return Ok(None);
    }
    work.charge(256)?;
    let raw = |time| projection.raw_endpoint(k.local_delta(time).to_bits()).axial;
    let first = raw(start);
    let last = raw(end);
    let center = raw(prior);
    if !first.is_finite() || !last.is_finite() || !(first <= center && center <= last) {
        return Ok(None);
    }
    let first = i64::from(first.to_bits());
    let last = i64::from(last.to_bits());
    let center = i64::from(center.to_bits());
    let inverse = |value| from_axial(value, axial, initial[3], angular);
    let offsets = std::iter::once(0).chain((1..=NEIGHBORS).flat_map(|n| [-n, n]));
    let mut confirmations = 0;
    for offset in offsets {
        let bits = center + offset;
        if !(first..=last).contains(&bits) {
            continue;
        }
        work.charge(128)?;
        let raw_y = f32::from_bits(bits as u32);
        for dt in [inverse(raw_y), inverse(raw_y.next_up()).next_down()] {
            if !(dt > 0. && dt < k.native.integration_seconds) {
                continue;
            }
            work.charge(64)?;
            let fraction = f64::from(dt) / f64::from(k.native.integration_seconds);
            let at = k.domain.start + fraction * k.domain.duration();
            if !(start < at && at < end) || at.to_bits() == prior.to_bits() {
                continue;
            }
            let phase = sample(projection, Clock::Logical, at.to_bits()).phase;
            if !phase.valid() {
                continue;
            }
            let [top, center] = phase.outputs(projection);
            let gap =
                f64::from(center + projection.core) - f64::from(projection.radius) - f64::from(top);
            if gap >= f64::from(projection.clearance) || !gap.is_finite() {
                continue;
            }
            if confirm(at, work)? {
                return Ok(Some(at));
            }
            confirmations += 1;
            if confirmations == MAX_CONFIRMATIONS {
                return Ok(None);
            }
        }
    }
    Ok(None)
}

/// Bound matching scalar outputs in one F32 binade. The axial input
/// is counted in the finer units of at most two adjacent binades.
struct ReversedRawGrid {
    start_axial: i64,
    axial_exponent: u32,
    start_scalar: i64,
    slope: [i64; 2],
    rounding: i64,
}

impl ReversedRawGrid {
    const FRACTION_BITS: u32 = 24;
    const ONE: i64 = 1 << Self::FRACTION_BITS;
    const HALF: i64 = Self::ONE / 2;

    fn axial_units(bits: u32, exponent: u32) -> i64 {
        // For normal F32 values, the implicit leading one and mantissa
        // expressed in the lower binade's units also cover the upper binade.
        let mantissa = (bits & 0x007f_ffff) | 0x0080_0000;
        i64::from(mantissa) << ((bits >> 23) - exponent)
    }

    fn new(
        axial: f32,
        scalar: f32,
        last: RawEndpoint,
        ratio: [f64; 2],
        rounding: f64,
    ) -> Option<Self> {
        let exponent = |x: f32| x.to_bits() >> 23;
        let final_axial = last.axial.abs();
        let axial_exponent = exponent(final_axial);
        if !axial.is_normal()
            || !scalar.is_normal()
            || !final_axial.is_normal()
            || exponent(axial).checked_sub(axial_exponent)? > 1
            || exponent(scalar) != exponent(last.scalar.abs())
        {
            return None;
        }
        let spacing = |x: f32| f64::from(x.next_up()) - f64::from(x);
        // The ratio of two F32 spacings is a power of two. Scaling the
        // directed F64 ratio by that and by ONE preserves its enclosure.
        let scale = (spacing(final_axial) / spacing(scalar)) * Self::ONE as f64;
        let slope = [
            (ratio[0] * scale).floor() as i64,
            (ratio[1] * scale).ceil() as i64,
        ];
        let rounding = (rounding * (Self::ONE as f64 / spacing(scalar))).ceil() as i64;
        let start_axial = Self::axial_units(axial.to_bits(), axial_exponent);
        let steps = start_axial - Self::axial_units(final_axial.to_bits(), axial_exponent);
        slope[1]
            .checked_mul(steps)?
            .checked_add(rounding)?
            .checked_add(Self::HALF)?;
        Some(Self {
            start_axial,
            axial_exponent,
            start_scalar: i64::from(scalar.to_bits()),
            slope,
            rounding,
        })
    }

    fn bounds(&self, axial: u32, first: f32, last: f32) -> (f32, f32) {
        let steps = self.start_axial - Self::axial_units(axial, self.axial_exponent);
        let lo = steps * self.slope[0] - self.rounding;
        let hi = steps * self.slope[1] + self.rounding;
        // Admit both neighbors at a midpoint irrespective of parity. The
        // input was finite and normal on one scalar binade.
        let lower = self.start_scalar + ((lo + Self::HALF - 1) >> Self::FRACTION_BITS);
        let upper = self.start_scalar + ((hi + Self::HALF) >> Self::FRACTION_BITS);
        let min = i64::from(first.to_bits());
        let max = i64::from(last.to_bits());
        let lower = lower.clamp(min, max);
        let upper = upper.clamp(min, max);
        (f32::from_bits(lower as u32), f32::from_bits(upper as u32))
    }
}

/// A fixed axial output bounds the shared integration step. Work backwards
/// through its rounding to enclose all matching increasing scalar outputs.
fn reversed_axial_image(
    image: &ProjectedImages<'_>,
    first: RawEndpoint,
    last: RawEndpoint,
    remaining: &mut u32,
    work: &mut Work,
) -> Result<Option<f32>, TrajectoryError> {
    let projection = image.projection;
    let kernel = projection.kernel;
    let initial = kernel.native.motion.start.rotation.to_array();
    let y0 = initial[projection.axis];
    let w0 = initial[3];
    let omega = kernel.native.angular_velocity[projection.axis];
    let direction = f64::from(y0) * f64::from(w0) * f64::from(omega);
    if projection.velocity != 0.
        || direction >= 0.
        || first.axial.is_sign_negative() != y0.is_sign_negative()
        || last.axial.is_sign_negative() != y0.is_sign_negative()
        || first.scalar.is_sign_negative() != w0.is_sign_negative()
        || last.scalar.is_sign_negative() != w0.is_sign_negative()
        || !(0. < last.axial.abs() && last.axial.abs() <= first.axial.abs())
        || !(0. < first.scalar.abs() && first.scalar.abs() <= last.scalar.abs())
    {
        return Ok(None);
    }
    let angular_step = omega.abs() * (f32::from_bits(last.input) * 0.5);
    let y0 = f64::from(y0.abs());
    let w0 = f64::from(w0.abs());
    let ratio = y0 / w0;
    let ratio = [ratio.next_down(), ratio.next_up()];
    let half_ulp = |value: f32| (f64::from(value.next_up()) - f64::from(value)) * 0.5;
    let axis_rounding =
        (half_ulp(first.axial.abs()) + half_ulp(angular_step * w0 as f32)).next_up();
    let scalar_rounding =
        ((axis_rounding * ratio[1]).next_up() + half_ulp(angular_step * y0 as f32)).next_up();
    if !scalar_rounding.is_finite() {
        return Ok(None);
    }
    work.charge(512)?;
    let mut proved = None;
    let low = last.axial.abs().to_bits();
    let high = first.axial.abs().to_bits();
    let first_scalar = first.scalar.abs();
    let last_scalar = last.scalar.abs();
    let grid = ReversedRawGrid::new(y0 as f32, w0 as f32, last, ratio, scalar_rounding);
    // A wide positive-scale scan can still have a small bounded image.
    // Let the compact grid spend the common image budget before returning to
    // the chronological input search. Every visited raw group is charged.
    let group_limit = if grid.is_some() && image.face_mask == 1 {
        MAX_RANGES as u32 * MAX_IMAGES
    } else {
        MAX_RANGES as u32
    };
    for step in 0..=(high - low).min(group_limit) {
        let bits = high - step;
        let axial = f32::from_bits(bits);
        let (lower, upper) = if let Some(grid) = &grid {
            work.charge(22)?;
            grid.bounds(bits, first_scalar, last_scalar)
        } else {
            work.charge(52)?;
            let distance = y0 - f64::from(axial);
            let lo = (w0 + (distance.next_down() * ratio[0]).next_down()).next_down();
            let hi = (w0 + (distance.next_up() * ratio[1]).next_up()).next_up();
            let lower = (((lo - scalar_rounding).next_down()) as f32).max(first_scalar);
            let upper = (((hi + scalar_rounding).next_up()) as f32).min(last_scalar);
            (lower, upper)
        };
        if lower > upper {
            proved = Some(axial);
            continue;
        }
        let raw = RawEndpoint {
            axial,
            scalar: lower,
            ..first
        };
        let width = upper.to_bits() - lower.to_bits();
        let range = RawRange {
            first: raw,
            last: RawEndpoint {
                scalar: upper,
                ..raw
            },
        };
        let count = if width == 0 {
            let phase = Phase::new(raw);
            if *remaining == 0
                || !phase.finite()
                || !image.clear_phase(phase.axial, phase.scale, None, work)?
            {
                break;
            }
            1
        } else {
            let covered = if width < MAX_COUPLED_GROUP {
                image.clear_fixed_axial(range, *remaining, None, work)?
            } else {
                image.clear_axial_scale_cells(range, *remaining, None, work)?
            };
            let Some(count) = covered else { break };
            count
        };
        *remaining -= count;
        proved = Some(axial);
    }
    Ok(proved)
}

// Bound two positive-scale actions for a fixed raw scalar. A single
// normalization factor makes the first term decrease and the second
// increase. Use the original operation order at the enclosing ends.
fn clear_scalar_block(
    image: &ProjectedImages<'_>,
    raw: RawEndpoint,
    low: u32,
    high: u32,
    relative: Option<f32>,
    remaining: &mut u32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if *remaining == 0 {
        return Ok(false);
    }
    *remaining -= 1;
    work.charge(48)?;
    let at = |bits| {
        Phase::new(RawEndpoint {
            axial: f32::from_bits(bits),
            ..raw
        })
    };
    let first = at(low);
    if low == high {
        return image.clear_phase(first.axial, first.scale, relative, work);
    }
    let last = at(high);
    if first.factor.to_bits() == last.factor.to_bits() && first.valid() && last.valid() {
        let p = image.projection;
        let second = |point, axis| axis * ((axis * point) * 2.);
        let half = p.half;
        let top = (half * first.scale + second(half, last.axial)) + p.translation.hi;
        let mut center = image.fixed_center.unwrap_or_else(|| {
            let action = p.anchor * last.scale + second(p.anchor, first.axial);
            (p.center_height() + action) + p.offset
        });
        if let Some(relative) = relative {
            center += relative;
        }
        if image_separates(p, [top, center]) {
            return Ok(true);
        }
    }
    let mid = low + (high - low) / 2;
    Ok(
        clear_scalar_block(image, raw, low, mid, relative, remaining, work)?
            && clear_scalar_block(image, raw, mid + 1, high, relative, remaining, work)?,
    )
}

/// The reversed lane can cross many axial grid positions without
/// changing its raw scalar. Invert the scalar range to bound the axial
/// input, then compare whole blocks that share a normalization factor.
fn reversed_scalar_image(
    image: &ProjectedImages<'_>,
    first: RawEndpoint,
    last: RawEndpoint,
    remaining: &mut u32,
    work: &mut Work,
) -> Result<Option<f32>, TrajectoryError> {
    let p = image.projection;
    let native = p.kernel.native;
    let q = native.motion.start.rotation.to_array();
    let omega = native.angular_velocity[p.axis];
    let y0 = q[p.axis];
    let w0 = q[3];
    let a = [first.axial.abs(), last.axial.abs()];
    let w = [first.scalar.abs(), last.scalar.abs()];
    let steps = w[1].to_bits().saturating_sub(w[0].to_bits());
    if image.face_mask != 1
        || p.velocity != 0.
        || !(0. < a[1] && a[1] < a[0] && 0. < w[0] && w[0] <= w[1])
        || a[0].to_bits() - a[1].to_bits() < 12u32.saturating_mul(steps + 1)
        || f64::from(y0) * f64::from(w0) * f64::from(omega) >= 0.
        || first.axial.is_sign_negative() != y0.is_sign_negative()
        || last.axial.is_sign_negative() != y0.is_sign_negative()
        || first.scalar.is_sign_negative() != w0.is_sign_negative()
        || last.scalar.is_sign_negative() != w0.is_sign_negative()
    {
        return Ok(None);
    }
    let half_ulp = |x: f32| (f64::from(x.next_up()) - f64::from(x)) * 0.5;
    let h = omega.abs() * (f32::from_bits(last.input) * 0.5);
    let y0 = f64::from(y0.abs());
    let w0 = f64::from(w0.abs());
    let ratio = w0 / y0;
    let ratio = [ratio.next_down(), ratio.next_up()];
    let scalar_product_rounding = half_ulp(h * y0 as f32);
    let axial_product_rounding = half_ulp(h * w0 as f32);
    if !(ratio[1].is_finite()
        && scalar_product_rounding.is_finite()
        && axial_product_rounding.is_finite())
    {
        return Ok(None);
    }
    work.charge(512)?;
    let mut proved = None;
    for step in 0..=steps.min(MAX_RANGES as u32) {
        work.charge(52)?;
        let scalar = f32::from_bits(w[0].to_bits() + step);
        // The rounding cell is local to this scalar. At a binade
        // boundary its two sides can have different widths.
        let below = (f64::from(scalar) - f64::from(scalar.next_down())) * 0.5;
        let above = half_ulp(scalar);
        let low_error = (((above + scalar_product_rounding).next_up() * ratio[1]).next_up()
            + axial_product_rounding)
            .next_up();
        let high_error = (((below + scalar_product_rounding).next_up() * ratio[1]).next_up()
            + axial_product_rounding)
            .next_up();
        let delta = f64::from(scalar) - w0;
        let lo = (y0 - (delta.next_up() * ratio[1]).next_up()).next_down();
        let hi = (y0 - (delta.next_down() * ratio[0]).next_down()).next_up();
        let low = (((lo - low_error).next_down()) as f32).max(a[1]).to_bits();
        let high = (((hi + high_error).next_up()) as f32).min(a[0]).to_bits();
        if low > high {
            proved = Some(scalar);
            continue;
        }
        // A short interval near zero may have many raw axial encodings
        // with the same normalization. The F32 bit width bounds the stack
        // depth and each visited block uses the original shared budget.
        if !clear_scalar_block(
            image,
            RawEndpoint { scalar, ..first },
            low,
            high,
            None,
            remaining,
            work,
        )? {
            break;
        }
        proved = Some(scalar);
    }
    Ok(proved)
}

/// At an uncertain affine image, use the frozen physical input clock to
/// narrow one scalar cell. The resulting frontier is only a clear prefix.
fn exact_scalar_frontier(
    image: &ProjectedImages<'_>,
    first: u64,
    last: u64,
    remaining: &mut u32,
    work: &mut Work,
) -> Result<Option<u64>, TrajectoryError> {
    work.charge(128)?;
    let at = |input: u64| image.projection.raw_endpoint(input as u32);
    let start = at(first);
    let end = at(last);
    let scalar = start.scalar.abs();
    let axial = start.axial.abs();
    let scalar_span = end.scalar.abs().to_bits().saturating_sub(scalar.to_bits());
    if image.face_mask != 1
        || image.projection.velocity != 0.
        || axial <= end.axial.abs()
        || scalar > end.scalar.abs()
        || axial.to_bits() - end.axial.abs().to_bits() < 128u32.saturating_mul(scalar_span + 1)
    {
        return Ok(None);
    }
    let mut current = first;
    let mut proved = None;
    // Reserve the exact clock inversion for the uncertain frontier.
    for _ in 0..16 {
        let left = at(current);
        let scalar = left.scalar.abs();
        let until = last_true(current, last, work, |input| {
            at(input).scalar.abs() == scalar
        })?;
        let raw = RawEndpoint { scalar, ..left };
        let upper_axial = left.axial.abs().to_bits();
        let clears = |candidate: u64, remaining: &mut u32, work: &mut Work| {
            let lower_axial = at(candidate).axial.abs().to_bits();
            if upper_axial < lower_axial {
                return Ok(false);
            }
            clear_scalar_block(image, raw, lower_axial, upper_axial, None, remaining, work)
        };
        if clears(until, remaining, work)? {
            proved = Some(until);
            if until == last {
                break;
            }
            current = until + 1;
            continue;
        }
        if !clears(current, remaining, work)? {
            break;
        }
        let mut low = current;
        let mut high = until;
        while low < high {
            let middle = low + (high - low).div_ceil(2);
            if clears(middle, remaining, work)? {
                low = middle;
            } else {
                high = middle - 1;
            }
        }
        proved = Some(low);
        break;
    }
    Ok(proved)
}

/// Visit reachable outputs rather than reopening a near-tangent interval
/// whose raw scalar has many different bits for each fixed axial input.
fn scan_dominant_axis(
    projection: &NormalProjection,
    clock: Clock,
    first: u64,
    last: u64,
    fixed_center: Option<f32>,
    checked: &mut Option<u64>,
    work: &mut Work,
) -> Result<Option<bool>, TrajectoryError> {
    work.charge(128)?;
    let at = |key| sample(projection, clock, key).phase;
    let start_phase = at(first);
    let end_phase = at(last);
    let a = start_phase.raw;
    let b = end_phase.raw;
    let axial_span = a.axial.abs().to_bits().abs_diff(b.axial.abs().to_bits());
    let scalar_span = a.scalar.abs().to_bits().abs_diff(b.scalar.abs().to_bits());
    let crosses_scalar = a.scalar.is_sign_negative() != b.scalar.is_sign_negative();
    let fallback = InputRotation::for_projection(projection).is_some() && !crosses_scalar;
    let signed = a.axial.abs() > a.scalar.abs() || b.axial.abs() > b.scalar.abs();
    let reversed = a.axial.abs() > b.axial.abs() && a.scalar.abs() <= b.scalar.abs();
    let min_span_ratio = if fallback {
        16 * MAX_COUPLED_GROUP
    } else if signed {
        1
    } else {
        0
    };
    if a.axial.is_sign_negative() != b.axial.is_sign_negative()
        || (!signed && !reversed)
        || (!crosses_scalar && scalar_span / (axial_span + 1) < min_span_ratio)
        || !start_phase.finite()
        || !end_phase.finite()
        || (fallback && !(start_phase.scale < 0. && end_phase.scale < 0.))
    {
        return Ok(None);
    }
    let face_mask = if signed {
        let Some(mask) = signed_face_mask(projection, start_phase, end_phase, work)? else {
            return Ok(None);
        };
        mask
    } else {
        // With both raw magnitudes monotone on opposite sides, the
        // endpoints bound whether the common normalization can be signed.
        if crosses_scalar {
            return Ok(None);
        }
        1
    };
    let image = ProjectedImages {
        projection,
        face_mask,
        upper_center: None,
        fixed_center,
    };
    let carrier = projection.kernel.native;
    let initial = carrier.motion.start.rotation.to_array();
    let angular = carrier.angular_velocity[projection.axis].abs();
    let direction = if a.axial <= b.axial { 1. } else { -1. };
    let mut left = first;
    let mut remaining = MAX_RANGES as u32 * MAX_IMAGES;
    let mut scalar_end = if crosses_scalar {
        last_true(first, last, work, |key| {
            at(key).raw.scalar.is_sign_negative() == a.scalar.is_sign_negative()
        })?
    } else {
        last
    };
    if !crosses_scalar && matches!(clock, Clock::Physical) {
        if let Some(scalar) = reversed_scalar_image(&image, a, b, &mut remaining, work)? {
            let passed = last_true(first, last, work, |key| at(key).raw.scalar.abs() <= scalar)?;
            *checked = Some(passed);
            left = passed + 1;
        }
        if left <= last {
            if let Some(passed) = exact_scalar_frontier(&image, left, last, &mut remaining, work)? {
                *checked = Some(passed);
                return Ok(Some(passed == last));
            }
            if let Some(axis) = reversed_axial_image(&image, at(left).raw, b, &mut remaining, work)?
            {
                let passed = last_true(left, last, work, |key| at(key).raw.axial.abs() >= axis)?;
                *checked = Some(passed);
                left = passed + 1;
            }
        }
    }
    while left <= last && remaining > 0 {
        work.charge(128)?;
        if left > scalar_end {
            scalar_end = last;
        }
        let phase = at(left);
        let axial = phase.raw.axial.to_bits();
        let hint = from_axial(
            (direction * phase.raw.axial).next_up(),
            direction * initial[projection.axis],
            initial[3].abs(),
            angular,
        );
        let candidate = match clock {
            Clock::Physical => u64::from(hint.to_bits()),
            Clock::Logical => logical_guess(projection, hint.to_bits()),
        };
        let same_axis = |key| at(key).raw.axial.to_bits() == axial;
        let mut found = None;
        if hint.is_finite() && left < candidate && candidate <= scalar_end {
            let attempts = if matches!(clock, Clock::Logical) {
                8
            } else {
                1
            };
            let mut candidate = candidate;
            for _ in 0..attempts {
                work.charge(64)?;
                if !same_axis(candidate) {
                    work.charge(64)?;
                    if same_axis(candidate - 1) {
                        found = Some(candidate - 1);
                        break;
                    }
                    if candidate <= left + 1 {
                        break;
                    }
                    candidate -= 1;
                } else if candidate < scalar_end {
                    candidate += 1;
                } else {
                    break;
                }
            }
        }
        let axial_end = match found {
            Some(end) => end,
            None => last_true(left, scalar_end, work, same_axis)?,
        };

        // Within one actual axial cell the magnitude of the raw scalar has
        // no turning point. A clearance proof over the entire raw lattice
        // certifies every original input. Unknowns still use the exact clock.
        work.charge(128)?;
        let a = phase.raw.scalar.abs();
        let b = at(axial_end).raw.scalar.abs();
        let fixed = RawEndpoint {
            axial: phase.raw.axial.abs(),
            scalar: a.min(b),
            ..phase.raw
        };
        let range = RawRange {
            first: fixed,
            last: RawEndpoint {
                scalar: a.max(b),
                ..fixed
            },
        };
        let relative = projection
            .relative(clock, left)
            .min(projection.relative(clock, axial_end));
        let width = a.to_bits().abs_diff(b.to_bits());
        let covered = if width == 0 {
            image
                .clear_phase(phase.axial, phase.scale, Some(relative), work)?
                .then_some(1)
        } else if width < MAX_COUPLED_GROUP {
            image.clear_fixed_axial(range, remaining, Some(relative), work)?
        } else {
            image.clear_axial_scale_cells(range, remaining, Some(relative), work)?
        };
        if let Some(count) = covered {
            remaining -= count;
            *checked = Some(axial_end);
            left = axial_end + 1;
            continue;
        }
        // One raw axial coordinate is fixed. The other coordinate has
        // constant sign, so its square and the normalization factor are
        // monotone on the original represented physical or logical clock.
        let mut cell = left;
        while cell <= axial_end && remaining > 0 {
            work.charge(96)?;
            let phase = at(cell);
            if !phase.finite() {
                return Ok(Some(false));
            }
            let factor_end = last_true(cell, axial_end, work, |key| {
                at(key).factor.to_bits() == phase.factor.to_bits()
            })?;
            // With the same normalization factor, the normalized axis is
            // fixed and scale is monotone. Visit only its reachable values.
            let mut current = cell;
            while current <= factor_end && remaining > 0 {
                remaining -= 1;
                work.charge(96)?;
                let phase = at(current);
                let edge = last_true(current, factor_end, work, |key| {
                    at(key).scale.to_bits() == phase.scale.to_bits()
                })?;
                let relative = projection
                    .relative(clock, current)
                    .min(projection.relative(clock, edge));
                if !image.clear_phase(phase.axial, phase.scale, Some(relative), work)? {
                    if image.clear_phase(
                        phase.axial,
                        phase.scale,
                        Some(projection.relative(clock, current)),
                        work,
                    )? {
                        let mut lo = current;
                        let mut hi = edge;
                        while lo < hi {
                            let middle = lo + (hi - lo).div_ceil(2);
                            if image.clear_phase(
                                phase.axial,
                                phase.scale,
                                Some(
                                    projection
                                        .relative(clock, current)
                                        .min(projection.relative(clock, middle)),
                                ),
                                work,
                            )? {
                                lo = middle;
                            } else {
                                hi = middle - 1;
                            }
                        }
                        *checked = Some(lo);
                    }
                    return Ok(Some(false));
                }
                *checked = Some(edge);
                current = edge + 1;
            }
            cell = factor_end + 1;
        }
        left = axial_end + 1;
    }
    Ok(Some(*checked == Some(last)))
}

/// Certify rotation states against an independent capsule that keeps one
/// represented normal coordinate under its own clock.
pub(super) fn fixed_center_prefix(
    projection: &NormalProjection,
    center: f32,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    const MAX_INITIAL_CELLS: usize = 256;
    let kernel = projection.kernel;
    let h = kernel.native.integration_seconds;
    let physical = |time| kernel.local_delta(Time::from_bits(time));
    let finish = end.to_bits();
    let mut first = start.to_bits();
    let mut checked = None;
    let at_stored = |pose: super::rp::Pose, work: &mut Work| {
        let q = pose.rotation;
        let axial = q.to_array()[projection.axis];
        let scale = super::normal_scale(q);
        let Some(top) = fixed_center_action(projection, axial, scale, work)? else {
            return Ok::<_, TrajectoryError>(false);
        };
        Ok(image_separates(
            projection,
            [top + pose.translation[projection.axis], center],
        ))
    };
    work.charge(256)?;
    if physical(first) == 0. {
        if !at_stored(kernel.native.motion.start, work)? {
            return Ok(None);
        }
        let until = last_true(first, finish, work, |time| physical(time) == 0.)?;
        checked = Some(Time::from_bits(until));
        first = until + 1;
        if first > finish {
            return Ok(checked);
        }
    }
    if physical(first) >= h {
        return if at_stored(kernel.native.motion.end, work)? {
            Ok(Some(end))
        } else {
            Ok(checked)
        };
    }
    if !(0. < physical(first) && physical(first) < h) {
        return Ok(checked);
    }
    let interior = last_true(first, finish, work, |time| physical(time) < h)?;
    let Some(rotation) = InputRotation::for_projection(projection) else {
        // The two stored rotations have already-authorized branches. Only
        // the interior reuses the same raw clock as the anchored proof.
        let mut low = u64::from(physical(first).to_bits());
        let high = u64::from(physical(interior).to_bits());
        let translation = |bits| {
            super::translation_at_input(kernel, projection.axis, f32::from_bits(bits as u32))
        };
        work.charge(256)?;
        let height = translation(low);
        let last_height = translation(high);
        let bounds = Float::span(height, last_height);
        let split = bounds.lo != bounds.hi && bounds.lo.next_up() == bounds.hi;
        let mut passed = None;
        let mut complete = None;
        for _ in 0..if split { 2 } else { 1 } {
            // The interior translation is monotone. Preserve its actual
            // rounding change and keep the stored endpoint independent.
            let height = translation(low);
            let edge = if split {
                last_true(low, high, work, |bits| translation(bits) == height)?
            } else {
                high
            };
            let projection = NormalProjection {
                translation: if split { Float::exact(height) } else { bounds },
                ..*projection
            };
            complete = scan_dominant_axis(
                &projection,
                Clock::Physical,
                low,
                edge,
                Some(center),
                &mut passed,
                work,
            )?;
            if complete != Some(true) || edge == high {
                break;
            }
            low = edge + 1;
        }
        if let Some(passed) = passed {
            let at = last_true(first, interior, work, |time| {
                u64::from(physical(time).to_bits()) <= passed
            })?;
            checked = Some(Time::from_bits(at));
        }
        if complete == Some(true)
            && (interior == finish || at_stored(kernel.native.motion.end, work)?)
        {
            return Ok(Some(end));
        }
        return Ok(checked);
    };
    let mut current = sample(projection, Clock::Logical, first);
    let last = sample(projection, Clock::Logical, interior);
    let mut consumed_interior = false;
    for _ in 0..MAX_INITIAL_CELLS {
        work.charge(128)?;
        let phase = current.phase;
        if !phase.finite() {
            return Ok(checked);
        }
        let Some(action) = fixed_center_action(projection, phase.axial, phase.scale, work)? else {
            return Ok(checked);
        };
        let top = |at: Sample| {
            action
                + super::translation_at_input(
                    kernel,
                    projection.axis,
                    f32::from_bits(at.phase.raw.input),
                )
        };
        if !image_separates(projection, [top(current), center]) {
            return Ok(checked);
        }
        let (edge, next) = phase_end(
            projection,
            Clock::Logical,
            current,
            last,
            rotation,
            Boundary::RawPair,
            work,
        )?;
        if !image_separates(projection, [top(edge), center]) {
            return Ok(checked);
        }
        // The rotation is identical throughout the cell and the original
        // translation is monotone between the two physical inputs.
        checked = Some(Time::from_bits(edge.at));
        let Some(next) = next else {
            consumed_interior = true;
            break;
        };
        current = next;
    }
    if !consumed_interior {
        if !last.phase.finite() || last.phase.raw.scalar <= 0. {
            return Ok(checked);
        }
        let mask = if current.phase.scale < 0. || last.phase.scale < 0. {
            let Some(mask) = signed_face_mask(projection, current.phase, last.phase, work)? else {
                return Ok(checked);
            };
            mask
        } else {
            1
        };
        if let Some(step) = scalar_image_prefix(
            projection,
            rotation,
            current.phase.raw,
            last.phase.raw,
            mask,
            None,
            Some(center),
            work,
        )? {
            let passed = last_true(current.at, last.at, work, |time| {
                rotation.step(physical(time).to_bits()) <= step
            })?;
            checked = Some(Time::from_bits(passed));
            consumed_interior = passed == interior;
        }
    }
    if consumed_interior && (interior == finish || at_stored(kernel.native.motion.end, work)?) {
        return Ok(Some(end));
    }
    Ok(checked)
}

fn fixed_center_action(
    projection: &NormalProjection,
    axial: f32,
    scale: f32,
    work: &mut Work,
) -> Result<Option<f32>, TrajectoryError> {
    if scale >= 0. {
        return Ok(Some(action(projection.half, axial, scale)));
    }
    normalized_action::signed_face_upper(projection.half, axial, scale, work)
}

/// None leaves the older time path in charge. Once admitted, Some reports
/// whether the whole interval passed and leaves only a certified prefix.
pub(super) fn scan(
    projection: &NormalProjection,
    clock: Clock,
    first: u64,
    last: u64,
    checked: &mut Option<u64>,
    work: &mut Work,
) -> Result<Option<bool>, TrajectoryError> {
    if first > last {
        return Ok(None);
    }
    if matches!(clock, Clock::Physical) {
        work.charge(64)?;
        let left = projection.raw_endpoint(first as u32);
        let right = projection.raw_endpoint(last as u32);
        if left.axial.is_sign_negative() != right.axial.is_sign_negative()
            && left.scalar.is_sign_negative() == right.scalar.is_sign_negative()
            && left.scalar.abs().min(right.scalar.abs()) >= left.axial.abs().max(right.axial.abs())
        {
            let boundary = last_true(first, last, work, |input| {
                projection
                    .raw_endpoint(input as u32)
                    .axial
                    .is_sign_negative()
                    == left.axial.is_sign_negative()
            })?;
            match scan(projection, clock, first, boundary, checked, work)? {
                Some(true) => {}
                prior => return Ok(prior),
            }
            let tail = RawRange {
                first: projection.raw_endpoint((boundary + 1) as u32),
                last: right,
            };
            work.charge(192)?;
            if projection.range_clear(tail) {
                *checked = Some(last);
                return Ok(Some(true));
            }
            return Ok(Some(false));
        }
    }
    if let Some(complete) = scan_dominant_axis(projection, clock, first, last, None, checked, work)?
    {
        return Ok(Some(complete));
    }
    let Some(rotation) = InputRotation::for_projection(projection) else {
        return Ok(None);
    };
    work.charge(128)?;
    let end = sample(projection, clock, last);
    let mut current = sample(projection, clock, first);
    if end.phase.raw.scalar <= 0. || !current.phase.finite() || !end.phase.finite() {
        return Ok(None);
    }
    if !current.phase.valid() || !end.phase.valid() {
        if matches!(clock, Clock::Logical) {
            if current.phase.scale < 0. {
                return scan_signed(projection, clock, current, end, rotation, checked, work)
                    .map(Some);
            }
            return Ok(None);
        }
    }
    if matches!(clock, Clock::Physical) {
        work.charge(192)?;
        if projection.range_clear(RawRange {
            first: current.phase.raw,
            last: end.phase.raw,
        }) {
            *checked = Some(last);
            return Ok(Some(true));
        }
        let signed = end.phase.scale < 0. || current.phase.scale < 0.;
        let face_values = if signed {
            work.charge(512)?;
            let Some(values) = signed_face_mask(projection, current.phase, end.phase, work)? else {
                return Ok(None);
            };
            values
        } else {
            1
        };
        if let Some(step) = scalar_image_prefix(
            projection,
            rotation,
            current.phase.raw,
            end.phase.raw,
            face_values,
            None,
            None,
            work,
        )? {
            // A step may be absent from the physical clock. Map only the
            // proved prefix and resume on the next original input.
            let passed = last_true(first, last, work, |dt| rotation.step(dt as u32) <= step)?;
            *checked = Some(passed);
            if passed == last {
                return Ok(Some(true));
            }
            work.charge(64)?;
            current = sample(projection, clock, passed + 1);
        }
        if signed {
            return scan_signed(projection, clock, current, end, rotation, checked, work).map(Some);
        }
    }
    let mut visited = 0;
    while visited < MAX_RANGES {
        if !current.phase.valid() {
            return Ok(Some(false));
        }
        let (group_end, next) = phase_end(
            projection,
            clock,
            current,
            end,
            rotation,
            Boundary::Normalization,
            work,
        )?;
        // A single scale cell already uses tight endpoints in the fine
        // path. Only a group spanning several scales needs the corner bound.
        if !Boundary::Scale.same(current.phase, group_end.phase) {
            work.charge(128)?;
            if group_clear(projection, clock, current, group_end) {
                visited += 1;
                *checked = Some(group_end.at);
            }
        }
        if *checked != Some(group_end.at)
            && !scan_group(
                projection,
                clock,
                current,
                group_end,
                rotation,
                checked,
                &mut visited,
                work,
            )?
        {
            return Ok(Some(false));
        }
        let Some(next) = next else {
            return Ok(Some(true));
        };
        current = next;
    }
    Ok(Some(false))
}

#[allow(clippy::too_many_arguments)]
fn scan_group(
    projection: &NormalProjection,
    clock: Clock,
    mut current: Sample,
    group_end: Sample,
    rotation: InputRotation,
    checked: &mut Option<u64>,
    visited: &mut usize,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    while *visited < MAX_RANGES {
        if !current.phase.valid() {
            return Ok(false);
        }
        let (end_of_phase, next) = phase_end(
            projection,
            clock,
            current,
            group_end,
            rotation,
            Boundary::Scale,
            work,
        )?;
        while *visited < MAX_RANGES {
            *visited += 1;
            work.charge(128)?;
            let left = current.phase.outputs(projection);
            let right = end_of_phase.phase.outputs(projection);
            let relative_start = projection.relative(clock, current.at);
            let relative_end = projection.relative(clock, end_of_phase.at);
            // With W/F/S fixed, both positive normal actions are monotone
            // in the normalized axial component. The independently
            // rounded relative term uses the original logical clock.
            if projection.separates(left, right, [relative_start, relative_end]) {
                *checked = Some(end_of_phase.at);
                break;
            }
            if !projection.separates(left, left, [relative_start; 2]) {
                return Ok(false);
            }
            let fixed = last_true(current.at, end_of_phase.at, work, |input| {
                sample(projection, clock, input).phase.outputs(projection) == left
            })?;
            let Some(passed) = projection.fixed_prefix(left, clock, current.at, fixed, work)?
            else {
                return Ok(false);
            };
            *checked = Some(passed);
            if passed < fixed {
                return Ok(false);
            }
            if passed == end_of_phase.at {
                break;
            }
            work.charge(64)?;
            current = sample(projection, clock, passed + 1);
        }
        if *checked != Some(end_of_phase.at) {
            return Ok(false);
        }
        let Some(next) = next else {
            return Ok(true);
        };
        current = next;
    }
    Ok(false)
}

#[cfg(test)]
mod tests;
