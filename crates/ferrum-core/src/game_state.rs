/// Fixed engine lifecycle states exposed through the numeric Wasm scene API.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum GameState {
    Title = 0,
    Playing = 1,
    GameOver = 2,
    Paused = 3,
    LevelComplete = 4,
}

impl GameState {
    /// Returns the stable numeric code used by snapshots and the Wasm facade.
    pub const fn code(self) -> u32 {
        self as u32
    }

    /// Resolves a stable snapshot/Wasm code to an engine state.
    pub const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Title),
            1 => Some(Self::Playing),
            2 => Some(Self::GameOver),
            3 => Some(Self::Paused),
            4 => Some(Self::LevelComplete),
            _ => None,
        }
    }

    /// Returns whether the state freezes simulation until an explicit transition.
    pub const fn freezes_simulation(self) -> bool {
        matches!(self, Self::Paused | Self::LevelComplete)
    }
}

#[cfg(test)]
mod tests {
    use super::GameState;

    #[test]
    fn stable_codes_round_trip_all_fixed_states() {
        for state in [
            GameState::Title,
            GameState::Playing,
            GameState::GameOver,
            GameState::Paused,
            GameState::LevelComplete,
        ] {
            assert_eq!(GameState::from_code(state.code()), Some(state));
        }
        assert_eq!(GameState::from_code(u32::MAX), None);
    }
}
