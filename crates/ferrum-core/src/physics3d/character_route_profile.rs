//! Value-based controller compatibility for shared fixed-geometry routes.
use super::colliders::native_collider;
use super::world::native_id;
use super::{BodyId, CharacterConfig, PhysicsError, PhysicsWorld3d, PlanarCollisionSpan};
use rapier3d::prelude as rp;

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct CharacterRouteProfile {
    config: CharacterConfig,
    #[serde(with = "crate::checkpoint_codec::array")]
    capsule: [f32; 7],
    local: rp::Pose,
    #[serde(with = "crate::checkpoint_codec::array")]
    rotation: [f32; 4],
    groups: rp::InteractionGroups,
    span: Option<PlanarCollisionSpan>,
}
impl PhysicsWorld3d {
    pub(crate) fn character_route_profile(
        &self,
        id: BodyId,
    ) -> Result<CharacterRouteProfile, PhysicsError> {
        let config = self.character_config(id)?.clone();
        let body = self
            .backend
            .bodies
            .get(native_id(id))
            .ok_or(PhysicsError::StaleBody)?;
        let runtime = &self.characters[&id];
        let c = self
            .backend
            .colliders
            .get(native_collider(runtime.collider))
            .ok_or(PhysicsError::StaleCollider)?;
        if !body.is_enabled() || !c.is_enabled() || c.is_sensor() {
            return Err(PhysicsError::InvalidCharacter);
        }
        let capsule = c
            .shape()
            .as_capsule()
            .ok_or(PhysicsError::InvalidCharacter)?;
        let a = capsule.segment.a.to_array();
        let b = capsule.segment.b.to_array();
        Ok(CharacterRouteProfile {
            config,
            capsule: [a[0], a[1], a[2], b[0], b[1], b[2], capsule.radius],
            local: *c
                .position_wrt_parent()
                .ok_or(PhysicsError::InvalidCharacter)?,
            rotation: body.rotation().to_array(),
            groups: c.collision_groups(),
            span: self.planar_collision_span(id)?,
        })
    }
}

impl CharacterConfig {
    /// Cold saved-controller numeric contract, independent of a current body.
    pub(crate) fn saved_controller_config_valid(&self) -> bool {
        self.validate(super::Space::Spatial).is_ok()
    }
}
impl CharacterRouteProfile {
    /// Fixed-size payload only. Caller precharges its96 scalar/record allowance.
    pub(crate) fn saved_controller_profile_valid(&self) -> bool {
        let quaternion = |q: [f32; 4]| {
            q.iter().all(|v| v.is_finite())
                && (q.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>() - 1.).abs() <= 1e-5
        };
        self.config.saved_controller_config_valid()
            && self.capsule.iter().all(|v| v.is_finite() && v.abs() <= 1e6)
            && self.capsule[6] > 0.
            && self.config.skin_width < self.capsule[6] * 0.5
            && ((rp::Rotation::from_array(self.rotation) * self.local.rotation) * rp::Vector::Y)
                .dot(self.config.up.into())
                .abs()
                >= 1. - 1e-5
            && self
                .local
                .translation
                .to_array()
                .iter()
                .all(|v| v.is_finite() && v.abs() <= 1e6)
            && quaternion(self.local.rotation.to_array())
            && quaternion(self.rotation)
            && self.span.is_none_or(|s| s.valid())
    }
}

impl CharacterRouteProfile {
    pub(crate) fn saved_controller_config_matches(&self, config: &CharacterConfig) -> bool {
        self.config == *config
    }
}

#[cfg(test)]
mod controller_admission_tests;
