export interface PlacementChangeLabel {
  /** Authored object id, when the change belongs to one. */
  object?: string;
  /** Dotted field below the object, or the whole path for document-level changes. */
  field: string;
  kind: "added" | "removed" | "changed";
}

export type PlacementChange = { path: string; before?: unknown; after?: unknown };
type Json = Record<string, unknown> | undefined;
export const escapePointer = (value: string) => value.replace(/~/g, "~0").replace(/\//g, "~1");
const child = (value: unknown, key: string): unknown =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
const unescapePointer = (segment: string) => segment.replace(/~1/g, "/").replace(/~0/g, "~");

/** Presentation only: names a JSON-pointer change by its object; the handoff keeps raw paths. */
export function describePlacementChange(path: string, before: unknown, after: unknown, beforeDocument: Json, afterDocument: Json): PlacementChangeLabel {
  const kind = before === undefined ? "added" : after === undefined ? "removed" : "changed";
  const segments = path.split("/").slice(1).map(unescapePointer);
  let object: string | undefined, rest = segments;
  if (segments[0] === "sceneComposition" && segments[1] === "fragments" && segments[3] === "instances" && /^\d+$/.test(segments[4] ?? "")) {
    // Compare walks both arrays by index; a removed instance only exists before.
    const owner = kind === "removed" && segments.length === 5 ? beforeDocument : afterDocument ?? beforeDocument;
    const instances = child(child(child(child(owner, "sceneComposition"), "fragments"), segments[2]), "instances");
    const id = child(Array.isArray(instances) ? instances[Number(segments[4])] : undefined, "id");
    if (typeof id === "string") { object = id; rest = segments.slice(5); }
  } else if (segments[0] === "spatial" && (segments[1] === "models" || segments[1] === "billboards") && segments[2]) {
    object = segments[2];
    rest = segments.slice(3);
  }
  if (object && rest[0] === "props" && rest[1] === "components") rest = rest.slice(2);
  return { object, field: rest.join("."), kind };
}

/** Structural diff into JSON-pointer changes; scene instances pair by id (see compareInstances). */
export function comparePlacementValues(
  before: unknown,
  after: unknown,
  path: string,
  result: PlacementChange[],
) {
  if (before === after) return;
  if (/^\/sceneComposition\/fragments\/[^/]+\/instances$/.test(path) && compareInstances(before, after, path, result)) return;
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    const left = before as Record<string, unknown>,
      right = after as Record<string, unknown>;
    for (const key of [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort())
      comparePlacementValues(left[key], right[key], path + "/" + escapePointer(key), result);
  } else result.push({ path, before, after });
}
/**
 * Pairs scene instances by id, so removing one does not report every later
 * instance as changed. Pointers use the after index, or the before index for a
 * removal. Arrays without unique string ids keep index comparison.
 */
function compareInstances(before: unknown, after: unknown, path: string, result: PlacementChange[]): boolean {
  const index = (value: unknown) => {
    if (!Array.isArray(value)) return undefined;
    const ids = new Map<string, number>();
    for (const [position, item] of value.entries()) {
      const id = item && typeof item === "object" ? (item as { id?: unknown }).id : undefined;
      if (typeof id !== "string" || ids.has(id)) return undefined;
      ids.set(id, position);
    }
    return ids;
  };
  const left = index(before), right = index(after);
  if (!left || !right) return false;
  const was = before as unknown[], now = after as unknown[];
  for (const [id, position] of left)
    if (!right.has(id)) result.push({ path: path + "/" + position, before: was[position], after: undefined });
  for (const [id, position] of right) {
    const previous = left.get(id);
    if (previous === undefined) result.push({ path: path + "/" + position, before: undefined, after: now[position] });
    else comparePlacementValues(was[previous], now[position], path + "/" + position, result);
  }
  return true;
}
