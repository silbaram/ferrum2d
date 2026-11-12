import { setUiAttribute } from "./placementLocale";

type StepModifiers = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };
/** Shift is fine and Ctrl/Cmd is coarse, matching label drags. */
export const numberStepScale = (event: StepModifiers) => event.shiftKey ? 0.1 : event.ctrlKey || event.metaKey ? 10 : 1;

/**
 * Field-sized stepping for step="any" inputs, whose native spinners always move by 1.
 * `commit` owns validation and history. Limits are read live because owners change them.
 */
export function installPlacementNumberStepper(input: HTMLInputElement, step: number, commit: () => void) {
  const nudge = (direction: 1 | -1, event: StepModifiers) => {
    if (input.disabled || !Number.isFinite(input.valueAsNumber)) return;
    const min = input.min === "" ? -Infinity : Number(input.min), max = input.max === "" ? Infinity : Number(input.max);
    const next = input.valueAsNumber + direction * step * numberStepScale(event);
    input.value = String(Number(Math.max(min, Math.min(max, next)).toFixed(6)));
    commit();
  };
  input.addEventListener("keydown", event => {
    if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return;
    event.preventDefault(); event.stopPropagation();
    nudge(event.code === "ArrowUp" ? 1 : -1, event);
  });
  const control = document.createElement("span"), stepper = document.createElement("span");
  control.className = "placement-number-control";
  stepper.className = "placement-number-stepper";
  for (const [direction, id, label] of [[1, "up", "Increase value"], [-1, "down", "Decrease value"]] as const) {
    const button = document.createElement("button");
    button.type = "button"; button.tabIndex = -1; button.dataset.placementNumberStep = id;
    setUiAttribute(button, "aria-label", label);
    // The row is a label; stepping must not also move focus into the input.
    button.addEventListener("click", event => { event.preventDefault(); nudge(direction, event); });
    stepper.append(button);
  }
  input.before(control);
  control.append(input, stepper);
}
