use crate::world::World;

use super::super::ShooterScene;
use super::GameplayEventSink;

impl ShooterScene {
    pub(in crate::shooter_scene) fn emit_player_interactions(
        &mut self,
        world: &mut World,
        mut events: Option<&mut GameplayEventSink<'_>>,
    ) {
        let Some(player) = world.player else {
            return;
        };
        let Some(player_transform) = world.transform(player) else {
            return;
        };
        if !world.interactions.iter().any(Option::is_some) {
            return;
        }

        for index in 0..world.interactions.len() {
            let Some(interaction) = world.interactions[index] else {
                continue;
            };
            if interaction.once && interaction.consumed {
                continue;
            }
            if !world.alive.get(index).copied().unwrap_or(false) {
                continue;
            }
            let Some(transform) = world.transforms[index] else {
                continue;
            };
            let dx = transform.x - player_transform.x;
            let dy = transform.y - player_transform.y;
            if dx.mul_add(dx, dy * dy) > interaction.radius * interaction.radius {
                continue;
            }

            let source = crate::entity::Entity {
                id: index as u32,
                generation: world.generations[index],
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
                if let Some(stored) = world.interactions[index].as_mut() {
                    stored.consumed = true;
                }
            }
        }
    }
}
