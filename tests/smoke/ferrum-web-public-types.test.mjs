import { equal } from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('packed public declarations compile in an ES2022 consumer without skipping library checks', async () => {
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
        type GameStateSnapshot,
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
