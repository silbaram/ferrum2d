//! Cold validation of persisted frame output, including the overflow index that
//! is dereferenced by the next animation update. This never rebuilds a frame.
//! Historical entity/resource IDs are not required to be live. Asset resolution,
//! complete output provenance and other Engine caches are separate obligations.
use super::{audio_poses::MAX_AUDIO_POSES, frame_buffers::EngineFrameBuffers};
use crate::render_command::{
    SpriteLightMasks, SpriteLightingMaterial, SpriteNormalMaterial, SpriteRenderCommand,
    SpriteSurfaceMaterial, SPRITE_NORMAL_NONE, SPRITE_SURFACE_TEXTURE_NONE,
};
use std::fmt;

#[derive(Clone, Copy, Debug)]
pub(super) struct Limits {
    pub max_work: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Usage {
    pub work: u64,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Error {
    WorkLimit,
    Invalid { field: &'static str, index: usize },
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "saved frame output rejected: {self:?}")
    }
}
impl std::error::Error for Error {}

fn require(valid: bool, field: &'static str, index: usize) -> Result<(), Error> {
    if valid {
        Ok(())
    } else {
        Err(Error::Invalid { field, index })
    }
}
fn finite(values: &[f32]) -> bool {
    values.iter().all(|v| v.is_finite())
}
fn command(v: &SpriteRenderCommand) -> bool {
    let SpriteRenderCommand {
        x,
        y,
        width,
        height,
        u0,
        v0,
        u1,
        v1,
        r,
        g,
        b,
        a,
        texture_id,
        effect_flags,
        rotation_radians,
    } = *v;
    // Raw signed dimensions/UVs/HDR remain producer values. This is not an
    // assertion that resource IDs are registered in a platform asset table.
    finite(&[
        x,
        y,
        width,
        height,
        u0,
        v0,
        u1,
        v1,
        r,
        g,
        b,
        a,
        texture_id,
        effect_flags,
        rotation_radians,
    ])
}
fn normal(v: SpriteNormalMaterial) -> bool {
    let SpriteNormalMaterial {
        normal_texture,
        flags,
    } = v;
    flags == 0 && normal_texture <= SPRITE_NORMAL_NONE
}
fn lighting(v: SpriteLightingMaterial) -> bool {
    let SpriteLightingMaterial { mode, alpha_cutoff } = v;
    mode <= 2
        && alpha_cutoff.is_finite()
        && (0.0..=1.).contains(&alpha_cutoff)
        && (mode == 2 || alpha_cutoff == 0.)
}
fn surface(v: SpriteSurfaceMaterial) -> bool {
    let SpriteSurfaceMaterial {
        emission_texture,
        specular_texture,
        roughness_texture,
        flags,
        emission,
        specular,
        roughness,
        reserved,
    } = v;
    flags <= 1
        && reserved == 0
        && [emission_texture, specular_texture, roughness_texture]
            .iter()
            .all(|id| *id <= SPRITE_SURFACE_TEXTURE_NONE)
        && emission
            .iter()
            .all(|v| v.is_finite() && (0.0..=64.).contains(v))
        && specular.is_finite()
        && (0.0..=1.).contains(&specular)
        && roughness.is_finite()
        && (0.0..=1.).contains(&roughness)
        && (flags != 0 || v == SpriteSurfaceMaterial::default())
}
fn masks(v: SpriteLightMasks) -> bool {
    let SpriteLightMasks {
        light_mask,
        shadow_mask,
    } = v;
    light_mask <= 255 && shadow_mask <= 255
}
fn line(v: &crate::collision::PhysicsDebugLine) -> bool {
    let crate::collision::PhysicsDebugLine {
        x0,
        y0,
        x1,
        y1,
        r,
        g,
        b,
        a,
    } = *v;
    finite(&[x0, y0, x1, y1, r, g, b, a])
}

pub(super) fn validate(b: &EngineFrameBuffers, limits: Limits) -> Result<Usage, Error> {
    // Exhaustive owner field list makes a newly persisted output an explicit
    // review obligation. No hidden backing/capacity is traversed here.
    let EngineFrameBuffers {
        contact_impacts,
        contact_impacts_dropped: _,
        render_commands,
        sprite_normal_materials,
        sprite_lighting_materials,
        sprite_surface_materials,
        sprite_light_masks,
        render_items,
        ground_shadow_projection,
        ground_y_scale,
        ground_shadow_volumes,
        ground_shadow_volume_casters,
        audio_poses,
        audio_events,
        effect_events,
        collision_events,
        gameplay_events,
        animation_event_overflow,
        frame_telemetry,
        physics_debug_lines,
        native_debug_state: _,
        tilemap_navigation_path_points,
        tilemap_navigation_debug_lines,
    } = b;
    // Precharge all scalar visits before scanning any vector. There is no heap
    // scratch and no per-element clone/serialization in this pass.
    let mut work = 256u64;
    for (count, cost) in [
        (contact_impacts.len(), 16),
        (render_commands.len(), 32),
        (sprite_normal_materials.len(), 4),
        (sprite_lighting_materials.len(), 8),
        (sprite_surface_materials.len(), 32),
        (sprite_light_masks.len(), 4),
        (render_items.len(), 128),
        (ground_shadow_volumes.len(), 8),
        (audio_poses.len(), 16),
        (audio_events.len(), 8),
        (effect_events.len(), 16),
        (collision_events.len(), 8),
        (gameplay_events.len(), 8),
        (physics_debug_lines.len(), 16),
        (tilemap_navigation_path_points.len(), 2),
        (tilemap_navigation_debug_lines.len(), 16),
    ] {
        work = work
            .checked_add((count as u64).checked_mul(cost).ok_or(Error::WorkLimit)?)
            .ok_or(Error::WorkLimit)?;
    }
    if work > limits.max_work {
        return Err(Error::WorkLimit);
    }
    let n = render_commands.len();
    require(sprite_normal_materials.len() == n, "normal-alignment", 0)?;
    for (field, count) in [
        ("lighting-alignment", sprite_lighting_materials.len()),
        ("surface-alignment", sprite_surface_materials.len()),
        ("mask-alignment", sprite_light_masks.len()),
    ] {
        require(count == 0 || count == n, field, 0)?;
    }
    require(
        tilemap_navigation_path_points.len().is_multiple_of(5),
        "navigation-stride",
        0,
    )?;
    let triangle_count = ground_shadow_volumes.len() / 3;
    let casters = *ground_shadow_volume_casters as usize;
    require(
        ground_shadow_volumes.len().is_multiple_of(3)
            && casters <= triangle_count
            && triangle_count <= casters.saturating_mul(8),
        "shadow-triangles",
        0,
    )?;
    require(audio_poses.len() <= MAX_AUDIO_POSES, "audio-pose-count", 0)?;
    require(frame_telemetry.file_payload_valid(), "telemetry", 0)?;
    require(
        finite(&[
            ground_shadow_projection.direction_x,
            ground_shadow_projection.direction_y,
            ground_shadow_projection.length_scale,
            *ground_y_scale,
        ]),
        "projection",
        0,
    )?;
    if let Some(index) = *animation_event_overflow {
        let valid = gameplay_events.get(index).is_some_and(|event| {
            event.kind == crate::gameplay_event::GAMEPLAY_EVENT_SPRITE_ANIMATION_OVERFLOW
                && event.actor_id == u32::MAX
                && event.actor_generation == 0
                && event.source_id == u32::MAX
                && event.source_generation == 0
                && event.token_id == 0
                && event.flags == 0
                && event.payload_bits != 0
        });
        require(valid, "animation-overflow", index)?;
    }
    for (i, v) in render_commands.iter().enumerate() {
        require(command(v), "render-command", i)?;
    }
    for (i, v) in sprite_normal_materials.iter().enumerate() {
        require(normal(*v), "normal", i)?;
    }
    for (i, v) in sprite_lighting_materials.iter().enumerate() {
        require(lighting(*v), "lighting", i)?;
    }
    for (i, v) in sprite_surface_materials.iter().enumerate() {
        require(surface(*v), "surface", i)?;
    }
    for (i, v) in sprite_light_masks.iter().enumerate() {
        require(masks(*v), "masks", i)?;
    }
    for (i, v) in render_items.iter().enumerate() {
        let crate::render_command::SpriteRenderItem {
            command: c,
            normal_material,
            lighting_material,
            surface_material,
            light_masks,
            sort_key:
                crate::render_command::SpriteRenderSortKey {
                    floor_id: _,
                    elevation,
                    foot_y,
                    render_layer: _,
                    sort_order,
                    stable_id: _,
                },
        } = *v;
        require(
            command(&c)
                && normal(normal_material)
                && lighting(lighting_material)
                && surface(surface_material)
                && masks(light_masks)
                && finite(&[elevation, foot_y, sort_order]),
            "render-item",
            i,
        )?;
    }
    for (i, v) in contact_impacts.iter().enumerate() {
        let crate::components::RigidContactImpulse {
            entity_a: _,
            entity_b: _,
            point_x,
            point_y,
            normal_x,
            normal_y,
            normal_impulse,
            tangent_impulse,
        } = *v;
        require(
            finite(&[
                point_x,
                point_y,
                normal_x,
                normal_y,
                normal_impulse,
                tangent_impulse,
            ]),
            "contact-impact",
            i,
        )?;
    }
    for (i, v) in ground_shadow_volumes.iter().enumerate() {
        let crate::world::ground_shadow::GroundShadowVolumeVertex { x, y, opacity } = *v;
        require(
            finite(&[x, y, opacity]) && (0.0..=1.).contains(&opacity),
            "shadow-vertex",
            i,
        )?;
    }
    for (i, v) in audio_poses.iter().enumerate() {
        require(v.file_payload_valid(), "audio-pose", i)?;
    }
    for (i, v) in audio_events.iter().enumerate() {
        let crate::audio_event::AudioEvent {
            sound_id,
            volume,
            pitch,
            channel_id,
        } = *v;
        require(
            finite(&[sound_id, volume, pitch, channel_id]),
            "audio-event",
            i,
        )?;
    }
    for (i, v) in effect_events.iter().enumerate() {
        let crate::effect_event::EffectEvent {
            effect_id: _,
            effect_type: _,
            actor_id: _,
            actor_generation: _,
            source_id: _,
            source_generation: _,
            x,
            y,
            intensity,
            radius,
        } = *v;
        require(finite(&[x, y, intensity, radius]), "effect-event", i)?;
    }
    for (i, v) in collision_events.iter().enumerate() {
        let crate::collision_event::CollisionEvent {
            kind,
            a_id: _,
            a_generation: _,
            b_id: _,
            b_generation: _,
            damage_bits,
        } = *v;
        let damage = f32::from_bits(damage_bits);
        require(
            (1..=7).contains(&kind) && damage.is_finite() && damage >= 0.,
            "collision-event",
            i,
        )?;
    }
    // Gameplay payload_bits is a tagged integer/float payload; interpreting all
    // kinds as f32 would reject legitimate integer frame/tile/token values.
    for (i, v) in gameplay_events.iter().enumerate() {
        require((1..=15).contains(&v.kind), "gameplay-event", i)?;
        if v.kind == crate::gameplay_event::GAMEPLAY_EVENT_TERRAIN_IMPACT {
            require(
                v.actor_id != u32::MAX
                    && v.source_id == u32::MAX
                    && v.source_generation == 0
                    && [1, 2].contains(&v.token_id)
                    && [0, 4].contains(&v.flags),
                "terrain-event",
                i,
            )?;
        }
    }
    for (i, v) in physics_debug_lines.iter().enumerate() {
        require(line(v), "debug-line", i)?;
    }
    for (i, v) in tilemap_navigation_debug_lines.iter().enumerate() {
        require(line(v), "navigation-line", i)?;
    }
    for (i, v) in tilemap_navigation_path_points.iter().enumerate() {
        require(v.is_finite(), "navigation-point", i)?;
    }
    Ok(Usage { work })
}

#[cfg(test)]
mod tests;
