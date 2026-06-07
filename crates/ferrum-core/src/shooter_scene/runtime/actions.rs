use crate::entity::Entity;
use crate::gameplay::{
    apply_dash_action_core_data, collect_action_triggers_for_phase, commit_prepared_action,
    dash_action_core_data_from_plan, dash_action_plan_failure_reason,
    dispatch_prepared_action_trigger, melee_action_plan_failure_reason,
    melee_attack_core_data_from_plan, plan_dash_action_transform, plan_melee_action,
    prepare_action_trigger_for_dispatch, projectile_action_plan_failure_reason,
    push_action_failure_event, push_action_trigger_failure_event,
    tick_gameplay_timer_trigger_for_dispatch, validate_projectile_action_support,
    validate_queued_melee_action_support, ActionAttemptFailurePolicy, ActionFailureEventData,
    ActionTriggerCommand, ActionTriggerPhase, ActionTriggerPreparation, DashActionPayload,
    MeleeActionPayload, PreparedAction, PreparedActionTriggerDispatcher, ProjectileActionPayload,
    SpawnPrefabActionPayload,
};
#[cfg(test)]
use crate::gameplay::{
    prepare_action_if_ready, prepare_input_action_if_ready, ActionPatternKind, ActionReadiness,
    FrameInputSnapshot, InputActionTrigger,
};
use crate::gameplay_event::{
    GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE, GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
    GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
};
#[cfg(test)]
use crate::input::{InputActionRegistry, InputState};
use crate::tilemap::Tilemap;
use crate::world::World;

use super::super::ShooterScene;
use super::GameplayEventSink;

#[cfg(test)]
pub(in crate::shooter_scene) const MAX_PENDING_ACTION_TRIGGERS: usize = 64;
const ACTION_TRIGGER_FAILURE_REASON_BUCKETS: usize =
    GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE as usize + 1;

struct ShooterActionTriggerDispatchContext<'a, 'events> {
    scene: &'a mut ShooterScene,
    world: &'a mut World,
    tilemap: &'a Tilemap,
    gameplay_events: Option<&'a mut GameplayEventSink<'events>>,
    branch_result: Option<PreparedActionTriggerBranchResult>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(in crate::shooter_scene) struct ActionTriggerPhaseProcessResult {
    pub(in crate::shooter_scene) triggers_collected: usize,
    pub(in crate::shooter_scene) triggers_processed: usize,
    pub(in crate::shooter_scene) prepared_dispatch_attempts: usize,
    pub(in crate::shooter_scene) prepared_dispatch_successes: usize,
    pub(in crate::shooter_scene) prepared_dispatch_failures: usize,
    pub(in crate::shooter_scene) prepared_dispatch_failure_events_pushed: usize,
    pub(in crate::shooter_scene) prepared_dispatch_commit_skips: usize,
    pub(in crate::shooter_scene) last_prepared_dispatch_failure_reason_code: Option<u32>,
    pub(in crate::shooter_scene) action_failure_reason_counts:
        [usize; ACTION_TRIGGER_FAILURE_REASON_BUCKETS],
    pub(in crate::shooter_scene) preparation_failures: usize,
    pub(in crate::shooter_scene) preparation_failure_events_pushed: usize,
    pub(in crate::shooter_scene) noops: usize,
}

impl ActionTriggerPhaseProcessResult {
    pub(in crate::shooter_scene) fn accumulate(&mut self, other: Self) {
        self.triggers_collected = self
            .triggers_collected
            .saturating_add(other.triggers_collected);
        self.triggers_processed = self
            .triggers_processed
            .saturating_add(other.triggers_processed);
        self.prepared_dispatch_attempts = self
            .prepared_dispatch_attempts
            .saturating_add(other.prepared_dispatch_attempts);
        self.prepared_dispatch_successes = self
            .prepared_dispatch_successes
            .saturating_add(other.prepared_dispatch_successes);
        self.prepared_dispatch_failures = self
            .prepared_dispatch_failures
            .saturating_add(other.prepared_dispatch_failures);
        self.prepared_dispatch_failure_events_pushed = self
            .prepared_dispatch_failure_events_pushed
            .saturating_add(other.prepared_dispatch_failure_events_pushed);
        self.prepared_dispatch_commit_skips = self
            .prepared_dispatch_commit_skips
            .saturating_add(other.prepared_dispatch_commit_skips);
        if other.last_prepared_dispatch_failure_reason_code.is_some() {
            self.last_prepared_dispatch_failure_reason_code =
                other.last_prepared_dispatch_failure_reason_code;
        }
        for (count, other_count) in self
            .action_failure_reason_counts
            .iter_mut()
            .zip(other.action_failure_reason_counts)
        {
            *count = count.saturating_add(other_count);
        }
        self.preparation_failures = self
            .preparation_failures
            .saturating_add(other.preparation_failures);
        self.preparation_failure_events_pushed = self
            .preparation_failure_events_pushed
            .saturating_add(other.preparation_failure_events_pushed);
        self.noops = self.noops.saturating_add(other.noops);
    }

    pub(in crate::shooter_scene) fn action_failure_count_for_reason(
        &self,
        reason_code: u32,
    ) -> usize {
        self.action_failure_reason_counts
            .get(reason_code as usize)
            .copied()
            .unwrap_or(0)
    }

    fn record_action_failure_reason(&mut self, reason_code: u32) {
        if let Some(count) = self
            .action_failure_reason_counts
            .get_mut(reason_code as usize)
        {
            *count = count.saturating_add(1);
        }
    }

    fn record_trigger(&mut self, result: ActionTriggerProcessResult) {
        self.triggers_processed = self.triggers_processed.saturating_add(1);
        match result {
            ActionTriggerProcessResult::PreparedDispatchAttempted { branch } => {
                self.prepared_dispatch_attempts = self.prepared_dispatch_attempts.saturating_add(1);
                if branch.effect_committed() {
                    self.prepared_dispatch_successes =
                        self.prepared_dispatch_successes.saturating_add(1);
                }
                if branch.commit_skipped() {
                    self.prepared_dispatch_commit_skips =
                        self.prepared_dispatch_commit_skips.saturating_add(1);
                }
                if let Some(reason_code) = branch.failure_reason_code() {
                    self.prepared_dispatch_failures =
                        self.prepared_dispatch_failures.saturating_add(1);
                    self.last_prepared_dispatch_failure_reason_code = Some(reason_code);
                    self.record_action_failure_reason(reason_code);
                    if branch.failure_event_pushed() {
                        self.prepared_dispatch_failure_events_pushed = self
                            .prepared_dispatch_failure_events_pushed
                            .saturating_add(1);
                    }
                }
            }
            ActionTriggerProcessResult::PreparationFailure {
                reason_code,
                event_pushed,
            } => {
                self.preparation_failures = self.preparation_failures.saturating_add(1);
                self.record_action_failure_reason(reason_code);
                if event_pushed {
                    self.preparation_failure_events_pushed =
                        self.preparation_failure_events_pushed.saturating_add(1);
                }
            }
            ActionTriggerProcessResult::Noop => {
                self.noops = self.noops.saturating_add(1);
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActionTriggerProcessResult {
    PreparedDispatchAttempted {
        branch: PreparedActionTriggerBranchResult,
    },
    PreparationFailure {
        reason_code: u32,
        event_pushed: bool,
    },
    Noop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreparedActionTriggerBranchResult {
    Dash(DashActionTriggerProcessResult),
    Melee(MeleeActionTriggerProcessResult),
    Projectile(ProjectileActionTriggerProcessResult),
    SpawnPrefab(SpawnPrefabActionTriggerProcessResult),
}

impl PreparedActionTriggerBranchResult {
    const fn effect_committed(self) -> bool {
        match self {
            Self::Dash(result) => result.dash_applied,
            Self::Melee(result) => result.melee_queued,
            Self::Projectile(result) => result.projectile_queued,
            Self::SpawnPrefab(result) => result.prefab_queued,
        }
    }

    const fn failure_reason_code(self) -> Option<u32> {
        match self {
            Self::Dash(result) => result.failure_reason_code,
            Self::Melee(result) => result.failure_reason_code,
            Self::Projectile(result) => result.failure_reason_code,
            Self::SpawnPrefab(result) => result.failure_reason_code,
        }
    }

    const fn failure_event_pushed(self) -> bool {
        match self {
            Self::Dash(result) => result.failure_event_pushed,
            Self::Melee(result) => result.failure_event_pushed,
            Self::Projectile(result) => result.failure_event_pushed,
            Self::SpawnPrefab(result) => result.failure_event_pushed,
        }
    }

    const fn commit_skipped(self) -> bool {
        match self {
            Self::Dash(result) => {
                result.plan_succeeded
                    && !result.commit_succeeded
                    && result.failure_reason_code.is_none()
            }
            Self::Melee(result) => {
                result.plan_succeeded
                    && !result.commit_succeeded
                    && result.failure_reason_code.is_none()
            }
            Self::Projectile(result) => {
                result.plan_succeeded
                    && !result.commit_succeeded
                    && result.failure_reason_code.is_none()
            }
            Self::SpawnPrefab(result) => {
                result.plan_succeeded
                    && !result.commit_succeeded
                    && result.failure_reason_code.is_none()
            }
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct DashActionTriggerProcessResult {
    plan_succeeded: bool,
    commit_succeeded: bool,
    dash_applied: bool,
    failure_event_pushed: bool,
    failure_reason_code: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct MeleeActionTriggerProcessResult {
    plan_succeeded: bool,
    commit_succeeded: bool,
    melee_queued: bool,
    failure_event_pushed: bool,
    failure_reason_code: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct ProjectileActionTriggerProcessResult {
    plan_succeeded: bool,
    commit_succeeded: bool,
    projectile_queued: bool,
    failure_event_pushed: bool,
    failure_reason_code: Option<u32>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
struct SpawnPrefabActionTriggerProcessResult {
    plan_succeeded: bool,
    commit_succeeded: bool,
    prefab_queued: bool,
    failure_event_pushed: bool,
    failure_reason_code: Option<u32>,
}

impl PreparedActionTriggerDispatcher for ShooterActionTriggerDispatchContext<'_, '_> {
    fn dispatch_projectile_action_trigger(
        &mut self,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: ProjectileActionPayload,
    ) {
        let result = self.scene.process_projectile_trigger(
            self.world,
            trigger,
            prepared,
            payload,
            self.gameplay_events.as_deref_mut(),
        );
        self.branch_result = Some(PreparedActionTriggerBranchResult::Projectile(result));
    }

    fn dispatch_dash_action_trigger(
        &mut self,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: DashActionPayload,
    ) {
        let result = self.scene.process_dash_trigger(
            self.world,
            trigger,
            prepared,
            payload,
            self.gameplay_events.as_deref_mut(),
        );
        self.branch_result = Some(PreparedActionTriggerBranchResult::Dash(result));
    }

    fn dispatch_melee_action_trigger(
        &mut self,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: MeleeActionPayload,
    ) {
        let result = self.scene.process_melee_trigger(
            self.world,
            trigger,
            prepared,
            payload,
            self.gameplay_events.as_deref_mut(),
        );
        self.branch_result = Some(PreparedActionTriggerBranchResult::Melee(result));
    }

    fn dispatch_spawn_prefab_action_trigger(
        &mut self,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: SpawnPrefabActionPayload,
    ) {
        let result = self.scene.process_spawn_prefab_trigger(
            self.world,
            self.tilemap,
            trigger,
            prepared,
            payload,
            self.gameplay_events.as_deref_mut(),
        );
        self.branch_result = Some(PreparedActionTriggerBranchResult::SpawnPrefab(result));
    }
}

pub(in crate::shooter_scene) fn commit_prepared_input_action(
    world: &mut World,
    prepared: PreparedAction,
) -> bool {
    commit_prepared_action(world, prepared)
}

impl ShooterScene {
    pub(in crate::shooter_scene) fn tick_gameplay_timer_action_triggers(
        &mut self,
        world: &mut World,
        delta_seconds: f32,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) {
        if delta_seconds <= 0.0
            || !delta_seconds.is_finite()
            || !world.gameplay_timer_triggers.iter().any(Option::is_some)
        {
            return;
        }

        let alive_count = world.alive_indices().len();
        for alive_position in 0..alive_count {
            let index = world.alive_indices()[alive_position];
            let Some(timer) = world.gameplay_timer_triggers[index].as_mut() else {
                continue;
            };
            let source = Entity {
                id: index as u32,
                generation: world.generations[index],
            };
            let Some(dispatch) =
                tick_gameplay_timer_trigger_for_dispatch(source, timer, delta_seconds)
            else {
                continue;
            };
            if let Some(events) = &mut gameplay_events {
                events.push_timer_dispatch(dispatch);
            }
            let Some(action_trigger) = dispatch.action_trigger() else {
                continue;
            };
            if let Err(data) = self.action_triggers.queue_action_trigger(action_trigger) {
                push_action_failure_event(gameplay_events.as_deref_mut(), data);
            }
        }
    }

    #[cfg(test)]
    pub(crate) fn queue_action_trigger(&mut self, command: ActionTriggerCommand) -> bool {
        self.action_triggers.queue(command)
    }

    pub(crate) fn queue_action_trigger_result(
        &mut self,
        command: ActionTriggerCommand,
    ) -> Result<(), ActionFailureEventData> {
        self.action_triggers.queue_action_trigger(command)
    }

    pub(in crate::shooter_scene) fn process_action_triggers(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> ActionTriggerPhaseProcessResult {
        let trigger_count = collect_action_triggers_for_phase(
            &mut self.action_triggers,
            ActionTriggerPhase::PrePhysics,
            &mut self.action_trigger_commands,
        );
        let mut result = ActionTriggerPhaseProcessResult {
            triggers_collected: trigger_count,
            ..ActionTriggerPhaseProcessResult::default()
        };
        for trigger_index in 0..trigger_count {
            let trigger = self.action_trigger_commands[trigger_index];
            let trigger_result = self.process_action_trigger(
                world,
                tilemap,
                trigger,
                gameplay_events.as_deref_mut(),
            );
            result.record_trigger(trigger_result);
        }
        self.action_trigger_commands.clear();
        result
    }

    fn process_action_trigger(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        trigger: ActionTriggerCommand,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> ActionTriggerProcessResult {
        let prepared_trigger = match prepare_action_trigger_for_dispatch(
            world,
            trigger,
            ActionAttemptFailurePolicy::ReportGenericReadinessFailures,
        ) {
            ActionTriggerPreparation::Ready(prepared_trigger) => prepared_trigger,
            ActionTriggerPreparation::Failure(data) => {
                let event_pushed = gameplay_events.is_some();
                push_action_failure_event(gameplay_events.as_deref_mut(), data);
                return ActionTriggerProcessResult::PreparationFailure {
                    reason_code: data.reason_code,
                    event_pushed,
                };
            }
            ActionTriggerPreparation::Noop => return ActionTriggerProcessResult::Noop,
        };

        let mut dispatch_context = ShooterActionTriggerDispatchContext {
            scene: self,
            world,
            tilemap,
            gameplay_events,
            branch_result: None,
        };
        dispatch_prepared_action_trigger(&mut dispatch_context, prepared_trigger);
        let Some(branch) = dispatch_context.branch_result else {
            return ActionTriggerProcessResult::Noop;
        };
        ActionTriggerProcessResult::PreparedDispatchAttempted { branch }
    }

    fn process_melee_trigger(
        &mut self,
        world: &mut World,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: MeleeActionPayload,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> MeleeActionTriggerProcessResult {
        if let Err(error) = validate_queued_melee_action_support(payload) {
            let reason_code = melee_action_plan_failure_reason(error);
            let failure_event_pushed = gameplay_events.is_some();
            push_action_trigger_failure_event(gameplay_events.as_deref_mut(), trigger, reason_code);
            return MeleeActionTriggerProcessResult {
                failure_event_pushed,
                failure_reason_code: Some(reason_code),
                ..MeleeActionTriggerProcessResult::default()
            };
        }
        let Some(source_t) = world.transform(trigger.source) else {
            let failure_event_pushed = gameplay_events.is_some();
            push_action_trigger_failure_event(
                gameplay_events.as_deref_mut(),
                trigger,
                GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
            );
            return MeleeActionTriggerProcessResult {
                failure_event_pushed,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM),
                ..MeleeActionTriggerProcessResult::default()
            };
        };
        let plan = match plan_melee_action(payload, trigger.source, source_t, world.player_entity())
        {
            Ok(plan) => plan,
            Err(error) => {
                let reason_code = melee_action_plan_failure_reason(error);
                let failure_event_pushed = gameplay_events.is_some();
                push_action_trigger_failure_event(gameplay_events, trigger, reason_code);
                return MeleeActionTriggerProcessResult {
                    failure_event_pushed,
                    failure_reason_code: Some(reason_code),
                    ..MeleeActionTriggerProcessResult::default()
                };
            }
        };
        let core_data = melee_attack_core_data_from_plan(
            prepared.entity,
            plan,
            world.height_span(prepared.entity),
        );
        let melee_queued = if commit_prepared_action(world, prepared) {
            self.queue_melee_attack(core_data);
            true
        } else {
            false
        };
        MeleeActionTriggerProcessResult {
            plan_succeeded: true,
            commit_succeeded: melee_queued,
            melee_queued,
            failure_event_pushed: false,
            failure_reason_code: None,
        }
    }

    fn process_projectile_trigger(
        &mut self,
        world: &mut World,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: ProjectileActionPayload,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> ProjectileActionTriggerProcessResult {
        if let Err(error) = validate_projectile_action_support(payload) {
            let reason_code = projectile_action_plan_failure_reason(error);
            let failure_event_pushed = gameplay_events.is_some();
            push_action_trigger_failure_event(gameplay_events.as_deref_mut(), trigger, reason_code);
            return ProjectileActionTriggerProcessResult {
                failure_event_pushed,
                failure_reason_code: Some(reason_code),
                ..ProjectileActionTriggerProcessResult::default()
            };
        }
        let command =
            match self.projectile_spawn_command_toward_player(world, trigger.source, payload) {
                Ok(command) => command,
                Err(reason_code) => {
                    let failure_event_pushed = gameplay_events.is_some();
                    push_action_trigger_failure_event(
                        gameplay_events.as_deref_mut(),
                        trigger,
                        reason_code,
                    );
                    return ProjectileActionTriggerProcessResult {
                        failure_event_pushed,
                        failure_reason_code: Some(reason_code),
                        ..ProjectileActionTriggerProcessResult::default()
                    };
                }
            };
        let projectile_queued = match self
            .commit_projectile_spawn_with_pre_commit_gate(command, || {
                commit_prepared_action(world, prepared)
            }) {
            Ok(projectile_queued) => projectile_queued,
            Err(reason_code) => {
                debug_assert_eq!(reason_code, GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL);
                let failure_event_pushed = gameplay_events.is_some();
                push_action_trigger_failure_event(gameplay_events, trigger, reason_code);
                return ProjectileActionTriggerProcessResult {
                    plan_succeeded: true,
                    failure_event_pushed,
                    failure_reason_code: Some(reason_code),
                    ..ProjectileActionTriggerProcessResult::default()
                };
            }
        };
        ProjectileActionTriggerProcessResult {
            plan_succeeded: true,
            commit_succeeded: projectile_queued,
            projectile_queued,
            failure_event_pushed: false,
            failure_reason_code: None,
        }
    }

    fn process_dash_trigger(
        &self,
        world: &mut World,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: DashActionPayload,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> DashActionTriggerProcessResult {
        let Some(source_t) = world.transform(trigger.source) else {
            let failure_event_pushed = gameplay_events.is_some();
            push_action_trigger_failure_event(
                gameplay_events.as_deref_mut(),
                trigger,
                GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
            );
            return DashActionTriggerProcessResult {
                failure_event_pushed,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM),
                ..DashActionTriggerProcessResult::default()
            };
        };
        let target = world
            .player_entity()
            .and_then(|player| world.transform(player).map(|transform| (player, transform)));
        let planned_transform =
            match plan_dash_action_transform(payload, trigger.source, source_t, target) {
                Ok(planned_transform) => planned_transform,
                Err(error) => {
                    let reason_code = dash_action_plan_failure_reason(error);
                    let failure_event_pushed = gameplay_events.is_some();
                    push_action_trigger_failure_event(gameplay_events, trigger, reason_code);
                    return DashActionTriggerProcessResult {
                        failure_event_pushed,
                        failure_reason_code: Some(reason_code),
                        ..DashActionTriggerProcessResult::default()
                    };
                }
            };
        let dash_data = dash_action_core_data_from_plan(prepared.entity, planned_transform);
        let dash_applied = if commit_prepared_action(world, prepared) {
            apply_dash_action_core_data(world, dash_data);
            true
        } else {
            false
        };
        DashActionTriggerProcessResult {
            plan_succeeded: true,
            commit_succeeded: dash_applied,
            dash_applied,
            failure_event_pushed: false,
            failure_reason_code: None,
        }
    }

    fn process_spawn_prefab_trigger(
        &mut self,
        world: &mut World,
        tilemap: &Tilemap,
        trigger: ActionTriggerCommand,
        prepared: PreparedAction,
        payload: SpawnPrefabActionPayload,
        mut gameplay_events: Option<&mut GameplayEventSink<'_>>,
    ) -> SpawnPrefabActionTriggerProcessResult {
        let command =
            match self.spawn_prefab_command(world, trigger.source, trigger.action_id, payload) {
                Ok(command) => command,
                Err(reason_code) => {
                    let failure_event_pushed = gameplay_events.is_some();
                    push_action_trigger_failure_event(
                        gameplay_events.as_deref_mut(),
                        trigger,
                        reason_code,
                    );
                    return SpawnPrefabActionTriggerProcessResult {
                        failure_event_pushed,
                        failure_reason_code: Some(reason_code),
                        ..SpawnPrefabActionTriggerProcessResult::default()
                    };
                }
            };
        let prefab_queued =
            match self.commit_prefab_spawn_with_pre_commit_gate(tilemap, command, || {
                commit_prepared_action(world, prepared)
            }) {
                Ok(prefab_queued) => prefab_queued,
                Err(reason_code) => {
                    let failure_event_pushed = gameplay_events.is_some();
                    push_action_trigger_failure_event(gameplay_events, trigger, reason_code);
                    return SpawnPrefabActionTriggerProcessResult {
                        plan_succeeded: true,
                        failure_event_pushed,
                        failure_reason_code: Some(reason_code),
                        ..SpawnPrefabActionTriggerProcessResult::default()
                    };
                }
            };
        SpawnPrefabActionTriggerProcessResult {
            plan_succeeded: true,
            commit_succeeded: prefab_queued,
            prefab_queued,
            failure_event_pushed: false,
            failure_reason_code: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::components::gameplay::{
        ActionAimSource, ActionBinding, GameplayFaction, MeleeTarget, ProjectileActionConfig,
        ProjectileCollisionTarget, ProjectileTileImpact, SpawnAnchor, SpawnPhase,
        GAMEPLAY_FACTION_ENEMY, GAMEPLAY_FACTION_PLAYER,
    };
    use crate::components::{CollisionLayer, HeightSpan, PhysicsFloorId, Transform2D, Velocity};
    use crate::game_state::GameState;
    use crate::gameplay::action_trigger_queue_full_event_data;
    use crate::gameplay_event::{
        GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT, GAMEPLAY_ACTION_FAILURE_COOLING_DOWN,
        GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE, GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
        GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET, GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
        GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
        GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE, GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
    };
    use crate::input::{INPUT_ACTION_ACTIVATION_PRESSED, INPUT_ACTION_CONTROL_ENTER};
    use crate::shooter_scene::ShooterScene;
    use crate::tilemap::Tilemap;

    fn empty_action_failure_reason_counts() -> [usize; ACTION_TRIGGER_FAILURE_REASON_BUCKETS] {
        [0; ACTION_TRIGGER_FAILURE_REASON_BUCKETS]
    }

    fn action_failure_reason_counts_with(
        reason_code: u32,
        count: usize,
    ) -> [usize; ACTION_TRIGGER_FAILURE_REASON_BUCKETS] {
        action_failure_reason_counts_with_many(&[(reason_code, count)])
    }

    fn action_failure_reason_counts_with_many(
        entries: &[(u32, usize)],
    ) -> [usize; ACTION_TRIGGER_FAILURE_REASON_BUCKETS] {
        let mut counts = empty_action_failure_reason_counts();
        for (reason_code, count) in entries {
            counts[*reason_code as usize] = *count;
        }
        counts
    }

    fn enter_pressed_registry(action_id: u32) -> InputActionRegistry {
        let mut input_actions = InputActionRegistry::empty();
        assert!(input_actions.set_binding(
            action_id,
            0,
            INPUT_ACTION_CONTROL_ENTER,
            INPUT_ACTION_ACTIVATION_PRESSED,
        ));
        input_actions
    }

    #[test]
    fn action_trigger_failure_reason_buckets_cover_known_reason_codes() {
        let known_reason_codes = [
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_ANCHOR,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PHASE,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
            GAMEPLAY_ACTION_FAILURE_PATTERN_MISMATCH,
            GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
            GAMEPLAY_ACTION_FAILURE_COOLING_DOWN,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
        ];

        assert_eq!(
            GAMEPLAY_ACTION_FAILURE_MAX_REASON_CODE,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET
        );
        assert!(known_reason_codes
            .iter()
            .all(|reason_code| (*reason_code as usize) < ACTION_TRIGGER_FAILURE_REASON_BUCKETS));
    }

    #[test]
    fn prepare_authored_action_reports_missing_and_pattern_mismatch_without_consuming() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let input_actions = enter_pressed_registry(1);
        let input = InputState {
            enter: 1,
            ..InputState::default()
        };

        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(input, InputState::default()),
                player,
                1,
                ActionPatternKind::Projectile,
            ),
            InputActionTrigger::Missing,
        );
        assert!(world.upsert_action_binding(player, ActionBinding::dash(1, 0.5, 96.0)));

        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(input, InputState::default()),
                player,
                1,
                ActionPatternKind::Projectile,
            ),
            InputActionTrigger::PatternMismatch,
        );
        assert_eq!(
            world.action_binding(player, 1),
            Some(ActionBinding::dash(1, 0.5, 96.0)),
        );
    }

    #[test]
    fn prepare_action_if_ready_is_independent_from_input_state() {
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::spawn_prefab(
            11,
            0.5,
            1,
            crate::components::gameplay::SpawnAnchor::SelfEntity,
            crate::components::gameplay::SpawnPhase::PrePhysics,
            16.0,
            0.0,
        );
        assert!(world.upsert_action_binding(source, action));

        assert_eq!(
            prepare_action_if_ready(&world, source, 11, ActionPatternKind::SpawnPrefab),
            ActionReadiness::Ready(PreparedAction::new(
                source,
                11,
                ActionPatternKind::SpawnPrefab,
                action,
            )),
        );
        assert!(commit_prepared_action(
            &mut world,
            PreparedAction::new(source, 11, ActionPatternKind::SpawnPrefab, action)
        ));
        assert_eq!(
            prepare_action_if_ready(&world, source, 11, ActionPatternKind::SpawnPrefab),
            ActionReadiness::CoolingDown,
        );
        assert_eq!(
            prepare_action_if_ready(&world, source, 11, ActionPatternKind::Projectile),
            ActionReadiness::PatternMismatch,
        );
    }

    #[test]
    fn action_trigger_queue_is_bounded_ordered_and_frame_local() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        let mut expected_action_ids = Vec::new();
        for index in 0..MAX_PENDING_ACTION_TRIGGERS {
            let action_id = 11 + index as u32;
            expected_action_ids.push(action_id);
            assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, action_id)));
        }
        assert!(!scene.queue_action_trigger(ActionTriggerCommand::timer(source, 999)));
        assert_eq!(
            scene.action_triggers.pending_len(),
            MAX_PENDING_ACTION_TRIGGERS
        );

        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        let result =
            scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(
            result,
            ActionTriggerPhaseProcessResult {
                triggers_collected: MAX_PENDING_ACTION_TRIGGERS,
                triggers_processed: MAX_PENDING_ACTION_TRIGGERS,
                prepared_dispatch_attempts: 0,
                prepared_dispatch_successes: 0,
                prepared_dispatch_failures: 0,
                prepared_dispatch_failure_events_pushed: 0,
                prepared_dispatch_commit_skips: 0,
                last_prepared_dispatch_failure_reason_code: None,
                action_failure_reason_counts: action_failure_reason_counts_with(
                    GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
                    MAX_PENDING_ACTION_TRIGGERS,
                ),
                preparation_failures: MAX_PENDING_ACTION_TRIGGERS,
                preparation_failure_events_pushed: MAX_PENDING_ACTION_TRIGGERS,
                noops: 0,
            }
        );
        assert_eq!(scene.action_triggers.pending_len(), 0);
        assert!(scene.action_triggers.pending_capacity() >= MAX_PENDING_ACTION_TRIGGERS);
        assert!(scene.action_triggers.processing_capacity() >= MAX_PENDING_ACTION_TRIGGERS);
        assert_eq!(events.len(), MAX_PENDING_ACTION_TRIGGERS);
        assert_eq!(
            events
                .iter()
                .map(|event| event.token_id)
                .collect::<Vec<_>>(),
            expected_action_ids
        );
        assert!(events
            .iter()
            .all(|event| event.payload_bits == GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING));
    }

    #[test]
    fn action_trigger_phase_result_reports_unpushed_preparation_failures_without_event_sink() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 11)));

        let result = scene.process_action_triggers(&mut world, &Tilemap::default(), None);

        assert_eq!(
            result,
            ActionTriggerPhaseProcessResult {
                triggers_collected: 1,
                triggers_processed: 1,
                prepared_dispatch_attempts: 0,
                prepared_dispatch_successes: 0,
                prepared_dispatch_failures: 0,
                prepared_dispatch_failure_events_pushed: 0,
                prepared_dispatch_commit_skips: 0,
                last_prepared_dispatch_failure_reason_code: None,
                action_failure_reason_counts: action_failure_reason_counts_with(
                    GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING,
                    1,
                ),
                preparation_failures: 1,
                preparation_failure_events_pushed: 0,
                noops: 0,
            }
        );
        assert_eq!(scene.action_triggers.pending_len(), 0);
    }

    #[test]
    fn action_trigger_phase_result_reports_unpushed_branch_failures_without_event_sink() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(source, ActionBinding::dash(21, 0.5, 40.0)));
        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 21)));

        let result = scene.process_action_triggers(&mut world, &Tilemap::default(), None);

        assert_eq!(
            result,
            ActionTriggerPhaseProcessResult {
                triggers_collected: 1,
                triggers_processed: 1,
                prepared_dispatch_attempts: 1,
                prepared_dispatch_successes: 0,
                prepared_dispatch_failures: 1,
                prepared_dispatch_failure_events_pushed: 0,
                prepared_dispatch_commit_skips: 0,
                last_prepared_dispatch_failure_reason_code: Some(
                    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM
                ),
                action_failure_reason_counts: action_failure_reason_counts_with(
                    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
                    1,
                ),
                preparation_failures: 0,
                preparation_failure_events_pushed: 0,
                noops: 0,
            }
        );
        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
        assert_eq!(scene.action_triggers.pending_len(), 0);
    }

    #[test]
    fn action_trigger_phase_result_counts_mixed_preparation_and_branch_failure_reasons() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let missing_binding_source = world.spawn_entity();
        let branch_failure_source = world.spawn_entity();
        assert!(
            world.upsert_action_binding(branch_failure_source, ActionBinding::dash(21, 0.5, 40.0))
        );
        assert!(
            scene.queue_action_trigger(ActionTriggerCommand::timer(missing_binding_source, 11,))
        );
        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(branch_failure_source, 21,)));

        let result = scene.process_action_triggers(&mut world, &Tilemap::default(), None);

        assert_eq!(
            result,
            ActionTriggerPhaseProcessResult {
                triggers_collected: 2,
                triggers_processed: 2,
                prepared_dispatch_attempts: 1,
                prepared_dispatch_successes: 0,
                prepared_dispatch_failures: 1,
                prepared_dispatch_failure_events_pushed: 0,
                prepared_dispatch_commit_skips: 0,
                last_prepared_dispatch_failure_reason_code: Some(
                    GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM
                ),
                action_failure_reason_counts: action_failure_reason_counts_with_many(&[
                    (GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING, 1),
                    (GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM, 1),
                ]),
                preparation_failures: 1,
                preparation_failure_events_pushed: 0,
                noops: 0,
            }
        );
        assert_eq!(
            result.action_failure_count_for_reason(GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_BINDING),
            1
        );
        assert_eq!(
            result
                .action_failure_count_for_reason(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM),
            1
        );
        assert_eq!(
            world
                .action_binding(branch_failure_source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
        assert_eq!(scene.action_triggers.pending_len(), 0);
    }

    #[test]
    fn action_trigger_phase_result_records_branch_failure_reason_and_commit_skip() {
        let mut result = ActionTriggerPhaseProcessResult::default();

        result.record_trigger(ActionTriggerProcessResult::PreparedDispatchAttempted {
            branch: PreparedActionTriggerBranchResult::SpawnPrefab(
                SpawnPrefabActionTriggerProcessResult {
                    plan_succeeded: true,
                    commit_succeeded: false,
                    prefab_queued: false,
                    failure_event_pushed: true,
                    failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT),
                },
            ),
        });
        result.record_trigger(ActionTriggerProcessResult::PreparedDispatchAttempted {
            branch: PreparedActionTriggerBranchResult::Dash(DashActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: false,
                dash_applied: false,
                failure_event_pushed: false,
                failure_reason_code: None,
            }),
        });
        result.record_trigger(ActionTriggerProcessResult::PreparationFailure {
            reason_code: GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
            event_pushed: false,
        });

        assert_eq!(
            result,
            ActionTriggerPhaseProcessResult {
                triggers_collected: 0,
                triggers_processed: 3,
                prepared_dispatch_attempts: 2,
                prepared_dispatch_successes: 0,
                prepared_dispatch_failures: 1,
                prepared_dispatch_failure_events_pushed: 1,
                prepared_dispatch_commit_skips: 1,
                last_prepared_dispatch_failure_reason_code: Some(
                    GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT
                ),
                action_failure_reason_counts: action_failure_reason_counts_with_many(&[
                    (GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT, 1),
                    (GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE, 1),
                ]),
                preparation_failures: 1,
                preparation_failure_events_pushed: 0,
                noops: 0,
            }
        );
        assert_eq!(
            result.action_failure_count_for_reason(GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT),
            1
        );
        assert_eq!(
            result.action_failure_count_for_reason(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE),
            1
        );
    }

    #[test]
    fn scene_queue_action_trigger_result_returns_failure_data_when_full() {
        let mut scene = ShooterScene::new();
        let source = Entity {
            id: 3,
            generation: 4,
        };
        for _ in 0..MAX_PENDING_ACTION_TRIGGERS {
            assert_eq!(
                scene.queue_action_trigger_result(ActionTriggerCommand::timer(source, 11)),
                Ok(())
            );
        }

        let rejected = ActionTriggerCommand::behavior_state_enter(source, 12);
        assert_eq!(
            scene.queue_action_trigger_result(rejected),
            Err(action_trigger_queue_full_event_data(rejected)),
        );
    }

    #[test]
    fn action_trigger_cooling_down_reports_generic_readiness_failure_reason() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(source, ActionBinding::dash(21, 0.5, 40.0)));
        assert!(world.commit_action_cooldown_if_ready(source, 21).is_some());

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 21)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].token_id, 21);
        assert_eq!(events[0].payload_bits, GAMEPLAY_ACTION_FAILURE_COOLING_DOWN);
    }

    #[test]
    fn action_trigger_spawn_prefab_missing_source_transform_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::spawn_prefab(
                51,
                0.5,
                1,
                SpawnAnchor::SelfEntity,
                SpawnPhase::PrePhysics,
                16.0,
                -4.0,
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 51)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
    }

    #[test]
    fn action_trigger_spawn_prefab_unsupported_prefab_takes_precedence_over_missing_source() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::spawn_prefab(
                51,
                0.5,
                99,
                SpawnAnchor::SelfEntity,
                SpawnPhase::PrePhysics,
                16.0,
                -4.0,
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 51)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB,
        );
    }

    #[test]
    fn action_trigger_spawn_prefab_queue_full_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(64.0, 64.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::spawn_prefab(
                51,
                0.5,
                1,
                SpawnAnchor::SelfEntity,
                SpawnPhase::PrePhysics,
                0.0,
                0.0,
            )
        ));
        scene.fill_pending_spawns_for_test();

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 51)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 64);
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        );
    }

    #[test]
    fn action_trigger_spawn_prefab_blocked_placement_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(64.0, 64.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::spawn_prefab(
                51,
                0.5,
                1,
                SpawnAnchor::SelfEntity,
                SpawnPhase::PrePhysics,
                0.0,
                0.0,
            )
        ));
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 48.0, 48.0, true, vec![1]);

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 51)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &tilemap, Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
        );
    }

    #[test]
    fn action_trigger_spawn_prefab_queue_full_takes_precedence_over_blocked_placement() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(64.0, 64.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::spawn_prefab(
                51,
                0.5,
                1,
                SpawnAnchor::SelfEntity,
                SpawnPhase::PrePhysics,
                0.0,
                0.0,
            )
        ));
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 48.0, 48.0, true, vec![1]);
        scene.fill_pending_spawns_for_test();

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 51)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &tilemap, Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 64);
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        );
    }

    #[test]
    fn spawn_prefab_trigger_process_result_reports_queued_prefab() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(64.0, 64.0, 0);
        let action = ActionBinding::spawn_prefab(
            51,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            16.0,
            -4.0,
        );
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 51, ActionPatternKind::SpawnPrefab, action);

        let result = scene.process_spawn_prefab_trigger(
            &mut world,
            &Tilemap::default(),
            ActionTriggerCommand::timer(source, 51),
            prepared,
            SpawnPrefabActionPayload {
                prefab_id: 1,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 16.0,
                offset_y: -4.0,
            },
            None,
        );

        assert_eq!(
            result,
            SpawnPrefabActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: true,
                prefab_queued: true,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        assert_eq!(scene.pending_spawn_count(), 1);
        assert!(
            (world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );
    }

    #[test]
    fn spawn_prefab_trigger_process_result_reports_plan_failure_event_push() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        let action = ActionBinding::spawn_prefab(
            51,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            16.0,
            -4.0,
        );
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 51, ActionPatternKind::SpawnPrefab, action);
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_spawn_prefab_trigger(
            &mut world,
            &Tilemap::default(),
            ActionTriggerCommand::timer(source, 51),
            prepared,
            SpawnPrefabActionPayload {
                prefab_id: 1,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 16.0,
                offset_y: -4.0,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            SpawnPrefabActionTriggerProcessResult {
                plan_succeeded: false,
                commit_succeeded: false,
                prefab_queued: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM),
            }
        );
        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn spawn_prefab_trigger_process_result_reports_unpushed_unsupported_prefab_without_event_sink()
    {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(64.0, 64.0, 0);
        let action = ActionBinding::spawn_prefab(
            51,
            0.5,
            99,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            16.0,
            -4.0,
        );
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 51, ActionPatternKind::SpawnPrefab, action);

        let result = scene.process_spawn_prefab_trigger(
            &mut world,
            &Tilemap::default(),
            ActionTriggerCommand::timer(source, 51),
            prepared,
            SpawnPrefabActionPayload {
                prefab_id: 99,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 16.0,
                offset_y: -4.0,
            },
            None,
        );

        assert_eq!(
            result,
            SpawnPrefabActionTriggerProcessResult {
                plan_succeeded: false,
                commit_succeeded: false,
                prefab_queued: false,
                failure_event_pushed: false,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_PREFAB),
            }
        );
        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn spawn_prefab_trigger_process_result_reports_blocked_placement_after_plan() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(64.0, 64.0, 0);
        let action = ActionBinding::spawn_prefab(
            51,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        );
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 51, ActionPatternKind::SpawnPrefab, action);
        let mut tilemap = Tilemap::default();
        tilemap.set_layer(0, 1, 1, 32.0, 32.0, 48.0, 48.0, true, vec![1]);
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_spawn_prefab_trigger(
            &mut world,
            &tilemap,
            ActionTriggerCommand::timer(source, 51),
            prepared,
            SpawnPrefabActionPayload {
                prefab_id: 1,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 0.0,
                offset_y: 0.0,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            SpawnPrefabActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: false,
                prefab_queued: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT),
            }
        );
        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_BLOCKED_PLACEMENT,
        );
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn spawn_prefab_trigger_process_result_reports_queue_full_after_plan() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(64.0, 64.0, 0);
        let action = ActionBinding::spawn_prefab(
            51,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        );
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 51, ActionPatternKind::SpawnPrefab, action);
        scene.fill_pending_spawns_for_test();
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_spawn_prefab_trigger(
            &mut world,
            &Tilemap::default(),
            ActionTriggerCommand::timer(source, 51),
            prepared,
            SpawnPrefabActionPayload {
                prefab_id: 1,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 0.0,
                offset_y: 0.0,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            SpawnPrefabActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: false,
                prefab_queued: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL),
            }
        );
        assert_eq!(scene.pending_spawn_count(), 64);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        );
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn spawn_prefab_trigger_process_result_reports_skipped_commit_after_binding_change() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(64.0, 64.0, 0);
        let action = ActionBinding::spawn_prefab(
            51,
            0.5,
            1,
            SpawnAnchor::SelfEntity,
            SpawnPhase::PrePhysics,
            0.0,
            0.0,
        );
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 51, ActionPatternKind::SpawnPrefab, action);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::spawn_prefab(
                51,
                0.5,
                1,
                SpawnAnchor::SelfEntity,
                SpawnPhase::PrePhysics,
                8.0,
                0.0,
            )
        ));

        let result = scene.process_spawn_prefab_trigger(
            &mut world,
            &Tilemap::default(),
            ActionTriggerCommand::timer(source, 51),
            prepared,
            SpawnPrefabActionPayload {
                prefab_id: 1,
                projectile: None,
                anchor: SpawnAnchor::SelfEntity,
                phase: SpawnPhase::PrePhysics,
                offset_x: 0.0,
                offset_y: 0.0,
            },
            None,
        );

        assert_eq!(
            result,
            SpawnPrefabActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: false,
                prefab_queued: false,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 51)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn action_trigger_dash_target_player_moves_source_and_commits_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 100.0, y: 0.0 });
        assert_eq!(world.player_entity(), Some(player));
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::dash_with_aim(21, 0.5, 40.0, ActionAimSource::TargetPlayer,)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 21)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        let result =
            scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(
            result,
            ActionTriggerPhaseProcessResult {
                triggers_collected: 1,
                triggers_processed: 1,
                prepared_dispatch_attempts: 1,
                prepared_dispatch_successes: 1,
                prepared_dispatch_failures: 0,
                prepared_dispatch_failure_events_pushed: 0,
                prepared_dispatch_commit_skips: 0,
                last_prepared_dispatch_failure_reason_code: None,
                action_failure_reason_counts: empty_action_failure_reason_counts(),
                preparation_failures: 0,
                preparation_failure_events_pushed: 0,
                noops: 0,
            }
        );
        let moved = world.transform(source).unwrap();
        assert!((moved.x - 60.0).abs() < 0.001);
        assert!((moved.y).abs() < 0.001);
        assert!(
            (world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );
        assert!(events.is_empty());
    }

    #[test]
    fn dash_trigger_process_result_reports_applied_dash() {
        let scene = ShooterScene::new();
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 100.0, y: 0.0 });
        let action = ActionBinding::dash_with_aim(21, 0.5, 40.0, ActionAimSource::TargetPlayer);
        assert!(world.upsert_action_binding(source, action));
        assert_eq!(world.player_entity(), Some(player));
        let prepared = PreparedAction::new(source, 21, ActionPatternKind::Dash, action);

        let result = scene.process_dash_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 21),
            prepared,
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::TargetPlayer,
            },
            None,
        );

        assert_eq!(
            result,
            DashActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: true,
                dash_applied: true,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        let moved = world.transform(source).unwrap();
        assert!((moved.x - 60.0).abs() < 0.001);
        assert!(moved.y.abs() < 0.001);
        assert!(
            (world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );
    }

    #[test]
    fn dash_trigger_process_result_reports_failure_event_push() {
        let scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        let action = ActionBinding::dash_with_aim(21, 0.5, 40.0, ActionAimSource::TargetPlayer);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 21, ActionPatternKind::Dash, action);
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_dash_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 21),
            prepared,
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::TargetPlayer,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            DashActionTriggerProcessResult {
                plan_succeeded: false,
                commit_succeeded: false,
                dash_applied: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM),
            }
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn dash_trigger_process_result_reports_skipped_commit_after_binding_change() {
        let scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 100.0, y: 0.0 });
        let action = ActionBinding::dash_with_aim(21, 0.5, 40.0, ActionAimSource::TargetPlayer);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 21, ActionPatternKind::Dash, action);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::dash_with_aim(21, 0.5, 80.0, ActionAimSource::TargetPlayer)
        ));

        let result = scene.process_dash_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 21),
            prepared,
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::TargetPlayer,
            },
            None,
        );

        assert_eq!(
            result,
            DashActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: false,
                dash_applied: false,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        assert_eq!(
            world.transform(source),
            Some(Transform2D { x: 100.0, y: 0.0 })
        );
        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn dash_trigger_process_result_reports_unpushed_plan_failure_without_event_sink() {
        let scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 100.0, y: 0.0 });
        let action = ActionBinding::dash(21, 0.5, 40.0);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 21, ActionPatternKind::Dash, action);

        let result = scene.process_dash_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 21),
            prepared,
            DashActionPayload {
                distance: 40.0,
                aim: ActionAimSource::Input,
            },
            None,
        );

        assert_eq!(
            result,
            DashActionTriggerProcessResult {
                plan_succeeded: false,
                commit_succeeded: false,
                dash_applied: false,
                failure_event_pushed: false,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE),
            }
        );
        assert_eq!(
            world.transform(source),
            Some(Transform2D { x: 100.0, y: 0.0 })
        );
        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn action_trigger_dash_missing_source_transform_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::dash_with_aim(21, 0.5, 40.0, ActionAimSource::TargetPlayer,)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 21)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
    }

    #[test]
    fn action_trigger_dash_missing_target_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 100.0, y: 0.0 });
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::dash_with_aim(21, 0.5, 40.0, ActionAimSource::TargetPlayer,)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 21)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        let unchanged = world.transform(source).unwrap();
        assert!((unchanged.x - 100.0).abs() < 0.001);
        assert!((unchanged.y).abs() < 0.001);
        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
    }

    #[test]
    fn action_trigger_dash_missing_player_transform_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 100.0, y: 0.0 });
        world.transforms[player.id as usize] = None;
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::dash_with_aim(21, 0.5, 40.0, ActionAimSource::TargetPlayer,)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 21)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        let unchanged = world.transform(source).unwrap();
        assert!((unchanged.x - 100.0).abs() < 0.001);
        assert!(unchanged.y.abs() < 0.001);
        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
    }

    #[test]
    fn action_trigger_dash_self_target_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_player(100.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::dash_with_aim(21, 0.5, 40.0, ActionAimSource::TargetPlayer,)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 21)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        let unchanged = world.transform(source).unwrap();
        assert!((unchanged.x - 100.0).abs() < 0.001);
        assert!(unchanged.y.abs() < 0.001);
        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
    }

    #[test]
    fn action_trigger_dash_input_aim_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        scene.game_state = GameState::Playing;
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        world.set_transform(source, Transform2D { x: 100.0, y: 0.0 });
        world.set_velocity(source, Velocity { vx: 0.0, vy: 2.0 });
        assert!(world.upsert_action_binding(source, ActionBinding::dash(21, 0.5, 40.0)));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 21)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        let unchanged = world.transform(source).unwrap();
        assert!((unchanged.x - 100.0).abs() < 0.001);
        assert!((unchanged.y).abs() < 0.001);
        assert_eq!(
            world
                .action_binding(source, 21)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
        );
    }

    #[test]
    fn action_trigger_projectile_target_player_queues_player_target_bullet_and_commits_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        let source_transform = world
            .transform(source)
            .expect("spawned enemy should have transform");
        let action = ActionBinding::projectile_with_target(
            31,
            0.5,
            ProjectileActionConfig {
                speed: 120.0,
                damage: 1.0,
                lifetime_seconds: 2.0,
                aim: ActionAimSource::TargetPlayer,
                collision_target: ProjectileCollisionTarget::Player,
                tile_impact: ProjectileTileImpact::Despawn,
            },
        );
        assert!(world.upsert_action_binding(source, action));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(events.is_empty());
        assert_eq!(scene.pending_spawn_count(), 1);
        assert!(
            (world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );

        let mut audio_events = Vec::new();
        scene.flush_pending_spawns(&mut world, &mut audio_events);
        let bullet_index = world
            .alive_indices()
            .iter()
            .copied()
            .find(|index| world.collider_layer_at(*index) == Some(CollisionLayer::Bullet))
            .unwrap();
        assert_eq!(
            world.projectile_collision_targets[bullet_index],
            Some(ProjectileCollisionTarget::Player),
        );
        let source_sprite =
            world.sprites[source.id as usize].expect("spawned enemy should have sprite");
        let source_half_extent = source_sprite.width.max(source_sprite.height) * 0.5;
        let bullet_half_extent = scene
            .config
            .bullet_template
            .sprite_width
            .max(scene.config.bullet_template.sprite_height)
            * 0.5;
        let bullet_transform = world.transforms[bullet_index].unwrap();
        assert!(
            (bullet_transform.x - (source_transform.x - source_half_extent - bullet_half_extent))
                .abs()
                < 0.001
        );
        assert!((bullet_transform.y - source_transform.y).abs() < 0.001);
        let velocity = world.velocities[bullet_index].unwrap();
        assert!(velocity.vx < -119.0);
        assert!(velocity.vy.abs() < 0.001);
    }

    #[test]
    fn projectile_trigger_process_result_reports_queued_spawn() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        let config = ProjectileActionConfig {
            speed: 120.0,
            damage: 1.0,
            lifetime_seconds: 2.0,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Despawn,
        };
        let action = ActionBinding::projectile_with_target(31, 0.5, config);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 31, ActionPatternKind::Projectile, action);

        let result = scene.process_projectile_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 31),
            prepared,
            ProjectileActionPayload {
                speed: config.speed,
                damage: config.damage,
                lifetime_seconds: config.lifetime_seconds,
                aim: config.aim,
                collision_target: config.collision_target,
                tile_impact: config.tile_impact,
            },
            None,
        );

        assert_eq!(
            result,
            ProjectileActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: true,
                projectile_queued: true,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        assert_eq!(scene.pending_spawn_count(), 1);
        assert!(
            (world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );
    }

    #[test]
    fn projectile_trigger_process_result_reports_support_failure_event_push() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        let action = ActionBinding::projectile_with_target(
            31,
            0.5,
            ProjectileActionConfig {
                speed: 120.0,
                damage: 1.0,
                lifetime_seconds: 2.0,
                aim: ActionAimSource::Input,
                collision_target: ProjectileCollisionTarget::Player,
                tile_impact: ProjectileTileImpact::Despawn,
            },
        );
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 31, ActionPatternKind::Projectile, action);
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_projectile_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 31),
            prepared,
            ProjectileActionPayload {
                speed: 120.0,
                damage: 1.0,
                lifetime_seconds: 2.0,
                aim: ActionAimSource::Input,
                collision_target: ProjectileCollisionTarget::Player,
                tile_impact: ProjectileTileImpact::Despawn,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            ProjectileActionTriggerProcessResult {
                plan_succeeded: false,
                commit_succeeded: false,
                projectile_queued: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE),
            }
        );
        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
        );
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn projectile_trigger_process_result_reports_plan_failure_event_push() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(100.0, 0.0, 0);
        let config = ProjectileActionConfig {
            speed: 120.0,
            damage: 1.0,
            lifetime_seconds: 2.0,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Despawn,
        };
        let action = ActionBinding::projectile_with_target(31, 0.5, config);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 31, ActionPatternKind::Projectile, action);
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_projectile_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 31),
            prepared,
            ProjectileActionPayload {
                speed: config.speed,
                damage: config.damage,
                lifetime_seconds: config.lifetime_seconds,
                aim: config.aim,
                collision_target: config.collision_target,
                tile_impact: config.tile_impact,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            ProjectileActionTriggerProcessResult {
                plan_succeeded: false,
                commit_succeeded: false,
                projectile_queued: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET),
            }
        );
        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn projectile_trigger_process_result_reports_queue_full_failure_after_plan() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        let config = ProjectileActionConfig {
            speed: 120.0,
            damage: 1.0,
            lifetime_seconds: 2.0,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Despawn,
        };
        let action = ActionBinding::projectile_with_target(31, 0.5, config);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 31, ActionPatternKind::Projectile, action);
        scene.fill_pending_spawns_for_test();
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_projectile_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 31),
            prepared,
            ProjectileActionPayload {
                speed: config.speed,
                damage: config.damage,
                lifetime_seconds: config.lifetime_seconds,
                aim: config.aim,
                collision_target: config.collision_target,
                tile_impact: config.tile_impact,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            ProjectileActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: false,
                projectile_queued: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL),
            }
        );
        assert_eq!(scene.pending_spawn_count(), 64);
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        );
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn projectile_trigger_process_result_reports_skipped_commit_after_binding_change() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        let config = ProjectileActionConfig {
            speed: 120.0,
            damage: 1.0,
            lifetime_seconds: 2.0,
            aim: ActionAimSource::TargetPlayer,
            collision_target: ProjectileCollisionTarget::Player,
            tile_impact: ProjectileTileImpact::Despawn,
        };
        let action = ActionBinding::projectile_with_target(31, 0.5, config);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 31, ActionPatternKind::Projectile, action);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 240.0,
                    ..config
                },
            )
        ));

        let result = scene.process_projectile_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 31),
            prepared,
            ProjectileActionPayload {
                speed: config.speed,
                damage: config.damage,
                lifetime_seconds: config.lifetime_seconds,
                aim: config.aim,
                collision_target: config.collision_target,
                tile_impact: config.tile_impact,
            },
            None,
        );

        assert_eq!(
            result,
            ProjectileActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: false,
                projectile_queued: false,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn action_trigger_projectile_queue_full_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::TargetPlayer,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));
        scene.fill_pending_spawns_for_test();

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        let result =
            scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(
            result,
            ActionTriggerPhaseProcessResult {
                triggers_collected: 1,
                triggers_processed: 1,
                prepared_dispatch_attempts: 1,
                prepared_dispatch_successes: 0,
                prepared_dispatch_failures: 1,
                prepared_dispatch_failure_events_pushed: 1,
                prepared_dispatch_commit_skips: 0,
                last_prepared_dispatch_failure_reason_code: Some(
                    GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL
                ),
                action_failure_reason_counts: action_failure_reason_counts_with(
                    GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
                    1,
                ),
                preparation_failures: 0,
                preparation_failure_events_pushed: 0,
                noops: 0,
            }
        );
        assert_eq!(scene.pending_spawn_count(), 64);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_SPAWN_QUEUE_FULL,
        );
    }

    #[test]
    fn duplicate_action_trigger_second_attempt_reports_cooling_down_once() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::TargetPlayer,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 1);
        assert!(
            (world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].token_id, 31);
        assert_eq!(events[0].payload_bits, GAMEPLAY_ACTION_FAILURE_COOLING_DOWN);
    }

    #[test]
    fn action_trigger_projectile_input_aim_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::Input,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
        );
    }

    #[test]
    fn action_trigger_projectile_missing_source_transform_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::TargetPlayer,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
    }

    #[test]
    fn action_trigger_projectile_unsupported_aim_takes_precedence_over_missing_source_transform() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::Input,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_AIM_SOURCE,
        );
    }

    #[test]
    fn action_trigger_projectile_missing_target_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(100.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::TargetPlayer,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
    }

    #[test]
    fn action_trigger_projectile_missing_player_transform_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        world.transforms[player.id as usize] = None;
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::TargetPlayer,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
    }

    #[test]
    fn action_trigger_projectile_self_target_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_player(100.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::TargetPlayer,
                    collision_target: ProjectileCollisionTarget::Player,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
    }

    #[test]
    fn action_trigger_projectile_enemy_collision_target_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(100.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::projectile_with_target(
                31,
                0.5,
                ProjectileActionConfig {
                    speed: 120.0,
                    damage: 1.0,
                    lifetime_seconds: 2.0,
                    aim: ActionAimSource::TargetPlayer,
                    collision_target: ProjectileCollisionTarget::Enemies,
                    tile_impact: ProjectileTileImpact::Despawn,
                },
            )
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 31)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_spawn_count(), 0);
        assert_eq!(
            world
                .action_binding(source, 31)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_UNSUPPORTED_COLLISION_TARGET,
        );
    }

    #[test]
    fn action_trigger_melee_target_player_causes_game_over_without_score() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(16.0, 0.0, 0);
        let source_height_span = HeightSpan::new(PhysicsFloorId(2), 4.0, 8.0).unwrap();
        assert!(world.set_height_span(source, source_height_span));
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(events.is_empty());
        assert_eq!(scene.pending_melee_attacks.len(), 1);
        let command = scene.pending_melee_attacks[0];
        assert_eq!(command.attacker, source);
        assert_eq!(command.center, world.transform(source).unwrap());
        assert_eq!(command.range, 32.0);
        assert_eq!(command.damage, 2.0);
        assert_eq!(command.target, MeleeTarget::Player);
        assert_eq!(command.height_span, Some(source_height_span));
        assert!(
            (world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );

        let mut audio_events = Vec::new();
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            None,
            None,
        );

        assert_eq!(scene.game_state(), GameState::GameOver);
        assert_eq!(scene.score(), 0);
    }

    #[test]
    fn action_trigger_melee_target_player_faction_denial_consumes_cooldown_without_game_over() {
        let mut scene = ShooterScene::new();
        scene.game_state = GameState::Playing;
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(72.0, 0.0, 0);
        world.set_gameplay_faction(
            source,
            GameplayFaction::new(GAMEPLAY_FACTION_ENEMY, 0).unwrap(),
        );
        world.set_gameplay_faction(
            player,
            GameplayFaction::new(GAMEPLAY_FACTION_PLAYER, 1 << GAMEPLAY_FACTION_ENEMY).unwrap(),
        );
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 96.0, 2.0, MeleeTarget::Player)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(events.is_empty());
        assert_eq!(scene.pending_melee_attacks.len(), 1);
        assert!(
            (world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );

        let mut audio_events = Vec::new();
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            None,
            None,
        );

        assert_eq!(scene.game_state(), GameState::Playing);
        assert_eq!(scene.score(), 0);
        assert!(audio_events.is_empty());
        assert!(scene.pending_melee_attacks.is_empty());
    }

    #[test]
    fn melee_trigger_process_result_reports_queued_attack() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(16.0, 0.0, 0);
        let source_height_span = HeightSpan::new(PhysicsFloorId(2), 4.0, 8.0).unwrap();
        assert!(world.set_height_span(source, source_height_span));
        let action = ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 41, ActionPatternKind::Melee, action);

        let result = scene.process_melee_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 41),
            prepared,
            MeleeActionPayload {
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Player,
            },
            None,
        );

        assert_eq!(
            result,
            MeleeActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: true,
                melee_queued: true,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        assert_eq!(scene.pending_melee_attacks.len(), 1);
        assert_eq!(scene.pending_melee_attacks[0].attacker, source);
        assert_eq!(
            scene.pending_melee_attacks[0].height_span,
            Some(source_height_span)
        );
        assert!(
            (world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );
    }

    #[test]
    fn melee_trigger_process_result_reports_failure_event_push() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        let action = ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 41, ActionPatternKind::Melee, action);
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_melee_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 41),
            prepared,
            MeleeActionPayload {
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Player,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            MeleeActionTriggerProcessResult {
                plan_succeeded: false,
                commit_succeeded: false,
                melee_queued: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM),
            }
        );
        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn melee_trigger_process_result_reports_skipped_commit_after_binding_change() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(16.0, 0.0, 0);
        let action = ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 41, ActionPatternKind::Melee, action);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 48.0, 2.0, MeleeTarget::Player)
        ));

        let result = scene.process_melee_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 41),
            prepared,
            MeleeActionPayload {
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Player,
            },
            None,
        );

        assert_eq!(
            result,
            MeleeActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: false,
                melee_queued: false,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn melee_trigger_process_result_reports_plan_failure_event_push() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(16.0, 0.0, 0);
        let action = ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 41, ActionPatternKind::Melee, action);
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);

        let result = scene.process_melee_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 41),
            prepared,
            MeleeActionPayload {
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Player,
            },
            Some(&mut event_sink),
        );

        assert_eq!(
            result,
            MeleeActionTriggerProcessResult {
                plan_succeeded: false,
                commit_succeeded: false,
                melee_queued: false,
                failure_event_pushed: true,
                failure_reason_code: Some(GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET),
            }
        );
        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0
        );
    }

    #[test]
    fn melee_trigger_process_result_queues_enemy_target_without_event_sink() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(16.0, 0.0, 0);
        let action = ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Enemies);
        assert!(world.upsert_action_binding(source, action));
        let prepared = PreparedAction::new(source, 41, ActionPatternKind::Melee, action);

        let result = scene.process_melee_trigger(
            &mut world,
            ActionTriggerCommand::timer(source, 41),
            prepared,
            MeleeActionPayload {
                range: 32.0,
                damage: 2.0,
                target: MeleeTarget::Enemies,
            },
            None,
        );

        assert_eq!(
            result,
            MeleeActionTriggerProcessResult {
                plan_succeeded: true,
                commit_succeeded: true,
                melee_queued: true,
                failure_event_pushed: false,
                failure_reason_code: None,
            }
        );
        assert_eq!(scene.pending_melee_attacks.len(), 1);
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.5
        );
    }

    #[test]
    fn action_trigger_melee_missing_source_transform_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
    }

    #[test]
    fn action_trigger_melee_enemy_target_reports_missing_source_transform() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Enemies)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
    }

    #[test]
    fn action_trigger_melee_enemy_target_does_not_require_player_target() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(16.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Enemies)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_melee_attacks.len(), 1);
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.5,
        );
        assert!(events.is_empty());
    }

    #[test]
    fn action_trigger_melee_missing_source_transform_takes_precedence_over_missing_target() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_entity();
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_SOURCE_TRANSFORM,
        );
    }

    #[test]
    fn action_trigger_melee_missing_target_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_enemy(16.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
    }

    #[test]
    fn action_trigger_melee_self_target_fails_without_consuming_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        let source = world.spawn_player(0.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Player)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(scene.pending_melee_attacks.is_empty());
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.0,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].payload_bits,
            GAMEPLAY_ACTION_FAILURE_MISSING_ACTION_TARGET,
        );
    }

    #[test]
    fn action_trigger_melee_target_player_whiff_consumes_cooldown() {
        let mut scene = ShooterScene::new();
        scene.game_state = GameState::Playing;
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(96.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 16.0, 2.0, MeleeTarget::Player)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert!(events.is_empty());
        assert_eq!(scene.pending_melee_attacks.len(), 1);
        assert!(
            (world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds
                - 0.5)
                .abs()
                < 0.001
        );

        let mut audio_events = Vec::new();
        scene.handle_collisions(
            &mut world,
            &Tilemap::default(),
            &mut audio_events,
            0.0,
            None,
            None,
            None,
            None,
        );

        assert_eq!(scene.game_state(), GameState::Playing);
        assert_eq!(scene.score(), 0);
        assert!(audio_events.is_empty());
    }

    #[test]
    fn action_trigger_melee_enemy_target_queues_and_consumes_cooldown() {
        let mut scene = ShooterScene::new();
        let mut world = World::default();
        world.spawn_player(0.0, 0.0, 0);
        let source = world.spawn_enemy(16.0, 0.0, 0);
        assert!(world.upsert_action_binding(
            source,
            ActionBinding::melee_with_target(41, 0.5, 32.0, 2.0, MeleeTarget::Enemies)
        ));

        assert!(scene.queue_action_trigger(ActionTriggerCommand::timer(source, 41)));
        let mut events = Vec::new();
        let mut event_sink = GameplayEventSink::new(&mut events);
        scene.process_action_triggers(&mut world, &Tilemap::default(), Some(&mut event_sink));

        assert_eq!(scene.pending_melee_attacks.len(), 1);
        assert_eq!(
            world
                .action_binding(source, 41)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.5,
        );
        assert!(events.is_empty());
    }

    #[test]
    fn prepared_authored_action_commits_cooldown_explicitly() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let action = ActionBinding::melee(3, 0.5, 64.0, 2.0);
        assert!(world.upsert_action_binding(player, action));
        let input_actions = enter_pressed_registry(3);
        let input = InputState {
            enter: 1,
            ..InputState::default()
        };

        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(input, InputState::default()),
                player,
                3,
                ActionPatternKind::Melee,
            ),
            InputActionTrigger::Ready(PreparedAction::new(
                player,
                3,
                ActionPatternKind::Melee,
                action,
            )),
        );
        assert_eq!(world.action_binding(player, 3), Some(action));
        assert!(commit_prepared_input_action(
            &mut world,
            PreparedAction::new(player, 3, ActionPatternKind::Melee, action)
        ));
        assert_eq!(
            world
                .action_binding(player, 3)
                .unwrap()
                .cooldown
                .remaining_seconds,
            0.5,
        );
        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(input, InputState::default()),
                player,
                3,
                ActionPatternKind::Melee,
            ),
            InputActionTrigger::CoolingDown,
        );
    }

    #[test]
    fn prepare_authored_action_reports_inactive_for_unpressed_or_repeated_pressed_input() {
        let mut world = World::default();
        let player = world.spawn_player(0.0, 0.0, 0);
        let action = ActionBinding::melee(3, 0.5, 64.0, 2.0);
        assert!(world.upsert_action_binding(player, action));
        let input_actions = enter_pressed_registry(3);
        let pressed = InputState {
            enter: 1,
            ..InputState::default()
        };

        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::current_only(InputState::default()),
                player,
                3,
                ActionPatternKind::Melee,
            ),
            InputActionTrigger::Inactive,
        );
        assert_eq!(
            prepare_input_action_if_ready(
                &world,
                &input_actions,
                FrameInputSnapshot::new(pressed, pressed),
                player,
                3,
                ActionPatternKind::Melee,
            ),
            InputActionTrigger::Inactive,
        );
        assert_eq!(world.action_binding(player, 3), Some(action));
    }
}
