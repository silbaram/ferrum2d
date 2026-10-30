import { gameplayAuthoringDiagnosticError } from './diagnostics.js';
/** Bounded UI provenance, never a behavior binding or simulation component. */
export function validateTileMapImportMetadata(value: unknown, path: string): void {
    const fail = (detail: string): never => { throw gameplayAuthoringDiagnosticError(path, detail); };
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return fail('tile map provenance must be an object');
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record))
        if (!['name', 'lineage', 'key', 'options', 'object', 'assetId', 'cell'].includes(key))
            fail('unknown tile map provenance field ' + key);
    for (const [key, max] of [['name', 48], ['lineage', 2048], ['key', 512]] as const)
        if (typeof record[key] !== 'string' || record[key].length < 1 || record[key].length > max)
            fail('invalid tile map ' + key);
    if (record.assetId !== undefined && (typeof record.assetId !== 'string' || record.assetId.length < 1 || record.assetId.length > 256))
        fail('invalid tile map assetId');
    for (const key of ['options', 'object'])
        if (record[key] !== undefined && (!record[key] || typeof record[key] !== 'object' || Array.isArray(record[key])))
            fail('invalid tile map ' + key);
    if (record.cell !== undefined) {
        const cell = record.cell;
        if (!cell || typeof cell !== 'object' || Array.isArray(cell)) fail('invalid tile map cell');
        const fields = cell as Record<string, unknown>;
        if (Object.keys(fields).some(key => !['layer', 'column', 'row'].includes(key)) ||
            typeof fields.layer !== 'string' || fields.layer.length < 1 || fields.layer.length > 512 ||
            ![fields.column, fields.row].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 256))
            fail('invalid tile map cell');
    }
    if (new TextEncoder().encode(JSON.stringify(record)).byteLength > 16384)
        fail('tile map provenance exceeds 16 KiB');
}

/** Only the same source cell/object may reuse a removed, saved map instance id. */
export function sameTileMapImportIdentity(left: unknown, right: unknown): boolean {
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    return ['name', 'lineage', 'key'].every(key => typeof a[key] === 'string' && a[key] !== '' && a[key] === b[key]);
}
