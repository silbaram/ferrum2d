//! Cold raw-order checks for persistent native runtime maps/sets. Standard
//! Serialize wire and the caller's cumulative decoder budget are unchanged.
//! Checking before insertion prevents silent BTree sorting/overwriting.
use serde::de::{self, MapAccess, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::marker::PhantomData;

pub(super) fn map<'de, D, K, V>(source: D) -> Result<BTreeMap<K, V>, D::Error>
where
    D: Deserializer<'de>,
    K: Deserialize<'de> + Ord,
    V: Deserialize<'de>,
{
    struct Ordered<K, V>(PhantomData<(K, V)>);
    impl<'de, K: Deserialize<'de> + Ord, V: Deserialize<'de>> Visitor<'de> for Ordered<K, V> {
        type Value = BTreeMap<K, V>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a native runtime map with strictly increasing keys")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut source: A) -> Result<Self::Value, A::Error> {
            let mut values = BTreeMap::new();
            while let Some(key) = source.next_key()? {
                if values
                    .last_key_value()
                    .is_some_and(|(last, _)| last >= &key)
                {
                    return Err(de::Error::custom("non-increasing native runtime map keys"));
                }
                let value = source.next_value()?;
                values.insert(key, value);
            }
            Ok(values)
        }
    }
    source.deserialize_map(Ordered(PhantomData))
}

pub(super) fn optional_map<'de, D, K, V>(source: D) -> Result<Option<BTreeMap<K, V>>, D::Error>
where
    D: Deserializer<'de>,
    K: Deserialize<'de> + Ord,
    V: Deserialize<'de>,
{
    struct Optional<K, V>(PhantomData<(K, V)>);
    impl<'de, K: Deserialize<'de> + Ord, V: Deserialize<'de>> Visitor<'de> for Optional<K, V> {
        type Value = Option<BTreeMap<K, V>>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("an optional native runtime map with strictly increasing keys")
        }
        fn visit_none<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
            Ok(None)
        }
        fn visit_some<S: Deserializer<'de>>(self, source: S) -> Result<Self::Value, S::Error> {
            map(source).map(Some)
        }
    }
    source.deserialize_option(Optional(PhantomData))
}

pub(super) fn set<'de, D, K>(source: D) -> Result<BTreeSet<K>, D::Error>
where
    D: Deserializer<'de>,
    K: Deserialize<'de> + Ord,
{
    struct Ordered<K>(PhantomData<K>);
    impl<'de, K: Deserialize<'de> + Ord> Visitor<'de> for Ordered<K> {
        type Value = BTreeSet<K>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("a native runtime set with strictly increasing keys")
        }
        fn visit_seq<A: SeqAccess<'de>>(self, mut source: A) -> Result<Self::Value, A::Error> {
            let mut values = BTreeSet::new();
            while let Some(key) = source.next_element()? {
                if values.last().is_some_and(|last| last >= &key) {
                    return Err(de::Error::custom("non-increasing native runtime set keys"));
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
