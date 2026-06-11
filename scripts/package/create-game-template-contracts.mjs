export const ASSET_PIPELINE_VALIDATION_PUBLIC_ENTRYPOINTS = Object.freeze([
  "@ferrum2d/ferrum-web/core",
  "@ferrum2d/ferrum-web/authoring",
  "@ferrum2d/ferrum-web/starter-scenes",
  "@ferrum2d/ferrum-web/labs",
]);

export function missingExpectedPublicEntryPoints(publicEntryPoints, expected = ASSET_PIPELINE_VALIDATION_PUBLIC_ENTRYPOINTS) {
  if (!Array.isArray(publicEntryPoints)) {
    return [...expected];
  }
  return expected.filter((entryPoint) => !publicEntryPoints.includes(entryPoint));
}

export function extractModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.add(match[1]);
    }
  }
  return specifiers;
}

export function hasModuleSpecifier(source, specifier) {
  return extractModuleSpecifiers(source).has(specifier);
}
