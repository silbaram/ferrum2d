//! Capsule constraints may consume a prescribed command at its obstruction time.
use super::character::CharacterPreview;
use super::motion_time::Time;
use super::world::native_id;
use super::{BodyId, PhysicsWorld3d};
use rapier3d::prelude as rp;
fn moving(body: &rp::RigidBody) -> bool {
    body.is_enabled()
        && match body.body_type() {
            rp::RigidBodyType::KinematicPositionBased => body.position() != body.next_position(),
            rp::RigidBodyType::KinematicVelocityBased => {
                body.linvel() != rp::Vector::ZERO || body.angvel() != rp::Vector::ZERO
            }
            rp::RigidBodyType::Dynamic => true,
            _ => false,
        }
}
impl PhysicsWorld3d {
    pub(super) fn has_moving_character_obstacles(&self) -> bool {
        !self.characters.is_empty()
            && self.backend.bodies.iter().any(|(id, b)| {
                let (slot, generation) = id.into_raw_parts();
                moving(b) && !self.characters.contains_key(&BodyId { slot, generation })
            })
    }
    pub(super) fn character_stops(
        &self,
        saved: &[CharacterPreview],
        stopped: &[BodyId],
        out: &mut Vec<BodyId>,
    ) -> Time {
        out.clear();
        let mut earliest = 1.0;
        let mut request = |body: BodyId, fraction: Time| {
            if stopped.contains(&body)
                || self.actual_path_is_guarded(body)
                || self.characters.contains_key(&body)
                || !self
                    .backend
                    .bodies
                    .get(native_id(body))
                    .is_some_and(|b| b.is_kinematic() && moving(b))
            {
                return;
            }
            let fraction = fraction.clamp(0.0, 1.0);
            if fraction < earliest {
                earliest = fraction;
                out.clear();
            }
            if fraction == earliest && !out.contains(&body) {
                out.push(body);
            }
        };
        for backup in saved {
            let Some(runtime) = self.characters.get(&backup.id) else {
                continue;
            };
            if let Some(stop) = &runtime.motion_stop {
                for &body in stop.bodies.iter().flatten() {
                    request(body, stop.fraction);
                }
            }
        }
        earliest
    }
    pub(super) fn stop_character_obstacle(&mut self, id: BodyId) {
        self.stop_prescribed_body(id);
        self.record_character_stop();
    }
}
