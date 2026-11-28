//! Piecewise prescribed motion inside one fixed tick, including turnarounds.
use super::motion_time::Time;
use super::types::{valid_pose, validate_plane};

mod character_admission;
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
    targets: Vec<(rp::RigidBodyHandle, rp::Pose, rp::Pose)>,
    characters: Vec<(BodyId, CharacterState)>,
}

impl PhysicsWorld3d {
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
        self.validate_kinematic_paths(paths)?;
        self.step_rapier_kinematic_tick(paths)
    }

    pub(super) fn validate_kinematic_paths(
        &self,
        paths: &[KinematicPath],
    ) -> Result<(), PhysicsError> {
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
        // Merge cuts in a small fixed buffer. The same validation is used
        // before Engine dash staging and at the direct physics entry.
        let mut cuts = [1.; 49];
        let mut count = 1;
        for path in paths {
            for &(time, _) in &path.knots[..path.knots.len() - 1] {
                cuts[count] = time;
                count += 1;
            }
        }
        let cuts = &mut cuts[..count];
        cuts.sort_unstable_by(f32::total_cmp);
        let dt = Time::from(self.backend.integration_parameters.dt);
        let mut start = 0.;
        for &cut in cuts.iter() {
            let end = Time::from(cut);
            if end > start {
                let seconds = super::motion_time::native_duration(dt * (end - start))?;
                self.validate_rapier_step_seconds(seconds)?;
                start = end;
            }
        }
        Ok(())
    }

    fn step_rapier_kinematic_tick(&mut self, paths: &[KinematicPath]) -> Result<(), PhysicsError> {
        let mut scratch = std::mem::take(&mut self.path_work);
        self.prepare_path_scratch(paths, &mut scratch);
        let native_dt = self.backend.integration_parameters.dt;
        if let Err(error) = self.begin_fixed_step() {
            self.path_work = scratch;
            return Err(error);
        }

        let mut stopped = Vec::new();
        let mut start = 0.;
        for index in 0..scratch.cuts.len() {
            let end = scratch.cuts[index];
            // Checked before tick begin by validate_kinematic_paths.
            self.backend.integration_parameters.dt = (Time::from(native_dt) * (end - start)) as f32;
            self.set_path_targets(paths, &scratch, end);
            self.step_kcc_interval(paths, &mut stopped);
            self.accumulate_character_slice(&mut scratch);
            // The stop applies to this slice. Earlier poses and contact results
            // are already committed, and the path continues from this boundary.
            for body in stopped.drain(..) {
                if let Some(index) = scratch.ids.iter().position(|&id| id == body) {
                    scratch.stopped[index] = Some(start);
                }
                scratch.stopped_bodies.push(body);
            }
            start = end;
        }
        self.backend.integration_parameters.dt = native_dt;
        self.publish_character_slices(&scratch, native_dt);
        self.finish_fixed_step();
        std::mem::swap(&mut self.path_scratch, &mut scratch);
        self.path_work = scratch;
        Ok(())
    }

    fn prepare_path_scratch(&self, paths: &[KinematicPath], scratch: &mut PathScratch) {
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
    }
    fn accumulate_character_slice(&self, scratch: &mut PathScratch) {
        for (id, total) in &mut scratch.characters {
            if let Some(runtime) = self.characters.get(id) {
                let current = &runtime.state;
                for axis in 0..3 {
                    total.translation[axis] += current.translation[axis];
                    total.carry_translation[axis] += current.carry_translation[axis];
                }
                total.carried_by = current.carried_by.or(total.carried_by);
                total.hit_ceiling |= current.hit_ceiling;
                total.blocked_by_character |= current.blocked_by_character;
                total.character_pair_casts += current.character_pair_casts;
                total.character_pair_contact_checks += current.character_pair_contact_checks;
                total.moving_obstacle_casts += current.moving_obstacle_casts;
                total.failed_moving_obstacle_casts += current.failed_moving_obstacle_casts;
                total.moving_obstacle_contact_checks += current.moving_obstacle_contact_checks;
                total.blocked_by_moving_obstacle |= current.blocked_by_moving_obstacle;
                total.dropped_contacts += current.dropped_contacts;
            }
        }
    }
    fn publish_character_slices(&mut self, scratch: &PathScratch, native_dt: f32) {
        for (id, total) in &scratch.characters {
            if let Some(runtime) = self.characters.get_mut(id) {
                runtime.state.translation = total.translation;
                runtime.state.velocity = total.translation.map(|v| v / native_dt);
                // A forward and return slice can cancel exactly while the
                // rider remains grounded on the same platform.
                runtime.state.carried_by = if total.carry_translation != [0.; 3] {
                    total.carried_by
                } else {
                    total.carried_by.filter(|&body| {
                        runtime
                            .state
                            .ground
                            .is_some_and(|ground| ground.body == body)
                    })
                };
                runtime.state.carry_translation = total.carry_translation;
                runtime.state.hit_ceiling = total.hit_ceiling;
                runtime.state.blocked_by_character = total.blocked_by_character;
                runtime.state.character_pair_casts = total.character_pair_casts;
                runtime.state.character_pair_contact_checks = total.character_pair_contact_checks;
                runtime.state.moving_obstacle_casts = total.moving_obstacle_casts;
                runtime.state.failed_moving_obstacle_casts = total.failed_moving_obstacle_casts;
                runtime.state.moving_obstacle_contact_checks = total.moving_obstacle_contact_checks;
                runtime.state.blocked_by_moving_obstacle = total.blocked_by_moving_obstacle;
                runtime.state.dropped_contacts = total.dropped_contacts;
            }
        }
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
    if crate::physics3d::geometry::same_pose_bits(start, target) {
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
        BodyDesc, BodyKind, ColliderDesc, JointDesc, JointKind, Shape, WorldConfig,
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

    fn solid(w: &mut PhysicsWorld3d, kind: BodyKind, x: f32, shape: Shape) -> BodyId {
        w.create_body(
            BodyDesc {
                kind,
                pose: pose(x, 0.),
                ..Default::default()
            },
            ColliderDesc::new(shape),
        )
        .unwrap()
    }

    #[test]
    fn rapier_path_pushes_at_a_turnaround_and_holds_at_a_late_squeeze() {
        for blocked in [false, true] {
            let mut w = PhysicsWorld3d::new(WorldConfig {
                gravity: [0.; 3],
                step_seconds: 0.1,
                ..Default::default()
            })
            .unwrap();
            let wall = Shape::Box {
                half_extents: [0.25, 2., 2.],
            };
            let moving = solid(&mut w, BodyKind::KinematicPosition, 3., wall.clone());
            let actor = solid(
                &mut w,
                BodyKind::KinematicPosition,
                0.,
                Shape::Capsule {
                    half_height: 0.25,
                    radius: 0.25,
                },
            );
            w.enable_character(actor, Default::default()).unwrap();
            let knots = if blocked {
                solid(&mut w, BodyKind::Fixed, -1.5, wall);
                vec![(0.5, pose(-0.3, 0.)), (1., pose(-3., 0.))]
            } else {
                vec![(0.5, pose(-3., 0.)), (1., pose(3., 0.))]
            };
            w.step_with_kinematic_paths(&[KinematicPath {
                body: moving,
                sweep_sensors: false,
                knots,
            }])
            .unwrap();
            let x = w.body_state(actor).unwrap().pose.position[0];
            let moving_x = w.body_state(moving).unwrap().pose.position[0];
            assert_eq!(w.step_statistics().backend_steps, 2);
            if blocked {
                assert!((moving_x + 0.3).abs() < 1e-6, "moving x={moving_x}");
                assert!((x + 0.81).abs() <= 0.005, "x={x}");
                assert_eq!(w.kinematic_path_progress(moving), (0.5, true));
                assert_eq!(w.step_statistics().kinematic_path_stops, 1);
            } else {
                assert_eq!(moving_x, 3.);
                assert!((x + 3.51).abs() <= 0.005, "x={x}");
                assert_eq!(w.kinematic_path_progress(moving), (1., false));
                assert_eq!(w.step_statistics().kinematic_path_stops, 0);
            }
        }
    }

    #[test]
    fn late_knot_stop_does_not_launch_a_box_on_a_descending_platform() {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            step_seconds: 0.1,
            ..WorldConfig::default()
        })
        .unwrap();
        let half_extents = Shape::Box {
            half_extents: [2., 0.1, 2.],
        };
        let platform = solid(
            &mut w,
            BodyKind::KinematicPosition,
            0.,
            half_extents.clone(),
        );
        let floor = solid(&mut w, BodyKind::Fixed, 0., half_extents);
        w.set_pose(floor, pose(0., -0.55)).unwrap();
        let box_id = solid(
            &mut w,
            BodyKind::Dynamic,
            0.,
            Shape::Box {
                half_extents: [0.25; 3],
            },
        );
        w.set_pose(box_id, pose(0., 0.35)).unwrap();
        w.set_body_options(
            box_id,
            &crate::physics3d::BodyOptions {
                lock_rotation: true,
                ..Default::default()
            },
        )
        .unwrap();
        for _ in 0..4 {
            w.step_checked().unwrap();
        }
        let mut held = PhysicsWorld3d::from_snapshot(&w.capture_snapshot().unwrap()).unwrap();
        let knot = pose(0., -0.1);
        let path = |end| KinematicPath {
            body: platform,
            sweep_sensors: false,
            knots: vec![(0.5, knot), (1., end)],
        };
        w.step_with_kinematic_paths(&[path(pose(0., -0.5))])
            .unwrap();
        held.step_with_kinematic_paths(&[path(knot)]).unwrap();
        assert!(w.body_state(box_id).unwrap().pose.position[1] < 0.34);
        assert!((w.body_state(platform).unwrap().pose.position[1] + 0.1).abs() < 1e-6);
        assert_eq!(w.kinematic_path_progress_precise(platform), (0.5, true));

        for tick in 0..30 {
            let state = w.body_state(box_id).unwrap();
            let expected = held.body_state(box_id).unwrap();
            assert!(
                (state.pose.position[1] - expected.pose.position[1]).abs() < 1e-5
                    && (state.linear_velocity[1] - expected.linear_velocity[1]).abs() < 1e-5,
                "tick {tick}: unexpected vertical response: {state:?}; control={expected:?}"
            );
            // After falling onto the stopped platform, the box stays at its
            // resting height within the contact tolerance.
            if tick >= 2 {
                assert!(state.pose.position[1] <= 0.255, "tick {tick}: {state:?}");
            }
            w.step_checked().unwrap();
            held.step_checked().unwrap();
        }
        let end_y = w.body_state(box_id).unwrap().pose.position[1];
        assert!((end_y - 0.25).abs() < 0.01, "box y={end_y}");
    }

    #[test]
    fn fast_rapier_path_cannot_pass_through_a_dynamic_body_without_ccd() {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            step_seconds: 0.1,
            ..Default::default()
        })
        .unwrap();
        let platform = solid(
            &mut w,
            BodyKind::KinematicPosition,
            3.,
            Shape::Box {
                half_extents: [0.1, 2., 2.],
            },
        );
        let object = solid(
            &mut w,
            BodyKind::Dynamic,
            0.,
            Shape::Box {
                half_extents: [0.1; 3],
            },
        );
        w.step_with_kinematic_paths(&[KinematicPath {
            body: platform,
            sweep_sensors: false,
            knots: vec![(1., pose(-3., 0.))],
        }])
        .unwrap();
        let platform_x = w.body_state(platform).unwrap().pose.position[0];
        let object_x = w.body_state(object).unwrap().pose.position[0];
        assert!(
            platform_x - object_x >= 0.195,
            "platform={platform_x}; object={object_x}"
        );
    }
    #[test]
    fn stationary_kinematic_targets_preserve_pose_bits_at_fractional_cuts() {
        let start = rp::Pose::from_parts(
            rp::Vector::new(0., -0.1, 0.36),
            rp::Rotation::from_rotation_x(0.3),
        );
        for cut in [0., 0.002, 0.25, 0.73, 1.] {
            assert!(crate::physics3d::geometry::same_pose_bits(
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
        let path = KinematicPath {
            sweep_sensors: false,
            body: platform,
            knots: vec![
                (0.25, pose(-1.0, 0.0)),
                (0.5, pose(2.0, 0.0)),
                (1.0, pose(-2.0, 0.0)),
            ],
        };
        let passes_per_slice = w.backend_pass_schedule().1;
        w.step_with_kinematic_paths(&[path]).unwrap();
        assert!((w.body_state(other).unwrap().pose.position[0] - 1.0).abs() < 1e-6);
        assert!((w.body_state(free).unwrap().linear_velocity[0] - 1.0).abs() < 1e-5);
        assert!((w.joint_state(joint).unwrap().force - 10.0).abs() < 0.05);
        assert_eq!(
            w.step_statistics().backend_steps,
            3 * passes_per_slice as u32
        );
        assert_eq!(w.config.step_seconds, 0.1);
        assert_eq!(w.backend.integration_parameters.dt, 0.1);
        assert_eq!(w.kinematic_path_progress(platform), (1., false));
        assert_eq!(w.body_state(platform).unwrap().pose, pose(-2.0, 0.0));
        let mut joint_events = Vec::new();
        assert_eq!(w.drain_joint_events(&mut joint_events), 0);
        w.step_checked().unwrap();
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

#[cfg(test)]
mod preflight_tests;
