import {
  createSceneInstanceHandleRegistry,
  type SceneAuthoringDocumentSpec,
} from "@ferrum2d/ferrum-web/authoring";

type Registry = ReturnType<typeof createSceneInstanceHandleRegistry>;

/** Cold authored preview activation. A failed native apply must not publish partial handles. */
export function createPlacementPreviewSession(options: {
  document: SceneAuthoringDocumentSpec;
  registry: Registry;
  apply(document: SceneAuthoringDocumentSpec, registry: Registry): void;
}) {
  let accepted = {
    document: structuredClone(options.document),
    registry: options.registry,
  };
  function activate(
    document: SceneAuthoringDocumentSpec,
    destination: Registry,
  ) {
    const candidate = createSceneInstanceHandleRegistry();
    options.apply(document, candidate);
    destination.clear();
    for (const entry of candidate.entries())
      destination.set(entry.instanceId, entry.handle);
  }
  return {
    apply(document: SceneAuthoringDocumentSpec, registry: Registry) {
      const snapshot = structuredClone(document);
      try {
        activate(snapshot, registry);
      } catch (error) {
        // Native configuration can reject after replacing the scene. Restore the
        // last accepted authoring document and refresh its generational handles.
        try {
          activate(accepted.document, accepted.registry);
        } catch (recoveryError) {
          accepted.registry.clear();
          throw new Error(
            `Preview activation and recovery failed: ${String(error)}; ${String(recoveryError)}`,
          );
        }
        throw error;
      }
      accepted = { document: snapshot, registry };
    },
  };
}
