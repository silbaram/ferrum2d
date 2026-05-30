export function createHd2dFloorIds(
  floorSources: Iterable<Iterable<string>>,
): ReadonlyMap<string, number> {
  const floors = new Set<string>(["default"]);
  for (const source of floorSources) {
    for (const floor of source) {
      floors.add(floor);
    }
  }
  const floorIds = new Map<string, number>([["default", 0]]);
  for (const floor of [...floors].filter((id) => id !== "default").sort()) {
    floorIds.set(floor, floorIds.size);
  }
  return floorIds;
}
