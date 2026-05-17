export type DiagnosticKind = "texture" | "sound" | "json" | "game-spec";
export type AssetDiagnosticKind = "texture" | "sound" | "json";

export interface DiagnosticContext {
  kind: DiagnosticKind;
  name?: string;
  url?: string;
  id?: number;
  path?: string;
  detail: string;
}

export function describeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }
  return String(error);
}

export function diagnosticMessage(prefix: string, context: DiagnosticContext): string {
  const parts = [`kind=${context.kind}`];
  if (context.name !== undefined) {
    parts.push(`name=${quote(context.name)}`);
  }
  if (context.id !== undefined) {
    parts.push(`id=${context.id}`);
  }
  if (context.url !== undefined) {
    parts.push(`url=${quote(context.url)}`);
  }
  if (context.path !== undefined) {
    parts.push(`path=${quote(context.path)}`);
  }
  parts.push(`detail=${quote(context.detail)}`);
  return `${prefix}: ${parts.join(" ")}.`;
}

export function diagnosticError(prefix: string, context: DiagnosticContext): Error {
  return new Error(diagnosticMessage(prefix, context));
}

export function assetLoadError(context: DiagnosticContext & { kind: AssetDiagnosticKind }): Error {
  return diagnosticError("Asset load error", context);
}

export function assetLookupError(context: DiagnosticContext & { kind: "texture" | "sound" }): Error {
  return diagnosticError("Asset lookup error", context);
}

export function audioLoadError(context: DiagnosticContext & { kind: "sound" }): Error {
  return diagnosticError("Audio load error", context);
}

export function audioDecodeError(context: DiagnosticContext & { kind: "sound" }): Error {
  return diagnosticError("Audio decode error", context);
}

export function audioPlaybackError(context: DiagnosticContext & { kind: "sound" }): Error {
  return diagnosticError("Audio playback error", context);
}

export function gameSpecDiagnosticError(path: string, detail: string): Error {
  return diagnosticError("Invalid shooter game spec", {
    kind: "game-spec",
    path,
    detail,
  });
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
