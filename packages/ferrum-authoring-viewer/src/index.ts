export const FERRUM_AUTHORING_VIEWER_TITLE = "Scene Placement Viewer" as const;
export const FERRUM_AUTHORING_VIEWER_FORMAT = "ferrum2d.authoring-viewer" as const;
export const FERRUM_AUTHORING_VIEWER_VERSION = 1 as const;
export const FERRUM_AUTHORING_VIEWER_WORKFLOW = "human-placement-agent-behavior" as const;
export const FERRUM_AUTHORING_VIEWER_PLACEMENT_OWNER = "sceneComposition.fragments[].instances[]" as const;
export const FERRUM_AUTHORING_VIEWER_BEHAVIOR_OWNER =
  "sceneComposition.prefabs[].props.behaviorRecipes + behaviorRecipes.entities" as const;
export const FERRUM_AUTHORING_VIEWER_RECOMMENDED_SCRIPT = "ferrum:placement-viewer" as const;

export interface FerrumAuthoringViewerOwnership {
  readonly workflow: typeof FERRUM_AUTHORING_VIEWER_WORKFLOW;
  readonly placementOwner: typeof FERRUM_AUTHORING_VIEWER_PLACEMENT_OWNER;
  readonly behaviorOwner: typeof FERRUM_AUTHORING_VIEWER_BEHAVIOR_OWNER;
}

export const FERRUM_AUTHORING_VIEWER_OWNERSHIP: FerrumAuthoringViewerOwnership = Object.freeze({
  workflow: FERRUM_AUTHORING_VIEWER_WORKFLOW,
  placementOwner: FERRUM_AUTHORING_VIEWER_PLACEMENT_OWNER,
  behaviorOwner: FERRUM_AUTHORING_VIEWER_BEHAVIOR_OWNER,
});

export interface FerrumAuthoringViewerBehaviorBindingEvidence {
  readonly recipeId: string;
  readonly bindingPath: string;
  readonly behaviorRecipePath: string;
  readonly commandCount: number;
  readonly commandTypes: readonly string[];
}

export interface FerrumAuthoringViewerBehaviorBindingEvidenceOptions {
  readonly instanceId: string;
  readonly recipeId: string;
  readonly commandCount?: number;
  readonly commandTypes?: readonly string[];
}

export interface FormatAuthoringViewerBehaviorProfilesOptions {
  readonly emptyLabel?: string;
}

export interface FerrumAuthoringViewerDataset {
  readonly [key: string]: string | undefined;
}

export interface FerrumAuthoringViewerControlOptions {
  readonly label: string;
  readonly className?: string;
  readonly dataset?: FerrumAuthoringViewerDataset;
}

export interface FerrumAuthoringViewerNumberControlOptions extends FerrumAuthoringViewerControlOptions {
  readonly value?: number | string;
  readonly step?: string;
  readonly min?: string;
}

export interface FerrumAuthoringViewerTextControlOptions extends FerrumAuthoringViewerControlOptions {
  readonly value?: string;
  readonly spellcheck?: boolean;
}

export interface FerrumAuthoringViewerSelectOption {
  readonly value: string;
  readonly label?: string;
}

export interface FerrumAuthoringViewerSelectControlOptions extends FerrumAuthoringViewerControlOptions {
  readonly options: readonly (string | FerrumAuthoringViewerSelectOption)[];
  readonly value?: string;
}

export interface FerrumAuthoringViewerTextareaControlOptions extends FerrumAuthoringViewerControlOptions {
  readonly value?: string;
  readonly rows?: number;
  readonly spellcheck?: boolean;
}

export interface FerrumAuthoringViewerCheckboxControlOptions extends FerrumAuthoringViewerControlOptions {
  readonly checked?: boolean;
}

export interface FerrumAuthoringViewerMessageOptions {
  readonly text: string;
  readonly className?: string;
}

export interface FerrumAuthoringViewerActionButtonOptions {
  readonly label: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly dataset?: FerrumAuthoringViewerDataset;
  readonly onClick?: (event: MouseEvent) => void;
}

export interface FerrumAuthoringViewerSummaryCardOptions {
  readonly title: string;
  readonly meta?: string;
  readonly className?: string;
  readonly titleClassName?: string;
  readonly metaClassName?: string;
  readonly dataset?: FerrumAuthoringViewerDataset;
  readonly action?: FerrumAuthoringViewerActionButtonOptions;
  readonly children?: readonly HTMLElement[];
}

export interface FerrumAuthoringViewerDisclosureSectionOptions {
  readonly title: string;
  readonly body?: HTMLElement;
  readonly open?: boolean;
  readonly className?: string;
  readonly summaryClassName?: string;
  readonly bodyClassName?: string;
  readonly dataset?: FerrumAuthoringViewerDataset;
}

export interface FerrumAuthoringViewerShellClassNames {
  readonly shell?: string;
  readonly toolbar?: string;
  readonly status?: string;
  readonly layout?: string;
  readonly stage?: string;
  readonly panel?: string;
  readonly section?: string;
}

export interface FerrumAuthoringViewerSectionOptions {
  readonly title: string;
  readonly body?: HTMLElement;
  readonly className?: string;
}

export interface FerrumAuthoringViewerShellSectionOptions extends FerrumAuthoringViewerSectionOptions {
  readonly id: string;
}

export interface FerrumAuthoringViewerShellOptions {
  readonly root: HTMLElement;
  readonly title: string;
  readonly sections: readonly FerrumAuthoringViewerShellSectionOptions[];
  readonly classNames?: FerrumAuthoringViewerShellClassNames;
}

export interface FerrumAuthoringViewerShell {
  readonly shell: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly title: HTMLHeadingElement;
  readonly status: HTMLElement;
  readonly layout: HTMLElement;
  readonly stage: HTMLElement;
  readonly panel: HTMLElement;
  readonly sections: Readonly<Record<string, HTMLElement>>;
}

export interface FerrumAuthoringViewerAppChromeClassNames {
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

export interface FerrumAuthoringViewerAppChromeLabels {
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

export interface FerrumAuthoringViewerAppChromeOptions {
  readonly root: HTMLElement;
  readonly toolbar: HTMLElement;
  readonly title?: string;
  readonly insertBefore?: Element | null;
  readonly classNames?: FerrumAuthoringViewerAppChromeClassNames;
  readonly labels?: FerrumAuthoringViewerAppChromeLabels;
}

export interface FerrumAuthoringViewerAppChromeSnapshot {
  readonly source: string;
  readonly selected?: string;
  readonly prefab?: string;
  readonly draftCount?: number;
  readonly referenceCount?: number;
  readonly saveEnabled: boolean;
  readonly saveTarget: string;
}

export interface FerrumAuthoringViewerAppChromeSaveResult {
  readonly saved?: boolean;
}

export interface FerrumAuthoringViewerAppChrome {
  readonly fileStrip: HTMLElement;
  readonly statusBar: HTMLElement;
  setSnapshot(snapshot: FerrumAuthoringViewerAppChromeSnapshot): void;
  setSaveResult(result: FerrumAuthoringViewerAppChromeSaveResult): void;
  setSaveError(error: unknown): void;
}

interface FerrumAuthoringViewerAppChromeSaveStateOptions {
  readonly saveEnabled: boolean;
  readonly draftCount: number;
  readonly referenceCount: number;
  readonly lastSaveError?: string;
  readonly lastSaveResult?: FerrumAuthoringViewerAppChromeSaveResult;
  readonly labels: Required<FerrumAuthoringViewerAppChromeLabels>;
}

const DEFAULT_APP_CHROME_CLASS_NAMES: Required<FerrumAuthoringViewerAppChromeClassNames> = Object.freeze({
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

const DEFAULT_APP_CHROME_LABELS: Required<FerrumAuthoringViewerAppChromeLabels> = Object.freeze({
  selected: "Selected",
  prefab: "Prefab",
  draft: "Draft",
  refs: "Refs",
  save: "Save",
  clean: "Clean",
  changeSingular: "Change",
  changePlural: "Changes",
  noDocument: "No Document",
  readOnly: "Read Only",
  saveFailed: "Save Failed",
  blocked: "Blocked",
  unsaved: "Unsaved",
  saved: "Saved",
});

export function formatAuthoringViewerBehaviorProfiles(
  profiles: readonly string[] | undefined,
  options: FormatAuthoringViewerBehaviorProfilesOptions = {},
): string {
  if (profiles === undefined || profiles.length === 0) {
    return options.emptyLabel ?? "-";
  }
  return profiles.join(", ");
}

export function appendAuthoringViewerKeyValueRow(
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

export function createAuthoringViewerNumberControl(
  options: FerrumAuthoringViewerNumberControlOptions,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const { label, input } = createAuthoringViewerInputControl(options);
  input.type = "number";
  input.value = options.value === undefined ? "" : String(options.value);
  input.step = options.step ?? "1";
  if (options.min !== undefined) {
    input.min = options.min;
  }
  return { label, input };
}

export function appendAuthoringViewerNumberControl(
  parent: HTMLElement,
  options: FerrumAuthoringViewerNumberControlOptions,
): HTMLInputElement {
  const { label, input } = createAuthoringViewerNumberControl(options);
  parent.append(label);
  return input;
}

export function appendAuthoringViewerTextControl(
  parent: HTMLElement,
  options: FerrumAuthoringViewerTextControlOptions,
): HTMLInputElement {
  const { label, input } = createAuthoringViewerInputControl(options);
  input.type = "text";
  input.value = options.value ?? "";
  input.spellcheck = options.spellcheck ?? false;
  parent.append(label);
  return input;
}

export function appendAuthoringViewerSelectControl(
  parent: HTMLElement,
  options: FerrumAuthoringViewerSelectControlOptions,
): HTMLSelectElement {
  const wrapper = createAuthoringViewerControlWrapper(options);
  const select = document.createElement("select");
  applyAuthoringViewerDataset(select, options.dataset);
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

export function appendAuthoringViewerTextareaControl(
  parent: HTMLElement,
  options: FerrumAuthoringViewerTextareaControlOptions,
): HTMLTextAreaElement {
  const wrapper = createAuthoringViewerControlWrapper(options);
  const textarea = document.createElement("textarea");
  textarea.value = options.value ?? "";
  textarea.rows = options.rows ?? 3;
  textarea.spellcheck = options.spellcheck ?? false;
  applyAuthoringViewerDataset(textarea, options.dataset);
  wrapper.append(textarea);
  parent.append(wrapper);
  return textarea;
}

export function appendAuthoringViewerCheckboxControl(
  parent: HTMLElement,
  options: FerrumAuthoringViewerCheckboxControlOptions,
): HTMLInputElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  const input = document.createElement("input");
  wrapper.className = options.className ?? "";
  labelText.textContent = options.label;
  input.type = "checkbox";
  input.checked = options.checked ?? false;
  applyAuthoringViewerDataset(input, options.dataset);
  wrapper.append(input, labelText);
  parent.append(wrapper);
  return input;
}

export function createAuthoringViewerMessage(
  options: FerrumAuthoringViewerMessageOptions,
): HTMLParagraphElement {
  const message = document.createElement("p");
  message.className = options.className ?? "";
  message.textContent = options.text;
  return message;
}

export function createAuthoringViewerActionButton(
  options: FerrumAuthoringViewerActionButtonOptions,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = options.label;
  button.className = options.className ?? "";
  button.disabled = options.disabled ?? false;
  applyAuthoringViewerDataset(button, options.dataset);
  if (options.onClick !== undefined) {
    button.addEventListener("click", options.onClick);
  }
  return button;
}

export function createAuthoringViewerSummaryCard(
  options: FerrumAuthoringViewerSummaryCardOptions,
): HTMLElement {
  const card = document.createElement("article");
  const title = document.createElement("h3");
  card.className = options.className ?? "";
  title.className = options.titleClassName ?? "";
  title.textContent = options.title;
  applyAuthoringViewerDataset(card, options.dataset);
  card.append(title);
  if (options.meta !== undefined) {
    const meta = document.createElement("p");
    meta.className = options.metaClassName ?? "";
    meta.textContent = options.meta;
    card.append(meta);
  }
  if (options.action !== undefined) {
    card.append(createAuthoringViewerActionButton(options.action));
  }
  if (options.children !== undefined) {
    card.append(...options.children);
  }
  return card;
}

export function createAuthoringViewerDisclosureSection(
  options: FerrumAuthoringViewerDisclosureSectionOptions,
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
  applyAuthoringViewerDataset(section, options.dataset);
  if (options.body !== undefined) {
    options.body.className = mergeClassName(options.body.className, options.bodyClassName);
    section.append(options.body);
  }
  return section;
}

export function createAuthoringViewerSection(
  options: FerrumAuthoringViewerSectionOptions,
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

export function createAuthoringViewerShell(
  options: FerrumAuthoringViewerShellOptions,
): FerrumAuthoringViewerShell {
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
    const section = createAuthoringViewerSection({
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

export function createAuthoringViewerAppChrome(
  options: FerrumAuthoringViewerAppChromeOptions,
): FerrumAuthoringViewerAppChrome {
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
  const selectedStatus = appendAuthoringViewerStatusItem(statusBar, labels.selected, classNames);
  const prefabStatus = appendAuthoringViewerStatusItem(statusBar, labels.prefab, classNames);
  const draftStatus = appendAuthoringViewerStatusItem(statusBar, labels.draft, classNames);
  const referenceStatus = appendAuthoringViewerStatusItem(statusBar, labels.refs, classNames);
  const saveTargetStatus = appendAuthoringViewerStatusItem(statusBar, labels.save, classNames);
  let lastSnapshot: FerrumAuthoringViewerAppChromeSnapshot | undefined;
  let lastSaveError: string | undefined;
  let lastSaveResult: FerrumAuthoringViewerAppChromeSaveResult | undefined;

  options.root.dataset.ferrumAuthoringViewerShell = "true";
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
    fileLabel.textContent = authoringViewerDocumentFileName(source, labels);
    filePath.textContent = source;
    filePath.title = source;
    saveBadge.textContent = saveState.label;
    saveBadge.dataset.status = saveState.status;
    draftBadge.textContent = authoringViewerDraftLabel(draftCount, labels);
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
      lastSaveError = authoringViewerErrorMessage(error);
      lastSaveResult = undefined;
      render();
    },
  };
}

export function readAuthoringViewerNumberInput(input: HTMLInputElement): number | undefined {
  const value = input.value.trim();
  if (value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function setAuthoringViewerNumberInputValue(input: HTMLInputElement, value: number): void {
  const next = formatAuthoringViewerNumber(value);
  if (input.value !== next) {
    input.value = next;
  }
}

export function formatAuthoringViewerNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function createAuthoringViewerBehaviorBindingPath(instanceId: string): string {
  return `sceneAuthoring.placement.instances.${instanceId}.props.behaviorRecipes`;
}

export function createAuthoringViewerBehaviorRecipePath(recipeId: string): string {
  return `behaviorRecipes.entities.${recipeId}`;
}

export function createAuthoringViewerBehaviorBindingEvidence(
  options: FerrumAuthoringViewerBehaviorBindingEvidenceOptions,
): FerrumAuthoringViewerBehaviorBindingEvidence {
  return {
    recipeId: options.recipeId,
    bindingPath: createAuthoringViewerBehaviorBindingPath(options.instanceId),
    behaviorRecipePath: createAuthoringViewerBehaviorRecipePath(options.recipeId),
    commandCount: options.commandCount ?? 0,
    commandTypes: uniqueSortedStrings(options.commandTypes ?? []),
  };
}

function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function appendAuthoringViewerStatusItem(
  parent: HTMLElement,
  label: string,
  classNames: Required<FerrumAuthoringViewerAppChromeClassNames>,
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
  options: FerrumAuthoringViewerAppChromeSaveStateOptions,
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

function authoringViewerDocumentFileName(
  source: string,
  labels: Required<FerrumAuthoringViewerAppChromeLabels>,
): string {
  const normalized = source.trim();
  if (normalized.length === 0) {
    return labels.noDocument;
  }
  const withoutQuery = normalized.split(/[?#]/, 1)[0] ?? normalized;
  const parts = withoutQuery.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : withoutQuery;
}

function authoringViewerDraftLabel(
  draftCount: number,
  labels: Required<FerrumAuthoringViewerAppChromeLabels>,
): string {
  if (draftCount === 0) {
    return labels.clean;
  }
  return `${draftCount} ${draftCount === 1 ? labels.changeSingular : labels.changePlural}`;
}

function authoringViewerErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown authoring viewer error";
}

function createAuthoringViewerInputControl(
  options: FerrumAuthoringViewerControlOptions,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = createAuthoringViewerControlWrapper(options);
  const input = document.createElement("input");
  applyAuthoringViewerDataset(input, options.dataset);
  wrapper.append(input);
  return { label: wrapper, input };
}

function createAuthoringViewerControlWrapper(
  options: FerrumAuthoringViewerControlOptions,
): HTMLLabelElement {
  const wrapper = document.createElement("label");
  const labelText = document.createElement("span");
  wrapper.className = options.className ?? "";
  labelText.textContent = options.label;
  wrapper.append(labelText);
  return wrapper;
}

function applyAuthoringViewerDataset(
  element: HTMLElement,
  dataset: FerrumAuthoringViewerDataset | undefined,
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
