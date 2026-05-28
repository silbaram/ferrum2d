import {
  PHYSICS_REPLAY_WORKER_REQUEST_FORMAT,
  PHYSICS_WORLD_SNAPSHOT_FORMAT,
  applyPhysicsSceneProfile,
  applyTileRules,
  bakeAnimatedTileLayer,
  createCollider,
  createJoint,
  createPhysicsLayerMap,
  createPhysicsLayerSpec,
  createPhysicsReplayInputStream,
  createPhysicsReplayWorkerClient,
  createPhysicsWorldFromSpec,
  createPixelMaskTerrain,
  createPixelMaskTerrainRuntime,
  createRigidBody,
  equal,
  extractPixelMaskBoundaryChains,
  physicsMaterial,
  resolveAnimatedTileFrame,
  test,
} from "./publicApiTypes.shared.js";

import type {
  AnimatedTileFrameSpec,
  AnimatedTileLayerOptions,
  AnimatedTileSpec,
  ApplyPhysicsSceneProfileOptions,
  ApplyTileRulesOptions,
  PhysicsAuthoringJointHandle,
  PhysicsAuthoringLayer,
  PhysicsColliderAuthoringOptions,
  PhysicsJointAuthoringOptions,
  PhysicsLayerPattern,
  PhysicsMaterialPresetName,
  PhysicsReplayInputEvent,
  PhysicsReplayInputRunResult,
  PhysicsReplayInputStream,
  PhysicsReplayWorkerRunResult,
  PhysicsReplayWorkerTransferBenchmarkResult,
  PhysicsRigidBodyAuthoringOptions,
  PhysicsSceneProfileId,
  PhysicsSceneProfileSpec,
  PhysicsWorldApplyResult,
  PixelMaskTerrainAlphaPatch,
  PixelMaskTerrainBoundaryOptions,
  PixelMaskTerrainDirtyRect,
  PixelMaskTerrainLayerOptions,
  PixelMaskTerrainOptions,
  PixelMaskTerrainRuntimeOptions,
  PixelMaskTerrainRuntimeSyncResult,
  PixelMaskTerrainTextureTarget,
  PixelMaskTerrainTextureUploadOptions,
  PublicApi,
  TileRuleGrid,
  TileRuleSpec,
  TilemapBoundaryChain,
  TilemapBoundaryExtractionOptions,
  TilemapBoundaryExtractionResult,
} from "./publicApiTypes.shared.js";

test("public API physics authoring, replay, terrain, and tilemap types", () => {
  const publicCreateCollider: PublicApi["createCollider"] = createCollider;
  const publicCreateJoint: PublicApi["createJoint"] = createJoint;
  const publicCreateRigidBody: PublicApi["createRigidBody"] = createRigidBody;
  const publicCreatePhysicsWorldFromSpec: PublicApi["createPhysicsWorldFromSpec"] = createPhysicsWorldFromSpec;
  const publicApplyPhysicsSceneProfile: PublicApi["applyPhysicsSceneProfile"] = applyPhysicsSceneProfile;
  const publicCreatePhysicsLayerSpec: PublicApi["createPhysicsLayerSpec"] = createPhysicsLayerSpec;
  const publicCreatePhysicsLayerMap: PublicApi["createPhysicsLayerMap"] = createPhysicsLayerMap;
  const publicPhysicsMaterial: PublicApi["physicsMaterial"] = physicsMaterial;
  const publicCreatePhysicsReplayInputStream: PublicApi["createPhysicsReplayInputStream"] =
    createPhysicsReplayInputStream;
  const publicPhysicsWorldSnapshotFormat: PublicApi["PHYSICS_WORLD_SNAPSHOT_FORMAT"] =
    PHYSICS_WORLD_SNAPSHOT_FORMAT;
  const publicCreatePhysicsReplayWorkerClient: PublicApi["createPhysicsReplayWorkerClient"] =
    createPhysicsReplayWorkerClient;
  const publicPhysicsReplayWorkerRequestFormat: PublicApi["PHYSICS_REPLAY_WORKER_REQUEST_FORMAT"] =
    PHYSICS_REPLAY_WORKER_REQUEST_FORMAT;
  const publicCreatePixelMaskTerrain: PublicApi["createPixelMaskTerrain"] = createPixelMaskTerrain;
  const publicExtractPixelMaskBoundaryChains: PublicApi["extractPixelMaskBoundaryChains"] =
    extractPixelMaskBoundaryChains;
  const publicCreatePixelMaskTerrainRuntime: PublicApi["createPixelMaskTerrainRuntime"] =
    createPixelMaskTerrainRuntime;
  const authoringCollider: PhysicsColliderAuthoringOptions = { type: "box", size: [16, 24] };
  const authoringJoint: PhysicsJointAuthoringOptions = {
    type: "distance",
    bodyA: "world",
    bodyB: { entityId: 1, entityGeneration: 1 },
    anchor: [0, 0],
    restLength: 12,
  };
  const bodyAuthoring: PhysicsRigidBodyAuthoringOptions = {
    collider: authoringCollider,
    material: "wood",
    layer: "player",
  };
  const layerPattern: PhysicsLayerPattern = { player: ["world"], world: ["player"] };
  const authoringLayerSpec = publicCreatePhysicsLayerSpec(layerPattern);
  const physicsLayerMap: Record<string, PhysicsAuthoringLayer> = publicCreatePhysicsLayerMap(layerPattern);
  const materialPreset: PhysicsMaterialPresetName = "wood";
  const bodyCollider = publicCreateCollider(authoringCollider);
  const material = publicPhysicsMaterial(materialPreset);
  const nullableAuthoringJoint: ReturnType<PublicApi["createJoint"]> | undefined = undefined;
  const compatibleAuthoringJoint: PhysicsAuthoringJointHandle | undefined = nullableAuthoringJoint;
  const nullableWorld: PhysicsWorldApplyResult | undefined = undefined;
  const physicsSceneProfileId: PhysicsSceneProfileId = "runtime";
  const physicsSceneProfileSpec: PhysicsSceneProfileSpec = {
    profile: physicsSceneProfileId,
    physics: {
      mode: "rigid",
      bodies: {
        crate: { type: "dynamic", collider: { shape: "box", size: [8, 8] } },
      },
    },
  };
  const physicsSceneProfileOptions: ApplyPhysicsSceneProfileOptions = { path: "physicsScene" };
  const replayEvent: PhysicsReplayInputEvent = {
    frame: 0,
    body: "crate",
    type: "setVelocity",
    velocityX: 1,
    velocityY: 0,
  };
  const replayInputStream: PhysicsReplayInputStream = publicCreatePhysicsReplayInputStream({
    frameCount: 1,
    events: [replayEvent],
  });
  equal(publicPhysicsWorldSnapshotFormat, "ferrum2d.physics-world.snapshot");
  const nullableReplayRun: PhysicsReplayInputRunResult | undefined = undefined;
  const nullableWorkerReplayRun: PhysicsReplayWorkerRunResult | undefined = undefined;
  const nullableWorkerBenchmark: PhysicsReplayWorkerTransferBenchmarkResult | undefined = undefined;
  const pixelMaskOptions: PixelMaskTerrainOptions = { width: 2, height: 2, fill: "solid" };
  const pixelMaskLayerOptions: PixelMaskTerrainLayerOptions = { tileWidth: 4, tileHeight: 4 };
  const pixelMaskBoundaryOptions: PixelMaskTerrainBoundaryOptions = { physicsLayer: "world" };
  const pixelTerrain = publicCreatePixelMaskTerrain(pixelMaskOptions);
  const pixelTextureUploadOptions: PixelMaskTerrainTextureUploadOptions = {
    color: [255, 255, 255],
    alphaScale: 1,
  };
  const pixelRuntimeTarget: PixelMaskTerrainTextureTarget = {
    createPixelMaskTerrainTexture: () => undefined,
    updatePixelMaskTerrainTexture: () => undefined,
  };
  const pixelRuntimeOptions: PixelMaskTerrainRuntimeOptions = {
    terrain: pixelTerrain,
    texture: {
      target: pixelRuntimeTarget,
      textureId: 1,
      upload: pixelTextureUploadOptions,
    },
    clearDirtyAfterSync: true,
  };
  const nullablePixelRuntimeResult: PixelMaskTerrainRuntimeSyncResult | undefined = undefined;
  const pixelBoundary = publicExtractPixelMaskBoundaryChains(pixelTerrain, pixelMaskBoundaryOptions);
  const nullableDirtyRect: PixelMaskTerrainDirtyRect | undefined = pixelTerrain.dirtyRect();
  const nullableAlphaPatch: PixelMaskTerrainAlphaPatch | undefined = pixelTerrain.dirtyAlphaPatch();
  const tilemapBoundaryOptions: TilemapBoundaryExtractionOptions = { physicsLayer: "world" };
  const tilemapBoundaryResult: TilemapBoundaryExtractionResult = pixelTerrain.extractBoundaryChains(tilemapBoundaryOptions);
  const tilemapBoundaryChain: TilemapBoundaryChain | undefined = tilemapBoundaryResult.chains[0];
  const tileRuleGrid: TileRuleGrid = { columns: 1, rows: 1, data: [1] };
  const tileRules: TileRuleSpec[] = [{ match: "filled", output: 2 }];
  const tileRuleOptions: ApplyTileRulesOptions = { preserveUnmatched: false };
  const publicApplyTileRules: PublicApi["applyTileRules"] = applyTileRules;
  const animatedTileFrame: AnimatedTileFrameSpec = { tile: 4, durationMs: 100 };
  const animatedTile: AnimatedTileSpec = { frames: [3, animatedTileFrame], fps: 4 };
  const animatedTileOptions: AnimatedTileLayerOptions = { timeSeconds: 0.25 };
  const publicResolveAnimatedTileFrame: PublicApi["resolveAnimatedTileFrame"] = resolveAnimatedTileFrame;
  const publicBakeAnimatedTileLayer: PublicApi["bakeAnimatedTileLayer"] = bakeAnimatedTileLayer;
  equal(typeof publicCreateRigidBody, "function");
  equal(typeof publicCreatePhysicsWorldFromSpec, "function");
  equal(typeof publicCreatePhysicsReplayWorkerClient, "function");
  equal(publicPhysicsReplayWorkerRequestFormat, "ferrum2d.physics-replay.worker.request");
  equal(typeof publicCreatePixelMaskTerrain, "function");
  equal(typeof publicCreatePixelMaskTerrainRuntime, "function");
  equal(replayInputStream.frameCount, 1);
  equal(bodyCollider.type, "aabb");
  equal(material.density, 0.8);
  equal(authoringLayerSpec.player.mask[0], "world");
  equal(physicsLayerMap.player.maskBits, 2);
  equal(bodyAuthoring.material, "wood");
  equal(nullableWorld, undefined);
  equal(nullableReplayRun, undefined);
  equal(nullableWorkerReplayRun, undefined);
  equal(nullableWorkerBenchmark, undefined);
  equal(pixelMaskLayerOptions.tileWidth, 4);
  equal(pixelRuntimeOptions.texture?.textureId, 1);
  equal(nullablePixelRuntimeResult, undefined);
  equal(pixelBoundary.chainCount, 1);
  equal(nullableDirtyRect, undefined);
  equal(nullableAlphaPatch, undefined);
  equal(tilemapBoundaryChain?.collider.shape, "chain");
  equal(publicApplyTileRules(tileRuleGrid, tileRules, tileRuleOptions)[0], 2);
  equal(publicResolveAnimatedTileFrame(animatedTile, animatedTileOptions), 4);
  equal(publicBakeAnimatedTileLayer(tileRuleGrid, { 1: animatedTile }, animatedTileOptions)[0], 4);
});
