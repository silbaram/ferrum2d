use super::World;
use crate::components::{
    DistanceJointId, GearJointId, PrismaticJointId, PulleyJointId, RevoluteJointId, RopeJointId,
    SpringJointId, WeldJointId,
};

/// Internal joint discriminator. Values retain the existing Wasm and diagnostic codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub(crate) enum JointKind {
    Distance = 0,
    Rope = 1,
    Spring = 2,
    Revolute = 3,
    Prismatic = 4,
    Gear = 5,
    Weld = 6,
    Pulley = 7,
}

impl TryFrom<u32> for JointKind {
    type Error = ();

    fn try_from(value: u32) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::Distance),
            1 => Ok(Self::Rope),
            2 => Ok(Self::Spring),
            3 => Ok(Self::Revolute),
            4 => Ok(Self::Prismatic),
            5 => Ok(Self::Gear),
            6 => Ok(Self::Weld),
            7 => Ok(Self::Pulley),
            _ => Err(()),
        }
    }
}

impl World {
    pub(crate) fn clear_joint_by_kind(
        &mut self,
        kind: JointKind,
        index: u32,
        generation: u32,
    ) -> bool {
        match kind {
            JointKind::Distance => self
                .clear_distance_joint(DistanceJointId { index, generation })
                .is_some(),
            JointKind::Rope => self
                .clear_rope_joint(RopeJointId { index, generation })
                .is_some(),
            JointKind::Spring => self
                .clear_spring_joint(SpringJointId { index, generation })
                .is_some(),
            JointKind::Revolute => self
                .clear_revolute_joint(RevoluteJointId { index, generation })
                .is_some(),
            JointKind::Prismatic => self
                .clear_prismatic_joint(PrismaticJointId { index, generation })
                .is_some(),
            JointKind::Gear => self
                .clear_gear_joint(GearJointId { index, generation })
                .is_some(),
            JointKind::Weld => self
                .clear_weld_joint(WeldJointId { index, generation })
                .is_some(),
            JointKind::Pulley => self
                .clear_pulley_joint(PulleyJointId { index, generation })
                .is_some(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::JointKind;

    #[test]
    fn joint_dispatch_codes_remain_stable_and_reject_unknown_values() {
        for (code, kind) in [
            (0, JointKind::Distance),
            (1, JointKind::Rope),
            (2, JointKind::Spring),
            (3, JointKind::Revolute),
            (4, JointKind::Prismatic),
            (5, JointKind::Gear),
            (6, JointKind::Weld),
            (7, JointKind::Pulley),
        ] {
            assert_eq!(kind as u32, code);
            assert_eq!(JointKind::try_from(code), Ok(kind));
        }
        for code in [8, 256, u32::MAX] {
            assert!(JointKind::try_from(code).is_err());
        }
    }
}
