//! Native runtime state belongs to the same checkpoint as its physics world.
use super::UnifiedPhysicsRuntime;

#[cfg(test)]
impl super::Engine {
    pub(in crate::engine) fn queued_checkpoint_commands_test(
        &mut self,
        a: crate::entity::Entity,
        k: crate::entity::Entity,
    ) {
        let runtime = self.unified_physics.as_mut().unwrap();
        let a = runtime.bindings[&(a.id, a.generation)].body;
        let k = runtime.bindings[&(k.id, k.generation)].body;
        runtime.physics.add_force(a, [2., 0., 0.], [0.; 3]).unwrap();
        runtime
            .physics
            .set_kinematic_target(
                k,
                crate::physics3d::Pose {
                    position: [11., 0., 0.],
                    ..Default::default()
                },
            )
            .unwrap();
    }
}

impl UnifiedPhysicsRuntime {
    #[cfg(test)]
    pub(in crate::engine) fn checkpoint_bytes(&self) -> Vec<u8> {
        self.physics
            .capture_snapshot()
            .unwrap()
            .encoded_bytes()
            .to_vec()
    }
}
