export const FERRUM_STUDIO_KIT_TITLE = "Ferrum2D Studio" as const;
export const FERRUM_STUDIO_KIT_FORMAT = "ferrum2d.studio-kit" as const;
export const FERRUM_STUDIO_KIT_VERSION = 1 as const;
export const FERRUM_STUDIO_KIT_WORKFLOW = "human-placement-agent-behavior" as const;
export const FERRUM_STUDIO_KIT_PLACEMENT_OWNER = "sceneComposition.fragments[].instances[]" as const;
export const FERRUM_STUDIO_KIT_BEHAVIOR_OWNER =
  "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities" as const;
export const FERRUM_STUDIO_KIT_RECOMMENDED_SCRIPT = "ferrum:studio" as const;

export interface FerrumStudioKitOwnership {
  readonly workflow: typeof FERRUM_STUDIO_KIT_WORKFLOW;
  readonly placementOwner: typeof FERRUM_STUDIO_KIT_PLACEMENT_OWNER;
  readonly behaviorOwner: typeof FERRUM_STUDIO_KIT_BEHAVIOR_OWNER;
}

export const FERRUM_STUDIO_KIT_OWNERSHIP: FerrumStudioKitOwnership = Object.freeze({
  workflow: FERRUM_STUDIO_KIT_WORKFLOW,
  placementOwner: FERRUM_STUDIO_KIT_PLACEMENT_OWNER,
  behaviorOwner: FERRUM_STUDIO_KIT_BEHAVIOR_OWNER,
});

export interface FerrumStudioKitBehaviorBindingEvidence {
  readonly recipeId: string;
  readonly bindingPath: string;
  readonly behaviorRecipePath: string;
  readonly commandCount: number;
  readonly commandTypes: readonly string[];
}

export interface FerrumStudioKitBehaviorBindingEvidenceOptions {
  readonly instanceId: string;
  readonly recipeId: string;
  readonly commandCount?: number;
  readonly commandTypes?: readonly string[];
}

export interface FormatStudioKitBehaviorProfilesOptions {
  readonly emptyLabel?: string;
}

export interface FerrumStudioKitDataset {
  readonly [key: string]: string | undefined;
}

export interface FerrumStudioKitControlOptions {
  readonly label: string;
  readonly className?: string;
  readonly dataset?: FerrumStudioKitDataset;
}

export interface FerrumStudioKitNumberControlOptions extends FerrumStudioKitControlOptions {
  readonly value?: number | string;
  readonly step?: string;
  readonly min?: string;
}

export interface FerrumStudioKitTextControlOptions extends FerrumStudioKitControlOptions {
  readonly value?: string;
  readonly spellcheck?: boolean;
}

export interface FerrumStudioKitSelectOption {
  readonly value: string;
  readonly label?: string;
}

export interface FerrumStudioKitSelectControlOptions extends FerrumStudioKitControlOptions {
  readonly options: readonly (string | FerrumStudioKitSelectOption)[];
  readonly value?: string;
}

export interface FerrumStudioKitTextareaControlOptions extends FerrumStudioKitControlOptions {
  readonly value?: string;
  readonly rows?: number;
  readonly spellcheck?: boolean;
}

export interface FerrumStudioKitCheckboxControlOptions extends FerrumStudioKitControlOptions {
  readonly checked?: boolean;
}

export interface FerrumStudioKitMessageOptions {
  readonly text: string;
  readonly className?: string;
}

export interface FerrumStudioKitActionButtonOptions {
  readonly label: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly dataset?: FerrumStudioKitDataset;
  readonly onClick?: (event: MouseEvent) => void;
}

export interface FerrumStudioKitSummaryCardOptions {
  readonly title: string;
  readonly meta?: string;
  readonly className?: string;
  readonly titleClassName?: string;
  readonly metaClassName?: string;
  readonly dataset?: FerrumStudioKitDataset;
  readonly action?: FerrumStudioKitActionButtonOptions;
  readonly children?: readonly HTMLElement[];
}

export interface FerrumStudioKitDisclosureSectionOptions {
  readonly title: string;
  readonly body?: HTMLElement;
  readonly open?: boolean;
  readonly className?: string;
  readonly summaryClassName?: string;
  readonly bodyClassName?: string;
  readonly dataset?: FerrumStudioKitDataset;
}

export interface FerrumStudioKitShellClassNames {
  readonly shell?: string;
  readonly toolbar?: string;
  readonly status?: string;
  readonly layout?: string;
  readonly stage?: string;
  readonly panel?: string;
  readonly section?: string;
}

export interface FerrumStudioKitSectionOptions {
  readonly title: string;
  readonly body?: HTMLElement;
  readonly className?: string;
}

export interface FerrumStudioKitShellSectionOptions extends FerrumStudioKitSectionOptions {
  readonly id: string;
}

export interface FerrumStudioKitShellOptions {
  readonly root: HTMLElement;
  readonly title: string;
  readonly sections: readonly FerrumStudioKitShellSectionOptions[];
  readonly classNames?: FerrumStudioKitShellClassNames;
}

export interface FerrumStudioKitShell {
  readonly shell: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly status: HTMLElement;
  readonly layout: HTMLElement;
  readonly stage: HTMLElement;
  readonly panel: HTMLElement;
  readonly sections: Readonly<Record<string, HTMLElement>>;
}

export interface FerrumStudioKitAppChromeClassNames {
  readonly fileStrip?: string;
  readonly fileMeta?: string;
  readonly fileName?: string;
  readonly filePath?: string;
  readonly stateBadge?: string;
  readonly stateBadgeMuted?: string;
  readonly statusBar?: string;
  readonly statusItem?: string;
  readonly statusLabel?: string;
  readonly statusValue?: string;
}

export interface FerrumStudioKitAppChromeLabels {
  readonly selected?: string;
  readonly prefab?: string;
  readonly draft?: string;
  readonly refs?: string;
  readonly save?: string;
  readonly clean?: string;
  readonly changeSingular?: string;
  readonly changePlural?: string;
  readonly noDocument?: string;
  readonly readOnly?: string;
  readonly saveFailed?: string;
  readonly blocked?: string;
  readonly unsaved?: string;
  readonly saved?: string;
}

export interface FerrumStudioKitAppChromeOptions {
  readonly root: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly title?: string;
  readonly insertBefore?: Element | null;
  readonly classNames?: FerrumStudioKitAppChromeClassNames;
  readonly labels?: FerrumStudioKitAppChromeLabels;
}

export interface FerrumStudioKitAppChromeSnapshot {
  readonly source: string;
  readonly selected?: string;
  readonly prefab?: string;
  readonly draftCount?: number;
  readonly referenceCount?: number;
  readonly saveEnabled: boolean;
  readonly saveTarget: string;
}

export interface FerrumStudioKitAppChromeSaveResult {
  readonly saved?: boolean;
}

export interface FerrumStudioKitAppChrome {
  readonly fileStrip: HTMLElement;
  readonly statusBar: HTMLElement;
  setSnapshot(snapshot: FerrumStudioKitAppChromeSnapshot): void;
  setSaveResult(result: FerrumStudioKitAppChromeSaveResult): void;
  setSaveError(error: unknown): void;
}

interface FerrumStudioKitAppChromeSaveStateOptions {
  readonly saveEnabled: boolean;
  readonly draftCount: number;
  readonly referenceCount: number;
  readonly lastSaveError?: string;
  readonly lastSaveResult?: FerrumStudioKitAppChromeSaveResult;
  readonly labels: Required<FerrumStudioKitAppChromeLabels>;
}

const DEFAULT_APP_CHROME_CLASS_NAMES: Required<FerrumStudioKitAppChromeClassNames> = Object.freeze({
  fileStrip: "ferrum-authoring-file-strip",
  fileMeta: "ferrum-authoring-file-meta",
  fileName: "ferrum-authoring-file-name",
  filePath: "ferrum-authoring-file-path",
  stateBadge: "ferrum-authoring-state-badge",
  stateBadgeMuted: "ferrum-authoring-state-badge-muted",
  statusBar: "ferrum-authoring-status-bar",
  statusItem: "ferrum-authoring-status-item",
  statusLabel: "ferrum-authoring-status-label",
  statusValue: "ferrum-authoring-status-value",
});

const DEFAULT_APP_CHROME_LABELS: Required<FerrumStudioKitAppChromeLabels> = Object.freeze({
  selected: "Selected",
  prefab: "Prefab",
  draft: "Draft",
  refs: "Refs",
  save: "Save",
  clean: "Clean",
  changeSingular: "Change",
  changePlural: "Changes",
  noDocument: "No Document",
  readOnly: "Export Only",
  saveFailed: "Save Failed",
  blocked: "Blocked",
  unsaved: "Unsaved",
  saved: "Saved",
});

export function formatStudioKitBehaviorProfiles(
  profiles: readonly string[] | undefined,
  options: FormatStudioKitBehaviorProfilesOptions = {},
): string {
  if (profiles === undefined || profiles.length === 0) {
    return options.emptyLabel ?? "-";
  }
  return profiles.join(", ");
}

export function appendStudioKitKeyValueRow(
  parent: HTMLElement,
  label: string,
  value = "-",
): HTMLElement {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  parent.append(term, description);
  return description;
}

export function createStudioKitNumberControl(
  options: FerrumStudioKitNumberControlOptions,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const { label, input } = createStudioKitInputControl(options);
  input.type = "number";
  input.value = options.value === undefined ? "" : String(options.value);
  input.step = options.step ?? "1";
  if (options.min !== undefined) {
    input.min = options.min;
  }
  return { label, input };
}

export function appendStudioKitNumberControl(
  parent: HTMLElement,
  options: FerrumStudioKitNumberControlOptions,
): HTMLInputElement {
  const { label, input } = createStudioKitNumberControl(options);
  parent.append(label);
  return input;
}

export function appendStudioKitTextControl(
  parent: HTMLElement,
  options: FerrumStudioKitTextControlOptions,
): HTMLInputElement {
  const { label, input } = createStudioKitInputControl(options);
  input.type = "text";
  input.value = options.value ?? "";
  input.spellcheck = options.spellcheck ?? false;
  parent.append(label);
  return input;
}

export function appendStudioKitSelectControl(
  parent: HTMLElement,
  options: FerrumStudioKitSelectControlOptions,
): HTMLSelectElement {
  const wrapper = createStudioKitControlWrapper(options);
  const select = document.createElement("select");
  applyStudioKitDataset(select, options.dataset);
  for (const optionValue of options.options) {
    const option = document.createElement("option");
    const value = typeof optionValue === "string" ? optionValue : optionValue.value;
    option.value = value;
    option.textContent = typeof optionValue === "string" ? optionValue : optionValue.label ?? value;
    select.append(option);
  }
  if (options.value !== undefined) {
    select.value = options.value;
  }
  wrapper.append(select);
  parent.append(wrapper);
  return select;
}

export function appendStudioKitTextareaControl(
  parent: HTMLElement,
  options: FerrumStudioKitTextareaControlOptions,
): HTMLTextAreaElement {
  const wrapper = createStudioKitControlWrapper(options);
  const textarea = document.createElement("textarea");
  textarea.value = options.value ?? "";
  textarea.rows = options.rows ?? 3;
  textarea.spellcheck = options.spellcheck ?? false;
  applyStudioKitDataset(textarea, options.dataset);
  wrapper.append(textarea);
  parent.append(wrapper);
  return textarea;
}

export function appendStudioKitCheckboxControl(
  parent: HTMLElement,
  options: FerrumStudioKitCheckboxControlOptions,
): HTMLInputElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  const input = document.createElement("input");
  wrapper.className = options.className ?? "";
  labelText.textContent = options.label;
  input.type = "checkbox";
  input.checked = options.checked ?? false;
  applyStudioKitDataset(input, options.dataset);
  wrapper.append(input, labelText);
  parent.append(wrapper);
  return input;
}

export function createStudioKitMessage(
  options: FerrumStudioKitMessageOptions,
): HTMLParagraphElement {
  const message = document.createElement("p");
  message.className = options.className ?? "";
  message.textContent = options.text;
  return message;
}

export function createStudioKitActionButton(
  options: FerrumStudioKitActionButtonOptions,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = options.label;
  button.className = options.className ?? "";
  button.disabled = options.disabled ?? false;
  applyStudioKitDataset(button, options.dataset);
  if (options.onClick !== undefined) {
    button.addEventListener("click", options.onClick);
  }
  return button;
}

export function createStudioKitSummaryCard(
  options: FerrumStudioKitSummaryCardOptions,
): HTMLElement {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  card.className = options.className ?? "";
  title.className = options.titleClassName ?? "";
  title.textContent = options.title;
  applyStudioKitDataset(card, options.dataset);
  card.append(title);
  if (options.meta !== undefined) {
    const meta = document.createElement("p");
    meta.className = options.metaClassName ?? "";
    meta.textContent = options.meta;
    card.append(meta);
  }
  if (options.action !== undefined) {
    card.append(createStudioKitActionButton(options.action));
  }
  if (options.children !== undefined) {
    card.append(...options.children);
  }
  return card;
}

export function createStudioKitDisclosureSection(
  options: FerrumStudioKitDisclosureSectionOptions,
): HTMLDetailsElement {
  const section = document.createElement("details");
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  section.className = options.className ?? "";
  section.open = options.open ?? true;
  summary.className = options.summaryClassName ?? "";
  title.textContent = options.title;
  summary.append(title);
  section.append(summary);
  applyStudioKitDataset(section, options.dataset);
  if (options.body !== undefined) {
    options.body.className = mergeClassName(options.body.className, options.bodyClassName);
    section.append(options.body);
  }
  return section;
}

export function createStudioKitSection(
  options: FerrumStudioKitSectionOptions,
): HTMLElement {
  const section = document.createElement("section");
  const title = document.createElement("h2");
  section.className = options.className ?? "";
  title.textContent = options.title;
  section.append(title);
  if (options.body !== undefined) {
    section.append(options.body);
  }
  return section;
}

export function createStudioKitShell(
  options: FerrumStudioKitShellOptions,
): FerrumStudioKitShell {
  const shell = document.createElement("main");
  const toolbar = document.createElement("header");
  const title = document.createElement("h1");
  const status = document.createElement("div");
  const layout = document.createElement("section");
  const stage = document.createElement("section");
  const panel = document.createElement("aside");
  const sectionElements: Record<string, HTMLElement> = {};
  const classNames = options.classNames ?? {};

  shell.className = classNames.shell ?? "";
  toolbar.className = classNames.toolbar ?? "";
  status.className = classNames.status ?? "";
  layout.className = classNames.layout ?? "";
  stage.className = classNames.stage ?? "";
  panel.className = classNames.panel ?? "";
  title.textContent = options.title;

  toolbar.append(title, status);
  for (const sectionSpec of options.sections) {
    const section = createStudioKitSection({
      title: sectionSpec.title,
      body: sectionSpec.body,
      className: sectionSpec.className ?? classNames.section,
    });
    sectionElements[sectionSpec.id] = section;
    panel.append(section);
  }
  layout.append(stage, panel);
  shell.append(toolbar, layout);
  options.root.replaceChildren(shell);

  return {
    shell,
    toolbar,
    title,
    status,
    layout,
    stage,
    panel,
    sections: Object.freeze(sectionElements),
  };
}

export function createStudioKitAppChrome(
  options: FerrumStudioKitAppChromeOptions,
): FerrumStudioKitAppChrome {
  const classNames = {
    ...DEFAULT_APP_CHROME_CLASS_NAMES,
    ...options.classNames,
  };
  const labels = {
    ...DEFAULT_APP_CHROME_LABELS,
    ...options.labels,
  };
  const toolbarTitle = options.toolbar.querySelector("h1");
  const fileStrip = document.createElement("section");
  const fileMeta = document.createElement("div");
  const fileLabel = document.createElement("span");
  const filePath = document.createElement("span");
  const saveBadge = document.createElement("span");
  const draftBadge = document.createElement("span");
  const statusBar = document.createElement("footer");
  const selectedStatus = appendStudioKitStatusItem(statusBar, labels.selected, classNames);
  const prefabStatus = appendStudioKitStatusItem(statusBar, labels.prefab, classNames);
  const draftStatus = appendStudioKitStatusItem(statusBar, labels.draft, classNames);
  const referenceStatus = appendStudioKitStatusItem(statusBar, labels.refs, classNames);
  const saveTargetStatus = appendStudioKitStatusItem(statusBar, labels.save, classNames);
  let lastSnapshot: FerrumStudioKitAppChromeSnapshot | undefined;
  let lastSaveError: string | undefined;
  let lastSaveResult: FerrumStudioKitAppChromeSaveResult | undefined;

  options.root.dataset.ferrumStudioKitShell = "true";
  if (toolbarTitle !== null && options.title !== undefined) {
    toolbarTitle.textContent = options.title;
  }

  fileStrip.className = classNames.fileStrip;
  fileMeta.className = classNames.fileMeta;
  fileLabel.className = classNames.fileName;
  filePath.className = classNames.filePath;
  saveBadge.className = classNames.stateBadge;
  draftBadge.className = `${classNames.stateBadge} ${classNames.stateBadgeMuted}`.trim();
  statusBar.className = classNames.statusBar;

  fileMeta.append(fileLabel, filePath);
  fileStrip.append(fileMeta, saveBadge, draftBadge);
  options.toolbar.insertBefore(fileStrip, options.insertBefore ?? null);
  options.root.append(statusBar);

  const render = (): void => {
    const snapshot = lastSnapshot;
    const source = snapshot?.source ?? "";
    const draftCount = snapshot?.draftCount ?? 0;
    const referenceCount = snapshot?.referenceCount ?? 0;
    const saveState = appChromeSaveState({
      saveEnabled: snapshot?.saveEnabled ?? false,
      draftCount,
      referenceCount,
      lastSaveError,
      lastSaveResult,
      labels,
    });
    fileLabel.textContent = studioKitDocumentFileName(source, labels);
    filePath.textContent = source;
    filePath.title = source;
    saveBadge.textContent = saveState.label;
    saveBadge.dataset.status = saveState.status;
    saveBadge.title = snapshot?.saveEnabled
      ? "Save document changes"
      : "File saving unavailable. Copy Patch or Handoff to keep changes.";
    draftBadge.textContent = studioKitDraftLabel(draftCount, labels);
    draftBadge.dataset.status = draftCount === 0 ? "clean" : "dirty";
    selectedStatus.value.textContent = snapshot?.selected ?? "-";
    prefabStatus.value.textContent = snapshot?.prefab ?? "-";
    draftStatus.value.textContent = String(draftCount);
    referenceStatus.value.textContent = String(referenceCount);
    referenceStatus.element.dataset.status = referenceCount === 0 ? "clean" : "blocked";
    saveTargetStatus.value.textContent = snapshot?.saveTarget ?? "-";
  };

  render();

  return {
    fileStrip,
    statusBar,
    setSnapshot(snapshot) {
      lastSnapshot = snapshot;
      if ((snapshot.draftCount ?? 0) > 0) {
        lastSaveError = undefined;
        lastSaveResult = undefined;
      }
      render();
    },
    setSaveResult(result) {
      lastSaveResult = result;
      lastSaveError = undefined;
      render();
    },
    setSaveError(error) {
      lastSaveError = studioKitErrorMessage(error);
      lastSaveResult = undefined;
      render();
    },
  };
}

export function readStudioKitNumberInput(input: HTMLInputElement): number | undefined {
  const value = input.value.trim();
  if (value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function setStudioKitNumberInputValue(input: HTMLInputElement, value: number): void {
  const next = formatStudioKitNumber(value);
  if (input.value !== next) {
    input.value = next;
  }
}

export function formatStudioKitNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function createStudioKitBehaviorBindingPath(instanceId: string): string {
  return `sceneAuthoring.placement.instances.${instanceId}.props.behaviorRecipes`;
}

export function createStudioKitBehaviorRecipePath(recipeId: string): string {
  return `behaviorRecipes.entities.${recipeId}`;
}

export function createStudioKitBehaviorBindingEvidence(
  options: FerrumStudioKitBehaviorBindingEvidenceOptions,
): FerrumStudioKitBehaviorBindingEvidence {
  return {
    recipeId: options.recipeId,
    bindingPath: createStudioKitBehaviorBindingPath(options.instanceId),
    behaviorRecipePath: createStudioKitBehaviorRecipePath(options.recipeId),
    commandCount: options.commandCount ?? 0,
    commandTypes: uniqueSortedStrings(options.commandTypes ?? []),
  };
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function appendStudioKitStatusItem(
  parent: HTMLElement,
  label: string,
  classNames: Required<FerrumStudioKitAppChromeClassNames>,
): { element: HTMLElement; value: HTMLElement } {
  const element = document.createElement("div");
  const labelElement = document.createElement("span");
  const value = document.createElement("span");
  element.className = classNames.statusItem;
  labelElement.className = classNames.statusLabel;
  value.className = classNames.statusValue;
  labelElement.textContent = label;
  value.textContent = "-";
  element.append(labelElement, value);
  parent.append(element);
  return { element, value };
}

function appChromeSaveState(
  options: FerrumStudioKitAppChromeSaveStateOptions,
): { label: string; status: string } {
  if (!options.saveEnabled) {
    return { label: options.labels.readOnly, status: "readonly" };
  }
  if (options.lastSaveError !== undefined) {
    return { label: options.labels.saveFailed, status: "error" };
  }
  if (options.referenceCount > 0) {
    return { label: options.labels.blocked, status: "blocked" };
  }
  if (options.draftCount > 0) {
    return { label: options.labels.unsaved, status: "dirty" };
  }
  if (options.lastSaveResult?.saved === true) {
    return { label: options.labels.saved, status: "saved" };
  }
  return { label: options.labels.saved, status: "saved" };
}

function studioKitDocumentFileName(
  source: string,
  labels: Required<FerrumStudioKitAppChromeLabels>,
): string {
  const normalized = source.trim();
  if (normalized.length === 0) {
    return labels.noDocument;
  }
  const withoutQuery = normalized.split(/[?#]/, 1)[0] ?? normalized;
  const parts = withoutQuery.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : withoutQuery;
}

function studioKitDraftLabel(
  draftCount: number,
  labels: Required<FerrumStudioKitAppChromeLabels>,
): string {
  if (draftCount === 0) {
    return labels.clean;
  }
  return `${draftCount} ${draftCount === 1 ? labels.changeSingular : labels.changePlural}`;
}

function studioKitErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown Studio Kit error";
}

function createStudioKitInputControl(
  options: FerrumStudioKitControlOptions,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = createStudioKitControlWrapper(options);
  const input = document.createElement("input");
  applyStudioKitDataset(input, options.dataset);
  wrapper.append(input);
  return { label: wrapper, input };
}

function createStudioKitControlWrapper(
  options: FerrumStudioKitControlOptions,
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  wrapper.className = options.className ?? "";
  labelText.textContent = options.label;
  wrapper.append(labelText);
  return wrapper;
}

function applyStudioKitDataset(
  element: HTMLElement,
  dataset: FerrumStudioKitDataset | undefined,
): void {
  if (dataset === undefined) {
    return;
  }
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== undefined) {
      element.dataset[key] = value;
    }
  }
}

function mergeClassName(current: string, next: string | undefined): string {
  if (next === undefined || next.length === 0) {
    return current;
  }
  if (current.length === 0) {
    return next;
  }
  return `${current} ${next}`;
}
