//! Actual suffix geometry for active velocity-kinematic angular contacts.
//! Retain every instantaneous/static plane; a new velocity is recast by the
//! existing bounded timeline before it can become a character target.
use super::{Contact, MotionQuery, MotionResult};
use crate::physics3d::character_constraints::{project, Plane};
use crate::physics3d::solver_trajectory::Time;
use rapier3d::parry::query::contact;
use rapier3d::prelude as rp;

pub(in crate::physics3d) fn endpoint_plane_at_pose(
    target: &rp::Collider,
    target_pose: &rp::Pose,
    source: &rp::Collider,
    current: &rp::Pose,
    velocity: rp::Vector,
    remaining: Time,
    skin: f32,
) -> Result<Option<Plane>, ()> {
    let endpoint = rp::Pose::from_translation(velocity * remaining as f32) * current;
    let hit =
        contact(target_pose, target.shape(), &endpoint, source.shape(), skin).map_err(|_| ())?;
    let Some(hit) = hit else {
        return Ok(None);
    };
    let offset =
        hit.normal1.dot(velocity) + ((f64::from(skin) - f64::from(hit.dist)) / remaining) as f32;
    if !hit.normal1.is_finite() || !offset.is_finite() {
        return Err(());
    }
    Ok(Some(Plane {
        normal: hit.normal1,
        offset,
    }))
}

pub(super) fn account_suffix_carry(
    contacts: &[Option<Contact>; 12],
    correction: rp::Vector,
    carry_velocity: &mut rp::Vector,
    time: Time,
    out: &mut MotionResult,
) {
    let amount = correction.length();
    if amount > 0.0 {
        let direction = correction / amount;
        let removed = (-carry_velocity.dot(direction)).max(0.0).min(amount);
        *carry_velocity += direction * removed;
        if removed > 1.0e-7 && out.carry_fraction.is_none() {
            out.carry_fraction = Some(time);
            out.carry_blocker = contacts
                .iter()
                .flatten()
                .find_map(|c| (c.normal.dot(direction) > 0.0).then_some(c.body).flatten());
        }
    }
}

impl MotionQuery<'_> {
    fn angular_kinematic(&self, c: &Contact) -> bool {
        self.scene
            .get(c.handle)
            .is_some_and(|m| m.angvel != rp::Vector::ZERO)
            && self
                .world
                .colliders
                .get(c.handle)
                .and_then(|c| c.parent())
                .and_then(|id| self.world.bodies.get(id))
                .is_some_and(|b| b.body_type() == rp::RigidBodyType::KinematicVelocityBased)
    }

    pub(super) fn angular_suffix_velocity(
        &self,
        contacts: &[Option<Contact>; 12],
        current: &rp::Pose,
        velocity: rp::Vector,
        remaining: Time,
        out: &mut MotionResult,
    ) -> Result<rp::Vector, ()> {
        // Ordinary linear, dynamic and position-prescribed paths keep their
        // original arithmetic, query counts and velocity projection.
        if remaining <= 0.0 || !contacts.iter().flatten().any(|c| self.angular_kinematic(c)) {
            return Ok(velocity);
        }
        // At most twelve original planes, twelve angular endpoint planes and
        // two planar-lock planes. No heap, shape clone or enlarged query AABB.
        let mut planes = [Plane::default(); 26];
        let mut count = 0;
        for c in contacts.iter().flatten() {
            planes[count] = Plane {
                normal: c.normal,
                offset: c.normal.dot(c.velocity),
            };
            count += 1;
        }
        if self.policies.planar {
            planes[count] = Plane {
                normal: rp::Vector::Z,
                offset: 0.0,
            };
            planes[count + 1] = Plane {
                normal: -rp::Vector::Z,
                offset: 0.0,
            };
            count += 2;
        }
        for c in contacts
            .iter()
            .flatten()
            .filter(|c| self.angular_kinematic(c))
        {
            let target = &self.world.colliders[c.handle];
            let motion = self.scene.get(c.handle).expect("active angular target");
            out.contact_checks += 1;
            match endpoint_plane_at_pose(
                target,
                &self.scene.target_pose(c.handle, motion, 1.),
                self.collider,
                current,
                velocity,
                remaining,
                self.config.skin_width,
            ) {
                Ok(Some(plane)) => {
                    planes[count] = plane;
                    count += 1;
                }
                Ok(None) => {}
                Err(()) => {
                    out.contact_failures += 1;
                    return Err(());
                }
            }
        }
        project(velocity, &planes[..count]).ok_or(())
    }
}

#[cfg(test)]
mod tests;
