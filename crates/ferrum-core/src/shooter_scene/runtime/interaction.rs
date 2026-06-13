use crate::world::World;

use super::super::ShooterScene;
use super::GameplayEventSink;

impl ShooterScene {
    pub(in crate::shooter_scene) fn emit_player_interactions(
        &mut self,
        world: &mut World,
        mut events: Option<&mut GameplayEventSink<'_>>,
    ) {
        let Some(player) = world.player_entity() else {
            return;
        };
        let Some(player_transform) = world.transform(player) else {
            return;
        };
        if !world.has_interactions() {
            return;
        }

        for index in 0..world.entity_capacity() {
            let Some(interaction) = world.interaction_at_index(index) else {
                continue;
            };
            if interaction.once && interaction.consumed {
                continue;
            }
            if !world.is_alive_index(index) {
                continue;
            }
            let Some(transform) = world.transform_at_index(index) else {
                continue;
            };
            let dx = transform.x - player_transform.x;
            let dy = transform.y - player_transform.y;
            if dx.mul_add(dx, dy * dy) > interaction.radius * interaction.radius {
                continue;
            }

            let Some(source) = world.entity_at_index(index) else {
                continue;
            };
            let consumed_this_frame = interaction.once;
            if let Some(event_sink) = events.as_mut() {
                event_sink.push_interaction_once_per_frame(
                    player,
                    source,
                    interaction.action_id,
                    interaction.once,
                    consumed_this_frame,
                );
            }
            if interaction.once {
                if let Some(stored) = world.interaction_mut_at_index(index) {
                    stored.consumed = true;
                }
            }
        }
    }
}
