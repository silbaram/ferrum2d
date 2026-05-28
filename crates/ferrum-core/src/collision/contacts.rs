use super::broadphase::{CollisionScratch, PairFilter};
use super::*;

impl CollisionSystem {
    pub fn build_mask_contacts(
        world: &World,
        category_a: CollisionMask,
        category_b: CollisionMask,
    ) -> Vec<CollisionContact> {
        let mut contacts = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_mask_contacts_into(&mut scratch, world, category_a, category_b, &mut contacts);
        contacts
    }

    pub fn build_mask_manifolds(
        world: &World,
        category_a: CollisionMask,
        category_b: CollisionMask,
    ) -> Vec<CollisionManifold> {
        let mut manifolds = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_mask_manifolds_into(
            &mut scratch,
            world,
            category_a,
            category_b,
            &mut manifolds,
        );
        manifolds
    }

    pub(crate) fn build_mask_contacts_into(
        scratch: &mut CollisionScratch,
        world: &World,
        category_a: CollisionMask,
        category_b: CollisionMask,
        contacts: &mut Vec<CollisionContact>,
    ) {
        contacts.clear();
        for pair in Self::build_collider_pairs_with_scratch(
            scratch,
            world,
            PairFilter::Masks(category_a, category_b),
        )
        .iter()
        .copied()
        {
            if let Some(contact) = contact_from_collider_pair(world, pair) {
                contacts.push(contact);
            }
        }
    }

    pub(crate) fn build_mask_manifolds_into(
        scratch: &mut CollisionScratch,
        world: &World,
        category_a: CollisionMask,
        category_b: CollisionMask,
        manifolds: &mut Vec<CollisionManifold>,
    ) {
        manifolds.clear();
        for pair in Self::build_collider_pairs_with_scratch(
            scratch,
            world,
            PairFilter::Masks(category_a, category_b),
        )
        .iter()
        .copied()
        {
            if let Some(manifold) = manifold_from_collider_pair(world, pair) {
                manifolds.push(manifold);
            }
        }
    }

    pub fn build_contacts(world: &World) -> Vec<CollisionContact> {
        Self::build_collider_contacts(world)
            .into_iter()
            .map(|contact| contact.contact)
            .collect()
    }

    pub fn build_manifolds(world: &World) -> Vec<CollisionManifold> {
        Self::build_collider_manifolds(world)
            .into_iter()
            .map(|manifold| manifold.manifold)
            .collect()
    }

    #[cfg(test)]
    pub(crate) fn build_rigid_collider_contacts(world: &World) -> Vec<ColliderCollisionContact> {
        let mut contacts = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_rigid_collider_contacts_into(&mut scratch, world, &mut contacts);
        contacts
    }

    pub(crate) fn build_rigid_collider_contacts_into(
        scratch: &mut CollisionScratch,
        world: &World,
        contacts: &mut Vec<ColliderCollisionContact>,
    ) {
        contacts.clear();
        for pair in Self::build_collider_pairs_with_scratch(scratch, world, PairFilter::All)
            .iter()
            .copied()
        {
            if collider_pair_has_trigger(world, pair) {
                continue;
            }
            if let Some(contact) = contact_from_collider_pair(world, pair) {
                contacts.push(ColliderCollisionContact {
                    collider_pair: pair,
                    contact,
                });
            }
        }
    }

    pub(crate) fn build_rigid_collider_manifolds(world: &World) -> Vec<ColliderCollisionManifold> {
        let mut manifolds = Vec::new();
        let mut scratch = CollisionScratch::default();
        Self::build_rigid_collider_manifolds_into(&mut scratch, world, &mut manifolds);
        manifolds
    }

    pub(crate) fn build_rigid_collider_manifolds_into(
        scratch: &mut CollisionScratch,
        world: &World,
        manifolds: &mut Vec<ColliderCollisionManifold>,
    ) {
        manifolds.clear();
        for pair in Self::build_collider_pairs_with_scratch(scratch, world, PairFilter::All)
            .iter()
            .copied()
        {
            if collider_pair_has_trigger(world, pair) {
                continue;
            }
            if let Some(manifold) = manifold_from_collider_pair(world, pair) {
                manifolds.push(ColliderCollisionManifold {
                    collider_pair: pair,
                    manifold,
                });
            }
        }
    }

    fn build_collider_contacts(world: &World) -> Vec<ColliderCollisionContact> {
        let mut contacts = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::All) {
            if let Some(contact) = contact_from_collider_pair(world, pair) {
                contacts.push(ColliderCollisionContact {
                    collider_pair: pair,
                    contact,
                });
            }
        }
        contacts
    }

    fn build_collider_manifolds(world: &World) -> Vec<ColliderCollisionManifold> {
        let mut manifolds = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::All) {
            if let Some(manifold) = manifold_from_collider_pair(world, pair) {
                manifolds.push(ColliderCollisionManifold {
                    collider_pair: pair,
                    manifold,
                });
            }
        }
        manifolds
    }

    pub fn build_layer_contacts(
        world: &World,
        layer_a: CollisionLayer,
        layer_b: CollisionLayer,
    ) -> Vec<CollisionContact> {
        let mut contacts = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::Layers(layer_a, layer_b)) {
            if let Some(contact) = contact_from_collider_pair(world, pair) {
                contacts.push(contact);
            }
        }
        contacts
    }

    pub fn build_layer_manifolds(
        world: &World,
        layer_a: CollisionLayer,
        layer_b: CollisionLayer,
    ) -> Vec<CollisionManifold> {
        let mut manifolds = Vec::new();
        for pair in Self::build_collider_pairs(world, PairFilter::Layers(layer_a, layer_b)) {
            if let Some(manifold) = manifold_from_collider_pair(world, pair) {
                manifolds.push(manifold);
            }
        }
        manifolds
    }
}
