import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(root, "packages/ferrum-web/package.json"));
const ts = require("typescript");
const sdk = "packages/ferrum-web/src/";

// These are intentionally narrow ownership contracts, not a claim to infer the
// semantics of arbitrary TypeScript. New facade state requires explicit review.
export const BOUNDARY_CONTRACTS = [
  { file: sdk + "dialogueQuest.ts", name: "QuestLog", nativeType: "NativeQuestLog",
    metadata: { document: "ResolvedQuestDocument" }, nativeReadonly: true,
    delegates: ["apply", "snapshot", "restore"] },
  { file: sdk + "dialogueQuest.ts", name: "DialogueSession", nativeType: "NativeDialogueSession",
    metadata: { graph: "ResolvedDialogueGraph" }, nativeReadonly: true,
    delegates: ["currentNode", "availableChoices", "choose", "snapshot", "restore"] },
  { file: sdk + "pixelMaskTerrain.ts", name: "PixelMaskTerrain", nativeType: "NativePixelMaskTerrain",
    metadata: { width: "number", height: "number", solidThreshold: "number" }, nativeReadonly: false,
    delegates: ["data", "version", "solidData", "isSolid", "alphaAt", "setPixel", "carveRect", "carveCircle", "dirtyRect", "clearDirty", "dirtyAlphaPatch"] },
];
const supportFiles = [sdk + "dialogueQuestNative.ts"];

/** Parse and bind real TS syntax; comments and string literals cannot satisfy a rule. */
export function validateLanguageBoundaries(sources, contracts = BOUNDARY_CONTRACTS) {
  const sourceFiles = new Map(Object.entries(sources).map(([path, text]) => [
    path, ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
  ]));
  const host = {
    getSourceFile: path => sourceFiles.get(path), getDefaultLibFileName: () => "lib.d.ts",
    writeFile() {}, getCurrentDirectory: () => "", getDirectories: () => [],
    fileExists: path => sourceFiles.has(path), readFile: path => sources[path],
    getCanonicalFileName: path => path, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n",
  };
  // Binding resolves local aliases even before a fresh generated pkg exists.
  // This does not replace the SDK's normal full typecheck after the Wasm build.
  const program = ts.createProgram([...sourceFiles.keys()], { noLib: true, noResolve: true }, host);
  const checker = program.getTypeChecker();
  const errors = [];
  const add = (file, node, message) => {
    const location = file.getLineAndCharacterOfPosition(node?.getStart(file) ?? 0);
    errors.push({ file: file.fileName, line: location.line + 1, column: location.character + 1, message });
  };
  for (const file of sourceFiles.values()) {
    for (const diagnostic of file.parseDiagnostics) add(file, undefined, ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    if (!contracts.some(contract => contract.file === file.fileName)) continue;
    // Progress cannot be moved from an instance to an obvious module singleton.
    for (const statement of file.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) add(file, statement, "facade modules may not own mutable module bindings");
      for (const declaration of statement.declarationList.declarations) {
        const init = unwrap(declaration.initializer);
        if (init && isResourceRegistry(file, declaration, init)) continue;
        if (init && (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init) || ts.isNewExpression(init))) {
          add(file, declaration, "facade module state containers must live in Rust or an explicitly reviewed platform adapter");
        }
      }
    }
  }
  for (const contract of contracts) {
    const file = sourceFiles.get(contract.file);
    if (!file) { errors.push({ file: contract.file, line: 1, column: 1, message: "required facade source is missing" }); continue; }
    const classes = file.statements.filter(node => ts.isClassDeclaration(node) && node.name?.text === contract.name);
    if (classes.length !== 1) { add(file, file, `expected exactly one ${contract.name} class`); continue; }
    const declaration = classes[0];
    if (declaration.heritageClauses?.length) add(file, declaration, `${contract.name} may not inherit hidden state`);
    const fields = new Map();
    for (const member of declaration.members) {
      if (ts.isPropertyDeclaration(member)) inspectField(member, member.name, member.type, member.modifiers);
      if (ts.isConstructorDeclaration(member)) {
        for (const parameter of member.parameters) {
          if (parameter.modifiers?.some(mod => [ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.ProtectedKeyword, ts.SyntaxKind.ReadonlyKeyword].includes(mod.kind))) {
            inspectField(parameter, parameter.name, parameter.type, parameter.modifiers);
          }
        }
      }
      if (ts.isSetAccessorDeclaration(member)) add(file, member, `${contract.name} may not introduce TS state setters`);
      if (member.body) inspectWrites(member);
    }
    for (const name of ["native", ...Object.keys(contract.metadata)]) {
      if (!fields.has(name)) add(file, declaration, `${contract.name}.${name} field is required`);
    }
    for (const name of contract.delegates) {
      const member = declaration.members.find(member => memberName(member.name) === name && member.body);
      if (!member || !delegatesToNative(member, new Set())) {
        add(file, member ?? declaration, `${contract.name}.${name} must call its native handle (possibly through a local method)`);
      }
    }

    function inspectField(node, nameNode, type, modifiers) {
      const name = memberName(nameNode);
      fields.set(name, node);
      if (modifiers?.some(mod => mod.kind === ts.SyntaxKind.StaticKeyword)) add(file, node, `${contract.name} may not own static state`);
      if (name !== "native" && !Object.hasOwn(contract.metadata, name)) {
        add(file, node, `${contract.name}.${name ?? "<computed>"} is forbidden TS instance state`);
        return;
      }
      const readonly = modifiers?.some(mod => mod.kind === ts.SyntaxKind.ReadonlyKeyword);
      if ((name !== "native" || contract.nativeReadonly) && !readonly) add(file, node, `${contract.name}.${name} must be readonly`);
      if (name === "native") {
        const types = type && ts.isUnionTypeNode(type) ? type.types.filter(item => item.kind !== ts.SyntaxKind.UndefinedKeyword) : [type];
        const native = types.length === 1 ? types[0] : undefined;
        const identifier = native && ts.isTypeReferenceNode(native) ? native.typeName : undefined;
        const valid = identifier && ts.isIdentifier(identifier) && nativeImport(file, identifier.text, contract.nativeType);
        if (!valid) add(file, node, `${contract.name}.native must be typed by the actual pkg export ${contract.nativeType}`);
      } else if (type?.getText(file) !== contract.metadata[name]) {
        add(file, node, `${contract.name}.${name} must remain ${contract.metadata[name]} authoring metadata`);
      }
    }

    function nativeReceiver(expression, seen = new Set()) {
      const node = unwrap(expression);
      if (!node || seen.has(node)) return false;
      seen.add(node);
      if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword && node.name.text === "native") return true;
      if (ts.isIdentifier(node)) {
        return (checker.getSymbolAtLocation(node)?.declarations ?? []).some(item =>
          ts.isVariableDeclaration(item) && nativeReceiver(item.initializer, new Set(seen)));
      }
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
        const method = declaration.members.find(member => memberName(member.name) === node.expression.name.text);
        let returnsNative = false;
        if (method?.body) walk(method.body, child => {
          if (ts.isReturnStatement(child) && nativeReceiver(child.expression, new Set(seen))) returnsNative = true;
        });
        return returnsNative;
      }
      return false;
    }

    function delegatesToNative(member, seen) {
      if (seen.has(member)) return false;
      seen.add(member);
      let found = false;
      walk(member.body, node => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
        if (nativeReceiver(node.expression.expression)) found = true;
        else if (node.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const called = declaration.members.find(item => memberName(item.name) === node.expression.name.text && item.body);
          if (called && delegatesToNative(called, new Set(seen))) found = true;
        }
      });
      return found;
    }

    function inspectWrites(member) {
      walk(member.body, node => {
        let target;
        if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target = node.left;
        if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) target = node.operand;
        if (ts.isDeleteExpression(node)) target = node.expression;
        const field = referencedField(target);
        if (field) {
          const direct = ts.isPropertyAccessExpression(unwrap(target)) && unwrap(target).expression.kind === ts.SyntaxKind.ThisKeyword;
          const constructorInitialization = ts.isConstructorDeclaration(member) && direct && fieldsAllowed(field);
          const release = memberName(member.name) === "destroy" && field === "native" && direct
            && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && ts.isIdentifier(node.right) && node.right.text === "undefined";
          if (!constructorInitialization && !release) add(file, node, `${contract.name} must not mutate TS-owned ${field}`);
        }
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const field = referencedField(node.expression.expression);
          if (field && field !== "native" && ["set", "add", "delete", "clear", "push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"].includes(node.expression.name.text)) {
            add(file, node, `${contract.name} must not mutate TS-owned ${field} containers`);
          }
          if (ts.isIdentifier(node.expression.expression) && ["Object", "Reflect"].includes(node.expression.expression.text)
            && ["assign", "defineProperty", "defineProperties", "set", "deleteProperty"].includes(node.expression.name.text)
            && node.arguments.some(argument => referencedField(argument))) {
            add(file, node, `${contract.name} reflective TS state mutation is forbidden`);
          }
        }
      });
    }
    function fieldsAllowed(name) { return name === "native" || Object.hasOwn(contract.metadata, name); }
    function referencedField(expression, seen = new Set()) {
      const node = unwrap(expression);
      if (!node || seen.has(node)) return undefined;
      seen.add(node);
      const direct = thisField(node);
      if (direct) return direct;
      if (node.kind === ts.SyntaxKind.ThisKeyword) return "<this>";
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const base = referencedField(node.expression, seen);
        if (base === "<this>") return ts.isPropertyAccessExpression(node) ? node.name.text : "<computed>";
        return base;
      }
      if (ts.isIdentifier(node)) {
        for (const declaration of checker.getSymbolAtLocation(node)?.declarations ?? []) {
          if (ts.isVariableDeclaration(declaration)) {
            const field = referencedField(declaration.initializer, new Set(seen));
            if (field) return field;
          }
        }
      }
      return undefined;
    }
  }
  return errors;

  function nativeImport(file, localName, nativeName, seen = new Set()) {
    const key = `${file.fileName}:${localName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement)) continue;
      const imports = statement.importClause?.namedBindings;
      if (!imports || !ts.isNamedImports(imports)) continue;
      const imported = imports.elements.find(item => item.name.text === localName);
      if (!imported) continue;
      const original = (imported.propertyName ?? imported.name).text;
      const specifier = statement.moduleSpecifier.text;
      if (specifier === "../pkg/ferrum_core.js") return original === nativeName;
      const importedFile = sourceFiles.get(normalize(join(dirname(file.fileName), specifier)).replace(/\.js$/, ".ts"));
      if (!importedFile) return false;
      for (const exported of importedFile.statements) {
        if (!ts.isExportDeclaration(exported) || !exported.exportClause || !ts.isNamedExports(exported.exportClause)) continue;
        const item = exported.exportClause.elements.find(item => item.name.text === original);
        if (!item) continue;
        const exportedName = (item.propertyName ?? item.name).text;
        if (exported.moduleSpecifier) return exported.moduleSpecifier.text === "../pkg/ferrum_core.js" && exportedName === nativeName;
        return nativeImport(importedFile, exportedName, nativeName, seen);
      }
    }
    return false;
  }

  function isResourceRegistry(file, declaration, init) {
    if (!ts.isNewExpression(init) || !ts.isIdentifier(init.expression)) return false;
    const types = init.typeArguments ?? [];
    const weakSet = init.expression.text === "WeakSet" && types.length === 1 && types[0].kind === ts.SyntaxKind.ObjectKeyword;
    const owner = init.expression.text === "WeakMap" && types.length === 2 && ts.isTypeReferenceNode(types[0])
      ? contracts.find(contract => contract.file === file.fileName && contract.name === types[0].typeName.getText(file)) : undefined;
    const weakMap = owner && ts.isTypeReferenceNode(types[1]) && ts.isIdentifier(types[1].typeName)
      && nativeImport(file, types[1].typeName.text, owner.nativeType);
    if (!weakSet && !weakMap) return false;
    const symbol = checker.getSymbolAtLocation(declaration.name);
    walk(file, node => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)
        || !ts.isIdentifier(node.expression.expression)
        || checker.getSymbolAtLocation(node.expression.expression) !== symbol) return;
      if (weakMap && node.expression.name.text === "set") {
        const [key, value] = node.arguments;
        if (key?.kind !== ts.SyntaxKind.ThisKeyword || !value || !ts.isPropertyAccessExpression(value)
          || value.expression.kind !== ts.SyntaxKind.ThisKeyword || value.name.text !== "native") {
          add(file, node, "native resource WeakMaps may store only this -> this.native handles, never progress snapshots");
        }
      }
      if (weakSet && node.expression.name.text === "add" && node.arguments[0]?.kind !== ts.SyntaxKind.ThisKeyword) {
        add(file, node, "lifecycle WeakSets may record only facade resource identity");
      }
    });
    return true;
  }
}

function memberName(node) { return node && (ts.isIdentifier(node) || ts.isStringLiteral(node)) ? node.text : undefined; }
function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
}
function thisField(node) {
  node = unwrap(node);
  if (!node) return undefined;
  if (ts.isPropertyAccessExpression(node)) return node.expression.kind === ts.SyntaxKind.ThisKeyword ? node.name.text : thisField(node.expression);
  if (ts.isElementAccessExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ThisKeyword) return ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : "<computed>";
    return thisField(node.expression);
  }
  return undefined;
}
function walk(node, visit) { if (node) { visit(node); ts.forEachChild(node, child => walk(child, visit)); } }

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const paths = [...new Set([...BOUNDARY_CONTRACTS.map(contract => contract.file), ...supportFiles])];
  const sources = Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(resolve(root, path), "utf8")])));
  const errors = validateLanguageBoundaries(sources);
  const report = {
    format: "ferrum2d.language-boundaries.ownership", version: 1, status: errors.length ? "failed" : "passed",
    scope: "QuestLog, DialogueSession and PixelMaskTerrain facade fields, native import/type provenance, state writes and native delegation; not a whole-program gameplay semantics proof.",
    sources: Object.fromEntries(Object.entries(sources).map(([path, source]) => [path, createHash("sha256").update(source).digest("hex")])),
    contracts: BOUNDARY_CONTRACTS, errors,
  };
  const artifactDir = resolve(root, "artifacts/language-boundaries");
  await mkdir(artifactDir, { recursive: true });
  await writeFile(resolve(artifactDir, "ownership-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
}
