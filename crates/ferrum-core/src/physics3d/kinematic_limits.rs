//! Earliest obstruction of prescribed paths. Dynamic bodies remain solver-driven.
use super::character::CharacterPreview;
use super::kinematic_motion::{accepted_collider_motion, motion_bounds};
use super::motion_time::Time;
use super::world::native_id;
use super::{BodyId, KinematicPath, PhysicsWorld3d};
use rapier3d::parry::bounding_volume::BoundingVolume;
use rapier3d::parry::query::{
    cast_shapes, cast_shapes_nonlinear, NonlinearRigidMotion, ShapeCastOptions,
};
use rapier3d::prelude as rp;

pub(super) struct PathLimit {
    pub fraction: Time,
    pub mask: u16,
    pub casts: u32,
    pub failures: u32,
    pub others: Vec<BodyId>,
}
impl PathLimit {
    fn record(&mut self, fraction: f32, mask: u16, other: Option<BodyId>) {
        self.record_precise(Time::from(fraction), mask, other);
    }
    fn record_precise(&mut self, fraction: Time, mask: u16, other: Option<BodyId>) {
        if fraction < self.fraction {
            self.fraction = fraction;
            self.mask = mask;
            self.others.clear();
            self.others.extend(other);
        } else if fraction == self.fraction {
            self.mask |= mask;
            if let Some(other) = other {
                if !self.others.contains(&other) {
                    self.others.push(other);
                }
            }
        }
    }
}

impl PhysicsWorld3d {
    pub(super) fn refresh_path_motion_queries(&mut self) {
        let schedule = self.kinematic_prediction_schedule();
        for (_, body) in self
            .backend
            .bodies
            .iter()
            .filter(|(_, b)| b.is_enabled() && b.is_kinematic())
        {
            for &id in body.colliders() {
                if let Some(collider) = self.backend.colliders.get(id).filter(|c| c.is_enabled()) {
                    let motion = accepted_collider_motion(
                        body,
                        collider,
                        self.backend.integration_parameters.dt,
                        &schedule,
                    );
                    self.backend.broad_phase.set_aabb(
                        &self.backend.integration_parameters,
                        id,
                        motion_bounds(collider.shape(), &motion),
                    );
                }
            }
        }
    }
    pub(super) fn limit_kinematic_paths(
        &self,
        paths: &[KinematicPath],
        stopped: &[Option<Time>],
        saved: &[CharacterPreview],
    ) -> PathLimit {
        let schedule = self.kinematic_prediction_schedule();
        let mut limit = PathLimit {
            fraction: 1.0,
            mask: 0,
            casts: 0,
            failures: 0,
            others: Vec::new(),
        };
        for (index, path) in paths.iter().enumerate() {
            if stopped[index].is_some() {
                continue;
            }
            let handle = native_id(path.body);
            let Some(body) = self.backend.bodies.get(handle).filter(|b| b.is_enabled()) else {
                continue;
            };
            if body.position() == body.next_position() {
                continue;
            }
            if self.actual_path_is_guarded(path.body) || Self::actual_prescribed_rotation(body) {
                // Registered paths (including linear carry) are admitted from
                // every actual full-shape interval and their final endpoint.
                // The earlier preview/free plan and BVH refresh stay intact;
                // their carry cap must not shorten this guarded command.
                continue;
            }
            for backup in saved {
                if backup.input.jump_speed == 0.0
                    && backup.state.ground.is_some_and(|g| g.body == path.body)
                {
                    if let Some(runtime) = self.characters.get(&backup.id) {
                        let carry_fraction = runtime
                            .state
                            .ground
                            .and_then(|g| self.actual_prescribed_stop(g.body))
                            .map(|seconds| {
                                (seconds / Time::from(self.config.step_seconds)).clamp(0., 1.)
                            })
                            .unwrap_or(runtime.carry_fraction);
                        if carry_fraction < 1.0 {
                            let mut mask = 1 << index;
                            if let Some(j) = paths
                                .iter()
                                .position(|p| Some(p.body) == runtime.carry_blocker)
                            {
                                if stopped[j].is_none() {
                                    mask |= 1 << j;
                                }
                            }
                            limit.record_precise(carry_fraction, mask, None);
                        }
                    }
                }
            }
            let riders = saved
                .iter()
                .filter(|backup| {
                    backup.input.jump_speed == 0.0
                        && backup.state.ground.is_some_and(|g| g.body == path.body)
                })
                .filter_map(|backup| self.backend.bodies.get(native_id(backup.id)))
                .flat_map(|rider| rider.colliders().iter().map(move |&id| (rider, id)));
            let fixtures = body.colliders().iter().map(|&id| (body, id));
            for (moving_body, collider_handle) in fixtures.chain(riders) {
                let Some(collider) = self
                    .backend
                    .colliders
                    .get(collider_handle)
                    .filter(|c| c.is_enabled() && (!c.is_sensor() || path.sweep_sensors))
                else {
                    continue;
                };
                let motion = accepted_collider_motion(
                    moving_body,
                    collider,
                    self.backend.integration_parameters.dt,
                    &schedule,
                );
                let clearance = collider
                    .parent()
                    .map(body_id)
                    .and_then(|id| self.characters.get(&id))
                    .map_or(0.0001 * self.config.length_unit, |r| r.config.skin_width);
                let bounds = motion_bounds(collider.shape(), &motion).loosened(clearance);
                let queries = self
                    .backend
                    .query_pipeline_with_filter(rp::QueryFilter::default());
                // The BVH includes swept bounds of every kinematic candidate, so
                // incoming obstacles are found without scanning the whole world per path.
                let candidates = queries
                    .intersect_aabb_conservative(bounds)
                    .filter(|(_, c)| {
                        c.parent()
                            .and_then(|id| self.backend.bodies.get(id))
                            .is_none_or(|b| !b.is_dynamic())
                    });
                for (other_handle, other) in candidates {
                    if other.parent() == Some(handle)
                        || other.parent() == collider.parent()
                        || !other.is_enabled()
                        || other.is_sensor()
                        || !collider.collision_groups().test(other.collision_groups())
                        || !self
                            .contact_policies
                            .pair_allows(collider.parent(), other.parent())
                        || !self.contact_policies.one_way_allows(
                            other_handle,
                            other,
                            collider.shape(),
                            collider.position(),
                        )
                        || !self.contact_policies.one_way_allows(
                            collider_handle,
                            collider,
                            other.shape(),
                            other.position(),
                        )
                    {
                        continue;
                    }
                    let other_id = other.parent().map(body_id);
                    // Supported riders are swept by the controller with its skin and
                    // locomotion rules above; their old pose is not an obstacle.
                    if saved.iter().any(|backup| {
                        Some(backup.id) == other_id
                            && backup.input.jump_speed == 0.0
                            && backup.state.ground.is_some_and(|g| g.body == path.body)
                    }) {
                        continue;
                    }
                    let other_body = other.parent().and_then(|id| self.backend.bodies.get(id));
                    let other_motion = other_body.map_or_else(
                        || NonlinearRigidMotion::constant_position(*other.position()),
                        |b| {
                            accepted_collider_motion(
                                b,
                                other,
                                self.backend.integration_parameters.dt,
                                &schedule,
                            )
                        },
                    );
                    if !bounds.intersects(&motion_bounds(other.shape(), &other_motion)) {
                        continue;
                    }
                    let mut mask = 1 << index;
                    if let Some(j) = paths.iter().position(|p| Some(p.body) == other_id) {
                        if stopped[j].is_none() {
                            mask |= 1 << j;
                        }
                    }
                    if let Some(support) = saved
                        .iter()
                        .find(|backup| {
                            Some(backup.id) == other_id && backup.input.jump_speed == 0.0
                        })
                        .and_then(|backup| backup.state.ground)
                    {
                        if let Some(j) = paths.iter().position(|p| p.body == support.body) {
                            if stopped[j].is_none() {
                                mask |= 1 << j;
                            }
                        }
                    }
                    limit.casts = limit.casts.saturating_add(1);
                    let result = if motion.angvel == rp::Vector::ZERO
                        && other_motion.angvel == rp::Vector::ZERO
                    {
                        cast_shapes(
                            &motion.start,
                            motion.linvel,
                            collider.shape(),
                            &other_motion.start,
                            other_motion.linvel,
                            other.shape(),
                            ShapeCastOptions {
                                max_time_of_impact: 1.0,
                                target_distance: clearance,
                                stop_at_penetration: false,
                                compute_impact_geometry_on_penetration: true,
                            },
                        )
                    } else {
                        cast_shapes_nonlinear(
                            &motion,
                            collider.shape(),
                            &other_motion,
                            other.shape(),
                            0.0,
                            1.0,
                            false,
                        )
                    };
                    match result {
                        Ok(Some(hit)) => {
                            // A scripted incoming kinematic must also stop at contact;
                            // otherwise it crosses the now-stationary dashing body.
                            let incoming = other_id.filter(|id| {
                                path.sweep_sensors
                                    && !paths.iter().any(|p| p.body == *id)
                                    && other_body.is_some_and(|b| b.is_kinematic())
                                    && (other_motion.linvel != rp::Vector::ZERO
                                        || other_motion.angvel != rp::Vector::ZERO)
                            });
                            limit.record(hit.time_of_impact.clamp(0.0, 1.0), mask, incoming);
                        }
                        Ok(None) => {}
                        Err(_) => {
                            limit.failures = limit.failures.saturating_add(1);
                            limit.record(0.0, mask, None);
                        }
                    }
                }
            }
        }
        limit
    }
}

fn body_id(handle: rp::RigidBodyHandle) -> BodyId {
    let (slot, generation) = handle.into_raw_parts();
    BodyId { slot, generation }
}
