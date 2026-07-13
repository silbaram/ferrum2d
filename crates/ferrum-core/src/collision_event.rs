use crate::collision::{CollisionPair, CollisionScratch, CollisionSystem};
use crate::entity::Entity;
use crate::world::World;

pub const COLLISION_EVENT_ENTER: u32 = 1;
pub const COLLISION_EVENT_STAY: u32 = 2;
pub const COLLISION_EVENT_EXIT: u32 = 3;
pub const COLLISION_EVENT_HIT: u32 = 4;
pub const COLLISION_EVENT_TRIGGER_ENTER: u32 = 5;
pub const COLLISION_EVENT_TRIGGER_STAY: u32 = 6;
pub const COLLISION_EVENT_TRIGGER_EXIT: u32 = 7;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CollisionEvent {
    pub kind: u32,
    pub a_id: u32,
    pub a_generation: u32,
    pub b_id: u32,
    pub b_generation: u32,
    pub damage_bits: u32,
}

const _: () = assert!(core::mem::size_of::<CollisionEvent>() == 24);

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CollisionEventCounts {
    pub enter: u32,
    pub stay: u32,
    pub exit: u32,
    pub hit: u32,
    pub trigger_enter: u32,
    pub trigger_stay: u32,
    pub trigger_exit: u32,
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
        self.trigger_enter = self.trigger_enter.saturating_add(other.trigger_enter);
        self.trigger_stay = self.trigger_stay.saturating_add(other.trigger_stay);
        self.trigger_exit = self.trigger_exit.saturating_add(other.trigger_exit);
    }

    pub fn total(self) -> u32 {
        self.enter
            .saturating_add(self.stay)
            .saturating_add(self.exit)
            .saturating_add(self.hit)
            .saturating_add(self.trigger_enter)
            .saturating_add(self.trigger_stay)
            .saturating_add(self.trigger_exit)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct CollisionPairCounts {
    pub total: u32,
    pub solid: u32,
    pub trigger: u32,
}

impl CollisionEvent {
    pub fn from_entities(kind: u32, a: Entity, b: Entity) -> Self {
        Self::from_entities_with_damage(kind, a, b, 0.0)
    }

    pub fn from_entities_with_damage(kind: u32, a: Entity, b: Entity, damage: f32) -> Self {
        Self {
            kind,
            a_id: a.id,
            a_generation: a.generation,
            b_id: b.id,
            b_generation: b.generation,
            damage_bits: sanitize_damage_payload(damage).to_bits(),
        }
    }

    pub fn damage(self) -> f32 {
        f32::from_bits(self.damage_bits)
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
        self.current.extend(
            self.pairs
                .iter()
                .copied()
                .map(|pair| CollisionPairKey::from_pair(world, pair)),
        );
        self.current.sort_unstable();
        self.current.dedup();

        let counts = append_lifecycle_events(&self.previous, &self.current, events);
        std::mem::swap(&mut self.previous, &mut self.current);
        self.current.clear();
        counts
    }

    pub fn current_pair_counts(&self) -> CollisionPairCounts {
        let mut counts = CollisionPairCounts::default();
        for key in &self.previous {
            counts.total = counts.total.saturating_add(1);
            if key.is_trigger {
                counts.trigger = counts.trigger.saturating_add(1);
            } else {
                counts.solid = counts.solid.saturating_add(1);
            }
        }
        counts
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct CollisionPairKey {
    a_id: u32,
    a_generation: u32,
    b_id: u32,
    b_generation: u32,
    is_trigger: bool,
}

impl CollisionPairKey {
    fn from_pair(world: &World, pair: CollisionPair) -> Self {
        let a = entity_key(pair.a);
        let b = entity_key(pair.b);
        let (a, b) = if a <= b { (a, b) } else { (b, a) };
        Self {
            a_id: a.0,
            a_generation: a.1,
            b_id: b.0,
            b_generation: b.1,
            is_trigger: pair_is_trigger(world, pair),
        }
    }

    fn to_event(self, solid_kind: u32, trigger_kind: u32) -> CollisionEvent {
        CollisionEvent::from_entities(
            if self.is_trigger {
                trigger_kind
            } else {
                solid_kind
            },
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
                events
                    .push(current_key.to_event(COLLISION_EVENT_STAY, COLLISION_EVENT_TRIGGER_STAY));
                if current_key.is_trigger {
                    counts.trigger_stay = counts.trigger_stay.saturating_add(1);
                } else {
                    counts.stay = counts.stay.saturating_add(1);
                }
                previous_index += 1;
                current_index += 1;
            }
            (Some(previous_key), Some(current_key)) if previous_key < current_key => {
                events.push(
                    previous_key.to_event(COLLISION_EVENT_EXIT, COLLISION_EVENT_TRIGGER_EXIT),
                );
                if previous_key.is_trigger {
                    counts.trigger_exit = counts.trigger_exit.saturating_add(1);
                } else {
                    counts.exit = counts.exit.saturating_add(1);
                }
                previous_index += 1;
            }
            (Some(_), Some(current_key)) => {
                events.push(
                    current_key.to_event(COLLISION_EVENT_ENTER, COLLISION_EVENT_TRIGGER_ENTER),
                );
                if current_key.is_trigger {
                    counts.trigger_enter = counts.trigger_enter.saturating_add(1);
                } else {
                    counts.enter = counts.enter.saturating_add(1);
                }
                current_index += 1;
            }
            (Some(previous_key), None) => {
                events.push(
                    previous_key.to_event(COLLISION_EVENT_EXIT, COLLISION_EVENT_TRIGGER_EXIT),
                );
                if previous_key.is_trigger {
                    counts.trigger_exit = counts.trigger_exit.saturating_add(1);
                } else {
                    counts.exit = counts.exit.saturating_add(1);
                }
                previous_index += 1;
            }
            (None, Some(current_key)) => {
                events.push(
                    current_key.to_event(COLLISION_EVENT_ENTER, COLLISION_EVENT_TRIGGER_ENTER),
                );
                if current_key.is_trigger {
                    counts.trigger_enter = counts.trigger_enter.saturating_add(1);
                } else {
                    counts.enter = counts.enter.saturating_add(1);
                }
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

fn pair_is_trigger(world: &World, pair: CollisionPair) -> bool {
    entity_has_trigger_collider(world, pair.a.id as usize)
        || entity_has_trigger_collider(world, pair.b.id as usize)
}

fn entity_has_trigger_collider(world: &World, index: usize) -> bool {
    world
        .colliders
        .get(index)
        .copied()
        .flatten()
        .is_some_and(|collider| collider.is_trigger)
        || world
            .circle_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
        || world
            .oriented_box_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
        || world
            .capsule_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
        || world
            .edge_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
        || world
            .convex_polygon_colliders
            .get(index)
            .copied()
            .flatten()
            .is_some_and(|collider| collider.is_trigger)
}

fn sanitize_damage_payload(damage: f32) -> f32 {
    if damage.is_finite() && damage > 0.0 {
        damage
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{
        AabbCollider, CollisionFilter, CollisionLayer, CollisionMask, ConvexPolygonCollider,
        OrientedBoxCollider, Transform2D, MAX_CONVEX_POLYGON_VERTICES,
    };

    #[test]
    fn tracker_reports_enter_stay_and_exit() {
        let mut world = World::default();
        let a = spawn_body(&mut world, 0.0, 0.0, CollisionLayer::Player, false);
        let b = spawn_body(&mut world, 8.0, 0.0, CollisionLayer::Enemy, false);
        let mut tracker = CollisionEventTracker::default();
        let mut events = Vec::new();

        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.enter, 1);
        assert_eq!(counts.trigger_enter, 0);
        assert_eq!(events[0].kind, COLLISION_EVENT_ENTER);
        assert_eq!(events[0].damage(), 0.0);

        events.clear();
        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.stay, 1);
        assert_eq!(counts.trigger_stay, 0);
        assert_eq!(events[0].kind, COLLISION_EVENT_STAY);

        world.set_transform(b, Transform2D { x: 30.0, y: 0.0 });
        events.clear();
        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.exit, 1);
        assert_eq!(counts.trigger_exit, 0);
        assert_eq!(events[0].kind, COLLISION_EVENT_EXIT);
        assert_eq!(events[0].a_id, a.id.min(b.id));
        assert_eq!(events[0].damage_bits, 0);
    }

    #[test]
    fn tracker_reports_trigger_enter_stay_and_exit() {
        let mut world = World::default();
        let sensor = spawn_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let actor = spawn_body(&mut world, 8.0, 0.0, CollisionLayer::Enemy, false);
        let mut tracker = CollisionEventTracker::default();
        let mut events = Vec::new();

        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.enter, 0);
        assert_eq!(counts.trigger_enter, 1);
        assert_eq!(counts.total(), 1);
        assert_eq!(events[0].kind, COLLISION_EVENT_TRIGGER_ENTER);

        events.clear();
        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.stay, 0);
        assert_eq!(counts.trigger_stay, 1);
        assert_eq!(events[0].kind, COLLISION_EVENT_TRIGGER_STAY);

        world.set_transform(actor, Transform2D { x: 30.0, y: 0.0 });
        events.clear();
        let counts = tracker.update(&world, &mut events);
        assert_eq!(counts.exit, 0);
        assert_eq!(counts.trigger_exit, 1);
        assert_eq!(events[0].kind, COLLISION_EVENT_TRIGGER_EXIT);
        assert_eq!(events[0].a_id, sensor.id.min(actor.id));
    }

    #[test]
    fn tracker_classifies_oriented_box_trigger_pairs() {
        let mut world = World::default();
        let sensor = spawn_oriented_box_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let actor = spawn_body(&mut world, 4.0, 0.0, CollisionLayer::Enemy, false);
        let mut tracker = CollisionEventTracker::default();
        let mut events = Vec::new();

        let counts = tracker.update(&world, &mut events);

        assert_eq!(counts.enter, 0);
        assert_eq!(counts.trigger_enter, 1);
        assert_eq!(
            tracker.current_pair_counts(),
            CollisionPairCounts {
                total: 1,
                solid: 0,
                trigger: 1,
            }
        );
        assert_eq!(events[0].kind, COLLISION_EVENT_TRIGGER_ENTER);
        assert_eq!(events[0].a_id, sensor.id.min(actor.id));
    }

    #[test]
    fn tracker_classifies_convex_polygon_trigger_pairs() {
        let mut world = World::default();
        let sensor = spawn_convex_polygon_body(&mut world, 0.0, 0.0, CollisionLayer::Player, true);
        let actor = spawn_body(&mut world, 4.0, 0.0, CollisionLayer::Enemy, false);
        let mut tracker = CollisionEventTracker::default();
        let mut events = Vec::new();

        let counts = tracker.update(&world, &mut events);

        assert_eq!(counts.enter, 0);
        assert_eq!(counts.trigger_enter, 1);
        assert_eq!(
            tracker.current_pair_counts(),
            CollisionPairCounts {
                total: 1,
                solid: 0,
                trigger: 1,
            }
        );
        assert_eq!(events[0].kind, COLLISION_EVENT_TRIGGER_ENTER);
        assert_eq!(events[0].a_id, sensor.id.min(actor.id));
    }

    #[test]
    fn tracker_reports_current_solid_and_trigger_pair_counts() {
        let mut world = World::default();
        spawn_body(&mut world, 0.0, 0.0, CollisionLayer::Player, false);
        spawn_body(&mut world, 8.0, 0.0, CollisionLayer::Enemy, false);
        spawn_body(&mut world, 100.0, 0.0, CollisionLayer::Player, true);
        let trigger_actor = spawn_body(&mut world, 108.0, 0.0, CollisionLayer::Enemy, false);
        let mut tracker = CollisionEventTracker::default();
        let mut events = Vec::new();

        tracker.update(&world, &mut events);

        assert_eq!(
            tracker.current_pair_counts(),
            CollisionPairCounts {
                total: 2,
                solid: 1,
                trigger: 1,
            }
        );

        world.set_transform(trigger_actor, Transform2D { x: 140.0, y: 0.0 });
        events.clear();
        tracker.update(&world, &mut events);

        assert_eq!(
            tracker.current_pair_counts(),
            CollisionPairCounts {
                total: 1,
                solid: 1,
                trigger: 0,
            }
        );
    }

    #[test]
    fn hit_events_can_carry_damage_payload() {
        let a = Entity {
            id: 1,
            generation: 0,
        };
        let b = Entity {
            id: 2,
            generation: 0,
        };

        let event = CollisionEvent::from_entities_with_damage(COLLISION_EVENT_HIT, a, b, 2.5);

        assert_eq!(event.kind, COLLISION_EVENT_HIT);
        assert_eq!(event.damage(), 2.5);
    }

    #[test]
    fn damage_payload_rejects_invalid_values() {
        let a = Entity {
            id: 1,
            generation: 0,
        };
        let b = Entity {
            id: 2,
            generation: 0,
        };

        let negative = CollisionEvent::from_entities_with_damage(COLLISION_EVENT_HIT, a, b, -1.0);
        let infinite =
            CollisionEvent::from_entities_with_damage(COLLISION_EVENT_HIT, a, b, f32::INFINITY);

        assert_eq!(negative.damage(), 0.0);
        assert_eq!(infinite.damage(), 0.0);
    }

    #[test]
    fn event_counts_add_includes_hit_events() {
        let mut counts = CollisionEventCounts {
            enter: 1,
            stay: 2,
            exit: 3,
            hit: 4,
            trigger_enter: 5,
            trigger_stay: 6,
            trigger_exit: 7,
        };

        counts.add(CollisionEventCounts {
            enter: 10,
            stay: 20,
            exit: 30,
            hit: 40,
            trigger_enter: 50,
            trigger_stay: 60,
            trigger_exit: 70,
        });

        assert_eq!(
            counts,
            CollisionEventCounts {
                enter: 11,
                stay: 22,
                exit: 33,
                hit: 44,
                trigger_enter: 55,
                trigger_stay: 66,
                trigger_exit: 77,
            }
        );
        assert_eq!(counts.total(), 308);
    }

    fn spawn_body(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
        is_trigger: bool,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_aabb_collider(
            entity,
            AabbCollider {
                half_width: 5.0,
                half_height: 5.0,
                offset_x: 0.0,
                offset_y: 0.0,
                enabled: true,
                is_trigger,
                layer,
            },
        );
        world.set_collision_filter(
            entity,
            CollisionFilter::new(layer.mask(), CollisionMask::ALL),
        );
        entity
    }

    fn spawn_oriented_box_body(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
        is_trigger: bool,
    ) -> Entity {
        let entity = world.spawn_entity();
        world.set_transform(entity, Transform2D { x, y });
        world.set_oriented_box_collider(
            entity,
            OrientedBoxCollider::new(5.0, 5.0, 0.0, is_trigger, layer),
        );
        world.set_collision_filter(
            entity,
            CollisionFilter::new(layer.mask(), CollisionMask::ALL),
        );
        entity
    }

    fn spawn_convex_polygon_body(
        world: &mut World,
        x: f32,
        y: f32,
        layer: CollisionLayer,
        is_trigger: bool,
    ) -> Entity {
        let entity = world.spawn_entity();
        let mut vertices = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
        vertices[0] = Transform2D { x: -5.0, y: -5.0 };
        vertices[1] = Transform2D { x: 5.0, y: -5.0 };
        vertices[2] = Transform2D { x: 5.0, y: 5.0 };
        vertices[3] = Transform2D { x: -5.0, y: 5.0 };
        world.set_transform(entity, Transform2D { x, y });
        world.set_convex_polygon_collider(
            entity,
            ConvexPolygonCollider::new(vertices, 4, is_trigger, layer),
        );
        world.set_collision_filter(
            entity,
            CollisionFilter::new(layer.mask(), CollisionMask::ALL),
        );
        entity
    }
}
