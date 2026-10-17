//! Bounded Data Scene attachment transforms. Root simulation remains in World.
use super::models::SpatialModels;
use crate::components::{AngularVelocity, HeightSpan, Rotation2D, Transform2D, Velocity};
use crate::entity::Entity;
use crate::world::World;

#[derive(Debug)]
struct Link {
    child: Entity,
    parent: Entity,
    parent_link: Option<usize>,
    local: [f32; 4],
    inherit_floor: bool,
}
#[derive(Clone, Copy, Debug)]
pub(crate) struct AttachmentPose {
    pub at: Transform2D,
    pub span: Option<HeightSpan>,
    pub yaw: f32,
}
impl AttachmentPose {
    fn read(world: &World, entity: Entity) -> Option<Self> {
        Some(Self {
            at: world.transform(entity)?,
            span: world.height_span(entity),
            yaw: world
                .rotation_at_index_or_default(entity.id as usize)
                .radians,
        })
    }
}
#[derive(Default, Debug)]
pub(crate) struct SpatialAttachments {
    links: Vec<Link>,
    scratch: Vec<Option<AttachmentPose>>,
    // Last committed root poses let autonomous integration fail as one transform transaction.
    roots: Vec<(Entity, AttachmentPose)>,
}
impl SpatialAttachments {
    pub fn contains(&self, entity: Entity) -> bool {
        self.links.iter().any(|l| l.child == entity)
    }
    pub fn has_parent(&self, entity: Entity) -> bool {
        self.links.iter().any(|l| l.parent == entity)
    }
    /// Commit a graph only after every root and derived child has passed cold validation.
    pub fn configure(
        &mut self,
        world: &mut World,
        models: &SpatialModels,
        metadata: &[u32],
        values: &[f32],
    ) -> bool {
        let Some(mut next) = Self::build_checked(world, models, metadata, values) else {
            return false;
        };
        next.commit(world);
        next.remember_roots(world);
        *self = next;
        true
    }
    /// Five metadata words: child handle, parent handle, inherit-floor flag. Four local floats.
    pub fn build_checked(
        world: &World,
        models: &SpatialModels,
        metadata: &[u32],
        values: &[f32],
    ) -> Option<Self> {
        if !metadata.len().is_multiple_of(5)
            || metadata.len() > 1024 * 5
            || values.len() != metadata.len() / 5 * 4
            || values.iter().any(|x| !x.is_finite())
        {
            return None;
        }
        let mut pending: Vec<_> = metadata
            .chunks_exact(5)
            .zip(values.chunks_exact(4))
            .collect();
        let mut links: Vec<Link> = Vec::with_capacity(pending.len());
        let children: std::collections::BTreeSet<_> =
            pending.iter().map(|(m, _)| (m[0], m[1])).collect();
        if children.len() != pending.len() {
            return None;
        }
        while !pending.is_empty() {
            let index = pending.iter().position(|(m, _)| {
                !children.contains(&(m[2], m[3]))
                    || links
                        .iter()
                        .any(|l| l.child.id == m[2] && l.child.generation == m[3])
            })?;
            let (m, v) = pending.remove(index);
            let child = Entity {
                id: m[0],
                generation: m[1],
            };
            let parent = Entity {
                id: m[2],
                generation: m[3],
            };
            if child == parent
                || m[4] > 1
                || !world.is_current_entity(child)
                || !world.is_current_entity(parent)
                || world.transform(child).is_none()
                || world.transform(parent).is_none()
                || !world
                    .rigid_body(child)
                    .is_some_and(|b| b.body_type == crate::components::RigidBodyType::Static)
                || world.height_span(child).is_none()
                || world.height_span(parent).is_none()
                || (!models
                    .bindings
                    .contains_key(&(parent.id, parent.generation))
                    && !children.contains(&(parent.id, parent.generation)))
            {
                return None;
            }
            let parent_link = links.iter().position(|l| l.child == parent);
            let mut ancestor = parent_link;
            let mut depth = 1;
            while let Some(i) = ancestor {
                depth += 1;
                if depth > 8 {
                    return None;
                }
                ancestor = links[i].parent_link;
            }
            links.push(Link {
                child,
                parent,
                parent_link,
                local: [v[0], v[1], v[2], v[3]],
                inherit_floor: m[4] != 0,
            });
        }
        let mut roots = Vec::new();
        for link in &links {
            if link.parent_link.is_none() && !roots.iter().any(|(entity, _)| *entity == link.parent)
            {
                let pose = AttachmentPose::read(world, link.parent)?;
                roots.push((link.parent, pose));
            }
        }
        let mut next = Self {
            scratch: vec![None; links.len()],
            links,
            roots,
        };
        if !next.evaluate(world, models, None, None) {
            return None;
        }
        Some(next)
    }
    /// Evaluate the complete batch before committing any child. Storage is allocated at configure time.
    pub fn synchronize(&mut self, world: &mut World, models: &SpatialModels) -> bool {
        if !self.evaluate(world, models, None, None) {
            return false;
        }
        self.commit(world);
        self.remember_roots(world);
        true
    }
    /// Autonomous simulation cannot leave roots ahead of stale collider/model children.
    /// Restore the last complete transform transaction and stop motion if any pose is invalid.
    pub fn synchronize_or_restore(&mut self, world: &mut World, models: &SpatialModels) -> bool {
        if self.synchronize(world, models) {
            return true;
        }
        for (entity, pose) in &self.roots {
            if !world.is_current_entity(*entity) {
                continue;
            }
            world.set_transform(*entity, pose.at);
            world.set_rotation(*entity, Rotation2D { radians: pose.yaw });
            if let Some(span) = pose.span {
                world.set_height_span(*entity, span);
            }
            world.set_velocity(*entity, Velocity::default());
            world.set_angular_velocity(*entity, AngularVelocity::default());
        }
        // Re-evaluate after rollback: stale generations are skipped and missing parents cascade.
        if self.evaluate(world, models, None, None) {
            self.commit(world);
        }
        false
    }
    fn remember_roots(&mut self, world: &World) {
        for (entity, pose) in &mut self.roots {
            if world.is_current_entity(*entity) {
                if let Some(current) = AttachmentPose::read(world, *entity) {
                    *pose = current;
                }
            }
        }
    }
    pub fn preflight(
        &mut self,
        world: &World,
        models: &SpatialModels,
        overrides: &std::collections::BTreeMap<(u32, u32), AttachmentPose>,
        removed: &std::collections::BTreeSet<(u32, u32)>,
    ) -> bool {
        self.evaluate(world, models, Some(overrides), Some(removed))
    }
    fn evaluate(
        &mut self,
        world: &World,
        models: &SpatialModels,
        overrides: Option<&std::collections::BTreeMap<(u32, u32), AttachmentPose>>,
        removed: Option<&std::collections::BTreeSet<(u32, u32)>>,
    ) -> bool {
        for (entity, _) in &self.roots {
            if !world.is_current_entity(*entity)
                || removed.is_some_and(|r| r.contains(&(entity.id, entity.generation)))
            {
                continue;
            }
            let pose = overrides
                .and_then(|p| p.get(&(entity.id, entity.generation)).copied())
                .or_else(|| AttachmentPose::read(world, *entity));
            if !pose.is_some_and(|p| valid_pose(models, *entity, p)) {
                return false;
            }
        }
        for (index, link) in self.links.iter().enumerate() {
            if removed.is_some_and(|r| {
                r.contains(&(link.parent.id, link.parent.generation))
                    && !r.contains(&(link.child.id, link.child.generation))
                    && world.is_current_entity(link.child)
            }) {
                // A restore must not report a child alive and then delete it as a side effect.
                return false;
            }
            let parent = match link.parent_link {
                Some(i) => self.scratch[i],
                None => overrides
                    .and_then(|p| p.get(&(link.parent.id, link.parent.generation)).copied())
                    .or_else(|| AttachmentPose::read(world, link.parent)),
            };
            let Some(parent) = parent.filter(|_| {
                world.is_current_entity(link.parent)
                    && world.is_current_entity(link.child)
                    && !removed.is_some_and(|r| {
                        r.contains(&(link.parent.id, link.parent.generation))
                            || r.contains(&(link.child.id, link.child.generation))
                    })
            }) else {
                self.scratch[index] = None;
                continue;
            };
            let (s, c) = parent.yaw.sin_cos();
            let at = Transform2D {
                x: parent.at.x + c * link.local[0] - s * link.local[1],
                y: parent.at.y + s * link.local[0] + c * link.local[1],
            };
            let yaw = parent.yaw + link.local[3];
            let span = world.height_span(link.child).and_then(|child| {
                HeightSpan::new(
                    if link.inherit_floor {
                        parent.span.map_or(child.floor, |p| p.floor)
                    } else {
                        child.floor
                    },
                    parent.span.map_or(0., |p| p.elevation) + link.local[2],
                    child.height,
                )
            });
            let pose = AttachmentPose { at, span, yaw };
            if !valid_pose(models, link.child, pose) {
                return false;
            }
            self.scratch[index] = Some(pose);
        }
        true
    }
    fn commit(&self, world: &mut World) {
        for (link, pose) in self.links.iter().zip(&self.scratch) {
            let Some(pose) = pose else {
                if world.is_current_entity(link.child) {
                    world.despawn(link.child);
                }
                continue;
            };
            world.set_transform(link.child, pose.at);
            world.set_rotation(link.child, Rotation2D { radians: pose.yaw });
            if let Some(span) = pose.span {
                world.set_height_span(link.child, span);
            }
            world.set_velocity(link.child, Velocity::default());
            world.set_angular_velocity(link.child, AngularVelocity::default());
        }
    }
}

fn valid_pose(models: &SpatialModels, entity: Entity, pose: AttachmentPose) -> bool {
    pose.at.x.is_finite()
        && pose.at.y.is_finite()
        && pose.at.x.abs() <= 1_000_000.
        && pose.at.y.abs() <= 1_000_000.
        && pose.yaw.is_finite()
        && pose.span.is_some_and(|span| span.top().is_finite())
        && models
            .bindings
            .get(&(entity.id, entity.generation))
            .is_none_or(|m| {
                m.pose_at_rotation(pose.at, pose.span.map_or(0., |s| s.elevation), pose.yaw)
                    .is_some()
            })
}
