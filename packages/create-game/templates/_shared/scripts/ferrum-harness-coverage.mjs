export const HARNESS_REPLAY_COVERAGE_TAGS_FORMAT = "ferrum2d.consumer.gameplay-replay.coverage-tags";
export const HARNESS_REPLAY_COVERAGE_TAGS_VERSION = 1;

export function assertCoverageTagDefinitions(definitions, label) {
  if (definitions === null || typeof definitions !== "object" || Array.isArray(definitions)) throw new Error(`${label} must be an object.`);
  const entries = Object.entries(definitions);
  if (entries.length === 0) throw new Error(`${label} must not be empty.`);
  for (const [tag, description] of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) throw new Error(`${label}.${tag} key must be kebab-case.`);
    if (typeof description !== "string" || description.length === 0) throw new Error(`${label}.${tag} must be a non-empty string.`);
  }
}

export function assertCoverageTagGroups(groups, label, definitions) {
  if (groups === null || typeof groups !== "object" || Array.isArray(groups)) throw new Error(`${label} must be an object.`);
  const entries = Object.entries(groups);
  if (entries.length === 0) throw new Error(`${label} must not be empty.`);
  const groupedTags = new Set();
  for (const [group, spec] of entries) {
    const groupLabel = `${label}.${group}`;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group)) throw new Error(`${groupLabel} key must be kebab-case.`);
    if (spec === null || typeof spec !== "object" || Array.isArray(spec)) throw new Error(`${groupLabel} must be an object.`);
    if (typeof spec.description !== "string" || spec.description.length === 0) throw new Error(`${groupLabel}.description must be a non-empty string.`);
    assertCoverageTags(spec.tags, definitions, undefined, `${groupLabel}.tags`, { requireAllDefinitions: false });
    for (const tag of spec.tags) groupedTags.add(tag);
  }
  for (const tag of Object.keys(definitions)) {
    if (!groupedTags.has(tag)) throw new Error(`${label} must include active coverage tag '${tag}' in at least one group.`);
  }
}

export function assertDeprecatedCoverageTags(deprecatedTags, label, definitions) {
  if (deprecatedTags === null || typeof deprecatedTags !== "object" || Array.isArray(deprecatedTags)) throw new Error(`${label} must be an object.`);
  for (const [tag, description] of Object.entries(deprecatedTags)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) throw new Error(`${label}.${tag} key must be kebab-case.`);
    if (definitions[tag] !== undefined) throw new Error(`${label}.${tag} must not also be an active coverage tag.`);
    if (typeof description !== "string" || description.length === 0) throw new Error(`${label}.${tag} must be a non-empty string.`);
  }
}

export function assertCoverageTags(tags, definitions, deprecatedTags, label, options = {}) {
  if (!Array.isArray(tags) || tags.length === 0) throw new Error(`${label} must be a non-empty array.`);
  const seen = new Set();
  for (const [index, tag] of tags.entries()) {
    if (typeof tag !== "string" || tag.length === 0) throw new Error(`${label}[${index}] must be a non-empty string.`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag)) throw new Error(`${label}[${index}] must be kebab-case.`);
    if (seen.has(tag)) throw new Error(`${label}[${index}] must be unique.`);
    seen.add(tag);
    if (definitions[tag] === undefined) throw new Error(`${label}[${index}] must reference defined coverage tag '${tag}'.`);
    if (deprecatedTags?.[tag] !== undefined) throw new Error(`${label}[${index}] must not use deprecated coverage tag '${tag}'.`);
  }
  if (options.requireAllDefinitions !== false) {
    for (const tag of Object.keys(definitions)) {
      if (!seen.has(tag)) throw new Error(`${label} must use defined coverage tag '${tag}'.`);
    }
  }
}
