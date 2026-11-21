import type { FerrumEngine } from "../src/engineTypes.js";
import type { GameplayEntityHandle } from "../src/gameplayAuthoringTypes.js";
import { nativeFileEngineOwner } from "../src/nativeFileEngineOwner.js";
import { readNativeFileNativeFacts } from "../src/nativeFileNativeFacts.js";
import { ResourceBudget } from "../src/nativeFileResourceBudget.js";
const STRIDES = [20, 20, 8, 32, 16, 20, 20, 20, 16, 20, 12, 12, 68, 136];
export function factWords(...values: number[]): Uint8Array { const bytes = new Uint8Array(values.length * 4), v = new DataView(bytes.buffer); values.forEach((x, i) => v.setUint32(i * 4, x, true)); return bytes; }
/** Old immutable1724 Wasm has no NativePrepare encoder. This independent ctx20
 * packet records actual normal source getter/handle observations. Root's fresh
 * A-generated packet integration is a separate gate; never label this copyout. */
export function fixtureFacts(engine: FerrumEngine, live: readonly GameplayEntityHandle[] = [], options: {
    slots?: readonly {
        generation: number;
        alive: boolean;
    }[];
    rawStoredEpoch?: number;
    clips?: readonly number[];
    textures?: readonly number[];
    models?: readonly number[];
    continuity?: readonly Uint8Array[];
} = {}) {
    const native = nativeFileEngineOwner(engine).native, epoch = native.data_scene_epoch(), configuration = native.spatial_configuration_revision(), raw = native.spatial_terrain_revision();
    if (live.length === 0 && epoch === 0 && engine.entityCount() === 1)
        live = [{ entityId: native.built_in_shooter_player_entity_id(), entityGeneration: native.built_in_shooter_player_entity_generation() }];
    const slots = options.slots ?? Array.from({ length: live.reduce((n, h) => Math.max(n, h.entityId + 1), 0) }, (_, id) => { const h = live.find(v => v.entityId === id); return { generation: h?.entityGeneration ?? 0, alive: h !== undefined }; });
    const concat = (values: readonly Uint8Array[]) => { const out = new Uint8Array(values.reduce((n, v) => n + v.length, 0)); let at = 0; for (const row of values) {
        out.set(row, at);
        at += row.length;
    } return out; };
    const rows = [factWords(epoch ? 1 : 0, options.rawStoredEpoch ?? epoch, raw, configuration, epoch), new Uint8Array(0), concat(slots.map(v => factWords(v.generation, +v.alive))), concat(live.map(h => factWords(h.entityId, h.entityGeneration, 0, 1, 0, 0, 0, options.clips?.length ? 1 : 0))), concat(live.flatMap(h => (options.textures ?? []).map(id => factWords(h.entityId, h.entityGeneration, 0, id)))), concat(live.flatMap(h => (options.clips ?? []).map((id, i) => factWords(h.entityId, h.entityGeneration, i, id, i === 0 ? 1 : 0)))), concat(live.flatMap(h => (options.models ?? []).map(id => factWords(h.entityId, h.entityGeneration, 0, 0, id)))), new Uint8Array(0), ...(options.continuity ?? [new Uint8Array(0), new Uint8Array(0), new Uint8Array(0), new Uint8Array(0)]), new Uint8Array(0), new Uint8Array(136)];
    const length = 240 + rows.reduce((n, v) => n + v.length, 0), packet = new Uint8Array(length);
    packet.set(factWords(0x3150464e, 1, length, 14));
    let at = 240;
    rows.forEach((v, i) => { packet.set(factWords(i + 1, STRIDES[i], v.length / STRIDES[i], at), 16 + i * 16); packet.set(v, at); at += v.length; });
    return { facts: readNativeFileNativeFacts(packet, new ResourceBudget()), packet };
}
