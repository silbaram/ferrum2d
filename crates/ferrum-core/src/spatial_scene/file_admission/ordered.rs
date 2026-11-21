//! Reject malformed raw key order before BTree insertion can sort/overwrite it.
//! Normal Serialize remains the standard BTree wire. The caller's Deserializer
//! is used directly, retaining the existing ACTIVE cumulative decode budget.
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::marker::PhantomData;

pub(in crate::spatial_scene) fn map<'de, D, K, V>(source: D) -> Result<BTreeMap<K, V>, D::Error>
where
    D: Deserializer<'de>,
    K: Deserialize<'de> + Ord,
    V: Deserialize<'de>,
{
    struct Ordered<K, V>(PhantomData<(K, V)>);
    impl<'de, K: Deserialize<'de> + Ord, V: Deserialize<'de>> Visitor<'de> for Ordered<K, V> {
        type Value = BTreeMap<K, V>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a spatial map with strictly increasing keys")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut source: A) -> Result<Self::Value, A::Error> {
            let mut values = BTreeMap::new();
            while let Some(key) = source.next_key()? {
                if values
                    .last_key_value()
                    .is_some_and(|(last, _)| last >= &key)
                {
                    // Check before decoding the duplicate/out-of-order value.
                    return Err(de::Error::custom("non-increasing spatial map keys"));
                }
                let value = source.next_value()?;
                values.insert(key, value);
            }
            Ok(values)
        }
    }
    source.deserialize_map(Ordered(PhantomData))
}

pub(in crate::spatial_scene) fn set<'de, D, K>(source: D) -> Result<BTreeSet<K>, D::Error>
where
    D: Deserializer<'de>,
    K: Deserialize<'de> + Ord,
{
    struct Ordered<K>(PhantomData<K>);
    impl<'de, K: Deserialize<'de> + Ord> Visitor<'de> for Ordered<K> {
        type Value = BTreeSet<K>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a spatial set with strictly increasing keys")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut source: A) -> Result<Self::Value, A::Error> {
            let mut values = BTreeSet::new();
            while let Some(key) = source.next_element()? {
                if values.last().is_some_and(|last| last >= &key) {
                    return Err(de::Error::custom("non-increasing spatial set keys"));
                }
                values.insert(key);
            }
            Ok(values)
        }
    }
    source.deserialize_seq(Ordered(PhantomData))
}

#[cfg(test)]
mod tests;
