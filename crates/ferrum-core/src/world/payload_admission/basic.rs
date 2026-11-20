use super::*;
use crate::components::*;
use crate::render_command::{SPRITE_NORMAL_NONE, SPRITE_SURFACE_TEXTURE_NONE};

pub(super) fn material(m: &PhysicsMaterial) -> bool {
    finite(&[
        m.restitution,
        m.friction,
        m.surface_velocity.vx,
        m.surface_velocity.vy,
        m.density,
        m.contact_baumgarte_bias_scale,
        m.max_contact_baumgarte_bias_velocity_scale,
        m.contact_position_correction_scale,
        m.contact_position_correction_slop_scale,
    ])
}
pub(super) fn body(b: &RigidBody) -> bool {
    // Static/kinematic constructors intentionally use +INF mass and inertia.
    let mass = if b.body_type == RigidBodyType::Dynamic {
        crate::components::valid_positive_mass_property(b.mass)
    } else {
        b.mass > 0. && !b.mass.is_nan()
    };
    let inertia = if b.body_type == RigidBodyType::Dynamic && !b.fixed_rotation {
        crate::components::valid_positive_mass_property(b.inertia)
    } else {
        b.inertia > 0. && !b.inertia.is_nan()
    };
    mass && inertia
        && b.inverse_mass >= 0.
        && b.inverse_inertia >= 0.
        && finite(&[
            b.inverse_mass,
            b.inverse_inertia,
            b.gravity_scale,
            b.linear_damping,
            b.angular_damping,
            b.force.vx,
            b.force.vy,
            b.impulse.vx,
            b.impulse.vy,
            b.torque,
            b.angular_impulse,
            b.sleep_timer_seconds,
        ])
        && material(&b.material)
}
pub(super) fn animation(a: &SpriteAnimation) -> bool {
    if a.columns == 0
        || a.rows == 0
        || !a.idle.is_valid(a.columns, a.rows)
        || !a.moving.is_valid(a.columns, a.rows)
    {
        return false;
    }
    for (state, sequence) in [
        (a.idle, a.idle_frames.as_ref()),
        (a.moving, a.moving_frames.as_ref()),
    ] {
        if let Some(sequence) = sequence {
            if !sequence.saved_payload_valid() || sequence.frame_count() != state.frame_count {
                return false;
            }
        }
    }
    let active = match a.current_state {
        SpriteAnimationKind::Idle => a.idle,
        SpriteAnimationKind::Moving => a.moving,
    };
    a.current_frame < active.frame_count
        && a.elapsed_seconds.is_finite()
        && a.elapsed_seconds >= 0.
        && a.elapsed_seconds < 1. / active.frames_per_second
}
fn playback(
    v: &super::super::sprite_playback::SpritePlayback,
    budget: &mut Budget,
) -> Result<bool> {
    if v.clips.is_empty() || v.clips.len() > 64 {
        return Ok(false);
    }
    budget.nested(v.clips.len(), CLIP_HEADER_WORK)?;
    let mut total = 0usize;
    for (i, clip) in v.clips.iter().enumerate() {
        let lengths = clip.saved_payload_lengths();
        let nested = lengths
            .into_iter()
            .try_fold(0usize, |a, b| a.checked_add(b))
            .ok_or(WorldPayloadAdmissionError::NestedItems)?;
        budget.nested(nested, 8)?;
        total = total
            .checked_add(lengths[0])
            .ok_or(WorldPayloadAdmissionError::NestedItems)?;
        if total > super::super::sprite_playback::MAX_CLIP_TOTAL_FRAMES
            || clip.admit_saved_payload().is_err()
            || v.clips[..i].iter().any(|c| c.id == clip.id)
        {
            return Ok(false);
        }
    }
    if v.active >= v.clips.len() || !v.elapsed.is_finite() || v.elapsed < 0. {
        return Ok(false);
    }
    let clip = &v.clips[v.active];
    let duration = clip.duration_seconds();
    Ok(duration.is_finite()
        && duration > 0.
        && if clip.looping {
            v.elapsed < duration
        } else {
            v.elapsed <= duration
        })
}
pub(super) fn entity(w: &World, i: usize, budget: &mut Budget) -> Result {
    if let Some(v) = w.transforms[i] {
        budget.charge(8)?;
        require(finite(&[v.x, v.y]), "transforms", i, "xy")?;
    }
    if let Some(v) = w.velocities[i] {
        budget.charge(8)?;
        require(finite(&[v.vx, v.vy]), "velocities", i, "xy")?;
    }
    if let Some(v) = w.rotations[i] {
        budget.charge(4)?;
        require(v.radians.is_finite(), "rotations", i, "radians")?;
    }
    if let Some(v) = w.angular_velocities[i] {
        budget.charge(4)?;
        require(
            v.radians_per_second.is_finite(),
            "angular_velocities",
            i,
            "radians-per-second",
        )?;
    }
    if let Some(v) = w.sprites[i] {
        budget.charge(32)?;
        require(
            finite(&[
                v.width,
                v.height,
                v.u0,
                v.v0,
                v.u1,
                v.v1,
                v.r,
                v.g,
                v.b,
                v.a,
                v.rotation_radians,
                v.origin_x,
                v.origin_y,
                v.sort_order,
            ]),
            "sprites",
            i,
            "numeric",
        )?;
    }
    if let Some(v) = w.sprite_normal_materials[i] {
        budget.charge(8)?;
        require(
            v.flags == 0 && v.normal_texture <= SPRITE_NORMAL_NONE,
            "sprite_normal_materials",
            i,
            "texture-flags",
        )?;
    }
    if let Some(v) = w.sprite_lighting_materials[i] {
        budget.charge(16)?;
        require(
            v.mode <= 2
                && v.alpha_cutoff.is_finite()
                && (0.0..=1.).contains(&v.alpha_cutoff)
                && (v.mode == 2 || v.alpha_cutoff == 0.),
            "sprite_lighting_materials",
            i,
            "mode-cutoff",
        )?;
    }
    if let Some(v) = w.sprite_light_masks[i] {
        budget.charge(8)?;
        require(
            v.light_mask <= 255 && v.shadow_mask <= 255,
            "sprite_light_masks",
            i,
            "mask",
        )?;
    }
    if let Some(v) = w.sprite_surface_materials[i] {
        budget.charge(32)?;
        require(
            v.flags <= 1
                && v.reserved == 0
                && [v.emission_texture, v.specular_texture, v.roughness_texture]
                    .iter()
                    .all(|id| *id <= SPRITE_SURFACE_TEXTURE_NONE)
                && v.emission
                    .iter()
                    .all(|v| v.is_finite() && (0.0..=64.).contains(v))
                && v.specular.is_finite()
                && (0.0..=1.).contains(&v.specular)
                && v.roughness.is_finite()
                && (0.0..=1.).contains(&v.roughness)
                && (v.flags != 0 || v == Default::default()),
            "sprite_surface_materials",
            i,
            "surface",
        )?;
    }
    if let Some(v) = w.sprite_nine_slices[i] {
        budget.charge(32)?;
        let record = [
            v.source_width,
            v.source_height,
            v.left,
            v.right,
            v.top,
            v.bottom,
            v.border_scale,
            if v.flip_x { 1. } else { 0. },
            if v.flip_y { 1. } else { 0. },
        ];
        require(
            SpriteNineSlice::from_record(&record) == Some(v),
            "sprite_nine_slices",
            i,
            "borders",
        )?;
    }
    if let Some(v) = w.sprite_animations[i] {
        budget.charge(512)?;
        require(animation(&v), "sprite_animations", i, "state-frame-time")?;
    }
    if let Some(v) = &w.sprite_playbacks[i] {
        budget.charge(16)?;
        require(
            playback(v, budget)?,
            "sprite_playbacks",
            i,
            "clip-frame-timeline-time",
        )?;
    }
    if let Some(v) = w.ground_shadows[i] {
        budget.charge(128)?;
        require(v.saved_payload_valid(), "ground_shadows", i, "shape-cache")?;
    }
    if let Some(v) = w.height_spans[i] {
        budget.charge(16)?;
        require(
            HeightSpan::new(v.floor, v.elevation, v.height) == Some(v),
            "height_spans",
            i,
            "span",
        )?;
    }
    if let Some(v) = w.projectile_arcs[i] {
        budget.charge(24)?;
        require(
            ProjectileArc::new(
                v.floor,
                v.base_elevation,
                v.z,
                v.z_velocity,
                v.gravity,
                v.hit_height,
            ) == Some(v),
            "projectile_arcs",
            i,
            "arc",
        )?;
    }
    if let Some(v) = w.rigid_bodies[i] {
        budget.charge(64)?;
        require(body(&v), "rigid_bodies", i, "body-material")?;
    }
    if let Some(v) = w.collider_materials[i] {
        budget.charge(32)?;
        require(material(&v), "collider_materials", i, "numeric")?;
    }
    // CollisionFilter category/mask are arbitrary u32 bitmasks by constructor.
    if let Some(v) = w.colliders[i] {
        budget.charge(160)?;
        require(
            shape(&CompoundColliderShape::Aabb(v)),
            "colliders",
            i,
            "shape",
        )?;
    }
    if let Some(v) = w.circle_colliders[i] {
        budget.charge(160)?;
        require(
            shape(&CompoundColliderShape::Circle(v)),
            "circle_colliders",
            i,
            "shape",
        )?;
    }
    if let Some(v) = w.oriented_box_colliders[i] {
        budget.charge(160)?;
        require(
            shape(&CompoundColliderShape::OrientedBox(v)),
            "oriented_box_colliders",
            i,
            "shape",
        )?;
    }
    if let Some(v) = w.capsule_colliders[i] {
        budget.charge(160)?;
        require(
            shape(&CompoundColliderShape::Capsule(v)),
            "capsule_colliders",
            i,
            "shape",
        )?;
    }
    if let Some(v) = w.edge_colliders[i] {
        budget.charge(160)?;
        require(
            shape(&CompoundColliderShape::Edge(v)),
            "edge_colliders",
            i,
            "shape",
        )?;
    }
    if let Some(v) = w.chain_colliders[i] {
        budget.charge(160)?;
        require(
            shape(&CompoundColliderShape::Chain(v)),
            "chain_colliders",
            i,
            "shape",
        )?;
    }
    if let Some(v) = w.convex_polygon_colliders[i] {
        budget.charge(160)?;
        require(
            shape(&CompoundColliderShape::ConvexPolygon(v)),
            "convex_polygon_colliders",
            i,
            "shape",
        )?;
    }
    let leaves = &w.compound_colliders[i];
    budget.nested(leaves.len(), COMPOUND_WORK)?;
    for leaf in leaves {
        require(
            shape(&leaf.shape) && leaf.material.as_ref().is_none_or(material),
            "compound_colliders",
            i,
            "shape-material",
        )?;
    }
    Ok(())
}
pub(super) fn shape(shape: &CompoundColliderShape) -> bool {
    match shape {
        CompoundColliderShape::Aabb(v) => {
            finite(&[v.half_width, v.half_height, v.offset_x, v.offset_y])
        }
        CompoundColliderShape::Circle(v) => finite(&[v.radius, v.offset_x, v.offset_y]),
        CompoundColliderShape::OrientedBox(v) => finite(&[
            v.half_width,
            v.half_height,
            v.offset_x,
            v.offset_y,
            v.rotation_radians,
        ]),
        CompoundColliderShape::Capsule(v) => finite(&[
            v.start_x, v.start_y, v.end_x, v.end_y, v.radius, v.offset_x, v.offset_y,
        ]),
        CompoundColliderShape::Edge(v) => finite(&[
            v.start_x, v.start_y, v.end_x, v.end_y, v.offset_x, v.offset_y,
        ]),
        CompoundColliderShape::Chain(v) => {
            finite(&[v.offset_x, v.offset_y])
                && v.vertex_count as usize <= v.vertices.len()
                && v.vertices.iter().all(|p| finite(&[p.x, p.y]))
        }
        CompoundColliderShape::ConvexPolygon(v) => {
            finite(&[v.offset_x, v.offset_y, v.rotation_radians])
                && v.vertex_count as usize <= v.vertices.len()
                && v.vertices.iter().all(|p| finite(&[p.x, p.y]))
        }
    }
}
