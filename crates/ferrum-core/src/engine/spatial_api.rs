use super::{Engine, SceneMode};
use crate::spatial_scene::{Billboard, SpatialCamera};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl Engine {
    /// Validate the current bodies plus proposed model bindings without changing the active scene/world.
    pub fn preflight_spatial_attachments(
        &self,
        metadata: &[u32],
        values: &[f32],
        models: &[u32],
        styles: &[f32],
    ) -> bool {
        let mut next = crate::spatial_scene::SpatialScene::default();
        next.models.configure(&self.world, models, styles)
            && crate::spatial_scene::SpatialAttachments::build_checked(
                &self.world,
                &next.models,
                metadata,
                values,
            )
            .is_some()
    }
    /// Cold bounded attachment graph. Native state owns every derived child pose.
    pub fn configure_spatial_attachments(&mut self, metadata: &[u32], values: &[f32]) -> bool {
        if self.scene_mode != SceneMode::Data {
            return false;
        }
        self.spatial_scene.attachments.configure(
            &mut self.world,
            &self.spatial_scene.models,
            metadata,
            values,
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub fn move_data_scene_spatial_actor_to(
        &mut self,
        x: f32,
        y: f32,
        floor: u32,
        speed: f32,
        cell: f32,
        radius: f32,
        cancel_on_input: bool,
    ) -> bool {
        if self.scene_mode != SceneMode::Data || self.spatial_scene.camera.is_none() {
            self.spatial_scene.navigation.reject_unavailable_request();
            return false;
        }
        let ok = self.spatial_scene.plan_navigation(
            &mut self.world,
            crate::components::Transform2D { x, y },
            floor,
            speed,
            cell,
            radius,
            cancel_on_input,
        );
        if ok {
            self.data_scene.movement.cancel();
        }
        ok
    }
    pub fn cancel_data_scene_spatial_move(&mut self) -> bool {
        if self.scene_mode != SceneMode::Data || !self.spatial_scene.navigation.cancel() {
            return false;
        }
        if let Some((actor, _, _, _)) = self.spatial_scene.actor {
            self.world
                .set_velocity(actor, crate::components::Velocity::default());
            if self.world.primary_actor_entity() == Some(actor) {
                self.data_scene.movement_animation.stop(&mut self.world);
            }
        }
        true
    }
    pub fn data_scene_spatial_move_status(&self) -> u32 {
        if self.scene_mode == SceneMode::Data {
            self.spatial_scene.navigation.status as u32
        } else {
            u32::MAX
        }
    }
    pub fn data_scene_spatial_move_stats(&self) -> Vec<u32> {
        if self.scene_mode == SceneMode::Data {
            self.spatial_scene.navigation.stats()
        } else {
            vec![]
        }
    }
    /// Optional v1 cold diagnostics; preserves the six-word movement stats ABI.
    pub fn data_scene_spatial_move_diagnostics(&self) -> Vec<u32> {
        if self.scene_mode == SceneMode::Data {
            self.spatial_scene.navigation.diagnostics()
        } else {
            vec![]
        }
    }
    /// Cold input capability: terrain metadata bit 4 marks a non-rendered physics/picking surface.
    pub fn spatial_surface_proxy_abi_version(&self) -> u32 {
        1
    }
    /// Cold input capability: terrain metadata bit 5 selects an X-axis ramp.
    pub fn spatial_ramp_axis_abi_version(&self) -> u32 {
        1
    }
    pub fn spatial_model_abi_version(&self) -> u32 {
        1
    }
    /// Cold capability for 1024 instances / 4096 primitives; render ABI stays v1.
    pub fn spatial_model_batch_abi_version(&self) -> u32 {
        1
    }
    /// Cold bulk model transform validation before authoring activation.
    pub fn preflight_spatial_model_poses(&self, styles: &[f32], origins: &[f32]) -> bool {
        crate::spatial_scene::preflight_model_poses(styles, origins)
    }
    pub fn spatial_model_stride(&self) -> u32 {
        20
    }
    pub fn spatial_model_ptr(&self) -> *const f32 {
        self.spatial_scene.models.draws.as_ptr().cast()
    }
    pub fn spatial_model_len(&self) -> usize {
        self.spatial_scene.models.draws.len()
    }
    /// Cold authoring query, never called per entity in the frame loop.
    pub fn spatial_model_draw_snapshot(&self, id: u32, generation: u32) -> Vec<u32> {
        if self.scene_mode != SceneMode::Data {
            return Vec::new();
        }
        self.spatial_scene.models.draw_snapshot((id, generation))
    }
    /// Cold chunk/LOD policy. Does not change the render ABI or simulation world.
    pub fn configure_spatial_model_streaming(
        &mut self,
        chunks: &[f32],
        metadata: &[u32],
        distances: &[f32],
    ) -> bool {
        self.spatial_scene
            .models
            .configure_streaming(chunks, metadata, distances)
    }
    pub fn spatial_model_asset_in_use(&self, asset: u32) -> bool {
        self.spatial_scene
            .models
            .bindings
            .values()
            .any(|m| m.asset == asset)
            || self.spatial_scene.models.streaming_asset_in_use(asset)
    }
    pub fn spatial_viewport_width(&self) -> f32 {
        self.camera.viewport_width
    }
    pub fn spatial_viewport_height(&self) -> f32 {
        self.camera.viewport_height
    }
    #[allow(clippy::too_many_arguments)]
    pub fn configure_spatial_scene(
        &mut self,
        camera_values: &[f32],
        terrain_values: &[f32],
        terrain_metadata: &[u32],
        handles: &[u32],
        styles: &[f32],
        actor_handle: &[u32],
        actor_values: &[f32],
    ) -> bool {
        self.configure_spatial_scene_connected(
            camera_values,
            terrain_values,
            terrain_metadata,
            handles,
            styles,
            actor_handle,
            actor_values,
            &[],
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub fn configure_spatial_scene_connected(
        &mut self,
        camera_values: &[f32],
        terrain_values: &[f32],
        terrain_metadata: &[u32],
        handles: &[u32],
        styles: &[f32],
        actor_handle: &[u32],
        actor_values: &[f32],
        connections: &[u32],
    ) -> bool {
        self.configure_spatial_scene_environment(
            camera_values,
            terrain_values,
            terrain_metadata,
            handles,
            styles,
            actor_handle,
            actor_values,
            connections,
            &[],
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub fn configure_spatial_scene_environment(
        &mut self,
        camera_values: &[f32],
        terrain_values: &[f32],
        terrain_metadata: &[u32],
        handles: &[u32],
        styles: &[f32],
        actor_handle: &[u32],
        actor_values: &[f32],
        connections: &[u32],
        environment: &[f32],
    ) -> bool {
        self.configure_spatial_scene_materials(
            camera_values,
            terrain_values,
            terrain_metadata,
            handles,
            styles,
            actor_handle,
            actor_values,
            connections,
            environment,
            &[],
            &[],
        )
    }
    #[allow(clippy::too_many_arguments)]
    pub fn configure_spatial_scene_materials(
        &mut self,
        camera_values: &[f32],
        terrain_values: &[f32],
        terrain_metadata: &[u32],
        handles: &[u32],
        styles: &[f32],
        actor_handle: &[u32],
        actor_values: &[f32],
        connections: &[u32],
        environment: &[f32],
        terrain_materials: &[u32],
        billboard_materials: &[u32],
    ) -> bool {
        self.configure_spatial_scene_models(
            camera_values,
            terrain_values,
            terrain_metadata,
            handles,
            styles,
            actor_handle,
            actor_values,
            connections,
            environment,
            terrain_materials,
            billboard_materials,
            &[],
            &[],
        )
    }
    /// Atomic spatial configuration with independent static model instance extension v1.
    #[allow(clippy::too_many_arguments)]
    pub fn configure_spatial_scene_models(
        &mut self,
        camera_values: &[f32],
        terrain_values: &[f32],
        terrain_metadata: &[u32],
        handles: &[u32],
        styles: &[f32],
        actor_handle: &[u32],
        actor_values: &[f32],
        connections: &[u32],
        environment: &[f32],
        terrain_materials: &[u32],
        billboard_materials: &[u32],
        model_metadata: &[u32],
        model_styles: &[f32],
    ) -> bool {
        if self.scene_mode != SceneMode::Data
            || !handles.len().is_multiple_of(2)
            || styles.len() != handles.len() / 2 * 3
            || handles.len() > 20000
        {
            return false;
        }
        let Some(camera) = SpatialCamera::new(camera_values) else {
            return false;
        };
        let mut next = crate::spatial_scene::SpatialScene::default();
        let Some(environment) = crate::spatial_scene::SpatialEnvironment::new(environment) else {
            return false;
        };
        next.environment = environment;
        next.camera = Some(camera);
        if !next.configure_surfaces(terrain_values, terrain_metadata)
            || !next.configure_connections(connections)
        {
            return false;
        }
        for (h, v) in handles.chunks_exact(2).zip(styles.chunks_exact(3)) {
            let Some(entity) = self.entity_from_handle(h[0], h[1]) else {
                return false;
            };
            if self.world.sprite_at_index(entity.id as usize).is_none()
                || v.iter().any(|v| !v.is_finite())
                || v[0] <= 0.0
                || !(0.001..=1.0).contains(&v[1])
                || next.bindings.contains_key(&(h[0], h[1]))
            {
                return false;
            }
            let sprite = self.world.sprite_at_index(entity.id as usize).unwrap();
            if ![
                sprite.width * v[0],
                sprite.height * v[0],
                v[2] + sprite.height * v[0],
            ]
            .iter()
            .all(|x| x.is_finite())
            {
                return false;
            }
            next.bindings.insert(
                (h[0], h[1]),
                Billboard {
                    material: Default::default(),
                    units_per_pixel: v[0],
                    cutoff: v[1],
                    elevation: v[2],
                },
            );
        }
        if !actor_handle.is_empty() {
            if actor_handle.len() != 2
                || actor_values.len() != 3
                || actor_values.iter().any(|v| !v.is_finite() || *v < 0.0)
                || next.surfaces.is_empty()
            {
                return false;
            }
            let Some(entity) = self.entity_from_handle(actor_handle[0], actor_handle[1]) else {
                return false;
            };
            if !next.bindings.contains_key(&(entity.id, entity.generation))
                || self.world.height_span(entity).is_none()
                || !self.world.rigid_body(entity).is_some_and(|b| {
                    b.enabled && b.body_type == crate::components::RigidBodyType::Kinematic
                })
                || self.world.compound_collider_count(entity) != 1
                || !self
                    .world
                    .collider(entity)
                    .is_some_and(|c| c.enabled && !c.is_trigger)
            {
                return false;
            }
            next.actor = Some((entity, actor_values[0], actor_values[1], actor_values[2]));
        } else if !actor_values.is_empty() {
            return false;
        }
        if !terrain_materials.is_empty() {
            if terrain_materials.len() != next.surfaces.len()
                || terrain_materials.iter().any(|f| *f > 3)
            {
                return false;
            }
            for ((m, surface), flags) in next
                .terrain_materials
                .iter_mut()
                .zip(&next.surfaces)
                .zip(terrain_materials)
            {
                if !surface.is_rendered && *flags != 0 {
                    return false;
                }
                m.flags = *flags;
            }
        }
        if !billboard_materials.is_empty() {
            if billboard_materials.len() != handles.len() {
                return false;
            }
            for (h, m) in handles
                .chunks_exact(2)
                .zip(billboard_materials.chunks_exact(2))
            {
                if m[0] > 16_777_215 || m[1] > 3 {
                    return false;
                }
                let Some(binding) = next.bindings.get_mut(&(h[0], h[1])) else {
                    return false;
                };
                binding.material = crate::spatial_scene::SpatialMaterial {
                    normal_texture: m[0],
                    flags: m[1],
                };
            }
        }
        if !next.environment.camera_valid(&camera) || !next.shadow_budget_valid(&self.world) {
            return false;
        }
        if !next
            .models
            .configure(&self.world, model_metadata, model_styles)
            || next
                .models
                .bindings
                .keys()
                .any(|h| next.bindings.contains_key(h))
        {
            return false;
        }
        self.data_scene.movement.cancel();
        next.revision = self.spatial_scene.revision.wrapping_add(1);
        self.spatial_scene = next;
        true
    }
    /// Cold preflight for authoring/restore before replacing the active scene.
    pub fn preflight_spatial_camera_environment(
        &self,
        camera_values: &[f32],
        environment_values: &[f32],
    ) -> bool {
        let Some(camera) = SpatialCamera::new(camera_values) else {
            return false;
        };
        crate::spatial_scene::SpatialEnvironment::new(environment_values)
            .is_some_and(|environment| environment.camera_valid(&camera))
    }
    /// Cold bulk binding. Entity generations are checked here and again when following.
    pub fn configure_spatial_light_bindings(&mut self, metadata: &[u32], offsets: &[f32]) -> bool {
        if self.spatial_scene.camera.is_none()
            || !metadata.len().is_multiple_of(3)
            || metadata.len() / 3 != offsets.len()
            || offsets.len() > 16
        {
            return false;
        }
        let mut bindings = [None; 16];
        for (entry, offset) in metadata.chunks_exact(3).zip(offsets) {
            let index = entry[0] as usize;
            let entity = crate::entity::Entity {
                id: entry[1],
                generation: entry[2],
            };
            if index >= 16
                || bindings[index].is_some()
                || !self.world.is_current_entity(entity)
                || !offset.is_finite()
                || offset.abs() > 1e6
            {
                return false;
            }
            bindings[index] = Some((entity, *offset));
        }
        self.spatial_scene.light_bindings = bindings;
        self.spatial_scene.frame_active = false;
        true
    }
    pub fn configure_spatial_environment(&mut self, values: &[f32]) -> bool {
        if self.scene_mode != SceneMode::Data || self.spatial_scene.camera.is_none() {
            return false;
        }
        let Some(next) = crate::spatial_scene::SpatialEnvironment::new(values) else {
            return false;
        };
        if self
            .spatial_scene
            .camera
            .as_ref()
            .is_none_or(|c| !next.camera_valid(c))
        {
            return false;
        }
        let previous = std::mem::replace(&mut self.spatial_scene.environment, next);
        if !self.spatial_scene.shadow_budget_valid(&self.world) {
            self.spatial_scene.environment = previous;
            return false;
        }
        self.spatial_scene.frame_active = false;
        true
    }
    pub fn capture_spatial_environment(&self) -> Vec<f32> {
        self.spatial_scene
            .environment
            .values
            .map_or_else(Vec::new, |v| {
                v[..self.spatial_scene.environment.value_len].to_vec()
            })
    }
    pub fn spatial_environment_abi_version(&self) -> u32 {
        if self.spatial_scene.environment.value_len > 128 {
            4
        } else if self.spatial_scene.environment.value_len > 112 {
            3
        } else if self.spatial_scene.environment.value_len > 80 {
            2
        } else {
            1
        }
    }
    pub fn spatial_environment_len(&self) -> u32 {
        if self.spatial_scene.frame_active && self.spatial_scene.environment.values.is_some() {
            self.spatial_scene.environment.value_len as u32
        } else {
            0
        }
    }
    pub fn spatial_environment_ptr(&self) -> *const f32 {
        self.spatial_scene.environment.frame_values.as_ptr()
    }
    pub fn spatial_shadow_matrix_ptr(&self) -> *const f32 {
        self.spatial_scene.environment.shadow_matrices.as_ptr()
    }
    pub fn spatial_shadow_matrix_len(&self) -> u32 {
        self.spatial_scene.environment.shadow_matrices.len() as u32
    }
    /// Optional shadow submission extension v1: face, source (terrain/caster), first, count.
    pub fn spatial_shadow_submission_version(&self) -> u32 {
        1
    }
    pub fn spatial_shadow_revision(&self) -> u32 {
        self.spatial_scene.shadow_revision
    }
    pub fn spatial_shadow_range_ptr(&self) -> *const u32 {
        self.spatial_scene.shadow_draw_ranges.as_ptr().cast()
    }
    pub fn spatial_shadow_range_len(&self) -> u32 {
        self.spatial_scene.shadow_draw_ranges.len() as u32
    }
    pub fn spatial_shadow_caster_ptr(&self) -> *const f32 {
        self.spatial_scene.shadow_casters.as_ptr().cast()
    }
    pub fn spatial_shadow_caster_len(&self) -> u32 {
        (self.spatial_scene.shadow_casters.len() * 6) as u32
    }
    pub fn configure_spatial_camera(&mut self, values: &[f32]) -> bool {
        if self.scene_mode != SceneMode::Data {
            return false;
        }
        let Some(camera) = SpatialCamera::new(values) else {
            return false;
        };
        if !self.spatial_scene.environment.camera_valid(&camera) {
            return false;
        }
        self.spatial_scene.camera = Some(camera);
        true
    }
    pub fn configure_spatial_terrain(&mut self, values: &[f32], metadata: &[u32]) -> bool {
        if self.spatial_scene.environment.shadows() {
            let mut proposed = crate::spatial_scene::SpatialScene::default();
            if !proposed.configure_surfaces(values, metadata) {
                return false;
            }
            let Some(environment) = crate::spatial_scene::SpatialEnvironment::new(
                self.spatial_scene
                    .environment
                    .values
                    .as_ref()
                    .map_or(&[], |v| &v[..self.spatial_scene.environment.value_len]),
            ) else {
                return false;
            };
            proposed.environment = environment;
            proposed.bindings = self.spatial_scene.bindings.clone();
            if !proposed.shadow_budget_valid(&self.world) {
                return false;
            }
        }
        self.scene_mode == SceneMode::Data
            && self.spatial_scene.configure_surfaces(values, metadata)
    }
    pub fn configure_spatial_billboards(&mut self, handles: &[u32], values: &[f32]) -> bool {
        if self.scene_mode != SceneMode::Data
            || !handles.len().is_multiple_of(2)
            || values.len() != handles.len() / 2 * 3
            || handles.len() > 20_000
        {
            return false;
        }
        let mut next = std::collections::BTreeMap::new();
        for (h, v) in handles.chunks_exact(2).zip(values.chunks_exact(3)) {
            let Some(entity) = self.entity_from_handle(h[0], h[1]) else {
                return false;
            };
            if self.world.sprite_at_index(entity.id as usize).is_none()
                || v.iter().any(|v| !v.is_finite())
                || v[0] <= 0.0
                || !(0.0..=1.0).contains(&v[1])
                || next.contains_key(&(h[0], h[1]))
            {
                return false;
            }
            next.insert(
                (h[0], h[1]),
                Billboard {
                    material: Default::default(),
                    units_per_pixel: v[0],
                    cutoff: v[1],
                    elevation: v[2],
                },
            );
        }
        let previous = std::mem::replace(&mut self.spatial_scene.bindings, next);
        if !self.spatial_scene.shadow_budget_valid(&self.world) {
            self.spatial_scene.bindings = previous;
            return false;
        }
        self.spatial_scene.navigation.cancel();
        self.spatial_scene.revision = self.spatial_scene.revision.wrapping_add(1);
        true
    }
    pub fn clear_spatial_scene(&mut self) {
        self.spatial_scene.clear();
    }
    pub fn configure_spatial_actor(
        &mut self,
        id: u32,
        generation: u32,
        speed: f32,
        max_step: f32,
        max_drop: f32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(id, generation) else {
            return false;
        };
        if !speed.is_finite()
            || speed < 0.0
            || !self.spatial_scene.move_body(
                &mut self.world,
                entity,
                0.0,
                0.0,
                max_step,
                max_drop,
                None,
            )
        {
            return false;
        }
        self.spatial_scene.actor = Some((entity, speed, max_step, max_drop));
        self.spatial_scene.navigation.cancel();
        self.data_scene.movement.cancel();
        self.spatial_scene.revision = self.spatial_scene.revision.wrapping_add(1);
        true
    }
    pub fn move_spatial_body(
        &mut self,
        id: u32,
        generation: u32,
        dx: f32,
        dy: f32,
        max_step: f32,
        max_drop: f32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(id, generation) else {
            return false;
        };
        let accepted = self.scene_mode == SceneMode::Data
            && self.spatial_scene.move_body(
                &mut self.world,
                entity,
                dx,
                dy,
                max_step,
                max_drop,
                Some(&mut self.physics_counters),
            );
        if accepted && self.spatial_scene.actor.map(|a| a.0) == Some(entity) {
            self.spatial_scene.navigation.cancel();
        }
        accepted
    }
    /// Cold bounded 2D/spatial authoring visibility. Physics and save state stay intact.
    pub fn set_spatial_preview_filter(&mut self, entity_keys: &[u32], surface_ids: &[u32]) -> bool {
        if self.scene_mode != SceneMode::Data
            || !entity_keys.len().is_multiple_of(2)
            || entity_keys.len() > 32768
            || surface_ids.len() > 256
            || entity_keys
                .chunks_exact(2)
                .any(|key| self.entity_from_handle(key[0], key[1]).is_none())
            || surface_ids.iter().any(|id| {
                !self
                    .spatial_scene
                    .surfaces
                    .iter()
                    .any(|surface| surface.id == *id)
            })
        {
            return false;
        }
        let entities = entity_keys
            .chunks_exact(2)
            .map(|key| (key[0], key[1]))
            .collect();
        let surfaces = surface_ids.iter().copied().collect();
        self.spatial_scene.preview_hidden_entities = entities;
        self.spatial_scene.preview_hidden_surfaces = surfaces;
        true
    }

    pub fn pick_spatial_surface(
        &self,
        x: f32,
        y: f32,
        camera_values: &[f32],
        terrain_revision: u32,
    ) -> Vec<f32> {
        if self.scene_mode != SceneMode::Data
            || !x.is_finite()
            || !y.is_finite()
            || x.abs() > 1.0
            || y.abs() > 1.0
            || terrain_revision != self.spatial_scene.revision
            || camera_values.len() != 28
            || camera_values.iter().any(|v| !v.is_finite())
        {
            return vec![];
        }
        let Some(camera) = SpatialCamera::new(&camera_values[16..]) else {
            return vec![];
        };
        if camera
            .matrix
            .iter()
            .zip(&camera_values[..16])
            .any(|(a, b)| (a - b).abs() > 0.0001)
        {
            return vec![];
        }
        self.spatial_scene.pick(&camera, x, y)
    }
    pub fn spatial_frame_active(&self) -> bool {
        self.spatial_scene.frame_active
    }
    /// Optional debug extension v1. Bits: terrain, billboards, height spans, depth, colliders, contacts, floor IDs.
    pub fn configure_spatial_debug(&mut self, flags: u32) -> bool {
        self.scene_mode == SceneMode::Data
            && self.spatial_scene.camera.is_some()
            && self.spatial_scene.debug.configure(flags)
    }
    pub fn spatial_debug_flags(&self) -> u32 {
        self.spatial_scene.debug.frame_flags
    }
    pub fn spatial_debug_ptr(&self) -> *const f32 {
        self.spatial_scene.debug.vertices.as_ptr().cast()
    }
    pub fn spatial_debug_len(&self) -> u32 {
        self.spatial_scene.debug.vertices.len() as u32
    }
    pub fn spatial_debug_vertex_stride(&self) -> u32 {
        11
    }
    pub fn spatial_debug_abi_version(&self) -> u32 {
        1
    }
    pub fn spatial_debug_truncated(&self) -> bool {
        self.spatial_scene.debug.truncated
    }
    pub fn spatial_debug_depth_test(&self) -> bool {
        self.spatial_scene.debug.depth_test()
    }
    pub fn spatial_abi_version(&self) -> u32 {
        2
    }
    pub fn spatial_vertex_stride(&self) -> u32 {
        11
    }
    pub fn spatial_terrain_revision(&self) -> u32 {
        self.spatial_scene.revision
    }
    pub fn spatial_terrain_ptr(&self) -> *const f32 {
        self.spatial_scene.terrain.as_ptr().cast()
    }
    pub fn spatial_terrain_len(&self) -> u32 {
        self.spatial_scene.terrain.len() as u32
    }
    pub fn spatial_terrain_draw_range_ptr(&self) -> *const u32 {
        self.spatial_scene.terrain_draw_ranges.as_ptr().cast()
    }
    pub fn spatial_terrain_draw_range_len(&self) -> u32 {
        self.spatial_scene.terrain_draw_ranges.len() as u32
    }
    pub fn spatial_terrain_draw_range_stride(&self) -> u32 {
        2
    }
    pub fn spatial_billboard_ptr(&self) -> *const f32 {
        self.spatial_scene.billboards.as_ptr().cast()
    }
    pub fn spatial_billboard_len(&self) -> u32 {
        self.spatial_scene.billboards.len() as u32
    }
    pub fn spatial_presentation_version(&self) -> u32 {
        1
    }
    pub fn spatial_presentation_ptr(&self) -> *const f32 {
        self.spatial_scene.presentation.as_ptr()
    }
    pub fn spatial_material_abi_version(&self) -> u32 {
        1
    }
    pub fn spatial_terrain_material_ptr(&self) -> *const u32 {
        self.spatial_scene.terrain_materials.as_ptr().cast()
    }
    pub fn spatial_terrain_material_len(&self) -> u32 {
        self.spatial_scene.terrain_materials.len() as u32
    }
    pub fn spatial_billboard_material_ptr(&self) -> *const u32 {
        self.spatial_scene.billboard_materials.as_ptr().cast()
    }
    pub fn spatial_billboard_material_len(&self) -> u32 {
        self.spatial_scene.billboard_materials.len() as u32
    }
    pub fn spatial_camera_ptr(&self) -> *const f32 {
        self.spatial_scene.frame_camera.as_ptr()
    }
}
