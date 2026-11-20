//! Cold, private complete-runtime serialization helpers. No arbitrary-byte import
//! is exposed. Encoded bytes are bounded; this is not a total decode-memory bound.
use crate::engine::RuntimeCheckpointError;
use postcard::ser_flavors::Flavor;

mod fallible_values;

pub(crate) const MAX_BYTES: usize = 64 * 1024 * 1024;
const HEADER: usize = 32;
const MAGIC: &[u8; 8] = b"F2DENGN\0";
const VERSION: u32 = 2;
include!(concat!(env!("OUT_DIR"), "/checkpoint_build.rs"));

/// Strict private file identity. This is compatibility metadata, not admission
/// or authentication, and does not expose a new Wasm/public engine API.
pub(crate) const fn build_fingerprint() -> u64 {
    BUILD
}

fn checksum(bytes: &[u8]) -> u32 {
    let mut value = !0u32;
    for byte in bytes {
        value ^= u32::from(*byte);
        for _ in 0..8 {
            value = (value >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(value & 1));
        }
    }
    !value
}
struct Output {
    bytes: Vec<u8>,
    limit: usize,
}
impl Flavor for Output {
    type Output = Vec<u8>;
    fn try_push(&mut self, byte: u8) -> postcard::Result<()> {
        self.try_extend(&[byte])
    }
    fn try_extend(&mut self, bytes: &[u8]) -> postcard::Result<()> {
        let length = self.bytes.len().saturating_add(bytes.len());
        if length > self.limit {
            return Err(postcard::Error::SerializeBufferFull);
        }
        if length > self.bytes.capacity() {
            let capacity = (self.bytes.capacity() + self.bytes.capacity() / 2)
                .max(length)
                .min(self.limit);
            self.bytes
                .try_reserve_exact(capacity - self.bytes.len())
                .map_err(|_| postcard::Error::SerializeBufferFull)?;
        }
        self.bytes.extend_from_slice(bytes);
        Ok(())
    }
    fn finalize(self) -> postcard::Result<Vec<u8>> {
        Ok(self.bytes)
    }
}
pub(crate) fn encode<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, RuntimeCheckpointError> {
    encode_with_limit(value, MAX_BYTES)
}
pub(crate) fn encode_with_limit<T: serde::Serialize>(
    value: &T,
    limit: usize,
) -> Result<Vec<u8>, RuntimeCheckpointError> {
    if !(HEADER..=MAX_BYTES).contains(&limit) {
        return Err(RuntimeCheckpointError::Capacity);
    }
    let mut prefix = Vec::new();
    prefix
        .try_reserve_exact(HEADER)
        .map_err(|_| RuntimeCheckpointError::Capacity)?;
    prefix.resize(HEADER, 0);
    let mut bytes = postcard::serialize_with_flavor(
        value,
        Output {
            bytes: prefix,
            limit,
        },
    )
    .map_err(|e| {
        if e == postcard::Error::SerializeBufferFull {
            RuntimeCheckpointError::Capacity
        } else {
            RuntimeCheckpointError::InvalidState
        }
    })?;
    let length = (bytes.len() - HEADER) as u32;
    let crc = checksum(&bytes[HEADER..]);
    bytes[..8].copy_from_slice(MAGIC);
    bytes[8..12].copy_from_slice(&VERSION.to_le_bytes());
    bytes[12..20].copy_from_slice(&BUILD.to_le_bytes());
    bytes[20..24].copy_from_slice(&length.to_le_bytes());
    bytes[24..28].copy_from_slice(&crc.to_le_bytes());
    bytes[28..32].copy_from_slice(&usize::BITS.to_le_bytes());
    Ok(bytes)
}
#[cfg(test)]
pub(crate) fn decode<T: serde::de::DeserializeOwned>(
    bytes: &[u8],
) -> Result<T, RuntimeCheckpointError> {
    decode_with_limits(bytes, crate::checkpoint_decode::Limits::default())
}
pub(crate) fn decode_with_limits<T: serde::de::DeserializeOwned>(
    bytes: &[u8],
    limits: crate::checkpoint_decode::Limits,
) -> Result<T, RuntimeCheckpointError> {
    decode_with_usage(bytes, limits).map(|(value, _)| value)
}

pub(crate) fn decode_with_usage<T: serde::de::DeserializeOwned>(
    bytes: &[u8],
    limits: crate::checkpoint_decode::Limits,
) -> Result<(T, crate::checkpoint_decode::Usage), RuntimeCheckpointError> {
    let payload = validated_payload(bytes)?;
    crate::checkpoint_decode::with_limits(payload, limits).map_err(decode_error)
}

/// File-only nested fields retain the enclosing decoder's cumulative budget.
pub(crate) fn decode_in_scope<T: serde::de::DeserializeOwned>(
    bytes: &[u8],
) -> Result<T, RuntimeCheckpointError> {
    let payload = validated_payload(bytes)?;
    crate::checkpoint_decode::from_bytes_in_scope(payload).map_err(decode_error)
}

fn decode_error(error: crate::checkpoint_decode::Error) -> RuntimeCheckpointError {
    match error.kind {
        crate::checkpoint_decode::ErrorKind::Limit(_)
        | crate::checkpoint_decode::ErrorKind::Allocation => RuntimeCheckpointError::Capacity,
        crate::checkpoint_decode::ErrorKind::Trailing => RuntimeCheckpointError::InvalidEnvelope,
        crate::checkpoint_decode::ErrorKind::Invalid => RuntimeCheckpointError::InvalidState,
    }
}

fn validated_payload(bytes: &[u8]) -> Result<&[u8], RuntimeCheckpointError> {
    if bytes.len() > MAX_BYTES {
        return Err(RuntimeCheckpointError::Capacity);
    }
    if bytes.len() < HEADER || &bytes[..8] != MAGIC {
        return Err(RuntimeCheckpointError::InvalidEnvelope);
    }
    let word = |at| u32::from_le_bytes(bytes[at..at + 4].try_into().expect("checked header"));
    if word(8) != VERSION
        || word(28) != usize::BITS
        || u64::from_le_bytes(bytes[12..20].try_into().expect("checked header")) != BUILD
    {
        return Err(RuntimeCheckpointError::IncompatibleBuild);
    }
    if word(20) as usize != bytes.len() - HEADER {
        return Err(RuntimeCheckpointError::InvalidEnvelope);
    }
    let payload = &bytes[HEADER..];
    if checksum(payload) != word(24) {
        return Err(RuntimeCheckpointError::Corrupt);
    }
    Ok(payload)
}

/// Preserve preallocation used by bounded queues and joint free lists.
pub(crate) mod vector {
    use serde::{Deserialize, Serialize};
    pub fn serialize<T: Serialize, S: serde::Serializer>(
        value: &Vec<T>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        if value.capacity() > super::MAX_BYTES / std::mem::size_of::<T>().max(1) {
            return Err(serde::ser::Error::custom(
                "checkpoint vector capacity exceeds budget",
            ));
        }
        (value.capacity(), value.as_slice()).serialize(serializer)
    }
    pub fn deserialize<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<T>, D::Error> {
        let (capacity, values): (usize, super::fallible_values::Values<T>) =
            Deserialize::deserialize(deserializer)?;
        let mut values = values.0;
        if capacity < values.len() || capacity > super::MAX_BYTES / std::mem::size_of::<T>().max(1)
        {
            return Err(serde::de::Error::custom(
                "invalid checkpoint vector capacity",
            ));
        }
        if capacity != values.capacity() {
            crate::checkpoint_decode::reserve::<T>(capacity)
                .map_err(|_| serde::de::Error::custom("checkpoint reservation budget exceeded"))?;
            let mut exact = Vec::new();
            exact
                .try_reserve_exact(capacity)
                .map_err(crate::checkpoint_decode::allocation_error)?;
            exact.append(&mut values);
            return Ok(exact);
        }
        Ok(values)
    }
}
pub(crate) mod optional_array {
    use serde::{Deserialize, Serialize};
    pub fn serialize<T: Serialize, S: serde::Serializer, const N: usize>(
        value: &Option<[T; N]>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value
            .as_ref()
            .map(|array| array.as_slice())
            .serialize(serializer)
    }
    pub fn deserialize<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>, const N: usize>(
        deserializer: D,
    ) -> Result<Option<[T; N]>, D::Error> {
        Option::<super::fallible_values::Values<T>>::deserialize(deserializer)?
            .map(|v| {
                v.0.try_into().map_err(|_| {
                    serde::de::Error::custom("invalid optional checkpoint array length")
                })
            })
            .transpose()
    }
}
/// Workspace whose previous contents are unconditionally cleared before use.
pub(crate) mod workspace_vector {
    use serde::{Deserialize, Serialize};
    pub fn serialize<T, S: serde::Serializer>(
        value: &Vec<T>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        if value.capacity() > super::MAX_BYTES / std::mem::size_of::<T>().max(1) {
            return Err(serde::ser::Error::custom(
                "checkpoint workspace capacity exceeds budget",
            ));
        }
        value.capacity().serialize(serializer)
    }
    pub fn deserialize<'de, T, D: serde::Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Vec<T>, D::Error> {
        let capacity = usize::deserialize(deserializer)?;
        if capacity > super::MAX_BYTES / std::mem::size_of::<T>().max(1) {
            return Err(serde::de::Error::custom(
                "invalid checkpoint workspace capacity",
            ));
        }
        let mut values = Vec::new();
        crate::checkpoint_decode::reserve::<T>(capacity)
            .map_err(|_| serde::de::Error::custom("checkpoint workspace budget exceeded"))?;
        values
            .try_reserve_exact(capacity)
            .map_err(crate::checkpoint_decode::allocation_error)?;
        Ok(values)
    }
}
/// Canonical key order; randomized HashMap iteration is not a file format.
pub(crate) mod map {
    use serde::{Deserialize, Serialize};
    use std::{collections::HashMap, hash::Hash};
    pub fn serialize<K: Ord + Serialize, V: Serialize, S: serde::Serializer>(
        value: &HashMap<K, V>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        if value.capacity() > super::MAX_BYTES / std::mem::size_of::<(K, V)>().max(1) {
            return Err(serde::ser::Error::custom(
                "checkpoint map capacity exceeds budget",
            ));
        }
        let mut entries: Vec<_> = value.iter().collect();
        entries.sort_unstable_by(|a, b| a.0.cmp(b.0));
        (value.capacity(), entries).serialize(serializer)
    }
    pub fn deserialize<
        'de,
        K: Eq + Hash + Deserialize<'de>,
        V: Deserialize<'de>,
        D: serde::Deserializer<'de>,
    >(
        deserializer: D,
    ) -> Result<HashMap<K, V>, D::Error> {
        let (capacity, entries): (usize, super::fallible_values::Values<(K, V)>) =
            Deserialize::deserialize(deserializer)?;
        let entries = entries.0;
        if capacity < entries.len()
            || capacity > super::MAX_BYTES / std::mem::size_of::<(K, V)>().max(1)
        {
            return Err(serde::de::Error::custom("invalid checkpoint map capacity"));
        }
        let mut values = HashMap::new();
        // Includes conservative bucket/control overhead as well as element slots.
        crate::checkpoint_decode::reserve::<(K, V)>(capacity)
            .and_then(|()| crate::checkpoint_decode::reserve_bytes(capacity.saturating_mul(16)))
            .map_err(|_| serde::de::Error::custom("checkpoint map budget exceeded"))?;
        values
            .try_reserve(capacity)
            .map_err(crate::checkpoint_decode::allocation_error)?;
        for (key, value) in entries {
            if values.insert(key, value).is_some() {
                return Err(serde::de::Error::custom("duplicate checkpoint map key"));
            }
        }
        Ok(values)
    }
}
pub(crate) mod array {
    use serde::{Deserialize, Serialize};
    pub fn serialize<T: Serialize, S: serde::Serializer, const N: usize>(
        value: &[T; N],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        value.as_slice().serialize(serializer)
    }
    pub fn deserialize<'de, T: Deserialize<'de>, D: serde::Deserializer<'de>, const N: usize>(
        deserializer: D,
    ) -> Result<[T; N], D::Error> {
        let values = super::fallible_values::Values::<T>::deserialize(deserializer)?;
        values
            .0
            .try_into()
            .map_err(|_| serde::de::Error::custom("invalid checkpoint array length"))
    }
}

#[cfg(test)]
mod tests;
