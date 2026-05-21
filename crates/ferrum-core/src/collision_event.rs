use crate::collision::{CollisionPair, CollisionScratch, CollisionSystem};
use crate::entity::Entity;
use crate::world::World;

pub const COLLISION_EVENT_ENTER: u32 = 1;
pub const COLLISION_EVENT_STAY: u32 = 2;
pub const COLLISION_EVENT_EXIT: u32 = 3;
pub const COLLISION_EVENT_HIT: u32 = 4;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CollisionEvent {
    pub kind: u32,
    pub a_id: u32,
    pub a_generation: u32,
    pub b_id: u32,
    pub b_generation: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CollisionEventCounts {
    pub enter: u32,
    pub stay: u32,
    pub exit: u32,
    pub hit: u32,
}

impl CollisionEventCounts {
    pub fn clear(&mut self) {
        *self = Self::default();
    }

    pub fn add(&mut self, other: Self) {
        self.enter = self.enter.saturating_add(other.enter);
        self.stay = self.stay.saturating_add(other.stay);
        self.exit = self.exit.saturating_add(other.exit);
        self.hit = self.hit.saturating_add(other.hit);
    }

    pub fn total(self) -> u32 {
        self.enter
            .saturating_add(self.stay)
            .saturating_add(self.exit)
            .saturating_add(self.hit)
    }
}

impl CollisionEvent {
    pub fn from_entities(kind: u32, a: Entity, b: Entity) -> Self {
        Self {
            kind,
            a_id: a.id,
            a_generation: a.generation,
            b_id: b.id,
            b_generation: b.generation,
        }
    }
}

#[derive(Debug, Default)]
pub struct CollisionEventTracker {
    scratch: CollisionScratch,
    pairs: Vec<CollisionPair>,
    previous: Vec<CollisionPairKey>,
    current: Vec<CollisionPairKey>,
}

impl CollisionEventTracker {
    pub fn clear(&mut self) {
        self.pairs.clear();
        self.previous.clear();
        self.current.clear();
    }

    pub fn update(
        &mut self,
        world: &World,
        events: &mut Vec<CollisionEvent>,
    ) -> CollisionEventCounts {
        CollisionSystem::build_pairs_into(&mut self.scratch, world, &mut self.pairs);
        self.current.clear();
        self.current
            .extend(self.pairs.iter().copied().map(CollisionPairKey::from_pair));
        self.current.sort_unstable();
        self.current.dedup();

        let counts = append_lifecycle_events(&self.previous, &self.current, events);
        std::mem::swap(&mut self.previous, &mut self.current);
        self.current.clear();
        counts
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct CollisionPairKey {
    a_id: u32,
    a_generation: u32,
    b_id: u32,
    b_generation: u32,
}

impl CollisionPairKey {
    fn from_pair(pair: CollisionPair) -> Self {
        let a = entity_key(pair.a);
        let b = entity_key(pair.b);
        let (a, b) = if a <= b { (a, b) } else { (b, a) };
        Self {
            a_id: a.0,
            a_generation: a.1,
            b_id: b.0,
            b_generation: b.1,
        }
    }

    fn to_event(self, kind: u32) -> CollisionEvent {
        CollisionEvent::from_entities(
            kind,
            Entity {
                id: self.a_id,
                generation: self.a_generation,
            },
            Entity {
                id: self.b_id,
                generation: self.b_generation,
            },
        )
    }
}

fn append_lifecycle_events(
    previous: &[CollisionPairKey],
    current: &[CollisionPairKey],
    events: &mut Vec<CollisionEvent>,
) -> CollisionEventCounts {
    let mut counts = CollisionEventCounts::default();
    let mut previous_index = 0;
    let mut current_index = 0;

    while previous_index < previous.len() || current_index < current.len() {
        let previous_key = previous.get(previous_index).copied();
        let current_key = current.get(current_index).copied();
        match (previous_key, current_key) {
            (Some(previous_key), Some(current_key)) if previous_key == current_key => {
                events.push(current_key.to_event(COLLISION_EVENT_STAY));
                counts.stay = counts.stay.saturating_add(1);
                previous_index += 1;
                current_index += 1;
            }
            (Some(previous_key), Some(current_key)) if previous_key < current_key => {
                events.push(previous_key.to_event(COLLISION_EVENT_EXIT));
                counts.exit = counts.exit.saturating_add(1);
                previous_index += 1;
            }
            (Some(_), Some(current_key)) => {
                events.push(current_key.to_event(COLLISION_EVENT_ENTER));
                counts.enter = counts.enter.saturating_add(1);
                current_index += 1;
            }
            (Some(previous_key), None) => {
                events.push(previous_key.to_event(COLLISION_EVENT_EXIT));
                counts.exit = counts.exit.saturating_add(1);
                previous_index += 1;
            }
            (None, Some(current_key)) => {
                events.push(current_key.to_event(COLLISION_EVENT_ENTER));
                counts.enter = counts.enter.saturating_add(1);
                current_index += 1;
            }
            (None, None) => break,
        }
    }

    counts
}

fn entity_key(entity: Entity) -> (u32, u32) {
    (entity.id, entity.generation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{
        AabbCollider, CollisionFilter, CollisionLayer, CollisionMask, Transform2D,
    };

    #[test]
    fn tracker_reports_enter_stay_and_exit() {
        let mut world = World::default();
        let a = spawn_body(&mut world, 0.0, 0.0, CollisionLayer::Player);
        let b = spawn_body(&mut world, 8.0, 0.0, CollisionLayer::Enemy);
        let mut tracker = CollisionEventTracker::default();
        let mut events = Vec::new();

        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.enter, 1);
        assert_eq!(events[0].kind, COLLISION_EVENT_ENTER);

        events.clear();
        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.stay, 1);
        assert_eq!(events[0].kind, COLLISION_EVENT_STAY);

        world.set_transform(b, Transform2D { x: 30.0, y: 0.0 });
        events.clear();
        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.exit, 1);
        assert_eq!(events[0].kind, COLLISION_EVENT_EXIT);
        assert_eq!(events[0].a_id, a.id.min(b.id));
    }

    #[test]
    fn event_counts_add_includes_hit_events() {
        let mut counts = CollisionEventCounts {
            enter: 1,
            stay: 2,
            exit: 3,
            hit: 4,
        };

        counts.add(CollisionEventCounts {
            enter: 10,
            stay: 20,
            exit: 30,
            hit: 40,
        });

        assert_eq!(
            counts,
            CollisionEventCounts {
                enter: 11,
                stay: 22,
                exit: 33,
                hit: 44,
            }
        );
    }

    fn spawn_body(world: &mut World, x: f32, y: f32, layer: CollisionLayer) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_aabb_collider(
            entity,
            AabbCollider {
                half_width: 5.0,
                half_height: 5.0,
                is_trigger: true,
                layer,
            },
        );
        world.set_collision_filter(
            entity,
            CollisionFilter::new(layer.mask(), CollisionMask::ALL),
        );
        entity
    }
}
