//! A coarser Native time cell bounds the other body's represented dt.
//! For equal velocities both faces translate by the same amount on a
//! residue class, even when the two original kernels start at different times.
use super::{grid, quantum, Bound, Kernel, Source, Time, TrajectoryError, Work};

#[derive(Clone, Copy)]
struct Rounded {
    ends: [f32; 2],
    quantum: i32,
}

impl Rounded {
    /// On this interval a translated input either stays exactly representable,
    /// or its rounded evaluations have the same spacing and tie parity.
    fn stage(ends: [f32; 2], input_grid: i32, shift_grid: i32) -> Option<Self> {
        if !ends.iter().all(|v| v.is_finite()) {
            return None;
        }
        let max_grid = grid(ends[0].abs().max(ends[1].abs()));
        if input_grid >= max_grid {
            return Some(Self {
                ends,
                quantum: input_grid,
            });
        }
        if shift_grid <= max_grid
            || ends[0].is_sign_negative() != ends[1].is_sign_negative()
            || ends.iter().any(|&v| {
                v == 0.
                    || grid(v) != max_grid
                    || grid(v.next_down()) != max_grid
                    || grid(v.next_up()) != max_grid
            })
        {
            return None;
        }
        Some(Self {
            ends,
            quantum: max_grid,
        })
    }
    fn add(self, value: f32, shift: i32) -> Option<Self> {
        if value == 0. {
            Some(self)
        } else {
            Self::stage(
                self.ends.map(|v| v + value),
                self.quantum.min(quantum(value)?),
                shift,
            )
        }
    }
    fn mul(self, rate: f32, shift: i32) -> Option<Self> {
        Self::stage(
            self.ends.map(|v| v * rate),
            self.quantum + quantum(rate)?,
            shift,
        )
    }
}

#[derive(Clone, Copy)]
struct Law {
    // Both operands are reflected so the separation is cap minus cube.
    cube: f32,
    cap: f32,
    rate: f32,
    face: f32,
    core: f32,
    radius: f32,
    margin: f32,
    // Bound on unrounded cap dt minus unrounded cube dt over this query.
    offset: Bound,
    driver_clock: Kernel,
    actor_clock: Kernel,
    start: Time,
    end: Time,
}
impl Law {
    fn clear_at(self, driver_dt: f32, actor_dt: f32) -> bool {
        let face = (self.cube + self.rate * driver_dt) + self.face;
        let center = self.cap + self.rate * actor_dt;
        let gap =
            |pole: f32| Bound::exact(f64::from(center + pole)).sub(Bound::exact(f64::from(face)));
        let local = gap(self.core - self.radius);
        let world = gap(self.core).sub(Bound::exact(f64::from(self.radius)));
        local.finite()
            && world.finite()
            && local.lo > f64::from(self.margin)
            && world.lo > f64::from(self.margin)
    }
    // A rounded lower bound can fall just outside an open cell. Resolve only
    // this cell at the first (or last) actual F64 observer key which owns it.
    fn exact_cell(self, t: f32, work: &mut Work) -> Result<bool, TrajectoryError> {
        let mut lo = self.start.to_bits();
        let mut hi = self.end.to_bits();
        let first = self.rate > 0.;
        while lo < hi {
            work.charge(24)?;
            let mid = lo + (hi - lo + u64::from(!first)) / 2;
            let native = self.driver_clock.local_delta(Time::from_bits(mid));
            if first {
                if native < t {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            } else if native > t {
                hi = mid - 1;
            } else {
                lo = mid;
            }
        }
        let at = Time::from_bits(lo);
        Ok(self.driver_clock.local_delta(at) != t
            || self.clear_at(t, self.actor_clock.local_delta(at)))
    }

    fn range(
        self,
        lo: u32,
        hi: u32,
        nodes: &mut usize,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        if *nodes == 0 {
            return Ok(false);
        }
        *nodes -= 1;
        work.charge(96)?;
        let dt = [lo, hi].map(f32::from_bits);
        if lo >> 23 != hi >> 23 {
            let mid = (((lo >> 23) + (hi >> 23)).div_ceil(2) << 23) - 1;
            return Ok(self.range(lo, mid, nodes, work)? && self.range(mid + 1, hi, nodes, work)?);
        }
        // Every represented cube dt is at most half a cell from its original
        // affine parameter. Bound the least favorable capsule coordinate.
        let step = grid(dt[1]);
        let half = Bound::exact(2_f64.powi(step - 1));
        let bound = if self.rate > 0. {
            self.offset.sub(half).lo
        } else {
            self.offset.add(half).hi
        };
        if !bound.is_finite() {
            return Ok(false);
        }
        // Quantize *outwards*. This makes dt+offset exactly representable in
        // F64 for every cell: the sum uses at most 49 aligned bits.
        let mag = (dt[1].abs() as f64).max(bound.abs());
        if mag > f64::from(f32::MAX) || grid(mag as f32) - step > 24 {
            return Ok(false);
        }
        let q = step.max(grid(mag as f32)) - 20;
        let unit = 2_f64.powi(q);
        let units = bound / unit;
        let offset = if self.rate > 0. {
            units.floor()
        } else {
            units.ceil()
        } * unit;
        let actor_dt = |v: f32| (f64::from(v) + offset) as f32;
        let cap_dt = dt.map(actor_dt);
        let cube_dt = Rounded {
            ends: dt,
            quantum: step,
        };
        let mut count = hi - lo + 1;
        if count > 16 {
            // A power-of-two stride in dt translates both unrounded products
            // by the same dyadic rate*stride. Test the operation's actual
            // binade and grid at every intermediate rounding stage.
            let mut period = None;
            for n in 0..=7 {
                work.charge(96)?;
                let time_shift = step + n;
                let distance_shift = time_shift + quantum(self.rate).unwrap();
                let actor = Rounded::stage(cap_dt, q.min(step), time_shift)
                    .and_then(|v| v.mul(self.rate, distance_shift))
                    .and_then(|v| v.add(self.cap, distance_shift));
                if cube_dt
                    .mul(self.rate, distance_shift)
                    .and_then(|v| v.add(self.cube, distance_shift))
                    .and_then(|v| v.add(self.face, distance_shift))
                    .is_some()
                    && actor.is_some_and(|v| {
                        v.add(self.core, distance_shift).is_some()
                            && v.add(self.core - self.radius, distance_shift).is_some()
                    })
                {
                    period = Some(n);
                    break;
                }
            }
            let Some(period) = period else {
                let mid = lo + (hi - lo) / 2;
                return Ok(
                    self.range(lo, mid, nodes, work)? && self.range(mid + 1, hi, nodes, work)?
                );
            };
            count = count.min(1 << period);
        }
        for i in 0..count {
            work.charge(48)?;
            let t = f32::from_bits(lo + i);
            if !self.clear_at(t, actor_dt(t)) {
                if count < hi - lo + 1 {
                    let mid = lo + (hi - lo) / 2;
                    return Ok(self.range(lo, mid, nodes, work)?
                        && self.range(mid + 1, hi, nodes, work)?);
                }
                if !self.exact_cell(t, work)? {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn separated(
    cube: Source,
    cap: Source,
    axis: usize,
    sign: f32,
    face: f32,
    core: f32,
    radius: f32,
    start: Time,
    end: Time,
    margin: f32,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let (Some(b), Some(a)) = (cube.clock, cap.clock) else {
        return Ok(false);
    };
    let rate = sign * cap.velocity[axis];
    if rate != sign * cube.velocity[axis] || quantum(rate).is_none() || super::same_clock(a, b) {
        return Ok(false);
    }
    work.charge(256)?;
    let scale = |k: Kernel| {
        let v = f64::from(k.native.integration_seconds) / k.domain.duration();
        Bound {
            lo: v.next_down(),
            hi: v.next_up(),
        }
    };
    // Keep the common affine variable: (t-B)*(sa-sb) + (B-A)*sa.
    let sa = scale(a);
    let span = Bound { lo: start, hi: end }.sub(Bound::exact(b.domain.start));
    let offset = span.mul(sa.sub(scale(b))).add(
        Bound::exact(b.domain.start)
            .sub(Bound::exact(a.domain.start))
            .mul(sa),
    );
    // Original F64 subtraction, division and multiplication precede the
    // final F32 clocks. All in-domain fractions lie in [0,1].
    let e = 8.
        * f64::EPSILON
        * (f64::from(a.native.integration_seconds) + f64::from(b.native.integration_seconds));
    let offset = offset.add(Bound { lo: -e, hi: e });
    if !offset.finite() {
        return Ok(false);
    }
    let law = Law {
        cube: sign * cube.origin[axis],
        cap: sign * cap.origin[axis],
        rate,
        face: sign * face,
        core: sign * core,
        radius,
        margin,
        offset,
        driver_clock: b,
        actor_clock: a,
        start,
        end,
    };
    law.range(
        b.local_delta(start).to_bits(),
        b.local_delta(end).to_bits(),
        &mut 1024,
        work,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::solver_trajectory::Domain;
    use rapier3d::prelude as rp;

    #[test]
    fn rebase_on_a_finer_native_clock_preserves_the_original_capsule_clearance() {
        let end = 0.05000000074505806;
        let source = |start, h, x| {
            let velocity = rp::Vector::X * -62.;
            let origin = rp::Vector::X * x;
            let k = Kernel::from_velocity_seconds(
                rp::RigidBodyHandle::invalid(),
                Domain::new(start, end).unwrap(),
                h,
                rp::Pose::from_translation(origin),
                velocity,
                rp::Vector::ZERO,
            )
            .unwrap();
            Source {
                clock: Some(k),
                origin,
                velocity,
                com: [origin, k.native.motion.end.translation],
            }
        };
        let cube = source(0.02500000037252903, 0.025, 1.65);
        let cap = source(0.04629400093108415, 0.0037059998, -0.18022804);
        let mut work = Work {
            used: 0,
            limit: 1_000_000,
        };
        let test = |margin, work: &mut Work| {
            separated(
                cube,
                cap,
                0,
                -1.,
                -0.25,
                0.,
                0.25,
                0.04629401396960021,
                0.04966666642576456,
                margin,
                work,
            )
            .unwrap()
        };
        assert!(test(0.009999863, &mut work));
        assert!(!test(0.010001, &mut work));
    }
}
