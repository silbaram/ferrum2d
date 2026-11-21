use std::fmt;

/// Coordinate constraints applied by the same 3D solver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Space {
    /// XYZ motion with a Y-up convention for spatial scenes.
    Spatial,
    /// XY translation and rotation about Z; authored Z positions must be zero.
    PlanarXy,
}

/// Validated simulation settings. Distances use engine units.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct WorldConfig {
    /// Spatial motion or a constraint to the XY plane.
    pub space: Space,
    /// World-space acceleration in engine units per second squared.
    pub gravity: [f32; 3],
    /// Mutable solver quality, restitution threshold and global CCD controls.
    pub solver: super::SolverSettings,
    /// Fixed timestep in seconds, from 0.0001 through 0.1.
    pub step_seconds: f32,
    /// Engine units per meter, used to scale solver tolerances.
    pub length_unit: f32,
    /// Maximum live bodies (1–65,536).
    pub max_bodies: usize,
    /// Maximum live colliders, including multiple colliders on one body.
    pub max_colliders: usize,
    /// Independent capacity for queued collision transitions and each tick's solved
    /// contact observations. Each stream reports its own dropped count.
    pub max_events: usize,
    /// Maximum simultaneous capsule controllers (1–1,024).
    pub max_characters: usize,
    /// Maximum live joints (1–131,072).
    pub max_joints: usize,
}

impl Default for WorldConfig {
    fn default() -> Self {
        Self {
            space: Space::Spatial,
            gravity: [0.0, -9.81, 0.0],
            solver: super::SolverSettings::default(),
            step_seconds: 1.0 / 60.0,
            length_unit: 1.0,
            max_bodies: 8192,
            max_colliders: 16384,
            max_events: 4096,
            max_characters: 128,
            max_joints: 16384,
        }
    }
}

impl WorldConfig {
    /// Reuse the exact creation predicate without constructing or mutating a world.
    pub(crate) fn validate_file_configuration(&self) -> Result<(), PhysicsError> {
        super::world::validate_config(self)
    }
}

/// An engine-owned generational identity. It is not a render entity identity.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct BodyId {
    /// Arena slot, meaningful only together with its generation.
    pub slot: u32,
    /// Slot reuse generation.
    pub generation: u32,
}

/// Identity of one collider, scoped to its world and invalidated on removal.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, serde::Serialize, serde::Deserialize,
)]
pub struct ColliderId {
    /// Arena slot, meaningful only together with its generation.
    pub slot: u32,
    /// Slot reuse generation.
    pub generation: u32,
}

/// Collider ownership captured at the time of a query or collision event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ColliderRef {
    /// Identity of the hit or event participant.
    pub collider: ColliderId,
    /// Body owning this collider.
    pub body: BodyId,
    /// Whether the collider detects intersections without solid response.
    pub sensor: bool,
}

/// Transform with an XYZW unit quaternion.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Pose {
    /// Translation in engine units.
    pub position: [f32; 3],
    /// Unit quaternion in XYZW order; identity is [0, 0, 0, 1].
    pub rotation: [f32; 4],
}

impl Default for Pose {
    fn default() -> Self {
        Self {
            position: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
        }
    }
}

/// How a body is integrated by the solver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum BodyKind {
    /// Immovable terrain; explicit teleports are allowed.
    Fixed,
    /// Integrated from forces, impulses, gravity and contacts.
    Dynamic,
    /// Moves to a target pose during the next step.
    KinematicPosition,
    /// Integrated from a directly assigned velocity, unaffected by forces.
    KinematicVelocity,
}

/// Body creation input. Invalid input leaves the world unchanged.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BodyDesc {
    /// Integration and response behavior.
    pub kind: BodyKind,
    /// Initial world-space pose.
    pub pose: Pose,
    /// Initial world-space linear velocity in engine units per second.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub linear_velocity: [f32; 3],
    /// Initial world-space angular velocity in radians per second.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub angular_velocity: [f32; 3],
    /// Multiplier applied to world gravity for this body.
    pub gravity_scale: f32,
    /// Nonnegative linear damping coefficient.
    pub linear_damping: f32,
    /// Nonnegative angular damping coefficient.
    pub angular_damping: f32,
    /// Enable continuous collision detection for fast motion.
    pub ccd: bool,
    /// Permit automatic sleep once motion settles.
    pub can_sleep: bool,
}

impl Default for BodyDesc {
    fn default() -> Self {
        Self {
            kind: BodyKind::Dynamic,
            pose: Pose::default(),
            linear_velocity: [0.0; 3],
            angular_velocity: [0.0; 3],
            gravity_scale: 1.0,
            linear_damping: 0.0,
            angular_damping: 0.0,
            ccd: false,
            can_sleep: true,
        }
    }
}

/// Collision geometry in local engine units. Boxes use half extents.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum Shape {
    /// Box centered on its local origin.
    Box {
        /// Positive half-widths along local X, Y and Z (at most 10000).
        /// Planar Z permits 30000 for authored XY extrusion; explicit geometry is retained.
        #[serde(with = "crate::checkpoint_codec::array")]
        half_extents: [f32; 3],
    },
    /// Sphere centered on its local origin.
    Sphere {
        /// Positive sphere radius.
        radius: f32,
    },
    /// Half-height describes the cylindrical part along the local Y axis.
    Capsule {
        /// Half the cylinder length; zero yields a sphere.
        half_height: f32,
        /// Positive radius of the cylinder and spherical caps.
        radius: f32,
    },
    /// Convex hull of 4–256 finite points. Coplanar/degenerate hulls are rejected.
    ConvexHull {
        /// Local coordinates within +/-10000, with planar Z extended to +/-30000.
        #[serde(with = "crate::checkpoint_codec::vector")]
        points: Vec<[f32; 3]>,
    },
    /// Indexed terrain surface, supported on fixed or kinematic bodies only.
    TriangleMesh {
        /// Local positions (3–65,536 vertices).
        #[serde(with = "crate::checkpoint_codec::vector")]
        vertices: Vec<[f32; 3]>,
        /// Nondegenerate index triples (1–131,072 triangles); collision is two-sided.
        #[serde(with = "crate::checkpoint_codec::vector")]
        triangles: Vec<[u32; 3]>,
    },
    /// Y-up terrain. Samples are row-major: Z row, X column.
    /// `size` is the total X/Z extent, centered on the origin; heights are engine units.
    Heightfield {
        /// Sample count along Z, at least two.
        rows: usize,
        /// Sample count along X, at least two.
        columns: usize,
        /// `rows * columns` Y coordinates, with consecutive columns in each row.
        #[serde(with = "crate::checkpoint_codec::vector")]
        heights: Vec<f32>,
        /// Total X and Z spans, not per-cell sizes.
        #[serde(with = "crate::checkpoint_codec::array")]
        size: [f32; 2],
    },
    /// Up to 64 positioned convex parts, sharing one collider identity and material.
    /// Nested compounds and terrain parts are rejected.
    Compound {
        /// Nonempty convex pieces with local poses.
        #[serde(with = "crate::checkpoint_codec::vector")]
        parts: Vec<ShapePart>,
    },
}

/// A convex piece of compound geometry, positioned relative to its collider.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ShapePart {
    /// Pose relative to the compound collider.
    pub pose: Pose,
    /// Box, sphere, capsule or convex hull; compounds and terrain cannot be nested.
    pub shape: Shape,
}

/// Collider material and filtering input.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct ColliderDesc {
    /// Local collision geometry.
    pub shape: Shape,
    /// Collider pose relative to its parent body.
    pub pose: Pose,
    /// Nonnegative mass per cubic engine unit; zero permits massless sensor fixtures.
    /// This is a 3D volume density in both spaces.
    pub density: f32,
    /// Friction coefficient in [0, 10].
    pub friction: f32,
    /// Restitution coefficient in [0, 1].
    pub restitution: f32,
    /// World-space surface speed in engine units/s. Only its contact-tangent
    /// component drives friction; this does not move the collider geometry.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub surface_velocity: [f32; 3],
    /// Optional explicit penetration correction. None uses native softness.
    pub contact_correction: Option<super::ContactCorrection>,
    /// Detect overlap without solid contact response.
    pub sensor: bool,
    /// Collision membership bits.
    pub category: u32,
    /// Accepted membership bits; both participants must accept each other.
    pub mask: u32,
}

impl ColliderDesc {
    /// Creates a collider with unit density and ordinary solid contact behavior.
    pub fn new(shape: Shape) -> Self {
        Self {
            shape,
            pose: Pose::default(),
            density: 1.0,
            friction: 0.5,
            restitution: 0.0,
            surface_velocity: [0.0; 3],
            contact_correction: None,
            sensor: false,
            category: 1,
            mask: u32::MAX,
        }
    }
}

/// A copied simulation state, safe across subsequent mutations and allocations.
#[derive(Debug, Clone, PartialEq)]
pub struct BodyState {
    /// Current world-space pose.
    pub pose: Pose,
    /// Current world-space velocity in engine units per second.
    pub linear_velocity: [f32; 3],
    /// Current world-space angular velocity in radians per second.
    pub angular_velocity: [f32; 3],
    /// Whether the backend currently excludes this settled body from integration.
    pub sleeping: bool,
}

/// Errors at the engine/backend boundary; no upstream error types leak to callers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum PhysicsError {
    /// Invalid timestep, gravity, unit scale, or capacity setting.
    InvalidConfig,
    /// Non-finite or out-of-range body input.
    InvalidBody,
    /// Direct angular motion would bypass the body rotation lock.
    LockedRotation,
    /// Invalid or degenerate geometry, material or collider pose.
    InvalidCollider,
    /// Invalid query pose, direction, distance or output limit.
    InvalidQuery,
    /// Input would violate the XY-plane constraints.
    OutOfPlane,
    /// The body slot/generation is no longer live in this world.
    StaleBody,
    /// The collider slot/generation is no longer live in this world.
    StaleCollider,
    /// A body or collider capacity would be exceeded.
    CapacityExceeded,
    /// The operation does not apply to this body's integration kind.
    WrongBodyKind,
    /// Geometry is not supported by this operation (for example dynamic terrain).
    UnsupportedShape,
    /// Invalid controller dimensions, movement input or upright capsule orientation.
    InvalidCharacter,
    /// This live identity has no registered character controller.
    NotCharacter,
    /// Disable the character controller before changing its owned motion or solid shape.
    CharacterControlled,
    /// Invalid joint frames, endpoints, limits, motor or break thresholds.
    InvalidJoint,
    /// The joint slot/generation is no longer live in this world.
    StaleJoint,
    /// Valid motion inputs could not be certified or resolved within the actual solver plan.
    UnresolvedMotion,
}

impl fmt::Display for PhysicsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidConfig => "invalid physics world configuration",
            Self::LockedRotation => "direct motion violates the body rotation lock",
            Self::InvalidBody => "invalid body pose, velocity, or integration settings",
            Self::InvalidCollider => "invalid collider geometry or material",
            Self::InvalidQuery => "invalid query pose, direction, distance, or result limit",
            Self::OutOfPlane => "planar physics requires Z=0 and rotation/velocity about Z only",
            Self::StaleBody => "body handle no longer exists",
            Self::StaleCollider => "collider handle no longer exists",
            Self::CapacityExceeded => "physics capacity exceeded",
            Self::WrongBodyKind => "operation requires a different body kind",
            Self::UnsupportedShape => "shape is not supported for this operation or body kind",
            Self::InvalidCharacter => {
                "invalid character settings, capsule orientation or movement input"
            }
            Self::NotCharacter => "body has no character controller",
            Self::CharacterControlled => "character controller owns this motion or collider",
            Self::InvalidJoint => "invalid joint endpoints, frames or settings",
            Self::StaleJoint => "joint handle no longer exists",
            Self::UnresolvedMotion => "actual motion could not be certified or resolved",
        })
    }
}

impl std::error::Error for PhysicsError {}

pub(super) fn valid_vector(v: &[f32]) -> bool {
    v.iter().all(|n| n.is_finite() && n.abs() <= 1.0e6)
}

pub(super) fn valid_pose(p: Pose) -> bool {
    valid_vector(&p.position)
        && valid_vector(&p.rotation)
        && (p
            .rotation
            .iter()
            .map(|v| f64::from(*v).powi(2))
            .sum::<f64>()
            - 1.0)
            .abs()
            <= 1.0e-5
}

pub(super) fn validate_plane(
    space: Space,
    pose: Pose,
    linear: [f32; 3],
    angular: [f32; 3],
) -> Result<(), PhysicsError> {
    if space == Space::PlanarXy
        && (pose.position[2] != 0.0
            || pose.rotation[0] != 0.0
            || pose.rotation[1] != 0.0
            || linear[2] != 0.0
            || angular[0] != 0.0
            || angular[1] != 0.0)
    {
        Err(PhysicsError::OutOfPlane)
    } else {
        Ok(())
    }
}
