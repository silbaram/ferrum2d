use super::visual::{clips, reactions, shadow, sprite};
use super::*;
mod definitions;
mod frame;
mod spatial;

pub(super) fn visit(
    e: &Engine,
    b: &mut Budget,
    emit: &mut impl FnMut(Reference) -> Result<(), Error>,
) -> Result<(), Error> {
    let Engine {
        checkpoint_owner: _,
        physics_restore_transaction: _,
        checkpoint_revision: _,
        unified_physics: _,
        default_unified_physics: _,
        default_unified_physics_fixed: _,
        unified_physics_body_states: _,
        unified_physics_character_states: _,
        unified_physics_queries: _,
        unified_physics_collisions: _,
        unified_physics_observations: _,
        unified_physics_joints: _,
        elapsed_seconds: _,
        input: _,
        input_actions: _,
        previous_input_sample: _,
        fixed_timestep_input_latch: _,
        scene_mode: _,
        scenes: _,
        data_scene: _,
        spatial_scene: _,
        authoring_continuity: _,
        camera: _,
        world: _,
        data_scene_entity: _,
        ground_sun: _,
        ground_shadow_stats: _,
        gameplay_authoring_snapshot: _,
        tilemap: _,
        particles: _,
        bitmap_text: _,
        tweens: _,
        particle_presets: _,
        impact_feedback: _,
        shooter_hit_particle_preset: _,
        frame_buffers: _,
        tilemap_navigation_scratch: _,
        physics_debug_collision_scratch: _,
        physics_debug_lines_enabled: _,
        collision_lifecycle_events_enabled: _,
        physics_debug_line_flags: _,
        collision_event_tracker: _,
        collision_event_counts: _,
        physics_counters: _,
        physics_query_result: _,
        physics_query_hits: _,
        physics_raycast_hits: _,
        physics_tile_shape_cast_hits: _,
        physics_tile_contact_hits: _,
        physics_tile_manifold_hits: _,
        physics_body_contact_hits: _,
        physics_body_manifold_hits: _,
        physics_rigid_contact_impulse_hits: _,
        physics_collision_query_scratch: _,
        physics_point_query_scratch: _,
        physics_aabb_query_scratch: _,
        physics_circle_query_scratch: _,
        physics_shape_query_scratch: _,
        physics_raycast_scratch: _,
        physics_shape_cast_scratch: _,
        physics_body_contact_scratch: _,
        physics_body_manifold_scratch: _,
        physics_tile_shape_cast_scratch: _,
        physics_tile_contact_scratch: _,
        physics_tile_manifold_scratch: _,
        physics_entity_snapshot: _,
        physics_body_collider_snapshot: _,
        physics_joint_snapshot: _,
        physics_body_snapshot_floats: _,
        physics_body_snapshot_u32s: _,
        shooter_snapshot_header_floats: _,
        shooter_snapshot_header_u32s: _,
        shooter_snapshot_entity_floats: _,
        shooter_snapshot_entity_u32s: _,
        rigid_body_step_stats: _,
        rigid_body_frame_stats: _,
        rigid_body_step_scratch: _,
        hd2d_kinematic_elevation_delta: _,
        hd2d_kinematic_flags: _,
        hd2d_kinematic_hit_count: _,
        auto_rigid_body_step_enabled: _,
        auto_rigid_body_step_config: _,
        fixed_timestep: _,
        fixed_timestep_enabled: _,
        render_interpolation_enabled: _,
        last_fixed_update: _,
    } = e; // A new Engine field must be classified in this owner census.
    b.work(84)?; // Persistent Engine owner dispatch; resource-free fields stay untouched.
    let w = &e.world;
    b.product(w.entity_capacity(), 12)?;
    for i in 0..w.entity_capacity() {
        if !w.is_alive_index(i) {
            continue;
        }
        let entity = Entity {
            id: index(i)?,
            generation: w.generation_at_index(i).ok_or(Error::WorkLimit)?,
        };
        let path = [entity.id, entity.generation, 0, 0];
        sprite(
            Owner::WorldSprite,
            path,
            Some(entity),
            w.sprites.get(i).copied().flatten(),
            w.sprite_normal_materials.get(i).copied().flatten(),
            w.sprite_surface_materials.get(i).copied().flatten(),
            emit,
        )?;
        if let Some(p) = w.sprite_playbacks.get(i).and_then(Option::as_ref) {
            clips(Owner::WorldPlayback, path, Some(entity), &p.clips, b, emit)?;
        }
        b.product(
            crate::components::gameplay::MAX_COLLISION_REACTIONS_PER_ENTITY,
            2,
        )?;
        if let Some(caster) = w.ground_shadows.get(i).and_then(Option::as_ref) {
            shadow(
                Owner::WorldGroundShadow,
                path,
                Some(entity),
                caster,
                b,
                emit,
            )?;
        }
        let r = w.collision_reactions(entity);
        reactions(
            Owner::WorldReaction,
            path,
            Some(entity),
            r.as_ref(),
            b,
            emit,
        )?;
    }
    definitions::visit(e, b, emit)?;
    spatial::visit(e, b, emit)?;
    frame::visit(e, b, emit)?;
    Ok(())
}
