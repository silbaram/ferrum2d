//! Checked work budget for captured motion and geometric queries.

use super::motion_error::TrajectoryError;

#[derive(Clone, Copy, Debug)]
pub(super) struct Work {
    pub used: u64,
    pub limit: u64,
}
impl Work {
    #[cfg_attr(test, track_caller)]
    pub fn charge(&mut self, amount: u64) -> Result<(), TrajectoryError> {
        let Some(next) = self.used.checked_add(amount) else {
            #[cfg(test)]
            if super::solver_trajectory::test_work_failure_selected() {
                super::solver_trajectory::test_work_failure(amount, self.used, self.limit);
            }
            return Err(TrajectoryError::WorkLimit);
        };
        if next > self.limit {
            #[cfg(test)]
            if super::solver_trajectory::test_work_failure_selected() {
                super::solver_trajectory::test_work_failure(amount, self.used, self.limit);
            }
            return Err(TrajectoryError::WorkLimit);
        }
        self.used = next;
        Ok(())
    }
}
