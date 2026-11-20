use super::*;
use crate::tilemap::Tilemap;
fn tile(
    owner: Owner,
    t: &Tilemap,
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    let defs = t.file_resource_definitions();
    b.product(defs.len(), 4)?;
    for (i, d) in defs.iter().enumerate() {
        if let Some(d) = d {
            emit(row(
                owner,
                [index(i)?, 0, 0, 0],
                None,
                Domain::Texture,
                Role::Base,
                StoredId::U32(d.texture_id),
                0,
                None,
            ))?;
        }
    }
    Ok(())
}
pub(super) fn visit(
    e: &Engine,
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    b.work(2)?;
    for (scene, texture) in [
        (
            1,
            crate::breakout_scene::BreakoutScene::file_program_texture_id(),
        ),
        (
            2,
            crate::platformer_scene::PlatformerScene::file_program_texture_id(),
        ),
    ] {
        let mut v = row(
            Owner::BuiltinProgramTexture,
            [scene, 0, 0, 0],
            None,
            Domain::Texture,
            Role::Base,
            StoredId::U32(texture),
            0,
            None,
        );
        v.provenance = Provenance::ProgramConstant;
        emit(v)?;
    }
    tile(Owner::TileMain, &e.tilemap, b, emit)?;
    tile(Owner::TileNavigation, &e.data_scene.navigation, b, emit)?;
    tile(Owner::TileSpatialPhysics, &e.spatial_scene.physics, b, emit)?;
    b.product(e.particles.particles().len(), 4)?;
    for (i, p) in e.particles.particles().iter().enumerate() {
        emit(row(
            Owner::Particle,
            [index(i)?, 0, 0, 0],
            None,
            Domain::Texture,
            Role::Base,
            StoredId::U32(p.texture_id),
            0,
            None,
        ))?;
    }
    b.product(e.particle_presets.len(), 4)?;
    for (i, p) in e.particle_presets.iter().enumerate() {
        if let Some(p) = p {
            emit(row(
                Owner::ParticlePreset,
                [index(i)?, 0, 0, 0],
                None,
                Domain::Texture,
                Role::Base,
                StoredId::U32(p.texture_id),
                0,
                None,
            ))?;
        }
    }
    b.work(1)?;
    if let Some(id) = e.shooter_hit_particle_preset {
        emit(row(
            Owner::ShooterHitPreset,
            [0; 4],
            None,
            Domain::ParticlePreset,
            Role::Preset,
            StoredId::U32(id),
            0,
            None,
        ))?;
    }
    let sizes = e.bitmap_text.file_resource_lengths();
    b.product(sizes[0], 4)?;
    b.product(sizes[1], 6)?;
    e.bitmap_text
        .visit_file_resource_fonts(&mut |id, texture| {
            emit(row(
                Owner::BitmapFont,
                [id, 0, 0, 0],
                None,
                Domain::Texture,
                Role::Base,
                StoredId::U32(texture),
                0,
                None,
            ))
        })?;
    e.bitmap_text
        .visit_file_resource_texts(&mut |ordinal, id, font, anchor, commands| {
            let path = [index(ordinal)?, id, 0, 0];
            emit(row(
                Owner::BitmapText,
                path,
                anchor,
                Domain::Font,
                Role::Font,
                StoredId::U32(font),
                0,
                None,
            ))?;
            b.product(commands.len(), 4)?;
            for (i, c) in commands.iter().enumerate() {
                emit(row(
                    Owner::BitmapCachedCommand,
                    [path[0], id, index(i)?, 0],
                    anchor,
                    Domain::Texture,
                    Role::Base,
                    StoredId::F32Bits(c.texture_id.to_bits()),
                    0,
                    None,
                ))?;
            }
            Ok::<(), Error>(())
        })?;
    b.work(6)?;
    let (textures, sounds) = e.scenes.shooter().file_resource_catalog();
    for (i, id) in textures.into_iter().enumerate() {
        emit(row(
            Owner::ShooterTextureCatalog,
            [index(i)?, 0, 0, 0],
            None,
            Domain::Texture,
            Role::Base,
            StoredId::U32(id),
            0,
            None,
        ))?;
    }
    for (i, id) in sounds.into_iter().enumerate() {
        emit(row(
            Owner::ShooterSoundCatalog,
            [index(i)?, 0, 0, 0],
            None,
            Domain::DirectSound,
            Role::Sound,
            StoredId::U32(id),
            0,
            None,
        ))?;
    }
    let shooter = e.scenes.shooter();
    for count in shooter.file_resource_spawn_lengths() {
        b.product(count, 12)?;
    }
    shooter.visit_file_resource_spawns(&mut |queue, ordinal, branch, entity, texture, sound| {
        let path = [index(queue)?, index(ordinal)?, branch, 0];
        emit(row(
            Owner::ShooterSpawnCommand,
            path,
            entity,
            Domain::Texture,
            Role::Base,
            StoredId::U32(texture),
            0,
            None,
        ))?;
        if let Some(sound) = sound {
            emit(row(
                Owner::ShooterSpawnCommand,
                path,
                entity,
                Domain::DirectSound,
                Role::Sound,
                StoredId::U32(sound),
                0,
                Some(0),
            ))?;
        }
        Ok::<(), Error>(())
    })?;
    let combat = &e.data_scene.gameplay.combat;
    for len in combat.file_resource_catalog_lengths() {
        b.product(len, 12)?;
    }
    combat.visit_file_resource_projectiles(&mut |i, texture, animation| {
        let path = [index(i)?, 0, 0, 0];
        emit(row(
            Owner::ProjectilePrefab,
            path,
            None,
            Domain::Texture,
            Role::Base,
            StoredId::U32(texture),
            0,
            None,
        ))?;
        if let Some(a) = animation {
            clips(Owner::ProjectilePrefab, path, None, a, b, emit)?;
        }
        Ok::<(), Error>(())
    })?;
    combat.visit_file_resource_actors(&mut |i, id, prototype, billboard| {
        let path = [index(i)?, id, 0, 0];
        let entity = Some(prototype.source);
        let v = prototype.file_resource_view();
        sprite(
            Owner::ActorPrototype,
            path,
            entity,
            v.sprite,
            v.normal,
            v.surface,
            emit,
        )?;
        if let Some(caster) = v.shadow {
            shadow(Owner::ActorGroundShadow, path, entity, caster, b, emit)?;
        }
        if let Some(p) = v.playback {
            clips(Owner::ActorPrototype, path, entity, &p.clips, b, emit)?;
        }
        reactions(Owner::ActorPrototype, path, entity, v.reactions, b, emit)?;
        if let Some(v) = billboard {
            emit(row(
                Owner::ActorBillboard,
                path,
                entity,
                Domain::Texture,
                Role::Normal,
                StoredId::U32(v.material.normal_texture),
                v.material.flags,
                Some(crate::render_command::SPRITE_NORMAL_NONE),
            ))?;
        }
        Ok::<(), Error>(())
    })?;
    combat.visit_file_resource_authored(&mut |i, entity, s, r| {
        let path = [index(i)?, 0, 0, 0];
        sprite(
            Owner::AuthoredDefinition,
            path,
            Some(entity),
            s,
            None,
            None,
            emit,
        )?;
        reactions(Owner::AuthoredDefinition, path, Some(entity), r, b, emit)
    })?;
    b.work(3)?;
    if let Some(snapshot) = &e.gameplay_authoring_snapshot {
        let (entity, r) = snapshot.file_resource_reactions();
        reactions(Owner::AuthoringSnapshot, [0; 4], Some(entity), r, b, emit)?;
    }
    b.product(8, 4)?; // Before the fixed owner projection copies its pose array.
    if let Some((entity, poses)) = e.data_scene.movement_animation.file_resource_poses() {
        for (i, (clip, flags)) in poses.into_iter().enumerate() {
            emit(row(
                Owner::MovementPose,
                [index(i)?, 0, 0, 0],
                Some(entity),
                Domain::AnimationClip,
                Role::Clip,
                StoredId::U32(clip),
                flags,
                None,
            ))?;
        }
    }
    let profiles = e.impact_feedback.file_resource_profiles();
    b.product(profiles.len(), 8)?;
    for (i, (sound, preset)) in profiles.enumerate() {
        let path = [index(i)?, 0, 0, 0];
        emit(row(
            Owner::ImpactFeedback,
            path,
            None,
            Domain::DirectSound,
            Role::Sound,
            StoredId::U32(sound),
            0,
            Some(u32::MAX),
        ))?;
        emit(row(
            Owner::ImpactFeedback,
            path,
            None,
            Domain::ParticlePreset,
            Role::Preset,
            StoredId::U32(preset),
            0,
            Some(u32::MAX),
        ))?;
    }
    if let Some((_, _, _, count)) = e.authoring_continuity.file_roster_header() {
        b.product(count, 6)?;
        e.authoring_continuity
            .visit_file_roster_instances(&mut |i, animation, lod| {
                let path = [index(i)?, 0, 0, 0];
                if let Some(p) = animation {
                    clips(Owner::ContinuityClip, path, None, &p.clips, b, emit)?;
                }
                if let Some(l) = lod {
                    let levels = l.file_roster_levels();
                    b.product(levels.len(), 4)?;
                    for (j, id) in levels.enumerate() {
                        emit(row(
                            Owner::ContinuityModel,
                            [path[0], 0, index(j)?, 0],
                            None,
                            Domain::Model,
                            Role::Model,
                            StoredId::U32(id),
                            0,
                            None,
                        ))?;
                    }
                }
                Ok::<(), Error>(())
            })?;
    }
    Ok(())
}
