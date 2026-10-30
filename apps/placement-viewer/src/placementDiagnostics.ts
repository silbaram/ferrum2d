import { setUiText, uiMessage } from "./placementLocale";
import { readPlacementImportDiagnostics } from "./placementImportDiagnostics";
import { createPlacementRuntimeSummary } from "./placementRuntimeSummary";
import {
  mergeScenePlacementPatch,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementAgentHandoff,
  type ScenePlacementAssetDiagnostic,
  type ScenePlacementViewerState,
  type DataSceneVariableStore,
} from "@ferrum2d/ferrum-web/authoring";
import type {
  FerrumRuntime,
  FerrumRuntimeFrame,
  GameplayEventView,
} from "@ferrum2d/ferrum-web/core";

type Change = { path: string; before?: unknown; after?: unknown };
type Evidence = NonNullable<ScenePlacementAgentHandoff["authoringEvidence"]>;
/** Bounded presentation evidence; the full deterministic patch remains in the handoff. */
export function installPlacementDiagnostics(options: {
  root: HTMLElement;
  runtime: FerrumRuntime;
  select(id: string): void;
  handle(
    id: string,
  ): { entityId: number; entityGeneration: number } | undefined;
  reloadAssets(): Promise<unknown>;
  canReloadAssets(): boolean;
  spatialTarget?(): { kind: string; id: string } | undefined;
  variables?(): DataSceneVariableStore | undefined;
  context?(): string;
  mode?(): string;
  visible?(): boolean;
  counts?(changes: number, problems: number): void;
}) {
  let state: ScenePlacementViewerState | undefined,
    source = "",
    base: SceneAuthoringDocumentSpec | undefined,
    patchSignature = "";
  let paths = new Map<string, string[]>(),
    changes: Change[] = [],
    evidence: Evidence = {
      selectedSourcePaths: [],
      changes: [],
      changeCount: 0,
      truncated: false,
    };
  let diagnostics: readonly ScenePlacementAssetDiagnostic[] = [],
    errors: string[] = [],
    lastRead = 0;
  let context = "",
    recentEvents: GameplayEventView[] = [];
  const root = document.createElement("section");
  root.className = "placement-diagnostics";
  const problems = details("Problems"),
    runtime = details("Selected Runtime"),
    diff = details("Agent Changes");
  const sourcePath = document.createElement("pre");
  sourcePath.dataset.placementSourcePath = "true";
  const runtimeValue = document.createElement("pre");
  runtimeValue.dataset.placementSelectedRuntime = "true";
  const runtimeSummary = createPlacementRuntimeSummary(),
    raw = document.createElement("details"),
    rawTitle = document.createElement("summary");
  setUiText(rawTitle, "Raw JSON");
  raw.dataset.placementRuntimeRaw = "true";
  raw.append(rawTitle, sourcePath, runtimeValue);
  runtime.body.append(runtimeSummary.element, raw);
  const reload = document.createElement("button");
  reload.type = "button";
  setUiText(reload, "Reload Assets");
  reload.dataset.placementReloadAssets = "true";
  reload.addEventListener("click", () => {
    reload.disabled = true;
    void options
      .reloadAssets()
      .catch(report)
      .finally(() => {
        reload.disabled = !options.canReloadAssets();
      });
  });
  root.append(reload);
  options.root.append(root);
  function details(label: string) {
    const element = document.createElement("details"),
      summary = document.createElement("summary"),
      body = document.createElement("div");
    setUiText(summary, label);
    element.dataset.placementDiagnosticSection = label;
    element.append(summary, body);
    root.append(element);
    return { element, summary, body };
  }
  function report(error: unknown) {
    errors = [
      ...errors.slice(-19),
      error instanceof Error ? error.message : String(error),
    ];
    renderProblems();
  }
  window.addEventListener("ferrum-placement-document-error", (event) => {
    if (event instanceof CustomEvent) report(event.detail);
  });
  window.addEventListener("ferrum-placement-import-diagnostics", event => {
    if (!(event instanceof CustomEvent)) return;
    renderProblems();
  });
  function renderProblems() {
    const imported = readPlacementImportDiagnostics();
    setUiText(
      problems.summary,
      uiMessage("Problems ({0})", diagnostics.length + errors.length + imported.length),
    );
    problems.body.replaceChildren();
    for (const diagnostic of imported) {
      const row = document.createElement("pre");
      row.dataset.placementImportProblem = diagnostic.source.file;
      row.textContent = diagnostic.source.file + "#" + diagnostic.source.pointer +
        (diagnostic.source.item ? " · " + diagnostic.source.item : "") + "\n" + diagnostic.message +
        "\n" + diagnostic.scenePaths.join("\n") +
        (diagnostic.scenePathsTruncated ? "\n…" : "") + "\n" + diagnostic.hint;
      problems.body.append(row);
    }
    for (const diagnostic of diagnostics) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = diagnostic.path + " · " + diagnostic.message;
      button.dataset.placementProblemPath = diagnostic.path;
      button.addEventListener("click", () => {
        const instance = state?.instances.find((i) =>
          diagnostic.path.includes("instances." + i.instanceId + "."),
        );
        if (instance) options.select(instance.instanceId);
      });
      problems.body.append(button);
    }
    for (const error of errors) {
      const row = document.createElement("p");
      row.textContent = source + " · " + error;
      problems.body.append(row);
    }
    if (!diagnostics.length && !errors.length && !imported.length)
      setUiText(problems.body, "No problems");
    options.counts?.(changes.length, diagnostics.length + errors.length + imported.length);
  }
  function indexSource(document: SceneAuthoringDocumentSpec) {
    paths = new Map();
    for (const [fragmentId, fragment] of Object.entries(
      document.sceneComposition.fragments ?? {},
    ))
      for (const [index, instance] of (fragment.instances ?? []).entries())
        if (instance.id) {
          const entries = paths.get(instance.id) ?? [];
          entries.push(
            "/sceneComposition/fragments/" +
              escapePointer(fragmentId) +
              "/instances/" +
              index,
          );
          paths.set(instance.id, entries);
        }
  }
  function sourcePaths(next: ScenePlacementViewerState) {
    const selected = new Set(next.selectedInstanceIds),
      result = new Set<string>();
    for (const instance of next.instances)
      if (selected.has(instance.instanceId)) {
        for (const path of paths.get(instance.sourceId) ?? [])
          result.add(source + "#" + path);
        if (!paths.has(instance.sourceId))
          result.add(source + "#draft.instances[" + instance.instanceId + "]");
        if (next.spatial?.models?.[instance.instanceId])
          result.add(
            source + "#/spatial/models/" + escapePointer(instance.instanceId),
          );
        if (next.spatial?.billboards[instance.instanceId])
          result.add(
            source +
              "#/spatial/billboards/" +
              escapePointer(instance.instanceId),
          );
        if (next.spatial?.attachments?.[instance.instanceId])
          result.add(
            source +
              "#/spatial/attachments/" +
              escapePointer(instance.instanceId),
          );
      }
    const target = options.spatialTarget?.();
    if (target?.kind === "surface") {
      const index = next.spatial?.terrain.findIndex(
        (surface) => surface.id === target.id,
      );
      if (index !== undefined && index >= 0)
        result.add(source + "#/spatial/terrain/" + index);
    }
    return [...result];
  }
  function sync(
    next: ScenePlacementViewerState,
    scene: SceneAuthoringDocumentSpec,
    sourceDocument: string,
    assetDiagnostics: readonly ScenePlacementAssetDiagnostic[],
  ) {
    const changedSelection =
      state?.selectedInstanceId !== next.selectedInstanceId;
    state = next;
    diagnostics = assetDiagnostics;
    const changedBase = base !== scene || source !== sourceDocument;
    if (changedSelection || changedBase) {
      recentEvents = [];
      lastRead = 0;
      runtimeSummary.clear("Waiting for selected runtime");
      setUiText(runtimeValue, "Waiting for selected runtime");
      Object.assign(window, { ferrumPlacementSelectedRuntime: undefined });
    }
    if (changedBase) {
      base = scene;
      source = sourceDocument;
      indexSource(scene);
      patchSignature = "";
      errors = [];
    }
    const signature = JSON.stringify(next.draftPatch ?? null);
    if (changedBase || signature !== patchSignature) {
      patchSignature = signature;
      changes = [];
      try {
        const after = next.draftPatch
          ? mergeScenePlacementPatch(scene, next.draftPatch).document
          : scene;
        compare(scene, after, "", changes);
      } catch (error) {
        report(error);
      }
      setUiText(diff.summary, uiMessage("Agent Changes ({0})", changes.length));
      diff.body.replaceChildren(
        ...changes.slice(0, 200).map((change) => {
          const row = document.createElement("pre");
          row.dataset.placementChangedPath = change.path;
          row.textContent =
            change.path +
            "\n" +
            short(change.before) +
            " → " +
            short(change.after);
          return row;
        }),
      );
      if (changes.length > 200) {
        const row = document.createElement("p");
        row.textContent =
          "Showing 200 of " +
          changes.length +
          " changes. Full patch is in the handoff.";
        diff.body.append(row);
      }
    }
    evidence = {
      selectedSourcePaths: sourcePaths(next),
      changes: changes.slice(0, 512),
      changeCount: changes.length,
      truncated: changes.length > 512,
    };
    sourcePath.textContent =
      evidence.selectedSourcePaths.join("\n") || "No authored object selected";
    if (!next.selectedInstanceId) {
      runtimeSummary.clear("No runtime entity selected");
      setUiText(runtimeValue, "No runtime entity selected");
      Object.assign(window, { ferrumPlacementSelectedRuntime: undefined });
    }
    reload.disabled = !options.canReloadAssets();
    renderProblems();
    Object.assign(window, {
      ferrumPlacementWorkspaceEvidence: structuredClone(evidence),
    });
    return evidence;
  }
  return {
    sync,
    panels: {
      problems: problems.element,
      runtime: runtime.element,
      changes: diff.element,
    },
    reload,
    frame(update: FerrumRuntimeFrame) {
      const nextContext =
        (options.context?.() ?? source) +
        "|" +
        (state?.selectedInstanceId ?? "");
      if (context !== nextContext) {
        context = nextContext;
        recentEvents = [];
        lastRead = 0;
      }
      const visible = runtime.element.open && (options.visible?.() ?? true);
      if (visible && state?.selectedInstanceId) {
        const handle = options.handle(state.selectedInstanceId);
        if (handle)
          for (const event of update.frame.gameplayEvents) {
            if (
              (event.actorId === handle.entityId &&
                event.actorGeneration === handle.entityGeneration) ||
              (event.sourceId === handle.entityId &&
                event.sourceGeneration === handle.entityGeneration)
            ) {
              recentEvents.push({ ...event });
              if (recentEvents.length > 64) recentEvents.shift();
            }
          }
      }
      if (
        !visible ||
        !state?.selectedInstanceId ||
        performance.now() - lastRead < 250
      )
        return;
      lastRead = performance.now();
      const id = state.selectedInstanceId,
        handle = options.handle(id);
      const entity =
        handle && options.runtime.engine.gameplayEntityExists(handle)
          ? options.runtime.engine.getPhysicsEntity(handle)
          : undefined;
      const colliderCount = entity && handle ? options.runtime.engine.getPhysicsBodyColliderCount(handle) : 0;
      const colliders = entity && handle ? Array.from({length: Math.min(32, colliderCount)}, (_,i) => options.runtime.engine.getPhysicsBodyCollider(handle,i)).filter((c): c is NonNullable<typeof c> => !!c) : [];
      const snapshot = {
        physics: entity,
        colliderCount,
        colliders,
        mode: options.mode?.() ?? "2d",
        observation: "Read-only · 4 Hz · events recorded while panel open",
        instanceId: id,
        entity: handle,
        gameplay: handle
          ? options.runtime.engine.gameplayEntityDiagnostics(handle)
          : undefined,
        variableScope: "global / scene; no entity variable scope",
        variables:
          options
            .variables?.()
            ?.declarations()
            .slice(0, 32)
            .map((declaration) => ({
              name: declaration.name,
              scope: declaration.scope,
              value: options.variables?.()?.get(declaration.name),
            })) ?? [],
        recentEvents: [...recentEvents],
        runtime: entity
          ? {
              x: entity.x,
              y: entity.y,
              bodyType: entity.bodyType,
              colliderType: entity.colliderType,
              heightSpan:
                entity.heightSpan ??
                options.runtime.engine.getPhysicsBodyHeightSpan(handle!),
            }
          : undefined,
      };
      runtimeSummary.update(snapshot);
      runtimeValue.textContent = JSON.stringify(snapshot, null, 2);
      Object.assign(window, { ferrumPlacementSelectedRuntime: snapshot });
    },
  };
}

function escapePointer(value: string) {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}
function short(value: unknown) {
  const text = JSON.stringify(value) ?? "(absent)";
  return text.length > 500 ? text.slice(0, 500) + "…" : text;
}
function compare(
  before: unknown,
  after: unknown,
  path: string,
  result: Change[],
) {
  if (before === after) return;
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    const left = before as Record<string, unknown>,
      right = after as Record<string, unknown>;
    for (const key of [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort())
      compare(left[key], right[key], path + "/" + escapePointer(key), result);
  } else result.push({ path, before, after });
}
