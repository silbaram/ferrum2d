//! Ferrum's supported native shapes and manifold workspaces, admitted at their
//! pinned Serde enum tags before variant payload construction.
//!
//! This does not replace numeric/storage/context validation. No serializer
//! or vendor-wide deserializer is changed, and accepted tags reach the original
//! enum seed once in their original numeric form.
use serde::de::{self, DeserializeSeed, EnumAccess, Visitor};
use serde::Deserialize;
use std::fmt;

#[derive(Clone, Copy)]
pub(super) enum Kind {
    Shape,
    ContactWorkspace,
}
impl Kind {
    fn allows(self, name: &str) -> bool {
        match self {
            Self::Shape => matches!(
                name,
                "Ball"
                    | "Cuboid"
                    | "Capsule"
                    | "ConvexPolyhedron"
                    | "TriMesh"
                    | "HeightField"
                    | "Compound"
            ),
            Self::ContactWorkspace => matches!(
                name,
                "TriMeshShapeContactManifoldsWorkspace"
                    | "HeightfieldShapeContactManifoldsWorkspace"
                    | "HeightfieldCompositeShapeContactManifoldsWorkspace"
                    | "CompositeShapeCompositeShapeContactManifoldsWorkspace"
                    | "CompositeShapeShapeContactManifoldsWorkspace"
            ),
        }
    }
}

pub(super) struct NativeEnumVisitor<V> {
    visitor: V,
    variants: &'static [&'static str],
    kind: Kind,
}

impl<V> NativeEnumVisitor<V> {
    pub(super) fn new(visitor: V, variants: &'static [&'static str], kind: Kind) -> Self {
        Self {
            visitor,
            variants,
            kind,
        }
    }
}

impl<'de, V: Visitor<'de>> Visitor<'de> for NativeEnumVisitor<V> {
    type Value = V::Value;

    fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.visitor.expecting(f)
    }

    fn visit_enum<A: EnumAccess<'de>>(self, source: A) -> Result<Self::Value, A::Error> {
        self.visitor.visit_enum(NativeEnum {
            source,
            variants: self.variants,
            kind: self.kind,
        })
    }
}

struct NativeEnum<A> {
    source: A,
    variants: &'static [&'static str],
    kind: Kind,
}

impl<'de, A: EnumAccess<'de>> EnumAccess<'de> for NativeEnum<A> {
    type Error = A::Error;
    type Variant = A::Variant;

    fn variant_seed<S: DeserializeSeed<'de>>(
        self,
        seed: S,
    ) -> Result<(S::Value, Self::Variant), Self::Error> {
        self.source.variant_seed(NativeTag {
            seed,
            variants: self.variants,
            kind: self.kind,
        })
    }
}

struct NativeTag<S> {
    seed: S,
    variants: &'static [&'static str],
    kind: Kind,
}

impl<'de, S: DeserializeSeed<'de>> DeserializeSeed<'de> for NativeTag<S> {
    type Value = S::Value;

    fn deserialize<D: de::Deserializer<'de>>(self, source: D) -> Result<Self::Value, D::Error> {
        // Postcard enum tags are u32. Resolve through Serde's actual pinned
        // variant names instead of assuming numeric IDs for the allowed set.
        let tag = u32::deserialize(source)?;
        if !self
            .variants
            .get(tag as usize)
            .is_some_and(|name| self.kind.allows(name))
        {
            return Err(de::Error::custom("unsupported native checkpoint variant"));
        }
        self.seed
            .deserialize(de::value::U32Deserializer::<D::Error>::new(tag))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct CountSeed<'a>(&'a Cell<usize>);
    impl<'de> DeserializeSeed<'de> for CountSeed<'_> {
        type Value = u32;

        fn deserialize<D: de::Deserializer<'de>>(self, source: D) -> Result<u32, D::Error> {
            self.0.set(self.0.get() + 1);
            u32::deserialize(source)
        }
    }

    #[test]
    fn native_shape_boundary_passes_original_tag_to_original_seed_once() {
        // Deliberately reorder names: admission is by the supplied variant
        // name, while the original seed receives the original numeric tag.
        const VARIANTS: &[&str] = &["Segment", "Capsule", "Ball"];
        let calls = Cell::new(0);
        for tag in [1, 2] {
            let restored = NativeTag {
                seed: CountSeed(&calls),
                variants: VARIANTS,
                kind: Kind::Shape,
            }
            .deserialize(de::value::U32Deserializer::<de::value::Error>::new(tag))
            .unwrap();
            assert_eq!(restored, tag);
        }
        assert_eq!(calls.get(), 2);
        assert!(NativeTag {
            seed: CountSeed(&calls),
            variants: VARIANTS,
            kind: Kind::Shape,
        }
        .deserialize(de::value::U32Deserializer::<de::value::Error>::new(0))
        .is_err());
        assert_eq!(calls.get(), 2, "unsupported tags never reach the seed");
    }
}
