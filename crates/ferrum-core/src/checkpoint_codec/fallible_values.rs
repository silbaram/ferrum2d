//! Same Serde sequence wire and element/budget frames as Vec<T>, with explicit
//! fallible growth from the very first element. Nested T still owns its own
//! allocation policy; this is not a whole Engine/allocator/RSS admission bound.
use serde::de::{Deserialize, Deserializer, SeqAccess, Visitor};
use std::{fmt, marker::PhantomData};

pub(super) struct Values<T>(pub Vec<T>);

impl<'de, T: Deserialize<'de>> Deserialize<'de> for Values<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Sequence<T>(PhantomData<T>);
        impl<'de, T: Deserialize<'de>> Visitor<'de> for Sequence<T> {
            type Value = Values<T>;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("checkpoint values sequence")
            }

            fn visit_seq<A: SeqAccess<'de>>(self, mut source: A) -> Result<Self::Value, A::Error> {
                let mut values = Vec::new();
                // Do not preallocate from a file's length hint. The shared
                // decoder charges each element before constructing T; reserve
                // the outer backing before push and drop T on reservation error.
                while let Some(value) = source.next_element()? {
                    if values.len() == values.capacity() {
                        values
                            .try_reserve(1)
                            .map_err(crate::checkpoint_decode::allocation_error)?;
                    }
                    values.push(value);
                }
                Ok(Values(values))
            }
        }
        deserializer.deserialize_seq(Sequence(PhantomData))
    }
}
