//! Standalone dialogue/quest state. The platform owns content presentation and packet encoding.
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
};
use wasm_bindgen::prelude::*;

const MAX_PACKET_BYTES: usize = 16 * 1024 * 1024;
const MAX_ITEMS: usize = 65_536;

#[derive(Clone, Debug)]
struct QuestDefinition {
    id: String,
    stages: Vec<String>,
}
#[derive(Clone, Debug, PartialEq)]
struct Progress {
    id: String,
    status: u32,
    stage: Option<String>,
    objectives: Vec<String>,
}
#[derive(Clone, Debug)]
struct QuestState {
    definitions: Vec<QuestDefinition>,
    indexes: BTreeMap<String, usize>,
    progress: Vec<Progress>,
}
#[derive(Clone, Debug)]
struct Update {
    quest: String,
    action: u32,
    stage: Option<String>,
    objective: Option<String>,
}
#[derive(Debug)]
struct Choice {
    to: Option<usize>,
    set: Vec<String>,
    clear: Vec<String>,
    require: Vec<String>,
    updates: Vec<Update>,
}
#[derive(Debug)]
struct Node {
    id: String,
    end: bool,
    updates: Vec<Update>,
    choices: Vec<Choice>,
}
#[derive(Clone, Debug, PartialEq)]
struct DialogueProgress {
    node: usize,
    flags: BTreeSet<String>,
    ended: bool,
}

#[wasm_bindgen]
pub struct NativeQuestLog {
    state: Rc<RefCell<QuestState>>,
}

#[wasm_bindgen]
impl NativeQuestLog {
    #[wasm_bindgen(constructor)]
    pub fn new(config: &[u8]) -> Result<NativeQuestLog, String> {
        let mut r = Reader::new(config)?;
        let mut definitions = Vec::new();
        let mut ids = BTreeSet::new();
        for _ in 0..r.count()? {
            let id = r.key()?;
            if !ids.insert(id.clone()) {
                return Err(packet_error());
            }
            definitions.push(QuestDefinition {
                id,
                stages: r.keys()?,
            });
        }
        r.finish()?;
        let progress = definitions.iter().map(inactive).collect();
        let indexes = definitions
            .iter()
            .enumerate()
            .map(|(i, q)| (q.id.clone(), i))
            .collect();
        let state = QuestState {
            definitions,
            indexes,
            progress,
        };
        state.validate_size()?;
        Ok(Self {
            state: Rc::new(RefCell::new(state)),
        })
    }

    pub fn apply(&mut self, packet: &[u8]) -> Result<Vec<u8>, String> {
        let mut r = Reader::new(packet)?;
        let updates = r.updates()?;
        r.finish()?;
        let mut next = self.state.borrow().clone();
        let results = next.apply(&updates)?;
        let packet = progress_packet(&results);
        *self.state.borrow_mut() = next;
        Ok(packet)
    }

    pub fn snapshot(&self) -> Vec<u8> {
        progress_packet(&self.state.borrow().progress)
    }

    pub fn validate_restore(&self, packet: &[u8]) -> Result<(), String> {
        self.state.borrow().restored(packet).map(|_| ())
    }

    pub fn restore(&mut self, packet: &[u8]) -> Result<(), String> {
        let next = self.state.borrow().restored(packet)?;
        *self.state.borrow_mut() = next;
        Ok(())
    }
}

#[wasm_bindgen]
pub struct NativeDialogueSession {
    nodes: Vec<Node>,
    progress: DialogueProgress,
    quests: Option<Rc<RefCell<QuestState>>>,
}

#[wasm_bindgen]
impl NativeDialogueSession {
    #[wasm_bindgen(constructor)]
    pub fn new(graph: &[u8]) -> Result<NativeDialogueSession, String> {
        Self::decode(graph, None)
    }

    pub fn with_quests(
        graph: &[u8],
        quests: &NativeQuestLog,
    ) -> Result<NativeDialogueSession, String> {
        Self::decode(graph, Some(Rc::clone(&quests.state)))
    }

    pub fn current_node(&self) -> u32 {
        self.progress.node as u32
    }

    pub fn available_choices(&self) -> Vec<u32> {
        self.nodes[self.progress.node]
            .choices
            .iter()
            .enumerate()
            .filter(|(_, c)| c.require.iter().all(|f| self.progress.flags.contains(f)))
            .map(|(i, _)| i as u32)
            .collect()
    }

    pub fn choose(&mut self, index: u32) -> Result<(), String> {
        if self.progress.ended {
            return Err("dialogue.choice|cannot choose after dialogue ended".into());
        }
        let choice = self.nodes[self.progress.node]
            .choices
            .get(index as usize)
            .filter(|c| c.require.iter().all(|f| self.progress.flags.contains(f)))
            .ok_or_else(|| "dialogue.choice|unknown or unavailable choice".to_string())?;
        let mut next = self.progress.clone();
        next.flags.extend(choice.set.iter().cloned());
        for flag in &choice.clear {
            next.flags.remove(flag);
        }
        let mut quests = self.quests.as_ref().map(|q| q.borrow().clone());
        if let Some(q) = &mut quests {
            q.apply(&choice.updates)?;
        }
        if let Some(to) = choice.to {
            next.node = to;
            if let Some(q) = &mut quests {
                q.apply(&self.nodes[to].updates)?;
            }
        } else {
            next.ended = true;
        }
        next.ended |= self.nodes[next.node].end;
        validate_dialogue_size(&self.nodes[next.node].id, &next.flags)?;
        if let (Some(target), Some(q)) = (&self.quests, quests) {
            *target.borrow_mut() = q;
        }
        self.progress = next;
        Ok(())
    }

    pub fn snapshot(&self) -> Vec<u8> {
        let mut w = Writer::new();
        w.string(&self.nodes[self.progress.node].id);
        w.u32(self.progress.flags.len() as u32);
        for flag in &self.progress.flags {
            w.string(flag);
        }
        w.u32(u32::from(self.progress.ended));
        w.0
    }

    pub fn validate_restore(&self, packet: &[u8]) -> Result<(), String> {
        self.restored(packet).map(|_| ())
    }

    pub fn restore(&mut self, packet: &[u8]) -> Result<(), String> {
        self.progress = self.restored(packet)?;
        Ok(())
    }
}

impl NativeDialogueSession {
    fn decode(packet: &[u8], quests: Option<Rc<RefCell<QuestState>>>) -> Result<Self, String> {
        let mut r = Reader::new(packet)?;
        let initial = r.u32()? as usize;
        let mut nodes = Vec::new();
        let mut ids = BTreeSet::new();
        for _ in 0..r.count()? {
            let id = r.key()?;
            if !ids.insert(id.clone()) {
                return Err(packet_error());
            }
            let end = r.boolean()?;
            let updates = r.updates()?;
            let mut choices = Vec::new();
            for _ in 0..r.count()? {
                let target = r.u32()?;
                choices.push(Choice {
                    to: if target == u32::MAX {
                        None
                    } else {
                        Some(target as usize)
                    },
                    set: r.keys()?,
                    clear: r.keys()?,
                    require: r.keys()?,
                    updates: r.updates()?,
                });
            }
            nodes.push(Node {
                id,
                end,
                updates,
                choices,
            });
        }
        r.finish()?;
        if initial >= nodes.len()
            || nodes.iter().any(|n| {
                n.choices
                    .iter()
                    .any(|c| c.to.is_some_and(|i| i >= nodes.len()))
            })
        {
            return Err(packet_error());
        }
        if let Some(q) = &quests {
            let mut next = q.borrow().clone();
            next.apply(&nodes[initial].updates)?;
            *q.borrow_mut() = next;
        }
        Ok(Self {
            nodes,
            quests,
            progress: DialogueProgress {
                node: initial,
                flags: BTreeSet::new(),
                ended: false,
            },
        })
    }

    fn restored(&self, packet: &[u8]) -> Result<DialogueProgress, String> {
        let mut r = Reader::new(packet)?;
        let id = r.key()?;
        let node =
            self.nodes.iter().position(|n| n.id == id).ok_or_else(|| {
                format!("dialogue.snapshot.nodeId|references missing node '{id}'")
            })?;
        let flags = r.keys()?.into_iter().collect();
        let ended = r.boolean()?;
        r.finish()?;
        validate_dialogue_size(&self.nodes[node].id, &flags)?;
        Ok(DialogueProgress { node, flags, ended })
    }
}

impl QuestState {
    fn apply(&mut self, updates: &[Update]) -> Result<Vec<Progress>, String> {
        let mut results = Vec::new();
        let mut result_bytes = 8;
        for update in updates {
            let index = self.indexes.get(&update.quest).copied().ok_or_else(|| {
                format!(
                    "questUpdate.quest|references missing quest '{}'",
                    update.quest
                )
            })?;
            let quest = &self.definitions[index];
            let p = &mut self.progress[index];
            match update.action {
                0 => {
                    p.status = 1;
                    p.stage = update
                        .stage
                        .clone()
                        .or_else(|| p.stage.clone())
                        .or_else(|| quest.stages.first().cloned());
                }
                1 => {
                    let stage = update.stage.as_ref().ok_or_else(|| {
                        "questUpdate.stage|must be a non-empty string".to_string()
                    })?;
                    if !quest.stages.contains(stage) {
                        return Err(format!(
                            "questUpdate.stage|references missing stage '{stage}'"
                        ));
                    }
                    p.status = 1;
                    p.stage = Some(stage.clone());
                }
                2 => {
                    let objective = update.objective.as_ref().ok_or_else(|| {
                        "questUpdate.objective|must be a non-empty string".to_string()
                    })?;
                    p.status = 1;
                    if !p.objectives.contains(objective) {
                        if p.objectives.len() >= MAX_ITEMS {
                            return Err(packet_error());
                        }
                        p.objectives.push(objective.clone());
                    }
                }
                3 => p.status = 2,
                _ => return Err(packet_error()),
            }
            result_bytes += progress_size(p);
            if result_bytes > MAX_PACKET_BYTES {
                return Err(packet_error());
            }
            results.push(p.clone());
        }
        self.validate_size()?;
        Ok(results)
    }

    fn validate_size(&self) -> Result<(), String> {
        if 8 + self.progress.iter().map(progress_size).sum::<usize>() > MAX_PACKET_BYTES {
            return Err(packet_error());
        }
        Ok(())
    }

    fn restored(&self, packet: &[u8]) -> Result<Self, String> {
        let mut r = Reader::new(packet)?;
        let mut next = Self {
            definitions: self.definitions.clone(),
            indexes: self.indexes.clone(),
            progress: self.definitions.iter().map(inactive).collect(),
        };
        for _ in 0..r.count()? {
            let id = r.key()?;
            let status = r.u32()?;
            if status > 2 {
                return Err(packet_error());
            }
            let stage = r.optional()?;
            let objectives = r.keys()?;
            if let Some(&i) = next.indexes.get(&id) {
                next.progress[i] = Progress {
                    id,
                    status,
                    stage,
                    objectives,
                };
            }
        }
        r.finish()?;
        next.validate_size()?;
        Ok(next)
    }
}

fn inactive(q: &QuestDefinition) -> Progress {
    Progress {
        id: q.id.clone(),
        status: 0,
        stage: q.stages.first().cloned(),
        objectives: Vec::new(),
    }
}
fn progress_size(p: &Progress) -> usize {
    16 + p.id.len()
        + p.stage.as_ref().map_or(0, |s| 4 + s.len())
        + p.objectives.iter().map(|s| 4 + s.len()).sum::<usize>()
}
fn validate_dialogue_size(id: &str, flags: &BTreeSet<String>) -> Result<(), String> {
    if flags.len() > MAX_ITEMS
        || 16 + id.len() + flags.iter().map(|s| 4 + s.len()).sum::<usize>() > MAX_PACKET_BYTES
    {
        return Err(packet_error());
    }
    Ok(())
}
fn progress_packet(progress: &[Progress]) -> Vec<u8> {
    let mut w = Writer::new();
    w.u32(progress.len() as u32);
    for p in progress {
        w.string(&p.id);
        w.u32(p.status);
        w.optional(p.stage.as_deref());
        w.u32(p.objectives.len() as u32);
        for objective in &p.objectives {
            w.string(objective);
        }
    }
    w.0
}
fn packet_error() -> String {
    "dialogueQuest.native|invalid or oversized native packet".into()
}

struct Reader<'a> {
    data: &'a [u8],
    offset: usize,
}
impl<'a> Reader<'a> {
    fn new(data: &'a [u8]) -> Result<Self, String> {
        if data.len() > MAX_PACKET_BYTES {
            return Err(packet_error());
        }
        let mut r = Self { data, offset: 0 };
        if r.u32()? != 1 {
            return Err(packet_error());
        }
        Ok(r)
    }
    fn u32(&mut self) -> Result<u32, String> {
        let bytes = self
            .data
            .get(self.offset..self.offset.saturating_add(4))
            .ok_or_else(packet_error)?;
        self.offset += 4;
        Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }
    fn count(&mut self) -> Result<usize, String> {
        let count = self.u32()? as usize;
        if count > MAX_ITEMS || count > (self.data.len() - self.offset) / 4 {
            return Err(packet_error());
        }
        Ok(count)
    }
    fn key(&mut self) -> Result<String, String> {
        let len = self.u32()? as usize;
        let bytes = self
            .data
            .get(self.offset..self.offset.saturating_add(len))
            .ok_or_else(packet_error)?;
        let value = std::str::from_utf8(bytes).map_err(|_| packet_error())?;
        if value.is_empty() {
            return Err(packet_error());
        }
        self.offset += len;
        Ok(value.to_owned())
    }
    fn keys(&mut self) -> Result<Vec<String>, String> {
        (0..self.count()?).map(|_| self.key()).collect()
    }
    fn boolean(&mut self) -> Result<bool, String> {
        match self.u32()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(packet_error()),
        }
    }
    fn optional(&mut self) -> Result<Option<String>, String> {
        if self.boolean()? {
            self.key().map(Some)
        } else {
            Ok(None)
        }
    }
    fn updates(&mut self) -> Result<Vec<Update>, String> {
        (0..self.count()?)
            .map(|_| {
                let quest = self.key()?;
                let action = self.u32()?;
                if action > 3 {
                    return Err(packet_error());
                }
                Ok(Update {
                    quest,
                    action,
                    stage: self.optional()?,
                    objective: self.optional()?,
                })
            })
            .collect()
    }
    fn finish(self) -> Result<(), String> {
        if self.offset == self.data.len() {
            Ok(())
        } else {
            Err(packet_error())
        }
    }
}
struct Writer(Vec<u8>);
impl Writer {
    fn new() -> Self {
        let mut w = Self(Vec::new());
        w.u32(1);
        w
    }
    fn u32(&mut self, value: u32) {
        self.0.extend(value.to_le_bytes());
    }
    fn string(&mut self, value: &str) {
        self.u32(value.len() as u32);
        self.0.extend(value.as_bytes());
    }
    fn optional(&mut self, value: Option<&str>) {
        self.u32(u32::from(value.is_some()));
        if let Some(v) = value {
            self.string(v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quest_config() -> Vec<u8> {
        let mut w = Writer::new();
        w.u32(1);
        w.string("tutorial");
        w.u32(1);
        w.string("intro");
        w.0
    }
    fn update(action: u32, quest: &str, stage: Option<&str>, objective: Option<&str>) -> Update {
        Update {
            action,
            quest: quest.into(),
            stage: stage.map(str::to_owned),
            objective: objective.map(str::to_owned),
        }
    }
    fn write_updates(w: &mut Writer, updates: &[Update]) {
        w.u32(updates.len() as u32);
        for u in updates {
            w.string(&u.quest);
            w.u32(u.action);
            w.optional(u.stage.as_deref());
            w.optional(u.objective.as_deref());
        }
    }
    fn updates_packet(updates: &[Update]) -> Vec<u8> {
        let mut w = Writer::new();
        write_updates(&mut w, updates);
        w.0
    }
    fn graph(invalid_destination_update: bool) -> Vec<u8> {
        let mut w = Writer::new();
        w.u32(0);
        w.u32(2);
        w.string("start");
        w.u32(0);
        write_updates(&mut w, &[update(0, "tutorial", Some("intro"), None)]);
        w.u32(2);
        w.u32(1);
        w.u32(1);
        w.string("accepted");
        w.u32(0);
        w.u32(0);
        write_updates(&mut w, &[update(2, "tutorial", None, Some("talk"))]);
        w.u32(u32::MAX);
        w.u32(0);
        w.u32(0);
        w.u32(1);
        w.string("secret");
        write_updates(&mut w, &[]);
        w.string("done");
        w.u32(1);
        write_updates(
            &mut w,
            &if invalid_destination_update {
                vec![update(3, "missing", None, None)]
            } else {
                vec![]
            },
        );
        w.u32(0);
        w.0
    }
    fn dialogue_packet(node: &str, flags: &[&str], ended: u32) -> Vec<u8> {
        let mut w = Writer::new();
        w.string(node);
        w.u32(flags.len() as u32);
        for flag in flags {
            w.string(flag);
        }
        w.u32(ended);
        w.0
    }

    #[test]
    fn native_quest_updates_preserve_order_and_apply_batch_atomically() {
        let mut q = NativeQuestLog::new(&quest_config()).unwrap();
        let original = q.snapshot();
        assert!(q
            .apply(&updates_packet(&[
                update(0, "tutorial", None, None),
                update(3, "missing", None, None)
            ]))
            .is_err());
        assert_eq!(q.snapshot(), original);
        let output = q
            .apply(&updates_packet(&[
                update(0, "tutorial", None, None),
                update(2, "tutorial", None, Some("talk")),
                update(2, "tutorial", None, Some("talk")),
                update(3, "tutorial", None, None),
            ]))
            .unwrap();
        let mut r = Reader::new(&output).unwrap();
        assert_eq!(r.count().unwrap(), 4);
        let state = q.state.borrow();
        assert_eq!(state.progress[0].status, 2);
        assert_eq!(state.progress[0].stage.as_deref(), Some("intro"));
        assert_eq!(state.progress[0].objectives, ["talk"]);
    }

    #[test]
    fn native_dialogue_owns_flags_transitions_and_shared_quest_lifetime() {
        let q = NativeQuestLog::new(&quest_config()).unwrap();
        let mut d = NativeDialogueSession::with_quests(&graph(false), &q).unwrap();
        assert_eq!(q.state.borrow().progress[0].status, 1);
        assert_eq!(d.available_choices(), [0]);
        let before = d.snapshot();
        assert!(d.choose(1).is_err());
        assert!(d.choose(u32::MAX).is_err());
        assert_eq!(d.snapshot(), before);
        drop(q); // The session retains the native quest state, independent of its wrapper lifetime.
        d.choose(0).unwrap();
        assert_eq!(d.current_node(), 1);
        assert!(d.progress.ended);
        assert_eq!(
            d.progress
                .flags
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["accepted"]
        );
        assert_eq!(
            d.quests.as_ref().unwrap().borrow().progress[0].objectives,
            ["talk"]
        );
        assert!(d.choose(0).is_err());
    }

    #[test]
    fn native_dialogue_choice_rolls_back_flags_node_and_quests_on_failure() {
        let q = NativeQuestLog::new(&quest_config()).unwrap();
        let mut d = NativeDialogueSession::with_quests(&graph(true), &q).unwrap();
        let before = d.snapshot();
        let quests_before = q.snapshot();
        assert!(d.choose(0).is_err());
        assert_eq!(d.snapshot(), before);
        assert_eq!(q.snapshot(), quests_before);
        // Without a linked quest log, quest update metadata does not affect dialogue playback.
        NativeDialogueSession::new(&graph(true))
            .unwrap()
            .choose(0)
            .unwrap();
    }

    #[test]
    fn native_restore_is_atomic_and_does_not_replay_node_updates() {
        let mut q = NativeQuestLog::new(&quest_config()).unwrap();
        let mut d = NativeDialogueSession::with_quests(&graph(false), &q).unwrap();
        q.apply(&updates_packet(&[update(3, "tutorial", None, None)]))
            .unwrap();
        d.restore(&dialogue_packet("start", &["secret", "extra", "secret"], 0))
            .unwrap();
        assert_eq!(d.available_choices(), [0, 1]);
        assert_eq!(q.state.borrow().progress[0].status, 2);
        let before = d.snapshot();
        for packet in [
            dialogue_packet("missing", &[], 0),
            dialogue_packet("done", &[], 2),
            dialogue_packet("done", &[""], 0),
        ] {
            assert!(d.validate_restore(&packet).is_err());
            assert!(d.restore(&packet).is_err());
            assert_eq!(d.snapshot(), before);
        }
        let before = q.snapshot();
        let invalid = progress_packet(&[Progress {
            id: "tutorial".into(),
            status: 3,
            stage: None,
            objectives: vec![],
        }]);
        assert!(q.restore(&invalid).is_err());
        assert_eq!(q.snapshot(), before);
        let unknown = progress_packet(&[Progress {
            id: "removed-content".into(),
            status: 2,
            stage: None,
            objectives: vec![],
        }]);
        q.restore(&unknown).unwrap();
        assert_eq!(q.state.borrow().progress[0].status, 0);
    }

    #[test]
    fn native_packet_parser_rejects_truncation_utf8_counts_and_trailing_bytes() {
        let config = quest_config();
        for length in 0..config.len() {
            assert!(NativeQuestLog::new(&config[..length]).is_err());
        }
        let packet = graph(false);
        for length in 0..packet.len() {
            assert!(NativeDialogueSession::new(&packet[..length]).is_err());
        }
        let mut trailing = config.clone();
        trailing.push(0);
        assert!(NativeQuestLog::new(&trailing).is_err());
        let mut bad = Writer::new();
        bad.u32(1);
        bad.u32(1);
        bad.0.push(255);
        bad.u32(0);
        assert!(NativeQuestLog::new(&bad.0).is_err());
        let mut bad = Writer::new();
        bad.u32((MAX_ITEMS + 1) as u32);
        assert!(NativeQuestLog::new(&bad.0).is_err());
        let mut bad = graph(false);
        bad[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(NativeDialogueSession::new(&bad).is_err());
        let mut q = NativeQuestLog::new(&config).unwrap();
        let before = q.snapshot();
        for length in 0..before.len() {
            assert!(q.restore(&before[..length]).is_err());
            assert_eq!(q.snapshot(), before);
        }
        assert!(NativeQuestLog::new(&vec![0; MAX_PACKET_BYTES + 1]).is_err());
    }
}
