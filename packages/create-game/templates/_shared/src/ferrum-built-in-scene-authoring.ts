import {
  GAME_STATE_CODE,
  type FerrumEngine,
} from "@ferrum2d/ferrum-web/core";
import {
  applyBuiltInSceneAuthoringDocument,
  type ApplyBuiltInSceneAuthoringDocumentResult,
  type BuiltInSceneAuthoringKind,
} from "@ferrum2d/ferrum-web/authoring";

export interface BuiltInSceneAuthoringSession {
  readonly applied: boolean;
  invalidate(): void;
  sync(gameState: number): ApplyBuiltInSceneAuthoringDocumentResult | undefined;
}

export async function loadBuiltInSceneAuthoringDocument(): Promise<unknown> {
  const response = await fetch("./scene-authoring.json", { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(
      `Failed to load public/scene-authoring.json: ${response.status} ${response.statusText}`,
    );
  }
  return await response.json() as unknown;
}

/**
 * Applies authoring on each transition into Playing and after explicit invalidation.
 * The game state supplied by the frame report keeps this free of extra per-frame Wasm calls.
 */
export function createBuiltInSceneAuthoringSession(
  engine: FerrumEngine,
  scene: BuiltInSceneAuthoringKind,
  document: unknown,
): BuiltInSceneAuthoringSession {
  let applied = false;
  return {
    get applied() {
      return applied;
    },
    invalidate() {
      applied = false;
    },
    sync(gameState) {
      if (gameState !== GAME_STATE_CODE.playing) {
        applied = false;
        return undefined;
      }
      if (applied) {
        return undefined;
      }
      const result = applyBuiltInSceneAuthoringDocument(engine, scene, document, {
        path: "template.sceneAuthoring",
      });
      applied = true;
      return result;
    },
  };
}
