//! Preview queries for known prescribed solver intervals. Dynamic proposals
//! are supplied by actual_scene at the solver barrier, never faked here.
use super::{MotionScene, NonlinearRigidMotion};
use crate::physics3d::solver_trajectory::{self, Curve, Domain, Kernel, ShapeMotion, Time, Work};
use rapier3d::parry::query::{cast_shapes, cast_shapes_nonlinear, ShapeCastOptions};
use rapier3d::prelude as rp;
use std::ops::Range;

pub(in crate::physics3d) const MAX_PROOF_WORK: u64 = 32 * 1024 * 1024;
const MAX_PREVIEW_INTERVALS: usize = 1 << 20;

pub(in crate::physics3d) struct ColliderPath {
    pub collider: rp::ColliderHandle,
    range: Range<usize>,
    local_center: rp::Vector,
    local_pose: rp::Pose,
}
#[derive(Clone, Copy)]
pub(in crate::physics3d) struct TargetHit {
    pub safe_time: Time,
    pub hit_time: Time,
    pub normal: rp::Vector,
    pub point: rp::Vector,
    pub velocity: rp::Vector,
}

impl MotionScene {
    pub(in crate::physics3d) fn uses_only_legacy_paths(&self) -> bool {
        self.paths.is_empty() && !self.exact_failed
    }

    pub(in crate::physics3d) fn prepare_exact_body(
        &mut self,
        id: rp::RigidBodyHandle,
        body: &rp::RigidBody,
        schedule: &(rp::IntegrationParameters, usize),
    ) -> Option<Range<usize>> {
        let count = schedule.0.num_solver_iterations.checked_mul(schedule.1);
        let Some(count) = count.filter(|n| {
            self.exact
                .len()
                .checked_add(*n)
                .is_some_and(|n| n <= MAX_PREVIEW_INTERVALS)
        }) else {
            self.exact_failed = true;
            return None;
        };
        if self.exact.try_reserve(count).is_err() {
            self.exact_failed = true;
            return None;
        }
        let start = self.exact.len();
        let n = schedule.0.num_solver_iterations;
        let duration = f64::from(schedule.0.dt);
        let mut index = 0usize;
        body.visit_kinematic_motion(id, &schedule.0, schedule.1, |m| {
            let pass = index / n;
            let substep = index % n;
            let domain = Domain {
                start: duration * pass as Time + duration * substep as Time / n as Time,
                end: duration * pass as Time + duration * (substep + 1) as Time / n as Time,
            };
            match Kernel::from_native(m, domain) {
                Ok(kernel) => self.exact.push(kernel),
                Err(_) => self.exact_failed = true,
            }
            index += 1;
        });
        Some(start..self.exact.len())
    }
    pub(in crate::physics3d) fn prepare_exact_collider(
        &mut self,
        id: rp::ColliderHandle,
        body: &rp::RigidBody,
        collider: &rp::Collider,
        range: Range<usize>,
    ) {
        if self.paths.try_reserve(1).is_err() {
            self.exact_failed = true;
            return;
        }
        self.paths.push(ColliderPath {
            collider: id,
            range,
            local_center: body.local_center_of_mass(),
            local_pose: collider.position_wrt_parent().copied().unwrap_or_default(),
        });
    }
    fn path(&self, id: rp::ColliderHandle) -> Option<&ColliderPath> {
        self.paths
            .binary_search_by_key(&id.into_raw_parts(), |p| p.collider.into_raw_parts())
            .ok()
            .map(|i| &self.paths[i])
    }
    pub(in crate::physics3d) fn target_pose(
        &self,
        id: rp::ColliderHandle,
        legacy: &NonlinearRigidMotion,
        time: Time,
    ) -> rp::Pose {
        if let Some(path) = self.path(id) {
            let rows = &self.exact[path.range.clone()];
            if let Some(last) = rows.last() {
                let clock = last.domain.end;
                let at = time * clock;
                let i = rows
                    .partition_point(|m| m.domain.end <= at)
                    .min(rows.len() - 1);
                return ShapeMotion {
                    curve: Curve::Integrated(rows[i]),
                    local_center: path.local_center,
                    local_pose: path.local_pose,
                }
                .pose(at);
            }
        }
        legacy.position_at_time(time as f32)
    }
    pub(in crate::physics3d) fn target_velocity(
        &self,
        id: rp::ColliderHandle,
        legacy: &NonlinearRigidMotion,
        time: Time,
        point: rp::Vector,
    ) -> rp::Vector {
        if let Some(path) = self.path(id) {
            let rows = &self.exact[path.range.clone()];
            if let Some(last) = rows.last() {
                let clock = last.domain.end;
                let at = time * clock;
                let i = rows
                    .partition_point(|m| m.domain.end <= at)
                    .min(rows.len() - 1);
                let motion = ShapeMotion {
                    curve: Curve::Integrated(rows[i]),
                    local_center: path.local_center,
                    local_pose: path.local_pose,
                };
                return motion.point_velocity(at, point) * clock as f32;
            }
        }
        let at = legacy.position_at_time(time as f32);
        legacy.linvel + legacy.angvel.cross(point - at * legacy.local_center)
    }

    #[allow(clippy::too_many_arguments)]
    pub(in crate::physics3d) fn cast_target(
        &self,
        id: rp::ColliderHandle,
        target: &dyn rp::Shape,
        legacy: &NonlinearRigidMotion,
        source: &dyn rp::Shape,
        current: &rp::Pose,
        velocity: rp::Vector,
        time: Time,
        skin: f32,
        work: &mut Work,
    ) -> Result<Option<TargetHit>, ()> {
        if self.exact_failed {
            return Err(());
        }
        let remaining = 1. - time;
        if let Some(path) = self.path(id) {
            let rows = &self.exact[path.range.clone()];
            let last = rows.last().ok_or(())?;
            let clock = last.domain.end;
            if clock <= 0. || !clock.is_finite() {
                return Err(());
            }
            let start = rp::Pose::from_translation(-velocity * time as f32) * current;
            let query = Kernel::from_velocity(
                rp::RigidBodyHandle::invalid(),
                Domain::new(0., clock).map_err(|_| ())?,
                start,
                velocity / clock as f32,
                rp::Vector::ZERO,
            )
            .map_err(|_| ())?;
            let query = ShapeMotion {
                curve: Curve::Integrated(query),
                local_center: rp::Vector::ZERO,
                local_pose: rp::Pose::IDENTITY,
            };
            for &row in rows {
                let from = (time * clock).max(row.domain.start);
                let until = clock.min(row.domain.end);
                if from > until {
                    continue;
                }
                let target_motion = ShapeMotion {
                    curve: Curve::Integrated(row),
                    local_center: path.local_center,
                    local_pose: path.local_pose,
                };
                // Preserve the nonlinear path's original physical-contact
                // clearance. Skin start-contact handling remains with caller.
                if let Some(hit) = solver_trajectory::cast_full_shapes(
                    target_motion,
                    target,
                    query,
                    source,
                    from,
                    until,
                    0.,
                    clock * 1e-6,
                    work,
                )
                .map_err(|_| ())?
                {
                    return Ok(Some(TargetHit {
                        safe_time: hit.safe_time / clock,
                        hit_time: hit.hit_time / clock,
                        normal: hit.contact.normal1,
                        point: hit.contact.point1,
                        velocity: target_motion.point_velocity(hit.hit_time, hit.contact.point1)
                            * clock as f32,
                    }));
                }
            }
            return Ok(None);
        }
        // The original cast supplies the contact, its ordering time and its
        // surface velocity for both linear and nonlinear predictions.
        let at = legacy.position_at_time(time as f32);
        let result = if legacy.angvel == rp::Vector::ZERO {
            cast_shapes(
                &at,
                legacy.linvel * remaining as f32,
                target,
                current,
                velocity * remaining as f32,
                source,
                ShapeCastOptions {
                    max_time_of_impact: 1.,
                    target_distance: skin,
                    stop_at_penetration: false,
                    compute_impact_geometry_on_penetration: true,
                },
            )
            .map(|hit| hit.map(|h| (time + remaining * f64::from(h.time_of_impact), h)))
        } else {
            let query = NonlinearRigidMotion::new(
                rp::Pose::from_translation(-velocity * time as f32) * current,
                rp::Vector::ZERO,
                velocity,
                rp::Vector::ZERO,
            );
            cast_shapes_nonlinear(legacy, target, &query, source, time as f32, 1., false)
                .map(|hit| hit.map(|h| (f64::from(h.time_of_impact), h)))
        }
        .map_err(|_| ())?;
        let Some((impact_time, h)) = result else {
            return Ok(None);
        };
        let impact = legacy.position_at_time(impact_time as f32);
        let normal = impact.rotation * h.normal1;
        let mut safe = impact_time;
        if legacy.angvel == rp::Vector::ZERO
            && skin > 0.
            && source.as_capsule().is_some()
            && (target.as_cuboid().is_some() || target.as_capsule().is_some())
            && normal.to_array().iter().filter(|n| **n != 0.).count() > 1
        {
            let speed = (velocity.as_dvec3() - legacy.linvel.as_dvec3()).length();
            if speed > 0. && speed.is_finite() {
                if let Some(gap) = solver_trajectory::static_signed_support_lower(
                    &at, target, current, source, normal, work,
                )
                .map_err(|_| ())?
                {
                    // Bound the preview's first advance from the starting separation.
                    // A converged GJK simplex can still place its face witnesses
                    // inside the shapes. Its time remains the contact ordering key.
                    let travel = (gap - f64::from(skin)).next_down().max(0.);
                    let lower = (time + (travel / speed.next_up()).next_down())
                        .next_down()
                        .max(time);
                    if (impact_time - lower) * speed <= f64::from(skin) {
                        safe = safe.min(lower);
                    }
                }
            }
        }
        let point = impact * h.witness1;
        Ok(Some(TargetHit {
            safe_time: safe,
            hit_time: impact_time,
            normal,
            point,
            velocity: legacy.linvel + legacy.angvel.cross(point - impact * legacy.local_center),
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oblique_linear_preview_stops_its_free_advance_before_the_capsule_skin() {
        let rotation = rp::Rotation::from_rotation_y(0.3);
        let pose = |x| rp::Pose::from_parts(rotation * (rp::Vector::X * x), rotation);
        let wall = rp::Cuboid::new(rp::Vector::new(0.25, 2., 5.));
        let capsule = rp::Capsule::new_y(0.25, 0.25);
        let surface = NonlinearRigidMotion::new(
            pose(3.),
            rp::Vector::ZERO,
            pose(-3.).translation - pose(3.).translation,
            rp::Vector::ZERO,
        );
        let source = pose(0.);
        let skin = 0.01;
        let hit = MotionScene::default()
            .cast_target(
                rp::ColliderHandle::invalid(),
                &wall,
                &surface,
                &capsule,
                &source,
                rp::Vector::ZERO,
                0.,
                skin,
                &mut Work {
                    used: 0,
                    limit: MAX_PROOF_WORK,
                },
            )
            .unwrap()
            .unwrap();
        let at = surface.position_at_time(hit.safe_time as f32);
        let face = at * (-rp::Vector::X * wall.half_extents.x);
        let n = (at.rotation * -rp::Vector::X).as_dvec3().normalize();
        let separation =
            (source.translation.as_dvec3() - face.as_dvec3()).dot(n) - f64::from(capsule.radius);
        assert!(separation >= f64::from(skin), "{separation}");
        assert!(hit.safe_time <= hit.hit_time);
    }
}
