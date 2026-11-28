use super::*;
use rapier3d::parry::query::{ShapeCastHit, Unsupported};

struct Push {
    actor: usize,
    time: f32,
    direction: rp::Vector,
    distance: f32,
}

pub(super) fn is_moving_kinematic(body: &rp::RigidBody) -> bool {
    body.is_enabled()
        && match body.body_type() {
            rp::RigidBodyType::KinematicPositionBased => body.position() != body.next_position(),
            rp::RigidBodyType::KinematicVelocityBased => {
                body.linvel() != rp::Vector::ZERO || body.angvel() != rp::Vector::ZERO
            }
            _ => false,
        }
}

impl PhysicsWorld3d {
    pub(super) fn push_characters_with_kinematics(
        &mut self,
        plans: &mut [MovePlan],
        characters: &mut BTreeMap<BodyId, CharacterRuntime>,
        blocked: &mut Vec<BodyId>,
        mut pushes: Option<&mut BTreeMap<(BodyId, BodyId), rp::Vector>>,
    ) {
        let movers: Vec<_> = self
            .backend
            .bodies
            .iter()
            .filter(|(_, body)| is_moving_kinematic(body))
            .map(|(handle, _)| handle)
            .filter(|handle| {
                self.character_order
                    .binary_search(&body_id(*handle))
                    .is_err()
            })
            .collect();
        let mut hits = Vec::new();
        let mut accepted = Vec::new();
        for mover in movers {
            hits.clear();
            accepted.clear();
            let stopped = self
                .kinematic_pushes(mover, plans, characters, &mut hits)
                .is_err()
                || !self.try_kinematic_pushes(mover, plans, characters, &hits, &mut accepted);
            if stopped {
                let body = body_id(mover);
                self.stop_prescribed_body(body);
                self.record_character_stop();
                self.record_path_stop();
                blocked.push(body);
            } else {
                for (actor, translation) in accepted.drain(..) {
                    if let Some(steps) = pushes.as_deref_mut() {
                        *steps.entry((body_id(mover), plans[actor].id)).or_default() +=
                            translation - plans[actor].translation;
                    }
                    plans[actor].translation = translation;
                }
            }
        }
    }

    fn kinematic_pushes(
        &self,
        mover: rp::RigidBodyHandle,
        plans: &[MovePlan],
        characters: &mut BTreeMap<BodyId, CharacterRuntime>,
        hits: &mut Vec<Push>,
    ) -> Result<(), Unsupported> {
        let body = &self.backend.bodies[mover];
        let dt = self.backend.integration_parameters.dt;
        let schedule = self.backend_pass_schedule();
        for &fixture in body.colliders() {
            let collider = &self.backend.colliders[fixture];
            if !collider.is_enabled() || collider.is_sensor() {
                continue;
            }
            let motion = accepted_collider_motion(body, collider, dt, &schedule);
            let bounds = motion_bounds(collider.shape(), &motion);
            for (actor, plan) in plans.iter().enumerate() {
                let runtime = characters.get_mut(&plan.id).unwrap();
                let skin = runtime.config.skin_width;
                let capsule = plan.shape.as_ref();
                let start = plan.shape_pose;
                let initial = capsule.compute_aabb(&start);
                if runtime.state.carried_by == Some(body_id(mover))
                    || runtime
                        .support_motion
                        .is_some_and(|(support, _, _)| support == body_id(mover))
                    || !plan.groups.test(collider.collision_groups())
                    || !self
                        .contact_policies
                        .pair_allows(Some(native_id(plan.id)), Some(mover))
                    || !self
                        .contact_policies
                        .one_way_allows(fixture, collider, capsule, &start)
                    || !bounds.intersects(
                        &initial
                            .merged(&initial.translated(plan.translation))
                            .loosened(skin),
                    )
                {
                    continue;
                }
                runtime.state.moving_obstacle_casts += 1;
                let hit = cast_kinematic_push(collider.shape(), &motion, plan, skin).map_err(
                    |error| {
                        runtime.state.failed_moving_obstacle_casts += 1;
                        error
                    },
                )?;
                let Some(hit) = hit else { continue };
                let at_hit = motion.position_at_time(hit.time_of_impact);
                let direction = at_hit.rotation * hit.normal1;
                let travel = motion.position_at_time(1.) * hit.witness1 - at_hit * hit.witness1;
                let remaining = travel - plan.translation * (1. - hit.time_of_impact);
                let distance = remaining.dot(direction);
                if distance <= 0. {
                    continue;
                }
                let push = Push {
                    actor,
                    time: hit.time_of_impact,
                    direction,
                    distance: distance
                        + if motion.angvel == rp::Vector::ZERO {
                            0.
                        } else {
                            skin
                        },
                };
                if let Some(old) = hits.iter_mut().find(|old| old.actor == actor) {
                    if push.time < old.time {
                        *old = push;
                    }
                } else {
                    hits.push(push);
                }
            }
        }
        hits.sort_unstable_by(|a, b| a.time.total_cmp(&b.time).then(a.actor.cmp(&b.actor)));
        Ok(())
    }

    fn try_kinematic_pushes(
        &self,
        mover: rp::RigidBodyHandle,
        plans: &[MovePlan],
        characters: &mut BTreeMap<BodyId, CharacterRuntime>,
        hits: &[Push],
        accepted: &mut Vec<(usize, rp::Vector)>,
    ) -> bool {
        for (index, hit) in hits.iter().enumerate() {
            let plan = &plans[hit.actor];
            let runtime = characters.get_mut(&plan.id).unwrap();
            runtime.state.blocked_by_moving_obstacle = true;
            runtime.state.moving_obstacle_contact_checks += 1;
            let skin = runtime.config.skin_width;
            let direction = hit.direction;
            let mut desired = direction * hit.distance;
            for (old, &(_, previous)) in hits[..index].iter().zip(accepted.iter()) {
                let peer = &plans[old.actor];
                if direction.dot(old.direction) > 0.99
                    && plan.groups.test(peer.groups)
                    && self
                        .contact_policies
                        .pair_allows(Some(native_id(plan.id)), Some(native_id(peer.id)))
                {
                    desired += direction
                        * capsule_push_spacing(plan, desired, peer, previous, direction, skin);
                }
            }
            let controller = KinematicCharacterController {
                autostep: None,
                snap_to_ground: None,
                ..plan.controller
            };
            let movement = self
                .kcc_move(plan, controller, desired, Some(mover))
                .translation;
            if (desired - movement).dot(direction)
                > self.backend.integration_parameters.allowed_linear_error()
            {
                return false;
            }
            accepted.push((hit.actor, plan.translation + movement));
        }
        true
    }
}

fn body_id(handle: rp::RigidBodyHandle) -> BodyId {
    let (slot, generation) = handle.into_raw_parts();
    BodyId { slot, generation }
}

fn cast_kinematic_push(
    shape: &dyn rp::Shape,
    motion: &NonlinearRigidMotion,
    plan: &MovePlan,
    skin: f32,
) -> Result<Option<ShapeCastHit>, Unsupported> {
    let capsule = plan.shape.as_ref();
    if motion.angvel == rp::Vector::ZERO {
        cast_shapes(
            &motion.start,
            motion.linvel,
            shape,
            &plan.shape_pose,
            plan.translation,
            capsule,
            ShapeCastOptions {
                max_time_of_impact: 1.,
                target_distance: skin,
                stop_at_penetration: false,
                compute_impact_geometry_on_penetration: true,
            },
        )
    } else {
        let actor = NonlinearRigidMotion::new(
            plan.shape_pose,
            rp::Vector::ZERO,
            plan.translation,
            rp::Vector::ZERO,
        );
        cast_shapes_nonlinear(motion, shape, &actor, capsule, 0., 1., false)
    }
}

fn capsule_push_spacing(
    plan: &MovePlan,
    push: rp::Vector,
    peer: &MovePlan,
    peer_translation: rp::Vector,
    axis: rp::Vector,
    skin: f32,
) -> f32 {
    let shape = plan.shape.as_ref();
    let other = peer.shape.as_ref();
    let end = rp::Pose::from_translation(plan.translation + push) * plan.shape_pose;
    let peer_end = rp::Pose::from_translation(peer_translation) * peer.shape_pose;
    use rapier3d::parry::shape::SupportMap;
    let a = shape.as_capsule().unwrap().support_point(&end, -axis);
    let b = other.as_capsule().unwrap().support_point(&peer_end, axis);
    let clearance = (b - a).dot(axis) + skin;
    if clearance <= 0. {
        return 0.;
    }
    let ahead = rp::Pose::from_translation(axis * (clearance + skin)) * end;
    let options = ShapeCastOptions::with_max_time_of_impact(clearance + skin);
    let hit = cast_shapes(
        &ahead,
        -axis,
        shape,
        &peer_end,
        rp::Vector::ZERO,
        other,
        ShapeCastOptions {
            target_distance: skin,
            ..options
        },
    );
    hit.ok()
        .flatten()
        .map_or(0., |hit| clearance + skin - hit.time_of_impact)
}
