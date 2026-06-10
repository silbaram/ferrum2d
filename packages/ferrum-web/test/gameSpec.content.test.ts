import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  createShooterContentRuntimeOptions,
  resolveShooterContentRuntimeSelection,
  resolveShooterGameSpec,
} from "../src/gameSpec.js";

test("resolveShooterGameSpec resolves enemy presets, waves, and audio policy", () => {
  const spec = resolveShooterGameSpec({
    enemies: {
      speed: 70,
      spawnInterval: 1,
      behavior: "chase",
      spawnPattern: "edge",
      health: 1,
      scoreReward: 1,
      presets: {
        bruiser: {
          speed: 55,
          behavior: "static",
          spawnPattern: "center",
          health: 4,
          scoreReward: 8,
        },
      },
      waves: [
        { enemy: "bruiser", duration: 12, spawnInterval: 1.5, enemyCount: 6 },
        { duration: 8, enemyCount: 4, spawnPattern: "corners" },
      ],
    },
    audio: {
      masterVolume: 0.9,
      sfxVolume: 0.7,
      events: {
        shoot: { volume: 0.25, pitch: 1.1 },
        hit: { volume: 0.5, pitch: 0.95 },
        gameOver: { volume: 0.8, pitch: 0.75 },
      },
    },
  });

  deepEqual(spec.waves, [
    {
      index: 0,
      enemy: "bruiser",
      duration: 12,
      spawnInterval: 1.5,
      enemyCount: 6,
      enemySpeed: 55,
      enemyBehavior: "static",
      enemyBehaviorCode: 2,
      enemySpawnPattern: "center",
      enemySpawnPatternCode: 2,
      enemyHealth: 4,
      scoreReward: 8,
    },
    {
      index: 1,
      enemy: "default",
      duration: 8,
      spawnInterval: 1,
      enemyCount: 4,
      enemySpeed: 70,
      enemyBehavior: "chase",
      enemyBehaviorCode: 0,
      enemySpawnPattern: "corners",
      enemySpawnPatternCode: 1,
      enemyHealth: 1,
      scoreReward: 1,
    },
  ]);
  equal(spec.audioMasterVolume, 0.9);
  equal(spec.audioSfxVolume, 0.7);
  equal(spec.shootVolume, 0.25);
  equal(spec.shootPitch, 1.1);
  equal(spec.hitVolume, 0.5);
  equal(spec.hitPitch, 0.95);
  equal(spec.gameOverVolume, 0.8);
  equal(spec.gameOverPitch, 0.75);
});

test("resolveShooterGameSpec resolves content localization, dialogue, and cutscenes", () => {
  const spec = resolveShooterGameSpec({
    content: {
      localization: {
        defaultLocale: "en",
        fallbackLocale: "en",
        locales: {
          en: {
            strings: {
              "intro.ready": "Ready?",
              "intro.choice": { text: "Start patrol", description: "Intro dialogue choice" },
              "intro.done": "Move out.",
            },
          },
          ko: {
            strings: {
              "intro.ready": "준비됐나요?",
            },
          },
        },
      },
      dialogue: {
        graphs: {
          intro: {
            initialNode: "start",
            nodes: {
              start: {
                speaker: "Guide",
                text: "intro.ready",
                choices: [{ id: "start", label: "intro.choice", to: "done" }],
              },
              done: { text: "intro.done", end: true },
            },
          },
        },
      },
      cutscenes: {
        intro: {
          id: "intro",
          commands: [
            { kind: "dialogue", graphId: "intro", nodeId: "start", durationSeconds: 1 },
            { kind: "wait", durationSeconds: 0.25 },
          ],
        },
      },
    },
  });

  equal(spec.content.localization?.defaultLocale, "en");
  equal(spec.content.localization?.locales.en.strings["intro.choice"].description, "Intro dialogue choice");
  equal(spec.content.dialogueGraphs.intro.initialNode, "start");
  equal(spec.content.dialogueGraphs.intro.nodes.start.choices[0].to, "done");
  equal(spec.content.cutscenes.intro.durationSeconds, 1.25);
  equal(spec.content.cutscenes.intro.commands[0].kind, "dialogue");
});

test("resolveShooterGameSpec resolves empty content namespace defaults", () => {
  const spec = resolveShooterGameSpec({});

  equal(spec.content.localization, undefined);
  deepEqual(spec.content.dialogueGraphs, {});
  deepEqual(spec.content.cutscenes, {});
});

test("createShooterContentRuntimeOptions wires single content entries into runtime options", () => {
  const spec = resolveShooterGameSpec({
    content: {
      localization: {
        defaultLocale: "en",
        locales: {
          en: {
            strings: {
              "intro.ready": "Ready?",
            },
          },
        },
      },
      dialogue: {
        graphs: {
          intro: {
            initialNode: "start",
            nodes: {
              start: { speaker: "Guide", text: "intro.ready", end: true },
            },
          },
        },
      },
      cutscenes: {
        intro: {
          commands: [
            { kind: "dialogue", graphId: "intro", nodeId: "start", durationSeconds: 1 },
          ],
        },
      },
    },
  });

  const selection = resolveShooterContentRuntimeSelection(spec.content);
  const runtimeOptions = createShooterContentRuntimeOptions(spec.content, { locale: "ko" });

  deepEqual(selection, {
    localization: true,
    cutsceneId: "intro",
  });
  if (runtimeOptions.localization === undefined || runtimeOptions.localization === false) {
    throw new Error("Expected runtime localization options.");
  }
  if (!("document" in runtimeOptions.localization)) {
    throw new Error("Expected runtime localization document options.");
  }
  const localizationOptions = runtimeOptions.localization as { document?: unknown; locale?: string };
  equal(localizationOptions.locale, "ko");
  equal(localizationOptions.document, spec.content.localization);
  equal(runtimeOptions.dialogue, undefined);
  if (runtimeOptions.cutscene === undefined || runtimeOptions.cutscene === false) {
    throw new Error("Expected runtime cutscene options.");
  }
  equal(runtimeOptions.cutscene.sequence.commands[0].kind, "dialogue");
  if (runtimeOptions.cutscene.sequence.commands[0].kind !== "dialogue") {
    throw new Error("Expected hydrated dialogue command.");
  }
  equal(runtimeOptions.cutscene.sequence.commands[0].speaker, "Guide");
  equal(runtimeOptions.cutscene.sequence.commands[0].text, "intro.ready");
  equal(runtimeOptions.cutscene.dialogue && runtimeOptions.cutscene.dialogue.textMode, "localizationKey");
});

test("createShooterContentRuntimeOptions uses explicit dialogue id when no cutscene is selected", () => {
  const spec = resolveShooterGameSpec({
    content: {
      dialogue: {
        graphs: {
          intro: {
            initialNode: "start",
            nodes: { start: { text: "Ready?", end: true } },
          },
          outro: {
            initialNode: "done",
            nodes: { done: { text: "Done.", end: true } },
          },
        },
      },
    },
  });

  const runtimeOptions = createShooterContentRuntimeOptions(spec.content, {
    dialogueGraphId: "outro",
    cutsceneId: false,
  });

  if (runtimeOptions.dialogue === undefined || runtimeOptions.dialogue === false) {
    throw new Error("Expected runtime dialogue options.");
  }
  equal(runtimeOptions.dialogue.graph.initialNode, "done");
  equal(runtimeOptions.cutscene, undefined);
});

test("createShooterContentRuntimeOptions rejects unresolved cutscene dialogue graph references", () => {
  const spec = resolveShooterGameSpec({
    content: {
      cutscenes: {
        intro: {
          commands: [
            { kind: "dialogue", graphId: "missing", nodeId: "start", durationSeconds: 1 },
          ],
        },
      },
    },
  });

  try {
    createShooterContentRuntimeOptions(spec.content);
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='content.cutscenes.intro.commands.0.graphId' detail='must reference content.dialogue.graphs id \\'missing\\''.",
    );
    return;
  }
  throw new Error("Expected invalid runtime content wiring to throw.");
});

test("resolveShooterGameSpec rejects empty content ids with game spec path context", () => {
  try {
    resolveShooterGameSpec({
      content: {
        dialogue: {
          graphs: {
            "": {
              initialNode: "start",
              nodes: { start: { text: "intro.ready", end: true } },
            },
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='content.dialogue.graphs key' detail='must be a non-empty content id'.",
    );
    return;
  }
  throw new Error("Expected empty content id to throw.");
});

test("resolveShooterGameSpec preserves dialogue graph path context inside content namespace", () => {
  try {
    resolveShooterGameSpec({
      content: {
        dialogue: {
          graphs: {
            intro: {
              initialNode: "missing",
              nodes: { start: { text: "intro.ready", end: true } },
            },
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid dialogue/quest data: kind=dialogue-quest path='content.dialogue.graphs.intro.initialNode' detail='references missing node \\'missing\\''.",
    );
    return;
  }
  throw new Error("Expected invalid dialogue graph to throw.");
});

test("resolveShooterGameSpec rejects unknown wave enemy preset with path context", () => {
  try {
    resolveShooterGameSpec({ enemies: { waves: [{ enemy: "missing" }] } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='enemies.waves.0.enemy' detail='must reference an enemy preset'.",
    );
    return;
  }
  throw new Error("Expected invalid wave preset spec to throw.");
});

test("resolveShooterGameSpec rejects invalid audio policy with path context", () => {
  try {
    resolveShooterGameSpec({ audio: { events: { shoot: { pitch: 0 } } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='audio.events.shoot.pitch' detail='must be a positive finite number'.",
    );
    return;
  }
  throw new Error("Expected invalid audio policy spec to throw.");
});

test("resolveShooterGameSpec rejects invalid atlas uv with path context", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          bad: {
            texture: "bullet",
            uv: { u0: 0.8, v0: 0, u1: 0.2, v1: 1 },
            size: { width: 8, height: 8 },
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='atlas.frames.bad.uv.u1' detail='must be greater than uv.u0'.",
    );
    return;
  }
  throw new Error("Expected invalid atlas uv spec to throw.");
});

test("resolveShooterGameSpec rejects unknown atlas frame references with path context", () => {
  try {
    resolveShooterGameSpec({ prefabs: { bullet: { frame: "missing" } } });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.frame' detail='must reference a frame in atlas.frames'.",
    );
    return;
  }
  throw new Error("Expected unknown atlas frame spec to throw.");
});

test("resolveShooterGameSpec rejects prefab frame and animation conflicts", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          bullet: {
            texture: 1,
            uv: { u0: 0, v0: 0, u1: 1, v1: 1 },
            size: { width: 8, height: 8 },
          },
        },
      },
      prefabs: {
        bullet: {
          frame: "bullet",
          animation: { frames: 2, fps: 8 },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.bullet.frame' detail='cannot be combined with animation'.",
    );
    return;
  }
  throw new Error("Expected atlas frame conflict spec to throw.");
});

test("resolveShooterGameSpec resolves atlas animation bindings", () => {
  const spec = resolveShooterGameSpec({
    atlas: {
      frames: {
        "player.idle.0": {
          texture: "sprites",
          uv: { u0: 0, v0: 0, u1: 0.25, v1: 0.5 },
          size: { width: 16, height: 24 },
        },
        "player.move.0": {
          texture: "sprites",
          uv: { u0: 0, v0: 0.5, u1: 0.25, v1: 1 },
          size: { width: 16, height: 24 },
        },
        "player.move.1": {
          texture: "sprites",
          uv: { u0: 0.25, v0: 0.5, u1: 0.5, v1: 1 },
          size: { width: 16, height: 24 },
        },
      },
    },
    prefabs: {
      player: {
        animation: {
          atlas: {
            idle: { frames: ["player.idle.0"], fps: 1 },
            move: { frames: ["player.move.0", "player.move.1"], fps: 8 },
          },
        },
      },
    },
  });

  equal(spec.playerWidth, 16);
  equal(spec.playerHeight, 24);
  equal(spec.playerAnimationFrames, 1);
  deepEqual(spec.playerAtlasAnimation, {
    texture: "sprites",
    width: 16,
    height: 24,
    idle: {
      fps: 1,
      frames: [spec.atlasFrames["player.idle.0"]],
    },
    move: {
      fps: 8,
      frames: [spec.atlasFrames["player.move.0"], spec.atlasFrames["player.move.1"]],
    },
  });
});

test("resolveShooterGameSpec rejects atlas animation frames with mixed texture", () => {
  try {
    resolveShooterGameSpec({
      atlas: {
        frames: {
          idle: {
            texture: "sprites-a",
            uv: { u0: 0, v0: 0, u1: 0.5, v1: 1 },
            size: { width: 16, height: 16 },
          },
          move: {
            texture: "sprites-b",
            uv: { u0: 0.5, v0: 0, u1: 1, v1: 1 },
            size: { width: 16, height: 16 },
          },
        },
      },
      prefabs: {
        player: {
          animation: {
            atlas: {
              idle: { frames: ["idle"], fps: 1 },
              move: { frames: ["move"], fps: 8 },
            },
          },
        },
      },
    });
  } catch (error) {
    equal(
      error instanceof Error ? error.message : String(error),
      "Invalid shooter game spec: kind=game-spec path='prefabs.player.animation.atlas.frames.1' detail='all atlas animation frames must use the same texture'.",
    );
    return;
  }
  throw new Error("Expected mixed atlas animation textures to throw.");
});
