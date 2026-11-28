//! Checked work budget for captured motion and geometric queries.

use super::PhysicsError;

#[derive(Clone, Copy, Debug)]
pub(super) struct Work {
    pub used: u64,
    pub limit: u64,
}
impl Work {
    pub fn charge(&mut self, amount: u64) -> Result<(), PhysicsError> {
        let next = self
            .used
            .checked_add(amount)
            .ok_or(PhysicsError::CapacityExceeded)?;
        if next > self.limit {
            return Err(PhysicsError::CapacityExceeded);
        }
        self.used = next;
        Ok(())
    }
}
