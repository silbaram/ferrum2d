import type { InputSnapshot } from "./inputManager.js";

export type InputDigitalControl = "w" | "a" | "s" | "d" | "space" | "enter" | "mouseLeft";

export interface InputActionBinding {
  control?: InputDigitalControl;
  virtualButton?: string;
}

export interface InputAxisBinding {
  negative: string;
  positive: string;
}

export interface InputActionProfile {
  actions: Record<string, readonly InputActionBinding[]>;
  axes?: Record<string, InputAxisBinding>;
}

export interface ResolveInputActionStateOptions {
  virtualButtons?: Record<string, boolean>;
  path?: string;
}

export interface InputActionState {
  actions: Record<string, boolean>;
  axes: Record<string, number>;
  pressedActions: readonly string[];
}

const DIGITAL_CONTROLS: readonly InputDigitalControl[] = ["w", "a", "s", "d", "space", "enter", "mouseLeft"];

export const DEFAULT_INPUT_ACTION_PROFILE: InputActionProfile = {
  actions: {
    moveUp: [{ control: "w" }],
    moveLeft: [{ control: "a" }],
    moveDown: [{ control: "s" }],
    moveRight: [{ control: "d" }],
    primary: [{ control: "space" }, { control: "mouseLeft" }, { virtualButton: "primary" }],
    menu: [{ control: "enter" }, { virtualButton: "menu" }],
  },
  axes: {
    moveX: { negative: "moveLeft", positive: "moveRight" },
    moveY: { negative: "moveUp", positive: "moveDown" },
  },
};

export const TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE: InputActionProfile = {
  actions: {
    moveUp: [{ control: "w" }],
    moveLeft: [{ control: "a" }],
    moveDown: [{ control: "s" }],
    moveRight: [{ control: "d" }],
    fire: [{ control: "space" }, { control: "mouseLeft" }, { virtualButton: "primary" }],
    primary: [{ control: "space" }, { control: "mouseLeft" }, { virtualButton: "primary" }],
    menu: [{ control: "enter" }, { virtualButton: "menu" }],
    start: [{ control: "enter" }, { virtualButton: "menu" }],
  },
  axes: {
    moveX: { negative: "moveLeft", positive: "moveRight" },
    moveY: { negative: "moveUp", positive: "moveDown" },
  },
};

export const PLATFORMER_INPUT_ACTION_PROFILE: InputActionProfile = {
  actions: {
    moveLeft: [{ control: "a" }],
    moveRight: [{ control: "d" }],
    jump: [{ control: "space" }, { virtualButton: "primary" }],
    primary: [{ control: "space" }, { virtualButton: "primary" }],
    menu: [{ control: "enter" }, { virtualButton: "menu" }],
    start: [{ control: "enter" }, { virtualButton: "menu" }],
  },
  axes: {
    moveX: { negative: "moveLeft", positive: "moveRight" },
  },
};

export const BREAKOUT_INPUT_ACTION_PROFILE: InputActionProfile = {
  actions: {
    moveLeft: [{ control: "a" }],
    moveRight: [{ control: "d" }],
    launch: [{ control: "space" }, { control: "mouseLeft" }, { virtualButton: "primary" }],
    primary: [{ control: "space" }, { control: "mouseLeft" }, { virtualButton: "primary" }],
    menu: [{ control: "enter" }, { virtualButton: "menu" }],
    start: [{ control: "enter" }, { virtualButton: "menu" }],
  },
  axes: {
    paddleX: { negative: "moveLeft", positive: "moveRight" },
  },
};

export const INPUT_ACTION_PROFILES = {
  default: DEFAULT_INPUT_ACTION_PROFILE,
  topdownShooter: TOPDOWN_SHOOTER_INPUT_ACTION_PROFILE,
  platformer: PLATFORMER_INPUT_ACTION_PROFILE,
  breakout: BREAKOUT_INPUT_ACTION_PROFILE,
} satisfies Record<string, InputActionProfile>;

export type InputActionProfileId = keyof typeof INPUT_ACTION_PROFILES;

export function resolveInputActionState(
  input: InputSnapshot,
  profile: InputActionProfile = DEFAULT_INPUT_ACTION_PROFILE,
  options: ResolveInputActionStateOptions = {},
): InputActionState {
  const path = options.path ?? "input.profile";
  const actions = resolveActions(input, profile, options.virtualButtons ?? {}, path);
  const axes = resolveAxes(actions, profile.axes ?? {}, path);
  return {
    actions,
    axes,
    pressedActions: Object.entries(actions)
      .filter(([, pressed]) => pressed)
      .map(([action]) => action),
  };
}

function resolveActions(
  input: InputSnapshot,
  profile: InputActionProfile,
  virtualButtons: Record<string, boolean>,
  path: string,
): Record<string, boolean> {
  if (!isRecord(profile.actions)) {
    throw new Error(`${path}.actions must be an object.`);
  }
  return Object.fromEntries(
    Object.entries(profile.actions).map(([action, bindings]) => {
      if (action.trim().length === 0) {
        throw new Error(`${path}.actions must not contain an empty action id.`);
      }
      if (!Array.isArray(bindings)) {
        throw new Error(`${path}.actions.${action} must be an array.`);
      }
      return [action, bindings.some((binding, index) =>
        isBindingPressed(input, virtualButtons, binding, `${path}.actions.${action}.${index}`)
      )];
    }),
  );
}

function resolveAxes(
  actions: Record<string, boolean>,
  axes: Record<string, InputAxisBinding>,
  path: string,
): Record<string, number> {
  if (!isRecord(axes)) {
    throw new Error(`${path}.axes must be an object.`);
  }
  return Object.fromEntries(
    Object.entries(axes).map(([axis, binding]) => {
      if (!isRecord(binding)) {
        throw new Error(`${path}.axes.${axis} must be an object.`);
      }
      const negative = actionId(binding.negative, `${path}.axes.${axis}.negative`, actions);
      const positive = actionId(binding.positive, `${path}.axes.${axis}.positive`, actions);
      const value = (actions[positive] ? 1 : 0) - (actions[negative] ? 1 : 0);
      return [axis, value];
    }),
  );
}

function isBindingPressed(
  input: InputSnapshot,
  virtualButtons: Record<string, boolean>,
  binding: InputActionBinding,
  path: string,
): boolean {
  if (!isRecord(binding)) {
    throw new Error(`${path} must be an object.`);
  }
  const hasControl = binding.control !== undefined;
  const hasVirtualButton = binding.virtualButton !== undefined;
  if (hasControl === hasVirtualButton) {
    throw new Error(`${path} must define exactly one of control or virtualButton.`);
  }
  if (hasControl) {
    const control = digitalControl(binding.control, `${path}.control`);
    return input[control];
  }
  const virtualButton = stringId(binding.virtualButton, `${path}.virtualButton`);
  return virtualButtons[virtualButton] === true;
}

function digitalControl(value: unknown, path: string): InputDigitalControl {
  if (typeof value !== "string" || !DIGITAL_CONTROLS.includes(value as InputDigitalControl)) {
    throw new Error(`${path} must be one of ${DIGITAL_CONTROLS.join(", ")}.`);
  }
  return value as InputDigitalControl;
}

function actionId(value: unknown, path: string, actions: Record<string, boolean>): string {
  const id = stringId(value, path);
  if (!hasOwnKey(actions, id)) {
    throw new Error(`${path} references unknown action '${id}'.`);
  }
  return id;
}

function stringId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwnKey(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}
