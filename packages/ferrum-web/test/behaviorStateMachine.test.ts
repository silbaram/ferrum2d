import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";

import {
  BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS,
  behaviorStateMachineBehaviorProfilesForState,
  behaviorStateMachineCommandsForState,
  compareBehaviorStateMachineReplay,
  applyBehaviorStateMachineStateCommands,
  createBehaviorStateMachineCurrentStateCommandPlan,
  createBehaviorStateMachineStateCommandPlan,
  createBehaviorStateMachineRuntimeInstallPlan,
  installBehaviorStateMachineRuntime,
  preflightBehaviorStateMachineStateCommands,
  runBehaviorStateMachineReplay,
  resolveBehaviorStateMachineDocument,
} from "../src/behaviorStateMachine.js";
import type { BehaviorRecipeDocumentSpec } from "../src/behaviorRecipes.js";
import type {
  BehaviorStateMachineDocumentSpec,
  BehaviorStateMachineRuntimeEngine,
} from "../src/behaviorStateMachine.js";
import type { GameplayBehaviorRuntimeEngine } from "../src/gameplayAuthoring.js";
import type {
  GameplayCollisionDamageEventAction,
  GameplayInteractionEventAction,
  GameplayAnimationFrameEventAction,
  GameplayPickupCollectedEventAction,
  GameplayTileImpactEventAction,
  GameplayTimerEventAction,
} from "../src/gameplayEventActions.js";

const recipes: BehaviorRecipeDocumentSpec = {
  entities: {
    "enemy.idle": {
      recipes: [{ kind: "interaction", action: "wake", actionId: 4, radius: 32 }],
    },
    "enemy.chase": {
      recipes: [{ kind: "chase", target: "player", speed: 96, stopDistance: 0 }],
    },
  },
};

const fsm: BehaviorStateMachineDocumentSpec = {
  machines: {
    enemy: {
      initial: "idle",
      states: {
        idle: {
          behaviorRecipes: "enemy.idle",
          transitions: [{
            to: "chasing",
            when: { type: "gameplayEvent", event: "interaction", action: "wake", actionId: 4 },
          }],
        },
        chasing: {
          behaviorRecipes: ["enemy.chase"],
        },
      },
    },
  },
};
const replayEntity = { entityId: 2, entityGeneration: 0 };

test("resolveBehaviorStateMachineDocument resolves minimal FSM authoring data", () => {
  const resolved = resolveBehaviorStateMachineDocument(fsm, { behaviorRecipes: recipes });

  equal(resolved.machines.enemy.initial, "idle");
  deepEqual(resolved.machines.enemy.states.idle.behaviorRecipes, ["enemy.idle"]);
  deepEqual(resolved.machines.enemy.states.idle.transitions[0]?.when, {
    type: "gameplayEvent",
    event: "interaction",
    action: "wake",
    actionId: 4,
  });
});

test("behaviorStateMachine helpers expose state behavior profiles and recipe commands", () => {
  deepEqual(behaviorStateMachineBehaviorProfilesForState(fsm, "enemy"), ["enemy.idle"]);

  const commands = behaviorStateMachineCommandsForState(fsm, recipes, "enemy", "chasing");
  deepEqual(commands.map((command) => command.type), ["configureChase"]);
  equal(commands[0]?.entity, "enemy.chase");
});

test("runBehaviorStateMachineReplay produces deterministic transition hashes and diffs", () => {
  const expected = runBehaviorStateMachineReplay(fsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [] },
      { frame: 1, events: [interactionAction(4, "wake")] },
      { frame: 2, events: [interactionAction(99, "ignore")] },
    ],
  }, {
    behaviorRecipes: recipes,
  });

  equal(expected.initialState, "idle");
  equal(expected.finalState, "chasing");
  deepEqual(expected.steps.map((step) => [step.frame, step.from, step.to, step.transition]), [
    [0, "idle", "idle", undefined],
    [1, "idle", "chasing", "idle.0"],
    [2, "chasing", "chasing", undefined],
  ]);
  equal(expected.replayHash.length, 8);

  const actual = runBehaviorStateMachineReplay(fsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [] },
      { frame: 1, events: [interactionAction(99, "ignore")] },
      { frame: 2, events: [] },
    ],
  }, {
    behaviorRecipes: recipes,
  });

  const comparison = compareBehaviorStateMachineReplay(expected, actual);
  equal(comparison.passed, false);
  equal(comparison.firstMismatchFrame, 1);
  equal(comparison.expectedFinalState, "chasing");
  equal(comparison.actualFinalState, "idle");

  const staleHandle = runBehaviorStateMachineReplay(fsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [] },
      { frame: 1, events: [interactionAction(4, "wake", 1)] },
      { frame: 2, events: [interactionAction(99, "ignore")] },
    ],
  }, {
    behaviorRecipes: recipes,
  });
  equal(compareBehaviorStateMachineReplay(expected, staleHandle).passed, false);

  const renamedAction = runBehaviorStateMachineReplay(fsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [] },
      { frame: 1, events: [interactionAction(4, "renamed")] },
      { frame: 2, events: [interactionAction(99, "ignore")] },
    ],
  }, {
    behaviorRecipes: recipes,
  });
  equal(compareBehaviorStateMachineReplay(expected, renamedAction).passed, true);
});

test("runBehaviorStateMachineReplay uses transition order and one transition per frame", () => {
  const ordered: BehaviorStateMachineDocumentSpec = {
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [
              {
                id: "first",
                to: "alert",
                when: { type: "gameplayEvent", event: "interaction", actionId: 4 },
              },
              {
                id: "second",
                to: "chasing",
                when: { type: "gameplayEvent", event: "interaction", actionId: 4 },
              },
            ],
          },
          alert: {
            transitions: [{
              id: "follow-up",
              to: "chasing",
              when: { type: "gameplayEvent", event: "interaction", actionId: 4 },
            }],
          },
          chasing: {},
        },
      },
    },
  };

  const replay = runBehaviorStateMachineReplay(ordered, {
    machine: "enemy",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [interactionAction(4, "wake")] },
      { frame: 1, events: [interactionAction(4, "wake")] },
    ],
  }, {
    behaviorRecipes: recipes,
  });

  deepEqual(replay.steps.map((step) => [step.frame, step.from, step.to, step.transition]), [
    [0, "idle", "alert", "first"],
    [1, "alert", "chasing", "follow-up"],
  ]);
});

test("createBehaviorStateMachineRuntimeInstallPlan maps authoring states to numeric runtime data", () => {
  const plan = createBehaviorStateMachineRuntimeInstallPlan(fsm, "enemy", { behaviorRecipes: recipes });

  deepEqual(plan.states, [
    { state: "chasing", stateId: 1 },
    { state: "idle", stateId: 2 },
  ]);
  equal(plan.initialStateId, 2);
  deepEqual(plan.transitions, [{
    id: "idle.0",
    from: "idle",
    to: "chasing",
    fromStateId: 2,
    toStateId: 1,
    event: "interaction",
    eventKind: 1,
    tokenId: 4,
    actionId: 4,
  }]);
});

test("animation frame gameplay events can drive FSM replay and runtime install plans", () => {
  const animationFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      enemy: {
        initial: "windup",
        states: {
          windup: {
            transitions: [{
              id: "hit",
              to: "recover",
              when: { type: "gameplayEvent", event: "animationFrame", animationToken: "attack-hit" },
            }],
          },
          recover: {},
        },
      },
    },
  };
  const ids = { animationEvents: { "attack-hit": 77 } };
  const plan = createBehaviorStateMachineRuntimeInstallPlan(animationFsm, "enemy", {
    behaviorRecipes: recipes,
    ids,
  });

  deepEqual(plan.transitions, [{
    id: "hit",
    from: "windup",
    to: "recover",
    fromStateId: 2,
    toStateId: 1,
    event: "animationFrame",
    eventKind: 12,
    tokenId: 77,
    actionId: 77,
  }]);

  const replay = runBehaviorStateMachineReplay(animationFsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [{ frame: 0, events: [animationFrameAction(77)] }],
  }, {
    behaviorRecipes: recipes,
    ids,
  });
  equal(replay.finalState, "recover");
  equal(replay.steps[0]?.event?.animationTokenId, 77);
});

test("runtime FSM install and replay can resolve interaction actions through runtime id registry", () => {
  const registryFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              id: "wake-up",
              to: "chasing",
              when: { type: "gameplayEvent", event: "interaction", action: "wake" },
            }],
          },
          chasing: {},
        },
      },
    },
  };
  const ids = { actions: { wake: 4 } };
  const plan = createBehaviorStateMachineRuntimeInstallPlan(registryFsm, "enemy", {
    behaviorRecipes: recipes,
    ids,
  });
  equal(plan.transitions[0]?.tokenId, 4);

  const replay = runBehaviorStateMachineReplay(registryFsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [{ frame: 0, events: [interactionAction(4, "renamed")] }],
  }, {
    behaviorRecipes: recipes,
    ids,
  });
  equal(replay.finalState, "chasing");
});

test("collision gameplay events can drive FSM replay and runtime install plans", () => {
  const collisionFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      enemy: {
        initial: "alive",
        states: {
          alive: {
            transitions: [{
              id: "damaged",
              to: "hurt",
              when: { type: "gameplayEvent", event: "collisionDamage" },
            }],
          },
          hurt: {},
        },
      },
    },
  };
  const replay = runBehaviorStateMachineReplay(collisionFsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [] },
      { frame: 1, events: [collisionDamageAction()] },
    ],
  }, {
    behaviorRecipes: recipes,
  });
  equal(replay.finalState, "hurt");
  deepEqual(replay.steps[1]?.event, {
    type: "collisionDamage",
    sourceEntityId: 2,
    sourceEntityGeneration: 0,
    actorEntityId: 1,
    actorEntityGeneration: 0,
    damage: 1,
    targetRemoved: true,
  });
  const wrongSourceReplay = runBehaviorStateMachineReplay(collisionFsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [collisionDamageAction({ sourceEntityId: 99 })] },
    ],
  }, {
    behaviorRecipes: recipes,
  });
  equal(wrongSourceReplay.finalState, "alive");
  equal(wrongSourceReplay.steps[0]?.event, undefined);

  const plan = createBehaviorStateMachineRuntimeInstallPlan(collisionFsm, "enemy", { behaviorRecipes: recipes });
  deepEqual(plan.transitions, [{
    id: "damaged",
    from: "alive",
    to: "hurt",
    fromStateId: 1,
    toStateId: 2,
    event: "collisionDamage",
    eventKind: 2,
    tokenId: 0,
    actionId: 0,
  }]);

  const calls: string[] = [];
  const engine: BehaviorStateMachineRuntimeEngine = {
    clear_gameplay_behavior_state_machine: () => true,
    set_gameplay_behavior_state_machine: () => true,
    add_gameplay_behavior_transition: () => false,
    add_gameplay_behavior_event_transition: (entityId, entityGeneration, fromState, toState, eventKind, tokenId) => {
      calls.push(`transition:${entityId}:${entityGeneration}:${fromState}:${toState}:${eventKind}:${tokenId}`);
      return true;
    },
  };
  installBehaviorStateMachineRuntime(engine, collisionFsm, "enemy", { entityId: 12, entityGeneration: 3 }, {
    behaviorRecipes: recipes,
  });
  deepEqual(calls, ["transition:12:3:1:2:2:0"]);
});

test("timer gameplay events can drive FSM replay and runtime install plans", () => {
  const timerFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      enemy: {
        initial: "sleeping",
        states: {
          sleeping: {
            transitions: [{
              id: "wake",
              to: "awake",
              when: { type: "gameplayEvent", event: "timer", timer: "wake" },
            }],
          },
          awake: {},
        },
      },
    },
  };
  const ids = { timers: { wake: 9 } };
  const replay = runBehaviorStateMachineReplay(timerFsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [] },
      { frame: 1, events: [timerAction(9, 0.25)] },
    ],
  }, {
    behaviorRecipes: recipes,
    ids,
  });

  equal(replay.finalState, "awake");
  deepEqual(replay.steps[1]?.event, {
    type: "timer",
    sourceEntityId: 2,
    sourceEntityGeneration: 0,
    actorEntityId: 2,
    actorEntityGeneration: 0,
    timerId: 9,
    durationSeconds: 0.25,
  });

  const plan = createBehaviorStateMachineRuntimeInstallPlan(timerFsm, "enemy", {
    behaviorRecipes: recipes,
    ids,
  });
  deepEqual(plan.transitions, [{
    id: "wake",
    from: "sleeping",
    to: "awake",
    fromStateId: 2,
    toStateId: 1,
    event: "timer",
    eventKind: 7,
    tokenId: 9,
    actionId: 9,
  }]);
});

test("pickupCollected gameplay events drive collector-scoped FSM predicates", () => {
  const pickupFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      player: {
        initial: "searching",
        states: {
          searching: {
            transitions: [{
              id: "collect-score",
              to: "rewarded",
              when: { type: "gameplayEvent", event: "pickupCollected", item: "score" },
            }],
          },
          rewarded: {},
        },
      },
    },
  };
  const ids = { items: { score: 1 } };
  const replay = runBehaviorStateMachineReplay(pickupFsm, {
    machine: "player",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [pickupCollectedAction({ actorEntityId: 99 })] },
      { frame: 1, events: [pickupCollectedAction()] },
    ],
  }, {
    behaviorRecipes: recipes,
    ids,
  });

  equal(replay.finalState, "rewarded");
  equal(replay.steps[0]?.event, undefined);
  deepEqual(replay.steps[1]?.event, {
    type: "pickupCollected",
    sourceEntityId: 4,
    sourceEntityGeneration: 0,
    actorEntityId: 2,
    actorEntityGeneration: 0,
    itemId: 1,
    count: 3,
    targetRemoved: true,
  });

  const plan = createBehaviorStateMachineRuntimeInstallPlan(pickupFsm, "player", {
    behaviorRecipes: recipes,
    ids,
  });
  deepEqual(plan.transitions, [{
    id: "collect-score",
    from: "searching",
    to: "rewarded",
    fromStateId: 2,
    toStateId: 1,
    event: "pickupCollected",
    eventKind: 8,
    tokenId: 1,
    actionId: 1,
  }]);
});

test("tileImpact gameplay events drive projectile-scoped FSM predicates", () => {
  const tileImpactFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      projectile: {
        initial: "flying",
        states: {
          flying: {
            transitions: [{
              id: "hit-wall",
              to: "spent",
              when: { type: "gameplayEvent", event: "tileImpact", tileImpact: "despawn" },
            }],
          },
          spent: {},
        },
      },
    },
  };
  const replay = runBehaviorStateMachineReplay(tileImpactFsm, {
    machine: "projectile",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [tileImpactAction({ sourceEntityId: 99 })] },
      { frame: 1, events: [tileImpactAction()] },
    ],
  }, {
    behaviorRecipes: recipes,
  });

  equal(replay.finalState, "spent");
  equal(replay.steps[0]?.event, undefined);
  deepEqual(replay.steps[1]?.event, {
    type: "tileImpact",
    sourceEntityId: 2,
    sourceEntityGeneration: 0,
    actorEntityId: 2,
    actorEntityGeneration: 0,
    tileImpact: "despawn",
    tileImpactCode: 0,
    layerIndex: 0,
    tileIndex: 0,
    normal: "negativeX",
    bounced: false,
    identityTruncated: false,
    targetRemoved: true,
  });

  const plan = createBehaviorStateMachineRuntimeInstallPlan(tileImpactFsm, "projectile", {
    behaviorRecipes: recipes,
  });
  deepEqual(plan.transitions, [{
    id: "hit-wall",
    from: "flying",
    to: "spent",
    fromStateId: 1,
    toStateId: 2,
    event: "tileImpact",
    eventKind: 9,
    tokenId: 0,
    actionId: 0,
  }]);

  const bounceFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      projectile: {
        initial: "flying",
        states: {
          flying: {
            transitions: [{
              id: "bounce-wall",
              to: "bounced",
              when: { type: "gameplayEvent", event: "tileImpact", tileImpactCode: 2 },
            }],
          },
          bounced: {},
        },
      },
    },
  };
  const bounceReplay = runBehaviorStateMachineReplay(bounceFsm, {
    machine: "projectile",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [tileImpactAction({ tileImpactCode: 2, tileImpact: "bounce", bounced: true, targetRemoved: false })] },
    ],
  }, {
    behaviorRecipes: recipes,
  });
  equal(bounceReplay.finalState, "bounced");
  deepEqual(createBehaviorStateMachineRuntimeInstallPlan(bounceFsm, "projectile").transitions, [{
    id: "bounce-wall",
    from: "flying",
    to: "bounced",
    fromStateId: 2,
    toStateId: 1,
    event: "tileImpact",
    eventKind: 9,
    tokenId: 2,
    actionId: 2,
  }]);
});

test("tileImpact FSM predicates reject non-emitted passThrough while accepting unknown telemetry observations", () => {
  const tileImpactFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      projectile: {
        initial: "flying",
        states: {
          flying: {
            transitions: [{
              id: "hit-wall",
              to: "spent",
              when: { type: "gameplayEvent", event: "tileImpact", tileImpact: "despawn" },
            }],
          },
          spent: {},
        },
      },
    },
  };
  const replay = runBehaviorStateMachineReplay(tileImpactFsm, {
    machine: "projectile",
    entity: replayEntity,
    frames: [
      { frame: 0, events: [tileImpactAction({ tileImpactCode: 99, tileImpact: "unknown" })] },
    ],
  }, {
    behaviorRecipes: recipes,
  });
  equal(replay.finalState, "flying");
  equal(replay.steps[0]?.event, undefined);
});


test("installBehaviorStateMachineRuntime clears, installs initial state, and rolls back failed transitions", () => {
  const calls: string[] = [];
  const engine: BehaviorStateMachineRuntimeEngine = {
    clear_gameplay_behavior_state_machine: (entityId, entityGeneration) => {
      calls.push(`clear:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_behavior_state_machine: (entityId, entityGeneration, initialState) => {
      calls.push(`set:${entityId}:${entityGeneration}:${initialState}`);
      return true;
    },
    add_gameplay_behavior_transition: (entityId, entityGeneration, fromState, toState, actionId) => {
      calls.push(`transition:${entityId}:${entityGeneration}:${fromState}:${toState}:${actionId}`);
      return true;
    },
  };

  const result = installBehaviorStateMachineRuntime(engine, fsm, "enemy", { entityId: 12, entityGeneration: 3 }, {
    behaviorRecipes: recipes,
  });

  equal(result.applied, true);
  deepEqual(calls, [
    "clear:12:3",
    "set:12:3:2",
    "transition:12:3:2:1:4",
  ]);

  const rollbackCalls: string[] = [];
  const failingEngine: BehaviorStateMachineRuntimeEngine = {
    clear_gameplay_behavior_state_machine: (entityId, entityGeneration) => {
      rollbackCalls.push(`clear:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_behavior_state_machine: (entityId, entityGeneration, initialState) => {
      rollbackCalls.push(`set:${entityId}:${entityGeneration}:${initialState}`);
      return true;
    },
    add_gameplay_behavior_transition: () => false,
  };
  expectMessage(() =>
    installBehaviorStateMachineRuntime(failingEngine, fsm, "enemy", { entityId: 12, entityGeneration: 3 }, {
      behaviorRecipes: recipes,
    }), /failed to apply behavior transition/,
  );
  deepEqual(rollbackCalls, [
    "clear:12:3",
    "set:12:3:2",
    "clear:12:3",
  ]);
});

test("runtime FSM installation requires numeric action IDs and bounded transitions", () => {
  expectMessage(() => createBehaviorStateMachineRuntimeInstallPlan({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "idle",
              when: { type: "gameplayEvent", event: "interaction", action: "wake" },
            }],
          },
        },
      },
    },
  }, "enemy", { behaviorRecipes: recipes }), /path='behaviorStateMachines\.machines\.enemy\.states\.idle\.transitions\.0\.when\.action'/);

  const transitions = Array.from({ length: BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS + 1 }, (_, index) => ({
    id: `t${index}`,
    to: "idle",
    when: { type: "gameplayEvent" as const, event: "interaction" as const, actionId: index + 1 },
  }));
  const boundedTransitions = transitions.slice(0, BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS);
  const boundedPlan = createBehaviorStateMachineRuntimeInstallPlan({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: { transitions: boundedTransitions },
        },
      },
    },
  }, "enemy", { behaviorRecipes: recipes });
  equal(boundedPlan.transitions.length, BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS);

  expectMessage(() => createBehaviorStateMachineRuntimeInstallPlan({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: { transitions },
        },
      },
    },
  }, "enemy", { behaviorRecipes: recipes }), new RegExp(`at most ${BEHAVIOR_STATE_MACHINE_RUNTIME_MAX_TRANSITIONS} runtime transitions`));

  expectMessage(() => createBehaviorStateMachineRuntimeInstallPlan({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "idle",
              when: { type: "gameplayEvent", event: "interaction", actionId: 0x1_0000_0000 },
            }],
          },
        },
      },
    },
  }, "enemy", { behaviorRecipes: recipes }), /positive safe u32 integer/);

  const missingEventSetterCalls: string[] = [];
  expectMessage(() => installBehaviorStateMachineRuntime({
    clear_gameplay_behavior_state_machine: (entityId, entityGeneration) => {
      missingEventSetterCalls.push(`clear:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_behavior_state_machine: (entityId, entityGeneration, initialState) => {
      missingEventSetterCalls.push(`set:${entityId}:${entityGeneration}:${initialState}`);
      return true;
    },
    add_gameplay_behavior_transition: () => true,
  }, {
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "idle",
              when: { type: "gameplayEvent", event: "collisionDespawn" },
            }],
          },
        },
      },
    },
  }, "enemy", { entityId: 12, entityGeneration: 3 }, { behaviorRecipes: recipes }), /add_gameplay_behavior_event_transition/);
  deepEqual(missingEventSetterCalls, [
    "clear:12:3",
    "set:12:3:1",
    "clear:12:3",
  ]);
});

test("state command plan maps runtime state id back to behavior recipe commands", () => {
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(fsm, "enemy", { behaviorRecipes: recipes });
  const plan = createBehaviorStateMachineStateCommandPlan(fsm, recipes, installPlan, 1, {
    entity: "enemy-1",
  });

  equal(plan.state, "chasing");
  equal(plan.stateId, 1);
  deepEqual(plan.behaviorProfiles, ["enemy.chase"]);
  equal(plan.sourceCommands[0]?.entity, "enemy.chase");
  equal(plan.commands[0]?.entity, "enemy-1");
  equal(plan.commands[0]?.type, "configureChase");
});

test("applyBehaviorStateMachineStateCommands retargets state commands to a runtime entity handle", () => {
  const calls: string[] = [];
  const engine: GameplayBehaviorRuntimeEngine = {
    set_gameplay_health: () => true,
    clear_gameplay_health: () => {
      calls.push("clearHealth");
      return true;
    },
    set_gameplay_damage: () => true,
    clear_gameplay_damage: () => {
      calls.push("clearDamage");
      return true;
    },
    set_gameplay_lifetime: () => true,
    clear_gameplay_lifetime: () => {
      calls.push("clearLifetime");
      return true;
    },
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: () => {
      calls.push("clearScoreReward");
      return true;
    },
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: () => {
      calls.push("clearPickup");
      return true;
    },
    set_gameplay_interaction: () => true,
    clear_gameplay_interaction: () => {
      calls.push("clearInteraction");
      return true;
    },
    clear_gameplay_timer_trigger: () => true,
    set_gameplay_action_projectile: () => true,
    clear_gameplay_actions: () => {
      calls.push("clearActions");
      return true;
    },
    set_gameplay_movement_chase_player: (entityId, entityGeneration, speed) => {
      calls.push(`chase:${entityId}:${entityGeneration}:${speed}`);
      return true;
    },
    set_gameplay_movement_chase_entity: () => true,
    clear_gameplay_movement: () => {
      calls.push("clearMovement");
      return true;
    },
    clear_gameplay_collision_reactions: () => {
      calls.push("clearReactions");
      return true;
    },
    add_gameplay_collision_damage: () => true,
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(fsm, "enemy", { behaviorRecipes: recipes });
  const plan = createBehaviorStateMachineStateCommandPlan(fsm, recipes, installPlan, 1);

  const result = applyBehaviorStateMachineStateCommands(
    engine,
    plan,
    { entityId: 12, entityGeneration: 3 },
    { entity: "enemy-1" },
  );

  equal(result.plan.targetEntity, "enemy-1");
  equal(result.commands[0]?.entity, "enemy-1");
  deepEqual(result.results, [true]);
  deepEqual(calls, ["chase:12:3:96"]);
});

test("applyBehaviorStateMachineStateCommands can replace supported gameplay components before applying state commands", () => {
  const calls: string[] = [];
  const engine: GameplayBehaviorRuntimeEngine = {
    set_gameplay_health: () => true,
    clear_gameplay_health: (entityId, entityGeneration) => {
      calls.push(`clearHealth:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_damage: () => true,
    clear_gameplay_damage: (entityId, entityGeneration) => {
      calls.push(`clearDamage:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_lifetime: (entityId, entityGeneration, seconds) => {
      calls.push(`lifetime:${entityId}:${entityGeneration}:${seconds}`);
      return true;
    },
    clear_gameplay_lifetime: (entityId, entityGeneration) => {
      calls.push(`clearLifetime:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: (entityId, entityGeneration) => {
      calls.push(`clearScoreReward:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: (entityId, entityGeneration) => {
      calls.push(`clearPickup:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_interaction: () => true,
    clear_gameplay_interaction: (entityId, entityGeneration) => {
      calls.push(`clearInteraction:${entityId}:${entityGeneration}`);
      return true;
    },
    clear_gameplay_timer_trigger: (entityId, entityGeneration) => {
      calls.push(`clearTimer:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_action_projectile: () => true,
    clear_gameplay_actions: (entityId, entityGeneration) => {
      calls.push(`clearActions:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_movement_chase_player: () => true,
    set_gameplay_movement_chase_entity: () => true,
    clear_gameplay_movement: (entityId, entityGeneration) => {
      calls.push(`clearMovement:${entityId}:${entityGeneration}`);
      return true;
    },
    clear_gameplay_collision_reactions: (entityId, entityGeneration) => {
      calls.push(`clearReactions:${entityId}:${entityGeneration}`);
      return true;
    },
    add_gameplay_collision_damage: () => true,
  };
  const stateful: BehaviorStateMachineDocumentSpec = {
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            behaviorRecipes: "enemy.idle",
          },
        },
      },
    },
  };
  const stateRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "enemy.idle": {
        recipes: [{ kind: "lifetime", seconds: 2 }],
      },
    },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(stateful, "enemy", { behaviorRecipes: stateRecipes });
  const plan = createBehaviorStateMachineStateCommandPlan(stateful, stateRecipes, installPlan, 1);

  const result = applyBehaviorStateMachineStateCommands(
    engine,
    plan,
    { entityId: 12, entityGeneration: 3 },
    { entity: "enemy-1", mode: "replaceSupported" },
  );

  deepEqual(result.results, [true, true, true, true, true, true, true, true, true, true, true]);
  deepEqual(calls, [
    "clearHealth:12:3",
    "clearDamage:12:3",
    "clearLifetime:12:3",
    "clearScoreReward:12:3",
    "clearPickup:12:3",
    "clearInteraction:12:3",
    "clearTimer:12:3",
    "clearActions:12:3",
    "clearMovement:12:3",
    "clearReactions:12:3",
    "lifetime:12:3:2",
  ]);
});

test("replaceSupported state command apply clears gameplay faction when runtime supports it", () => {
  const calls: string[] = [];
  const engine: GameplayBehaviorRuntimeEngine = {
    set_gameplay_health: () => true,
    clear_gameplay_health: () => {
      calls.push("clearHealth");
      return true;
    },
    set_gameplay_damage: () => true,
    clear_gameplay_damage: () => {
      calls.push("clearDamage");
      return true;
    },
    set_gameplay_faction: (_entityId, _entityGeneration, factionId, damageMask) => {
      calls.push(`faction:${factionId}:${damageMask}`);
      return true;
    },
    clear_gameplay_faction: () => {
      calls.push("clearFaction");
      return true;
    },
    set_gameplay_lifetime: () => true,
    clear_gameplay_lifetime: () => {
      calls.push("clearLifetime");
      return true;
    },
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: () => {
      calls.push("clearScoreReward");
      return true;
    },
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: () => {
      calls.push("clearPickup");
      return true;
    },
    set_gameplay_interaction: () => true,
    clear_gameplay_interaction: () => {
      calls.push("clearInteraction");
      return true;
    },
    clear_gameplay_timer_trigger: () => {
      calls.push("clearTimer");
      return true;
    },
    set_gameplay_action_projectile: () => true,
    clear_gameplay_actions: () => {
      calls.push("clearActions");
      return true;
    },
    set_gameplay_movement_chase_player: () => true,
    set_gameplay_movement_chase_entity: () => true,
    clear_gameplay_movement: () => {
      calls.push("clearMovement");
      return true;
    },
    clear_gameplay_collision_reactions: () => {
      calls.push("clearReactions");
      return true;
    },
    add_gameplay_collision_damage: () => true,
  };
  const factionFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      enemy: {
        initial: "hostile",
        states: {
          hostile: {
            behaviorRecipes: "enemy.hostile",
          },
        },
      },
    },
  };
  const factionRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "enemy.hostile": {
        recipes: [{ kind: "faction", faction: "enemy", damages: ["player"] }],
      },
    },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(factionFsm, "enemy", {
    behaviorRecipes: factionRecipes,
  });
  const plan = createBehaviorStateMachineStateCommandPlan(factionFsm, factionRecipes, installPlan, 1);

  const result = applyBehaviorStateMachineStateCommands(
    engine,
    plan,
    { entityId: 12, entityGeneration: 3 },
    { entity: "enemy-1", mode: "replaceSupported" },
  );

  deepEqual(result.results, [true, true, true, true, true, true, true, true, true, true, true, true]);
  deepEqual(calls, [
    "clearHealth",
    "clearDamage",
    "clearFaction",
    "clearLifetime",
    "clearScoreReward",
    "clearPickup",
    "clearInteraction",
    "clearTimer",
    "clearActions",
    "clearMovement",
    "clearReactions",
    "faction:2:2",
  ]);
});

test("replaceSupported state command apply clears then installs timer trigger state commands", () => {
  const calls: string[] = [];
  const engine: GameplayBehaviorRuntimeEngine = {
    set_gameplay_health: () => true,
    clear_gameplay_health: (entityId, entityGeneration) => {
      calls.push(`clearHealth:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_damage: () => true,
    clear_gameplay_damage: (entityId, entityGeneration) => {
      calls.push(`clearDamage:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_lifetime: () => true,
    clear_gameplay_lifetime: (entityId, entityGeneration) => {
      calls.push(`clearLifetime:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: (entityId, entityGeneration) => {
      calls.push(`clearScoreReward:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: (entityId, entityGeneration) => {
      calls.push(`clearPickup:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_interaction: () => true,
    clear_gameplay_interaction: (entityId, entityGeneration) => {
      calls.push(`clearInteraction:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_timer_trigger: (entityId, entityGeneration, timerId, durationSeconds) => {
      calls.push(`timer:${entityId}:${entityGeneration}:${timerId}:${durationSeconds}`);
      return true;
    },
    clear_gameplay_timer_trigger: (entityId, entityGeneration) => {
      calls.push(`clearTimer:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_action_projectile: () => true,
    clear_gameplay_actions: (entityId, entityGeneration) => {
      calls.push(`clearActions:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_movement_chase_player: () => true,
    set_gameplay_movement_chase_entity: () => true,
    clear_gameplay_movement: (entityId, entityGeneration) => {
      calls.push(`clearMovement:${entityId}:${entityGeneration}`);
      return true;
    },
    clear_gameplay_collision_reactions: (entityId, entityGeneration) => {
      calls.push(`clearReactions:${entityId}:${entityGeneration}`);
      return true;
    },
    add_gameplay_collision_damage: () => true,
  };
  const timerFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      switch: {
        initial: "waiting",
        states: {
          waiting: {
            behaviorRecipes: "switch.waiting",
          },
        },
      },
    },
  };
  const timerRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "switch.waiting": {
        recipes: [{ kind: "timerTrigger", timer: "wake", seconds: 0.5 }],
      },
    },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(timerFsm, "switch", {
    behaviorRecipes: timerRecipes,
  });
  const plan = createBehaviorStateMachineStateCommandPlan(timerFsm, timerRecipes, installPlan, 1);

  const result = applyBehaviorStateMachineStateCommands(
    engine,
    plan,
    { entityId: 12, entityGeneration: 3 },
    {
      entity: "switch-1",
      ids: { timers: { wake: 9 } },
      mode: "replaceSupported",
    },
  );

  deepEqual(result.results, [true, true, true, true, true, true, true, true, true, true, true]);
  deepEqual(calls, [
    "clearHealth:12:3",
    "clearDamage:12:3",
    "clearLifetime:12:3",
    "clearScoreReward:12:3",
    "clearPickup:12:3",
    "clearInteraction:12:3",
    "clearTimer:12:3",
    "clearActions:12:3",
    "clearMovement:12:3",
    "clearReactions:12:3",
    "timer:12:3:9:0.5",
  ]);
});

test("replaceSupported timer state commands preflight timer ids before clearing components", () => {
  const calls: string[] = [];
  const engine: GameplayBehaviorRuntimeEngine = {
    set_gameplay_health: () => true,
    clear_gameplay_health: () => {
      calls.push("clearHealth");
      return true;
    },
    set_gameplay_damage: () => true,
    clear_gameplay_damage: () => {
      calls.push("clearDamage");
      return true;
    },
    set_gameplay_lifetime: () => true,
    clear_gameplay_lifetime: () => {
      calls.push("clearLifetime");
      return true;
    },
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: () => {
      calls.push("clearScoreReward");
      return true;
    },
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: () => {
      calls.push("clearPickup");
      return true;
    },
    set_gameplay_interaction: () => true,
    clear_gameplay_interaction: () => {
      calls.push("clearInteraction");
      return true;
    },
    set_gameplay_timer_trigger: () => {
      calls.push("setTimer");
      return true;
    },
    clear_gameplay_timer_trigger: () => {
      calls.push("clearTimer");
      return true;
    },
    set_gameplay_action_projectile: () => true,
    clear_gameplay_actions: () => true,
    set_gameplay_movement_chase_player: () => true,
    set_gameplay_movement_chase_entity: () => true,
    clear_gameplay_movement: () => true,
    clear_gameplay_collision_reactions: () => true,
    add_gameplay_collision_damage: () => true,
  };
  const timerFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      switch: {
        initial: "waiting",
        states: {
          waiting: {
            behaviorRecipes: "switch.waiting",
          },
        },
      },
    },
  };
  const timerRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "switch.waiting": {
        recipes: [{ kind: "timerTrigger", timer: "wake", seconds: 0.5 }],
      },
    },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(timerFsm, "switch", {
    behaviorRecipes: timerRecipes,
  });
  const plan = createBehaviorStateMachineStateCommandPlan(timerFsm, timerRecipes, installPlan, 1);

  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      engine,
      plan,
      { entityId: 12, entityGeneration: 3 },
      { entity: "switch-1", mode: "replaceSupported" },
    ), /path='behaviorStateMachines\.commands\.0\.timer'/,
  );
  deepEqual(calls, []);
});

test("overlay state command apply preserves absent timer state", () => {
  const calls: string[] = [];
  const result = applyBehaviorStateMachineStateCommands(
    stateCommandRuntimeEngine(calls),
    emptyStateCommandPlan(),
    { entityId: 12, entityGeneration: 3 },
    { entity: "switch-1" },
  );

  deepEqual(result.results, []);
  deepEqual(calls, []);
});

test("overlay state command apply installs timer commands without explicit clear", () => {
  const calls: string[] = [];
  const result = applyBehaviorStateMachineStateCommands(
    stateCommandRuntimeEngine(calls),
    timerStateCommandPlan(),
    { entityId: 12, entityGeneration: 3 },
    {
      entity: "switch-1",
      ids: { timers: { wake: 9 } },
    },
  );

  deepEqual(result.results, [true]);
  deepEqual(calls, ["timer:12:3:9:0.5"]);
});

test("replaceSupported state command apply clears old timer without installing a new absent timer", () => {
  const calls: string[] = [];
  const result = applyBehaviorStateMachineStateCommands(
    stateCommandRuntimeEngine(calls),
    emptyStateCommandPlan(),
    { entityId: 12, entityGeneration: 3 },
    { entity: "switch-1", mode: "replaceSupported" },
  );

  deepEqual(result.results, [true, true, true, true, true, true, true, true, true, true]);
  deepEqual(calls, [
    "clearHealth:12:3",
    "clearDamage:12:3",
    "clearLifetime:12:3",
    "clearScoreReward:12:3",
    "clearPickup:12:3",
    "clearInteraction:12:3",
    "clearTimer:12:3",
    "clearActions:12:3",
    "clearMovement:12:3",
    "clearReactions:12:3",
  ]);
});

test("replaceSupported state command apply requires timer clear runtime support", () => {
  const calls: string[] = [];
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { omitTimerClear: true }),
      timerStateCommandPlan(),
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "switch-1",
        ids: { timers: { wake: 9 } },
        mode: "replaceSupported",
      },
    ), /path='behaviorStateMachines\.clear\.timerTrigger'/,
  );
  deepEqual(calls, []);
});

test("preflightBehaviorStateMachineStateCommands validates replaceSupported plans without mutating runtime", () => {
  const calls: string[] = [];
  const result = preflightBehaviorStateMachineStateCommands(
    stateCommandRuntimeEngine(calls),
    timerStateCommandPlan(),
    { entityId: 12, entityGeneration: 3 },
    {
      entity: "switch-1",
      ids: { timers: { wake: 9 } },
      mode: "replaceSupported",
    },
  );

  equal(result.mode, "replaceSupported");
  equal(result.plan.targetEntity, "switch-1");
  deepEqual(result.commands.map((command) => command.type), ["configureTimerTrigger"]);
  deepEqual(result.results, [true]);
  deepEqual(result.clearOperations, [
    "health",
    "damage",
    "lifetime",
    "scoreReward",
    "pickup",
    "interaction",
    "timerTrigger",
    "actions",
    "movement",
    "collisionReactions",
  ]);
  deepEqual(calls, []);
});

test("preflightBehaviorStateMachineStateCommands reports missing replaceSupported clear support without mutating runtime", () => {
  const calls: string[] = [];
  expectMessage(() =>
    preflightBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { omitTimerClear: true }),
      timerStateCommandPlan(),
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "switch-1",
        ids: { timers: { wake: 9 } },
        mode: "replaceSupported",
      },
    ), /path='behaviorStateMachines\.clear\.timerTrigger'/,
  );
  deepEqual(calls, []);
});

test("preflightBehaviorStateMachineStateCommands supports current state command vocabulary without mutating runtime", () => {
  const calls: string[] = [];
  const stateful: BehaviorStateMachineDocumentSpec = {
    machines: {
      source: {
        initial: "armed",
        states: {
          armed: {
            behaviorRecipes: ["source.damage", "source.timer"],
          },
        },
      },
    },
  };
  const stateRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "source.damage": {
        recipes: [{ kind: "damage", amount: 1, target: "other", cooldownSeconds: 0 }],
      },
      "source.timer": {
        recipes: [{ kind: "timerTrigger", timer: "wake", action: "summon", seconds: 0.5 }],
      },
    },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(stateful, "source", {
    behaviorRecipes: stateRecipes,
    ids: {
      actions: { summon: 11 },
      timers: { wake: 9 },
    },
  });
  const plan = createBehaviorStateMachineStateCommandPlan(stateful, stateRecipes, installPlan, 1, {
    entity: "source-1",
  });

  const result = preflightBehaviorStateMachineStateCommands(
    stateCommandRuntimeEngine(calls),
    plan,
    { entityId: 12, entityGeneration: 3 },
    {
      entity: "source-1",
      ids: {
        actions: { summon: 11 },
        timers: { wake: 9 },
      },
      mode: "replaceSupported",
    },
  );

  deepEqual(result.commands.map((command) => command.type), ["configureDamage", "configureTimerTrigger"]);
  deepEqual(result.results, [true, true]);
  deepEqual(calls, []);
});

test("replaceSupported state command apply preflights actual runtime command capability before clearing components", () => {
  const calls: string[] = [];
  const stateful: BehaviorStateMachineDocumentSpec = {
    machines: {
      source: {
        initial: "armed",
        states: {
          armed: {
            behaviorRecipes: "source.timer",
          },
        },
      },
    },
  };
  const stateRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "source.timer": {
        recipes: [{ kind: "timerTrigger", timer: "wake", action: "summon", seconds: 0.5 }],
      },
    },
  };
  const ids = {
    actions: { summon: 11 },
    timers: { wake: 9 },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(stateful, "source", {
    behaviorRecipes: stateRecipes,
    ids,
  });
  const plan = createBehaviorStateMachineStateCommandPlan(stateful, stateRecipes, installPlan, 1, {
    entity: "source-1",
  });

  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { omitTimerActionTrigger: true }),
      plan,
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "source-1",
        ids,
        mode: "replaceSupported",
      },
    ), /path='behaviorStateMachines\.commands\.0\.type'.*set_gameplay_timer_action_trigger/,
  );
  deepEqual(calls, []);
});

test("replaceSupported state command apply preflights stale runtime handles before clearing components", () => {
  const calls: string[] = [];
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { staleEntity: true }),
      timerStateCommandPlan(),
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "switch-1",
        ids: { timers: { wake: 9 } },
        mode: "replaceSupported",
      },
    ), /path='behaviorStateMachines\.entityHandle'.*stale or missing runtime entity handle/,
  );
  deepEqual(calls, []);
});

test("replaceSupported state command apply restores snapshot when apply fails", () => {
  const calls: string[] = [];
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { transactionHooks: true, timerApplyResult: false }),
      timerStateCommandPlan(),
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "switch-1",
        ids: { timers: { wake: 9 } },
        mode: "replaceSupported",
      },
    ), /path='behaviorStateMachines\.commands\.0'.*configureTimerTrigger/,
  );
  deepEqual(calls, [
    "capture:12:3",
    "clearHealth:12:3",
    "clearDamage:12:3",
    "clearLifetime:12:3",
    "clearScoreReward:12:3",
    "clearPickup:12:3",
    "clearInteraction:12:3",
    "clearTimer:12:3",
    "clearActions:12:3",
    "clearMovement:12:3",
    "clearReactions:12:3",
    "timer:12:3:9:0.5",
    "restore:12:3",
    "clearSnapshot",
  ]);
});

test("replaceSupported state command apply restores snapshot when clear fails", () => {
  const calls: string[] = [];
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { transactionHooks: true, clearTimerResult: false }),
      timerStateCommandPlan(),
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "switch-1",
        ids: { timers: { wake: 9 } },
        mode: "replaceSupported",
      },
    ), /path='behaviorStateMachines\.clear\.timerTrigger'.*clear gameplay timer trigger/,
  );
  deepEqual(calls, [
    "capture:12:3",
    "clearHealth:12:3",
    "clearDamage:12:3",
    "clearLifetime:12:3",
    "clearScoreReward:12:3",
    "clearPickup:12:3",
    "clearInteraction:12:3",
    "clearTimer:12:3",
    "restore:12:3",
    "clearSnapshot",
  ]);
});

test("replaceSupported state command apply restores snapshot when apply throws", () => {
  const calls: string[] = [];
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { transactionHooks: true, timerApplyThrows: true }),
      timerStateCommandPlan(),
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "switch-1",
        ids: { timers: { wake: 9 } },
        mode: "replaceSupported",
      },
    ), /timer setter exploded/,
  );
  deepEqual(calls, [
    "capture:12:3",
    "clearHealth:12:3",
    "clearDamage:12:3",
    "clearLifetime:12:3",
    "clearScoreReward:12:3",
    "clearPickup:12:3",
    "clearInteraction:12:3",
    "clearTimer:12:3",
    "clearActions:12:3",
    "clearMovement:12:3",
    "clearReactions:12:3",
    "timer:12:3:9:0.5",
    "restore:12:3",
    "clearSnapshot",
  ]);
});

test("replaceSupported state command apply preserves legacy non-transactional behavior without hooks", () => {
  const calls: string[] = [];
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { timerApplyResult: false }),
      timerStateCommandPlan(),
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "switch-1",
        ids: { timers: { wake: 9 } },
        mode: "replaceSupported",
      },
    ), /path='behaviorStateMachines\.commands\.0'.*configureTimerTrigger/,
  );
  deepEqual(calls, [
    "clearHealth:12:3",
    "clearDamage:12:3",
    "clearLifetime:12:3",
    "clearScoreReward:12:3",
    "clearPickup:12:3",
    "clearInteraction:12:3",
    "clearTimer:12:3",
    "clearActions:12:3",
    "clearMovement:12:3",
    "clearReactions:12:3",
    "timer:12:3:9:0.5",
  ]);
});

test("replaceSupported state command apply does not clear when snapshot capture fails", () => {
  const calls: string[] = [];
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      stateCommandRuntimeEngine(calls, { transactionHooks: true, captureResult: false }),
      timerStateCommandPlan(),
      { entityId: 12, entityGeneration: 3 },
      {
        entity: "switch-1",
        ids: { timers: { wake: 9 } },
        mode: "replaceSupported",
      },
    ), /path='behaviorStateMachines\.transaction\.capture'/,
  );
  deepEqual(calls, ["capture:12:3", "clearSnapshot"]);
});

test("replaceSupported state command apply preflights commands before clearing components", () => {
  const calls: string[] = [];
  const engine: GameplayBehaviorRuntimeEngine = {
    set_gameplay_health: () => true,
    clear_gameplay_health: () => {
      calls.push("clearHealth");
      return true;
    },
    set_gameplay_damage: () => true,
    clear_gameplay_damage: () => {
      calls.push("clearDamage");
      return true;
    },
    set_gameplay_lifetime: () => true,
    clear_gameplay_lifetime: () => {
      calls.push("clearLifetime");
      return true;
    },
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: () => {
      calls.push("clearScoreReward");
      return true;
    },
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: () => {
      calls.push("clearPickup");
      return true;
    },
    set_gameplay_interaction: () => {
      calls.push("setInteraction");
      return true;
    },
    clear_gameplay_interaction: () => {
      calls.push("clearInteraction");
      return true;
    },
    clear_gameplay_timer_trigger: () => true,
    set_gameplay_action_projectile: () => true,
    clear_gameplay_actions: () => true,
    set_gameplay_movement_chase_player: () => true,
    set_gameplay_movement_chase_entity: () => true,
    clear_gameplay_movement: () => {
      calls.push("clearMovement");
      return true;
    },
    clear_gameplay_collision_reactions: () => {
      calls.push("clearReactions");
      return true;
    },
    add_gameplay_collision_damage: () => true,
  };
  const stateful: BehaviorStateMachineDocumentSpec = {
    machines: {
      switch: {
        initial: "armed",
        states: {
          armed: {
            behaviorRecipes: "switch.armed",
          },
        },
      },
    },
  };
  const stateRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "switch.armed": {
        recipes: [{ kind: "interaction", action: "open", radius: 24 }],
      },
    },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(stateful, "switch", {
    behaviorRecipes: stateRecipes,
  });
  const plan = createBehaviorStateMachineStateCommandPlan(stateful, stateRecipes, installPlan, 1);

  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(
      engine,
      plan,
      { entityId: 12, entityGeneration: 3 },
      { entity: "switch-1", mode: "replaceSupported" },
    ), /path='behaviorStateMachines\.commands\.0\.action'/,
  );
  deepEqual(calls, []);
});

test("state command plan reports unknown runtime state IDs and missing apply target", () => {
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(fsm, "enemy", { behaviorRecipes: recipes });
  expectMessage(() =>
    createBehaviorStateMachineStateCommandPlan(fsm, recipes, installPlan, 0), /must reference an installed behavior state machine state/,
  );
  expectMessage(() =>
    createBehaviorStateMachineStateCommandPlan(fsm, recipes, installPlan, 99), /unknown runtime state id.*99/,
  );

  const queryPlan = createBehaviorStateMachineCurrentStateCommandPlan(
    { gameplay_behavior_state: () => 1 },
    fsm,
    recipes,
    installPlan,
    { entityId: 12, entityGeneration: 3 },
    { entity: "enemy-1" },
  );
  equal(queryPlan.state, "chasing");

  const plan = createBehaviorStateMachineStateCommandPlan(fsm, recipes, installPlan, 1);
  const engine: GameplayBehaviorRuntimeEngine = {
    set_gameplay_health: () => true,
    clear_gameplay_health: () => true,
    set_gameplay_damage: () => true,
    clear_gameplay_damage: () => true,
    set_gameplay_lifetime: () => true,
    clear_gameplay_lifetime: () => true,
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: () => true,
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: () => true,
    set_gameplay_interaction: () => true,
    clear_gameplay_interaction: () => true,
    set_gameplay_action_projectile: () => true,
    clear_gameplay_timer_trigger: () => true,
    clear_gameplay_actions: () => true,
    set_gameplay_movement_chase_player: () => true,
    set_gameplay_movement_chase_entity: () => true,
    add_gameplay_collision_damage: () => true,
  };
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(engine, plan, { entityId: 12, entityGeneration: 3 }), /path='behaviorStateMachines\.entity'/,
  );
  expectMessage(() =>
    applyBehaviorStateMachineStateCommands(engine, plan, { entityId: 12, entityGeneration: 3 }, {
      entity: "enemy-1",
      mode: "replaceSupported",
    }), /path='behaviorStateMachines\.clear\.movement'/,
  );
});

test("resolveBehaviorStateMachineDocument reports machine-actionable diagnostics", () => {
  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      enemy: {
        initial: "missing",
        states: {
          idle: {},
        },
      },
    },
  }), /path='behaviorStateMachines\.machines\.enemy\.initial'/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "missing",
              when: { type: "gameplayEvent", event: "interaction", action: "wake" },
            }],
          },
        },
      },
    },
  }), /path='behaviorStateMachines\.machines\.enemy\.states\.idle\.transitions\.0\.to'/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [
              {
                id: "wake",
                to: "idle",
                when: { type: "gameplayEvent", event: "interaction", action: "wake" },
              },
              {
                id: "wake",
                to: "idle",
                when: { type: "gameplayEvent", event: "interaction", actionId: 4 },
              },
            ],
          },
        },
      },
    },
  }), /transition id must be unique per state/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            behaviorRecipes: "missing.profile",
          },
        },
      },
    },
  }, { behaviorRecipes: recipes }), /missing\.profile/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "idle",
              when: { type: "gameplayEvent", event: "interaction" },
            }],
          },
        },
      },
    },
  }), /must declare action or actionId/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "idle",
              when: { type: "gameplayEvent", event: "collisionDamage", actionId: 4 },
            }],
          },
        },
      },
    },
  }), /must not declare action or actionId/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "idle",
              when: { type: "gameplayEvent", event: "pickupCollected" },
            }],
          },
        },
      },
    },
  } as unknown as BehaviorStateMachineDocumentSpec), /must declare item or itemId/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      projectile: {
        initial: "flying",
        states: {
          flying: {
            transitions: [{
              to: "spent",
              when: { type: "gameplayEvent", event: "tileImpact" },
            }],
          },
          spent: {},
        },
      },
    },
  } as unknown as BehaviorStateMachineDocumentSpec), /must declare tileImpact or tileImpactCode/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "idle",
              when: { type: "gameplayEvent", event: "timer", timerId: 1, tileImpact: "despawn" },
            }],
          },
        },
      },
    },
  } as unknown as BehaviorStateMachineDocumentSpec), /must not declare tileImpact or tileImpactCode/);

  expectMessage(() => createBehaviorStateMachineRuntimeInstallPlan({
    machines: {
      projectile: {
        initial: "flying",
        states: {
          flying: {
            transitions: [{
              to: "spent",
              when: { type: "gameplayEvent", event: "tileImpact", tileImpactCode: 3 },
            }],
          },
          spent: {},
        },
      },
    },
  } as unknown as BehaviorStateMachineDocumentSpec, "projectile"), /tile impact predicate code/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      projectile: {
        initial: "flying",
        states: {
          flying: {
            transitions: [{
              to: "spent",
              when: { type: "gameplayEvent", event: "tileImpact", tileImpact: "passThrough" },
            }],
          },
          spent: {},
        },
      },
    },
  } as unknown as BehaviorStateMachineDocumentSpec), /passThrough does not emit tileImpact telemetry/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      projectile: {
        initial: "flying",
        states: {
          flying: {
            transitions: [{
              to: "spent",
              when: { type: "gameplayEvent", event: "tileImpact", tileImpactCode: 1 },
            }],
          },
          spent: {},
        },
      },
    },
  } as unknown as BehaviorStateMachineDocumentSpec), /predicate code 0 .* or 2/);

  expectMessage(() => resolveBehaviorStateMachineDocument({
    machines: {
      projectile: {
        initial: "flying",
        states: {
          flying: {
            transitions: [{
              to: "spent",
              when: { type: "gameplayEvent", event: "tileImpact", tileImpact: "despawn", tileImpactCode: 2 },
            }],
          },
          spent: {},
        },
      },
    },
  } as unknown as BehaviorStateMachineDocumentSpec), /tileImpact and tileImpactCode must describe the same/);

  expectMessage(() => runBehaviorStateMachineReplay(fsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [{ frame: -1 }],
  }, {
    behaviorRecipes: recipes,
  }), /path='behaviorStateMachineReplay\.frames\.0\.frame'/);

  expectMessage(() => runBehaviorStateMachineReplay(fsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [],
  }), /must provide behaviorRecipes/);

  expectMessage(() => runBehaviorStateMachineReplay({
    machines: {
      enemy: {
        initial: "idle",
        states: {
          idle: {
            transitions: [{
              to: "idle",
              when: { type: "gameplayEvent", event: "interaction", action: "wake" },
            }],
          },
        },
      },
    },
  }, {
    machine: "enemy",
    entity: replayEntity,
    frames: [],
  }, {
    behaviorRecipes: recipes,
  }), /must resolve interaction action \\'wake\\' to a runtime action id/);

  expectMessage(() => runBehaviorStateMachineReplay(fsm, {
    machine: "enemy",
    entity: replayEntity,
    frames: [{ frame: 1 }, { frame: 1 }],
  }, {
    behaviorRecipes: recipes,
  }), /strictly increasing/);
});

function interactionAction(
  actionId: number,
  action: string,
  actorGeneration = 0,
): GameplayInteractionEventAction {
  return {
    type: "interaction" as const,
    actionId,
    action,
    actor: { entityId: 1, entityGeneration: actorGeneration },
    source: { entityId: 2, entityGeneration: 0 },
    once: false,
    consumedThisFrame: false,
    flags: 0,
    payloadBits: 0,
    event: {
      kind: "interaction",
      kindCode: 1,
      actorId: 1,
      actorGeneration,
      sourceId: 2,
      sourceGeneration: 0,
      tokenId: actionId,
      flags: 0,
      payloadBits: 0,
      once: false,
      consumedThisFrame: false,
      targetRemoved: false,
    },
  };
}

function collisionDamageAction(
  options: { sourceEntityId?: number; sourceEntityGeneration?: number } = {},
): GameplayCollisionDamageEventAction {
  const sourceEntityId = options.sourceEntityId ?? 2;
  const sourceEntityGeneration = options.sourceEntityGeneration ?? 0;
  return {
    type: "collisionDamage",
    actor: { entityId: 1, entityGeneration: 0 },
    source: { entityId: sourceEntityId, entityGeneration: sourceEntityGeneration },
    damage: 1,
    targetRemoved: true,
    flags: 4,
    payloadBits: 0x3f800000,
    event: {
      kind: "collisionDamage",
      kindCode: 2,
      actorId: 1,
      actorGeneration: 0,
      sourceId: sourceEntityId,
      sourceGeneration: sourceEntityGeneration,
      tokenId: 0,
      flags: 4,
      payloadBits: 0x3f800000,
      once: false,
      consumedThisFrame: false,
      targetRemoved: true,
    },
  };
}

function timerAction(timerId: number, durationSeconds: number): GameplayTimerEventAction {
  return {
    type: "timer",
    actor: { entityId: 2, entityGeneration: 0 },
    source: { entityId: 2, entityGeneration: 0 },
    timerId,
    durationSeconds,
    flags: 0,
    payloadBits: 0x3e800000,
    event: {
      kind: "timer",
      kindCode: 7,
      actorId: 2,
      actorGeneration: 0,
      sourceId: 2,
      sourceGeneration: 0,
      tokenId: timerId,
      flags: 0,
      payloadBits: 0x3e800000,
      once: false,
      consumedThisFrame: false,
      targetRemoved: false,
    },
  };
}

function pickupCollectedAction(
  options: { actorEntityId?: number; actorEntityGeneration?: number; sourceEntityId?: number; sourceEntityGeneration?: number } = {},
): GameplayPickupCollectedEventAction {
  const actorEntityId = options.actorEntityId ?? 2;
  const actorEntityGeneration = options.actorEntityGeneration ?? 0;
  const sourceEntityId = options.sourceEntityId ?? 4;
  const sourceEntityGeneration = options.sourceEntityGeneration ?? 0;
  return {
    type: "pickupCollected",
    actor: { entityId: actorEntityId, entityGeneration: actorEntityGeneration },
    source: { entityId: sourceEntityId, entityGeneration: sourceEntityGeneration },
    itemId: 1,
    count: 3,
    targetRemoved: true,
    flags: 4,
    payloadBits: 3,
    event: {
      kind: "pickupCollected",
      kindCode: 8,
      actorId: actorEntityId,
      actorGeneration: actorEntityGeneration,
      sourceId: sourceEntityId,
      sourceGeneration: sourceEntityGeneration,
      tokenId: 1,
      flags: 4,
      payloadBits: 3,
      once: false,
      consumedThisFrame: false,
      targetRemoved: true,
    },
  };
}

function tileImpactAction(
  options: {
    sourceEntityId?: number;
    sourceEntityGeneration?: number;
    tileImpactCode?: number;
    tileImpact?: GameplayTileImpactEventAction["tileImpact"];
    targetRemoved?: boolean;
    bounced?: boolean;
  } = {},
): GameplayTileImpactEventAction {
  const sourceEntityId = options.sourceEntityId ?? 2;
  const sourceEntityGeneration = options.sourceEntityGeneration ?? 0;
  const tileImpactCode = options.tileImpactCode ?? 0;
  const tileImpact = options.tileImpact ?? "despawn";
  const targetRemoved = options.targetRemoved ?? true;
  const bounced = options.bounced ?? false;
  const flags = 516;
  const payloadBits = 0;
  return {
    type: "tileImpact",
    actor: { entityId: sourceEntityId, entityGeneration: sourceEntityGeneration },
    source: { entityId: sourceEntityId, entityGeneration: sourceEntityGeneration },
    projectile: { entityId: sourceEntityId, entityGeneration: sourceEntityGeneration },
    tileImpactCode,
    tileImpact,
    layerIndex: 0,
    tileIndex: 0,
    normal: "negativeX",
    bounced,
    identityTruncated: false,
    targetRemoved,
    flags,
    payloadBits,
    event: {
      kind: "tileImpact",
      kindCode: 9,
      actorId: sourceEntityId,
      actorGeneration: sourceEntityGeneration,
      sourceId: sourceEntityId,
      sourceGeneration: sourceEntityGeneration,
      tokenId: tileImpactCode,
      flags,
      payloadBits,
      once: false,
      consumedThisFrame: false,
      targetRemoved,
    },
  };
}

function animationFrameAction(tokenId: number): GameplayAnimationFrameEventAction {
  const payloadBits = (2 << 16) | 1;
  return {
    type: "animationFrame",
    actor: { entityId: 2, entityGeneration: 0 },
    source: { entityId: 2, entityGeneration: 0 },
    tokenId,
    eventKind: 1,
    clipId: 2,
    frame: 1,
    flags: 1,
    payloadBits,
    event: {
      kind: "animationFrame",
      kindCode: 12,
      actorId: 2,
      actorGeneration: 0,
      sourceId: 2,
      sourceGeneration: 0,
      tokenId,
      flags: 1,
      payloadBits,
      once: false,
      consumedThisFrame: false,
      targetRemoved: false,
    },
  };
}

function timerStateCommandPlan() {
  const timerFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      switch: {
        initial: "waiting",
        states: {
          waiting: {
            behaviorRecipes: "switch.waiting",
          },
        },
      },
    },
  };
  const timerRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      "switch.waiting": {
        recipes: [{ kind: "timerTrigger", timer: "wake", seconds: 0.5 }],
      },
    },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(timerFsm, "switch", {
    behaviorRecipes: timerRecipes,
  });
  return createBehaviorStateMachineStateCommandPlan(timerFsm, timerRecipes, installPlan, 1);
}

function emptyStateCommandPlan() {
  const emptyFsm: BehaviorStateMachineDocumentSpec = {
    machines: {
      switch: {
        initial: "waiting",
        states: {
          waiting: {},
        },
      },
    },
  };
  const emptyRecipes: BehaviorRecipeDocumentSpec = {
    entities: {
      unused: {
        recipes: [{ kind: "lifetime", seconds: 1 }],
      },
    },
  };
  const installPlan = createBehaviorStateMachineRuntimeInstallPlan(emptyFsm, "switch", {
    behaviorRecipes: emptyRecipes,
  });
  return createBehaviorStateMachineStateCommandPlan(emptyFsm, emptyRecipes, installPlan, 1);
}

function stateCommandRuntimeEngine(
  calls: string[],
  options: {
    omitTimerClear?: boolean;
    omitTimerActionTrigger?: boolean;
    staleEntity?: boolean;
    transactionHooks?: boolean;
    captureResult?: boolean;
    clearTimerResult?: boolean;
    timerApplyResult?: boolean;
    timerApplyThrows?: boolean;
  } = {},
): GameplayBehaviorRuntimeEngine {
  return {
    gameplay_entity_exists: () => options.staleEntity !== true,
    ...(options.transactionHooks
      ? {
          capture_gameplay_authoring_snapshot: (entityId: number, entityGeneration: number) => {
            calls.push(`capture:${entityId}:${entityGeneration}`);
            return options.captureResult ?? true;
          },
          restore_gameplay_authoring_snapshot: (entityId: number, entityGeneration: number) => {
            calls.push(`restore:${entityId}:${entityGeneration}`);
            return true;
          },
          clear_gameplay_authoring_snapshot: () => {
            calls.push("clearSnapshot");
          },
        }
      : {}),
    set_gameplay_health: () => true,
    clear_gameplay_health: (entityId, entityGeneration) => {
      calls.push(`clearHealth:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_damage: () => true,
    set_gameplay_damage_reaction: () => true,
    clear_gameplay_damage: (entityId, entityGeneration) => {
      calls.push(`clearDamage:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_lifetime: () => true,
    clear_gameplay_lifetime: (entityId, entityGeneration) => {
      calls.push(`clearLifetime:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_score_reward: () => true,
    clear_gameplay_score_reward: (entityId, entityGeneration) => {
      calls.push(`clearScoreReward:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_pickup: () => true,
    clear_gameplay_pickup: (entityId, entityGeneration) => {
      calls.push(`clearPickup:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_interaction: () => true,
    clear_gameplay_interaction: (entityId, entityGeneration) => {
      calls.push(`clearInteraction:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_timer_trigger: (entityId, entityGeneration, timerId, durationSeconds) => {
      calls.push(`timer:${entityId}:${entityGeneration}:${timerId}:${durationSeconds}`);
      if (options.timerApplyThrows) {
        throw new Error("timer setter exploded");
      }
      return options.timerApplyResult ?? true;
    },
    ...(options.omitTimerActionTrigger
      ? {}
      : {
          set_gameplay_timer_action_trigger: (
            entityId: number,
            entityGeneration: number,
            timerId: number,
            durationSeconds: number,
            actionId: number,
          ) => {
            calls.push(`timerAction:${entityId}:${entityGeneration}:${timerId}:${durationSeconds}:${actionId}`);
            return true;
          },
        }),
    ...(options.omitTimerClear
      ? {}
      : {
          clear_gameplay_timer_trigger: (entityId: number, entityGeneration: number) => {
            calls.push(`clearTimer:${entityId}:${entityGeneration}`);
            return options.clearTimerResult ?? true;
          },
        }),
    set_gameplay_action_projectile: () => true,
    clear_gameplay_actions: (entityId, entityGeneration) => {
      calls.push(`clearActions:${entityId}:${entityGeneration}`);
      return true;
    },
    set_gameplay_movement_chase_player: () => true,
    set_gameplay_movement_chase_entity: () => true,
    clear_gameplay_movement: (entityId, entityGeneration) => {
      calls.push(`clearMovement:${entityId}:${entityGeneration}`);
      return true;
    },
    clear_gameplay_collision_reactions: (entityId, entityGeneration) => {
      calls.push(`clearReactions:${entityId}:${entityGeneration}`);
      return true;
    },
    add_gameplay_collision_damage: () => true,
  };
}

function expectMessage(fn: () => void, pattern: RegExp): void {
  try {
    fn();
  } catch (error) {
    equal(error instanceof Error, true);
    equal(pattern.test(error instanceof Error ? error.message : String(error)), true);
    return;
  }
  throw new Error("Expected function to throw.");
}
