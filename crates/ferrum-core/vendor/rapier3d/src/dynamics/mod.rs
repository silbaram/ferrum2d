// Ferrum2D modified vendored source; see FERRUM-PATCHES.md.
//! Structures related to dynamics: bodies, impulse_joints, etc.

#[cfg(feature = "alloc")]
pub(crate) use self::ccd::post_solve_ccd_active;
#[cfg(feature = "alloc")]
pub use self::ccd::{
    CCDSolver, CcdClamp, CcdDiagnostics, solver_ccd_active, solver_ccd_body_tier_allows,
    solver_ccd_pair_kind, solver_ccd_shape_supported,
};
pub use self::coefficient_combine_rule::CoefficientCombineRule;
#[cfg(feature = "dim3")]
pub use self::integration_parameters::FrictionModel;
pub use self::integration_parameters::{IntegrationParameters, SpringCoefficients};
#[cfg(feature = "alloc")]
pub use self::island_manager::IslandManager;
#[cfg(feature = "alloc")]
pub(crate) use self::island_manager::{INVALID_ISLAND, ImpulseJointIslandEvent, PersistentIslands};

#[cfg(feature = "alloc")]
pub(crate) use self::joint::JointGraphEdge;
#[cfg(feature = "alloc")]
pub(crate) use self::joint::JointIndex;
pub use self::joint::*;
#[cfg(feature = "alloc")]
pub use self::rigid_body_components::*;
pub use self::rigid_body_handle::RigidBodyHandle;
#[cfg(feature = "alloc")]
pub(crate) use self::rigid_body_set::ModifiedRigidBodies;
#[cfg(feature = "alloc")]
pub(crate) use self::solver::StagedIslandSolver;
pub use parry::mass_properties::MassProperties;

#[cfg(feature = "alloc")]
pub use self::rigid_body::{RigidBody, RigidBodyBuilder, RigidBodyMotionCredit};
#[cfg(feature = "alloc")]
pub use self::rigid_body_set::{BodyPair, RigidBodySet};
#[cfg(feature = "alloc")]
pub(crate) use self::soft_body::soft_body_crossing_tests;
#[cfg(feature = "alloc")]
pub use self::soft_body::*;

#[cfg(feature = "alloc")]
mod ccd;
mod coefficient_combine_rule;
mod integration_parameters;
#[cfg(feature = "alloc")]
mod island_manager;
mod joint;
#[cfg(feature = "alloc")]
mod rigid_body_components;
mod rigid_body_handle;
#[cfg(feature = "alloc")]
pub(crate) mod solver;

#[cfg(feature = "alloc")]
mod rigid_body;
#[cfg(feature = "alloc")]
mod rigid_body_set;
#[cfg(feature = "alloc")]
mod soft_body;

// Ferrum cold numeric admission, separate from stored graph validation.
#[cfg(all(feature = "serde-serialize", feature = "dim3", feature = "f32"))]
mod stored_body_numerics;
#[cfg(all(feature = "serde-serialize", feature = "dim3", feature = "f32"))]
#[doc(hidden)]
pub use stored_body_numerics::{
    StoredBodyNumericError, StoredBodyNumericLimits, validate_stored_body_numerics,
};

#[cfg(feature = "serde-serialize")]
#[doc(hidden)]
pub use island_manager::{StoredIslandError, StoredIslandLimits, validate_stored_islands};
