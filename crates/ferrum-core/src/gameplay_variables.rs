pub(crate) const MAX_GAMEPLAY_VARIABLES: usize = 64;
pub(crate) const MAX_GAMEPLAY_VARIABLE_MUTATION_TRIGGERS_PER_ENTITY: usize = 16;
const GAMEPLAY_VARIABLE_SNAPSHOT_U32S_PER_SLOT: usize = 5;
pub(crate) const GAMEPLAY_VARIABLE_SNAPSHOT_U32S: usize =
    MAX_GAMEPLAY_VARIABLES * GAMEPLAY_VARIABLE_SNAPSHOT_U32S_PER_SLOT;
const MAX_SAFE_INTEGER: f64 = 9_007_199_254_740_991.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GameplayVariableType {
    Integer,
    Real,
    Bool,
}

impl GameplayVariableType {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Integer),
            1 => Some(Self::Real),
            2 => Some(Self::Bool),
            _ => None,
        }
    }

    const fn code(self) -> u32 {
        match self {
            Self::Integer => 0,
            Self::Real => 1,
            Self::Bool => 2,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GameplayVariableScope {
    Global,
    Scene,
}

impl GameplayVariableScope {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Global),
            1 => Some(Self::Scene),
            _ => None,
        }
    }

    const fn code(self) -> u32 {
        match self {
            Self::Global => 0,
            Self::Scene => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct GameplayVariable {
    variable_type: GameplayVariableType,
    scope: GameplayVariableScope,
    default_value: f64,
    value: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GameplayVariableSlab {
    slots: [Option<GameplayVariable>; MAX_GAMEPLAY_VARIABLES],
}

impl Default for GameplayVariableSlab {
    fn default() -> Self {
        Self {
            slots: [None; MAX_GAMEPLAY_VARIABLES],
        }
    }
}

impl GameplayVariableSlab {
    pub(crate) fn clear(&mut self) {
        self.slots.fill(None);
    }

    pub(crate) fn configure(
        &mut self,
        slot: u32,
        variable_type: GameplayVariableType,
        scope: GameplayVariableScope,
        default_value: f64,
        value: f64,
    ) -> bool {
        let Some(index) = variable_slot_index(slot) else {
            return false;
        };
        let Some(default_value) = normalized_value(variable_type, default_value) else {
            return false;
        };
        let Some(value) = normalized_value(variable_type, value) else {
            return false;
        };
        self.slots[index] = Some(GameplayVariable {
            variable_type,
            scope,
            default_value,
            value,
        });
        true
    }

    pub(crate) fn is_configured(&self, slot: u32) -> bool {
        variable_slot_index(slot)
            .and_then(|index| self.slots[index])
            .is_some()
    }

    pub(crate) fn value(&self, slot: u32) -> Option<f64> {
        variable_slot_index(slot).and_then(|index| self.slots[index].map(|entry| entry.value))
    }

    pub(crate) fn set(&mut self, slot: u32, value: f64) -> bool {
        let Some(index) = variable_slot_index(slot) else {
            return false;
        };
        let Some(entry) = self.slots[index].as_mut() else {
            return false;
        };
        let Some(value) = normalized_value(entry.variable_type, value) else {
            return false;
        };
        entry.value = value;
        true
    }

    pub(crate) fn increment(&mut self, slot: u32, amount: f64) -> bool {
        let Some(index) = variable_slot_index(slot) else {
            return false;
        };
        let Some(entry) = self.slots[index].as_mut() else {
            return false;
        };
        if entry.variable_type == GameplayVariableType::Bool || !amount.is_finite() {
            return false;
        }
        let Some(value) = normalized_value(entry.variable_type, entry.value + amount) else {
            return false;
        };
        entry.value = value;
        true
    }

    pub(crate) fn reset_scene_values(&mut self) {
        for entry in self.slots.iter_mut().flatten() {
            if entry.scope == GameplayVariableScope::Scene {
                entry.value = entry.default_value;
            }
        }
    }

    pub(crate) fn matches(&self, comparison: GameplayVariableComparison) -> bool {
        if !comparison.enabled {
            return true;
        }
        if !self.supports_comparison(comparison) {
            return false;
        }
        let left = self
            .value(comparison.left_slot)
            .expect("supported comparison must reference a configured left slot");
        let right = if comparison.right_slot == 0 {
            comparison.right_literal
        } else {
            self.value(comparison.right_slot)
                .expect("supported comparison must reference a configured right slot")
        };
        comparison.operator.matches(left, right)
    }

    pub(crate) fn supports_comparison(&self, comparison: GameplayVariableComparison) -> bool {
        if !comparison.enabled {
            return true;
        }
        let Some(left) = self.variable(comparison.left_slot) else {
            return false;
        };
        if left.variable_type == GameplayVariableType::Bool
            && !matches!(
                comparison.operator,
                GameplayVariableComparisonOperator::Equal
                    | GameplayVariableComparisonOperator::NotEqual
            )
        {
            return false;
        }
        if comparison.right_slot == 0 {
            return normalized_value(left.variable_type, comparison.right_literal).is_some();
        }
        let Some(right) = self.variable(comparison.right_slot) else {
            return false;
        };
        (left.variable_type == GameplayVariableType::Bool)
            == (right.variable_type == GameplayVariableType::Bool)
    }

    pub(crate) fn supports_mutation(
        &self,
        slot: u32,
        operation: GameplayVariableMutationOperation,
        value: f64,
    ) -> bool {
        let Some(variable) = self.variable(slot) else {
            return false;
        };
        match operation {
            GameplayVariableMutationOperation::Set => {
                normalized_value(variable.variable_type, value).is_some()
            }
            GameplayVariableMutationOperation::Increment => {
                variable.variable_type != GameplayVariableType::Bool
                    && normalized_value(variable.variable_type, value).is_some()
            }
        }
    }

    pub(crate) fn write_snapshot(&self, output: &mut [u32]) -> bool {
        if output.len() != GAMEPLAY_VARIABLE_SNAPSHOT_U32S {
            return false;
        }
        output.fill(0);
        for (slot, entry) in self.slots.iter().enumerate() {
            let Some(entry) = entry else {
                continue;
            };
            let offset = slot * GAMEPLAY_VARIABLE_SNAPSHOT_U32S_PER_SLOT;
            output[offset] = 1 | (entry.variable_type.code() << 8) | (entry.scope.code() << 16);
            write_f64_words(entry.default_value, &mut output[offset + 1..offset + 3]);
            write_f64_words(entry.value, &mut output[offset + 3..offset + 5]);
        }
        true
    }

    pub(crate) fn from_snapshot(input: &[u32]) -> Option<Self> {
        if input.len() != GAMEPLAY_VARIABLE_SNAPSHOT_U32S {
            return None;
        }
        let mut slab = Self::default();
        for slot in 0..MAX_GAMEPLAY_VARIABLES {
            let offset = slot * GAMEPLAY_VARIABLE_SNAPSHOT_U32S_PER_SLOT;
            let metadata = input[offset];
            if metadata == 0 {
                if input[offset + 1..offset + 5].iter().any(|word| *word != 0) {
                    return None;
                }
                continue;
            }
            if metadata & 0xff != 1 || metadata & 0xff00_0000 != 0 {
                return None;
            }
            let variable_type = GameplayVariableType::from_code((metadata >> 8) & 0xff)?;
            let scope = GameplayVariableScope::from_code((metadata >> 16) & 0xff)?;
            let default_value = read_f64_words(&input[offset + 1..offset + 3]);
            let value = read_f64_words(&input[offset + 3..offset + 5]);
            if !slab.configure(
                (slot + 1) as u32,
                variable_type,
                scope,
                default_value,
                value,
            ) {
                return None;
            }
        }
        Some(slab)
    }

    fn variable(&self, slot: u32) -> Option<GameplayVariable> {
        variable_slot_index(slot).and_then(|index| self.slots[index])
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GameplayVariableComparisonOperator {
    Equal,
    NotEqual,
    LessThan,
    LessThanOrEqual,
    GreaterThan,
    GreaterThanOrEqual,
}

impl GameplayVariableComparisonOperator {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Equal),
            1 => Some(Self::NotEqual),
            2 => Some(Self::LessThan),
            3 => Some(Self::LessThanOrEqual),
            4 => Some(Self::GreaterThan),
            5 => Some(Self::GreaterThanOrEqual),
            _ => None,
        }
    }

    const fn matches(self, left: f64, right: f64) -> bool {
        match self {
            Self::Equal => left == right,
            Self::NotEqual => left != right,
            Self::LessThan => left < right,
            Self::LessThanOrEqual => left <= right,
            Self::GreaterThan => left > right,
            Self::GreaterThanOrEqual => left >= right,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GameplayVariableComparison {
    enabled: bool,
    pub(crate) left_slot: u32,
    pub(crate) operator: GameplayVariableComparisonOperator,
    pub(crate) right_slot: u32,
    pub(crate) right_literal: f64,
}

impl GameplayVariableComparison {
    pub(crate) const fn always() -> Self {
        Self {
            enabled: false,
            left_slot: 0,
            operator: GameplayVariableComparisonOperator::Equal,
            right_slot: 0,
            right_literal: 0.0,
        }
    }

    pub(crate) fn new(
        left_slot: u32,
        operator: GameplayVariableComparisonOperator,
        right_slot: u32,
        right_literal: f64,
    ) -> Option<Self> {
        variable_slot_index(left_slot)?;
        if right_slot != 0 {
            variable_slot_index(right_slot)?;
        }
        if !right_literal.is_finite() || (right_slot != 0 && right_literal != 0.0) {
            return None;
        }
        Some(Self {
            enabled: true,
            left_slot,
            operator,
            right_slot,
            right_literal: normalize_zero(right_literal),
        })
    }
}

impl Default for GameplayVariableComparison {
    fn default() -> Self {
        Self::always()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum GameplayVariableMutationOperation {
    Set,
    Increment,
}

impl GameplayVariableMutationOperation {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Set),
            1 => Some(Self::Increment),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GameplayVariableMutationTrigger {
    pub(crate) event_kind: u32,
    pub(crate) token_id: u32,
    pub(crate) slot: u32,
    pub(crate) operation: GameplayVariableMutationOperation,
    pub(crate) value: f64,
}

impl GameplayVariableMutationTrigger {
    pub(crate) fn new(
        event_kind: u32,
        token_id: u32,
        slot: u32,
        operation: GameplayVariableMutationOperation,
        value: f64,
    ) -> Option<Self> {
        variable_slot_index(slot)?;
        if !value.is_finite() {
            return None;
        }
        Some(Self {
            event_kind,
            token_id,
            slot,
            operation,
            value: normalize_zero(value),
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct GameplayVariableMutationTriggerSet {
    triggers: [Option<GameplayVariableMutationTrigger>;
        MAX_GAMEPLAY_VARIABLE_MUTATION_TRIGGERS_PER_ENTITY],
    len: usize,
}

impl Default for GameplayVariableMutationTriggerSet {
    fn default() -> Self {
        Self {
            triggers: [None; MAX_GAMEPLAY_VARIABLE_MUTATION_TRIGGERS_PER_ENTITY],
            len: 0,
        }
    }
}

impl GameplayVariableMutationTriggerSet {
    pub(crate) fn upsert(&mut self, trigger: GameplayVariableMutationTrigger) -> bool {
        if let Some(existing) = self.triggers.iter_mut().take(self.len).find(|entry| {
            entry.as_ref().is_some_and(|entry| {
                entry.event_kind == trigger.event_kind
                    && entry.token_id == trigger.token_id
                    && entry.slot == trigger.slot
                    && entry.operation == trigger.operation
            })
        }) {
            *existing = Some(trigger);
            return true;
        }
        let Some(slot) = self.triggers.get_mut(self.len) else {
            return false;
        };
        *slot = Some(trigger);
        self.len += 1;
        true
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = GameplayVariableMutationTrigger> + '_ {
        self.triggers.iter().filter_map(|trigger| *trigger)
    }
}

fn variable_slot_index(slot: u32) -> Option<usize> {
    let index = slot.checked_sub(1)? as usize;
    (index < MAX_GAMEPLAY_VARIABLES).then_some(index)
}

fn normalized_value(variable_type: GameplayVariableType, value: f64) -> Option<f64> {
    if !value.is_finite() {
        return None;
    }
    match variable_type {
        GameplayVariableType::Integer => (value.fract() == 0.0 && value.abs() <= MAX_SAFE_INTEGER)
            .then_some(normalize_zero(value)),
        GameplayVariableType::Real => Some(normalize_zero(value)),
        GameplayVariableType::Bool => matches!(value, 0.0 | 1.0).then_some(normalize_zero(value)),
    }
}

fn normalize_zero(value: f64) -> f64 {
    if value == 0.0 {
        0.0
    } else {
        value
    }
}

fn write_f64_words(value: f64, output: &mut [u32]) {
    let bits = value.to_bits();
    output[0] = bits as u32;
    output[1] = (bits >> 32) as u32;
}

fn read_f64_words(input: &[u32]) -> f64 {
    f64::from_bits(u64::from(input[0]) | (u64::from(input[1]) << 32))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slab_validates_types_and_round_trips_snapshot() {
        let mut slab = GameplayVariableSlab::default();
        assert!(slab.configure(
            1,
            GameplayVariableType::Integer,
            GameplayVariableScope::Global,
            2.0,
            3.0,
        ));
        assert!(slab.configure(
            2,
            GameplayVariableType::Bool,
            GameplayVariableScope::Scene,
            0.0,
            1.0,
        ));
        assert!(slab.increment(1, 4.0));
        assert!(!slab.increment(2, 1.0));

        let mut snapshot = [0; GAMEPLAY_VARIABLE_SNAPSHOT_U32S];
        assert!(slab.write_snapshot(&mut snapshot));
        assert_eq!(GameplayVariableSlab::from_snapshot(&snapshot), Some(slab));
    }

    #[test]
    fn comparison_supports_literal_and_variable_rhs() {
        let mut slab = GameplayVariableSlab::default();
        assert!(slab.configure(
            1,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            3.0,
            3.0,
        ));
        assert!(slab.configure(
            2,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            2.0,
            2.0,
        ));
        assert!(slab.matches(
            GameplayVariableComparison::new(
                1,
                GameplayVariableComparisonOperator::GreaterThanOrEqual,
                0,
                3.0,
            )
            .unwrap(),
        ));
        assert!(slab.matches(
            GameplayVariableComparison::new(
                1,
                GameplayVariableComparisonOperator::GreaterThan,
                2,
                0.0,
            )
            .unwrap(),
        ));
    }

    #[test]
    fn slab_rejects_unconfigured_and_type_incompatible_runtime_commands() {
        let mut slab = GameplayVariableSlab::default();
        assert!(slab.configure(
            1,
            GameplayVariableType::Bool,
            GameplayVariableScope::Scene,
            0.0,
            0.0,
        ));
        assert!(slab.configure(
            2,
            GameplayVariableType::Integer,
            GameplayVariableScope::Scene,
            0.0,
            0.0,
        ));
        let bool_ordering = GameplayVariableComparison::new(
            1,
            GameplayVariableComparisonOperator::GreaterThan,
            0,
            0.0,
        )
        .unwrap();
        let mixed_types =
            GameplayVariableComparison::new(1, GameplayVariableComparisonOperator::Equal, 2, 0.0)
                .unwrap();
        let missing_slot =
            GameplayVariableComparison::new(3, GameplayVariableComparisonOperator::Equal, 0, 1.0)
                .unwrap();

        assert!(!slab.supports_comparison(bool_ordering));
        assert!(!slab.supports_comparison(mixed_types));
        assert!(!slab.supports_comparison(missing_slot));
        assert!(!slab.supports_mutation(1, GameplayVariableMutationOperation::Increment, 1.0,));
        assert!(!slab.supports_mutation(2, GameplayVariableMutationOperation::Set, 0.5,));
        assert!(!slab.supports_mutation(3, GameplayVariableMutationOperation::Set, 1.0,));
    }

    #[test]
    fn bool_negative_zero_is_canonicalized_for_stable_snapshots() {
        let mut slab = GameplayVariableSlab::default();
        assert!(slab.configure(
            1,
            GameplayVariableType::Bool,
            GameplayVariableScope::Scene,
            -0.0,
            -0.0,
        ));

        let mut snapshot = [0; GAMEPLAY_VARIABLE_SNAPSHOT_U32S];
        assert!(slab.write_snapshot(&mut snapshot));

        assert_eq!(snapshot[1], 0);
        assert_eq!(snapshot[2], 0);
        assert_eq!(snapshot[3], 0);
        assert_eq!(snapshot[4], 0);

        let comparison =
            GameplayVariableComparison::new(1, GameplayVariableComparisonOperator::Equal, 0, -0.0)
                .unwrap();
        let trigger = GameplayVariableMutationTrigger::new(
            1,
            0,
            1,
            GameplayVariableMutationOperation::Set,
            -0.0,
        )
        .unwrap();
        assert_eq!(comparison.right_literal.to_bits(), 0);
        assert_eq!(trigger.value.to_bits(), 0);
    }
}
