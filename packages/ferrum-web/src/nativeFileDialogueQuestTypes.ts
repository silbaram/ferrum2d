/** @internal Structural subset of the shared resource ledger; never reset here. */
export interface NativeFileDialogueQuestBudget {
    work(amount: number): void;
    metadata(value: string): void;
    charge(kind: "resources" | "sourceBytes" | "decodedBytes", amount: number): void;
}
export type NativeFileDialogueQuestErrorCode = "OWNER" | "CONTENT" | "REFERENCE" | "LIMIT" | "STALE" | "TOKEN" | "NATIVE";
export class NativeFileDialogueQuestError extends Error {
    constructor(readonly code: NativeFileDialogueQuestErrorCode, readonly field: string) {
        super(`Native-file dialogue/quest rejected (${code}: ${field})`);
        this.name = "NativeFileDialogueQuestError";
    }
}
export function fileDialogueQuestRequire(ok: unknown, code: NativeFileDialogueQuestErrorCode, field: string): asserts ok {
    if (!ok)
        throw new NativeFileDialogueQuestError(code, field);
}
/** Saved provenance is data only. It never initializes a new native revision. */
export interface NativeFileDialogueQuestOrigin {
    readonly revision: readonly [
        number,
        number
    ];
}
