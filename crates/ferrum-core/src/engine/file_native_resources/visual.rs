use super::*;
use crate::components::{
    gameplay::{CollisionReaction, CollisionReactionSet, MAX_COLLISION_REACTIONS_PER_ENTITY},
    Sprite,
};
use crate::render_command::{
    SpriteNormalMaterial, SpriteSurfaceMaterial, SPRITE_NORMAL_NONE, SPRITE_SURFACE_TEXTURE_NONE,
};
use crate::world::sprite_playback::SpriteClip;

#[allow(clippy::too_many_arguments)] // Borrowed visual fields from the same owner cut.
pub(super) fn sprite(
    owner: Owner,
    path: [u32; 4],
    entity: Option<Entity>,
    sprite: Option<Sprite>,
    normal: Option<SpriteNormalMaterial>,
    surface: Option<SpriteSurfaceMaterial>,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    if let Some(s) = sprite {
        emit(row(
            owner,
            path,
            entity,
            Domain::Texture,
            Role::Base,
            StoredId::U32(s.texture_id),
            u32::from(s.depth_sort) | (u32::from(s.project_ground) << 1),
            None,
        ))?;
    }
    if let Some(n) = normal {
        emit(row(
            owner,
            path,
            entity,
            Domain::Texture,
            Role::Normal,
            StoredId::U32(n.normal_texture),
            n.flags,
            Some(SPRITE_NORMAL_NONE),
        ))?;
    }
    if let Some(s) = surface {
        for (role, id) in [
            (Role::Emission, s.emission_texture),
            (Role::Specular, s.specular_texture),
            (Role::Roughness, s.roughness_texture),
        ] {
            emit(row(
                owner,
                path,
                entity,
                Domain::Texture,
                role,
                StoredId::U32(id),
                s.flags,
                Some(SPRITE_SURFACE_TEXTURE_NONE),
            ))?;
        }
    }
    Ok(())
}
pub(super) fn clips(
    owner: Owner,
    mut path: [u32; 4],
    entity: Option<Entity>,
    clips: &[SpriteClip],
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    b.product(clips.len(), 4)?;
    for (i, c) in clips.iter().enumerate() {
        path[3] = index(i)?;
        emit(row(
            owner,
            path,
            entity,
            Domain::AnimationClip,
            Role::Clip,
            StoredId::U32(c.id),
            u32::from(c.emit_events) | (u32::from(c.looping) << 1),
            None,
        ))?;
    }
    Ok(())
}
pub(super) fn reactions(
    owner: Owner,
    mut path: [u32; 4],
    entity: Option<Entity>,
    set: Option<&CollisionReactionSet>,
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    let Some(set) = set else { return Ok(()) };
    // The owner is a prevalidated fixed backing array, not an untrusted len getter.
    b.product(MAX_COLLISION_REACTIONS_PER_ENTITY, 8)?;
    for (i, r) in set.checkpoint_reactions().enumerate() {
        path[3] = index(i)?;
        let (domain, role, id, flags) = match r {
            CollisionReaction::PlaySound {
                sound_id,
                replace_default,
                trigger,
                ..
            } => (
                Domain::DirectSound,
                Role::Sound,
                sound_id,
                u32::from(replace_default)
                    | (u32::from(matches!(
                        trigger,
                        crate::components::gameplay::CollisionReactionTrigger::Enter
                    )) << 1),
            ),
            CollisionReaction::SpawnParticle {
                preset_id,
                replace_default,
                trigger,
                ..
            } => (
                Domain::ParticlePreset,
                Role::Preset,
                preset_id,
                u32::from(replace_default)
                    | (u32::from(matches!(
                        trigger,
                        crate::components::gameplay::CollisionReactionTrigger::Enter
                    )) << 1),
            ),
            CollisionReaction::EmitEffect {
                effect_id,
                effect_type,
                trigger,
                ..
            } => (
                Domain::PresentationEffect { effect_type },
                Role::Effect,
                effect_id,
                u32::from(matches!(
                    trigger,
                    crate::components::gameplay::CollisionReactionTrigger::Enter
                )),
            ),
            CollisionReaction::Damage { .. }
            | CollisionReaction::AreaDamage { .. }
            | CollisionReaction::Knockback { .. }
            | CollisionReaction::Pickup { .. }
            | CollisionReaction::Despawn { .. }
            | CollisionReaction::CameraShake { .. }
            | CollisionReaction::SpawnPrefab { .. } => continue,
        };
        emit(row(
            owner,
            path,
            entity,
            domain,
            role,
            StoredId::U32(id),
            flags,
            None,
        ))?;
    }
    Ok(())
}
pub(super) fn shadow(
    owner: Owner,
    path: [u32; 4],
    entity: Option<Entity>,
    caster: &crate::world::ground_shadow::GroundShadowCaster,
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    b.work(4)?;
    if let Some((texture, shader_mode)) = caster.file_resource_cache() {
        emit(row(
            owner,
            path,
            entity,
            Domain::Texture,
            Role::Base,
            StoredId::F32Bits(texture),
            shader_mode,
            None,
        ))?;
    }
    if let Some(texture) = caster.file_program_texture() {
        let mut v = row(
            owner,
            path,
            entity,
            Domain::Texture,
            Role::Base,
            StoredId::U32(texture),
            0,
            None,
        );
        v.provenance = Provenance::ProgramConstant;
        emit(v)?;
    }
    Ok(())
}
