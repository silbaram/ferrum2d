//! Remaining runtime16 payload after native/World and existing cross-reference
//! admission. Historical cache values are never refreshed or installed here.
use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
use crate::physics::RigidBodyStepConfig;
use crate::physics3d::BodyPrototype;
pub(super) fn config(c: RigidBodyStepConfig, sanitized: bool, b: &mut Budget) -> Result<(), Error> {
    let RigidBodyStepConfig {
        gravity: _,
        velocity_iterations: _,
        position_iterations: _,
        position_correction_percent: _,
        position_correction_slop: _,
        restitution_velocity_threshold: _,
        contact_baumgarte_bias_factor: _,
        max_contact_baumgarte_bias_velocity: _,
        contact_split_impulse: _,
        continuous: _,
    } = c;
    b.work(16)?;
    require(
        finite(&[
            c.gravity.vx,
            c.gravity.vy,
            c.position_correction_percent,
            c.position_correction_slop,
            c.restitution_velocity_threshold,
            c.contact_baumgarte_bias_factor,
            c.max_contact_baumgarte_bias_velocity,
        ]),
        "runtime_payload",
        "step_config",
        0,
        Problem::Number,
    )?;
    if sanitized {
        require(
            (1..=32).contains(&c.velocity_iterations)
                && (1..=32).contains(&c.position_iterations)
                && (0. ..=1.).contains(&c.position_correction_percent)
                && c.position_correction_slop >= 0.
                && c.restitution_velocity_threshold >= 0.
                && (0. ..=1.).contains(&c.contact_baumgarte_bias_factor)
                && c.max_contact_baumgarte_bias_velocity >= 0.,
            "runtime_payload",
            "contact_config",
            0,
            Problem::Range,
        )?;
    }
    Ok(())
}
pub(super) fn pose(p: Pose, space: Space, b: &mut Budget) -> Result<(), Error> {
    // The saved/history helper has no creation-only position magnitude clamp.
    BodyPrototype::validate_file_body_desc(
        &BodyDesc {
            pose: p,
            ..BodyDesc::default()
        },
        space,
        b,
    )
}
pub(super) fn unique<T: Ord + Copy>(
    rows: impl ExactSizeIterator<Item = T>,
    b: &mut Budget,
    owner: &'static str,
    field: &'static str,
) -> Result<(), Error> {
    let n = rows.len();
    b.work(n)?;
    b.sort(n)?;
    let mut values = b.reserve::<T>(n)?;
    values.extend(rows);
    values.sort_unstable();
    b.work(n)?;
    require(
        !values.windows(2).any(|v| v[0] == v[1]),
        owner,
        field,
        0,
        Problem::Duplicate,
    )
}
impl UnifiedPhysicsRuntime {
    pub(in crate::engine) fn validate_file_payload(&self, b: &mut Budget) -> Result<(), Error> {
        // The 16 declared fields are distinct from native/controller/builtin/output
        // participants. Existing file_admission owns inverse/coverage/history links.
        b.work(16)?;
        config(self.previous_auto_config, false, b)?;
        b.product(self.bindings.len(), 6)?;
        for binding in self.bindings.values() {
            let Binding {
                body: _,
                render_offset: _,
                legacy: _,
            } = binding;
            require(
                finite(&binding.render_offset),
                "runtime_payload",
                "render_offset",
                0,
                Problem::Number,
            )?;
            if let Some(c) = &binding.legacy {
                c.validate_file_payload(self.physics.config().space, b)?;
            }
        }
        b.product(self.entities_by_body.len(), 4)?;
        b.vector(&self.retired)?;
        // previous_auto_enabled/shooter_gameplay are bools and last_error is a closed
        // fieldless error enum: valid Rust values are fully checked by bounded decode.
        b.vector(&self.pending_planar)?;
        require(
            self.pending_planar.is_empty() || self.physics.config().space == Space::PlanarXy,
            "runtime_payload",
            "pending_space",
            0,
            Problem::Reference,
        )?;
        for p in &self.pending_planar {
            p.validate_file_payload(&self.physics, b)?;
        }
        b.work(self.legacy_joints.len())?;
        for p in self.legacy_joints.values() {
            p.validate_file_payload(&self.physics, b)?;
        }
        b.vector(&self.pending_joints)?;
        for p in &self.pending_joints {
            p.validate_file_payload(&self.physics, b)?;
        }
        b.vector(&self.retired_joints)?;
        b.product(self.retired_joints.len(), 3)?;
        for (i, key) in self.retired_joints.iter().enumerate() {
            require(
                key.0 < 8,
                "runtime_payload",
                "retired_joint_kind",
                i,
                Problem::Range,
            )?;
        }
        b.work(self.projectiles.len())?;
        for (&key, p) in &self.projectiles {
            p.validate_file_payload(self.physics.config().space, b)?;
            require(
                p.file_hit_matches_actor(key),
                "runtime_projectile",
                "terrain_actor",
                0,
                Problem::Layout,
            )?;
        }
        self.terrain.validate_file_payload(&self.physics, b)?;
        self.platform_motion
            .validate_file_payload(self.physics.config().space, b)?;
        self.dash
            .validate_file_payload(self.physics.config().space, b)?;
        self.automatic_planar.validate_file_payload(b)?;
        Ok(())
    }
}
