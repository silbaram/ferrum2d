import type { ChoiceOptions, Control, ExampleControls, SliderOptions, ToggleOptions } from "./example";
import { icon } from "./icons";
import { el, uiAttribute, uiText, type LocalizedText } from "./locale";
import { frameText } from "./messages";

/** Inspector setting rows (Pixelforge field rows): a 76px name and one control. */

let counter = 0;
const uid = (prefix: string) => `${prefix}-${++counter}`;

/** Decimal places that a step needs, so 0.05 shows as 1.25 and not 1.2500000001. */
const decimals = (step: number) => (String(step).split(".")[1] ?? "").length;

export function createControls(rows: HTMLElement, signal: AbortSignal): ExampleControls {
  const row = (label: LocalizedText, id?: string) => {
    const node = el("div", "field");
    const name = el(id ? "label" : "span", "field-k", label);
    if (id && name instanceof HTMLLabelElement) name.htmlFor = id;
    const value = el("div", "field-v");
    node.append(name, value);
    rows.append(node);
    return { node, name, value };
  };

  return {
    slider(options: SliderOptions): Control<number> {
      const id = uid("slider");
      const { value } = row(options.label, id);
      const range = el("input", "range"); range.type = "range"; range.id = id;
      const number = el("input", "num"); number.type = "number";
      uiAttribute(number, "aria-label", frameText.numberValue(options.label));
      for (const input of [range, number]) {
        input.min = String(options.min); input.max = String(options.max); input.step = String(options.step);
      }
      const places = decimals(options.step);
      const show = (next: number) => {
        range.value = String(next);
        number.value = next.toFixed(places);
        range.style.setProperty("--fill", `${((next - options.min) / (options.max - options.min)) * 100}%`);
      };
      const clamp = (next: number) => Math.min(options.max, Math.max(options.min, next));
      range.addEventListener("input", () => { const next = Number(range.value); show(next); options.onInput(next); }, { signal });
      number.addEventListener("change", () => {
        const next = Number.isFinite(number.valueAsNumber) ? clamp(number.valueAsNumber) : Number(range.value);
        show(next); options.onInput(next);
      }, { signal });
      // The unit slot is always there so number fields line up across rows.
      value.append(range, number, el("span", "unit", options.unit ?? ""));
      show(options.value);
      return { set: show };
    },

    choice(options: ChoiceOptions): Control<string> {
      const { value, name } = row(options.label);
      const group = el("div", "seg"); group.setAttribute("role", "group");
      name.id = uid("choice"); group.setAttribute("aria-labelledby", name.id);
      const buttons = options.options.map(option => {
        const button = el("button", option.color ? "seg-b swatch" : "seg-b"); button.type = "button";
        button.dataset.value = option.value;
        if (option.color) {
          const chip = el("span", "chip"); chip.style.background = option.color;
          button.append(chip, el("span", "sr-only", option.text));
          uiAttribute(button, "title", option.text);
        } else button.append(uiText(option.text));
        button.addEventListener("click", () => { show(option.value); options.onChange(option.value); }, { signal });
        return button;
      });
      const show = (next: string) => { for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.value === next)); };
      group.append(...buttons);
      value.append(group);
      show(options.value);
      return { set: show };
    },

    toggle(options: ToggleOptions): Control<boolean> {
      const id = uid("toggle");
      const { value } = row(options.label, id);
      const button = el("button", "switch"); button.type = "button"; button.id = id;
      button.setAttribute("role", "switch");
      const show = (next: boolean) => button.setAttribute("aria-checked", String(next));
      button.addEventListener("click", () => { const next = button.getAttribute("aria-checked") !== "true"; show(next); options.onChange(next); }, { signal });
      value.append(button);
      show(options.value);
      return { set: show };
    },

    hint(text: LocalizedText): void {
      const hint = el("p", "field-hint"); hint.append(icon("mouse-pointer-click"), el("span", undefined, text));
      rows.append(hint);
    },
  };
}
