import { readFile } from "node:fs/promises";

export async function readJsonSchemaContract(schemaPath) {
  return JSON.parse(await readFile(schemaPath, "utf8"));
}

export function validateJsonSchemaContract(schema, value, label = "$") {
  validateNode(schema, value, label, schema);
}

function validateNode(schema, value, path, rootSchema) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    throw new Error(`${path} is not allowed by schema`);
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw new Error(`${path} schema node must be an object`);
  }
  if (typeof schema.$ref === "string") {
    validateNode(resolveRef(rootSchema, schema.$ref), value, path, rootSchema);
    return;
  }
  if (Array.isArray(schema.anyOf)) {
    validateAnyOf(schema.anyOf, value, path, rootSchema);
  }
  if (Array.isArray(schema.oneOf)) {
    validateOneOf(schema.oneOf, value, path, rootSchema);
  }
  if (Array.isArray(schema.allOf)) {
    validateAllOf(schema.allOf, value, path, rootSchema);
  }
  if (schema.not !== undefined) {
    validateNot(schema.not, value, path, rootSchema);
  }
  if (schema.if !== undefined) {
    validateConditional(schema, value, path, rootSchema);
  }
  if (schema.const !== undefined && !jsonEqual(value, schema.const)) {
    throw new Error(`${path} must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonEqual(value, entry))) {
    throw new Error(`${path} must be one of ${schema.enum.map((entry) => JSON.stringify(entry)).join(", ")}`);
  }
  if (schema.type !== undefined) {
    validateType(schema.type, value, path);
  }
  if (typeof value === "string") {
    validateString(schema, value, path);
  }
  if (typeof value === "number") {
    validateNumber(schema, value, path);
  }
  if (Array.isArray(value)) {
    validateArray(schema, value, path, rootSchema);
  }
  if (isPlainObject(value)) {
    validateObject(schema, value, path, rootSchema);
  }
}

function validateAnyOf(schemas, value, path, rootSchema) {
  const errors = [];
  for (const candidate of schemas) {
    try {
      validateNode(candidate, value, path, rootSchema);
      return;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`${path} must match at least one anyOf schema: ${errors.join("; ")}`);
}

function validateOneOf(schemas, value, path, rootSchema) {
  const errors = [];
  let matches = 0;
  for (const candidate of schemas) {
    try {
      validateNode(candidate, value, path, rootSchema);
      matches += 1;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (matches === 1) {
    return;
  }
  if (matches === 0) {
    throw new Error(`${path} must match exactly one oneOf schema: ${errors.join("; ")}`);
  }
  throw new Error(`${path} must match exactly one oneOf schema but matched ${matches}`);
}

function validateAllOf(schemas, value, path, rootSchema) {
  schemas.forEach((candidate, index) => {
    validateNode(candidate, value, `${path}.allOf[${index}]`, rootSchema);
  });
}

function validateNot(schema, value, path, rootSchema) {
  try {
    validateNode(schema, value, path, rootSchema);
  } catch {
    return;
  }
  throw new Error(`${path} must not match forbidden schema`);
}

function validateConditional(schema, value, path, rootSchema) {
  let matched = false;
  try {
    validateNode(schema.if, value, path, rootSchema);
    matched = true;
  } catch {
    matched = false;
  }
  if (matched && schema.then !== undefined) {
    validateNode(schema.then, value, path, rootSchema);
  }
  if (!matched && schema.else !== undefined) {
    validateNode(schema.else, value, path, rootSchema);
  }
}

function validateType(type, value, path) {
  const types = Array.isArray(type) ? type : [type];
  if (!types.some((candidate) => matchesType(candidate, value))) {
    throw new Error(`${path} must be ${types.join(" or ")}`);
  }
}

function matchesType(type, value) {
  if (type === "object") return isPlainObject(value);
  if (type === "array") return Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "null") return value === null;
  return true;
}

function validateString(schema, value, path) {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    throw new Error(`${path} must have length >= ${schema.minLength}`);
  }
  if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
    throw new Error(`${path} must match pattern ${schema.pattern}`);
  }
}

function validateNumber(schema, value, path) {
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new Error(`${path} must be >= ${schema.minimum}`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new Error(`${path} must be <= ${schema.maximum}`);
  }
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    throw new Error(`${path} must be > ${schema.exclusiveMinimum}`);
  }
}

function validateArray(schema, value, path, rootSchema) {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    throw new Error(`${path} must contain at least ${schema.minItems} item(s)`);
  }
  if (schema.items !== undefined) {
    value.forEach((entry, index) => {
      validateNode(schema.items, entry, `${path}[${index}]`, rootSchema);
    });
  }
}

function validateObject(schema, value, path, rootSchema) {
  if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) {
    throw new Error(`${path} must contain at least ${schema.minProperties} properties`);
  }
  for (const key of schema.required ?? []) {
    if (value[key] === undefined) {
      throw new Error(`${path}.${key} is required`);
    }
  }
  const properties = schema.properties ?? {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (value[key] !== undefined) {
      validateNode(propertySchema, value[key], `${path}.${key}`, rootSchema);
    }
  }
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(properties));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        throw new Error(`${path}.${key} is not allowed`);
      }
    }
  } else if (isPlainObject(schema.additionalProperties)) {
    const allowed = new Set(Object.keys(properties));
    for (const [key, entry] of Object.entries(value)) {
      if (!allowed.has(key)) {
        validateNode(schema.additionalProperties, entry, `${path}.${key}`, rootSchema);
      }
    }
  }
}

function resolveRef(rootSchema, ref) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local JSON schema refs are supported: ${ref}`);
  }
  return ref
    .slice(2)
    .split("/")
    .reduce((node, rawPart) => {
      const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
      if (!isPlainObject(node) || node[part] === undefined) {
        throw new Error(`Unresolved JSON schema ref: ${ref}`);
      }
      return node[part];
    }, rootSchema);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
