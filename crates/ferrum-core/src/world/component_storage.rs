use super::World;

pub(super) struct WorldComponentStorage;

impl WorldComponentStorage {
    pub(super) fn push_empty_entity(world: &mut World) {
        world.transforms.push(None);
        world.sprites.push(None);
        world.sprite_animations.push(None);
        world.velocities.push(None);
        world.rotations.push(None);
        world.angular_velocities.push(None);
        world.height_spans.push(None);
        world.projectile_arcs.push(None);
        world.rigid_bodies.push(None);
        world.colliders.push(None);
        world.circle_colliders.push(None);
        world.oriented_box_colliders.push(None);
        world.capsule_colliders.push(None);
        world.edge_colliders.push(None);
        world.chain_colliders.push(None);
        world.convex_polygon_colliders.push(None);
        world.compound_colliders.push(Vec::new());
        world.collider_materials.push(None);
        world.collision_filters.push(None);
        world.lifetimes.push(None);
        world.projectile_policies.push(None);
        world.bullet_lifetimes.push(None);
        world.projectile_collision_targets.push(None);
        world.projectile_tile_impacts.push(None);
        world.healths.push(None);
        world.damages.push(None);
        world.score_rewards.push(None);
        world.gameplay_factions.push(None);
        world.gameplay_tags.push(None);
        world.action_bindings.push(None);
        world.pickups.push(None);
        world.interactions.push(None);
        world.movement_patterns.push(None);
        world.collision_reactions.push(None);
        world.behavior_state_machines.push(None);
        world.behavior_state_enter_actions.push(None);
        world.gameplay_timer_triggers.push(None);
    }

    pub(super) fn clear_entity(world: &mut World, index: usize) {
        world.transforms[index] = None;
        world.sprites[index] = None;
        world.sprite_animations[index] = None;
        world.velocities[index] = None;
        world.rotations[index] = None;
        world.angular_velocities[index] = None;
        world.height_spans[index] = None;
        world.projectile_arcs[index] = None;
        world.rigid_bodies[index] = None;
        world.colliders[index] = None;
        world.circle_colliders[index] = None;
        world.oriented_box_colliders[index] = None;
        world.capsule_colliders[index] = None;
        world.edge_colliders[index] = None;
        world.chain_colliders[index] = None;
        world.convex_polygon_colliders[index] = None;
        world.compound_colliders[index].clear();
        world.collider_materials[index] = None;
        world.collision_filters[index] = None;
        world.lifetimes[index] = None;
        world.projectile_policies[index] = None;
        world.bullet_lifetimes[index] = None;
        world.projectile_collision_targets[index] = None;
        world.projectile_tile_impacts[index] = None;
        world.healths[index] = None;
        world.damages[index] = None;
        world.score_rewards[index] = None;
        world.clear_gameplay_query_indices_at_index(index);
        world.action_bindings[index] = None;
        world.pickups[index] = None;
        world.interactions[index] = None;
        world.movement_patterns[index] = None;
        world.collision_reactions[index] = None;
        world.behavior_state_machines[index] = None;
        world.behavior_state_enter_actions[index] = None;
        world.gameplay_timer_triggers[index] = None;
    }
}

#[cfg(test)]
mod tests {
    use super::WorldComponentStorage;
    use crate::components::gameplay::{GameplayFaction, GameplayTags};
    use crate::components::{AabbCollider, CollisionLayer, Transform2D, Velocity};
    use crate::world::World;

    #[test]
    fn push_empty_entity_extends_component_slots() {
        let mut world = World::default();

        WorldComponentStorage::push_empty_entity(&mut world);

        assert_component_slot_len(&world, 1);
        assert_component_slot_empty(&world, 0);
    }

    #[test]
    fn clear_entity_resets_component_slots_and_query_indices() {
        let mut world = World::default();
        let entity = world.spawn_entity();
        let index = entity.id as usize;
        world.transforms[index] = Some(Transform2D { x: 4.0, y: -2.0 });
        world.velocities[index] = Some(Velocity { vx: 10.0, vy: 3.0 });
        world.colliders[index] = Some(AabbCollider::new(6.0, 7.0, false, CollisionLayer::Enemy));
        world.set_gameplay_faction_at_index(index, GameplayFaction::new(2, 0).unwrap());
        world.set_gameplay_tags_at_index(index, GameplayTags::new(0b101).unwrap());

        WorldComponentStorage::clear_entity(&mut world, index);

        assert_component_slot_len(&world, 1);
        assert_component_slot_empty(&world, index);
        assert!(world.gameplay_faction_indices(2).is_empty());
        assert!(world.gameplay_tag_indices(0).is_empty());
        assert!(world.gameplay_tag_indices(2).is_empty());
    }

    fn assert_component_slot_len(world: &World, len: usize) {
        assert_eq!(world.transforms.len(), len);
        assert_eq!(world.sprites.len(), len);
        assert_eq!(world.sprite_animations.len(), len);
        assert_eq!(world.velocities.len(), len);
        assert_eq!(world.rotations.len(), len);
        assert_eq!(world.angular_velocities.len(), len);
        assert_eq!(world.height_spans.len(), len);
        assert_eq!(world.projectile_arcs.len(), len);
        assert_eq!(world.rigid_bodies.len(), len);
        assert_eq!(world.colliders.len(), len);
        assert_eq!(world.circle_colliders.len(), len);
        assert_eq!(world.oriented_box_colliders.len(), len);
        assert_eq!(world.capsule_colliders.len(), len);
        assert_eq!(world.edge_colliders.len(), len);
        assert_eq!(world.chain_colliders.len(), len);
        assert_eq!(world.convex_polygon_colliders.len(), len);
        assert_eq!(world.compound_colliders.len(), len);
        assert_eq!(world.collider_materials.len(), len);
        assert_eq!(world.collision_filters.len(), len);
        assert_eq!(world.lifetimes.len(), len);
        assert_eq!(world.projectile_policies.len(), len);
        assert_eq!(world.bullet_lifetimes.len(), len);
        assert_eq!(world.projectile_collision_targets.len(), len);
        assert_eq!(world.projectile_tile_impacts.len(), len);
        assert_eq!(world.healths.len(), len);
        assert_eq!(world.damages.len(), len);
        assert_eq!(world.score_rewards.len(), len);
        assert_eq!(world.gameplay_factions.len(), len);
        assert_eq!(world.gameplay_tags.len(), len);
        assert_eq!(world.action_bindings.len(), len);
        assert_eq!(world.pickups.len(), len);
        assert_eq!(world.interactions.len(), len);
        assert_eq!(world.movement_patterns.len(), len);
        assert_eq!(world.collision_reactions.len(), len);
        assert_eq!(world.behavior_state_machines.len(), len);
        assert_eq!(world.behavior_state_enter_actions.len(), len);
        assert_eq!(world.gameplay_timer_triggers.len(), len);
    }

    fn assert_component_slot_empty(world: &World, index: usize) {
        assert_eq!(world.transforms[index], None);
        assert_eq!(world.sprites[index], None);
        assert_eq!(world.sprite_animations[index], None);
        assert_eq!(world.velocities[index], None);
        assert_eq!(world.rotations[index], None);
        assert_eq!(world.angular_velocities[index], None);
        assert_eq!(world.height_spans[index], None);
        assert_eq!(world.projectile_arcs[index], None);
        assert_eq!(world.rigid_bodies[index], None);
        assert_eq!(world.colliders[index], None);
        assert_eq!(world.circle_colliders[index], None);
        assert_eq!(world.oriented_box_colliders[index], None);
        assert_eq!(world.capsule_colliders[index], None);
        assert_eq!(world.edge_colliders[index], None);
        assert_eq!(world.chain_colliders[index], None);
        assert_eq!(world.convex_polygon_colliders[index], None);
        assert!(world.compound_colliders[index].is_empty());
        assert_eq!(world.collider_materials[index], None);
        assert_eq!(world.collision_filters[index], None);
        assert_eq!(world.lifetimes[index], None);
        assert_eq!(world.projectile_policies[index], None);
        assert_eq!(world.bullet_lifetimes[index], None);
        assert_eq!(world.projectile_collision_targets[index], None);
        assert_eq!(world.projectile_tile_impacts[index], None);
        assert_eq!(world.healths[index], None);
        assert_eq!(world.damages[index], None);
        assert_eq!(world.score_rewards[index], None);
        assert_eq!(world.gameplay_factions[index], None);
        assert_eq!(world.gameplay_tags[index], None);
        assert_eq!(world.action_bindings[index], None);
        assert_eq!(world.pickups[index], None);
        assert_eq!(world.interactions[index], None);
        assert_eq!(world.movement_patterns[index], None);
        assert_eq!(world.collision_reactions[index], None);
        assert_eq!(world.behavior_state_machines[index], None);
        assert_eq!(world.behavior_state_enter_actions[index], None);
        assert_eq!(world.gameplay_timer_triggers[index], None);
    }
}
