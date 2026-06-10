use wasm_bindgen::prelude::*;

use crate::input::INPUT_ACTION_REGISTRY_SNAPSHOT_U32S;
use crate::shooter_scene::{
    ShooterEntitySnapshot, ShooterSceneSnapshot, SHOOTER_SNAPSHOT_ENTITY_FLOATS,
    SHOOTER_SNAPSHOT_ENTITY_U32S, SHOOTER_SNAPSHOT_HEADER_FLOATS, SHOOTER_SNAPSHOT_HEADER_U32S,
    SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET,
};

use super::scenes::{ActiveScene, SceneMode};
use super::{
    Engine, PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY, PHYSICS_BODY_SNAPSHOT_HANDLE_U32S,
    PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY,
};

#[wasm_bindgen]
impl Engine {
    pub fn physics_body_snapshot_floats_per_body(&self) -> usize {
        PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY
    }

    pub fn physics_body_snapshot_u32s_per_body(&self) -> usize {
        PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY
    }

    pub fn physics_body_snapshot_float_ptr(&self) -> *const f32 {
        self.physics_body_snapshot_floats.as_ptr()
    }

    pub fn physics_body_snapshot_float_len(&self) -> usize {
        self.physics_body_snapshot_floats.len()
    }

    pub fn physics_body_snapshot_u32_ptr(&self) -> *const u32 {
        self.physics_body_snapshot_u32s.as_ptr()
    }

    pub fn physics_body_snapshot_u32_len(&self) -> usize {
        self.physics_body_snapshot_u32s.len()
    }

    pub fn shooter_snapshot_header_floats(&self) -> usize {
        SHOOTER_SNAPSHOT_HEADER_FLOATS
    }

    pub fn shooter_snapshot_header_u32s(&self) -> usize {
        SHOOTER_SNAPSHOT_HEADER_U32S
    }

    pub fn shooter_snapshot_entity_floats(&self) -> usize {
        SHOOTER_SNAPSHOT_ENTITY_FLOATS
    }

    pub fn shooter_snapshot_entity_u32s(&self) -> usize {
        SHOOTER_SNAPSHOT_ENTITY_U32S
    }

    pub fn shooter_snapshot_header_float_ptr(&self) -> *const f32 {
        self.shooter_snapshot_header_floats.as_ptr()
    }

    pub fn shooter_snapshot_header_float_len(&self) -> usize {
        self.shooter_snapshot_header_floats.len()
    }

    pub fn shooter_snapshot_header_u32_ptr(&self) -> *const u32 {
        self.shooter_snapshot_header_u32s.as_ptr()
    }

    pub fn shooter_snapshot_header_u32_len(&self) -> usize {
        self.shooter_snapshot_header_u32s.len()
    }

    pub fn shooter_snapshot_entity_float_ptr(&self) -> *const f32 {
        self.shooter_snapshot_entity_floats.as_ptr()
    }

    pub fn shooter_snapshot_entity_float_len(&self) -> usize {
        self.shooter_snapshot_entity_floats.len()
    }

    pub fn shooter_snapshot_entity_u32_ptr(&self) -> *const u32 {
        self.shooter_snapshot_entity_u32s.as_ptr()
    }

    pub fn shooter_snapshot_entity_u32_len(&self) -> usize {
        self.shooter_snapshot_entity_u32s.len()
    }

    pub fn capture_shooter_snapshot(&mut self) -> bool {
        if self.scene_mode != SceneMode::BuiltIn || self.scenes.active() != ActiveScene::Shooter {
            self.clear_shooter_snapshot_buffers();
            return false;
        }
        let mut snapshot = self.scenes.shooter.snapshot(&self.world, &self.camera);
        if !self.input_actions.write_snapshot(
            &mut snapshot.header_u32s[SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
                ..SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
                    + INPUT_ACTION_REGISTRY_SNAPSHOT_U32S],
        ) {
            self.clear_shooter_snapshot_buffers();
            return false;
        }
        self.store_shooter_snapshot(&snapshot);
        true
    }

    pub fn restore_shooter_snapshot(
        &mut self,
        header_floats: Vec<f32>,
        header_u32s: Vec<u32>,
        entity_floats: Vec<f32>,
        entity_u32s: Vec<u32>,
    ) -> bool {
        if header_floats.len() != SHOOTER_SNAPSHOT_HEADER_FLOATS
            || header_u32s.len() != SHOOTER_SNAPSHOT_HEADER_U32S
            || !entity_floats
                .len()
                .is_multiple_of(SHOOTER_SNAPSHOT_ENTITY_FLOATS)
            || !entity_u32s
                .len()
                .is_multiple_of(SHOOTER_SNAPSHOT_ENTITY_U32S)
            || entity_floats.len() / SHOOTER_SNAPSHOT_ENTITY_FLOATS
                != entity_u32s.len() / SHOOTER_SNAPSHOT_ENTITY_U32S
        {
            return false;
        }

        let mut snapshot = ShooterSceneSnapshot {
            header_floats: [0.0; SHOOTER_SNAPSHOT_HEADER_FLOATS],
            header_u32s: [0; SHOOTER_SNAPSHOT_HEADER_U32S],
            entities: Vec::with_capacity(entity_u32s.len() / SHOOTER_SNAPSHOT_ENTITY_U32S),
        };
        snapshot.header_floats.copy_from_slice(&header_floats);
        snapshot.header_u32s.copy_from_slice(&header_u32s);
        for (floats, u32s) in entity_floats
            .chunks_exact(SHOOTER_SNAPSHOT_ENTITY_FLOATS)
            .zip(entity_u32s.chunks_exact(SHOOTER_SNAPSHOT_ENTITY_U32S))
        {
            let mut entity = ShooterEntitySnapshot {
                floats: [0.0; SHOOTER_SNAPSHOT_ENTITY_FLOATS],
                u32s: [0; SHOOTER_SNAPSHOT_ENTITY_U32S],
            };
            entity.floats.copy_from_slice(floats);
            entity.u32s.copy_from_slice(u32s);
            snapshot.entities.push(entity);
        }

        let Some(input_actions) = crate::input::InputActionRegistry::from_snapshot(
            &snapshot.header_u32s[SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
                ..SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
                    + INPUT_ACTION_REGISTRY_SNAPSHOT_U32S],
        ) else {
            return false;
        };
        let restored = self.scenes.shooter.restore_snapshot(
            &mut self.world,
            &mut self.camera,
            &mut self.audio_events,
            &snapshot,
        );
        if restored {
            self.activate_built_in_shooter_scene();
            self.input_actions = input_actions;
            self.particles.clear();
            self.tweens.clear();
            self.clear_physics_history();
        }
        restored
    }

    pub fn capture_physics_body_snapshot_bulk(&mut self, handles: Vec<u32>) -> bool {
        if !handles
            .len()
            .is_multiple_of(PHYSICS_BODY_SNAPSHOT_HANDLE_U32S)
        {
            self.clear_physics_body_snapshot_buffers();
            return false;
        }
        let body_count = handles.len() / PHYSICS_BODY_SNAPSHOT_HANDLE_U32S;
        let mut snapshots = Vec::with_capacity(body_count);
        for chunk in handles.chunks_exact(PHYSICS_BODY_SNAPSHOT_HANDLE_U32S) {
            let Some(entity) = self.entity_from_handle(chunk[0], chunk[1]) else {
                self.clear_physics_body_snapshot_buffers();
                return false;
            };
            if !self.store_physics_entity_snapshot(entity) {
                self.clear_physics_body_snapshot_buffers();
                return false;
            }
            snapshots.push(self.physics_entity_snapshot);
        }
        self.clear_physics_body_snapshot_buffers();
        self.physics_body_snapshot_floats
            .reserve(body_count * PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY);
        self.physics_body_snapshot_u32s
            .reserve(body_count * PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY);
        for snapshot in snapshots {
            Self::append_physics_body_snapshot_bulk(
                snapshot,
                &mut self.physics_body_snapshot_floats,
                &mut self.physics_body_snapshot_u32s,
            );
        }
        true
    }

    pub fn restore_physics_body_snapshot_bulk(
        &mut self,
        handles: Vec<u32>,
        floats: Vec<f32>,
        u32s: Vec<u32>,
    ) -> bool {
        if !handles
            .len()
            .is_multiple_of(PHYSICS_BODY_SNAPSHOT_HANDLE_U32S)
            || !floats
                .len()
                .is_multiple_of(PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY)
            || !u32s
                .len()
                .is_multiple_of(PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY)
        {
            return false;
        }
        let body_count = handles.len() / PHYSICS_BODY_SNAPSHOT_HANDLE_U32S;
        if floats.len() / PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY != body_count
            || u32s.len() / PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY != body_count
        {
            return false;
        }
        for index in 0..body_count {
            let handle_offset = index * PHYSICS_BODY_SNAPSHOT_HANDLE_U32S;
            let float_offset = index * PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY;
            let u32_offset = index * PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY;
            if !self.restore_physics_body_snapshot_entry(
                handles[handle_offset],
                handles[handle_offset + 1],
                &floats[float_offset..float_offset + PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY],
                &u32s[u32_offset..u32_offset + PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY],
            ) {
                return false;
            }
        }
        true
    }
}

impl Engine {
    fn clear_shooter_snapshot_buffers(&mut self) {
        self.shooter_snapshot_header_floats.clear();
        self.shooter_snapshot_header_u32s.clear();
        self.shooter_snapshot_entity_floats.clear();
        self.shooter_snapshot_entity_u32s.clear();
    }

    fn clear_physics_body_snapshot_buffers(&mut self) {
        self.physics_body_snapshot_floats.clear();
        self.physics_body_snapshot_u32s.clear();
    }

    fn store_shooter_snapshot(&mut self, snapshot: &ShooterSceneSnapshot) {
        self.clear_shooter_snapshot_buffers();

        self.shooter_snapshot_header_floats
            .extend_from_slice(&snapshot.header_floats);
        self.shooter_snapshot_header_u32s
            .extend_from_slice(&snapshot.header_u32s);
        self.shooter_snapshot_entity_floats
            .reserve(snapshot.entities.len() * SHOOTER_SNAPSHOT_ENTITY_FLOATS);
        self.shooter_snapshot_entity_u32s
            .reserve(snapshot.entities.len() * SHOOTER_SNAPSHOT_ENTITY_U32S);
        for entity in &snapshot.entities {
            self.shooter_snapshot_entity_floats
                .extend_from_slice(&entity.floats);
            self.shooter_snapshot_entity_u32s
                .extend_from_slice(&entity.u32s);
        }
    }
}
