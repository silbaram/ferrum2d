//! Versioned file-only Engine section. The embedded memory payload and alias
//! tables decode in ONE cumulative admission scope. This is not complete Engine
//! admission and does not restore aliases, execute or publish the candidate.
use super::{persistence, Engine, RuntimeCheckpointError};
use serde::{de, Deserialize, Serialize};
use std::fmt;

const MAGIC: &[u8; 8] = b"F2DFSTAT";
const VERSION: u32 = 1;
const PREFIX: usize = 16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Error {
    InvalidPrefix,
    UnsupportedVersion,
    Capacity,
    Payload(RuntimeCheckpointError),
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "file Engine section rejected: {self:?}")
    }
}
impl std::error::Error for Error {}

struct Bytes<'a>(&'a [u8]);
impl Serialize for Bytes<'_> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_bytes(self.0)
    }
}
#[derive(Serialize)]
struct Capture<'a, A, S> {
    engine: Bytes<'a>,
    arcs: &'a A,
    shapes: &'a S,
}

/// Tables are owned but deliberately not yet admitted or applied to the Engine.
/// Callers must retain all owner semantic/topology admission obligations.
#[derive(Deserialize)]
pub(super) struct Decoded<A, S> {
    #[serde(deserialize_with = "decode_engine")]
    pub engine: Box<Engine>,
    pub arcs: A,
    pub shapes: S,
}

fn decode_engine<'de, D: de::Deserializer<'de>>(source: D) -> Result<Box<Engine>, D::Error> {
    struct EngineBytes;
    impl<'de> de::Visitor<'de> for EngineBytes {
        type Value = Box<Engine>;
        fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            f.write_str("borrowed complete Engine memory payload")
        }
        fn visit_borrowed_bytes<E: de::Error>(self, value: &'de [u8]) -> Result<Self::Value, E> {
            self.visit_bytes(value)
        }
        fn visit_bytes<E: de::Error>(self, value: &[u8]) -> Result<Self::Value, E> {
            // No bytes Vec or nested default scope. Native physics payloads inside
            // this Engine inherit this same outer scope too.
            persistence::decode_in_scope(value).map_err(E::custom)
        }
    }
    source.deserialize_bytes(EngineBytes)
}

pub(super) fn encode<A: Serialize, S: Serialize>(
    memory: &[u8],
    arcs: &A,
    shapes: &S,
) -> Result<Vec<u8>, Error> {
    if memory.len() > crate::checkpoint_codec::MAX_BYTES - PREFIX {
        return Err(Error::Capacity);
    }
    let payload = crate::checkpoint_codec::encode_with_limit(
        &Capture {
            engine: Bytes(memory),
            arcs,
            shapes,
        },
        crate::checkpoint_codec::MAX_BYTES - PREFIX,
    )
    .map_err(Error::Payload)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(PREFIX + payload.len())
        .map_err(|_| Error::Capacity)?;
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&VERSION.to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    bytes.extend_from_slice(&payload);
    Ok(bytes)
}

pub(super) fn decode<A: de::DeserializeOwned, S: de::DeserializeOwned>(
    bytes: &[u8],
    limits: crate::checkpoint_decode::Limits,
) -> Result<Decoded<A, S>, Error> {
    decode_with_usage(bytes, limits).map(|(value, _)| value)
}

pub(super) fn decode_with_usage<A: de::DeserializeOwned, S: de::DeserializeOwned>(
    bytes: &[u8],
    limits: crate::checkpoint_decode::Limits,
) -> Result<(Decoded<A, S>, crate::checkpoint_decode::Usage), Error> {
    if bytes.len() > crate::checkpoint_codec::MAX_BYTES {
        return Err(Error::Capacity);
    }
    if bytes.len() < PREFIX || &bytes[..8] != MAGIC || bytes[12..16] != [0; 4] {
        return Err(Error::InvalidPrefix);
    }
    let version = u32::from_le_bytes(bytes[8..12].try_into().expect("checked fixed prefix"));
    if version != VERSION {
        return Err(Error::UnsupportedVersion);
    }
    crate::checkpoint_codec::decode_with_usage(&bytes[PREFIX..], limits).map_err(Error::Payload)
}

#[cfg(test)]
mod tests;
