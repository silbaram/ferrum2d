//! Read-only character traversal probes for native path planning and cold movement.
//! Queries share the controller's static response; they never predict moving-body
//! trajectories, consume input, integrate gravity or apply impulses.
use super::colliders::native_collider;
use super::types::{valid_pose, valid_vector, validate_plane};
use super::world::{native_id, native_pose};
use super::{BodyId, CharacterConfig, PhysicsError, PhysicsWorld3d, Pose};
use rapier3d::control::{
    CharacterCollision, CharacterLength, EffectiveCharacterMovement, KinematicCharacterController,
};
use rapier3d::parry::{bounding_volume::BoundingVolume, query::ShapeCastOptions};
use rapier3d::prelude as rp;

pub(super) fn tight_epsilon(length_unit: f32, config: &CharacterConfig) -> f32 {
    (length_unit * 1e-6).min(config.skin_width * 0.001)
}

mod tight_ground_admission;
pub(super) use tight_ground_admission::certified_tight_ground_admitted;

#[derive(Debug, Default, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct CharacterProbeScratch {
    #[serde(with = "crate::checkpoint_codec::workspace_vector")]
    collisions: Vec<CharacterCollision>,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct CharacterMotionProbe {
    pub pose: Pose,
    pub ground: Option<super::ColliderRef>,
    pub grounded: bool,
    pub sliding: bool,
    pub dropped_contacts: usize,
}

impl PhysicsWorld3d {
    /// Cold displacement: sweep against current geometry, then commit the allowed
    /// pose. No simulation tick, dynamic impulse or queued-input consumption.
    pub(crate) fn move_character_displacement(
        &mut self,
        id: BodyId,
        translation: [f32; 3],
        step: f32,
        snap: f32,
        scratch: &mut CharacterProbeScratch,
    ) -> Result<(), PhysicsError> {
        let mut config = self.character_config(id)?.clone();
        config.step_height = step;
        config.snap_distance = snap;
        config.validate(self.config.space)?;
        let pose = self.body_state(id)?.pose;
        let state = self.character_state(id)?.clone();
        let probe = self.probe_character_with_config(
            id,
            pose,
            translation,
            state.grounded,
            &config,
            false,
            scratch,
        )?;
        if probe.dropped_contacts != 0 {
            return Err(PhysicsError::CapacityExceeded);
        }
        self.set_pose(id, probe.pose)?;
        let runtime = self
            .characters
            .get_mut(&id)
            .ok_or(PhysicsError::InvalidCharacter)?;
        // A rising capsule may still be within the support probe's skin margin.
        // A cold horizontal edit must not cancel its already-consumed jump.
        let grounded = probe.grounded && state.vertical_speed <= 0.;
        runtime.state.grounded = grounded;
        runtime.state.ground = if grounded { probe.ground } else { None };
        runtime.state.sliding = probe.sliding;
        runtime.state.vertical_speed = if grounded { 0. } else { state.vertical_speed };
        runtime.state.translation =
            std::array::from_fn(|i| probe.pose.position[i] - pose.position[i]);
        Ok(())
    }

    pub(crate) fn character_config(&self, id: BodyId) -> Result<&CharacterConfig, PhysicsError> {
        self.character_state(id)?;
        Ok(&self.characters[&id].config)
    }

    /// Probe a hypothetical pose in the current world without moving any body.
    /// Dynamic bodies/characters are observed at current poses. The real fixed tick
    /// still performs relative-motion and coupled contact resolution.
    pub(crate) fn probe_character_motion(
        &mut self,
        id: BodyId,
        pose: Pose,
        translation: [f32; 3],
        grounded: bool,
        scratch: &mut CharacterProbeScratch,
    ) -> Result<CharacterMotionProbe, PhysicsError> {
        let config = self.character_config(id)?.clone();
        self.probe_character_with_config(id, pose, translation, grounded, &config, false, scratch)
    }

    /// Stable route geometry excludes moving peers; real movement still uses every body.
    pub(crate) fn probe_character_route(
        &mut self,
        id: BodyId,
        pose: Pose,
        translation: [f32; 3],
        grounded: bool,
        scratch: &mut CharacterProbeScratch,
    ) -> Result<CharacterMotionProbe, PhysicsError> {
        let config = self.character_config(id)?.clone();
        self.probe_character_with_config(id, pose, translation, grounded, &config, true, scratch)
    }

    #[allow(clippy::too_many_arguments)]
    fn probe_character_with_config(
        &mut self,
        id: BodyId,
        pose: Pose,
        translation: [f32; 3],
        grounded: bool,
        config: &CharacterConfig,
        fixed_only: bool,
        scratch: &mut CharacterProbeScratch,
    ) -> Result<CharacterMotionProbe, PhysicsError> {
        if !valid_pose(pose) || !valid_vector(&translation) {
            return Err(PhysicsError::InvalidQuery);
        }
        validate_plane(self.config.space, pose, translation, [0.; 3])?;
        self.character_state(id)?;
        self.validate_character_pose(id, pose)?;
        self.refresh_queries();
        let runtime = &self.characters[&id];
        let body = &self.backend.bodies[native_id(id)];
        let collider = &self.backend.colliders[native_collider(runtime.collider)];
        if !body.is_enabled() || !collider.is_enabled() {
            return Err(PhysicsError::InvalidCharacter);
        }
        let shape_pose = native_pose(pose)
            * collider
                .position_wrt_parent()
                .ok_or(PhysicsError::InvalidCharacter)?;
        let shape = collider.shape();
        let allows = |handle: rp::ColliderHandle, c: &rp::Collider| {
            c.is_enabled()
                && c.parent().is_none_or(|p| {
                    self.backend
                        .bodies
                        .get(p)
                        .is_some_and(|b| b.is_enabled() && (!fixed_only || b.is_fixed()))
                })
                && self
                    .contact_policies
                    .one_way_allows(handle, c, shape, &shape_pose)
                && self
                    .contact_policies
                    .pair_allows(Some(native_id(id)), c.parent())
        };
        let queries = self.backend.query_pipeline_with_filter(rp::QueryFilter {
            flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
            groups: Some(collider.collision_groups()),
            exclude_rigid_body: Some(native_id(id)),
            predicate: Some(&allows),
            ..Default::default()
        });
        let up = rp::Vector::from(config.up);
        let desired = rp::Vector::from(translation);
        let mut controller = config.controller();
        if !grounded || desired.dot(up) > 0. {
            controller.snap_to_ground = None;
        }
        let mut dropped = 0;
        let (movement, moved) = move_with_clearance(
            &self.backend,
            &queries,
            &controller,
            config,
            self.config.length_unit,
            shape,
            &shape_pose,
            desired,
            grounded && desired.dot(up) == 0.,
            &mut scratch.collisions,
            &mut dropped,
        );
        let end = Pose {
            position: std::array::from_fn(|i| pose.position[i] + moved[i]),
            ..pose
        };
        if !valid_pose(end) {
            return Err(PhysicsError::InvalidQuery);
        }
        let ground = super::character::ground_at_filtered(
            &self.backend,
            &self.contact_policies,
            id,
            collider,
            &(rp::Pose::from_translation(moved) * shape_pose),
            config,
            fixed_only,
        );
        Ok(CharacterMotionProbe {
            pose: end,
            ground,
            grounded: ground.is_some(),
            sliding: ground.is_none() && movement.is_sliding_down_slope,
            dropped_contacts: dropped,
        })
    }
}

/// Static response shared by real fixed-step movement and cold traversal probes.
#[allow(clippy::too_many_arguments)]
pub(super) fn move_with_clearance(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    controller: &KinematicCharacterController,
    config: &CharacterConfig,
    length_unit: f32,
    shape: &dyn rp::Shape,
    shape_pose: &rp::Pose,
    desired: rp::Vector,
    lift_from_ground: bool,
    collisions: &mut Vec<CharacterCollision>,
    dropped: &mut usize,
) -> (EffectiveCharacterMovement, rp::Vector) {
    let up = rp::Vector::from(config.up);
    collisions.clear();
    let mut movement = if lift_from_ground && desired.length_squared() > 0. {
        move_with_ground_clearance(
            world,
            queries,
            controller,
            config,
            length_unit,
            shape,
            shape_pose,
            desired,
            rp::Vector::ZERO,
            collisions,
            dropped,
        )
        .unwrap_or_else(held_movement)
    } else {
        move_segment(
            queries,
            controller,
            config,
            shape,
            shape_pose,
            desired,
            rp::Vector::ZERO,
            |hit| record_collision(collisions, dropped, hit),
        )
    };
    // A downward landing can lose its tangent either through zero-distance
    // skin casts or a near-flat normal that KCC classifies as unwanted sliding.
    // The legacy retry keeps its last walkable lateral endpoint. A separate
    // tight-clearance certificate below can reconsume an earlier real prefix.
    // Keep all geometry in the query, including walls on the same compound.
    // There is at most one extra KCC pass, never recursion: 20 iterations and
    // up to four stair casts per iteration. Classification may cast up twice;
    // a tight pass adds down/restore and one separately applied original snap.
    // Conservative bound: 2*(20*(1+4)+1)+4 = 206 pipeline shape casts, or
    // 2*20+4 = 44 without stairs/snap. Physical/support/continuous certificates
    // add <=16 BVH scans here; ground fallback is separately <=2 scans. Each
    // scan visits admitted colliders/compound leaves, not a constant amount of
    // shape work. Native manifolds/GJK and dense performance remain separate.
    let mut retried = false;
    // A primary skin cast can select the ceiling first, with no floor callback.
    // Keep its actual first-hit prefix; an exact finite support face can certify
    // floor proximity, but does not manufacture a TOI or a collision callback.
    if !lift_from_ground && desired.dot(up) < 0. {
        if let Some(first) = collisions.first().copied() {
            let stationary = world
                .colliders
                .get(first.handle)
                .is_some_and(|target| stationary_target(world, target));
            let epsilon = tight_epsilon(length_unit, config);
            let first_pose = rp::Pose::from_translation(first.translation_applied) * shape_pose;
            // A numerically warped primary prefix is not a valid physical path.
            // The original pose precedes every cast and is the safe rollback.
            let prefix = if geometry_clearance(queries, shape, &first_pose, epsilon, epsilon, up)
                .is_some()
            {
                first.translation_applied
            } else {
                rp::Vector::ZERO
            };
            let horizontal = desired - up * desired.dot(up) - (prefix - up * prefix.dot(up));
            if stationary && horizontal.length_squared() > (config.skin_width * 0.001).powi(2) {
                let pose = rp::Pose::from_translation(prefix) * shape_pose;
                let (lift, limited) = clearance_lift(queries, config, length_unit, shape, &pose);
                let lifted = rp::Pose::from_translation(lift) * pose;
                let full = !limited
                    && geometry_clearance(queries, shape, &lifted, config.skin_width, epsilon, up)
                        .is_some_and(|c| c.nearest > epsilon && c.overhead >= config.skin_width);
                if !full && certified_flat_support(world, queries, shape, &pose, config, epsilon) {
                    retried = true;
                    // The zero-length primary contact can have an indeterminate
                    // within-skin normal. It is query evidence, not a physical
                    // impulse row. Nonzero prefix contacts retain provenance.
                    let keep = usize::from(prefix.length_squared() > epsilon * epsilon);
                    if let Some(suffix) = move_tight_segment(
                        world,
                        queries,
                        controller,
                        config,
                        length_unit,
                        shape,
                        &pose,
                        horizontal,
                        prefix,
                        epsilon,
                        Some(keep),
                        collisions,
                        dropped,
                    ) {
                        movement.translation = prefix + suffix.translation;
                        movement.grounded = suffix.grounded;
                        movement.is_sliding_down_slope = suffix.is_sliding_down_slope;
                    } else {
                        movement.translation = prefix;
                    }
                }
            }
        }
    }
    if !retried && !lift_from_ground && desired.dot(up) < 0. && !collisions.is_empty() {
        let last = collisions[collisions.len() - 1];
        let epsilon = config.skin_width * 0.001;
        let progress = movement.translation - last.translation_applied;
        let lateral_progress = progress - up * progress.dot(up);
        let stalled = lateral_progress.length_squared() <= epsilon * epsilon;
        if let Some(target) = world
            .colliders
            .get(last.handle)
            .filter(|target| stalled && stationary_target(world, target))
        {
            let normal = super::character_geometry::target_normal(
                target,
                target.position(),
                last.hit.witness1,
                last.hit.normal1,
            );
            // Resume unconsumed horizontal intent, not a fresh projection of
            // remaining gravity: the latter manufactures downhill motion on a
            // walkable slope. The first hit's prefix remains collision-tested.
            let remaining = desired - last.translation_applied;
            let horizontal = remaining - up * remaining.dot(up);
            let tangent = horizontal - normal * horizontal.dot(normal);
            // Limit this numerical recovery to almost-flat support. Real ramp,
            // step-face and ledge responses keep KCC's original slope policy.
            if normal.dot(up) >= 1. - 1.0e-6
                && normal.dot(up) >= config.max_slope_angle.cos()
                && tangent.length_squared() > epsilon * epsilon
            {
                let prefix = last.translation_applied;
                let contact_pose = rp::Pose::from_translation(prefix) * shape_pose;
                if let Some(suffix) = move_with_ground_clearance(
                    world,
                    queries,
                    controller,
                    config,
                    length_unit,
                    shape,
                    &contact_pose,
                    tangent,
                    prefix,
                    collisions,
                    dropped,
                ) {
                    movement.translation = prefix + suffix.translation;
                    movement.grounded = suffix.grounded;
                    movement.is_sliding_down_slope = suffix.is_sliding_down_slope;
                } else {
                    // No candidate or contact record is committed on rejection.
                    movement.translation = prefix;
                }
            }
        }
    }
    movement.translation = super::character_geometry::stabilize_translation(
        world,
        shape,
        collisions.iter(),
        up,
        desired,
        movement.translation,
    );
    // Zero-input primary casts can also nudge into a touching roof. A rejected
    // physical result is never exposed to the simulation or impulse consumer.
    // Only an already-fitting pose with a certified stationary finite floor
    // and tight overhead obtains this guard; unknown geometry keeps its path.
    if !lift_from_ground && desired.dot(up) <= 0. {
        let epsilon = tight_epsilon(length_unit, config);
        if geometry_clearance(queries, shape, shape_pose, config.skin_width, epsilon, up)
            .is_some_and(|c| c.overhead < config.skin_width)
            && certified_flat_support(world, queries, shape, shape_pose, config, epsilon)
        {
            let end = rp::Pose::from_translation(movement.translation) * shape_pose;
            if geometry_clearance(queries, shape, &end, epsilon, epsilon, up).is_none() {
                movement.translation = rp::Vector::ZERO;
                collisions.clear();
            }
        }
    }
    let translation = movement.translation;
    (movement, translation)
}

fn record_collision(
    collisions: &mut Vec<CharacterCollision>,
    dropped: &mut usize,
    hit: CharacterCollision,
) {
    if collisions.len() < CONTACT_CAPACITY {
        collisions.push(hit);
    } else {
        *dropped += 1;
    }
}

const CONTACT_CAPACITY: usize = 32;

#[cfg(test)]
pub(super) mod clearance_work {
    use super::rp;
    use std::cell::RefCell;
    #[derive(Default, Debug, Clone)]
    pub struct Work {
        pub kcc: usize,
        pub scans: usize,
        pub colliders: usize,
        pub leaves: usize,
        pub contacts: usize,
        pub support_scans: usize,
        pub continuous_scans: usize,
        pub sweeps: Vec<(rp::Vector, rp::Vector, f32, f32)>,
        pub placement: rp::Vector,
        pub margin: f32,
        pub kcc_translation: rp::Vector,
        pub continuous: bool,
        pub down_proof_attempted: bool,
        pub down_certified: bool,
        pub restore_certified: bool,
        pub accepted_restore: f32,
    }
    thread_local! { static WORK: RefCell<Work> = RefCell::default(); }
    pub fn add(f: impl FnOnce(&mut Work)) {
        WORK.with(|w| f(&mut w.borrow_mut()));
    }
    pub fn certifies(
        world: &rp::PhysicsWorld,
        queries: &rp::QueryPipeline<'_>,
        shape: &dyn rp::Shape,
        pose: &rp::Pose,
        delta: rp::Vector,
        epsilon: f32,
    ) -> bool {
        super::certified_linear_translation(world, queries, shape, pose, delta, epsilon)
    }
    pub fn take() -> Work {
        WORK.with(|w| std::mem::take(&mut *w.borrow_mut()))
    }
}

fn clearance_lift(
    queries: &rp::QueryPipeline<'_>,
    config: &CharacterConfig,
    length_unit: f32,
    shape: &dyn rp::Shape,
    shape_pose: &rp::Pose,
) -> (rp::Vector, bool) {
    let up = rp::Vector::from(config.up);
    // Keep a small swept clearance before a supported lateral cast. Restore it
    // afterwards so numeric nudges cannot accumulate into upward motion.
    let distance = (config.skin_width * 0.1).min(length_unit * 0.001);
    let hit = queries.cast_shape(
        shape_pose,
        up,
        shape,
        ShapeCastOptions {
            max_time_of_impact: distance,
            target_distance: 0.,
            stop_at_penetration: false,
            compute_impact_geometry_on_penetration: true,
        },
    );
    let allowed = hit.map_or(distance, |(_, hit)| hit.time_of_impact);
    #[cfg(test)]
    clearance_work::add(|w| {
        w.sweeps
            .push((shape_pose.translation, up, distance, allowed))
    });
    (up * allowed, hit.is_some())
}

#[derive(Clone, Copy)]
struct GeometryClearance {
    nearest: f32,
    positive: f32,
    overhead: f32,
}

// This checks the real, uninflated capsule against exactly the admitted query
// geometry. Touching within roundoff is allowed; unsupported/nonfinite contacts
// cannot certify a placement. Positive distances size a numerical query margin.
fn geometry_clearance(
    queries: &rp::QueryPipeline<'_>,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
    prediction: f32,
    epsilon: f32,
    up: rp::Vector,
) -> Option<GeometryClearance> {
    #[cfg(test)]
    clearance_work::add(|w| w.scans += 1);
    let mut result = GeometryClearance {
        nearest: f32::INFINITY,
        positive: f32::INFINITY,
        overhead: f32::INFINITY,
    };
    let bounds = shape.compute_aabb(pose).loosened(prediction);
    for (_, target) in queries.intersect_aabb_conservative(bounds) {
        #[cfg(test)]
        clearance_work::add(|w| w.colliders += 1);
        if let Some(compound) = target.shape().as_compound() {
            for (local, part) in compound.shapes() {
                let part_pose = target.position() * local;
                accumulate_clearance(
                    queries,
                    part.as_ref(),
                    &part_pose,
                    shape,
                    pose,
                    prediction,
                    epsilon,
                    up,
                    &mut result,
                )?;
            }
        } else {
            accumulate_clearance(
                queries,
                target.shape(),
                target.position(),
                shape,
                pose,
                prediction,
                epsilon,
                up,
                &mut result,
            )?;
        }
    }
    Some(result)
}

// A capsule is a segment Minkowski-summed with its ORIGINAL radius. These
// six support extrema bound every point, so a nonnegative box face separation
// proves real nonpenetration even when EPA's touching witnesses are unstable.
// An inconclusive face test falls back to the normal full-shape contact query.
#[allow(clippy::too_many_arguments)]
fn accumulate_clearance(
    queries: &rp::QueryPipeline<'_>,
    target: &dyn rp::Shape,
    target_pose: &rp::Pose,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
    prediction: f32,
    epsilon: f32,
    up: rp::Vector,
    result: &mut GeometryClearance,
) -> Option<()> {
    #[cfg(test)]
    clearance_work::add(|w| w.leaves += 1);
    let relative = target_pose.inv_mul(pose);
    let certified = capsule_box_plane(target, shape, &relative, rp::Vector::ZERO)
        .filter(|(gap, _, footprint)| *gap >= -epsilon || *footprint)
        .map(|(gap, normal, _)| (gap, target_pose.rotation * normal));
    let distance = if let Some(certificate) = certified {
        Some(certificate)
    } else {
        #[cfg(test)]
        clearance_work::add(|w| w.contacts += 1);
        queries
            .dispatcher
            .contact(&relative, target, shape, prediction)
            .ok()?
            .map(|hit| (hit.dist, target_pose.rotation * hit.normal1))
    };
    if let Some((distance, normal)) = distance {
        if !distance.is_finite() || distance < -epsilon {
            return None;
        }
        result.nearest = result.nearest.min(distance);
        if distance > epsilon {
            result.positive = result.positive.min(distance);
        }
        if normal.dot(up) < -0.99 {
            result.overhead = result.overhead.min(distance);
        }
    }
    Some(())
}

// For fixed orientation, each capsule-axis endpoint is affine in t. Taking
// extrema of a,b,a+d,b+d and adding the ORIGINAL radius encloses the actual
// shape for EVERY t in [0,1], not just the endpoint placements.
pub(super) fn capsule_box_plane(
    target: &dyn rp::Shape,
    shape: &dyn rp::Shape,
    relative: &rp::Pose,
    delta: rp::Vector,
) -> Option<(f32, rp::Vector, bool)> {
    let box_shape = target.as_cuboid()?;
    let capsule = shape.as_capsule()?;
    let a = *relative * capsule.segment.a;
    let b = *relative * capsule.segment.b;
    let min = a.min(b).min(a + delta).min(b + delta) - rp::Vector::splat(capsule.radius);
    let max = a.max(b).max(a + delta).max(b + delta) + rp::Vector::splat(capsule.radius);
    let mut gap = f32::NEG_INFINITY;
    let mut normal = rp::Vector::ZERO;
    for axis in 0..3 {
        for sign in [-1., 1.] {
            let candidate = if sign > 0. {
                min[axis] - box_shape.half_extents[axis]
            } else {
                -box_shape.half_extents[axis] - max[axis]
            };
            if candidate > gap {
                gap = candidate;
                normal = rp::Vector::ZERO;
                normal[axis] = sign;
            }
        }
    }
    let axis = if normal.x != 0. {
        0
    } else if normal.y != 0. {
        1
    } else {
        2
    };
    // If the whole capsule footprint lies within this finite face, crossing its
    // plane is also a real overlap certificate. Do not let noisy generic EPA
    // witnesses turn a known face penetration into a positive distance.
    let footprint = (0..3)
        .filter(|&i| i != axis)
        .all(|i| min[i] > -box_shape.half_extents[i] && max[i] < box_shape.half_extents[i]);
    gap.is_finite().then_some((gap, normal, footprint))
}

fn certified_linear_translation(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
    delta: rp::Vector,
    epsilon: f32,
) -> bool {
    #[cfg(test)]
    clearance_work::add(|w| w.continuous_scans += 1);
    let end = rp::Pose::from_translation(delta) * pose;
    let bounds = shape
        .compute_aabb(pose)
        .merged(&shape.compute_aabb(&end))
        .loosened(epsilon);
    queries
        .intersect_aabb_conservative(bounds)
        .all(|(_, target)| {
            #[cfg(test)]
            clearance_work::add(|w| w.colliders += 1);
            if !stationary_target(world, target) {
                return false;
            }
            let certifies = |part: &dyn rp::Shape, part_pose: &rp::Pose| {
                #[cfg(test)]
                clearance_work::add(|w| w.leaves += 1);
                capsule_box_plane(
                    part,
                    shape,
                    &part_pose.inv_mul(pose),
                    part_pose.rotation.inverse() * delta,
                )
                .is_some_and(|(gap, _, _)| gap >= -epsilon)
            };
            if let Some(compound) = target.shape().as_compound() {
                compound
                    .shapes()
                    .iter()
                    .all(|(local, part)| certifies(part.as_ref(), &(target.position() * local)))
            } else {
                certifies(target.shape(), target.position())
            }
        })
}

// This is a finite support-face certificate, not a new ground hit. Every
// capsule point projects inside the face, and its ORIGINAL radius is included.
// Ledges, overhangs, slopes not parallel to `up`, and filtered/one-way geometry
// cannot obtain this certificate. Compound leaves are tested at their real pose.
#[allow(clippy::too_many_arguments)]
fn certified_flat_support_handle(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
    config: &CharacterConfig,
    epsilon: f32,
    max_distance: f32,
) -> Option<rp::ColliderHandle> {
    #[cfg(test)]
    clearance_work::add(|w| w.support_scans += 1);
    let capsule = shape.as_capsule()?;
    let up = rp::Vector::from(config.up);
    let certifies = |target: &dyn rp::Shape, target_pose: &rp::Pose| -> Option<f32> {
        #[cfg(test)]
        clearance_work::add(|w| w.leaves += 1);
        let cuboid = target.as_cuboid()?;
        let relative = target_pose.inv_mul(pose);
        let a = relative * capsule.segment.a;
        let b = relative * capsule.segment.b;
        let min = a.min(b) - rp::Vector::splat(capsule.radius);
        let max = a.max(b) + rp::Vector::splat(capsule.radius);
        let mut nearest: Option<f32> = None;
        for axis in 0..3 {
            for sign in [-1., 1.] {
                let mut normal = rp::Vector::ZERO;
                normal[axis] = sign;
                let alignment = (target_pose.rotation * normal).dot(up);
                if alignment < 1. - 1e-6 || alignment < config.max_slope_angle.cos() - 1e-5 {
                    continue;
                }
                let gap = if sign > 0. {
                    min[axis] - cuboid.half_extents[axis]
                } else {
                    -cuboid.half_extents[axis] - max[axis]
                };
                if gap >= -epsilon
                    && gap <= max_distance
                    && (0..3).filter(|&i| i != axis).all(|i| {
                        min[i] > -cuboid.half_extents[i] + epsilon
                            && max[i] < cuboid.half_extents[i] - epsilon
                    })
                {
                    nearest = Some(nearest.map_or(gap, |old| old.min(gap)));
                }
            }
        }
        nearest
    };
    let mut nearest: Option<(f32, rp::ColliderHandle)> = None;
    for (handle, target) in
        queries.intersect_aabb_conservative(shape.compute_aabb(pose).loosened(max_distance))
    {
        #[cfg(test)]
        clearance_work::add(|w| w.colliders += 1);
        if !stationary_target(world, target) {
            continue;
        }
        let distance = if let Some(compound) = target.shape().as_compound() {
            compound
                .shapes()
                .iter()
                .filter_map(|(local, part)| certifies(part.as_ref(), &(target.position() * local)))
                .min_by(f32::total_cmp)
        } else {
            certifies(target.shape(), target.position())
        };
        if let Some(distance) = distance {
            if nearest.is_none_or(|(old, old_handle)| {
                distance
                    .total_cmp(&old)
                    .then_with(|| handle.into_raw_parts().cmp(&old_handle.into_raw_parts()))
                    .is_lt()
            }) {
                nearest = Some((distance, handle));
            }
        }
    }
    nearest.map(|(_, handle)| handle)
}

fn certified_flat_support(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
    config: &CharacterConfig,
    epsilon: f32,
) -> bool {
    certified_flat_support_handle(
        world,
        queries,
        shape,
        pose,
        config,
        epsilon,
        config.skin_width,
    )
    .is_some()
}

/// A native down cast can choose an already-touching roof before the floor.
/// This fallback returns an ACTUAL finite stationary support collider, never a
/// manufactured hit/TOI. Its caller supplies the unchanged native ground filter.
pub(super) fn certified_tight_ground(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    shape: &dyn rp::Shape,
    pose: &rp::Pose,
    config: &CharacterConfig,
) -> Option<rp::ColliderHandle> {
    let epsilon = tight_epsilon(world.integration_parameters.length_unit, config);
    let clearance = geometry_clearance(
        queries,
        shape,
        pose,
        config.skin_width,
        epsilon,
        rp::Vector::from(config.up),
    )?;
    if clearance.overhead >= config.skin_width {
        return None;
    }
    certified_flat_support_handle(
        world,
        queries,
        shape,
        pose,
        config,
        epsilon,
        config.skin_width * 2.,
    )
}

fn stationary_target(world: &rp::PhysicsWorld, target: &rp::Collider) -> bool {
    target.parent().is_none_or(|parent| {
        world
            .bodies
            .get(parent)
            .is_some_and(|body| match body.body_type() {
                rp::RigidBodyType::Fixed => true,
                rp::RigidBodyType::KinematicPositionBased => {
                    body.position() == body.next_position()
                }
                rp::RigidBodyType::KinematicVelocityBased => {
                    body.linvel() == rp::Vector::ZERO && body.angvel() == rp::Vector::ZERO
                }
                rp::RigidBodyType::Dynamic | rp::RigidBodyType::SoftFrame => false,
            })
    })
}

fn held_movement() -> EffectiveCharacterMovement {
    EffectiveCharacterMovement {
        translation: rp::Vector::ZERO,
        grounded: true,
        is_sliding_down_slope: false,
    }
}

fn trim_stalled_contacts(
    collisions: &mut Vec<CharacterCollision>,
    prefix: rp::Vector,
    epsilon: f32,
) {
    let Some(last) = collisions.last().copied() else {
        return;
    };
    let keep = collisions
        .iter()
        .rposition(|hit| {
            hit.handle != last.handle
                || hit.hit.time_of_impact != 0.
                || (hit.translation_applied - prefix).length_squared() > epsilon * epsilon
        })
        .map_or(1, |i| i + 1);
    collisions.truncate(keep);
}

#[allow(clippy::too_many_arguments)]
fn move_with_ground_clearance(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    controller: &KinematicCharacterController,
    config: &CharacterConfig,
    length_unit: f32,
    shape: &dyn rp::Shape,
    shape_pose: &rp::Pose,
    desired: rp::Vector,
    prefix: rp::Vector,
    collisions: &mut Vec<CharacterCollision>,
    dropped: &mut usize,
) -> Option<EffectiveCharacterMovement> {
    let (lift, limited) = clearance_lift(queries, config, length_unit, shape, shape_pose);
    let epsilon = tight_epsilon(length_unit, config);
    let lifted = rp::Pose::from_translation(lift) * shape_pose;
    if !limited
        && geometry_clearance(
            queries,
            shape,
            &lifted,
            config.skin_width,
            epsilon,
            rp::Vector::from(config.up),
        )
        .is_some_and(|c| c.nearest > epsilon && c.overhead >= config.skin_width)
    {
        trim_stalled_contacts(collisions, prefix, config.skin_width * 0.001);
        let mut movement = move_segment(
            queries,
            controller,
            config,
            shape,
            shape_pose,
            desired,
            lift,
            |mut hit| {
                hit.translation_applied += prefix;
                record_collision(collisions, dropped, hit);
            },
        );
        // KCC can already have snapped down from the temporary lift before
        // the restore cast. On the same level face, walking at skin height
        // has no downward component. Keep the checked lateral movement.
        let up = rp::Vector::from(config.up);
        let down = movement.translation.dot(up);
        // An enabled autostep owns its vertical placement on approaches to
        // steps and ramps, even when the requested input itself is level.
        if controller.autostep.is_none() && desired.dot(up) == 0. && down < 0. {
            let tangent = movement.translation - up * down;
            if let Some(handle) = certified_flat_support_handle(
                world,
                queries,
                shape,
                shape_pose,
                config,
                epsilon,
                config.skin_width + epsilon,
            ) {
                let floor = &world.colliders[handle];
                let pose = floor.position();
                let level_face = capsule_box_plane(
                    floor.shape(),
                    shape,
                    &pose.inv_mul(shape_pose),
                    pose.rotation.inverse() * tangent,
                )
                .is_some_and(|(_, normal, inside)| inside && pose.rotation * normal == up);
                if level_face
                    && certified_linear_translation(
                        world, queries, shape, shape_pose, tangent, epsilon,
                    )
                {
                    movement.translation = tangent;
                }
            }
        }
        return Some(movement);
    }
    move_tight_segment(
        world,
        queries,
        controller,
        config,
        length_unit,
        shape,
        shape_pose,
        desired,
        prefix,
        epsilon,
        None,
        collisions,
        dropped,
    )
}

#[allow(clippy::too_many_arguments)]
fn move_tight_segment(
    world: &rp::PhysicsWorld,
    queries: &rp::QueryPipeline<'_>,
    controller: &KinematicCharacterController,
    config: &CharacterConfig,
    length_unit: f32,
    shape: &dyn rp::Shape,
    shape_pose: &rp::Pose,
    desired: rp::Vector,
    prefix: rp::Vector,
    epsilon: f32,
    keep_prefix: Option<usize>,
    collisions: &mut Vec<CharacterCollision>,
    dropped: &mut usize,
) -> Option<EffectiveCharacterMovement> {
    geometry_clearance(
        queries,
        shape,
        shape_pose,
        epsilon,
        epsilon,
        rp::Vector::from(config.up),
    )?;
    let up = rp::Vector::from(config.up);
    let desired = if certified_flat_support(world, queries, shape, shape_pose, config, epsilon) {
        desired - up * desired.dot(up)
    } else {
        desired
    };
    let limit = (config.skin_width * 0.1).min(length_unit * 0.001);
    let distance = queries
        .cast_shape(
            shape_pose,
            -up,
            shape,
            ShapeCastOptions {
                max_time_of_impact: limit,
                target_distance: 0.,
                stop_at_penetration: false,
                compute_impact_geometry_on_penetration: true,
            },
        )
        .map_or(limit, |(_, hit)| hit.time_of_impact);
    if !distance.is_finite() || distance < 0. {
        return None;
    }
    let distance = distance.min(limit);
    #[cfg(test)]
    clearance_work::add(|w| {
        w.sweeps
            .push((shape_pose.translation, -up, limit, distance))
    });
    let mut placement = -up * (distance * 0.5);
    let mut placed = rp::Pose::from_translation(placement) * shape_pose;
    let clearance = if let Some(c) =
        geometry_clearance(queries, shape, &placed, config.skin_width, epsilon, up).filter(|_| {
            // The endpoint alone cannot certify a sweep past a finite thin
            // edge. Keep the native cast AND require a continuous original-
            // shape separation proof for every admitted stationary box leaf.
            let proof =
                certified_linear_translation(world, queries, shape, shape_pose, placement, epsilon);
            #[cfg(test)]
            clearance_work::add(|w| {
                w.down_proof_attempted = true;
                w.down_certified = proof;
            });
            proof
        }) {
        c
    } else {
        // A cast/endpoint may be numerically inconclusive, or the full down
        // segment may lack a certificate. Stay at the already-certified prefix
        // rather than expose an unsafe placement or ignore unknown geometry.
        placement = rp::Vector::ZERO;
        placed = *shape_pose;
        geometry_clearance(queries, shape, &placed, config.skin_width, epsilon, up)?
    };
    // Skin remains the authored preferred buffer. A tight numerical retry uses
    // a positive best-effort query margin, never a smaller physical shape.
    let cap = if placement == rp::Vector::ZERO {
        config.skin_width
    } else {
        distance * 0.25
    };
    let margin = config.skin_width.min(cap).min(clearance.positive * 0.5);
    if !margin.is_finite() || margin <= 0. {
        return None;
    }
    let mut bounded = *controller;
    bounded.offset = CharacterLength::Absolute(margin);
    bounded.normal_nudge_factor = if placement == rp::Vector::ZERO {
        0.
    } else {
        margin * 0.01
    };
    // Reapply the original snap after restoring the numerical placement. Its
    // preferred margin and vertical effect must not be integrated a second time.
    bounded.snap_to_ground = None;
    let mut hits = [None; CONTACT_CAPACITY];
    let mut count = 0;
    let mut omitted = 0;
    #[cfg(test)]
    clearance_work::add(|w| {
        w.kcc += 1;
        w.placement = placement;
        w.margin = margin;
    });
    let mut movement = bounded.move_shape(0., queries, shape, &placed, desired, |mut hit| {
        hit.translation_applied += placement;
        if count < CONTACT_CAPACITY {
            hits[count] = Some(hit);
            count += 1;
        } else {
            omitted += 1;
        }
    });
    // A positive query margin is preferred numerical clearance, not a smaller
    // capsule. At an infeasible margin, KCC may report an unstable within-skin
    // normal. An independent CONTINUOUS full-shape separation proof can approve
    // the exact tangent; it creates no collision TOI/callback or impulse row.
    // Every admitted stationary box leaf must prove a fixed separating plane;
    // moving parents, walls/steps crossed by this path and unknown shapes fail.
    let continuous = certified_linear_translation(world, queries, shape, &placed, desired, epsilon);
    #[cfg(test)]
    clearance_work::add(|w| {
        w.kcc_translation = movement.translation;
        w.continuous = continuous;
    });
    if continuous {
        movement.translation = desired;
        movement.is_sliding_down_slope = false;
        hits.fill(None);
        omitted = 0;
    }
    let raw_end = rp::Pose::from_translation(movement.translation) * placed;
    geometry_clearance(queries, shape, &raw_end, epsilon, epsilon, up)?;
    let mut translation = placement + movement.translation;
    if placement != rp::Vector::ZERO {
        let native_restore = queries
            .cast_shape(
                &raw_end,
                up,
                shape,
                ShapeCastOptions {
                    max_time_of_impact: placement.length(),
                    target_distance: 0.,
                    stop_at_penetration: false,
                    compute_impact_geometry_on_penetration: true,
                },
            )
            .map_or(placement.length(), |(_, hit)| hit.time_of_impact);
        #[cfg(test)]
        clearance_work::add(|w| {
            w.sweeps
                .push((raw_end.translation, up, placement.length(), native_restore))
        });
        // The real sweep is retained above. A native within-touch false early
        // hit cannot shorten a separately certified continuous full-shape lift.
        let certified_restore = certified_linear_translation(
            world,
            queries,
            shape,
            &raw_end,
            up * placement.length(),
            epsilon,
        );
        let restore = if certified_restore {
            placement.length()
        } else {
            native_restore
        };
        #[cfg(test)]
        clearance_work::add(|w| {
            w.restore_certified = certified_restore;
            w.accepted_restore = restore;
        });
        translation += up * restore;
    }
    if let Some(snap) = controller
        .snap_to_ground
        .filter(|_| translation.dot(up) <= 0.)
    {
        let extent = shape.compute_local_aabb().extents().dot(up.abs());
        let eval = |value| match value {
            CharacterLength::Absolute(x) => x,
            CharacterLength::Relative(x) => x * extent,
        };
        let end = rp::Pose::from_translation(translation) * shape_pose;
        if let Some((_, hit)) = queries.cast_shape(
            &end,
            -up,
            shape,
            ShapeCastOptions {
                max_time_of_impact: eval(snap),
                target_distance: eval(controller.offset),
                stop_at_penetration: false,
                compute_impact_geometry_on_penetration: true,
            },
        ) {
            translation -= up * hit.time_of_impact;
            movement.grounded = true;
        }
    }
    translation = super::character_geometry::stabilize_translation(
        world,
        shape,
        hits.iter().filter_map(Option::as_ref),
        up,
        desired,
        translation,
    );
    let end = rp::Pose::from_translation(translation) * shape_pose;
    geometry_clearance(queries, shape, &end, epsilon, epsilon, up)?;
    // Commit records only after every checked segment is accepted. Rejected
    // candidates retain the original collision-tested prefix and scratch rows.
    if let Some(keep) = keep_prefix {
        collisions.truncate(keep);
    } else {
        trim_stalled_contacts(collisions, prefix, config.skin_width * 0.001);
    }
    for mut hit in hits.into_iter().flatten() {
        hit.translation_applied += prefix;
        record_collision(collisions, dropped, hit);
    }
    *dropped += omitted;
    movement.translation = translation;
    Some(movement)
}

#[allow(clippy::too_many_arguments)]
fn move_segment(
    queries: &rp::QueryPipeline<'_>,
    controller: &KinematicCharacterController,
    config: &CharacterConfig,
    shape: &dyn rp::Shape,
    shape_pose: &rp::Pose,
    desired: rp::Vector,
    lift: rp::Vector,
    mut events: impl FnMut(CharacterCollision),
) -> EffectiveCharacterMovement {
    let up = rp::Vector::from(config.up);
    #[cfg(test)]
    clearance_work::add(|w| w.kcc += 1);
    let movement_pose = rp::Pose::from_translation(lift) * shape_pose;
    // Zero dt disables velocity platform friction. Runtime carry has its own
    // swept finite-transform path after this shared static response.
    let mut movement =
        controller.move_shape(0., queries, shape, &movement_pose, desired, |mut hit| {
            hit.translation_applied += lift;
            events(hit);
        });
    let mut translation = lift + movement.translation;
    if lift != rp::Vector::ZERO {
        let lift_length = lift.length();
        let end = rp::Pose::from_translation(translation) * shape_pose;
        let down = queries
            .cast_shape(
                &end,
                -up,
                shape,
                ShapeCastOptions {
                    max_time_of_impact: lift_length,
                    target_distance: config.skin_width,
                    stop_at_penetration: true,
                    compute_impact_geometry_on_penetration: false,
                },
            )
            .map_or(lift_length, |(_, hit)| hit.time_of_impact);
        translation -= up * down;
    }
    movement.translation = translation;
    movement
}
