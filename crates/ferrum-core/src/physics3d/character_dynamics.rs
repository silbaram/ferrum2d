//! Finite-mass character contacts share the fixed clock with native rigid bodies.
//! Future impacts split the existing tick; impulses are applied only at actual
//! contacts, after accepted static/crowd movement, and never by a preview.
use super::colliders::native_collider;
use super::events::collider_id;
use super::world::native_id;
use super::{BodyId, PhysicsWorld3d};
use rapier3d::parry::bounding_volume::BoundingVolume;
use rapier3d::parry::query::{
    cast_shapes, cast_shapes_nonlinear, contact, NonlinearRigidMotion, ShapeCastOptions,
};
use rapier3d::parry::query::{ContactManifold, DefaultQueryDispatcher, PersistentQueryDispatcher};
use rapier3d::prelude as rp;
use rapier3d::utils::PoseOps;
mod accelerated;
pub(super) mod actual_impulse;
mod native_contacts;

pub(super) fn prediction_band(skin: f32) -> f32 {
    skin * 1.025
}

#[derive(Default)]
pub(super) struct Scratch {
    nodes: Vec<Node>,
    rows: Vec<Row>,
    manifolds: Vec<ContactManifold<(), ()>>,
    accelerated: accelerated::Scratch,
    parents: Vec<usize>,
    coupled: Vec<bool>,
    coasting_frames: Vec<CoastingFrame>,
    native: native_contacts::Scratch,
    // Candidate character rows indexed before sorting. A Native contact on the
    // same receiving body needs a common face frame for the two impulse owners.
    face_normals: Vec<(usize, rp::Vector)>,
    predicting: bool,
}
#[derive(Clone, Copy, Default)]
struct CoastingFrame {
    character_peers: bool,
    native: Option<BodyId>,
}
impl Scratch {
    pub(super) fn coasting_frame(&self, id: BodyId) -> Option<BodyId> {
        if !self.predicting {
            return None;
        }
        let index = self.nodes.binary_search_by_key(&id, |n| n.id).ok()?;
        let frame = self.coasting_frames.get(self.parents[index])?;
        frame.character_peers.then_some(frame.native).flatten()
    }
    /// Native participants of the currently converged character contact graph.
    /// They may receive its impulse through native contacts/joints; an unrelated
    /// dynamic body is not included just because a finite character exists.
    pub(super) fn coupled_native_scan_len(&self) -> usize {
        self.nodes.len()
    }
    pub(super) fn coupled_native_bodies(&self) -> impl Iterator<Item = BodyId> + '_ {
        self.nodes.iter().enumerate().filter_map(|(i, node)| {
            (self.predicting && !node.character && self.is_coupled(i)).then_some(node.id)
        })
    }
    pub(super) fn invalidate(&mut self) {
        self.predicting = false;
    }
    /// An active character row against one supported native receiver.
    pub(super) fn confined_receiver(
        &self,
        body: BodyId,
        collider: super::ColliderId,
        work: &mut super::solver_trajectory::Work,
    ) -> Result<Option<super::ColliderId>, super::solver_trajectory::TrajectoryError> {
        if !self.predicting {
            return Ok(None);
        }
        let height = |len: usize| u64::from(usize::BITS - len.max(1).leading_zeros());
        work.charge(height(self.nodes.len()) + height(self.rows.len()) + 2)?;
        let Ok(a) = self.nodes.binary_search_by_key(&body, |node| node.id) else {
            return Ok(None);
        };
        let start = self.rows.partition_point(|row| row.a < a);
        let mut receiver = None;
        for row in self.rows[start..].iter().take_while(|row| row.a == a) {
            work.charge(1)?;
            let Some((x, y)) = row.pair else { continue };
            if !row.b.is_some_and(|b| self.nodes[b].native_contact) {
                continue;
            }
            let other = if x == collider { y } else { x };
            if receiver.is_some_and(|old| old != other) {
                return Ok(None);
            }
            receiver = Some(other);
        }
        Ok(receiver)
    }
    pub(super) fn contact_limited_translation(
        &self,
        id: BodyId,
        support: Option<rp::RigidBodyHandle>,
        mut planned: rp::Vector,
        gravity: rp::Vector,
        dt: f32,
    ) -> rp::Vector {
        if !self.predicting || planned == rp::Vector::ZERO || gravity == rp::Vector::ZERO {
            return planned;
        }
        let Ok(a) = self.nodes.binary_search_by_key(&id, |node| node.id) else {
            return planned;
        };
        // A touching row owns the physical impulse. Native contacts can still
        // slow its receiver before the next preview. Limit only the character's
        // geometric approach, before the static sweep, for that interval.
        let first = self.rows.partition_point(|r| r.a < a);
        let last = self.rows.partition_point(|r| r.a <= a);
        for patch in self.rows[first..last].chunk_by(|a, b| a.b == b.b) {
            let first = &patch[0];
            let Some(target) = first
                .b
                .filter(|_| first.pair.is_some())
                .map(|b| &self.nodes[b])
            else {
                continue;
            };
            let handle = native_id(target.id);
            if !target.native_contact || Some(handle) == support {
                continue;
            }
            let drag = gravity.length() * dt;
            for row in patch {
                let into = (-planned.dot(row.normal)).max(0.);
                let rate = (-target.point_velocity(row.point).dot(row.normal)).max(0.);
                let allowed = (rate - drag).max(0.) * dt;
                planned += row.normal * (into - allowed).max(0.);
            }
        }
        planned
    }
    fn is_coupled(&self, mut index: usize) -> bool {
        while self.parents[index] != index {
            index = self.parents[index];
        }
        self.coupled.get(index).copied().unwrap_or(false)
    }
    pub(super) fn motion(
        &self,
        body: &rp::RigidBody,
        collider: &rp::Collider,
        gravity: rp::Vector,
        dt: f32,
    ) -> NonlinearRigidMotion {
        if self.predicting {
            if let Some(handle) = collider.parent() {
                let (slot, generation) = handle.into_raw_parts();
                if let Ok(index) = self
                    .nodes
                    .binary_search_by_key(&BodyId { slot, generation }, |n| n.id)
                {
                    if self.is_coupled(index) {
                        let node = &self.nodes[index];
                        let local = collider.position_wrt_parent().copied().unwrap_or_default();
                        return NonlinearRigidMotion::new(
                            *collider.position(),
                            local.inverse() * body.local_center_of_mass(),
                            node.linear * dt,
                            node.angular * dt,
                        );
                    }
                }
            }
        }
        collider_motion(body, collider, gravity, dt)
    }
}
struct Node {
    id: BodyId,
    character: bool,
    linear: rp::Vector,
    angular: rp::Vector,
    initial_linear: rp::Vector,
    initial_angular: rp::Vector,
    inv_mass: rp::Vector,
    inv_inertia: rp::AngularInertia,
    center: rp::Vector,
    visits: usize,
    limited: bool,
    native_contact: bool,
    support_reaction: rp::Vector,
}
struct Row {
    a: usize,
    b: Option<usize>,
    target_velocity: rp::Vector,
    point: rp::Vector,
    normal: rp::Vector,
    impulse: f32,
    minimum_velocity: f32,
    pair: Option<(super::ColliderId, super::ColliderId)>,
}
fn root(parents: &mut [usize], mut node: usize) -> usize {
    while parents[node] != node {
        let parent = parents[node];
        parents[node] = parents[parent];
        node = parents[node];
    }
    node
}

/// Non-consuming prediction. Native integration retains ownership of user force,
/// gravity, damping and angular momentum; this only reads their next-step effect.
fn predicted_velocity(
    body: &rp::RigidBody,
    gravity: rp::Vector,
    dt: f32,
) -> (rp::Vector, rp::Vector) {
    let mass = body.mass_properties();
    let linear = (body.linvel()
        + (body.user_force() + gravity * body.mass() * body.gravity_scale())
            * mass.effective_inv_mass
            * dt)
        / (1. + dt * body.linear_damping());
    let angular = (body.angvel() + mass.effective_world_inv_inertia * body.user_torque() * dt)
        / (1. + dt * body.angular_damping());
    (linear, angular)
}
pub(super) fn predicted_pose(body: &rp::RigidBody, gravity: rp::Vector, dt: f32) -> rp::Pose {
    let (linear, angular) = predicted_velocity(body, gravity, dt);
    let center = body.center_of_mass();
    body.position()
        .append_translation(-center)
        .append_rotation(angular * dt)
        .append_translation(center + linear * dt)
}
pub(super) fn collider_motion(
    body: &rp::RigidBody,
    collider: &rp::Collider,
    gravity: rp::Vector,
    dt: f32,
) -> NonlinearRigidMotion {
    let local = collider.position_wrt_parent().copied().unwrap_or_default();
    let (linear, angular) = predicted_velocity(body, gravity, dt);
    NonlinearRigidMotion::new(
        *collider.position(),
        local.inverse() * body.local_center_of_mass(),
        linear * dt,
        angular * dt,
    )
}

impl Node {
    fn point_velocity(&self, point: rp::Vector) -> rp::Vector {
        self.linear + self.angular.cross(point - self.center)
    }
    fn effective_mass(&self, point: rp::Vector, normal: rp::Vector) -> f32 {
        let angular = (point - self.center).cross(normal);
        normal.dot(normal * self.inv_mass) + angular.dot(self.inv_inertia * angular)
    }
    fn impulse(&mut self, point: rp::Vector, impulse: rp::Vector) {
        self.linear += impulse * self.inv_mass;
        self.angular += self.inv_inertia * (point - self.center).cross(impulse);
    }
}

/// A capsule parallel to a box face has a segment contact patch. GJK may
/// return either segment end; recover both clipped face witnesses so symmetry
/// and the dynamic body's angular effective mass do not depend on that choice.
pub(super) fn capsule_face_patch_at(
    target: &dyn rp::Shape,
    target_pose: &rp::Pose,
    capsule: &dyn rp::Shape,
    capsule_pose: &rp::Pose,
    normal: rp::Vector,
) -> Option<[Option<rp::Vector>; 2]> {
    capsule_face_patch(target, target_pose, capsule, capsule_pose, normal).map(|(points, _)| points)
}

fn capsule_face_patch(
    target: &dyn rp::Shape,
    target_pose: &rp::Pose,
    capsule: &dyn rp::Shape,
    capsule_pose: &rp::Pose,
    normal: rp::Vector,
) -> Option<([Option<rp::Vector>; 2], rp::Vector)> {
    let face = target.as_cuboid()?;
    let shape = capsule.as_capsule()?;
    let n = target_pose.rotation.inverse() * normal;
    let axis = (0..3).max_by(|&a, &b| n[a].abs().total_cmp(&n[b].abs()))?;
    if n[axis].abs() < 1. - 1.0e-5 {
        return None;
    }
    let relative = target_pose.inv_mul(capsule_pose);
    let a = relative * shape.segment.a;
    let b = relative * shape.segment.b;
    let delta = b - a;
    if delta[axis].abs() > 1.0e-5 {
        return None;
    }
    let (mut enter, mut exit): (f32, f32) = (0., 1.);
    for tangent in (0..3).filter(|&t| t != axis) {
        let half = face.half_extents[tangent];
        if delta[tangent].abs() < 1.0e-8 {
            if a[tangent].abs() > half {
                return None;
            }
        } else {
            let x = (-half - a[tangent]) / delta[tangent];
            let y = (half - a[tangent]) / delta[tangent];
            enter = enter.max(x.min(y));
            exit = exit.min(x.max(y));
        }
    }
    if enter > exit {
        return None;
    }
    let point = |t: f32| -> rp::Vector {
        let mut local: rp::Vector = a + delta * t;
        local[axis] = n[axis].signum() * face.half_extents[axis];
        *target_pose * local
    };
    let points = [
        Some(point(enter)),
        (exit - enter > 1.0e-5).then(|| point(exit)),
    ];
    // A parallel segment whose projection overlaps this face has the face
    // normal exactly. Preserve the query normal for oblique or embedded axes.
    let normal = if delta[axis] == 0. && a[axis] * n[axis].signum() >= face.half_extents[axis] {
        let mut local_normal = rp::Vector::ZERO;
        local_normal[axis] = n[axis].signum();
        target_pose.rotation * local_normal
    } else {
        normal
    };
    Some((points, normal))
}

// Solve a centered load across the whole contact graph before row ordering
// introduces torque. The wall and the character can share a body even when
// their impulses are later published by different solvers.
fn centered_contact_patches(nodes: &[Node], rows: &[Row]) -> bool {
    !rows.is_empty()
        && rows
            .chunk_by(|a, b| a.a == b.a && a.b == b.b && a.normal == b.normal)
            .all(|patch| {
                let first = &patch[0];
                let symmetric = |node: &Node| {
                    let arm = |point: rp::Vector| {
                        node.inv_inertia * (point - node.center).cross(first.normal)
                    };
                    node.angular == rp::Vector::ZERO
                        && patch
                            .iter()
                            .zip(patch.iter().rev())
                            .all(|(a, b)| arm(a.point) == -arm(b.point))
                };
                // Characters have no angular degrees of freedom. Their single
                // peer row can transmit the centered load to the next patch.
                let peer = patch.len() == 1
                    && nodes[first.a].character
                    && first.b.is_some_and(|b| nodes[b].character);
                (peer
                    || (matches!(patch.len(), 2 | 4)
                        && first.point != patch[patch.len() - 1].point))
                    && patch.iter().all(|r| {
                        r.minimum_velocity == first.minimum_velocity
                            && (r.b.is_some() || r.target_velocity == first.target_velocity)
                    })
                    && symmetric(&nodes[first.a])
                    && first.b.is_none_or(|i| symmetric(&nodes[i]))
            })
}

/// Shared finite-mass normal-row solve for both current touching contacts and
/// actual backend-interval contacts. This consumes no input, force, gravity,
/// timestep or backend state.
fn solve_rows(
    nodes: &mut [Node],
    rows: &mut [Row],
    acceleration: &mut accelerated::Scratch,
    reserve_retry: impl FnOnce() -> Result<(), super::solver_trajectory::TrajectoryError>,
) -> Result<bool, super::solver_trajectory::TrajectoryError> {
    if centered_contact_patches(nodes, rows)
        && rows.iter().any(|row| {
            let target = row.b.map_or(row.target_velocity, |b| nodes[b].linear);
            (nodes[row.a].linear - target).dot(row.normal) < row.minimum_velocity - 1.0e-5
        })
    {
        if accelerated::solve(nodes, rows, acceleration, true) {
            return Ok(true);
        }
        reserve_retry()?;
    }
    let mut converged = rows.is_empty();
    for pass in 0..64 {
        if pass == 8 && accelerated::solve(nodes, rows, acceleration, false) {
            return Ok(true);
        }
        for row in rows.iter_mut() {
            nodes[row.a].visits += 1;
            if let Some(b) = row.b {
                nodes[b].visits += 1;
            }
            let target = row
                .b
                .map_or(row.target_velocity, |b| nodes[b].point_velocity(row.point));
            let mut relative = (nodes[row.a].point_velocity(row.point) - target).dot(row.normal);
            if row.minimum_velocity != 0. {
                relative -= row.minimum_velocity;
            }
            let denom = nodes[row.a].effective_mass(row.point, row.normal)
                + row
                    .b
                    .map_or(0., |b| nodes[b].effective_mass(row.point, row.normal));
            if denom <= 1.0e-10 {
                continue;
            }
            let next = (row.impulse - relative / denom).max(0.);
            let impulse = row.normal * (next - row.impulse);
            row.impulse = next;
            nodes[row.a].impulse(row.point, impulse);
            if let Some(b) = row.b {
                nodes[b].impulse(row.point, -impulse);
            }
        }
        converged = rows.iter().all(|r| {
            let target =
                r.b.map_or(r.target_velocity, |b| nodes[b].point_velocity(r.point));
            let mut velocity = (nodes[r.a].point_velocity(r.point) - target).dot(r.normal);
            if r.minimum_velocity != 0. {
                velocity -= r.minimum_velocity;
            }
            velocity >= -1.0e-5 && (r.impulse <= 1.0e-6 || velocity.abs() <= 1.0e-5)
        });
        if converged {
            break;
        }
    }
    Ok(converged)
}

impl PhysicsWorld3d {
    /// Solve touching contact islands once before accepting the next native
    /// interval. Character free velocities came from the restored preview.
    pub(super) fn solve_character_dynamic_contacts(&mut self) -> bool {
        if !self.characters.values().any(|r| r.config.push_mass > 0.) {
            return false;
        }
        let mut s = std::mem::take(&mut self.character_dynamics);
        s.nodes.clear();
        s.rows.clear();
        s.face_normals.clear();
        let dt = self.backend.integration_parameters.dt;
        for (handle, body) in self.backend.bodies.iter() {
            if !body.is_enabled() {
                continue;
            }
            let (slot, generation) = handle.into_raw_parts();
            let id = BodyId { slot, generation };
            let character = self.characters.get(&id);
            let (linear, angular, inv_mass, inv_inertia) = if let Some(r) = character {
                let mut inv_mass = rp::Vector::splat(if r.config.push_mass > 0. {
                    1. / r.config.push_mass
                } else {
                    0.
                });
                if self.contact_policies.planar {
                    inv_mass.z = 0.;
                }
                let mut linear = rp::Vector::from(r.free_velocity);
                if let Some((support, _, point)) =
                    r.support_motion.filter(|_| r.config.push_mass > 0.)
                {
                    if let Some(platform) = self.backend.bodies.get(native_id(support)) {
                        // A swept carry displacement is a geometric preview. The
                        // touching rows need the material point's instantaneous
                        // velocity, including when a wall shortens that preview.
                        let (support_linear, support_angular) =
                            predicted_velocity(platform, self.backend.gravity, dt);
                        linear = (linear - rp::Vector::from(r.free_carry_translation) / dt)
                            + (support_linear
                                + support_angular.cross(point - platform.center_of_mass()));
                    }
                }
                (
                    linear,
                    rp::Vector::ZERO,
                    inv_mass,
                    rp::AngularInertia::zero(),
                )
            } else if body.is_dynamic() {
                let (linear, angular) = predicted_velocity(body, self.backend.gravity, dt);
                let mass = body.mass_properties();
                (
                    linear,
                    angular,
                    mass.effective_inv_mass,
                    mass.effective_world_inv_inertia,
                )
            } else {
                continue;
            };
            s.nodes.push(Node {
                id,
                character: character.is_some(),
                linear,
                angular,
                initial_linear: linear,
                initial_angular: angular,
                inv_mass,
                inv_inertia,
                center: body.center_of_mass(),
                visits: 0,
                limited: false,
                native_contact: false,
                support_reaction: rp::Vector::ZERO,
            });
        }
        s.nodes.sort_unstable_by_key(|n| n.id);
        for (&id, r) in &self.characters {
            let Ok(a) = s.nodes.binary_search_by_key(&id, |n| n.id) else {
                continue;
            };
            let Some(collider) = self.backend.colliders.get(native_collider(r.collider)) else {
                continue;
            };
            let queries = self.backend.query_pipeline_with_filter(rp::QueryFilter {
                flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
                groups: Some(collider.collision_groups()),
                exclude_rigid_body: Some(native_id(id)),
                ..Default::default()
            });
            let bounds = collider.compute_aabb().loosened(r.config.skin_width * 1.05);
            let row_start = s.rows.len();
            for (handle, other) in queries.intersect_aabb_conservative(bounds) {
                if s.rows.len() - row_start >= 128 {
                    s.nodes[a].limited = true;
                    break;
                }
                if !other.is_enabled()
                    || !self
                        .contact_policies
                        .pair_allows(collider.parent(), other.parent())
                    || !self.contact_policies.one_way_allows(
                        handle,
                        other,
                        collider.shape(),
                        collider.position(),
                    )
                {
                    continue;
                }
                let Some(body) = other
                    .parent()
                    .and_then(|h| self.backend.bodies.get(h))
                    .filter(|b| b.is_enabled())
                else {
                    continue;
                };
                let target_id = other
                    .parent()
                    .map(|h| {
                        let (slot, generation) = h.into_raw_parts();
                        BodyId { slot, generation }
                    })
                    .expect("body parent checked above");
                let b = s.nodes.binary_search_by_key(&target_id, |n| n.id).ok();
                if b.is_some_and(|b| s.nodes[b].character && b <= a) {
                    continue;
                }
                if body.is_dynamic() && r.config.push_mass <= 0. {
                    continue;
                }
                let skin = self
                    .characters
                    .get(&target_id)
                    .map_or(r.config.skin_width, |other| {
                        r.config.skin_width.max(other.config.skin_width)
                    });
                let pair = body.is_dynamic().then(|| {
                    let x = r.collider;
                    let y = collider_id(handle);
                    if x < y {
                        (x, y)
                    } else {
                        (y, x)
                    }
                });
                if self.characters.contains_key(&target_id) {
                    if let Some(hit) = super::character_geometry::contact(
                        other,
                        other.position(),
                        collider,
                        collider.position(),
                        skin * 1.05,
                    ) {
                        s.rows.push(Row {
                            a,
                            b,
                            target_velocity: body.velocity_at_point(hit.point1),
                            point: hit.point1,
                            normal: hit.normal1,
                            impulse: 0.,
                            minimum_velocity: 0.,
                            pair,
                        });
                    }
                } else {
                    // Use the complete geometric patch. A support-map witness
                    // on an arbitrary capsule end would invent torque in a
                    // symmetric broad-face impact.
                    s.manifolds.clear();
                    if DefaultQueryDispatcher
                        .contact_manifolds(
                            &other.position().inv_mul(collider.position()),
                            other.shape(),
                            collider.shape(),
                            skin * 1.05,
                            &mut s.manifolds,
                            &mut None,
                        )
                        .is_err()
                    {
                        continue;
                    }
                    for manifold in &s.manifolds {
                        if s.rows.len() - row_start >= 128 {
                            s.nodes[a].limited = true;
                            break;
                        }
                        let pose = manifold
                            .subshape_pos1()
                            .map_or(*other.position(), |p| other.position() * p);
                        let mut normal = pose.rotation * manifold.local_n1;
                        if self.contact_policies.planar {
                            normal.z = 0.;
                        }
                        let Some(normal) = normal.try_normalize() else {
                            continue;
                        };
                        if let Some((patch, face_normal)) = capsule_face_patch(
                            other.shape(),
                            other.position(),
                            collider.shape(),
                            collider.position(),
                            normal,
                        ) {
                            for mut point in patch.into_iter().flatten() {
                                if b.is_some()
                                    && face_normal != normal
                                    && (!self.contact_policies.planar || face_normal.z == 0.)
                                {
                                    s.face_normals.push((s.rows.len(), face_normal));
                                }
                                if self.contact_policies.planar {
                                    point.z = 0.;
                                }
                                s.rows.push(Row {
                                    a,
                                    b,
                                    target_velocity: body.velocity_at_point(point),
                                    point,
                                    normal,
                                    impulse: 0.,
                                    minimum_velocity: 0.,
                                    pair,
                                });
                            }
                            continue;
                        }
                        for hit in manifold.points.iter().filter(|p| p.dist <= skin * 1.05) {
                            if s.rows.len() - row_start >= 128 {
                                s.nodes[a].limited = true;
                                break;
                            }
                            let mut point = pose * hit.local_p1;
                            if self.contact_policies.planar {
                                point.z = 0.;
                            }
                            s.rows.push(Row {
                                a,
                                b,
                                target_velocity: body.velocity_at_point(point),
                                point,
                                normal,
                                impulse: 0.,
                                minimum_velocity: 0.,
                                pair,
                            });
                        }
                    }
                }
            }
        }
        native_contacts::collect(
            &self.backend,
            &self.contact_policies,
            &mut s.nodes,
            &mut s.rows,
            &mut s.manifolds,
            &mut s.native,
            self.characters.len().saturating_mul(128),
        );
        // Preserve ordinary crowd response for islands that never touch a
        // finite-mass dynamic pair.
        s.parents.clear();
        s.parents.extend(0..s.nodes.len());
        for row in &s.rows {
            if let Some(b) = row.b {
                let x = root(&mut s.parents, row.a);
                let y = root(&mut s.parents, b);
                s.parents[y] = x;
            }
        }
        s.coupled.clear();
        s.coupled.resize(s.nodes.len(), false);
        for row in &s.rows {
            if row.pair.is_some() {
                s.coupled[root(&mut s.parents, row.a)] = true;
            }
        }
        s.coasting_frames.clear();
        s.coasting_frames
            .resize(s.nodes.len(), CoastingFrame::default());
        for i in 0..s.nodes.len() {
            let parent = root(&mut s.parents, i);
            s.parents[i] = parent;
            if !s.nodes[i].character && s.coupled[parent] {
                s.coasting_frames[parent]
                    .native
                    .get_or_insert(s.nodes[i].id);
            }
        }
        for r in &s.rows {
            if s.nodes[r.a].character && r.b.is_some_and(|b| s.nodes[b].character) {
                s.coasting_frames[s.parents[r.a]].character_peers = true;
            }
        }
        for &(index, normal) in &s.face_normals {
            let row = &mut s.rows[index];
            if row.b.is_some_and(|b| {
                s.nodes[b].native_contact
                    || (s.coasting_frames[s.parents[b]].character_peers
                        && s.nodes[b].angular == rp::Vector::ZERO)
            }) {
                row.normal = normal;
            }
        }
        s.rows.sort_unstable_by(|a, b| {
            a.a.cmp(&b.a)
                .then(a.b.cmp(&b.b))
                .then(a.point.x.total_cmp(&b.point.x))
                .then(a.point.y.total_cmp(&b.point.y))
                .then(a.point.z.total_cmp(&b.point.z))
                .then(a.normal.x.total_cmp(&b.normal.x))
                .then(a.normal.y.total_cmp(&b.normal.y))
                .then(a.normal.z.total_cmp(&b.normal.z))
        });
        s.rows.retain(|row| s.coupled[root(&mut s.parents, row.a)]);
        // A finite contact graph receives at most 64 row sweeps. Failure is
        // observable and leaves the existing conservative motion sweep active.
        let converged = solve_rows(&mut s.nodes, &mut s.rows, &mut s.accelerated, || Ok(()))
            .expect("unmetered contact prediction");
        let mut changed = false;
        let graph_limited = s.nodes.iter().any(|node| node.limited);
        for row in &s.rows {
            if row.pair.is_some() {
                if let Some(b) = row.b {
                    if self.characters.get(&s.nodes[row.a].id).is_some_and(|r| {
                        r.state.grounded && r.state.ground.is_some_and(|g| g.body == s.nodes[b].id)
                    }) {
                        let inverse_mass = s.nodes[row.a].inv_mass;
                        s.nodes[row.a].support_reaction += row.normal * row.impulse * inverse_mass;
                    }
                }
            }
        }
        for node in &s.nodes {
            if let Some(r) = self.characters.get_mut(&node.id) {
                r.dynamic_iterations += node.visits;
                r.dynamic_limited |= graph_limited || !converged;
            }
        }
        for node in &s.nodes {
            let mut linear = node.linear - node.initial_linear;
            if let Some(r) = self.characters.get(&node.id) {
                let up = rp::Vector::from(r.config.up);
                // Support-normal response belongs to accepted support carry.
                // Do not turn load bearing into an independent upward launch.
                linear -= up * node.support_reaction.dot(up);
            }
            let angular = node.angular - node.initial_angular;
            if linear.length_squared() + angular.length_squared() <= 1.0e-12 {
                continue;
            }
            changed = true;
            if node.character {
                if let Some(r) = self.characters.get_mut(&node.id) {
                    // A velocity motor may supply new work on the next fixed
                    // tick. Only the part opposing that motor is tick-local;
                    // incoming-body knockback and reactions to external motion
                    // remain character-owned external velocity.
                    let direction = linear.try_normalize().unwrap_or(rp::Vector::ZERO);
                    let motor =
                        rp::Vector::from(r.input_velocity()) + rp::Vector::from(r.tick_velocity);
                    let removed = (-motor.dot(direction)).max(0.).min(linear.length());
                    let motor_reaction = direction * removed;
                    r.contact_velocity =
                        (rp::Vector::from(r.contact_velocity) + motor_reaction).to_array();
                    r.external_velocity = (rp::Vector::from(r.external_velocity) + linear
                        - motor_reaction)
                        .to_array();
                    if !converged {
                        r.state.character_coupling_iteration_limit = true;
                    }
                }
            }
        }
        for row in &s.rows {
            if let Some(pair) = row.pair {
                if let Some(index) = row.b {
                    if let Some(body) = self.backend.bodies.get_mut(native_id(s.nodes[index].id)) {
                        // Native contacts/joints retain ownership of their own
                        // impulses and friction. Publish only the character's
                        // equal-and-opposite contact impulse to the backend.
                        body.apply_impulse_at_point(-row.normal * row.impulse, row.point, true);
                    }
                }
                // The controller has explicitly admitted this touching pair even
                // when its current impulse is zero. Keep contact/event generation.
                self.contact_policies.character_dynamic_pairs.insert(pair);
                for id in [pair.0, pair.1] {
                    if let Some(c) = self.backend.colliders.get_mut(native_collider(id)) {
                        c.set_active_hooks(
                            c.active_hooks() | rp::ActiveHooks::FILTER_CONTACT_PAIRS,
                        );
                    }
                }
            }
        }
        s.predicting = converged && !s.rows.is_empty();
        self.character_dynamics = s;
        changed
    }

    /// Earliest future contact of an accepted capsule trajectory and a native
    /// dynamic trajectory. Already touching pairs were solved above.
    pub(super) fn limit_character_dynamic_motion(&self) -> super::solver_trajectory::Time {
        let mut earliest: super::solver_trajectory::Time = 1.;
        let dt = self.backend.integration_parameters.dt;
        for (&id, r) in &self.characters {
            if r.config.push_mass <= 0. {
                continue;
            }
            let c = &self.backend.colliders[native_collider(r.collider)];
            let body = &self.backend.bodies[native_id(id)];
            if !body.is_enabled() || !c.is_enabled() {
                continue;
            }
            let translation = if r.state.blocked_by_character {
                r.state.translation.into()
            } else {
                rp::Vector::from(r.free_velocity) * dt
            };
            let motion = NonlinearRigidMotion::new(
                *c.position(),
                rp::Vector::ZERO,
                translation,
                rp::Vector::ZERO,
            );
            let queries = self.backend.query_pipeline_with_filter(rp::QueryFilter {
                flags: rp::QueryFilterFlags::EXCLUDE_SENSORS,
                groups: Some(c.collision_groups()),
                exclude_rigid_body: Some(native_id(id)),
                ..Default::default()
            });
            // Split inside the touching row's prediction band. The suffix can
            // acquire its finite-mass row while the prefix still has clearance
            // for differences between predicted and native contact velocities.
            let prediction_band = prediction_band(r.config.skin_width);
            let bounds = super::kinematic_motion::motion_bounds(c.shape(), &motion)
                .loosened(prediction_band);
            for (handle, other) in queries.intersect_aabb_conservative(bounds) {
                let Some(target) = other
                    .parent()
                    .and_then(|h| self.backend.bodies.get(h))
                    .filter(|b| b.is_enabled() && b.is_dynamic())
                else {
                    continue;
                };
                if !other.is_enabled()
                    || !self
                        .contact_policies
                        .pair_allows(c.parent(), other.parent())
                    || !self
                        .contact_policies
                        .one_way_allows(handle, other, c.shape(), c.position())
                {
                    continue;
                }
                if contact(
                    other.position(),
                    other.shape(),
                    c.position(),
                    c.shape(),
                    r.config.skin_width * 1.05,
                )
                .ok()
                .flatten()
                .is_some()
                {
                    continue;
                }
                let native_contacts = target.colliders().iter().any(|&collider| {
                    self.backend.contact_pairs_with(collider).any(|p| {
                        p.has_any_active_contact()
                            && p.collider1 != native_collider(r.collider)
                            && p.collider2 != native_collider(r.collider)
                    })
                });
                let event_distance = if native_contacts {
                    prediction_band
                } else {
                    r.config.skin_width
                };
                let target_motion =
                    self.character_dynamics
                        .motion(target, other, self.backend.gravity, dt);
                let cast = |target: &NonlinearRigidMotion| {
                    if target.angvel == rp::Vector::ZERO {
                        cast_shapes(
                            other.position(),
                            target.linvel,
                            other.shape(),
                            c.position(),
                            motion.linvel,
                            c.shape(),
                            ShapeCastOptions {
                                max_time_of_impact: 1.,
                                target_distance: event_distance,
                                stop_at_penetration: false,
                                compute_impact_geometry_on_penetration: true,
                            },
                        )
                    } else {
                        let mut capsule =
                            *c.shape().as_capsule().expect("character capsule invariant");
                        capsule.radius += event_distance;
                        cast_shapes_nonlinear(
                            target,
                            other.shape(),
                            &motion,
                            &capsule,
                            0.,
                            1.,
                            false,
                        )
                    }
                    .ok()
                    .flatten()
                };
                // Native constraints may slow translation or cancel rotation.
                // A resisted linear path is an additional candidate for a split;
                // the actual guard still admits the complete shape trajectories.
                let travel = target_motion.linvel.length();
                let resisted = native_contacts.then(|| {
                    let mut resisted = target_motion;
                    let drag = self.backend.gravity.length() * dt * dt;
                    resisted.angvel = rp::Vector::ZERO;
                    resisted.linvel = if travel > drag {
                        target_motion.linvel * (1. - drag / travel)
                    } else {
                        rp::Vector::ZERO
                    };
                    resisted
                });
                for hit in cast(&target_motion)
                    .into_iter()
                    .chain(resisted.as_ref().and_then(cast))
                {
                    // Stop at the geometric impact. The controller's positive
                    // skin places the accepted endpoint safely before it.
                    let allowed = if translation.length_squared() > 1.0e-12 {
                        (rp::Vector::from(r.free_translation).dot(translation)
                            / translation.length_squared())
                        .clamp(0., 1.)
                    } else {
                        1.
                    };
                    if hit.time_of_impact > 1.0e-6 && hit.time_of_impact <= allowed + 1.0e-5 {
                        earliest = earliest.min(f64::from(hit.time_of_impact));
                    }
                }
            }
        }
        earliest.min(f64::from(native_contacts::limit(
            &self.backend,
            &self.contact_policies,
            &self.character_dynamics,
        )))
    }
}
