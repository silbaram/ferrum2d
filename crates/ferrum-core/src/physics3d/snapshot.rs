//! Build-local native checkpoints. The opaque value is produced by a live world;
//! importing arbitrary bytes and whole Engine persistence are separate contracts.
use super::geometry;
use super::world::{native_id, validate_config};
use super::{character::CharacterRuntime, events::EventCollector, joints::JointRuntime};
use super::{BodyId, PhysicsWorld3d, WorldConfig};
use postcard::ser_flavors::Flavor;
use rapier3d::prelude as rp;
use std::collections::BTreeMap;
use std::fmt;

mod backend_state;
mod body_numerics;
mod character_admission;
mod contact_numerics;
mod contact_workspaces;
mod integration_parameters;
mod islands;
mod joint_numerics;
mod stored_characters;

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(remote = "PhysicsWorld3d")]
struct WorldState {
    #[serde(with = "backend_state::State")]
    backend: rp::PhysicsWorld,
    statistics: super::statistics::Statistics,
    #[serde(skip)]
    tick_outputs: super::world::tick_outputs::TickOutputs,
    config: WorldConfig,
    #[serde(skip)]
    interval_nominal_seconds: Option<f32>,
    events: EventCollector,
    contact_policies: super::contact_policy::ContactPolicies,
    query_updates: Vec<rp::ColliderHandle>,
    collider_shape_revisions: BTreeMap<super::ColliderId, u64>,
    path_scratch: super::kinematic_paths::PathScratch,
    step_motion: super::queries::StepMotion,
    #[serde(with = "stored_characters")]
    characters: BTreeMap<BodyId, CharacterRuntime>,
    #[serde(skip)]
    character_motion: Box<super::character_motion::MotionScene>,
    #[serde(skip)]
    character_order: Vec<BodyId>,
    #[serde(skip)]
    character_contacts: super::character_contacts::Scratch,
    #[serde(skip)]
    character_dynamics: super::character_dynamics::Scratch,
    joints: BTreeMap<super::JointId, JointRuntime>,
    joint_events: Vec<super::JointEvent>,
    dropped_joint_events: usize,
    broken_joints: Vec<(super::JointId, super::JointEventReason)>,
    planar_angles: BTreeMap<BodyId, super::planar_angle::PlanarAngle>,
    #[serde(skip)]
    joint_kinematics: Vec<(rp::RigidBodyHandle, rp::Pose, rp::Pose)>,
}

#[derive(serde::Serialize)]
struct Capture<'a> {
    #[serde(with = "WorldState")]
    world: &'a PhysicsWorld3d,
}
#[derive(serde::Deserialize)]
struct Restore {
    #[serde(deserialize_with = "read_world")]
    world: PhysicsWorld3d,
}

fn read_world<'de, D: serde::Deserializer<'de>>(source: D) -> Result<PhysicsWorld3d, D::Error> {
    // Serde skips the transient scratch, so its fixed heap allocation needs
    // an explicit charge before the remote world's default constructs it.
    crate::checkpoint_decode::reserve::<super::character_motion::MotionScene>(1)
        .map_err(|_| serde::de::Error::custom("physics motion scratch allocation budget"))?;
    WorldState::deserialize(source)
}

/// Native checkpoint format. Changing persistent fields requires a new version.
/// Version7 stores private trajectory domains and normalized controller/path
/// fractions as f64; original native observer labels and physical dt remain f32.
pub const PHYSICS_SNAPSHOT_VERSION: u32 = 7;
/// Maximum encoded checkpoint size, including its envelope.
pub const PHYSICS_SNAPSHOT_MAX_BYTES: usize = 64 * 1024 * 1024;
const HEADER: usize = 32;
const MAGIC: &[u8; 8] = b"F2DPHYS\0";
// Independent cold reference/scratch policies. These count raw stored slots,
// links and requested temporary bytes, not bodies, decode heap or process RSS.
const REFERENCE_LIMITS: rp::StoredReferenceLimits = rp::StoredReferenceLimits {
    max_work: 128 * 1024 * 1024,
    max_scratch_bytes: 64 * 1024 * 1024,
};

// Shared source/target fingerprint includes all pinned core, Rapier and Parry inputs.
include!(concat!(env!("OUT_DIR"), "/checkpoint_build.rs"));
const fn crc_table() -> [u32; 256] {
    let mut table = [0; 256];
    let mut i = 0;
    while i < 256 {
        let mut value = i as u32;
        let mut bit = 0;
        while bit < 8 {
            value = if value & 1 == 0 {
                value >> 1
            } else {
                (value >> 1) ^ 0xedb88320
            };
            bit += 1;
        }
        table[i] = value;
        i += 1;
    }
    table
}
fn crc(bytes: &[u8]) -> u32 {
    const TABLE: [u32; 256] = crc_table();
    !bytes.iter().fold(!0u32, |sum, byte| {
        (sum >> 8) ^ TABLE[((sum ^ u32::from(*byte)) & 255) as usize]
    })
}

/// Rejected checkpoint capture/restore. No failed restore changes the live world.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhysicsSnapshotError {
    /// Encoded bytes or cold validation exceed a resource budget, or allocation failed.
    Capacity,
    /// The envelope is truncated, has an unknown magic, or has trailing data.
    InvalidEnvelope,
    /// The format or pinned engine/backend build differs.
    IncompatibleBuild,
    /// Encoded bytes failed their integrity check.
    Corrupt,
    /// Native state could not be encoded/decoded or violates world invariants.
    InvalidState,
}
impl fmt::Display for PhysicsSnapshotError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Capacity => "Native checkpoint resource budget exceeded or allocation failed",
            Self::InvalidEnvelope => "Invalid native checkpoint envelope",
            Self::IncompatibleBuild => "Incompatible native checkpoint format/build",
            Self::Corrupt => "Corrupt native checkpoint payload",
            Self::InvalidState => "Invalid native checkpoint state",
        })
    }
}
impl std::error::Error for PhysicsSnapshotError {}

/// Owned, opaque native checkpoint captured by this engine build.
///
/// Includes backend arenas, contacts/islands, pending commands, character/joint
/// runtime and observation streams. Handles retain their saved world identity.
/// It is not an Engine/Data Scene checkpoint and has no arbitrary-byte importer.
#[derive(Clone)]
pub struct PhysicsSnapshot {
    bytes: Vec<u8>,
}
impl fmt::Debug for PhysicsSnapshot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PhysicsSnapshot")
            .field("version", &PHYSICS_SNAPSHOT_VERSION)
            .field("bytes", &self.bytes.len())
            .finish()
    }
}
impl PhysicsSnapshot {
    /// Borrow the encoded bytes for size/provenance evidence. No mutation is allowed.
    pub fn encoded_bytes(&self) -> &[u8] {
        &self.bytes
    }
    fn payload(&self) -> Result<&[u8], PhysicsSnapshotError> {
        snapshot_payload(&self.bytes)
    }
}
fn snapshot_payload(bytes: &[u8]) -> Result<&[u8], PhysicsSnapshotError> {
    if bytes.len() > PHYSICS_SNAPSHOT_MAX_BYTES {
        return Err(PhysicsSnapshotError::Capacity);
    }
    if bytes.len() < HEADER || &bytes[..8] != MAGIC {
        return Err(PhysicsSnapshotError::InvalidEnvelope);
    }
    let u32_at = |at| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("checked envelope"));
    if u32_at(8) != PHYSICS_SNAPSHOT_VERSION
        || u64::from_le_bytes(bytes[12..20].try_into().expect("checked envelope")) != BUILD
    {
        return Err(PhysicsSnapshotError::IncompatibleBuild);
    }
    if u32_at(20) as usize != bytes.len() - HEADER || u32_at(28) != 0 {
        return Err(PhysicsSnapshotError::InvalidEnvelope);
    }
    let payload = &bytes[HEADER..];
    if crc(payload) != u32_at(24) {
        return Err(PhysicsSnapshotError::Corrupt);
    }
    Ok(payload)
}

struct Output {
    bytes: Vec<u8>,
    limit: usize,
}
impl Flavor for Output {
    type Output = Vec<u8>;
    fn try_push(&mut self, value: u8) -> postcard::Result<()> {
        self.try_extend(&[value])
    }
    fn try_extend(&mut self, values: &[u8]) -> postcard::Result<()> {
        let required = self.bytes.len().saturating_add(values.len());
        if required > self.limit {
            return Err(postcard::Error::SerializeBufferFull);
        }
        if required > self.bytes.capacity() {
            // Bound requested buffer growth as well as encoded length. This is
            // not a bound on the world's memory or decoder allocation overhead.
            let target = (self.bytes.capacity() + self.bytes.capacity() / 2)
                .max(required)
                .min(self.limit);
            self.bytes
                .try_reserve_exact(target - self.bytes.len())
                .map_err(|_| postcard::Error::SerializeBufferFull)?;
        }
        self.bytes.extend_from_slice(values);
        Ok(())
    }
    fn finalize(self) -> postcard::Result<Self::Output> {
        Ok(self.bytes)
    }
}

impl PhysicsWorld3d {
    /// Capture a cold checkpoint without advancing time, consuming input or
    /// refreshing native modification queues. Serialization is byte-budgeted.
    pub fn capture_snapshot(&self) -> Result<PhysicsSnapshot, PhysicsSnapshotError> {
        self.capture_snapshot_with_limit(PHYSICS_SNAPSHOT_MAX_BYTES)
    }
    /// Capture with a stricter encoded-byte budget. The global hard cap still applies.
    pub fn capture_snapshot_with_limit(
        &self,
        limit: usize,
    ) -> Result<PhysicsSnapshot, PhysicsSnapshotError> {
        if !(HEADER..=PHYSICS_SNAPSHOT_MAX_BYTES).contains(&limit) {
            return Err(PhysicsSnapshotError::Capacity);
        }
        self.validate_snapshot_state()?;
        let mut bytes = Vec::new();
        bytes
            .try_reserve(HEADER)
            .map_err(|_| PhysicsSnapshotError::Capacity)?;
        bytes.resize(HEADER, 0);
        let mut bytes =
            postcard::serialize_with_flavor(&Capture { world: self }, Output { bytes, limit })
                .map_err(|e| {
                    if e == postcard::Error::SerializeBufferFull {
                        PhysicsSnapshotError::Capacity
                    } else {
                        PhysicsSnapshotError::InvalidState
                    }
                })?;
        bytes[..8].copy_from_slice(MAGIC);
        bytes[8..12].copy_from_slice(&PHYSICS_SNAPSHOT_VERSION.to_le_bytes());
        bytes[12..20].copy_from_slice(&BUILD.to_le_bytes());
        let length = (bytes.len() - HEADER) as u32;
        let checksum = crc(&bytes[HEADER..]);
        bytes[20..24].copy_from_slice(&length.to_le_bytes());
        bytes[24..28].copy_from_slice(&checksum.to_le_bytes());
        Ok(PhysicsSnapshot { bytes })
    }
    /// Construct a separate world with the checkpoint's saved native identities.
    /// Workspace caches are rebuilt; persistent solver/contact state is retained.
    pub fn from_snapshot(snapshot: &PhysicsSnapshot) -> Result<Self, PhysicsSnapshotError> {
        Self::from_payload(snapshot.payload()?)
    }
    fn from_payload(payload: &[u8]) -> Result<Self, PhysicsSnapshotError> {
        let Restore { mut world } =
            crate::checkpoint_decode::from_bytes(payload).map_err(|error| match error.kind {
                crate::checkpoint_decode::ErrorKind::Limit(_)
                | crate::checkpoint_decode::ErrorKind::Allocation => PhysicsSnapshotError::Capacity,
                crate::checkpoint_decode::ErrorKind::Trailing => {
                    PhysicsSnapshotError::InvalidEnvelope
                }
                crate::checkpoint_decode::ErrorKind::Invalid => PhysicsSnapshotError::InvalidState,
            })?;
        world.validate_snapshot_state()?;
        // The upstream CCD solver is workspace-only and intentionally serde-skipped.
        world
            .backend
            .ccd_solver
            .set_diagnostic_limit(world.config.max_events);
        Ok(world)
    }
    /// Replace the world only after the complete candidate has been decoded and
    /// validated. Engine/entity remapping is outside this native-only operation.
    pub fn restore_snapshot(
        &mut self,
        snapshot: &PhysicsSnapshot,
    ) -> Result<(), PhysicsSnapshotError> {
        let world = Self::from_snapshot(snapshot)?;
        *self = world;
        Ok(())
    }
    fn validate_snapshot_state(&self) -> Result<(), PhysicsSnapshotError> {
        self.validate_snapshot_state_with_reference_limits(REFERENCE_LIMITS)
    }
    fn validate_snapshot_state_with_reference_limits(
        &self,
        limits: rp::StoredReferenceLimits,
    ) -> Result<(), PhysicsSnapshotError> {
        let invalid = || PhysicsSnapshotError::InvalidState;
        // Validate capacities/settings through the same constructor contract.
        validate_config(&self.config).map_err(|_| invalid())?;
        integration_parameters::validate(&self.backend.integration_parameters, &self.config)?;
        // Check cross-container handles/graph links before consumers traverse
        // the candidate. This read-only check also applies to cold capture.
        rp::validate_stored_references(&self.backend, limits).map_err(|error| match error {
            rp::StoredReferenceError::WorkLimit
            | rp::StoredReferenceError::ScratchLimit
            | rp::StoredReferenceError::Allocation => PhysicsSnapshotError::Capacity,
            _ => PhysicsSnapshotError::InvalidState,
        })?;
        islands::validate(&self.backend)?;
        contact_numerics::validate(&self.backend)?;
        contact_workspaces::validate(&self.backend)?;
        if self.interval_nominal_seconds.is_some()
            || self.body_count() > self.config.max_bodies
            || self.collider_count() > self.config.max_colliders
            || self.joint_count() > self.config.max_joints
            || self.characters.len() > self.config.max_characters
            || self.backend.bodies.iter().count() != self.body_count()
            || self.backend.colliders.iter().count() != self.collider_count()
            || self.backend.gravity.to_array() != self.config.gravity
        {
            return Err(invalid());
        }
        body_numerics::validate(&self.backend)?;
        self.validate_joint_numerics()?;
        for (handle, body) in self.backend.bodies.iter() {
            if body
                .translation()
                .to_array()
                .iter()
                .chain(body.linvel().to_array().iter())
                .chain(body.angvel().to_array().iter())
                .any(|v| !v.is_finite())
            {
                return Err(invalid());
            }
            for collider in body.colliders() {
                if !self
                    .backend
                    .colliders
                    .get(*collider)
                    .is_some_and(|c| c.parent() == Some(handle))
                {
                    return Err(invalid());
                }
            }
        }
        // File aliases may point many colliders at one large mesh, so each
        // shared geometry allocation is checked once.
        let mut checked_shapes = std::collections::BTreeSet::new();
        for (id, collider) in self.backend.colliders.iter() {
            if !collider
                .parent()
                .and_then(|p| self.backend.bodies.get(p))
                .is_some_and(|b| b.colliders().contains(&id))
                || !collider
                    .position_wrt_parent()
                    .is_some_and(|local| geometry::valid_native_pose(local, self.config.space))
            {
                return Err(invalid());
            }
            let shape = collider.shared_shape();
            if checked_shapes.insert(std::sync::Arc::as_ptr(&shape.0).cast::<()>() as usize)
                && !geometry::valid_native_shape(shape.as_ref(), self.config.space)
            {
                return Err(invalid());
            }
        }
        if self.collider_shape_revisions.len() > self.collider_count()
            || self.collider_shape_revisions.iter().any(|(id, revision)| {
                *revision == 0
                    || !self
                        .backend
                        .colliders
                        .contains(super::colliders::native_collider(*id))
            })
        {
            return Err(invalid());
        }
        for (id, character) in &self.characters {
            character
                .config
                .validate(self.config.space)
                .map_err(|_| invalid())?;
            let Some(body) = self.backend.bodies.get(native_id(*id)) else {
                return Err(invalid());
            };
            if body.body_type() != rapier3d::prelude::RigidBodyType::KinematicPositionBased
                || !self
                    .backend
                    .colliders
                    .get(super::colliders::native_collider(character.collider))
                    .is_some_and(|c| {
                        c.parent() == Some(native_id(*id))
                            && !c.is_sensor()
                            && c.shape().as_capsule().is_some_and(|capsule| {
                                character.config.skin_width < capsule.radius * 0.5
                            })
                            && c.position_wrt_parent().is_some_and(|local| {
                                // Same relative capsule-axis contract as public
                                // enable_character; no pose normalization/repair.
                                let at = *body.position() * *local;
                                (at.rotation * rapier3d::prelude::Vector::Y)
                                    .dot(character.config.up.into())
                                    .abs()
                                    >= 1.0 - 1.0e-5
                            })
                    })
            {
                return Err(invalid());
            }
        }
        character_admission::validate(self, character_admission::LIMITS)?;
        self.step_motion.validate_saved_payload()?;
        for (id, joint) in &self.joints {
            if self
                .backend
                .impulse_joints
                .get(super::joints::native_joint(*id))
                .is_none()
            {
                return Err(invalid());
            }
            self.validate_joint(&joint.desc).map_err(|_| invalid())?;
        }
        Ok(())
    }
}

/// Parry's motion type has no serde representation; preserve its public inputs.
pub(super) mod motion {
    use rapier3d::parry::query::NonlinearRigidMotion;
    use rapier3d::prelude as rp;
    use serde::{Deserialize, Serialize};
    pub fn serialize<S: serde::Serializer>(
        value: &NonlinearRigidMotion,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        (value.start, value.local_center, value.linvel, value.angvel).serialize(serializer)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<NonlinearRigidMotion, D::Error> {
        let (start, center, linear, angular) =
            <(rp::Pose, rp::Vector, rp::Vector, rp::Vector)>::deserialize(deserializer)?;
        Ok(NonlinearRigidMotion::new(start, center, linear, angular))
    }
}

#[cfg(test)]
mod tests;

/// Internal composition of an Engine checkpoint. The outer checkpoint is still
/// produced by a live Engine; this is not a public arbitrary-byte importer.
pub(crate) mod checkpoint_state {
    use super::*;
    use serde::Deserialize;
    pub fn serialize<S: serde::Serializer>(
        world: &PhysicsWorld3d,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        let snapshot = world
            .capture_snapshot()
            .map_err(serde::ser::Error::custom)?;
        serializer.serialize_bytes(&snapshot.bytes)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<PhysicsWorld3d, D::Error> {
        let bytes = <&[u8]>::deserialize(deserializer)?;
        let payload = snapshot_payload(bytes).map_err(serde::de::Error::custom)?;
        PhysicsWorld3d::from_payload(payload).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod controller_contract_tests;

#[cfg(test)]
mod character_runtime_tests;
