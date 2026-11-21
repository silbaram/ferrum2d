//! DTO contracts for cached results. All native identities may be historical.
use super::*;
use crate::physics3d::{
    CcdClamp, ColliderId, ColliderRef, ContactImpulse, JointEvent, JointEventReason,
};

pub(in crate::engine::unified_physics) fn collider(
    v: ColliderRef,
    b: &mut Budget,
) -> Result<(), Error> {
    let ColliderRef {
        collider: _,
        body: _,
        sensor: _,
    } = v;
    b.work(5)
}

pub(in crate::engine::unified_physics) fn impulse(
    v: &ContactImpulse,
    b: &mut Budget,
    i: usize,
) -> Result<(), Error> {
    let ContactImpulse {
        first: _,
        second: _,
        categories: _,
        point: _,
        normal: _,
        normal_impulse: _,
        tangent_impulse: _,
        approach_speed: _,
    } = v;
    b.work(12)?;
    collider(v.first, b)?;
    collider(v.second, b)?;
    f::require(
        v.first.collider != v.second.collider
            && f::finite(&v.point)
            && f::finite(&v.normal)
            && v.normal_impulse.is_finite()
            && v.normal_impulse >= 0.
            && f::finite(&v.tangent_impulse)
            && v.approach_speed.is_finite(),
        "runtime_contacts",
        "native_impulse",
        i,
        Problem::Number,
    )
}

pub(in crate::engine::unified_physics) fn ccd(
    v: &CcdClamp,
    b: &mut Budget,
    i: usize,
) -> Result<(), Error> {
    let CcdClamp {
        moving: _,
        target: _,
        fraction: _,
        sweep_seconds: _,
        point: _,
        normal: _,
    } = v;
    b.work(8)?;
    collider(v.moving, b)?;
    collider(v.target, b)?;
    f::require(
        v.fraction.is_finite()
            && (0. ..=1.).contains(&v.fraction)
            && v.sweep_seconds.is_finite()
            && v.sweep_seconds >= 0.
            && f::finite(&v.point)
            && f::finite(&v.normal),
        "runtime_statistics",
        "ccd",
        i,
        Problem::Number,
    )
}

fn unique(ids: Vec<ColliderId>, b: &mut Budget, owner: &'static str) -> Result<(), Error> {
    let mut ids = ids;
    b.sort(ids.len())?;
    ids.sort_unstable();
    b.work(ids.len())?;
    f::require(
        !ids.windows(2).any(|p| p[0] == p[1]),
        owner,
        "collider_unique",
        0,
        Problem::Duplicate,
    )
}

pub(super) fn queries(r: &UnifiedPhysicsRuntime, b: &mut Budget) -> Result<(), Error> {
    let max = r.physics.config().max_colliders;
    for (len, owner) in [
        (r.native_ray_hits.len(), "runtime_ray"),
        (r.native_point_hits.len(), "runtime_point"),
        (r.native_sweep_hits.len(), "runtime_sweep"),
        (r.native_nearest_hits.len(), "runtime_nearest"),
    ] {
        f::require(len <= max, owner, "length", 0, Problem::Length)?;
    }
    b.vector(&r.native_ray_hits)?;
    let mut ids = b.reserve::<ColliderId>(r.native_ray_hits.len())?;
    for (i, v) in r.native_ray_hits.iter().enumerate() {
        let crate::physics3d::RayHit {
            target: _,
            distance: _,
            point: _,
            normal: _,
        } = v;
        b.work(7)?;
        collider(v.target, b)?;
        f::require(
            v.distance.is_finite()
                && v.distance >= 0.
                && f::finite(&v.point)
                && f::finite(&v.normal),
            "runtime_ray",
            "number",
            i,
            Problem::Number,
        )?;
        if i > 0 {
            let p = &r.native_ray_hits[i - 1];
            f::require(
                p.distance
                    .total_cmp(&v.distance)
                    .then(p.target.collider.cmp(&v.target.collider))
                    .is_le(),
                "runtime_ray",
                "order",
                i,
                Problem::Order,
            )?;
        }
        ids.push(v.target.collider);
    }
    unique(ids, b, "runtime_ray")?;
    b.vector(&r.native_point_hits)?;
    for (i, v) in r.native_point_hits.iter().enumerate() {
        collider(*v, b)?;
        f::require(
            i == 0 || r.native_point_hits[i - 1].collider < v.collider,
            "runtime_point",
            "order",
            i,
            Problem::Order,
        )?;
    }
    b.vector(&r.native_sweep_hits)?;
    let mut ids = b.reserve::<ColliderId>(r.native_sweep_hits.len())?;
    for (i, v) in r.native_sweep_hits.iter().enumerate() {
        let crate::physics3d::SweepHit {
            target: _,
            fraction: _,
            point: _,
            normal: _,
            initial_overlap: _,
        } = v;
        b.work(8)?;
        collider(v.target, b)?;
        f::require(
            v.fraction.is_finite()
                && (0. ..=1.).contains(&v.fraction)
                && f::finite(&v.point)
                && f::finite(&v.normal)
                && v.initial_overlap == (v.fraction == 0.),
            "runtime_sweep",
            "number_overlap",
            i,
            Problem::Number,
        )?;
        // Unsupported pairs can leave an unsorted partial cache before the
        // producer's final sort. No request provenance is stored in this DTO.
        ids.push(v.target.collider);
    }
    unique(ids, b, "runtime_sweep")?;
    b.vector(&r.native_nearest_hits)?;
    let mut ids = b.reserve::<ColliderId>(r.native_nearest_hits.len())?;
    for (i, v) in r.native_nearest_hits.iter().enumerate() {
        let crate::physics3d::PointHit {
            target: _,
            distance: _,
            point: _,
            is_inside: _,
        } = v;
        b.work(5)?;
        collider(v.target, b)?;
        f::require(
            v.distance.is_finite() && v.distance >= 0. && f::finite(&v.point),
            "runtime_nearest",
            "number",
            i,
            Problem::Number,
        )?;
        if i > 0 {
            let p = &r.native_nearest_hits[i - 1];
            f::require(
                p.distance
                    .total_cmp(&v.distance)
                    .then(p.target.collider.cmp(&v.target.collider))
                    .is_le(),
                "runtime_nearest",
                "order",
                i,
                Problem::Order,
            )?;
        }
        ids.push(v.target.collider);
    }
    unique(ids, b, "runtime_nearest")?;
    b.vector(&r.native_contact_manifolds)?;
    let mut previous = None;
    for (i, v) in r.native_contact_manifolds.iter().enumerate() {
        let crate::physics3d::ContactManifold {
            first: _,
            second: _,
            first_subshape: _,
            second_subshape: _,
            normal: _,
            points: _,
        } = v;
        b.work(6)?;
        collider(v.first, b)?;
        collider(v.second, b)?;
        b.vector(&v.points)?;
        let key = (
            v.first.collider,
            v.second.collider,
            v.first_subshape,
            v.second_subshape,
        );
        f::require(
            v.first.collider != v.second.collider
                && v.first.body != v.second.body
                && previous.is_none_or(|p| p <= key)
                && !v.points.is_empty()
                && f::finite(&v.normal),
            "runtime_manifolds",
            "header",
            i,
            Problem::Graph,
        )?;
        previous = Some(key);
        for point in &v.points {
            let crate::physics3d::ContactPoint {
                first: _,
                second: _,
                penetration: _,
            } = point;
            b.work(7)?;
            f::require(
                f::finite(&point.first)
                    && f::finite(&point.second)
                    && point.penetration.is_finite()
                    && point.penetration >= 0.,
                "runtime_manifolds",
                "point",
                i,
                Problem::Number,
            )?;
        }
    }
    Ok(())
}

pub(in crate::engine::unified_physics) fn joint_events(
    rows: &Vec<JointEvent>,
    max: usize,
    b: &mut Budget,
) -> Result<(), Error> {
    b.vector(rows)?;
    f::require(
        rows.len() <= max,
        "runtime_joint_events",
        "length",
        0,
        Problem::Length,
    )?;
    let mut ids = b.reserve::<crate::physics3d::JointId>(rows.len())?;
    for (i, v) in rows.iter().enumerate() {
        let JointEvent {
            joint: _,
            body_a: _,
            body_b: _,
            reason: _,
            reaction: _,
        } = v;
        let crate::physics3d::JointState {
            force: _,
            torque: _,
        } = v.reaction;
        b.work(9)?;
        match v.reason {
            JointEventReason::ForceLimit
            | JointEventReason::TorqueLimit
            | JointEventReason::ForceAndTorqueLimit
            | JointEventReason::Removed
            | JointEventReason::BodyRemoved => {}
        }
        f::require(
            v.reaction.force.is_finite()
                && v.reaction.force >= 0.
                && v.reaction.torque.is_finite()
                && v.reaction.torque >= 0.,
            "runtime_joint_events",
            "reaction",
            i,
            Problem::Number,
        )?;
        ids.push(v.joint);
    }
    b.sort(ids.len())?;
    ids.sort_unstable();
    b.work(ids.len())?;
    f::require(
        !ids.windows(2).any(|p| p[0] == p[1]),
        "runtime_joint_events",
        "identity_unique",
        0,
        Problem::Duplicate,
    )
}

pub(in crate::engine::unified_physics) fn bits<const N: usize>(a: &[f32; N], z: &[f32; N]) -> bool {
    a.iter().zip(z).all(|(a, z)| a.to_bits() == z.to_bits())
}

pub(in crate::engine::unified_physics) fn same_impulse(
    a: &ContactImpulse,
    z: &ContactImpulse,
) -> bool {
    a.first == z.first
        && a.second == z.second
        && a.categories == z.categories
        && bits(&a.point, &z.point)
        && bits(&a.normal, &z.normal)
        && a.normal_impulse.to_bits() == z.normal_impulse.to_bits()
        && bits(&a.tangent_impulse, &z.tangent_impulse)
        && a.approach_speed.to_bits() == z.approach_speed.to_bits()
}

pub(in crate::engine::unified_physics) fn participant_matches(
    p: &crate::engine::unified_physics::collision_stream::Participant,
    target: ColliderRef,
) -> bool {
    p.body == [target.body.slot, target.body.generation]
        && p.collider == [target.collider.slot, target.collider.generation]
        && ((p.flags & 2) != 0) == target.sensor
}
