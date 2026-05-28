use super::World;
use crate::components::{AngularVelocity, Rotation2D, Transform2D, Velocity};
use crate::entity::Entity;

impl World {
    pub fn transform(&self, entity: Entity) -> Option<Transform2D> {
        let i = self.valid_index(entity)?;
        self.transforms[i]
    }

    pub fn set_transform(&mut self, entity: Entity, transform: Transform2D) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.transforms[i] = Some(transform);
    }

    pub fn velocity(&self, entity: Entity) -> Option<Velocity> {
        let i = self.valid_index(entity)?;
        self.velocities[i]
    }

    pub fn set_velocity(&mut self, entity: Entity, velocity: Velocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.velocities[i] = Some(velocity);
    }

    pub fn rotation(&self, entity: Entity) -> Option<Rotation2D> {
        let i = self.valid_index(entity)?;
        self.rotations[i]
    }

    pub fn set_rotation(&mut self, entity: Entity, rotation: Rotation2D) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.rotations[i] = Some(rotation);
    }

    pub fn angular_velocity(&self, entity: Entity) -> Option<AngularVelocity> {
        let i = self.valid_index(entity)?;
        self.angular_velocities[i]
    }

    pub fn set_angular_velocity(&mut self, entity: Entity, angular_velocity: AngularVelocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.angular_velocities[i] = Some(angular_velocity);
    }
}
