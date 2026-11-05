import type { FeatureContext, FeatureExtra } from "./featureExtras";
import { createCutsceneFeature, cutsceneControls } from "./featureCutscene";
import { createLoadingFeature, loadingControls } from "./featureLoading";
import { createStreamingFeature, streamingControls } from "./featureStreaming";

export const systemControls = { cutscene: cutsceneControls, "asset-loading": loadingControls, streaming: streamingControls };
export function createSystemFeature(ctx: FeatureContext): FeatureExtra | undefined {
  if (ctx.id === "cutscene") return createCutsceneFeature(ctx);
  if (ctx.id === "asset-loading") return createLoadingFeature(ctx);
  if (ctx.id === "streaming") return createStreamingFeature(ctx);
  return undefined;
}
