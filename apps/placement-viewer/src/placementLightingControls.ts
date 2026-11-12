import type { SpatialEnvironmentSpec, SpatialLightingSpec } from "@ferrum2d/ferrum-web/core";
import type { LightingScene2D } from "@ferrum2d/ferrum-web/labs";

export type PlacementLightingDraft = {
  spatial: true;
  environment: SpatialEnvironmentSpec;
  light: SpatialLightingSpec;
  bindings: Record<string, readonly number[]>;
} | { spatial: false; light: LightingScene2D };

/** Shared inspector controls retain the host's validation, focus and history ownership. */
export interface PlacementLightingControls {
  number(parent: HTMLElement, label: string, name: string, min: number, max: number, step: number,
    read: (d: PlacementLightingDraft) => number, write: (d: PlacementLightingDraft, value: number) => void,
    visible?: (d: PlacementLightingDraft) => boolean, decimals?: number): HTMLInputElement;
  color(parent: HTMLElement, label: string, name: string, read: (d: PlacementLightingDraft) => readonly number[],
    write: (d: PlacementLightingDraft, rgb: [number, number, number]) => void,
    visible?: (d: PlacementLightingDraft) => boolean): HTMLInputElement;
  checkbox(label: string, name: string, run: (value: boolean) => void): { row: HTMLElement; input: HTMLInputElement };
  action(label: string, name: string, run: () => void): HTMLButtonElement;
  change(edit: (d: PlacementLightingDraft) => void): boolean;
}
