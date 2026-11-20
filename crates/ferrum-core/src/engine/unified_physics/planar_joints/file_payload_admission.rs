use super::*;
use crate::gameplay::file_admission::{require, Budget, Error, Problem};
use crate::physics3d::PhysicsWorld3d;
impl PendingJoint {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        physics: &PhysicsWorld3d,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            key: _,
            entities: _,
            desc: _,
            break_distance: _,
            break_angle: _,
        } = self;
        // validate_joint_settings builds only a fixed-stack GenericJoint. It performs
        // no body lookup and accepts pending World-entity placeholder BodyIds.
        b.work(512)?;
        require(
            self.key.0 < 8
                && physics.validate_joint_settings(&self.desc).is_ok()
                && [self.break_distance, self.break_angle]
                    .into_iter()
                    .flatten()
                    .all(|v| v.is_finite() && (0. ..=1e9).contains(&v)),
            "runtime_joints",
            "source",
            0,
            Problem::Number,
        )
    }
}
impl JointBinding {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        physics: &PhysicsWorld3d,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            native: _,
            source: _,
        } = self;
        b.work(2)?;
        self.source.validate_file_payload(physics, b)
    }
}
