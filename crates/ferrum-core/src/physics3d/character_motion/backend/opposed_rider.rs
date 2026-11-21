//! A projected rate change is not by itself an external carry obstruction.
//! Only the already validated current/visible-active solid contact planes are
//! read here. Own support is not an independent opponent; no geometry search,
//! body/input/J write or new contact/filter/one-way decision is performed.
use super::*;

impl BackendMotionScratch {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn independent_carry_opponent(
        &self,
        rider: rp::RigidBodyHandle,
        support: rp::RigidBodyHandle,
        carried: rp::Vector,
        correction: rp::Vector,
        safe: Time,
        hit: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        work.charge(16)?;
        if !carried.is_finite() || !correction.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        for sample in &self.contacts {
            work.charge(1)?;
            if self.carry_opposed_at(
                sample, rider, support, carried, correction, safe, hit, end, bodies, work,
            )? {
                return Ok(true);
            }
        }
        // Charge the visibility visit too; hidden history never lends a plane.
        for active in &self.active_contacts {
            work.charge(1)?;
            if active.visible
                && self.carry_opposed_at(
                    &active.sample,
                    rider,
                    support,
                    carried,
                    correction,
                    safe,
                    hit,
                    end,
                    bodies,
                    work,
                )?
            {
                return Ok(true);
            }
        }
        Ok(false)
    }

    #[allow(clippy::too_many_arguments)]
    fn carry_opposed_at(
        &self,
        sample: &actual_scene::ContactSample,
        rider: rp::RigidBodyHandle,
        support: rp::RigidBodyHandle,
        carried: rp::Vector,
        correction: rp::Vector,
        safe: Time,
        hit: Time,
        end: Time,
        bodies: &rp::RigidBodySet,
        work: &mut Work,
    ) -> Result<bool, TrajectoryError> {
        work.charge(64)?;
        if sample.a.sensor || sample.b.sensor || sample.a.collider == sample.b.collider {
            return Ok(false);
        }
        let (other, normal) = if sample.a.parent == Some(rider) {
            (sample.b, -sample.contact.normal1)
        } else if sample.b.parent == Some(rider) {
            (sample.a, sample.contact.normal1)
        } else {
            return Ok(false);
        };
        if other.parent == Some(rider) || other.parent == Some(support) {
            return Ok(false);
        }
        // The normal points from the independent opponent toward the rider.
        // This plane must oppose actual carry, and the solved correction must
        // remove some of that inward component. An unrelated touching plane
        // cannot explain why a different transport component changed.
        let inward = carried.dot(normal);
        let removed = correction.dot(normal);
        if !normal.is_finite() || !inward.is_finite() || !removed.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        if inward >= 0. || removed <= 0. {
            return Ok(false);
        }
        let target = match other.role {
            Role::Character(id) => {
                // Same final geometry value used by the peer row. Do not
                // substitute its canonical physical momentum or old curve.
                let lookup = usize::BITS - self.character_values.len().max(1).leading_zeros();
                work.charge(u64::from(lookup) + 16)?;
                let index = self
                    .character_values
                    .binary_search_by_key(&id, |v| v.0)
                    .map_err(|_| TrajectoryError::InvalidReference)?;
                self.character_values[index].1
            }
            _ => {
                // Exactly the unary geometry-row owner and witness midpoint:
                // unchanged prescribed -> original Kernel derivative;
                // stopped/changed Native -> original-law continuation of the
                // current solved physical state; unowned fixed -> saved curve.
                // Its own Work admission precedes those fixed rate operations.
                let point = (sample.contact.point1 + sample.contact.point2) * 0.5;
                self.geometric_surface_rate(&other, safe, hit, end, point, bodies, work)?
            }
        };
        let closing = (carried - target).dot(normal);
        if !target.is_finite() || !closing.is_finite() {
            return Err(TrajectoryError::NonFinite);
        }
        Ok(closing < 0.)
    }
}

#[cfg(test)]
mod tests;
