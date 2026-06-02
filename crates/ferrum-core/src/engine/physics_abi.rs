pub(super) const PHYSICS_BODY_TYPE_STATIC: u32 = 0;
pub(super) const PHYSICS_BODY_TYPE_KINEMATIC: u32 = 1;
pub(super) const PHYSICS_BODY_TYPE_DYNAMIC: u32 = 2;

pub(super) const PHYSICS_COLLIDER_TYPE_NONE: u32 = 0;
pub(super) const PHYSICS_COLLIDER_TYPE_AABB: u32 = 1;
pub(super) const PHYSICS_COLLIDER_TYPE_CIRCLE: u32 = 2;
pub(super) const PHYSICS_COLLIDER_TYPE_CAPSULE: u32 = 3;
pub(super) const PHYSICS_COLLIDER_TYPE_ORIENTED_BOX: u32 = 4;
pub(super) const PHYSICS_COLLIDER_TYPE_CONVEX_POLYGON: u32 = 5;
pub(super) const PHYSICS_COLLIDER_TYPE_EDGE: u32 = 6;
pub(super) const PHYSICS_COLLIDER_TYPE_CHAIN: u32 = 7;
pub(super) const PHYSICS_EDGE_BODY_RADIUS: f32 = 0.0001;

pub(super) const PHYSICS_LAYER_PLAYER: u32 = 0;
pub(super) const PHYSICS_LAYER_ENEMY: u32 = 1;
pub(super) const PHYSICS_LAYER_BULLET: u32 = 2;
pub(super) const PHYSICS_LAYER_WALL: u32 = 3;
pub(super) const PHYSICS_LAYER_PICKUP: u32 = 4;

pub(super) const PHYSICS_JOINT_DISTANCE: u32 = 0;
pub(super) const PHYSICS_JOINT_ROPE: u32 = 1;
pub(super) const PHYSICS_JOINT_SPRING: u32 = 2;
pub(super) const PHYSICS_JOINT_REVOLUTE: u32 = 3;
pub(super) const PHYSICS_JOINT_PRISMATIC: u32 = 4;
pub(super) const PHYSICS_JOINT_GEAR: u32 = 5;
pub(super) const PHYSICS_JOINT_WELD: u32 = 6;
pub(super) const PHYSICS_JOINT_PULLEY: u32 = 7;

pub(super) const PHYSICS_BODY_SNAPSHOT_FLOATS_PER_BODY: usize = 31;
pub(super) const PHYSICS_BODY_SNAPSHOT_U32S_PER_BODY: usize = 5;
pub(super) const PHYSICS_BODY_SNAPSHOT_HANDLE_U32S: usize = 2;
pub(super) const PHYSICS_BODY_SNAPSHOT_U32_ENTITY_ID: usize = 0;
pub(super) const PHYSICS_BODY_SNAPSHOT_U32_ENTITY_GENERATION: usize = 1;
pub(super) const PHYSICS_BODY_SNAPSHOT_U32_BODY_TYPE: usize = 2;
pub(super) const PHYSICS_BODY_SNAPSHOT_U32_COLLIDER_TYPE: usize = 3;
pub(super) const PHYSICS_BODY_SNAPSHOT_U32_FLAGS: usize = 4;
pub(super) const PHYSICS_BODY_SNAPSHOT_FLAG_BODY_ENABLED: u32 = 1 << 0;
pub(super) const PHYSICS_BODY_SNAPSHOT_FLAG_SLEEPING: u32 = 1 << 1;
pub(super) const PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_ENABLED: u32 = 1 << 2;
pub(super) const PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_TRIGGER: u32 = 1 << 3;
pub(super) const PHYSICS_BODY_SNAPSHOT_FLAG_COLLIDER_MATERIAL_OVERRIDE: u32 = 1 << 4;
