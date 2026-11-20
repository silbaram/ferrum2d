use super::{entity, validate_handles, Engine, UnifiedPhysicsError};
use crate::entity::Entity;
use crate::physics3d::{CharacterConfig, CharacterInput, CharacterState};
use wasm_bindgen::prelude::*;

const WORDS: usize = 28;
#[repr(C)]
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(in crate::engine) struct CharacterStateRecord {
    entity_id: u32,
    generation: u32,
    flags: u32,
    #[serde(with = "crate::checkpoint_codec::array")]
    ground_collider: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    ground_body: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    carried_by: [u32; 2],
    #[serde(with = "crate::checkpoint_codec::array")]
    translation: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    velocity: [f32; 3],
    #[serde(with = "crate::checkpoint_codec::array")]
    carry_translation: [f32; 3],
    vertical_speed: f32,
    #[serde(with = "crate::checkpoint_codec::array")]
    counters: [u32; 9],
}
const _: () = assert!(std::mem::size_of::<CharacterStateRecord>() == WORDS * 4);
const _: () = assert!(std::mem::align_of::<CharacterStateRecord>() == 4);
impl CharacterStateRecord {
    fn new(e: Entity, s: &CharacterState) -> Self {
        let flags = [
            s.grounded,
            s.sliding,
            s.hit_ceiling,
            s.blocked_by_character,
            s.character_coupling_iteration_limit,
            s.blocked_by_moving_obstacle,
            s.moving_obstacle_iteration_limit,
            s.ground.is_some(),
            s.carried_by.is_some(),
        ]
        .into_iter()
        .enumerate()
        .fold(0, |bits, (i, value)| bits | (u32::from(value) << i));
        Self {
            entity_id: e.id,
            generation: e.generation,
            flags,
            ground_collider: s
                .ground
                .map_or([0; 2], |g| [g.collider.slot, g.collider.generation]),
            ground_body: s
                .ground
                .map_or([0; 2], |g| [g.body.slot, g.body.generation]),
            carried_by: s.carried_by.map_or([0; 2], |b| [b.slot, b.generation]),
            translation: s.translation,
            velocity: s.velocity,
            carry_translation: s.carry_translation,
            vertical_speed: s.vertical_speed,
            counters: [
                s.dropped_contacts,
                s.character_pair_casts,
                s.character_pair_contact_checks,
                s.character_coupling_iterations,
                s.failed_pair_casts,
                s.moving_obstacle_casts,
                s.failed_moving_obstacle_casts,
                s.moving_obstacle_contact_checks,
                s.failed_moving_obstacle_contacts,
            ]
            .map(|v| v.min(u32::MAX as usize) as u32),
        }
    }
}
fn input(v: &[f32]) -> CharacterInput {
    CharacterInput {
        velocity: [v[0], v[1], v[2]],
        jump_speed: v[3],
    }
}

#[wasm_bindgen]
impl Engine {
    /// Character setup/input/state capability, independent of the world/body bridge version.
    pub fn unified_physics_character_version(&self) -> u32 {
        1
    }

    /// Empty values disable a controller. Eleven f32s enable/reset it: up XYZ,
    /// skin, climb/slide angles, step height/width, snap, vertical speed limit, push mass.
    pub fn configure_unified_physics_character(
        &mut self,
        id: u32,
        generation: u32,
        values: &[f32],
    ) -> Result<(), String> {
        let e = Entity { id, generation };
        if values.is_empty() {
            let id = self.unified_body_id(e).map_err(|e| e.to_string())?;
            return self
                .unified_physics
                .as_mut()
                .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?
                .physics
                .disable_character(id)
                .map_err(|e| e.to_string());
        }
        if values.len() != 11 {
            return Err("Character configuration requires eleven f32 values".into());
        }
        self.enable_unified_character(
            e,
            CharacterConfig {
                up: [values[0], values[1], values[2]],
                skin_width: values[3],
                max_slope_angle: values[4],
                slide_angle: values[5],
                step_height: values[6],
                step_min_width: values[7],
                snap_distance: values[8],
                max_vertical_speed: values[9],
                push_mass: values[10],
            },
        )
        .map_err(|e| e.to_string())
    }

    /// Atomic batch input admission. Four f32s per entity: ground velocity XYZ, jump speed.
    /// Ground velocity persists; jump is consumed by the next fixed step. Last duplicate wins.
    pub fn set_unified_physics_character_inputs(
        &mut self,
        handles: &[u32],
        values: &[f32],
    ) -> Result<(), String> {
        validate_handles(handles)?;
        if values.len() != handles.len() / 2 * 4 {
            return Err("Character input requires four f32 values per handle".into());
        }
        let runtime = self
            .unified_physics
            .as_ref()
            .ok_or_else(|| UnifiedPhysicsError::NotConfigured.to_string())?;
        for (h, v) in handles.chunks_exact(2).zip(values.chunks_exact(4)) {
            let id = self.unified_body_id(entity(h)).map_err(|e| e.to_string())?;
            runtime
                .physics
                .validate_character_input(id, &input(v))
                .map_err(|e| e.to_string())?;
        }
        for (h, v) in handles.chunks_exact(2).zip(values.chunks_exact(4)) {
            self.set_unified_character_input(entity(h), input(v))
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Last completed fixed-tick controller state, in request order. Failure clears output.
    pub fn query_unified_physics_character_states(
        &mut self,
        handles: &[u32],
    ) -> Result<(), String> {
        self.unified_physics_character_states.clear();
        validate_handles(handles)?;
        if self.unified_physics.is_none() {
            return Err(UnifiedPhysicsError::NotConfigured.to_string());
        }
        for h in handles.chunks_exact(2) {
            self.unified_character_state(entity(h))
                .map_err(|e| e.to_string())?;
        }
        self.unified_physics_character_states
            .reserve(handles.len() / 2);
        for h in handles.chunks_exact(2) {
            let e = entity(h);
            let record = CharacterStateRecord::new(
                e,
                self.unified_character_state(e).map_err(|e| e.to_string())?,
            );
            self.unified_physics_character_states.push(record);
        }
        Ok(())
    }
    pub fn unified_physics_character_state_stride_words(&self) -> usize {
        WORDS
    }
    pub fn unified_physics_character_state_count(&self) -> usize {
        self.unified_physics_character_states.len()
    }
    pub fn unified_physics_character_state_ptr(&self) -> *const u32 {
        self.unified_physics_character_states.as_ptr().cast()
    }
}

mod file_output_admission;
