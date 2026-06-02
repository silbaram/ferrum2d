use super::*;
use crate::collision_event::{
    COLLISION_EVENT_ENTER, COLLISION_EVENT_EXIT, COLLISION_EVENT_HIT, COLLISION_EVENT_STAY,
    COLLISION_EVENT_TRIGGER_ENTER, COLLISION_EVENT_TRIGGER_EXIT, COLLISION_EVENT_TRIGGER_STAY,
};
use crate::components::gameplay::{
    ActionBinding, ActionPattern, BehaviorStateEnterAction, BehaviorStateEnterActionPhase,
    BehaviorStateMachine, BehaviorStateTransition, CollisionReaction, CollisionReactionTrigger,
    CollisionTarget, Cooldown, GameplayFaction, GameplayTimerTrigger, Interaction, MovementPattern,
    MovementTarget, Pickup, ProjectileTileImpact, SpawnAnchor, SpawnPhase, GAMEPLAY_FACTION_ENEMY,
    GAMEPLAY_FACTION_PLAYER, GAMEPLAY_PICKUP_ITEM_SCORE,
};
use crate::components::{
    AabbCollider, CollisionFilter, CollisionLayer, CollisionMask, HeightSpan, PhysicsFloorId,
    RigidBody, Transform2D, Velocity,
};
use crate::physics::PhysicsSystem;
use crate::shooter_scene::{EnemyBehavior, EnemySpawnPattern, DEFAULT_TEXTURE_ID};
use crate::{
    GAMEPLAY_EVENT_COLLISION_DAMAGE, GAMEPLAY_EVENT_FLAG_CONSUMED_THIS_FRAME,
    GAMEPLAY_EVENT_FLAG_ONCE, GAMEPLAY_EVENT_FLAG_TARGET_REMOVED, GAMEPLAY_EVENT_INTERACTION,
    GAMEPLAY_EVENT_PICKUP_COLLECTED, GAMEPLAY_EVENT_PREFAB_SPAWNED, GAMEPLAY_EVENT_TILE_IMPACT,
    GAMEPLAY_EVENT_TIMER,
};

mod collision_events;
mod fixed_timestep;
mod particles;
mod physics_body_queries;
mod physics_body_snapshots;
mod physics_debug_abi;
mod physics_joint_controls;
mod physics_queries;
mod physics_rigid_steps;
mod rendering;
mod runtime_outputs;
mod scene_switching;
mod shooter_authoring;
mod shooter_snapshots;

fn count_layer(engine: &Engine, layer: CollisionLayer) -> usize {
    engine
        .world
        .alive
        .iter()
        .enumerate()
        .filter(|(idx, alive)| {
            **alive && engine.world.colliders[*idx].is_some_and(|c| c.layer == layer)
        })
        .count()
}

fn find_layer(engine: &Engine, layer: CollisionLayer) -> crate::entity::Entity {
    engine
        .world
        .alive
        .iter()
        .enumerate()
        .find_map(|(idx, alive)| {
            if *alive && engine.world.colliders[idx].is_some_and(|collider| collider.layer == layer)
            {
                Some(crate::entity::Entity {
                    id: idx as u32,
                    generation: engine.world.generations[idx],
                })
            } else {
                None
            }
        })
        .expect("scene should contain requested collision layer")
}

fn find_lowest_layer(engine: &Engine, layer: CollisionLayer) -> crate::entity::Entity {
    engine
        .world
        .alive
        .iter()
        .enumerate()
        .filter_map(|(idx, alive)| {
            let transform = engine.world.transforms[idx]?;
            if *alive && engine.world.colliders[idx].is_some_and(|collider| collider.layer == layer)
            {
                Some((
                    transform.y,
                    crate::entity::Entity {
                        id: idx as u32,
                        generation: engine.world.generations[idx],
                    },
                ))
            } else {
                None
            }
        })
        .max_by(|(left_y, _), (right_y, _)| left_y.total_cmp(right_y))
        .map(|(_, entity)| entity)
        .expect("scene should contain requested collision layer")
}

fn set_test_particle_preset(
    engine: &mut Engine,
    preset_id: u32,
    texture_id: u32,
    burst_count: u32,
    lifetime_seconds: f32,
) {
    engine.set_particle_preset(
        preset_id,
        texture_id,
        0.0,
        0.0,
        1.0,
        1.0,
        burst_count,
        lifetime_seconds,
        lifetime_seconds,
        0.0,
        0.0,
        6.0,
        6.0,
        6.0,
        6.0,
        1.0,
        0.8,
        0.2,
        1.0,
        1.0,
        0.2,
        0.0,
        0.0,
        0.0,
        0.0,
        0.0,
    );
}

fn spawn_test_body(
    world: &mut World,
    x: f32,
    y: f32,
    layer: CollisionLayer,
) -> crate::entity::Entity {
    spawn_test_body_with_trigger(world, x, y, layer, false)
}

fn spawn_test_body_with_trigger(
    world: &mut World,
    x: f32,
    y: f32,
    layer: CollisionLayer,
    is_trigger: bool,
) -> crate::entity::Entity {
    let entity = world.spawn_entity();
    world.set_transform(entity, Transform2D { x, y });
    world.set_aabb_collider(
        entity,
        AabbCollider {
            half_width: 5.0,
            half_height: 5.0,
            offset_x: 0.0,
            offset_y: 0.0,
            enabled: true,
            is_trigger,
            layer,
        },
    );
    world.set_collision_filter(
        entity,
        CollisionFilter::new(layer.mask(), CollisionMask::ALL),
    );
    entity
}
