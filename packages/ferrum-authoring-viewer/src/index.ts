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
