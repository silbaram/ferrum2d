//! Owned cold native-file boundary. SDK sections remain unvalidated; not Ready.
use super::{file_candidate as candidate, file_envelope as framing, Engine};
use std::{fmt, sync::Arc};
use wasm_bindgen::prelude::*;
mod limits;
mod packet;
#[cfg(test)]
mod tests;
use limits::Limits;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Error {
    InvalidLimits,
    InputCapacity,
    Admission(candidate::Error),
    Work,
    Scratch,
    Output,
    Allocation,
    Section,
    Consumed,
    ForeignTarget,
    TargetChanged,
    RestoreInProgress,
    Capture(candidate::Error),
    Framing(framing::Error),
    Overflow,
}
impl Error {
    fn code(self) -> u32 {
        match self {
            Self::InvalidLimits => 1,
            Self::InputCapacity => 2,
            Self::Admission(_) => 3,
            Self::Work => 4,
            Self::Scratch => 5,
            Self::Output => 6,
            Self::Allocation => 7,
            Self::Section => 8,
            Self::Consumed => 9,
            Self::ForeignTarget => 10,
            Self::TargetChanged => 11,
            Self::RestoreInProgress => 12,
            Self::Capture(_) => 14,
            Self::Framing(_) => 15,
            Self::Overflow => 16,
        }
    }
    fn js(self) -> JsValue {
        JsValue::from_str(match self.code() {
            1 => "native-file.prepare:1",
            2 => "native-file.prepare:2",
            3 => "native-file.prepare:3",
            4 => "native-file.prepare:4",
            5 => "native-file.prepare:5",
            6 => "native-file.prepare:6",
            7 => "native-file.prepare:7",
            8 => "native-file.prepare:8",
            9 => "native-file.prepare:9",
            10 => "native-file.prepare:10",
            11 => "native-file.prepare:11",
            12 => "native-file.prepare:12",
            13 => "native-file.prepare:13",
            14 => "native-file.prepare:14",
            15 => "native-file.prepare:15",
            _ => "native-file.prepare:16",
        })
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "native file prepare rejected: {self:?}")
    }
}
impl std::error::Error for Error {}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct CopyUsage {
    work: u64,
    scratch: usize,
    bytes: usize,
}

/// Detached owned file/admitted Native facts, scoped to a private target owner.
/// Does not expose Engine execution, accept SDK facts as Native facts or prove Ready.
#[wasm_bindgen]
pub struct NativeFilePrepare {
    owner: Arc<()>,
    revision: u32,
    sdk_build: u64,
    file: Vec<u8>,
    ranges: [(usize, usize); 7],
    parts: candidate::OwnedParts,
    installed: bool,
    limits: Limits,
    output: CopyUsage,
    plan: packet::Plan,
}
impl fmt::Debug for NativeFilePrepare {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("NativeFilePrepare")
            .field("file_bytes", &self.file.len())
            .field("installed", &self.installed)
            .field("output", &self.output)
            .finish_non_exhaustive()
    }
}
impl NativeFilePrepare {
    fn prepare_owned(
        target: &Engine,
        file: Vec<u8>,
        sdk: u64,
        limits: Limits,
    ) -> Result<Self, Error> {
        if target.physics_restore_transaction.is_some() {
            return Err(Error::RestoreInProgress);
        }
        if file.capacity() > limits.native.framing.max_file_bytes {
            return Err(Error::InputCapacity);
        }
        let parts = candidate::prepare(&file, sdk, &limits.native)
            .map_err(Error::Admission)?
            .into_owned_parts();
        let mut value = Self {
            owner: Arc::clone(&target.checkpoint_owner),
            revision: target.checkpoint_revision,
            sdk_build: sdk,
            file,
            ranges: parts.ranges,
            parts,
            installed: false,
            limits,
            output: CopyUsage::default(),
            plan: packet::Plan::empty(),
        };
        // The native variable layout is fixed at 64 slots; charge before counting it.
        value.charge_work(64 + 14)?;
        value.plan = packet::Plan::new(&value)?;
        Ok(value)
    }
    fn available(&self) -> Result<(), Error> {
        if self.installed {
            Err(Error::Consumed)
        } else {
            Ok(())
        }
    }
    fn charge_work(&mut self, n: u64) -> Result<(), Error> {
        let next = self.output.work.checked_add(n).ok_or(Error::Work)?;
        if self
            .parts
            .usage
            .post_decode_work
            .checked_add(next)
            .ok_or(Error::Work)?
            > self.limits.native.max_post_decode_work
        {
            return Err(Error::Work);
        }
        self.output.work = next;
        Ok(())
    }
    fn reserve_output(&mut self, n: usize, metadata: bool) -> Result<(), Error> {
        self.charge_work(1)?;
        self.available()?;
        if metadata && n > self.limits.max_metadata_bytes {
            return Err(Error::Output);
        }
        let bytes = self.output.bytes.checked_add(n).ok_or(Error::Output)?;
        if bytes > self.limits.max_output_bytes {
            return Err(Error::Output);
        }
        self.charge_work(u64::try_from(n).map_err(|_| Error::Work)?)?;
        let scratch = self.output.scratch.checked_add(n).ok_or(Error::Scratch)?;
        if self
            .parts
            .usage
            .post_decode_scratch_bytes
            .checked_add(scratch)
            .ok_or(Error::Scratch)?
            > self.limits.native.max_post_decode_scratch_bytes
        {
            return Err(Error::Scratch);
        }
        self.output.scratch = scratch;
        self.output.bytes = bytes;
        Ok(())
    }
    fn metadata_native(&mut self) -> Result<Vec<u8>, Error> {
        self.reserve_output(self.plan.bytes, true)?;
        packet::encode(self)
    }
    pub(super) fn sdk_section_bytes(&self, kind: u32) -> Result<&[u8], Error> {
        self.available()?;
        if !(2..=7).contains(&kind) {
            return Err(Error::Section);
        }
        let (start, end) = self.ranges[kind as usize - 1];
        Ok(&self.file[start..end])
    }
    fn section_native(&mut self, kind: u32) -> Result<Vec<u8>, Error> {
        self.charge_work(1)?;
        let n = self.sdk_section_bytes(kind)?.len();
        self.reserve_output(n, false)?;
        let source = self.sdk_section_bytes(kind)?;
        let mut out = Vec::new();
        out.try_reserve_exact(n).map_err(|_| Error::Allocation)?;
        out.extend_from_slice(source);
        Ok(out)
    }
    fn repack_native(&mut self, sdk: &[u8], lengths: &[u32]) -> Result<Vec<u8>, Error> {
        self.charge_work(7)?;
        self.available()?;
        let sections = split_sdk(sdk, lengths, self.limits.native.framing.max_file_bytes)?;
        let (start, end) = self.ranges[0];
        let length = 288usize
            .checked_add(end - start)
            .and_then(|n| n.checked_add(sdk.len()))
            .ok_or(Error::Overflow)?;
        self.reserve_output(length, false)?;
        // The materialization charge and a separate framing CRC-byte visit share
        // the same remaining ledger before framing's fallible output reservation.
        self.charge_work(length as u64)?;
        framing::encode(
            &candidate::profile(self.sdk_build),
            &framing::Sections {
                engine: &self.file[start..end],
                variables: sections[0],
                authoring: sections[1],
                resource_manifest: sections[2],
                resource_data: sections[3],
                dialogue_quest: sections[4],
                host_bindings: sections[5],
            },
            &self.limits.native.framing,
        )
        .map_err(Error::Framing)
    }
    fn install(&mut self, target: &mut Engine) -> Result<(), Error> {
        self.available()?;
        if !Arc::ptr_eq(&self.owner, &target.checkpoint_owner) {
            return Err(Error::ForeignTarget);
        }
        if self.revision != target.checkpoint_revision {
            return Err(Error::TargetChanged);
        }
        if target.physics_restore_transaction.is_some() {
            return Err(Error::RestoreInProgress);
        }
        // Keep the big Engine boxed: swap follows the existing checkpoint pattern.
        let mut engine = self.parts.engine.take().ok_or(Error::Consumed)?;
        // The decoded fresh owner and saved revision remain unchanged. Any old
        // placeholder checkpoint/other prepare becomes foreign after this swap.
        std::mem::swap(target, engine.as_mut());
        self.installed = true;
        Ok(())
    }
}
#[wasm_bindgen]
impl NativeFilePrepare {
    /// The SDK exclusively owns target in a new unpublished namespace. Rust checks
    /// owner identity, not unpublished provenance; the SDK capability supplies that.
    #[wasm_bindgen(constructor)]
    pub fn new(
        target: &Engine,
        file: Vec<u8>,
        sdk_lo: u32,
        sdk_hi: u32,
        limits: &[u32],
    ) -> Result<NativeFilePrepare, JsValue> {
        let limits = Limits::parse(limits).map_err(Error::js)?;
        Self::prepare_owned(
            target,
            file,
            u64::from(sdk_lo) | (u64::from(sdk_hi) << 32),
            limits,
        )
        .map_err(Error::js)
    }
    /// Explicit little-endian byte packet version; not a JSON/serde ABI.
    pub fn packet_version() -> u32 {
        1
    }
    /// Charges each attempted cold length request; not a per-entity hot API.
    pub fn metadata_len(&mut self) -> Result<u32, JsValue> {
        self.charge_work(1)
            .and_then(|()| self.available())
            .map_err(Error::js)?;
        u32::try_from(self.plan.bytes).map_err(|_| Error::Overflow.js())
    }
    /// New fallibly reserved bulk packet; repeated/failed requests share one ledger.
    pub fn metadata(&mut self) -> Result<Vec<u8>, JsValue> {
        self.metadata_native().map_err(Error::js)
    }
    pub fn sdk_section_len(&mut self, kind: u32) -> Result<u32, JsValue> {
        self.charge_work(1).map_err(Error::js)?;
        let bytes = self.sdk_section_bytes(kind).map_err(Error::js)?;
        u32::try_from(bytes.len()).map_err(|_| Error::Overflow.js())
    }
    /// Only the six still-unvalidated SDK sections; Engine bytes are never exposed.
    pub fn sdk_section(&mut self, kind: u32) -> Result<Vec<u8>, JsValue> {
        self.section_native(kind).map_err(Error::js)
    }
    /// Reframe retained Engine bytes with opaque SDK sections. No native codec,
    /// rebuild or claim of SDK admission/Ready is performed.
    pub fn repack_sdk_sections(
        &mut self,
        sdk_bulk: &[u8],
        lengths: &[u32],
    ) -> Result<Vec<u8>, JsValue> {
        self.repack_native(sdk_bulk, lengths).map_err(Error::js)
    }
    pub fn is_consumed(&self) -> bool {
        self.installed
    }
}
#[wasm_bindgen]
impl Engine {
    /// Native install only. The private SDK coordinator calls this once after all
    /// SDK admission, in its target namespace. Status0 is not a public Ready token.
    pub fn install_native_file_prepare(&mut self, prepared: &mut NativeFilePrepare) -> u32 {
        match prepared.install(self) {
            Ok(()) => 0,
            Err(error) => error.code(),
        }
    }
    /// Capture the actual Engine file section and six opaque SDK sections without
    /// stepping/querying/rebuilding the source. SDK content admission is separate.
    pub fn capture_native_file(
        &self,
        sdk_sections: &[u8],
        lengths: &[u32],
        sdk_lo: u32,
        sdk_hi: u32,
        limits: &[u32],
    ) -> Result<Vec<u8>, JsValue> {
        let limits = Limits::parse(limits).map_err(Error::js)?;
        capture(
            self,
            sdk_sections,
            lengths,
            u64::from(sdk_lo) | (u64::from(sdk_hi) << 32),
            &limits,
        )
        .map_err(Error::js)
    }
}
fn capture(
    source: &Engine,
    sdk: &[u8],
    lengths: &[u32],
    build: u64,
    limits: &Limits,
) -> Result<Vec<u8>, Error> {
    let sections = split_sdk(sdk, lengths, limits.native.framing.max_file_bytes)?;
    let (engine, usage) = candidate::capture_engine_section_with_usage(source, &limits.native)
        .map_err(Error::Capture)?;
    let length = 288usize
        .checked_add(engine.len())
        .and_then(|n| n.checked_add(sdk.len()))
        .ok_or(Error::Overflow)?;
    if length.checked_mul(4).ok_or(Error::Overflow)? > limits.native.max_checksum_work {
        return Err(Error::Capture(candidate::Error::ChecksumWork));
    }
    if length > limits.max_output_bytes
        || usage.scratch.checked_add(length).ok_or(Error::Scratch)?
            > limits.native.max_post_decode_scratch_bytes
        || usage.work.checked_add(length as u64).ok_or(Error::Work)?
            > limits.native.max_post_decode_work
    {
        return Err(Error::Output);
    }
    framing::encode(
        &candidate::profile(build),
        &framing::Sections {
            engine: &engine,
            variables: sections[0],
            authoring: sections[1],
            resource_manifest: sections[2],
            resource_data: sections[3],
            dialogue_quest: sections[4],
            host_bindings: sections[5],
        },
        &limits.native.framing,
    )
    .map_err(Error::Framing)
}

fn split_sdk<'a>(sdk: &'a [u8], lengths: &[u32], max: usize) -> Result<[&'a [u8]; 6], Error> {
    if lengths.len() != 6 || sdk.len() > max {
        return Err(Error::Section);
    }
    let mut sections = [&[][..]; 6];
    let mut at = 0usize;
    for (slot, &length) in sections.iter_mut().zip(lengths) {
        let end = at.checked_add(length as usize).ok_or(Error::Overflow)?;
        if end > sdk.len() || length == 0 {
            return Err(Error::Section);
        }
        *slot = &sdk[at..end];
        at = end;
    }
    if at != sdk.len() {
        return Err(Error::Section);
    }
    Ok(sections)
}
