use super::*;

pub(super) fn precise_current_overlap(world: &World, pair: ColliderPair) -> bool {
    ColliderPairContext::from_collider_pair(world, pair).is_some_and(|pair| pair.overlaps())
}

pub(super) fn contact_from_collider_pair(
    world: &World,
    pair: ColliderPair,
) -> Option<CollisionContact> {
    ColliderPairContext::from_collider_pair(world, pair)?.contact()
}

pub(super) fn manifold_from_collider_pair(
    world: &World,
    pair: ColliderPair,
) -> Option<CollisionManifold> {
    ColliderPairContext::from_collider_pair(world, pair)?.manifold()
}

#[derive(Clone, Copy, Debug)]
struct ColliderPairContext {
    pair: CollisionPair,
    at: Transform2D,
    ac: ColliderShapeRef,
    bt: Transform2D,
    bc: ColliderShapeRef,
}

impl ColliderPairContext {
    fn from_collider_pair(world: &World, collider_pair: ColliderPair) -> Option<Self> {
        let pair = collider_pair_to_pair(world, collider_pair);
        let a_index = pair.a.id as usize;
        let b_index = pair.b.id as usize;
        Some(Self {
            pair,
            at: world.transforms.get(a_index).copied().flatten()?,
            ac: collider_shape_at_segment(
                world,
                a_index,
                collider_pair.a.collider_index,
                collider_pair.a.segment_index,
            )?,
            bt: world.transforms.get(b_index).copied().flatten()?,
            bc: collider_shape_at_segment(
                world,
                b_index,
                collider_pair.b.collider_index,
                collider_pair.b.segment_index,
            )?,
        })
    }

    fn overlaps(self) -> bool {
        shapes_overlap(self.at, self.ac, self.bt, self.bc)
    }

    fn contact(self) -> Option<CollisionContact> {
        let contact = self.shape_contact()?;
        let (point_x, point_y) = self.contact_point(contact);
        Some(CollisionContact {
            pair: self.pair,
            normal_x: contact.normal_x,
            normal_y: contact.normal_y,
            penetration: contact.penetration,
            point_x,
            point_y,
        })
    }

    fn manifold(self) -> Option<CollisionManifold> {
        let contact = self.shape_contact()?;
        let (points, point_count) = self.contact_manifold_points(contact);
        (point_count > 0).then_some(CollisionManifold {
            pair: self.pair,
            normal_x: contact.normal_x,
            normal_y: contact.normal_y,
            penetration: contact.penetration,
            point_count,
            points,
        })
    }

    fn shape_contact(self) -> Option<AabbContact> {
        shape_contact(self.at, self.ac, self.bt, self.bc)
    }

    fn contact_point(self, contact: AabbContact) -> (f32, f32) {
        contact_point(self.at, self.ac, self.bt, self.bc, contact)
    }

    fn contact_manifold_points(
        self,
        contact: AabbContact,
    ) -> ([CollisionContactPoint; MAX_COLLISION_MANIFOLD_POINTS], u32) {
        contact_manifold_points(self.at, self.ac, self.bt, self.bc, contact)
    }
}
