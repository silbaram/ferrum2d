import { gameplayAuthoringDiagnosticError } from "./diagnostics.js";

export const MAX_GAMEPLAY_FACTION_ID = 31;
export const GAMEPLAY_FACTION_ID_RANGE_LABEL = `0..${MAX_GAMEPLAY_FACTION_ID}`;
export const GAMEPLAY_FACTION_CODES = Object.freeze({
  neutral: 0,
  player: 1,
  enemy: 2,
} as const);
export const GAMEPLAY_FACTION_RELATION_CODES = Object.freeze({
  neutral: 0,
  friendly: 1,
  hostile: 2,
} as const);

export type GameplayFactionName = keyof typeof GAMEPLAY_FACTION_CODES;
export type GameplayFactionReference = GameplayFactionName | number;
export type FactionRelation = keyof typeof GAMEPLAY_FACTION_RELATION_CODES;

export interface FactionRelationEntrySpec {
  source: GameplayFactionReference;
  target: GameplayFactionReference;
  relation: FactionRelation;
}

export interface FactionRelationTableSpec {
  defaultRelation?: FactionRelation;
  relations: readonly FactionRelationEntrySpec[];
}

interface ResolvedFactionRelationEntrySpec {
  source: number;
  target: number;
  relation: FactionRelation;
  relationCode: number;
}

export interface ApplyFactionRelationTableOptions {
  path?: string;
}

export interface ApplyFactionRelationTableResult {
  applied: true;
  defaultRelation: FactionRelation;
  relationCount: number;
}

export interface FactionRelationRuntimeEngine {
  clear_gameplay_faction_relations(): void;
  set_gameplay_faction_default_relation(relationCode: number): boolean;
  set_gameplay_faction_relation(sourceFactionId: number, targetFactionId: number, relationCode: number): boolean;
}

export function applyFactionRelationTable(
  engine: FactionRelationRuntimeEngine,
  table: FactionRelationTableSpec,
  options: ApplyFactionRelationTableOptions = {},
): ApplyFactionRelationTableResult {
  const path = options.path ?? "factionRelationTable";
  if (engine === null || typeof engine !== "object") {
    throw gameplayAuthoringDiagnosticError(`${path}.engine`, "must be a faction relation runtime engine");
  }
  if (!isRecord(table)) {
    throw gameplayAuthoringDiagnosticError(path, "must be an object");
  }
  if (!Array.isArray(table.relations)) {
    throw gameplayAuthoringDiagnosticError(`${path}.relations`, "must be an array");
  }
  const defaultRelation = factionRelationValue(table.defaultRelation ?? "neutral", `${path}.defaultRelation`);
  const relationEntries = table.relations.map((rawEntry, index): ResolvedFactionRelationEntrySpec => {
    const entryPath = `${path}.relations.${index}`;
    if (!isRecord(rawEntry)) {
      throw gameplayAuthoringDiagnosticError(entryPath, "must be an object");
    }
    const entry = factionRelationEntrySpec(rawEntry, entryPath);
    return {
      ...entry,
      relationCode: factionRelationCode(entry.relation),
    };
  });

  engine.clear_gameplay_faction_relations();
  if (!engine.set_gameplay_faction_default_relation(factionRelationCode(defaultRelation))) {
    throw gameplayAuthoringDiagnosticError(`${path}.defaultRelation`, `runtime rejected default relation '${defaultRelation}'`);
  }

  relationEntries.forEach((entry, index) => {
    const entryPath = `${path}.relations.${index}`;
    const applied = engine.set_gameplay_faction_relation(entry.source, entry.target, entry.relationCode);
    if (!applied) {
      throw gameplayAuthoringDiagnosticError(entryPath, `runtime rejected relation '${entry.source}' -> '${entry.target}'`);
    }
  });

  return {
    applied: true,
    defaultRelation,
    relationCount: relationEntries.length,
  };
}

export function gameplayFactionCode(faction: GameplayFactionReference, path: string): number {
  if (typeof faction === "number" && Number.isInteger(faction) && faction >= 0 && faction <= MAX_GAMEPLAY_FACTION_ID) {
    return faction;
  }
  if (typeof faction === "string") {
    const code = GAMEPLAY_FACTION_CODES[faction];
    if (code !== undefined) return code;
  }
  throw gameplayAuthoringDiagnosticError(
    path,
    `must be one of neutral, player, enemy, or an integer faction id between ${GAMEPLAY_FACTION_ID_RANGE_LABEL}`,
  );
}

export function gameplayFactionMask(factions: readonly GameplayFactionReference[], path: string): number {
  let mask = 0;
  for (let index = 0; index < factions.length; index += 1) {
    mask |= 1 << gameplayFactionCode(factions[index]!, `${path}.${index}`);
  }
  return mask >>> 0;
}

function factionRelationEntrySpec(value: Record<string, unknown>, path: string): Omit<ResolvedFactionRelationEntrySpec, "relationCode"> {
  const source = gameplayFactionCode(value.source as GameplayFactionReference, `${path}.source`);
  const target = gameplayFactionCode(value.target as GameplayFactionReference, `${path}.target`);
  return {
    source,
    target,
    relation: factionRelationValue(value.relation, `${path}.relation`),
  };
}

function factionRelationValue(value: unknown, path: string): FactionRelation {
  if (typeof value === "string" && GAMEPLAY_FACTION_RELATION_CODES[value as FactionRelation] !== undefined) {
    return value as FactionRelation;
  }
  throw gameplayAuthoringDiagnosticError(path, "must be one of neutral, friendly, or hostile");
}

function factionRelationCode(relation: FactionRelation): number {
  return GAMEPLAY_FACTION_RELATION_CODES[relation];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
