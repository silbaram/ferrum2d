use super::*;
use crate::physics3d::{CharacterRouteProfile, FixedQuerySnapshot, PhysicsWorld3d};

#[derive(Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub(super) struct Key {
    pub target: Entity,
    #[serde(with = "crate::checkpoint_codec::array")]
    pub goal: [f32; 3],
    pub floor: u32,
    pub radius: f32,
    pub cell: f32,
    pub profile: CharacterRouteProfile,
}
#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Entry {
    key: Key,
    points: Arc<[Point]>,
}
#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub(super) struct RouteCache {
    #[serde(with = "crate::checkpoint_codec::vector")]
    entries: Vec<Entry>,
    geometry: Option<FixedQuerySnapshot>,
    revision: Option<u32>,
}
impl RouteCache {
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    /// Caller admits the worst-case scan, comparison and recapture before this call.
    pub fn validate(
        &mut self,
        physics: &PhysicsWorld3d,
        scene: &SpatialScene,
        world: &World,
    ) -> bool {
        self.entries
            .retain(|e| world.is_current_entity(e.key.target));
        let changed = self.revision != Some(scene.revision)
            || self
                .geometry
                .as_ref()
                .is_none_or(|g| !physics.fixed_query_snapshot_matches(g));
        if changed {
            self.entries.clear();
            self.geometry = Some(physics.capture_fixed_query_snapshot());
            self.revision = Some(scene.revision);
        }
        changed
    }
    pub fn observe_target(&mut self, target: Entity, goal: [f32; 3], floor: u32) {
        self.entries
            .retain(|e| e.key.target != target || e.key.goal == goal && e.key.floor == floor);
    }
    pub fn find(&self, key: &Key) -> Option<Arc<[Point]>> {
        self.entries
            .iter()
            .rev()
            .find(|e| e.key == *key)
            .map(|e| Arc::clone(&e.points))
    }
    pub fn remove(&mut self, key: &Key) {
        self.entries.retain(|e| e.key != *key);
    }
    pub fn store(&mut self, key: Key, points: Arc<[Point]>) {
        self.entries.retain(|e| e.key != key);
        if self.entries.len() == 8 {
            self.entries.remove(0);
        }
        self.entries.push(Entry { key, points });
    }
}

impl RouteCache {
    pub(super) fn visit_file_route_arcs<'a, E>(
        &'a self,
        visit: &mut impl FnMut(usize, Entity, &'a Arc<[Point]>) -> Result<(), E>,
    ) -> Result<(), E> {
        for (index, entry) in self.entries.iter().enumerate() {
            visit(index, entry.key.target, &entry.points)?;
        }
        Ok(())
    }
    /// Certified same-value rebind only; keys/order/revision/geometry stay stored.
    pub(super) fn rebind_file_route_arcs(&mut self, replace: &mut impl FnMut(&mut Arc<[Point]>)) {
        for entry in &mut self.entries {
            replace(&mut entry.points);
        }
    }
}

mod file_admission;
