use super::{Error, NativeFilePrepare};
use crate::engine::{file_native_resources as resources, file_native_roster as roster};
use crate::gameplay_variables::{GameplayVariableScope, GameplayVariableType};
const STRIDES: [usize; 14] = [20, 20, 8, 32, 16, 20, 20, 20, 16, 20, 12, 12, 68, 136];
#[derive(Clone, Copy, Debug)]
pub(super) struct Plan {
    pub bytes: usize,
    counts: [usize; 14],
    offsets: [usize; 14],
}
impl Plan {
    pub fn empty() -> Self {
        Self {
            bytes: 0,
            counts: [0; 14],
            offsets: [0; 14],
        }
    }
    pub fn new(value: &NativeFilePrepare) -> Result<Self, Error> {
        let r = &value.parts.native_roster;
        let counts = [
            1,
            value.parts.variables.iter().flatten().count(),
            r.slots.len(),
            r.live_entities.len(),
            r.textures.len(),
            r.clips.len(),
            r.models.len(),
            r.bodies.len(),
            usize::from(r.continuity.is_some()),
            r.continuity_instances.len(),
            r.continuity_clips.len(),
            r.continuity_models.len(),
            value.parts.native_resources.references.len(),
            1,
        ];
        let mut offsets = [0; 14];
        let mut bytes = 16usize + 14 * 16;
        for (i, (&count, &stride)) in counts.iter().zip(&STRIDES).enumerate() {
            u32::try_from(count).map_err(|_| Error::Overflow)?;
            offsets[i] = bytes;
            bytes = bytes
                .checked_add(count.checked_mul(stride).ok_or(Error::Overflow)?)
                .ok_or(Error::Overflow)?;
        }
        u32::try_from(bytes).map_err(|_| Error::Overflow)?;
        if bytes > value.limits.max_metadata_bytes {
            return Err(Error::Output);
        }
        Ok(Self {
            bytes,
            counts,
            offsets,
        })
    }
}
struct Writer {
    bytes: Vec<u8>,
    at: usize,
}
impl Writer {
    fn new(length: usize) -> Result<Self, Error> {
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(length)
            .map_err(|_| Error::Allocation)?;
        bytes.resize(length, 0);
        Ok(Self { bytes, at: 0 })
    }
    fn raw(&mut self, bytes: &[u8]) -> Result<(), Error> {
        let end = self.at.checked_add(bytes.len()).ok_or(Error::Overflow)?;
        self.bytes
            .get_mut(self.at..end)
            .ok_or(Error::Overflow)?
            .copy_from_slice(bytes);
        self.at = end;
        Ok(())
    }
    fn u32(&mut self, value: u32) -> Result<(), Error> {
        self.raw(&value.to_le_bytes())
    }
    fn u64(&mut self, value: u64) -> Result<(), Error> {
        self.raw(&value.to_le_bytes())
    }
    fn words(&mut self, words: &[u32]) -> Result<(), Error> {
        for &word in words {
            self.u32(word)?;
        }
        Ok(())
    }
}
pub(super) fn encode(value: &NativeFilePrepare) -> Result<Vec<u8>, Error> {
    let mut w = Writer::new(value.plan.bytes)?;
    w.words(&[0x3150_464e, 1, value.plan.bytes as u32, 14])?;
    for (i, ((&count, &offset), &stride)) in value
        .plan
        .counts
        .iter()
        .zip(&value.plan.offsets)
        .zip(&STRIDES)
        .enumerate()
    {
        w.words(&[i as u32 + 1, stride as u32, count as u32, offset as u32])?;
    }
    let r = &value.parts.native_roster;
    w.words(&[
        match r.context.scene {
            roster::Scene::BuiltIn => 0,
            roster::Scene::Data => 1,
        },
        r.context.stored_data_epoch,
        r.context.spatial_revision,
        value
            .parts
            .engine
            .as_ref()
            .ok_or(Error::Consumed)?
            .spatial_configuration_revision(),
        value
            .parts
            .engine
            .as_ref()
            .ok_or(Error::Consumed)?
            .data_scene_epoch(),
    ])?;
    for v in value.parts.variables.iter().flatten() {
        w.words(&[
            v.slot,
            match v.variable_type {
                GameplayVariableType::Integer => 0,
                GameplayVariableType::Real => 1,
                GameplayVariableType::Bool => 2,
            },
            match v.scope {
                GameplayVariableScope::Global => 0,
                GameplayVariableScope::Scene => 1,
            },
        ])?;
        w.u64(v.default_value.to_bits())?;
    }
    for v in &r.slots {
        w.words(&[v.generation, u32::from(v.alive)])?;
    }
    for v in &r.live_entities {
        w.words(&[
            v.handle.id,
            v.handle.generation,
            v.progress_flags,
            u32::from(v.sprite_present),
            u32::from(v.sprite_projection_flags.is_some()),
            v.sprite_projection_flags.unwrap_or(0),
            u32::from(v.legacy_animation_present),
            u32::from(v.playback_present),
        ])?;
    }
    for v in &r.textures {
        w.words(&[
            v.handle.id,
            v.handle.generation,
            match v.role {
                roster::TextureRole::Sprite => 0,
                roster::TextureRole::Normal => 1,
                roster::TextureRole::Emission => 2,
                roster::TextureRole::Specular => 3,
                roster::TextureRole::Roughness => 4,
            },
            v.id,
        ])?;
    }
    for v in &r.clips {
        w.words(&[
            v.handle.id,
            v.handle.generation,
            v.ordinal,
            v.id,
            u32::from(v.active),
        ])?;
    }
    for v in &r.models {
        let (role, param) = match v.role {
            roster::ModelRole::Base { flags } => (0, flags),
            roster::ModelRole::Lod(index) => (1, index),
        };
        w.words(&[v.handle.id, v.handle.generation, role, param, v.asset])?;
    }
    for v in &r.bodies {
        w.words(&[
            v.handle.id,
            v.handle.generation,
            v.body.slot,
            v.body.generation,
            u32::from(v.legacy),
        ])?;
    }
    if let Some(v) = r.continuity {
        w.words(&[v.serial, v.token, v.epoch, v.instance_count])?;
    }
    for v in &r.continuity_instances {
        w.words(&[
            v.ordinal,
            u32::from(v.active_clip.is_some()),
            v.active_clip.unwrap_or(0),
            u32::from(v.selected_lod.is_some()),
            v.selected_lod.unwrap_or(0),
        ])?;
    }
    for rows in [&r.continuity_clips, &r.continuity_models] {
        for v in rows {
            w.words(&[v.instance_ordinal, v.reference_ordinal, v.id])?;
        }
    }
    for v in &value.parts.native_resources.references {
        let (domain, param) = match v.domain {
            resources::Domain::Texture => (0, 0),
            resources::Domain::Model => (1, 0),
            resources::Domain::Font => (2, 0),
            resources::Domain::DirectSound => (3, 0),
            resources::Domain::ParticlePreset => (4, 0),
            resources::Domain::PresentationEffect { effect_type } => (5, effect_type),
            resources::Domain::AnimationClip => (6, 0),
        };
        let (tag, bits) = match v.value {
            resources::StoredId::U32(bits) => (0, bits),
            resources::StoredId::F32Bits(bits) => (1, bits),
        };
        let entity = v.entity.unwrap_or(crate::entity::Entity {
            id: 0,
            generation: 0,
        });
        w.words(&[
            owner(v.owner),
            match v.provenance {
                resources::Provenance::StoredField => 0,
                resources::Provenance::ProgramConstant => 1,
            },
            v.path[0],
            v.path[1],
            v.path[2],
            v.path[3],
            u32::from(v.entity.is_some()),
            entity.id,
            entity.generation,
            domain,
            param,
            role(v.role),
            tag,
            bits,
            v.flags,
            u32::from(v.absence_sentinel.is_some()),
            v.absence_sentinel.unwrap_or(0),
        ])?;
    }
    let u = value.parts.usage;
    for v in [
        u.file_bytes as u64,
        u.engine_section_bytes as u64,
        u.checksum_work_reserved as u64,
        u.decode_allocation_allowance as u64,
        u.post_decode_work,
        u.post_decode_scratch_bytes as u64,
        u.world_nested_items as u64,
        u.alias_roots as u64,
        u.alias_compare_bytes as u64,
        value.output.work,
        value.output.scratch as u64,
        value.output.bytes as u64,
        value.limits.native.max_post_decode_work,
        value.limits.native.max_post_decode_scratch_bytes as u64,
        value.limits.max_output_bytes as u64,
        value.limits.max_metadata_bytes as u64,
        value.file.capacity() as u64,
    ] {
        w.u64(v)?;
    }
    if w.at != value.plan.bytes {
        return Err(Error::Overflow);
    }
    Ok(w.bytes)
}

fn owner(value: resources::Owner) -> u32 {
    match value {
        resources::Owner::BuiltinProgramTexture => 0,
        resources::Owner::WorldSprite => 1,
        resources::Owner::WorldGroundShadow => 2,
        resources::Owner::ActorGroundShadow => 3,
        resources::Owner::WorldPlayback => 4,
        resources::Owner::WorldReaction => 5,
        resources::Owner::ProjectilePrefab => 6,
        resources::Owner::ActorPrototype => 7,
        resources::Owner::ActorBillboard => 8,
        resources::Owner::AuthoredDefinition => 9,
        resources::Owner::AuthoringSnapshot => 10,
        resources::Owner::MovementPose => 11,
        resources::Owner::ContinuityClip => 12,
        resources::Owner::ContinuityModel => 13,
        resources::Owner::TileMain => 14,
        resources::Owner::TileNavigation => 15,
        resources::Owner::TileSpatialPhysics => 16,
        resources::Owner::Particle => 17,
        resources::Owner::ParticlePreset => 18,
        resources::Owner::ShooterHitPreset => 19,
        resources::Owner::BitmapFont => 20,
        resources::Owner::BitmapText => 21,
        resources::Owner::BitmapCachedCommand => 22,
        resources::Owner::ShooterTextureCatalog => 23,
        resources::Owner::ShooterSpawnCommand => 24,
        resources::Owner::ShooterSoundCatalog => 25,
        resources::Owner::SpatialSurface => 26,
        resources::Owner::SpatialVertex => 27,
        resources::Owner::SpatialNormal => 28,
        resources::Owner::SpatialBillboard => 29,
        resources::Owner::SpatialRuntimeBillboard => 30,
        resources::Owner::ModelBinding => 31,
        resources::Owner::ModelLod => 32,
        resources::Owner::ModelDraw => 33,
        resources::Owner::ImpactFeedback => 34,
        resources::Owner::FrameCommand => 35,
        resources::Owner::FrameItem => 36,
        resources::Owner::FrameNormal => 37,
        resources::Owner::FrameSurface => 38,
        resources::Owner::FrameAudio => 39,
        resources::Owner::FrameEffect => 40,
        resources::Owner::FrameGameplayEffect => 41,
        resources::Owner::FrameGameplayClip => 42,
    }
}

fn role(value: resources::Role) -> u32 {
    match value {
        resources::Role::Base => 0,
        resources::Role::Normal => 1,
        resources::Role::Emission => 2,
        resources::Role::Specular => 3,
        resources::Role::Roughness => 4,
        resources::Role::Clip => 5,
        resources::Role::Sound => 6,
        resources::Role::Preset => 7,
        resources::Role::Effect => 8,
        resources::Role::Font => 9,
        resources::Role::Model => 10,
    }
}
