//! Relative sweeps against prescribed moving obstacles, with contact-normal sliding.
use super::contact_policy::ContactPolicies;
use super::kinematic_motion::{accepted_collider_motion, motion_bounds};
use super::solver_trajectory::{Kernel, Time};
use super::world::native_id;
use super::{BodyId, CharacterConfig, PhysicsWorld3d};
use rapier3d::parry::bounding_volume::BoundingVolume;
use rapier3d::parry::query::{contact, NonlinearRigidMotion};
use rapier3d::prelude as rp;
pub(super) mod actual_scene;
pub(super) mod angular_suffix;
pub(super) mod backend;
pub(super) mod credit;
mod feedback;
pub(super) mod native_ccd;
pub(super) mod sensors;
pub(super) mod trajectory;
pub(super) use feedback::BackendCharacterFeedback;

#[derive(Default)]
pub(super) struct MotionScene {
    #[cfg(test)]
    pub(super) experiment: super::character::experimental_tests::Experiment,
    movers: Vec<(rp::ColliderHandle, NonlinearRigidMotion)>,
    exact: Vec<Kernel>,
    paths: Vec<trajectory::ColliderPath>,
    exact_failed: bool,
    pub(super) backend_motion: backend::BackendMotionScratch,
    pub(super) credit: credit::CharacterIntervalCredit,
    pub(super) rollback: credit::StepRollback,
}
impl MotionScene {
    pub fn failure_stop(&self, world: &rp::PhysicsWorld, time: Time) -> Option<MotionStop> {
        let mut bodies = [None; 12];
        let mut count = 0;
        for &(handle, _) in &self.movers {
            let Some(parent) = world.colliders[handle].parent() else {
                continue;
            };
            if !world.bodies[parent].is_kinematic() {
                continue;
            }
            let (slot, generation) = parent.into_raw_parts();
            let body = Some(BodyId { slot, generation });
            if !bodies[..count].contains(&body) {
                bodies[count] = body;
                count += 1;
                if count == bodies.len() {
                    break;
                }
            }
        }
        (count > 0).then_some(MotionStop {
            fraction: time,
            bodies,
        })
    }
    pub fn get(&self, id: rp::ColliderHandle) -> Option<&NonlinearRigidMotion> {
        self.movers
            .binary_search_by_key(&id.into_raw_parts(), |m| m.0.into_raw_parts())
            .ok()
            .map(|i| &self.movers[i].1)
    }
}
impl PhysicsWorld3d {
    pub(super) fn prepare_character_motion(&mut self) {
        let schedule = self.kinematic_prediction_schedule();
        self.character_motion.movers.clear();
        self.character_motion.exact.clear();
        self.character_motion.paths.clear();
        self.character_motion.exact_failed = false;
        for (id, body) in self
            .backend
            .bodies
            .iter()
            .filter(|(_, b)| b.is_enabled() && (b.is_kinematic() || b.is_dynamic()))
        {
            let (slot, generation) = id.into_raw_parts();
            if self.characters.contains_key(&BodyId { slot, generation }) {
                continue;
            }
            let exact = if body.body_type() == rp::RigidBodyType::KinematicVelocityBased
                && body.angvel() != rp::Vector::ZERO
            {
                self.character_motion
                    .prepare_exact_body(id, body, &schedule)
            } else {
                None
            };
            for &h in body.colliders() {
                let Some(c) = self
                    .backend
                    .colliders
                    .get(h)
                    .filter(|c| c.is_enabled() && !c.is_sensor())
                else {
                    continue;
                };
                let motion = if body.is_dynamic() {
                    self.character_dynamics.motion(
                        body,
                        c,
                        self.backend.gravity,
                        self.backend.integration_parameters.dt,
                    )
                } else {
                    accepted_collider_motion(
                        body,
                        c,
                        self.backend.integration_parameters.dt,
                        &schedule,
                    )
                };
                if motion.linvel == rp::Vector::ZERO && motion.angvel == rp::Vector::ZERO {
                    continue;
                }
                self.backend.broad_phase.set_aabb(
                    &self.backend.integration_parameters,
                    h,
                    motion_bounds(c.shape(), &motion),
                );
                self.character_motion.movers.push((h, motion));
                if let Some(range) = &exact {
                    self.character_motion
                        .prepare_exact_collider(h, body, c, range.clone());
                }
            }
        }
        self.character_motion
            .movers
            .sort_unstable_by_key(|m| m.0.into_raw_parts());
        self.character_motion
            .paths
            .sort_unstable_by_key(|p| p.collider.into_raw_parts());
    }
}
/// A preview may stop up to twelve contacted moving bodies without allocating.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub(super) struct MotionStop {
    pub fraction: Time,
    pub bodies: [Option<BodyId>; 12],
}
#[derive(Default)]
pub(super) struct MotionResult {
    pub translation: rp::Vector,
    pub carry_translation: rp::Vector,
    pub casts: usize,
    pub failures: usize,
    pub contact_checks: usize,
    pub contact_failures: usize,
    pub blocked: bool,
    pub exhausted: bool,
    pub stop: Option<MotionStop>,
    pub hit_ceiling: bool,
    pub carry_fraction: Option<Time>,
    pub carry_blocker: Option<BodyId>,
    pub trajectory_work: u64,
}
struct Contact {
    time: Time,
    safe_time: Time,
    normal: rp::Vector,
    velocity: rp::Vector,
    handle: rp::ColliderHandle,
    body: Option<BodyId>,
}

pub(super) struct MotionQuery<'a> {
    pub world: &'a rp::PhysicsWorld,
    pub scene: &'a MotionScene,
    pub policies: &'a ContactPolicies,
    pub order: &'a [BodyId],
    pub body: BodyId,
    pub collider: &'a rp::Collider,
    pub config: &'a CharacterConfig,
}
impl MotionQuery<'_> {
    pub fn resolve(&self, desired: rp::Vector, carry: rp::Vector) -> MotionResult {
        let mut out = MotionResult {
            translation: desired,
            carry_translation: carry,
            ..MotionResult::default()
        };
        if self.scene.movers.is_empty() {
            return out;
        }
        let mut time = 0.0;
        let mut proof_work = super::solver_trajectory::Work {
            used: 0,
            limit: trajectory::MAX_PROOF_WORK,
        };
        let mut applied = rp::Vector::ZERO;
        let mut applied_carry = rp::Vector::ZERO;
        let mut carry_velocity = carry;
        let mut velocity = desired;
        let pose = *self.collider.position();
        let mut contacts: [Option<Contact>; 12] = std::array::from_fn(|_| None);
        for _ in 0..12 {
            let remaining = 1.0 - time;
            let current = rp::Pose::from_translation(applied) * pose;
            let start = self.collider.shape().compute_aabb(&current);
            let bounds = start
                .merged(&start.translated(velocity * remaining as f32))
                .loosened(self.config.skin_width);
            let pipeline = self.world.query_pipeline_with_filter(rp::QueryFilter {
                flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
                groups: Some(self.collider.collision_groups()),
                exclude_rigid_body: Some(native_id(self.body)),
                ..rp::QueryFilter::default()
            });
            let mut first: Option<Contact> = None;
            for (handle, c) in pipeline.intersect_aabb_conservative(bounds) {
                if !c.is_enabled()
                    || c.parent().is_some_and(|p| {
                        let (slot, generation) = p.into_raw_parts();
                        self.order
                            .binary_search(&BodyId { slot, generation })
                            .is_ok()
                    })
                    || !self
                        .policies
                        .pair_allows(self.collider.parent(), c.parent())
                {
                    continue;
                }
                let moving = self.scene.get(handle);
                if moving.is_none() && !out.blocked {
                    continue;
                }
                let stationary = NonlinearRigidMotion::constant_position(*c.position());
                let motion = moving.unwrap_or(&stationary);
                let at = self.scene.target_pose(handle, motion, time);
                if !self
                    .policies
                    .one_way_allows_at(handle, &at, self.collider.shape(), &current)
                {
                    continue;
                }
                // At the skin boundary a directional cast can return a late,
                // poorly conditioned GJK normal after an unrelated event split.
                // Refresh the actual closest contact before advancing time.
                out.contact_checks += 1;
                let touching = contact(
                    &at,
                    c.shape(),
                    &current,
                    self.collider.shape(),
                    self.config.skin_width * 1.01,
                );
                let touching = match touching {
                    Ok(hit) => hit,
                    Err(_) => {
                        out.contact_failures += 1;
                        out.stop = self.contact_stop(&contacts, time, Some(handle));
                        out.blocked = true;
                        out.translation = applied;
                        out.carry_translation = applied_carry;
                        return out;
                    }
                };
                let initial = touching.and_then(|h| {
                    let target_velocity =
                        self.scene.target_velocity(handle, motion, time, h.point1);
                    ((velocity - target_velocity).dot(h.normal1) < -1.0e-6).then_some(Contact {
                        time,
                        safe_time: time,
                        normal: h.normal1,
                        velocity: target_velocity,
                        handle,
                        body: c.parent().map(|id| {
                            let (slot, generation) = id.into_raw_parts();
                            BodyId { slot, generation }
                        }),
                    })
                });
                if let Some(initial) = initial {
                    if first.as_ref().is_none_or(|old| {
                        time < old.time
                            || (time == old.time
                                && handle.into_raw_parts() < old.handle.into_raw_parts())
                    }) {
                        first = Some(initial);
                    }
                    continue;
                }
                out.casts += 1;
                let before_work = proof_work.used;
                let result = self.scene.cast_target(
                    handle,
                    c.shape(),
                    motion,
                    self.collider.shape(),
                    &current,
                    velocity,
                    time,
                    self.config.skin_width,
                    &mut proof_work,
                );
                out.trajectory_work += proof_work.used - before_work;
                let hit = match result {
                    Ok(Some(hit)) => hit,
                    Ok(None) => continue,
                    Err(_) => {
                        out.failures += 1;
                        out.stop = self.contact_stop(&contacts, time, Some(handle));
                        out.blocked = true;
                        out.translation = applied;
                        out.carry_translation = applied_carry;
                        return out;
                    }
                };
                let normal = hit.normal;
                let target_velocity = hit.velocity;
                if (velocity - target_velocity).dot(normal) >= -1.0e-6 {
                    continue;
                }
                if first.as_ref().is_none_or(|old| {
                    hit.hit_time < old.time
                        || (hit.hit_time == old.time
                            && handle.into_raw_parts() < old.handle.into_raw_parts())
                }) {
                    first = Some(Contact {
                        time: hit.hit_time,
                        safe_time: hit.safe_time,
                        normal,
                        velocity: target_velocity,
                        handle,
                        body: c.parent().map(|id| {
                            let (slot, generation) = id.into_raw_parts();
                            BodyId { slot, generation }
                        }),
                    });
                }
            }
            let Some(hit) = first else {
                // A rotating surface keeps changing after its first contact.
                // A frozen tangent velocity is not a clearance certificate for
                // the suffix. Recast if actual end geometry needs more motion.
                match self
                    .angular_suffix_velocity(&contacts, &current, velocity, remaining, &mut out)
                {
                    Ok(next) if next != velocity => {
                        angular_suffix::account_suffix_carry(
                            &contacts,
                            next - velocity,
                            &mut carry_velocity,
                            time,
                            &mut out,
                        );
                        velocity = next;
                        continue;
                    }
                    Ok(_) => {}
                    Err(()) => {
                        out.stop = self.contact_stop(&contacts, time, None);
                        out.translation = applied;
                        out.carry_translation = applied_carry;
                        out.exhausted = out.stop.is_none();
                        return out;
                    }
                }
                out.translation = applied + velocity * remaining as f32;
                out.carry_translation = applied_carry + carry_velocity * remaining as f32;
                return out;
            };
            let next_time = hit.safe_time.clamp(time, 1.0);
            applied += velocity * (next_time - time) as f32;
            applied_carry += carry_velocity * (next_time - time) as f32;
            time = next_time;
            out.blocked = true;
            if hit.normal.dot(carry) < -1.0e-7 && out.carry_fraction.is_none() {
                out.carry_fraction = Some(time);
                out.carry_blocker = hit.body;
            }
            out.hit_ceiling |= hit.normal.dot(rp::Vector::from(self.config.up)) < -0.01;
            let approach = (velocity - hit.velocity).dot(hit.normal);
            let blocked_carry = (-carry_velocity.dot(hit.normal)).max(0.0).min(-approach);
            carry_velocity += hit.normal * blocked_carry;
            let contact_pose = rp::Pose::from_translation(applied) * pose;
            let (checks, failures) = self.refresh_contacts(&mut contacts, &contact_pose, time);
            out.contact_checks += checks;
            out.contact_failures += failures;
            let slot = contacts
                .iter()
                .position(|c| c.as_ref().is_some_and(|c| c.handle == hit.handle))
                .or_else(|| contacts.iter().position(Option::is_none));
            if let Some(slot) = slot {
                contacts[slot] = Some(hit);
            }
            if failures > 0 {
                out.stop = self.contact_stop(&contacts, time, None);
                out.translation = applied;
                out.carry_translation = applied_carry;
                out.exhausted = out.stop.is_none();
                return out;
            }
            let mut planes = [super::character_constraints::Plane::default(); 14];
            let mut count = 0;
            for c in contacts.iter().flatten() {
                planes[count] = super::character_constraints::Plane {
                    normal: c.normal,
                    offset: c.normal.dot(c.velocity),
                };
                count += 1;
            }
            if self.policies.planar {
                planes[count] = super::character_constraints::Plane {
                    normal: rp::Vector::Z,
                    offset: 0.0,
                };
                planes[count + 1] = super::character_constraints::Plane {
                    normal: -rp::Vector::Z,
                    offset: 0.0,
                };
                count += 2;
            }
            let Some(projected) = super::character_constraints::project(velocity, &planes[..count])
            else {
                out.stop = self.contact_stop(&contacts, time, None);
                out.translation = applied;
                out.carry_translation = applied_carry;
                out.exhausted = out.stop.is_none();
                return out;
            };
            velocity = projected;
            // A feasible endpoint correction only nominates a velocity
            // for the next complete cast. When endpoint planes conflict,
            // the original instantaneous projection still gets its cast.
            let mut endpoint_checks = MotionResult::default();
            let endpoint_candidate = self.angular_suffix_velocity(
                &contacts,
                &contact_pose,
                velocity,
                1.0 - time,
                &mut endpoint_checks,
            );
            out.contact_checks += endpoint_checks.contact_checks;
            if let Ok(next) = endpoint_candidate {
                angular_suffix::account_suffix_carry(
                    &contacts,
                    next - velocity,
                    &mut carry_velocity,
                    time,
                    &mut out,
                );
                velocity = next;
            }
            if time >= 1.0 {
                out.translation = applied;
                out.carry_translation = applied_carry;
                return out;
            }
        }
        out.translation = applied;
        out.carry_translation = applied_carry;
        out.stop = self.contact_stop(&contacts, time, None);
        out.exhausted = true;
        out
    }
    fn refresh_contacts(
        &self,
        contacts: &mut [Option<Contact>],
        pose: &rp::Pose,
        time: Time,
    ) -> (usize, usize) {
        let mut checks = 0;
        let mut failures = 0;
        for entry in contacts {
            let Some(old) = entry.as_mut() else {
                continue;
            };
            let Some(c) = self.world.colliders.get(old.handle) else {
                *entry = None;
                continue;
            };
            let stationary = NonlinearRigidMotion::constant_position(*c.position());
            let motion = self.scene.get(old.handle).unwrap_or(&stationary);
            let at = self.scene.target_pose(old.handle, motion, time);
            checks += 1;
            match contact(
                &at,
                c.shape(),
                pose,
                self.collider.shape(),
                self.config.skin_width * 1.01,
            ) {
                Ok(Some(hit)) => {
                    old.normal = hit.normal1;
                    old.velocity = self
                        .scene
                        .target_velocity(old.handle, motion, time, hit.point1);
                }
                Ok(None) => *entry = None,
                Err(_) => failures += 1,
            }
        }
        (checks, failures)
    }
    fn contact_stop(
        &self,
        contacts: &[Option<Contact>],
        time: Time,
        failed: Option<rp::ColliderHandle>,
    ) -> Option<MotionStop> {
        let mut bodies = [None; 12];
        let mut count = 0;
        // Include an unsupported pair's moving body even if no normal exists.
        let handles = failed
            .into_iter()
            .chain(contacts.iter().flatten().map(|c| c.handle));
        for handle in handles {
            let body = self
                .world
                .colliders
                .get(handle)
                .and_then(|c| c.parent())
                .map(|id| {
                    let (slot, generation) = id.into_raw_parts();
                    BodyId { slot, generation }
                });
            if self.scene.get(handle).is_some()
                && body.is_some()
                && !bodies[..count].contains(&body)
                && count < bodies.len()
            {
                bodies[count] = body;
                count += 1;
            }
        }
        (count > 0).then_some(MotionStop {
            fraction: time,
            bodies,
        })
    }
}
