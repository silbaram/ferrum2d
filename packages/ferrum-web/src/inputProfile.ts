import type { InputSnapshot } from "./inputManager.js";

export type InputDigitalControl = "w" | "a" | "s" | "d" | "space" | "enter" | "mouseLeft";

export interface InputActionBinding {
  control?: InputDigitalControl;
  virtualButton?: string;
  /** Physical KeyboardEvent.code, independent of the keyboard layout. */
  code?: string;
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
  /** Currently held physical keyboard codes, supplied by the platform. */
  keys?: ReadonlySet<string>;
  path?: string;
}

export interface InputActionState {
  actions: Record<string, boolean>;
  axes: Record<string, number>;
  pressedActions: readonly string[];
}

export const INPUT_DIGITAL_CONTROLS: readonly InputDigitalControl[] = ["w", "a", "s", "d", "space", "enter", "mouseLeft"];

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
  return evaluateInputActionState(input, resolveInputActionProfile(profile, options.path), options);
}

/** Validate every binding before evaluating input; the returned profile owns its data. */
export function resolveInputActionProfile(
  profile: InputActionProfile,
  path = "input.profile",
): InputActionProfile {
  if (!isRecord(profile) || !isRecord(profile.actions)) {
    throw new Error(`${path}.actions must be an object.`);
  }
  const actions = Object.fromEntries(Object.entries(profile.actions).map(([action, bindings]) => {
    stringId(action, `${path}.actions key`);
    if (!Array.isArray(bindings)) throw new Error(`${path}.actions.${action} must be an array.`);
    return [action, Array.from(bindings, (binding, index) => {
      const at = `${path}.actions.${action}.${index}`;
      if (!isRecord(binding)) throw new Error(`${at} must be an object.`);
      if ([binding.control, binding.virtualButton, binding.code].filter((value) => value !== undefined).length !== 1) {
        throw new Error(`${at} must define exactly one of control, virtualButton or code.`);
      }
      if (binding.control !== undefined) return { control: digitalControl(binding.control, `${at}.control`) };
      if (binding.code !== undefined) return { code: keyboardCode(binding.code, `${at}.code`) };
      return { virtualButton: stringId(binding.virtualButton, `${at}.virtualButton`) };
    })];
  }));
  const rawAxes = profile.axes ?? {};
  if (!isRecord(rawAxes)) throw new Error(`${path}.axes must be an object.`);
  const axes = Object.fromEntries(Object.entries(rawAxes).map(([axis, binding]) => {
    stringId(axis, `${path}.axes key`);
    if (!isRecord(binding)) throw new Error(`${path}.axes.${axis} must be an object.`);
    return [axis, {
      negative: actionId(binding.negative, `${path}.axes.${axis}.negative`, actions),
      positive: actionId(binding.positive, `${path}.axes.${axis}.positive`, actions),
    }];
  }));
  return { actions, axes };
}

// Internal evaluator: InputManager validates and copies its profile once at construction.
export function evaluateInputActionState(
  input: InputSnapshot,
  profile: InputActionProfile,
  options: ResolveInputActionStateOptions = {},
): InputActionState {
  const actions = Object.fromEntries(Object.entries(profile.actions).map(([action, bindings]) => [
    action, bindings.some((binding) => binding.control !== undefined
      ? input[binding.control]
      : binding.code !== undefined ? options.keys?.has(binding.code) === true
        : binding.virtualButton !== undefined && Object.prototype.hasOwnProperty.call(options.virtualButtons ?? {}, binding.virtualButton)
          && options.virtualButtons?.[binding.virtualButton] === true),
  ]));
  const axes = Object.fromEntries(Object.entries(profile.axes ?? {}).map(([axis, binding]) => [
    axis, (actions[binding.positive] ? 1 : 0) - (actions[binding.negative] ? 1 : 0),
  ]));
  return {
    actions,
    axes,
    pressedActions: Object.entries(actions)
      .filter(([, pressed]) => pressed)
      .map(([action]) => action),
  };
}

function digitalControl(value: unknown, path: string): InputDigitalControl {
  if (typeof value !== "string" || !INPUT_DIGITAL_CONTROLS.includes(value as InputDigitalControl)) {
    throw new Error(`${path} must be one of ${INPUT_DIGITAL_CONTROLS.join(", ")}.`);
  }
  return value as InputDigitalControl;
}

function actionId(value: unknown, path: string, actions: object): string {
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

function hasOwnKey(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function keyboardCode(value: unknown, path: string): string {
  // KeyboardEvent.code is an extensible platform string; reject blanks/whitespace, not future codes.
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(value) || value === "Unidentified") {
    throw new Error(`${path} must be a non-empty KeyboardEvent.code.`);
  }
  return value;
}
