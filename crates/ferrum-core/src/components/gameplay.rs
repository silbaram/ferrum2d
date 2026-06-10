use crate::components::CollisionLayer;
use crate::entity::Entity;
use crate::gameplay_event::GAMEPLAY_EVENT_INTERACTION;

pub(crate) const MAX_COLLISION_REACTIONS_PER_ENTITY: usize = 16;
pub(crate) const MAX_BEHAVIOR_STATE_TRANSITIONS_PER_ENTITY: usize = 32;
pub(crate) const MAX_BEHAVIOR_STATE_ENTER_ACTIONS_PER_ENTITY: usize = 32;
pub(crate) const MAX_ACTION_BINDINGS_PER_ENTITY: usize = 16;
pub(crate) const GAMEPLAY_PICKUP_ITEM_SCORE: u32 = 1;
#[cfg(test)]
pub(crate) const GAMEPLAY_FACTION_NEUTRAL: u32 = 0;
#[cfg(test)]
pub(crate) const GAMEPLAY_FACTION_PLAYER: u32 = 1;
#[cfg(test)]
pub(crate) const GAMEPLAY_FACTION_ENEMY: u32 = 2;
pub(crate) const GAMEPLAY_FACTION_MAX_ID: u32 = 31;
pub(crate) const GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS: usize =
    GAMEPLAY_FACTION_MAX_ID as usize + 1;
pub(crate) const GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S: usize =
    2 + GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS * 2;
const GAMEPLAY_FACTION_RELATION_TABLE_FULL_MASK: u32 = u32::MAX;
pub(crate) const GAMEPLAY_TAG_MAX_ID: u32 = 31;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MovementTarget {
    Player,
    NearestPlayer,
    NearestEnemy,
    NearestLayer(CollisionLayer),
    NearestFaction(u32),
    NearestTag(u32),
    Entity(Entity),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollisionTarget {
    SelfEntity,
    OtherEntity,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GameplayFaction {
    pub(crate) faction_id: u32,
    pub(crate) damage_mask: u32,
}

impl GameplayFaction {
    pub(crate) const fn new(faction_id: u32, damage_mask: u32) -> Option<Self> {
        if faction_id > GAMEPLAY_FACTION_MAX_ID {
            return None;
        }
        Some(Self {
            faction_id,
            damage_mask,
        })
    }

    pub(crate) const fn can_damage(self, target: Self) -> bool {
        self.damage_mask & gameplay_faction_mask(target.faction_id) != 0
    }
}

pub(crate) const fn gameplay_faction_mask(faction_id: u32) -> u32 {
    if faction_id > GAMEPLAY_FACTION_MAX_ID {
        return 0;
    }
    1_u32 << faction_id
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FactionRelation {
    Neutral,
    Friendly,
    Hostile,
}

impl FactionRelation {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Neutral),
            1 => Some(Self::Friendly),
            2 => Some(Self::Hostile),
            _ => None,
        }
    }

    pub(crate) const fn code(self) -> u32 {
        match self {
            Self::Neutral => 0,
            Self::Friendly => 1,
            Self::Hostile => 2,
        }
    }

    const fn damage_allowed(self) -> bool {
        matches!(self, Self::Hostile)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FactionRelationTable {
    enabled: bool,
    default_relation: FactionRelation,
    friendly_masks: [u32; GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS],
    hostile_masks: [u32; GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS],
}

impl Default for FactionRelationTable {
    fn default() -> Self {
        Self {
            enabled: false,
            default_relation: FactionRelation::Neutral,
            friendly_masks: [0; GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS],
            hostile_masks: [0; GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS],
        }
    }
}

impl FactionRelationTable {
    pub(crate) fn clear(&mut self) {
        *self = Self::default();
    }

    pub(crate) const fn enabled(&self) -> bool {
        self.enabled
    }

    #[cfg(test)]
    pub(crate) const fn default_relation(&self) -> FactionRelation {
        self.default_relation
    }

    pub(crate) fn set_default_relation(&mut self, relation: FactionRelation) {
        self.enabled = true;
        self.default_relation = relation;
        let (friendly_mask, hostile_mask) = relation_fill_masks(relation);
        self.friendly_masks = [friendly_mask; GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS];
        self.hostile_masks = [hostile_mask; GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS];
    }

    pub(crate) fn set_relation(
        &mut self,
        source_faction_id: u32,
        target_faction_id: u32,
        relation: FactionRelation,
    ) -> bool {
        if source_faction_id > GAMEPLAY_FACTION_MAX_ID
            || target_faction_id > GAMEPLAY_FACTION_MAX_ID
        {
            return false;
        }
        if !self.enabled {
            self.set_default_relation(FactionRelation::Neutral);
        }
        let source_index = source_faction_id as usize;
        let target_mask = gameplay_faction_mask(target_faction_id);
        self.friendly_masks[source_index] &= !target_mask;
        self.hostile_masks[source_index] &= !target_mask;
        match relation {
            FactionRelation::Neutral => {}
            FactionRelation::Friendly => self.friendly_masks[source_index] |= target_mask,
            FactionRelation::Hostile => self.hostile_masks[source_index] |= target_mask,
        }
        true
    }

    pub(crate) fn relation(
        &self,
        source_faction_id: u32,
        target_faction_id: u32,
    ) -> Option<FactionRelation> {
        if source_faction_id > GAMEPLAY_FACTION_MAX_ID
            || target_faction_id > GAMEPLAY_FACTION_MAX_ID
        {
            return None;
        }
        let source_index = source_faction_id as usize;
        let target_mask = gameplay_faction_mask(target_faction_id);
        if self.hostile_masks[source_index] & target_mask != 0 {
            return Some(FactionRelation::Hostile);
        }
        if self.friendly_masks[source_index] & target_mask != 0 {
            return Some(FactionRelation::Friendly);
        }
        Some(FactionRelation::Neutral)
    }

    pub(crate) fn can_damage(&self, source_faction_id: u32, target_faction_id: u32) -> bool {
        self.enabled
            && self
                .relation(source_faction_id, target_faction_id)
                .is_some_and(FactionRelation::damage_allowed)
    }

    pub(crate) fn write_snapshot(&self, output: &mut [u32]) -> bool {
        if output.len() != GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S {
            return false;
        }
        output[0] = if self.enabled { 1 } else { 0 };
        output[1] = self.default_relation.code();
        let friendly_start = 2;
        let hostile_start = friendly_start + GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS;
        output[friendly_start..hostile_start].copy_from_slice(&self.friendly_masks);
        output[hostile_start..hostile_start + GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS]
            .copy_from_slice(&self.hostile_masks);
        true
    }

    pub(crate) fn from_snapshot(input: &[u32]) -> Option<Self> {
        if input.len() != GAMEPLAY_FACTION_RELATION_TABLE_SNAPSHOT_U32S {
            return None;
        }
        let enabled = match input[0] {
            0 => false,
            1 => true,
            _ => return None,
        };
        let default_relation = FactionRelation::from_code(input[1])?;
        let friendly_start = 2;
        let hostile_start = friendly_start + GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS;
        let mut friendly_masks = [0; GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS];
        let mut hostile_masks = [0; GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS];
        friendly_masks.copy_from_slice(&input[friendly_start..hostile_start]);
        hostile_masks.copy_from_slice(
            &input[hostile_start..hostile_start + GAMEPLAY_FACTION_RELATION_TABLE_BUCKETS],
        );
        for (friendly, hostile) in friendly_masks.iter().zip(hostile_masks.iter()) {
            if friendly & hostile != 0 {
                return None;
            }
        }
        if !enabled
            && (default_relation != FactionRelation::Neutral
                || friendly_masks.iter().any(|mask| *mask != 0)
                || hostile_masks.iter().any(|mask| *mask != 0))
        {
            return None;
        }
        Some(Self {
            enabled,
            default_relation,
            friendly_masks,
            hostile_masks,
        })
    }
}

const fn relation_fill_masks(relation: FactionRelation) -> (u32, u32) {
    match relation {
        FactionRelation::Neutral => (0, 0),
        FactionRelation::Friendly => (GAMEPLAY_FACTION_RELATION_TABLE_FULL_MASK, 0),
        FactionRelation::Hostile => (0, GAMEPLAY_FACTION_RELATION_TABLE_FULL_MASK),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct GameplayTags {
    pub(crate) mask: u32,
}

impl GameplayTags {
    pub(crate) const fn new(mask: u32) -> Option<Self> {
        if mask == 0 {
            return None;
        }
        Some(Self { mask })
    }

    pub(crate) const fn contains(self, tag_id: u32) -> bool {
        if tag_id > GAMEPLAY_TAG_MAX_ID {
            return false;
        }
        self.mask & gameplay_tag_mask(tag_id) != 0
    }
}

pub(crate) const fn gameplay_tag_mask(tag_id: u32) -> u32 {
    if tag_id > GAMEPLAY_TAG_MAX_ID {
        return 0;
    }
    1_u32 << tag_id
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CollisionReactionTrigger {
    Contact,
    Enter,
}

impl CollisionReactionTrigger {
    pub(crate) const fn is_allowed(self, is_enter: bool) -> bool {
        match self {
            CollisionReactionTrigger::Contact => true,
            CollisionReactionTrigger::Enter => is_enter,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum MovementPattern {
    Static,
    TopdownInput {
        speed: f32,
    },
    PlatformerInput {
        horizontal_speed: f32,
        gravity: f32,
        jump_speed: f32,
        max_fall_speed: f32,
        ground_probe_distance: f32,
        step_offset: f32,
        coyote_time_seconds: f32,
        jump_buffer_seconds: f32,
    },
    Linear {
        vx: f32,
        vy: f32,
    },
    Oscillate {
        origin_x: f32,
        origin_y: f32,
        amplitude_x: f32,
        amplitude_y: f32,
        phase_speed: f32,
    },
    MoveToPoint {
        x: f32,
        y: f32,
        speed: f32,
    },
    Chase {
        target: MovementTarget,
        speed: f32,
    },
    SeekTarget {
        target: MovementTarget,
        speed: f32,
        turn_rate: f32,
    },
    Orbit {
        target: MovementTarget,
        speed: f32,
        radius: f32,
        radial_band: f32,
    },
    Accelerate {
        acceleration_x: f32,
        acceleration_y: f32,
        max_speed: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum CollisionReaction {
    Damage {
        target: CollisionTarget,
    },
    AreaDamage {
        radius: f32,
        target_layer: CollisionLayer,
    },
    Knockback {
        target: CollisionTarget,
        impulse: f32,
    },
    Pickup {
        target: CollisionTarget,
    },
    Despawn {
        target: CollisionTarget,
    },
    PlaySound {
        sound_id: u32,
        volume: f32,
        pitch: f32,
        cooldown: Cooldown,
        replace_default: bool,
        trigger: CollisionReactionTrigger,
    },
    SpawnParticle {
        preset_id: u32,
        target: CollisionTarget,
        cooldown: Cooldown,
        replace_default: bool,
        trigger: CollisionReactionTrigger,
    },
    CameraShake {
        cooldown: Cooldown,
        trigger: CollisionReactionTrigger,
    },
    EmitEffect {
        effect_id: u32,
        effect_type: u32,
        target: CollisionTarget,
        intensity: f32,
        radius: f32,
        cooldown: Cooldown,
        trigger: CollisionReactionTrigger,
    },
    SpawnPrefab {
        action_id: u32,
        prefab_id: u32,
        target: CollisionTarget,
        cooldown: Cooldown,
        trigger: CollisionReactionTrigger,
        offset_x: f32,
        offset_y: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Cooldown {
    pub(crate) duration_seconds: f32,
    pub(crate) remaining_seconds: f32,
}

impl Cooldown {
    pub(crate) const fn ready(duration_seconds: f32) -> Self {
        Self {
            duration_seconds,
            remaining_seconds: 0.0,
        }
    }

    pub(crate) fn tick(&mut self, delta: f32) {
        self.remaining_seconds = (self.remaining_seconds - delta.max(0.0)).max(0.0);
    }

    pub(crate) fn commit_if_ready(&mut self) -> bool {
        if !self.is_ready() {
            return false;
        }
        self.commit();
        true
    }

    pub(crate) const fn is_ready(self) -> bool {
        self.remaining_seconds <= 0.0
    }

    pub(crate) fn commit(&mut self) {
        self.remaining_seconds = self.duration_seconds.max(0.0);
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct GameplayTimerTrigger {
    pub(crate) timer_id: u32,
    pub(crate) duration_seconds: f32,
    pub(crate) remaining_seconds: f32,
    pub(crate) fired: bool,
    pub(crate) action_id: Option<u32>,
}

impl GameplayTimerTrigger {
    pub(crate) const fn new(timer_id: u32, duration_seconds: f32) -> Self {
        Self {
            timer_id,
            duration_seconds,
            remaining_seconds: duration_seconds,
            fired: false,
            action_id: None,
        }
    }

    pub(crate) const fn with_action(timer_id: u32, duration_seconds: f32, action_id: u32) -> Self {
        Self {
            timer_id,
            duration_seconds,
            remaining_seconds: duration_seconds,
            fired: false,
            action_id: Some(action_id),
        }
    }

    pub(crate) fn tick(&mut self, delta_seconds: f32) -> bool {
        if self.fired {
            return false;
        }
        self.remaining_seconds = (self.remaining_seconds - delta_seconds.max(0.0)).max(0.0);
        if self.remaining_seconds > 0.0 {
            return false;
        }
        self.fired = true;
        true
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum ActionPattern {
    Projectile {
        speed: f32,
        damage: f32,
        lifetime_seconds: f32,
        aim: ActionAimSource,
        collision_target: ProjectileCollisionTarget,
        tile_impact: ProjectileTileImpact,
    },
    Dash {
        distance: f32,
        aim: ActionAimSource,
    },
    Melee {
        range: f32,
        damage: f32,
        target: MeleeTarget,
    },
    SpawnPrefab {
        prefab_id: u32,
        projectile: Option<SpawnPrefabProjectilePayload>,
        anchor: SpawnAnchor,
        phase: SpawnPhase,
        offset_x: f32,
        offset_y: f32,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ActionAimSource {
    Input,
    TargetPlayer,
}

impl ActionAimSource {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Input),
            1 => Some(Self::TargetPlayer),
            _ => None,
        }
    }

    pub(crate) const fn code(self) -> u32 {
        match self {
            Self::Input => 0,
            Self::TargetPlayer => 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectileCollisionTarget {
    Enemies,
    Player,
}

impl ProjectileCollisionTarget {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Enemies),
            1 => Some(Self::Player),
            _ => None,
        }
    }

    pub(crate) const fn code(self) -> u32 {
        match self {
            Self::Enemies => 0,
            Self::Player => 1,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectileTileImpact {
    Despawn,
    PassThrough,
    Bounce,
}

impl ProjectileTileImpact {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Despawn),
            1 => Some(Self::PassThrough),
            2 => Some(Self::Bounce),
            _ => None,
        }
    }

    pub(crate) const fn code(self) -> u32 {
        match self {
            Self::Despawn => 0,
            Self::PassThrough => 1,
            Self::Bounce => 2,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct GameplayLifetime {
    pub(crate) remaining_seconds: f32,
}

impl GameplayLifetime {
    pub(crate) const fn new(remaining_seconds: f32) -> Self {
        Self { remaining_seconds }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProjectilePolicy {
    pub(crate) collision_target: ProjectileCollisionTarget,
    pub(crate) tile_impact: ProjectileTileImpact,
}

impl ProjectilePolicy {
    pub(crate) const fn new(
        collision_target: ProjectileCollisionTarget,
        tile_impact: ProjectileTileImpact,
    ) -> Self {
        Self {
            collision_target,
            tile_impact,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct SpawnPrefabProjectilePayload {
    pub(crate) speed: f32,
    pub(crate) damage: f32,
    pub(crate) lifetime_seconds: f32,
    pub(crate) aim: ActionAimSource,
    pub(crate) collision_target: ProjectileCollisionTarget,
    pub(crate) tile_impact: ProjectileTileImpact,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ProjectileActionConfig {
    pub(crate) speed: f32,
    pub(crate) damage: f32,
    pub(crate) lifetime_seconds: f32,
    pub(crate) aim: ActionAimSource,
    pub(crate) collision_target: ProjectileCollisionTarget,
    pub(crate) tile_impact: ProjectileTileImpact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MeleeTarget {
    Enemies,
    Player,
}

impl MeleeTarget {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::Enemies),
            1 => Some(Self::Player),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpawnAnchor {
    SelfEntity,
}

impl SpawnAnchor {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::SelfEntity),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SpawnPhase {
    PrePhysics,
}

impl SpawnPhase {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::PrePhysics),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ActionBinding {
    pub(crate) action_id: u32,
    pub(crate) pattern: ActionPattern,
    pub(crate) cooldown: Cooldown,
}

impl ActionBinding {
    #[cfg(test)]
    pub(crate) const fn projectile(
        action_id: u32,
        cooldown_seconds: f32,
        speed: f32,
        damage: f32,
        lifetime_seconds: f32,
    ) -> Self {
        Self::projectile_with_target(
            action_id,
            cooldown_seconds,
            ProjectileActionConfig {
                speed,
                damage,
                lifetime_seconds,
                aim: ActionAimSource::Input,
                collision_target: ProjectileCollisionTarget::Enemies,
                tile_impact: ProjectileTileImpact::Despawn,
            },
        )
    }

    pub(crate) const fn projectile_with_target(
        action_id: u32,
        cooldown_seconds: f32,
        config: ProjectileActionConfig,
    ) -> Self {
        Self {
            action_id,
            pattern: ActionPattern::Projectile {
                speed: config.speed,
                damage: config.damage,
                lifetime_seconds: config.lifetime_seconds,
                aim: config.aim,
                collision_target: config.collision_target,
                tile_impact: config.tile_impact,
            },
            cooldown: Cooldown::ready(cooldown_seconds),
        }
    }

    #[cfg(test)]
    pub(crate) const fn dash(action_id: u32, cooldown_seconds: f32, distance: f32) -> Self {
        Self::dash_with_aim(
            action_id,
            cooldown_seconds,
            distance,
            ActionAimSource::Input,
        )
    }

    pub(crate) const fn dash_with_aim(
        action_id: u32,
        cooldown_seconds: f32,
        distance: f32,
        aim: ActionAimSource,
    ) -> Self {
        Self {
            action_id,
            pattern: ActionPattern::Dash { distance, aim },
            cooldown: Cooldown::ready(cooldown_seconds),
        }
    }

    pub(crate) const fn melee(
        action_id: u32,
        cooldown_seconds: f32,
        range: f32,
        damage: f32,
    ) -> Self {
        Self::melee_with_target(
            action_id,
            cooldown_seconds,
            range,
            damage,
            MeleeTarget::Enemies,
        )
    }

    pub(crate) const fn melee_with_target(
        action_id: u32,
        cooldown_seconds: f32,
        range: f32,
        damage: f32,
        target: MeleeTarget,
    ) -> Self {
        Self {
            action_id,
            pattern: ActionPattern::Melee {
                range,
                damage,
                target,
            },
            cooldown: Cooldown::ready(cooldown_seconds),
        }
    }

    pub(crate) const fn spawn_prefab(
        action_id: u32,
        cooldown_seconds: f32,
        prefab_id: u32,
        anchor: SpawnAnchor,
        phase: SpawnPhase,
        offset_x: f32,
        offset_y: f32,
    ) -> Self {
        Self {
            action_id,
            pattern: ActionPattern::SpawnPrefab {
                prefab_id,
                projectile: None,
                anchor,
                phase,
                offset_x,
                offset_y,
            },
            cooldown: Cooldown::ready(cooldown_seconds),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Pickup {
    pub(crate) item_id: u32,
    pub(crate) count: u32,
    pub(crate) despawn_on_collect: bool,
}

impl Pickup {
    pub(crate) const fn new(item_id: u32, count: u32, despawn_on_collect: bool) -> Self {
        Self {
            item_id,
            count,
            despawn_on_collect,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Interaction {
    pub(crate) action_id: u32,
    pub(crate) radius: f32,
    pub(crate) once: bool,
    pub(crate) consumed: bool,
}

impl Interaction {
    pub(crate) const fn new(action_id: u32, radius: f32, once: bool) -> Self {
        Self {
            action_id,
            radius,
            once,
            consumed: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct CollisionReactionSet {
    reactions: [Option<CollisionReaction>; MAX_COLLISION_REACTIONS_PER_ENTITY],
    len: usize,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ActionBindingSet {
    bindings: [Option<ActionBinding>; MAX_ACTION_BINDINGS_PER_ENTITY],
    len: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BehaviorStateTransition {
    pub(crate) from_state: u32,
    pub(crate) to_state: u32,
    pub(crate) event_kind: u32,
    pub(crate) token_id: u32,
}

impl BehaviorStateTransition {
    #[allow(dead_code)]
    pub(crate) const fn new(from_state: u32, to_state: u32, action_id: u32) -> Self {
        Self::new_event(from_state, to_state, GAMEPLAY_EVENT_INTERACTION, action_id)
    }

    pub(crate) const fn new_event(
        from_state: u32,
        to_state: u32,
        event_kind: u32,
        token_id: u32,
    ) -> Self {
        Self {
            from_state,
            to_state,
            event_kind,
            token_id,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BehaviorStateMachine {
    current_state: u32,
    transitions: [Option<BehaviorStateTransition>; MAX_BEHAVIOR_STATE_TRANSITIONS_PER_ENTITY],
    len: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BehaviorStateEnterAction {
    pub(crate) state: u32,
    pub(crate) action_id: u32,
    pub(crate) phase: BehaviorStateEnterActionPhase,
}

impl BehaviorStateEnterAction {
    pub(crate) const fn new(
        state: u32,
        action_id: u32,
        phase: BehaviorStateEnterActionPhase,
    ) -> Self {
        Self {
            state,
            action_id,
            phase,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BehaviorStateEnterActionPhase {
    NextFramePrePhysics,
}

impl BehaviorStateEnterActionPhase {
    pub(crate) const fn from_code(code: u32) -> Option<Self> {
        match code {
            0 => Some(Self::NextFramePrePhysics),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct BehaviorStateEnterActionSet {
    actions: [Option<BehaviorStateEnterAction>; MAX_BEHAVIOR_STATE_ENTER_ACTIONS_PER_ENTITY],
    len: usize,
}

impl BehaviorStateMachine {
    pub(crate) const fn new(initial_state: u32) -> Self {
        Self {
            current_state: initial_state,
            transitions: [None; MAX_BEHAVIOR_STATE_TRANSITIONS_PER_ENTITY],
            len: 0,
        }
    }

    pub(crate) const fn current_state(&self) -> u32 {
        self.current_state
    }

    pub(crate) fn set_current_state(&mut self, state: u32) {
        self.current_state = state;
    }

    pub(crate) fn push_transition(&mut self, transition: BehaviorStateTransition) -> bool {
        self.compact_transitions();
        if self
            .iter_transitions()
            .any(|existing| existing == transition)
        {
            return true;
        }
        let Some(slot) = self.transitions.get_mut(self.len) else {
            return false;
        };
        *slot = Some(transition);
        self.len += 1;
        true
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.len
    }

    pub(crate) fn iter_transitions(&self) -> impl Iterator<Item = BehaviorStateTransition> + '_ {
        self.transitions.iter().filter_map(|transition| *transition)
    }

    fn compact_transitions(&mut self) {
        self.len = compact_option_slots(&mut self.transitions);
    }
}

impl Default for CollisionReactionSet {
    fn default() -> Self {
        Self {
            reactions: [None; MAX_COLLISION_REACTIONS_PER_ENTITY],
            len: 0,
        }
    }
}

impl Default for ActionBindingSet {
    fn default() -> Self {
        Self {
            bindings: [None; MAX_ACTION_BINDINGS_PER_ENTITY],
            len: 0,
        }
    }
}

impl Default for BehaviorStateEnterActionSet {
    fn default() -> Self {
        Self {
            actions: [None; MAX_BEHAVIOR_STATE_ENTER_ACTIONS_PER_ENTITY],
            len: 0,
        }
    }
}

impl ActionBindingSet {
    pub(crate) fn upsert(&mut self, binding: ActionBinding) -> bool {
        self.compact();
        if let Some(slot) = self.bindings.iter_mut().take(self.len).find(|slot| {
            slot.as_ref()
                .is_some_and(|existing| existing.action_id == binding.action_id)
        }) {
            *slot = Some(binding);
            return true;
        }
        let Some(slot) = self.bindings.get_mut(self.len) else {
            return false;
        };
        *slot = Some(binding);
        self.len += 1;
        true
    }

    pub(crate) fn get(&self, action_id: u32) -> Option<ActionBinding> {
        self.bindings
            .iter()
            .filter_map(|binding| *binding)
            .find(|binding| binding.action_id == action_id)
    }

    pub(crate) fn tick_cooldowns(&mut self, delta: f32) {
        let delta = delta.max(0.0);
        if delta == 0.0 {
            return;
        }
        for binding in self.bindings.iter_mut().flatten() {
            binding.cooldown.remaining_seconds =
                (binding.cooldown.remaining_seconds - delta).max(0.0);
        }
    }

    pub(crate) fn commit_cooldown_if_ready(&mut self, action_id: u32) -> Option<ActionBinding> {
        for binding in self.bindings.iter_mut().flatten() {
            if binding.action_id != action_id {
                continue;
            }
            if binding.cooldown.remaining_seconds > 0.0 {
                return None;
            }
            let triggered = *binding;
            binding.cooldown.remaining_seconds = binding.cooldown.duration_seconds.max(0.0);
            return Some(triggered);
        }
        None
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.len
    }

    pub(crate) fn iter(&self) -> impl Iterator<Item = ActionBinding> + '_ {
        self.bindings.iter().filter_map(|binding| *binding)
    }

    fn compact(&mut self) {
        self.len = compact_option_slots(&mut self.bindings);
    }
}

impl BehaviorStateEnterActionSet {
    pub(crate) fn upsert(&mut self, action: BehaviorStateEnterAction) -> bool {
        self.compact();
        if let Some(slot) = self.actions.iter_mut().take(self.len).find(|slot| {
            slot.as_ref().is_some_and(|existing| {
                existing.state == action.state
                    && existing.action_id == action.action_id
                    && existing.phase == action.phase
            })
        }) {
            *slot = Some(action);
            return true;
        }
        let Some(slot) = self.actions.get_mut(self.len) else {
            return false;
        };
        *slot = Some(action);
        self.len += 1;
        true
    }

    #[cfg(test)]
    pub(crate) fn is_empty(&self) -> bool {
        self.len == 0
    }

    pub(crate) fn iter_for_state(
        &self,
        state: u32,
    ) -> impl Iterator<Item = BehaviorStateEnterAction> + '_ {
        self.actions
            .iter()
            .filter_map(|action| *action)
            .filter(move |action| action.state == state)
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.len
    }

    fn compact(&mut self) {
        self.len = compact_option_slots(&mut self.actions);
    }
}

impl CollisionReactionSet {
    pub(crate) fn push(&mut self, reaction: CollisionReaction) -> bool {
        self.compact();
        if let Some(slot) = self.reactions.iter_mut().take(self.len).find(|slot| {
            slot.as_ref()
                .is_some_and(|existing| collision_reaction_authoring_key_eq(*existing, reaction))
        }) {
            *slot = Some(reaction);
            return true;
        }
        let Some(slot) = self.reactions.get_mut(self.len) else {
            return false;
        };
        *slot = Some(reaction);
        self.len += 1;
        true
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.len
    }

    #[cfg(test)]
    pub(crate) fn iter(&self) -> impl Iterator<Item = CollisionReaction> + '_ {
        self.reactions.iter().filter_map(|reaction| *reaction)
    }

    pub(crate) fn iter_mut(&mut self) -> impl Iterator<Item = &mut CollisionReaction> + '_ {
        self.reactions.iter_mut().filter_map(Option::as_mut)
    }

    pub(crate) fn tick_cooldowns(&mut self, delta: f32) {
        let delta = delta.max(0.0);
        if delta == 0.0 {
            return;
        }
        for reaction in self.iter_mut() {
            match reaction {
                CollisionReaction::PlaySound { cooldown, .. }
                | CollisionReaction::SpawnParticle { cooldown, .. }
                | CollisionReaction::CameraShake { cooldown, .. }
                | CollisionReaction::EmitEffect { cooldown, .. }
                | CollisionReaction::SpawnPrefab { cooldown, .. } => cooldown.tick(delta),
                CollisionReaction::Damage { .. }
                | CollisionReaction::AreaDamage { .. }
                | CollisionReaction::Knockback { .. }
                | CollisionReaction::Pickup { .. }
                | CollisionReaction::Despawn { .. } => {}
            }
        }
    }

    fn compact(&mut self) {
        self.len = compact_option_slots(&mut self.reactions);
    }
}

fn compact_option_slots<T: Copy, const N: usize>(slots: &mut [Option<T>; N]) -> usize {
    let mut compacted = [None; N];
    let mut len = 0;
    for value in slots.iter().filter_map(|slot| *slot) {
        compacted[len] = Some(value);
        len += 1;
    }
    *slots = compacted;
    len
}

fn collision_reaction_authoring_key_eq(a: CollisionReaction, b: CollisionReaction) -> bool {
    match (a, b) {
        (CollisionReaction::Damage { target: a }, CollisionReaction::Damage { target: b })
        | (CollisionReaction::Pickup { target: a }, CollisionReaction::Pickup { target: b })
        | (CollisionReaction::Despawn { target: a }, CollisionReaction::Despawn { target: b }) => {
            a == b
        }
        (
            CollisionReaction::AreaDamage {
                target_layer: a, ..
            },
            CollisionReaction::AreaDamage {
                target_layer: b, ..
            },
        ) => a == b,
        (
            CollisionReaction::Knockback { target: a, .. },
            CollisionReaction::Knockback { target: b, .. },
        ) => a == b,
        (
            CollisionReaction::EmitEffect {
                effect_id: a_effect,
                effect_type: a_type,
                target: a_target,
                ..
            },
            CollisionReaction::EmitEffect {
                effect_id: b_effect,
                effect_type: b_type,
                target: b_target,
                ..
            },
        ) => a_effect == b_effect && a_type == b_type && a_target == b_target,
        (
            CollisionReaction::SpawnPrefab {
                action_id: a_action,
                ..
            },
            CollisionReaction::SpawnPrefab {
                action_id: b_action,
                ..
            },
        ) => a_action == b_action,
        (
            CollisionReaction::PlaySound {
                sound_id: a_sound, ..
            },
            CollisionReaction::PlaySound {
                sound_id: b_sound, ..
            },
        ) => a_sound == b_sound,
        (
            CollisionReaction::SpawnParticle {
                preset_id: a_preset,
                target: a_target,
                ..
            },
            CollisionReaction::SpawnParticle {
                preset_id: b_preset,
                target: b_target,
                ..
            },
        ) => a_preset == b_preset && a_target == b_target,
        (CollisionReaction::CameraShake { .. }, CollisionReaction::CameraShake { .. }) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gameplay_faction_and_tag_ids_are_u32_mask_bounded() {
        assert_eq!(GAMEPLAY_FACTION_MAX_ID, u32::BITS - 1);
        assert_eq!(GAMEPLAY_TAG_MAX_ID, u32::BITS - 1);

        let max_faction_mask = 1_u32 << GAMEPLAY_FACTION_MAX_ID;
        let max_tag_mask = 1_u32 << GAMEPLAY_TAG_MAX_ID;
        let max_faction = GameplayFaction::new(GAMEPLAY_FACTION_MAX_ID, max_faction_mask)
            .expect("max faction id fits u32 mask storage");
        let max_tag = GameplayTags::new(max_tag_mask).expect("max tag id fits u32 mask storage");

        assert!(max_faction.can_damage(GameplayFaction::new(GAMEPLAY_FACTION_MAX_ID, 0).unwrap()));
        assert_eq!(
            gameplay_faction_mask(GAMEPLAY_FACTION_MAX_ID),
            max_faction_mask
        );
        assert_eq!(gameplay_faction_mask(GAMEPLAY_FACTION_MAX_ID + 1), 0);
        assert!(GameplayFaction::new(GAMEPLAY_FACTION_MAX_ID + 1, 0).is_none());

        assert!(max_tag.contains(GAMEPLAY_TAG_MAX_ID));
        assert!(!max_tag.contains(GAMEPLAY_TAG_MAX_ID + 1));
        assert_eq!(gameplay_tag_mask(GAMEPLAY_TAG_MAX_ID), max_tag_mask);
        assert_eq!(gameplay_tag_mask(GAMEPLAY_TAG_MAX_ID + 1), 0);
        assert!(GameplayTags::new(0).is_none());

        let mut relations = FactionRelationTable::default();
        assert!(relations.set_relation(
            GAMEPLAY_FACTION_MAX_ID,
            GAMEPLAY_FACTION_MAX_ID,
            FactionRelation::Hostile,
        ));
        assert_eq!(
            relations.relation(GAMEPLAY_FACTION_MAX_ID, GAMEPLAY_FACTION_MAX_ID),
            Some(FactionRelation::Hostile)
        );
        assert!(!relations.set_relation(
            GAMEPLAY_FACTION_MAX_ID + 1,
            GAMEPLAY_FACTION_MAX_ID,
            FactionRelation::Hostile,
        ));
        assert!(!relations.set_relation(
            GAMEPLAY_FACTION_MAX_ID,
            GAMEPLAY_FACTION_MAX_ID + 1,
            FactionRelation::Hostile,
        ));
        assert_eq!(
            relations.relation(GAMEPLAY_FACTION_MAX_ID + 1, GAMEPLAY_FACTION_MAX_ID),
            None
        );
    }

    #[test]
    fn collision_reaction_set_is_bounded_and_ordered() {
        let mut set = CollisionReactionSet::default();
        let reactions = (0..MAX_COLLISION_REACTIONS_PER_ENTITY)
            .map(|index| CollisionReaction::PlaySound {
                sound_id: index as u32 + 1,
                volume: 0.8,
                pitch: 1.1,
                cooldown: Cooldown::ready(0.0),
                replace_default: false,
                trigger: CollisionReactionTrigger::Contact,
            })
            .collect::<Vec<_>>();

        for reaction in reactions.iter().copied() {
            assert!(set.push(reaction));
        }
        assert!(set.push(CollisionReaction::PlaySound {
            sound_id: 1,
            volume: 0.8,
            pitch: 1.1,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        }));

        assert_eq!(set.len(), MAX_COLLISION_REACTIONS_PER_ENTITY);
        assert_eq!(set.iter().collect::<Vec<_>>(), reactions);
        assert!(!set.push(CollisionReaction::PlaySound {
            sound_id: MAX_COLLISION_REACTIONS_PER_ENTITY as u32 + 1,
            volume: 0.8,
            pitch: 1.1,
            cooldown: Cooldown::ready(0.0),
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        }));
    }

    #[test]
    fn collision_reaction_set_replaces_authoring_key_and_resets_cooldown_state() {
        let mut set = CollisionReactionSet::default();
        assert!(set.push(CollisionReaction::PlaySound {
            sound_id: 7,
            volume: 0.5,
            pitch: 1.0,
            cooldown: Cooldown {
                duration_seconds: 0.25,
                remaining_seconds: 0.2,
            },
            replace_default: false,
            trigger: CollisionReactionTrigger::Contact,
        }));
        assert!(set.push(CollisionReaction::PlaySound {
            sound_id: 7,
            volume: 0.75,
            pitch: 1.1,
            cooldown: Cooldown::ready(0.5),
            replace_default: true,
            trigger: CollisionReactionTrigger::Enter,
        }));

        assert_eq!(set.len(), 1);
        assert_eq!(
            set.iter().collect::<Vec<_>>(),
            vec![CollisionReaction::PlaySound {
                sound_id: 7,
                volume: 0.75,
                pitch: 1.1,
                cooldown: Cooldown::ready(0.5),
                replace_default: true,
                trigger: CollisionReactionTrigger::Enter,
            }]
        );
    }

    #[test]
    fn action_binding_set_is_bounded_ordered_and_replaces_by_action_id() {
        let mut set = ActionBindingSet::default();
        let bindings = (1..=MAX_ACTION_BINDINGS_PER_ENTITY as u32)
            .map(|action_id| {
                if action_id == 4 {
                    ActionBinding::spawn_prefab(
                        action_id,
                        0.4,
                        11,
                        SpawnAnchor::SelfEntity,
                        SpawnPhase::PrePhysics,
                        8.0,
                        -4.0,
                    )
                } else {
                    let value = action_id as f32;
                    ActionBinding::projectile(
                        action_id,
                        value * 0.1,
                        280.0 + value * 40.0,
                        value,
                        1.0 + value * 0.2,
                    )
                }
            })
            .collect::<Vec<_>>();

        for binding in bindings.iter().copied() {
            assert!(set.upsert(binding));
        }
        let replacement = ActionBinding::projectile(2, 0.25, 380.0, 2.5, 1.5);
        assert!(set.upsert(replacement));
        assert!(!set.upsert(ActionBinding::projectile(
            MAX_ACTION_BINDINGS_PER_ENTITY as u32 + 1,
            0.9,
            640.0,
            9.0,
            2.8,
        )));

        assert_eq!(set.len(), MAX_ACTION_BINDINGS_PER_ENTITY);
        let mut expected = bindings;
        expected[1] = replacement;
        assert_eq!(set.iter().collect::<Vec<_>>(), expected);
    }

    #[test]
    fn action_binding_set_ticks_and_triggers_cooldown() {
        let mut set = ActionBindingSet::default();
        let binding = ActionBinding::projectile(1, 0.25, 320.0, 1.0, 1.2);
        assert!(set.upsert(binding));

        assert_eq!(set.get(1), Some(binding));
        assert_eq!(set.commit_cooldown_if_ready(1), Some(binding));
        assert_eq!(set.commit_cooldown_if_ready(1), None);

        set.tick_cooldowns(0.1);
        assert_eq!(set.commit_cooldown_if_ready(1), None);

        set.tick_cooldowns(0.15);
        let triggered = set.commit_cooldown_if_ready(1).unwrap();
        assert_eq!(triggered.action_id, 1);
        assert_eq!(triggered.pattern, binding.pattern);
    }

    #[test]
    fn fixed_slot_sets_compact_sparse_slots_before_inserting() {
        let mut reactions = CollisionReactionSet::default();
        assert!(reactions.push(CollisionReaction::Damage {
            target: CollisionTarget::OtherEntity,
        }));
        assert!(reactions.push(CollisionReaction::Pickup {
            target: CollisionTarget::OtherEntity,
        }));
        reactions.reactions[0] = None;
        assert!(reactions.push(CollisionReaction::Despawn {
            target: CollisionTarget::OtherEntity,
        }));
        assert_eq!(
            reactions.iter().collect::<Vec<_>>(),
            vec![
                CollisionReaction::Pickup {
                    target: CollisionTarget::OtherEntity,
                },
                CollisionReaction::Despawn {
                    target: CollisionTarget::OtherEntity,
                },
            ]
        );
        assert_eq!(reactions.len(), 2);

        let mut bindings = ActionBindingSet::default();
        let first_binding = ActionBinding::projectile(1, 0.1, 320.0, 1.0, 1.2);
        let second_binding = ActionBinding::projectile(2, 0.2, 360.0, 2.0, 1.4);
        assert!(bindings.upsert(first_binding));
        assert!(bindings.upsert(second_binding));
        bindings.bindings[0] = None;
        let third_binding = ActionBinding::projectile(3, 0.3, 400.0, 3.0, 1.6);
        assert!(bindings.upsert(third_binding));
        assert_eq!(
            bindings.iter().collect::<Vec<_>>(),
            vec![second_binding, third_binding]
        );
        assert_eq!(bindings.len(), 2);

        let mut machine = BehaviorStateMachine::new(1);
        let first_transition = BehaviorStateTransition::new(1, 2, 10);
        let second_transition = BehaviorStateTransition::new(2, 3, 11);
        let third_transition = BehaviorStateTransition::new(3, 4, 12);
        assert!(machine.push_transition(first_transition));
        assert!(machine.push_transition(second_transition));
        machine.transitions[0] = None;
        assert!(machine.push_transition(third_transition));
        assert_eq!(
            machine.iter_transitions().collect::<Vec<_>>(),
            vec![second_transition, third_transition]
        );
        assert_eq!(machine.len(), 2);

        let mut enter_actions = BehaviorStateEnterActionSet::default();
        let first_action = BehaviorStateEnterAction::new(
            1,
            10,
            BehaviorStateEnterActionPhase::NextFramePrePhysics,
        );
        let second_action = BehaviorStateEnterAction::new(
            2,
            11,
            BehaviorStateEnterActionPhase::NextFramePrePhysics,
        );
        let third_action = BehaviorStateEnterAction::new(
            3,
            12,
            BehaviorStateEnterActionPhase::NextFramePrePhysics,
        );
        assert!(enter_actions.upsert(first_action));
        assert!(enter_actions.upsert(second_action));
        enter_actions.actions[0] = None;
        assert!(enter_actions.upsert(third_action));
        assert_eq!(
            enter_actions.iter_for_state(2).collect::<Vec<_>>(),
            vec![second_action]
        );
        assert_eq!(
            enter_actions.iter_for_state(3).collect::<Vec<_>>(),
            vec![third_action]
        );
        assert_eq!(enter_actions.len(), 2);
    }

    #[test]
    fn behavior_state_machine_transitions_are_bounded_and_ordered() {
        let mut machine = BehaviorStateMachine::new(1);
        let transitions = (0..MAX_BEHAVIOR_STATE_TRANSITIONS_PER_ENTITY)
            .map(|index| {
                BehaviorStateTransition::new(index as u32 + 1, index as u32 + 2, index as u32 + 10)
            })
            .collect::<Vec<_>>();

        for transition in transitions.iter().copied() {
            assert!(machine.push_transition(transition));
        }
        assert!(machine.push_transition(BehaviorStateTransition::new(1, 2, 10)));
        assert!(!machine.push_transition(BehaviorStateTransition::new(99, 100, 109)));

        assert_eq!(machine.current_state(), 1);
        machine.set_current_state(2);
        assert_eq!(machine.current_state(), 2);
        assert_eq!(machine.len(), MAX_BEHAVIOR_STATE_TRANSITIONS_PER_ENTITY);
        assert_eq!(machine.iter_transitions().collect::<Vec<_>>(), transitions);
    }

    #[test]
    fn behavior_state_enter_actions_are_bounded_and_filter_by_state() {
        let mut actions = BehaviorStateEnterActionSet::default();
        assert!(actions.is_empty());
        assert!(actions.upsert(BehaviorStateEnterAction::new(
            2,
            11,
            BehaviorStateEnterActionPhase::NextFramePrePhysics,
        )));
        assert!(actions.upsert(BehaviorStateEnterAction::new(
            2,
            11,
            BehaviorStateEnterActionPhase::NextFramePrePhysics,
        )));
        assert!(actions.upsert(BehaviorStateEnterAction::new(
            3,
            12,
            BehaviorStateEnterActionPhase::NextFramePrePhysics,
        )));
        assert_eq!(actions.len(), 2);
        assert_eq!(
            actions.iter_for_state(2).collect::<Vec<_>>(),
            vec![BehaviorStateEnterAction::new(
                2,
                11,
                BehaviorStateEnterActionPhase::NextFramePrePhysics,
            )]
        );

        for index in 0..(MAX_BEHAVIOR_STATE_ENTER_ACTIONS_PER_ENTITY - 2) {
            assert!(actions.upsert(BehaviorStateEnterAction::new(
                10 + index as u32,
                20,
                BehaviorStateEnterActionPhase::NextFramePrePhysics,
            )));
        }
        assert_eq!(actions.len(), MAX_BEHAVIOR_STATE_ENTER_ACTIONS_PER_ENTITY);
        assert!(!actions.upsert(BehaviorStateEnterAction::new(
            99,
            99,
            BehaviorStateEnterActionPhase::NextFramePrePhysics,
        )));
    }
}
