//! Test-only comparison using Rapier's KCC and ordinary rigid-body step.
use super::*;
use crate::physics3d::KinematicPath;
use rapier3d::control::EffectiveCharacterMovement;
use rapier3d::parry::{
    bounding_volume::BoundingVolume,
    query::{cast_shapes, contact},
};

#[derive(Clone, Copy, Default, Eq, PartialEq)]
pub(in crate::physics3d) enum Experiment {
    #[default]
    Current,
    RigidProof,
    CharacterKcc,
}

struct MovePlan {
    id: BodyId,
    body_pose: rp::Pose,
    shape_pose: rp::Pose,
    shape: rp::SharedShape,
    groups: rp::InteractionGroups,
    controller: KinematicCharacterController,
    translation: rp::Vector,
}

impl PhysicsWorld3d {
    pub(crate) fn force_rigid_motion_proof(&mut self) {
        self.character_motion.experiment = Experiment::RigidProof;
    }

    pub(in crate::physics3d) fn rigid_motion_proof_is_forced(&self) -> bool {
        self.character_motion.experiment == Experiment::RigidProof
            && self.config.solver.continuous
            && self
                .backend
                .bodies
                .iter()
                .any(|(_, body)| body.is_enabled() && body.is_dynamic())
    }

    pub(crate) fn enable_experimental_character_kcc(&mut self) {
        self.character_motion.experiment = Experiment::CharacterKcc;
    }

    pub(in crate::physics3d) fn experimental_character_kcc_enabled(&self) -> bool {
        self.character_motion.experiment == Experiment::CharacterKcc
            && !self.characters.is_empty()
            && !self.step_motion.enabled
    }

    pub(in crate::physics3d) fn step_experimental_character_kcc(
        &mut self,
        paths: &[KinematicPath],
    ) -> Result<(), PhysicsError> {
        self.begin_fixed_step();
        for path in paths {
            let target = path.knots.last().expect("validated path").1;
            self.backend.bodies[native_id(path.body)]
                .set_next_kinematic_position(native_pose(target));
        }
        self.refresh_queries();
        let dt = self.backend.integration_parameters.dt;
        let mut characters = std::mem::take(&mut self.characters);
        self.character_order.clear();
        self.character_order.extend(characters.keys().copied());
        let mut plans = Vec::with_capacity(characters.len());
        for (&id, runtime) in &mut characters {
            if let Some(plan) = self.kcc_plan(id, runtime, dt) {
                plans.push(plan);
            }
        }
        self.solve_experimental_crowd(&mut plans, &mut characters);
        for plan in &plans {
            let translation = plan.translation;
            let state = &mut characters.get_mut(&plan.id).unwrap().state;
            state.translation = translation.to_array();
            state.velocity = (translation / dt).to_array();
            self.backend.bodies[native_id(plan.id)].set_next_kinematic_position(
                rp::Pose::from_translation(translation) * plan.body_pose,
            );
        }
        self.characters = characters;
        self.step_with_joints(0., 1.);
        let mut characters = std::mem::take(&mut self.characters);
        for plan in &mut plans {
            let runtime = characters.get_mut(&plan.id).unwrap();
            plan.shape_pose = *self.backend.colliders[native_collider(runtime.collider)].position();
            let support = if runtime.state.vertical_speed <= 0. {
                self.experimental_ground(plan, runtime.config.skin_width * 2.)
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
        self.query_updates.clear();
        self.finish_statistics();
        self.end_backend_motion_tick();
        self.actual_motion_result()
    }

    fn experimental_ground(&self, plan: &MovePlan, distance: f32) -> Option<ColliderRef> {
        let up = plan.controller.up;
        let min_up = plan.controller.max_slope_climb_angle.cos();
        let options = ShapeCastOptions {
            max_time_of_impact: distance,
            target_distance: 0.,
            stop_at_penetration: true,
            compute_impact_geometry_on_penetration: true,
        };
        let shape = plan.shape.as_ref();
        let handle = self.kcc_query(plan, plan.shape_pose, None, |queries| {
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
        })?;
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
        // A zero move asks Rapier to depenetrate even when movement input follows.
        plan.translation = self
            .kcc_move(&plan, simple, rp::Vector::ZERO, None)
            .translation;
        let mut controller = plan.controller;
        if !grounded || jump > 0. {
            controller.snap_to_ground = None;
        }
        let desired = (rp::Vector::from(runtime.input.velocity)
            + rp::Vector::from(runtime.tick_velocity)
            + up * walking_speed)
            * dt;
        let movement = self.kcc_move(&plan, controller, desired, None);
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
            if let Some(next) = next {
                let anchor = plan.shape_pose.translation + plan.translation;
                let local = platform.position().inverse_transform_point(anchor);
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
            carried_by,
            carry_translation: carry.to_array(),
            ..CharacterState::default()
        };
        Some(plan)
    }

    fn kcc_query<T>(
        &self,
        plan: &MovePlan,
        pose: rp::Pose,
        ignore: Option<rp::RigidBodyHandle>,
        query: impl FnOnce(rp::QueryPipeline<'_>) -> T,
    ) -> T {
        let allowed = |handle, c: &rp::Collider| {
            c.is_enabled()
                && c.parent().is_none_or(|parent| {
                    let (slot, generation) = parent.into_raw_parts();
                    Some(parent) != ignore
                        && self
                            .character_order
                            .binary_search(&BodyId { slot, generation })
                            .is_err()
                })
                && self
                    .contact_policies
                    .pair_allows(Some(native_id(plan.id)), c.parent())
                && self
                    .contact_policies
                    .one_way_allows(handle, c, plan.shape.as_ref(), &pose)
        };
        query(self.backend.query_pipeline_with_filter(rp::QueryFilter {
            flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
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
        self.kcc_query(plan, pose, ignore, |q| {
            controller.move_shape(0., &q, plan.shape.as_ref(), &pose, desired, |_| {})
        })
    }

    fn solve_experimental_crowd(
        &self,
        plans: &mut [MovePlan],
        characters: &mut std::collections::BTreeMap<BodyId, CharacterRuntime>,
    ) {
        if plans.len() < 2 {
            return;
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
    assert_eq!(
        world.experimental_ground(&plan, 0.02).unwrap().body,
        support
    );
}
