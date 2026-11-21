use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
impl DataSceneGameplay {
    pub(in crate::engine) fn validate_file(
        &self,
        world: &World,
        scene: &crate::spatial_scene::SpatialScene,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            combat: _,
            enabled: _,
            interaction_input_action: _,
            previous_input: _,
            collision_scratch: _,
            collision_pairs: _,
        } = self;
        b.work(6)?;
        b.work(9)?;
        let i = self.previous_input;
        require(
            [i.w, i.a, i.s, i.d, i.space, i.enter, i.mouse_left]
                .iter()
                .all(|v| *v <= 1)
                && finite(&[i.mouse_x, i.mouse_y]),
            "data_gameplay",
            "previous_input",
            0,
            Problem::Number,
        )?;
        let used = self
            .collision_scratch
            .validate_file(world, b.remaining())
            .map_err(Error::from)?;
        b.nested(used)?;
        b.vector(&self.collision_pairs)?;
        b.product(self.collision_pairs.len(), 4)?;
        for (i, p) in self.collision_pairs.iter().enumerate() {
            require(
                p.a.id != p.b.id,
                "data_gameplay",
                "collision_pairs",
                i,
                Problem::Reference,
            )?;
        }
        self.combat.validate_file(world, scene, b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    impl DataSceneGameplay {
        pub(in crate::engine) fn corrupt_file_fixture(&mut self, case: u32) {
            if case == 18 {
                self.previous_input.mouse_x = f32::NAN;
            } else {
                self.combat.corrupt_file_fixture(case);
            }
        }
    }
}
