//! Compare the ordinary KCC route with the retired proof policy.
use super::*;

#[derive(Clone, Copy, Default, Eq, PartialEq)]
pub(in crate::physics3d) enum Experiment {
    #[default]
    Current,
    RigidProof,
    CharacterProof,
    CharacterKcc,
}

impl PhysicsWorld3d {
    pub(crate) fn force_rigid_motion_proof(&mut self) {
        self.character_motion.experiment = Experiment::RigidProof;
    }

    pub(in crate::physics3d) fn rigid_motion_proof_is_forced(&self) -> bool {
        self.character_motion.experiment == Experiment::RigidProof
            && self.config.solver.continuous
            && self
                .backend
                .bodies
                .iter()
                .any(|(_, body)| body.is_enabled() && body.is_dynamic())
    }

    pub(crate) fn enable_experimental_character_kcc(&mut self) {
        self.character_motion.experiment = Experiment::CharacterKcc;
    }

    pub(crate) fn force_character_motion_proof(&mut self) {
        self.character_motion.experiment = Experiment::CharacterProof;
    }

    pub(in crate::physics3d) fn character_motion_proof_is_forced(&self) -> bool {
        self.character_motion.experiment == Experiment::CharacterProof
    }

    pub(in crate::physics3d) fn experimental_character_kcc_enabled(&self) -> bool {
        self.character_motion.experiment == Experiment::CharacterKcc && !self.characters.is_empty()
    }
}
