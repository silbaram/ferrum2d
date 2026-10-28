import { canUsePlacementAsset } from "./placementAssetScope";
import {
  setUiAttribute,
  setUiText,
  type UiContent,
  uiMessage,
  uiText,
} from "./placementLocale";

import {
  createSpriteNormalWorkerClient,
  createSceneSpriteNormalPatch,
  type SceneAuthoringDocumentSpec,
  type ScenePlacementViewer,
  type ScenePlacementViewerState,
  type SceneSpriteNormalBindingEvidence,
  type SpriteNormalGenerationSettings,
  type SpriteNormalWorkerClient,
  type SpriteNormalWorkerInput,
} from "@ferrum2d/ferrum-web/authoring";
import type { FerrumRuntime } from "@ferrum2d/ferrum-web/core";
import {
  createPlacementNormalAssets,
  placementNormalAssetBundle,
  placementNormalMeasure,
  placementNormalRead,
  type PlacementNormalAsset,
  type PlacementNormalAssetHost,
} from "./placementNormalAssets";
import { createPlacementNormalPreview } from "./placementNormalPreview";
import { createPlacementPanelTabs } from "./placementPanelTabs";

interface Context {
  project?: string;
  key: string;
  source: string;
  document: SceneAuthoringDocumentSpec;
  mode: string;
  canEdit: boolean;
}
interface Draft {
  source?: { name: string; bytes: Uint8Array };
  stem: string;
  settings: SpriteNormalGenerationSettings;
  grid: boolean;
  width: number;
  height: number;
  animation: boolean;
  loop: boolean;
  candidate?: PlacementNormalAsset;
  dirty: boolean;
  status: UiContent;
}
const defaults: Required<Omit<SpriteNormalGenerationSettings, "frameSize">> = {
  normalStrength: 1.5,
  detailStrength: 6,
  detailScale: 0.6,
  shapeStrength: 1.15,
  shapeRadius: 4,
  shapeSoftness: 1.15,
  alphaThreshold: 0.03,
};
const settingLabels = [
  ["normalStrength", "Normal Strength", 0, 8, 0.1],
  ["detailStrength", "Detail Strength", 0, 8, 0.1],
  ["detailScale", "Detail Scale", 0.6, 8, 0.1],
  ["shapeStrength", "Shape Strength", 0, 8, 0.1],
  ["shapeRadius", "Shape Radius", 0.5, 512, 0.5],
  ["shapeSoftness", "Shape Softness", 0, 8, 0.05],
  ["alphaThreshold", "Alpha Threshold", 0, 0.99, 0.01],
] as const;

export function createPlacementNormalTool(options: {
  engine: FerrumRuntime["engine"];
  viewer: ScenePlacementViewer;
  context(): Context;
  host(): PlacementNormalAssetHost | undefined;
  taken(id: string): boolean;
  apply(patch: ReturnType<typeof createSceneSpriteNormalPatch>["patch"]): void;
  changed(): void;
}) {
  const element = document.createElement("details"),
    summary = document.createElement("summary");
  element.className = "placement-normal-tool";
  element.dataset.placementNormalTool = "true";
  setUiText(summary, "Generate Normal");
  const body = document.createElement("div"),
    sourceLabel = document.createElement("output");
  sourceLabel.dataset.normalSource = "true";
  const file = document.createElement("input");
  file.type = "file";
  file.accept = ".png,.gif,.apng";
  setUiAttribute(file, "aria-label", "Normal source image");
  const name = document.createElement("input");
  name.type = "text";
  name.maxLength = 64;
  setUiAttribute(name, "aria-label", "Generated asset name");
  const preset = document.createElement("select");
  setUiAttribute(preset, "aria-label", "Normal preset");
  for (const label of ["Default", "Soft", "Crisp", "Custom"]) {
    const o = document.createElement("option");
    setUiText(o, (o.value = label));
    preset.append(o);
  }
  const settings = document.createElement("div");
  settings.className = "placement-normal-settings";
  const inputs = new Map<keyof typeof defaults, HTMLInputElement>();
  function field(label: string, control: HTMLElement, parent = body) {
    const wrapper = document.createElement("label");
    if (!control.hasAttribute("aria-label"))
      setUiAttribute(control, "aria-label", label);
    wrapper.append(uiText(label), control);
    parent.append(wrapper);
  }
  field("Source", file);
  body.append(sourceLabel);
  field("Asset Name", name);
  field("Preset", preset);
  body.append(settings);
  for (const [key, label, min, max, step] of settingLabels) {
    const input = document.createElement("input");
    input.type = "number";
    Object.assign(input, {
      min: String(min),
      max: String(max),
      step: String(step),
    });
    setUiAttribute(input, "aria-label", label);
    inputs.set(key, input);
    field(label, input, settings);
  }
  const grid = document.createElement("input"),
    animation = document.createElement("input"),
    loop = document.createElement("input");
  grid.type = animation.type = loop.type = "checkbox";
  setUiAttribute(grid, "aria-label", "PNG frame grid");
  setUiAttribute(animation, "aria-label", "Export animation");
  setUiAttribute(loop, "aria-label", "Loop animation");
  field("PNG Frame Grid", grid, settings);
  const width = document.createElement("input"),
    height = document.createElement("input");
  for (const [input, label] of [
    [width, "Frame Width"],
    [height, "Frame Height"],
  ] as const) {
    input.type = "number";
    input.min = "1";
    input.max = "4096";
    input.step = "1";
    setUiAttribute(input, "aria-label", label);
    field(label, input, settings);
  }
  field("Export Animation", animation, settings);
  field("Loop", loop, settings);
  const actions = document.createElement("div");
  actions.className = "placement-normal-actions";
  function button(label: string, action: string) {
    const b = document.createElement("button");
    b.type = "button";
    setUiText(b, label);
    b.dataset.normalAction = action;
    actions.append(b);
    return b;
  }
  const generate = button("Generate Normal", "generate"),
    cancel = button("Cancel", "cancel"),
    apply = button("Apply", "apply"),
    save = button("Save Assets", "save"),
    exportButton = button("Export Assets", "export");
  const light = document.createElement("select");
  setUiAttribute(light, "aria-label", "Preview lighting");
  for (const label of ["Fixed Light", "Moving Light"]) {
    const o = document.createElement("option");
    o.value = label;
    setUiText(o, label);
    light.append(o);
  }
  const preview = document.createElement("div");
  preview.className = "placement-normal-previews";
  const status = document.createElement("output"),
    target = document.createElement("output");
  status.setAttribute("aria-live", "polite");
  status.dataset.normalStatus = "true";
  target.dataset.normalTarget = "true";
  const hint = document.createElement("p");
  setUiText(
    hint,
    "Apply edits the selected HD-2D sprite. Export keeps files and provenance together.",
  );
  const editor = document.createElement("div");
  editor.className = "placement-normal-editor";
  editor.append(...body.childNodes);
  const panels = createPlacementPanelTabs("Normal tool views", [
    ["settings", "Settings"],
    ["preview", "Preview"],
  ] as const);
  panels.panels.get("settings")!.append(editor);
  panels.panels.get("preview")!.append(light, preview, hint);
  body.append(actions, sourceLabel, status, target, panels.element);
  const expand = button("Expand", "expand");
  let expanded = false;
  function expandPanel(value: boolean) {
    expanded = value;
    const root = element.closest<HTMLElement>(".demo-shell");
    if (root) root.dataset.normalToolExpanded = String(value && element.open);
    setUiText(expand, value ? "Restore" : "Expand");
    expand.setAttribute("aria-pressed", String(value));
  }
  expand.addEventListener("click", () => expandPanel(!expanded));
  element.append(summary, body);
  const drafts = new Map<string, Draft>(),
    evidence = new Map<string, Map<string, SceneSpriteNormalBindingEvidence>>();
  const assets = createPlacementNormalAssets(options.engine, options.taken);
  let key = "",
    mode = "",
    serial = 0,
    busy = false,
    controller: AbortController | undefined,
    client: SpriteNormalWorkerClient | undefined;
  let previewSerial = 0,
    previewResource:
      | Awaited<ReturnType<typeof createPlacementNormalPreview>>
      | undefined,
    shown: PlacementNormalAsset | undefined,
    disposed = false;
  const draft = () => drafts.get(key)!;
  function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
  function alive(token: number) {
    return (
      !disposed &&
      token === serial &&
      key === options.context().key &&
      mode === options.context().mode
    );
  }
  function stop(message = "Cancelled") {
    serial++;
    controller?.abort();
    controller = undefined;
    client?.destroy();
    client = undefined;
    if (busy && drafts.has(key)) draft().status = uiMessage(message);
    busy = false;
  }
  async function show(candidate?: PlacementNormalAsset) {
    if (shown === candidate) return;
    shown = candidate;
    const token = ++previewSerial;
    previewResource?.destroy();
    previewResource = undefined;
    preview.replaceChildren();
    if (!candidate) return;
    panels.select("preview");
    const mount = document.createElement("div");
    mount.className = "placement-normal-preview-grid";
    try {
      const resource = await createPlacementNormalPreview(
        mount,
        candidate.result.colorPng,
        candidate.result.normalPng,
      );
      if (token !== previewSerial || disposed) {
        resource.destroy();
        return;
      }
      preview.replaceChildren(mount);
      previewResource = resource;
      resource.setMoving(light.value === "Moving Light");
    } catch (error) {
      if (token === previewSerial) {
        const p = document.createElement("p");
        setUiText(p, errorMessage(error));
        preview.append(p);
      }
    }
  }
  function read() {
    const d = draft();
    d.stem = name.value.trim();
    d.settings = Object.fromEntries(
      [...inputs].map(([key, input]) => [key, input.valueAsNumber]),
    );
    d.grid = grid.checked;
    d.width = width.valueAsNumber;
    d.height = height.valueAsNumber;
    d.animation = animation.checked;
    d.loop = loop.checked;
  }
  function render() {
    if (disposed || !drafts.has(key)) return;
    const d = draft(),
      context = options.context(),
      selected = options.viewer.state().selectedInstanceId;
    generate.disabled = busy || !d.source || !context.canEdit;
    cancel.disabled = !busy;
    file.disabled = name.disabled = preset.disabled = busy;
    for (const input of [...inputs.values(), grid, animation, loop])
      input.disabled = busy;
    width.disabled = height.disabled = busy || !grid.checked;
    const applicable =
      !!selected &&
      !!context.document.spatial?.billboards[selected] &&
      !options.viewer.state().lockedInstanceIds.includes(selected);
    apply.disabled =
      busy || d.dirty || !d.candidate || !context.canEdit || !applicable;
    save.disabled =
      busy ||
      d.dirty ||
      !d.candidate ||
      d.candidate.persisted ||
      !options.host()?.saveAssets;
    exportButton.disabled = busy || d.dirty || !d.candidate;
    setUiText(generate, d.candidate ? "Regenerate" : "Generate Normal");
    setUiText(
      sourceLabel,
      d.source
        ? uiMessage(
            "{0} · {1} KiB",
            d.source.name,
            (d.source.bytes.byteLength / 1024).toFixed(1),
          )
        : "Choose PNG, GIF or APNG",
    );
    setUiText(
      status,
      busy
        ? d.status
        : uiMessage(
            "{0}{1}",
            d.status,
            uiMessage(
              d.candidate && !d.dirty
                ? d.candidate.persisted
                  ? " · Assets saved"
                  : " · Session assets; export or save before closing"
                : "",
            ),
          ),
    );
    element.dataset.normalBusy = String(busy);
    element.dataset.normalReady = String(!!d.candidate && !d.dirty);
    setUiText(
      target,
      applicable
        ? uiMessage("Apply Target · {0}", selected)
        : "Select an unlocked HD-2D sprite to apply",
    );
    setUiAttribute(
      save,
      "title",
      options.host()?.saveAssets
        ? "Save without overwriting files"
        : "Asset save host unavailable",
    );
    void show(d.candidate);
  }
  function markChanged() {
    read();
    draft().dirty = true;
    preset.value = "Custom";
    draft().status = uiMessage("Settings changed. Generate to update.");
    render();
  }
  for (const control of [
    name,
    ...inputs.values(),
    grid,
    width,
    height,
    animation,
    loop,
  ])
    control.addEventListener("change", markChanged);
  preset.addEventListener("change", () => {
    if (preset.value === "Custom") return;
    const next = {
      ...defaults,
      ...(preset.value === "Soft"
        ? { detailStrength: 2, shapeSoftness: 2 }
        : preset.value === "Crisp"
          ? { shapeRadius: 2, shapeSoftness: 0.5 }
          : {}),
    };
    for (const [key, input] of inputs) input.value = String(next[key]);
    const label = preset.value;
    markChanged();
    preset.value = label;
  });
  async function setSource(name: string, bytes: Uint8Array, token: number) {
    if (!alive(token)) return;
    if (!bytes.byteLength || bytes.byteLength > 16 * 1024 * 1024)
      throw new Error("Source must contain 1 byte to 16 MiB");
    const total = [...drafts].reduce(
      (n, [other, d]) =>
        n + (other === key ? 0 : (d.source?.bytes.byteLength ?? 0)),
      bytes.byteLength,
    );
    if (total > 64 * 1024 * 1024)
      throw new Error("Source budget reached. Close another document.");
    const d = draft();
    d.source = { name, bytes };
    d.stem =
      name
        .replace(/\.[^.]+$/u, "")
        .replace(/[^a-zA-Z0-9_.-]/g, "-")
        .replace(/^[^a-zA-Z0-9]+/, "")
        .slice(0, 64) || "sprite";
    d.dirty = true;
    d.animation = /\.(gif|apng)$/i.test(name);
    d.status = uiMessage("Source ready");
    updateFields();
  }
  async function loadFile(value: File) {
    stop();
    const token = serial;
    busy = true;
    draft().status = uiMessage("Reading source…");
    render();
    try {
      if (value.size > 16 * 1024 * 1024)
        throw new Error("Source exceeds 16 MiB");
      await setSource(
        value.name,
        new Uint8Array(await value.arrayBuffer()),
        token,
      );
    } catch (error) {
      if (alive(token)) draft().status = errorMessage(error);
    } finally {
      if (alive(token)) {
        busy = false;
        render();
      }
    }
  }
  file.addEventListener("change", () => {
    if (file.files?.[0]) void loadFile(file.files[0]);
    file.value = "";
  });
  generate.addEventListener(
    "click",
    () =>
      void (async () => {
        if (generate.disabled) return;
        read();
        stop();
        const token = serial;
        controller = new AbortController();
        busy = true;
        draft().dirty = true;
        draft().status = uiMessage("Generating…");
        render();
        try {
          let generator = options.host()?.generator;
          if (!generator) {
            const response = await fetch(
              new URL("./__ferrum-normal-generator/config.json", location.href),
              { signal: controller.signal },
            );
            if (!response.ok) throw new Error("Normal generator unavailable");
            generator = JSON.parse(
              new TextDecoder().decode(
                await placementNormalRead(response, 65536),
              ),
            );
          }
          if (!alive(token)) return;
          client = createSpriteNormalWorkerClient({ generator: generator! });
          const d = draft(),
            input: SpriteNormalWorkerInput = {
              ...d.source!,
              settings: {
                ...d.settings,
                ...(d.grid
                  ? { frameSize: { width: d.width, height: d.height } }
                  : {}),
              },
              ...(d.animation ? { animation: { loop: d.loop } } : {}),
            };
          const result = await client.generate(input, {
            signal: controller.signal,
          });
          if (!alive(token)) return;
          const prepared = await assets.prepare(
            key,
            d.stem,
            result,
            controller.signal,
          );
          if (!alive(token)) {
            // Reusing a candidate does not transfer its original owner's lifetime.
            if (prepared.created) assets.discard(prepared.asset);
            return;
          }
          const candidate = prepared.asset;
          const previous = d.candidate;
          d.candidate = candidate;
          panels.select("preview");
          d.dirty = false;
          d.status = uiMessage(
            "Ready · {0} × {1} · {2} ms",
            candidate.binding.width,
            candidate.binding.height,
            Math.round(result.elapsedMs),
          );
          if (previous && previous !== candidate && !previous.uploaded)
            assets.discard(previous);
        } catch (error) {
          if (alive(token))
            draft().status = uiMessage(
              "Generation failed. {0}",
              errorMessage(error),
            );
        } finally {
          if (alive(token)) {
            busy = false;
            render();
          }
        }
      })(),
  );
  cancel.addEventListener("click", () => {
    stop();
    render();
  });
  apply.addEventListener(
    "click",
    () =>
      void (async () => {
        if (apply.disabled) return;
        const asset = draft().candidate!,
          context = options.context(),
          instanceId = options.viewer.state().selectedInstanceId!;
        const signature = JSON.stringify(context.document);
        stop();
        const token = serial;
        controller = new AbortController();
        busy = true;
        draft().status = uiMessage("Preparing assets…");
        render();
        try {
          const plan = createSceneSpriteNormalPatch(
            context.document,
            asset.binding,
            { instanceId, assets: asset.measured },
          );
          await assets.upload(asset, controller.signal);
          if (!alive(token)) return;
          if (
            signature !== JSON.stringify(options.context().document) ||
            options.viewer.state().selectedInstanceId !== instanceId ||
            options.viewer.state().lockedInstanceIds.includes(instanceId) ||
            !options.context().canEdit
          )
            throw new Error("Document changed. Apply again.");
          // Immutable asset pairs survive Undo/Redo. Keep their evidence too; the
          // handoff validates each record against the current document before export.
          const records = evidence.get(key) ?? new Map(),
            recordKey = JSON.stringify([instanceId, asset.key]),
            previous = records.get(recordKey);
          records.set(recordKey, plan.evidence);
          evidence.set(key, records);
          try {
            options.apply(plan.patch);
          } catch (error) {
            if (previous) records.set(recordKey, previous);
            else records.delete(recordKey);
            throw error;
          }
          draft().status = uiMessage(
            "Applied · Undo restores the previous binding",
          );
          options.changed();
        } catch (error) {
          if (alive(token))
            draft().status = uiMessage(
              "Apply failed. {0}",
              errorMessage(error),
            );
        } finally {
          if (alive(token)) {
            busy = false;
            render();
          }
        }
      })(),
  );
  exportButton.addEventListener("click", () => {
    if (exportButton.disabled) return;
    const asset = draft().candidate!,
      url = URL.createObjectURL(
        new Blob(
          [JSON.stringify(placementNormalAssetBundle(asset), null, 2) + "\n"],
          { type: "application/json" },
        ),
      );
    const link = document.createElement("a");
    link.href = url;
    link.download = asset.key + ".normal-assets.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    draft().status = uiMessage("Exported · Project files have not been saved");
    render();
  });
  save.addEventListener(
    "click",
    () =>
      void (async () => {
        const host = options.host();
        if (save.disabled || !host?.saveAssets) return;
        const asset = draft().candidate!,
          context = options.context();
        stop();
        const token = serial;
        controller = new AbortController();
        busy = true;
        draft().status = uiMessage("Saving assets…");
        render();
        try {
          const result = await host.saveAssets(
            placementNormalAssetBundle(asset),
            { signal: controller.signal },
          );
          if (!alive(token) || host !== options.host()) return;
          if (result.registered !== true)
            throw new Error("Host did not register the generated assets");
          for (const measured of asset.measured) {
            const url = new URL(result.textures[measured.id], location.href);
            if (
              !["http:", "https:", "ferrum-asset:"].includes(url.protocol) ||
              url.username ||
              url.password
            )
              throw new Error("Host must return durable asset URLs");
            const response = await fetch(url, { signal: controller.signal });
            const actual = await placementNormalMeasure(
              await placementNormalRead(response, 40 * 1024 * 1024),
            );
            if (
              actual.sha256 !== measured.sha256 ||
              actual.width !== measured.width ||
              actual.height !== measured.height
            )
              throw new Error("Saved asset differs from generated bytes");
          }
          if (
            !alive(token) ||
            context.key !== options.context().key ||
            host !== options.host()
          )
            return;
          asset.persisted = true;
          asset.project = context.project;
          draft().status = uiMessage("Assets saved and registered");
          options.changed();
        } catch (error) {
          if (alive(token))
            draft().status = uiMessage("Save failed. {0}", errorMessage(error));
        } finally {
          if (alive(token)) {
            busy = false;
            render();
          }
        }
      })(),
  );
  let previewVisible = false;
  const visibility = new IntersectionObserver((entries) => {
    previewVisible = entries.some((entry) => entry.isIntersecting);
    previewResource?.setMoving(
      previewVisible && element.open && light.value === "Moving Light",
    );
  });
  visibility.observe(preview);
  light.addEventListener("change", () =>
    previewResource?.setMoving(
      previewVisible && light.value === "Moving Light",
    ),
  );
  element.addEventListener("toggle", () => {
    expandPanel(expanded);
    previewResource?.setMoving(
      previewVisible && element.open && light.value === "Moving Light",
    );
  });
  function updateFields() {
    panels.select("settings");
    const d = draft();
    name.value = d.stem;
    for (const [key, input] of inputs)
      input.value = String(d.settings[key] ?? defaults[key]);
    grid.checked = d.grid;
    width.value = String(d.width);
    height.value = String(d.height);
    animation.checked = d.animation;
    loop.checked = d.loop;
    preset.value = "Custom";
  }
  function sync() {
    if (disposed) return;
    const context = options.context();
    if (key !== context.key) {
      stop("Cancelled · Document changed");
      key = context.key;
      shown = undefined;
      previewSerial++;
      previewResource?.destroy();
      previewResource = undefined;
      preview.replaceChildren();
      if (!drafts.has(key))
        drafts.set(key, {
          stem: "sprite",
          settings: { ...defaults },
          grid: false,
          width: 32,
          height: 32,
          animation: false,
          loop: true,
          dirty: true,
          status: uiMessage("Choose a source image"),
        });
      updateFields();
    }
    if (mode !== context.mode) {
      stop("Cancelled · Workspace changed");
      mode = context.mode;
    }
    render();
  }
  const pagehide = (event: PageTransitionEvent) => {
    if (event.persisted) {
      stop();
      previewResource?.setMoving(false);
    } else destroy();
  };
  window.addEventListener("pagehide", pagehide, true);
  const pageshow = () => {
    sync();
    previewResource?.setMoving(
      previewVisible && element.open && light.value === "Moving Light",
    );
  };
  window.addEventListener("pageshow", pageshow);
  function destroy() {
    if (disposed) return;
    stop();
    disposed = true;
    previewSerial++;
    visibility.disconnect();
    previewResource?.destroy();
    assets.destroy();
    drafts.clear();
    evidence.clear();
    window.removeEventListener("pagehide", pagehide, true);
    window.removeEventListener("pageshow", pageshow);
  }
  sync();
  return {
    element,
    sync,
    destroy,
    generationSettings() {
      return { ...draft().settings };
    },
    async openAsset(name: string, url: string) {
      sync();
      element.open = true;
      stop();
      const token = serial;
      controller = new AbortController();
      busy = true;
      draft().status = uiMessage("Reading asset…");
      render();
      try {
        const response = await fetch(url, { signal: controller.signal });
        const bytes = new Uint8Array(
          await placementNormalRead(response, 16 * 1024 * 1024),
        );
        const ext = bytes[0] === 71 ? "gif" : "png";
        await setSource(
          name.replace(/\.[^.]+$/u, "") + "." + ext,
          bytes,
          token,
        );
      } catch (error) {
        if (alive(token)) draft().status = errorMessage(error);
      } finally {
        if (alive(token)) {
          busy = false;
          render();
        }
      }
    },
    close(document: string) {
      if (document === key) stop();
      drafts.delete(document);
      evidence.delete(document);
      assets.close(document);
    },
    browserEntries() {
      return assets
        .entries()
        .filter((a) => canUsePlacementAsset(a, key, options.context().project) && a.uploaded)
        .map((a) => ({
          id: a.binding.textures.color.asset,
          url: a.urls![a.binding.textures.color.asset],
          width: a.binding.width,
          height: a.binding.height,
        }));
    },
    bindings() {
      return [...(evidence.get(key)?.values() ?? [])];
    },
    blocksSave(document: SceneAuthoringDocumentSpec) {
      const text = JSON.stringify(document);
      return assets
        .entries()
        .some(
          (a) =>
            (!canUsePlacementAsset(a, key, options.context().project) || !a.persisted) &&
            [
              a.binding.textures.color.asset,
              a.binding.textures.normal.asset,
            ].some((id) => text.includes(JSON.stringify(id))),
        );
    },
    assertDocumentAssets(
      document: SceneAuthoringDocumentSpec,
      documentKey: string,
      project?: string,
    ) {
      const text = JSON.stringify(document);
      if (
        assets
          .entries()
          .some(
            (asset) =>
              !canUsePlacementAsset(asset, documentKey, project) &&
              [
                asset.binding.textures.color.asset,
                asset.binding.textures.normal.asset,
              ].some((id) => text.includes(JSON.stringify(id))),
          )
      )
        throw new Error(
          "Generated session assets belong to another document. Register the exported assets and reopen the project.",
        );
    },
  };
}
