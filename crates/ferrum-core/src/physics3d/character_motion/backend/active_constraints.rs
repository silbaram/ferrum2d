//! Contact identity lifetime for virtual, zero-mass geometry only.
//!
//! The immutable free plan is never replaced by a prior projected velocity.
//! Instead, a contact encountered in this Native context can contribute its
//! freshly queried inequality to the next simultaneous suffix projection.
//! Physical rows, momentum, impulses and grounding never read this history.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Primitive {
    Box([u32; 3]),
    Capsule([u32; 7]),
}

impl Primitive {
    fn of(shape: &dyn rp::Shape) -> Option<Self> {
        if let Some(shape) = shape.as_cuboid() {
            Some(Self::Box(shape.half_extents.to_array().map(f32::to_bits)))
        } else {
            shape.as_capsule().map(|shape| {
                let a = shape.segment.a.to_array();
                let b = shape.segment.b.to_array();
                Self::Capsule([a[0], a[1], a[2], b[0], b[1], b[2], shape.radius].map(f32::to_bits))
            })
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(in crate::physics3d::character_motion) struct ActiveContact {
    pub sample: actual_scene::ContactSample,
    shapes: [Primitive; 2],
    /// The original safe witness distance, floored only by the unchanged
    /// pair clearance. This per-contact envelope never grows on refresh.
    envelope: f32,
    accepted_at: Time,
    pub visible: bool,
}

impl ActiveContact {
    pub(in crate::physics3d::character_motion) fn is_accepted_peer(
        &self,
        a: &ColliderTrajectory,
        b: &ColliderTrajectory,
        time: Time,
    ) -> bool {
        time >= self.accepted_at
            && self
                .shapes
                .iter()
                .all(|shape| matches!(shape, Primitive::Capsule(_)))
            && ((source_matches(&self.sample.a, a) && source_matches(&self.sample.b, b))
                || (source_matches(&self.sample.a, b) && source_matches(&self.sample.b, a)))
    }
}

fn same_pair(a: &actual_scene::ContactSample, b: &actual_scene::ContactSample) -> bool {
    (a.a.collider == b.a.collider && a.b.collider == b.b.collider)
        || (a.a.collider == b.b.collider && a.b.collider == b.a.collider)
}

fn source_matches(old: &ColliderTrajectory, current: &ColliderTrajectory) -> bool {
    old.collider == current.collider
        && old.parent == current.parent
        && old.role == current.role
        && old.motion.local_center == current.motion.local_center
        && old.motion.local_pose == current.motion.local_pose
        && !current.sensor
}

/// A finite body is never cached as an infinite external driver. A positive
/// mass character pair remains in its existing fresh physical/virtual solve.
fn eligible(
    sample: &actual_scene::ContactSample,
    bodies: &rp::RigidBodySet,
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    time: Time,
) -> bool {
    let mut character = false;
    for collider in [&sample.a, &sample.b] {
        if collider.sensor || collider.motion.linear_angular_velocity(time).1 != rp::Vector::ZERO {
            return false;
        }
        match collider.role {
            Role::Character(id) => {
                character = true;
                if !characters
                    .get(&id)
                    .is_some_and(|r| r.config.push_mass == 0.)
                {
                    return false;
                }
            }
            Role::Fixed | Role::Prescribed => {
                if collider.parent.is_some_and(|h| {
                    bodies
                        .get(h)
                        .is_none_or(|b| !b.is_enabled() || b.is_dynamic())
                }) {
                    return false;
                }
            }
            Role::Dynamic | Role::SleepingDynamic => return false,
        }
    }
    character
}

impl BackendMotionScratch {
    /// Charge retained backing, including capacity left by an earlier tick,
    /// to the existing transient bound. No new owner allowance is introduced.
    pub(super) fn active_bytes(&self, requested: usize) -> Result<usize, TrajectoryError> {
        let count = self.active_contacts.capacity().max(requested);
        if count > MAX_INTERVALS {
            return Err(TrajectoryError::WorkLimit);
        }
        count
            .checked_mul(std::mem::size_of::<ActiveContact>())
            .ok_or(TrajectoryError::WorkLimit)
    }

    pub(super) fn active_remaining(&self, scratch: usize) -> Result<usize, TrajectoryError> {
        scratch
            .checked_sub(self.active_bytes(self.active_contacts.len())?)
            .and_then(|remaining| remaining.checked_sub(self.replay_pairs.bytes()))
            .ok_or(TrajectoryError::WorkLimit)
    }

    fn free_peer_rate(&self, collider: &ColliderTrajectory) -> Option<rp::Vector> {
        let Role::Character(id) = collider.role else {
            return None;
        };
        let entry = self.entries.get(self.entry_index(collider.parent)?)?;
        if entry.support.is_some() {
            return None;
        }
        let index = self
            .origins
            .binary_search_by_key(&id, |origin| origin.body)
            .ok()?;
        let origin = self.origins[index];
        Some(origin.relative_plan + origin.geometry_delta + entry.geometry_delta)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn refresh_active_contacts(
        &mut self,
        time: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        policies: &ContactPolicies,
        continuous: bool,
        work: &mut Work,
    ) -> Result<(), TrajectoryError> {
        let lookup = usize::BITS
            - characters
                .len()
                .max(self.disabled_pairs.len())
                .max(1)
                .leading_zeros();
        let visits = self
            .active_contacts
            .len()
            .checked_mul(
                self.contacts
                    .len()
                    .checked_add(64 + 4 * lookup as usize)
                    .ok_or(TrajectoryError::WorkLimit)?,
            )
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(u64::try_from(visits).map_err(|_| TrajectoryError::WorkLimit)?)?;
        let mut kept = 0;
        for index in 0..self.active_contacts.len() {
            let mut old = self.active_contacts[index];
            if time < old.accepted_at {
                return Err(TrajectoryError::InvalidTime);
            }
            let current = self.scene.contact_pair_at(
                colliders,
                policies,
                (old.sample.a.collider, old.sample.b.collider),
                time,
                old.envelope,
                work,
                &|a, b| {
                    eligible_pair(
                        &self.disabled_pairs,
                        &self.mixed,
                        &self.prescribed_paths,
                        a,
                        b,
                        bodies,
                        continuous,
                        true,
                    )
                },
            )?;
            let Some(current) = current else { continue };
            if !source_matches(&old.sample.a, &current.a)
                || !source_matches(&old.sample.b, &current.b)
                || !eligible(&current, bodies, characters, time)
                || [
                    colliders
                        .get(current.a.collider)
                        .and_then(|c| Primitive::of(c.shape())),
                    colliders
                        .get(current.b.collider)
                        .and_then(|c| Primitive::of(c.shape())),
                ] != old.shapes.map(Some)
            {
                continue;
            }
            // Zero angular velocity is only eligibility. Stored/normalized
            // quaternion branches need not be constant: fresh full shapes and
            // their current normal are authoritative, never the old point or
            // a claimed constant carry/rotation action.
            let family = current.contact.normal1.dot(old.sample.contact.normal1);
            if !family.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            if family <= 0. {
                continue;
            }
            let relative = current
                .b
                .motion
                .point_velocity(time, current.contact.point2)
                - current
                    .a
                    .motion
                    .point_velocity(time, current.contact.point1);
            let separating = relative.dot(current.contact.normal1);
            if !separating.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            if separating > 0. {
                // The next response rebuilds free geometry. A prior projection
                // can be separating even when the rebuilt peer pair is not.
                // Retain the refreshed unilateral row in that case.
                let search = usize::BITS
                    - self
                        .entries
                        .len()
                        .max(self.origins.len())
                        .max(1)
                        .leading_zeros();
                work.charge(4 * u64::from(search) + 8)?;
                let free = self
                    .free_peer_rate(&current.a)
                    .zip(self.free_peer_rate(&current.b));
                let Some((a, b)) = free else { continue };
                let free_separating = (b - a).dot(current.contact.normal1);
                if !free_separating.is_finite() {
                    return Err(TrajectoryError::NonFinite);
                }
                if free_separating > 0. {
                    continue;
                }
            }
            old.sample = current;
            old.visible = !self
                .contacts
                .iter()
                .any(|sample| same_pair(sample, &current));
            self.active_contacts[kept] = old;
            kept += 1;
        }
        self.active_contacts.truncate(kept);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn remember_active_contacts(
        &mut self,
        safe_time: Time,
        hit_time: Time,
        bodies: &rp::RigidBodySet,
        colliders: &rp::ColliderSet,
        characters: &BTreeMap<BodyId, CharacterRuntime>,
        work: &mut Work,
        scratch: usize,
    ) -> Result<(), TrajectoryError> {
        let lookup = usize::BITS
            - characters
                .len()
                .max(self.origins.len())
                .max(1)
                .leading_zeros();
        let comparisons = self
            .contacts
            .len()
            .checked_mul(
                self.active_contacts
                    .len()
                    .checked_add(self.contacts.len())
                    .and_then(|n| n.checked_add(64 + 4 * lookup as usize))
                    .ok_or(TrajectoryError::WorkLimit)?,
            )
            .ok_or(TrajectoryError::WorkLimit)?;
        work.charge(u64::try_from(comparisons).map_err(|_| TrajectoryError::WorkLimit)?)?;
        for sample in &self.contacts {
            if !eligible(sample, bodies, characters, hit_time)
                || self
                    .active_contacts
                    .iter()
                    .any(|old| same_pair(&old.sample, sample))
            {
                continue;
            }
            let (Some(ca), Some(cb)) = (
                colliders.get(sample.a.collider),
                colliders.get(sample.b.collider),
            ) else {
                continue;
            };
            let (Some(a), Some(b)) = (Primitive::of(ca.shape()), Primitive::of(cb.shape())) else {
                continue;
            };
            // Primitive-only: no f32::MAX composite BVH inflation or hidden
            // shape clone is needed to obtain the original safe leaf witness.
            let mut safe_gap: Option<f32> = None;
            crate::physics3d::solver_trajectory::contacts_full_shapes(
                sample.a.motion,
                ca.shape(),
                sample.b.motion,
                cb.shape(),
                safe_time,
                f32::MAX,
                work,
                &mut |contact, _, _, work| {
                    work.charge(1)?;
                    if contact.normal1.dot(sample.contact.normal1) > 0.
                        && safe_gap.is_none_or(|old| contact.dist < old)
                    {
                        safe_gap = Some(contact.dist);
                    }
                    Ok(())
                },
            )?;
            let Some(safe_gap) = safe_gap else { continue };
            let envelope = safe_gap.max(effective_pair_clearance(
                characters,
                &self.origins,
                &sample.a,
                &sample.b,
            ));
            if !envelope.is_finite() {
                return Err(TrajectoryError::NonFinite);
            }
            let count = self
                .active_contacts
                .len()
                .checked_add(1)
                .ok_or(TrajectoryError::WorkLimit)?;
            let target = if count > self.active_contacts.capacity() {
                self.active_contacts
                    .capacity()
                    .checked_mul(2)
                    .map(|n| n.max(count).max(4))
                    .ok_or(TrajectoryError::WorkLimit)?
            } else {
                self.active_contacts.capacity()
            };
            let bytes = self.active_bytes(target)?;
            let contact_bytes = self
                .contacts
                .len()
                .checked_mul(std::mem::size_of::<actual_scene::ContactSample>())
                .ok_or(TrajectoryError::WorkLimit)?;
            if bytes.checked_add(contact_bytes).is_none_or(|n| n > scratch) {
                return Err(TrajectoryError::WorkLimit);
            }
            // Charge the requested backing/relocation before any reservation.
            work.charge(target as u64)?;
            if target > self.active_contacts.capacity() {
                self.active_contacts
                    .try_reserve_exact(target - self.active_contacts.len())
                    .map_err(|_| TrajectoryError::WorkLimit)?;
            }
            self.active_contacts.push(ActiveContact {
                sample: *sample,
                shapes: [a, b],
                envelope,
                accepted_at: safe_time,
                visible: false,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
