impl BreakoutScene {
    /// Fixed dependency of this build's native scene/particle generation code;
    /// it is not a persisted catalog or proof of a loaded platform texture.
    pub(crate) const fn file_program_texture_id() -> u32 {
        config::DEFAULT_TEXTURE_ID
    }
}

mod config;
mod effects;
mod file_admission;
mod level;
mod runtime;

#[cfg(test)]
mod tests;

use crate::collision::CircleQueryHit;
use crate::entity::Entity;
use crate::game_state::GameState;

use config::{BRICK_COLUMNS, BRICK_ROWS};

pub(crate) use effects::{breakout_brick_hit_particle_preset, BreakoutParticleBurstSink};
pub(crate) use runtime::{BreakoutHit, BreakoutHitKind, BreakoutPaddlePlan};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct BreakoutScene {
    game_state: GameState,
    score: u32,
    paddle: Option<Entity>,
    ball: Option<Entity>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    bricks: Vec<Entity>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    walls: Vec<Entity>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    marked_for_despawn: Vec<bool>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    pending_despawn: Vec<Entity>,
    #[serde(with = "crate::checkpoint_codec::vector")]
    area_damage_hits: Vec<CircleQueryHit>,
}

impl Default for BreakoutScene {
    fn default() -> Self {
        Self {
            game_state: GameState::Title,
            score: 0,
            paddle: None,
            ball: None,
            bricks: Vec::with_capacity((BRICK_COLUMNS * BRICK_ROWS) as usize),
            walls: Vec::with_capacity(3),
            marked_for_despawn: Vec::new(),
            pending_despawn: Vec::with_capacity(1),
            area_damage_hits: Vec::new(),
        }
    }
}

impl BreakoutScene {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn score(&self) -> u32 {
        self.score
    }

    pub(crate) fn paddle_entity(&self) -> Option<Entity> {
        self.paddle
    }

    pub(crate) fn ball_entity(&self) -> Option<Entity> {
        self.ball
    }

    pub(crate) fn game_state(&self) -> GameState {
        self.game_state
    }
}

#[cfg(test)]
impl BreakoutScene {
    pub(crate) fn corrupt_builtin_file_fixture(&mut self, case: usize) {
        match case {
            0 => self.bricks.push(self.bricks[0]),
            1 => self.ball = self.paddle,
            2 => self.bricks[0].id = u32::MAX,
            3 => self.paddle = None,
            4 => self.area_damage_hits.push(CircleQueryHit {
                entity: Entity {
                    id: u32::MAX,
                    generation: 0,
                },
            }),
            _ => unreachable!(),
        }
    }
}
