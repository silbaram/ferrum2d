import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const manifestPath = "docs/engine/public-api-surface.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const packageJson = JSON.parse(readFileSync("packages/ferrum-web/package.json", "utf8"));
const publicApiDoc = readFileSync("docs/engine/public-api.md", "utf8");
const createGamePackageCheck = readFileSync("scripts/package/check-create-game-package.mjs", "utf8");
const packageConsumerSmoke = readFileSync("tests/smoke/package-consumer-smoke.mjs", "utf8");

const allowedImportPaths = new Set(manifest.entrypoints.map((entrypoint) => entrypoint.importPath));
const forbiddenPrefixes = [
  "@ferrum2d/ferrum-web/dist/",
  "@ferrum2d/ferrum-web/pkg/",
  "@ferrum2d/ferrum-web/src/",
  "packages/ferrum-web/src/",
];
const ignoredConsumerDirectoryNames = new Set([
  ".git",
  "artifacts",
  "coverage",
  "dist",
  "dist-pages",
  "dist-test",
  "node_modules",
]);

const errors = [
  ...checkManifestShape(),
  ...checkPackageExports(),
  ...checkPublicApiDoc(),
  ...checkSourceExports(),
  ...checkConsumerImports(),
  ...checkExistingPackageGuards(),
];

if (errors.length > 0) {
  console.error("public API surface check failed");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  entrypoints: manifest.entrypoints.map((entrypoint) => ({
    exportPath: entrypoint.exportPath,
    tier: entrypoint.tier,
    exportedNames: exportedNamesFromSource(entrypoint.source).length,
  })),
  scannedConsumerFiles: collectConsumerFiles().length,
}, null, 2));

function checkManifestShape() {
  const errors = [];
  if (manifest.format !== "ferrum2d.public-api.surface") {
    errors.push(`${manifestPath} format must be ferrum2d.public-api.surface.`);
  }
  if (manifest.version !== 1) {
    errors.push(`${manifestPath} version must be 1.`);
  }
  if (manifest.packageName !== "@ferrum2d/ferrum-web") {
    errors.push(`${manifestPath} packageName must be @ferrum2d/ferrum-web.`);
  }
  const tiers = new Set(["stable", "preview", "compatibility"]);
  for (const entrypoint of manifest.entrypoints ?? []) {
    if (!tiers.has(entrypoint.tier)) {
      errors.push(`${entrypoint.exportPath} tier must be stable, preview, or compatibility.`);
    }
    if (!entrypoint.importPath?.startsWith("@ferrum2d/ferrum-web")) {
      errors.push(`${entrypoint.exportPath} importPath must use @ferrum2d/ferrum-web.`);
    }
    if (!existsSync(path.join(repoRoot, entrypoint.source))) {
      errors.push(`${entrypoint.exportPath} source is missing: ${entrypoint.source}.`);
    }
  }
  if (!manifest.entrypoints?.some((entrypoint) => entrypoint.tier === "stable")) {
    errors.push(`${manifestPath} must declare at least one stable entrypoint.`);
  }
  if (!manifest.entrypoints?.some((entrypoint) => entrypoint.tier === "preview")) {
    errors.push(`${manifestPath} must declare at least one preview entrypoint.`);
  }
  return errors;
}

function checkPackageExports() {
  const errors = [];
  const manifestExportPaths = new Set(manifest.entrypoints.map((entrypoint) => entrypoint.exportPath));
  const packageExportPaths = new Set(Object.keys(packageJson.exports ?? {}));
  for (const exportPath of manifestExportPaths) {
    if (!packageExportPaths.has(exportPath)) {
      errors.push(`packages/ferrum-web package.json exports is missing ${exportPath}.`);
      continue;
    }
    const entrypoint = manifest.entrypoints.find((item) => item.exportPath === exportPath);
    const distName = path.basename(entrypoint.source, ".ts");
    const expectedImport = `./dist/${distName}.js`;
    const expectedTypes = `./dist/${distName}.d.ts`;
    const actual = packageJson.exports[exportPath];
    if (actual.import !== expectedImport) {
      errors.push(`exports['${exportPath}'].import must be ${expectedImport}, got ${actual.import}.`);
    }
    if (actual.types !== expectedTypes) {
      errors.push(`exports['${exportPath}'].types must be ${expectedTypes}, got ${actual.types}.`);
    }
  }
  for (const exportPath of packageExportPaths) {
    if (!manifestExportPaths.has(exportPath)) {
      errors.push(`packages/ferrum-web package.json exports contains undocumented public path ${exportPath}.`);
    }
  }
  return errors;
}

function checkPublicApiDoc() {
  const errors = [];
  const requiredSnippets = [
    "Public API surface manifest",
    "stable",
    "preview",
    "compatibility",
    "deprecation",
    ...manifest.entrypoints.map((entrypoint) => entrypoint.importPath),
    ...manifest.forbiddenConsumerImports,
  ];
  for (const snippet of requiredSnippets) {
    if (!publicApiDoc.includes(snippet)) {
      errors.push(`docs/engine/public-api.md is missing '${snippet}'.`);
    }
  }
  return errors;
}

function checkSourceExports() {
  const errors = [];
  for (const entrypoint of manifest.entrypoints) {
    const source = readFileSync(entrypoint.source, "utf8");
    const names = exportedNamesFromSource(entrypoint.source);
    if (entrypoint.exportPath !== "." && /\bexport\s+\*/u.test(source)) {
      errors.push(`${entrypoint.source} must use explicit exports, not export *.`);
    }
    for (const requiredExport of entrypoint.requiredExports ?? []) {
      if (!names.includes(requiredExport)) {
        errors.push(`${entrypoint.source} must export ${requiredExport}.`);
      }
    }
  }
  return errors;
}

function checkConsumerImports() {
  const errors = [];
  for (const filePath of collectConsumerFiles()) {
    const source = readFileSync(filePath, "utf8");
    for (const specifier of packageSpecifiers(source)) {
      const displayPath = path.relative(repoRoot, filePath);
      for (const forbiddenPrefix of forbiddenPrefixes) {
        if (specifier.startsWith(forbiddenPrefix)) {
          errors.push(`${displayPath} must not import internal package path ${specifier}.`);
        }
      }
      if (specifier.startsWith("@ferrum2d/ferrum-web") && !allowedImportPaths.has(specifier)) {
        errors.push(`${displayPath} imports undocumented @ferrum2d/ferrum-web path ${specifier}.`);
      }
    }
  }
  return errors;
}

function checkExistingPackageGuards() {
  const errors = [];
  for (const snippet of [
    "@ferrum2d/ferrum-web/dist/",
    "@ferrum2d/ferrum-web/pkg/",
    "@ferrum2d/ferrum-web/src/",
    "generated game must import from package public subpath entrypoints",
  ]) {
    if (!createGamePackageCheck.includes(snippet)) {
      errors.push(`scripts/package/check-create-game-package.mjs is missing '${snippet}'.`);
    }
  }
  for (const snippet of [
    "createFerrumRuntime must be exported from the core subpath",
    "resolveSceneCompositionSpec must be exported from the authoring subpath",
    "resolveShooterGameSpec must be exported from the starter-scenes subpath",
    "resolveSpriteMaterialPreset must be exported from the labs subpath",
    "RuntimeProfiler must be exported from the quality subpath",
    "Internal import must be blocked by package exports",
  ]) {
    if (!packageConsumerSmoke.includes(snippet)) {
      errors.push(`tests/smoke/package-consumer-smoke.mjs is missing '${snippet}'.`);
    }
  }
  return errors;
}

function exportedNamesFromSource(sourcePath, visited = new Set()) {
  const absoluteSourcePath = path.resolve(repoRoot, sourcePath);
  if (visited.has(absoluteSourcePath)) {
    return [];
  }
  visited.add(absoluteSourcePath);

  const source = readFileSync(absoluteSourcePath, "utf8");
  const names = [];
  const exportBlockPattern = /\bexport\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+["'][^"']+["']/gu;
  for (const match of source.matchAll(exportBlockPattern)) {
    for (const rawPart of match[1].split(",")) {
      const exportName = exportedNameFromPart(rawPart);
      if (exportName !== undefined) {
        names.push(exportName);
      }
    }
  }

  const exportAllPattern = /\bexport\s+\*\s+from\s+["']([^"']+)["']/gu;
  for (const match of source.matchAll(exportAllPattern)) {
    const nestedSourcePath = resolveExportSourcePath(absoluteSourcePath, match[1]);
    if (nestedSourcePath !== undefined) {
      names.push(...exportedNamesFromSource(nestedSourcePath, visited));
    }
  }

  return [...new Set(names)].sort();
}

function exportedNameFromPart(rawPart) {
  const withoutComment = rawPart.replace(/\/\/.*$/gmu, "").trim().replace(/^type\s+/u, "");
  if (!withoutComment) {
    return undefined;
  }
  const aliasMatch = /\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)$/u.exec(withoutComment);
  const exportName = aliasMatch?.[1] ?? withoutComment.split(/\s+/u)[0];
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(exportName) ? exportName : undefined;
}

function resolveExportSourcePath(fromSourcePath, specifier) {
  if (!specifier.startsWith(".")) {
    return undefined;
  }

  const basePath = path.resolve(path.dirname(fromSourcePath), specifier);
  const extension = path.extname(basePath);
  const candidates = [];
  if (extension === ".js") {
    candidates.push(basePath.replace(/\.js$/u, ".ts"));
  } else if (extension === "") {
    candidates.push(`${basePath}.ts`, `${basePath}.tsx`, path.join(basePath, "index.ts"));
  }
  candidates.push(basePath);

  return candidates.find((candidate) => existsSync(candidate));
}

function collectConsumerFiles() {
  return manifest.consumerImportRoots.flatMap((root) => collectFiles(path.join(repoRoot, root)))
    .filter((filePath) => /\.(?:ts|js|mjs)$/u.test(filePath));
}

function collectFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(directory)) {
    const entryPath = path.join(directory, entry);
    const entryStat = statSync(entryPath);
    if (entryStat.isDirectory()) {
      if (ignoredConsumerDirectoryNames.has(entry)) {
        continue;
      }
      files.push(...collectFiles(entryPath));
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

function packageSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s+["'](@ferrum2d\/ferrum-web[^"']*)["']/gu,
    /\bimport\s*\(\s*["'](@ferrum2d\/ferrum-web[^"']*)["']\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}
