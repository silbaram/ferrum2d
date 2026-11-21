//! Tick-local target motion for projectile casts. The scene-query BVH and pipeline
//! modification lists remain untouched. All projectiles see the same sampled motion,
//! even after earlier projectiles have been clamped to their first hit.
use super::*;
use crate::physics3d::solver_trajectory::Time;
mod exact;
mod file_admission;
mod finish;
#[cfg(test)]
mod logical_clock_tests;
use rapier3d::parry::bounding_volume::{Aabb, BoundingVolume};
use rapier3d::parry::partitioning::{Bvh, BvhWorkspace};
use rapier3d::parry::query::{
    cast_shapes, cast_shapes_nonlinear, contact, NonlinearRigidMotion, ShapeCastOptions,
};

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub(in crate::physics3d) struct StepMotion {
    pub(in crate::physics3d) enabled: bool,
    ready: bool,
    elapsed: Time,
    starts: Vec<MotionStart>,
    segments: Vec<TargetMotion>,
    bvh: Bvh,
    #[serde(skip)]
    workspace: BvhWorkspace,
    leaves: usize,
    exact_failed: bool,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct MotionStart {
    collider: rp::ColliderHandle,
    body: rp::RigidBodyHandle,
    pose: rp::Pose,
    local_pose: rp::Pose,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct TargetMotion {
    collider: rp::ColliderHandle,
    #[serde(with = "crate::physics3d::snapshot::motion")]
    motion: NonlinearRigidMotion,
    start_fraction: Time,
    end_fraction: Time,
    exact: Option<exact::Segment>,
}

impl StepMotion {
    pub(in crate::physics3d) fn stage_tick(&mut self, prior: &mut Self) {
        prior.ready = self.ready;
        prior.elapsed = self.elapsed;
        prior.exact_failed = self.exact_failed;
        std::mem::swap(&mut self.starts, &mut prior.starts);
        std::mem::swap(&mut self.segments, &mut prior.segments);
    }

    pub(in crate::physics3d) fn restore_tick(&mut self, prior: &mut Self) {
        self.ready = prior.ready;
        self.elapsed = prior.elapsed;
        self.exact_failed = prior.exact_failed;
        std::mem::swap(&mut self.starts, &mut prior.starts);
        std::mem::swap(&mut self.segments, &mut prior.segments);
    }
}

impl PhysicsWorld3d {
    pub(crate) fn step_motion_capture_state(&self) -> StepMotionCaptureState {
        StepMotionCaptureState {
            enabled: self.step_motion.enabled,
            ready: self.step_motion.ready,
        }
    }

    pub(crate) fn restore_step_motion_capture_state(&mut self, state: StepMotionCaptureState) {
        self.step_motion.enabled = state.enabled;
        self.step_motion.ready = state.ready;
    }

    // Internal opt-in: callers request capture before step(), never by advancing a
    // second solver. Worlds without active projectiles pay no per-collider capture.
    pub(crate) fn set_step_motion_enabled(&mut self, enabled: bool) {
        self.step_motion.enabled = enabled;
        self.step_motion.ready = false;
    }

    pub(in crate::physics3d) fn begin_step_motion(&mut self) {
        self.step_motion.ready = false;
        self.step_motion.starts.clear();
        self.step_motion.segments.clear();
        self.step_motion.elapsed = 0.0;
        self.step_motion.exact_failed = false;
        if !self.step_motion.enabled {
            return;
        }
        self.refresh_queries();
        for (id, collider) in self.backend.colliders.iter() {
            let Some(parent) = collider.parent() else {
                continue;
            };
            let Some(body) = self.backend.bodies.get(parent) else {
                continue;
            };
            if !collider.is_enabled() || !body.is_enabled() {
                continue;
            }
            self.step_motion.starts.push(MotionStart {
                collider: id,
                body: parent,
                pose: *body.position(),
                local_pose: collider.position_wrt_parent().copied().unwrap_or_default(),
            });
        }
    }

    pub(in crate::physics3d) fn record_step_motion_segment(
        &mut self,
        end_fraction: impl Into<Time>,
    ) {
        let end_fraction = end_fraction.into();
        let capture = &mut self.step_motion;
        if !capture.enabled {
            return;
        }
        let trace = self.events.2.get_mut().unwrap_or_else(|p| p.into_inner());
        trace.sort();
        let start_fraction = capture.elapsed;
        let duration = self.backend.integration_parameters.dt;
        // Legacy records retain their old f32 interpolation arithmetic. The
        // actual curve records use their independent precise pass clock.
        let fraction = |time: f32| {
            (start_fraction as f32
                + (time / duration).clamp(0.0, 1.0) * (end_fraction as f32 - start_fraction as f32))
                as Time
        };
        let actual_domain = trace.precise_domain();
        let actual_global = !trace.actual.is_empty();
        let tick_seconds = Time::from(self.config.step_seconds);
        let precise_fraction = |time: Time| {
            if actual_global {
                if time == actual_domain.start {
                    start_fraction
                } else if time == actual_domain.end {
                    end_fraction
                } else {
                    (time / tick_seconds).clamp(start_fraction, end_fraction)
                }
            } else {
                start_fraction
                    + (time / actual_domain.duration()).clamp(0., 1.)
                        * (end_fraction - start_fraction)
            }
        };
        for start in &mut capture.starts {
            let Some(body) = self.backend.bodies.get(start.body) else {
                continue;
            };
            let Some(collider) = self.backend.colliders.get(start.collider) else {
                continue;
            };
            let center = body.local_center_of_mass();
            let end = *body.position();
            if exact::capture_body(
                trace,
                start,
                body,
                collider.is_sensor(),
                &precise_fraction,
                &mut capture.segments,
                &mut capture.exact_failed,
            ) {
                // Final correction is an endpoint, never a timed teleport.
                let final_com = end.prepend_translation(center);
                if capture.segments.len() >= 1 << 20 || capture.segments.try_reserve(1).is_err() {
                    capture.exact_failed = true;
                } else {
                    capture.segments.push(target_motion(
                        start,
                        center,
                        final_com,
                        final_com,
                        end_fraction,
                        end_fraction,
                    ));
                }
                start.pose = end;
                continue;
            }
            let key = start.body.into_raw_parts();
            let from = trace
                .motions
                .partition_point(|m| m.body.into_raw_parts() < key);
            let to = trace
                .motions
                .partition_point(|m| m.body.into_raw_parts() <= key);
            let motions = &trace.motions[from..to];
            let from = trace
                .clamps
                .partition_point(|m| m.body.into_raw_parts() < key);
            let to = trace
                .clamps
                .partition_point(|m| m.body.into_raw_parts() <= key);
            let clamps = &trace.clamps[from..to];
            if motions.is_empty() && clamps.is_empty()
                || body.body_type() == rp::RigidBodyType::KinematicPositionBased
            {
                // No exact capture was selected. Use the authored positions at
                // the pass boundaries, including the sensor interpolation path.
                capture.segments.push(target_motion(
                    start,
                    center,
                    start.pose.prepend_translation(center),
                    end.prepend_translation(center),
                    start_fraction,
                    end_fraction,
                ));
            } else {
                for motion in motions {
                    // CCD replaces the solved path for its time slice. Never report
                    // a discarded overshoot through an obstacle as an actual hit.
                    if clamps.iter().any(|clamp| {
                        motion.start_time >= clamp.start_time && motion.start_time < clamp.end_time
                    }) {
                        continue;
                    }
                    capture.segments.push(target_motion(
                        start,
                        center,
                        motion.start,
                        motion.end,
                        fraction(motion.start_time),
                        fraction(motion.end_time),
                    ));
                }
                for clamp in clamps {
                    let impact =
                        clamp.start_time + (clamp.end_time - clamp.start_time) * clamp.fraction;
                    capture.segments.push(target_motion(
                        start,
                        center,
                        clamp.start,
                        clamp.end,
                        fraction(clamp.start_time),
                        fraction(impact),
                    ));
                    capture.segments.push(target_motion(
                        start,
                        center,
                        clamp.end,
                        clamp.end,
                        fraction(impact),
                        fraction(clamp.end_time),
                    ));
                }
                // Final pose corrections (e.g. ratio-joint projection) are not an
                // extra time interval. Test their endpoint without sweeping a teleport.
                let final_com = end.prepend_translation(center);
                capture.segments.push(target_motion(
                    start,
                    center,
                    final_com,
                    final_com,
                    end_fraction,
                    end_fraction,
                ));
            }
            start.pose = end;
        }
        capture.elapsed = end_fraction;
    }

    pub(in crate::physics3d) fn finish_step_motion(
        &mut self,
        work: &mut crate::physics3d::solver_trajectory::Work,
    ) {
        self.step_motion.finish(&self.backend.colliders, work);
    }

    /// Casts against this tick's captured target motion, using normalized tick time.
    /// This is internal until snapshot/replay and full native motion tracing are wired.
    /// Captured Native paths retain individual solver integrations and accepted
    /// CCD clamps. Position-controlled sensors can follow the authored path.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn sweep_step_motion(
        &self,
        shape: &Shape,
        pose: Pose,
        translation: [f32; 3],
        filter: &QueryFilter,
        out: &mut Vec<SweepHit>,
        limit: usize,
    ) -> Result<bool, PhysicsError> {
        self.validate_query_limit(limit)?;
        if !self.step_motion.ready || !valid_vector(&translation) {
            return Err(PhysicsError::InvalidQuery);
        }
        validate_plane(self.config.space, pose, translation, [0.0; 3])?;
        let shape = self.query_shape(shape, pose)?;
        let filter_native = self.query_filter(filter)?;
        let pose = native_pose(pose);
        let translation = rp::Vector::from(translation);
        let bounds = shape.compute_aabb(&pose);
        let bounds = bounds.merged(&bounds.translated(translation));
        out.clear();
        let mut work = crate::physics3d::solver_trajectory::Work {
            used: 0,
            limit: 32 * 1024 * 1024,
        };
        for index in self.step_motion.bvh.intersect_aabb(&bounds) {
            let segment = &self.step_motion.segments[index as usize];
            let Some(collider) = self.backend.colliders.get(segment.collider) else {
                continue;
            };
            if !filter_native.test(&self.backend.bodies, segment.collider, collider)
                || !self.query_allows(collider, filter)
            {
                continue;
            }
            let Some(target) = collider_ref(segment.collider, collider) else {
                continue;
            };
            if let Some(exact) = &segment.exact {
                if let Some(hit) = exact::cast(
                    exact,
                    segment,
                    target,
                    collider.shape(),
                    shape.as_ref(),
                    &pose,
                    translation,
                    &mut work,
                )? {
                    out.push(hit);
                }
                continue;
            }
            let query = NonlinearRigidMotion::new(
                rp::Pose::from_parts(
                    pose.translation + translation * segment.start_fraction as f32,
                    pose.rotation,
                ),
                rp::Vector::ZERO,
                translation * (segment.end_fraction - segment.start_fraction) as f32,
                rp::Vector::ZERO,
            );
            if let Some(mut hit) = cast_motion(
                target,
                collider.shape(),
                &segment.motion,
                shape.as_ref(),
                &query,
            )? {
                hit.fraction = segment.start_fraction as f32
                    + hit.fraction * (segment.end_fraction as f32 - segment.start_fraction as f32);
                hit.initial_overlap = hit.fraction == 0.0;
                out.push(hit);
            }
        }
        // Multiple sampled passes of the same collider contribute only its earliest
        // hit. Final ordering is independent of BVH insertion and projectile order.
        out.sort_unstable_by(|a, b| {
            a.target
                .collider
                .cmp(&b.target.collider)
                .then(a.fraction.total_cmp(&b.fraction))
        });
        out.dedup_by_key(|hit| hit.target.collider);
        out.sort_unstable_by(|a, b| {
            a.fraction
                .total_cmp(&b.fraction)
                .then(a.target.collider.cmp(&b.target.collider))
        });
        let truncated = out.len() > limit;
        out.truncate(limit);
        Ok(truncated)
    }
}

#[derive(Clone, Copy)]
pub(crate) struct StepMotionCaptureState {
    enabled: bool,
    ready: bool,
}

fn target_motion(
    start: &MotionStart,
    center: rp::Vector,
    from: rp::Pose,
    to: rp::Pose,
    start_fraction: impl Into<Time>,
    end_fraction: impl Into<Time>,
) -> TargetMotion {
    let start_fraction = start_fraction.into();
    let end_fraction = end_fraction.into();
    TargetMotion {
        collider: start.collider,
        motion: NonlinearRigidMotion::new(
            from.prepend_translation(-center) * start.local_pose,
            start.local_pose.inverse() * center,
            to.translation - from.translation,
            (to.rotation * from.rotation.inverse()).to_scaled_axis(),
        ),
        start_fraction,
        end_fraction,
        exact: None,
    }
}

fn motion_bounds(shape: &dyn rp::Shape, motion: &NonlinearRigidMotion) -> Aabb {
    if motion.angvel == rp::Vector::ZERO {
        let start = shape.compute_aabb(&motion.start);
        return start.merged(&start.translated(motion.linvel));
    }
    // Endpoint AABBs miss rotating tips/offset fixtures. A sphere about the actual
    // rotation pivot contains every intermediate orientation, including compounds.
    let sphere = shape.compute_local_bounding_sphere();
    let radius = (sphere.center - motion.local_center).length() + sphere.radius;
    let start = Aabb::from_half_extents(
        motion.start * motion.local_center,
        rp::Vector::splat(radius),
    );
    start.merged(&start.translated(motion.linvel))
}

fn cast_motion(
    target: ColliderRef,
    target_shape: &dyn rp::Shape,
    target_motion: &NonlinearRigidMotion,
    shape: &dyn rp::Shape,
    motion: &NonlinearRigidMotion,
) -> Result<Option<SweepHit>, PhysicsError> {
    // Also provides meaningful geometry for stationary overlap / initial penetration.
    if let Some(contact) = contact(
        &target_motion.start,
        target_shape,
        &motion.start,
        shape,
        0.0,
    )
    .map_err(|_| PhysicsError::UnsupportedShape)?
    {
        return Ok(Some(SweepHit {
            target,
            fraction: 0.0,
            point: contact.point1.to_array(),
            normal: contact.normal1.to_array(),
            initial_overlap: true,
        }));
    }
    let hit = if target_motion.angvel == rp::Vector::ZERO {
        if target_motion.linvel == motion.linvel {
            return Ok(None);
        }
        cast_shapes(
            &target_motion.start,
            target_motion.linvel,
            target_shape,
            &motion.start,
            motion.linvel,
            shape,
            ShapeCastOptions {
                max_time_of_impact: 1.0,
                target_distance: 0.0,
                stop_at_penetration: true,
                compute_impact_geometry_on_penetration: true,
            },
        )
    } else {
        cast_shapes_nonlinear(target_motion, target_shape, motion, shape, 0.0, 1.0, true)
    }
    .map_err(|_| PhysicsError::UnsupportedShape)?;
    Ok(hit.map(|hit| {
        let at = target_motion.position_at_time(hit.time_of_impact);
        SweepHit {
            target,
            fraction: hit.time_of_impact,
            point: (at * hit.witness1).to_array(),
            normal: (at.rotation * hit.normal1).to_array(),
            initial_overlap: hit.time_of_impact == 0.0,
        }
    }))
}

#[cfg(test)]
impl StepMotion {
    pub(in crate::physics3d) fn test_exact_segments(
        &self,
        owner: rp::RigidBodyHandle,
    ) -> Vec<(
        crate::physics3d::solver_trajectory::ShapeMotion,
        Time,
        Time,
        Time,
        Time,
    )> {
        self.segments
            .iter()
            .filter_map(|row| {
                row.exact.as_ref().filter(|s| s.owner == owner).map(|s| {
                    (
                        s.motion,
                        s.start_time,
                        s.end_time,
                        row.start_fraction,
                        row.end_fraction,
                    )
                })
            })
            .collect()
    }
}
