//! Bound the capsule relative to the box face that supplies its original
//! position. All cancellation is between operands of the same Native kernel.
use super::super::correlated_linear::{identity_frame, identity_rotation, same_kernel};
use super::*;
use rapier3d::parry::shape::{Capsule, Cuboid};

#[allow(clippy::too_many_arguments)]
pub(super) fn prefix(
    cube: ShapeMotion,
    cap: ShapeMotion,
    box_shape: &Cuboid,
    capsule: &Capsule,
    normal: rp::Vector,
    start: Time,
    end: Time,
    clearance: f32,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<FacePrefix>, TrajectoryError> {
    let (
        Curve::Integrated(driver),
        Curve::Anchored {
            carrier,
            anchor,
            offset,
            linear_velocity,
            rotation,
        },
    ) = (cube.curve, cap.curve)
    else {
        return Ok(None);
    };
    let Some(axis) = (0..3).find(|&i| normal[i].abs() == 1.) else {
        return Ok(None);
    };
    let sign = normal[axis];
    let face = sign * box_shape.half_extents[axis];
    let a = capsule.segment.a;
    let b = capsule.segment.b;
    let axial_support = a[axis] != b[axis] && (0..3).all(|i| i == axis || a[i] == b[i]);
    let core = if sign * a[axis] <= sign * b[axis] {
        a[axis]
    } else {
        b[axis]
    };
    let pole = core - sign * capsule.radius;
    let relative = sign * linear_velocity[axis];
    if !linear_velocity.is_finite()
        || (relative < 0. && !axial_support)
        || !same_kernel(driver, carrier)
        || !identity_frame(cap)
        || !identity_rotation(rotation)
        || !anchor.is_finite()
        || !offset.is_finite()
        || !box_shape.half_extents.is_finite()
        || box_shape.half_extents.min_element() < 0.
        || !capsule.radius.is_finite()
        || capsule.radius < 0.
        || !a.is_finite()
        || !b.is_finite()
    {
        return Ok(None);
    }
    let Some(source) = Source::new(cube, start, end, work)? else {
        return Ok(None);
    };
    let axis_coords = |v: [rp::Vector; 2]| v.map(|p| p[axis]);
    let carrier_coords = axis_coords(source.com);
    let coordinates = carrier_coords.map(|v| sign * v);
    let signed_face = sign * face;
    let signed_anchor = sign * anchor[axis];
    let original_basis = anchor[axis] == face || anchor[axis] == face - pole;
    let shared_face = if !original_basis && relative >= 0. {
        work.charge(256)?;
        shared_rounded_face(signed_face, signed_anchor, coordinates)
    } else {
        None
    };
    // A cardinal segment parallel to the face has the same core and local
    // pole on its whole length. Both radius graphs therefore use the same
    // scalar Gap when the relative face-axis drift is zero.
    let parallel_axis = (0..3).find(|&i| a[i] != b[i]);
    let stationary_side = relative == 0.
        && parallel_axis.is_some_and(|i| i != axis && (0..3).all(|j| j == i || a[j] == b[j]))
        && (0..3).all(|i| i == axis || normal[i] == 0.);
    if !axial_support && !original_basis && shared_face.is_none() && !stationary_side {
        return Ok(None);
    }
    let scan_cells = relative < 0. || (relative > 0. && !original_basis && shared_face.is_none());
    let (proof_face, proof_anchor, coordinates) = shared_face.map_or(
        (signed_face, signed_anchor, coordinates),
        |(delta, face_coords)| (0., delta, face_coords),
    );
    work.charge(1024)?;
    let products = [start, end].map(|t| {
        let dt = (t - carrier.domain.start).clamp(0., carrier.domain.duration()) as f32;
        linear_velocity * dt
    });
    let inner = source.com.map(|v| v + anchor);
    let bases = inner.map(|v| v + offset);
    if inner
        .iter()
        .chain(&bases)
        .chain(&products)
        .any(|v| !v.is_finite())
    {
        return Ok(None);
    }
    let centers = [
        bases[0].min(bases[1]) + products[0].min(products[1]),
        bases[0].max(bases[1]) + products[0].max(products[1]),
    ];
    if centers.iter().any(|p| !p.is_finite())
        || !finite_shape(
            source,
            [-box_shape.half_extents, box_shape.half_extents],
            0.,
        )
        || !finite_shape(
            Source {
                com: centers,
                ..source
            },
            [a.min(b), a.max(b)],
            capsule.radius,
        )
    {
        return Ok(None);
    }
    // The full shape images above still check the tangential coordinates
    // for finite values. Only the face-axis terms enter the separation gap.
    let law = Gap {
        face: proof_face,
        anchor: proof_anchor,
        offset: sign * offset[axis],
        drift: sign * products[0][axis],
        core: sign * core,
        radius: capsule.radius,
        clearance,
    };
    if scan_cells {
        let mut probe = Work {
            used: 0,
            limit: (work.limit - work.used).min(8 * 1024 * 1024),
        };
        let result = translating_prefix(
            source, axis, sign, relative, law, start, end, tolerance, &mut probe,
        );
        work.charge(probe.used)?;
        return match result {
            Err(TrajectoryError::WorkLimit) => Ok(None),
            other => other,
        };
    }
    let c = axis_coords(centers);
    let f = |x: f32| Bound::exact(f64::from(x));
    // When both additions use the same face, their rounded results cancel.
    // For a radius-shifted face retain both errors, including any binade crossing.
    let mut base = f(sign * anchor[axis])
        .sub(f(sign * face))
        .add(f(sign * offset[axis]));
    if anchor[axis] != face {
        let (Some(ea), Some(eb)) = (
            add_error(carrier_coords, anchor[axis]),
            add_error(carrier_coords, face),
        ) else {
            return Ok(None);
        };
        base = base.sub(Bound::exact(ea)).sub(Bound::exact(eb));
    }
    let (Some(offset_error), Some(core_error), Some(pole_error)) = (
        add_error(axis_coords(inner), offset[axis]),
        add_error(c, core),
        add_error(c, pole),
    ) else {
        return Ok(None);
    };
    base = base.sub(Bound::exact(offset_error));
    if linear_velocity[axis] != 0. {
        let Some(error) = half_ulp(c) else {
            return Ok(None);
        };
        base = base
            .add(f(sign * products[0][axis]))
            .sub(Bound::exact(error));
    }
    let local = base.add(f(sign * pole)).sub(Bound::exact(pole_error));
    let world = base
        .add(f(sign * core))
        .sub(Bound::exact(core_error))
        .sub(f(capsule.radius));
    if local.finite()
        && world.finite()
        && local.lo > f64::from(clearance)
        && world.lo > f64::from(clearance)
    {
        return Ok(Some(FacePrefix::Separated));
    }
    if relative == 0.
        && !original_basis
        && ((shared_face.is_none() && axial_support) || stationary_side)
        && !start.is_sign_negative()
        && coordinates[0] != coordinates[1]
    {
        // A stationary face-axis offset can still re-enter the skin at a
        // rounding tie. Search the driver's original coordinate image before
        // narrowing a real clock boundary. Tangential motion stays in the
        // original shapes for the caller's contact observation.
        let mut trial = Work {
            used: 0,
            limit: ((work.limit - work.used) / 2).min(1024 * 1024),
        };
        let result = law.first_threshold(coordinates, 12, &mut trial);
        work.charge(trial.used)?;
        match result {
            Ok(Coordinates::Clear) => return Ok(Some(FacePrefix::Separated)),
            Ok(Coordinates::Threshold(x)) if x != coordinates[0] => {
                let ascending = coordinates[0] < coordinates[1];
                let coordinate = |bits| {
                    let p = sign
                        * (source.origin[axis]
                            + source.velocity[axis] * driver.local_delta(Time::from_bits(bits)));
                    if shared_face.is_some() {
                        p + signed_face
                    } else {
                        p
                    }
                };
                let (mut low, mut high) = (start.to_bits(), end.to_bits());
                while high - low > 1 {
                    work.charge(32)?;
                    let mid = low + (high - low) / 2;
                    let before = if ascending {
                        coordinate(mid) < x
                    } else {
                        coordinate(mid) > x
                    };
                    if before {
                        low = mid;
                    } else {
                        high = mid;
                    }
                }
                let (safe_time, hit_time) = (Time::from_bits(low), Time::from_bits(high));
                if !law.clear(coordinate(high)) && hit_time - safe_time <= tolerance {
                    if stationary_side {
                        // A projected crossing can be outside the finite face.
                        // Admit the boundary only when an actual side point
                        // and an interior point on that face share the two
                        // tangent coordinates in the original F32 transforms.
                        work.charge(384)?;
                        let pa = cube.metered_pose(hit_time, work)?;
                        let pb = cap.metered_pose(hit_time, work)?;
                        let mut core = a;
                        if let Some(i) = parallel_axis {
                            core[i] = a[i].midpoint(b[i]);
                        }
                        let capsule_point = pb * core;
                        let mut local = capsule_point - pa.translation;
                        local[axis] = face;
                        let face_point = pa * local;
                        core[axis] -= sign * capsule.radius;
                        let pole = pb * core;
                        let axis_distance = |value| {
                            let d = f(value).sub(f(face_point[axis]));
                            d.lo.abs().max(d.hi.abs())
                        };
                        let local_gap = axis_distance(pole[axis]);
                        let world_gap =
                            Bound::exact(axis_distance(capsule_point[axis])).sub(f(capsule.radius));
                        if !pole.is_finite()
                            || !(local_gap < f64::from(clearance)
                                || world_gap.hi < f64::from(clearance))
                            || !local.is_finite()
                            || !face_point.is_finite()
                            || !(0..3).all(|i| {
                                i == axis
                                    || (local[i].abs() < box_shape.half_extents[i]
                                        && face_point[i] == capsule_point[i])
                            })
                        {
                            return Ok(Some(FacePrefix::Through(safe_time)));
                        }
                    }
                    return Ok(Some(FacePrefix::Boundary {
                        safe_time,
                        hit_time,
                        witness: None,
                    }));
                }
                // The Native coordinate may jump over the candidate residue.
                // Only the actually proved chronological prefix is available.
                return Ok(Some(FacePrefix::Through(safe_time)));
            }
            Err(TrajectoryError::WorkLimit) | Ok(_) => return Ok(None),
            Err(error) => return Err(error),
        }
    }
    let clear = if original_basis || shared_face.is_some() {
        law.coordinate_range(coordinates, work)?
    } else {
        // The raw translation can have a much finer grid than the face.
        // Bound this optional proof and leave work for the ordinary cast.
        let mut trial = Work {
            used: 0,
            limit: ((work.limit - work.used) / 2).min(48 * 1024),
        };
        let result = law.coordinate_range(coordinates, &mut trial);
        work.charge(trial.used)?;
        match result {
            Err(TrajectoryError::WorkLimit) => false,
            other => other?,
        }
    };
    Ok(clear.then_some(FacePrefix::Separated))
}

#[allow(clippy::too_many_arguments)]
fn translating_prefix(
    source: Source,
    axis: usize,
    sign: f32,
    relative: f32,
    law: Gap,
    start: Time,
    end: Time,
    tolerance: Time,
    work: &mut Work,
) -> Result<Option<FacePrefix>, TrajectoryError> {
    let Some(clock) = source.clock else {
        return Ok(None);
    };
    if start.is_sign_negative() || source.velocity[axis] == 0. {
        return Ok(None);
    }
    let coordinate =
        |at: Time| sign * (source.origin[axis] + source.velocity[axis] * clock.local_delta(at));
    // When both effects close the gap within a fixed anchor cell, the box
    // face only contributes another monotone term.
    let closing = relative < 0. && sign * source.velocity[axis] > 0.;
    let cell_at = |at| {
        let x = coordinate(at);
        [if closing { 0. } else { x + law.face }, x + law.anchor]
    };
    let cell_end = |from, until, work: &mut Work| {
        let until = if closing {
            until
        } else {
            let Some(last) =
                shared_clock_faces::face_end(source, axis, sign * law.face, from, until, work)?
            else {
                return Ok(None);
            };
            Time::from_bits(last)
        };
        shared_clock_faces::face_end(source, axis, sign * law.anchor, from, until, work)
    };
    let step_at = |at: Time| {
        let dt = (at - clock.domain.start).clamp(0., clock.domain.duration()) as f32;
        Gap {
            drift: relative * dt,
            ..law
        }
    };
    let clear_at = |at: Time, work: &mut Work| {
        work.charge(64)?;
        Ok(step_at(at).clear(coordinate(at)))
    };
    if !clear_at(start, work)? {
        return Ok(None);
    }
    let scan_end = if relative > 0. {
        // A separating correction may start exactly at a rounding tie.
        // Verify its complete later image using the minimum outward step,
        // then enumerate the actual cells in the short remaining prefix.
        let near = (start + 32. * tolerance).min(end);
        if near < end
            && !step_at(near).coordinate_range([coordinate(near), coordinate(end)], work)?
        {
            return Ok(None);
        }
        near
    } else {
        end
    };
    let (mut low, mut high) = match first_closed_face_cell(
        start,
        scan_end,
        16 * 1024,
        cell_at,
        cell_end,
        clear_at,
        work,
    )? {
        FaceSearch::Clear => return Ok(Some(FacePrefix::Separated)),
        FaceSearch::Incomplete(last) => {
            return Ok(Some(FacePrefix::Through(Time::from_bits(last))))
        }
        FaceSearch::Boundary(low, high) => (low, high),
    };
    while high - low > 1 {
        let mid = low + (high - low) / 2;
        if clear_at(Time::from_bits(mid), work)? {
            low = mid;
        } else {
            high = mid;
        }
    }
    let safe = Time::from_bits(low);
    let hit = Time::from_bits(high);
    Ok((hit - safe <= tolerance).then_some(FacePrefix::Boundary {
        safe_time: safe,
        hit_time: hit,
        witness: None,
    }))
}

fn shared_rounded_face(face: f32, anchor: f32, coordinates: [f32; 2]) -> Option<(f32, [f32; 2])> {
    let face_range = coordinates.map(|t| t + face);
    let anchor_range = coordinates.map(|t| t + anchor);
    let step = grid(face_range[0]);
    if face_range.into_iter().chain(anchor_range).any(|v| {
        !v.is_normal()
            || v.is_sign_negative() != face_range[0].is_sign_negative()
            || grid(v) != step
            || grid(v.next_up()) != step
            || grid(v.next_down()) != step
    }) {
        return None;
    }
    let delta = anchor - face;
    let exact = Bound::exact(f64::from(anchor)).sub(Bound::exact(f64::from(face)));
    let periods = f64::from(delta) / 2_f64.powi(step + 1);
    if !exact.is_exact(f64::from(delta)) || periods.fract() != 0. {
        return None;
    }
    // Both rounded sums remain on the same uniform grid. An even shift
    // preserves ties-to-even, so the rounded anchor is the face plus delta.
    Some((delta, face_range))
}

/// Values differ from the first by precisely the original driver's coordinate
/// shift. Its minimum lattice step survives an exact cancellation, even when
/// the result crosses zero and its *own* F32 spacing is much finer.
#[derive(Clone, Copy)]
struct Shift {
    values: [f32; 2],
    grid: i32,
}
impl Shift {
    fn add(self, constant: f32, driver_step: i32) -> Option<Self> {
        if constant == 0. {
            return Some(self);
        }
        let values = self.values.map(|v| v + constant);
        if !values.iter().all(|v| v.is_finite()) {
            return None;
        }
        let input_step = self.grid.min(quantum(constant)?);
        let largest = grid(values[0].abs().max(values[1].abs()));
        if input_step >= largest {
            return Some(Self {
                values,
                grid: input_step,
            });
        }
        // The entire rounded output lies strictly inside one binade. An even
        // shift of its uniform grid preserves all ties of the original add.
        if driver_step <= largest
            || values[0].is_sign_negative() != values[1].is_sign_negative()
            || values.iter().any(|&v| {
                v == 0.
                    || grid(v) != largest
                    || grid(v.next_up()) != largest
                    || grid(v.next_down()) != largest
            })
        {
            return None;
        }
        Some(Self {
            values,
            grid: largest,
        })
    }
}

#[derive(Clone, Copy)]
struct Gap {
    face: f32,
    anchor: f32,
    offset: f32,
    drift: f32,
    core: f32,
    radius: f32,
    clearance: f32,
}
enum Coordinates {
    Clear,
    Threshold(f32),
    Incomplete,
}

impl Gap {
    fn coordinate_range(
        self,
        coordinates: [f32; 2],
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        Ok(matches!(
            self.first_threshold(coordinates, 5, work)?,
            Coordinates::Clear
        ))
    }

    fn first_threshold(
        self,
        coordinates: [f32; 2],
        max_shift: i32,
        work: &mut Work,
    ) -> Result<Coordinates, TrajectoryError> {
        let order = |v: f32| {
            let bits = v.to_bits();
            if bits >> 31 == 0 {
                bits ^ 0x8000_0000
            } else {
                !bits
            }
        };
        let keys = coordinates.map(order);
        self.range(
            keys[0].min(keys[1]),
            keys[0].max(keys[1]),
            keys[0] > keys[1],
            max_shift,
            &mut 64,
            work,
        )
    }

    fn binades(self, driver: f32) -> [u32; 7] {
        let anchor = driver + self.anchor;
        let offset = anchor + self.offset;
        let com = offset + self.drift;
        [
            driver,
            driver + self.face,
            anchor,
            offset,
            com,
            com + self.core,
            com + (self.core - self.radius),
        ]
        .map(|value| {
            let bits = value.to_bits();
            // A boundary can have a different spacing on either side.
            let position = match bits & 0x007f_ffff {
                0 => 0,
                0x007f_ffff => 2,
                _ => 1,
            };
            (bits & 0xff80_0000) | position
        })
    }

    fn clear(self, t: f32) -> bool {
        let top = t + self.face;
        let com = ((t + self.anchor) + self.offset) + self.drift;
        let f = |v: f32| Bound::exact(f64::from(v));
        let world = f(com + self.core).sub(f(top)).sub(f(self.radius));
        let local = f(com + (self.core - self.radius)).sub(f(top));
        local.finite()
            && world.finite()
            && local.lo > f64::from(self.clearance)
            && world.lo > f64::from(self.clearance)
    }

    // On one driver binade, every original F32 coordinate belongs to one
    // of these residue classes. All descendants shift by exactly the same
    // period. Near a binade edge retain both child intervals.
    fn period(self, values: [f32; 2], max_shift: i32) -> Option<u32> {
        let [x, y] = values;
        if x == 0. || y == 0. || x.to_bits() >> 23 != y.to_bits() >> 23 {
            return None;
        }
        let step = grid(x);
        let reference = Shift { values, grid: step };
        for shift in step..=step + max_shift {
            let actor = reference
                .add(self.anchor, shift)
                .and_then(|v| v.add(self.offset, shift))
                .and_then(|v| v.add(self.drift, shift));
            if reference.add(self.face, shift).is_some()
                && actor.is_some_and(|v| {
                    v.add(self.core, shift).is_some()
                        && v.add(self.core - self.radius, shift).is_some()
                })
            {
                return Some(1 << (shift - step));
            }
        }
        None
    }

    fn range(
        self,
        lo: u32,
        hi: u32,
        descending: bool,
        max_shift: i32,
        remaining: &mut usize,
        work: &mut Work,
    ) -> Result<Coordinates, TrajectoryError> {
        if *remaining == 0 {
            return Ok(Coordinates::Incomplete);
        }
        *remaining -= 1;
        work.charge(320)?;
        let value = |k: u32| f32::from_bits(if k >> 31 == 0 { !k } else { k ^ 0x8000_0000 });
        let span = hi - lo;
        let count = if span < 8 {
            span + 1
        } else if let Some(period) = self.period([value(lo), value(hi)], max_shift) {
            period.min(span + 1)
        } else {
            let first = self.binades(value(lo));
            let mid = if first != self.binades(value(hi)) {
                // Each stage is monotone in the driver coordinate. Find
                // the first change of spacing instead of repeatedly
                // subdividing across that same rounding boundary.
                let (mut left, mut right) = (lo, hi);
                while right - left > 1 {
                    work.charge(48)?;
                    let middle = left + (right - left) / 2;
                    if self.binades(value(middle)) == first {
                        left = middle;
                    } else {
                        right = middle;
                    }
                }
                left
            } else {
                lo + span / 2
            };
            let [first, next] = if descending {
                [(mid + 1, hi), (lo, mid)]
            } else {
                [(lo, mid), (mid + 1, hi)]
            };
            return match self.range(first.0, first.1, descending, max_shift, remaining, work)? {
                Coordinates::Clear => {
                    self.range(next.0, next.1, descending, max_shift, remaining, work)
                }
                stopped => Ok(stopped),
            };
        };
        for i in 0..count {
            work.charge(64)?;
            let x = value(if descending { hi - i } else { lo + i });
            if !self.clear(x) {
                return Ok(Coordinates::Threshold(x));
            }
        }
        Ok(Coordinates::Clear)
    }
}
