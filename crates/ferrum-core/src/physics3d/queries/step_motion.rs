//! Tick-local target motion for projectile casts. The scene-query BVH and pipeline
//! modification lists remain untouched. All projectiles see the same sampled motion,
//! even after earlier projectiles have been clamped to their first hit.
use super::*;
use crate::physics3d::motion_time::Time;
mod file_admission;
mod finish;
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
    #[serde(skip)]
    capture_failed: bool,
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
}

impl StepMotion {
    pub(in crate::physics3d) fn stage_tick(&mut self, prior: &mut Self) {
        prior.ready = self.ready;
        prior.elapsed = self.elapsed;
        prior.capture_failed = self.capture_failed;
        std::mem::swap(&mut self.starts, &mut prior.starts);
        std::mem::swap(&mut self.segments, &mut prior.segments);
    }

    pub(in crate::physics3d) fn restore_tick(&mut self, prior: &mut Self) {
        self.ready = prior.ready;
        self.elapsed = prior.elapsed;
        self.capture_failed = prior.capture_failed;
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
        self.step_motion.capture_failed = false;
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

    pub(in crate::physics3d) fn record_interpolated_step_motion(&mut self) {
        let capture = &mut self.step_motion;
        if !capture.enabled {
            return;
        }
        if capture.starts.len() > 1 << 20
            || capture.segments.try_reserve(capture.starts.len()).is_err()
        {
            capture.invalidate_capture();
            return;
        }
        for start in &mut capture.starts {
            let Some(body) = self.backend.bodies.get(start.body) else {
                continue;
            };
            if !self.backend.colliders.contains(start.collider) {
                continue;
            }
            let end = *body.position();
            capture.segments.push(target_motion(
                start,
                rp::Vector::ZERO,
                start.pose,
                end,
                0.,
                1.,
            ));
            start.pose = end;
        }
        capture.elapsed = 1.;
    }

    pub(in crate::physics3d) fn finish_interpolated_step_motion(&mut self) {
        // Charge captured geometry and BVH topology independently of the solver.
        const MAX_CAPTURE_WORK: u64 = 32 * 1024 * 1024;
        let mut work = crate::physics3d::motion_work::Work {
            used: 0,
            limit: MAX_CAPTURE_WORK,
        };
        self.finish_step_motion(&mut work);
    }

    pub(in crate::physics3d) fn finish_step_motion(
        &mut self,
        work: &mut crate::physics3d::motion_work::Work,
    ) {
        self.step_motion.finish(&self.backend.colliders, work);
    }

    /// Casts against this tick's captured target motion, using normalized tick time.
    /// The ordinary path interpolates each target's published start and end
    /// poses. Targets that turn and return within a tick may not be observed.
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
