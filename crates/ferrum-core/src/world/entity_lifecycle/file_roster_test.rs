//! Private boundary seed only. Subsequent despawn/reset/reuse uses real producers;
//! this is not evidence of billions of actual public lifecycle iterations.
use super::*;
impl World {
    pub(crate) fn file_roster_boundary_source_for_test() -> (Self, Entity, Entity) {
        let mut w = Self::default();
        let a = w.spawn_entity();
        let b = w.spawn_entity();
        w.generations[a.id as usize] = u32::MAX - 1;
        let a = Entity {
            id: a.id,
            generation: u32::MAX - 1,
        };
        w.reset_joint_incident_count(a);
        (w, a, b)
    }
}
