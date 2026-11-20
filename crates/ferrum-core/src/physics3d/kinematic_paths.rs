//! Piecewise prescribed motion inside one fixed tick, including turnarounds.
use super::solver_trajectory::Time;
use super::types::{valid_pose, validate_plane};

mod character_admission;
mod event_prefix;
pub(super) mod wake_join;
use super::world::{native_id, native_pose};
use super::{BodyId, CharacterState, PhysicsError, PhysicsWorld3d, Pose};
use rapier3d::prelude as rp;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct KinematicPath {
    pub body: BodyId,
    pub sweep_sensors: bool,
    /// Increasing normalized tick times; the final time is exactly one.
    #[serde(with = "crate::checkpoint_codec::vector")]
    pub knots: Vec<(f32, Pose)>,
}

#[derive(Default, serde::Serialize, serde::Deserialize)]
pub(super) struct PathScratch {
    cuts: Vec<Time>,
    ids: Vec<BodyId>,
    stopped: Vec<Option<Time>>,
    stopped_bodies: Vec<BodyId>,
    pending_stops: Vec<BodyId>,
    preview: Vec<super::character::CharacterPreview>,
    targets: Vec<(rp::RigidBodyHandle, rp::Pose, rp::Pose)>,
    characters: Vec<(BodyId, CharacterState)>,
}

impl PhysicsWorld3d {
    fn publish_actual_path_stops(
        &mut self,
        scratch: &mut PathScratch,
        dt: Time,
    ) -> Result<(), PhysicsError> {
        self.charge_actual_stop_work(
            scratch.ids.len() + scratch.targets.len(),
            scratch.stopped_bodies.len(),
        )?;
        for index in 0..scratch.ids.len() {
            let body = scratch.ids[index];
            let Some(seconds) = self.actual_prescribed_stop(body) else {
                continue;
            };
            let fraction = (seconds / dt).clamp(0., 1.);
            let first = scratch.stopped[index].is_none();
            scratch.stopped[index] =
                Some(scratch.stopped[index].map_or(fraction, |old| old.min(fraction)));
            if !scratch.stopped_bodies.contains(&body) {
                if scratch.stopped_bodies.try_reserve(1).is_err() {
                    self.character_motion
                        .backend_motion
                        .fail(super::solver_trajectory::TrajectoryError::WorkLimit);
                    return Err(PhysicsError::CapacityExceeded);
                }
                scratch.stopped_bodies.push(body);
            }
            if first {
                self.record_path_stop();
            }
            for runtime in self
                .characters
                .values_mut()
                .filter(|r| r.state.carried_by == Some(body))
            {
                runtime.carry_fraction = runtime.carry_fraction.min(fraction);
            }
        }
        for index in 0..scratch.targets.len() {
            let (slot, generation) = scratch.targets[index].0.into_raw_parts();
            let body = BodyId { slot, generation };
            let Some(seconds) = self.actual_prescribed_stop(body) else {
                continue;
            };
            if !scratch.stopped_bodies.contains(&body) {
                if scratch.stopped_bodies.try_reserve(1).is_err() {
                    self.character_motion
                        .backend_motion
                        .fail(super::solver_trajectory::TrajectoryError::WorkLimit);
                    return Err(PhysicsError::CapacityExceeded);
                }
                scratch.stopped_bodies.push(body);
            }
            for runtime in self
                .characters
                .values_mut()
                .filter(|r| r.state.carried_by == Some(body))
            {
                runtime.carry_fraction = runtime.carry_fraction.min((seconds / dt).clamp(0., 1.));
            }
        }
        Ok(())
    }
    pub(crate) fn kinematic_path_progress(&self, body: BodyId) -> (f32, bool) {
        let (fraction, stopped) = self.kinematic_path_progress_precise(body);
        (fraction as f32, stopped)
    }

    /// Execution authority for future prescribed motion; the f32 getter is an observer only.
    pub(crate) fn kinematic_path_progress_precise(&self, body: BodyId) -> (Time, bool) {
        let stop = self
            .path_scratch
            .ids
            .iter()
            .position(|&id| id == body)
            .and_then(|i| self.path_scratch.stopped[i]);
        (stop.unwrap_or(1.0), stop.is_some())
    }

    pub(crate) fn carried_character_count(&self, paths: &[KinematicPath]) -> u32 {
        self.characters
            .values()
            .filter(|r| {
                r.state
                    .carried_by
                    .is_some_and(|id| paths.iter().any(|p| p.body == id))
            })
            .count() as u32
    }

    pub(crate) fn step_with_kinematic_paths(
        &mut self,
        paths: &[KinematicPath],
    ) -> Result<(), PhysicsError> {
        if paths.is_empty() {
            return self.step_checked();
        }
        // Complete validation before consuming controller input, force or events.
        if paths.len() > 16 {
            return Err(PhysicsError::CapacityExceeded);
        }
        for (i, path) in paths.iter().enumerate() {
            if paths[..i].iter().any(|p| p.body == path.body)
                || path.knots.is_empty()
                || path.knots.len() > 4
            {
                return Err(PhysicsError::InvalidBody);
            }
            let body = self
                .backend
                .bodies
                .get(native_id(path.body))
                .ok_or(PhysicsError::StaleBody)?;
            if !body.is_kinematic() || body.body_type() != rp::RigidBodyType::KinematicPositionBased
            {
                return Err(PhysicsError::WrongBodyKind);
            }
            if self.characters.contains_key(&path.body) {
                return Err(PhysicsError::CharacterControlled);
            }
            let mut previous = 0.0;
            for &(time, pose) in &path.knots {
                if !time.is_finite() || time <= previous || time > 1.0 || !valid_pose(pose) {
                    return Err(PhysicsError::InvalidBody);
                }
                validate_plane(self.config.space, pose, [0.0; 3], [0.0; 3])?;
                if body.locked_axes().contains(rp::LockedAxes::ROTATION_LOCKED)
                    && body.rotation().to_array() != pose.rotation
                    && body.rotation().to_array() != pose.rotation.map(|v| -v)
                {
                    return Err(PhysicsError::LockedRotation);
                }
                previous = time;
            }
            if previous != 1.0 {
                return Err(PhysicsError::InvalidBody);
            }
        }
        self.step_kinematic_tick(paths);
        self.actual_motion_result()
    }

    pub(super) fn step_kinematic_tick(&mut self, paths: &[KinematicPath]) {
        let mut scratch = std::mem::take(&mut self.path_scratch);
        scratch.cuts.clear();
        scratch.cuts.push(1.0);
        scratch.stopped_bodies.clear();
        scratch.targets.clear();
        scratch.characters.clear();
        scratch.ids.clear();
        scratch.ids.extend(paths.iter().map(|p| p.body));
        scratch.stopped.clear();
        scratch.stopped.resize(paths.len(), None);
        for path in paths {
            scratch
                .cuts
                .extend(path.knots.iter().map(|k| Time::from(k.0)));
        }
        scratch.cuts.sort_unstable_by(Time::total_cmp);
        scratch.cuts.dedup();
        scratch
            .targets
            .extend(self.backend.bodies.iter().filter_map(|(id, body)| {
                let (slot, generation) = id.into_raw_parts();
                (body.body_type() == rp::RigidBodyType::KinematicPositionBased
                    && !self.characters.contains_key(&BodyId { slot, generation }))
                .then_some((id, *body.position(), *body.next_position()))
            }));
        scratch.characters.extend(
            self.characters
                .keys()
                .map(|&id| (id, CharacterState::default())),
        );
        self.begin_fixed_step();
        if self.configure_actual_paths(paths).is_err() {
            self.finish_fixed_step();
            self.path_scratch = scratch;
            return;
        }
        let native_dt = self.backend.integration_parameters.dt;
        let dt = Time::from(native_dt);
        let mut start = 0.0;
        let mut dynamic_events = 0usize;
        let mut wake_refinements = 0;
        let dynamic_event_budget = self.characters.len().saturating_mul(32).max(32);
        'cuts: for cut in 0..scratch.cuts.len() {
            let cut_end = scratch.cuts[cut];
            let mut retry_end: Option<Time> = None;
            while start < cut_end {
                let end = retry_end.unwrap_or(cut_end).min(cut_end);
                self.character_dynamics.invalidate();
                self.backend.integration_parameters.dt =
                    match super::character_motion::backend::native_duration(dt * (end - start)) {
                        Ok(seconds) => seconds,
                        Err(error) => {
                            self.character_motion.backend_motion.fail(error);
                            break 'cuts;
                        }
                    };
                self.set_path_targets(paths, &scratch, end);
                self.refresh_queries();
                if self.capture_actual_interval_credit().is_err() {
                    break 'cuts;
                }
                let credit_start = self.actual_motion_completed_time();
                self.preview_characters(&mut scratch.preview);
                self.restore_character_preview(&scratch.preview);
                self.solve_character_dynamic_contacts();
                self.preview_characters(&mut scratch.preview);
                self.refresh_path_motion_queries();
                #[cfg(test)]
                if std::thread::current().name().is_some_and(|name| {
                    name.ends_with(
                        "full_cycle_inside_tick_preserves_rider_transport_and_motion_work",
                    )
                }) {
                    eprintln!(
                        "C12_CYCLE_PREVIEW start={start} end={end} stops={:?} stopped_bodies={:?}",
                        scratch.stopped, scratch.stopped_bodies
                    );
                    for (id, r) in &self.characters {
                        eprintln!("C12_CYCLE_RUNTIME id={id:?} state={:?} fraction={} blocker={:?} motion_stop={:?} free={:?} geometric={:?} free_carry={:?}",
                            r.state,r.carry_fraction,r.carry_blocker,r.motion_stop,r.free_velocity,r.free_translation,r.free_carry_translation);
                    }
                }
                let mut limit =
                    self.limit_kinematic_paths(paths, &scratch.stopped, &scratch.preview);
                let character_fraction = self.character_stops(
                    &scratch.preview,
                    &scratch.stopped_bodies,
                    &mut scratch.pending_stops,
                );
                if !scratch.pending_stops.is_empty() {
                    if character_fraction < limit.fraction {
                        limit.mask = 0;
                        limit.others.clear();
                        limit.fraction = character_fraction;
                    } else if character_fraction > limit.fraction {
                        scratch.pending_stops.clear();
                    }
                }
                #[cfg(test)]
                if std::thread::current().name().is_some_and(|name| {
                    name.ends_with(
                        "full_cycle_inside_tick_preserves_rider_transport_and_motion_work",
                    )
                }) {
                    eprintln!("C12_CYCLE_LIMIT start={start} end={end} fraction={} mask={} other={:?} char_fraction={character_fraction} char_stops={:?}",
                        limit.fraction,limit.mask,limit.others,scratch.pending_stops);
                }
                let mut character_stop_count = scratch.pending_stops.len();
                for other in &limit.others {
                    if !scratch.pending_stops.contains(other) {
                        scratch.pending_stops.push(*other);
                    }
                }
                self.record_path_queries(limit.casts, limit.failures, !scratch.preview.is_empty());
                let mut dynamic_fraction = self.limit_character_dynamic_motion();
                if dynamic_fraction < 1. && dynamic_events >= dynamic_event_budget {
                    // Fall back to the bounded conservative movement sweep for
                    // the suffix. Time and persistent forces still advance.
                    for runtime in self.characters.values_mut() {
                        runtime.dynamic_limited = true;
                    }
                    dynamic_fraction = 1.;
                }
                self.restore_character_preview(&scratch.preview);
                let mut dynamic_event = dynamic_fraction < limit.fraction;
                if dynamic_event {
                    limit.mask = 0;
                    scratch.pending_stops.clear();
                    limit.fraction = dynamic_fraction;
                }
                let mut impact =
                    if limit.mask == 0 && scratch.pending_stops.is_empty() && !dynamic_event {
                        end
                    } else {
                        start + (end - start) * limit.fraction
                    };
                if impact > start && impact < end && self.needs_prefix_recheck() {
                    let event = self.refine_prefix_event(
                        paths,
                        &mut scratch,
                        start,
                        impact,
                        dt,
                        limit.mask,
                        character_stop_count,
                        dynamic_event,
                        dynamic_events < dynamic_event_budget,
                        event_prefix::MAX_REFINEMENTS,
                    );
                    impact = event.impact;
                    limit.mask = event.mask;
                    character_stop_count = event.character_stops;
                    dynamic_event = event.dynamic;
                }
                if self.actual_motion_result().is_err() {
                    let _ = self.finish_actual_interval_credit(credit_start);
                    break 'cuts;
                }
                if dynamic_event {
                    dynamic_events += 1;
                }
                if impact > start {
                    self.backend.integration_parameters.dt =
                        match super::character_motion::backend::native_duration(
                            dt * (impact - start),
                        ) {
                            Ok(seconds) => seconds,
                            Err(error) => {
                                self.character_motion.backend_motion.fail(error);
                                let _ = self.finish_actual_interval_credit(credit_start);
                                break 'cuts;
                            }
                        };
                    self.set_path_targets(paths, &scratch, impact);
                    // The controller already selected these exact stop owners.
                    // Register their consumer role before the first Native
                    // interval so no unverified earlier prefix is skipped by a
                    // later promotion. Full actual admission still owns motion.
                    if let Err(error) = self.classify_preview_stop_consumers(&scratch.pending_stops)
                    {
                        self.character_motion.backend_motion.fail(error);
                        let _ = self.finish_actual_interval_credit(credit_start);
                        break 'cuts;
                    }
                    self.step_characters();
                    if let Err(error) = self.classify_coupled_drivers() {
                        self.character_motion.backend_motion.fail(error);
                        let _ = self.finish_actual_interval_credit(credit_start);
                        break 'cuts;
                    }
                    self.step_with_joints(start, impact);
                    let credited = self.finish_actual_interval_credit(credit_start).is_ok();
                    let stops = self.publish_actual_path_stops(&mut scratch, dt).is_ok();
                    let accepted = credited && stops;
                    if accepted {
                        self.finish_characters();
                    }
                    let progressed = self.actual_motion_completed_time() > credit_start;
                    if accepted || progressed {
                        for (id, total) in &mut scratch.characters {
                            if let Some(runtime) = self.characters.get(id) {
                                let current = &runtime.state;
                                for axis in 0..3 {
                                    total.translation[axis] += current.translation[axis];
                                    total.carry_translation[axis] +=
                                        current.carry_translation[axis];
                                }
                                total.carried_by = current.carried_by.or(total.carried_by);
                                total.hit_ceiling |= current.hit_ceiling;
                                total.blocked_by_character |= current.blocked_by_character;
                                total.character_pair_casts += current.character_pair_casts;
                                total.character_pair_contact_checks +=
                                    current.character_pair_contact_checks;
                                total.character_coupling_iterations +=
                                    current.character_coupling_iterations;
                                total.character_coupling_iteration_limit |=
                                    current.character_coupling_iteration_limit;
                                total.failed_pair_casts += current.failed_pair_casts;
                                total.moving_obstacle_casts += current.moving_obstacle_casts;
                                total.failed_moving_obstacle_casts +=
                                    current.failed_moving_obstacle_casts;
                                total.moving_obstacle_contact_checks +=
                                    current.moving_obstacle_contact_checks;
                                total.failed_moving_obstacle_contacts +=
                                    current.failed_moving_obstacle_contacts;
                                total.blocked_by_moving_obstacle |=
                                    current.blocked_by_moving_obstacle;
                                total.moving_obstacle_iteration_limit |=
                                    current.moving_obstacle_iteration_limit;
                                total.dropped_contacts += current.dropped_contacts;
                            }
                        }
                    }
                    if !accepted {
                        if progressed {
                            wake_refinements = 0;
                        }
                        if wake_refinements == event_prefix::MAX_REFINEMENTS {
                            break 'cuts;
                        }
                        wake_refinements += 1;
                        start = (self.actual_motion_completed_time() / dt).clamp(start, cut_end);
                        if start >= cut_end {
                            break 'cuts;
                        }
                        match self.retry_actual_wake(dt * (cut_end - start)) {
                            Ok(Some(
                                super::character_motion::backend::WakeRetry::Joined
                                | super::character_motion::backend::WakeRetry::Promoted,
                            )) => {
                                retry_end = None;
                                wake_refinements = 0;
                                continue;
                            }
                            Ok(Some(super::character_motion::backend::WakeRetry::Prefix(
                                seconds,
                            ))) => {
                                let next = start + seconds / dt;
                                if next <= start || next > cut_end {
                                    self.character_motion.backend_motion.fail(
                                        super::solver_trajectory::TrajectoryError::InvalidTime,
                                    );
                                    break 'cuts;
                                }
                                retry_end = Some(next);
                                continue;
                            }
                            _ => break 'cuts,
                        }
                    }
                    wake_refinements = 0;
                } else {
                    let _ = self.finish_actual_interval_credit(credit_start);
                }
                // Every event stops at least one new prescribed body. Zero-time
                // contacts never integrate dt=0 or consume queued character input.
                for (stop_index, &id) in scratch.pending_stops.iter().enumerate() {
                    if stop_index >= character_stop_count {
                        self.stop_prescribed_body(id);
                    } else {
                        self.stop_character_obstacle(id);
                    }
                    scratch.stopped_bodies.push(id);
                    if let Some(index) = paths.iter().position(|p| p.body == id) {
                        if scratch.stopped[index].is_none() {
                            scratch.stopped[index] = Some(impact);
                            self.record_path_stop();
                        }
                    }
                }
                for (index, stop) in scratch.stopped.iter_mut().enumerate() {
                    if limit.mask & (1 << index) != 0 && stop.is_none() {
                        *stop = Some(impact);
                        self.record_path_stop();
                    }
                }
                start = impact;
                if retry_end.is_some_and(|end| start >= end) {
                    retry_end = None;
                }
            }
        }
        self.backend.integration_parameters.dt = native_dt;
        for (id, total) in &scratch.characters {
            if let Some(runtime) = self.characters.get_mut(id) {
                runtime.state.translation = total.translation;
                runtime.state.velocity = total.translation.map(|v| v / native_dt);
                runtime.state.carried_by = total.carried_by;
                runtime.state.carry_translation = total.carry_translation;
                runtime.state.hit_ceiling = total.hit_ceiling;
                runtime.state.blocked_by_character = total.blocked_by_character;
                runtime.state.character_pair_casts = total.character_pair_casts;
                runtime.state.character_pair_contact_checks = total.character_pair_contact_checks;
                runtime.state.character_coupling_iterations = total.character_coupling_iterations;
                runtime.state.character_coupling_iteration_limit =
                    total.character_coupling_iteration_limit;
                runtime.state.failed_pair_casts = total.failed_pair_casts;
                runtime.state.moving_obstacle_casts = total.moving_obstacle_casts;
                runtime.state.failed_moving_obstacle_casts = total.failed_moving_obstacle_casts;
                runtime.state.moving_obstacle_contact_checks = total.moving_obstacle_contact_checks;
                runtime.state.failed_moving_obstacle_contacts =
                    total.failed_moving_obstacle_contacts;
                runtime.state.blocked_by_moving_obstacle = total.blocked_by_moving_obstacle;
                runtime.state.moving_obstacle_iteration_limit =
                    total.moving_obstacle_iteration_limit;
                runtime.state.dropped_contacts = total.dropped_contacts;
            }
        }
        self.finish_fixed_step();
        self.path_scratch = scratch;
    }
    fn set_path_targets(&mut self, paths: &[KinematicPath], scratch: &PathScratch, time: Time) {
        for &(id, original, target) in &scratch.targets {
            let (slot, generation) = id.into_raw_parts();
            let path_index = paths
                .iter()
                .position(|p| p.body == BodyId { slot, generation });
            if let Some(body) = self.backend.bodies.get_mut(id) {
                if scratch
                    .stopped_bodies
                    .contains(&BodyId { slot, generation })
                {
                    body.set_next_kinematic_position(*body.position());
                    continue;
                }
                let next = path_index.map_or_else(
                    || interpolate_kinematic_pose(original, target, time),
                    |index| {
                        if scratch.stopped[index].is_some() {
                            *body.position()
                        } else {
                            path_pose(original, &paths[index], time)
                        }
                    },
                );
                body.set_next_kinematic_position(next);
            }
        }
    }
}

pub(super) fn interpolate_kinematic_pose(
    start: rp::Pose,
    target: rp::Pose,
    alpha: Time,
) -> rp::Pose {
    if alpha >= 1.0 {
        return target;
    }
    // A stationary target can be revisited at any fractional TOI cut.
    // Interpolating two equal f32 values can move it by one representable
    // position and feed a spurious surface velocity to the next contact.
    if crate::physics3d::solver_trajectory::same_pose_bits(start, target) {
        return start;
    }
    rp::Pose::from_parts(
        start.translation.lerp(target.translation, alpha as f32),
        start.rotation.slerp(target.rotation, alpha as f32),
    )
}
fn path_pose(original: rp::Pose, path: &KinematicPath, time: Time) -> rp::Pose {
    let mut start = original;
    let mut start_time = 0.0;
    for &(end_time, target) in &path.knots {
        let target = native_pose(target);
        let end_time = Time::from(end_time);
        if time <= end_time {
            return interpolate_kinematic_pose(
                start,
                target,
                (time - start_time) / (end_time - start_time),
            );
        }
        start = target;
        start_time = end_time;
    }
    start
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::{
        BodyDesc, BodyKind, ColliderDesc, JointDesc, JointKind, QueryFilter, Shape, WorldConfig,
    };
    fn pose(x: f32, y: f32) -> Pose {
        Pose {
            position: [x, y, 0.0],
            ..Pose::default()
        }
    }
    fn body(w: &mut PhysicsWorld3d, kind: BodyKind, x: f32, y: f32) -> BodyId {
        w.create_body(
            BodyDesc {
                kind,
                pose: pose(x, y),
                can_sleep: false,
                ..BodyDesc::default()
            },
            ColliderDesc {
                sensor: true,
                ..ColliderDesc::new(Shape::Box {
                    half_extents: [0.5; 3],
                })
            },
        )
        .unwrap()
    }
    #[test]
    fn stationary_kinematic_targets_preserve_pose_bits_at_fractional_cuts() {
        let start = rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.36),
            rp::Rotation::from_rotation_x(0.3),
        );
        for cut in [0., 0.002, 0.25, 0.73, 1.] {
            assert!(crate::physics3d::solver_trajectory::same_pose_bits(
                interpolate_kinematic_pose(start, start, cut),
                start,
            ));
        }
    }

    #[test]
    fn path_splits_keep_other_targets_forces_joint_load_and_full_tick_motion() {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            step_seconds: 0.1,
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let platform = body(&mut w, BodyKind::KinematicPosition, -2.0, 0.0);
        let other = body(&mut w, BodyKind::KinematicPosition, 0.0, 5.0);
        let free = body(&mut w, BodyKind::Dynamic, 0.0, 10.0);
        let anchor = body(&mut w, BodyKind::Fixed, 0.0, 20.0);
        let attached = body(&mut w, BodyKind::Dynamic, 0.0, 20.0);
        let joint = w
            .create_joint(JointDesc::new(anchor, attached, JointKind::Fixed))
            .unwrap();
        w.add_force(free, [10.0, 0.0, 0.0], [0.0; 3]).unwrap();
        w.add_force(attached, [0.0, 10.0, 0.0], [0.0; 3]).unwrap();
        w.set_kinematic_target(other, pose(1.0, 5.0)).unwrap();
        w.set_step_motion_enabled(true);
        let path = KinematicPath {
            sweep_sensors: false,
            body: platform,
            knots: vec![(0.5, pose(2.0, 0.0)), (1.0, pose(-2.0, 0.0))],
        };
        w.step_with_kinematic_paths(&[path]).unwrap();
        assert!((w.body_state(other).unwrap().pose.position[0] - 1.0).abs() < 1e-6);
        assert!((w.body_state(free).unwrap().linear_velocity[0] - 1.0).abs() < 1e-5);
        assert!((w.joint_state(joint).unwrap().force - 10.0).abs() < 0.05);
        assert_eq!(w.step_statistics().backend_steps, 8);
        assert_eq!(w.config.step_seconds, 0.1);
        assert_eq!(w.backend.integration_parameters.dt, 0.1);
        let mut hits = Vec::new();
        w.sweep_step_motion(
            &Shape::Sphere { radius: 0.1 },
            pose(0.0, 0.0),
            [0.0; 3],
            &QueryFilter {
                include_sensors: true,
                ..QueryFilter::default()
            },
            &mut hits,
            32,
        )
        .unwrap();
        let hit = hits.iter().find(|h| h.target.body == platform).unwrap();
        assert!((hit.fraction - 0.175).abs() < 0.001, "{hit:?}");
        w.step();
        assert!((w.body_state(free).unwrap().linear_velocity[0] - 2.0).abs() < 1e-5);
        assert!((w.body_state(other).unwrap().pose.position[0] - 1.0).abs() < 1e-6);
    }
    #[test]
    fn invalid_path_preserves_pending_target_and_does_not_reset_step_statistics() {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.0; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let a = body(&mut w, BodyKind::KinematicPosition, 0.0, 0.0);
        let b = body(&mut w, BodyKind::Dynamic, 0.0, 10.0);
        w.step();
        let old = w.body_state(a).unwrap();
        let stats = w.step_statistics();
        w.set_kinematic_target(a, pose(2.0, 0.0)).unwrap();
        w.add_force(b, [12.0, 0.0, 0.0], [0.0; 3]).unwrap();
        for knots in [
            vec![],
            vec![(0.5, pose(1.0, 0.0))],
            vec![
                (0.7, pose(1.0, 0.0)),
                (0.6, pose(2.0, 0.0)),
                (1.0, pose(3.0, 0.0)),
            ],
        ] {
            assert!(w
                .step_with_kinematic_paths(&[KinematicPath {
                    body: a,
                    knots,
                    sweep_sensors: false
                }])
                .is_err());
            assert_eq!(w.body_state(a).unwrap(), old);
            assert_eq!(w.step_statistics(), stats);
        }
        w.step();
        assert_eq!(w.body_state(a).unwrap().pose.position[0], 2.0);
        assert!((w.body_state(b).unwrap().linear_velocity[0] - 0.2).abs() < 1e-5);
    }
    #[test]
    fn single_segment_path_matches_existing_prescribed_motion_for_120_ticks() {
        fn setup() -> (PhysicsWorld3d, BodyId, BodyId) {
            let mut w = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
            let floor = w
                .create_body(
                    crate::physics3d::BodyDesc {
                        kind: BodyKind::KinematicPosition,
                        pose: pose(0.0, -0.1),
                        ..Default::default()
                    },
                    ColliderDesc::new(Shape::Box {
                        half_extents: [4.0, 0.1, 4.0],
                    }),
                )
                .unwrap();
            let actor = w
                .create_body(
                    crate::physics3d::BodyDesc {
                        pose: pose(0.0, 1.0),
                        ..Default::default()
                    },
                    ColliderDesc::new(Shape::Sphere { radius: 0.5 }),
                )
                .unwrap();
            w.set_step_motion_enabled(true);
            (w, floor, actor)
        }
        let (mut baseline, p0, a0) = setup();
        let (mut path, p1, a1) = setup();
        for tick in 1..=120 {
            let target = pose((tick as f32 * 0.02).sin(), -0.1);
            baseline.set_kinematic_target(p0, target).unwrap();
            let step = baseline.step_checked();
            assert!(step.is_ok(), "target tick {tick}: {step:?}");
            let step = path.step_with_kinematic_paths(&[KinematicPath {
                sweep_sensors: false,
                body: p1,
                knots: vec![(1.0, target)],
            }]);
            assert!(step.is_ok(), "path tick {tick}: {step:?}");
            assert_eq!(
                baseline.body_state(p0).unwrap(),
                path.body_state(p1).unwrap(),
                "platform tick {tick}"
            );
            assert_eq!(
                baseline.body_state(a0).unwrap(),
                path.body_state(a1).unwrap(),
                "rider tick {tick}"
            );
            assert_eq!(
                baseline.step_statistics(),
                path.step_statistics(),
                "tick {tick}"
            );
        }
    }
}
