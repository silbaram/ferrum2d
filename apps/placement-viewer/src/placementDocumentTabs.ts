import { setUiAttribute, setUiText, uiMessage } from "./placementLocale";
export interface PlacementDocumentTab {
  key: string;
  label: string;
  source: string;
  dirty: boolean;
  controls?: string;
  closable?: boolean;
}

/** Tab chrome only; document ownership and runtime activation live in the host. */
export function createPlacementDocumentTabs(options: {
  activate(key: string): void;
  close(key: string): void;
  open(file: File): Promise<void>;
}) {
  const element = document.createElement("div");
  element.className = "placement-workspace-strip";
  const tabs = document.createElement("div");
  tabs.className = "placement-document-tabs";
  tabs.setAttribute("role", "tablist");
  setUiAttribute(tabs, "aria-label", "Scene documents");
  const open = document.createElement("button");
  open.type = "button";
  setUiText(open, "Open JSON");
  open.dataset.placementAction = "open-json-document";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.hidden = true;
  input.dataset.placementDocumentFile = "true";
  const message = document.createElement("span");
  let tabSignature = "";
  message.className = "placement-workspace-message";
  message.setAttribute("role", "status");
  open.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (file) void options.open(file).catch((error) => report(error));
  });
  tabs.addEventListener("keydown", (event) => {
    if (
      !(event.target instanceof HTMLButtonElement) ||
      event.target.getAttribute("role") !== "tab"
    )
      return;
    const buttons = [...tabs.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    const index = buttons.indexOf(event.target);
    const next =
      event.code === "Home"
        ? 0
        : event.code === "End"
          ? buttons.length - 1
          : event.code === "ArrowRight"
            ? (index + 1) % buttons.length
            : event.code === "ArrowLeft"
              ? (index + buttons.length - 1) % buttons.length
              : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const key = buttons[next].dataset.placementDocumentKey;
    if (key) options.activate(key);
    // Activation refreshes the tab nodes.
    tabs.querySelector<HTMLButtonElement>("[aria-selected=true]")?.focus();
  });
  element.append(tabs, open, input, message);
  function report(error?: unknown) {
    setUiText(
      message,
      error === undefined
        ? ""
        : error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Could not open document",
    );
  }
  return {
    element,
    report,
    setState(documents: PlacementDocumentTab[], active: string) {
      const signature = JSON.stringify([documents, active]);
      if (signature === tabSignature) return;
      tabSignature = signature;
      const restoreFocus = tabs.contains(window.document.activeElement);
      tabs.replaceChildren(
        ...documents.map((document) => {
          const item = window.document.createElement("div");
          item.className = "placement-document-tab";
          item.dataset.active = String(document.key === active);
          const button = window.document.createElement("button");
          button.type = "button";
          button.setAttribute("role", "tab");
          button.setAttribute("aria-selected", String(document.key === active));
          button.setAttribute("aria-controls", document.controls ?? "placement-viewport");
          button.tabIndex = document.key === active ? 0 : -1;
          button.dataset.placementDocumentKey = document.key;
          button.textContent = `${document.label}${document.dirty ? " •" : ""}`;
          button.title = document.source;
          button.addEventListener("click", () =>
            options.activate(document.key),
          );
          const close = window.document.createElement("button");
          close.type = "button";
          setUiText(close, "×");
          setUiAttribute(close, "title", "Close document");
          setUiAttribute(
            close,
            "aria-label",
            uiMessage("Close {0}", document.label),
          );
          close.dataset.placementCloseDocument = document.key;
          close.tabIndex = -1;
          close.disabled = document.closable === false ||
            (document.closable === undefined && documents.length === 1);
          close.addEventListener("click", () => options.close(document.key));
          item.append(button, close);
          return item;
        }),
      );
      if (restoreFocus)
        tabs.querySelector<HTMLButtonElement>("[aria-selected=true]")?.focus();
      Object.assign(window, {
        ferrumPlacementWorkspaceDocuments: documents,
        ferrumPlacementWorkspaceActiveDocument: active,
      });
    },
  };
}
