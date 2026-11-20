//! Preserve the existing sequence/map wire while rejecting normalization.
use super::*;
use serde::Serialize;
pub(super) mod open {
    use super::*;
    pub fn serialize<S: serde::Serializer>(v: &BinaryHeap<Open>, s: S) -> Result<S::Ok, S::Error> {
        v.serialize(s)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(
        d: D,
    ) -> Result<BinaryHeap<Open>, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = BinaryHeap<Open>;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("ordered native search heap sequence")
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(
                self,
                mut a: A,
            ) -> Result<Self::Value, A::Error> {
                let mut v = Vec::new();
                while let Some(value) = a.next_element::<Open>()? {
                    if v.len() >= MAX_OPEN || (!v.is_empty() && v[(v.len() - 1) / 2] < value) {
                        return Err(serde::de::Error::custom("invalid saved native search heap"));
                    }
                    v.try_reserve(1)
                        .map_err(|_| serde::de::Error::custom("saved heap allocation failed"))?;
                    v.push(value);
                }
                // Every parent already dominates its children. Heapify performs no swaps.
                Ok(BinaryHeap::from(v))
            }
        }
        d.deserialize_seq(Visitor)
    }
}
pub(super) mod known {
    use super::*;
    type Known = BTreeMap<(i32, i32, u32), usize>;
    pub fn serialize<S: serde::Serializer>(v: &Known, s: S) -> Result<S::Ok, S::Error> {
        v.serialize(s)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Known, D::Error> {
        struct Visitor;
        impl<'de> serde::de::Visitor<'de> for Visitor {
            type Value = Known;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("strictly ordered native search known map")
            }
            fn visit_map<A: serde::de::MapAccess<'de>>(
                self,
                mut a: A,
            ) -> Result<Self::Value, A::Error> {
                let mut out = BTreeMap::new();
                let mut last = None;
                while let Some((key, value)) = a.next_entry::<(i32, i32, u32), usize>()? {
                    if out.len() >= MAX_NODES || last.is_some_and(|previous| previous >= key) {
                        return Err(serde::de::Error::custom(
                            "invalid saved native search map order",
                        ));
                    }
                    last = Some(key);
                    out.insert(key, value);
                }
                Ok(out)
            }
        }
        d.deserialize_map(Visitor)
    }
}
