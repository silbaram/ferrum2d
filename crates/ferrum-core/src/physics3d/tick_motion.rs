//! Transient gameplay translation over one full fixed tick. Input and body kind
//! are restored after all path subdivisions; ordinary poses never teleport.
use super::types::{valid_pose, valid_vector, validate_plane};
use super::world::{native_id, native_pose};
use super::{BodyId, KinematicPath, PhysicsError, PhysicsWorld3d, Pose};
use rapier3d::prelude as rp;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct TickMotion {
    pub body: BodyId,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub translation: [f32; 3],
}
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct TickMotionBackup {
    pub body: BodyId,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub start: [f32; 3],
    kind: rp::RigidBodyType,
    linear: rp::Vector,
    angular: rp::Vector,
}
impl PhysicsWorld3d {
    pub(crate) fn validate_tick_motion(&self, request: &TickMotion) -> Result<(), PhysicsError> {
        let body = self
            .backend
            .bodies
            .get(native_id(request.body))
            .ok_or(PhysicsError::StaleBody)?;
        if !body.is_enabled() || !body.is_kinematic() {
            return Err(PhysicsError::WrongBodyKind);
        }
        if !body.colliders().iter().any(|id| {
            self.backend
                .colliders
                .get(*id)
                .is_some_and(|c| c.is_enabled())
        }) {
            return Err(PhysicsError::InvalidCollider);
        }
        if body.body_type() == rp::RigidBodyType::KinematicVelocityBased
            && body.angvel().length() * self.config.step_seconds > std::f32::consts::TAU
        {
            return Err(PhysicsError::InvalidBody);
        }
        let velocity = request.translation.map(|v| v / self.config.step_seconds);
        if !valid_vector(&request.translation) || !valid_vector(&velocity) {
            return Err(PhysicsError::InvalidBody);
        }
        validate_plane(
            self.config.space,
            Pose::default(),
            request.translation,
            [0.; 3],
        )?;
        let count = if body.body_type() == rp::RigidBodyType::KinematicVelocityBased {
            ((body.angvel().length() * self.config.step_seconds / std::f32::consts::FRAC_PI_2)
                .ceil() as usize)
                .clamp(1, 4)
        } else {
            1
        };
        for i in 1..=count {
            let fraction = i as f32 / count as f32;
            let mut target = if self.characters.contains_key(&request.body) {
                *body.position()
            } else if body.body_type() == rp::RigidBodyType::KinematicVelocityBased {
                body.predict_position_using_velocity(self.config.step_seconds * fraction)
            } else {
                *body.next_position()
            };
            target.translation += rp::Vector::from(request.translation) * fraction;
            if !valid_pose(Pose {
                position: target.translation.to_array(),
                rotation: target.rotation.to_array(),
            }) {
                return Err(PhysicsError::InvalidBody);
            }
            if body.locked_axes().contains(rp::LockedAxes::ROTATION_LOCKED)
                && target.rotation.to_array() != body.rotation().to_array()
                && target.rotation.to_array() != body.rotation().to_array().map(|v| -v)
            {
                return Err(PhysicsError::LockedRotation);
            }
        }
        Ok(())
    }
    pub(crate) fn tick_motion_is_character(&self, id: BodyId) -> bool {
        self.characters.contains_key(&id)
    }

    /// Validate every request/path slot before any body or controller is changed.
    pub(crate) fn begin_tick_motions(
        &mut self,
        requests: &[TickMotion],
        paths: &mut Vec<KinematicPath>,
        saved: &mut Vec<TickMotionBackup>,
    ) -> Result<(), PhysicsError> {
        if requests.is_empty() {
            saved.clear();
            return Ok(());
        }
        self.validate_kinematic_paths(paths)?;
        let mut additional = 0;
        for (i, request) in requests.iter().enumerate() {
            self.validate_tick_motion(request)?;
            if requests[..i].iter().any(|r| r.body == request.body)
                || paths.iter().any(|p| p.body == request.body)
            {
                return Err(PhysicsError::InvalidBody);
            }
            additional += usize::from(!self.characters.contains_key(&request.body));
        }
        if paths.len() + additional > 16 {
            return Err(PhysicsError::CapacityExceeded);
        }
        if !self.backend_motion_enabled() {
            self.prepare_rapier_ratio_tick()?;
        }
        saved.clear();
        for request in requests {
            let body = &mut self.backend.bodies[native_id(request.body)];
            saved.push(TickMotionBackup {
                body: request.body,
                start: body.translation().to_array(),
                kind: body.body_type(),
                linear: body.linvel(),
                angular: body.angvel(),
            });
            if let Some(character) = self.characters.get_mut(&request.body) {
                character.tick_velocity = request.translation.map(|v| v / self.config.step_seconds);
            } else {
                let count = if body.body_type() == rp::RigidBodyType::KinematicVelocityBased {
                    ((body.angvel().length() * self.config.step_seconds
                        / std::f32::consts::FRAC_PI_2)
                        .ceil() as usize)
                        .clamp(1, 4)
                } else {
                    1
                };
                let mut knots = Vec::with_capacity(count);
                for index in 1..=count {
                    let fraction = index as f32 / count as f32;
                    let mut target = if body.body_type()
                        == rp::RigidBodyType::KinematicVelocityBased
                    {
                        body.predict_position_using_velocity(self.config.step_seconds * fraction)
                    } else {
                        *body.next_position()
                    };
                    target.translation += rp::Vector::from(request.translation) * fraction;
                    knots.push((
                        fraction,
                        Pose {
                            position: target.translation.to_array(),
                            rotation: target.rotation.to_array(),
                        },
                    ));
                }
                body.set_body_type(rp::RigidBodyType::KinematicPositionBased, true);
                if let Some((_, target)) = knots.last() {
                    body.set_next_kinematic_position(native_pose(*target));
                }
                paths.push(KinematicPath {
                    body: request.body,
                    sweep_sensors: true,
                    knots,
                });
            }
        }
        Ok(())
    }
    pub(crate) fn finish_tick_motions(&mut self, saved: &[TickMotionBackup]) {
        for backup in saved {
            if let Some(character) = self.characters.get_mut(&backup.body) {
                character.tick_velocity = [0.; 3];
            } else if let Some(body) = self.backend.bodies.get_mut(native_id(backup.body)) {
                body.set_body_type(backup.kind, true);
                if backup.kind == rp::RigidBodyType::KinematicVelocityBased {
                    body.set_linvel(backup.linear, true);
                    body.set_angvel(backup.angular, true);
                }
                body.set_next_kinematic_position(native_pose(Pose {
                    position: body.translation().to_array(),
                    rotation: body.rotation().to_array(),
                }));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics3d::{BodyDesc, BodyKind, CharacterConfig, ColliderDesc, Shape, WorldConfig};
    #[test]
    fn native_dash_character_upward_motion_does_not_reground_inside_skin() {
        let mut w = PhysicsWorld3d::new(WorldConfig {
            gravity: [0.; 3],
            ..WorldConfig::default()
        })
        .unwrap();
        w.create_body(
            BodyDesc {
                kind: BodyKind::Fixed,
                pose: Pose {
                    position: [0., -0.5, 0.],
                    ..Pose::default()
                },
                ..BodyDesc::default()
            },
            ColliderDesc::new(Shape::Box {
                half_extents: [10., 0.5, 10.],
            }),
        )
        .unwrap();
        let a = w
            .create_body(
                BodyDesc {
                    kind: BodyKind::KinematicPosition,
                    pose: Pose {
                        position: [0., 0.7595, 0.],
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
        w.enable_character(a, CharacterConfig::default()).unwrap();
        w.step();
        assert!(w.character_state(a).unwrap().grounded);
        let before = w.body_state(a).unwrap().pose.position[1];
        let mut paths = Vec::new();
        let mut saved = Vec::new();
        w.begin_tick_motions(
            &[TickMotion {
                body: a,
                translation: [0., 0.001, 0.],
            }],
            &mut paths,
            &mut saved,
        )
        .unwrap();
        w.step_with_kinematic_paths(&paths).unwrap();
        w.finish_tick_motions(&saved);
        assert!(w.body_state(a).unwrap().pose.position[1] > before + 0.0009);
        assert!(
            !w.character_state(a).unwrap().grounded,
            "an upward dash was cancelled by the skin support probe"
        );
    }
}
