import type {
  ResolvedPostProcessColor,
  ResolvedPostProcessPass,
  ScreenFadeTransitionSnapshot,
  ScreenFadeTransitionSpec,
} from "./types.js";
import { DEFAULT_FADE_COLOR } from "./postProcess.js";
import {
  clamp,
  invalid,
  isRecord,
  lerp,
  nonNegativeFinite,
  nonNegativeNumber,
  resolveColor,
  unitNumber,
} from "./validation.js";

type ResolvedScreenFadeTransitionSpec = Required<
  Pick<ScreenFadeTransitionSpec, "durationSeconds" | "fromOpacity" | "toOpacity">
> & { color: ResolvedPostProcessColor };

export class ScreenFadeTransition {
  private spec: ResolvedScreenFadeTransitionSpec;
  private elapsedSeconds = 0;

  constructor(spec: ScreenFadeTransitionSpec = {}) {
    this.spec = resolveScreenFadeTransitionSpec(spec);
  }

  static create(spec: ScreenFadeTransitionSpec = {}): ScreenFadeTransition {
    return new ScreenFadeTransition(spec);
  }

  reset(spec?: ScreenFadeTransitionSpec): ScreenFadeTransitionSnapshot {
    if (spec !== undefined) {
      this.spec = resolveScreenFadeTransitionSpec(spec);
    }
    this.elapsedSeconds = 0;
    return this.snapshot();
  }

  update(deltaSeconds: number): ScreenFadeTransitionSnapshot {
    this.elapsedSeconds = Math.min(
      this.spec.durationSeconds,
      this.elapsedSeconds + nonNegativeFinite(deltaSeconds, "screen fade deltaSeconds"),
    );
    return this.snapshot();
  }

  finish(): ScreenFadeTransitionSnapshot {
    this.elapsedSeconds = this.spec.durationSeconds;
    return this.snapshot();
  }

  postProcessPasses(): readonly ResolvedPostProcessPass[] {
    const snapshot = this.snapshot();
    if (snapshot.opacity <= 0) {
      return [];
    }
    return [{ kind: "fade", color: snapshot.color }];
  }

  snapshot(): ScreenFadeTransitionSnapshot {
    const progress = this.spec.durationSeconds <= 0
      ? 1
      : clamp(this.elapsedSeconds / this.spec.durationSeconds, 0, 1);
    const opacity = lerp(this.spec.fromOpacity, this.spec.toOpacity, progress);
    const color: ResolvedPostProcessColor = [
      this.spec.color[0],
      this.spec.color[1],
      this.spec.color[2],
      opacity,
    ];
    return {
      active: progress < 1,
      elapsedSeconds: this.elapsedSeconds,
      durationSeconds: this.spec.durationSeconds,
      progress,
      opacity,
      color,
    };
  }
}

function resolveScreenFadeTransitionSpec(spec: ScreenFadeTransitionSpec): ResolvedScreenFadeTransitionSpec {
  if (!isRecord(spec)) {
    throw invalid("screenFade", "must be an object");
  }
  const input = spec as ScreenFadeTransitionSpec;
  const color = resolveColor(input.color ?? DEFAULT_FADE_COLOR, "screenFade.color");
  return {
    durationSeconds: nonNegativeNumber(input.durationSeconds, "screenFade.durationSeconds", 1),
    fromOpacity: unitNumber(input.fromOpacity, "screenFade.fromOpacity", 1),
    toOpacity: unitNumber(input.toOpacity, "screenFade.toOpacity", 0),
    color,
  };
}
