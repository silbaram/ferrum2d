use super::World;
use crate::components::{
    AngularVelocity, RigidBody, RigidBodyCcdDebugHit, RigidBodyType, RigidContactImpulse,
    Rotation2D, Velocity,
};
use crate::entity::Entity;

impl World {
    pub fn rigid_body(&self, entity: Entity) -> Option<RigidBody> {
        let i = self.valid_index(entity)?;
        self.rigid_bodies[i]
    }

    pub fn set_rigid_body(&mut self, entity: Entity, body: RigidBody) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.rigid_bodies[i] = Some(body);
        if self.velocities[i].is_none() {
            self.velocities[i] = Some(Velocity::default());
        }
        if self.rotations[i].is_none() {
            self.rotations[i] = Some(Rotation2D::default());
        }
        if self.angular_velocities[i].is_none() {
            self.angular_velocities[i] = Some(AngularVelocity::default());
        }
    }

    pub fn clear_rigid_body(&mut self, entity: Entity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        self.rigid_bodies[i] = None;
    }

    pub fn rigid_contact_impulse_count(&self) -> usize {
        self.rigid_contact_impulses.len()
    }

    pub fn rigid_contact_impulse_at(&self, index: usize) -> Option<RigidContactImpulse> {
        self.rigid_contact_impulses.get(index).copied()
    }

    pub fn rigid_contact_impulses(&self) -> impl Iterator<Item = RigidContactImpulse> + '_ {
        self.rigid_contact_impulses.iter().copied()
    }

    pub(crate) fn clear_rigid_contact_impulses(&mut self) {
        self.rigid_contact_impulses.clear();
    }

    pub(crate) fn record_rigid_contact_impulse(&mut self, impulse: RigidContactImpulse) {
        self.rigid_contact_impulses.push(impulse);
    }

    pub fn rigid_body_ccd_debug_hit_count(&self) -> usize {
        self.rigid_body_ccd_debug_hits.len()
    }

    pub fn rigid_body_ccd_debug_hit_at(&self, index: usize) -> Option<RigidBodyCcdDebugHit> {
        self.rigid_body_ccd_debug_hits.get(index).copied()
    }

    pub fn rigid_body_ccd_debug_hits(&self) -> impl Iterator<Item = RigidBodyCcdDebugHit> + '_ {
        self.rigid_body_ccd_debug_hits.iter().copied()
    }

    pub(crate) fn clear_rigid_body_ccd_debug_hits(&mut self) {
        self.rigid_body_ccd_debug_hits.clear();
    }

    pub(crate) fn record_rigid_body_ccd_debug_hit(&mut self, hit: RigidBodyCcdDebugHit) {
        self.rigid_body_ccd_debug_hits.push(hit);
    }

    pub fn apply_force(&mut self, entity: Entity, force: Velocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let Some(body) = self.rigid_bodies[i].as_mut() else {
            return;
        };
        if !body.enabled {
            return;
        }
        if body.body_type != RigidBodyType::Dynamic {
            return;
        }
        let mut applied = false;
        if force.vx.is_finite() {
            body.force.vx += force.vx;
            applied = applied || force.vx != 0.0;
        }
        if force.vy.is_finite() {
            body.force.vy += force.vy;
            applied = applied || force.vy != 0.0;
        }
        if applied {
            wake_rigid_body(body);
        }
    }

    pub fn apply_impulse(&mut self, entity: Entity, impulse: Velocity) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let Some(body) = self.rigid_bodies[i].as_mut() else {
            return;
        };
        if !body.enabled {
            return;
        }
        if body.body_type != RigidBodyType::Dynamic {
            return;
        }
        let mut applied = false;
        if impulse.vx.is_finite() {
            body.impulse.vx += impulse.vx;
            applied = applied || impulse.vx != 0.0;
        }
        if impulse.vy.is_finite() {
            body.impulse.vy += impulse.vy;
            applied = applied || impulse.vy != 0.0;
        }
        if applied {
            wake_rigid_body(body);
        }
    }

    pub fn apply_torque(&mut self, entity: Entity, torque: f32) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let Some(body) = self.rigid_bodies[i].as_mut() else {
            return;
        };
        if !body.enabled {
            return;
        }
        if body.body_type != RigidBodyType::Dynamic {
            return;
        }
        if torque.is_finite() {
            body.torque += torque;
            if torque != 0.0 {
                wake_rigid_body(body);
            }
        }
    }

    pub fn apply_angular_impulse(&mut self, entity: Entity, angular_impulse: f32) {
        let Some(i) = self.valid_index(entity) else {
            return;
        };
        let Some(body) = self.rigid_bodies[i].as_mut() else {
            return;
        };
        if !body.enabled {
            return;
        }
        if body.body_type != RigidBodyType::Dynamic {
            return;
        }
        if angular_impulse.is_finite() {
            body.angular_impulse += angular_impulse;
            if angular_impulse != 0.0 {
                wake_rigid_body(body);
            }
        }
    }
}

fn wake_rigid_body(body: &mut RigidBody) {
    if body.enabled && body.body_type == RigidBodyType::Dynamic {
        body.is_sleeping = false;
        body.sleep_timer_seconds = 0.0;
    }
}
