import { resolveShooterGameSpec } from "./gameSpecResolve.js";
import {
  DEFAULT_PHYSICS_MATERIAL_DENSITY,
  DEFAULT_PHYSICS_MATERIAL_FRICTION,
  DEFAULT_PHYSICS_MATERIAL_RESTITUTION,
  DEFAULT_PHYSICS_MATERIAL_SCALE,
} from "./gameSpecDefaults.js";
import { gameSpecError } from "./gameSpecValidation.js";
import type {
  ApplyShooterGameSpecOptions,
  ResolvedShooterAtlasAnimation,
  ResolvedShooterAtlasFrame,
  ResolvedShooterGameSpec,
  ResolvedShooterPhysicsMaterial,
  ResolvedShooterPrefabCollider,
  ResolvedShooterPrefabColliderVertex,
  ResolvedShooterTileDefinition,
  ResolvedShooterTileLayer,
  ResolvedShooterTileRampDefinition,
  ResolvedShooterTileSlopeDefinition,
  ResolvedShooterTilemap,
  ShooterGameSpecTarget,
  ShooterTileKind,
  ShooterTileRampAxis,
} from "./gameSpecTypes.js";
import type { ResolvedPhysicsSpec } from "./physicsSpec.js";
import { createHd2dFloorIds } from "./physicsHd2dFloorIds.js";

export function applyShooterGameSpec(
  engine: ShooterGameSpecTarget,
  input: unknown,
  options: ApplyShooterGameSpecOptions = {},
): ResolvedShooterGameSpec {
  const spec = resolveShooterGameSpec(input, {
    physicsModeOverride: options.physicsModeOverride,
  });
  const atlasFrames = [
    atlasFrameApplication(0, spec.playerAtlasFrame, options, "prefabs.player.frame"),
    atlasFrameApplication(1, spec.enemyAtlasFrame, options, "prefabs.enemy.frame"),
    atlasFrameApplication(2, spec.bulletAtlasFrame, options, "prefabs.bullet.frame"),
  ].filter((frame): frame is ResolvedAtlasFrameApplication => frame !== undefined);
  const atlasAnimations = [
    atlasAnimationApplication(0, spec.playerAtlasAnimation, options, "prefabs.player.animation.atlas"),
    atlasAnimationApplication(1, spec.enemyAtlasAnimation, options, "prefabs.enemy.animation.atlas"),
    atlasAnimationApplication(2, spec.bulletAtlasAnimation, options, "prefabs.bullet.animation.atlas"),
  ].filter((animation): animation is ResolvedAtlasAnimationApplication => animation !== undefined);
  const tilemap = tilemapApplication(spec.tilemap, spec.physics, options);
  engine.set_shooter_resolved_config(
    spec.worldWidth,
    spec.worldHeight,
    spec.playerSpeed,
    spec.enemySpeed,
    spec.enemySpawnInterval,
    spec.bulletSpeed,
    spec.fireCooldown,
    spec.bulletLifetime,
    spec.playerWidth,
    spec.playerHeight,
    spec.enemyWidth,
    spec.enemyHeight,
    spec.bulletWidth,
    spec.bulletHeight,
    spec.playerAnimationFrames,
    spec.playerAnimationFps,
    spec.enemyAnimationFrames,
    spec.enemyAnimationFps,
    spec.bulletAnimationFrames,
    spec.bulletAnimationFps,
    spec.enemyBehaviorCode,
    spec.enemySpawnPatternCode,
    spec.enemyHealth,
    spec.bulletDamage,
    spec.scoreReward,
    spec.orbitRadius,
    spec.orbitRadialBand,
  );
  engine.set_shooter_projectile_arc?.(
    spec.projectileArc.enabled,
    spec.projectileArc.launchHeight,
    spec.projectileArc.zVelocity,
    spec.projectileArc.gravity,
    spec.projectileArc.hitHeight,
  );
  engine.set_shooter_animations?.(
    spec.playerAnimationColumns,
    spec.playerAnimationRows,
    spec.playerAnimationIdleRow,
    spec.playerAnimationIdleFrames,
    spec.playerAnimationIdleFps,
    spec.playerAnimationMoveRow,
    spec.playerAnimationMoveFrames,
    spec.playerAnimationMoveFps,
    spec.enemyAnimationColumns,
    spec.enemyAnimationRows,
    spec.enemyAnimationIdleRow,
    spec.enemyAnimationIdleFrames,
    spec.enemyAnimationIdleFps,
    spec.enemyAnimationMoveRow,
    spec.enemyAnimationMoveFrames,
    spec.enemyAnimationMoveFps,
    spec.bulletAnimationColumns,
    spec.bulletAnimationRows,
    spec.bulletAnimationIdleRow,
    spec.bulletAnimationIdleFrames,
    spec.bulletAnimationIdleFps,
    spec.bulletAnimationMoveRow,
    spec.bulletAnimationMoveFrames,
    spec.bulletAnimationMoveFps,
  );
  engine.set_shooter_camera_preset?.(
    spec.cameraPresetCode,
    spec.cameraDeadZoneWidth,
    spec.cameraDeadZoneHeight,
    spec.cameraLookAheadDistance,
    spec.cameraShakeAmplitude,
    spec.cameraShakeFrequency,
  );
  engine.set_shooter_audio_policy?.(
    spec.shootVolume,
    spec.shootPitch,
    spec.hitVolume,
    spec.hitPitch,
    spec.gameOverVolume,
    spec.gameOverPitch,
  );
  engine.clear_shooter_tilemap?.();
  for (const tile of tilemap.tiles) {
    applyTileDefinition(engine, tile);
  }
  for (const layer of tilemap.layers) {
    engine.set_shooter_tilemap_layer?.(
      layer.index,
      layer.columns,
      layer.rows,
      layer.tileWidth,
      layer.tileHeight,
      layer.originX,
      layer.originY,
      layer.collision,
      Uint32Array.from(layer.data),
    );
  }
  engine.clear_shooter_waves?.();
  for (const wave of spec.waves) {
    engine.set_shooter_wave?.(
      wave.index,
      wave.duration,
      wave.spawnInterval,
      wave.enemyCount,
      wave.enemySpeed,
      wave.enemyBehaviorCode,
      wave.enemySpawnPatternCode,
      wave.enemyHealth,
      wave.scoreReward,
    );
  }
  for (const frame of atlasFrames) {
    applyAtlasFrame(engine, frame);
  }
  for (const animation of atlasAnimations) {
    applyAtlasAnimation(engine, animation);
  }
  applyPrefabCollider(engine, 0, spec.playerCollider);
  applyPrefabCollider(engine, 1, spec.enemyCollider);
  applyPrefabCollider(engine, 2, spec.bulletCollider);
  return spec;
}

interface ResolvedAtlasFrameApplication {
  prefab: number;
  textureId: number;
  frame: ResolvedShooterAtlasFrame;
}

interface ResolvedAtlasAnimationApplication {
  prefab: number;
  textureId: number;
  animation: ResolvedShooterAtlasAnimation;
}

function atlasFrameApplication(
  prefab: number,
  frame: ResolvedShooterAtlasFrame | undefined,
  options: ApplyShooterGameSpecOptions,
  path: string,
): ResolvedAtlasFrameApplication | undefined {
  if (!frame) {
    return undefined;
  }
  return {
    prefab,
    textureId: atlasTextureId(frame.texture, options, path),
    frame,
  };
}

function applyAtlasFrame(
  engine: ShooterGameSpecTarget,
  application: ResolvedAtlasFrameApplication,
): void {
  const { frame } = application;
  engine.set_shooter_atlas_frame?.(
    application.prefab,
    application.textureId,
    frame.width,
    frame.height,
    frame.u0,
    frame.v0,
    frame.u1,
    frame.v1,
  );
}

function atlasAnimationApplication(
  prefab: number,
  animation: ResolvedShooterAtlasAnimation | undefined,
  options: ApplyShooterGameSpecOptions,
  path: string,
): ResolvedAtlasAnimationApplication | undefined {
  if (!animation) {
    return undefined;
  }
  return {
    prefab,
    textureId: atlasTextureId(animation.texture, options, path),
    animation,
  };
}

function applyAtlasAnimation(
  engine: ShooterGameSpecTarget,
  application: ResolvedAtlasAnimationApplication,
): void {
  const { animation } = application;
  engine.set_shooter_atlas_animation?.(
    application.prefab,
    application.textureId,
    animation.width,
    animation.height,
    animation.idle.fps,
    atlasFrameBuffer(animation.idle.frames),
    animation.move.fps,
    atlasFrameBuffer(animation.move.frames),
  );
}

function applyPrefabCollider(
  engine: ShooterGameSpecTarget,
  prefab: number,
  collider: ResolvedShooterPrefabCollider,
): void {
  const material = prefabColliderMaterialArgs(collider.material);
  switch (collider.type) {
    case "aabb":
      engine.set_shooter_prefab_collider?.(
        prefab,
        collider.halfWidth,
        collider.halfHeight,
        collider.offsetX,
        collider.offsetY,
        collider.enabled,
        collider.trigger,
        ...material,
      );
      break;
    case "circle":
      engine.set_shooter_prefab_circle_collider?.(
        prefab,
        collider.radius,
        collider.offsetX,
        collider.offsetY,
        collider.enabled,
        collider.trigger,
        ...material,
      );
      break;
    case "capsule":
      engine.set_shooter_prefab_capsule_collider?.(
        prefab,
        collider.startX,
        collider.startY,
        collider.endX,
        collider.endY,
        collider.radius,
        collider.offsetX,
        collider.offsetY,
        collider.enabled,
        collider.trigger,
        ...material,
      );
      break;
    case "orientedBox":
      engine.set_shooter_prefab_oriented_box_collider?.(
        prefab,
        collider.halfWidth,
        collider.halfHeight,
        collider.rotationRadians,
        collider.offsetX,
        collider.offsetY,
        collider.enabled,
        collider.trigger,
        ...material,
      );
      break;
    case "convexPolygon":
      engine.set_shooter_prefab_convex_polygon_collider?.(
        prefab,
        prefabColliderVertexBuffer(collider.vertices),
        collider.rotationRadians,
        collider.offsetX,
        collider.offsetY,
        collider.enabled,
        collider.trigger,
        ...material,
      );
      break;
  }
}

function prefabColliderMaterialArgs(
  material: ResolvedShooterPhysicsMaterial | undefined,
): [
  boolean,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] {
  return [
    material !== undefined,
    material?.restitution ?? DEFAULT_PHYSICS_MATERIAL_RESTITUTION,
    material?.friction ?? DEFAULT_PHYSICS_MATERIAL_FRICTION,
    material?.surfaceVelocityX ?? 0,
    material?.surfaceVelocityY ?? 0,
    material?.density ?? DEFAULT_PHYSICS_MATERIAL_DENSITY,
    material?.contactBaumgarteBiasScale ?? DEFAULT_PHYSICS_MATERIAL_SCALE,
    material?.maxContactBaumgarteBiasVelocityScale ?? DEFAULT_PHYSICS_MATERIAL_SCALE,
    material?.contactPositionCorrectionScale ?? DEFAULT_PHYSICS_MATERIAL_SCALE,
    material?.contactPositionCorrectionSlopScale ?? DEFAULT_PHYSICS_MATERIAL_SCALE,
  ];
}

function prefabColliderVertexBuffer(vertices: readonly ResolvedShooterPrefabColliderVertex[]): Float32Array {
  const buffer = new Float32Array(vertices.length * 2);
  vertices.forEach((vertex, index) => {
    const offset = index * 2;
    buffer[offset] = vertex.x;
    buffer[offset + 1] = vertex.y;
  });
  return buffer;
}

function atlasFrameBuffer(frames: readonly ResolvedShooterAtlasFrame[]): Float32Array {
  const buffer = new Float32Array(frames.length * 4);
  frames.forEach((frame, index) => {
    const offset = index * 4;
    buffer[offset] = frame.u0;
    buffer[offset + 1] = frame.v0;
    buffer[offset + 2] = frame.u1;
    buffer[offset + 3] = frame.v1;
  });
  return buffer;
}

function atlasTextureId(
  texture: string | number,
  options: ApplyShooterGameSpecOptions,
  path: string,
): number {
  if (typeof texture === "number") {
    return texture;
  }
  if (!options.textureId) {
    throw gameSpecError(path, "requires a textureId resolver when atlas frame texture is a name");
  }
  const textureId = options.textureId(texture);
  if (Number.isInteger(textureId) && textureId >= 0) {
    return textureId;
  }
  throw gameSpecError(path, "textureId resolver must return a non-negative integer");
}

interface ResolvedTileDefinitionApplication {
  id: number;
  textureId: number;
  frame: ResolvedShooterAtlasFrame;
  color: [number, number, number, number];
  hd2d?: ResolvedTileHd2dMetadataApplication;
  heightSpan?: {
    floorId: number;
    elevation: number;
    height: number;
  };
  slope?: ResolvedShooterTileSlopeDefinition;
  oneWayPlatform?: boolean;
}

interface ResolvedTileHd2dMetadataApplication {
  kind: ShooterTileKind;
  kindCode: number;
  blocksMovement: boolean;
  blocksProjectile: boolean;
  blocksVision: boolean;
  occluderHeight: number;
  ramp?: ResolvedTileHd2dRampApplication;
  bridgePortal?: ResolvedTileBridgePortalApplication;
}

interface ResolvedTileHd2dRampApplication extends ResolvedShooterTileRampDefinition {
  axisCode: number;
}

interface ResolvedTileBridgePortalApplication {
  lowerFloorId: number;
  upperFloorId: number;
  lowerElevation: number;
  upperElevation: number;
  navigationCost: number;
}

interface ResolvedTilemapApplication {
  tiles: ResolvedTileDefinitionApplication[];
  layers: ResolvedShooterTileLayer[];
}

const TILE_KIND_CODES: Record<ShooterTileKind, number> = {
  flat: 0,
  stair: 1,
  ramp: 2,
  ledge: 3,
  bridge: 4,
};

const TILE_RAMP_AXIS_CODES: Record<ShooterTileRampAxis, number> = {
  x: 0,
  y: 1,
};

function tilemapApplication(
  tilemap: ResolvedShooterTilemap | undefined,
  physics: ResolvedPhysicsSpec,
  options: ApplyShooterGameSpecOptions,
): ResolvedTilemapApplication {
  if (!tilemap) {
    return { tiles: [], layers: [] };
  }
  const floorIds = createTilemapHd2dFloorIds(physics, tilemap);
  return {
    tiles: tilemap.tiles.map((tile) => ({
      id: tile.id,
      textureId: atlasTextureId(tile.frame.texture, options, `tilemap.tiles.${tile.id}.frame`),
      frame: tile.frame,
      color: tile.color,
      ...(tileHd2dMetadataApplication(tile, floorIds) ?? {}),
      ...(tileHeightSpanApplication(physics, tile, floorIds) ?? {}),
      ...(tile.slope ? { slope: tile.slope } : {}),
      ...(tile.oneWayPlatform ? { oneWayPlatform: true } : {}),
    })),
    layers: tilemap.layers,
  };
}

function tileHd2dMetadataApplication(
  tile: ResolvedShooterTileDefinition,
  floorIds: ReadonlyMap<string, number>,
): Pick<ResolvedTileDefinitionApplication, "hd2d"> | undefined {
  if (
    tile.kind === "flat" &&
    tile.blocksMovement &&
    tile.blocksProjectile &&
    tile.blocksVision &&
    tile.occluderHeight === tile.height &&
    tile.ramp === undefined
  ) {
    return undefined;
  }
  return {
    hd2d: {
      kind: tile.kind,
      kindCode: TILE_KIND_CODES[tile.kind],
      blocksMovement: tile.blocksMovement,
      blocksProjectile: tile.blocksProjectile,
      blocksVision: tile.blocksVision,
      occluderHeight: tile.occluderHeight,
      ...(tile.ramp
        ? {
            ramp: {
              ...tile.ramp,
              axisCode: TILE_RAMP_AXIS_CODES[tile.ramp.axis],
            },
          }
        : {}),
      ...(tile.bridgePortal
        ? {
            bridgePortal: {
              lowerFloorId: floorIds.get(tile.bridgePortal.lowerFloor) ?? 0,
              upperFloorId: floorIds.get(tile.bridgePortal.upperFloor) ?? 0,
              lowerElevation: tile.bridgePortal.lowerElevation,
              upperElevation: tile.bridgePortal.upperElevation,
              navigationCost: tile.bridgePortal.navigationCost,
            },
          }
        : {}),
    },
  };
}

function createTilemapHd2dFloorIds(
  physics: ResolvedPhysicsSpec,
  tilemap: ResolvedShooterTilemap,
): ReadonlyMap<string, number> {
  return createHd2dFloorIds([
    Object.values(physics.bodies).map((body) => body.floor),
    tilemap.tiles.map((tile) => tile.floor),
    tilemap.tiles.flatMap((tile) => tile.bridgePortal === undefined
      ? []
      : [tile.bridgePortal.lowerFloor, tile.bridgePortal.upperFloor]),
  ]);
}

function tileHeightSpanApplication(
  physics: ResolvedPhysicsSpec,
  tile: ResolvedShooterTileDefinition,
  floorIds: ReadonlyMap<string, number>,
): Pick<ResolvedTileDefinitionApplication, "heightSpan"> | undefined {
  if (
    !physics.hd2d.enabled &&
    tile.floor === "default" &&
    tile.elevation === 0 &&
    tile.height === 0
  ) {
    return undefined;
  }
  return {
    heightSpan: {
      floorId: floorIds.get(tile.floor) ?? 0,
      elevation: tile.elevation,
      height: tile.height,
    },
  };
}

function applyTileDefinition(engine: ShooterGameSpecTarget, application: ResolvedTileDefinitionApplication): void {
  const { frame, color } = application;
  engine.set_shooter_tile?.(
    application.id,
    application.textureId,
    frame.u0,
    frame.v0,
    frame.u1,
    frame.v1,
    color[0],
    color[1],
    color[2],
    color[3],
  );
  if (application.hd2d !== undefined) {
    const ramp = application.hd2d.ramp;
    const accepted = engine.set_shooter_tile_hd2d_metadata?.(
      application.id,
      application.hd2d.kindCode,
      application.hd2d.blocksMovement,
      application.hd2d.blocksProjectile,
      application.hd2d.blocksVision,
      application.hd2d.occluderHeight,
      ramp !== undefined,
      ramp?.axisCode ?? 0,
      ramp?.startElevation ?? 0,
      ramp?.endElevation ?? 0,
    );
    if (accepted === false) {
      throw gameSpecError(`tilemap.tiles.${application.id}.kind`, "runtime rejected tile HD-2D metadata");
    }
    if (application.hd2d.bridgePortal !== undefined) {
      const portalAccepted = engine.set_shooter_tile_bridge_portal?.(
        application.id,
        application.hd2d.bridgePortal.lowerFloorId,
        application.hd2d.bridgePortal.upperFloorId,
        application.hd2d.bridgePortal.lowerElevation,
        application.hd2d.bridgePortal.upperElevation,
        application.hd2d.bridgePortal.navigationCost,
      );
      if (portalAccepted === false) {
        throw gameSpecError(`tilemap.tiles.${application.id}.bridgePortal`, "runtime rejected bridge portal metadata");
      }
    }
  }
  if (application.slope) {
    engine.set_shooter_tile_slope?.(
      application.id,
      application.slope.x0,
      application.slope.y0,
      application.slope.x1,
      application.slope.y1,
    );
  }
  if (application.oneWayPlatform) {
    engine.set_shooter_tile_one_way_platform?.(application.id);
  }
  if (application.heightSpan !== undefined) {
    const accepted = engine.set_shooter_tile_height_span?.(
      application.id,
      application.heightSpan.floorId,
      application.heightSpan.elevation,
      application.heightSpan.height,
    );
    if (accepted === false) {
      throw gameSpecError(`tilemap.tiles.${application.id}.height`, "runtime rejected tile height span");
    }
  }
}
