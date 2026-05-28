use wasm_bindgen::prelude::*;

use crate::collision::CollisionSystem;
use crate::components::{
    CollisionMask, DistanceJointId, GearJointId, PrismaticJointId, PulleyJointId, RevoluteJointId,
    RopeJointId, SpringJointId, Transform2D, WeldJointId,
};

use super::super::physics_bridge::{
    PhysicsBodyColliderSnapshot, PhysicsEntitySnapshot, PhysicsJointSnapshot, PhysicsQueryResult,
    PhysicsRigidContactImpulseHit,
};
use super::super::{
    Engine, PHYSICS_JOINT_DISTANCE, PHYSICS_JOINT_GEAR, PHYSICS_JOINT_PRISMATIC,
    PHYSICS_JOINT_PULLEY, PHYSICS_JOINT_REVOLUTE, PHYSICS_JOINT_ROPE, PHYSICS_JOINT_SPRING,
    PHYSICS_JOINT_WELD,
};

#[wasm_bindgen]
impl Engine {
    pub fn physics_body_collider_count(&self, entity_id: u32, entity_generation: u32) -> u32 {
        self.entity_from_handle(entity_id, entity_generation)
            .map(|entity| self.world.compound_collider_count(entity) as u32)
            .unwrap_or(0)
    }

    pub fn query_physics_body_collider(
        &mut self,
        entity_id: u32,
        entity_generation: u32,
        collider_index: u32,
    ) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            self.physics_body_collider_snapshot = PhysicsBodyColliderSnapshot::default();
            return false;
        };
        let Some(snapshot) = self.physics_body_collider_snapshot(entity, collider_index) else {
            self.physics_body_collider_snapshot = PhysicsBodyColliderSnapshot::default();
            return false;
        };
        self.physics_body_collider_snapshot = snapshot;
        true
    }

    pub fn query_physics_entity(&mut self, entity_id: u32, entity_generation: u32) -> bool {
        let Some(entity) = self.entity_from_handle(entity_id, entity_generation) else {
            self.physics_entity_snapshot = PhysicsEntitySnapshot::default();
            return false;
        };
        self.store_physics_entity_snapshot(entity)
    }

    pub fn query_physics_joint(
        &mut self,
        joint_type: u32,
        joint_index: u32,
        joint_generation: u32,
    ) -> bool {
        let found = match joint_type {
            PHYSICS_JOINT_DISTANCE => self
                .world
                .distance_joint(DistanceJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_distance_joint_snapshot(
                        DistanceJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_ROPE => self
                .world
                .rope_joint(RopeJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_rope_joint_snapshot(
                        RopeJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_SPRING => self
                .world
                .spring_joint(SpringJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_spring_joint_snapshot(
                        SpringJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_PULLEY => self
                .world
                .pulley_joint(PulleyJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_pulley_joint_snapshot(
                        PulleyJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_REVOLUTE => self
                .world
                .revolute_joint(RevoluteJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_revolute_joint_snapshot(
                        RevoluteJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_PRISMATIC => self
                .world
                .prismatic_joint(PrismaticJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_prismatic_joint_snapshot(
                        PrismaticJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_WELD => self
                .world
                .weld_joint(WeldJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_weld_joint_snapshot(
                        WeldJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            PHYSICS_JOINT_GEAR => self
                .world
                .gear_joint(GearJointId {
                    index: joint_index,
                    generation: joint_generation,
                })
                .map(|joint| {
                    self.store_gear_joint_snapshot(
                        GearJointId {
                            index: joint_index,
                            generation: joint_generation,
                        },
                        joint,
                    )
                }),
            _ => None,
        };
        found.unwrap_or_else(|| {
            self.physics_joint_snapshot = PhysicsJointSnapshot::default();
            false
        })
    }

    pub fn query_nearest_body(
        &mut self,
        x: f32,
        y: f32,
        max_distance: f32,
        query_mask_bits: u32,
    ) -> bool {
        let Some(hit) = CollisionSystem::nearest_body_query(
            &self.world,
            Transform2D { x, y },
            max_distance,
            CollisionMask::from_bits(query_mask_bits),
        ) else {
            self.physics_query_result = PhysicsQueryResult::default();
            return false;
        };

        self.physics_query_result = PhysicsQueryResult {
            entity_id: hit.entity.id,
            entity_generation: hit.entity.generation,
            tile_layer_index: 0,
            tile_index: 0,
            point_x: hit.point_x,
            point_y: hit.point_y,
            distance: hit.distance,
        };
        true
    }

    pub fn query_body_contacts(&mut self, category_a_bits: u32, category_b_bits: u32) -> u32 {
        CollisionSystem::build_mask_contacts_into(
            &mut self.physics_collision_query_scratch,
            &self.world,
            CollisionMask::from_bits(category_a_bits),
            CollisionMask::from_bits(category_b_bits),
            &mut self.physics_body_contact_scratch,
        );
        self.store_physics_body_contacts_from_scratch()
    }

    pub fn query_body_manifolds(&mut self, category_a_bits: u32, category_b_bits: u32) -> u32 {
        CollisionSystem::build_mask_manifolds_into(
            &mut self.physics_collision_query_scratch,
            &self.world,
            CollisionMask::from_bits(category_a_bits),
            CollisionMask::from_bits(category_b_bits),
            &mut self.physics_body_manifold_scratch,
        );
        self.store_physics_body_manifolds_from_scratch()
    }

    pub fn query_rigid_contact_impulses(&mut self) -> u32 {
        self.physics_rigid_contact_impulse_hits.clear();
        self.physics_rigid_contact_impulse_hits.extend(
            self.world
                .rigid_contact_impulses()
                .map(PhysicsRigidContactImpulseHit::from_rigid_contact_impulse),
        );
        u32::try_from(self.physics_rigid_contact_impulse_hits.len()).unwrap_or(u32::MAX)
    }
}
