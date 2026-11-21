use super::*;
use crate::engine::file_data_movement_admission::{invalid, Budget, Error, Owner};

impl DataSceneMovementAnimation {
    pub(in crate::engine) fn validate_file(&self, budget: &mut Budget) -> Result<(), Error> {
        let Self { binding: _ } = self;
        budget.work(1)?;
        let Some(binding) = &self.binding else {
            return Ok(());
        };
        let Binding {
            actor: _,
            poses: _,
            facing: _,
            before: _,
            was_following: _,
        } = binding;
        budget.work(5 + 8 * 3)?;
        if binding.facing > 3 {
            return Err(invalid(Owner::Animation, "facing", 0));
        }
        if binding
            .before
            .is_some_and(|p| !p.x.is_finite() || !p.y.is_finite())
        {
            return Err(invalid(Owner::Animation, "before", 0));
        }
        for (index, pose) in binding.poses.iter().enumerate() {
            let Pose {
                clip: _,
                flip_x: _,
                flip_y: _,
            } = pose;
            if pose.clip > 65535 {
                return Err(invalid(Owner::Animation, "clip", index));
            }
        }
        // Despawn/primary-actor/clip edits may precede the next begin_step.
        // valid_actor/apply_pose already retire such bindings. Keep that history.
        Ok(())
    }

    #[cfg(test)]
    pub(in crate::engine) fn corrupt_file_animation_fixture(&mut self, case: u32) {
        let binding = self
            .binding
            .as_mut()
            .expect("animation fixture has a binding");
        match case {
            0 => binding.facing = 4,
            1 => binding.poses[0].clip = 65536,
            2 => {
                binding.before = Some(Transform2D {
                    x: f32::NAN,
                    y: 0.0,
                })
            }
            _ => unreachable!("known file animation test case"),
        }
    }
}
