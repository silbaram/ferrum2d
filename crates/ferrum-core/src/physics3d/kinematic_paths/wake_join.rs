//! A rejected first-hit bound proposes a new actual-kernel prefix, never an
//! accepted clock. Sleeping join is performed outside every solver borrow and
//! only at a newly queried full-geometry contact boundary.
use crate::physics3d::character_motion::backend::IncomingMotion;
use crate::physics3d::{
    character_motion::backend::WakeJoin,
    solver_trajectory::{Time, TrajectoryError, Work},
    PhysicsWorld3d,
};
use rapier3d::prelude as rp;
use rapier3d::utils::PoseOps;

pub(in crate::physics3d) fn wake_prefix_seconds(
    join: &WakeJoin,
    current_seconds: Time,
) -> Result<Time, TrajectoryError> {
    if !current_seconds.is_finite()
        || current_seconds <= 0.
        || !join.safe_time.is_finite()
        || !join.hit_time.is_finite()
        || join.safe_time < 0.
        || join.hit_time < join.safe_time
        || join.hit_time > current_seconds
    {
        return Err(TrajectoryError::InvalidTime);
    }
    // The upper contact bracket is a candidate only. Its different dt will be
    // integrated and continuously checked again before any time is consumed.
    if join.hit_time <= 0. {
        return Err(TrajectoryError::Unresolved);
    }
    Ok(join.hit_time)
}
fn actual_pose(
    collider: &rp::Collider,
    bodies: &rp::RigidBodySet,
) -> Result<rp::Pose, TrajectoryError> {
    match collider.parent() {
        Some(id) => {
            let body = bodies.get(id).ok_or(TrajectoryError::InvalidReference)?;
            Ok(*body.position() * collider.position_wrt_parent().copied().unwrap_or_default())
        }
        None => Ok(*collider.position()),
    }
}
fn same_pose(a: rp::Pose, b: rp::Pose) -> bool {
    a.translation.to_array().map(f32::to_bits) == b.translation.to_array().map(f32::to_bits)
        && a.rotation.to_array().map(f32::to_bits) == b.rotation.to_array().map(f32::to_bits)
}
fn point_velocity(
    parent: Option<rp::RigidBodyHandle>,
    bodies: &rp::RigidBodySet,
    incoming: IncomingMotion,
    point: rp::Vector,
    seconds: Time,
) -> Result<rp::Vector, TrajectoryError> {
    let Some(body) = parent.and_then(|id| bodies.get(id)) else {
        return Ok(rp::Vector::ZERO);
    };
    if body.is_sleeping() {
        return Ok(rp::Vector::ZERO);
    }
    let com = body
        .position()
        .prepend_translation(body.local_center_of_mass());
    if same_pose(com, incoming.start) {
        if !incoming.linear.is_finite() || !incoming.angular.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        return Ok(incoming.linear + incoming.angular.cross(point - com.translation));
    }
    if body.body_type() == rp::RigidBodyType::KinematicPositionBased {
        if !seconds.is_finite() || seconds <= 0. {
            return Err(TrajectoryError::InvalidTime);
        }
        let seconds = crate::physics3d::motion_time::native_duration(seconds)?;
        let inverse = 1. / seconds;
        if !inverse.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        let velocity = rp::RigidBodyPosition {
            position: *body.position(),
            next_position: *body.next_position(),
        }
        .interpolate_velocity(inverse, body.local_center_of_mass());
        let result = velocity.linvel + velocity.angvel.cross(point - com.translation);
        if !result.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        return Ok(result);
    }
    Ok(body.velocity_at_point(point))
}

impl PhysicsWorld3d {
    pub(in crate::physics3d) fn try_join_sleeping_motion(
        &mut self,
        join: &WakeJoin,
        work: &mut Work,
        max_scratch: usize,
    ) -> Result<bool, TrajectoryError> {
        work.charge(8)?;
        let bodies = &self.backend.bodies;
        let body = bodies
            .get(join.body)
            .ok_or(TrajectoryError::InvalidReference)?;
        if !body.is_enabled() || !body.is_dynamic() {
            return Err(TrajectoryError::InvalidReference);
        }
        let a = self
            .backend
            .colliders
            .get(join.a)
            .ok_or(TrajectoryError::InvalidReference)?;
        let b = self
            .backend
            .colliders
            .get(join.b)
            .ok_or(TrajectoryError::InvalidReference)?;
        if a.parent() != Some(join.body) && b.parent() != Some(join.body) {
            return Err(TrajectoryError::InvalidReference);
        }
        if !a.is_enabled()
            || !b.is_enabled()
            || a.is_sensor()
            || b.is_sensor()
            || a.parent() == b.parent()
            || !a.collision_groups().test(b.collision_groups())
            || !self.contact_policies.pair_allows(a.parent(), b.parent())
        {
            return Ok(false);
        }
        for parent in [a.parent(), b.parent()].into_iter().flatten() {
            if !bodies.get(parent).is_some_and(|b| b.is_enabled()) {
                return Ok(false);
            }
        }
        let pa = actual_pose(a, bodies)?;
        let pb = actual_pose(b, bodies)?;
        if !self
            .contact_policies
            .one_way_allows_at(join.a, &pa, b.shape(), &pb)
            || !self
                .contact_policies
                .one_way_allows_at(join.b, &pb, a.shape(), &pa)
        {
            return Ok(false);
        }
        // This is the existing native solver's contact/slop distance, not a
        // new shape shrink or a fabricated TOI. The exact positive distance and
        // approach are queried at this newly accepted prefix's actual poses.
        let mut margin = self.backend.integration_parameters.allowed_linear_error();
        for parent in [a.parent(), b.parent()].into_iter().flatten() {
            let (slot, generation) = parent.into_raw_parts();
            if let Some(character) = self
                .characters
                .get(&crate::physics3d::BodyId { slot, generation })
            {
                if character.config.push_mass == 0. {
                    return Ok(false);
                }
                // Existing finite-mass preplan's exact touching-contact query
                // range. Re-derive it from the current owner configuration.
                margin = margin.max(character.config.skin_width * 1.05);
            }
        }
        work.charge(1)?;
        let Some(contact) = rapier3d::parry::query::contact(&pa, a.shape(), &pb, b.shape(), margin)
            .map_err(|_| TrajectoryError::UnsupportedShape)?
        else {
            return Ok(false);
        };
        if !contact.dist.is_finite()
            || !contact.normal1.is_finite()
            || !contact.point1.is_finite()
            || !contact.point2.is_finite()
        {
            return Err(TrajectoryError::NonFinite);
        }
        let approach = (point_velocity(
            b.parent(),
            bodies,
            join.incoming_b,
            contact.point2,
            Time::from(self.backend.integration_parameters.dt),
        )? - point_velocity(
            a.parent(),
            bodies,
            join.incoming_a,
            contact.point1,
            Time::from(self.backend.integration_parameters.dt),
        )?)
        .dot(contact.normal1);
        if contact.dist > margin || (contact.dist > 0. && approach >= 0.) {
            return Ok(false);
        }
        if !body.is_sleeping() {
            return Ok(true);
        }
        // Existing whole-island wake visits/moves each stored member and may
        // clone its handles. Charge its conservative logical work/requested
        // temporary layout before entering that ordinary owner operation.
        let n = bodies.len();
        let bytes = n
            .checked_mul(
                3 * std::mem::size_of::<rp::RigidBodyHandle>() + std::mem::size_of::<usize>(),
            )
            .ok_or(TrajectoryError::WorkLimit)?;
        if bytes > max_scratch {
            return Err(TrajectoryError::WorkLimit);
        }
        work.charge(
            u64::try_from(bodies.motion_storage_slots())
                .map_err(|_| TrajectoryError::WorkLimit)?
                .checked_mul(16)
                .ok_or(TrajectoryError::WorkLimit)?,
        )?;
        // Shared solver references have ended before this Core-owned operation.
        // The normal native API wakes the connected sleeping island, preserving
        // its joints/contact ownership for the actual remaining backend solve.
        self.backend
            .islands
            .wake_up(&mut self.backend.bodies, join.body, true);
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::solver_trajectory::{Curve, Domain, Kernel, ShapeMotion};
    use crate::physics3d::{
        world::native_id, BodyDesc, BodyKind, ColliderDesc, Pose, Shape, WorldConfig,
    };
    fn fixture(
        gap: f32,
        mask: u32,
        velocity: f32,
    ) -> (PhysicsWorld3d, crate::physics3d::BodyId, WakeJoin) {
        let mut world = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        let wall = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicVelocity,
                    pose: Pose {
                        position: [0.35 + gap, 0., 0.],
                        ..Pose::default()
                    },
                    linear_velocity: [velocity, 0., 0.],
                    ..BodyDesc::default()
                },
                ColliderDesc {
                    mask,
                    ..ColliderDesc::new(Shape::Box {
                        half_extents: [0.1, 1., 1.],
                    })
                },
            )
            .unwrap();
        let body = world
            .create_body(
                BodyDesc {
                    kind: BodyKind::Dynamic,
                    ..BodyDesc::default()
                },
                ColliderDesc::new(Shape::Sphere { radius: 0.25 }),
            )
            .unwrap();
        world.set_sleeping(body, true).unwrap();
        let a = world.backend.bodies[native_id(wall)].colliders()[0];
        let b = world.backend.bodies[native_id(body)].colliders()[0];
        let incoming = |id| {
            let source = &world.backend.bodies[native_id(id)];
            let start = source
                .position()
                .prepend_translation(source.local_center_of_mass());
            let curve = rapier3d::pipeline::SolverBodyIntegration::from_velocity(
                native_id(id),
                0.,
                0.1,
                start,
                source.linvel(),
                source.angvel(),
            )
            .unwrap();
            IncomingMotion::from_motion(
                ShapeMotion {
                    curve: Curve::Integrated(
                        Kernel::from_native(
                            curve,
                            Domain::new(
                                Time::from(curve.motion.start_time),
                                Time::from(curve.motion.end_time),
                            )
                            .unwrap(),
                        )
                        .unwrap(),
                    ),
                    local_center: source.local_center_of_mass(),
                    local_pose: rp::Pose::IDENTITY,
                },
                0.,
            )
        };
        let join = WakeJoin {
            body: native_id(body),
            a,
            b,
            safe_time: 0.,
            hit_time: 0.05,
            incoming_a: incoming(wall),
            incoming_b: incoming(body),
        };
        (world, body, join)
    }
    #[test]
    fn wake_join_needs_new_full_geometry_contact_and_current_filter_approach() {
        for (gap, mask, velocity, expected) in [
            (0.0005, u32::MAX, -1., true),
            (0.02, u32::MAX, -1., false),
            (0.0005, 0, -1., false),
            (0.0005, u32::MAX, 1., false),
        ] {
            let (mut world, body, join) = fixture(gap, mask, velocity);
            let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
            let mut work = Work {
                used: 0,
                limit: u64::MAX,
            };
            assert_eq!(
                world.try_join_sleeping_motion(&join, &mut work, 1 << 20),
                Ok(expected)
            );
            assert_eq!(world.body_state(body).unwrap().sleeping, !expected);
            if !expected {
                assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
            }
        }
    }
    #[test]
    fn stale_incoming_motion_cannot_wake_stationary_positive_gap() {
        let (mut world, body, mut join) = fixture(0.0005, u32::MAX, 0.);
        join.incoming_a.start.translation.x += 0.1;
        join.incoming_a.linear = -rp::Vector::X;
        let before = world.capture_snapshot().unwrap().encoded_bytes().to_vec();
        let mut work = Work {
            used: 0,
            limit: u64::MAX,
        };
        assert_eq!(
            world.try_join_sleeping_motion(&join, &mut work, 1 << 20),
            Ok(false)
        );
        assert!(world.body_state(body).unwrap().sleeping);
        assert_eq!(world.capture_snapshot().unwrap().encoded_bytes(), before);
        assert_eq!(wake_prefix_seconds(&join, 0.1), Ok(0.05));
        join.hit_time = Time::NAN;
        assert_eq!(
            wake_prefix_seconds(&join, 0.1),
            Err(TrajectoryError::InvalidTime)
        );
    }
}
