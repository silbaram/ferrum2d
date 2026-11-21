//! Borrowed stored binding projection; never body_state/query/rebuild.
use super::*;
impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn file_roster_binding_count(&self) -> usize {
        self.bindings.len()
    }
    pub(in crate::engine) fn visit_file_roster_bindings<E>(
        &self,
        visit: &mut impl FnMut(Entity, BodyId, bool) -> Result<(), E>,
    ) -> Result<(), E> {
        for (&(id, generation), binding) in &self.bindings {
            visit(
                Entity { id, generation },
                binding.body,
                binding.legacy.is_some(),
            )?;
        }
        Ok(())
    }
}
