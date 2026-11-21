//! Complete output ranges of the original scalar F32 operations. Input dt
//! may have arbitrarily many representable values: rounding an addition to
//! a large COM/vertex can nevertheless have a singleton output image.
//!
//! This matches the locked glam scalar-math expressions, not an algebraically
//! equivalent quaternion/pose formula. No endpoint sampling certifies safety.
use super::{Bound, Curve, ShapeMotion, Time, ToiProxy, TrajectoryError, Work};
use crate::physics3d::solver_trajectory::Kernel;
use rapier3d::prelude as rp;

pub(in crate::physics3d::solver_trajectory) use support::native_box_face_cast;
mod bounds;
pub(in crate::physics3d) use bounds::straight_primitive_bounds;
pub(in crate::physics3d::solver_trajectory) use bounds::whole_bounds;
mod axial_image;
mod initial_support;
#[cfg(test)]
pub(in crate::physics3d::solver_trajectory) use initial_support::initial_support_clearance;
pub(super) use initial_support::native_clear_static_eligible_with_proxies;
pub(in crate::physics3d) use initial_support::static_signed_support_lower;
pub(in crate::physics3d::solver_trajectory) use initial_support::{
    initial_support_allowances, native_clear_static_eligible, world_radius_pair,
};
mod query_image;
mod radial;
mod shared_normal;
pub(in crate::physics3d) use shared_normal::normal_action_range;
pub(in crate::physics3d::solver_trajectory) use shared_normal::signed_face_support;
pub(super) use shared_normal::{
    clear_prefix as shared_normal_prefix, complete_separation as shared_normal_complete,
    nearby_rotating_conflict, separated as shared_normal_separated,
};
mod support;
pub(in crate::physics3d::solver_trajectory) use support::anchored_capsule_face_separated;
pub(in crate::physics3d::solver_trajectory) use support::fixed_wall_rider_separated;
pub(in crate::physics3d::solver_trajectory) use support::initial_capsule_cell;
pub(in crate::physics3d) use support::tight_face_fits;
pub(super) use support::{corotating_separated, moving_face_separated};
pub(in crate::physics3d::solver_trajectory) use support::{
    planar_capsule_cell, rounded_cap_edge_separated, rounded_cap_plane_witness,
    rounded_capsule_pair_separated, PlanarCell,
};

#[derive(Clone, Copy)]
struct Float {
    lo: f32,
    hi: f32,
}
impl Float {
    const ZERO: Self = Self::exact(0.);
    const fn exact(value: f32) -> Self {
        Self {
            lo: value,
            hi: value,
        }
    }
    fn span(a: f32, b: f32) -> Self {
        if !a.is_finite() || !b.is_finite() {
            return Self::exact(f32::NAN);
        }
        if a.total_cmp(&b).is_gt() {
            Self { lo: b, hi: a }
        } else {
            Self { lo: a, hi: b }
        }
    }
    fn finite(self) -> bool {
        self.lo.is_finite() && self.hi.is_finite()
    }
    // IEEE rounded add/sub are monotone. Evaluate the actual F32 endpoint
    // operations; next_up would unnecessarily destroy singleton outputs.
    fn add(self, rhs: Self) -> Self {
        Self::span(self.lo + rhs.lo, self.hi + rhs.hi)
    }
    fn sub(self, rhs: Self) -> Self {
        Self::span(self.lo - rhs.hi, self.hi - rhs.lo)
    }
    fn mul(self, rhs: Self) -> Self {
        let values = [
            self.lo * rhs.lo,
            self.lo * rhs.hi,
            self.hi * rhs.lo,
            self.hi * rhs.hi,
        ];
        if values.iter().any(|x| !x.is_finite()) {
            return Self::exact(f32::NAN);
        }
        let mut out = Self::exact(values[0]);
        for &x in &values[1..] {
            if x.total_cmp(&out.lo).is_lt() {
                out.lo = x;
            }
            if x.total_cmp(&out.hi).is_gt() {
                out.hi = x;
            }
        }
        out
    }
    fn image(self) -> Option<Small> {
        if !self.finite() {
            return None;
        }
        if self.lo.to_bits() == self.hi.to_bits() {
            Some(Small {
                values: [self.lo; 2],
                len: 1,
            })
        } else if self.lo == self.hi
            || (self.lo.to_bits() != (-0_f32).to_bits()
                && self.lo.next_up().to_bits() == self.hi.to_bits())
        {
            // Preserve both signed-zero outputs too. They are not silently
            // replaced with one bit pattern before a native normalization.
            Some(Small {
                values: [self.lo, self.hi],
                len: 2,
            })
        } else {
            None
        }
    }
}
#[derive(Clone, Copy)]
struct Small {
    values: [f32; 2],
    len: usize,
}
type Translation = [Float; 3];
fn exact_vector(v: rp::Vector) -> Translation {
    v.to_array().map(Float::exact)
}
fn add(a: Translation, b: Translation) -> Translation {
    std::array::from_fn(|i| a[i].add(b[i]))
}
fn sub(a: Translation, b: Translation) -> Translation {
    std::array::from_fn(|i| a[i].sub(b[i]))
}
fn mul(v: rp::Vector, s: Float) -> Translation {
    v.to_array().map(|x| Float::exact(x).mul(s))
}

fn real_float_sum(a: f32, b: f32) -> Bound {
    let (a, b) = (f64::from(a), f64::from(b));
    if !a.is_finite() || !b.is_finite() {
        return Bound::exact(f64::NAN);
    }
    // Error-free TwoSum, only for represented F32 inputs. All nonzero
    // intermediates are multiples of 2^-149, far above F64 underflow, and
    // their magnitudes are far below F64 overflow. A zero residual proves
    // an exact real extent; RN(sum)==an endpoint alone proves nothing.
    let sum = a + b;
    let virtual_b = sum - a;
    let residual = (a - (sum - virtual_b)) + (b - virtual_b);
    if residual == 0. {
        Bound::exact(sum)
    } else {
        Bound::exact(a).add(Bound::exact(b))
    }
}

fn world_radius_range(core: Float, radius: f32) -> Float {
    if !core.finite() || !radius.is_finite() || radius < 0. {
        return Float::exact(f32::NAN);
    }
    // The world-scalar radius is a real shape extent. Native RN(core±r)
    // can erase it completely; enclose the real sum first and only then
    // convert outward. This broadens a certificate, never the actual shape.
    let lower = real_float_sum(core.lo, -radius);
    let upper = real_float_sum(core.hi, radius);
    if !lower.finite() || !upper.finite() {
        return Float::exact(f32::NAN);
    }
    let mut lo = lower.lo as f32;
    let mut hi = upper.hi as f32;
    if f64::from(lo) > lower.lo {
        lo = lo.next_down();
    }
    if f64::from(hi) < upper.hi {
        hi = hi.next_up();
    }
    Float::span(lo, hi)
}

#[derive(Clone, Copy)]
struct Quaternion {
    components: [Float; 4],
    // Only the complete raw-image/native-normalize path and stored endpoints
    // own exact quaternions. Singleton-norm bounds are support-only.
    exact: Option<rp::Rotation>,
}
impl Quaternion {
    const IDENTITY: Self = Self {
        components: [Float::ZERO, Float::ZERO, Float::ZERO, Float::exact(1.)],
        exact: Some(rp::Rotation::IDENTITY),
    };
    fn exact(q: rp::Rotation) -> Self {
        Self {
            components: q.to_array().map(Float::exact),
            exact: Some(q),
        }
    }
    fn finite(self) -> bool {
        self.components.iter().all(|x| x.finite())
    }
    fn vector(self, v: rp::Vector) -> Translation {
        if let Some(q) = self.exact {
            exact_vector(q * v)
        } else {
            rotate(self.components, exact_vector(v))
        }
    }
    fn range(self, v: Translation) -> Translation {
        if let Some(q) = self.exact {
            if v.iter().all(|x| x.lo.to_bits() == x.hi.to_bits()) {
                return exact_vector(q * rp::Vector::from_array(v.map(|x| x.lo)));
            }
        }
        rotate(self.components, v)
    }
    fn conjugate(self) -> Self {
        Self {
            components: std::array::from_fn(|i| {
                if i == 3 {
                    self.components[i]
                } else {
                    Float::span(-self.components[i].hi, -self.components[i].lo)
                }
            }),
            exact: self.exact.map(|q| q.conjugate()),
        }
    }
    fn combined(self, rhs: Self) -> Self {
        if let (Some(a), Some(b)) = (self.exact, rhs.exact) {
            Self::exact(a * b)
        } else {
            Self {
                components: product(self.components, rhs.components),
                exact: None,
            }
        }
    }
    fn compose(self, q: rp::Rotation) -> Self {
        if let Some(a) = self.exact {
            Self::exact(a * q)
        } else {
            Self {
                components: product(self.components, q.to_array().map(Float::exact)),
                exact: None,
            }
        }
    }
}

/// Bounds every local point of the cuboid after the actual F32 pose transform.
pub(in crate::physics3d::solver_trajectory) fn rounded_box_extents(
    pose: rp::Pose,
    half: rp::Vector,
) -> Option<[(f32, f32); 3]> {
    let local = half.to_array().map(|h| Float::span(-h, h));
    let world = Frame::exact(pose).point_range(local);
    world
        .iter()
        .all(|x| x.finite())
        .then(|| world.map(|x| (x.lo, x.hi)))
}

#[derive(Clone, Copy)]
struct Frame {
    translation: Translation,
    rotation: Quaternion,
}
impl Frame {
    const EMPTY: Self = Self {
        translation: [Float::ZERO; 3],
        rotation: Quaternion::IDENTITY,
    };
    fn exact(pose: rp::Pose) -> Self {
        Self {
            translation: exact_vector(pose.translation),
            rotation: Quaternion::exact(pose.rotation),
        }
    }
    fn shape(self, motion: ShapeMotion) -> Self {
        // COM.prepend_translation(-local_center) * local_pose. Combining
        // these local translations first would change the F32 output law.
        let origin = add(self.translation, self.rotation.vector(-motion.local_center));
        Self {
            translation: add(origin, self.rotation.vector(motion.local_pose.translation)),
            rotation: self.rotation.compose(motion.local_pose.rotation),
        }
    }
    fn point(self, vertex: rp::Vector) -> Translation {
        // Pose::transform_point is R(q,p) + T, not R(q,p+T).
        add(self.rotation.vector(vertex), self.translation)
    }
    fn point_range(self, v: Translation) -> Translation {
        add(self.rotation.range(v), self.translation)
    }
    fn relative(a: Self, b: Self) -> Self {
        let inverse = a.rotation.conjugate();
        Self {
            rotation: inverse.combined(b.rotation),
            translation: inverse.range(sub(b.translation, a.translation)),
        }
    }
    fn inverse(self) -> Self {
        let rotation = self.rotation.conjugate();
        Self {
            rotation,
            translation: rotation.range(self.translation.map(|x| Float::span(-x.hi, -x.lo))),
        }
    }
    fn full_point(self, vertex: rp::Vector, radius: f32) -> Translation {
        if radius == 0. {
            return self.point(vertex);
        }
        // Original local-ball paths rotate the inflated point, whereas the
        // positive core-query path adds the same original radius in world
        // space. A rounded, nonunit q can shrink either local projection.
        // Include both original graphs; neither changes r or adds slop.
        let local = vertex
            .to_array()
            .map(|x| Float::span(x - radius, x + radius));
        let rotated = add(rotate(self.rotation.components, local), self.translation);
        let world = self
            .point(vertex)
            .map(|core| world_radius_range(core, radius));
        std::array::from_fn(|i| {
            if !rotated[i].finite() || !world[i].finite() {
                return Float::exact(f32::NAN);
            }
            Float::span(
                if rotated[i].lo.total_cmp(&world[i].lo).is_le() {
                    rotated[i].lo
                } else {
                    world[i].lo
                },
                if rotated[i].hi.total_cmp(&world[i].hi).is_ge() {
                    rotated[i].hi
                } else {
                    world[i].hi
                },
            )
        })
    }
}

fn rotate(q: [Float; 4], v: Translation) -> Translation {
    // Original scalar Quat::mul_vec3, in exactly its original association.
    let b = [q[0], q[1], q[2]];
    let b2 = b[0].mul(b[0]).add(b[1].mul(b[1])).add(b[2].mul(b[2]));
    let scale = q[3].mul(q[3]).sub(b2);
    let dot = v[0].mul(b[0]).add(v[1].mul(b[1])).add(v[2].mul(b[2]));
    let twice_dot = dot.mul(Float::exact(2.));
    let twice_w = q[3].mul(Float::exact(2.));
    let cross = [
        b[1].mul(v[2]).sub(v[1].mul(b[2])),
        b[2].mul(v[0]).sub(v[2].mul(b[0])),
        b[0].mul(v[1]).sub(v[0].mul(b[1])),
    ];
    std::array::from_fn(|i| {
        v[i].mul(scale)
            .add(b[i].mul(twice_dot))
            .add(cross[i].mul(twice_w))
    })
}

// Two stored endpoints plus at most 2^4 raw quaternion component outputs.
// Exact candidates use the existing native normalize function. A raw range
// with proven singleton native norm² can instead occupy one support-only
// frame. Neither path approximates sqrt or assumes an exact unit quaternion.
const MAX_FRAMES: usize = 18;
struct Frames {
    values: [Frame; MAX_FRAMES],
    len: usize,
}
impl Frames {
    fn new() -> Self {
        Self {
            values: [Frame::EMPTY; MAX_FRAMES],
            len: 0,
        }
    }
    fn push(&mut self, value: Frame) -> Option<()> {
        if !value.rotation.finite() || value.translation.iter().any(|r| !r.finite()) {
            return None;
        }
        if self.values[..self.len].iter().any(|old| {
            old.rotation.exact.is_some() == value.rotation.exact.is_some()
                && old
                    .rotation
                    .components
                    .iter()
                    .zip(value.rotation.components)
                    .all(|(a, b)| {
                        a.lo.to_bits() == b.lo.to_bits() && a.hi.to_bits() == b.hi.to_bits()
                    })
                && old.translation.iter().zip(value.translation).all(|(a, b)| {
                    a.lo.to_bits() == b.lo.to_bits() && a.hi.to_bits() == b.hi.to_bits()
                })
        }) {
            return Some(());
        }
        if self.len == self.values.len() {
            return None;
        }
        self.values[self.len] = value;
        self.len += 1;
        Some(())
    }
    fn normalized(
        &mut self,
        raw: [Float; 4],
        translation: Translation,
        sample: rp::Rotation,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        let [Some(x), Some(y), Some(z), Some(w)] = raw.map(Float::image) else {
            return if self.singleton_norm(raw, translation, sample, work)? {
                Ok(true)
            } else {
                self.normalization_range(raw, translation, work)
            };
        };
        let inputs = [x, y, z, w];
        let count = inputs.iter().map(|i| i.len).product::<usize>();
        work.charge((count as u64) * 128)?;
        for index in 0..count {
            let mut ordinal = index;
            let q = inputs.map(|v| {
                let x = v.values[ordinal % v.len];
                ordinal /= v.len;
                x
            });
            let raw = rp::Rotation::from_array(q);
            // Cartesian over-approximation can include a nonexistent zero
            // quaternion. That is a failed certificate, not a native panic.
            if !raw.length_squared().is_finite() || raw.length_squared() <= 0. {
                return Ok(false);
            }
            if self
                .push(Frame {
                    translation,
                    rotation: Quaternion::exact(raw.normalize()),
                })
                .is_none()
            {
                return Ok(false);
            }
        }
        Ok(true)
    }
    fn singleton_norm(
        &mut self,
        raw: [Float; 4],
        translation: Translation,
        sample: rp::Rotation,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        work.charge(256)?;
        // Original scalar Vec4::dot(self,self), with every original F32
        // multiply and left-associated add enclosed. No endpoint norm sample
        // is used to conclude that the other raw quaternions share its norm.
        let squared = raw[0]
            .mul(raw[0])
            .add(raw[1].mul(raw[1]))
            .add(raw[2].mul(raw[2]))
            .add(raw[3].mul(raw[3]));
        if !squared.finite() || squared.lo <= 0. || squared.lo.to_bits() != squared.hi.to_bits() {
            return Ok(false);
        }
        if sample
            .to_array()
            .into_iter()
            .zip(raw)
            .any(|(value, range)| {
                !value.is_finite()
                    || value.total_cmp(&range.lo).is_lt()
                    || value.total_cmp(&range.hi).is_gt()
            })
            || sample.length_squared().to_bits() != squared.lo.to_bits()
        {
            return Ok(false);
        }
        // Same native length_recip as Quat.normalize -> Vec4.normalize.
        // Its input norm² bits were proven equal for the *entire* raw range.
        let factor = sample.length_recip();
        if !factor.is_finite() || factor <= 0. {
            return Ok(false);
        }
        let rotation = Quaternion {
            components: raw.map(|x| x.mul(Float::exact(factor))),
            exact: None,
        };
        Ok(self
            .push(Frame {
                translation,
                rotation,
            })
            .is_some())
    }
    fn normalization_range(
        &mut self,
        raw: [Float; 4],
        translation: Translation,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        work.charge(512)?;
        if raw.iter().any(|v| !v.finite()) {
            return Ok(false);
        }
        // The locked scalar squared norm is a left-associated sum of
        // nonnegative squares. Its complete image lies between these two
        // original native dot evaluations, regardless of how many raw
        // component values occur or which components cross signed zero.
        let minimum = rp::Rotation::from_array(raw.map(|v| {
            if v.lo <= 0. && v.hi >= 0. {
                0.
            } else {
                v.lo.abs().min(v.hi.abs())
            }
        }));
        let maximum = rp::Rotation::from_array(raw.map(|v| v.lo.abs().max(v.hi.abs())));
        let low_squared = minimum.length_squared();
        let high_squared = maximum.length_squared();
        if !low_squared.is_finite()
            || low_squared <= 0.
            || !high_squared.is_finite()
            || high_squared < low_squared
        {
            return Ok(false);
        }
        // Native sqrt and reciprocal are monotone on this positive finite
        // range. Call exactly the length_recip used by Quat.normalize; no
        // replacement sqrt, norm approximation, or normalized time sample.
        let factor_lo = maximum.length_recip();
        let factor_hi = minimum.length_recip();
        if !factor_lo.is_finite()
            || factor_lo <= 0.
            || !factor_hi.is_finite()
            || factor_hi < factor_lo
        {
            return Ok(false);
        }
        let factor = Float::span(factor_lo, factor_hi);
        let rotation = Quaternion {
            components: raw.map(|v| v.mul(factor)),
            exact: None,
        };
        if !rotation.finite() {
            return Ok(false);
        }
        // This encloses the full normalized output graph, but it is not an
        // enumerated quaternion image. Only support/output interval proofs
        // may consume it; poses() still refuses exact=None.
        Ok(self
            .push(Frame {
                translation,
                rotation,
            })
            .is_some())
    }
    fn shape(&mut self, motion: ShapeMotion) {
        for value in &mut self.values[..self.len] {
            *value = value.shape(motion);
        }
    }
}

fn product(a: [Float; 4], b: [Float; 4]) -> [Float; 4] {
    // glam 0.33.12 scalar Quat::mul_quat, including its association/order.
    [
        a[3].mul(b[0])
            .add(a[0].mul(b[3]))
            .add(a[1].mul(b[2]))
            .sub(a[2].mul(b[1])),
        a[3].mul(b[1])
            .sub(a[0].mul(b[2]))
            .add(a[1].mul(b[3]))
            .add(a[2].mul(b[0])),
        a[3].mul(b[2])
            .add(a[0].mul(b[1]))
            .sub(a[1].mul(b[0]))
            .add(a[2].mul(b[3])),
        a[3].mul(b[3])
            .sub(a[0].mul(b[0]))
            .sub(a[1].mul(b[1]))
            .sub(a[2].mul(b[2])),
    ]
}

fn kernel(
    k: Kernel,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<Frames>, TrajectoryError> {
    work.charge(128)?;
    let identity = k.native.angular_velocity.to_array().map(f32::to_bits) == [0; 3]
        && k.native.motion.start.rotation.to_array().map(f32::to_bits)
            == rp::Rotation::IDENTITY.to_array().map(f32::to_bits);
    if !identity {
        work.charge(256)?;
    }
    let lo = k.local_delta(start);
    let hi = k.local_delta(end);
    if !lo.is_finite() || !hi.is_finite() || lo > hi {
        return Ok(None);
    }
    let mut out = Frames::new();
    // Native has endpoint branches even when the *logical* timestamp is
    // interior and conversion to physical dt rounds to 0 or native.h.
    if lo <= 0. && out.push(Frame::exact(k.native.motion.start)).is_none() {
        return Ok(None);
    }
    if hi >= k.native.integration_seconds && out.push(Frame::exact(k.native.motion.end)).is_none() {
        return Ok(None);
    }
    let dt = Float {
        lo: lo.max(f32::from_bits(1)),
        hi: hi.min(k.native.integration_seconds.next_down()),
    };
    if dt.lo <= dt.hi {
        let translation = add(
            exact_vector(k.native.motion.start.translation),
            mul(k.native.linear_velocity, dt),
        );
        if identity {
            // Positive zero angular components produce an exact identity
            // increment for every nonnegative physical input. Multiplication
            // and normalization both leave its bits unchanged. Stored start
            // and end poses still take their own branches above.
            let interior = Frame {
                translation,
                rotation: Quaternion::IDENTITY,
            };
            return Ok(out.push(interior).map(|()| out));
        }
        // Exactly omega*(dt*.5), then increment*q0, then normalize. Neither
        // dt*omega*.5 nor normalize(q0+dt*qdot) is substituted here.
        let hang = mul(k.native.angular_velocity, dt.mul(Float::exact(0.5)));
        let raw = product(
            [hang[0], hang[1], hang[2], Float::exact(1.)],
            k.native.motion.start.rotation.to_array().map(Float::exact),
        );
        let hang_sample = k.native.angular_velocity * (dt.lo * 0.5);
        let sample = rp::Rotation::from_xyzw(hang_sample.x, hang_sample.y, hang_sample.z, 1.)
            * k.native.motion.start.rotation;
        if !out.normalized(raw, translation, sample, work)? {
            return Ok(None);
        }
    }
    Ok((out.len > 0).then_some(out))
}

fn frames(
    curve: Curve,
    start: Time,
    end: Time,
    work: &mut Work,
) -> Result<Option<Frames>, TrajectoryError> {
    let (from, to) = curve.times();
    if start < from || end > to || start > end {
        return Ok(None);
    }
    match curve {
        Curve::Constant { pose, .. } => {
            let mut out = Frames::new();
            Ok(out.push(Frame::exact(pose)).map(|()| out))
        }
        Curve::Integrated(k) => kernel(k, start, end, work),
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        } => {
            let Some(mut out) = kernel(carrier, start, end, work)? else {
                return Ok(None);
            };
            work.charge(
                (out.len as u64)
                    * if out.values[..out.len]
                        .iter()
                        .any(|f| f.rotation.exact.is_none())
                    {
                        1024
                    } else {
                        128
                    },
            )?;
            let relative = Float::span(
                (start - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32,
                (end - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32,
            );
            for f in &mut out.values[..out.len] {
                f.translation = add(
                    add(
                        add(f.translation, f.rotation.vector(anchor)),
                        exact_vector(offset),
                    ),
                    mul(linear_velocity, relative),
                );
                f.rotation = Quaternion::exact(rotation);
            }
            Ok(Some(out))
        }
        Curve::Ccd {
            sweep,
            start_time,
            end_time,
        } => {
            work.charge(384)?;
            let span = end_time - start_time;
            if span <= 0. {
                return Ok(None);
            }
            let t = Float::span(
                ((start - start_time) / span).clamp(0., 1.) as f32,
                ((end - start_time) / span).clamp(0., 1.) as f32,
            );
            let one_minus = Float::exact(1.).sub(t);
            let q1 = if sweep.q1.dot(sweep.q2) < 0. {
                -sweep.q1
            } else {
                sweep.q1
            };
            let raw = std::array::from_fn(|i| {
                Float::exact(q1.to_array()[i])
                    .mul(one_minus)
                    .add(Float::exact(sweep.q2.to_array()[i]).mul(t))
            });
            // Original non-monotone Vec3::lerp, not lerp_monotonic.
            let translation = add(mul(sweep.c1, one_minus), mul(sweep.c2, t));
            let mut out = Frames::new();
            let sample = q1 * (1.0 - t.lo) + sweep.q2 * t.lo;
            if !out.normalized(raw, translation, sample, work)? {
                return Ok(None);
            }
            work.charge(
                (out.len as u64)
                    * if out.values[..out.len]
                        .iter()
                        .any(|f| f.rotation.exact.is_none())
                    {
                        1024
                    } else {
                        128
                    },
            )?;
            for f in &mut out.values[..out.len] {
                let local = f.rotation.vector(sweep.local_center);
                // transform_at subtracts this; com_pose then prepends it.
                f.translation = add(sub(f.translation, local), local);
            }
            Ok(Some(out))
        }
    }
}

fn project(value: Translation, axis: rp::Vector) -> Option<Bound> {
    if value.iter().any(|r| !r.finite()) {
        return None;
    }
    let mut out = Bound::exact(0.);
    for (range, n) in value.into_iter().zip(axis.to_array()) {
        out = out.add(
            Bound {
                lo: f64::from(range.lo),
                hi: f64::from(range.hi),
            }
            .mul(Bound::exact(f64::from(n))),
        );
    }
    Some(out)
}

/// The same original local-radius/world-real-radius enclosure used by the
/// output proof. Equal poses cover one finite parameter output; a fixed
/// rotation and componentwise translation range cover the monotone linear
/// path after the caller has proved its original endpoint/interior law.
/// The caller prepays each original point: the established 1024 rounded
/// point price for nonzero radius, and its fixed scalar point price for r0.
pub(super) fn full_projection(
    low: rp::Pose,
    high: rp::Pose,
    point: rp::Vector,
    radius: f32,
    axis: rp::Vector,
) -> Option<Bound> {
    if !low.is_finite()
        || !high.is_finite()
        || low.rotation.to_array().map(f32::to_bits) != high.rotation.to_array().map(f32::to_bits)
    {
        return None;
    }
    let frame = Frame {
        translation: std::array::from_fn(|i| Float::span(low.translation[i], high.translation[i])),
        rotation: Quaternion::exact(low.rotation),
    };
    project(frame.full_point(point, radius), axis)
}

const MAX_POSES: usize = 8;
struct Poses {
    values: [rp::Pose; MAX_POSES],
    len: usize,
}
fn poses(frames: &Frames, work: &mut Work) -> Result<Option<Poses>, TrajectoryError> {
    work.charge((frames.len as u64) * 8 * 32)?;
    let mut out = Poses {
        values: [rp::Pose::IDENTITY; MAX_POSES],
        len: 0,
    };
    for f in &frames.values[..frames.len] {
        let Some(rotation) = f.rotation.exact else {
            return Ok(None);
        };
        let [Some(x), Some(y), Some(z)] = f.translation.map(Float::image) else {
            return Ok(None);
        };
        for &x in &x.values[..x.len] {
            for &y in &y.values[..y.len] {
                for &z in &z.values[..z.len] {
                    let p = rp::Pose::from_parts(rp::Vector::new(x, y, z), rotation);
                    if out.values[..out.len].iter().any(|old| {
                        old.translation.to_array().map(f32::to_bits)
                            == p.translation.to_array().map(f32::to_bits)
                            && old.rotation.to_array().map(f32::to_bits)
                                == p.rotation.to_array().map(f32::to_bits)
                    }) {
                        continue;
                    }
                    if out.len == out.values.len() {
                        return Ok(None);
                    }
                    out.values[out.len] = p;
                    out.len += 1;
                }
            }
        }
    }
    Ok(Some(out))
}

#[derive(Clone, Copy)]
pub(super) struct Context<'a> {
    pub(super) a: ShapeMotion,
    pub(super) sa: &'a dyn rp::Shape,
    pub(super) b: ShapeMotion,
    pub(super) sb: &'a dyn rp::Shape,
    pub(super) start: Time,
    pub(super) end: Time,
    pub(super) clearance: f32,
}
struct PreparedFrames<'a> {
    a: Frames,
    b: Frames,
    pa: ToiProxy<'a>,
    pb: ToiProxy<'a>,
}
/// Private interval-local owner: geometry/time/clearance are bound at
/// construction and cannot be changed between axis requests.
pub(in crate::physics3d::solver_trajectory) struct AxisCache<'a> {
    context: Context<'a>,
    pub(super) finite_image: super::finite_image::Cache<'a>,
    query_image: query_image::Cache,
    axial_image: axial_image::Cache,
    attempted: bool,
    prepared: Option<PreparedFrames<'a>>,
    face: Option<bool>,
    support_done: bool,
    capsule_support: Option<bool>,
    point_probe_taken: bool,
}
impl<'a> AxisCache<'a> {
    pub(in crate::physics3d::solver_trajectory) fn new(
        a: ShapeMotion,
        sa: &'a dyn rp::Shape,
        b: ShapeMotion,
        sb: &'a dyn rp::Shape,
        start: Time,
        end: Time,
        clearance: f32,
    ) -> Self {
        let context = Context {
            a,
            sa,
            b,
            sb,
            start,
            end,
            clearance,
        };
        Self {
            context,
            finite_image: super::finite_image::Cache::new(context),
            query_image: query_image::Cache::default(),
            axial_image: axial_image::Cache::default(),
            attempted: false,
            prepared: None,
            face: None,
            support_done: false,
            capsule_support: None,
            point_probe_taken: false,
        }
    }
    pub(super) fn context(&self) -> Context<'a> {
        self.context
    }
    pub(super) fn point_probe_available(&self) -> bool {
        !self.point_probe_taken
    }
    pub(super) fn take_point_probe(&mut self) {
        self.point_probe_taken = true;
    }
}
fn prepare<'a>(
    context: Context<'a>,
    work: &mut Work,
) -> Result<Option<PreparedFrames<'a>>, TrajectoryError> {
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        ..
    } = context;
    let (Some(mut fa), Some(mut fb)) = (
        frames(a.curve, start, end, work)?,
        frames(b.curve, start, end, work)?,
    ) else {
        return Ok(None);
    };
    let pa = ToiProxy::from_shape(sa).ok_or(TrajectoryError::UnsupportedShape)?;
    let pb = ToiProxy::from_shape(sb).ok_or(TrajectoryError::UnsupportedShape)?;
    let frame_charge = (fa.len + fb.len)
        .checked_mul(
            if fa.values[..fa.len]
                .iter()
                .chain(&fb.values[..fb.len])
                .any(|f| f.rotation.exact.is_none())
            {
                1024
            } else {
                128
            },
        )
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(u64::try_from(frame_charge).map_err(|_| TrajectoryError::WorkLimit)?)?;
    fa.shape(a);
    fb.shape(b);
    if fa.values[..fa.len]
        .iter()
        .chain(&fb.values[..fb.len])
        .any(|f| !f.rotation.finite() || f.translation.iter().any(|v| !v.finite()))
    {
        return Ok(None);
    }
    Ok(Some(PreparedFrames {
        a: fa,
        b: fb,
        pa,
        pb,
    }))
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    a: ShapeMotion,
    sa: &dyn rp::Shape,
    b: ShapeMotion,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let mut axes = super::super::SeparationAxes::single(normal);
    let mut cache = AxisCache::new(a, sa, b, sb, start, end, clearance);
    separated_cached(0, work, &mut axes, &mut cache)
}
pub(super) fn separated_cached(
    index: usize,
    work: &mut Work,
    axes: &mut super::super::SeparationAxes,
    cache: &mut AxisCache<'_>,
) -> Result<bool, TrajectoryError> {
    let Context {
        sa, sb, clearance, ..
    } = cache.context;
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    let (fa, fb) = (&prepared.a, &prepared.b);
    let normal = axes.values[index].normal;
    if radial::world_scalar(fa, sa, fb, sb, clearance, work)? {
        return Ok(true);
    }
    if full_plane(prepared, sa, sb, normal, clearance, work)? {
        return Ok(true);
    }
    // The old cheap cube and an existing complete native pose image can
    // already settle most intervals. Reserve the more expensive whole-hull
    // arithmetic/face proof for intervals that still need it.
    let image = cache.query_image.clear(fa, sa, fb, sb, clearance, work);
    match image {
        Ok(Some(true)) => Ok(true),
        Ok(None | Some(false)) => {
            if shared_normal_separated(cache.context(), normal, work)? {
                Ok(true)
            } else {
                support_after_image(index, work, axes, cache)
            }
        }
        Err(query_image::Error::Preparation(error)) => Err(error),
        Err(query_image::Error::Leaf(error)) => {
            if shared_normal_separated(cache.context(), normal, work)?
                || support_after_image(index, work, axes, cache)?
            {
                Ok(true)
            } else {
                Err(error)
            }
        }
    }
}

// The optional cardinal phase can reuse only this original full-output
// support plane. It does not grant an initial margin or use any contact
// distance/normal as a geometric certificate.
pub(in crate::physics3d::solver_trajectory) fn closed_plane_cached(
    index: usize,
    work: &mut Work,
    axes: &super::super::SeparationAxes,
    cache: &mut AxisCache<'_>,
) -> Result<bool, TrajectoryError> {
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    full_plane(
        prepared,
        cache.context.sa,
        cache.context.sb,
        axes.values[index].normal,
        cache.context.clearance,
        work,
    )
}

pub(super) fn staggered_prefix(
    context: Context<'_>,
    normal: rp::Vector,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<Time>, TrajectoryError> {
    support::staggered_prefix(context, normal, tolerance, work)
}
pub(super) fn early_common_product_applicable(context: Context<'_>) -> bool {
    support::early_common_product_applicable(context)
}
pub(super) fn common_product_applicable(context: Context<'_>) -> bool {
    support::common_product_applicable(context)
}
pub(super) fn common_product_separated(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    support::common_product_separated(context, normal, work)
}

/// Final supplemental support after all original axes/closed planes/corotating
/// attempts. The original immutable prepared frame ranges are reused.
pub(super) fn exact_box_separated_cached(
    cache: &mut AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context { sa, sb, .. } = cache.context;
    if !((sa.as_cuboid().is_some() && sb.as_capsule().is_some())
        || (sb.as_cuboid().is_some() && sa.as_capsule().is_some()))
    {
        return Ok(false);
    }
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    support::exact_box_separated(
        cache.context,
        &prepared.a,
        &prepared.pa,
        &prepared.b,
        &prepared.pb,
        normal,
        work,
    )
}

pub(in crate::physics3d::solver_trajectory) fn ramp_capsule_separated(
    cache: &mut AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context { a, sa, b, sb, .. } = cache.context;
    let fixed_face = |motion: ShapeMotion, shape: &dyn rp::Shape| {
        matches!(motion.curve, Curve::Constant { .. })
            && (shape.as_convex_polyhedron().is_some() || shape.as_triangle().is_some())
    };
    if !((fixed_face(a, sa) && sb.as_capsule().is_some())
        || (fixed_face(b, sb) && sa.as_capsule().is_some()))
    {
        return Ok(false);
    }
    fixed_support_capsule_separated(cache, normal, work)
}

pub(in crate::physics3d::solver_trajectory) fn fixed_support_capsule_separated(
    cache: &mut AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    support::ramp_capsule_separated(cache.context, prepared, normal, work)
}

pub(in crate::physics3d::solver_trajectory) fn cardinal_box_ball_separated(
    cache: &mut AxisCache<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context {
        sa, sb, clearance, ..
    } = cache.context;
    let (cube, ball, swapped) = if let (Some(cube), Some(ball)) = (sa.as_cuboid(), sb.as_ball()) {
        if !cache.context.a.is_fixed_axis_aligned() {
            return Ok(false);
        }
        (cube, ball, false)
    } else if let (Some(ball), Some(cube)) = (sa.as_ball(), sb.as_cuboid()) {
        if !cache.context.b.is_fixed_axis_aligned() {
            return Ok(false);
        }
        (cube, ball, true)
    } else {
        return Ok(false);
    };
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    let (a, b) = if swapped {
        (&prepared.b, &prepared.a)
    } else {
        (&prepared.a, &prepared.b)
    };
    let ball_motion = if swapped {
        cache.context.a
    } else {
        cache.context.b
    };
    support::cardinal_box_ball(
        a,
        cube,
        b,
        ball,
        (ball_motion, cache.context.start, cache.context.end),
        clearance,
        work,
    )
}

pub(in crate::physics3d::solver_trajectory) fn offset_box_ball_separated(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context {
        a,
        sa,
        b,
        sb,
        clearance,
        ..
    } = context;
    let (motion, cube, target, ball, normal) =
        if let (Some(cube), Some(ball)) = (sa.as_cuboid(), sb.as_ball()) {
            (a, cube, b, ball, normal)
        } else if let (Some(ball), Some(cube)) = (sa.as_ball(), sb.as_cuboid()) {
            (b, cube, a, ball, -normal)
        } else {
            return Ok(false);
        };
    if !target.is_fixed_axis_aligned()
        || motion.local_pose.rotation != rp::Rotation::IDENTITY
        || motion.local_pose.translation == rp::Vector::ZERO
        || !matches!(motion.curve, Curve::Integrated(_))
        || clearance <= 0.
    {
        return Ok(false);
    }
    support::offset_separated(motion, cube, target, ball, normal, context, work)
}

pub(in crate::physics3d::solver_trajectory) fn rotating_capsule_ball_separated(
    cache: &mut AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context {
        a,
        b,
        sa,
        sb,
        clearance,
        ..
    } = cache.context;
    if clearance < 0. {
        return Ok(false);
    }
    let (cap, ball, flipped) = if let (Some(cap), Some(ball)) = (sa.as_capsule(), sb.as_ball()) {
        if !a.is_single_axis_spin() || !b.is_fixed_axis_aligned() {
            return Ok(false);
        }
        (cap, ball, false)
    } else if let (Some(ball), Some(cap)) = (sa.as_ball(), sb.as_capsule()) {
        if !b.is_single_axis_spin() || !a.is_fixed_axis_aligned() {
            return Ok(false);
        }
        (cap, ball, true)
    } else {
        return Ok(false);
    };
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    let (capsule, sphere, direction) = if flipped {
        (&prepared.b, &prepared.a, -normal)
    } else {
        (&prepared.a, &prepared.b, normal)
    };
    support::capsule_ball_separated(capsule, cap, sphere, ball, direction, clearance, work)
}

pub(in crate::physics3d::solver_trajectory) fn rotating_box_ball_face_separated(
    cache: &mut AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context {
        sa, sb, clearance, ..
    } = cache.context;
    let (cube, ball, normal, swapped) =
        if let (Some(cube), Some(ball)) = (sa.as_cuboid(), sb.as_ball()) {
            (cube, ball, normal, false)
        } else if let (Some(ball), Some(cube)) = (sa.as_ball(), sb.as_cuboid()) {
            (cube, ball, -normal, true)
        } else {
            return Ok(false);
        };
    let (box_motion, ball_motion) = if swapped {
        (cache.context.b, cache.context.a)
    } else {
        (cache.context.a, cache.context.b)
    };
    if offset_box_ball_separated(cache.context, normal, work)? {
        return Ok(true);
    }
    if !box_motion.is_single_axis_spin() || !ball_motion.is_fixed_axis_aligned() || clearance < 0. {
        return Ok(false);
    }
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    let (a, b) = if swapped {
        (&prepared.b, &prepared.a)
    } else {
        (&prepared.a, &prepared.b)
    };
    support::rotating_box_ball_face(a, cube, b, ball, normal, clearance, cache.context, work)
}

pub(super) fn fixed_wall_overlap(
    context: Context<'_>,
    at: Time,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    support::fixed_wall_overlap(context, at, work)
}
pub(super) fn fixed_wall_time_hint(context: Context<'_>) -> Option<Time> {
    support::fixed_wall_time_hint(context)
}

pub(super) fn planar_rotating_box_separated(
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    support::planar_rotating_box_separated(context, work)
}

pub(super) fn corotating_projected_prefix(
    context: Context<'_>,
    work: &mut Work,
) -> Result<crate::physics3d::solver_trajectory::IntervalCertificate, TrajectoryError> {
    support::corotating_projected_prefix(context, work)
}

pub(super) fn shared_planar_capsule_sweep(
    context: Context<'_>,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<crate::physics3d::solver_trajectory::CastHit>, TrajectoryError> {
    support::shared_planar_capsule_sweep(context, tolerance, work)
}

pub(in crate::physics3d::solver_trajectory) fn axial_capsule_separated(
    context: Context<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    support::axial_capsule_separated(context, normal, work)
}

pub(in crate::physics3d::solver_trajectory) fn fixed_box_capsule_edge_prefix(
    cache: &AxisCache<'_>,
    tolerance: Time,
    work: &mut Work,
) -> Result<Time, TrajectoryError> {
    let mut context = cache.context;
    let mut frontier = context.start;
    let mut pending = [0.; 64];
    let mut count = 0;
    // Prove the ordered prefix without making a fresh contact observation
    // at every midpoint. Only the original search can report a hit.
    loop {
        work.charge(8)?;
        match radial::fixed_box_capsule_edge(context, work)? {
            Some(true) => {
                frontier = context.end;
                if count == 0 {
                    break;
                }
                count -= 1;
                context.start = frontier;
                context.end = pending[count];
            }
            Some(false) if count < pending.len() && context.start.next_up() < context.end => {
                let middle = if context.end - context.start > tolerance {
                    context.start + (context.end - context.start) * 0.5
                } else {
                    let (lo, hi) = (context.start.to_bits(), context.end.to_bits());
                    Time::from_bits(lo + (hi - lo) / 2)
                };
                if middle <= context.start || middle >= context.end {
                    break;
                }
                pending[count] = context.end;
                count += 1;
                context.end = middle;
            }
            _ => break,
        }
    }
    Ok(frontier)
}

pub(in crate::physics3d::solver_trajectory) fn rotating_cardinal_box_face_separated(
    cache: &mut AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context {
        a,
        sa,
        b,
        sb,
        start,
        end,
        clearance,
    } = cache.context;
    let (cube, cuboid, cap, capsule, n) =
        if let (Some(cube), Some(cap)) = (sa.as_cuboid(), sb.as_capsule()) {
            (a, cube, b, cap, normal)
        } else if let (Some(cap), Some(cube)) = (sa.as_capsule(), sb.as_cuboid()) {
            (b, cube, a, cap, -normal)
        } else {
            return Ok(false);
        };
    if !matches!(cube.curve, Curve::Integrated(k) if k.native.angular_velocity != rp::Vector::ZERO)
        || !matches!(cap.curve, Curve::Integrated(k) if k.has_identity_orientation())
        || !normal.is_finite()
        || !cuboid.half_extents.is_finite()
        || clearance <= 0.
        || [cube, cap]
            .into_iter()
            .any(|m| m.local_center != rp::Vector::ZERO || m.local_pose != rp::Pose::IDENTITY)
    {
        return Ok(false);
    }
    let axis = n.abs().max_position();
    if n[axis].abs() < 0.99 {
        return Ok(false);
    }
    let sign = n[axis].signum();
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = &cache.prepared else {
        return Ok(false);
    };
    let frames = if sa.as_cuboid().is_some() {
        &prepared.a
    } else {
        &prepared.b
    };
    work.charge(512 * frames.len as u64)?;
    let hull = cuboid.half_extents.to_array().map(|h| Float::span(-h, h));
    let mut support = f32::NEG_INFINITY;
    for frame in &frames.values[..frames.len] {
        let offset = frame.rotation.range(hull)[axis];
        if !offset.finite() {
            return Ok(false);
        }
        support = support.max(if sign > 0. { offset.hi } else { -offset.lo });
    }
    if !support.is_finite() || support > cuboid.half_extents[axis] {
        return Ok(false);
    }
    super::integrated_linear::bounded_rotating_face(
        cube,
        cap,
        axis,
        sign,
        sign * support,
        capsule,
        start,
        end,
        clearance,
        work,
    )
}

pub(in crate::physics3d::solver_trajectory) fn rotating_box_capsule_separated(
    cache: &mut AxisCache<'_>,
    normal: rp::Vector,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let Context {
        a,
        b,
        sa,
        sb,
        clearance,
        ..
    } = cache.context;
    let (cube, capsule, flipped) =
        if let (Some(cube), Some(cap)) = (sa.as_cuboid(), sb.as_capsule()) {
            if !a.is_single_axis_spin() || !super::upright_capsule_motion(b) {
                return Ok(false);
            }
            (cube, cap, false)
        } else if let (Some(cap), Some(cube)) = (sa.as_capsule(), sb.as_cuboid()) {
            if !b.is_single_axis_spin() || !super::upright_capsule_motion(a) {
                return Ok(false);
            }
            (cube, cap, true)
        } else {
            return Ok(false);
        };
    if clearance < 0. {
        return Ok(false);
    }
    if !cache.attempted {
        cache.prepared = prepare(cache.context, work)?;
        cache.attempted = true;
    }
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    let (a, b, n) = if flipped {
        (&prepared.b, &prepared.a, -normal)
    } else {
        (&prepared.a, &prepared.b, normal)
    };
    support::rotating_box_capsule_face(a, cube, b, capsule, n, cache.context, work)
}

fn full_plane(
    prepared: &PreparedFrames<'_>,
    sa: &dyn rp::Shape,
    sb: &dyn rp::Shape,
    normal: rp::Vector,
    clearance: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let PreparedFrames {
        a: fa,
        b: fb,
        pa,
        pb,
    } = prepared;
    let count = fa
        .len
        .checked_mul(pa.points().len())
        .and_then(|n| {
            n.checked_mul(
                if pa.radius > 0.
                    || fa.values[..fa.len]
                        .iter()
                        .any(|f| f.rotation.exact.is_none())
                {
                    1024
                } else {
                    128
                },
            )
        })
        .and_then(|n| {
            fb.len
                .checked_mul(pb.points().len())
                .and_then(|m| {
                    m.checked_mul(
                        if pb.radius > 0.
                            || fb.values[..fb.len]
                                .iter()
                                .any(|f| f.rotation.exact.is_none())
                        {
                            1024
                        } else {
                            128
                        },
                    )
                })
                .and_then(|m| n.checked_add(m))
        })
        .ok_or(TrajectoryError::WorkLimit)?;
    work.charge(u64::try_from(count).map_err(|_| TrajectoryError::WorkLimit)?)?;
    let mut upper = f64::NEG_INFINITY;
    let mut lower = f64::INFINITY;
    for f in &fa.values[..fa.len] {
        for &point in pa.points() {
            let Some(projection) = project(f.full_point(point, pa.radius), normal) else {
                return Ok(false);
            };
            upper = upper.max(projection.hi);
        }
    }
    for f in &fb.values[..fb.len] {
        for &point in pb.points() {
            let Some(projection) = project(f.full_point(point, pb.radius), normal) else {
                return Ok(false);
            };
            lower = lower.min(projection.lo);
        }
    }
    let norm2 = super::dot(normal, normal);
    if norm2.lo <= 0. || !norm2.hi.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let norm = norm2.sqrt();
    // The original radii are already enclosed in local coordinates before
    // the actual rotation/translation operations. Only clearance remains.
    let margin = Bound::exact(f64::from(clearance)).mul(norm);
    let gap = Bound::exact(lower).sub(Bound::exact(upper)).sub(margin).lo;
    if !gap.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    // A geometric support-plane gap can disagree with the ball primary
    // query's sequential rounded radius subtraction. Only its graph-aware
    // check above or the complete original leaf-query image below may
    // certify this pair; do not fall through to an ideal cube-plane proof.
    Ok(gap >= 0. && !(sa.as_ball().is_some() && sb.as_ball().is_some()))
}

fn support_after_image(
    index: usize,
    work: &mut Work,
    axes: &mut super::super::SeparationAxes,
    cache: &mut AxisCache<'_>,
) -> Result<bool, TrajectoryError> {
    let Context {
        sa, sb, clearance, ..
    } = cache.context;
    let Some(prepared) = cache.prepared.as_ref() else {
        return Ok(false);
    };
    let (a, b) = (&prepared.a, &prepared.b);
    // Local-radius separation can only decide this stage when neither
    // shape needs the real world-radius proof below.
    if prepared.pa.radius == 0. && prepared.pb.radius == 0. {
        let face = match cache.face {
            Some(value) => value,
            None => {
                let value = radial::local_face(a, sa, b, sb, clearance, work)?;
                cache.face = Some(value);
                value
            }
        };
        if face {
            return Ok(true);
        }
    }
    if !cache.support_done {
        // Both zero-radius and Ball/Ball owners have no new tight support
        // proof. Do not eagerly resolve future axes in either case.
        if (sa.as_ball().is_some() && sb.as_ball().is_some())
            || (prepared.pa.radius == 0. && prepared.pb.radius == 0.)
        {
            return Ok(false);
        }
        axes.ensure_all(work)?;
        support::separated_axes(
            a,
            &prepared.pa,
            b,
            &prepared.pb,
            &mut axes.values[..axes.len],
            clearance,
            work,
        )?;
        cache.support_done = true;
    }
    if axes.values[index].full_support.unwrap_or(false) {
        return Ok(true);
    }
    // Preserve the existing face and whole-support stages before trying the
    // extra direction. It remains a whole-F32 certificate, never a contact
    // result, and is prepared at most once in this immutable pair/interval.
    let capsule = match cache.capsule_support {
        Some(value) => value,
        None => {
            let value = support::capsule_separation(cache.context, a, b, work)?;
            cache.capsule_support = Some(value);
            value
        }
    };
    if capsule {
        return Ok(true);
    }
    // Original axis/face/batched-support/capsule stages keep first refusal.
    // The optional query-equivalence certificate owns only this fixed context.
    let native_clear = cache.axial_image.clear(a, sa, b, sb, clearance, work)?;
    // Cache.clear still describes the original Native predicate over its
    // entire tangent family. A representative alone cannot certify the
    // original world-radius geometry. The full-range proofs above retain
    // their original priority; otherwise continue the original axis/timeline
    // search rather than promoting this Native-only observation to NoHit.
    Ok(native_clear == Some(true) && !world_radius_pair(sa, sb))
}

// The smallest rounding-cell half-width among all represented numbers in
// this complete range. Looking only toward next_up misses the smaller lower
// spacing at a binade boundary. Compute in F64, retaining 2^-150 near zero.
fn minimum_half_cell(range: Float) -> Option<f64> {
    if !range.finite() {
        return None;
    }
    let closest = if range.lo <= 0. && range.hi >= 0. {
        0.
    } else {
        range.lo.abs().min(range.hi.abs())
    };
    let down = f64::from(closest) - f64::from(closest.next_down());
    let next = closest.next_up();
    // At MAXfinite the finite opposite gap is also a conservative bound
    // against the IEEE nearest-overflow threshold in the outward direction.
    let up = if next.is_finite() {
        f64::from(next) - f64::from(closest)
    } else {
        down
    };
    let half = down.min(up) * 0.5;
    (half.is_finite() && half > 0.).then_some(half)
}

pub(super) fn linear_com_addition_invisible(
    curve: Curve,
    rate: rp::Vector,
    start: Time,
    end: Time,
    max_addition_seconds: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(256)?;
    let (from, to) = curve.times();
    if !start.is_finite()
        || !end.is_finite()
        || !from.is_finite()
        || !to.is_finite()
        || start > end
        || to < from
        || !(to - from).is_finite()
        || !(end - start).is_finite()
        || start < from
        || end > to
        || !max_addition_seconds.is_finite()
        || max_addition_seconds < 0.
    {
        return Err(TrajectoryError::InvalidTime);
    }
    if !rate.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    // The added term is a separate constant-rate F32 multiplication. Its
    // magnitude is monotone for 0<=elapsed<=the caller's trusted bound. Do
    // not infer this bound from an Anchored curve's native carrier dt.
    let maximum_delta = rate * max_addition_seconds;
    if !maximum_delta.is_finite() {
        return Err(TrajectoryError::NonFinite);
    }
    let Some(complete) = frames(curve, start, end, work)? else {
        return Ok(false);
    };
    work.charge((complete.len as u64) * 96)?;
    for frame in &complete.values[..complete.len] {
        if !frame.rotation.finite() || frame.translation.iter().any(|v| !v.finite()) {
            return Err(TrajectoryError::NonFinite);
        }
        for (coordinate, delta) in frame.translation.into_iter().zip(maximum_delta.to_array()) {
            // Signed zero is numerically zero. No pose-bit preservation is
            // authorized here; the caller retains its separate safe-bit gate.
            if delta == 0. {
                continue;
            }
            let Some(half) = minimum_half_cell(coordinate) else {
                return Err(TrajectoryError::NonFinite);
            };
            if f64::from(delta).abs() >= half {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests;
