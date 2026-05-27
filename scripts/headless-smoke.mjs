#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import initWasm, {
  Engine,
  sprite_render_command_floats,
  wasm_memory,
} from "../packages/ferrum-web/pkg/ferrum_core.js";
import { applyShooterGameSpec, resolveShooterGameSpec } from "../packages/ferrum-web/dist/gameSpec.js";
import { decodeRenderCommands } from "../packages/ferrum-web/dist/renderCommandDecoder.js";
import { rendererStatsForCommands } from "../packages/ferrum-web/dist/renderer.js";

const FLOATS_PER_COMMAND = 14;
const DEFAULT_SPEC_PATH = "examples/topdown-shooter/public/game.json";
const PARTICLE_SMOKE_PRESET_ID = 0;
const PARTICLE_SMOKE_BURST_COUNT = 4;
const PARTICLE_SMOKE_LIFETIME_SECONDS = 0.2;
const textureIds = new Map([
  ["player", 1],
  ["enemy", 2],
  ["bullet", 3],
]);

const paths = process.argv.slice(2);
const smokeTargets = paths.length > 0 ? paths : [DEFAULT_SPEC_PATH];

class SmokeEngine {
  resolvedConfig;
  animationConfig;
  cameraConfig;
  audioConfig;
  atlasFrames = [];
  atlasAnimations = [];
  tiles = [];
  tileLayers = [];
  waves = [];
  tilemapCleared = false;
  wavesCleared = false;

  set_shooter_resolved_config(...values) {
    this.resolvedConfig = values;
  }

  set_shooter_animations(...values) {
    this.animationConfig = values;
  }

  set_shooter_camera_preset(...values) {
    this.cameraConfig = values;
  }

  set_shooter_audio_policy(...values) {
    this.audioConfig = values;
  }

  clear_shooter_tilemap() {
    this.tilemapCleared = true;
  }

  set_shooter_tile(tileId, textureIdValue, u0, v0, u1, v1, r, g, b, a) {
    this.tiles.push({ tileId, textureId: textureIdValue, u0, v0, u1, v1, color: [r, g, b, a] });
  }

  set_shooter_tilemap_layer(index, columns, rows, tileWidth, tileHeight, originX, originY, collision, tiles) {
    this.tileLayers.push({
      index,
      columns,
      rows,
      tileWidth,
      tileHeight,
      originX,
      originY,
      collision,
      data: Array.from(tiles),
    });
  }

  clear_shooter_waves() {
    this.wavesCleared = true;
  }

  set_shooter_wave(...values) {
    this.waves.push(values);
  }

  set_shooter_atlas_frame(...values) {
    this.atlasFrames.push(values);
  }

  set_shooter_atlas_animation(prefab, textureIdValue, width, height, idleFps, idleFrames, moveFps, moveFrames) {
    this.atlasAnimations.push({
      prefab,
      textureId: textureIdValue,
      width,
      height,
      idleFps,
      idleFrames: Array.from(idleFrames),
      moveFps,
      moveFrames: Array.from(moveFrames),
    });
  }
}

function smokeResolvedSpec(resolved) {
  assert(resolved.worldWidth > 0 && resolved.worldHeight > 0, "world dimensions must be positive");
  assert(resolved.playerSpeed > 0, "player speed must be positive");
  assert(resolved.orbitRadius > 0, "orbit radius must be positive");
  assert(resolved.orbitRadialBand >= 0, "orbit radial band must be non-negative");
  assert(resolved.waves.length > 0, "at least one enemy wave is required");
  assert(resolved.waves.some((wave) => wave.enemyBehavior === "chase"), "at least one chase wave is required");
  assert(resolved.bulletAtlasFrame !== undefined, "bullet atlas frame must be resolved");
  assert(resolved.playerAtlasAnimation !== undefined, "player atlas animation must be resolved");
  assert(resolved.audioSfxVolume > 0, "SFX bus volume must be positive");
  assert(resolved.shootPitch > 0 && resolved.hitPitch > 0 && resolved.gameOverPitch > 0, "audio pitches must be positive");
  assert(resolved.tilemap !== undefined, "tilemap must be present for the Top-down Shooter smoke target");

  const tilemap = resolved.tilemap;
  assert(tilemap.tiles.length > 0, "tilemap must define at least one positive tile");
  assert(tilemap.layers.length > 0, "tilemap must define at least one layer");
  const collisionLayers = tilemap.layers.filter((layer) => layer.collision);
  assert(collisionLayers.length > 0, "collision layer is required for obstacle and navigation smoke");

  let obstacleCount = 0;
  let walkableCount = 0;
  for (const layer of collisionLayers) {
    assert(layer.data.length === layer.columns * layer.rows, `collision layer '${layer.name}' data length must match dimensions`);
    obstacleCount += layer.data.filter((tileId) => tileId > 0).length;
    walkableCount += layer.data.filter((tileId) => tileId === 0).length;
  }
  assert(obstacleCount > 0, "collision layer must contain at least one obstacle tile");
  assert(walkableCount > 0, "collision layer must contain at least one walkable tile");

  return {
    waves: resolved.waves.length,
    tileLayers: tilemap.layers.length,
    collisionLayers: collisionLayers.length,
    collisionObstacles: obstacleCount,
    audioPolicy: {
      sfxVolume: resolved.audioSfxVolume,
      shootPitch: resolved.shootPitch,
      hitPitch: resolved.hitPitch,
      gameOverPitch: resolved.gameOverPitch,
    },
  };
}

function smokeAppliedEngine(engine, resolved) {
  assert(Array.isArray(engine.resolvedConfig), "resolved shooter config must be applied");
  assert(Array.isArray(engine.animationConfig), "animation config must be applied");
  assert(Array.isArray(engine.cameraConfig), "camera preset config must be applied");
  assert(Array.isArray(engine.audioConfig), "audio policy must be applied");
  assert(engine.tilemapCleared, "tilemap must be cleared before applying resolved layers");
  assert(engine.wavesCleared, "waves must be cleared before applying resolved waves");
  assert(engine.tiles.length === resolved.tilemap.tiles.length, "all resolved tile definitions must be applied");
  assert(engine.tileLayers.length === resolved.tilemap.layers.length, "all resolved tile layers must be applied");
  assert(engine.waves.length === resolved.waves.length, "all resolved waves must be applied");
  assert(engine.atlasFrames.some((frame) => frame[0] === 2 && frame[1] === textureId("bullet")), "bullet atlas frame must resolve named texture id");
  assert(
    engine.atlasAnimations.some((animation) => animation.prefab === 0 && animation.textureId === textureId("player")),
    "player atlas animation must resolve named texture id",
  );
  assert(engine.tileLayers.some((layer) => layer.collision && layer.data.some((tileId) => tileId > 0)), "applied collision layer must keep obstacle data");
}

function smokeRenderCommandBuffer(resolved) {
  const commandBuffer = tilemapRenderCommandBuffer(resolved);
  assert(commandBuffer.commandCount > 0, "representative render command buffer must not be empty");
  assert(commandBuffer.buffer.length === commandBuffer.commandCount * FLOATS_PER_COMMAND, "render command buffer length must match ABI width");

  const commands = decodeRenderCommands(commandBuffer);
  assert(commands.length === commandBuffer.commandCount, "decoded render command count must match buffer command count");
  for (const command of commands) {
    assert(command.width > 0 && command.height > 0, "decoded render command dimensions must be positive");
    assert(command.textureId >= 0, "decoded render command texture id must be non-negative");
    assert(command.uv.every((value) => value >= 0 && value <= 1), "decoded render command UVs must be normalized");
    assert(command.color.every((value) => value >= 0 && value <= 1), "decoded render command color must be normalized");
  }

  const drawCalls = contiguousTextureBatchCount(commands);
  const stats = rendererStatsForCommands(commandBuffer, drawCalls);
  assert(stats.renderCommandCount === commandBuffer.commandCount, "renderer stats must preserve render command count");
  assert(stats.spriteCount === commandBuffer.commandCount, "renderer stats must preserve sprite count");
  assert(stats.drawCalls > 0, "renderer stats must report at least one draw call for non-empty commands");

  return {
    renderCommands: commandBuffer.commandCount,
    textureBatches: drawCalls,
    textureSwitches: stats.textureSwitchCount,
  };
}

let wasmInitialized = false;

async function smokeParticleRuntime() {
  await initSmokeWasm();
  assert(sprite_render_command_floats() === FLOATS_PER_COMMAND, "Wasm render command ABI width must match headless smoke decoder");

  const engine = new Engine();
  try {
    engine.set_viewport_size(800, 480);
    engine.set_particle_seed(7);
    engine.set_particle_preset(
      PARTICLE_SMOKE_PRESET_ID,
      textureId("bullet"),
      0,
      0,
      1,
      1,
      PARTICLE_SMOKE_BURST_COUNT,
      PARTICLE_SMOKE_LIFETIME_SECONDS,
      PARTICLE_SMOKE_LIFETIME_SECONDS,
      0,
      0,
      6,
      6,
      2,
      2,
      1,
      0.82,
      0.28,
      1,
      1,
      0.18,
      0.05,
      0,
      0,
      0,
      0,
    );
    engine.set_shooter_hit_particle_preset(PARTICLE_SMOKE_PRESET_ID);
    engine.clear_shooter_hit_particle_preset();
    engine.set_shooter_hit_particle_preset(PARTICLE_SMOKE_PRESET_ID);

    engine.update(0);
    const baseRenderCommandCount = readEngineRenderCommandBuffer(engine).commandCount;
    const spawned = engine.spawn_particle_burst(PARTICLE_SMOKE_PRESET_ID, engine.camera_x(), engine.camera_y());
    assert(spawned === PARTICLE_SMOKE_BURST_COUNT, "particle burst must spawn the configured count");
    assert(engine.particle_count() === PARTICLE_SMOKE_BURST_COUNT, "particle count must reflect a live burst before update");

    engine.update(0);
    const activeBuffer = readEngineRenderCommandBuffer(engine);
    assert(
      activeBuffer.commandCount === baseRenderCommandCount + PARTICLE_SMOKE_BURST_COUNT,
      "particle render commands must append to the engine render command buffer",
    );
    const activeCommands = decodeRenderCommands(activeBuffer);
    const particleCommands = activeCommands.slice(-PARTICLE_SMOKE_BURST_COUNT);
    for (const command of particleCommands) {
      assert(command.textureId === textureId("bullet"), "particle commands must use the configured texture id");
      assert(command.width > 0 && command.height > 0, "particle command dimensions must be positive");
      assert(command.color[3] > 0, "active particle commands must keep visible alpha");
    }

    engine.update(PARTICLE_SMOKE_LIFETIME_SECONDS + 0.01);
    const expiredBuffer = readEngineRenderCommandBuffer(engine);
    assert(engine.particle_count() === 0, "particle count must return to zero after lifetime expiry");
    assert(
      expiredBuffer.commandCount <= baseRenderCommandCount,
      "expired particles must be removed from the render command buffer",
    );

    return {
      particleCapacity: engine.particle_capacity(),
      particleBurstCount: spawned,
      particleRenderCommands: activeBuffer.commandCount - baseRenderCommandCount,
      renderCommandsWithParticles: activeBuffer.commandCount,
      renderCommandsAfterParticleExpiry: expiredBuffer.commandCount,
    };
  } finally {
    engine.free();
  }
}

async function initSmokeWasm() {
  if (wasmInitialized) {
    return;
  }
  const wasmBytes = await readFile(new URL("../packages/ferrum-web/pkg/ferrum_core_bg.wasm", import.meta.url));
  await initWasm({ module_or_path: wasmBytes });
  wasmInitialized = true;
}

function readEngineRenderCommandBuffer(engine) {
  const commandCount = engine.render_command_len();
  return {
    buffer: new Float32Array(wasm_memory().buffer, engine.render_command_ptr(), commandCount * FLOATS_PER_COMMAND),
    commandCount,
    floatsPerCommand: FLOATS_PER_COMMAND,
  };
}


function tilemapRenderCommandBuffer(resolved) {
  const tilemap = resolved.tilemap;
  const tilesById = new Map(tilemap.tiles.map((tile) => [tile.id, tile]));
  const floats = [];

  for (const layer of tilemap.layers) {
    for (let index = 0; index < layer.data.length; index += 1) {
      const tileId = layer.data[index];
      if (tileId === 0) {
        continue;
      }
      const tile = tilesById.get(tileId);
      if (tile === undefined) {
        continue;
      }
      const column = index % layer.columns;
      const row = Math.floor(index / layer.columns);
      const x = layer.originX + column * layer.tileWidth;
      const y = layer.originY + row * layer.tileHeight;
      const frame = tile.frame;
      floats.push(
        x,
        y,
        layer.tileWidth,
        layer.tileHeight,
        frame.u0,
        frame.v0,
        frame.u1,
        frame.v1,
        tile.color[0],
        tile.color[1],
        tile.color[2],
        tile.color[3],
        typeof frame.texture === "number" ? frame.texture : textureId(frame.texture),
        0,
      );
    }
  }

  return {
    buffer: Float32Array.from(floats),
    commandCount: floats.length / FLOATS_PER_COMMAND,
    floatsPerCommand: FLOATS_PER_COMMAND,
  };
}

function contiguousTextureBatchCount(commands) {
  if (commands.length === 0) {
    return 0;
  }
  let batches = 1;
  let previousTextureId = commands[0].textureId;
  for (const command of commands.slice(1)) {
    if (command.textureId !== previousTextureId) {
      batches += 1;
      previousTextureId = command.textureId;
    }
  }
  return batches;
}

function textureId(name) {
  const id = textureIds.get(name);
  assert(id !== undefined, `texture '${name}' must be present in the smoke texture manifest`);
  return id;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`[headless smoke] ${message}`);
  }
}

for (const path of smokeTargets) {
  try {
    const source = await readFile(path, "utf8");
    const parsed = JSON.parse(source);
    const resolved = resolveShooterGameSpec(parsed);
    const engine = new SmokeEngine();
    const applied = applyShooterGameSpec(engine, parsed, { textureId });
    assert(applied.worldWidth === resolved.worldWidth, "applyShooterGameSpec must use the resolved Game Spec path");

    const report = smokeResolvedSpec(resolved);
    smokeAppliedEngine(engine, resolved);
    const renderReport = smokeRenderCommandBuffer(resolved);
    const particleReport = await smokeParticleRuntime();

    console.log(`${path}: headless smoke ok`);
    console.log(JSON.stringify({ ...report, ...renderReport, ...particleReport }, null, 2));
  } catch (error) {
    console.error(`${path}: headless smoke failed`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
