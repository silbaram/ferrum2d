//! Same map wire, without std BTreeMap's reorder/duplicate-overwrite behavior.
use super::{BodyId, CharacterRuntime};
use serde::Serialize;
use std::collections::BTreeMap;

pub(super) fn serialize<S: serde::Serializer>(
    characters: &BTreeMap<BodyId, CharacterRuntime>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    characters.serialize(serializer)
}

pub(super) fn deserialize<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<BodyId, CharacterRuntime>, D::Error> {
    struct Visitor;
    impl<'de> serde::de::Visitor<'de> for Visitor {
        type Value = BTreeMap<BodyId, CharacterRuntime>;

        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("strictly increasing native character identities")
        }

        fn visit_map<A: serde::de::MapAccess<'de>>(
            self,
            mut source: A,
        ) -> Result<Self::Value, A::Error> {
            let mut characters = BTreeMap::new();
            let mut previous = None;
            while let Some(id) = source.next_key::<BodyId>()? {
                // 1024 is WorldConfig's existing constructor maximum. The
                // candidate's smaller configured maximum is checked later.
                if characters.len() >= 1024 || previous.is_some_and(|old| old >= id) {
                    return Err(serde::de::Error::custom(
                        "invalid saved character map order",
                    ));
                }
                // This is the original map allocation, with no staging copy or
                // sort. The existing ACTIVE decoder charges key/value/collection
                // allocation work through these same MapAccess operations.
                let runtime = source.next_value::<CharacterRuntime>()?;
                previous = Some(id);
                characters.insert(id, runtime);
            }
            Ok(characters)
        }
    }
    deserializer.deserialize_map(Visitor)
}
