import { equal } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('packed public declarations compile and public native game files replay in an isolated consumer', async () => {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/ferrum-web');
  const project = await mkdtemp(join(tmpdir(), 'ferrum-public-types-'));
  try {
    const packed = join(project, 'packed');
    const installed = join(project, 'node_modules/@ferrum2d/ferrum-web');
    await mkdir(packed);
    await mkdir(installed, { recursive: true });
    await run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['pack', '--pack-destination', packed], packageRoot, 'Package pack');
    const tarballs = (await readdir(packed)).filter(name => name.endsWith('.tgz'));
    equal(tarballs.length, 1, 'expected one packed runtime package');
    await run('tar', ['-xzf', join(packed, tarballs[0]), '-C', installed, '--strip-components=1'], project, 'Packed package extraction');
    await writeFile(join(project, 'consumer.ts'), `
      import { createRenderer, restoreGameStateSnapshot,
        type PixelPerfectOptions, type FerrumEngine, type SpatialModelInstanceSpec, type SpatialDirectionalLightSpec, type SpatialPointShadowSpec,
        type SpriteLightingMaterialSpec, type SpriteLightingBufferView, type FlatLightingPreparer, type FlatHdrOptions, type ResolvedFlatHdrOptions,
        type SpriteSurfaceMaterialSpec, type SpriteSurfaceBufferView, type SpriteLightMaskBufferView, type SpatialReceiverMaskBufferView,
        type GameStateSnapshot, type UnifiedPhysicsOptions, type UnifiedPhysicsBodyStateBufferView,
        type FerrumUnifiedPhysicsApi, type FerrumUnifiedPhysicsCommandApi, UNIFIED_PHYSICS_STATE_LAYOUT,
        type UnifiedPhysicsBodyOptions, type UnifiedPhysicsShape, type UnifiedPhysicsCharacterOptions, UNIFIED_PHYSICS_CHARACTER_LAYOUT,
        createUnifiedPhysicsQueryBatch, UNIFIED_PHYSICS_QUERY_LAYOUT, type UnifiedPhysicsQuery, type UnifiedPhysicsQueryBatch,
        type UnifiedPhysicsQueryBufferView, type FerrumUnifiedPhysicsQueryApi,
        UNIFIED_PHYSICS_COLLISION_LAYOUT, type FerrumUnifiedPhysicsCollisionApi, type UnifiedPhysicsCollisionBufferView,
        UNIFIED_PHYSICS_CONTACT_LAYOUT, UNIFIED_PHYSICS_OBSERVATION_LAYOUT, UNIFIED_PHYSICS_COUNTER_LAYOUT,
        type FerrumUnifiedPhysicsObservationApi, type UnifiedPhysicsContactQuery, type UnifiedPhysicsContactBufferView,
        type UnifiedPhysicsObservationBufferView, type UnifiedPhysicsDiagnostics, type UnifiedPhysicsCounters,
      } from '@ferrum2d/ferrum-web/core';
      import {
        createSceneInstanceHandleRegistry,
        type ApplySceneBehaviorRecipesOptions,
        type SceneInstanceHandleRegistry,
        type ScenePlacementViewer,
        type SceneSpatialPatch,
        type DataSceneSpriteSurfaceSpec, type ResolvedDataSceneSpriteSurface, type DataSceneSpriteVisualSpec,
        type FlatLightingAsset,
        type FlatLightingPreparer as AuthoringFlatLightingPreparer,
        applyDataSceneAuthoringDocument,
      } from '@ferrum2d/ferrum-web/authoring';
      import '@ferrum2d/ferrum-web/starter-scenes';
      import type { LightingScene2D, PointLightSpot2D, PointLightCookie2D, ResolvedPointLightCookie2D, PolygonOccluder2D } from '@ferrum2d/ferrum-web/labs';
      import type { RuntimeDiagnosticsBudget } from '@ferrum2d/ferrum-web/quality';
      const config: PixelPerfectOptions = { width: 320, height: 180, snap: true };
      const disabled: PixelPerfectOptions = { ...config, snap: false };
      // @ts-expect-error snap is strictly boolean
      const invalid: PixelPerfectOptions = { ...config, snap: 'on' };
      declare const engine: FerrumEngine;
      const observedPositions: readonly (import('@ferrum2d/ferrum-web/core').GameplayPosition | undefined)[] = engine.queryGameplayPositions([]);
      const observedProgress: import('@ferrum2d/ferrum-web/core').BuiltInShooterProgress | undefined = engine.builtInShooterProgress();
      const observedActions: import('@ferrum2d/ferrum-web/core').BuiltInShooterPlayerActions | undefined = engine.builtInShooterPlayerActions();
      const gameplayObservationApi: import('@ferrum2d/ferrum-web/core').FerrumGameplayObservationApi = engine;
      declare const terrainFrame: import('@ferrum2d/ferrum-web/core').TerrainImpactBufferView;
      const terrainWords: Uint32Array = terrainFrame.words;
      const terrainStride: 24 = terrainFrame.stride;
      declare const jsonHost: import('@ferrum2d/ferrum-web/core').BrowserPlatformHost;
      declare const jsonLoader: import('@ferrum2d/ferrum-web/core').AssetLoader;
      const retainedJson: unknown = jsonHost.getJsonAsset('game');
      const loadedJson: unknown = jsonLoader.getJsonAsset('game');
      const customHost: import('@ferrum2d/ferrum-web/core').AssetHost = jsonHost;
      const optionalJson: unknown = customHost.getJsonAsset?.('game');
      const nativeSessionPromise: Promise<import('@ferrum2d/ferrum-web/core').NativeGameFileSession> =
        import('@ferrum2d/ferrum-web/core').then(api => api.createNativeGameFileSession(engine, { wasm: new Uint8Array() }));
      declare const nativeSession: import('@ferrum2d/ferrum-web/core').NativeGameFileSession;
      const currentFileEngine: FerrumEngine = nativeSession.current();
      const fileEpoch: number = nativeSession.epoch();
      const preparedFile: Promise<import('@ferrum2d/ferrum-web/core').NativeGameFileReady> = nativeSession.prepare(new Blob([]));
      // @ts-expect-error public file sessions do not expose the private Wasm bridge
      nativeSession.bridge;
      // @ts-expect-error public file sessions do not expose the unpublished native target
      nativeSession.target;
      const collisionMap: import('@ferrum2d/ferrum-web/core').DataSceneCollisionTilemapOptions = {
        columns: 1, rows: 1, tileWidth: 10, tileHeight: 10, tiles: [1], definitions: [{ id: 1, blocksMovement: false }]
      };
      const collisionMapAccepted: boolean = engine.configureDataSceneCollisionTilemap(collisionMap);
      engine.configureDataSceneCollisionTilemap(false);
      const kinematicController: import('@ferrum2d/ferrum-web/core').PhysicsKinematicControllerOptions = {
        solidMaskBits: 8, maxIterations: 8, maxStepHeight: 4, maxDropHeight: 8, allowLedgeDrop: true,
      };
      const rootController: import('@ferrum2d/ferrum-web').PhysicsKinematicControllerOptions = kinematicController;
      const controllerAccepted: boolean = engine.configureDataSceneKinematicController({ entityId: 1, entityGeneration: 2 }, rootController);
      engine.configureDataSceneKinematicController({ entityId: 1, entityGeneration: 2 }, false);
      // @ts-expect-error controller limits must be numbers
      engine.configureDataSceneKinematicController({ entityId: 1, entityGeneration: 2 }, { maxStepHeight: 'high' });
      // @ts-expect-error controller ledge policy is strictly boolean
      engine.configureDataSceneKinematicController({ entityId: 1, entityGeneration: 2 }, { allowLedgeDrop: 1 });
      const backend: 'legacy' | 'unified-3d' = engine.physicsBackend();
      declare const physicsSpec: import('@ferrum2d/ferrum-web/core').ResolvedPhysicsSpec;
      engine.validatePhysicsRuntime(physicsSpec);
      const configuredPhysics = engine.configurePhysicsRuntime(physicsSpec);
      const worldOptions: import('@ferrum2d/ferrum-web/authoring').PhysicsWorldApplyOptions = { configureRuntime: false };
      const memoryCheckpoint: import('@ferrum2d/ferrum-web/core').RuntimeCheckpoint = engine.captureRuntimeCheckpoint();
      const rollbackRevision: number = engine.runtimeCheckpointRevision();
      const rollbackApi: import('@ferrum2d/ferrum-web/core').FerrumRuntimeCheckpointApi = engine;
      rollbackApi.restoreRuntimeCheckpoint(memoryCheckpoint); memoryCheckpoint.dispose();
      const nativeNavigationAvailable: boolean = engine.supportsDataSceneNativeCombatNavigation();
      const nativeCrowdAvailable: boolean = engine.supportsDataSceneNativeCombatCrowd();
      const nativeMovementAvailable: boolean = engine.supportsDataSceneNativeCombatMovement();
      const authoredBody: import('@ferrum2d/ferrum-web/authoring').DataScenePhysicsBodySpec = {
        kind: 'dynamic', elevation: 8, collider: { shape: { type: 'sphere', radius: 1 } },
      };
      const coreBody: import('@ferrum2d/ferrum-web/core').DataScenePhysicsBodySpec = authoredBody;
      const authoredController: typeof coreBody = {kind: 'kinematic-position', collider: {shape: {type: 'capsule', halfHeight: 1, radius: 0.5}}, character: {stepHeight: 0.3}};
      const joint: import('@ferrum2d/ferrum-web/authoring').DataScenePhysicsJointSpec = {bodyA: 'a', bodyB: 'b', kind: {type: 'fixed'}};
      const coreJoint: import('@ferrum2d/ferrum-web/core').DataScenePhysicsJointSpec = joint;
      const physicsWorld: import('@ferrum2d/ferrum-web/core').DataScenePhysicsSpec = {space: 'spatial', gravity: [0,-10,0], lengthUnit: 1, joints: {lock: coreJoint}};
      // @ts-expect-error authored endpoints use instance IDs, not native runtime handles
      const badJoint: typeof joint = {...joint, bodyA: {entityId: 1, entityGeneration: 1}};
      // @ts-expect-error remove the authored character field to disable; false is a runtime API command only
      const badController: typeof authoredController = {...authoredController, character: false};
      const authoredDocument: import('@ferrum2d/ferrum-web/authoring').SceneAuthoringDocumentSpec = {
        format: 'ferrum2d.consumer.scene-authoring', version: 1,
        physics: {space: 'spatial', gravity: [0, -9.81, 0], lengthUnit: 1},
        sceneComposition: {initialFragment: 'main', prefabs: {}, fragments: {main: {instances: []}}},
        behaviorRecipes: {entities: {}},
      };
      const authoredResult = applyDataSceneAuthoringDocument(engine, {...authoredDocument, physics: physicsWorld});
      const authoredJointHandle: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsJointHandle | undefined = authoredResult.physicsJoints?.lock;
      // @ts-expect-error body position belongs to placement/elevation, not a second pose
      const authoredPose: typeof authoredBody = {...coreBody, pose: {position: [0, 0, 0]}};
      // @ts-expect-error legacy and shape-based body encodings cannot be mixed
      const authoredLegacy: typeof authoredBody = {...coreBody, type: 'dynamic'};
      // @ts-expect-error authored body still requires its collider
      const authoredMissing: typeof authoredBody = {kind: 'fixed'};
      const unified: FerrumUnifiedPhysicsApi = engine;
      const unifiedOptions: UnifiedPhysicsOptions = { space: 'planar-xy', gravity: [0, 980, 0], lengthUnit: 100 };
      unified.configureUnifiedPhysics(unifiedOptions);
      const physicsHandles = new Uint32Array([1, 1]);
      const nativeStates: UnifiedPhysicsBodyStateBufferView = unified.queryUnifiedPhysicsBodyStates(physicsHandles);
      unified.setUnifiedPhysicsVelocities(physicsHandles, new Float32Array([1, 0, 0, 0, 0, 0]));
      const positionX: number = nativeStates.floats[UNIFIED_PHYSICS_STATE_LAYOUT.position];
      // @ts-expect-error all three world gravity axes are required
      const invalidUnified: UnifiedPhysicsOptions = { ...unifiedOptions, gravity: [0, 980] };
      // @ts-expect-error velocity batches are f32 rather than u32
      unified.setUnifiedPhysicsVelocities(physicsHandles, physicsHandles);
      void [positionX, invalidUnified];
      const nativeShape: UnifiedPhysicsShape = { type: 'heightfield', rows: 2, columns: 2, size: [10, 10], heights: [0, 0, 1, 1] };
      const nativeBody: UnifiedPhysicsBodyOptions = { kind: 'fixed', collider: { shape: nativeShape } };
      const nativeHandle = unified.spawnUnifiedPhysicsBody(nativeBody);
      const controller: UnifiedPhysicsCharacterOptions = { up: [0, 1, 0], stepHeight: 0.4 };
      unified.configureUnifiedPhysicsCharacter(nativeHandle, controller);
      unified.setUnifiedPhysicsCharacterInputs(physicsHandles, new Float32Array([1, 0, 0, 0]));
      const grounded = unified.queryUnifiedPhysicsCharacterStates(physicsHandles).words[UNIFIED_PHYSICS_CHARACTER_LAYOUT.flags];
      unified.configureUnifiedPhysicsCharacter(nativeHandle, false);
      unified.removeUnifiedPhysicsBody(nativeHandle);
      // @ts-expect-error compound parts cannot contain nested terrain shapes
      const invalidPart: UnifiedPhysicsShape = { type: 'compound', parts: [{ shape: nativeShape }] };
      void [grounded, invalidPart];
      const commands: FerrumUnifiedPhysicsCommandApi = unified;
      commands.setUnifiedPhysicsPoses(physicsHandles, new Float32Array([0, 0, 0, 0, 0, 0, 1]));
      commands.setUnifiedPhysicsKinematicTargets(physicsHandles, new Float32Array([1, 0, 0, 0, 0, 0, 1]));
      commands.addUnifiedPhysicsForces(physicsHandles, new Float32Array(6));
      commands.applyUnifiedPhysicsImpulses(physicsHandles, new Float32Array(6));
      commands.clearUnifiedPhysicsForces(physicsHandles);
      commands.setUnifiedPhysicsSleeping(physicsHandles, true);
      // @ts-expect-error bulk poses require f32 arrays
      commands.setUnifiedPhysicsPoses(physicsHandles, physicsHandles);
      // @ts-expect-error sleeping is boolean, not numeric metadata
      commands.setUnifiedPhysicsSleeping(physicsHandles, 1);
      const query: UnifiedPhysicsQuery = {type:'ray', origin:[0,10,0], direction:[0,-1,0], maxDistance:20, limit:4};
      const queryBatch: UnifiedPhysicsQueryBatch = createUnifiedPhysicsQueryBatch([query,
        {type:'sweep', shape:{type:'sphere',radius:0.5}, translation:[0,-4,0], filter:{excludeBody:nativeHandle}}]);
      queryBatch.values[UNIFIED_PHYSICS_QUERY_LAYOUT.inputPosition] = 2;
      const queryApi: FerrumUnifiedPhysicsQueryApi = engine;
      const queryResult: UnifiedPhysicsQueryBufferView = queryApi.queryUnifiedPhysics(queryBatch);
      const hitCount: number = queryResult.summaries[UNIFIED_PHYSICS_QUERY_LAYOUT.summaryCount];
      // @ts-expect-error query shapes are convex, not terrain meshes
      const badQuery: UnifiedPhysicsQuery = {type:'overlap',shape:nativeShape};
      void [hitCount,badQuery];
      const collisionApi: FerrumUnifiedPhysicsCollisionApi = engine;
      collisionApi.setUnifiedPhysicsCollisionEventsEnabled(true);
      const collisionEvents: UnifiedPhysicsCollisionBufferView = collisionApi.drainUnifiedPhysicsCollisionEvents();
      const collisionPairs: UnifiedPhysicsCollisionBufferView = collisionApi.queryUnifiedPhysicsCollisionPairs();
      const phase: number = collisionEvents.words[UNIFIED_PHYSICS_COLLISION_LAYOUT.phase];
      // @ts-expect-error event capture takes an explicit boolean
      collisionApi.setUnifiedPhysicsCollisionEventsEnabled(1);
      void [collisionPairs, phase];
      const bindingApi: import('@ferrum2d/ferrum-web/core').FerrumUnifiedPhysicsBindingApi = engine;
      bindingApi.bindUnifiedPhysicsBody(nativeHandle, nativeBody);
      bindingApi.unbindUnifiedPhysicsBody(nativeHandle);
      // @ts-expect-error bind requires a generation-bearing entity handle
      bindingApi.bindUnifiedPhysicsBody(1, nativeBody);
      // @ts-expect-error a collider is required when binding physics
      bindingApi.bindUnifiedPhysicsBody(nativeHandle, {kind:'fixed'});
      const jointApi: import('@ferrum2d/ferrum-web/core').FerrumUnifiedPhysicsJointApi = engine;
      const jointMotor: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsJointMotor = {targetPosition:0,targetVelocity:1,stiffness:2,damping:3,maxForce:4};
      const jointSpring: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsJointSpring = {stiffness:2,damping:3};
      const jointKind: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsJointKind = {type:'continuousRevolute',limits:[-10,10],motor:jointMotor};
      const jointOptions: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsJointOptions = {bodyA:nativeHandle,bodyB:nativeHandle,kind:jointKind,linearSpring:jointSpring};
      const jointHandle: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsJointHandle = jointApi.createUnifiedPhysicsJoint(jointOptions);
      jointApi.updateUnifiedPhysicsJoint(jointHandle,jointOptions);
      const jointStates: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsJointBufferView = jointApi.queryUnifiedPhysicsJointStates();
      jointApi.setUnifiedPhysicsJointEventsEnabled(true);jointApi.drainUnifiedPhysicsJointEvents();jointApi.removeUnifiedPhysicsJoint(jointHandle);
      // @ts-expect-error continuous hinges require their multi-turn bounds
      const incompleteJoint: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsJointKind = {type:'continuousRevolute'};
      // @ts-expect-error joint identities use uint32 pairs
      jointApi.queryUnifiedPhysicsJointStates(new Float32Array(2));
      // @ts-expect-error streaming flag is strictly boolean
      jointApi.setUnifiedPhysicsJointEventsEnabled(1);
      void [jointStates,incompleteJoint];
      const controlApi: import('@ferrum2d/ferrum-web/core').FerrumUnifiedPhysicsControlApi = engine;
      const bodySettings: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsBodySettings = {
        kind:'dynamic',enabled:true,gravityScale:1,linearDamping:0,angularDamping:0,canSleep:true,ccd:false,lockRotation:false
      };
      const massProperties: import('@ferrum2d/ferrum-web/core').UnifiedPhysicsMassProperties = {
        mass:2,principalInertia:[4,4,4],center:[0,0,0],inertiaRotation:[0,0,0,1]
      };
      controlApi.setUnifiedPhysicsBodyOptions(nativeHandle,bodySettings);
      controlApi.setUnifiedPhysicsMassProperties(nativeHandle,massProperties);
      const fixture=controlApi.queryUnifiedPhysicsColliders(nativeHandle)[0];
      const addedFixture=controlApi.addUnifiedPhysicsCollider(nativeHandle,{shape:nativeShape});
      controlApi.updateUnifiedPhysicsCollider(nativeHandle,fixture,{shape:nativeShape});
      controlApi.removeUnifiedPhysicsCollider(nativeHandle,addedFixture);
      // @ts-expect-error body settings replace every flag; this is not a partial patch
      controlApi.setUnifiedPhysicsBodyOptions(nativeHandle,{enabled:false});
      // @ts-expect-error entity identity is not a collider identity
      controlApi.removeUnifiedPhysicsCollider(nativeHandle,nativeHandle);
      const observationApi: FerrumUnifiedPhysicsObservationApi = engine;
      const contactOptions: UnifiedPhysicsContactQuery = {categoryA:2,categoryB:4,includeSensors:true,maxManifolds:16,maxPoints:128};
      const contactView: UnifiedPhysicsContactBufferView = observationApi.queryUnifiedPhysicsContactManifolds(contactOptions);
      const observations: UnifiedPhysicsObservationBufferView = observationApi.queryUnifiedPhysicsObservations();
      const nativeDiagnostics: UnifiedPhysicsDiagnostics | undefined = observationApi.queryUnifiedPhysicsDiagnostics();
      const nativeCounters: UnifiedPhysicsCounters = observations.diagnostics.frame;
      const backendSteps: number = nativeCounters.backendSteps;
      // @ts-expect-error contact flags must be boolean
      observationApi.queryUnifiedPhysicsContactManifolds({includeSensors:1});
      // @ts-expect-error native counters do not pretend to measure legacy warm-start row operations
      const unsupportedCounter = nativeCounters.warmStartRows;
      void [contactView,nativeDiagnostics,backendSteps,unsupportedCounter,UNIFIED_PHYSICS_CONTACT_LAYOUT,
        UNIFIED_PHYSICS_OBSERVATION_LAYOUT,UNIFIED_PHYSICS_COUNTER_LAYOUT];
      declare const viewer: ScenePlacementViewer;
      declare const renderer: Awaited<ReturnType<typeof createRenderer>>;
      declare const saved: GameStateSnapshot;
      const receiver: SpriteLightingMaterialSpec = { mode: 'cutout', alphaCutoff: 0.5, lightMask: 1, shadowMask: 0 };
      const maskSidecar: SpriteLightMaskBufferView = { version: 1, stride: 2, buffer: new Uint32Array([1, 0]) };
      // @ts-expect-error light channels are numeric bit masks
      const badMask: SpriteLightingMaterialSpec = { mode: 'opaque', lightMask: 'all' };
      void [maskSidecar, badMask];
      const hdr: FlatHdrOptions = { exposure: -1, toneMapping: 'aces' };
      const resolvedHdr: ResolvedFlatHdrOptions = { enabled: false, exposure: 2, toneMapping: 'reinhard' };
      const cone: PointLightSpot2D = { directionX: 1, directionY: 0, angleDegrees: 90, penumbra: 0 };
      // @ts-expect-error cone direction components are numeric
      const invalidCone: PointLightSpot2D = { ...cone, directionX: 'right' };
      void invalidCone;
      const namedCookie: PointLightCookie2D = { texture: 'pattern', rotationRadians: 0, uv: [1, 0, 0, 1] };
      const cookie: PointLightCookie2D = { textureId: 7 };
      const resolvedCookie: ResolvedPointLightCookie2D = { texture: 'pattern', rotationRadians: 0, uv: [0, 0, 1, 1] };
      // @ts-expect-error cookie references must be unambiguous
      const ambiguousCookie: PointLightCookie2D = { texture: 'pattern', textureId: 7 };
      void [namedCookie, resolvedCookie, ambiguousCookie];
      const polygon: PolygonOccluder2D = { vertices: [{ x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }] };
      const lighting: LightingScene2D = { profile: 'lit', hdr, pointLights: [{ x: 10, y: 10, radius: 100, spot: cone, cookie }], polygonOccluders: [polygon], ambientIrradiance: [0.2, 0.2, 0.2], directionalLight: { directionX: 1, directionY: 0, lightMask: 2, shadowMask: 4 } };
      renderer.setLighting({ ...lighting, hdr: resolvedHdr });
      // @ts-expect-error tone mapping modes are explicit
      const invalidHdr: FlatHdrOptions = { toneMapping: 'filmic' };
      void invalidHdr;
      const assets: FlatLightingAsset[] = [{ textureId: 1, lighting: receiver }];
      const preparer: FlatLightingPreparer = renderer;
      const cookieVersion: number | undefined = preparer.flatLightingCookieVersion?.();
      const polygonVersion: number | undefined = preparer.flatLightingPolygonVersion?.();
      void polygonVersion;
      void cookieVersion;
      const authoredPreparer: AuthoringFlatLightingPreparer = preparer;
      const words = new Uint32Array(2);
      const sidecar: SpriteLightingBufferView = { version: 1, stride: 2, words, values: new Float32Array(words.buffer) };
      engine.configureSpriteLightingMaterials([{ entity: { entityId: 1, entityGeneration: 1 }, lighting: receiver }]);
      const surface: SpriteSurfaceMaterialSpec = { emission: [4, 2, 1], emissionTextureId: 12, specular: 0.6, roughness: 0.5 };
      engine.configureSpriteSurfaceMaterials([{ entity: { entityId: 1, entityGeneration: 1 }, surface }]);
      const surfaceWords = new Uint32Array(10);
      const surfaceSidecar: SpriteSurfaceBufferView = { version: 1, stride: 10, words: surfaceWords, values: new Float32Array(surfaceWords.buffer) };
      const authoredSurface: DataSceneSpriteSurfaceSpec = { emission: [4, 2, 1], emissionTexture: 'glow', specularTexture: 10, roughness: 0 };
      const visual: DataSceneSpriteVisualSpec = { kind: 'sprite', texture: 'base', width: 16, height: 16, lighting: receiver, surface: authoredSurface };
      const resolvedSurface: ResolvedDataSceneSpriteSurface = { emissionTexture: { kind: 'asset', value: 'glow', name: 'glow' } };
      // @ts-expect-error metallic is outside this bounded non-metallic profile
      const metallicSurface: SpriteSurfaceMaterialSpec = { metallic: 1 };
      // @ts-expect-error authored references use stable map fields rather than runtime ID aliases
      const runtimeAuthoredSurface: DataSceneSpriteSurfaceSpec = { emissionTextureId: 12 };
      void [surfaceSidecar, visual, resolvedSurface, metallicSurface, runtimeAuthoredSurface];
      renderer.loadTexture(1, 'surface.png', { alphaMode: 'straight' });
      renderer.prepareFlatLighting(lighting, assets);
      renderer.setLighting(lighting);
      applyDataSceneAuthoringDocument(engine, {}, { flatLightingPreparer: authoredPreparer });
      restoreGameStateSnapshot(engine, saved, { dataSceneAuthoringApplyOptions: { flatLightingPreparer: preparer } });
      // @ts-expect-error receiver modes are explicit
      const invalidReceiver: SpriteLightingMaterialSpec = { mode: 'lit' };
      // @ts-expect-error the alpha upload override accepts straight alpha only
      renderer.loadTexture(1, 'surface.png', { alphaMode: 'premultiplied' });
      void [sidecar, invalidReceiver];
      const spatialMasks: SpatialReceiverMaskBufferView = { version: 1, stride: 2, terrain: new Uint32Array([1, 0]), billboards: new Uint32Array(), models: new Uint32Array() };
      const receiverPatch: SceneSpatialPatch = { format: 'ferrum2d.scene-spatial.patch', version: 8, operations: [{ kind: 'updateModel', id: 'proxy', changes: { lightMask: 1, shadowMask: 0 } }] };
      viewer.updateSpatial(receiverPatch.operations);
      const maskedModel: SpatialModelInstanceSpec = { asset: 'tree', contentId: 'a'.repeat(64), lightMask: 0, shadowMask: 1 };
      void [spatialMasks, maskedModel];
      const sun: SpatialDirectionalLightSpec = { lightMask: 1, shadowMask: 0, direction: { x: -1, y: -1, elevation: 1 }, shadows: { center: { x: 0, y: 10, elevation: 12 } } };
      engine.setDataSceneSpatialEnvironment({ lighting: { lights: [], directional: sun } });
      engine.setDataSceneSpatialEnvironment({ composition: 'separated', lighting: { lights: [] }, ambientOcclusion: { strength: 0 } });
      engine.setDataSceneSpatialEnvironment({ composition: 'separated', bloom: { mode: 'wide', quality: 'high', radius: 64 } });
      const shadowOwners: readonly SpatialPointShadowSpec[] = [{ lightIndex: 0, resolution: 128 }, { lightIndex: 1, normalBias: 0.1 }];
      const pointEnvironment = { lighting: { lights: [{ position: { x: -40, y: 0, elevation: 64 }, radius: 200 }, { position: { x: 40, y: 0, elevation: 64 }, radius: 200 }], pointShadows: shadowOwners } };
      engine.setDataSceneSpatialEnvironment(pointEnvironment);
      const pointPatch: SceneSpatialPatch = { format: 'ferrum2d.scene-spatial.patch', version: 11,
        operations: [{ kind: 'setEnvironment', changes: { environment: pointEnvironment } }] };
      viewer.updateSpatial(pointPatch.operations);
      // @ts-expect-error point cube resolutions remain bounded
      const invalidShadowOwner: SpatialPointShadowSpec = { lightIndex: 0, resolution: 2048 };
      void invalidShadowOwner;

      const bloomPatch: SceneSpatialPatch = { format: 'ferrum2d.scene-spatial.patch', version: 10,
        operations: [{ kind: 'setEnvironment', changes: { environment: { composition: 'separated', bloom: { mode: 'wide', quality: 'low' } } } }] };
      viewer.updateSpatial(bloomPatch.operations);
      const bloomBudget: RuntimeDiagnosticsBudget = { maxSpatialBloomDrawCalls: 6, maxSpatialBloomTextureBytes: 44032, maxSpatialBloomTexelFetchBudget: 89600 };
      const bloomWork: number | undefined = renderer.stats().spatialBloomTexelFetchBudget;
      // @ts-expect-error wide quality choices are explicit
      engine.setDataSceneSpatialEnvironment({ composition: 'separated', bloom: { mode: 'wide', quality: 'ultra' } });
      void [bloomBudget, bloomWork];
      // @ts-expect-error composition choices are explicit
      engine.setDataSceneSpatialEnvironment({ composition: 'ambient-only' });
      // @ts-expect-error fixed sun center requires all three world coordinates
      const incompleteCenter: NonNullable<SpatialDirectionalLightSpec['shadows']> = { center: { x: 0, y: 0 } };
      const proxy: SpatialModelInstanceSpec = { asset: 'proxy', contentId: 'a'.repeat(64), shadowOnly: true };
      const shadowPatch: SceneSpatialPatch = { format: 'ferrum2d.scene-spatial.patch', version: 7,
        operations: [{ kind: 'updateModel', id: 'proxy', changes: { shadowOnly: false } }] };
      viewer.updateSpatial(shadowPatch.operations);
      // @ts-expect-error shadowOnly requires a boolean
      const invalidProxy: SpatialModelInstanceSpec = { ...proxy, shadowOnly: 'on' };
      const registry: SceneInstanceHandleRegistry = createSceneInstanceHandleRegistry({
        entityExists: handle => handle.entityGeneration > 0,
      });
      registry.set('actor', { entityId: 1, entityGeneration: 1 });
      const behaviorOptions: ApplySceneBehaviorRecipesOptions = { instanceHandleRegistry: registry };
      viewer.addInstances('main', [{ id: 'tile_0', prefab: 'tile', x: 16, y: 16 }] as const);
      // @ts-expect-error batch requires a fragment string
      viewer.addInstances(1, []);
      // @ts-expect-error entries require a prefab
      viewer.addInstances('main', [{ id: 'tile_1' }]);
      void [config, disabled, invalid, engine, behaviorOptions, proxy, invalidProxy, sun, incompleteCenter];
    `);
    await writeFile(join(project, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'], types: [], strict: true, skipLibCheck: false, noEmit: true,
    }, files: ['consumer.ts'] }));
    const require = createRequire(join(packageRoot, 'package.json'));
    const output = await run(process.execPath, [require.resolve('typescript/lib/tsc.js'), '--project', join(project, 'tsconfig.json')], project, 'ES2022 public declaration check');
    equal(output, '');
    // Reuse this installed tarball for actual public API execution. The consumer
    // imports only /core; the harness supplies the deployed Wasm as an app asset.
    await writeFile(join(project, 'deployed.wasm'), await readFile(join(installed, 'pkg/ferrum_core_bg.wasm')));
    await writeFile(join(project, 'native-file-consumer.mjs'), `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      import { createEngine, initializeFerrumWasm, createNativeGameFileSession,
        NativeGameFileError, UNIFIED_PHYSICS_STATE_LAYOUT as L } from '@ferrum2d/ferrum-web/core';
      const binary = await readFile(new URL('./deployed.wasm', import.meta.url));
      await initializeFerrumWasm(binary);
      const pending = new Map(); let serial = 0, time = 0;
      globalThis.requestAnimationFrame = callback => { pending.set(++serial, callback); return serial; };
      globalThis.cancelAnimationFrame = id => pending.delete(id);
      const pump = () => { time += 10; const calls = [...pending.values()]; pending.clear();
        assert.equal(calls.length, 1); calls[0](time); };
      const frame = () => {};
      const initial = await createEngine(frame);
      initial.useDataScene();
      initial.configureUnifiedPhysics({ space:'planar-xy', gravity:[0,0,0], lengthUnit:1, stepSeconds:.01 });
      initial.configureFixedTimestep(false);
      const body = initial.spawnUnifiedPhysicsBody({ kind:'kinematic-velocity', linearVelocity:[2,0,0],
        collider:{shape:{type:'sphere',radius:.25}} });
      const handles = new Uint32Array([body.entityId, body.entityGeneration]);
      const x = e => { const view = e.queryUnifiedPhysicsBodyStates(handles); assert.equal(view.count,1); return view.floats[L.position]; };
      const files = await createNativeGameFileSession(initial, { wasm:binary,
        preparePlatform(context) { assert.deepEqual(context.requiredRoles,['frame.onFrame']);
          assert(!('target' in context) && !('bridge' in context));
          return { callbacks:{'frame.onFrame':frame}, dispose(){} }; } });
      try {
        initial.start(); for(let i=0;i<7;i++) pump(); initial.stop();
        const before = {time:initial.time(),x:x(initial)}; assert(before.time>0 && before.x>0);
        const file = await files.capture(), bad = file.slice(); bad[bad.length-1] ^= 1;
        await assert.rejects(files.prepare(new Blob([bad])), e => e instanceof NativeGameFileError);
        assert.equal(files.current(),initial); assert.equal(files.epoch(),0);
        const ready = await files.prepare(new Blob([file])); await files.commit(ready);
        const restored = files.current(); assert.notEqual(restored,initial); assert.equal(files.epoch(),1);
        assert.equal(restored.time(),before.time); assert.equal(x(restored),before.x);
        restored.start(); for(let i=0;i<7;i++) pump(); restored.stop();
        assert(restored.time()>before.time && x(restored)>before.x);
        assert((await files.capture()).length>288);
        await assert.rejects(files.commit(ready), e => e instanceof NativeGameFileError && e.code==='STALE');
      } finally { await files.dispose(); initial.destroy(); }
    `);
    equal(await run(process.execPath, [join(project, 'native-file-consumer.mjs')], project, 'Packed public native game-file replay'), '');
  } finally { await rm(project, { recursive: true, force: true }); }
});

function run(command, args, cwd, label) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; }); child.stderr.on('data', bytes => { output += bytes; });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) done(output);
      else reject(new Error(`${label} failed (${code ?? signal}):\n${output}`));
    });
  });
}
