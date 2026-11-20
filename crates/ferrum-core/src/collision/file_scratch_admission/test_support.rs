use super::*;
use crate::components::*;
use crate::physics::{PhysicsSystem, RigidBodyStepConfig};
pub(crate) fn limits() -> Limits {
    Limits {
        max_work: 10_000_000,
        max_scratch_bytes: 10_000_000,
    }
}
pub(crate) fn bytes<T: serde::Serialize>(v: &T) -> Vec<u8> {
    crate::checkpoint_codec::encode(v).unwrap()
}
pub(crate) fn restored<T: serde::Serialize + serde::de::DeserializeOwned>(v: &T) -> T {
    crate::checkpoint_codec::decode(&bytes(v)).unwrap()
}
pub(crate) fn check_budgets(mut check: impl FnMut(Limits) -> Result<Usage, Error>) {
    let used = check(limits()).unwrap();
    assert_eq!(
        check(Limits {
            max_work: used.work,
            max_scratch_bytes: used.scratch_bytes
        }),
        Ok(used)
    );
    assert_eq!(
        check(Limits {
            max_work: used.work - 1,
            max_scratch_bytes: used.scratch_bytes
        }),
        Err(Error::WorkLimit)
    );
    if used.scratch_bytes > 0 {
        assert_eq!(
            check(Limits {
                max_work: used.work,
                max_scratch_bytes: used.scratch_bytes - 1
            }),
            Err(Error::ScratchLimit)
        );
    }
}
pub(crate) fn config() -> RigidBodyStepConfig {
    RigidBodyStepConfig {
        gravity: Velocity { vx: 0.0, vy: 10.0 },
        contact_split_impulse: true,
        continuous: true,
        ..RigidBodyStepConfig::default()
    }
}
pub(crate) fn fixture() -> (World, Vec<Entity>) {
    let mut w = World::default();
    let mut es = Vec::new();
    for (i, (x, y)) in [
        (0.0, 4.0),
        (0.0, 2.5),
        (1.5, 2.7),
        (40.0, 0.0),
        (12.0, 0.0),
        (16.0, 0.0),
        (20.0, 0.0),
        (24.0, 0.0),
        (28.0, 0.0),
        (32.0, 0.0),
    ]
    .into_iter()
    .enumerate()
    {
        let e = w.spawn_entity();
        w.set_transform(e, Transform2D { x, y });
        w.set_aabb_collider(
            e,
            AabbCollider::new(
                if i == 0 { 20.0 } else { 1.0 },
                1.0,
                false,
                CollisionLayer::Wall,
            ),
        );
        w.set_rigid_body(
            e,
            if i == 1 || i == 2 {
                RigidBody::dynamic(1.0)
            } else {
                RigidBody::static_body()
            },
        );
        es.push(e);
    }
    w.set_velocity(es[1], Velocity { vx: 1.0, vy: 3.0 });
    w.set_velocity(es[2], Velocity { vx: -1.0, vy: 2.0 });
    w.set_aabb_collider(
        es[3],
        AabbCollider::new(-1.0, 0.0, false, CollisionLayer::Wall),
    );
    w.set_circle_collider(es[4], CircleCollider::new(1.0, false, CollisionLayer::Wall));
    w.set_oriented_box_collider(
        es[5],
        OrientedBoxCollider::new(1.0, 2.0, 0.25, false, CollisionLayer::Wall),
    );
    w.set_capsule_collider(
        es[6],
        CapsuleCollider::new(-1.0, 0.0, 1.0, 0.0, 0.5, false, CollisionLayer::Wall),
    );
    w.set_edge_collider(
        es[7],
        EdgeCollider::new(-1.0, 0.0, 1.0, 1.0, false, CollisionLayer::Wall),
    );
    let mut v = [Transform2D::default(); MAX_CONVEX_POLYGON_VERTICES];
    v[0] = Transform2D { x: -1.0, y: -1.0 };
    v[1] = Transform2D { x: 1.0, y: -1.0 };
    v[2] = Transform2D { x: 0.0, y: 1.0 };
    w.set_convex_polygon_collider(
        es[8],
        ConvexPolygonCollider::new(v, 3, false, CollisionLayer::Wall),
    );
    let mut v = [Transform2D::default(); MAX_CHAIN_COLLIDER_VERTICES];
    v[0] = Transform2D { x: -1.0, y: 0.0 };
    v[1] = Transform2D { x: 0.0, y: 1.0 };
    v[2] = Transform2D { x: 1.0, y: 0.0 };
    w.set_chain_collider(
        es[9],
        ChainCollider::new(v, 3, false, false, CollisionLayer::Wall),
    );
    (w, es)
}
pub(crate) fn warm_world() -> (World, Vec<Entity>) {
    let (mut w, es) = fixture();
    for _ in 0..2 {
        PhysicsSystem::step_rigid_bodies_with_config(&mut w, 0.01, config());
    }
    (w, es)
}
struct SavedWorld<'a>(&'a World);
impl serde::Serialize for SavedWorld<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        crate::world::persistence::State::serialize(self.0, s)
    }
}
#[derive(serde::Deserialize)]
struct RestoredWorld(#[serde(with = "crate::world::persistence::State")] World);
pub(crate) fn world_bytes(w: &World) -> Vec<u8> {
    bytes(&SavedWorld(w))
}
pub(crate) fn restored_world(w: &World) -> World {
    crate::checkpoint_codec::decode::<RestoredWorld>(&world_bytes(w))
        .unwrap()
        .0
}
