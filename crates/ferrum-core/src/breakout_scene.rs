mod config;
mod effects;
mod level;
mod runtime;

#[cfg(test)]
mod tests;

use crate::entity::Entity;
use crate::game_state::GameState;

use config::{BRICK_COLUMNS, BRICK_ROWS};

pub(crate) use effects::{breakout_brick_hit_particle_preset, BreakoutParticleBurstSink};

#[derive(Debug)]
pub(crate) struct BreakoutScene {
    game_state: GameState,
    score: u32,
    paddle: Option<Entity>,
    ball: Option<Entity>,
    bricks: Vec<Entity>,
    walls: Vec<Entity>,
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

    pub(crate) fn game_state(&self) -> GameState {
        self.game_state
    }
}
