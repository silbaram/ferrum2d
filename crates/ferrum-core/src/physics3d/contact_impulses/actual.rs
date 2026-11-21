//! Transient physical-response observations. Geometry-only projections never
//! enter this owner. Only batches inside the native committed prefix publish.
use super::ContactImpulse;
use crate::physics3d::{
    events::EventCollector,
    solver_trajectory::{Time, TrajectoryError, Work},
};

// Fixed row validation/copy plus its later publication and clear visits.
const ROW_WORK: u64 = 32;
// Seal and the later committed-prefix batch visit share this one allowance.
const BATCH_WORK: u64 = 16;

#[derive(Clone, Copy)]
struct Batch {
    end: Time,
    contacts: usize,
    solved: usize,
}

/// An unsealed response checkpoint. Internal callers use it only until the
/// current context seals, and never across reset/publication or other owners.
#[derive(Clone, Copy)]
pub(in crate::physics3d) struct Mark {
    contacts: usize,
    solved: usize,
    batches: usize,
}

/// Requested storage is bounded, fallible and transient. No persistent field,
/// default budget, allocator/RSS guarantee or contact normalization is added.
#[derive(Default)]
pub(in crate::physics3d) struct Staging {
    contacts: Vec<ContactImpulse>,
    batches: Vec<Batch>,
    solved: usize,
    sealed_contacts: usize,
    sealed_solved: usize,
    limit: usize,
}

impl Staging {
    /// Retain reusable backing, clear observations and adopt the existing
    /// WorldConfig.max_events output limit. The shared Work lives in the caller.
    pub fn reset(&mut self, limit: usize) {
        self.contacts.clear();
        self.batches.clear();
        self.solved = 0;
        self.sealed_contacts = 0;
        self.sealed_solved = 0;
        self.limit = limit;
    }

    pub fn mark(&self) -> Mark {
        Mark {
            contacts: self.contacts.len(),
            solved: self.solved,
            batches: self.batches.len(),
        }
    }

    /// Roll back a plan whose canonical physical before-state was restored.
    /// Logical work already performed stays charged in the caller's ledger.
    pub fn rewind(&mut self, mark: Mark) -> Result<(), TrajectoryError> {
        if mark.batches != self.batches.len()
            || mark.contacts < self.sealed_contacts
            || mark.contacts > self.contacts.len()
            || mark.solved < self.sealed_solved
            || mark.solved > self.solved
        {
            return Err(TrajectoryError::InvalidReference);
        }
        self.contacts.truncate(mark.contacts);
        self.solved = mark.solved;
        Ok(())
    }

    fn layout(contacts: usize, batches: usize, max: usize) -> Result<(), TrajectoryError> {
        let bytes = contacts
            .checked_mul(std::mem::size_of::<ContactImpulse>())
            .and_then(|c| {
                batches
                    .checked_mul(std::mem::size_of::<Batch>())
                    .and_then(|b| c.checked_add(b))
            })
            .ok_or(TrajectoryError::WorkLimit)?;
        if bytes > max {
            return Err(TrajectoryError::WorkLimit);
        }
        Ok(())
    }

    /// Call only for the additional physical solve's actual J. The original
    /// row witness, category and generational identities are copied verbatim.
    pub fn push(
        &mut self,
        contact: ContactImpulse,
        work: &mut Work,
        max_scratch: usize,
    ) -> Result<(), TrajectoryError> {
        work.charge(ROW_WORK)?;
        let normal = rapier3d::prelude::Vector::from(contact.normal);
        if !normal.is_finite()
            || (normal.length_squared() - 1.).abs() > 1e-5
            || !contact.point.iter().all(|v| v.is_finite())
            || !contact.tangent_impulse.iter().all(|v| v.is_finite())
            || !contact.normal_impulse.is_finite()
            || contact.normal_impulse < 0.
            || !contact.approach_speed.is_finite()
            || contact.approach_speed < 0.
        {
            return Err(TrajectoryError::NonFinite);
        }
        if contact.first.sensor
            || contact.second.sensor
            || contact.first.collider == contact.second.collider
            || contact.first.body == contact.second.body
        {
            return Err(TrajectoryError::InvalidReference);
        }
        if contact.normal_impulse == 0. && contact.tangent_impulse == [0.; 3] {
            return Ok(());
        }
        let solved = self
            .solved
            .checked_add(1)
            .ok_or(TrajectoryError::WorkLimit)?;
        if self.contacts.len() < self.limit {
            let count = self
                .contacts
                .len()
                .checked_add(1)
                .ok_or(TrajectoryError::WorkLimit)?;
            Self::layout(count, self.batches.len(), max_scratch)?;
            if self.contacts.len() == self.contacts.capacity() {
                self.contacts
                    .try_reserve_exact(1)
                    .map_err(|_| TrajectoryError::WorkLimit)?;
            }
            self.contacts.push(contact);
        }
        self.solved = solved;
        Ok(())
    }

    /// Precharge every batch and complete all fallible storage before the
    /// caller writes the accepted context. Equal ends preserve producer order.
    pub fn seal(
        &mut self,
        end: Time,
        work: &mut Work,
        max_scratch: usize,
    ) -> Result<(), TrajectoryError> {
        work.charge(BATCH_WORK)?;
        if !end.is_finite() || end <= 0. || self.batches.last().is_some_and(|b| b.end > end) {
            return Err(TrajectoryError::InvalidTime);
        }
        if self.solved == self.sealed_solved {
            return Ok(());
        }
        let count = self
            .batches
            .len()
            .checked_add(1)
            .ok_or(TrajectoryError::WorkLimit)?;
        Self::layout(self.contacts.len(), count, max_scratch)?;
        if self.batches.len() == self.batches.capacity() {
            self.batches
                .try_reserve_exact(1)
                .map_err(|_| TrajectoryError::WorkLimit)?;
        }
        self.batches.push(Batch {
            end,
            contacts: self.contacts.len(),
            solved: self.solved,
        });
        self.sealed_contacts = self.contacts.len();
        self.sealed_solved = self.solved;
        Ok(())
    }

    /// No allocation, new work allowance, geometry query or native re-entry.
    /// The caller has prepared the collector's restored output capacity before
    /// backend execution via `prepare_actual_contact_impulses`.
    /// Discard unsealed/rejected suffixes, including speculative contexts in a
    /// rejected CCD slice, after publishing only its real committed prefix.
    pub fn publish_committed(
        &mut self,
        end: Time,
        collector: &EventCollector,
    ) -> Result<(), TrajectoryError> {
        if !end.is_finite() || end < 0. {
            return Err(TrajectoryError::InvalidTime);
        }
        let mut contacts = 0;
        let mut solved = 0;
        for batch in &self.batches {
            if batch.end > end {
                break;
            }
            contacts = batch.contacts;
            solved = batch.solved;
        }
        if solved != 0 {
            collector.record_actual_contact_impulses(&self.contacts[..contacts], solved);
        }
        self.reset(self.limit);
        Ok(())
    }
}

#[cfg(test)]
mod tests;
