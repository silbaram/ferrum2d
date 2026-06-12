import {
  IndexedDbAssetCache,
  LevelChunkStreamer,
  LoadingOverlay,
  SCREENSHOT_CAPTURE_SUMMARY_FORMAT,
  SCREENSHOT_CAPTURE_SUMMARY_VERSION,
  TEXTURE_ATLAS_PACK_FORMAT,
  assertScreenshotCaptureSummary,
  assetManifestFingerprint,
  compareScreenshotSummaries,
  createAssetPreloadCachePolicy,
  equal,
  importAsepriteAtlas,
  importAsepriteAtlasFrames,
  importLDtkGameSpec,
  importLDtkTilemap,
  importTiledGameSpec,
  importTiledTilemap,
  invalidatePreloadedAssetCache,
  packTextureAtlas,
  preloadAssetManifest,
  resolveAssetPreloadPlan,
  resolveLevelChunkManifest,
  resolveLevelStreamingPlan,
  resolveScreenshotCaptureSpec,
  summarizeScreenshotPixels,
  test,
  textureAtlasDocumentToShooterAtlas,
} from "./publicApiTypes.shared.js";

import type {
  AsepriteAtlasImportOptions,
  AsepriteAtlasImportResult,
  AssetManifest,
  AssetReleaseEntry,
  AssetReleaseKind,
  AssetReleasePayload,
  AssetPreloadCache,
  AssetPreloadCachePolicy,
  AssetPreloadEntry,
  AssetPreloadInvalidationResult,
  AssetPreloadPlan,
  AtlasSpriteInput,
  AtlasSpritePlacement,
  BinaryAssetCache,
  BinaryCacheSetOptions,
  CreateAssetPreloadCachePolicyOptions,
  IndexedDbAssetCacheOptions,
  InvalidatePreloadedAssetCacheOptions,
  JsonAssetCache,
  JsonCacheSetOptions,
  LDtkEntityInstance,
  LDtkTilemapImportOptions,
  LDtkTilemapImportResult,
  LDtkTilesetFrameContext,
  LevelChunkBounds,
  LevelChunkManifestSpec,
  LevelChunkSpec,
  LevelChunkStreamerSnapshot,
  LevelStreamingAssetLifetimePolicy,
  LevelStreamingOrigin,
  LevelStreamingPlan,
  LevelStreamingPlanOptions,
  LevelStreamingViewport,
  LevelTilemapChunkSpec,
  LoadingOverlayOptions,
  LoadingOverlayState,
  LoadingOverlayStatus,
  PackedTextureAtlasDocument,
  PackedTextureAtlasFrame,
  PreloadAssetManifestOptions,
  PreloadedAssetManifest,
  PublicApi,
  ResolveLevelChunkManifestOptions,
  ResolvedLevelChunk,
  ResolvedLevelChunkManifest,
  ResolvedLevelTilemapChunk,
  ResolvedScreenshotCaptureSpec,
  ScreenshotCaptureSpec,
  ScreenshotColorSummary,
  ScreenshotComparisonReport,
  ScreenshotComparisonThreshold,
  ScreenshotPixelSummary,
  ShooterAtlasSpec,
  TextureAtlasLayout,
  TextureAtlasPackInput,
  TextureAtlasPackOptions,
  TiledLayerCompressionContext,
  TiledLayerDataDecoder,
  TiledTilemapImportOptions,
  TiledTilemapImportResult,
  TiledTilesetFrameContext,
  generateTextureAtlasLayout,
} from "./publicApiTypes.shared.js";
import type { AssetReleasePayload as CoreAssetReleasePayload } from "../src/core.js";

test("public API asset, streaming, pipeline, texture atlas, and screenshot types", () => {
  const manifest: AssetManifest = {
    textures: { player: "/assets/player.png" },
    sounds: { shoot: "/assets/shoot.wav" },
    json: { game: "/game.json" },
  };
  const releaseKind: AssetReleaseKind = "texture";
  const releaseEntry: AssetReleaseEntry = {
    kind: releaseKind,
    name: "player",
    url: "/assets/player.png",
  };
  const releasePayload: AssetReleasePayload = {
    entries: [releaseEntry],
    textures: [releaseEntry],
    sounds: [],
    json: [],
    total: 1,
  };
  const coreReleasePayload: CoreAssetReleasePayload = releasePayload;
  const publicResolveAssetPreloadPlan: PublicApi["resolveAssetPreloadPlan"] = resolveAssetPreloadPlan;
  const publicPreloadAssetManifest: PublicApi["preloadAssetManifest"] = preloadAssetManifest;
  const publicAssetManifestFingerprint: PublicApi["assetManifestFingerprint"] = assetManifestFingerprint;
  const publicCreateAssetPreloadCachePolicy: PublicApi["createAssetPreloadCachePolicy"] =
    createAssetPreloadCachePolicy;
  const publicInvalidatePreloadedAssetCache: PublicApi["invalidatePreloadedAssetCache"] =
    invalidatePreloadedAssetCache;
  const publicIndexedDbAssetCache: PublicApi["IndexedDbAssetCache"] = IndexedDbAssetCache;
  const publicLoadingOverlay: PublicApi["LoadingOverlay"] = LoadingOverlay;
  const assetPreloadCachePolicy: AssetPreloadCachePolicy = {
    json: true,
    textures: true,
    sounds: true,
    binary: true,
    version: "v1",
    ttlMs: 1000,
  };
  const assetPreloadPlan: AssetPreloadPlan = publicResolveAssetPreloadPlan(manifest);
  const firstAssetPreloadEntry: AssetPreloadEntry | undefined = assetPreloadPlan.entries[0];
  const cachePolicyOptions: CreateAssetPreloadCachePolicyOptions = {
    versionPrefix: "game",
    versionSalt: "release",
    ttlMs: 1000,
  };
  const derivedAssetPreloadCachePolicy: AssetPreloadCachePolicy =
    publicCreateAssetPreloadCachePolicy(manifest, cachePolicyOptions);
  const preloadOptions: PreloadAssetManifestOptions = { cachePolicy: derivedAssetPreloadCachePolicy };
  const invalidationOptions: InvalidatePreloadedAssetCacheOptions = { policy: derivedAssetPreloadCachePolicy };
  const nullableAssetPreloadInvalidation: AssetPreloadInvalidationResult | undefined = undefined;
  const nullablePreloadedManifest: PreloadedAssetManifest | undefined = undefined;
  const jsonCacheSetOptions: JsonCacheSetOptions = { version: "v1", ttlMs: 1000 };
  const binaryCacheSetOptions: BinaryCacheSetOptions = jsonCacheSetOptions;
  const indexedDbAssetCache = new publicIndexedDbAssetCache({ indexedDB: undefined });
  const assetPreloadCache: AssetPreloadCache = indexedDbAssetCache;
  const jsonAssetCache: JsonAssetCache = indexedDbAssetCache;
  const binaryAssetCache: BinaryAssetCache = indexedDbAssetCache;
  const indexedDbOptions: IndexedDbAssetCacheOptions = {
    databaseName: "ferrum-test",
    storeName: "json",
    binaryStoreName: "binary",
  };
  const levelOrigin: LevelStreamingOrigin = { x: 0, y: 0 };
  const levelTilemapChunk: LevelTilemapChunkSpec = { url: "/chunks/0-0.json", layer: "main" };
  const levelChunkSpec: LevelChunkSpec = {
    id: "0,0",
    chunkX: 0,
    chunkY: 0,
    tilemap: levelTilemapChunk,
    assets: manifest,
  };
  const levelManifestSpec: LevelChunkManifestSpec = {
    id: "world",
    tileWidth: 16,
    tileHeight: 16,
    chunkColumns: 4,
    chunkRows: 4,
    origin: levelOrigin,
    chunks: [levelChunkSpec],
  };
  const levelResolveOptions: ResolveLevelChunkManifestOptions = { path: "streaming" };
  const publicResolveLevelChunkManifest: PublicApi["resolveLevelChunkManifest"] = resolveLevelChunkManifest;
  const publicResolveLevelStreamingPlan: PublicApi["resolveLevelStreamingPlan"] = resolveLevelStreamingPlan;
  const publicLevelChunkStreamer: PublicApi["LevelChunkStreamer"] = LevelChunkStreamer;
  const resolvedLevelManifest: ResolvedLevelChunkManifest =
    publicResolveLevelChunkManifest(levelManifestSpec, levelResolveOptions);
  const resolvedLevelChunk: ResolvedLevelChunk = resolvedLevelManifest.chunks[0] as ResolvedLevelChunk;
  const resolvedLevelTilemapChunk: ResolvedLevelTilemapChunk =
    resolvedLevelChunk.tilemap as ResolvedLevelTilemapChunk;
  const levelChunkBounds: LevelChunkBounds = resolvedLevelChunk.bounds;
  const levelViewport: LevelStreamingViewport = { x: 0, y: 0, width: 16, height: 16 };
  const levelAssetLifetime: LevelStreamingAssetLifetimePolicy = { preloadMarginChunks: 0, retainMarginChunks: 0 };
  const levelPlanOptions: LevelStreamingPlanOptions = { assetLifetime: levelAssetLifetime };
  const levelStreamingPlan: LevelStreamingPlan =
    publicResolveLevelStreamingPlan(resolvedLevelManifest, levelViewport, levelPlanOptions);
  const levelStreamer = publicLevelChunkStreamer.create(resolvedLevelManifest, levelAssetLifetime);
  const levelStreamerSnapshot: LevelChunkStreamerSnapshot = levelStreamer.markLoaded(levelStreamingPlan.loadChunkIds);
  const loadingOverlayOptions: LoadingOverlayOptions = { title: "Loading", autoHideOnComplete: true };
  const loadingOverlayStatus: LoadingOverlayStatus = "loading";
  const loadingOverlayState: LoadingOverlayState = {
    status: loadingOverlayStatus,
    progress: { loaded: 1, total: 2, ratio: 0.5 },
    title: "Loading",
    detail: "Loading texture player (1/2)",
  };
  equal(typeof publicPreloadAssetManifest, "function");
  equal(releasePayload.textures[0]?.name, "player");
  equal(coreReleasePayload.total, 1);
  equal(assetPreloadPlan.total, 3);
  equal(firstAssetPreloadEntry?.kind, "texture");
  equal(publicAssetManifestFingerprint(manifest, "release").length > 0, true);
  equal(preloadOptions.cachePolicy?.json, true);
  equal(preloadOptions.cachePolicy?.textures, true);
  equal(derivedAssetPreloadCachePolicy.version?.startsWith("game-"), true);
  equal(invalidationOptions.policy?.binary, true);
  equal(nullableAssetPreloadInvalidation, undefined);
  equal(typeof publicInvalidatePreloadedAssetCache, "function");
  equal(assetPreloadCachePolicy.binary, true);
  equal(nullablePreloadedManifest, undefined);
  equal(jsonCacheSetOptions.version, "v1");
  equal(binaryCacheSetOptions.ttlMs, 1000);
  equal(typeof jsonAssetCache.getJson, "function");
  equal(typeof binaryAssetCache.getBinary, "function");
  equal(resolvedLevelManifest.id, "world");
  equal(resolvedLevelTilemapChunk.layer, "main");
  equal(levelChunkBounds.width, 64);
  equal(levelStreamingPlan.activeChunkIds[0], "0,0");
  equal(levelStreamingPlan.assetManifest.json?.["0,0:tilemap"], "/chunks/0-0.json");
  equal(levelStreamerSnapshot.loadedChunkIds[0], "0,0");
  equal(indexedDbOptions.storeName, "json");
  equal(indexedDbOptions.binaryStoreName, "binary");
  equal(typeof publicLoadingOverlay, "function");
  equal(loadingOverlayOptions.autoHideOnComplete, true);
  equal(loadingOverlayState.status, "loading");
  const asepriteImportOptions: AsepriteAtlasImportOptions = { texture: "sprites" };
  const publicImportAsepriteAtlas: PublicApi["importAsepriteAtlas"] = importAsepriteAtlas;
  const asepriteImportResult: AsepriteAtlasImportResult = publicImportAsepriteAtlas({
    frames: {
      "player.png": { frame: { x: 0, y: 0, w: 16, h: 16 } },
    },
    meta: { size: { w: 32, h: 32 } },
  }, asepriteImportOptions);
  const publicImportAsepriteAtlasFrames: PublicApi["importAsepriteAtlasFrames"] = importAsepriteAtlasFrames;
  const tiledImportOptions: TiledTilemapImportOptions = {
    externalTilesets: {
      "terrain.tsx": {
        name: "terrain",
        imagewidth: 8,
        imageheight: 8,
        tilewidth: 8,
        tileheight: 8,
        columns: 1,
        tilecount: 1,
      },
    },
    frameNameForGid: (context: TiledTilesetFrameContext) => `${context.tilesetName}.${context.localId}`,
    decodeCompressedLayerData: (bytes: Uint8Array, context: TiledLayerCompressionContext) => {
      equal(context.compression.length > 0, true);
      return bytes;
    },
  };
  const tiledLayerDataDecoder: TiledLayerDataDecoder = tiledImportOptions.decodeCompressedLayerData!;
  const publicImportTiledTilemap: PublicApi["importTiledTilemap"] = importTiledTilemap;
  const tiledImportResult: TiledTilemapImportResult = publicImportTiledTilemap({
    orientation: "orthogonal",
    width: 1,
    height: 1,
    tilewidth: 8,
    tileheight: 8,
    tilesets: [{
      firstgid: 1,
      source: "terrain.tsx",
    }],
    layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
  }, tiledImportOptions);
  const publicImportTiledGameSpec: PublicApi["importTiledGameSpec"] = importTiledGameSpec;
  const ldtkImportOptions: LDtkTilemapImportOptions = {
    externalLevels: {},
    frameNameForTile: (context: LDtkTilesetFrameContext) => `${context.tilesetIdentifier}.${context.ldtkTileId}`,
  };
  const publicImportLDtkTilemap: PublicApi["importLDtkTilemap"] = importLDtkTilemap;
  const ldtkImportResult: LDtkTilemapImportResult = publicImportLDtkTilemap({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        pxWid: 8,
        pxHei: 8,
        tileGridSize: 8,
      }],
    },
    levels: [{
      identifier: "Level_0",
      pxWid: 8,
      pxHei: 8,
      layerInstances: [{
        __identifier: "ground",
        __type: "Tiles",
        __cWid: 1,
        __cHei: 1,
        __gridSize: 8,
        __tilesetDefUid: 1,
        gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
      }, {
        __identifier: "actors",
        __type: "Entities",
        __gridSize: 8,
        entityInstances: [{
          __identifier: "Spawn",
          px: [0, 0],
          width: 8,
          height: 8,
          fieldInstances: [{
            __identifier: "role",
            __type: "String",
            __value: "player",
          }],
        }],
      }],
    }],
  }, ldtkImportOptions);
  const firstLDtkEntity: LDtkEntityInstance | undefined = ldtkImportResult.entities[0];
  const publicImportLDtkGameSpec: PublicApi["importLDtkGameSpec"] = importLDtkGameSpec;
  const atlasSprite: AtlasSpriteInput = { name: "compat", width: 8, height: 8 };
  const atlasPlacement: AtlasSpritePlacement = {
    name: atlasSprite.name,
    x: 0,
    y: 0,
    width: atlasSprite.width,
    height: atlasSprite.height,
    u0: 0,
    v0: 0,
    u1: 1,
    v1: 1,
  };
  const atlasLayoutFn: typeof generateTextureAtlasLayout = (() => ({
    width: 8,
    height: 8,
    sprites: [atlasPlacement],
  })) as typeof generateTextureAtlasLayout;
  const publicPackTextureAtlas: PublicApi["packTextureAtlas"] = packTextureAtlas;
  const publicTextureAtlasDocumentToShooterAtlas: PublicApi["textureAtlasDocumentToShooterAtlas"] =
    textureAtlasDocumentToShooterAtlas;
  const publicTextureAtlasPackFormat: PublicApi["TEXTURE_ATLAS_PACK_FORMAT"] = TEXTURE_ATLAS_PACK_FORMAT;
  const atlasPackInput: TextureAtlasPackInput = { name: "hero", source: "hero.png", width: 16, height: 16 };
  const atlasPackOptions: TextureAtlasPackOptions = { texture: "packed", padding: 1 };
  const atlasLayout: TextureAtlasLayout = atlasLayoutFn([atlasSprite]);
  const packedAtlasDocument: PackedTextureAtlasDocument =
    publicPackTextureAtlas([atlasPackInput], atlasPackOptions);
  const packedAtlasFrame: PackedTextureAtlasFrame = packedAtlasDocument.placements[0];
  const packedShooterAtlas: ShooterAtlasSpec =
    publicTextureAtlasDocumentToShooterAtlas(packedAtlasDocument);
  const screenshotCaptureSpec: ScreenshotCaptureSpec = {
    name: "Topdown Title",
    comparison: { maxAverageColorDelta: 0.01 },
  };
  const publicScreenshotCaptureSummaryFormat: PublicApi["SCREENSHOT_CAPTURE_SUMMARY_FORMAT"] =
    SCREENSHOT_CAPTURE_SUMMARY_FORMAT;
  const publicScreenshotCaptureSummaryVersion: PublicApi["SCREENSHOT_CAPTURE_SUMMARY_VERSION"] =
    SCREENSHOT_CAPTURE_SUMMARY_VERSION;
  const publicResolveScreenshotCaptureSpec: PublicApi["resolveScreenshotCaptureSpec"] =
    resolveScreenshotCaptureSpec;
  const publicSummarizeScreenshotPixels: PublicApi["summarizeScreenshotPixels"] =
    summarizeScreenshotPixels;
  const publicAssertScreenshotCaptureSummary: PublicApi["assertScreenshotCaptureSummary"] =
    assertScreenshotCaptureSummary;
  const publicCompareScreenshotSummaries: PublicApi["compareScreenshotSummaries"] =
    compareScreenshotSummaries;
  const resolvedScreenshotCaptureSpec: ResolvedScreenshotCaptureSpec =
    publicResolveScreenshotCaptureSpec(screenshotCaptureSpec);
  const screenshotColorSummary: ScreenshotColorSummary = { r: 1, g: 1, b: 1, a: 1 };
  const screenshotSummary: ScreenshotPixelSummary = publicSummarizeScreenshotPixels(
    new Uint8Array([255, 255, 255, 255]),
    1,
    1,
  );
  const screenshotThreshold: ScreenshotComparisonThreshold = { maxAverageColorDelta: 0 };
  const screenshotComparison: ScreenshotComparisonReport =
    publicCompareScreenshotSummaries(screenshotSummary, screenshotSummary, screenshotThreshold);
  const assertedScreenshotSummary: ScreenshotPixelSummary =
    publicAssertScreenshotCaptureSummary(screenshotSummary, resolvedScreenshotCaptureSpec);

  equal(manifest.textures?.player, "/assets/player.png");
  equal(asepriteImportResult.frameNames[0], "player");
  equal(publicImportAsepriteAtlasFrames({
    frames: {
      "enemy.png": { frame: { x: 0, y: 0, w: 8, h: 8 } },
    },
    meta: { size: { w: 16, h: 16 } },
  }, asepriteImportOptions).enemy.texture, "sprites");
  equal(tiledImportResult.usedGids[0], 1);
  equal(publicImportTiledGameSpec({
    orientation: "orthogonal",
    width: 1,
    height: 1,
    tilewidth: 8,
    tileheight: 8,
    tilesets: [{
      firstgid: 1,
      name: "terrain",
      imagewidth: 8,
      imageheight: 8,
      tilewidth: 8,
      tileheight: 8,
      columns: 1,
      tilecount: 1,
    }],
    layers: [{ type: "tilelayer", width: 1, height: 1, data: [1] }],
  }, tiledImportOptions).tilemap?.layers?.[0]?.data?.[0], 1);
  equal(tiledLayerDataDecoder(new Uint8Array(0), {
    compression: "zlib",
    path: "assetPipeline.tiled.layers.0.data",
    expectedByteLength: 0,
  }).byteLength, 0);
  equal(ldtkImportResult.usedTileIds[0], 1);
  equal(firstLDtkEntity?.fields.role, "player");
  equal(publicImportLDtkGameSpec({
    defs: {
      tilesets: [{
        uid: 1,
        identifier: "terrain",
        pxWid: 8,
        pxHei: 8,
        tileGridSize: 8,
      }],
    },
    levels: [{
      identifier: "Level_0",
      pxWid: 8,
      pxHei: 8,
      layerInstances: [{
        __identifier: "ground",
        __type: "Tiles",
        __cWid: 1,
        __cHei: 1,
        __gridSize: 8,
        __tilesetDefUid: 1,
        gridTiles: [{ px: [0, 0], src: [0, 0], t: 0, f: 0 }],
      }],
    }],
  }, ldtkImportOptions).tilemap?.layers?.[0]?.data?.[0], 1);
  equal(publicTextureAtlasPackFormat, "ferrum-texture-atlas-pack");
  equal(atlasLayout.width, 8);
  equal(packedAtlasFrame.name, "hero");
  equal(packedShooterAtlas.frames?.hero.texture, "packed");
  equal(publicScreenshotCaptureSummaryFormat, "ferrum-screenshot-capture-summary");
  equal(publicScreenshotCaptureSummaryVersion, 1);
  equal(resolvedScreenshotCaptureSpec.name, "Topdown-Title");
  equal(screenshotColorSummary.a, 1);
  equal(screenshotSummary.contentHash, assertedScreenshotSummary.contentHash);
  equal(screenshotComparison.passed, true);
});
