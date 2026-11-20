//! Read-only local avoidance checks. This is a steering forecast, not a second
//! movement solver: the character tick still resolves actual coupled contacts.
use super::colliders::native_collider;
use super::types::{valid_pose, valid_vector};
use super::world::{native_id, native_pose};
use super::{BodyId, PhysicsError, PhysicsWorld3d, Pose};
use rapier3d::parry::query::{cast_shapes, ShapeCastOptions};
use rapier3d::prelude as rp;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct CharacterCrowdPeer {
    pub body: BodyId,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub velocity: [f32; 3],
}

#[cfg(test)]
mod tests;
pub(crate) struct CharacterCrowdCheck {
    pub clear: bool,
    pub tests: u32,
}

impl PhysicsWorld3d {
    /// Actual capsule center and its lowest point along a unit plane normal.
    /// Includes both local placement and the requested hypothetical body pose.
    pub(crate) fn character_plane_support(
        &self,
        id: BodyId,
        pose: Pose,
        normal: [f32; 3],
    ) -> Result<([f32; 3], [f32; 3]), PhysicsError> {
        let n = rp::Vector::from(normal);
        if !valid_pose(pose) || !valid_vector(&normal) || (n.length_squared() - 1.).abs() > 1e-5 {
            return Err(PhysicsError::InvalidQuery);
        }
        self.character_state(id)?;
        let c = &self.backend.colliders[native_collider(self.characters[&id].collider)];
        let capsule = c
            .shape()
            .as_capsule()
            .ok_or(PhysicsError::InvalidCharacter)?;
        let at = native_pose(pose)
            * c.position_wrt_parent()
                .ok_or(PhysicsError::InvalidCharacter)?;
        let a = at * capsule.segment.a;
        let b = at * capsule.segment.b;
        let lowest = if a.dot(n) < b.dot(n) { a } else { b };
        Ok((
            ((a + b) * 0.5).to_array(),
            (lowest - n * capsule.radius).to_array(),
        ))
    }
    pub(crate) fn character_crowd_radius(&self, id: BodyId) -> Result<f32, PhysicsError> {
        self.character_state(id)?;
        self.backend.colliders[native_collider(self.characters[&id].collider)]
            .shape()
            .as_capsule()
            .map(|c| c.radius)
            .ok_or(PhysicsError::InvalidCharacter)
    }

    /// Forecast a finite translation against current peer capsules and their
    /// observed velocities. Caller admits bounded peer-count work first.
    pub(crate) fn character_crowd_clear(
        &self,
        id: BodyId,
        pose: Pose,
        translation: [f32; 3],
        seconds: f32,
        padding: f32,
        peers: &[CharacterCrowdPeer],
    ) -> Result<CharacterCrowdCheck, PhysicsError> {
        self.character_crowd_clear_masked(id, pose, translation, seconds, padding, peers, 0)
    }

    /// Exclude rows only from an already-admitted long forecast. The caller
    /// still checks all rows for the next actual tick with the direct query.
    /// Tests count visited rows, so excluded rows do not spend geometry work.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn character_crowd_clear_masked(
        &self,
        id: BodyId,
        pose: Pose,
        translation: [f32; 3],
        seconds: f32,
        padding: f32,
        peers: &[CharacterCrowdPeer],
        excluded: u64,
    ) -> Result<CharacterCrowdCheck, PhysicsError> {
        if !valid_pose(pose)
            || !valid_vector(&translation)
            || !seconds.is_finite()
            || !(0. ..=60.).contains(&seconds)
            || !padding.is_finite()
            || !(0. ..=4096.).contains(&padding)
            || peers.len() > 64
            || peers.len() < 64 && excluded >> peers.len() != 0
        {
            return Err(PhysicsError::InvalidQuery);
        }
        self.character_state(id)?;
        let source = &self.characters[&id];
        let a = &self.backend.colliders[native_collider(source.collider)];
        let source_body = &self.backend.bodies[native_id(id)];
        if !source_body.is_enabled() || !a.is_enabled() || a.is_sensor() {
            return Err(PhysicsError::InvalidCharacter);
        }
        let at = native_pose(pose)
            * a.position_wrt_parent()
                .ok_or(PhysicsError::InvalidCharacter)?;
        let mut result = CharacterCrowdCheck {
            clear: true,
            tests: 0,
        };
        for (index, peer) in peers.iter().enumerate() {
            if excluded != 0 && excluded & (1u64 << index) != 0 {
                continue;
            }
            if peer.body == id {
                continue;
            }
            result.tests += 1;
            let Some(other) = self.characters.get(&peer.body) else {
                continue;
            };
            let Some(body) = self.backend.bodies.get(native_id(peer.body)) else {
                continue;
            };
            let Some(b) = self.backend.colliders.get(native_collider(other.collider)) else {
                continue;
            };
            if !body.is_enabled()
                || !b.is_enabled()
                || b.is_sensor()
                || !a.collision_groups().test(b.collision_groups())
                || !self.contact_policies.pair_allows(a.parent(), b.parent())
            {
                continue;
            }
            let bt = *body.position()
                * b.position_wrt_parent()
                    .ok_or(PhysicsError::InvalidCharacter)?;
            if !self.contact_policies.one_way_allows_at(
                native_collider(other.collider),
                &bt,
                a.shape(),
                &at,
            ) {
                continue;
            }
            if !valid_vector(&peer.velocity) {
                return Err(PhysicsError::InvalidQuery);
            }
            let relative =
                rp::Vector::from(translation) - rp::Vector::from(peer.velocity) * seconds;
            let margin = padding + source.config.skin_width.max(other.config.skin_width);
            if let Some(contact) = super::character_geometry::contact(a, &at, b, &bt, margin) {
                // An existing padding overlap must permit separating/tangent
                // motion; otherwise a dense group could never recover.
                if relative.dot(contact.normal1) <= 0. {
                    continue;
                }
                result.clear = false;
                return Ok(result);
            }
            let hit = cast_shapes(
                &at,
                relative,
                a.shape(),
                &bt,
                rp::Vector::ZERO,
                b.shape(),
                ShapeCastOptions {
                    max_time_of_impact: 1.,
                    target_distance: margin,
                    stop_at_penetration: true,
                    compute_impact_geometry_on_penetration: true,
                },
            )
            .map_err(|_| PhysicsError::InvalidQuery)?;
            if hit.is_some_and(|hit| hit.time_of_impact < 1.) {
                result.clear = false;
                return Ok(result);
            }
        }
        Ok(result)
    }
}
