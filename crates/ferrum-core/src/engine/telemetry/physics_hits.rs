use wasm_bindgen::prelude::*;

use super::super::{
    Engine, PhysicsBodyContactHit, PhysicsBodyManifoldHit, PhysicsQueryEntityHit,
    PhysicsRaycastBodyHit, PhysicsRigidContactImpulseHit, PhysicsTileContactHit,
    PhysicsTileManifoldHit, PhysicsTileShapeCastHit,
};

#[wasm_bindgen]
impl Engine {
    pub fn physics_query_hit_ptr(&self) -> *const PhysicsQueryEntityHit {
        self.physics_query_hits.as_ptr()
    }

    pub fn physics_query_hit_len(&self) -> usize {
        self.physics_query_hits.len()
    }

    pub fn physics_raycast_hit_ptr(&self) -> *const PhysicsRaycastBodyHit {
        self.physics_raycast_hits.as_ptr()
    }

    pub fn physics_raycast_hit_len(&self) -> usize {
        self.physics_raycast_hits.len()
    }

    pub fn physics_tile_shape_cast_hit_ptr(&self) -> *const PhysicsTileShapeCastHit {
        self.physics_tile_shape_cast_hits.as_ptr()
    }

    pub fn physics_tile_shape_cast_hit_len(&self) -> usize {
        self.physics_tile_shape_cast_hits.len()
    }

    pub fn physics_tile_contact_hit_ptr(&self) -> *const PhysicsTileContactHit {
        self.physics_tile_contact_hits.as_ptr()
    }

    pub fn physics_tile_contact_hit_len(&self) -> usize {
        self.physics_tile_contact_hits.len()
    }

    pub fn physics_tile_manifold_hit_ptr(&self) -> *const PhysicsTileManifoldHit {
        self.physics_tile_manifold_hits.as_ptr()
    }

    pub fn physics_tile_manifold_hit_len(&self) -> usize {
        self.physics_tile_manifold_hits.len()
    }

    pub fn physics_body_contact_hit_ptr(&self) -> *const PhysicsBodyContactHit {
        self.physics_body_contact_hits.as_ptr()
    }

    pub fn physics_body_contact_hit_len(&self) -> usize {
        self.physics_body_contact_hits.len()
    }

    pub fn physics_body_manifold_hit_ptr(&self) -> *const PhysicsBodyManifoldHit {
        self.physics_body_manifold_hits.as_ptr()
    }

    pub fn physics_body_manifold_hit_len(&self) -> usize {
        self.physics_body_manifold_hits.len()
    }

    pub fn physics_rigid_contact_impulse_hit_ptr(&self) -> *const PhysicsRigidContactImpulseHit {
        self.physics_rigid_contact_impulse_hits.as_ptr()
    }

    pub fn physics_rigid_contact_impulse_hit_len(&self) -> usize {
        self.physics_rigid_contact_impulse_hits.len()
    }
}
