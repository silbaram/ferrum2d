use wasm_bindgen::prelude::*;

use crate::gameplay_variables::{GameplayVariableSlab, GAMEPLAY_VARIABLE_SNAPSHOT_U32S};
use crate::input::INPUT_ACTION_REGISTRY_SNAPSHOT_U32S;
use crate::shooter_scene::{
    ShooterEntitySnapshot, ShooterSceneSnapshot, SHOOTER_SNAPSHOT_ENTITY_FLOATS,
    SHOOTER_SNAPSHOT_ENTITY_U32S, SHOOTER_SNAPSHOT_HEADER_FLOATS, SHOOTER_SNAPSHOT_HEADER_U32S,
    SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET, SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET,
};

use super::scenes::{ActiveScene, SceneMode};
use super::{
    Engine, PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY, PHYSICS_BODY_SNAPSHOT_HANDLE_U32S,
    PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY,
};

#[wasm_bindgen]
impl Engine {
    pub fn begin_physics_restore_transaction(&mut self) -> bool {
        if self.physics_restore_transaction.is_some() {
            return false;
        }
        self.physics_restore_transaction = Some(self.world.transaction_snapshot());
        true
    }

    pub fn end_physics_restore_transaction(&mut self, commit: bool) -> bool {
        let Some(snapshot) = self.physics_restore_transaction.take() else {
            return false;
        };
        if !commit {
            self.world.restore_transaction_snapshot(&snapshot);
        } else {
            self.reset_physics_impact_feedback();
            self.clear_physics_history();
        }
        true
    }

    /// Eight f32 values per requested body: force XY, impulse XY, torque,
    /// angular impulse, sleep timer, can-sleep flag. Empty means invalid input.
    pub fn capture_physics_solver_state_bulk(&self, handles: &[u32]) -> Vec<f32> {
        if !handles.len().is_multiple_of(2) {
            return Vec::new();
        }
        let mut values = Vec::with_capacity(handles.len() * 4);
        for h in handles.chunks_exact(2) {
            let Some(body) = self
                .entity_from_handle(h[0], h[1])
                .and_then(|e| self.world.rigid_body(e))
            else {
                return Vec::new();
            };
            values.extend([
                body.force.vx,
                body.force.vy,
                body.impulse.vx,
                body.impulse.vy,
                body.torque,
                body.angular_impulse,
                body.sleep_timer_seconds,
                u8::from(body.can_sleep) as f32,
            ]);
        }
        values
    }

    pub fn restore_physics_solver_state_bulk(
        &mut self,
        handles: &[u32],
        values: &[f32],
        contact_handles: &[u32],
        contacts: &[f32],
    ) -> bool {
        use crate::components::{RigidContactImpulse, Velocity};
        if !handles.len().is_multiple_of(2)
            || values.len() != handles.len() * 4
            || !contact_handles.len().is_multiple_of(4)
            || contacts.len() != contact_handles.len() / 4 * 6
            || values.iter().chain(contacts).any(|v| !v.is_finite())
        {
            return false;
        }
        let mut entities = Vec::with_capacity(handles.len() / 2);
        let mut selected = std::collections::HashSet::new();
        for (h, v) in handles.chunks_exact(2).zip(values.chunks_exact(8)) {
            let Some(entity) = self.entity_from_handle(h[0], h[1]) else {
                return false;
            };
            if self.world.rigid_body(entity).is_none()
                || !selected.insert((entity.id, entity.generation))
                || v[6] < 0.0
                || (v[7] != 0.0 && v[7] != 1.0)
            {
                return false;
            }
            entities.push(entity);
        }
        let mut restored_contacts = Vec::with_capacity(contact_handles.len() / 4);
        for (h, v) in contact_handles
            .chunks_exact(4)
            .zip(contacts.chunks_exact(6))
        {
            if !selected.contains(&(h[0], h[1]))
                || !selected.contains(&(h[2], h[3]))
                || h[..2] == h[2..]
                || v[4] < 0.0
                || (v[2].hypot(v[3]) - 1.0).abs() > 0.01
            {
                return false;
            }
            restored_contacts.push(RigidContactImpulse {
                entity_a: crate::entity::Entity {
                    id: h[0],
                    generation: h[1],
                },
                entity_b: crate::entity::Entity {
                    id: h[2],
                    generation: h[3],
                },
                point_x: v[0],
                point_y: v[1],
                normal_x: v[2],
                normal_y: v[3],
                normal_impulse: v[4],
                tangent_impulse: v[5],
            });
        }
        // Commit only after every handle, accumulator and contact has passed validation.
        for (entity, v) in entities.into_iter().zip(values.chunks_exact(8)) {
            let body = self.world.rigid_bodies[entity.id as usize]
                .as_mut()
                .expect("validated body");
            body.force = Velocity { vx: v[0], vy: v[1] };
            body.impulse = Velocity { vx: v[2], vy: v[3] };
            body.torque = v[4];
            body.angular_impulse = v[5];
            body.sleep_timer_seconds = v[6];
            body.can_sleep = v[7] == 1.0;
        }
        let retained: Vec<_> = self
            .world
            .rigid_contact_impulses()
            .filter(|c| {
                !selected.contains(&(c.entity_a.id, c.entity_a.generation))
                    && !selected.contains(&(c.entity_b.id, c.entity_b.generation))
            })
            .collect();
        self.world.clear_rigid_contact_impulses();
        for c in retained.into_iter().chain(restored_contacts) {
            self.world.record_rigid_contact_impulse(c);
        }
        true
    }

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
        if self.scene_mode != SceneMode::BuiltIn || !self.scenes.is_active(ActiveScene::Shooter) {
            self.clear_shooter_snapshot_buffers();
            return false;
        }
        let mut snapshot = self.scenes.shooter().snapshot(&self.world, &self.camera);
        if !self.input_actions.write_snapshot(
            &mut snapshot.header_u32s[SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
                ..SHOOTER_SNAPSHOT_INPUT_ACTION_REGISTRY_U32_OFFSET
                    + INPUT_ACTION_REGISTRY_SNAPSHOT_U32S],
        ) {
            self.clear_shooter_snapshot_buffers();
            return false;
        }
        if !self.world.gameplay_variable_slab().write_snapshot(
            &mut snapshot.header_u32s[SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET
                ..SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET + GAMEPLAY_VARIABLE_SNAPSHOT_U32S],
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
        let Some(gameplay_variables) = GameplayVariableSlab::from_snapshot(
            &snapshot.header_u32s[SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET
                ..SHOOTER_SNAPSHOT_VARIABLES_U32_OFFSET + GAMEPLAY_VARIABLE_SNAPSHOT_U32S],
        ) else {
            return false;
        };
        let restored = self.scenes.shooter_mut().restore_snapshot(
            &mut self.world,
            &mut self.camera,
            &mut self.frame_buffers.audio_events,
            &snapshot,
        );
        if restored {
            self.reset_physics_impact_feedback();
            self.activate_built_in_shooter_scene();
            self.input_actions = input_actions;
            self.world
                .replace_gameplay_variable_slab(gameplay_variables);
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
            if !self.validate_physics_body_snapshot_entry(
                handles[handle_offset],
                handles[handle_offset + 1],
                &floats[float_offset..float_offset + PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY],
                &u32s[u32_offset..u32_offset + PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY],
            ) {
                return false;
            }
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
        if self.physics_restore_transaction.is_none() {
            self.reset_physics_impact_feedback();
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
