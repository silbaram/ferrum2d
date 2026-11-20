use super::super::file_payload_admission as payload;
use super::*;
use crate::gameplay::file_admission::{finite, require, Budget, Error, Problem};
use crate::physics3d::{BodyPrototype, PhysicsWorld3d};
fn options(v: &BodyOptions, space: Space, b: &mut Budget) -> Result<(), Error> {
    let BodyOptions {
        kind: _,
        enabled: _,
        gravity_scale: _,
        linear_damping: _,
        angular_damping: _,
        can_sleep: _,
        ccd: _,
        lock_rotation: _,
    } = v;
    b.work(8)?;
    require(
        v.kind != BodyKind::KinematicPosition,
        "runtime_planar",
        "options_kind",
        0,
        Problem::Layout,
    )?;
    BodyPrototype::validate_file_body_desc(
        &BodyDesc {
            kind: v.kind,
            gravity_scale: v.gravity_scale,
            linear_damping: v.linear_damping,
            angular_damping: v.angular_damping,
            can_sleep: v.can_sleep,
            ccd: v.ccd,
            ..BodyDesc::default()
        },
        space,
        b,
    )
}
fn mass(v: &AdditionalMassProperties, space: Space, b: &mut Budget) -> Result<(), Error> {
    let AdditionalMassProperties {
        mass: _,
        principal_inertia: _,
        center: _,
        inertia_rotation: _,
    } = v;
    b.work(24)?;
    require(
        v.mass.is_finite()
            && (0. ..=1e9).contains(&v.mass)
            && v.principal_inertia
                .iter()
                .all(|n| n.is_finite() && (0. ..=1e12).contains(n))
            && v.center.iter().all(|n| n.is_finite() && n.abs() <= 1e6),
        "runtime_planar",
        "mass",
        0,
        Problem::Number,
    )?;
    payload::pose(
        Pose {
            position: v.center,
            rotation: v.inertia_rotation,
        },
        space,
        b,
    )
}
fn sources(v: &Vec<CompoundCollider>, b: &mut Budget) -> Result<(), Error> {
    b.vector(v)?;
    b.product(v.len(), 256)?;
    for (i, c) in v.iter().enumerate() {
        require(
            World::file_shape_payload_valid(&c.shape)
                && c.material
                    .as_ref()
                    .is_none_or(World::file_material_payload_valid),
            "runtime_planar",
            "source",
            i,
            Problem::Number,
        )?;
    }
    Ok(())
}
impl LegacyBinding {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        space: Space,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            implicit_kinematic: _,
            options: _,
            mass: _,
            sources: _,
            material: _,
            sleeping: _,
            contact_config: _,
            fixtures: _,
        } = self;
        b.work(8)?;
        options(&self.options, space, b)?;
        mass(&self.mass, space, b)?;
        sources(&self.sources, b)?;
        b.work(16)?;
        require(
            World::file_material_payload_valid(&self.material)
                && material_supported(self.material).is_ok(),
            "runtime_planar",
            "material",
            0,
            Problem::Number,
        )?;
        payload::config(self.contact_config, true, b)?;
        b.vector(&self.fixtures)?;
        require(
            !self.implicit_kinematic || self.options.kind == BodyKind::KinematicVelocity,
            "runtime_planar",
            "implicit_kinematic",
            0,
            Problem::Layout,
        )?;
        Ok(())
    }
}
impl PendingBody {
    pub(in crate::engine::unified_physics) fn validate_file_payload(
        &self,
        physics: &PhysicsWorld3d,
        b: &mut Budget,
    ) -> Result<(), Error> {
        let Self {
            implicit_kinematic: _,
            entity: _,
            desc: _,
            options: _,
            mass: _,
            rigid: _,
            contact_config: _,
            fixtures: _,
            span: _,
        } = self;
        b.work(9)?;
        let space = physics.config().space;
        BodyPrototype::validate_file_body_desc(&self.desc, space, b)?;
        b.work(128)?;
        require(
            physics.validate_body_desc(&self.desc).is_ok(),
            "runtime_planar",
            "pending_desc",
            0,
            Problem::Number,
        )?;
        options(&self.options, space, b)?;
        mass(&self.mass, space, b)?;
        b.work(64)?;
        require(
            World::file_rigid_body_payload_valid(&self.rigid)
                && material_supported(self.rigid.material).is_ok()
                && finite(&[
                    self.rigid.force.vx,
                    self.rigid.force.vy,
                    self.rigid.impulse.vx,
                    self.rigid.impulse.vy,
                    self.rigid.torque,
                    self.rigid.angular_impulse,
                ])
                && [
                    self.rigid.force.vx,
                    self.rigid.force.vy,
                    self.rigid.impulse.vx,
                    self.rigid.impulse.vy,
                    self.rigid.torque,
                    self.rigid.angular_impulse,
                ]
                .iter()
                .all(|v| v.abs() <= 1e6),
            "runtime_planar",
            "pending_rigid",
            0,
            Problem::Number,
        )?;
        require(
            self.options.kind == self.desc.kind
                && self.options.gravity_scale == self.desc.gravity_scale
                && self.options.linear_damping == self.desc.linear_damping
                && self.options.angular_damping == self.desc.angular_damping
                && self.options.can_sleep == self.desc.can_sleep
                && self.options.ccd == self.desc.ccd
                && self.options.enabled == self.rigid.enabled
                && self.options.lock_rotation == self.rigid.fixed_rotation
                && (!self.implicit_kinematic || self.options.kind == BodyKind::KinematicVelocity),
            "runtime_planar",
            "pending_options",
            0,
            Problem::Layout,
        )?;
        payload::config(self.contact_config, true, b)?;
        b.work(4)?;
        require(
            self.span.is_none_or(|s| s.valid()),
            "runtime_planar",
            "span",
            0,
            Problem::Number,
        )?;
        if let Some(f) = &self.fixtures {
            let Fixtures {
                sources: _,
                descs: _,
            } = f;
            b.work(2)?;
            sources(&f.sources, b)?;
            b.vector(&f.descs)?;
            for desc in &f.descs {
                BodyPrototype::validate_file_collider_desc(desc, space, b)?;
            }
        }
        Ok(())
    }
}
