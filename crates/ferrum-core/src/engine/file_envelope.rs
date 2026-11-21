//! Private, bounded native-file framing. This only validates the container;
//! Engine/SDK semantics, resource materialization and atomic publication are
//! separate required stages. There is no public arbitrary-byte importer here.
use std::fmt;

const MAGIC: &[u8; 8] = b"F2DFILE\0";
const VERSION: u32 = 1;
const HEADER_BYTES: usize = 64;
const ENTRY_BYTES: usize = 32;
const SECTION_COUNT: usize = 7;
const CONTENT_START: usize = HEADER_BYTES + ENTRY_BYTES * SECTION_COUNT;
const ABSOLUTE_MAX_BYTES: usize = 256 * 1024 * 1024;

/// Required sections in canonical file order. Empty collections still require
/// their encoded count/schema; a zero-byte section is never a complete value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub(crate) enum SectionKind {
    Engine = 1,
    Variables = 2,
    Authoring = 3,
    ResourceManifest = 4,
    ResourceData = 5,
    DialogueQuest = 6,
    HostBindings = 7,
}
const SECTIONS: [SectionKind; SECTION_COUNT] = [
    SectionKind::Engine,
    SectionKind::Variables,
    SectionKind::Authoring,
    SectionKind::ResourceManifest,
    SectionKind::ResourceData,
    SectionKind::DialogueQuest,
    SectionKind::HostBindings,
];

/// Strict compatibility identity supplied by the eventual Engine/SDK loader.
/// Matching these numbers is not semantic admission or authentication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BuildProfile {
    pub engine: u64,
    pub sdk: u64,
    pub word_bits: u32,
}

/// Encoded bytes and CRC scan bytes, not decoded heap, GPU, or CPU budgets.
/// The seven content decoders must impose their own cumulative limits too.
#[derive(Debug, Clone)]
pub(crate) struct Limits {
    pub max_file_bytes: usize,
    pub max_checksum_bytes: usize,
    pub max_section_bytes: [usize; SECTION_COUNT],
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            max_file_bytes: 64 * 1024 * 1024,
            max_checksum_bytes: 64 * 1024 * 1024,
            max_section_bytes: [
                64 * 1024 * 1024,
                4 * 1024 * 1024,
                16 * 1024 * 1024,
                4 * 1024 * 1024,
                64 * 1024 * 1024,
                8 * 1024 * 1024,
                4 * 1024 * 1024,
            ],
        }
    }
}
impl Limits {
    fn validate(&self) -> Result<(), Error> {
        if self.max_file_bytes > ABSOLUTE_MAX_BYTES
            || self.max_checksum_bytes > ABSOLUTE_MAX_BYTES
            || self
                .max_section_bytes
                .iter()
                .any(|&n| n > ABSOLUTE_MAX_BYTES)
        {
            return Err(Error::InvalidLimits);
        }
        Ok(())
    }
    fn admit_length(&self, length: usize) -> Result<(), Error> {
        if length > self.max_file_bytes {
            return Err(Error::Capacity);
        }
        // Header (64), directory (224), and disjoint content are each CRC-scanned
        // once. Charge their total before any allocation or checksum iteration.
        if length > self.max_checksum_bytes {
            return Err(Error::ChecksumWorkLimit);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Error {
    InvalidLimits,
    Capacity,
    ChecksumWorkLimit,
    Allocation,
    Truncated,
    BadMagic,
    UnsupportedVersion,
    InvalidHeader,
    IncompatibleProfile,
    InvalidDirectory,
    SectionLength(SectionKind),
    CorruptHeader,
    CorruptDirectory,
    CorruptSection(SectionKind),
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "native file envelope rejected: {self:?}")
    }
}
impl std::error::Error for Error {}

/// Owned by the caller; the framing encoder never interprets these payloads.
pub(crate) struct Sections<'a> {
    pub engine: &'a [u8],
    pub variables: &'a [u8],
    pub authoring: &'a [u8],
    pub resource_manifest: &'a [u8],
    pub resource_data: &'a [u8],
    pub dialogue_quest: &'a [u8],
    pub host_bindings: &'a [u8],
}
impl Sections<'_> {
    fn slices(&self) -> [&[u8]; SECTION_COUNT] {
        [
            self.engine,
            self.variables,
            self.authoring,
            self.resource_manifest,
            self.resource_data,
            self.dialogue_quest,
            self.host_bindings,
        ]
    }
}
impl fmt::Debug for Sections<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Sections")
            .field("lengths", &self.slices().map(<[u8]>::len))
            .finish()
    }
}

/// Borrowed views are valid only while the input file bytes remain owned/alive.
/// This does not expose an Engine until its separate semantic admission passes.
pub(crate) struct ParsedEnvelope<'a> {
    profile: BuildProfile,
    data: [&'a [u8]; SECTION_COUNT],
    ranges: [(usize, usize); SECTION_COUNT],
}
impl<'a> ParsedEnvelope<'a> {
    /// Checked canonical offsets, safe to retain after the borrowed view ends.
    pub(crate) fn checked_ranges(&self) -> [(usize, usize); SECTION_COUNT] {
        self.ranges
    }
    pub fn profile(&self) -> &BuildProfile {
        &self.profile
    }
    pub fn section(&self, kind: SectionKind) -> &'a [u8] {
        self.data[kind as usize - 1]
    }
}
impl fmt::Debug for ParsedEnvelope<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ParsedEnvelope")
            .field("profile", &self.profile)
            .field("lengths", &self.data.map(<[u8]>::len))
            .finish()
    }
}

/// Encode every required section with one fallible output reservation.
///
/// # Errors
/// Rejects invalid profile/limits, missing/oversized sections, byte/work limit
/// exhaustion and allocation failure before exposing a partial output.
pub(crate) fn encode(
    profile: &BuildProfile,
    sections: &Sections<'_>,
    limits: &Limits,
) -> Result<Vec<u8>, Error> {
    limits.validate()?;
    if !matches!(profile.word_bits, 32 | 64) {
        return Err(Error::IncompatibleProfile);
    }
    let data = sections.slices();
    let mut length = CONTENT_START;
    for (i, bytes) in data.iter().enumerate() {
        if bytes.is_empty() {
            return Err(Error::SectionLength(SECTIONS[i]));
        }
        if bytes.len() > limits.max_section_bytes[i] {
            return Err(Error::Capacity);
        }
        length = length.checked_add(bytes.len()).ok_or(Error::Capacity)?;
    }
    limits.admit_length(length)?;
    let mut output = Vec::new();
    output
        .try_reserve_exact(length)
        .map_err(|_| Error::Allocation)?;
    output.resize(length, 0);
    output[..8].copy_from_slice(MAGIC);
    put_u32(&mut output, 8, VERSION);
    put_u32(&mut output, 12, HEADER_BYTES as u32);
    put_u32(&mut output, 20, SECTION_COUNT as u32);
    put_u64(&mut output, 24, length as u64);
    put_u64(&mut output, 32, profile.engine);
    put_u64(&mut output, 40, profile.sdk);
    put_u32(&mut output, 56, profile.word_bits);
    let mut offset = CONTENT_START;
    for (i, bytes) in data.iter().enumerate() {
        let entry = HEADER_BYTES + i * ENTRY_BYTES;
        put_u32(&mut output, entry, SECTIONS[i] as u32);
        put_u64(&mut output, entry + 8, offset as u64);
        put_u64(&mut output, entry + 16, bytes.len() as u64);
        put_u32(&mut output, entry + 24, checksum(bytes));
        output[offset..offset + bytes.len()].copy_from_slice(bytes);
        offset += bytes.len();
    }
    let directory_crc = checksum(&output[HEADER_BYTES..CONTENT_START]);
    put_u32(&mut output, 48, directory_crc);
    let header_crc = header_checksum(&output[..HEADER_BYTES]);
    put_u32(&mut output, 52, header_crc);
    Ok(output)
}

/// Validate framing without allocating or interpreting Engine/SDK payloads.
/// Caller-owned bytes must be fixed before crossing a reentrant host boundary.
///
/// # Errors
/// Rejects incompatible/unknown format data, malformed sizes/offsets/order,
/// missing sections, limits and corrupt header/directory/content checksums.
pub(crate) fn read<'a>(
    bytes: &'a [u8],
    expected: &BuildProfile,
    limits: &Limits,
) -> Result<ParsedEnvelope<'a>, Error> {
    limits.validate()?;
    limits.admit_length(bytes.len())?;
    if bytes.len() < HEADER_BYTES {
        return Err(Error::Truncated);
    }
    if &bytes[..8] != MAGIC {
        return Err(Error::BadMagic);
    }
    if u32_at(bytes, 8) != VERSION {
        return Err(Error::UnsupportedVersion);
    }
    if u32_at(bytes, 12) != HEADER_BYTES as u32
        || u32_at(bytes, 16) != 0
        || u32_at(bytes, 20) != SECTION_COUNT as u32
        || u32_at(bytes, 60) != 0
    {
        return Err(Error::InvalidHeader);
    }
    if header_checksum(&bytes[..HEADER_BYTES]) != u32_at(bytes, 52) {
        return Err(Error::CorruptHeader);
    }
    let profile = BuildProfile {
        engine: u64_at(bytes, 32),
        sdk: u64_at(bytes, 40),
        word_bits: u32_at(bytes, 56),
    };
    if !matches!(profile.word_bits, 32 | 64) || profile != *expected {
        return Err(Error::IncompatibleProfile);
    }
    if u64_at(bytes, 24) != bytes.len() as u64 {
        return Err(Error::InvalidHeader);
    }
    if bytes.len() < CONTENT_START {
        return Err(Error::Truncated);
    }
    if checksum(&bytes[HEADER_BYTES..CONTENT_START]) != u32_at(bytes, 48) {
        return Err(Error::CorruptDirectory);
    }
    let mut ranges = [(0, 0); SECTION_COUNT];
    let mut next = CONTENT_START;
    // Finish every length/offset check before scanning any section's content.
    for i in 0..SECTION_COUNT {
        let entry = HEADER_BYTES + i * ENTRY_BYTES;
        if u32_at(bytes, entry) != SECTIONS[i] as u32
            || u32_at(bytes, entry + 4) != 0
            || u32_at(bytes, entry + 28) != 0
        {
            return Err(Error::InvalidDirectory);
        }
        let offset =
            usize::try_from(u64_at(bytes, entry + 8)).map_err(|_| Error::InvalidDirectory)?;
        let length =
            usize::try_from(u64_at(bytes, entry + 16)).map_err(|_| Error::InvalidDirectory)?;
        if length == 0 {
            return Err(Error::SectionLength(SECTIONS[i]));
        }
        if length > limits.max_section_bytes[i] {
            return Err(Error::Capacity);
        }
        let end = offset.checked_add(length).ok_or(Error::InvalidDirectory)?;
        if offset != next || end > bytes.len() {
            return Err(Error::InvalidDirectory);
        }
        ranges[i] = (offset, end);
        next = end;
    }
    if next != bytes.len() {
        return Err(Error::InvalidDirectory);
    }
    let mut data = [&[][..]; SECTION_COUNT];
    for i in 0..SECTION_COUNT {
        let (start, end) = ranges[i];
        let section = &bytes[start..end];
        if checksum(section) != u32_at(bytes, HEADER_BYTES + i * ENTRY_BYTES + 24) {
            return Err(Error::CorruptSection(SECTIONS[i]));
        }
        data[i] = section;
    }
    Ok(ParsedEnvelope {
        profile,
        data,
        ranges,
    })
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(
        bytes[at..at + 4]
            .try_into()
            .expect("validated fixed-width field"),
    )
}
fn u64_at(bytes: &[u8], at: usize) -> u64 {
    u64::from_le_bytes(
        bytes[at..at + 8]
            .try_into()
            .expect("validated fixed-width field"),
    )
}
fn put_u32(bytes: &mut [u8], at: usize, value: u32) {
    bytes[at..at + 4].copy_from_slice(&value.to_le_bytes());
}
fn put_u64(bytes: &mut [u8], at: usize, value: u64) {
    bytes[at..at + 8].copy_from_slice(&value.to_le_bytes());
}
fn crc_byte(mut crc: u32, byte: u8) -> u32 {
    crc ^= u32::from(byte);
    for _ in 0..8 {
        crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
    }
    crc
}
fn checksum(bytes: &[u8]) -> u32 {
    !bytes.iter().fold(!0u32, |crc, &byte| crc_byte(crc, byte))
}
fn header_checksum(header: &[u8]) -> u32 {
    !header.iter().enumerate().fold(!0u32, |crc, (i, &byte)| {
        crc_byte(crc, if (52..56).contains(&i) { 0 } else { byte })
    })
}

#[cfg(test)]
mod tests;
