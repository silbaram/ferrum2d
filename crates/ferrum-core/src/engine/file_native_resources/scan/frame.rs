use super::*;
use crate::render_command::{
    SpriteNormalMaterial, SpriteRenderCommand, SpriteSurfaceMaterial, SPRITE_NORMAL_NONE,
    SPRITE_SURFACE_TEXTURE_NONE,
};
fn command(
    owner: Owner,
    path: [u32; 4],
    c: &SpriteRenderCommand,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    emit(row(
        owner,
        path,
        None,
        Domain::Texture,
        Role::Base,
        StoredId::F32Bits(c.texture_id.to_bits()),
        c.effect_flags.to_bits(),
        None,
    ))
}
fn normal(
    owner: Owner,
    path: [u32; 4],
    v: SpriteNormalMaterial,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    emit(row(
        owner,
        path,
        None,
        Domain::Texture,
        Role::Normal,
        StoredId::U32(v.normal_texture),
        v.flags,
        Some(SPRITE_NORMAL_NONE),
    ))
}
fn surface(
    owner: Owner,
    path: [u32; 4],
    v: SpriteSurfaceMaterial,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    for (role, id) in [
        (Role::Emission, v.emission_texture),
        (Role::Specular, v.specular_texture),
        (Role::Roughness, v.roughness_texture),
    ] {
        emit(row(
            owner,
            path,
            None,
            Domain::Texture,
            role,
            StoredId::U32(id),
            v.flags,
            Some(SPRITE_SURFACE_TEXTURE_NONE),
        ))?;
    }
    Ok(())
}
pub(super) fn visit(
    e: &Engine,
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    let f = &e.frame_buffers;
    b.product(f.render_commands.len(), 4)?;
    for (i, v) in f.render_commands.iter().enumerate() {
        command(Owner::FrameCommand, [index(i)?, 0, 0, 0], v, emit)?;
    }
    b.product(f.render_items.len(), 20)?;
    for (i, v) in f.render_items.iter().enumerate() {
        let p = [index(i)?, 0, 0, 0];
        command(Owner::FrameItem, p, &v.command, emit)?;
        normal(Owner::FrameItem, p, v.normal_material, emit)?;
        surface(Owner::FrameItem, p, v.surface_material, emit)?;
    }
    b.product(f.sprite_normal_materials.len(), 4)?;
    for (i, v) in f.sprite_normal_materials.iter().enumerate() {
        normal(Owner::FrameNormal, [index(i)?, 0, 0, 0], *v, emit)?;
    }
    b.product(f.sprite_surface_materials.len(), 12)?;
    for (i, v) in f.sprite_surface_materials.iter().enumerate() {
        surface(Owner::FrameSurface, [index(i)?, 0, 0, 0], *v, emit)?;
    }
    b.product(f.audio_events.len(), 4)?;
    for (i, v) in f.audio_events.iter().enumerate() {
        emit(row(
            Owner::FrameAudio,
            [index(i)?, 0, 0, 0],
            None,
            Domain::DirectSound,
            Role::Sound,
            StoredId::F32Bits(v.sound_id.to_bits()),
            v.channel_id.to_bits(),
            None,
        ))?;
    }
    b.product(f.effect_events.len(), 8)?;
    for (i, v) in f.effect_events.iter().enumerate() {
        emit(row(
            Owner::FrameEffect,
            [index(i)?, v.source_id, v.source_generation, 0],
            Some(Entity {
                id: v.actor_id,
                generation: v.actor_generation,
            }),
            Domain::PresentationEffect {
                effect_type: v.effect_type,
            },
            Role::Effect,
            StoredId::U32(v.effect_id),
            0,
            None,
        ))?;
    }
    b.product(f.gameplay_events.len(), 8)?;
    for (i, v) in f.gameplay_events.iter().enumerate() {
        if matches!(
            v.kind,
            crate::gameplay_event::GAMEPLAY_EVENT_SPRITE_ANIMATION_FRAME
                | crate::gameplay_event::GAMEPLAY_EVENT_SPRITE_ANIMATION_COMPLETED
        ) {
            emit(row(
                Owner::FrameGameplayClip,
                [index(i)?, v.source_id, v.source_generation, 0],
                Some(Entity {
                    id: v.actor_id,
                    generation: v.actor_generation,
                }),
                Domain::AnimationClip,
                Role::Clip,
                StoredId::U32(v.token_id),
                v.flags,
                None,
            ))?;
        }
        if v.kind == crate::gameplay_event::GAMEPLAY_EVENT_PRESENTATION_EFFECT {
            emit(row(
                Owner::FrameGameplayEffect,
                [index(i)?, v.source_id, v.source_generation, 0],
                Some(Entity {
                    id: v.actor_id,
                    generation: v.actor_generation,
                }),
                Domain::PresentationEffect {
                    effect_type: v.payload_bits,
                },
                Role::Effect,
                StoredId::U32(v.token_id),
                v.flags,
                None,
            ))?;
        }
    }
    Ok(())
}
