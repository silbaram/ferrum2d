//! Native bounded temporal selection. Rendering reads slots; simulation advances weights.
use super::lighting_upgrade::Candidates;

#[derive(Debug, Clone, Copy)]
pub(super) struct Config {
    pub hysteresis: f32,
    pub fade_seconds: f32,
    pub reset_distance: f32,
}
pub(super) fn valid(v: &[f32]) -> bool {
    [0., 1.].contains(&v[576])
        && (0. ..=1.).contains(&v[577])
        && (0. ..=5.).contains(&v[578])
        && (0. ..=1e6).contains(&v[579])
}
#[derive(Debug, Default, Clone, Copy, PartialEq)]
enum Phase {
    #[default]
    Empty,
    Steady,
    In,
    Out,
}
#[derive(Debug, Default, Clone, Copy, PartialEq)]
struct Slot {
    source: Option<u8>,
    pending: Option<u8>,
    weight: f32,
    phase: Phase,
}

/// ABI v1: source, packed display slot(-1 absent), reason, flags, base score, weight.
#[repr(C)]
#[derive(Debug, Default, Clone, PartialEq)]
pub(crate) struct LightSelectionDiagnostic {
    pub source: u32,
    pub slot: i32,
    pub reason: u32,
    pub flags: u32,
    pub score: f32,
    pub weight: f32,
}
const _: () = assert!(std::mem::size_of::<LightSelectionDiagnostic>() == 24);
const _: () = assert!(std::mem::align_of::<LightSelectionDiagnostic>() == 4);
const _: () = assert!(std::mem::offset_of!(LightSelectionDiagnostic, score) == 16);
const _: () = assert!(std::mem::offset_of!(LightSelectionDiagnostic, weight) == 20);

#[derive(Debug, Clone)]
pub(super) struct LightSelection {
    config: Option<Config>,
    hash: u32,
    initialized: bool,
    tick: u32,
    anchor: [f32; 3],
    slots: [Slot; 4],
    diagnostics: [LightSelectionDiagnostic; 16],
    diagnostic_count: usize,
}
impl Default for LightSelection {
    fn default() -> Self {
        Self {
            config: None,
            hash: 0,
            initialized: false,
            tick: 0,
            anchor: [0.; 3],
            slots: [Slot::default(); 4],
            diagnostics: std::array::from_fn(|_| Default::default()),
            diagnostic_count: 0,
        }
    }
}
impl LightSelection {
    pub fn new(v: &[f32]) -> Self {
        if ![580, 584, 592, 600, 608].contains(&v.len()) || v[576] == 0. {
            return Self::default();
        }
        let mut hash = 2166136261u32;
        // Only semantic point selection inputs. Ignore compiler-derived selected rows.
        for value in inputs(v) {
            let bits = if value == 0. { 0 } else { value.to_bits() };
            for byte in bits.to_le_bytes() {
                hash = (hash ^ u32::from(byte)).wrapping_mul(16777619);
            }
        }
        Self {
            config: Some(Config {
                hysteresis: v[577],
                fade_seconds: v[578],
                reset_distance: v[579],
            }),
            hash,
            ..Default::default()
        }
    }
    pub fn enabled(&self) -> bool {
        self.config.is_some()
    }
    pub fn retain_compatible(&mut self, previous: &Self, source: &[f32], old_source: &[f32]) {
        if self.enabled()
            && previous.enabled()
            && self.hash == previous.hash
            && inputs(source).eq(inputs(old_source))
        {
            *self = previous.clone();
        }
    }
    pub fn reset(&mut self) {
        self.initialized = false;
        self.tick = 0;
        self.anchor = [0.; 3];
        self.slots.fill(Slot::default());
        self.diagnostic_count = 0;
    }
    pub fn diagnostics(&self) -> &[LightSelectionDiagnostic] {
        &self.diagnostics[..self.diagnostic_count]
    }

    fn desired(&self, v: &[f32], data: &Candidates, hysteresis: bool) -> [Option<u8>; 4] {
        let mut ranked = std::array::from_fn::<_, 16, _>(|i| {
            let owner = super::point_shadows::owner(v, i);
            let incumbent = self.slots.iter().any(|s| s.source == Some(i as u8));
            let score = if let Some(owner) = owner {
                f32::MAX / (owner + 1) as f32
            } else if data.visible[i] && data.scores[i] > 0. {
                data.scores[i]
                    * if hysteresis && incumbent {
                        1. + self.config.map_or(0., |c| c.hysteresis)
                    } else {
                        1.
                    }
            } else {
                -1.
            };
            (i, score)
        });
        ranked[..data.count].sort_unstable_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
        let mut desired = [None; 4];
        for (slot, (source, score)) in ranked[..data.count.min(v[136] as usize)].iter().enumerate()
        {
            if *score >= 0. {
                desired[slot] = Some(*source as u8);
            }
        }
        desired
    }
    pub fn advance(&mut self, v: &[f32], data: &Candidates, target: [f32; 3], dt: f32) {
        let Some(config) = self.config else {
            return;
        };
        if v[0] as u32 & 1 == 0 {
            self.reset();
            self.refresh(v, data);
            return;
        }
        let cut = config.reset_distance > 0.
            && target
                .iter()
                .zip(self.anchor)
                .map(|(a, b)| (*a - b).powi(2))
                .sum::<f32>()
                > config.reset_distance.powi(2);
        if !self.initialized || cut {
            let desired = self.desired(v, data, false);
            self.slots = desired.map(|source| {
                if source.is_some() {
                    Slot {
                        source,
                        weight: 1.,
                        phase: Phase::Steady,
                        ..Default::default()
                    }
                } else {
                    Slot::default()
                }
            });
            self.initialized = true;
            self.anchor = target;
        } else if dt.is_finite() && dt > 0. {
            let desired = self.desired(v, data, true);
            let mut assigned = [false; 16];
            for slot in &self.slots {
                if let Some(source) = slot
                    .source
                    .filter(|source| desired.contains(&Some(*source)))
                {
                    assigned[source as usize] = true;
                }
            }
            let mut replacements = desired
                .into_iter()
                .flatten()
                .filter(|source| !assigned[*source as usize]);
            for slot in &mut self.slots {
                let keep = slot.source.is_some_and(|s| desired.contains(&Some(s)));
                let target = if keep {
                    slot.source
                } else {
                    replacements.next()
                };
                if keep {
                    slot.pending = None;
                    slot.phase = if slot.weight < 1. {
                        Phase::In
                    } else {
                        Phase::Steady
                    };
                } else if slot.source.is_none() {
                    slot.source = target;
                    slot.pending = None;
                    slot.phase = if target.is_some() {
                        Phase::In
                    } else {
                        Phase::Empty
                    };
                } else {
                    slot.pending = target;
                    slot.phase = Phase::Out;
                }
                advance_slot(slot, dt, config.fade_seconds);
            }
            self.anchor = target;
        }
        if dt.is_finite() && dt > 0. {
            self.tick = self.tick.wrapping_add(1);
        }
        self.refresh(v, data);
    }
    pub fn display(&mut self, v: &[f32], data: &Candidates) -> ([Option<usize>; 4], [f32; 4]) {
        self.refresh(v, data);
        if v[0] as u32 & 1 == 0 {
            return ([None; 4], [0.; 4]);
        }
        pack(&self.display_slots(v, data))
    }
    fn display_slots(&self, v: &[f32], data: &Candidates) -> [Slot; 4] {
        if v[0] as u32 & 1 == 0 {
            return [Slot::default(); 4];
        }
        if self.initialized {
            self.slots
        } else {
            // A render before the first simulation update is a stateless preview.
            // It must not change which light the first simulation step fades out.
            self.desired(v, data, false).map(|source| {
                if source.is_some() {
                    Slot {
                        source,
                        weight: 1.,
                        phase: Phase::Steady,
                        ..Default::default()
                    }
                } else {
                    Slot::default()
                }
            })
        }
    }
    fn refresh(&mut self, v: &[f32], data: &Candidates) {
        let enabled = v[0] as u32 & 1 != 0;
        let raw = self.desired(v, data, false);
        self.diagnostic_count = data.count;
        let slots = self.display_slots(v, data);
        let (packed, _) = pack(&slots);
        for (i, row) in self.diagnostics[..data.count].iter_mut().enumerate() {
            let slot = slots.iter().find(|s| s.source == Some(i as u8));
            let held = slot.is_some_and(|s| s.phase != Phase::Out) && !raw.contains(&Some(i as u8));
            let queued = self.slots.iter().any(|s| s.pending == Some(i as u8));
            let reason = if !enabled {
                8
            } else if data.unavailable[i] != 0 {
                data.unavailable[i]
            } else if data.scores[i] <= 0. {
                7
            } else {
                match slot {
                    None if queued => 10,
                    None => 5,
                    Some(s) if s.phase == Phase::In => 2,
                    Some(s) if s.phase == Phase::Out => 3,
                    Some(_) if held => 4,
                    Some(_) => 1,
                }
            };
            *row = LightSelectionDiagnostic {
                source: i as u32,
                slot: packed
                    .iter()
                    .position(|s| *s == Some(i))
                    .map_or(-1, |s| s as i32),
                reason,
                flags: u32::from(super::point_shadows::owner(v, i).is_some())
                    | (u32::from(held) << 1)
                    | (u32::from(!self.initialized) << 2)
                    | (u32::from(queued) << 3),
                score: data.scores[i],
                weight: slot.map_or(0., |s| s.weight),
            };
        }
    }
    /// Cold progress v1: version/hash/initialized/tick/anchorXYZ and4 source/pending/weight/phase rows.
    pub fn capture(&self) -> Vec<f64> {
        if !self.enabled() {
            return vec![];
        }
        let mut v = Vec::with_capacity(23);
        v.extend([
            1.,
            f64::from(self.hash),
            f64::from(u8::from(self.initialized)),
            f64::from(self.tick),
        ]);
        v.extend(self.anchor.map(f64::from));
        for slot in &self.slots {
            v.extend([
                slot.source.map_or(-1., f64::from),
                slot.pending.map_or(-1., f64::from),
                f64::from(slot.weight),
                slot.phase as u32 as f64,
            ]);
        }
        v
    }
    pub fn restore(&mut self, v: &[f64], source: &[f32]) -> bool {
        if !self.enabled()
            || v.len() != 23
            || v.iter().any(|n| !n.is_finite())
            || v[0] != 1.
            || v[1] != f64::from(self.hash)
            || ![0., 1.].contains(&v[2])
            || v[3].fract() != 0.
            || !(0. ..=u32::MAX as f64).contains(&v[3])
            || v[4..7].iter().any(|n| n.abs() > 1e6)
        {
            return false;
        }
        let mut slots = [Slot::default(); 4];
        let mut seen = [false; 16];
        let mut pending = [false; 16];
        let index = |n: f64| -> Option<Option<u8>> {
            if n == -1. {
                Some(None)
            } else if n.fract() == 0. && (0. ..f64::from(source[137])).contains(&n) {
                Some(Some(n as u8))
            } else {
                None
            }
        };
        for (slot, row) in slots.iter_mut().zip(v[7..].chunks_exact(4)) {
            if !(0. ..=1.).contains(&row[2]) {
                return false;
            }
            let (Some(active), Some(next)) = (index(row[0]), index(row[1])) else {
                return false;
            };
            let weight = row[2] as f32;
            let phase = match row[3] {
                0. => Phase::Empty,
                1. => Phase::Steady,
                2. => Phase::In,
                3. => Phase::Out,
                _ => return false,
            };
            let valid = match phase {
                Phase::Empty => active.is_none() && next.is_none() && weight == 0.,
                Phase::Steady => active.is_some() && next.is_none() && weight == 1.,
                Phase::In => {
                    active.is_some()
                        && next.is_none()
                        && (0. ..1.).contains(&weight)
                        && source[578] > 0.
                }
                Phase::Out => {
                    active.is_some()
                        && next != active
                        && weight > 0.
                        && weight <= 1.
                        && source[578] > 0.
                }
            };
            if !valid {
                return false;
            }
            if let Some(i) = active {
                if seen[i as usize] {
                    return false;
                }
                seen[i as usize] = true;
            }
            if let Some(i) = next {
                if pending[i as usize] {
                    return false;
                }
                pending[i as usize] = true;
            }
            *slot = Slot {
                source: active,
                pending: next,
                weight,
                phase,
            };
        }
        if seen.iter().zip(pending).any(|(a, b)| *a && b)
            || slots[source[136] as usize..]
                .iter()
                .any(|s| *s != Slot::default())
            || (v[2] == 0.
                && (v[3..7].iter().any(|n| *n != 0.)
                    || slots.iter().any(|s| *s != Slot::default())))
            || (v[2] == 1.
                && (source[0] as u32 & 1 == 0
                    || (0..source[137] as usize).any(|i| {
                        super::point_shadows::owner(source, i).is_some_and(|owner| {
                            slots[owner].source != Some(i as u8)
                                || slots[owner].phase != Phase::Steady
                        })
                    })))
        {
            return false;
        }
        self.slots = slots;
        self.initialized = v[2] == 1.;
        self.tick = v[3] as u32;
        self.anchor = [v[4] as f32, v[5] as f32, v[6] as f32];
        true
    }
}

fn inputs(v: &[f32]) -> impl Iterator<Item = f32> + '_ {
    std::iter::once((v[0] as u32 & 1) as f32)
        .chain(v[136..139].iter().copied())
        .chain(v[192..512].iter().copied())
        .chain(v[549..565].iter().copied())
        .chain(v[576..580].iter().copied())
        .chain((v.len() >= 592 && v[589] == 1.).then(|| v[584]))
}

fn pack(slots: &[Slot; 4]) -> ([Option<usize>; 4], [f32; 4]) {
    let mut sources = [None; 4];
    let mut weights = [0.; 4];
    let mut at = 0;
    for slot in slots {
        if let Some(source) = slot.source {
            sources[at] = Some(source as usize);
            weights[at] = slot.weight;
            at += 1;
        }
    }
    (sources, weights)
}

fn advance_slot(slot: &mut Slot, mut dt: f32, fade: f32) {
    if slot.phase == Phase::Out {
        let time = slot.weight * fade;
        if fade > 0. && dt < time {
            let weight = (slot.weight - dt / fade).max(0.);
            if weight > 0. {
                slot.weight = weight;
                return;
            }
            // Division can round to the remaining weight just before `time`.
            // Finish that leg now instead of persisting an invalid Out/zero row.
            dt = 0.;
        } else {
            dt = (dt - time).max(0.);
        }
        slot.source = slot.pending.take();
        slot.weight = 0.;
        slot.phase = if slot.source.is_some() {
            Phase::In
        } else {
            Phase::Empty
        };
    }
    if slot.phase == Phase::In {
        if fade == 0. {
            slot.weight = 1.;
        } else {
            slot.weight = (slot.weight + dt / fade).min(1.);
        }
        if slot.weight == 1. {
            slot.phase = Phase::Steady;
        }
    }
}

#[cfg(test)]
#[path = "light_selection_tests.rs"]
mod tests;
