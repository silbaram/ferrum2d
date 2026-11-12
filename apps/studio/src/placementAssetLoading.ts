import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";

interface LoadProgress { loaded: number; total: number; name?: string; }
/** Release the caller on abort even when a platform decoder cannot be interrupted. */
function awaitLoad<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve,reject)=>{
    const abort = ()=>{ cleanup(); reject(signal.reason); };
    const cleanup = ()=>signal.removeEventListener("abort",abort);
    signal.addEventListener("abort",abort,{once:true});
    // Retain both handlers so a late decode rejection is still consumed after abort.
    pending.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});
    if (signal.aborted) abort();
  });
}
/** One active platform load. Retry resumes its original caller; stale callers can never publish. */
export function createPlacementAssetLoading() {
  const element = document.createElement("aside"), title = document.createElement("strong"), progress = document.createElement("progress"),
    detail = document.createElement("output"), errorText = document.createElement("p"), retry = document.createElement("button"), cancel = document.createElement("button");
  element.className = "placement-asset-loading"; element.dataset.placementAssetLoading = "idle"; element.hidden = true;
  element.setAttribute("aria-live","polite"); setUiAttribute(element,"aria-label","Asset Loading");
  retry.type = cancel.type = "button"; setUiText(retry,"Retry"); setUiText(cancel,"Cancel");
  retry.dataset.placementAssetRetry = "true"; cancel.dataset.placementAssetCancel = "true";
  element.append(title,progress,detail,errorText,retry,cancel); document.body.append(element);
  let current: AbortController | undefined, resume: (()=>void) | undefined, destroyed = false;
  const cancelLoad = ()=>{ if(current) current.abort(new DOMException("Asset loading cancelled","AbortError")); else element.hidden = true; };
  retry.addEventListener("click",()=>resume?.()); cancel.addEventListener("click",cancelLoad);
  element.addEventListener("keydown",event=>{
    // Keep native button activation out of the game's global input handlers.
    if (["Enter","Space","Escape"].includes(event.code)) event.stopPropagation();
    if (event.code === "Escape") { event.preventDefault(); cancelLoad(); }
  });
  function publish(state: string, value: LoadProgress = {loaded:0,total:0}) {
    element.dataset.placementAssetLoading = state; element.hidden = state === "ready" || state === "cancelled";
    progress.max = Math.max(1,value.total); progress.value = value.loaded;
    progress.hidden = state !== "loading"; retry.hidden = state !== "error";
    setUiText(detail,uiMessage("{0} / {1} · {2}",value.loaded,value.total,value.name ?? ""));
    Object.assign(window,{ ferrumPlacementAssetLoading: {state,...value} });
  }
  return {
    async run<T>(caption: string, operation: (signal: AbortSignal, progress: (value: LoadProgress)=>void)=>Promise<T>, externalSignal?: AbortSignal, canRetry: (error: unknown)=>boolean = ()=>true): Promise<T> {
      if (destroyed) throw new Error("Asset loading disposed");
      current?.abort(new DOMException("Asset loading replaced","AbortError"));
      const controller = new AbortController(); current = controller; setUiText(title,caption); setUiText(cancel,"Cancel");
      const abort = ()=>controller.abort(externalSignal?.reason);
      externalSignal?.addEventListener("abort",abort,{once:true});
      if (externalSignal?.aborted) abort();
      try {
        while (true) {
          let lastProgress: LoadProgress = {loaded:0,total:0};
          controller.signal.throwIfAborted(); errorText.hidden = true; publish("loading");
          try {
            const result = await awaitLoad(operation(controller.signal,value=>{ if (current === controller && !controller.signal.aborted) {lastProgress = value; publish("loading",value);} }),controller.signal);
            controller.signal.throwIfAborted();
            if (current !== controller) throw new DOMException("Asset loading replaced","AbortError");
            publish("ready",lastProgress); return result;
          } catch (error) {
            controller.signal.throwIfAborted();
            if (current !== controller) throw error;
            publish("error",lastProgress); errorText.hidden = false; errorText.textContent = error instanceof Error ? error.message : String(error);
            if (!canRetry(error)) { retry.hidden = true; setUiText(cancel,"Close"); throw error; }
            await new Promise<void>((resolve,reject)=>{
              const abort = ()=>{ cleanup(); reject(controller.signal.reason); };
              const cleanup = ()=>{ controller.signal.removeEventListener("abort",abort); if (resume === retryLoad) resume = undefined; };
              const retryLoad = ()=>{ cleanup(); resolve(); };
              resume = retryLoad; controller.signal.addEventListener("abort",abort,{once:true});
              if (controller.signal.aborted) abort();
            });
          }
        }
      } finally {
        externalSignal?.removeEventListener("abort",abort);
        if (current === controller) { if (controller.signal.aborted) publish("cancelled"); current = undefined; resume = undefined; }
      }
    },
    cancel() { current?.abort(new DOMException("Asset loading cancelled","AbortError")); },
    destroy() { destroyed = true; current?.abort(new DOMException("Asset loading disposed","AbortError")); element.remove(); },
  };
}
