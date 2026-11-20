//! Cold standalone file ownership packets. No raw Rc address is serialized.
//! Empty expected header probes a fixed16/32-byte layout. A checked capture
//! compares that entire header before reserving its body output buffer.
use super::*;
const QUEST_TAG: u32 = 0x46515131;
const DIALOGUE_TAG: u32 = 0x46445131;
fn stale() -> String {
    "dialogueQuest.file|source revision or packet layout changed".into()
}
pub(super) fn next_revision(old: u64) -> Result<u64, String> {
    old.checked_add(1)
        .ok_or_else(|| "dialogueQuest.file|revision exhausted".into())
}
pub(super) fn dialogue_bytes(id: &str, flags: &BTreeSet<String>) -> Result<usize, String> {
    let mut n = 16usize.checked_add(id.len()).ok_or_else(packet_error)?;
    for flag in flags {
        n = n
            .checked_add(4)
            .and_then(|v| v.checked_add(flag.len()))
            .ok_or_else(packet_error)?;
    }
    if n > MAX_PACKET_BYTES {
        return Err(packet_error());
    }
    Ok(n)
}
impl QuestState {
    pub(super) fn refresh_file_size(&mut self) -> Result<(), String> {
        let mut n = 8usize;
        for p in &self.progress {
            n = n.checked_add(progress_size(p)).ok_or_else(packet_error)?;
        }
        if n > MAX_PACKET_BYTES {
            return Err(packet_error());
        }
        self.file_packet_bytes = n;
        Ok(())
    }
    fn file_header(&self) -> [u32; 4] {
        [
            QUEST_TAG,
            self.file_revision as u32,
            (self.file_revision >> 32) as u32,
            self.file_packet_bytes as u32,
        ]
    }
}
fn matches_header(expected: &[u8], header: &[u32]) -> bool {
    expected.len() == header.len() * 4
        && expected
            .chunks_exact(4)
            .zip(header)
            .all(|(b, v)| b == v.to_le_bytes())
}
fn output(header: &[u32], expected: &[u8], body: usize) -> Result<(Writer, bool), String> {
    let probe = expected.is_empty();
    if !probe && !matches_header(expected, header) {
        return Err(stale());
    }
    let size = header.len() * 4 + if probe { 0 } else { body };
    let mut v = Vec::new();
    v.try_reserve_exact(size).map_err(|_| packet_error())?;
    for word in header {
        v.extend_from_slice(&word.to_le_bytes());
    }
    Ok((Writer(v), probe))
}
fn write_quests(w: &mut Writer, q: &QuestState) {
    w.u32(1);
    w.u32(q.progress.len() as u32);
    for p in &q.progress {
        w.string(&p.id);
        w.u32(p.status);
        w.optional(p.stage.as_deref());
        w.u32(p.objectives.len() as u32);
        for s in &p.objectives {
            w.string(s);
        }
    }
}
fn write_dialogue(w: &mut Writer, d: &NativeDialogueSession) {
    w.u32(1);
    w.string(&d.nodes[d.progress.node].id);
    w.u32(d.progress.flags.len() as u32);
    for s in &d.progress.flags {
        w.string(s);
    }
    w.u32(u32::from(d.progress.ended));
}
#[wasm_bindgen]
impl NativeQuestLog {
    /// Cold two-phase getter. Probe is16bytes; checked output appends the existing
    /// version1 progress wire. Caller charges both outputs before asking for them.
    pub fn file_state_packet(&self, expected_header: &[u8]) -> Result<Vec<u8>, String> {
        let q = self.state.borrow();
        let (mut w, probe) = output(&q.file_header(), expected_header, q.file_packet_bytes)?;
        if !probe {
            write_quests(&mut w, &q);
        }
        Ok(w.0)
    }
}
#[wasm_bindgen]
impl NativeDialogueSession {
    /// Cold two-phase getter including the actual linked Rc quest state even when
    /// its public NativeQuestLog wrapper has already been freed.
    pub fn file_state_packet(&self, expected_header: &[u8]) -> Result<Vec<u8>, String> {
        let q = self.quests.as_ref().map(|q| q.borrow());
        let qr = q.as_ref().map_or(0, |q| q.file_revision);
        let qb = q.as_ref().map_or(0, |q| q.file_packet_bytes);
        let header = [
            DIALOGUE_TAG,
            self.file_revision as u32,
            (self.file_revision >> 32) as u32,
            self.file_packet_bytes as u32,
            u32::from(q.is_some()),
            qr as u32,
            (qr >> 32) as u32,
            qb as u32,
        ];
        let (mut w, probe) = output(&header, expected_header, self.file_packet_bytes + qb)?;
        if !probe {
            write_dialogue(&mut w, self);
            if let Some(q) = &q {
                write_quests(&mut w, q);
            }
        }
        Ok(w.0)
    }
    /// Creates a new detached session without applying initial node quest updates.
    /// Existing new/with_quests keep their original behavior. File flags must be
    /// strictly native-ordered and unique before BTreeSet insertion can repair them.
    pub fn file_with_quests(
        graph: &[u8],
        progress: &[u8],
        quests: &NativeQuestLog,
    ) -> Result<NativeDialogueSession, String> {
        let mut d = Self::decode(graph, None)?;
        let mut r = Reader::new(progress)?;
        let id = r.key()?;
        let node = d
            .nodes
            .iter()
            .position(|n| n.id == id)
            .ok_or_else(packet_error)?;
        let count = r.count()?;
        let mut flags = BTreeSet::new();
        for _ in 0..count {
            let flag = r.key()?;
            if flags.last().is_some_and(|last| last >= &flag) {
                return Err(packet_error());
            }
            flags.insert(flag);
        }
        let ended = r.boolean()?;
        r.finish()?;
        let bytes = dialogue_bytes(&d.nodes[node].id, &flags)?;
        d.progress = DialogueProgress { node, flags, ended };
        d.file_revision = 1;
        d.file_packet_bytes = bytes;
        d.quests = Some(Rc::clone(&quests.state));
        Ok(d)
    }
}

#[cfg(test)]
mod tests;
