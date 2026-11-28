import type { GroupId, SiteExample, SiteLink } from "./catalog";

/** One row of the example list: an example that runs here, or a tool that opens elsewhere. */
export type SiteEntry = { kind: "example"; item: SiteExample } | { kind: "tool"; item: SiteLink };

interface Group { readonly id: GroupId }

export function siteEntries(examples: readonly SiteExample[], tools: readonly SiteLink[]): SiteEntry[] {
  return [...examples.map(item => ({ kind: "example" as const, item })), ...tools.map(item => ({ kind: "tool" as const, item }))];
}

export const entryGroup = (entry: SiteEntry): GroupId => entry.kind === "tool" ? "tools" : entry.item.group;

/** The search box value as compared against titles and summaries. */
export const searchQuery = (value: string) => value.trim().toLowerCase();

/** A query matches the title or summary in either language, whichever language the page shows. */
export const entryMatches = ({ item }: SiteEntry, query: string) => !query || (["ko", "en"] as const).some(
  locale => `${item.title[locale]} ${item.summary[locale]}`.toLocaleLowerCase(locale).includes(query),
);

/** List rows per group: `items` counts the whole group, `shown` the matches. While searching, groups
 * without a match are left out; otherwise every group stays, empty ones included. */
export function treeGroups<G extends Group>(groups: readonly G[], entries: readonly SiteEntry[], query: string) {
  return groups.flatMap(group => {
    const items = entries.filter(entry => entryGroup(entry) === group.id);
    const shown = items.filter(entry => entryMatches(entry, query));
    return query && !shown.length ? [] : [{ group, items, shown }];
  });
}

/** Home page sections: only groups with a matching entry. Before any example lands, only tools show. */
export function homeGroups<G extends Group>(groups: readonly G[], entries: readonly SiteEntry[], query: string) {
  const hasExamples = entries.some(entry => entry.kind === "example");
  const shown = entries.filter(entry => entryMatches(entry, query));
  return groups.flatMap(group => {
    if (group.id !== "tools" && !hasExamples) return [];
    const items = shown.filter(entry => entryGroup(entry) === group.id);
    return items.length ? [{ group, items }] : [];
  });
}
