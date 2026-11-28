use super::*;
use crate::physics3d::{KinematicPath, TickMotion, TickMotionBackup};
use crate::world::World;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Dash {
    entity: Entity,
    #[serde(with = "crate::checkpoint_codec::array")]
    translation: [f32; 3],
    result: Result<bool, UnifiedPhysicsError>,
}
#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct DashState {
    #[serde(with = "crate::checkpoint_codec::vector")]
    queued: Vec<Dash>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    requests: Vec<TickMotion>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    backups: Vec<TickMotionBackup>,
}

#[cfg(test)]
impl DashState {
    pub(in crate::engine) fn corrupt_runtime_payload_fixture(
        &mut self,
        case: usize,
        actor: Entity,
        body: BodyId,
    ) {
        match case {
            0 => self.queued.push(Dash {
                entity: actor,
                translation: [f32::NAN, 0., 0.],
                result: Ok(false),
            }),
            1 => self.requests[0].translation[0] = f32::NAN,
            2 => {
                #[derive(serde::Serialize)]
                struct Raw {
                    body: BodyId,
                    #[serde(with = "crate::checkpoint_codec::array")]
                    start: [f32; 3],
                    kind: rapier3d::prelude::RigidBodyType,
                    linear: rapier3d::prelude::Vector,
                    angular: rapier3d::prelude::Vector,
                }
                let raw = Raw {
                    body,
                    start: [0.; 3],
                    kind: rapier3d::prelude::RigidBodyType::KinematicVelocityBased,
                    linear: rapier3d::prelude::Vector::ZERO,
                    angular: rapier3d::prelude::Vector::ZERO,
                };
                self.backups.push(
                    crate::checkpoint_decode::from_bytes(&postcard::to_allocvec(&raw).unwrap())
                        .unwrap(),
                );
            }
            _ => unreachable!(),
        }
    }
}
impl UnifiedPhysicsRuntime {
    pub(super) fn has_queued_native_dash(&self, entity: Entity) -> bool {
        self.dash.queued.iter().any(|dash| dash.entity == entity)
    }
    pub(in crate::engine) fn queue_native_dash(
        &mut self,
        world: &World,
        entity: Entity,
        delta: Velocity,
        platforms: usize,
    ) -> Result<(), UnifiedPhysicsError> {
        if self.dash.queued.iter().any(|d| d.entity == entity) {
            return Err(PhysicsError::InvalidBody.into());
        }
        if self.dash.queued.len() == 128 {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        let translation = match self.physics.config().space {
            Space::PlanarXy => [delta.vx, delta.vy, 0.],
            Space::Spatial => [delta.vx, 0., -delta.vy],
        };
        let binding = self.bindings.get(&(entity.id, entity.generation));
        let character = if let Some(binding) = binding {
            self.physics.validate_tick_motion(&TickMotion {
                body: binding.body,
                translation,
            })?;
            self.physics.tick_motion_is_character(binding.body)
        } else {
            // An authored planar entity is imported at the upcoming fixed tick.
            if self.physics.config().space != Space::PlanarXy
                || !world.rigid_body(entity).is_some_and(|r| {
                    r.enabled && r.body_type == crate::components::RigidBodyType::Kinematic
                })
            {
                return Err(PhysicsError::WrongBodyKind.into());
            }
            false
        };
        if !character {
            let others = self
                .dash
                .queued
                .iter()
                .filter(|d| {
                    !self
                        .bindings
                        .get(&(d.entity.id, d.entity.generation))
                        .is_some_and(|b| self.physics.tick_motion_is_character(b.body))
                })
                .count();
            if others + platforms >= 16 {
                return Err(PhysicsError::CapacityExceeded.into());
            }
        }
        if self.controlled_spatial_actor == Some(entity) {
            self.actor_navigation.cancel();
        }
        self.dash.queued.push(Dash {
            entity,
            translation,
            result: Err(PhysicsError::InvalidBody.into()),
        });
        Ok(())
    }
    pub(super) fn validate_native_dash_slots(
        &self,
        world: &World,
        platforms: usize,
    ) -> Result<(), UnifiedPhysicsError> {
        if platforms + self.dash.queued.len() <= 16 {
            return Ok(());
        }
        let mut paths = platforms;
        for dash in &self.dash.queued {
            if !world.is_current_entity(dash.entity) {
                continue;
            }
            let binding = self.bindings.get(&(dash.entity.id, dash.entity.generation));
            let occupies_slot = if let Some(binding) = binding {
                !self.physics.tick_motion_is_character(binding.body)
                    && self
                        .physics
                        .validate_tick_motion(&TickMotion {
                            body: binding.body,
                            translation: dash.translation,
                        })
                        .is_ok()
            } else {
                self.physics.config().space == Space::PlanarXy
                    && world.rigid_body(dash.entity).is_some_and(|body| {
                        body.enabled
                            && body.body_type == crate::components::RigidBodyType::Kinematic
                    })
            };
            paths += usize::from(occupies_slot);
        }
        if paths > 16 {
            return Err(PhysicsError::CapacityExceeded.into());
        }
        Ok(())
    }

    pub(super) fn begin_native_dashes(
        &mut self,
        paths: &mut Vec<KinematicPath>,
    ) -> Result<(), UnifiedPhysicsError> {
        let mut requests = Vec::new();
        requests
            .try_reserve_exact(self.dash.queued.len())
            .map_err(|_| PhysicsError::CapacityExceeded)?;
        let mut results = [Ok(false); 128];
        for (dash, result) in self.dash.queued.iter().zip(&mut results) {
            let binding = self
                .bindings
                .get(&(dash.entity.id, dash.entity.generation))
                .ok_or(UnifiedPhysicsError::StaleEntity);
            *result = binding.and_then(|binding| {
                let request = TickMotion {
                    body: binding.body,
                    translation: dash.translation,
                };
                self.physics.validate_tick_motion(&request)?;
                requests.push(request);
                Ok(false)
            });
        }
        self.physics
            .begin_tick_motions(&requests, paths, &mut self.dash.backups)?;
        self.dash.requests = requests;
        for (dash, result) in self.dash.queued.iter_mut().zip(results) {
            dash.result = result;
        }
        Ok(())
    }
    pub(super) fn finish_native_dashes(&mut self, succeeded: bool) {
        self.physics.finish_tick_motions(&self.dash.backups);
        for dash in &mut self.dash.queued {
            if dash.result.is_err() {
                continue;
            }
            let result = (|| {
                if !succeeded {
                    return Err(PhysicsError::InvalidBody.into());
                }
                let binding = self
                    .bindings
                    .get(&(dash.entity.id, dash.entity.generation))
                    .ok_or(UnifiedPhysicsError::StaleEntity)?;
                let saved = self
                    .dash
                    .backups
                    .iter()
                    .find(|s| s.body == binding.body)
                    .ok_or(PhysicsError::InvalidBody)?;
                let state = self.physics.body_state(binding.body)?;
                let carry = self
                    .physics
                    .character_state(binding.body)
                    .map_or([0.; 3], |s| s.carry_translation);
                let progress: f64 = (0..3)
                    .map(|i| {
                        f64::from(state.pose.position[i] - saved.start[i] - carry[i])
                            * f64::from(dash.translation[i])
                    })
                    .sum();
                let length = dash
                    .translation
                    .iter()
                    .map(|v| f64::from(*v).powi(2))
                    .sum::<f64>()
                    .sqrt();
                let tolerance =
                    (1.0e-5 * f64::from(self.physics.config().length_unit)).min(length * 0.001);
                Ok(progress > tolerance * length)
            })();
            dash.result = result;
        }
        self.dash.backups.clear();
    }
    pub(in crate::engine) fn take_native_dash_result(
        &mut self,
        entity: Entity,
    ) -> Result<bool, UnifiedPhysicsError> {
        let index = self
            .dash
            .queued
            .iter()
            .position(|d| d.entity == entity)
            .ok_or(UnifiedPhysicsError::StaleEntity)?;
        self.dash.queued.remove(index).result
    }
}

mod file_payload_admission;
