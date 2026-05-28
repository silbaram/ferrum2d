use crate::collision::{CollisionContact, CollisionManifold, RaycastHit, ShapeCastHit};
use crate::components::RigidContactImpulse;
use crate::entity::Entity;
use crate::tilemap::{TilemapContactHit, TilemapContactManifoldHit, TilemapShapeCastHit};

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PhysicsQueryEntityHit {
    pub entity_id: u32,
    pub entity_generation: u32,
}

impl PhysicsQueryEntityHit {
    pub(in crate::engine) fn from_entity(entity: Entity) -> Self {
        Self {
            entity_id: entity.id,
            entity_generation: entity.generation,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsRaycastBodyHit {
    pub entity_id: u32,
    pub entity_generation: u32,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

impl PhysicsRaycastBodyHit {
    pub(in crate::engine) fn from_raycast_hit(hit: RaycastHit) -> Self {
        Self {
            entity_id: hit.entity.id,
            entity_generation: hit.entity.generation,
            distance: hit.distance,
            point_x: hit.point_x,
            point_y: hit.point_y,
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
        }
    }

    pub(in crate::engine) fn from_shape_cast_hit(hit: ShapeCastHit) -> Self {
        Self {
            entity_id: hit.entity.id,
            entity_generation: hit.entity.generation,
            distance: hit.distance,
            point_x: hit.point_x,
            point_y: hit.point_y,
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsTileShapeCastHit {
    pub tile_layer_index: u32,
    pub tile_index: u32,
    pub distance: f32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
}

impl PhysicsTileShapeCastHit {
    pub(in crate::engine) fn from_tilemap_shape_cast_hit(hit: TilemapShapeCastHit) -> Self {
        Self {
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            distance: hit.distance,
            point_x: hit.point_x,
            point_y: hit.point_y,
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsTileContactHit {
    pub tile_layer_index: u32,
    pub tile_index: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point_x: f32,
    pub point_y: f32,
}

impl PhysicsTileContactHit {
    pub(in crate::engine) fn from_tilemap_contact_hit(hit: TilemapContactHit) -> Self {
        Self {
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
            penetration: hit.penetration,
            point_x: hit.point_x,
            point_y: hit.point_y,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsTileManifoldHit {
    pub tile_layer_index: u32,
    pub tile_index: u32,
    pub point_count: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point0_x: f32,
    pub point0_y: f32,
    pub point0_penetration: f32,
    pub point1_x: f32,
    pub point1_y: f32,
    pub point1_penetration: f32,
}

impl PhysicsTileManifoldHit {
    pub(in crate::engine) fn from_tilemap_contact_manifold_hit(
        hit: TilemapContactManifoldHit,
    ) -> Self {
        Self {
            tile_layer_index: u32::try_from(hit.layer_index).unwrap_or(u32::MAX),
            tile_index: u32::try_from(hit.tile_index).unwrap_or(u32::MAX),
            point_count: hit.point_count,
            normal_x: hit.normal_x,
            normal_y: hit.normal_y,
            penetration: hit.penetration,
            point0_x: hit.points[0].point_x,
            point0_y: hit.points[0].point_y,
            point0_penetration: hit.points[0].penetration,
            point1_x: hit.points[1].point_x,
            point1_y: hit.points[1].point_y,
            point1_penetration: hit.points[1].penetration,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsBodyContactHit {
    pub a_entity_id: u32,
    pub a_entity_generation: u32,
    pub b_entity_id: u32,
    pub b_entity_generation: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point_x: f32,
    pub point_y: f32,
}

impl PhysicsBodyContactHit {
    pub(in crate::engine) fn from_collision_contact(contact: CollisionContact) -> Self {
        Self {
            a_entity_id: contact.pair.a.id,
            a_entity_generation: contact.pair.a.generation,
            b_entity_id: contact.pair.b.id,
            b_entity_generation: contact.pair.b.generation,
            normal_x: contact.normal_x,
            normal_y: contact.normal_y,
            penetration: contact.penetration,
            point_x: contact.point_x,
            point_y: contact.point_y,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsBodyManifoldHit {
    pub a_entity_id: u32,
    pub a_entity_generation: u32,
    pub b_entity_id: u32,
    pub b_entity_generation: u32,
    pub point_count: u32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub penetration: f32,
    pub point0_x: f32,
    pub point0_y: f32,
    pub point0_penetration: f32,
    pub point1_x: f32,
    pub point1_y: f32,
    pub point1_penetration: f32,
}

impl PhysicsBodyManifoldHit {
    pub(in crate::engine) fn from_collision_manifold(manifold: CollisionManifold) -> Self {
        Self {
            a_entity_id: manifold.pair.a.id,
            a_entity_generation: manifold.pair.a.generation,
            b_entity_id: manifold.pair.b.id,
            b_entity_generation: manifold.pair.b.generation,
            point_count: manifold.point_count,
            normal_x: manifold.normal_x,
            normal_y: manifold.normal_y,
            penetration: manifold.penetration,
            point0_x: manifold.points[0].point_x,
            point0_y: manifold.points[0].point_y,
            point0_penetration: manifold.points[0].penetration,
            point1_x: manifold.points[1].point_x,
            point1_y: manifold.points[1].point_y,
            point1_penetration: manifold.points[1].penetration,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PhysicsRigidContactImpulseHit {
    pub a_entity_id: u32,
    pub a_entity_generation: u32,
    pub b_entity_id: u32,
    pub b_entity_generation: u32,
    pub point_x: f32,
    pub point_y: f32,
    pub normal_x: f32,
    pub normal_y: f32,
    pub normal_impulse: f32,
    pub tangent_impulse: f32,
}

impl PhysicsRigidContactImpulseHit {
    pub(in crate::engine) fn from_rigid_contact_impulse(impulse: RigidContactImpulse) -> Self {
        Self {
            a_entity_id: impulse.entity_a.id,
            a_entity_generation: impulse.entity_a.generation,
            b_entity_id: impulse.entity_b.id,
            b_entity_generation: impulse.entity_b.generation,
            point_x: impulse.point_x,
            point_y: impulse.point_y,
            normal_x: impulse.normal_x,
            normal_y: impulse.normal_y,
            normal_impulse: impulse.normal_impulse,
            tangent_impulse: impulse.tangent_impulse,
        }
    }
}
