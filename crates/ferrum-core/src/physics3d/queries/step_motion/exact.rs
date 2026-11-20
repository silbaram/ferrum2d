//! Stored completed-step observations retain the real integration law and domain.
use super::*;
use crate::physics3d::{
    motion_trace::{AcceptedCurve, MotionTrace},
    solver_trajectory::{self, Curve, Domain, Kernel, ShapeMotion, Time, TrajectoryError, Work},
};

const MAX_SEGMENTS: usize = 1 << 20;
#[derive(serde::Serialize, serde::Deserialize)]
pub(super) struct Segment {
    pub owner: rp::RigidBodyHandle,
    pub motion: ShapeMotion,
    pub start_time: Time,
    pub end_time: Time,
}

pub(super) fn capture_body(
    trace: &MotionTrace,
    start: &MotionStart,
    body: &rp::RigidBody,
    sensor: bool,
    fraction: &impl Fn(Time) -> Time,
    segments: &mut Vec<TargetMotion>,
    failed: &mut bool,
) -> bool {
    if trace.integration_capacity_failed {
        *failed = true;
        return true;
    }
    let center = body.local_center_of_mass();
    let key = start.body.into_raw_parts();
    let from = trace
        .actual
        .partition_point(|m| m.body.into_raw_parts() < key);
    let to = trace
        .actual
        .partition_point(|m| m.body.into_raw_parts() <= key);
    let actual = &trace.actual[from..to];
    // Position-controlled sensor sweeps use authored interpolation. An
    // accepted hold is the exception because it records a stopped command.
    if sensor
        && body.body_type() == rp::RigidBodyType::KinematicPositionBased
        && !actual
            .iter()
            .any(|row| row.start_time < row.end_time && matches!(row.curve, Curve::Constant { .. }))
    {
        return false;
    }

    let i = trace
        .integrations
        .partition_point(|m| m.motion.body.into_raw_parts() < key);
    let j = trace
        .integrations
        .partition_point(|m| m.motion.body.into_raw_parts() <= key);
    let integrations = &trace.integrations[i..j];
    if actual.is_empty()
        && (integrations.is_empty()
            || integrations
                .iter()
                .all(|m| m.angular_velocity == rp::Vector::ZERO)
                && trace.accepted_clamps.iter().all(|c| c.body != start.body))
    {
        return false;
    }
    let add = |actual: AcceptedCurve, segments: &mut Vec<TargetMotion>, failed: &mut bool| {
        let from = actual.curve.com_pose(actual.start_time);
        let to = actual.curve.com_pose(actual.end_time);
        if segments.len() >= MAX_SEGMENTS || segments.try_reserve(1).is_err() {
            *failed = true;
            return;
        }
        let mut target = target_motion(
            start,
            center,
            from,
            to,
            fraction(actual.start_time),
            fraction(actual.end_time),
        );
        target.exact = Some(Segment {
            owner: actual.body,
            motion: ShapeMotion {
                curve: actual.curve,
                local_center: center,
                local_pose: start.local_pose,
            },
            start_time: actual.start_time,
            end_time: actual.end_time,
        });
        segments.push(target);
    };
    let lo = trace
        .accepted_clamps
        .partition_point(|m| m.body.into_raw_parts() < key);
    let hi = trace
        .accepted_clamps
        .partition_point(|m| m.body.into_raw_parts() <= key);
    let clamps = &trace.accepted_clamps[lo..hi];
    if !actual.is_empty() {
        for &row in actual {
            if !clamps
                .iter()
                .any(|c| row.start_time >= c.start_time && row.start_time < c.end_time)
            {
                add(row, segments, failed);
            }
        }
    } else {
        for &integration in integrations {
            if !clamps.iter().any(|c| {
                f64::from(integration.motion.start_time) >= c.start_time
                    && f64::from(integration.motion.start_time) < c.end_time
            }) {
                let kernel = match Kernel::from_native(
                    integration,
                    Domain {
                        start: f64::from(integration.motion.start_time),
                        end: f64::from(integration.motion.end_time),
                    },
                ) {
                    Ok(kernel) => kernel,
                    Err(_) => {
                        *failed = true;
                        continue;
                    }
                };
                add(
                    AcceptedCurve {
                        body: start.body,
                        curve: Curve::Integrated(kernel),
                        start_time: f64::from(integration.motion.start_time),
                        end_time: f64::from(integration.motion.end_time),
                    },
                    segments,
                    failed,
                );
            }
        }
    }
    for clamp in clamps {
        let impact =
            clamp.start_time + (clamp.end_time - clamp.start_time) * f64::from(clamp.fraction);
        add(
            AcceptedCurve {
                body: start.body,
                curve: Curve::Ccd {
                    sweep: clamp.sweep,
                    start_time: clamp.start_time,
                    end_time: clamp.end_time,
                },
                start_time: clamp.start_time,
                end_time: impact,
            },
            segments,
            failed,
        );
        let pose = Curve::Ccd {
            sweep: clamp.sweep,
            start_time: clamp.start_time,
            end_time: clamp.end_time,
        }
        .com_pose(impact);
        add(
            AcceptedCurve {
                body: start.body,
                curve: Curve::Constant {
                    pose,
                    start_time: impact,
                    end_time: clamp.full_end_time,
                },
                start_time: impact,
                end_time: clamp.full_end_time,
            },
            segments,
            failed,
        );
    }
    true
}

#[allow(clippy::too_many_arguments)]
pub(super) fn cast(
    exact: &Segment,
    segment: &TargetMotion,
    target: ColliderRef,
    target_shape: &dyn rp::Shape,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
    translation: rp::Vector,
    work: &mut Work,
) -> Result<Option<SweepHit>, PhysicsError> {
    let from = exact.start_time;
    let to = exact.end_time;
    let start = rp::Pose::from_parts(
        pose.translation + translation * segment.start_fraction as f32,
        pose.rotation,
    );
    let contact = |pose: &rp::Pose| {
        rapier3d::parry::query::contact(&exact.motion.pose(from), target_shape, pose, shape, 0.)
            .map_err(|_| PhysicsError::UnsupportedShape)
    };
    if let Some(c) = contact(&start)? {
        return Ok(Some(SweepHit {
            target,
            fraction: segment.start_fraction as f32,
            point: c.point1.to_array(),
            normal: c.normal1.to_array(),
            initial_overlap: segment.start_fraction == 0.,
        }));
    }
    if from == to {
        return Ok(None);
    }
    let velocity =
        translation * ((segment.end_fraction - segment.start_fraction) / (to - from)) as f32;
    let query = Kernel::from_velocity(
        rp::RigidBodyHandle::invalid(),
        Domain {
            start: from,
            end: to,
        },
        start,
        velocity,
        rp::Vector::ZERO,
    )
    .map_err(|_| PhysicsError::InvalidQuery)?;
    let query = ShapeMotion {
        curve: Curve::Integrated(query),
        local_center: rp::Vector::ZERO,
        local_pose: rp::Pose::IDENTITY,
    };
    let result = solver_trajectory::cast_full_shapes(
        exact.motion,
        target_shape,
        query,
        shape,
        from,
        to,
        0.,
        ((to - from) * 1e-6).max(f64::from(f32::MIN_POSITIVE)),
        work,
    )
    .map_err(|e| match e {
        TrajectoryError::WorkLimit => PhysicsError::CapacityExceeded,
        TrajectoryError::UnsupportedShape => PhysicsError::UnsupportedShape,
        _ => PhysicsError::InvalidQuery,
    })?;
    Ok(result.map(|hit| SweepHit {
        target,
        // Public hit metadata stays f32; all target/query planning above used
        // the precise domain and the actual witness's same physical time.
        fraction: (segment.start_fraction
            + (segment.end_fraction - segment.start_fraction)
                * ((hit.hit_time - from) / (to - from))) as f32,
        point: hit.contact.point1.to_array(),
        normal: hit.contact.normal1.to_array(),
        initial_overlap: false,
    }))
}
