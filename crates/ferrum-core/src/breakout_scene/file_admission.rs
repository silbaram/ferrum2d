use super::*;
use crate::engine::file_builtin_scenes_admission::{
    entity, entity_history, require, Budget, Error, Problem,
};
use crate::world::World;
impl BreakoutScene {
    pub(crate) fn validate_file(&self, w: &World, b: &mut Budget) -> Result<(), Error> {
        let Self {
            game_state: _,
            score: _,
            paddle: _,
            ball: _,
            bricks: _,
            walls: _,
            marked_for_despawn: _,
            pending_despawn: _,
            area_damage_hits: _,
        } = self;
        b.work(9)?;
        b.vector(&self.bricks)?;
        b.vector(&self.walls)?;
        b.vector(&self.marked_for_despawn)?;
        b.vector(&self.pending_despawn)?;
        b.vector(&self.area_damage_hits)?;
        let initialized = self.paddle.is_some();
        require(
            self.ball.is_some() == initialized
                && if initialized {
                    self.walls.len() == 3
                        && self.bricks.len() == (BRICK_COLUMNS * BRICK_ROWS) as usize
                } else {
                    self.walls.is_empty() && self.bricks.is_empty()
                },
            "builtin_breakout",
            "level_layout",
            0,
            Problem::Layout,
        )?;
        let n = self.bricks.len() + self.walls.len() + usize::from(initialized) * 2;
        b.work(n)?;
        b.sort(n)?;
        let mut keys = b.reserve::<(u32, u32)>(n)?;
        for (i, e) in self
            .paddle
            .iter()
            .chain(&self.ball)
            .chain(&self.walls)
            .chain(&self.bricks)
            .copied()
            .enumerate()
        {
            entity(w, e, "builtin_breakout", "level_entities", i)?;
            keys.push((e.id, e.generation));
        }
        keys.sort_unstable();
        require(
            keys.windows(2).all(|p| p[0] != p[1]),
            "builtin_breakout",
            "level_entities",
            0,
            Problem::Duplicate,
        )?;
        require(
            self.marked_for_despawn.len() <= w.entity_capacity(),
            "builtin_breakout",
            "marked",
            0,
            Problem::Length,
        )?;
        for (i, &e) in self.pending_despawn.iter().enumerate() {
            entity(w, e, "builtin_breakout", "pending_despawn", i)?;
        }
        for (i, h) in self.area_damage_hits.iter().enumerate() {
            require(
                entity_history(w, h.entity),
                "builtin_breakout",
                "area_damage_hits",
                i,
                Problem::Reference,
            )?;
        }
        Ok(())
    }
}
