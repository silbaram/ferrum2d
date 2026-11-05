//! Translated flat supports. Stable surface indices, bounded native carry, no 3D solver.
use super::{append_surface, rectangles_overlap, SpatialScene, Surface};
use crate::collision::{
    collider_segment_count_at, collider_shape_at_segment, AabbBounds, ColliderShapeRef,
    CollisionSystem,
};
use crate::components::{HeightSpan, RigidBodyType, Transform2D};
use crate::entity::Entity;
use crate::world::World;

#[derive(Clone, Copy, Debug)]
pub(crate) struct MovingPlatform {
    pub origin: Surface,
    pub offset: [f32; 3],
    pub duration: f64,
    pub phase: f64,
}
impl MovingPlatform {
    fn surface_at(self, phase: f64) -> Surface {
        let fraction = (phase / self.duration).min(2.0);
        let fraction = if fraction > 1.0 {
            2.0 - fraction
        } else {
            fraction
        } as f32;
        let mut surface = self.origin;
        surface.bounds[0] += self.offset[0] * fraction;
        surface.bounds[1] += self.offset[1] * fraction;
        surface.base += self.offset[2] * fraction;
        surface.heights[0] += self.offset[2] * fraction;
        surface.heights[1] += self.offset[2] * fraction;
        surface
    }
}
impl SpatialScene {
    /// Each record retains the eight-value spatial progress ABI: tag2,id,dx,dy,dh,duration,phase,0.
    pub(crate) fn platform_state(&self) -> Vec<f64> {
        self.moving_platforms
            .iter()
            .flat_map(|p| {
                [
                    2.0,
                    p.origin.id as f64,
                    p.offset[0] as f64,
                    p.offset[1] as f64,
                    p.offset[2] as f64,
                    p.duration,
                    p.phase,
                    0.0,
                ]
            })
            .collect()
    }
    pub(crate) fn parse_platform_state(
        &self,
        values: &[f64],
    ) -> Option<(Vec<MovingPlatform>, Vec<Surface>)> {
        if !values.len().is_multiple_of(8) || values.len() > 16 * 8 {
            return None;
        }
        let mut platforms: Vec<MovingPlatform> = Vec::new();
        let mut surfaces = self.surfaces.clone();
        for r in values.chunks_exact(8) {
            if r.iter().any(|v| !v.is_finite())
                || r[0] != 2.0
                || r[1].fract() != 0.0
                || r[1] <= 0.0
                || r[1] > 65535.0
                || r[5] < 0.05
                || r[5] > 3600.0
                || r[6] < 0.0
                || r[6] >= 2.0 * r[5]
                || r[7] != 0.0
                || r[2..5].iter().any(|v| v.abs() > 1_000_000.0)
            {
                return None;
            }
            let index = surfaces.iter().position(|s| s.id == r[1] as u32)?;
            if self
                .connections
                .iter()
                .any(|c| c.from == index || c.to == index)
                || platforms.iter().any(|p| p.origin.id == r[1] as u32)
            {
                return None;
            }
            let origin = self
                .moving_platforms
                .iter()
                .find(|p| p.origin.id == r[1] as u32)
                .map_or(surfaces[index], |p| p.origin);
            if !origin.walkable || origin.kind == 2 || origin.heights[0] != origin.heights[1] {
                return None;
            }
            let platform = MovingPlatform {
                origin,
                offset: [r[2] as f32, r[3] as f32, r[4] as f32],
                duration: r[5],
                phase: r[6],
            };
            let surface = platform.surface_at(platform.phase);
            if !valid_surface(surface) {
                return None;
            }
            surfaces[index] = surface;
            platforms.push(platform);
        }
        if surfaces.iter().enumerate().any(|(i, a)| {
            surfaces[..i]
                .iter()
                .any(|b| a.floor == b.floor && rectangles_overlap(a.bounds, b.bounds))
        }) {
            return None;
        }
        Some((platforms, surfaces))
    }
    pub(crate) fn apply_platform_state(
        &mut self,
        platforms: Vec<MovingPlatform>,
        surfaces: Vec<Surface>,
    ) {
        self.moving_platforms = platforms;
        self.surfaces = surfaces;
        self.rebuild_platform_geometry();
    }
    pub(crate) fn rebuild_platform_geometry(&mut self) {
        for index in 0..self.surfaces.len() {
            self.sync_platform_physics(index);
        }
        self.refresh_platform_render();
    }
    fn sync_platform_physics(&mut self, index: usize) {
        let s = self.surfaces[index];
        let tile = (index + 1) as u32;
        self.physics
            .set_tile_definition(tile, 0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        self.physics.set_tile_height_span_definition(
            tile,
            s.floor,
            if s.walkable { s.heights[0] } else { s.base },
            if s.walkable {
                0.0
            } else {
                s.heights[0].max(s.heights[1]) - s.base
            },
        );
        self.physics.set_tile_hd2d_definition(
            tile,
            s.kind,
            !s.walkable,
            true,
            true,
            s.heights[0] - s.base,
            s.kind == 2,
            u32::from(!s.ramp_x),
            s.heights[0],
            s.heights[1],
        );
        self.physics.set_layer(
            index as u32,
            1,
            1,
            s.bounds[2],
            s.bounds[3],
            s.bounds[0],
            s.bounds[1],
            true,
            vec![tile],
        );
    }
    fn refresh_platform_render(&mut self) {
        self.terrain.clear();
        for surface in &self.surfaces {
            append_surface(&mut self.terrain, *surface);
        }
        self.terrain_draw_ranges.clear();
        self.navigation.cancel();
        self.navigation_revision = self.navigation_revision.wrapping_add(1);
        self.revision = self.revision.wrapping_add(1);
        self.platform_revision = self.platform_revision.wrapping_add(1);
    }
    pub(crate) fn step_moving_platforms(&mut self, world: &mut World, dt: f32) {
        self.platform_carried = 0;
        self.platform_blocked = 0;
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }
        let mut geometry_changed = false;
        for pindex in 0..self.moving_platforms.len() {
            let platform = self.moving_platforms[pindex];
            let Some(index) = self
                .surfaces
                .iter()
                .position(|s| s.id == platform.origin.id)
            else {
                continue;
            };
            let old = self.surfaces[index];
            let next_phase = (platform.phase + dt as f64) % (2.0 * platform.duration);
            // Bounded steps also prevent a very large dt from skipping an obstruction/turnaround.
            let travel_speed = platform.offset.iter().map(|v| v.abs()).fold(0.0, f32::max)
                / platform.duration as f32;
            let steps = (travel_speed * dt / (old.bounds[2].min(old.bounds[3]) * 0.125).min(2.0))
                .ceil()
                .max(1.0) as usize;
            if steps > 64 {
                self.platform_blocked += 1;
                continue;
            }
            let riders: Vec<_> = world
                .alive_indices()
                .iter()
                .filter_map(|i| {
                    let entity = world.entity_at_index(*i)?;
                    if self.attachments.contains(entity)
                        || !world
                            .rigid_body(entity)
                            .is_some_and(|b| b.enabled && b.body_type == RigidBodyType::Kinematic)
                    {
                        return None;
                    }
                    let collider = world.collider(entity)?;
                    if !collider.enabled
                        || collider.is_trigger
                        || world.compound_collider_count(entity) != 1
                    {
                        return None;
                    }
                    let at = world.transform(entity)?;
                    let span = world.height_span(entity)?;
                    let center = collider.center(at);
                    (span.floor.0 == old.floor
                        && (span.elevation - old.heights[0]).abs() < 0.01
                        && contains(old, center))
                    .then_some((entity, at, span, world.velocity(entity).unwrap_or_default()))
                })
                .take(257)
                .collect();
            let rider_entities: Vec<_> = riders.iter().map(|r| r.0).collect();
            if riders.len() > 256 {
                self.platform_blocked += 1;
                continue;
            }
            let mut valid = true;
            for step in 1..=steps {
                let phase = (platform.phase + dt as f64 * step as f64 / steps as f64)
                    % (2.0 * platform.duration);
                let next = platform.surface_at(phase);
                if !valid_surface(next)
                    || self.surfaces.iter().enumerate().any(|(j, s)| {
                        j != index
                            && s.floor == next.floor
                            && rectangles_overlap(s.bounds, next.bounds)
                    })
                {
                    valid = false;
                    break;
                }
                let previous = self.surfaces[index];
                let dx = next.bounds[0] - previous.bounds[0];
                let dy = next.bounds[1] - previous.bounds[1];
                let dh = next.heights[0] - previous.heights[0];
                self.surfaces[index] = next;
                self.sync_platform_physics(index);
                for (entity, _, _, _) in &riders {
                    let at = world.transform(*entity).unwrap_or_default();
                    let Some(mut span) = world.height_span(*entity) else {
                        valid = false;
                        break;
                    };
                    let old_span = span;
                    span.elevation += dh;
                    if carry_overlaps(world, *entity, at, dx, dy, old_span, span, &rider_entities) {
                        valid = false;
                        break;
                    }
                }
                if valid {
                    for entity in &rider_entities {
                        let at = world.transform(*entity).unwrap_or_default();
                        if let Some(mut span) = world.height_span(*entity) {
                            span.elevation += dh;
                            world.set_transform(
                                *entity,
                                Transform2D {
                                    x: at.x + dx,
                                    y: at.y + dy,
                                },
                            );
                            world.set_height_span(*entity, span);
                        }
                    }
                }
                if !valid {
                    break;
                }
            }
            if valid {
                geometry_changed |= old.bounds != self.surfaces[index].bounds
                    || old.heights != self.surfaces[index].heights;
                self.moving_platforms[pindex].phase = next_phase;
                self.platform_carried += riders.len() as u32;
                for (e, _, _, velocity) in &riders {
                    world.set_velocity(*e, *velocity);
                }
            } else {
                self.surfaces[index] = old;
                self.sync_platform_physics(index);
                for (e, at, span, velocity) in riders {
                    world.set_transform(e, at);
                    world.set_height_span(e, span);
                    world.set_velocity(e, velocity);
                }
                self.platform_blocked += 1;
            }
        }
        if geometry_changed {
            self.refresh_platform_render();
        }
    }
}
fn contains(s: Surface, p: Transform2D) -> bool {
    p.x >= s.bounds[0]
        && p.y >= s.bounds[1]
        && p.x < s.bounds[0] + s.bounds[2]
        && p.y < s.bounds[1] + s.bounds[3]
}
fn valid_surface(s: Surface) -> bool {
    s.bounds
        .iter()
        .chain([s.base, s.heights[0], s.heights[1]].iter())
        .all(|v| v.is_finite())
        && s.bounds[0] + s.bounds[2] > s.bounds[0]
        && s.bounds[1] + s.bounds[3] > s.bounds[1]
}
#[allow(clippy::too_many_arguments)]
fn carry_overlaps(
    world: &World,
    entity: Entity,
    at: Transform2D,
    dx: f32,
    dy: f32,
    old: HeightSpan,
    new: HeightSpan,
    riders: &[Entity],
) -> bool {
    let Some(c) = world.collider(entity) else {
        return true;
    };
    let center = c.center(at);
    let sweep_at = Transform2D {
        x: center.x + dx * 0.5,
        y: center.y + dy * 0.5,
    };
    let sweep = crate::components::AabbCollider {
        half_width: (c.half_width + dx.abs() * 0.5 - 0.001).max(0.001),
        half_height: (c.half_height + dy.abs() * 0.5 - 0.001).max(0.001),
        offset_x: 0.,
        offset_y: 0.,
        ..c
    };
    let Some(bounds) = AabbBounds::from_center(sweep_at, sweep.half_width, sweep.half_height)
    else {
        return true;
    };
    let span = HeightSpan {
        floor: old.floor,
        elevation: old.elevation.min(new.elevation),
        height: old.height + (new.elevation - old.elevation).abs(),
    };
    let Some(filter) = world.compound_collision_filter_at(entity.id as usize, 0) else {
        return false;
    };
    let mut hits = Vec::new();
    CollisionSystem::aabb_query_with_height_span_into(
        world,
        bounds,
        filter.mask,
        Some(span),
        &mut hits,
    );
    hits.iter().any(|hit| {
        if riders.contains(&hit.entity) {
            return false;
        }
        let Some(target_at) = world.transform(hit.entity) else {
            return false;
        };
        let index = hit.entity.id as usize;
        // Entity-only query hits can come from a trigger or a differently filtered
        // compound child. Test the actual solid child before blocking the batch.
        (0..world.compound_collider_count_at(index)).any(|collider| {
            if !world
                .compound_collision_filter_at(index, collider)
                .is_some_and(|target| filter.can_collide_with(target))
            {
                return false;
            }
            (0..collider_segment_count_at(world, index, collider)).any(|segment| {
                collider_shape_at_segment(world, index, collider, segment).is_some_and(|shape| {
                    !shape.is_trigger()
                        && CollisionSystem::shapes_overlap(
                            sweep_at,
                            ColliderShapeRef::Aabb(sweep),
                            target_at,
                            shape,
                        )
                })
            })
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::{
        AabbCollider, CircleCollider, CollisionFilter, CollisionLayer, CollisionMask,
        CompoundCollider, CompoundColliderShape, OrientedBoxCollider, PhysicsFloorId, RigidBody,
    };

    fn fixture() -> (SpatialScene, World, Entity, Entity) {
        let mut scene = SpatialScene::default();
        assert!(scene.configure_surfaces(
            &[0., 0., 20., 20., -2., 0., 0., 1., 1., 1., 1.],
            &[1, 0, 16777215, 1],
        ));
        let (platforms, surfaces) = scene
            .parse_platform_state(&[2., 1., 10., 0., 8., 1., 0., 0.])
            .unwrap();
        scene.apply_platform_state(platforms, surfaces);
        let mut world = World::default();
        let rider = world.spawn_entity();
        world.set_transform(rider, Transform2D { x: 10., y: 10. });
        world.set_rigid_body(rider, RigidBody::kinematic());
        world.set_aabb_collider(
            rider,
            AabbCollider::new(1., 1., false, CollisionLayer::Player),
        );
        world.set_collision_filter(
            rider,
            CollisionFilter::new(CollisionMask::PLAYER, CollisionMask::WALL),
        );
        world.set_height_span(rider, HeightSpan::new(PhysicsFloorId(0), 0., 4.).unwrap());
        let obstacle = world.spawn_entity();
        world.set_transform(obstacle, Transform2D { x: 13., y: 10. });
        world.set_rigid_body(obstacle, RigidBody::static_body());
        world.set_height_span(
            obstacle,
            HeightSpan::new(PhysicsFloorId(0), 0., 50.).unwrap(),
        );
        (scene, world, rider, obstacle)
    }

    fn assert_carry(scene: &mut SpatialScene, world: &mut World, rider: Entity, blocked: bool) {
        scene.step_moving_platforms(world, 0.5);
        assert_eq!(scene.platform_blocked, u32::from(blocked));
        assert_eq!(scene.platform_carried, u32::from(!blocked));
        assert_eq!(
            world.transform(rider).unwrap().x,
            if blocked { 10. } else { 15. }
        );
        assert_eq!(
            world.height_span(rider).unwrap().elevation,
            if blocked { 0. } else { 4. }
        );
        assert_eq!(
            scene.moving_platforms[0].phase,
            if blocked { 0. } else { 0.5 }
        );
    }

    #[test]
    fn moving_platform_carry_ignores_trigger_shapes_but_blocks_solid_shapes() {
        for trigger in [true, false] {
            let shapes = [
                CompoundColliderShape::Circle(CircleCollider::new(
                    1.,
                    trigger,
                    CollisionLayer::Wall,
                )),
                CompoundColliderShape::OrientedBox(OrientedBoxCollider::new(
                    1.,
                    1.,
                    0.5,
                    trigger,
                    CollisionLayer::Wall,
                )),
            ];
            for shape in shapes {
                let (mut scene, mut world, rider, obstacle) = fixture();
                world
                    .add_compound_collider(
                        obstacle,
                        CompoundCollider::new(shape).with_filter(CollisionFilter::new(
                            CollisionMask::WALL,
                            CollisionMask::PLAYER,
                        )),
                    )
                    .unwrap();
                assert_carry(&mut scene, &mut world, rider, !trigger);
            }
        }
    }

    #[test]
    fn moving_platform_carry_checks_each_compound_solid_and_its_filter() {
        for solid_near in [false, true] {
            for reciprocal in [false, true] {
                let (mut scene, mut world, rider, obstacle) = fixture();
                world.set_aabb_collider(
                    obstacle,
                    AabbCollider::new(1., 1., true, CollisionLayer::Wall),
                );
                // The secondary solid's filter must override this unrelated primary filter.
                world.set_collision_filter(
                    obstacle,
                    CollisionFilter::new(CollisionMask::WALL, CollisionMask::NONE),
                );
                world
                    .add_compound_collider(
                        obstacle,
                        CompoundCollider::new(CompoundColliderShape::Circle(
                            CircleCollider::new(1., false, CollisionLayer::Wall)
                                .with_offset(if solid_near { 0. } else { 100. }, 0.),
                        ))
                        .with_filter(CollisionFilter::new(
                            CollisionMask::WALL,
                            if reciprocal {
                                CollisionMask::PLAYER
                            } else {
                                CollisionMask::NONE
                            },
                        )),
                    )
                    .unwrap();
                assert_carry(&mut scene, &mut world, rider, solid_near && reciprocal);
            }
        }
    }

    #[test]
    fn moving_platform_carry_does_not_promote_trigger_hit_to_remote_solid_hit() {
        let (mut scene, mut world, rider, obstacle) = fixture();
        world.set_aabb_collider(
            obstacle,
            AabbCollider::new(1., 1., false, CollisionLayer::Wall).with_offset(100., 0.),
        );
        world.set_collision_filter(
            obstacle,
            CollisionFilter::new(CollisionMask::WALL, CollisionMask::PLAYER),
        );
        world
            .add_compound_collider(
                obstacle,
                CompoundCollider::new(CompoundColliderShape::Circle(CircleCollider::new(
                    1.,
                    true,
                    CollisionLayer::Wall,
                ))),
            )
            .unwrap();
        assert_carry(&mut scene, &mut world, rider, false);
    }
}
