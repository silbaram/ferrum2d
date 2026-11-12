import type { FerrumRuntime, FerrumRuntimeFrame, SpatialModelAsset } from "@ferrum2d/ferrum-web/core";
import { setUiAttribute, setUiText, uiMessage, type UiContent } from "./placementLocale";

/** Visible-panel-only telemetry, sampled at 2 Hz. Missing GPU timing stays explicitly unmeasured. */
export function createPlacementPerformance(options: { runtime: FerrumRuntime; canvas: HTMLCanvasElement; models: ReadonlyMap<string, SpatialModelAsset>; visible(): boolean; measureGpu(enabled: boolean): void }) {
  const element = document.createElement("details"), summary = document.createElement("summary"), values = document.createElement("dl"), hint = document.createElement("p"), reset = document.createElement("button");
  element.dataset.placementPerformance = "true"; element.className = "placement-performance";
  setUiText(summary,"Rendering and Resources"); setUiText(hint,"Memory is estimated allocation, not measured VRAM. GPU results may arrive later.");
  reset.type = "button"; setUiText(reset,"Reset Peak"); reset.dataset.placementPerformanceReset = "true";
  element.append(summary,values,hint,reset); let last = -Infinity, peak = 0;
  reset.addEventListener("click",()=>{peak=0;last=-Infinity;});
  setUiAttribute(values,"aria-label","Renderer Statistics");
  const row = (key: string,value: UiContent) => { const dt=document.createElement("dt"),dd=document.createElement("dd"); setUiText(dt,key);setUiText(dd,value);values.append(dt,dd); };
  const bytes = (value: number | undefined): UiContent => value === undefined ? "Unmeasured" : value < 1024 ? `${value} B` : value < 1048576 ? `${(value/1024).toFixed(1)} KiB` : uiMessage("{0} MiB",(value/1048576).toFixed(2));
  return { element, frame(update: FerrumRuntimeFrame) {
    const enabled = element.open && options.visible();
    options.measureGpu(enabled);
    if (!enabled || performance.now()-last < 500) return; last=performance.now();
    const renderer=options.runtime.renderer, stats=update.rendererStats, spatial=stats.spatial,
      resources=renderer.resourceStats?.(), gpu=renderer.gpuTimingStats?.(), cpu=[...options.models.values()].reduce((n,a)=>n+a.byteLength,0);
    peak=Math.max(peak,resources?.estimatedBytes ?? 0); values.replaceChildren();
    row("Draw Calls",String(stats.drawCalls)); row("Sprites / Billboards",String(stats.spriteCount));
    row("Spatial Triangles",spatial ? String(spatial.triangleCount) : "Not Applicable");
    row("Models",uiMessage("{0} visible / {1} submitted",spatial?.visibleModelCount ?? 0,spatial?.modelCount ?? 0));
    row("Debug Lines",spatial ? uiMessage("{0} · {1}",spatial.debugLineCount,uiMessage(spatial.debugTruncated ? "Truncated" : "Complete")) : "Not Applicable");
    row("Draw Breakdown",uiMessage("Models {0} · Shadows {1} · Effects {2} · Debug {3}",spatial?.modelDrawCalls ?? 0,spatial?.shadowDrawCalls ?? stats.shadowDrawCalls,spatial?.effectDrawCalls ?? stats.postProcessDrawCalls,spatial?.debugDrawCalls ?? 0));
    row("Spatial Upload",spatial ? bytes(spatial.uploadBytes) : "Not Applicable"); row("Model Upload",spatial ? bytes(spatial.modelUploadBytes) : "Not Applicable");
    row("Texture / Buffer / Target",resources ? `${resources.textureCount} / ${resources.bufferCount} / ${resources.renderTargetCount}` : "Unsupported");
    row("GPU Allocation Estimate",bytes(resources?.estimatedBytes)); row("Peak Allocation Estimate",resources?.estimatedBytes === undefined ? "Unmeasured" : bytes(peak));
    row("CPU Model Cache",uiMessage("{0} assets · {1} MiB",options.models.size,(cpu/1048576).toFixed(2)));
    row("GPU Time",gpu?.elapsedMs === undefined ? uiMessage("Unmeasured · {0}",gpu?.status ?? "unsupported") : uiMessage("{0} ms · Frame {1}",gpu.elapsedMs.toFixed(2),gpu.frameId ?? "—"));
    row("Backbuffer",`${options.canvas.width} × ${options.canvas.height}`);
    Object.assign(window,{ferrumPlacementPerformance:{stats,resources,gpu,cpuModelBytes:cpu,modelAssets:options.models.size,peakEstimatedBytes:peak}});
  } };
}
