export type DiagnosticKind = "texture" | "sound" | "json" | "game-spec" | "physics-spec" | "asset-pipeline";
export type AssetDiagnosticKind = "texture" | "sound" | "json";
export type DiagnosticCode =
  | "FERRUM_ASSET_LOAD"
  | "FERRUM_ASSET_LOOKUP"
  | "FERRUM_AUDIO_CONTEXT"
  | "FERRUM_AUDIO_DECODE"
  | "FERRUM_AUDIO_LOAD"
  | "FERRUM_AUDIO_PLAYBACK"
  | "FERRUM_ASSET_PIPELINE_INVALID"
  | "FERRUM_DIAGNOSTIC"
  | "FERRUM_GAME_SPEC_INVALID"
  | "FERRUM_PHYSICS_SPEC_INVALID"
  | "FERRUM_TEXTURE_CREATE"
  | "FERRUM_TEXTURE_DECODE"
  | "FERRUM_TEXTURE_LOAD"
  | "FERRUM_TEXTURE_LOOKUP"
  | "FERRUM_TEXTURE_REGISTRY";

export interface DiagnosticContext {
  kind: DiagnosticKind;
  name?: string;
  url?: string;
  id?: number;
  path?: string;
  detail: string;
}

export interface DiagnosticReport {
  code: DiagnosticCode | "FERRUM_UNKNOWN";
  message: string;
  context?: DiagnosticContext;
}

export class FerrumDiagnosticError extends Error {
  readonly code: DiagnosticCode;
  readonly context: DiagnosticContext;
  readonly prefix: string;

  constructor(code: DiagnosticCode, prefix: string, context: DiagnosticContext) {
    super(diagnosticMessage(prefix, context));
    this.name = "FerrumDiagnosticError";
    this.code = code;
    this.prefix = prefix;
    this.context = { ...context };
  }
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

export function diagnosticError(
  prefix: string,
  context: DiagnosticContext,
  code: DiagnosticCode = "FERRUM_DIAGNOSTIC",
): FerrumDiagnosticError {
  return new FerrumDiagnosticError(code, prefix, context);
}

export function isFerrumDiagnosticError(error: unknown): error is FerrumDiagnosticError {
  return error instanceof FerrumDiagnosticError;
}

export function diagnosticReport(error: unknown): DiagnosticReport {
  if (isFerrumDiagnosticError(error)) {
    return {
      code: error.code,
      message: error.message,
      context: { ...error.context },
    };
  }
  return {
    code: "FERRUM_UNKNOWN",
    message: describeError(error),
  };
}

export function formatDiagnosticReport(error: unknown): string {
  const report = diagnosticReport(error);
  if (report.code === "FERRUM_UNKNOWN") {
    return report.message;
  }
  return `${report.code}: ${report.message}`;
}

export function assetLoadError(context: DiagnosticContext & { kind: AssetDiagnosticKind }): FerrumDiagnosticError {
  return diagnosticError("Asset load error", context, "FERRUM_ASSET_LOAD");
}

export function assetLookupError(context: DiagnosticContext & { kind: "texture" | "sound" }): FerrumDiagnosticError {
  return diagnosticError("Asset lookup error", context, "FERRUM_ASSET_LOOKUP");
}

export function audioLoadError(context: DiagnosticContext & { kind: "sound" }): FerrumDiagnosticError {
  return diagnosticError("Audio load error", context, "FERRUM_AUDIO_LOAD");
}

export function audioDecodeError(context: DiagnosticContext & { kind: "sound" }): FerrumDiagnosticError {
  return diagnosticError("Audio decode error", context, "FERRUM_AUDIO_DECODE");
}

export function audioPlaybackError(context: DiagnosticContext & { kind: "sound" }): FerrumDiagnosticError {
  return diagnosticError("Audio playback error", context, "FERRUM_AUDIO_PLAYBACK");
}

export function gameSpecDiagnosticError(path: string, detail: string): FerrumDiagnosticError {
  return diagnosticError("Invalid shooter game spec", {
    kind: "game-spec",
    path,
    detail,
  }, "FERRUM_GAME_SPEC_INVALID");
}

export function physicsSpecDiagnosticError(path: string, detail: string): FerrumDiagnosticError {
  return diagnosticError("Invalid physics spec", {
    kind: "physics-spec",
    path,
    detail,
  }, "FERRUM_PHYSICS_SPEC_INVALID");
}

export function assetPipelineDiagnosticError(path: string, detail: string): FerrumDiagnosticError {
  return diagnosticError("Invalid asset pipeline metadata", {
    kind: "asset-pipeline",
    path,
    detail,
  }, "FERRUM_ASSET_PIPELINE_INVALID");
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
