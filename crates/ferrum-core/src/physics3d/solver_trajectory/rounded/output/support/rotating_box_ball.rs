//! Full-shape separation for an integrated cuboid against a stationary sphere.
//! The moving face proof encloses both radius paths and preserves the common
//! Native time in the projection when its rounded coefficients permit it.
use super::*;
mod face_cells;
mod face_clock;
mod product_bias;
mod projected_face;
mod sphere_cells;
mod translating_capsule;
pub(in crate::physics3d::solver_trajectory::rounded::output) use translating_capsule::{
    fixed_wall_overlap, fixed_wall_separated, fixed_wall_time_hint,
};

// Test the same moving box face at every represented time. For a real
// quaternion q, R(q) scales by s=|q|². Thus n=R(q)*e_i has length s, and the
// ideal face support relative to the box origin is s²*h_i. Bound the errors
// of the original scalar transform over the complete box and ball hulls.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded::output) fn rotating_box_ball_face(
    frames: &Frames,
    cuboid: &rp::Cuboid,
    ball_frames: &Frames,
    ball: &rp::Ball,
    direction: rp::Vector,
    clearance: f32,
    context: Context<'_>,
    clock: bool,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(512 + (frames.len + ball_frames.len) as u64 * 64)?;
    if frames.len == 0
        || ball_frames.len == 0
        || !direction.is_finite()
        || !cuboid.half_extents.is_finite()
        || !ball.radius.is_finite()
        || cuboid.half_extents.min_element() < 0.
        || ball.radius < 0.
    {
        return Ok(false);
    }
    rotating_round_face(
        frames,
        cuboid,
        union(ball_frames),
        ball,
        direction,
        clearance,
        context,
        None,
        clock,
        work,
    )
}

#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory) fn rotating_box_clock_times(
    cube: ShapeMotion,
    cuboid: &rp::Cuboid,
    target: ShapeMotion,
    ball: &rp::Ball,
    start: Time,
    end: Time,
    clearance: f32,
    work: &mut Work,
    mut visit: impl FnMut(Time, &mut Work) -> Result<bool, TrajectoryError>,
) -> Result<(), TrajectoryError> {
    let q = cube.metered_pose(start, work)?.rotation.to_array();
    let pivot = (0..3)
        .max_by(|&a, &b| q[a].abs().total_cmp(&q[b].abs()))
        .unwrap_or(0);
    let c = Context {
        a: cube,
        sa: cuboid,
        b: target,
        sb: ball,
        start,
        end,
        clearance,
    };
    let _ = face_clock::rows(c, pivot, work, |at, _, work| visit(at, work))?;
    Ok(())
}

#[derive(Clone, Copy)]
struct CapsuleSlab {
    axis: usize,
    translation: Float,
    core: Float,
}

fn target_value(frame: Frame, slab: Option<CapsuleSlab>, i: usize, radial: Float) -> Value {
    let radial = Value {
        error: if radial.lo == radial.hi {
            0.
        } else {
            let r = radial.lo.abs().max(radial.hi.abs());
            half_ulp(Float::exact(r.next_down()))
        },
        ..Value::input(radial)
    };
    let Some(slab) = slab.filter(|slab| slab.axis == i) else {
        return radial.add(Value::input(frame.translation[i]));
    };
    let shift = Value::input(slab.translation);
    let core = Value::input(slab.core);
    let actual = slab.core.add(radial.actual);
    let local = Value {
        actual,
        ideal: core.ideal.add(radial.ideal),
        error: half_ulp(actual),
    }
    .add(shift);
    let world = core.add(shift).add(radial);
    Value {
        actual: Float::span(
            local.actual.lo.min(world.actual.lo),
            local.actual.hi.max(world.actual.hi),
        ),
        ideal: local.ideal,
        error: local.error.max(world.error),
    }
}

#[allow(clippy::too_many_arguments)]
fn rotating_round_face(
    frames: &Frames,
    cuboid: &rp::Cuboid,
    ball_frame: Frame,
    ball: &rp::Ball,
    direction: rp::Vector,
    clearance: f32,
    context: Context<'_>,
    slab: Option<CapsuleSlab>,
    clock: bool,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let evaluate = |frame, work: &mut Work| {
        rotating_box_ball_face_frame(
            frame, cuboid, ball_frame, ball, direction, clearance, context, slab, clock, work,
        )
    };
    let test = |frame: Frame, work: &mut Work| {
        if evaluate(frame, work)? {
            return Ok(true);
        }
        let cube = if context.sa.as_cuboid().is_some() {
            context.a
        } else {
            context.b
        };
        if slab.is_some() || cube.is_single_axis_spin() {
            return Ok(false);
        }
        let q = frame.rotation.components;
        let axis = (0..3)
            .max_by(|&a, &b| {
                q[a].lo
                    .abs()
                    .max(q[a].hi.abs())
                    .total_cmp(&q[b].lo.abs().max(q[b].hi.abs()))
            })
            .unwrap_or(0);
        let (Some(spins), Some(scalars)) = (q[axis].image(), q[3].image()) else {
            return Ok(false);
        };
        if spins.len * scalars.len <= 1 {
            return Ok(false);
        }
        for &spin in &spins.values[..spins.len] {
            for &scalar in &scalars.values[..scalars.len] {
                let mut f = frame;
                f.rotation.exact = None;
                f.rotation.components[axis] = Float::exact(spin);
                f.rotation.components[3] = Float::exact(scalar);
                if !evaluate(f, work)? {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    };
    if test(union(frames), work)? {
        return Ok(true);
    }
    if !(2..=4).contains(&frames.len) {
        return Ok(false);
    }
    for &frame in &frames.values[..frames.len] {
        if !test(frame, work)? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[allow(clippy::too_many_arguments)]
fn rotating_box_ball_face_frame(
    box_frame: Frame,
    cuboid: &rp::Cuboid,
    ball_frame: Frame,
    ball: &rp::Ball,
    direction: rp::Vector,
    clearance: f32,
    context: Context<'_>,
    slab: Option<CapsuleSlab>,
    clock: bool,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    let q = ball_frame.rotation.components;
    if (0..3).any(|i| !exact_value(q[i], 0.)) || !exact_value(q[3], 1.) {
        return Ok(false);
    }
    let q = box_frame.rotation.components;
    if (0..3).all(|i| exact_value(q[i], 0.)) {
        return Ok(false);
    }
    work.charge(1536)?; // one full box/ball hull and three axis nominations
    let reference = box_frame.rotation;
    let (axis, sign) = [rp::Vector::X, rp::Vector::Y, rp::Vector::Z]
        .into_iter()
        .enumerate()
        .map(|(i, n)| {
            let n = reference.vector(n);
            let n = rp::Vector::from_array(n.map(|v| v.lo));
            (i, n.dot(direction))
        })
        .max_by(|a, b| a.1.abs().total_cmp(&b.1.abs()))
        .ok_or(TrajectoryError::InvalidReference)?;
    if !sign.is_finite() || sign == 0. {
        return Ok(false);
    }
    let projected_frame = if slab.is_none() {
        projected_face::reduce(
            box_frame,
            ball_frame,
            cuboid.half_extents,
            ball.radius,
            clearance,
            axis,
            sign.signum(),
            context,
            work,
        )?
    } else {
        None
    };
    let box_frame = projected_frame.map_or(box_frame, |(frame, _)| frame);
    let q = box_frame.rotation.components;
    let ideal = IdealTransform::new(Frame {
        translation: [Float::ZERO; 3],
        ..box_frame
    });
    let mut local_normal = rp::Vector::ZERO;
    local_normal[axis] = sign.signum();
    let pivot = (0..3).find(|&i| {
        i != axis && !exact_value(q[i], 0.) && (0..3).all(|j| j == i || exact_value(q[j], 0.))
    });
    let planar = pivot.map(|pivot| {
        let tangent = 3 - pivot - axis;
        let orientation = if (pivot + 1) % 3 == axis { 1. } else { -1. };
        let scale = Value::input(q[3].mul(q[3]).sub(q[pivot].mul(q[pivot])));
        let spin = Value::input(q[pivot]);
        let twice_w = Value::input(q[3]).mul(Value::input(Float::exact(2.)));
        let signed = Bound::exact(f64::from(sign.signum()));
        let mut n = [Bound::exact(0.); 3];
        n[axis] = scale.ideal.mul(signed);
        n[tangent] = spin
            .ideal
            .mul(twice_w.ideal)
            .mul(Bound::exact(orientation))
            .mul(signed);
        let squared = n[axis].mul(n[axis]).add(n[tangent].mul(n[tangent]));
        (
            tangent,
            orientation as f32,
            scale,
            spin,
            twice_w,
            n,
            squared,
        )
    });
    let (n, squared, magnitude_n) = if let Some((_, _, _, _, _, n, squared)) = planar {
        (n, squared, squared.sqrt())
    } else {
        let scale = ideal
            .q
            .into_iter()
            .fold(Bound::exact(0.), |a, q| a.add(q.mul(q)));
        (ideal.point(local_normal), scale.mul(scale), scale)
    };
    if !magnitude_n.finite() || magnitude_n.lo <= 0. || n.iter().any(|x| !x.finite()) {
        return Ok(false);
    }
    let box_values = transform(
        box_frame,
        cuboid
            .half_extents
            .to_array()
            .map(|half| Value::input(Float::span(-half, half))),
    );
    let ball_values = std::array::from_fn::<_, 3, _>(|i| {
        let r = ball.radius;
        let toward_box = if n[i].lo >= 0. {
            Float::span(-r, 0.)
        } else if n[i].hi <= 0. {
            Float::span(0., r)
        } else {
            Float::span(-r, r)
        };
        target_value(ball_frame, slab, i, toward_box)
    });
    let ball_centers: [Bound; 3] = std::array::from_fn(|i| {
        if let Some(slab) = slab.filter(|slab| slab.axis == i) {
            Value::input(slab.translation)
                .ideal
                .add(Value::input(slab.core).ideal)
        } else {
            Value::input(ball_frame.translation[i]).ideal
        }
    });
    // With identity rotation, replacing an away-facing local coordinate
    // with zero leaves a point in the ball and can only lower the projected
    // rounded world output. The half-hull covers every remaining minimum.
    if box_values.iter().chain(&ball_values).any(|v| !v.finite())
        || ball_frame
            .translation
            .into_iter()
            .any(|core| !world_radius_range(core, ball.radius).finite())
    {
        return Ok(false);
    }
    // When the side face is perpendicular to a pure spin axis, both
    // projected coordinates are monotone toward that face. Use the shared
    // rounded diagonal as the exact coefficient in the proof; the real
    // comparison plane remains orthogonal to the ideal tangent with that
    // same coefficient. No actual multiply/add is regrouped.
    let mut box_error = box_values.map(|v| v.error);
    let mut box_origin = box_frame.translation.map(|t| Value::input(t).ideal);
    let mut direct_box_error = box_error;
    let mut face_cells = None;
    if let Some((tangent, orientation, scale, spin, twice_w, _, _)) = planar {
        work.charge(1024)?;
        let h = cuboid.half_extents;
        let flip = Value::input(Float::exact(orientation));
        let rotate_slab = |local: Float, along: Float| {
            let local = Value::input(local);
            let along = Value::input(along);
            let x = along.mul(spin).mul(flip).mul(twice_w);
            let y = local.mul(spin).mul(flip).mul(twice_w);
            [
                face_difference(local.mul(scale), x),
                along.mul(scale).add(y),
            ]
        };
        let full = rotate_slab(
            Float::span(-h[axis], h[axis]),
            Float::span(-h[tangent], h[tangent]),
        );
        let full = [
            full[0].add(Value::input(box_frame.translation[axis])),
            full[1].add(Value::input(box_frame.translation[tangent])),
        ];
        if full.iter().any(|v| !v.finite()) {
            return Ok(false);
        }
        let delta: [Bound; 3] = std::array::from_fn(|i| {
            ball_centers[i].sub(Value::input(box_frame.translation[i]).ideal)
        });
        let mut errors = [0.; 3];
        for (j, i) in [axis, tangent].into_iter().enumerate() {
            let sphere = target_value(ball_frame, slab, i, Float::span(-ball.radius, ball.radius));
            errors[i] = upper_add(full[j].error, sphere.error);
        }
        let mut along = [Bound::exact(0.); 3];
        along[tangent] = scale.ideal;
        along[axis] = negate(
            spin.ideal
                .mul(twice_w.ideal)
                .mul(Bound::exact(f64::from(orientation))),
        );
        let projection = |n: [Bound; 3]| {
            n.into_iter()
                .zip(delta)
                .fold(Bound::exact(0.), |d, (axis, x)| d.add(axis.mul(x)))
        };
        let error = |n: [Bound; 3]| {
            n.into_iter().zip(errors).fold(0., |e, (axis, v)| {
                upper_add(e, upper_mul(magnitude(axis), v))
            })
        };
        let side_gap = projection(n)
            .sub(squared.mul(Bound::exact(f64::from(h[axis]))))
            .sub(Bound::exact(error(n)));
        // The normal and tangent are orthogonal and have the same squared
        // length. Subtract rounding errors in each of these directions before
        // comparing with the original radial disk plus clearance. The pivot
        // coordinate is perpendicular to both projections.
        let usable_radius =
            Bound::exact(f64::from(ball.radius)).add(Bound::exact(f64::from(clearance)));
        let max_distance = usable_radius.mul(usable_radius).mul(squared);
        let other_gap = projection(along);
        let tangent_error = Bound::exact(error(along));
        let cull = |split: f32, left: bool| {
            let edge = squared.mul(Bound::exact(f64::from(split)));
            let direct = if left {
                other_gap.sub(edge)
            } else {
                edge.sub(other_gap)
            };
            let lateral = Bound::exact(direct.sub(tangent_error).lo.max(0.));
            let normal = Bound::exact(side_gap.lo.max(0.));
            let distance = lateral.mul(lateral).add(normal.mul(normal));
            max_distance.finite() && usable_radius.lo >= 0. && distance.lo > max_distance.hi
        };
        let along = cull_ball_tangent_slabs(
            box_frame,
            ball_frame,
            h,
            tangent,
            ball.radius,
            clearance,
            context,
            slab,
            projected_frame.map(|(_, pivot)| pivot),
            work,
            cull,
        )?;
        if projected_frame.is_some() {
            face_cells = Some((
                tangent,
                orientation,
                along,
                scale.actual,
                spin.actual,
                twice_w.actual,
                [errors[axis], errors[tangent]],
            ));
        }
        let Some(ledger) = FaceLedger::new(
            box_frame,
            axis,
            tangent,
            h[axis] * sign.signum(),
            along,
            orientation,
            scale,
            spin,
            twice_w,
            projected_frame.is_some(),
        ) else {
            return Ok(false);
        };
        for (j, i) in [axis, tangent].into_iter().enumerate() {
            direct_box_error[i] = ledger.direct[j];
            box_origin[i] = ledger.origin[j];
            box_error[i] = ledger.error[j];
        }
    }
    let mut gap = Bound::exact(0.);
    let mut error = 0.;
    for i in 0..3 {
        let t = ball_centers[i].sub(box_origin[i]);
        gap = gap.add(n[i].mul(t));
        error = upper_add(
            error,
            upper_mul(
                magnitude(n[i]),
                upper_add(box_error[i], ball_values[i].error),
            ),
        );
    }
    let margin = Bound::exact(f64::from(ball.radius))
        .add(Bound::exact(f64::from(clearance)))
        .mul(magnitude_n);
    let face_limit = squared.mul(Bound::exact(f64::from(cuboid.half_extents[axis])));
    let nominal = gap.sub(face_limit).sub(margin);
    let mut done = nominal.sub(Bound::exact(error)).lo > 0.;
    if !done && slab.is_none() {
        if let (Some(pivot), Some((tangent, orientation, diagonal, _, twice_w, _, _))) =
            (pivot, planar)
        {
            work.charge(1280)?;
            if let Some((projection, clock_error)) = shared_face_time(
                context,
                ball_frame,
                axis,
                tangent,
                pivot,
                sign.signum(),
                orientation,
                diagonal.actual,
                twice_w.actual,
                n,
            ) {
                let error = (0..3).fold(clock_error, |error, i| {
                    upper_add(
                        error,
                        upper_mul(
                            magnitude(n[i]),
                            upper_add(direct_box_error[i], ball_values[i].error),
                        ),
                    )
                });
                done = projection
                    .sub(face_limit)
                    .sub(margin)
                    .sub(Bound::exact(error))
                    .lo
                    > 0.;
            }
        }
    }
    if !done {
        if let Some((tangent, orientation, along, diagonal, spin, twice_w, tangent_errors)) =
            face_cells
        {
            if clock {
                let pivot = 3 - axis - tangent;
                // Each row keeps the original quaternion input and translation on
                // the same physical interval. Reuse the already culled face
                // region and sphere error across all of these rows.
                return face_clock::rows(context, pivot, work, |_, row, work| {
                    work.charge(512)?;
                    let q = row.rotation.components;
                    let spin = Value::input(q[pivot]);
                    let w2 = Value::input(q[3].mul(Float::exact(2.)));
                    let diagonal = Value::input(q[3].mul(q[3]).sub(q[pivot].mul(q[pivot])));
                    let Some(ledger) = FaceLedger::new(
                        row,
                        axis,
                        tangent,
                        cuboid.half_extents[axis] * sign.signum(),
                        along,
                        orientation,
                        diagonal,
                        spin,
                        w2,
                        true,
                    ) else {
                        return Ok(false);
                    };
                    let sign = Bound::exact(f64::from(sign.signum()));
                    let n = [
                        diagonal.ideal.mul(sign),
                        spin.ideal
                            .mul(w2.ideal)
                            .mul(Bound::exact(f64::from(orientation)))
                            .mul(sign),
                    ];
                    let squared = n[0].mul(n[0]).add(n[1].mul(n[1]));
                    let mut projected = Bound::exact(0.);
                    for (j, i) in [axis, tangent].into_iter().enumerate() {
                        let delta = ball_centers[i].sub(ledger.origin[j]);
                        projected = projected.add(n[j].mul(delta)).sub(Bound::exact(upper_mul(
                            magnitude(n[j]),
                            upper_add(ledger.error[j], ball_values[i].error),
                        )));
                    }
                    let margin = Bound::exact(f64::from(ball.radius))
                        .add(Bound::exact(f64::from(clearance)))
                        .mul(squared.sqrt());
                    if projected
                        .sub(squared.mul(Bound::exact(f64::from(cuboid.half_extents[axis]))))
                        .sub(margin)
                        .lo
                        > 0.
                    {
                        return Ok(true);
                    }
                    // The entire time slab was culled above. The represented
                    // quaternion and translations in this row give a tighter
                    // normal gap and a matching orthogonal tangent interval.
                    work.charge(256)?;
                    let tangent_axis = [negate(n[1].mul(sign)), n[0].mul(sign)];
                    let mut normal_gap = Bound::exact(0.);
                    let mut tangent_projection = Bound::exact(0.);
                    for (j, i) in [axis, tangent].into_iter().enumerate() {
                        let sphere = target_value(
                            ball_frame,
                            None,
                            i,
                            Float::span(-ball.radius, ball.radius),
                        );
                        let error =
                            upper_mul(magnitude(n[j]), upper_add(ledger.error[j], sphere.error));
                        let delta = ball_centers[i].sub(ledger.origin[j]);
                        normal_gap = normal_gap.add(n[j].mul(delta)).sub(Bound::exact(error));

                        // Every local normal coordinate has zero ideal tangent
                        // projection. Keep the complete box and disk errors.
                        let delta = ball_centers[i].sub(Value::input(row.translation[i]).ideal);
                        let error = upper_mul(magnitude(tangent_axis[j]), tangent_errors[j]);
                        tangent_projection = tangent_projection
                            .add(tangent_axis[j].mul(delta))
                            .add(Bound {
                                lo: -error,
                                hi: error,
                            });
                    }
                    normal_gap = normal_gap
                        .sub(squared.mul(Bound::exact(f64::from(cuboid.half_extents[axis]))));
                    let Some(along) =
                        reachable_tangents(along, normal_gap, tangent_projection, squared, margin)
                    else {
                        return Ok(true);
                    };
                    face_cells::separated(
                        row,
                        ball_frame,
                        ball.radius,
                        clearance,
                        cuboid.half_extents,
                        axis,
                        tangent,
                        if sign.lo < 0. { -1. } else { 1. },
                        orientation,
                        along,
                        diagonal.actual,
                        spin.actual,
                        w2.actual,
                        work,
                    )
                });
            }
            let available = work.limit - work.used;
            let mut local = Work {
                used: 0,
                limit: available.min(512 * 1024),
            };
            let clear = face_cells::separated(
                box_frame,
                ball_frame,
                ball.radius,
                clearance,
                cuboid.half_extents,
                axis,
                tangent,
                sign.signum(),
                orientation,
                along,
                diagonal,
                spin,
                twice_w,
                &mut local,
            );
            work.charge(local.used)?;
            done = match clear {
                Err(TrajectoryError::WorkLimit) if available > local.limit => false,
                result => result?,
            };
        }
    }
    Ok(done)
}

// The row's normal and tangent are orthogonal and both have length |n|.
// For a local tangent u to reach the sphere, the squared normal gap plus
// (tangent_projection - u * |n|²)² must fit in the scaled radial margin.
fn reachable_tangents(
    along: Float,
    normal_gap: Bound,
    tangent_projection: Bound,
    squared: Bound,
    margin: Bound,
) -> Option<Float> {
    if !squared.finite() || squared.lo <= 0. || !normal_gap.finite() || !margin.finite() {
        return Some(along);
    }
    let gap = Bound::exact(normal_gap.lo.max(0.));
    let remaining = margin.mul(margin).sub(gap.mul(gap));
    if remaining.hi < 0. {
        return None;
    }
    let width = Bound {
        lo: 0.,
        hi: remaining.hi,
    }
    .sqrt()
    .hi;
    let reciprocal = Bound {
        lo: (1. / squared.hi).next_down(),
        hi: (1. / squared.lo).next_up(),
    };
    let reachable = tangent_projection
        .add(Bound {
            lo: -width,
            hi: width,
        })
        .mul(reciprocal);
    if !reachable.finite() {
        return Some(along);
    }
    let lo = along.lo.max((reachable.lo as f32).next_down());
    let hi = along.hi.min((reachable.hi as f32).next_up());
    (lo <= hi).then_some(Float { lo, hi })
}

#[derive(Clone, Copy)]
struct FaceLedger {
    origin: [Bound; 2],
    error: [f64; 2],
    direct: [f64; 2],
}

impl FaceLedger {
    #[allow(clippy::too_many_arguments)]
    fn new(
        frame: Frame,
        axis: usize,
        tangent: usize,
        side: f32,
        along: Float,
        orientation: f32,
        scale: Value,
        spin: Value,
        twice_w: Value,
        refine: bool,
    ) -> Option<Self> {
        let mut ledger = Self {
            origin: [Bound::exact(0.); 2],
            error: [0.; 2],
            direct: [0.; 2],
        };
        let flip = Value::input(Float::exact(orientation));
        let side = Value::input(Float::exact(side));
        let local = Value::input(along);
        let normal_term = side.mul(scale);
        let lateral_term = local.mul(spin).mul(flip).mul(twice_w);
        let tangent_term = local.mul(scale);
        let offset = side.mul(spin).mul(flip).mul(twice_w);
        let values = [
            face_difference(normal_term, lateral_term),
            tangent_term.add(offset),
        ];
        if values.iter().any(|v| !v.finite()) {
            return None;
        }
        let biases = if refine {
            let bounds = |bias: Bound, error: f64| {
                bias.add(Bound {
                    lo: -error,
                    hi: error,
                })
            };
            let side_error = scale
                .actual
                .image()
                .map(|image| {
                    let errors = image.values.map(|d| {
                        f64::from(side.actual.lo * d) - f64::from(side.actual.lo) * f64::from(d)
                    });
                    Bound {
                        lo: errors[0].min(errors[image.len - 1]).next_down(),
                        hi: errors[0].max(errors[image.len - 1]).next_up(),
                    }
                })
                .unwrap_or(Bound {
                    lo: -normal_term.error,
                    hi: normal_term.error,
                });
            let product_error = product_bias::twice_product(local.mul(spin).mul(flip), twice_w)
                .map(|(bias, error)| bounds(bias, error))
                .unwrap_or(Bound {
                    lo: -lateral_term.error,
                    hi: lateral_term.error,
                });
            let sub_error = face_difference(
                Value::input(normal_term.actual),
                Value::input(lateral_term.actual),
            )
            .error;
            let side_bias = Some(bounds(side_error.sub(product_error), sub_error));
            let tangent_bias =
                rounded_translation_band(tangent_term.actual, offset.actual, values[1].actual)
                    .map(|shift| bounds(shift.sub(offset.ideal), tangent_term.error));
            [side_bias, tangent_bias]
        } else {
            [None, None]
        };
        for (j, ((i, value), bias)) in [axis, tangent]
            .into_iter()
            .zip(values)
            .zip(biases)
            .enumerate()
        {
            let translation = frame.translation[i];
            let placed = value.add(Value::input(translation));
            if !placed.finite() {
                return None;
            }
            ledger.direct[j] = placed.error;
            let (bias, error) = match bias {
                Some(range)
                    if range.finite() && range.hi >= -value.error && range.lo <= value.error =>
                {
                    (
                        Bound {
                            lo: range.lo.max(-value.error),
                            hi: range.hi.min(value.error),
                        },
                        0.,
                    )
                }
                _ => (Bound::exact(0.), value.error),
            };
            if let Some(shift) = rounded_translation_band(value.actual, translation, placed.actual)
            {
                ledger.origin[j] = shift.add(bias);
                ledger.error[j] = error;
            } else {
                ledger.origin[j] = Value::input(translation).ideal.add(bias);
                ledger.error[j] = upper_add(
                    error,
                    rounding(value.actual, translation, placed.actual, Op::Add),
                );
            }
        }
        Some(ledger)
    }
}

// The exact rotation and translation use one physical F32 delta. Keep
// that parameter shared while accumulating a certified error for each
// original rounded node. A constant diagonal/normalizer leaves one affine
// normal component, so projection is at most quadratic in the common dt.
#[allow(clippy::too_many_arguments)]
fn shared_face_time(
    context: Context<'_>,
    ball_frame: Frame,
    face: usize,
    tangent: usize,
    pivot: usize,
    sign: f32,
    orientation: f32,
    diagonal: Float,
    twice_w: Float,
    normal: [Bound; 3],
) -> Option<(Bound, f64)> {
    if !singleton(diagonal) || !singleton(twice_w) {
        return None;
    }
    let cube = if context.sa.as_cuboid().is_some() {
        context.a
    } else {
        context.b
    };
    let Curve::Integrated(k) = cube.curve else {
        return None;
    };
    if cube.local_center != rp::Vector::ZERO || cube.local_pose != rp::Pose::IDENTITY {
        return None;
    }
    let native = k.native;
    let start = native.motion.start;
    let omega = native.angular_velocity;
    let raw_start = start.rotation.to_array();
    let dt = Float::span(k.local_delta(context.start), k.local_delta(context.end));
    if dt.lo < 0. || dt.hi >= native.integration_seconds {
        return None;
    }
    let f = |x| Value::input(Float::exact(x));
    let half_dt = Value::input(dt).mul(f(0.5));
    let turns = omega.to_array().map(|w| f(w).mul(half_dt));
    // Preserve the original Hamilton product and its rounding order. Even
    // when two components vanish from the face projection, all four inputs
    // still contribute to the original quaternion normalization.
    let q = raw_start.map(f);
    let raw_z = match pivot {
        0 => q[0]
            .add(turns[0].mul(q[3]))
            .add(turns[1].mul(q[2]))
            .sub(turns[2].mul(q[1])),
        1 => q[1]
            .sub(turns[0].mul(q[2]))
            .add(turns[1].mul(q[3]))
            .add(turns[2].mul(q[0])),
        _ => q[2]
            .add(turns[0].mul(q[1]))
            .sub(turns[1].mul(q[0]))
            .add(turns[2].mul(q[3])),
    };
    let raw = product(
        [
            turns[0].actual,
            turns[1].actual,
            turns[2].actual,
            Float::exact(1.),
        ],
        raw_start.map(Float::exact),
    );
    if raw.iter().any(|v| !v.finite()) {
        return None;
    }
    let min = rp::Rotation::from_array(raw.map(|v| {
        if v.lo <= 0. && v.hi >= 0. {
            0.
        } else {
            v.lo.abs().min(v.hi.abs())
        }
    }));
    let max = rp::Rotation::from_array(raw.map(|v| v.lo.abs().max(v.hi.abs())));
    let factor = min.length_recip();
    if !factor.is_finite() || factor <= 0. || factor.to_bits() != max.length_recip().to_bits() {
        return None;
    }
    // The native zero-delta branch returns the stored rotation directly.
    if dt.lo == 0. && factor != 1. {
        return None;
    }
    let rotated = raw_z.mul(f(factor));
    let directed = Bound::exact(f64::from(sign) * f64::from(orientation) * f64::from(twice_w.lo));
    let k0 = Bound::exact(f64::from(raw_start[pivot]))
        .mul(Bound::exact(f64::from(factor)))
        .mul(directed);
    let next = (pivot + 1) % 3;
    let last = (pivot + 2) % 3;
    let rate = |i: usize, j: usize| Bound::exact(f64::from(omega[i]) * f64::from(raw_start[j]));
    let k1 = rate(pivot, 3)
        .add(rate(next, last))
        .sub(rate(last, next))
        .mul(Bound::exact(0.5))
        .mul(Bound::exact(f64::from(factor)))
        .mul(directed);
    let center = (f64::from(dt.lo) + f64::from(dt.hi)) * 0.5;
    let u = Value::input(dt).ideal.sub(Bound::exact(center));
    let time = Bound::exact(center);
    let change = |i: usize| {
        let slope = Bound::exact(-f64::from(native.linear_velocity[i]));
        let origin = Value::input(ball_frame.translation[i])
            .ideal
            .sub(Bound::exact(f64::from(start.translation[i])))
            .add(slope.mul(time));
        let actual =
            f(start.translation[i]).add(f(native.linear_velocity[i]).mul(Value::input(dt)));
        (origin, slope, actual.error)
    };
    let (in_face, face_rate, face_error) = change(face);
    let (along, along_rate, translation_error) = change(tangent);
    let fixed = Bound::exact(f64::from(sign) * f64::from(diagonal.lo));
    let normal_at_center = k0.add(k1.mul(time));
    let base = fixed.mul(in_face).add(normal_at_center.mul(along));
    let slope = fixed
        .mul(face_rate)
        .add(normal_at_center.mul(along_rate))
        .add(k1.mul(along));
    let squared = k1.mul(along_rate);
    let gap = base.add(slope.mul(u)).add(squared.mul(u.mul(u)));
    let magnitude_along = magnitude(along.add(along_rate.mul(u)));
    let error = upper_add(
        upper_mul(
            magnitude(directed),
            upper_mul(rotated.error, magnitude_along),
        ),
        upper_add(
            upper_mul(magnitude(normal[face]), face_error),
            upper_mul(magnitude(normal[tangent]), translation_error),
        ),
    );
    (gap.finite() && error.is_finite()).then_some((gap, error))
}

// A nominated local tangent range only proposes a partition. Exclude
// a slab only if an original world coordinate proves its complete distance
// from the full stationary sphere, including the selected clearance.
#[allow(clippy::too_many_arguments)]
fn cull_ball_tangent_slabs(
    bx: Frame,
    ball: Frame,
    half: rp::Vector,
    axis: usize,
    radius: f32,
    clearance: f32,
    context: Context<'_>,
    slab: Option<CapsuleSlab>,
    projected_axis: Option<usize>,
    work: &mut Work,
    radial: impl Fn(f32, bool) -> bool,
) -> Result<Float, TrajectoryError> {
    work.charge(2048)?;
    let (box_motion, ball_motion) = if context.sa.as_cuboid().is_some() {
        (context.a, context.b)
    } else {
        (context.b, context.a)
    };
    let target = if slab.is_some() {
        rp::Pose::from_translation(rp::Vector::from_array(
            ball.translation
                .map(|v| ((f64::from(v.lo) + f64::from(v.hi)) * 0.5) as f32),
        ))
    } else {
        ball_motion.pose(context.start)
    };
    let center = box_motion.pose(context.start).inv_mul(&target).translation[axis];
    let width = 2. * (radius + clearance);
    let limit = half[axis];
    if !center.is_finite() || !width.is_finite() || width <= 0. {
        return Ok(Float::span(-limit, limit));
    }
    let sphere: [Float; 3] = std::array::from_fn(|i| {
        let world = world_radius_range(ball.translation[i], radius);
        let local = target_value(ball, slab, i, Float::span(-radius, radius)).actual;
        Float::span(world.lo.min(local.lo), world.hi.max(local.hi))
    });
    let margin = Bound::exact(f64::from(clearance));
    let separated = |lo, hi| {
        let slab = bx.point_range(std::array::from_fn(|i| {
            if i == axis {
                Float::span(lo, hi)
            } else {
                Float::span(-half[i], half[i])
            }
        }));
        if slab.iter().chain(&sphere).any(|range| !range.finite()) {
            return false;
        }
        slab.into_iter().zip(sphere).enumerate().any(|(i, (l, r))| {
            if projected_axis == Some(i) {
                return false;
            }
            let left = Bound::exact(f64::from(l.lo)).sub(Bound::exact(f64::from(r.hi)));
            let right = Bound::exact(f64::from(r.lo)).sub(Bound::exact(f64::from(l.hi)));
            left.sub(margin).lo > 0. || right.sub(margin).lo > 0.
        })
    };
    let mut near = Float::span(-limit, limit);
    let lo = (center - width).clamp(-limit, limit);
    let hi = (center + width).clamp(-limit, limit);
    if lo > -limit && separated(-limit, lo) {
        near.lo = lo;
    }
    if hi < limit && separated(hi, limit) {
        near.hi = hi;
    }
    let mut narrow_width = (radius + clearance) * 0.25;
    for _ in 0..if projected_axis.is_some() { 7 } else { 4 } {
        work.charge(128)?;
        let lo = (center - narrow_width).clamp(near.lo, near.hi);
        let hi = (center + narrow_width).clamp(near.lo, near.hi);
        let mut changed = false;
        if lo > near.lo && radial(lo, true) {
            near.lo = lo;
            changed = true;
        }
        if hi < near.hi && radial(hi, false) {
            near.hi = hi;
            changed = true;
        }
        if !changed {
            break;
        }
        narrow_width *= 0.25;
    }
    Ok(near)
}

// Sterbenz: subtracting two represented floats of the same sign whose
// magnitudes stay within a factor of two incurs no additional F32 error.
fn face_difference(a: Value, b: Value) -> Value {
    let a_mag = |x: Float| f64::from(x.lo.abs().max(x.hi.abs()));
    let min = |x: Float| f64::from(x.lo.abs().min(x.hi.abs()));
    let same_sign =
        (a.actual.lo > 0. && b.actual.lo > 0.) || (a.actual.hi < 0. && b.actual.hi < 0.);
    if same_sign && a_mag(a.actual) <= 2. * min(b.actual) && a_mag(b.actual) <= 2. * min(a.actual) {
        Value {
            actual: a.actual.sub(b.actual),
            ideal: a.ideal.sub(b.ideal),
            error: upper_add(a.error, b.error),
        }
    } else {
        a.sub(b)
    }
}

// If the entire input and translated result stay on one represented F32
// grid, round the translation on that grid. Both tie directions are kept.
fn rounded_translation_band(base: Float, offset: Float, after: Float) -> Option<Bound> {
    let binade = base.lo.to_bits() >> 23;
    let exponent = (binade & 255) as i32;
    if !(1..255).contains(&exponent)
        || [base.hi, after.lo, after.hi]
            .into_iter()
            .any(|v| v.to_bits() >> 23 != binade)
    {
        return None;
    }
    let origin = 2_f64.powi(exponent - 127);
    let (low, high) = if base.lo.is_sign_negative() {
        (-2. * origin, -origin)
    } else {
        (origin, 2. * origin)
    };
    let exact = Value::input(base).ideal.add(Value::input(offset).ideal);
    if exact.lo < low || exact.hi > high {
        return None;
    }
    let quantum = 2_f64.powi(exponent - 150);
    let lo = (f64::from(offset.lo) / quantum - 0.5).next_down().ceil() * quantum;
    let hi = (f64::from(offset.hi) / quantum + 0.5).next_up().floor() * quantum;
    (lo.is_finite() && hi.is_finite() && lo <= hi).then_some(Bound { lo, hi })
}

/// The exact-real action of the same COM quaternion on both local offsets
/// contributes only along the chosen face. Keep the two original F32 offset
/// transforms and additions as separate error bounds.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded::output) fn offset_separated(
    motion: ShapeMotion,
    cuboid: &rp::Cuboid,
    target: ShapeMotion,
    ball: &rp::Ball,
    direction: rp::Vector,
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    work.charge(512)?;
    if !direction.is_finite()
        || !cuboid.half_extents.is_finite()
        || cuboid.half_extents.min_element() < 0.
        || !ball.radius.is_finite()
        || ball.radius < 0.
    {
        return Ok(false);
    }
    let Some(com) = frames(motion.curve, context.start, context.end, work)? else {
        return Ok(false);
    };
    let ball_frame = Frame::exact(target.pose(context.start));
    if ball_frame.rotation.exact != Some(rp::Rotation::IDENTITY) {
        return Ok(false);
    }
    let ball_hull = transform(ball_frame, [Value::local(0., ball.radius); 3]);
    if ball_hull.iter().any(|value| !value.finite()) {
        return Ok(false);
    }
    let mut direction_axis = 0;
    let mut sign = 0_f32;
    let first_box = motion.pose(context.start);
    for i in 0..3 {
        let mut unit = rp::Vector::ZERO;
        unit[i] = 1.;
        let dot = (first_box.rotation * unit).dot(direction);
        if dot.abs() > sign.abs() {
            direction_axis = i;
            sign = dot;
        }
    }
    if !sign.is_finite() || sign == 0. {
        return Ok(false);
    }
    let sign = sign.signum();
    let mut axis = rp::Vector::ZERO;
    axis[direction_axis] = sign;
    for &frame in &com.values[..com.len] {
        work.charge(2048)?;
        let rotation = Frame {
            translation: [Float::ZERO; 3],
            ..frame
        };
        let ideal = IdealTransform::new(rotation);
        let normal = ideal.point(axis);
        let norm = ideal
            .q
            .into_iter()
            .fold(Bound::exact(0.), |sum, q| sum.add(q.mul(q)));
        if norm.lo <= 0. || !norm.finite() {
            return Ok(false);
        }
        let mut actual = frame.translation;
        let mut errors = [0.; 3];
        for offset in [-motion.local_center, motion.local_pose.translation] {
            let values = transform(
                Frame {
                    translation: actual,
                    ..rotation
                },
                offset.to_array().map(|v| Value::input(Float::exact(v))),
            );
            if values.iter().any(|value| !value.finite()) {
                return Ok(false);
            }
            for (i, v) in values.into_iter().enumerate() {
                actual[i] = v.actual;
                errors[i] = upper_add(errors[i], v.error);
            }
        }
        let box_hull = transform(
            Frame {
                translation: actual,
                ..rotation
            },
            cuboid
                .half_extents
                .to_array()
                .map(|h| Value::input(Float::span(-h, h))),
        );
        if box_hull.iter().any(|value| !value.finite()) {
            return Ok(false);
        }
        let margin = Bound::exact(f64::from(ball.radius))
            .add(Bound::exact(f64::from(context.clearance)))
            .mul(norm);
        let offset = Bound::exact(f64::from(motion.local_pose.translation[direction_axis]))
            .sub(Bound::exact(f64::from(motion.local_center[direction_axis])))
            .mul(Bound::exact(f64::from(sign)));
        let face = norm
            .mul(norm)
            .mul(Bound::exact(f64::from(cuboid.half_extents[direction_axis])).add(offset));
        let mut gap = Bound::exact(0.);
        let mut error = 0.;
        for i in 0..3 {
            let delta = Value::input(ball_frame.translation[i])
                .ideal
                .sub(Value::input(frame.translation[i]).ideal);
            gap = gap.add(delta.mul(normal[i]));
            error = upper_add(
                error,
                upper_mul(
                    magnitude(normal[i]),
                    upper_add(errors[i], upper_add(box_hull[i].error, ball_hull[i].error)),
                ),
            );
        }
        if !gap.finite()
            || !error.is_finite()
            || !face.finite()
            || !margin.finite()
            || gap.sub(face).sub(margin).sub(Bound::exact(error)).lo <= 0.
        {
            return Ok(false);
        }
    }
    Ok(com.len > 0)
}

// For a fixed identity capsule, a core-coordinate interval plus the original
// sphere covers every leaf point. Enlarge the center interval for the local
// p+u rounding and for the alternate rounded world-core path.
#[allow(clippy::too_many_arguments)]
pub(in crate::physics3d::solver_trajectory::rounded::output) fn rotating_box_capsule_face(
    frames: &Frames,
    cube: &rp::Cuboid,
    other: &Frames,
    capsule: &rp::Capsule,
    normal: rp::Vector,
    context: Context<'_>,
    work: &mut Work,
) -> Result<bool, TrajectoryError> {
    if frames.len == 0 {
        return Ok(false);
    }
    if translating_capsule::separated(context, frames, cube, capsule, work)? {
        return Ok(true);
    }
    let a = capsule.segment.a;
    let b = capsule.segment.b;
    let r = capsule.radius;
    if frames.len == 0
        || other.len != 1
        || !r.is_finite()
        || r <= 0.
        || !a.is_finite()
        || !b.is_finite()
    {
        return Ok(false);
    }
    let mut varying = (0..3).filter(|&i| a[i] != b[i]);
    let Some(axis) = varying.next() else {
        return Ok(false);
    };
    if varying.next().is_some() || (0..3).any(|i| i != axis && a[i] != 0.) {
        return Ok(false);
    }
    let frame = other.values[0];
    if frame.rotation.exact != Some(rp::Rotation::IDENTITY) || normal[axis] == 0. {
        return Ok(false);
    }
    work.charge(1024)?;
    let lo = a[axis].min(b[axis]);
    let hi = a[axis].max(b[axis]);
    let cut = if normal[axis] > 0. {
        lo + r / 32.
    } else {
        hi - r / 32.
    }
    .clamp(lo, hi);
    let sphere = rp::Ball::new(r);
    for (first, last) in [(lo, cut), (cut, hi)] {
        let mut centers = frame;
        let base = frame.translation[axis];
        let core = Float::span(first, last);
        centers.translation[axis] = base.add(core);
        let slab = CapsuleSlab {
            axis,
            translation: base,
            core,
        };
        if !rotating_round_face(
            frames,
            cube,
            centers,
            &sphere,
            normal,
            context.clearance,
            context,
            Some(slab),
            false,
            work,
        )? {
            return Ok(false);
        }
    }
    Ok(true)
}
