import { createPlacementFrameNormals } from "./placementFrameNormals";

/** Preserve the existing Aseprite workflow and provenance contract. */
export function createPlacementAsepriteNormals(options: Omit<Parameters<typeof createPlacementFrameNormals>[0], "kind">) {
  return createPlacementFrameNormals({ ...options, kind: "aseprite" });
}
