use super::*;
use crate::spatial_scene::SpatialVertex;
fn vertices(
    kind: u32,
    v: &[SpatialVertex],
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    b.product(v.len(), 4)?;
    for (i, v) in v.iter().enumerate() {
        emit(row(
            Owner::SpatialVertex,
            [kind, index(i)?, 0, 0],
            None,
            Domain::Texture,
            Role::Base,
            StoredId::F32Bits(v.texture.to_bits()),
            0,
            Some(crate::render_command::SPRITE_NORMAL_NONE),
        ))?;
    }
    Ok(())
}
fn quads(
    kind: u32,
    v: &[[SpatialVertex; 6]],
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    b.product(v.len(), 24)?;
    for (i, q) in v.iter().enumerate() {
        for (j, v) in q.iter().enumerate() {
            emit(row(
                Owner::SpatialVertex,
                [kind, index(i)?, index(j)?, 0],
                None,
                Domain::Texture,
                Role::Base,
                StoredId::F32Bits(v.texture.to_bits()),
                0,
                Some(crate::render_command::SPRITE_NORMAL_NONE),
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
    let s = &e.spatial_scene;
    b.product(s.surfaces.len(), 4)?;
    for (i, v) in s.surfaces.iter().enumerate() {
        emit(row(
            Owner::SpatialSurface,
            [index(i)?, v.id, 0, 0],
            None,
            Domain::Texture,
            Role::Base,
            StoredId::U32(v.texture),
            v.kind | (u32::from(v.is_rendered) << 31) | (u32::from(v.walkable) << 30),
            None,
        ))?;
    }
    vertices(0, &s.terrain, b, emit)?;
    vertices(1, &s.billboards, b, emit)?;
    vertices(2, &s.debug.vertices, b, emit)?;
    quads(3, &s.shadow_casters, b, emit)?;
    let (previous, scratch) = s.file_resource_hidden_vertex_views();
    quads(4, previous, b, emit)?;
    vertices(5, scratch, b, emit)?;
    for (kind, materials) in [(0, &s.terrain_materials), (1, &s.billboard_materials)] {
        b.product(materials.len(), 4)?;
        for (i, v) in materials.iter().enumerate() {
            emit(row(
                Owner::SpatialNormal,
                [kind, index(i)?, 0, 0],
                None,
                Domain::Texture,
                Role::Normal,
                StoredId::U32(v.normal_texture),
                v.flags,
                Some(crate::render_command::SPRITE_NORMAL_NONE),
            ))?;
        }
    }
    b.product(s.bindings.len(), 4)?;
    for (&(id, generation), v) in &s.bindings {
        emit(row(
            Owner::SpatialBillboard,
            [id, generation, 0, 0],
            Some(Entity { id, generation }),
            Domain::Texture,
            Role::Normal,
            StoredId::U32(v.material.normal_texture),
            v.material.flags,
            Some(crate::render_command::SPRITE_NORMAL_NONE),
        ))?;
    }
    b.product(s.runtime_billboards.len(), 4)?;
    for (i, (entity, v)) in s.runtime_billboards.iter().enumerate() {
        emit(row(
            Owner::SpatialRuntimeBillboard,
            [index(i)?, 0, 0, 0],
            Some(*entity),
            Domain::Texture,
            Role::Normal,
            StoredId::U32(v.material.normal_texture),
            v.material.flags,
            Some(crate::render_command::SPRITE_NORMAL_NONE),
        ))?;
    }
    let models = &s.models;
    b.product(models.bindings.len(), 4)?;
    for (&(id, generation), v) in &models.bindings {
        emit(row(
            Owner::ModelBinding,
            [id, generation, 0, 0],
            Some(Entity { id, generation }),
            Domain::Model,
            Role::Model,
            StoredId::U32(v.asset),
            v.flags,
            None,
        ))?;
    }
    b.product(models.file_roster_policy_count(), 4)?;
    models.visit_file_roster_lods(&mut |(id, generation), count, value| {
        if let Some((ordinal, asset)) = value {
            emit(row(
                Owner::ModelLod,
                [id, generation, index(ordinal)?, 0],
                Some(Entity { id, generation }),
                Domain::Model,
                Role::Model,
                StoredId::U32(asset),
                0,
                None,
            ))?;
        } else {
            b.product(count, 4)?;
        }
        Ok::<(), Error>(())
    })?;
    let draws = models.file_resource_draws();
    b.product(draws.len(), 4)?;
    for (i, (asset, flags)) in draws.enumerate() {
        emit(row(
            Owner::ModelDraw,
            [index(i)?, 0, 0, 0],
            None,
            Domain::Model,
            Role::Model,
            StoredId::U32(asset),
            flags,
            None,
        ))?;
    }
    Ok(())
}
