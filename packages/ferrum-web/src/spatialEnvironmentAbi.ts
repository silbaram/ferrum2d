/** Private wire contract shared by the compiler, bridge and renderer consumers.
 * Rust owns the matching table in spatial_scene/environment.rs; the native bridge
 * integration test checks all historical layouts independently of this table.
 */
const lengths = {
  1: 80, 2: 112, 3: 128, 4: 512, 5: 528, 6: 544, 7: 576, 8: 580,
  9: 584, 10: 592, 11: 600, 12: 608, 13: 616, 14: 632, 15: 700,
} as const;
export type SpatialEnvironmentVersion = keyof typeof lengths;

// Entries originate from the numeric literal keys above; allocate the inverse once.
const versions = new Map<number, SpatialEnvironmentVersion>(
  Object.entries(lengths).map(([version, length]) => [length, Number(version) as SpatialEnvironmentVersion]),
);
export function spatialEnvironmentVersion(length: number): SpatialEnvironmentVersion | undefined {
  return versions.get(length);
}
export function spatialEnvironmentLength(version: SpatialEnvironmentVersion): number {
  return lengths[version];
}
export function matchesSpatialEnvironmentLayout(version: unknown, length: number): version is SpatialEnvironmentVersion {
  return version !== undefined && spatialEnvironmentVersion(length) === version;
}
