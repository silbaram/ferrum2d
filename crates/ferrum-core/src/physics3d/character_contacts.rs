//! Coupled capsule motion: one contact timeline for actors and prescribed obstacles.
use super::character::CharacterRuntime;
use super::character_motion::{MotionResult, MotionScene, MotionStop};
use super::colliders::native_collider;
use super::contact_policy::ContactPolicies;
use super::solver_trajectory::{Time, Work};
use super::world::native_id;
use super::BodyId;
use rapier3d::parry::bounding_volume::BoundingVolume;
use rapier3d::parry::query::{contact, NonlinearRigidMotion};
use rapier3d::prelude as rp;
use std::collections::{BTreeMap, HashMap};
pub(super) mod actual_rows;
mod angular_suffix;
#[cfg(test)]
mod pair_bound_tests;
mod solver;

#[derive(Default)]
pub(super) struct Scratch {
    actors: Vec<Actor>,
    contacts: Vec<Constraint>,
    blocked: Vec<bool>,
    solver: solver::Scratch,
    misses: HashMap<(rp::ColliderHandle, rp::ColliderHandle), LinearMiss>,
}

// A result is reusable only inside this solve, where both colliders and the
// configured skin are immutable. Preserve the sign of zero at the query edge.
#[derive(PartialEq, Eq)]
struct LinearInputs {
    source: [u32; 7],
    target: [u32; 7],
    source_velocity: [u32; 3],
    target_velocity: [u32; 3],
    remaining: u32,
}

impl LinearInputs {
    fn new(
        source: rp::Pose,
        target: rp::Pose,
        source_velocity: rp::Vector,
        target_velocity: rp::Vector,
        remaining: f32,
    ) -> Self {
        let bits = |pose: rp::Pose| {
            let [x, y, z] = pose.translation.to_array();
            let [i, j, k, w] = pose.rotation.to_array();
            [x, y, z, i, j, k, w].map(f32::to_bits)
        };
        Self {
            source: bits(source),
            target: bits(target),
            source_velocity: source_velocity.to_array().map(f32::to_bits),
            target_velocity: target_velocity.to_array().map(f32::to_bits),
            remaining: remaining.to_bits(),
        }
    }
}

struct LinearMiss {
    inputs: LinearInputs,
    cast: bool,
}

const MAX_CACHED_MISSES: usize = 512;
impl Scratch {
    pub(super) fn contact_count(&self) -> usize {
        self.contacts.len()
    }

    /// Prescribed drivers whose contact currently contributes to the coupled
    /// controller's motion. These are consumer tags for the next Native
    /// proposal. They do not publish stops, impulses or pose corrections.
    pub(super) fn moving_drivers<'a>(
        &'a self,
        world: &'a rp::PhysicsWorld,
    ) -> impl Iterator<Item = BodyId> + 'a {
        self.contacts.iter().filter_map(|contact| {
            let incoming = contact.velocity.dot(contact.normal);
            if contact.b.is_some() || !incoming.is_finite() || incoming <= 0. {
                return None;
            }
            let actor = &self.actors[contact.a];
            let driven = actor.applied.dot(contact.normal);
            if !actor.out.blocked || !driven.is_finite() || driven <= 0. {
                return None;
            }
            let parent = world.colliders.get(contact.target)?.parent()?;
            let body = world.bodies.get(parent)?;
            if body.body_type() != rp::RigidBodyType::KinematicPositionBased
                || !body.is_enabled()
                || body.is_sleeping()
                || body.angvel() != rp::Vector::ZERO
                || body.position().rotation != body.next_position().rotation
            {
                return None;
            }
            let (slot, generation) = parent.into_raw_parts();
            Some(BodyId { slot, generation })
        })
    }
}
struct Actor {
    id: BodyId,
    collider: rp::ColliderHandle,
    velocity: rp::Vector,
    applied: rp::Vector,
    carry: rp::Vector,
    applied_carry: rp::Vector,
    previous_velocity: rp::Vector,
    out: MotionResult,
    pair_casts: usize,
    pair_contacts: usize,
    pair_failures: usize,
    iterations: usize,
    limited: bool,
    blocked_by_character: bool,
}
struct Constraint {
    a: usize,
    b: Option<usize>,
    target: rp::ColliderHandle,
    source: rp::ColliderHandle,
    normal: rp::Vector,
    velocity: rp::Vector,
}
struct Hit {
    time: Time,
    safe_time: Time,
    constraint: Constraint,
}

pub(super) fn resolve(
    world: &mut rp::PhysicsWorld,
    policies: &ContactPolicies,
    scene: &MotionScene,
    characters: &mut BTreeMap<BodyId, CharacterRuntime>,
    scratch: &mut Scratch,
    dt: f32,
) {
    if characters.len() < 2 {
        return;
    }
    scratch.actors.clear();
    scratch.contacts.clear();
    scratch.misses.clear();
    for (&id, r) in characters.iter() {
        if !world
            .bodies
            .get(native_id(id))
            .is_some_and(|body| body.is_enabled())
        {
            continue;
        }
        scratch.actors.push(Actor {
            id,
            collider: native_collider(r.collider),
            velocity: r.state.translation.into(),
            applied: rp::Vector::ZERO,
            carry: r.state.carry_translation.into(),
            applied_carry: rp::Vector::ZERO,
            previous_velocity: rp::Vector::ZERO,
            out: MotionResult::default(),
            pair_casts: 0,
            pair_contacts: 0,
            pair_failures: 0,
            iterations: 0,
            limited: false,
            blocked_by_character: false,
        });
    }
    scratch.blocked.resize(scratch.actors.len(), false);
    let tolerance = 1.0e-6;
    let mut time = 0.0;
    let mut query_failed = false;
    let mut proof_work = Work {
        used: 0,
        limit: super::character_motion::trajectory::MAX_PROOF_WORK,
    };
    for _ in 0..scratch.actors.len().saturating_mul(12) {
        update_bounds(world, characters, &scratch.actors, 1.0 - time);
        let hit = match first_hit(
            world,
            policies,
            scene,
            characters,
            &mut scratch.actors,
            time,
            tolerance,
            &mut proof_work,
            &mut scratch.misses,
        ) {
            Ok(Some(hit)) => hit,
            Ok(None) => {
                match angular_suffix::correct(
                    world, policies, scene, characters, scratch, time, tolerance, false,
                ) {
                    Ok(angular_suffix::Outcome::Recast) => continue,
                    Ok(angular_suffix::Outcome::Stopped) => break,
                    Ok(angular_suffix::Outcome::Clear) => {}
                    Err(()) => {
                        fail_query(world, scene, &mut scratch.actors, time);
                        query_failed = true;
                        break;
                    }
                }
                advance(&mut scratch.actors, 1.0 - time);
                time = 1.0;
                break;
            }
            Err(()) => {
                fail_query(world, scene, &mut scratch.actors, time);
                query_failed = true;
                break;
            }
        };
        let next_time = hit.safe_time.clamp(time, 1.0);
        advance(&mut scratch.actors, next_time - time);
        time = next_time;
        let refreshed = refresh(
            world,
            scene,
            characters,
            &mut scratch.actors,
            &mut scratch.contacts,
            time,
        );
        if !refreshed {
            fail_query(world, scene, &mut scratch.actors, time);
            query_failed = true;
            break;
        }
        let c = hit.constraint;
        scratch.actors[c.a].out.blocked |= c.b.is_none();
        scratch.actors[c.a].out.hit_ceiling |= c
            .normal
            .dot(characters[&scratch.actors[c.a].id].config.up.into())
            < -0.01;
        if let Some(b) = c.b {
            scratch.actors[b].out.hit_ceiling |=
                (-c.normal).dot(characters[&scratch.actors[b].id].config.up.into()) < -0.01;
        }
        scratch.actors[c.a].blocked_by_character |= c.b.is_some();
        if let Some(b) = c.b {
            scratch.actors[b].blocked_by_character = true;
        }
        if time >= 1.0 {
            break;
        }
        if let Some(old) = scratch
            .contacts
            .iter_mut()
            .find(|old| old.a == c.a && old.target == c.target)
        {
            *old = c;
        } else {
            scratch.contacts.push(c);
        }
        for actor in &mut scratch.actors {
            actor.previous_velocity = actor.velocity;
        }
        if !solver::solve(
            &mut scratch.actors,
            &scratch.contacts,
            policies.planar,
            tolerance,
            &mut scratch.solver,
        ) {
            if stop_sources(world, scene, scratch, time, tolerance) {
                for (a, blocked) in scratch.actors.iter_mut().zip(&scratch.blocked) {
                    a.limited |= *blocked;
                }
                break;
            }
            // With only stationary constraints, rest is always feasible. This is
            // a bounded numerical fallback, reported separately from a squeeze.
            for (a, blocked) in scratch.actors.iter_mut().zip(&scratch.blocked) {
                if *blocked {
                    a.velocity = rp::Vector::ZERO;
                    a.carry = rp::Vector::ZERO;
                    a.limited = true;
                }
            }
        }
        adjust_carry(
            world,
            &mut scratch.actors,
            &scratch.contacts,
            time,
            tolerance,
        );
        // The instantaneous tangent can turn inwards on an angular
        // suffix. An endpoint projection only nominates a velocity for
        // the next complete cast against all the original colliders.
        let _ = angular_suffix::correct(
            world, policies, scene, characters, scratch, time, tolerance, true,
        );
    }
    if query_failed {
        // Only contacts from a completed census can register Native drivers.
        scratch.contacts.clear();
    }
    if time < 1.0 && !query_failed && scratch.actors.iter().all(|a| a.out.stop.is_none()) {
        for a in &mut scratch.actors {
            a.limited = true;
        }
        stop_sources(world, scene, scratch, time, -1.0);
    }
    for a in &scratch.actors {
        let Some(r) = characters.get_mut(&a.id) else {
            continue;
        };
        r.state.translation = a.applied.to_array();
        r.state.velocity = (a.applied / dt).to_array();
        r.state.carry_translation = a.applied_carry.to_array();
        if a.applied_carry.length_squared() <= 1.0e-12 {
            r.state.carried_by = None;
        }
        r.state.blocked_by_character = a.blocked_by_character;
        r.state.character_pair_casts = a.pair_casts;
        r.state.character_pair_contact_checks = a.pair_contacts;
        r.state.failed_pair_casts = a.pair_failures;
        r.state.character_coupling_iterations += a.iterations;
        r.state.character_coupling_iteration_limit |= a.limited;
        r.state.moving_obstacle_casts = a.out.casts;
        r.state.moving_obstacle_contact_checks = a.out.contact_checks;
        r.state.failed_moving_obstacle_casts = a.out.failures;
        r.state.failed_moving_obstacle_contacts = a.out.contact_failures;
        r.state.blocked_by_moving_obstacle = a.out.blocked;
        r.state.hit_ceiling |= a.out.hit_ceiling;
        if a.out.hit_ceiling {
            r.state.vertical_speed = 0.0;
        }
        r.motion_stop.clone_from(&a.out.stop);
        if let Some(fraction) = a.out.carry_fraction {
            if fraction <= r.carry_fraction {
                r.carry_fraction = fraction;
                r.carry_blocker = a.out.carry_blocker;
            }
        }
        if let Some(body) = world.bodies.get_mut(native_id(a.id)) {
            body.set_next_kinematic_position(
                rp::Pose::from_translation(a.applied) * *body.position(),
            );
        }
    }
}
fn adjust_carry(
    world: &rp::PhysicsWorld,
    actors: &mut [Actor],
    contacts: &[Constraint],
    time: Time,
    tolerance: f32,
) {
    for (index, a) in actors.iter_mut().enumerate() {
        let correction = a.velocity - a.previous_velocity;
        let amount = correction.length();
        if amount <= tolerance {
            continue;
        }
        let direction = correction / amount;
        let removed = (-a.carry.dot(direction)).max(0.0).min(amount);
        if removed > tolerance {
            a.carry += direction * removed;
            if a.out.carry_fraction.is_none() {
                a.out.carry_fraction = Some(time);
                a.out.carry_blocker = contacts.iter().find_map(|c| {
                    let (handle, normal) = if c.a == index {
                        (c.target, c.normal)
                    } else if c.b == Some(index) {
                        (c.source, -c.normal)
                    } else {
                        return None;
                    };
                    if normal.dot(direction) <= 0.0 {
                        return None;
                    }
                    world.colliders[handle].parent().map(|body| {
                        let (slot, generation) = body.into_raw_parts();
                        BodyId { slot, generation }
                    })
                });
            }
        }
    }
}
fn advance(actors: &mut [Actor], dt: Time) {
    for a in actors {
        a.applied += a.velocity * dt as f32;
        a.applied_carry += a.carry * dt as f32;
    }
}
/// Conservative earliest hit time of two linearly moving capsules, or `None`
/// when they may already be within `margin` (contact prediction, which also
/// covers the cast's skin target distance). The f64 segment distance loses a
/// margin far above the f32 pose/GJK error, so the pair's real contact check
/// reports no contact and any cast hit time is at or after the bound.
#[allow(clippy::too_many_arguments)]
fn capsule_pair_hit_lower_bound(
    a: &rp::Capsule,
    a_pose: &rp::Pose,
    a_velocity: rp::Vector,
    b: &rp::Capsule,
    b_pose: &rp::Pose,
    b_velocity: rp::Vector,
    margin: f32,
    time: Time,
) -> Option<Time> {
    let point = |pose: &rp::Pose, p: rp::Vector| (*pose * p).to_array().map(f64::from);
    let (p1, q1) = (point(a_pose, a.segment.a), point(a_pose, a.segment.b));
    let (p2, q2) = (point(b_pose, b.segment.a), point(b_pose, b.segment.b));
    let scale = [p1, q1, p2, q2]
        .iter()
        .flatten()
        .fold(1.0_f64, |m, v| m.max(v.abs()));
    if !scale.is_finite() {
        return None;
    }
    let gap = super::character_geometry::segment_distance(p1, q1, p2, q2)
        - f64::from(a.radius)
        - f64::from(b.radius)
        - (1.0e-3 + scale * 1.0e-6);
    let margin = f64::from(margin);
    // NaN never proves separation.
    if gap.is_nan() || gap <= margin {
        return None;
    }
    let speed = (a_velocity - b_velocity)
        .to_array()
        .map(f64::from)
        .iter()
        .map(|v| v * v)
        .sum::<f64>()
        .sqrt();
    if !speed.is_finite() {
        return None;
    }
    Some(if speed == 0.0 {
        Time::INFINITY
    } else {
        time + (gap - margin) / (speed * (1.0 + 1.0e-9))
    })
}

fn actor_pose(world: &rp::PhysicsWorld, actor: &Actor) -> rp::Pose {
    rp::Pose::from_translation(actor.applied) * *world.colliders[actor.collider].position()
}
fn update_bounds(
    world: &mut rp::PhysicsWorld,
    chars: &BTreeMap<BodyId, CharacterRuntime>,
    actors: &[Actor],
    remaining: Time,
) {
    for a in actors {
        let c = &world.colliders[a.collider];
        let start = c.shape().compute_aabb(&actor_pose(world, a));
        let bounds = start
            .merged(&start.translated(a.velocity * remaining as f32))
            .loosened(chars[&a.id].config.skin_width);
        world
            .broad_phase
            .set_aabb(&world.integration_parameters, a.collider, bounds);
    }
}
// Keep the world, policy, motion, actor and query-budget inputs explicit at
// this geometric query boundary.
#[allow(clippy::too_many_arguments)]
fn first_hit(
    world: &rp::PhysicsWorld,
    policies: &ContactPolicies,
    scene: &MotionScene,
    chars: &BTreeMap<BodyId, CharacterRuntime>,
    actors: &mut [Actor],
    time: Time,
    tolerance: f32,
    work: &mut Work,
    misses: &mut HashMap<(rp::ColliderHandle, rp::ColliderHandle), LinearMiss>,
) -> Result<Option<Hit>, ()> {
    let mut first: Option<Hit> = None;
    let remaining = 1.0 - time;
    let legacy_paths = scene.uses_only_legacy_paths();
    for i in 0..actors.len() {
        let id = actors[i].id;
        let a = &world.colliders[actors[i].collider];
        let pose = actor_pose(world, &actors[i]);
        let v = actors[i].velocity;
        let skin = chars[&id].config.skin_width;
        let start = a.shape().compute_aabb(&pose);
        let bounds = start
            .merged(&start.translated(v * remaining as f32))
            .loosened(skin);
        let pipeline = world.query_pipeline_with_filter(rp::QueryFilter {
            flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
            groups: Some(a.collision_groups()),
            exclude_rigid_body: Some(native_id(id)),
            ..rp::QueryFilter::default()
        });
        for (handle, b) in pipeline.intersect_aabb_conservative(bounds) {
            if !b.is_enabled() || !policies.pair_allows(a.parent(), b.parent()) {
                continue;
            }
            let target_id = b.parent().map(|h| {
                let (slot, generation) = h.into_raw_parts();
                BodyId { slot, generation }
            });
            let other = target_id.and_then(|id| actors.binary_search_by_key(&id, |a| a.id).ok());
            if other.is_some_and(|j| j <= i || actors[j].collider != handle) {
                continue;
            }
            let target_skin =
                other.map_or(skin, |j| skin.max(chars[&actors[j].id].config.skin_width));
            if let Some(j) = other {
                // Exact pruning: a separated linear character pair whose earliest
                // possible hit is after this tick or after the current first hit
                // cannot become `first`. Its contact check and cast are counted
                // as the full evaluation would count them (no contact, one cast).
                let lower = (!policies.has_one_way(handle) && !scene.has_path(handle))
                    .then(|| {
                        capsule_pair_hit_lower_bound(
                            a.shape().as_capsule()?,
                            &pose,
                            v,
                            b.shape().as_capsule()?,
                            &actor_pose(world, &actors[j]),
                            actors[j].velocity,
                            target_skin * 1.01,
                            time,
                        )
                    })
                    .flatten();
                if lower.is_some_and(|lower| {
                    lower > 1.0 || first.as_ref().is_some_and(|hit| lower > hit.time)
                }) {
                    actors[i].pair_contacts += 1;
                    actors[j].pair_contacts += 1;
                    actors[i].pair_casts += 1;
                    actors[j].pair_casts += 1;
                    continue;
                }
            }
            let stationary;
            let motion = if let Some(j) = other {
                stationary = NonlinearRigidMotion::new(
                    rp::Pose::from_translation(-actors[j].velocity * time as f32)
                        * actor_pose(world, &actors[j]),
                    rp::Vector::ZERO,
                    actors[j].velocity,
                    rp::Vector::ZERO,
                );
                &stationary
            } else if let Some(m) = scene.get(handle) {
                m
            } else {
                stationary = NonlinearRigidMotion::constant_position(*b.position());
                &stationary
            };
            let at = scene.target_pose(handle, motion, time);
            if !policies.one_way_allows_at(handle, &at, a.shape(), &pose) {
                continue;
            }
            if let Some(j) = other {
                actors[i].pair_contacts += 1;
                actors[j].pair_contacts += 1;
            } else {
                actors[i].out.contact_checks += 1;
            }
            let key = (actors[i].collider, handle);
            let linear = (legacy_paths && motion.angvel == rp::Vector::ZERO)
                .then(|| LinearInputs::new(pose, at, v, motion.linvel, remaining as f32));
            if let Some(miss) = linear
                .as_ref()
                .and_then(|inputs| misses.get(&key).filter(|cached| inputs == &cached.inputs))
            {
                if miss.cast {
                    if let Some(j) = other {
                        actors[i].pair_casts += 1;
                        actors[j].pair_casts += 1;
                    } else {
                        actors[i].out.casts += 1;
                    }
                }
                continue;
            }
            let contact_result = if other.is_some() {
                Ok(super::character_geometry::contact(
                    b,
                    &at,
                    a,
                    &pose,
                    target_skin * 1.01,
                ))
            } else {
                contact(&at, b.shape(), &pose, a.shape(), target_skin * 1.01)
            };
            let touching = match contact_result {
                Ok(c) => c,
                Err(_) => {
                    actors[i].out.contact_failures += 1;
                    return Err(());
                }
            };
            let mut found = touching.and_then(|c| {
                let normal = stable_normal(super::character_geometry::target_normal(
                    b, &at, c.point1, c.normal1,
                ));
                let target_v = scene.target_velocity(handle, motion, time, c.point1);
                ((v - target_v).dot(normal) < -motion_tolerance(v, target_v, tolerance))
                    .then_some((time, time, normal, target_v))
            });
            if found.is_none() {
                if touching.is_some() && motion.angvel == rp::Vector::ZERO {
                    if let Some(inputs) = linear {
                        if misses.len() < MAX_CACHED_MISSES {
                            misses.insert(
                                key,
                                LinearMiss {
                                    inputs,
                                    cast: false,
                                },
                            );
                        }
                    }
                    continue;
                }
                if let Some(j) = other {
                    actors[i].pair_casts += 1;
                    actors[j].pair_casts += 1;
                } else {
                    actors[i].out.casts += 1;
                }
                let result = scene.cast_target(
                    handle,
                    b.shape(),
                    motion,
                    a.shape(),
                    &pose,
                    v,
                    time,
                    target_skin,
                    work,
                );
                match result {
                    Ok(Some(hit)) => {
                        let t = hit.hit_time;
                        let at = scene.target_pose(handle, motion, t);
                        let at_character = rp::Pose::from_translation(v * (t - time) as f32) * pose;
                        let n = if other.is_some() {
                            super::character_geometry::contact(b, &at, a, &at_character, f32::MAX)
                                .map_or(hit.normal, |c| c.normal1)
                        } else {
                            hit.normal
                        };
                        let n = stable_normal(super::character_geometry::target_normal(
                            b, &at, hit.point, n,
                        ));
                        let threshold = motion_tolerance(v, hit.velocity, tolerance);
                        if (v - hit.velocity).dot(n) < -threshold {
                            let mut safe = hit.safe_time;
                            if motion.angvel == rp::Vector::ZERO
                                && a.shape().as_capsule().is_some()
                                && (b.shape().as_capsule().is_some()
                                    || b.shape().as_cuboid().is_some())
                                && (n.to_array().into_iter().filter(|x| *x != 0.).count() > 1
                                    || (v.cross(n) == rp::Vector::ZERO
                                        && hit.velocity.cross(n) == rp::Vector::ZERO))
                            {
                                // The crowd solver accepts a small inward residual on
                                // each row. Leave room for that residual when choosing
                                // how far to advance freely before activating this row.
                                // For an axial contact, preserve the timing of any
                                // independent tangential motion on either body.
                                let relative_speed =
                                    (v.as_dvec3() - hit.velocity.as_dvec3()).length();
                                let allowance = (f64::from(threshold) * 0.5 * remaining)
                                    .min(f64::from(target_skin));
                                safe = (safe - allowance / relative_speed).max(time);
                            }
                            found = Some((t, safe, n, hit.velocity));
                        }
                    }
                    Ok(None) => {
                        if let Some(inputs) = linear {
                            if misses.len() < MAX_CACHED_MISSES {
                                misses.insert(key, LinearMiss { inputs, cast: true });
                            }
                        }
                    }
                    Err(_) => {
                        if let Some(j) = other {
                            actors[i].pair_failures += 1;
                            actors[j].pair_failures += 1;
                        } else {
                            actors[i].out.failures += 1;
                        }
                        return Err(());
                    }
                }
            }
            if let Some((t, safe_time, normal, velocity)) = found {
                if first.as_ref().is_none_or(|old| {
                    t < old.time
                        || (t == old.time
                            && (i, handle.into_raw_parts())
                                < (old.constraint.a, old.constraint.target.into_raw_parts()))
                }) {
                    first = Some(Hit {
                        time: t,
                        safe_time,
                        constraint: Constraint {
                            a: i,
                            b: other,
                            target: handle,
                            source: actors[i].collider,
                            normal,
                            velocity,
                        },
                    });
                }
            }
        }
    }
    Ok(first)
}
fn refresh(
    world: &rp::PhysicsWorld,
    scene: &MotionScene,
    chars: &BTreeMap<BodyId, CharacterRuntime>,
    actors: &mut [Actor],
    contacts: &mut Vec<Constraint>,
    time: Time,
) -> bool {
    let mut valid = true;
    contacts.retain_mut(|c| {
        let a = &world.colliders[actors[c.a].collider];
        let b = &world.colliders[c.target];
        let at = c.b.map_or_else(
            || {
                scene
                    .get(c.target)
                    .map_or(*b.position(), |m| scene.target_pose(c.target, m, time))
            },
            |j| actor_pose(world, &actors[j]),
        );
        let skin = c.b.map_or(chars[&actors[c.a].id].config.skin_width, |j| {
            chars[&actors[c.a].id]
                .config
                .skin_width
                .max(chars[&actors[j].id].config.skin_width)
        });
        if let Some(j) = c.b {
            actors[c.a].pair_contacts += 1;
            actors[j].pair_contacts += 1;
        } else {
            actors[c.a].out.contact_checks += 1;
        }
        let pose = actor_pose(world, &actors[c.a]);
        let result = if c.b.is_some() {
            Ok(super::character_geometry::contact(
                b,
                &at,
                a,
                &pose,
                skin * 1.01,
            ))
        } else {
            contact(&at, b.shape(), &pose, a.shape(), skin * 1.01)
        };
        match result {
            Ok(Some(hit)) => {
                c.normal = stable_normal(super::character_geometry::target_normal(
                    b,
                    &at,
                    hit.point1,
                    hit.normal1,
                ));
                if c.b.is_none() {
                    c.velocity = scene.get(c.target).map_or(rp::Vector::ZERO, |m| {
                        scene.target_velocity(c.target, m, time, hit.point1)
                    });
                }
                true
            }
            Ok(None) => false,
            Err(_) => {
                actors[c.a].out.contact_failures += 1;
                valid = false;
                true
            }
        }
    });
    valid
}
fn residual(c: &Constraint, actors: &[Actor]) -> f32 {
    -c.normal
        .dot(actors[c.a].velocity - c.b.map_or(c.velocity, |j| actors[j].velocity))
}
fn stop_sources(
    world: &rp::PhysicsWorld,
    scene: &MotionScene,
    scratch: &mut Scratch,
    time: Time,
    tolerance: f32,
) -> bool {
    scratch.blocked.fill(false);
    for c in &scratch.contacts {
        let threshold = if tolerance < 0.0 {
            tolerance
        } else {
            contact_tolerance(c, &scratch.actors, tolerance) * 0.5
        };
        if residual(c, &scratch.actors) > threshold {
            scratch.blocked[c.a] = true;
            if let Some(b) = c.b {
                scratch.blocked[b] = true;
            }
        }
    }
    loop {
        let mut changed = false;
        for c in &scratch.contacts {
            if let Some(b) = c.b {
                if scratch.blocked[c.a] != scratch.blocked[b] {
                    scratch.blocked[c.a] = true;
                    scratch.blocked[b] = true;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    let mut any = false;
    for c in &scratch.contacts {
        if !scratch.blocked[c.a] || c.b.is_some() || scene.get(c.target).is_none() {
            continue;
        }
        let Some(body) = world.colliders[c.target].parent() else {
            continue;
        };
        let (slot, generation) = body.into_raw_parts();
        let id = BodyId { slot, generation };
        let out = &mut scratch.actors[c.a].out;
        let stop = out.stop.get_or_insert(MotionStop {
            fraction: time,
            bodies: [None; 12],
        });
        if !stop.bodies.contains(&Some(id)) {
            if let Some(slot) = stop.bodies.iter_mut().find(|slot| slot.is_none()) {
                *slot = Some(id);
            }
        }
        any = true;
    }
    any
}

fn stable_normal(normal: rp::Vector) -> rp::Vector {
    // GJK's tiny off-axis residuals must not seed sideways motion in a
    // symmetric head-on crowd and then grow through curved capsule contacts.
    let mut result = normal;
    for axis in 0..3 {
        if result[axis].abs() < 1.0e-5 {
            result[axis] = 0.0;
        }
    }
    result.try_normalize().unwrap_or(normal)
}

fn fail_query(world: &rp::PhysicsWorld, scene: &MotionScene, actors: &mut [Actor], time: Time) {
    // Unsupported geometry leaves no reliable separating normal. Hold the
    // preview and stop prescribed motion conservatively before accepting time.
    if let Some(first) = actors.first_mut() {
        first.out.stop = scene.failure_stop(world, time);
    }
}

fn motion_tolerance(a: rp::Vector, b: rp::Vector, base: f32) -> f32 {
    base * (1.0 + a.length().max(b.length()))
}
fn contact_tolerance(c: &Constraint, actors: &[Actor], base: f32) -> f32 {
    motion_tolerance(
        actors[c.a].velocity,
        c.b.map_or(c.velocity, |b| actors[b].velocity),
        base,
    )
}
