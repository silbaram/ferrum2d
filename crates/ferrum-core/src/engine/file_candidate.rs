//! Internal detached preparation, not complete Engine or SDK file admission.
//!
//! The candidate never returns its Engine, steps, queries, renders or publishes.
//! SDK sections, complete Engine payload semantics, actual
//! allocator/RSS, resource graph and owner/epoch/fence publication remain separate
//! required stages. A successful preparation cannot be used as a Ready token.

use super::{
    file_builtin_scenes_admission as builtin, file_controller_admission as controller,
    file_data_gameplay_admission as data_gameplay, file_data_movement_admission as data_movement,
    file_engine_section as engine_section, file_envelope as framing,
    file_frame_admission as frame_output, file_gameplay_authoring_admission as gameplay_authoring,
    file_native_resources as native_resources, file_native_roster as native_roster,
    file_physics_output_admission as physics_output, file_presentation_admission as presentation,
    file_root_admission as root_settings,
    file_runtime_observation_admission as runtime_observations,
    file_runtime_payload_admission as runtime_payload, file_scratch_admission as scratch,
    file_sharing as sharing, file_spatial_admission as spatial, file_tilemap_admission as tilemap,
    persistence, unified_physics::file_admission as bindings,
};
use super::{Engine, RuntimeCheckpointError};
use crate::gameplay_variables::file_admission as variables;
use crate::world::payload_admission as world_payload;
use crate::world::persistence_admission as world_storage;
use std::fmt;

const MIB: usize = 1024 * 1024;
const MAX_POST_DECODE_WORK: u64 = 128 * MIB as u64;
const MAX_POST_DECODE_SCRATCH: usize = 64 * MIB;
const MAX_ALLOCATION_WORK: usize = 1024 * MIB;
const MAX_CHECKSUM_WORK: usize = 1024 * MIB;
const MAX_ALIAS_ROOTS: usize = 64 * MIB;
const MAX_ALIAS_COMPARE_BYTES: usize = 512 * MIB;
const MAX_ENTITY_SLOTS: usize = MIB;
const MAX_JOINT_SLOTS: usize = MIB;
const MAX_NESTED_ITEMS: usize = 64 * MIB;
// The actual native slab has 64 slots and at most 128 scalar normalizations.
const VARIABLE_WORK: u64 = 64 + 128;

#[derive(Clone, Debug)]
pub(super) struct Limits {
    pub framing: framing::Limits,
    pub decode: crate::checkpoint_decode::Limits,
    pub max_checksum_work: usize,
    /// Conservative decode allowance plus all post-decode scratch requests.
    /// Neither this quantity nor the underlying decoder measures allocator/RSS.
    pub max_allocation_work: usize,
    pub max_post_decode_work: u64,
    pub max_post_decode_scratch_bytes: usize,
    pub max_entity_slots: usize,
    pub max_joint_slots: usize,
    pub max_nested_items: usize,
    pub max_alias_roots: usize,
    pub max_alias_compare_bytes: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            framing: framing::Limits::default(),
            decode: crate::checkpoint_decode::Limits {
                allocation_work: MAX_ALLOCATION_WORK - MAX_POST_DECODE_SCRATCH,
                ..Default::default()
            },
            max_checksum_work: 256 * MIB,
            max_allocation_work: MAX_ALLOCATION_WORK,
            max_post_decode_work: MAX_POST_DECODE_WORK,
            max_post_decode_scratch_bytes: MAX_POST_DECODE_SCRATCH,
            max_entity_slots: MAX_ENTITY_SLOTS,
            max_joint_slots: MAX_JOINT_SLOTS,
            max_nested_items: MAX_NESTED_ITEMS,
            max_alias_roots: MAX_ALIAS_ROOTS,
            max_alias_compare_bytes: 128 * MIB,
        }
    }
}
impl Limits {
    fn validate(&self, input_bytes: usize) -> Result<usize, Error> {
        let absolute = crate::checkpoint_decode::Limits::default();
        if self.decode.input_bytes > absolute.input_bytes
            || self.decode.allocation_work > absolute.allocation_work
            || self.decode.values > absolute.values
            || self.decode.depth > absolute.depth
            || self.decode.collection > absolute.collection
            || self.decode.zero_sized_elements > absolute.zero_sized_elements
            || self.max_post_decode_work > MAX_POST_DECODE_WORK
            || self.max_post_decode_scratch_bytes > MAX_POST_DECODE_SCRATCH
            || self.max_allocation_work > MAX_ALLOCATION_WORK
            || self.max_checksum_work > MAX_CHECKSUM_WORK
            || self.max_entity_slots > MAX_ENTITY_SLOTS
            || self.max_joint_slots > MAX_JOINT_SLOTS
            || self.max_nested_items > MAX_NESTED_ITEMS
            || self.max_alias_roots > MAX_ALIAS_ROOTS
            || self.max_alias_compare_bytes > MAX_ALIAS_COMPARE_BYTES
        {
            return Err(Error::InvalidLimits);
        }
        let allocation = self
            .decode
            .allocation_work
            .checked_add(self.max_post_decode_scratch_bytes)
            .ok_or(Error::AllocationAllowance)?;
        if allocation > self.max_allocation_work {
            return Err(Error::AllocationAllowance);
        }
        // Framing, file Engine wrapper, inner memory Engine and its one native
        // PhysicsWorld each scan at most file_bytes. Reserve BEFORE any CRC.
        let checksum = input_bytes.checked_mul(4).ok_or(Error::ChecksumWork)?;
        if checksum > self.max_checksum_work {
            return Err(Error::ChecksumWork);
        }
        Ok(checksum)
    }

    fn sharing(&self, work: u64, scratch: usize) -> sharing::Limits {
        sharing::Limits {
            max_work: work,
            max_scratch_bytes: scratch,
            max_roots: self.max_alias_roots,
            max_compare_bytes: self.max_alias_compare_bytes,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Error {
    InvalidLimits,
    AllocationAllowance,
    ChecksumWork,
    PostDecodeWork,
    PostDecodeScratch,
    Framing(framing::Error),
    Engine(RuntimeCheckpointError),
    EngineSection(engine_section::Error),
    Sharing(sharing::Error),
    World(world_payload::WorldPayloadAdmissionError),
    Variables(variables::Error),
    Root(root_settings::Error),
    GameplayAuthoring(gameplay_authoring::Error),
    Frame(frame_output::Error),
    Presentation(presentation::Error),
    Tilemap(tilemap::Error),
    DataMovement(data_movement::Error),
    Scratch(scratch::Error),
    Spatial(spatial::Error),
    Controller(controller::Error),
    PhysicsOutput(physics_output::Error),
    DataGameplay(data_gameplay::Error),
    RuntimeObservations(runtime_observations::Error),
    RuntimePayload(runtime_payload::Error),
    Builtin(builtin::Error),
    Bindings(bindings::Error),
    NativeRoster(native_roster::Error),
    NativeResources(native_resources::Error),
    EngineSectionUnavailable,
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "detached native file candidate rejected: {self:?}")
    }
}
impl std::error::Error for Error {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Usage {
    pub file_bytes: usize,
    pub engine_section_bytes: usize,
    /// A conservative reservation of 4 * file_bytes, not CPU instructions.
    pub checksum_work_reserved: usize,
    /// Configured allowance; not an assertion of actual allocations or RSS.
    pub decode_allocation_allowance: usize,
    /// Only the explicitly connected passes after native decoding.
    pub post_decode_work: u64,
    /// Cumulative logical scratch/output payload; includes roster Vecs retained
    /// for Candidate lifetime, not only temporary arrays and not actual RSS.
    pub post_decode_scratch_bytes: usize,
    pub world_nested_items: usize,
    pub alias_roots: usize,
    /// Logical byte models of both owners, not the wire length or RSS.
    pub alias_compare_bytes: usize,
}

/// Owned candidate with borrowed, still-unvalidated SDK bytes. Engine fields are
/// private even to parent modules: no into_engine/execute/query/publish API exists.
pub(super) struct Candidate<'a> {
    engine: Box<Engine>,
    file: framing::ParsedEnvelope<'a>,
    variables: variables::Layout,
    usage: Usage,
    native_roster: native_roster::Roster,
    native_resources: native_resources::Inventory,
}
impl fmt::Debug for Candidate<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DetachedFileCandidate")
            .field("usage", &self.usage)
            .field("unvalidated_sdk_sections", &6)
            .finish_non_exhaustive()
    }
}
pub(super) struct OwnedParts {
    pub engine: Option<Box<Engine>>,
    pub ranges: [(usize, usize); 7],
    pub variables: variables::Layout,
    pub usage: Usage,
    pub native_roster: native_roster::Roster,
    pub native_resources: native_resources::Inventory,
}

impl<'a> Candidate<'a> {
    /// Move admitted payloads only; no retained borrow or whole-file clone.
    pub(super) fn into_owned_parts(self) -> OwnedParts {
        OwnedParts {
            engine: Some(self.engine),
            ranges: self.file.checked_ranges(),
            variables: self.variables,
            usage: self.usage,
            native_roster: self.native_roster,
            native_resources: self.native_resources,
        }
    }

    /// Actual stored ID dependency facts only; never a loaded resource/Ready token.
    #[allow(dead_code)] // Private SDK linkage is staged separately.
    pub(super) fn native_resources(&self) -> &native_resources::Inventory {
        &self.native_resources
    }

    /// Metadata-only borrow of this admitted cut; never an Engine/Ready handle.
    #[allow(dead_code)] // Private SDK linkage is staged separately.
    pub(super) fn native_roster(&self) -> &native_roster::Roster {
        &self.native_roster
    }

    pub(super) fn variable_layout(&self) -> &variables::Layout {
        &self.variables
    }

    pub(super) fn usage(&self) -> Usage {
        self.usage
    }

    /// Borrow only SDK bytes for the next bounded parsing/validation stages.
    /// This does not assert any schema/content or resource binding is admitted.
    pub(super) fn sdk_section(&self, kind: framing::SectionKind) -> Result<&'a [u8], Error> {
        if kind == framing::SectionKind::Engine {
            return Err(Error::EngineSectionUnavailable);
        }
        Ok(self.file.section(kind))
    }
}

pub(super) fn profile(sdk_build: u64) -> framing::BuildProfile {
    framing::BuildProfile {
        engine: crate::checkpoint_codec::build_fingerprint(),
        sdk: sdk_build,
        word_bits: usize::BITS,
    }
}

/// Private source capture for the file-only Engine section. The immutable Rust
/// borrow covers original identity capture and memory encoding. SDK participant
/// fences/resources, aggregate capture allocations and publication remain open.
pub(super) fn capture_engine_section(engine: &Engine, limits: &Limits) -> Result<Vec<u8>, Error> {
    capture_engine_section_with_usage(engine, limits).map(|(bytes, _)| bytes)
}
#[derive(Clone, Copy, Debug)]
pub(super) struct CaptureUsage {
    pub work: u64,
    pub scratch: usize,
}
pub(super) fn capture_engine_section_with_usage(
    engine: &Engine,
    limits: &Limits,
) -> Result<(Vec<u8>, CaptureUsage), Error> {
    limits.validate(0)?;
    let (tables, usage) = sharing::capture(
        engine,
        limits.sharing(
            limits.max_post_decode_work,
            limits.max_post_decode_scratch_bytes,
        ),
    )
    .map_err(Error::Sharing)?;
    let memory = persistence::encode(engine).map_err(Error::Engine)?;
    let bytes = engine_section::encode(&memory, &tables.arcs, &tables.shapes)
        .map_err(Error::EngineSection)?;
    let scratch = usage
        .scratch_bytes
        .checked_add(memory.len())
        .and_then(|n| n.checked_add(bytes.len()))
        .ok_or(Error::PostDecodeScratch)?;
    let work = usage
        .work
        .checked_add(memory.len() as u64)
        .and_then(|n| n.checked_add(bytes.len() as u64))
        .ok_or(Error::PostDecodeWork)?;
    Ok((bytes, CaptureUsage { work, scratch }))
}

/// Decode into a NEW unpublished Engine; never accepts or mutates a live target.
/// The existing nested native snapshot decoder admits PhysicsWorld first. World
/// storage/component payload then precedes root settings and native bindings;
/// variable layout comes from
/// this actual decoded candidate, never from caller-provided metadata.
pub(super) fn prepare<'a>(
    bytes: &'a [u8],
    sdk_build: u64,
    limits: &Limits,
) -> Result<Candidate<'a>, Error> {
    let checksum_work_reserved = limits.validate(bytes.len())?;
    let file =
        framing::read(bytes, &profile(sdk_build), &limits.framing).map_err(Error::Framing)?;
    let engine_bytes = file.section(framing::SectionKind::Engine);
    let decoded: sharing::Decoded =
        engine_section::decode(engine_bytes, limits.decode).map_err(Error::EngineSection)?;
    let engine = decoded.engine;
    let tables = sharing::Tables {
        arcs: decoded.arcs,
        shapes: decoded.shapes,
    };
    let world = engine
        .world
        .validate_payload_admission(world_payload::WorldPayloadAdmissionLimits {
            storage: world_storage::WorldStorageAdmissionLimits {
                max_entity_slots: limits.max_entity_slots,
                max_joint_slots: limits.max_joint_slots,
                max_work: limits.max_post_decode_work,
                max_scratch_bytes: limits.max_post_decode_scratch_bytes,
            },
            max_work: limits.max_post_decode_work,
            max_scratch_bytes: limits.max_post_decode_scratch_bytes,
            max_nested_items: limits.max_nested_items,
        })
        .map_err(Error::World)?;
    let remaining_work = limits
        .max_post_decode_work
        .checked_sub(world.work_units)
        .and_then(|n| n.checked_sub(VARIABLE_WORK))
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = limits
        .max_post_decode_scratch_bytes
        .checked_sub(world.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let variables = engine
        .world
        .gameplay_variable_slab()
        .admit_file_layout()
        .map_err(Error::Variables)?;
    let root = root_settings::validate(
        &engine,
        root_settings::Limits {
            max_work: usize::try_from(remaining_work).map_err(|_| Error::PostDecodeWork)?,
        },
    )
    .map_err(Error::Root)?;
    let remaining_work = remaining_work
        .checked_sub(root.work as u64)
        .ok_or(Error::PostDecodeWork)?;
    let gameplay_authoring = gameplay_authoring::validate(
        &engine,
        gameplay_authoring::Limits {
            max_work: remaining_work,
        },
    )
    .map_err(Error::GameplayAuthoring)?;
    let remaining_work = remaining_work
        .checked_sub(gameplay_authoring.work)
        .ok_or(Error::PostDecodeWork)?;
    let presentation = presentation::validate(
        &engine,
        presentation::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::Presentation)?;
    let remaining_work = remaining_work
        .checked_sub(presentation.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(presentation.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let tilemap = tilemap::validate(
        &engine,
        tilemap::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::Tilemap)?;
    let remaining_work = remaining_work
        .checked_sub(tilemap.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(tilemap.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let data_movement = data_movement::validate(
        &engine,
        data_movement::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::DataMovement)?;
    let remaining_work = remaining_work
        .checked_sub(data_movement.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(data_movement.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let scratch = scratch::validate(
        &engine,
        scratch::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::Scratch)?;
    let remaining_work = remaining_work
        .checked_sub(scratch.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(scratch.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let spatial = spatial::validate(
        &engine,
        spatial::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::Spatial)?;
    let remaining_work = remaining_work
        .checked_sub(spatial.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(spatial.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let physics_output = physics_output::validate(
        &engine,
        physics_output::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::PhysicsOutput)?;
    let remaining_work = remaining_work
        .checked_sub(physics_output.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(physics_output.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let frame = frame_output::validate(
        &engine.frame_buffers,
        frame_output::Limits {
            max_work: remaining_work,
        },
    )
    .map_err(Error::Frame)?;
    let remaining_work = remaining_work
        .checked_sub(frame.work)
        .ok_or(Error::PostDecodeWork)?;
    let native = bindings::validate_after_native_admission(
        &engine,
        bindings::Limits {
            max_work: usize::try_from(remaining_work).map_err(|_| Error::PostDecodeWork)?,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::Bindings)?;
    let remaining_work = remaining_work
        .checked_sub(native.work as u64)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(native.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let (engine, sharing) = sharing::restore(
        engine,
        tables,
        limits.sharing(remaining_work, remaining_scratch),
    )
    .map_err(Error::Sharing)?;
    let remaining_work = remaining_work
        .checked_sub(sharing.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(sharing.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    // Controller caches are checked after declared sharing is admitted. Any
    // later failure drops this owned detached Engine; no live target is exposed.
    let controller = controller::validate(
        &engine,
        controller::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::Controller)?;
    let remaining_work = remaining_work
        .checked_sub(controller.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(controller.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let data_gameplay = data_gameplay::validate(
        &engine,
        data_gameplay::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::DataGameplay)?;
    let remaining_work = remaining_work
        .checked_sub(data_gameplay.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(data_gameplay.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let runtime_observations = runtime_observations::validate(
        &engine,
        runtime_observations::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::RuntimeObservations)?;
    let remaining_work = remaining_work
        .checked_sub(runtime_observations.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(runtime_observations.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let runtime_payload = runtime_payload::validate(
        &engine,
        runtime_payload::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::RuntimePayload)?;
    let remaining_work = remaining_work
        .checked_sub(runtime_payload.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(runtime_payload.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let builtin = builtin::validate(
        &engine,
        builtin::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::Builtin)?;
    let remaining_work = remaining_work
        .checked_sub(builtin.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(builtin.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let (native_roster, roster_usage) = native_roster::capture_after_admission(
        &engine,
        &variables,
        native_roster::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::NativeRoster)?;
    let remaining_work = remaining_work
        .checked_sub(roster_usage.work)
        .ok_or(Error::PostDecodeWork)?;
    let remaining_scratch = remaining_scratch
        .checked_sub(roster_usage.scratch_bytes)
        .ok_or(Error::PostDecodeScratch)?;
    let (native_resources, resources_usage) = native_resources::capture_after_admission(
        &engine,
        native_resources::Limits {
            max_work: remaining_work,
            max_scratch_bytes: remaining_scratch,
        },
    )
    .map_err(Error::NativeResources)?;
    let usage = Usage {
        file_bytes: bytes.len(),
        engine_section_bytes: engine_bytes.len(),
        checksum_work_reserved,
        decode_allocation_allowance: limits.decode.allocation_work,
        // Every pass precharges and returns usage <= its incoming allowance.
        post_decode_work: world.work_units
            + VARIABLE_WORK
            + root.work as u64
            + gameplay_authoring.work
            + presentation.work
            + tilemap.work
            + data_movement.work
            + scratch.work
            + spatial.work
            + physics_output.work
            + frame.work
            + native.work as u64
            + sharing.work
            + controller.work
            + data_gameplay.work
            + runtime_observations.work
            + runtime_payload.work
            + builtin.work
            + roster_usage.work
            + resources_usage.work,
        post_decode_scratch_bytes: world.scratch_bytes
            + presentation.scratch_bytes
            + tilemap.scratch_bytes
            + data_movement.scratch_bytes
            + scratch.scratch_bytes
            + spatial.scratch_bytes
            + physics_output.scratch_bytes
            + native.scratch_bytes
            + sharing.scratch_bytes
            + controller.scratch_bytes
            + data_gameplay.scratch_bytes
            + runtime_observations.scratch_bytes
            + runtime_payload.scratch_bytes
            + builtin.scratch_bytes
            + roster_usage.scratch_bytes
            + resources_usage.scratch_bytes,
        world_nested_items: world.nested_items,
        alias_roots: sharing.roots,
        alias_compare_bytes: sharing.compare_bytes,
    };
    Ok(Candidate {
        engine,
        file,
        variables,
        usage,
        native_roster,
        native_resources,
    })
}

#[cfg(test)]
mod tests;
