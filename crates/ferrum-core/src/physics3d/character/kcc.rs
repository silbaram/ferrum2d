//! Rapier KCC movement, platform transport and capsule separation.
use super::*;
use crate::physics3d::kinematic_motion::{accepted_collider_motion, motion_bounds};
use crate::physics3d::KinematicPath;
use rapier3d::control::EffectiveCharacterMovement;
use rapier3d::parry::{
    bounding_volume::BoundingVolume,
    query::{cast_shapes, cast_shapes_nonlinear, contact, NonlinearRigidMotion},
};
use std::collections::{BTreeMap, BTreeSet};
mod kinematic_push;
use kinematic_push::is_moving_kinematic;

struct MovePlan {
    id: BodyId,
    body_pose: rp::Pose,
    shape_pose: rp::Pose,
    shape: rp::SharedShape,
    groups: rp::InteractionGroups,
    controller: KinematicCharacterController,
    translation: rp::Vector,
}

#[derive(Clone, Copy)]
enum KccQuery {
    Terrain,
    StaticTerrain,
    Locomotion,
}

impl PhysicsWorld3d {
    pub(in crate::physics3d) fn step_character_kcc(&mut self) -> Result<(), PhysicsError> {
        if !self.begin_fixed_step() {
            return self.actual_motion_result();
        }
        self.step_kcc_interval(&[], 0., 1., &mut Vec::new(), None);
        self.finish_fixed_step();
        self.actual_motion_result()
    }

    pub(in crate::physics3d) fn step_kcc_interval(
        &mut self,
        paths: &[KinematicPath],
        start: f64,
        end: f64,
        stopped: &mut Vec<BodyId>,
        pushes: Option<&mut BTreeMap<(BodyId, BodyId), rp::Vector>>,
    ) {
        self.refresh_queries();
        let dt = self.backend.integration_parameters.dt;
        let mut velocity_stops = Vec::new();
        let blocked = self.stop_blocked_platform_groups(paths, dt, &mut velocity_stops);
        for &body in &blocked {
            self.record_path_stop();
            stopped.push(body);
        }
        let mut characters = std::mem::take(&mut self.characters);
        self.character_order.clear();
        self.character_order.extend(characters.keys().copied());
        let mut plans = Vec::with_capacity(characters.len());
        for (&id, runtime) in &mut characters {
            runtime.support_motion = None;
            if runtime.state.grounded
                && runtime.input.jump_speed == 0.
                && runtime
                    .state
                    .ground
                    .is_some_and(|support| blocked.contains(&support.body))
            {
                let body = &mut self.backend.bodies[native_id(id)];
                body.set_next_kinematic_position(*body.position());
                runtime.state.translation = [0.; 3];
                runtime.state.velocity = [0.; 3];
                runtime.state.carried_by = None;
                runtime.state.carry_translation = [0.; 3];
                continue;
            }
            if let Some(plan) = self.kcc_plan(id, runtime, dt) {
                plans.push(plan);
            }
        }
        self.separate_kcc_crowd(&mut plans, &mut characters);
        self.push_characters_with_kinematics(&mut plans, &mut characters, stopped, pushes);
        for plan in &plans {
            let translation = plan.translation;
            let runtime = characters.get_mut(&plan.id).unwrap();
            runtime.state.translation = translation.to_array();
            runtime.state.velocity = (translation / dt).to_array();
            if runtime.config.push_mass > 0. {
                self.kcc_push_dynamic(plan, runtime, dt);
            }
            self.backend.bodies[native_id(plan.id)].set_next_kinematic_position(
                rp::Pose::from_translation(translation) * plan.body_pose,
            );
        }
        self.characters = characters;
        self.step_with_joints(start, end);
        for id in velocity_stops {
            self.stop_prescribed_body(id);
        }
        self.reconcile_dynamic_character_support();
        let mut characters = std::mem::take(&mut self.characters);
        for plan in &mut plans {
            let runtime = characters.get_mut(&plan.id).unwrap();
            let position = self.backend.bodies[native_id(plan.id)].translation();
            let translation = position - plan.body_pose.translation;
            runtime.state.translation = translation.to_array();
            runtime.state.velocity = (translation / dt).to_array();
            plan.shape_pose = *self.backend.colliders[native_collider(runtime.collider)].position();
            let moved_up = rp::Vector::from(runtime.tick_velocity).dot(plan.controller.up) > 0.
                && (rp::Vector::from(runtime.state.translation)
                    - rp::Vector::from(runtime.state.carry_translation))
                .dot(plan.controller.up)
                    > 0.;
            let support = if runtime.state.vertical_speed <= 0. && !moved_up {
                super::character_ground(&self.backend, &self.contact_policies, plan.id, runtime)
                    .or_else(|| self.kcc_ground(plan, runtime.config.skin_width * 2.))
            } else {
                None
            };
            runtime.state.ground = support;
            runtime.state.grounded = support.is_some();
            if support.is_some() {
                runtime.state.vertical_speed = 0.;
                runtime.state.sliding = false;
            }
        }
        self.characters = characters;
    }

    fn kcc_ground(&self, plan: &MovePlan, distance: f32) -> Option<ColliderRef> {
        let up = plan.controller.up;
        let min_up = plan.controller.max_slope_climb_angle.cos();
        let options = ShapeCastOptions {
            max_time_of_impact: distance,
            target_distance: 0.,
            stop_at_penetration: true,
            compute_impact_geometry_on_penetration: true,
        };
        let shape = plan.shape.as_ref();
        let handle = self.kcc_query(
            plan,
            plan.shape_pose,
            None,
            rp::QueryFilterFlags::empty(),
            KccQuery::Terrain,
            |queries| {
                let (first, hit) = queries.cast_shape(&plan.shape_pose, -up, shape, options)?;
                if hit.normal1.dot(up) >= min_up {
                    return Some(first);
                }
                // A wall can win the down cast at time zero. Filter by slope before
                // ranking the remaining hits, including parts of that collider.
                let bounds = shape.compute_aabb(&plan.shape_pose);
                let sweep = bounds.merged(&bounds.translated(-up * distance));
                let cast = |pose: &rp::Pose, target: &dyn rp::Shape| {
                    cast_shapes(
                        pose,
                        rp::Vector::ZERO,
                        target,
                        &plan.shape_pose,
                        -up,
                        shape,
                        options,
                    )
                    .ok()
                    .flatten()
                    .filter(|hit| (pose.rotation * hit.normal1).dot(up) >= min_up)
                    .map(|hit| hit.time_of_impact)
                };
                queries
                    .intersect_aabb_conservative(sweep)
                    .filter_map(|(id, collider)| {
                        let pose = collider.position();
                        let target = collider.shape();
                        let time = if let Some(composite) = target.as_composite_shape() {
                            let bounds = shape.compute_aabb(&pose.inv_mul(&plan.shape_pose));
                            let local_travel = pose.rotation.inverse() * (-up * distance);
                            let bounds = bounds.merged(&bounds.translated(local_travel));
                            let mut best = None;
                            for id in composite.bvh().intersect_aabb(&bounds) {
                                composite.map_part_at(id, &mut |offset, part, _| {
                                    let part_pose = offset.map_or(*pose, |p| pose * p);
                                    if let Some(time) = cast(&part_pose, part) {
                                        best = Some(best.map_or(time, |old| f32::min(old, time)));
                                    }
                                });
                            }
                            best
                        } else {
                            cast(pose, target)
                        }?;
                        Some((time, id))
                    })
                    .min_by(|(a, a_id), (b, b_id)| {
                        a.total_cmp(b)
                            .then_with(|| collider_id(*a_id).cmp(&collider_id(*b_id)))
                    })
                    .map(|(_, id)| id)
            },
        )?;
        collider_ref(handle, &self.backend.colliders[handle])
    }

    fn kcc_plan(&self, id: BodyId, runtime: &mut CharacterRuntime, dt: f32) -> Option<MovePlan> {
        let body = &self.backend.bodies[native_id(id)];
        let collider = &self.backend.colliders[native_collider(runtime.collider)];
        if !body.is_enabled() || !collider.is_enabled() {
            runtime.state = CharacterState::default();
            return None;
        }
        let mut plan = MovePlan {
            id,
            body_pose: *body.position(),
            shape_pose: *collider.position(),
            shape: collider.shared_shape().clone(),
            groups: collider.collision_groups(),
            controller: runtime.config.controller(),
            translation: rp::Vector::ZERO,
        };
        let up = plan.controller.up;
        let jump = std::mem::take(&mut runtime.input.jump_speed);
        let grounded = runtime.state.grounded;
        let max_speed = runtime.config.max_vertical_speed;
        let mut vertical_speed = if grounded && jump > 0. {
            jump
        } else {
            runtime.state.vertical_speed
        };
        if runtime.config.push_mass > 0. {
            let impulse = rp::Vector::from(std::mem::take(&mut runtime.pending_impulse));
            let external = rp::Vector::from(runtime.external_velocity)
                + (rp::Vector::from(runtime.external_force) * dt + impulse)
                    / runtime.config.push_mass;
            let vertical = external.dot(up);
            vertical_speed += vertical;
            runtime.external_velocity = (external - up * vertical).to_array();
        }
        vertical_speed = (vertical_speed
            + self.backend.gravity.dot(up) * body.gravity_scale() * dt)
            .clamp(-max_speed, max_speed);
        let walking_speed = if grounded && jump == 0. && vertical_speed < 0. {
            0.
        } else {
            vertical_speed
        };
        let simple = KinematicCharacterController {
            autostep: None,
            snap_to_ground: None,
            ..plan.controller
        };
        let moving_support = runtime
            .state
            .ground
            .filter(|_| grounded && jump == 0.)
            .map(|ground| native_id(ground.body))
            .filter(|&handle| {
                let support = &self.backend.bodies[handle];
                match support.body_type() {
                    rp::RigidBodyType::KinematicPositionBased => {
                        support.position() != support.next_position()
                    }
                    rp::RigidBodyType::KinematicVelocityBased | rp::RigidBodyType::Dynamic => {
                        support.linvel() != rp::Vector::ZERO || support.angvel() != rp::Vector::ZERO
                    }
                    _ => false,
                }
            });
        let mut controller = plan.controller;
        if !grounded || jump > 0. || vertical_speed > 0. || moving_support.is_some() {
            controller.snap_to_ground = None;
        }
        let desired = (rp::Vector::from(runtime.input.velocity)
            + rp::Vector::from(runtime.tick_velocity)
            + rp::Vector::from(runtime.external_velocity)
            + up * walking_speed)
            * dt;
        let lateral = desired - up * desired.dot(up);
        let use_clearance = moving_support.is_none()
            && jump == 0.
            && walking_speed <= 0.
            && lateral.length_squared() > 0.;
        // Preserve the exact resting pose on an already accepted support.
        // Other static overlaps still go through KCC depenetration.
        let ignored = if grounded && desired == rp::Vector::ZERO {
            runtime.state.ground.map(|support| native_id(support.body))
        } else {
            moving_support
        };
        if !use_clearance {
            // A zero move depenetrates static geometry before a normal KCC move.
            plan.translation = self
                .kcc_move(&plan, simple, rp::Vector::ZERO, ignored)
                .translation;
        }
        runtime.collisions.clear();
        let mut external = rp::Vector::from(runtime.external_velocity);
        let mut dropped_contacts = 0;
        let mut blocked_by_character = false;
        let pose = rp::Pose::from_translation(plan.translation) * plan.shape_pose;
        let movement = self.kcc_query(
            &plan,
            pose,
            ignored,
            if desired == rp::Vector::ZERO {
                rp::QueryFilterFlags::EXCLUDE_DYNAMIC
            } else {
                rp::QueryFilterFlags::empty()
            },
            if desired == rp::Vector::ZERO {
                KccQuery::StaticTerrain
            } else {
                KccQuery::Locomotion
            },
            |query| {
                if use_clearance {
                    // Share the stationary clearance handling with traversal
                    // probes, particularly when a capsule fits a low ceiling.
                    return super::super::character_query::move_with_clearance(
                        &self.backend,
                        &query,
                        &controller,
                        &runtime.config,
                        self.config.length_unit,
                        plan.shape.as_ref(),
                        &pose,
                        desired,
                        grounded && walking_speed == 0.,
                        &mut runtime.collisions,
                        &mut dropped_contacts,
                    )
                    .0;
                }
                controller.move_shape(0., &query, plan.shape.as_ref(), &pose, desired, |hit| {
                    blocked_by_character |= self.kcc_peer(&self.backend.colliders[hit.handle]);
                    if runtime.config.push_mass == 0. {
                        return;
                    }
                    if runtime.collisions.len() < 32 {
                        runtime.collisions.push(hit);
                    } else {
                        dropped_contacts += 1;
                    }
                })
            },
        );
        runtime.collisions.retain(|hit| {
            let target = &self.backend.colliders[hit.handle];
            blocked_by_character |= self.kcc_peer(target);
            if runtime.config.push_mass == 0. {
                return false;
            }
            if target
                .parent()
                .is_some_and(|id| self.backend.bodies[id].is_dynamic())
            {
                return true;
            }
            let normal = super::super::character_geometry::collision_normal(
                target,
                plan.shape.as_ref(),
                hit,
            );
            let horizontal = normal - up * normal.dot(up);
            if let Some(direction) = horizontal.try_normalize() {
                external -= direction * external.dot(direction).min(0.);
            }
            false
        });
        runtime.external_velocity = external.to_array();
        plan.translation += movement.translation;

        // Walk against the current platform pose, then transport the resulting anchor.
        let mut carried_by = None;
        let mut carry = rp::Vector::ZERO;
        if let Some((support, platform)) = runtime
            .state
            .ground
            .filter(|_| grounded && jump == 0.)
            .and_then(|support| {
                self.backend
                    .bodies
                    .get(native_id(support.body))
                    .map(|platform| (support, platform))
            })
        {
            let handle = native_id(support.body);
            let next = match platform.body_type() {
                rp::RigidBodyType::KinematicPositionBased => Some(*platform.next_position()),
                rp::RigidBodyType::KinematicVelocityBased => {
                    Some(platform.predict_position_using_velocity(dt))
                }
                _ => None,
            };
            if next.is_some() || platform.is_dynamic() {
                let pose = rp::Pose::from_translation(plan.translation) * plan.shape_pose;
                let shape = plan.shape.as_ref();
                let fixture = &self.backend.colliders[native_collider(support.collider)];
                let local = rotating_face_anchor(fixture, shape, &pose, up, platform.angvel())
                    .or_else(|| {
                        contact(
                            fixture.position(),
                            fixture.shape(),
                            &pose,
                            shape,
                            runtime.config.skin_width * 2.05,
                        )
                        .ok()
                        .flatten()
                        .map(|hit| platform.position().inverse_transform_point(hit.point1))
                    })
                    .unwrap_or_else(|| {
                        platform
                            .position()
                            .inverse_transform_point(pose.translation)
                    });
                let anchor = *platform.position() * local;
                runtime.support_motion = Some((support.body, local, anchor));
                let next = next.unwrap_or(*platform.position());
                let delta = next * local - anchor;
                if delta.length_squared() > 1.0e-12 {
                    carry = self
                        .kcc_move(&plan, simple, delta, Some(handle))
                        .translation;
                    plan.translation += carry;
                    if carry.length_squared() > 1.0e-12 {
                        carried_by = Some(support.body);
                    }
                }
            }
        }
        if self.config.space == Space::PlanarXy {
            plan.translation.z = 0.;
        }
        let hit_ceiling = vertical_speed > 0.
            && (desired - movement.translation).dot(up) > runtime.config.skin_width;
        runtime.state = CharacterState {
            vertical_speed: if hit_ceiling { 0. } else { vertical_speed },
            sliding: movement.is_sliding_down_slope,
            hit_ceiling,
            dropped_contacts,
            blocked_by_character,
            carried_by,
            carry_translation: carry.to_array(),
            ..CharacterState::default()
        };
        Some(plan)
    }

    fn kcc_peer(&self, collider: &rp::Collider) -> bool {
        collider.parent().is_some_and(|parent| {
            let (slot, generation) = parent.into_raw_parts();
            self.character_order
                .binary_search(&BodyId { slot, generation })
                .is_ok()
        })
    }

    fn kcc_query<T>(
        &self,
        plan: &MovePlan,
        pose: rp::Pose,
        ignore: Option<rp::RigidBodyHandle>,
        excluded: rp::QueryFilterFlags,
        kind: KccQuery,
        query: impl FnOnce(rp::QueryPipeline<'_>) -> T,
    ) -> T {
        let allowed = |handle, c: &rp::Collider| {
            c.is_enabled()
                && c.parent().is_none_or(|parent| {
                    Some(parent) != ignore
                        && if self.kcc_peer(c) {
                            matches!(kind, KccQuery::Locomotion)
                        } else {
                            matches!(kind, KccQuery::Terrain)
                                || !is_moving_kinematic(&self.backend.bodies[parent])
                        }
                })
                && self
                    .contact_policies
                    .pair_allows(Some(native_id(plan.id)), c.parent())
                && self
                    .contact_policies
                    .one_way_allows(handle, c, plan.shape.as_ref(), &pose)
        };
        query(self.backend.query_pipeline_with_filter(rp::QueryFilter {
            flags: excluded | rp::QueryFilterFlags::EXCLUDE_SENSORS,
            groups: Some(plan.groups),
            exclude_rigid_body: Some(native_id(plan.id)),
            predicate: Some(&allowed),
            ..rp::QueryFilter::default()
        }))
    }

    fn kcc_move(
        &self,
        plan: &MovePlan,
        controller: KinematicCharacterController,
        desired: rp::Vector,
        ignore: Option<rp::RigidBodyHandle>,
    ) -> EffectiveCharacterMovement {
        let pose = rp::Pose::from_translation(plan.translation) * plan.shape_pose;
        // Platform transport is applied explicitly. A zero query dt disables KCC surface friction.
        let excluded = if desired == rp::Vector::ZERO {
            // Rapier separates incoming dynamic bodies from the kinematic actor.
            rp::QueryFilterFlags::EXCLUDE_DYNAMIC
        } else {
            rp::QueryFilterFlags::empty()
        };
        self.kcc_query(
            plan,
            pose,
            ignore,
            excluded,
            if desired == rp::Vector::ZERO {
                KccQuery::StaticTerrain
            } else {
                KccQuery::Terrain
            },
            |q| controller.move_shape(0., &q, plan.shape.as_ref(), &pose, desired, |_| {}),
        )
    }

    fn kcc_push_dynamic(&mut self, plan: &MovePlan, runtime: &mut CharacterRuntime, dt: f32) {
        let mut before = BTreeMap::new();
        for hit in &runtime.collisions {
            let Some(id) = self.backend.colliders[hit.handle].parent() else {
                continue;
            };
            if let Some(body) = self.backend.bodies.get(id).filter(|b| b.is_dynamic()) {
                before
                    .entry(id.into_raw_parts())
                    .or_insert((id, body.linvel()));
            }
        }
        if before.is_empty() {
            return;
        }
        let filter = rp::QueryFilter {
            flags: rp::QueryFilterFlags::ONLY_DYNAMIC | rp::QueryFilterFlags::EXCLUDE_SENSORS,
            groups: Some(plan.groups),
            predicate: Some(&|handle, collider| {
                collider
                    .parent()
                    .is_some_and(|id| before.contains_key(&id.into_raw_parts()))
                    && self
                        .contact_policies
                        .pair_allows(Some(native_id(plan.id)), collider.parent())
                    && self.contact_policies.one_way_allows(
                        handle,
                        collider,
                        plan.shape.as_ref(),
                        &plan.shape_pose,
                    )
            }),
            ..rp::QueryFilter::default()
        };
        let mut queries = self.backend.broad_phase.as_query_pipeline_mut(
            self.backend.narrow_phase.query_dispatcher(),
            &mut self.backend.bodies,
            &mut self.backend.colliders,
            filter,
        );
        plan.controller.solve_character_collision_impulses(
            dt,
            &mut queries,
            plan.shape.as_ref(),
            runtime.config.push_mass,
            &runtime.collisions,
        );
        // Sample the change across the KCC call alone, before gravity and contacts run.
        let impulse: rp::Vector = before
            .values()
            .map(|&(id, velocity)| {
                let body = &queries.bodies[id];
                (body.linvel() - velocity) * body.mass()
            })
            .sum();
        let reaction = impulse / runtime.config.push_mass;
        let vertical = reaction.dot(plan.controller.up);
        runtime.state.vertical_speed -= vertical;
        runtime.external_velocity = (rp::Vector::from(runtime.external_velocity)
            - (reaction - plan.controller.up * vertical))
            .to_array();
    }

    fn stop_blocked_platform_groups(
        &mut self,
        paths: &[KinematicPath],
        dt: f32,
        velocity_stops: &mut Vec<BodyId>,
    ) -> Vec<BodyId> {
        let mut platforms: BTreeSet<_> = paths.iter().map(|path| path.body).collect();
        platforms.extend(self.characters.values().filter_map(|rider| {
            rider
                .state
                .ground
                .filter(|_| rider.state.grounded)
                .map(|ground| ground.body)
        }));
        platforms.retain(|&id| is_moving_kinematic(&self.backend.bodies[native_id(id)]));
        if platforms.is_empty() {
            return Vec::new();
        }

        self.refresh_path_motion_queries();
        let schedule = self.backend_pass_schedule();
        let mut blocked = BTreeSet::new();
        let mut clipped = BTreeMap::<BodyId, f32>::new();
        let (mut casts, mut failures) = (0u32, 0u32);
        for id in platforms {
            let platform = &self.backend.bodies[native_id(id)];
            let prescribed = paths.iter().find(|path| path.body == id);
            let next = if platform.body_type() == rp::RigidBodyType::KinematicPositionBased {
                *platform.next_position()
            } else {
                super::super::kinematic_motion::accepted_kinematic_pose(platform, dt, &schedule)
            };
            let riders: Vec<_> = self
                .characters
                .iter()
                .filter(|(_, rider)| {
                    rider.state.grounded
                        && rider.input.jump_speed == 0.
                        && rider.state.ground.is_some_and(|ground| ground.body == id)
                })
                .map(|(&rider, _)| native_id(rider))
                .collect();
            let members = std::iter::once(native_id(id)).chain(riders.iter().copied());
            let sweep_sensors = prescribed.is_some_and(|path| path.sweep_sensors);
            let mut blocker = None;
            let mut dash_stop: Option<(f32, Option<BodyId>)> = None;
            let blocked_group = members.clone().any(|handle| {
                self.backend.bodies[handle]
                    .colliders()
                    .iter()
                    .any(|&fixture| {
                        let collider = &self.backend.colliders[fixture];
                        if !collider.is_enabled() || (collider.is_sensor() && !sweep_sensors) {
                            return false;
                        }
                        let motion = if handle == native_id(id) {
                            accepted_collider_motion(platform, collider, dt, &schedule)
                        } else {
                            let start = *collider.position();
                            let delta = next
                                * platform
                                    .position()
                                    .inverse_transform_point(start.translation)
                                - start.translation;
                            NonlinearRigidMotion::new(
                                start,
                                rp::Vector::ZERO,
                                delta,
                                rp::Vector::ZERO,
                            )
                        };
                        let bounds = motion_bounds(collider.shape(), &motion);
                        self.backend
                            .query_pipeline()
                            .intersect_aabb_conservative(bounds)
                            .any(|(other_id, other)| {
                                if !other.is_enabled()
                                    || other.is_sensor()
                                    || members.clone().any(|member| other.parent() == Some(member))
                                    || handle == native_id(id)
                                        && other.parent().is_some_and(|actor| {
                                            let (slot, generation) = actor.into_raw_parts();
                                            self.characters
                                                .contains_key(&BodyId { slot, generation })
                                        })
                                    || !collider.collision_groups().test(other.collision_groups())
                                    || !self
                                        .contact_policies
                                        .pair_allows(Some(handle), other.parent())
                                    || !self.contact_policies.one_way_allows(
                                        other_id,
                                        other,
                                        collider.shape(),
                                        collider.position(),
                                    )
                                {
                                    return false;
                                }
                                let other_body =
                                    other.parent().and_then(|id| self.backend.bodies.get(id));
                                if other_body.is_some_and(|body| !body.is_enabled()) {
                                    return false;
                                }
                                let other_motion = other_body.map_or_else(
                                    || NonlinearRigidMotion::constant_position(*other.position()),
                                    |body| {
                                        if !body.is_dynamic() {
                                            return accepted_collider_motion(
                                                body, other, dt, &schedule,
                                            );
                                        }
                                        let predicted =
                                            super::super::character_dynamics::predicted_pose(
                                                body,
                                                self.backend.gravity,
                                                dt,
                                            );
                                        let local = other
                                            .position_wrt_parent()
                                            .copied()
                                            .unwrap_or_default();
                                        NonlinearRigidMotion::new(
                                            *other.position(),
                                            local.inverse() * body.local_center_of_mass(),
                                            predicted * body.local_center_of_mass()
                                                - *body.position() * body.local_center_of_mass(),
                                            (predicted.rotation * body.rotation().inverse())
                                                .to_scaled_axis(),
                                        )
                                    },
                                );
                                if let Some(body) = other_body.filter(|body| body.is_dynamic()) {
                                    // Discrete contacts cover poses that arrive together. Hold a
                                    // fast authored path that would cross a non-CCD body's whole shape.
                                    if handle != native_id(id)
                                        || prescribed.is_none()
                                        || body.is_ccd_enabled() && self.config.solver.continuous
                                        || !motion_bounds(other.shape(), &other_motion)
                                            .intersects(&bounds)
                                        || collider
                                            .shape()
                                            .compute_aabb(&motion.position_at_time(1.))
                                            .intersects(
                                                &other.shape().compute_aabb(
                                                    &other_motion.position_at_time(1.),
                                                ),
                                            )
                                    {
                                        return false;
                                    }
                                }
                                if motion.angvel == rp::Vector::ZERO
                                    && other_motion.angvel == rp::Vector::ZERO
                                    && motion.linvel == other_motion.linvel
                                {
                                    return false;
                                }
                                casts = casts.saturating_add(1);
                                let hit = if motion.angvel == rp::Vector::ZERO
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
                                            max_time_of_impact: 1.,
                                            stop_at_penetration: false,
                                            target_distance: if sweep_sensors {
                                                0.0001 * self.config.length_unit
                                            } else {
                                                0.
                                            },
                                            ..Default::default()
                                        },
                                    )
                                } else {
                                    cast_shapes_nonlinear(
                                        &motion,
                                        collider.shape(),
                                        &other_motion,
                                        other.shape(),
                                        0.,
                                        1.,
                                        false,
                                    )
                                };
                                let time = match hit {
                                    Ok(hit) => hit.map(|hit| hit.time_of_impact),
                                    Err(_) => {
                                        failures = failures.saturating_add(1);
                                        Some(0.)
                                    }
                                };
                                let Some(time) = time.filter(|&time| time < 1.) else {
                                    return false;
                                };
                                let hit_blocker = if other_body.is_some_and(is_moving_kinematic) {
                                    other.parent().map(|body| {
                                        let (slot, generation) = body.into_raw_parts();
                                        BodyId { slot, generation }
                                    })
                                } else {
                                    None
                                };
                                if sweep_sensors && riders.is_empty() {
                                    if dash_stop.is_none_or(|(old, _)| time < old) {
                                        dash_stop = Some((
                                            time,
                                            hit_blocker
                                                .filter(|b| !paths.iter().any(|p| p.body == *b)),
                                        ));
                                    }
                                    return false;
                                }
                                blocker = hit_blocker;
                                true
                            })
                    })
            });
            if blocked_group {
                blocked.insert(id);
                // The rider and the incoming carrier share the same obstructed gap.
                blocked.extend(blocker);
            }
            if let Some((time, incoming)) = dash_stop {
                for body in std::iter::once(id).chain(incoming) {
                    clipped
                        .entry(body)
                        .and_modify(|old| *old = old.min(time))
                        .or_insert(time);
                }
            }
        }
        self.record_path_queries(casts, failures, false);
        for &id in &blocked {
            self.stop_prescribed_body(id);
        }
        for (id, fraction) in clipped {
            if !blocked.insert(id) {
                continue;
            }
            // A dash uses the cast's safe prefix so contact can consume its
            // remaining travel. A blocked carrier above stops as a whole.
            let body = &mut self.backend.bodies[native_id(id)];
            if body.body_type() == rp::RigidBodyType::KinematicPositionBased {
                body.set_next_kinematic_position(
                    super::super::kinematic_paths::interpolate_kinematic_pose(
                        *body.position(),
                        *body.next_position(),
                        f64::from(fraction),
                    ),
                );
            } else {
                body.set_linvel(body.linvel() * fraction, true);
                body.set_angvel(body.angvel() * fraction, true);
                velocity_stops.push(id);
            }
        }
        blocked.into_iter().collect()
    }

    fn separate_kcc_crowd(
        &self,
        plans: &mut [MovePlan],
        characters: &mut std::collections::BTreeMap<BodyId, CharacterRuntime>,
    ) {
        if plans.len() < 2 {
            return;
        }
        let mut cut = vec![1_f32; plans.len()];
        let mut groups: Vec<_> = (0..plans.len()).collect();
        let swept_bounds: Vec<_> = plans
            .iter()
            .map(|plan| {
                let initial = plan.shape.compute_aabb(&plan.shape_pose);
                initial.merged(&initial.translated(plan.translation))
            })
            .collect();
        let options = ShapeCastOptions {
            max_time_of_impact: 1.,
            stop_at_penetration: false,
            ..ShapeCastOptions::default()
        };
        for (i, a) in plans.iter().enumerate() {
            for (j, b) in plans.iter().enumerate().skip(i + 1) {
                if !swept_bounds[i].intersects(&swept_bounds[j])
                    || !a.groups.test(b.groups)
                    || !self
                        .contact_policies
                        .pair_allows(Some(native_id(a.id)), Some(native_id(b.id)))
                {
                    continue;
                }
                // One common fraction prevents an earlier stop from allowing a
                // following rider to finish a different part of the same motion.
                let left = crowd_group(&mut groups, i);
                let right = crowd_group(&mut groups, j);
                let group = left.min(right);
                groups[left.max(right)] = group;
                cut[group] = cut[left].min(cut[right]);
                if a.translation == b.translation {
                    continue;
                }
                characters
                    .get_mut(&a.id)
                    .unwrap()
                    .state
                    .character_pair_casts += 1;
                characters
                    .get_mut(&b.id)
                    .unwrap()
                    .state
                    .character_pair_casts += 1;
                if contact(
                    &a.shape_pose,
                    a.shape.as_ref(),
                    &b.shape_pose,
                    b.shape.as_ref(),
                    0.,
                )
                .is_ok_and(|hit| {
                    hit.is_some_and(|hit| (b.translation - a.translation).dot(hit.normal1) < 0.)
                }) {
                    cut[group] = 0.;
                    continue;
                }
                if let Ok(Some(hit)) = cast_shapes(
                    &a.shape_pose,
                    a.translation,
                    a.shape.as_ref(),
                    &b.shape_pose,
                    b.translation,
                    b.shape.as_ref(),
                    options,
                ) {
                    cut[group] = cut[group].min(hit.time_of_impact);
                }
            }
        }
        for (index, plan) in plans.iter_mut().enumerate() {
            let fraction = cut[crowd_group(&mut groups, index)];
            if fraction < 1. {
                plan.translation *= fraction;
                let runtime = characters.get_mut(&plan.id).unwrap();
                runtime.state.blocked_by_character = true;
                runtime.state.carry_translation =
                    (rp::Vector::from(runtime.state.carry_translation) * fraction).to_array();
                let end = plan.shape_pose.translation + plan.translation;
                // A peer can stop us before a proposed hit on a dynamic body.
                runtime.collisions.retain(|hit| {
                    (end - hit.character_pos.translation).dot(hit.hit.normal1)
                        <= runtime.config.skin_width * 0.01
                });
            }
        }
        let mut corrections = vec![rp::Vector::ZERO; plans.len()];
        let mut poses = Vec::with_capacity(plans.len());
        // Resolve endpoint capsule overlaps in stable body order and clip corrections against scenery.
        for _ in 0..4 {
            corrections.fill(rp::Vector::ZERO);
            poses.clear();
            poses.extend(plans.iter().map(|p| {
                let pose = rp::Pose::from_translation(p.translation) * p.shape_pose;
                (pose, p.shape.compute_aabb(&pose))
            }));
            for (i, a) in plans.iter().enumerate() {
                for (j, b) in plans.iter().enumerate().skip(i + 1) {
                    if !poses[i].1.intersects(&poses[j].1)
                        || !a.groups.test(b.groups)
                        || !self
                            .contact_policies
                            .pair_allows(Some(native_id(a.id)), Some(native_id(b.id)))
                    {
                        continue;
                    }
                    characters
                        .get_mut(&a.id)
                        .unwrap()
                        .state
                        .character_pair_contact_checks += 1;
                    characters
                        .get_mut(&b.id)
                        .unwrap()
                        .state
                        .character_pair_contact_checks += 1;
                    let Some(hit) = contact(
                        &poses[i].0,
                        a.shape.as_ref(),
                        &poses[j].0,
                        b.shape.as_ref(),
                        0.,
                    )
                    .expect("character capsules support contact queries")
                    .filter(|hit| hit.dist < 0.) else {
                        continue;
                    };
                    let up = a.controller.up;
                    let normal = (hit.normal1 - up * hit.normal1.dot(up))
                        .try_normalize()
                        .unwrap_or(rp::Vector::X);
                    let correction = normal * (-0.5 * hit.dist);
                    corrections[i] -= correction;
                    corrections[j] += correction;
                    characters
                        .get_mut(&a.id)
                        .unwrap()
                        .state
                        .blocked_by_character = true;
                    characters
                        .get_mut(&b.id)
                        .unwrap()
                        .state
                        .blocked_by_character = true;
                }
            }
            if corrections.iter().all(|c| *c == rp::Vector::ZERO) {
                break;
            }
            for (plan, delta) in plans.iter_mut().zip(&corrections) {
                if *delta == rp::Vector::ZERO {
                    continue;
                }
                let controller = KinematicCharacterController {
                    autostep: None,
                    snap_to_ground: None,
                    ..plan.controller
                };
                plan.translation += self.kcc_move(plan, controller, *delta, None).translation;
                if self.config.space == Space::PlanarXy {
                    plan.translation.z = 0.;
                }
            }
        }
    }
}

fn crowd_group(parents: &mut [usize], mut index: usize) -> usize {
    while index != parents[index] {
        parents[index] = parents[parents[index]];
        index = parents[index];
    }
    index
}

#[cfg(test)]
#[test]
fn p1b_kcc_chooses_the_nearest_walkable_part_of_a_compound() {
    use crate::physics3d::{BodyDesc, BodyKind, ShapePart, WorldConfig};

    let mut world = PhysicsWorld3d::new(WorldConfig::default()).unwrap();
    let part = |position, half_extents| ShapePart {
        pose: Pose {
            position,
            ..Pose::default()
        },
        shape: Shape::Box { half_extents },
    };
    let support = world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Compound {
                parts: vec![
                    part([0.49, 1., 0.], [0.25, 2., 2.]),
                    part([0., -0.1, 0.], [4., 0.1, 4.]),
                ],
            }),
        )
        .unwrap();
    world
        .create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., -0.105, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [4., 0.1, 4.],
            }),
        )
        .unwrap();
    let id = world
        .create_body(
            BodyDesc {
                kind: BodyKind::KinematicPosition,
                pose: Pose {
                    position: [0., 0.759, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Capsule {
                half_height: 0.5,
                radius: 0.25,
            }),
        )
        .unwrap();
    world
        .enable_character(id, CharacterConfig::default())
        .unwrap();
    world.refresh_queries();
    let runtime = &world.characters[&id];
    let collider = &world.backend.colliders[native_collider(runtime.collider)];
    let plan = MovePlan {
        id,
        body_pose: *world.backend.bodies[native_id(id)].position(),
        shape_pose: *collider.position(),
        shape: collider.shared_shape().clone(),
        groups: collider.collision_groups(),
        controller: runtime.config.controller(),
        translation: rp::Vector::ZERO,
    };
    assert_eq!(world.kcc_ground(&plan, 0.02).unwrap().body, support);
}
