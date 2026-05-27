import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import {
  CutsceneSequencePlayer,
  applyCutsceneSequenceEvent,
  resolveCutsceneSequenceSpec,
} from "../src/cutsceneSequence.js";
import { diagnosticReport } from "../src/diagnostics.js";

test("resolveCutsceneSequenceSpec normalizes wait, camera, audio, and dialogue commands", () => {
  const sequence = resolveCutsceneSequenceSpec({
    id: "intro",
    commands: [
      { kind: "wait", durationSeconds: 0.25 },
      { kind: "camera", target: { x: 24, y: -8 }, durationSeconds: 0.5, easing: "easeInOut" },
      { kind: "audio", sound: "intro-bgm", bus: "bgm", loop: true, volume: 0.5, fadeSeconds: 0.25 },
      { kind: "dialogue", speaker: "Guide", text: "Move with WASD.", durationSeconds: 1 },
    ],
  });

  equal(sequence.id, "intro");
  equal(sequence.durationSeconds, 1.75);
  equal(sequence.commands[1]?.kind, "camera");
  equal(sequence.commands[1]?.startSeconds, 0.25);
  equal(sequence.commands[2]?.endSeconds, 0.75);
  equal(sequence.commands[3]?.id, "dialogue-3");
});

test("CutsceneSequencePlayer emits commands in timeline order and applies target adapters", () => {
  const player = CutsceneSequencePlayer.create({
    id: "tutorial",
    commands: [
      { kind: "wait", durationSeconds: 0.1 },
      { kind: "camera", target: { x: 10, y: 20 }, durationSeconds: 0.2 },
      { kind: "audio", sound: "ding" },
      { kind: "dialogue", nodeId: "intro", durationSeconds: 0.1 },
    ],
  });
  const calls: string[] = [];
  const target = {
    onCutsceneCommand: (event: { command: { kind: string } }) => calls.push(`command:${event.command.kind}`),
    moveCamera: (command: { target: { x: number } }) => calls.push(`camera:${command.target.x}`),
    playCutsceneAudio: (command: { sound: string | number }) => calls.push(`audio:${command.sound}`),
    showCutsceneDialogue: (command: { nodeId?: string }) => calls.push(`dialogue:${command.nodeId}`),
  };

  const first = player.update(0, { target });
  deepEqual(first.events.map((event) => event.command.kind), ["wait"]);
  equal(first.snapshot.commandProgress, 0);

  const second = player.update(0.35, { target });
  deepEqual(second.events.map((event) => event.command.kind), ["camera", "audio", "dialogue"]);
  equal(second.snapshot.currentCommand?.kind, "dialogue");
  ok(Math.abs(second.snapshot.commandElapsedSeconds - 0.05) < 1e-9);

  const done = player.update(0.05, { target });
  equal(done.completed, true);
  deepEqual(calls, [
    "command:wait",
    "command:camera",
    "camera:10",
    "command:audio",
    "audio:ding",
    "command:dialogue",
    "dialogue:intro",
  ]);
});

test("CutsceneSequencePlayer supports looped sequences with a zero-duration command guard", () => {
  const looped = CutsceneSequencePlayer.create({
    id: "pulse",
    loop: true,
    commands: [
      { kind: "audio", sound: 1 },
      { kind: "wait", durationSeconds: 0.1 },
    ],
  });

  const result = looped.update(0.25);
  equal(result.completed, false);
  equal(result.snapshot.currentCommand?.kind, "wait");
  ok(result.events.length >= 3);
});

test("applyCutsceneSequenceEvent routes a single resolved event", () => {
  const sequence = resolveCutsceneSequenceSpec({
    commands: [
      { kind: "camera", target: { x: 4, y: 8 } },
    ],
  });
  const event = {
    type: "command" as const,
    sequenceId: sequence.id,
    commandIndex: 0,
    command: sequence.commands[0],
    elapsedSeconds: 0,
  };
  const calls: string[] = [];

  applyCutsceneSequenceEvent({
    moveCamera: (command) => calls.push(`${command.target.x},${command.target.y}`),
  }, event);

  deepEqual(calls, ["4,8"]);
});

test("resolveCutsceneSequenceSpec reports diagnostic path context", () => {
  try {
    resolveCutsceneSequenceSpec({
      commands: [
        { kind: "dialogue", durationSeconds: 1 },
      ],
    });
  } catch (error) {
    const report = diagnosticReport(error);
    equal(report.code, "FERRUM_CUTSCENE_SEQUENCE_INVALID");
    equal(report.context?.path, "cutscene.commands[0]");
    return;
  }
  throw new Error("Expected invalid cutscene sequence to throw.");
});
