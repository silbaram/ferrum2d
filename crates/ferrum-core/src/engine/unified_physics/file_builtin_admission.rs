use super::UnifiedPhysicsRuntime;
use crate::engine::file_builtin_scenes_admission::{Budget, Error};
use crate::world::World;
impl UnifiedPhysicsRuntime {
    /// Exactly two stored built-in profile leaves, not whole Runtime admission.
    pub(in crate::engine) fn validate_file_builtin_leaves(
        &self,
        w: &World,
        b: &mut Budget,
    ) -> Result<(), Error> {
        b.work(2)?;
        if let Some(v) = &self.breakout {
            v.validate_file(w, b)?;
        }
        if let Some(v) = &self.platformer {
            v.validate_file(w, b)?;
        }
        Ok(())
    }
}
#[cfg(test)]
impl super::UnifiedPhysicsRuntime {
    pub(in crate::engine) fn builtin_leaf_input_fixture(&self) -> (f32, bool) {
        self.platformer
            .as_ref()
            .unwrap()
            .builtin_leaf_input_fixture()
    }
    pub(in crate::engine) fn corrupt_builtin_leaf_fixture(&mut self, case: usize) {
        if case < 2 {
            self.breakout
                .as_mut()
                .unwrap()
                .corrupt_builtin_leaf_fixture(case);
        } else {
            self.platformer
                .as_mut()
                .unwrap()
                .corrupt_builtin_leaf_fixture(case);
        }
    }
}
