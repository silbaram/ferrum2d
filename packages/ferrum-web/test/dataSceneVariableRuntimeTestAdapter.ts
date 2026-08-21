import {
  attachDataSceneVariableRuntimeEngineAdapter,
  type DataSceneVariableRuntimeEngineAdapter,
  type DataSceneVariableScope,
  type DataSceneVariableType,
  type DataSceneVariableValue,
} from "../src/dataSceneVariables.js";
import type { FerrumEngine } from "../src/engineTypes.js";

export function attachMemoryDataSceneVariableRuntime(engine: FerrumEngine): FerrumEngine {
  return attachDataSceneVariableRuntimeEngineAdapter(engine, new MemoryDataSceneVariableRuntimeAdapter());
}

class MemoryDataSceneVariableRuntimeAdapter implements DataSceneVariableRuntimeEngineAdapter {
  private readonly values = new Map<number, number>();

  clear(): void {
    this.values.clear();
  }

  configure(
    slot: number,
    _type: DataSceneVariableType,
    _scope: DataSceneVariableScope,
    _defaultValue: DataSceneVariableValue,
    value: DataSceneVariableValue,
  ): boolean {
    this.values.set(slot, typeof value === "boolean" ? Number(value) : value);
    return true;
  }

  get(slot: number): number {
    return this.values.get(slot) ?? Number.NaN;
  }

  set(slot: number, value: DataSceneVariableValue): boolean {
    if (!this.values.has(slot)) {
      return false;
    }
    this.values.set(slot, typeof value === "boolean" ? Number(value) : value);
    return true;
  }
}
