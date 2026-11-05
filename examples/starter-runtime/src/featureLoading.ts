import { preloadAssetManifest, type AssetPreloadCache } from "@ferrum2d/ferrum-web/core";
import type { FeatureContext, FeatureExtra } from "./featureExtras";

/** Demo-only latency, cancellable without leaving timers or listeners behind. */
export function demoDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
    const cancel = () => { clearTimeout(timer); signal.removeEventListener("abort", cancel); reject(new DOMException("Cancelled", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

export const loadingControls = `<div class="feature-buttons"><button data-control="load-assets">불러오기</button><button data-control="cancel-assets">취소</button><button data-control="fail-assets">실패 체험</button><button data-control="clear-cache">캐시 비우기</button></div><progress data-value="asset-progress" aria-label="에셋 로딩 진행" value="0" max="3"></progress><output data-value="asset-status" role="status">이 실험만의 메모리 캐시입니다. 새로고침하면 비워집니다.</output><p>취소를 체험할 수 있도록 요청마다 300ms를 지연합니다. 실패 체험은 네트워크 오류를 의도적으로 주입합니다.</p>`;

export function createLoadingFeature(ctx: FeatureContext): FeatureExtra {
  const { root, signal } = ctx;
  const json = new Map<string, unknown>(), binary = new Map<string, ArrayBuffer>();
  const cache: AssetPreloadCache = {
    getJson: async url => json.get(url) ?? null, setJson: async (url, value) => { json.set(url, value); }, invalidateJson: async url => { json.delete(url); },
    getBinary: async url => binary.get(url) ?? null, setBinary: async (url, value) => { binary.set(url, value); }, invalidateBinary: async url => { binary.delete(url); },
  };
  const url = (path: string) => new URL(path, document.baseURI).href;
  const manifest = { textures: { floor: url("./playground/floor.png"), robot: url("./playground/robot.png") }, json: { scene: url("./features/animation.json") } };
  const progress = root.querySelector<HTMLProgressElement>('[data-value="asset-progress"]')!;
  const status = root.querySelector<HTMLOutputElement>('[data-value="asset-status"]')!;
  let controller: AbortController | undefined, generation = 0, state = "idle", loaded = 0, fetched = 0, cached = 0, requests = 0;
  const reset = () => { generation++; controller?.abort(); json.clear(); binary.clear(); state = "idle"; loaded = fetched = cached = requests = 0; progress.value = 0; status.textContent = "캐시를 비웠습니다. 불러오기를 눌러 시작하세요."; };
  const load = (fail: boolean) => {
    if (!ctx.playing() || state === "loading") return;
    const request = ++generation; controller?.abort(); controller = new AbortController(); const local = controller.signal;
    state = "loading"; loaded = fetched = cached = requests = 0; progress.value = 0; status.textContent = fail ? "의도한 실패를 재현합니다…" : "에셋을 불러옵니다…";
    void preloadAssetManifest(manifest, { signal: local, concurrency: 1, cache: fail ? undefined : cache,
      cachePolicy: { json: true, textures: true, version: "lab-v1" },
      fetch: async (input, options) => { await demoDelay(300, local); if (fail) throw Error("실험용 네트워크 오류"); requests++; return fetch(input, options); },
      onProgress: next => { if (request === generation && !signal.aborted) { loaded = next.loaded; progress.value = loaded; } },
    }).then(result => {
      if (request !== generation || signal.aborted) return;
      state = "complete"; fetched = result.fetched; cached = result.cached;
      status.textContent = `완료 · fetch ${requests}회 · 캐시 ${cached}개`;
    }).catch(error => {
      if (request !== generation || signal.aborted) return;
      state = local.aborted ? "cancelled" : "error";
      status.textContent = local.aborted ? "취소됨 · 완료된 캐시는 유지합니다." : `${error instanceof Error ? error.message : String(error)} · 불러오기로 다시 시도하세요.`;
    });
  };
  const on = (key: string, fn: () => void) => root.querySelector(`[data-control="${key}"]`)!.addEventListener("click", fn, { signal });
  on("load-assets", () => load(false)); on("fail-assets", () => load(true)); on("cancel-assets", () => controller?.abort()); on("clear-cache", reset);
  return { reset, frame() {}, pause() {}, observation: () => `${state} · ${loaded} / 3 · fetch ${requests}회 · 캐시 ${cached}개`,
    snapshot: () => ({ loading: { state, loaded, fetched, cached, requests, cacheEntries: json.size + binary.size } }),
    destroy: () => { generation++; controller?.abort(); json.clear(); binary.clear(); },
  };
}
