use super::types::{valid_pose, valid_vector};
use super::world::native_id;
use super::{BodyDesc, BodyId, BodyKind, PhysicsError, PhysicsWorld3d, Pose, Space};
use rapier3d::prelude as rp;

/// Mutable integration properties, independent of a body's pose and velocity.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct BodyOptions {
    /// Fixed, dynamic or one of the kinematic integration modes.
    pub kind: BodyKind,
    /// Disabled bodies do not participate in simulation or queries.
    pub enabled: bool,
    /// Acceleration multiplier, finite and within [-1,000, 1,000].
    pub gravity_scale: f32,
    /// Linear damping from zero through 10,000.
    pub linear_damping: f32,
    /// Angular damping from zero through 10,000.
    pub angular_damping: f32,
    /// Whether the body may automatically sleep.
    pub can_sleep: bool,
    /// Continuous collision detection for fast dynamic bodies.
    pub ccd: bool,
    /// Lock all rotations while preserving authored inertia for later unlocking.
    pub lock_rotation: bool,
}

impl From<&BodyDesc> for BodyOptions {
    fn from(desc: &BodyDesc) -> Self {
        Self {
            kind: desc.kind,
            enabled: true,
            gravity_scale: desc.gravity_scale,
            linear_damping: desc.linear_damping,
            angular_damping: desc.angular_damping,
            can_sleep: desc.can_sleep,
            ccd: desc.ccd,
            lock_rotation: false,
        }
    }
}

impl Default for BodyOptions {
    fn default() -> Self {
        Self::from(&BodyDesc::default())
    }
}

/// Mass properties added to the collider-derived mass properties.
///
/// Set collider density to zero when specifying the complete body mass/inertia,
/// including when preserving legacy 2D area-based mass and polar inertia.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct AdditionalMassProperties {
    /// Nonnegative mass, at most 1,000,000,000.
    pub mass: f32,
    /// Nonnegative moments about the local principal axes, each at most 1e12.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub principal_inertia: [f32; 3],
    /// Body-local center of mass.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub center: [f32; 3],
    /// Unit quaternion orienting the inertia's principal axes, XYZW.
    #[serde(with = "crate::checkpoint_codec::array")]
    pub inertia_rotation: [f32; 4],
}

impl PhysicsWorld3d {
    /// Changes integration properties atomically and wakes the body.
    ///
    /// A controller must be disabled first. Terrain cannot become dynamic.
    /// Rotation locking also clears angular velocity; planar locks are preserved.
    pub fn set_body_options(
        &mut self,
        id: BodyId,
        options: &BodyOptions,
    ) -> Result<(), PhysicsError> {
        if !options.gravity_scale.is_finite()
            || options.gravity_scale.abs() > 1000.0
            || ![options.linear_damping, options.angular_damping]
                .iter()
                .all(|v| v.is_finite() && (0.0..=10000.0).contains(v))
        {
            return Err(PhysicsError::InvalidBody);
        }
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        if self.characters.contains_key(&id) {
            return Err(PhysicsError::CharacterControlled);
        }
        if options.kind == BodyKind::Dynamic
            && body.colliders().iter().any(|id| {
                self.backend.colliders.get(*id).is_some_and(|c| {
                    matches!(
                        c.shape().shape_type(),
                        rapier3d::parry::shape::ShapeType::TriMesh
                            | rapier3d::parry::shape::ShapeType::HeightField
                    )
                })
            })
        {
            return Err(PhysicsError::UnsupportedShape);
        }
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        body.set_body_type(
            match options.kind {
                BodyKind::Fixed => rp::RigidBodyType::Fixed,
                BodyKind::Dynamic => rp::RigidBodyType::Dynamic,
                BodyKind::KinematicPosition => rp::RigidBodyType::KinematicPositionBased,
                BodyKind::KinematicVelocity => rp::RigidBodyType::KinematicVelocityBased,
            },
            true,
        );
        let mut axes = rp::LockedAxes::empty();
        if self.config.space == Space::PlanarXy {
            axes |= rp::LockedAxes::TRANSLATION_LOCKED_Z
                | rp::LockedAxes::ROTATION_LOCKED_X
                | rp::LockedAxes::ROTATION_LOCKED_Y;
        }
        if options.lock_rotation {
            axes |= rp::LockedAxes::ROTATION_LOCKED;
            body.set_angvel(rp::Vector::ZERO, true);
        }
        body.set_locked_axes(axes, true);
        body.set_gravity_scale(options.gravity_scale, true);
        body.set_linear_damping(options.linear_damping);
        body.set_angular_damping(options.angular_damping);
        body.enable_ccd(options.ccd);
        *body.activation_mut() = if options.can_sleep {
            rp::RigidBodyActivation::active()
        } else {
            rp::RigidBodyActivation::cannot_sleep()
        };
        body.set_enabled(options.enabled);
        self.query_updates.extend_from_slice(body.colliders());
        for &id in body.colliders() {
            if let Some(collider) = self.backend.colliders.get_mut(id) {
                // All fixtures in this API are enabled individually. Clear the backend's
                // deferred DisabledByParent flag as well, so queries see re-enabling now.
                collider.set_enabled(false);
                collider.set_enabled(options.enabled);
            }
        }
        if !options.enabled {
            self.invalidate_character_support(Some(id), None);
        }
        Ok(())
    }

    /// Sets additive mass properties and immediately recomputes mass/inertia.
    ///
    /// Zero-density fixtures plus this method specify an exact authored body mass.
    /// Existing collider-derived mass is otherwise retained and added to this input.
    pub fn set_additional_mass_properties(
        &mut self,
        id: BodyId,
        properties: &AdditionalMassProperties,
    ) -> Result<(), PhysicsError> {
        if !properties.mass.is_finite()
            || !(0.0..=1.0e9).contains(&properties.mass)
            || !valid_vector(&properties.center)
            || !properties
                .principal_inertia
                .iter()
                .all(|v| v.is_finite() && (0.0..=1.0e12).contains(v))
            || !valid_pose(Pose {
                position: properties.center,
                rotation: properties.inertia_rotation,
            })
        {
            return Err(PhysicsError::InvalidBody);
        }
        if self.config.space == Space::PlanarXy
            && (properties.center[2] != 0.0
                || properties.inertia_rotation[0] != 0.0
                || properties.inertia_rotation[1] != 0.0)
        {
            return Err(PhysicsError::OutOfPlane);
        }
        let body = self
            .backend
            .bodies
            .get_mut(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        body.set_additional_mass_properties(
            rp::MassProperties::with_principal_inertia_frame(
                properties.center.into(),
                properties.mass,
                properties.principal_inertia.into(),
                rp::Rotation::from_array(properties.inertia_rotation),
            ),
            true,
        );
        body.recompute_mass_properties_from_colliders(&self.backend.colliders);
        Ok(())
    }
}
