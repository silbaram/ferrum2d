import { resolveManifestInput } from "./levelStreamingManifest.js";
import { resolveLevelStreamingPlanForResolvedManifest } from "./levelStreamingPlan.js";
import type {
  LevelChunkManifestSpec,
  LevelChunkStreamerSnapshot,
  LevelStreamingAssetLifetimePolicy,
  LevelStreamingPlan,
  LevelStreamingViewport,
  ResolvedLevelChunkManifest,
} from "./levelStreamingTypes.js";
import { invalid } from "./levelStreamingValidation.js";

export class LevelChunkStreamer {
  private readonly loadedChunkIds = new Set<string>();

  constructor(
    private readonly manifest: ResolvedLevelChunkManifest,
    private readonly assetLifetime: LevelStreamingAssetLifetimePolicy = {},
  ) {}

  static create(
    manifest: LevelChunkManifestSpec | ResolvedLevelChunkManifest,
    assetLifetime: LevelStreamingAssetLifetimePolicy = {},
  ): LevelChunkStreamer {
    return new LevelChunkStreamer(resolveManifestInput(manifest), assetLifetime);
  }

  plan(viewport: LevelStreamingViewport): LevelStreamingPlan {
    return resolveLevelStreamingPlanForResolvedManifest(
      this.manifest,
      viewport,
      this.assetLifetime,
      this.loadedChunkIds,
      false,
    );
  }

  markLoaded(chunkIds: readonly string[]): LevelChunkStreamerSnapshot {
    for (const chunkId of chunkIds) {
      this.requireChunk(chunkId);
      this.loadedChunkIds.add(chunkId);
    }
    return this.snapshot();
  }

  markUnloaded(chunkIds: readonly string[]): LevelChunkStreamerSnapshot {
    for (const chunkId of chunkIds) {
      this.loadedChunkIds.delete(chunkId);
    }
    return this.snapshot();
  }

  snapshot(): LevelChunkStreamerSnapshot {
    return {
      manifestId: this.manifest.id,
      loadedChunkIds: [...this.loadedChunkIds].sort(),
    };
  }

  private requireChunk(chunkId: string): void {
    if (this.manifest.chunksById[chunkId] === undefined) {
      throw invalid("levelStreaming.loadedChunkIds", `references missing chunk '${chunkId}'`);
    }
  }
}
