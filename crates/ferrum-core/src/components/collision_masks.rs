#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CollisionLayer {
    Player,
    Enemy,
    Bullet,
    Wall,
    Pickup,
}

impl CollisionLayer {
    pub const fn mask(self) -> CollisionMask {
        match self {
            Self::Player => CollisionMask::PLAYER,
            Self::Enemy => CollisionMask::ENEMY,
            Self::Bullet => CollisionMask::BULLET,
            Self::Wall => CollisionMask::WALL,
            Self::Pickup => CollisionMask::PICKUP,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionMask {
    pub bits: u32,
}

impl CollisionMask {
    pub const NONE: Self = Self { bits: 0 };
    pub const PLAYER: Self = Self { bits: 1 << 0 };
    pub const ENEMY: Self = Self { bits: 1 << 1 };
    pub const BULLET: Self = Self { bits: 1 << 2 };
    pub const WALL: Self = Self { bits: 1 << 3 };
    pub const PICKUP: Self = Self { bits: 1 << 4 };
    pub const ALL: Self = Self { bits: u32::MAX };

    pub const fn from_bits(bits: u32) -> Self {
        Self { bits }
    }

    pub const fn bit(index: u8) -> Option<Self> {
        if index < 32 {
            Some(Self {
                bits: 1_u32 << index,
            })
        } else {
            None
        }
    }

    pub const fn union(self, other: Self) -> Self {
        Self {
            bits: self.bits | other.bits,
        }
    }

    pub const fn intersects(self, other: Self) -> bool {
        self.bits & other.bits != 0
    }
}

impl From<CollisionLayer> for CollisionMask {
    fn from(layer: CollisionLayer) -> Self {
        layer.mask()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CollisionFilter {
    pub category: CollisionMask,
    pub mask: CollisionMask,
}

impl CollisionFilter {
    pub const fn new(category: CollisionMask, mask: CollisionMask) -> Self {
        Self { category, mask }
    }

    pub const fn from_layer(layer: CollisionLayer) -> Self {
        Self {
            category: layer.mask(),
            mask: CollisionMask::ALL,
        }
    }

    pub const fn can_collide_with(self, other: Self) -> bool {
        self.mask.intersects(other.category) && other.mask.intersects(self.category)
    }
}
