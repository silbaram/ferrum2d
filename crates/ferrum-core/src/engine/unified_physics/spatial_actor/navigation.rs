//! Bounded terrain-guided A*. Geometry admission and actual movement use the
//! same native capsule controller; terrain metadata supplies destinations only.
use super::*;
use crate::physics3d::Pose;
use std::sync::Arc;
pub(in crate::engine) mod file_admission;
pub(in crate::engine) mod search;

#[derive(Clone, Copy, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct Point {
    pub(in crate::engine) pose: Pose,
    pub(in crate::engine) surface: u32,
}
#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct ActorNavigation {
    pub(in crate::engine) status: SpatialMoveStatus,
    actor: Option<Entity>,
    points: Option<Arc<[Point]>>,
    next: usize,
    planned: usize,
    speed: f32,
    radius: f32,
    tolerance: f32,
    cancel_on_input: bool,
    last: Option<Pose>,
    intent_start: Option<Pose>,
    intent_distance: f64,
    pub(in crate::engine) last_motion: Option<(f64, f64)>,
    requests: u32,
    searches: u32,
    request_status: u32,
    expanded: u32,
    probes: u32,
    work: u64,
    target_count: usize,
    preparation_work: u64,
}
pub(in crate::engine) enum MotionProgress {
    TowardWaypoint,
    TraveledDistance,
}

fn horizontal(a: Pose, b: Pose) -> f64 {
    (f64::from(a.position[0]) - f64::from(b.position[0]))
        .hypot(f64::from(a.position[2]) - f64::from(b.position[2]))
}
fn waypoint_progress(before: Pose, after: Pose, target: Pose) -> f64 {
    let total = horizontal(before, target) + horizontal(after, target);
    if total == 0. {
        return 0.;
    }
    // Difference of squared distances divided by their sum of lengths.
    // Form it from the actual displacement to retain tiny represented steps
    // even when both distances round to the same F64 value.
    let contribution = |i: usize| {
        let before = f64::from(before.position[i]);
        let after = f64::from(after.position[i]);
        let target = f64::from(target.position[i]);
        (after - before) * ((target - before) + (target - after))
    };
    (contribution(0) + contribution(2)) / total
}
fn distance(a: Pose, b: Pose) -> f64 {
    horizontal(a, b).hypot(f64::from(a.position[1]) - f64::from(b.position[1]))
}

impl ActorNavigation {
    pub(in crate::engine) fn from_route(
        actor: Entity,
        points: Arc<[Point]>,
        speed: f32,
        radius: f32,
        tolerance: f32,
        start: Pose,
    ) -> Self {
        Self {
            actor: Some(actor),
            planned: points.len(),
            points: Some(points),
            speed,
            radius,
            tolerance,
            last: Some(start),
            status: SpatialMoveStatus::Moving,
            ..Self::default()
        }
    }
    pub(in crate::engine) fn reject_unavailable_request(&mut self) {
        self.requests = self.requests.saturating_add(1);
        self.request_status = 3;
        self.target_count = 0;
        self.preparation_work = 0;
    }
    pub(super) fn actor(&self) -> Option<Entity> {
        self.actor
    }
    pub(in crate::engine) fn target(&self) -> Option<Pose> {
        (self.status == SpatialMoveStatus::Moving)
            .then(|| {
                self.points
                    .as_ref()
                    .and_then(|points| points.get(self.next))
                    .map(|p| p.pose)
            })
            .flatten()
    }
    pub(in crate::engine) fn is_final(&self) -> bool {
        self.points
            .as_ref()
            .is_some_and(|p| self.next + 1 == p.len())
    }
    pub(in crate::engine) fn shortcut_target(&self, pose: Pose, cell: f32) -> Option<Point> {
        if self.status != SpatialMoveStatus::Moving {
            return None;
        }
        let points = self.points.as_ref()?;
        let current = points.get(self.next)?;
        (horizontal(pose, current.pose) <= f64::from(cell))
            .then(|| points.get(self.next + 1).copied())
            .flatten()
    }
    pub(in crate::engine) fn accept_shortcut(&mut self) {
        self.next += 1;
    }
    pub(in crate::engine) fn stats(&self) -> Vec<u32> {
        vec![
            self.expanded,
            self.probes,
            self.planned as u32,
            self.points
                .as_ref()
                .map_or(0, |p| p.len().saturating_sub(self.next)) as u32,
            self.searches,
            self.work.min(u64::from(u32::MAX)) as u32,
        ]
    }
    pub(in crate::engine) fn diagnostics(&self) -> Vec<u32> {
        vec![
            1,
            self.request_status,
            self.requests,
            self.target_count as u32,
            self.preparation_work.min(u64::from(u32::MAX)) as u32,
        ]
    }
    pub(in crate::engine) fn cancel(&mut self) -> bool {
        if self.status != SpatialMoveStatus::Moving {
            return false;
        }
        self.finish(SpatialMoveStatus::Cancelled);
        true
    }
    fn finish(&mut self, status: SpatialMoveStatus) {
        self.status = status;
        self.points = None;
        self.next = 0;
        self.intent_start = None;
    }
    pub(in crate::engine) fn intent(
        &mut self,
        actor: Entity,
        pose: Pose,
        input: InputState,
        dt: f32,
    ) -> ([f32; 3], bool) {
        self.last_motion = None;
        if self.status != SpatialMoveStatus::Moving {
            return ([0.; 3], false);
        }
        if self.actor != Some(actor)
            || self
                .last
                .is_some_and(|last| distance(last, pose) > f64::from(self.tolerance))
            || self.cancel_on_input
                && (input.w != 0 || input.a != 0 || input.s != 0 || input.d != 0)
        {
            self.finish(SpatialMoveStatus::Cancelled);
            return ([0.; 3], false);
        }
        let Some(target) = self.target() else {
            self.finish(SpatialMoveStatus::Arrived);
            return ([0.; 3], true);
        };
        self.intent_start = Some(pose);
        self.intent_distance = 0.;
        let d = horizontal(pose, target);
        if d == 0. || dt <= 0. || !dt.is_finite() {
            return ([0.; 3], true);
        }
        let speed = f64::from(self.speed).min(d / f64::from(dt));
        self.intent_distance = speed * f64::from(dt);
        (
            [
                (f64::from(target.position[0] - pose.position[0]) / d * speed) as f32,
                0.,
                (f64::from(target.position[2] - pose.position[2]) / d * speed) as f32,
            ],
            true,
        )
    }
    pub(in crate::engine) fn observe(
        &mut self,
        actor: Entity,
        pose: Pose,
        grounded: bool,
        surface: Option<u32>,
        motion_progress: MotionProgress,
    ) {
        if self.status != SpatialMoveStatus::Moving || self.actor != Some(actor) {
            return;
        }
        self.last = Some(pose);
        let Some(before) = self.intent_start.take() else {
            return;
        };
        self.last_motion = Some((
            f64::from(pose.position[0]) - f64::from(before.position[0]),
            f64::from(before.position[2]) - f64::from(pose.position[2]),
        ));
        let Some(target) = self
            .points
            .as_ref()
            .and_then(|points| points.get(self.next))
        else {
            return;
        };
        let radius = if self.next + 1 == self.points.as_ref().map_or(0, |p| p.len()) {
            self.radius.max(self.tolerance)
        } else {
            self.tolerance
        };
        if grounded
            && surface == Some(target.surface)
            && horizontal(pose, target.pose) <= f64::from(radius)
            && (pose.position[1] - target.pose.position[1]).abs() <= self.tolerance * 4.
        {
            self.next += 1;
            if self.next == self.points.as_ref().map_or(0, |p| p.len()) {
                self.finish(SpatialMoveStatus::Arrived);
            }
        } else if grounded {
            let progress = match motion_progress {
                MotionProgress::TowardWaypoint => waypoint_progress(before, pose, target.pose),
                MotionProgress::TraveledDistance => horizontal(before, pose),
            };
            if progress <= self.intent_distance * 0.001 {
                self.finish(SpatialMoveStatus::Blocked);
            }
        }
    }
    /// Account for a certified steering detour or an intentional wait. Waiting
    /// for a peer/budget must not be mistaken for a failed collision movement.
    pub(in crate::engine) fn replace_intent(&mut self, velocity: [f32; 3], dt: f32) {
        self.intent_distance = f64::from(velocity[0]).hypot(f64::from(velocity[2])) * f64::from(dt);
        if self.intent_distance == 0. {
            self.intent_start = None;
        }
    }
    #[allow(clippy::too_many_arguments)]
    fn search(
        &mut self,
        runtime: &mut UnifiedPhysicsRuntime,
        scene: &SpatialScene,
        body: BodyId,
        start: Pose,
        goal: Transform2D,
        offset: [f32; 3],
        floor: u32,
        cell: f32,
    ) -> Result<Vec<Point>, u32> {
        let seed = Pose {
            position: [goal.x - offset[0], start.position[1], -goal.y - offset[2]],
            ..start
        };
        let mut job = search::Search::new(runtime, scene, body, seed, floor, cell)?;
        let result = job.advance(runtime, scene, search::MAX_WORK);
        self.expanded = job.expanded;
        self.probes = job.probes;
        self.work = job.work;
        result?.ok_or(7)
    }
}

impl UnifiedPhysicsRuntime {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::engine) fn plan_spatial_actor_navigation(
        &mut self,
        scene: &SpatialScene,
        goal: Transform2D,
        floor: u32,
        speed: f32,
        cell: f32,
        radius: f32,
        cancel_on_input: bool,
    ) -> bool {
        let mut nav = std::mem::take(&mut self.actor_navigation);
        let previous_counters = (nav.expanded, nav.probes, nav.work, nav.searches);
        nav.requests = nav.requests.saturating_add(1);
        nav.expanded = 0;
        nav.probes = 0;
        nav.work = 0;
        nav.target_count = self.physics.collider_count();
        nav.preparation_work = (nav.target_count + scene.surfaces.len() + 1) as u64;
        nav.work = nav.preparation_work;
        let request = (|| {
            if ![goal.x, goal.y, speed, cell, radius]
                .iter()
                .all(|v| v.is_finite())
                || speed <= 0.
                || speed > 1.0e6
                || goal.x.abs() > 1.0e6
                || goal.y.abs() > 1.0e6
                || cell <= 0.
                || radius < 0.
                || floor > 65535
            {
                return Err(2);
            }
            let actor = scene.actor.ok_or(3u32)?.0;
            let body = self.spatial_actor_body(actor).map_err(|_| 3u32)?;
            let start = self.physics.body_state(body).map_err(|_| 3u32)?.pose;
            let offset = self.bindings[&(actor.id, actor.generation)].render_offset;
            nav.searches = nav.searches.saturating_add(1);
            let points = nav.search(self, scene, body, start, goal, offset, floor, cell)?;
            nav.tolerance = (self
                .physics
                .character_config(body)
                .map_err(|_| 3u32)?
                .skin_width
                * 0.1)
                .max(self.physics.config().length_unit * 0.0001);
            nav.actor = Some(actor);
            nav.planned = points.len();
            nav.points = Some(points.into());
            nav.next = 0;
            nav.speed = speed;
            nav.radius = radius;
            nav.cancel_on_input = cancel_on_input;
            nav.last = Some(start);
            nav.intent_start = None;
            nav.last_motion = None;
            nav.status = SpatialMoveStatus::Moving;
            Ok(())
        })();
        nav.request_status = request.as_ref().err().copied().unwrap_or(1);
        if request.is_err() {
            (nav.expanded, nav.probes, nav.work, nav.searches) = previous_counters;
        }
        self.actor_navigation = nav;
        request.is_ok()
    }
}

impl ActorNavigation {
    /// Cold file graph traversal; includes retained/nonmoving routes as stored.
    pub(in crate::engine) fn file_route_arc(&self) -> Option<(Option<Entity>, &Arc<[Point]>)> {
        self.points.as_ref().map(|points| (self.actor, points))
    }
    /// Caller has certified the entire graph and prepared same-value clones.
    /// Only the backing changes; no route status/cursor/history is recomputed.
    pub(in crate::engine) fn rebind_file_route_arc(
        &mut self,
        replace: &mut impl FnMut(&mut Arc<[Point]>),
    ) {
        if let Some(points) = &mut self.points {
            replace(points);
        }
    }
}

#[cfg(test)]
#[test]
fn waypoint_progress_keeps_the_sign_of_tiny_represented_motion() {
    let before = Pose::default();
    let after = Pose {
        position: [1e-15, 0., 0.],
        ..before
    };
    let waypoint = Pose {
        position: [1e6, 0., 0.],
        ..before
    };
    assert_eq!(horizontal(before, waypoint), horizontal(after, waypoint));
    assert!(waypoint_progress(before, after, waypoint) > 0.);
    assert!(waypoint_progress(after, before, waypoint) < 0.);
}
