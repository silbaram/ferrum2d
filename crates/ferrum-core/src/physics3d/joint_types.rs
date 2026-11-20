use super::{BodyId, Pose};

/// Identity of one joint, scoped to its world and invalidated on removal or break.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct JointId {
    /// Arena slot, meaningful only together with its generation.
    pub slot: u32,
    /// Slot reuse generation.
    pub generation: u32,
}

/// Force-based actuator on a joint's single free coordinate.
///
/// Linear coordinates use engine units; angular coordinates use radians. Gains
/// apply physical force/torque, so heavier bodies respond differently. Set
/// stiffness to zero for a velocity-only motor. All fields must be finite.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct JointMotor {
    /// Desired coordinate; angular positions are within [-pi, pi], except for
    /// `ContinuousRevolute`, which accepts the full continuous coordinate.
    pub target_position: f32,
    /// Desired coordinate velocity per second.
    pub target_velocity: f32,
    /// Position error gain, from zero through 1,000,000.
    pub stiffness: f32,
    /// Velocity error gain, from zero through 1,000,000.
    pub damping: f32,
    /// Maximum force (slider) or torque (hinge), from zero through 1,000,000,000.
    pub max_force: f32,
}

/// Effective-mass-normalized elastic response for a constrained coordinate.
/// None on a joint means rigid; both gains zero leave its coordinate free.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct SpringResponse {
    /// Acceleration per coordinate error (1/s²), from zero through 1,000,000.
    pub stiffness: f32,
    /// Acceleration per coordinate velocity (1/s), from zero through 1,000,000.
    pub damping: f32,
}

/// Constraints solved by the common 3D backend, including in XY-constrained worlds.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum JointKind {
    /// Coincident local frames with no relative translation or rotation (2D weld).
    Fixed,
    /// Coincident anchors with unrestricted relative rotation (ball-and-socket).
    Spherical,
    /// Rotation about each local frame's X axis; all other motion is locked.
    Revolute {
        /// Optional angular interval in radians within [-pi, pi].
        limits: Option<[f32; 2]>,
        /// Optional angular actuator.
        motor: Option<JointMotor>,
    },
    /// Planar hinge whose limits and motor position use the full angle_b - angle_a,
    /// including whole turns. Local X axes must point along positive Z; local
    /// frame twist does not introduce an angle offset. Spatial worlds reject it.
    ContinuousRevolute {
        /// Ordered inclusive bounds in radians, each within [-1,000,000, 1,000,000].
        limits: [f32; 2],
        /// Optional actuator. Its position is a continuous angle with the same bounds.
        motor: Option<JointMotor>,
    },
    /// Translation along each local frame's X axis; relative rotation is locked.
    Prismatic {
        /// Optional linear interval in engine units.
        limits: Option<[f32; 2]>,
        /// Optional linear actuator.
        motor: Option<JointMotor>,
    },
    /// Constant anchor distance, without locking relative orientation.
    Distance {
        /// Nonnegative distance in engine units (zero is a coincident-anchor joint).
        length: f32,
    },
    /// Maximum anchor distance; exerts no force while slack.
    Rope {
        /// Strictly positive length in engine units.
        max_length: f32,
    },
    /// Elastic cable between body-local anchors. It pulls only while stretched;
    /// zero stiffness with damping is a one-sided damper, and zero gains are free.
    ElasticRope {
        /// Nonnegative unstretched length in engine units.
        max_length: f32,
        /// Mass-normalized elastic response of the cable's length coordinate.
        spring: SpringResponse,
    },
    /// Planar Z-axis gear: angle_b + ratio * angle_a = reference_angle (modulo one turn).
    /// Translation remains free; use separate hinges to anchor the wheels.
    Gear {
        /// Finite nonzero ratio with absolute value in [0.0001, 10000].
        ratio: f32,
        /// Phase offset in radians, bounded by 1,000,000.
        reference_angle: f32,
        /// Optional elastic response instead of the rigid phase constraint.
        spring: Option<SpringResponse>,
    },
    /// Pulley with two fixed world anchors and two body-local attachment points.
    Pulley {
        /// First fixed world anchor.
        ground_a: [f32; 3],
        /// Second fixed world anchor.
        ground_b: [f32; 3],
        /// Weighted length: length_a + ratio * length_b.
        length: f32,
        /// Strictly positive length ratio in [0.0001, 10000].
        ratio: f32,
        /// A slack pulley only resists extension beyond the weighted length.
        slack: bool,
        /// Optional elastic response. A slack pulley never pushes while the cable is loose.
        spring: Option<SpringResponse>,
    },
    /// Mass-normalized radial spring, parameterized by frequency and damping ratio.
    FrequencySpring {
        /// Nonnegative equilibrium distance.
        rest_length: f32,
        /// Oscillation frequency in [0, 1000] Hz; zero disables the spring force.
        frequency_hz: f32,
        /// Damping ratio in [0, 10], where one is critical damping.
        damping_ratio: f32,
    },
    /// Radial spring with effective-mass-normalized acceleration gains.
    /// Unlike force-based gains, the same values produce the same response when
    /// both endpoint masses/inertias are scaled together. Zero stiffness gives
    /// a pure damper; both gains zero leave the radial coordinate free.
    AccelerationSpring {
        /// Nonnegative equilibrium distance in engine units.
        rest_length: f32,
        /// Acceleration per unit extension (1/s²), from zero through 1,000,000.
        stiffness: f32,
        /// Acceleration per unit relative velocity (1/s), from zero through 1,000,000.
        damping: f32,
    },
    /// Damped, force-based spring between the local anchors.
    Spring {
        /// Nonnegative equilibrium distance in engine units.
        rest_length: f32,
        /// Force per unit extension, strictly positive and at most 1,000,000.
        stiffness: f32,
        /// Force per unit relative velocity, from zero through 1,000,000.
        damping: f32,
    },
}

/// Validated joint creation/update input. At least one endpoint must be dynamic.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct JointDesc {
    /// First body; endpoints must be distinct and live in this world.
    pub body_a: BodyId,
    /// Second body.
    pub body_b: BodyId,
    /// Joint anchor and orientation relative to the first body. Orientation affects
    /// fixed/hinge/slider joints; radial joints derive their axis from the anchors.
    pub local_frame_a: Pose,
    /// Joint anchor and orientation relative to the second body, with the same convention.
    pub local_frame_b: Pose,
    /// Constraint and optional actuator settings.
    pub kind: JointKind,
    /// Elastic response replacing locked linear axes of fixed/spherical/hinge/slider
    /// frames. None retains rigid locks; zero gains release those axes. Free axes,
    /// limits and explicit motors are unaffected. Radial and ratio joints reject it.
    pub linear_spring: Option<SpringResponse>,
    /// Elastic response replacing locked angular axes of frame joints, using
    /// shortest-arc angular errors. None retains rigid locks. Spherical joints
    /// and planar hinges have no locked angular coordinate and reject this option.
    pub angular_spring: Option<SpringResponse>,
    /// Whether connected bodies may contact one another (default false).
    pub contacts_enabled: bool,
    /// Whether the constraint participates in simulation (default true).
    pub enabled: bool,
    /// Optional nonnegative solver reaction force threshold; None never breaks by force.
    pub break_force: Option<f32>,
    /// Optional nonnegative solver reaction torque threshold; None never breaks by torque.
    pub break_torque: Option<f32>,
}

impl JointDesc {
    /// Connects body origins with identity local frames and no break thresholds.
    pub fn new(body_a: BodyId, body_b: BodyId, kind: JointKind) -> Self {
        Self {
            body_a,
            body_b,
            local_frame_a: Pose::default(),
            local_frame_b: Pose::default(),
            kind,
            linear_spring: None,
            angular_spring: None,
            contacts_enabled: false,
            enabled: true,
            break_force: None,
            break_torque: None,
        }
    }
}

/// Peak sampled reaction magnitudes during the last fixed tick, in force/torque units.
///
/// Includes constraint, limit and motor impulses divided by the substep duration.
/// A world containing joints samples each solver substep so early impacts are not
/// lost to the final substep. These remain timestep-dependent numerical estimates,
/// not continuous-time peak forces. Disabled/inactive joints report zero.
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize, serde::Deserialize)]
pub struct JointState {
    /// Largest sampled resultant linear reaction magnitude during the fixed tick.
    pub force: f32,
    /// Largest sampled angular reaction magnitude at the joint anchor during the tick.
    pub torque: f32,
}

/// Why a joint stopped existing. Explicit removal is not reported as a force break.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum JointEventReason {
    /// Force threshold exceeded after a simulation step.
    ForceLimit,
    /// Torque threshold exceeded after a simulation step.
    TorqueLimit,
    /// Both thresholds exceeded in the same step.
    ForceAndTorqueLimit,
    /// Explicit joint removal.
    Removed,
    /// An endpoint body was removed, including by clearing the world.
    BodyRemoved,
}

/// One bounded lifecycle event, retaining identities even after arena slot reuse.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct JointEvent {
    /// Removed joint's full identity.
    pub joint: JointId,
    /// First endpoint's identity at removal.
    pub body_a: BodyId,
    /// Second endpoint's identity at removal.
    pub body_b: BodyId,
    /// Removal/break reason.
    pub reason: JointEventReason,
    /// Last simulated reaction estimate (zero before the first step or after update).
    pub reaction: JointState,
}
