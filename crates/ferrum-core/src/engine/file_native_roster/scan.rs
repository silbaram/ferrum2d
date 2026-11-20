use super::*;
use crate::render_command::{SPRITE_NORMAL_NONE, SPRITE_SURFACE_TEXTURE_NONE};

pub(super) fn visit(
    engine: &Engine,
    variables: &Layout,
    b: &mut Budget,
    emit: &mut impl FnMut(Fact) -> Result<(), Error>,
) -> Result<(), Error> {
    b.product(64, 4)?;
    for entry in variables.iter().flatten() {
        emit(Fact::Variable(Variable {
            slot: entry.slot,
            variable_type: entry.variable_type,
            scope: entry.scope,
            default_value: entry.default_value,
        }))?;
    }
    let world = &engine.world;
    let slots = world.entity_capacity();
    b.product(slots, 4)?;
    for i in 0..slots {
        let generation = world.generation_at_index(i).ok_or(Error::Invalid {
            owner: "native_roster",
            field: "slot_generation",
            index: i,
            problem: Problem::Reference,
        })?;
        let alive = world.is_alive_index(i);
        emit(Fact::Slot(Slot { generation, alive }))?;
        if !alive {
            continue;
        }
        b.work(40)?;
        let handle = Entity {
            id: u32_count(i)?,
            generation,
        };
        let rigid = world.rigid_body(handle);
        let collider = (world.compound_collider_count_at(i) == 1)
            .then(|| world.compound_collider_ref_at(i, 0))
            .flatten();
        let consumed = world
            .interaction_at_index(i)
            .is_some_and(|v| v.once && v.consumed);
        let progress_flags = 1
            | (u32::from(consumed) << 1)
            | (u32::from(rigid.is_some()) << 2)
            | (u32::from(rigid.is_some_and(|v| v.enabled)) << 3)
            | (u32::from(collider.is_some()) << 4)
            | (u32::from(collider.is_some_and(|v| v.enabled())) << 5);
        let playback = world.sprite_playbacks.get(i).and_then(Option::as_ref);
        let sprite = world.sprites.get(i).and_then(Option::as_ref);
        emit(Fact::Entity(LiveEntity {
            handle,
            progress_flags,
            sprite_present: sprite.is_some(),
            sprite_projection_flags: sprite
                .map(|s| u32::from(s.depth_sort) | (u32::from(s.project_ground) << 1)),
            legacy_animation_present: world.sprite_animations.get(i).is_some_and(Option::is_some),
            playback_present: playback.is_some(),
        }))?;
        if let Some(sprite) = sprite {
            emit(Fact::Texture(Texture {
                handle,
                role: TextureRole::Sprite,
                id: sprite.texture_id,
            }))?;
        }
        if let Some(v) = world
            .sprite_normal_materials
            .get(i)
            .and_then(Option::as_ref)
        {
            if v.normal_texture != SPRITE_NORMAL_NONE {
                emit(Fact::Texture(Texture {
                    handle,
                    role: TextureRole::Normal,
                    id: v.normal_texture,
                }))?;
            }
        }
        if let Some(v) = world
            .sprite_surface_materials
            .get(i)
            .and_then(Option::as_ref)
        {
            for (role, id) in [
                (TextureRole::Emission, v.emission_texture),
                (TextureRole::Specular, v.specular_texture),
                (TextureRole::Roughness, v.roughness_texture),
            ] {
                if id != SPRITE_SURFACE_TEXTURE_NONE {
                    emit(Fact::Texture(Texture { handle, role, id }))?;
                }
            }
        }
        if let Some(p) = playback {
            b.product(p.clips.len(), 4)?;
            for (j, c) in p.clips.iter().enumerate() {
                emit(Fact::Clip(Clip {
                    handle,
                    ordinal: u32_count(j)?,
                    id: c.id,
                    active: p.active == j,
                }))?;
            }
        }
    }
    let models = &engine.spatial_scene.models;
    b.product(models.bindings.len(), 4)?;
    for (&(id, generation), model) in &models.bindings {
        emit(Fact::Model(Model {
            handle: Entity { id, generation },
            role: ModelRole::Base { flags: model.flags },
            asset: model.asset,
        }))?;
    }
    b.product(models.file_roster_policy_count(), 3)?;
    models.visit_file_roster_lods(&mut |(id, generation), count, value| {
        if let Some((ordinal, asset)) = value {
            emit(Fact::Model(Model {
                handle: Entity { id, generation },
                role: ModelRole::Lod(u32_count(ordinal)?),
                asset,
            }))?;
        } else {
            b.product(count, 5)?;
        }
        Ok::<(), Error>(())
    })?;
    if let Some(runtime) = &engine.unified_physics {
        b.product(runtime.file_roster_binding_count(), 5)?;
        runtime.visit_file_roster_bindings(&mut |handle, body, legacy| {
            emit(Fact::Body(BodyBinding {
                handle,
                body,
                legacy,
            }))
        })?;
    }
    if let Some((serial, token, epoch, count)) = engine.authoring_continuity.file_roster_header() {
        b.work(4)?;
        b.product(count, 6)?;
        emit(Fact::Continuity(Continuity {
            serial,
            token,
            epoch,
            instance_count: u32_count(count)?,
        }))?;
        engine
            .authoring_continuity
            .visit_file_roster_instances(&mut |index, animation, lod| {
                let ordinal = u32_count(index)?;
                emit(Fact::ContinuityInstance(ContinuityInstance {
                    ordinal,
                    active_clip: animation.map(|p| u32_count(p.active)).transpose()?,
                    selected_lod: lod
                        .map(|l| u32_count(l.file_roster_selected()))
                        .transpose()?,
                }))?;
                if let Some(p) = animation {
                    b.product(p.clips.len(), 4)?;
                    for (j, c) in p.clips.iter().enumerate() {
                        emit(Fact::ContinuityClip(ContinuityReference {
                            instance_ordinal: ordinal,
                            reference_ordinal: u32_count(j)?,
                            id: c.id,
                        }))?;
                    }
                }
                if let Some(lod) = lod {
                    let levels = lod.file_roster_levels();
                    b.product(levels.len(), 4)?;
                    for (j, id) in levels.enumerate() {
                        emit(Fact::ContinuityModel(ContinuityReference {
                            instance_ordinal: ordinal,
                            reference_ordinal: u32_count(j)?,
                            id,
                        }))?;
                    }
                }
                Ok::<(), Error>(())
            })?;
    }
    Ok(())
}
