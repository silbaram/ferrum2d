import type { AssetReleasePayload } from "@ferrum2d/ferrum-web/core";
import { LevelChunkStreamer, type SceneAuthoringDocumentSpec } from "@ferrum2d/ferrum-web/authoring";
import { demoDelay } from "./featureLoading";
import type { FeatureContext, FeatureExtra } from "./featureExtras";

export const streamingControls = `<div class="feature-buttons"><button data-chunk="0" aria-pressed="false">왼쪽 구역</button><button data-chunk="1" aria-pressed="false">가운데 구역</button><button data-chunk="2" aria-pressed="false">오른쪽 구역</button></div><output data-value="stream-status" role="status">구역을 선택하세요. 각 구역은 고유 이미지 1개와 공통 바닥을 사용합니다.</output><p>구역 로딩 전 250ms를 지연합니다. 로딩 중 다른 구역을 고르면 이전 요청을 취소합니다.</p>`;

export function createStreamingFeature(ctx: FeatureContext): FeatureExtra {
  const { root, runtime, signal, assets } = ctx;
  const names = ["energy", "ball", "wall"];
  const url = (name: string) => new URL(`./playground/${name}.png`, document.baseURI).href;
  const manifest = { id: "three-rooms", tileWidth: 32, tileHeight: 32, chunkColumns: 20, chunkRows: 12,
    chunks: names.map((name, index) => ({ id: String(index), chunkX: index, chunkY: 0,
      assets: { textures: { stream_ground: url("floor"), [`stream_${index}`]: url(name) } } })) };
  const streamer = LevelChunkStreamer.create(manifest, { preloadMarginChunks: 0, retainMarginChunks: 0 });
  const status = root.querySelector<HTMLOutputElement>('[data-value="stream-status"]')!;
  let selected = -1, visible = -1, generation = 0, pending = false, state = "idle", releases = 0;
  let controller: AbortController | undefined, tail = Promise.resolve();
  // All loads and cleanup are serialized so an old cancellation cannot evict a newer request's texture.
  const resident = new Map<string, string>();
  const release = (textures: Record<string, string>) => {
    if (signal.aborted) return;
    const entries = Object.entries(textures).map(([name, assetUrl]) => ({ kind: "texture" as const, name, url: assetUrl }));
    const payload: AssetReleasePayload = { entries, textures: entries, sounds: [], json: [], total: entries.length };
    const before = runtime.renderer.resourceStats?.()?.textureCount ?? 0;
    assets.releaseAssets(payload); for (const entry of entries) resident.delete(entry.name);
    releases += Math.max(0, before - (runtime.renderer.resourceStats?.()?.textureCount ?? before));
  };
  const camera = () => ({ x: 320 + Math.max(0, visible) * 640, y: 192, smoothTimeSeconds: 0 });
  const select = (index: number) => {
    if (!ctx.playing()) return;
    selected = index; const request = ++generation; controller?.abort(); pending = true; state = "loading";
    status.textContent = `${index + 1}번 구역 로딩 중…`;
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-chunk]")) button.setAttribute("aria-pressed", String(Number(button.dataset.chunk) === index));
    tail = tail.then(async () => {
      if (request !== generation || signal.aborted) return;
      controller = new AbortController(); const local = controller.signal;
      const plan = streamer.plan({ x: index * 640 + 1, y: 1, width: 638, height: 382 });
      const required = manifest.chunks[index].assets.textures;
      const missing = Object.fromEntries(Object.entries(required).filter(([name]) => !resident.has(name)));
      try {
        await demoDelay(250, local);
        await assets.loadAssets({ textures: missing }, undefined, { signal: local, concurrency: 2 });
        if (request !== generation || signal.aborted) { release(missing); return; }
        for (const [name, path] of Object.entries(missing)) resident.set(name, path);
        const doc = structuredClone(ctx.source as SceneAuthoringDocumentSpec);
        for (const instance of doc.sceneComposition.fragments!.lab.instances!) {
          instance.x = (instance.x ?? 0) + index * 640;
          // Known generator fixture: every instance has a sprite visual component.
          const components = instance.props!.components as { visual: { texture: string } };
          if (instance.id?.startsWith("floor_")) components.visual.texture = "stream_ground";
          if (instance.id === "energy") components.visual.texture = `stream_${index}`;
        }
        visible = index; ctx.reapply(doc);
        const unused = Object.fromEntries([...resident].filter(([name]) => !(name in required)));
        release(unused); streamer.markUnloaded(plan.unloadChunkIds); streamer.markLoaded(plan.loadChunkIds);
        state = "ready"; status.textContent = `${index + 1}번 구역 표시 · 공통 바닥 유지 · 전용 텍스처 ${releases}개 해제`;
      } catch (error) {
        // A cancelled batch may have completed a subset before observing the signal.
        release(missing);
        if (request === generation && !signal.aborted) { state = local.aborted ? "cancelled" : "error"; status.textContent = `구역 로딩 실패: ${error instanceof Error ? error.message : String(error)}`; }
      } finally { if (request === generation) pending = false; }
    });
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-chunk]")) button.addEventListener("click", () => select(Number(button.dataset.chunk)), { signal });
  const reset = () => {
    generation++; controller?.abort(); selected = visible = -1; pending = false; state = "idle";
    streamer.markUnloaded(streamer.snapshot().loadedChunkIds);
    for (const button of root.querySelectorAll("[data-chunk]")) button.setAttribute("aria-pressed", "false");
    status.textContent = "구역을 선택하세요.";
    tail = tail.then(() => { release(Object.fromEntries(resident)); releases = 0; });
  };
  return {
    reset, camera, frame() {}, pause() {},
    observation: () => `표시 ${visible < 0 ? "없음" : visible + 1} · 로드 ${streamer.snapshot().loadedChunkIds.length}구역 · 전용/공통 텍스처 ${resident.size}개 · GPU 텍스처 약 ${Math.round((runtime.renderer.resourceStats?.()?.textureBytes ?? 0) / 1024)} KiB · ${state}`,
    snapshot: () => ({ streaming: { selected, visible, pending, state, loaded: streamer.snapshot().loadedChunkIds, resident: [...resident.keys()].sort(), releases, resources: runtime.renderer.resourceStats?.() } }),
    destroy: () => { generation++; controller?.abort(); resident.clear(); },
  };
}
