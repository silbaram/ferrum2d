//! Chronological cells of a pure-axis Box/Capsule projection. The original
//! physical clock and all rounded scalar operations are preserved.
use super::*;
mod phase_cells;

const MAX_CELLS: usize = 512;
const MAX_RANGES: usize = 24_576;

enum Scan {
    Complete,
    PossibleContact,
    CellLimit,
}

#[derive(Clone, Copy)]
enum Clock {
    Physical,
    Logical,
}

#[derive(Clone, Copy)]
struct RawEndpoint {
    input: u32,
    axial: f32,
    scalar: f32,
}

#[derive(Clone, Copy)]
struct RawRange {
    first: RawEndpoint,
    last: RawEndpoint,
}

impl RawEndpoint {
    fn new(kernel: Kernel, axis: usize, input: u32) -> Self {
        let dt = f32::from_bits(input);
        let q = kernel.native.motion.start.rotation.to_array();
        let hang = kernel.native.angular_velocity[axis] * (dt * 0.5);
        // The two surviving coordinates in the original scalar Quat product
        // when both operands share the axis. Zero terms affect only zero signs.
        Self {
            input,
            axial: q[axis] + hang * q[3],
            scalar: q[3] - hang * q[axis],
        }
    }
}

fn normal_scale(q: rp::Rotation) -> f32 {
    let vector = rp::Vector::new(q.x, q.y, q.z);
    q.w * q.w - vector.dot(vector)
}

pub(super) fn point_action(point: f32, axial: f32, scale: f32) -> f32 {
    let twice_dot = (point * axial) * 2.;
    point * scale + axial * twice_dot
}

pub(super) fn positive_scale(k: Kernel, axis: usize, start: Time, end: Time) -> bool {
    let dt_lo = k.local_delta(start);
    let dt_hi = k.local_delta(end);
    let h = k.native.integration_seconds;
    let is_positive = |pose: rp::Pose| {
        let scale = normal_scale(pose.rotation);
        scale.is_finite() && scale >= 0.
    };
    if !dt_lo.is_finite()
        || !dt_hi.is_finite()
        || dt_lo > dt_hi
        || dt_lo <= 0. && !is_positive(k.native.motion.start)
        || dt_hi >= h && !is_positive(k.native.motion.end)
    {
        return false;
    }
    let first = dt_lo.max(f32::from_bits(1));
    let last = dt_hi.min(h.next_down());
    if first > last {
        return true;
    }
    let first = RawEndpoint::new(k, axis, first.to_bits());
    let last = RawEndpoint::new(k, axis, last.to_bits());
    // Both raw coordinates are monotone. The same positive native
    // normalization factor and rounded squares preserve magnitude order.
    [first.axial, first.scalar, last.axial, last.scalar]
        .into_iter()
        .all(f32::is_finite)
        && first.scalar.is_sign_negative() == last.scalar.is_sign_negative()
        && first.scalar.abs().min(last.scalar.abs()) >= first.axial.abs().max(last.axial.abs())
}

#[derive(Clone, Copy)]
struct NormalProjection {
    kernel: Kernel,
    axis: usize,
    half: f32,
    anchor: f32,
    offset: f32,
    velocity: f32,
    core: f32,
    pole: f32,
    radius: f32,
    clearance: f32,
    translation: Float,
    reference_height: Option<f32>,
}

// The interior uses the original rounded product and addition. Its extrema
// are the two physical inputs. The saved endpoint is a separate pose.
pub(super) fn translation_range(
    kernel: Kernel,
    axis: usize,
    start: Time,
    end: Time,
) -> Option<Float> {
    let initial = kernel.native.motion.start.translation[axis];
    let saved_end = kernel.native.motion.end.translation[axis];
    let velocity = kernel.native.linear_velocity[axis];
    if !initial.is_finite() || !saved_end.is_finite() || !velocity.is_finite() {
        return None;
    }
    if velocity == 0. && initial == saved_end {
        return Some(Float::exact(initial));
    }
    let h = kernel.native.integration_seconds;
    let low = kernel.local_delta(start);
    let high = kernel.local_delta(end);
    if !low.is_finite() || !high.is_finite() || !h.is_finite() || h <= 0. || low > high {
        return None;
    }
    if low >= h {
        return Some(Float::exact(saved_end));
    }
    let first = if low == 0. {
        initial
    } else {
        initial + velocity * low
    };
    let last = initial + velocity * high.min(h.next_down());
    let mut range = Float::span(first, last);
    if high >= h {
        range.lo = range.lo.min(saved_end);
        range.hi = range.hi.max(saved_end);
    }
    range.finite().then_some(range)
}

fn translation_at_input(kernel: Kernel, axis: usize, input: f32) -> f32 {
    if input <= 0. {
        kernel.native.motion.start.translation[axis]
    } else if input >= kernel.native.integration_seconds {
        kernel.native.motion.end.translation[axis]
    } else {
        kernel.native.motion.start.translation[axis] + kernel.native.linear_velocity[axis] * input
    }
}

impl NormalProjection {
    fn new(context: Context<'_>, normal: rp::Vector) -> Option<Self> {
        Self::with_face_phase(context, normal, false)
    }

    fn with_face_phase(
        context: Context<'_>,
        normal: rp::Vector,
        allow_face_phase: bool,
    ) -> Option<Self> {
        let Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        } = context;
        let (box_motion, cuboid, capsule_motion, capsule, normal) =
            if let (Some(cuboid), Some(capsule)) = (sa.as_cuboid(), sb.as_capsule()) {
                (a, cuboid, b, capsule, normal)
            } else if let (Some(capsule), Some(cuboid)) = (sa.as_capsule(), sb.as_cuboid()) {
                (b, cuboid, a, capsule, -normal)
            } else {
                return None;
            };
        let axis = (0..3).find(|&i| normal[i] == 1.)?;
        let (
            Curve::Integrated(kernel),
            Curve::Anchored {
                carrier,
                anchor,
                offset,
                linear_velocity,
                rotation,
            },
        ) = (box_motion.curve, capsule_motion.curve)
        else {
            return None;
        };
        let shared_kernel = same_kernel(kernel, carrier);
        if (!shared_kernel
            && !(allow_face_phase
                && anchor[axis].to_bits() == cuboid.half_extents[axis].to_bits()
                && same_rotation_clock(kernel, carrier)))
            || !local_identity(box_motion)
            || !local_identity(capsule_motion)
            || !qi(rotation)
            || !anchor.is_finite()
            || !offset.is_finite()
            || !linear_velocity.is_finite()
            || anchor[axis] <= 0.
            || kernel.native.angular_velocity[axis] == 0.
            || (0..3).any(|i| {
                i != axis
                    && (normal[i] != 0.
                        || kernel.native.angular_velocity[i] != 0.
                        || kernel.native.motion.start.rotation.to_array()[i] != 0.
                        || kernel.native.motion.end.rotation.to_array()[i] != 0.)
            })
            || !cuboid.half_extents.is_finite()
            || cuboid.half_extents.min_element() <= 0.
            || !capsule.segment.a.is_finite()
            || !capsule.segment.b.is_finite()
            || !capsule.radius.is_finite()
            || capsule.radius < 0.
            || !clearance.is_finite()
            || clearance < 0.
        {
            return None;
        }
        let translation = translation_range(kernel, axis, start, end)?;
        if translation.lo != translation.hi
            && translation.lo.next_up() != translation.hi
            && !positive_scale(kernel, axis, start, end)
        {
            return None;
        }
        let center_translation = if shared_kernel {
            None
        } else {
            let center = translation_range(carrier, axis, start, end)?;
            if translation.lo != translation.hi || center.lo != center.hi {
                return None;
            }
            Some(center.lo)
        };
        let core = capsule.segment.a[axis].min(capsule.segment.b[axis]);
        let pole = core - capsule.radius;
        pole.is_finite().then_some(Self {
            kernel,
            axis,
            half: cuboid.half_extents[axis],
            anchor: anchor[axis],
            offset: offset[axis],
            velocity: linear_velocity[axis],
            core,
            pole,
            radius: capsule.radius,
            clearance,
            translation,
            reference_height: center_translation,
        })
    }

    fn raw(&self, clock: Clock, bits: u64) -> rp::Rotation {
        let elapsed = match clock {
            Clock::Physical => f32::from_bits(bits as u32),
            Clock::Logical => self.kernel.local_delta(Time::from_bits(bits)),
        };
        let half = self.kernel.native.angular_velocity * (elapsed * 0.5);
        rp::Rotation::from_xyzw(half.x, half.y, half.z, 1.)
            * self.kernel.native.motion.start.rotation
    }

    fn center_height(&self) -> f32 {
        self.reference_height.unwrap_or(self.translation.lo)
    }

    fn outputs(&self, q: rp::Rotation) -> [f32; 2] {
        let mut normal = rp::Vector::ZERO;
        normal[self.axis] = self.half;
        let top = (q * normal)[self.axis] + self.translation.hi;
        normal[self.axis] = self.anchor;
        let center = (self.center_height() + (q * normal)[self.axis]) + self.offset;
        [top, center]
    }

    fn relative(&self, clock: Clock, time: u64) -> f32 {
        if matches!(clock, Clock::Physical) {
            return 0.;
        }
        let domain = self.kernel.domain;
        let elapsed = (Time::from_bits(time) - domain.start).clamp(0., domain.duration());
        self.velocity * (elapsed as f32)
    }

    fn separates(&self, left: [f32; 2], right: [f32; 2], relative: [f32; 2]) -> bool {
        if left.into_iter().chain(right).any(|p| !p.is_finite()) {
            return false;
        }
        let top = left[0].max(right[0]);
        // The original relative product is monotone on the logical clock.
        // It may move against the rotational action, so bound each addend
        // separately before applying the original F32 addition.
        let [relative_start, relative_end] = relative;
        if !relative_start.is_finite() || !relative_end.is_finite() {
            return false;
        }
        let center = left[1].min(right[1]) + relative_start.min(relative_end);
        capsule_clears(
            top,
            center,
            self.core,
            self.pole,
            self.radius,
            self.clearance,
        )
    }

    fn fixed_prefix(
        &self,
        outputs: [f32; 2],
        clock: Clock,
        start: u64,
        end: u64,
        work: &mut Work,
    ) -> Result<Option<u64>, TrajectoryError> {
        let relative = self.relative(clock, start);
        if !self.separates(outputs, outputs, [relative; 2]) {
            return Ok(None);
        }
        // With both rotational outputs fixed, only the monotone
        // relative addition can turn a clear cell into a possible hit.
        last_true(start, end, work, |at| {
            self.separates(outputs, outputs, [relative, self.relative(clock, at)])
        })
        .map(Some)
    }

    fn stored_prefix(
        &self,
        pose: rp::Pose,
        clock: Clock,
        start: u64,
        end: u64,
        work: &mut Work,
    ) -> Result<Option<u64>, TrajectoryError> {
        work.charge(512)?;
        let scale = normal_scale(pose.rotation);
        if !scale.is_finite() {
            return Ok(None);
        }
        let mut outputs = self.outputs(pose.rotation);
        if scale < 0. {
            let axial = pose.rotation.to_array()[self.axis];
            let Some(top) = normalized_action::signed_face_upper(self.half, axial, scale, work)?
            else {
                return Ok(None);
            };
            outputs[0] = top + self.translation.hi;
        }
        self.fixed_prefix(outputs, clock, start, end, work)
    }

    fn interior(
        &self,
        clock: Clock,
        mut current: u64,
        end: u64,
        checked: &mut Option<u64>,
        work: &mut Work,
    ) -> Result<Scan, TrajectoryError> {
        work.charge(512)?;
        let first = self.raw(clock, current);
        let last = self.raw(clock, end);
        let axis = self.axis;
        let y = |q: rp::Rotation| q.to_array()[axis];
        // Both raw components are monotone on the original clock. Keep
        // their sign fixed so that abs, square and rounded norm on each
        // fixed-W cell are monotone as well.
        let same_sign = |a: f32, b: f32| a >= 0. && b >= 0. || a <= 0. && b <= 0.;
        if !first.is_finite()
            || !last.is_finite()
            || !same_sign(y(first), y(last))
            || !same_sign(first.w, last.w)
        {
            return Ok(Scan::PossibleContact);
        }
        let norm = |axis: f32, w: f32| axis * axis + w * w;
        let low_squared = norm(
            y(first).abs().min(y(last).abs()),
            first.w.abs().min(last.w.abs()),
        );
        let high_squared = norm(
            y(first).abs().max(y(last).abs()),
            first.w.abs().max(last.w.abs()),
        );
        if !high_squared.is_finite() || low_squared <= 0. || !low_squared.sqrt().recip().is_finite()
        {
            return Ok(Scan::PossibleContact);
        }

        let phase = |at| {
            let raw = self.raw(clock, at);
            let factor = raw.length_recip();
            let normalized = raw * factor;
            let scale = normal_scale(normalized);
            (
                [raw.w.abs().to_bits(), factor.to_bits(), scale.to_bits()],
                normalized,
            )
        };
        let mut cells = 0;
        while current <= end && cells < MAX_CELLS {
            work.charge(512)?;
            let (key, _) = phase(current);
            let scale = f32::from_bits(key[2]);
            if !scale.is_finite() || scale < 0. {
                return Ok(Scan::PossibleContact);
            }
            // The tuple cannot recur after a change. Raw |W| is monotone.
            // For fixed W the reciprocal norm is monotone in raw |Y|, and
            // for fixed W and reciprocal the rounded scale is monotone too.
            let phase_end = last_true(current, end, work, |at| phase(at).0 == key)?;
            while current <= phase_end && cells < MAX_CELLS {
                cells += 1;
                work.charge(512)?;
                // Within this phase both positive normal actions increase
                // with |q_axis|. S >= 0 makes the face bound the whole slab.
                let left = self.outputs(phase(current).1);
                let right = self.outputs(phase(phase_end).1);
                let relative = self.relative(clock, current);
                let passed =
                    if self.separates(left, right, [relative, self.relative(clock, phase_end)]) {
                        phase_end
                    } else {
                        if !self.separates(left, left, [relative; 2]) {
                            return Ok(Scan::PossibleContact);
                        }
                        // Equal represented outputs also form one monotone cell.
                        let fixed = last_true(current, phase_end, work, |at| {
                            self.outputs(phase(at).1) == left
                        })?;
                        let Some(passed) = self.fixed_prefix(left, clock, current, fixed, work)?
                        else {
                            return Ok(Scan::PossibleContact);
                        };
                        if passed < fixed {
                            *checked = Some(passed);
                            return Ok(Scan::PossibleContact);
                        }
                        passed
                    };
                *checked = Some(passed);
                current = passed + 1;
            }
        }
        Ok(if current > end {
            Scan::Complete
        } else {
            Scan::CellLimit
        })
    }
    fn logical_prefix(
        &self,
        start: Time,
        end: Time,
        full_end: Time,
        work: &mut Work,
    ) -> Result<Option<Time>, TrajectoryError> {
        let k = self.kernel;
        let mut until = end.to_bits();
        let mut current = start.to_bits();
        let physical = |bits| k.local_delta(Time::from_bits(bits));
        let h = k.native.integration_seconds;
        if end <= start || !physical(current).is_finite() || !physical(until).is_finite() {
            return Ok(None);
        }
        // Keep a separate bound for the region this fine pass actually scans.
        // It need not include the saved end of the whole integration.
        let fine = if self.translation.lo == self.translation.hi {
            *self
        } else {
            let Some(translation) = translation_range(k, self.axis, start, end) else {
                return Ok(None);
            };
            Self {
                translation,
                ..*self
            }
        };
        let mut checked = None;
        if physical(current) == 0. {
            let last = last_true(current, until, work, |at| physical(at) == 0.)?;
            checked =
                fine.stored_prefix(k.native.motion.start, Clock::Logical, current, last, work)?;
            if checked == Some(last) {
                current = last + 1;
            }
        }
        if current <= until && physical(current) > 0. && physical(current) < h {
            let rotation = k.position_at_time(Time::from_bits(current)).rotation;
            let scale = normal_scale(rotation);
            let center = self.outputs(rotation)[1];
            let span = (center - center.next_down()).min(center.next_up() - center);
            let relative = self.relative(Clock::Logical, full_end.to_bits());
            if self.velocity < 0.
                && (scale < 0. || (center.is_finite() && relative.abs() <= 2. * span))
            {
                let full_last =
                    last_true(current, full_end.to_bits(), work, |at| physical(at) < h)?;
                if let Some(passed) =
                    phase_cells::moving_phase_prefix(self, current, full_last, work)?
                {
                    checked = Some(passed);
                    current = passed + 1;
                    // Keep the existing limit on the fine scan after the proved prefix.
                    until = (Time::from_bits(current) + k.domain.duration() * 0.125)
                        .min(full_end)
                        .to_bits();
                }
            }
        }
        if current <= until && physical(current) > 0. && physical(current) < h {
            let last = last_true(current, until, work, |at| physical(at) < h)?;
            let complete = match phase_cells::scan(
                &fine,
                Clock::Logical,
                current,
                last,
                &mut checked,
                work,
            )? {
                Some(complete) => complete,
                None => matches!(
                    fine.interior(Clock::Logical, current, last, &mut checked, work)?,
                    Scan::Complete
                ),
            };
            if complete {
                current = last + 1;
            }
        }
        if current <= until && physical(current) >= h {
            if let Some(last) =
                fine.stored_prefix(k.native.motion.end, Clock::Logical, current, until, work)?
            {
                checked = Some(last);
            }
        }
        Ok(checked.map(Time::from_bits))
    }

    fn correlated_outputs(
        &self,
        context: Context<'_>,
        work: &mut Work,
    ) -> Result<Option<[f32; 2]>, TrajectoryError> {
        work.charge(256)?;
        let mut lift = 0_f64;
        if !positive_scale(self.kernel, self.axis, context.start, context.end) {
            let Some(phases) = frames(
                Curve::Integrated(self.kernel),
                context.start,
                context.end,
                work,
            )?
            else {
                return Ok(None);
            };
            for frame in &phases.values[..phases.len] {
                work.charge(512)?;
                let q = frame.rotation.components;
                let axial = q[self.axis];
                let scalar = q[3];
                let scale = scalar.mul(scalar).sub(axial.mul(axial));
                if scale.lo < 0. {
                    let Some(limit) = normalized_action::signed_face_lift(self.half, axial, scale)
                    else {
                        return Ok(None);
                    };
                    lift = lift.max(limit);
                }
            }
        }
        let bound = |coordinate, work: &mut Work| {
            super::normalized_action::action_bounds(
                self.kernel,
                self.axis,
                context.start,
                context.end,
                coordinate,
                work,
            )
        };
        let Some(box_action) = bound(self.half, work)? else {
            return Ok(None);
        };
        let Some(anchor_action) = bound(self.anchor, work)? else {
            return Ok(None);
        };
        // Each action output is already an F32 value. Exclude representable
        // values outside the directed real bound before the original RN adds.
        let Some(upper) =
            normalized_action::signed_face_ceiling(represented_upper(box_action), lift)
        else {
            return Ok(None);
        };
        let lower = anchor_action.lo as f32;
        let lower = if f64::from(lower) < anchor_action.lo {
            lower.next_up()
        } else {
            lower
        };
        let top = upper + self.translation.hi;
        let center = (self.center_height() + lower) + self.offset;
        Ok(Some([top, center]))
    }

    fn face_phase_clear(
        &self,
        context: Context<'_>,
        center_translation: f32,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        // Only the positive scale makes the outer face bound the full slab.
        // Both curves have the same rounded action at this same local height.
        if !positive_scale(self.kernel, self.axis, context.start, context.end) {
            return Ok(false);
        }
        let Some([first, last]) = super::normal_action_range(
            self.kernel,
            self.axis,
            context.start,
            context.end,
            self.half,
            work,
        )?
        else {
            return Ok(false);
        };
        if first <= 0. || last.to_bits().saturating_sub(first.to_bits()) >= 256 {
            return Ok(false);
        }
        let relative = self
            .relative(Clock::Logical, context.start.to_bits())
            .min(self.relative(Clock::Logical, context.end.to_bits()));
        for bits in first.to_bits()..=last.to_bits() {
            work.charge(96)?;
            let action = f32::from_bits(bits);
            let top = action + self.translation.hi;
            let center = ((center_translation + action) + self.offset) + relative;
            if !capsule_clears(
                top,
                center,
                self.core,
                self.pole,
                self.radius,
                self.clearance,
            ) {
                return Ok(false);
            }
        }
        for (motion, shape) in [(context.a, context.sa), (context.b, context.sb)] {
            motion.bounds(shape, context.start, context.end, work)?;
        }
        Ok(true)
    }

    fn correlated_clear(
        &self,
        context: Context<'_>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let Some(outputs) = self.correlated_outputs(context, work)? else {
            return Ok(false);
        };
        if !self.separates(outputs, outputs, [0.; 2]) {
            return Ok(false);
        }
        for (motion, shape) in [(context.a, context.sa), (context.b, context.sb)] {
            motion.bounds(shape, context.start, context.end, work)?;
        }
        Ok(true)
    }

    fn signed_shared_face_clear(
        &self,
        context: Context<'_>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        const MAX_BELOW_FACE_STEPS: u32 = 8;
        let below_face = self.anchor < self.half;
        if (below_face && self.half.to_bits() - self.anchor.to_bits() > MAX_BELOW_FACE_STEPS)
            || normal_scale(self.kernel.position_at_time(context.start).rotation) >= 0.
        {
            return Ok(false);
        }
        let Some(phases) = frames(
            Curve::Integrated(self.kernel),
            context.start,
            context.end,
            work,
        )?
        else {
            return Ok(false);
        };
        let mut lift = 0_f64;
        let mut loss = 0_f64;
        let mut pre_round_gain = Some(f64::INFINITY);
        let mut sum_spacing = Some(f64::INFINITY);
        for frame in &phases.values[..phases.len] {
            work.charge(512)?;
            let q = frame.rotation.components;
            let y = q[self.axis];
            let w = q[3];
            let scale = w.mul(w).sub(y.mul(y));
            sum_spacing = sum_spacing
                .zip(normalized_action::signed_sum_spacing(self.half, y, scale))
                .map(|(prior, next)| prior.min(next));
            let Some(limit) = normalized_action::signed_face_lift(self.half, y, scale) else {
                return Ok(false);
            };
            let retreat = if below_face {
                normalized_action::signed_action_loss(self.half, self.anchor, y, scale)
            } else {
                normalized_action::signed_first_product_loss(self.half, self.anchor, scale)
            };
            let Some(retreat) = retreat else {
                return Ok(false);
            };
            let gain = if below_face {
                normalized_action::signed_pre_round_action_loss(self.half, self.anchor, y, scale)
                    .map(|loss| -loss)
            } else {
                let increase = super::second_product_gap(y, self.half, self.anchor);
                let gain = Bound::exact(increase).sub(Bound::exact(retreat));
                gain.finite().then_some(gain.lo)
            };
            pre_round_gain = pre_round_gain
                .zip(gain)
                .map(|(prior, next)| prior.min(next));
            lift = lift.max(limit);
            loss = loss.max(retreat);
        }
        let Some([first, last]) = super::normal_action_range(
            self.kernel,
            self.axis,
            context.start,
            context.end,
            self.half,
            work,
        )?
        else {
            return Ok(false);
        };
        if first <= 0.
            || last.to_bits() < first.to_bits()
            || last.to_bits() - first.to_bits() >= 256
        {
            return Ok(false);
        }
        for bits in first.to_bits()..=last.to_bits() {
            work.charge(96)?;
            let face = f32::from_bits(bits);
            let face_sum = sum_spacing
                .and_then(|spacing| normalized_action::signed_sum_in_output_cell(face, spacing));
            if face_sum.is_some_and(|sum| sum.lo > sum.hi) {
                continue;
            }
            let Some(upper) = normalized_action::signed_face_ceiling(face, lift) else {
                return Ok(false);
            };
            let upper = face_sum
                .map(|sum| {
                    let top = Bound::exact(sum.hi).add(Bound::exact(lift));
                    upper.min(top.hi as f32)
                })
                .unwrap_or(upper);
            let grid_lower = pre_round_gain.and_then(|gain| {
                if let Some(sum) = face_sum {
                    let lower = Bound::exact(sum.lo).add(Bound::exact(gain));
                    lower.finite().then_some(lower.lo as f32)
                } else {
                    ActionGap::BeforeFinalRound(Bound::exact(gain)).anchor_floor(face)
                }
            });
            let rounded_lower = if below_face {
                // This loss already includes both rounded actions.
                let bound = Bound::exact(f64::from(face)).sub(Bound::exact(loss));
                bound.finite().then_some(bound.lo as f32)
            } else if loss == 0. {
                Some(face)
            } else {
                let neighbor = face.next_down();
                // The lower neighbor may be in a finer binade.
                (neighbor > 0. && loss < f64::from(neighbor) - f64::from(neighbor.next_down()))
                    .then_some(neighbor)
            };
            let Some(lower) = [grid_lower, rounded_lower]
                .into_iter()
                .flatten()
                .reduce(f32::max)
            else {
                return Ok(false);
            };
            if !capsule_clears(
                upper + self.translation.hi,
                (self.center_height() + lower) + self.offset,
                self.core,
                self.pole,
                self.radius,
                self.clearance,
            ) {
                return Ok(false);
            }
        }
        for (motion, shape) in [(context.a, context.sa), (context.b, context.sb)] {
            motion.bounds(shape, context.start, context.end, work)?;
        }
        Ok(true)
    }

    fn moving_prefix(
        &self,
        context: Context<'_>,
        work: &mut Work,
    ) -> Result<Option<Time>, TrajectoryError> {
        // Prove a prefix against a single complete rotation enclosure. Only
        // the original monotone logical displacement changes in this test.
        let coarse = if let Some(outputs) = self.correlated_outputs(context, work)? {
            self.fixed_prefix(
                outputs,
                Clock::Logical,
                context.start.to_bits(),
                context.end.to_bits(),
                work,
            )?
            .map(Time::from_bits)
        } else {
            None
        };
        if coarse == Some(context.end) {
            return Ok(coarse);
        }

        // The tiny relative product can remain invisible through only a
        // prefix. In that case use the actual physical clock through that
        // prefix and leave the rest to the logical relative-motion proof.
        let mut coarse = coarse;
        if self.translation.lo == self.translation.hi && self.velocity < 0. {
            let start = coarse.map_or(context.start, Time::next_up);
            if start < context.end {
                let center = self.outputs(self.kernel.position_at_time(start).rotation)[1];
                let step = f64::from(center) - f64::from(center.next_down());
                let half = step * 0.5;
                let visible = |at| f64::from(self.relative(Clock::Logical, at).abs());
                if half.is_finite()
                    && visible(start.to_bits()) < half
                    && visible(context.end.to_bits()) <= 2. * step
                {
                    let cutoff = Time::from_bits(last_true(
                        start.to_bits(),
                        context.end.to_bits(),
                        work,
                        |at| visible(at) < half,
                    )?);
                    if cutoff > start && self.relative_addition_invisible(start, cutoff, work)? {
                        let fixed = Self {
                            velocity: 0.,
                            ..*self
                        };
                        let end = (start + self.kernel.domain.duration() * 0.125).min(cutoff);
                        coarse = fixed.physical_prefix(start, end, cutoff, work)?.or(coarse);
                    }
                }
            }
        }
        if coarse == Some(context.end) {
            return Ok(coarse);
        }

        // Spend the existing fine-scan allowance only on the unproved tail.
        let start = coarse.map_or(context.start, Time::next_up);
        let end = (start + self.kernel.domain.duration() * 0.125).min(context.end);
        Ok(self
            .logical_prefix(start, end, context.end, work)?
            .or(coarse))
    }

    fn relative_addition_invisible(
        &self,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let domain = self.kernel.domain;
        let duration = (end - domain.start).clamp(0., domain.duration()) as f32;
        if !duration.is_finite() || duration <= 0. {
            return Ok(false);
        }
        let mut anchor = rp::Vector::ZERO;
        let mut offset = rp::Vector::ZERO;
        let mut rate = rp::Vector::ZERO;
        anchor[self.axis] = self.anchor;
        offset[self.axis] = self.offset;
        rate[self.axis] = self.velocity;
        let mut carrier = self.kernel;
        if let Some(height) = self.reference_height {
            // The original reference was proved to remain on this single
            // F32 height. Its pure-axis COM projection is the same here.
            carrier.native.motion.start.translation[self.axis] = height;
            carrier.native.motion.end.translation[self.axis] = height;
            carrier.native.linear_velocity[self.axis] = 0.;
        }
        let curve = Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity: rp::Vector::ZERO,
            rotation: rp::Rotation::IDENTITY,
        };
        let center = curve.com_pose(start).translation[self.axis];
        if !center.is_finite()
            || f64::from((self.velocity * duration).abs())
                >= (f64::from(center.next_up()) - f64::from(center)) * 0.5
        {
            return Ok(false);
        }
        crate::physics3d::solver_trajectory::linear_com_addition_invisible(
            curve, rate, start, end, duration, work,
        )
    }

    fn physical_translation_prefix(
        &self,
        start: Time,
        end: Time,
        work: &mut Work,
    ) -> Result<Option<Time>, TrajectoryError> {
        let k = self.kernel;
        let h = k.native.integration_seconds;
        let elapsed = |at| k.local_delta(Time::from_bits(at));
        let translation = |at| translation_at_input(k, self.axis, elapsed(at));
        let mut current = start.to_bits();
        let until = end.to_bits();
        let mut checked = None;
        if elapsed(current) < h {
            let interior = last_true(current, until, work, |at| elapsed(at) < h)?;
            // The accepted translation range contains at most two adjacent
            // F32 values. The interior translation is monotone on this clock.
            while current <= interior {
                let value = translation(current);
                let last = last_true(current, interior, work, |at| translation(at) == value)?;
                let point = Time::from_bits(current);
                let bound = Time::from_bits(last);
                let projection = Self {
                    translation: Float::exact(value),
                    ..*self
                };
                let clear = if current == last {
                    projection
                        .stored_prefix(
                            k.position_at_time(point),
                            Clock::Logical,
                            current,
                            last,
                            work,
                        )?
                        .map(Time::from_bits)
                } else {
                    let scan_end = (point + k.domain.duration() * 0.125).min(bound);
                    projection.physical_prefix(point, scan_end, bound, work)?
                };
                checked = clear.or(checked);
                if clear != Some(bound) {
                    return Ok(checked);
                }
                current = last + 1;
            }
        }
        if current <= until {
            let projection = Self {
                translation: Float::exact(k.native.motion.end.translation[self.axis]),
                ..*self
            };
            checked = projection
                .stored_prefix(k.native.motion.end, Clock::Logical, current, until, work)?
                .map(Time::from_bits)
                .or(checked);
        }
        Ok(checked)
    }

    fn physical_prefix(
        &self,
        start: Time,
        end: Time,
        full_end: Time,
        work: &mut Work,
    ) -> Result<Option<Time>, TrajectoryError> {
        // A zero relative product is constant on either clock. Using the
        // original F32 dt image removes redundant logical-time probes.
        let k = self.kernel;
        let dt_lo = k.local_delta(start);
        let mut dt_hi = k.local_delta(end);
        let h = k.native.integration_seconds;
        if !dt_lo.is_finite() || !dt_hi.is_finite() || dt_lo > dt_hi || end <= start {
            return Ok(None);
        }
        let mut checked = None;
        if dt_lo == 0. {
            checked = self.stored_prefix(k.native.motion.start, Clock::Physical, 0, 0, work)?;
            if checked.is_none() {
                return Ok(None);
            }
        }
        let first = dt_lo.max(f32::from_bits(1));
        let full_hi = k.local_delta(full_end);
        let full_last = full_hi.min(h.next_down());
        if let Some(complete) = phase_cells::scan(
            self,
            Clock::Physical,
            u64::from(first.to_bits()),
            u64::from(full_last.to_bits()),
            &mut checked,
            work,
        )? {
            if complete && full_hi >= h {
                let bits = u64::from(h.to_bits());
                if let Some(last) =
                    self.stored_prefix(k.native.motion.end, Clock::Physical, bits, bits, work)?
                {
                    checked = Some(last);
                }
            }
            return self.physical_frontier(start, full_end, checked, work);
        }
        let last = dt_hi.min(h.next_down());
        let scan = if first > last {
            Scan::Complete
        } else {
            self.interior(
                Clock::Physical,
                u64::from(first.to_bits()),
                u64::from(last.to_bits()),
                &mut checked,
                work,
            )?
        };
        let mut clear_until = end;
        let interior_clear = match scan {
            Scan::Complete => true,
            Scan::PossibleContact => false,
            Scan::CellLimit => {
                clear_until = full_end;
                dt_hi = k.local_delta(full_end);
                let remaining = (checked.ok_or(TrajectoryError::Unresolved)? as u32) + 1;
                self.range_prefix(
                    remaining,
                    dt_hi.min(h.next_down()).to_bits(),
                    &mut checked,
                    work,
                )?
            }
        };
        if interior_clear && dt_hi >= h {
            let bits = u64::from(h.to_bits());
            if let Some(last) =
                self.stored_prefix(k.native.motion.end, Clock::Physical, bits, bits, work)?
            {
                checked = Some(last);
            }
        }
        self.physical_frontier(start, clear_until, checked, work)
    }

    fn physical_frontier(
        &self,
        start: Time,
        end: Time,
        checked: Option<u64>,
        work: &mut Work,
    ) -> Result<Option<Time>, TrajectoryError> {
        let Some(proved) = checked else {
            return Ok(None);
        };
        Ok(Some(Time::from_bits(last_true(
            start.to_bits(),
            end.to_bits(),
            work,
            |at| u64::from(self.kernel.local_delta(Time::from_bits(at)).to_bits()) <= proved,
        )?)))
    }

    fn raw_endpoint(&self, input: u32) -> RawEndpoint {
        RawEndpoint::new(self.kernel, self.axis, input)
    }

    fn range_clear(&self, range: RawRange) -> bool {
        let RawRange { first, last } = range;
        let magnitudes = |a: f32, b: f32| {
            let low = if a <= 0. && b >= 0. || b <= 0. && a >= 0. {
                0.
            } else {
                a.abs().min(b.abs())
            };
            Float {
                lo: low,
                hi: a.abs().max(b.abs()),
            }
        };
        if [first.axial, first.scalar, last.axial, last.scalar]
            .into_iter()
            .any(|x| !x.is_finite())
        {
            return false;
        }
        // The original products on this path are all monotone in both
        // arguments. Evaluate two rounded extrema for each one.
        let multiply = |a: Float, b: Float| Float {
            lo: a.lo * b.lo,
            hi: a.hi * b.hi,
        };
        let square = |a| multiply(a, a);
        let y = magnitudes(first.axial, last.axial);
        let w = magnitudes(first.scalar, last.scalar);
        let norm = square(y).add(square(w));
        if !norm.finite() || norm.lo <= 0. {
            return false;
        }
        let factor = Float {
            lo: norm.hi.sqrt().recip(),
            hi: norm.lo.sqrt().recip(),
        };
        if !factor.finite() || factor.lo <= 0. {
            return false;
        }
        let y = multiply(y, factor);
        let w = multiply(w, factor);
        let scale = square(w).sub(square(y));
        if !scale.finite() || scale.lo < 0. {
            return false;
        }
        let action = |p| {
            let p = Float::exact(p);
            let twice_dot = multiply(multiply(p, y), Float::exact(2.));
            multiply(p, scale).add(multiply(y, twice_dot))
        };
        let translation = self.translation;
        let top = action(self.half).add(translation);
        let center_translation = self.reference_height.map_or(translation, Float::exact);
        let center = center_translation
            .add(action(self.anchor))
            .add(Float::exact(self.offset));
        if !top.finite() || !center.finite() {
            return false;
        }
        let worst = [top.hi, center.lo];
        self.separates(worst, worst, [0.; 2])
    }

    fn split_at_scalar_change(
        &self,
        range: RawRange,
        work: &mut Work,
    ) -> Result<Option<(RawEndpoint, RawEndpoint)>, TrajectoryError> {
        let current = range.first.scalar;
        let end = range.last.scalar;
        let q0 = self.kernel.native.motion.start.rotation.to_array();
        let axial = q0[self.axis];
        let angular = self.kernel.native.angular_velocity[self.axis];
        if !(current > end && end > 0. && q0[3] > 0. && axial > 0. && angular > 0.) {
            return Ok(None);
        }

        work.charge(160)?;
        let lower_edge = |x: f32| (f64::from(x) + f64::from(x.next_down())) * 0.5;
        let even = |x: f32| x.to_bits() & 1 == 0;
        let rounded_above = |value: f64, include_equal: bool| {
            let rounded = value as f32;
            let widened = f64::from(rounded);
            if widened < value || (!include_equal && widened == value) {
                rounded.next_up()
            } else {
                rounded
            }
        };

        // Invert the three rounded stages to nominate the next decreasing
        // W output. Ties prefer the destination when its significand is even.
        // The inverse is only a guess until both original neighbors agree.
        let product = rounded_above(
            f64::from(q0[3]) - lower_edge(current),
            even(current.next_down()),
        );
        let hang = rounded_above(lower_edge(product) / f64::from(axial), even(product));
        let half_dt = rounded_above(lower_edge(hang) / f64::from(angular), even(hang));
        let dt = half_dt * 2.;
        let next = dt.to_bits();
        if !dt.is_finite() || next <= range.first.input || next > range.last.input {
            return Ok(None);
        }

        work.charge(64)?;
        let previous = self.raw_endpoint(next - 1);
        let candidate = self.raw_endpoint(next);
        // The pure-axis raw W output is nonincreasing here. Two exact
        // neighboring evaluations delimit its entire current output cell.
        Ok(
            (previous.scalar.to_bits() == current.to_bits() && candidate.scalar < current)
                .then_some((previous, candidate)),
        )
    }

    fn range_prefix(
        &self,
        first: u32,
        last: u32,
        checked: &mut Option<u64>,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        if first > last {
            return Ok(true);
        }
        // Each split adds only two new raw endpoint evaluations. Retain the
        // outer endpoints along with the pending right half on the stack.
        const DEPTH: usize = u32::BITS as usize;
        work.charge(std::mem::size_of::<[RawRange; DEPTH]>() as u64 + 64)?;
        let mut range = RawRange {
            first: self.raw_endpoint(first),
            last: self.raw_endpoint(last),
        };
        let mut pending = [range; DEPTH];
        let mut count = 0;
        for _ in 0..MAX_RANGES {
            // The range check visits one bounded scalar normalization and two
            // scalar supports. Raw outputs have a separate charge on creation.
            work.charge(192)?;
            if self.range_clear(range) {
                *checked = Some(u64::from(range.last.input));
                if count == 0 {
                    return Ok(true);
                }
                count -= 1;
                range = pending[count];
            } else if range.first.input == range.last.input {
                return Ok(false);
            } else {
                if count == DEPTH {
                    return Ok(false);
                }
                let (left, right) = if let Some(split) = self.split_at_scalar_change(range, work)? {
                    split
                } else {
                    work.charge(64)?;
                    let middle = range.first.input + (range.last.input - range.first.input) / 2;
                    (self.raw_endpoint(middle), self.raw_endpoint(middle + 1))
                };
                pending[count] = RawRange {
                    first: right,
                    last: range.last,
                };
                count += 1;
                range.last = left;
            }
        }
        Ok(false)
    }
}

// Inclusive, with the predicate already true at 'low'. Each midpoint is a
// represented input, and the caller has established a monotone true prefix.
fn last_true(
    mut low: u64,
    mut high: u64,
    work: &mut Work,
    mut applies: impl FnMut(u64) -> bool,
) -> Result<u64, TrajectoryError> {
    if low < high {
        work.charge(96)?;
        if applies(high) {
            return Ok(high);
        }
    }
    while low < high {
        work.charge(96)?;
        let middle = low + (high - low).div_ceil(2);
        if applies(middle) {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    Ok(low)
}

pub(in crate::physics3d::solver_trajectory::rounded) fn nearby_rotating_conflict(
    context: Context<'_>,
    normal: rp::Vector,
    prior: Time,
    work: &mut Work,
    confirm: impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<Option<Time>, TrajectoryError> {
    let Some(axis) = (0..3).find(|&i| normal[i] != 0.) else {
        return Ok(None);
    };
    if !normal.is_finite() || (0..3).any(|i| i != axis && normal[i] != 0.) {
        return Ok(None);
    }
    let mut cardinal = rp::Vector::ZERO;
    cardinal[axis] = normal[axis].signum();
    let Some(projection) = NormalProjection::new(context, cardinal) else {
        return Ok(None);
    };
    if prior == context.start && projection.velocity == 0. {
        let search_interior = binade(Float::span(projection.half, projection.anchor)).is_none();
        return phase_cells::signed_conflict(
            &projection,
            prior,
            context.end,
            None,
            search_interior,
            work,
            confirm,
        );
    }
    if projection.velocity != 0.
        || projection.anchor <= projection.half
        || binade(Float::span(projection.half, projection.anchor)).is_some()
        || !(context.start < prior && prior < context.end)
    {
        return Ok(None);
    }
    if normal_scale(projection.kernel.native.motion.start.rotation) < 0. {
        return phase_cells::signed_conflict(
            &projection,
            context.start,
            context.end,
            Some(prior),
            true,
            work,
            confirm,
        );
    }
    phase_cells::nearby_conflict(
        &projection,
        context.start,
        context.end,
        prior,
        work,
        confirm,
    )
}

pub(in crate::physics3d::solver_trajectory::rounded) fn complete_separation(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Some(axis) = (0..3).find(|&i| normal[i] != 0.) else {
        return Ok(false);
    };
    if !normal.is_finite() || (0..3).any(|i| i != axis && normal[i] != 0.) {
        return Ok(false);
    }
    // The observation indicates a side, not the unit length of the proof's
    // world coordinate. NormalProjection checks the actual rotation axis.
    let mut cardinal = rp::Vector::ZERO;
    cardinal[axis] = normal[axis].signum();
    let Some(projection) = NormalProjection::with_face_phase(context, cardinal, true) else {
        return Ok(false);
    };
    if !context.start.is_finite()
        || !context.end.is_finite()
        || context.start >= context.end
        || context.start < projection.kernel.domain.start
        || context.end > projection.kernel.domain.end
        || !(projection.kernel.domain.duration() as f32).is_finite()
    {
        return Ok(false);
    }
    if projection.reference_height.is_none() && projection.velocity != 0. {
        return Ok(false);
    }
    work.charge(512)?;
    Kernel::from_native(projection.kernel.native, projection.kernel.domain)?;
    if let Some(center) = projection.reference_height {
        return projection.face_phase_clear(context, center, work);
    }
    // A rider attached at the face uses exactly the same rounded axial
    // action as the supporting slab. Check both capsule radius paths for
    // each possible action before using independent bounds.
    if projection.anchor == projection.half
        && projection.translation.lo == projection.translation.hi
        && projection.face_phase_clear(context, projection.translation.lo, work)?
    {
        return Ok(true);
    }
    // Prefer the shared lattice proof for near-face anchors. The separate
    // rounded action bounds can also certify supports in different binades.
    if binade(Float::span(projection.half, projection.anchor)).is_some()
        && super::separated(context, cardinal, work)?
    {
        return Ok(true);
    }
    if projection.correlated_clear(context, work)? {
        return Ok(true);
    }
    projection.signed_shared_face_clear(context, work)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn independent_fixed_center_prefix(
    kernel: Kernel,
    axis: usize,
    half: f32,
    center: f32,
    core: f32,
    radius: f32,
    clearance: f32,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    let Some(translation) = translation_range(kernel, axis, start, end) else {
        return Ok(None);
    };
    let projection = NormalProjection {
        kernel,
        axis,
        half,
        anchor: half,
        offset: 0.,
        velocity: 0.,
        core,
        pole: core - radius,
        radius,
        clearance,
        translation,
        reference_height: None,
    };
    phase_cells::fixed_center_prefix(&projection, center, start, end, work)
}

pub(in crate::physics3d::solver_trajectory::rounded) fn prefix(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    let Some(projection) = NormalProjection::with_face_phase(context, normal, true) else {
        return Ok(None);
    };
    let k = projection.kernel;
    let start = context.start;
    if !start.is_finite()
        || start.is_sign_negative()
        || !context.end.is_finite()
        || start >= context.end
        || start < k.domain.start
        || context.end > k.domain.end
    {
        return Ok(None);
    }
    work.charge(1024)?;
    Kernel::from_native(k.native, k.domain)?;
    let translation = projection.translation;
    let fixed_translation = translation.lo == translation.hi;
    let adjacent_translation = translation.lo.next_up() == translation.hi;
    let physical = (fixed_translation || adjacent_translation)
        && (k.domain.duration() as f32).is_finite()
        && (projection.velocity == 0.
            || projection.relative_addition_invisible(start, context.end, work)?);
    let clear_end = if physical {
        let projection = NormalProjection {
            velocity: 0.,
            ..projection
        };
        if fixed_translation {
            let end = (start + k.domain.duration() * 0.125).min(context.end);
            projection.physical_prefix(start, end, context.end, work)?
        } else {
            projection.physical_translation_prefix(start, context.end, work)?
        }
    } else {
        projection.moving_prefix(context, work)?
    };
    let Some(clear_end) = clear_end else {
        return Ok(None);
    };
    if clear_end < start
        || (clear_end == start && normal_scale(k.position_at_time(start).rotation) >= 0.)
    {
        return Ok(None);
    }
    // A signed slab can prove only its first represented time. Keep that
    // singleton so the cast can check the next original world pose directly.
    // Do not hide failure of the original full-shape finite bounds in an
    // unprojected coordinate. Check the accepted prefix only, after proving it.
    for (motion, shape) in [(context.a, context.sa), (context.b, context.sb)] {
        motion.bounds(shape, start, clear_end, work)?;
    }
    Ok(Some(clear_end))
}

#[cfg(test)]
mod tests;
