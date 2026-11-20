//! Unified rigid-body physics for spatial and XY-constrained worlds.
//!
//! Backend handles and math types remain private. Planar worlds reject out-of-plane
//! authored motion because solver axis locks alone do not constrain velocity setters.

#![warn(missing_docs)]

mod body_controls;
mod body_prototype;
pub(crate) use body_prototype::BodyPrototype;
mod character;
mod character_crowd;
pub(crate) use character_crowd::CharacterCrowdPeer;
mod character_query;
pub(crate) use character_query::{CharacterMotionProbe, CharacterProbeScratch};
mod character_route_profile;
pub(crate) use character_route_profile::CharacterRouteProfile;
mod character_query_snapshot;
pub(crate) use character_query_snapshot::{CharacterQuerySnapshot, FixedQuerySnapshot};
mod character_constraints;
mod character_contacts;
mod character_dynamics;
mod character_geometry;
mod character_motion;
mod character_stops;
mod colliders;
mod contact_correction;
mod contact_impulses;
mod contact_policy;
mod contact_queries;
mod continuous_hinge;
mod debug_draw;
mod dynamics;
pub(crate) use debug_draw::{DebugDrawOptions, DebugDrawStatistics, DebugLine3d};
mod events;
pub(crate) mod file_shared_shapes;
mod geometry;
mod joint_reactions;
mod joint_types;
mod joints;
#[cfg(test)]
mod kinematic_limit_tests;
mod kinematic_limits;
mod kinematic_motion;
mod tick_motion;
pub(crate) use tick_motion::{TickMotion, TickMotionBackup};
mod kinematic_paths;
pub(crate) use kinematic_paths::KinematicPath;
mod motion_trace;
mod one_way;
mod solver_trajectory;
pub(crate) use one_way::TerrainOneWay;
mod planar_angle;
mod queries;
mod ratio_joints;
mod settings;
pub(crate) mod snapshot;
pub use snapshot::{
    PhysicsSnapshot, PhysicsSnapshotError, PHYSICS_SNAPSHOT_MAX_BYTES, PHYSICS_SNAPSHOT_VERSION,
};
mod statistics;
mod types;
mod world;

pub use body_controls::{AdditionalMassProperties, BodyOptions};
pub use character::{CharacterConfig, CharacterInput, CharacterState};
pub use contact_correction::ContactCorrection;
pub use contact_impulses::{ContactImpulse, ContactImpulseDiagnostics};
pub use contact_policy::PlanarCollisionSpan;
pub use contact_queries::{ContactManifold, ContactPoint};
pub use events::{ActiveCollisionPair, CollisionEvent, CollisionPhase};
pub use joint_types::{
    JointDesc, JointEvent, JointEventReason, JointId, JointKind, JointMotor, JointState,
    SpringResponse,
};
pub use queries::{PointHit, QueryFilter, RayCast, RayHit, SweepHit};
pub use settings::SolverSettings;
pub use statistics::{CcdClamp, StepStatistics};
pub use types::{
    BodyDesc, BodyId, BodyKind, BodyState, ColliderDesc, ColliderId, ColliderRef, PhysicsError,
    Pose, Shape, ShapePart, Space, WorldConfig,
};
pub use world::PhysicsWorld3d;

#[cfg(test)]
mod character_dynamic_tests;
#[cfg(test)]
mod character_motion_tests;
#[cfg(test)]
mod character_squeeze_tests;
#[cfg(test)]
mod character_tests;
#[cfg(test)]
mod event_tests;
#[cfg(test)]
mod joint_tests;
#[cfg(test)]
mod query_tests;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod body_control_tests;

#[cfg(test)]
mod ratio_joint_tests;

#[cfg(test)]
mod continuous_hinge_tests;

#[cfg(test)]
mod spring_tests;

#[cfg(test)]
mod frame_spring_tests;

#[cfg(test)]
mod contact_policy_tests;

#[cfg(test)]
mod contact_correction_tests;

#[cfg(test)]
mod settings_tests;

#[cfg(test)]
mod shape_query_tests;

#[cfg(test)]
mod contact_query_tests;

#[cfg(test)]
mod contact_impulse_tests;

#[cfg(test)]
mod statistics_tests;

#[cfg(test)]
mod step_motion_tests;

#[cfg(test)]
mod character_coupling_tests;

#[cfg(test)]
mod landing_trajectory_tests;
#[cfg(test)]
mod near_skin_tests;

#[cfg(test)]
mod tight_clearance_tests;

#[cfg(test)]
mod broad_phase_reuse_tests;

#[cfg(test)]
mod angular_ccd_bounds_tests;

#[cfg(test)]
mod kinematic_accepted_motion_tests;

#[cfg(test)]
mod actual_trajectory_tests;
