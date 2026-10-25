import { setUiText, uiMessage, uiText } from "./placementLocale";
export interface PlacementAssetRevision {
  id: string;
  kind: "sprite" | "model";
  revision: string;
}
/** Detection never imports assets. Explicit Apply owns all writes and resource changes. */
export function createPlacementAssetChanges<T>(options: {
  path(): string | undefined;
  baseline(): readonly PlacementAssetRevision[];
  probe(path: string): Promise<T>;
  revisions(value: T): readonly PlacementAssetRevision[];
  apply(value: T): Promise<void>;
  canApply(): boolean;
  report(error: unknown): void;
}) {
  const element = document.createElement("details");
  element.className = "placement-asset-changes";
  const summary = document.createElement("summary");
  setUiText(summary, "Asset Changes");
  const watch = document.createElement("input");
  watch.type = "checkbox";
  watch.dataset.placementWatchAssets = "true";
  const label = document.createElement("label");
  label.append(watch, uiText(" Watch Folder"));
  const check = document.createElement("button"),
    apply = document.createElement("button"),
    list = document.createElement("div"),
    status = document.createElement("output");
  check.type = apply.type = "button";
  setUiText(check, "Check Changes");
  setUiText(apply, "Apply Changes");
  check.dataset.placementCheckAssets = "true";
  apply.dataset.placementApplyAssets = "true";
  apply.disabled = true;
  element.append(summary, label, check, apply, list, status);
  status.setAttribute("aria-live", "polite");
  let pending: T | undefined,
    path = "",
    generation = 0,
    busy = false,
    timer: number | undefined;
  const signature = (values: readonly PlacementAssetRevision[]) =>
    JSON.stringify(
      values
        .map((value) => [value.kind, value.id, value.revision])
        .sort((a, b) => String(a).localeCompare(String(b))),
    );
  async function inspect() {
    const next = options.path();
    if (!next || busy) return;
    const token = ++generation;
    busy = true;
    check.disabled = true;
    try {
      const result = await options.probe(next);
      if (token !== generation || next !== options.path()) return;
      const before = options.baseline(),
        after = options.revisions(result);
      if (signature(before) === signature(after)) {
        pending = undefined;
        list.replaceChildren();
        setUiText(status, "Assets are current");
        return;
      }
      pending = result;
      path = next;
      const old = new Map(
        before.map((value) => [value.kind + ":" + value.id, value.revision]),
      );
      const fresh = new Set(after.map((value) => value.kind + ":" + value.id));
      const rows = after
        .filter(
          (value) => old.get(value.kind + ":" + value.id) !== value.revision,
        )
        .map(
          (value) =>
            `${old.has(value.kind + ":" + value.id) ? "Changed" : "Added"} · ${value.id} · ${value.kind}`,
        );
      rows.push(
        ...before
          .filter((value) => !fresh.has(value.kind + ":" + value.id))
          .map((value) => "Missing · " + value.id),
      );
      list.replaceChildren(
        ...rows.slice(0, 128).map((value) => {
          const row = document.createElement("p");
          setUiText(row, value);
          return row;
        }),
      );
      setUiText(status, uiMessage("{0} changes detected", rows.length));
    } catch (error) {
      if (token === generation) {
        setUiText(
          status,
          error instanceof Error ? error.message : String(error),
        );
        options.report(error);
      }
    } finally {
      busy = false;
      check.disabled = !options.path();
      apply.disabled = !pending || !options.canApply();
    }
  }
  check.addEventListener("click", () => void inspect());
  apply.addEventListener("click", () => {
    if (!pending || !options.canApply() || path !== options.path() || busy)
      return;
    const value = pending,
      token = ++generation;
    busy = true;
    apply.disabled = check.disabled = true;
    void options
      .apply(value)
      .then(() => {
        if (token !== generation) return;
        pending = undefined;
        list.replaceChildren();
        setUiText(status, "Assets applied");
      })
      .catch((error) => {
        options.report(error);
        setUiText(
          status,
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        busy = false;
        apply.disabled = !pending || !options.canApply();
        check.disabled = !options.path();
      });
  });
  watch.addEventListener("change", () => {
    if (timer) window.clearInterval(timer);
    timer = watch.checked
      ? window.setInterval(() => void inspect(), 3000)
      : undefined;
    if (watch.checked) void inspect();
  });
  window.addEventListener("pagehide", () => {
    generation++;
    if (timer) window.clearInterval(timer);
  });
  return {
    element,
    sync() {
      const next = options.path();
      if (path && path !== next) {
        generation++;
        pending = undefined;
        list.replaceChildren();
        setUiText(status, "");
        path = next ?? "";
      }
      watch.disabled = !next;
      check.disabled = busy || !next;
      apply.disabled = busy || !pending || !options.canApply();
      if (!next)
        setUiText(status, "Open a desktop asset folder to watch changes");
    },
  };
}
