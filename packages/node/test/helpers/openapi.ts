/**
 * Minimal OpenAPI request checker for the contract tests.
 *
 * It answers one question: would the API accept this request exactly as the
 * SDK sent it? It resolves the operation for a method and URL, checks query
 * parameters against the declared ones, and validates the JSON body against
 * the operation's request schema.
 *
 * Unknown body keys are an error unless the schema explicitly allows extra
 * properties. The API strips undeclared keys silently, so a field the SDK
 * sends that the API does not declare is a field the caller thinks is doing
 * something and is not.
 *
 * Only the JSON Schema keywords the spec actually uses are implemented.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Schema {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  allOf?: Schema[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  pattern?: string;
  nullable?: boolean;
  $ref?: string;
}

interface Parameter {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema?: Schema;
}

interface Operation {
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, { schema?: Schema }> };
}

interface Spec {
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema> };
}

const here = dirname(fileURLToPath(import.meta.url));
export const SPEC_PATH = resolve(here, "..", "..", "..", "..", "specs", "openapi.json");
export const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as Spec;

export interface RecordedRequest {
  method: string;
  url: string;
  body: unknown;
}

export interface ResolvedOperation {
  template: string;
  operation: Operation;
}

/** Find the operation for a method and concrete path, preferring literal segments over `{params}`. */
export function findOperation(method: string, pathname: string): ResolvedOperation | undefined {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let best: { template: string; operation: Operation; literals: number } | undefined;
  for (const [template, ops] of Object.entries(spec.paths)) {
    const operation = ops[method.toLowerCase()];
    if (!operation) continue;
    const tparts = template.split("/").filter(Boolean);
    if (tparts.length !== parts.length) continue;
    let literals = 0;
    let ok = true;
    for (let i = 0; i < tparts.length; i += 1) {
      const t = tparts[i]!;
      if (t.startsWith("{") && t.endsWith("}")) {
        if (!parts[i]) ok = false;
      } else if (t === parts[i]) {
        literals += 1;
      } else {
        ok = false;
      }
      if (!ok) break;
    }
    if (ok && (!best || literals > best.literals)) best = { template, operation, literals };
  }
  return best && { template: best.template, operation: best.operation };
}

function resolveRef(schema: Schema): Schema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.replace("#/components/schemas/", "");
  const target = spec.components?.schemas?.[name];
  if (!target) throw new Error(`unresolved $ref ${schema.$ref}`);
  return resolveRef(target);
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(expected: string, actual: string): boolean {
  return expected === actual || (expected === "number" && actual === "integer");
}

/** Validate a value against a schema. Returns human-readable problems; empty means valid. */
export function validate(rawSchema: Schema, value: unknown, at: string): string[] {
  const schema = resolveRef(rawSchema);
  const problems: string[] = [];

  if (schema.allOf) {
    for (const s of schema.allOf) problems.push(...validate(s, value, at));
  }
  const alternatives = schema.anyOf ?? schema.oneOf;
  if (alternatives) {
    const results = alternatives.map((s) => validate(s, value, at));
    if (!results.some((r) => r.length === 0)) {
      problems.push(`${at}: matches none of the allowed shapes (${results.map((r) => r[0]).join(" | ")})`);
    }
    return problems;
  }

  if (value === null && schema.nullable) return problems;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!types.some((t) => typeMatches(t, actual))) {
      return [...problems, `${at}: expected ${types.join("|")}, got ${actual}`];
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${at}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.const !== undefined && schema.const !== value) {
    problems.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  }

  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) problems.push(`${at}: does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${at}: above ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) problems.push(`${at}: not above ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) problems.push(`${at}: not below ${schema.exclusiveMaximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${at}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${at}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => problems.push(...validate(schema.items!, item, `${at}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined) problems.push(`${at}.${key}: required by the API but not sent`);
    }
    for (const [key, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      const prop = schema.properties?.[key];
      if (prop) {
        problems.push(...validate(prop, v, `${at}.${key}`));
      } else if (schema.properties) {
        const extra = schema.additionalProperties;
        if (extra === false) {
          problems.push(`${at}.${key}: rejected by the API (not an allowed property)`);
        } else if (extra === undefined) {
          problems.push(`${at}.${key}: not in the API schema, so the API silently drops it`);
        } else if (typeof extra === "object") {
          problems.push(...validate(extra, v, `${at}.${key}`));
        }
      }
    }
  }
  return problems;
}

function coerceQueryValue(schema: Schema, raw: string): unknown {
  const s = resolveRef(schema);
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes("integer") || types.includes("number")) return Number(raw);
  if (types.includes("boolean")) return raw === "true" ? true : raw === "false" ? false : raw;
  if (types.includes("array")) return raw.split(",");
  return raw;
}

export interface CheckOptions {
  /**
   * Query parameters the API accepts on this route but its OpenAPI document
   * does not declare. Each one must be justified where it is listed.
   */
  undeclaredQuery?: readonly string[];
}

/** Every reason the API would reject or ignore part of this request. Empty means it conforms. */
export function checkRequest(req: RecordedRequest, options: CheckOptions = {}): string[] {
  const url = new URL(req.url);
  const resolved = findOperation(req.method, url.pathname);
  if (!resolved) return [`${req.method} ${url.pathname}: no such operation in specs/openapi.json`];
  const { template, operation } = resolved;
  const label = `${req.method} ${template}`;
  const problems: string[] = [];

  const queryParams = new Map(
    (operation.parameters ?? []).filter((p) => p.in === "query").map((p) => [p.name, p] as const),
  );
  for (const [name, raw] of url.searchParams) {
    const param = queryParams.get(name);
    if (!param) {
      if (!options.undeclaredQuery?.includes(name)) problems.push(`${label}: query parameter "${name}" is not declared`);
      continue;
    }
    if (param.schema) problems.push(...validate(param.schema, coerceQueryValue(param.schema, raw), `${label} ?${name}`));
  }
  for (const param of queryParams.values()) {
    if (param.required && !url.searchParams.has(param.name)) problems.push(`${label}: required query parameter "${param.name}" missing`);
  }

  const bodySchema = operation.requestBody?.content?.["application/json"]?.schema;
  if (req.body === undefined) {
    if (operation.requestBody?.required) problems.push(`${label}: request body required but not sent`);
  } else if (!bodySchema) {
    problems.push(`${label}: sends a body but the operation declares none`);
  } else {
    problems.push(...validate(bodySchema, req.body, `${label} body`));
  }
  return problems;
}

/** Look up a schema inside an operation's JSON request body by dotted path (`checks.items`). */
export function bodySchemaAt(method: string, template: string, dotted: string): Schema {
  const op = spec.paths[template]?.[method.toLowerCase()];
  let schema = op?.requestBody?.content?.["application/json"]?.schema;
  if (!schema) throw new Error(`${method} ${template} has no JSON body schema`);
  for (const part of dotted.split(".").filter(Boolean)) {
    schema = resolveRef(schema);
    if (part === "items") schema = schema.items;
    else if (/^anyOf\[\d+\]$/.test(part)) schema = schema.anyOf?.[Number(part.slice(6, -1))];
    else schema = schema.properties?.[part];
    if (!schema) throw new Error(`${method} ${template}: nothing at ${dotted}`);
  }
  return resolveRef(schema);
}

/** Look up a declared query parameter's schema. */
export function querySchema(method: string, template: string, name: string): Schema {
  const op = spec.paths[template]?.[method.toLowerCase()];
  const param = op?.parameters?.find((p) => p.in === "query" && p.name === name);
  if (!param?.schema) throw new Error(`${method} ${template}: no query parameter ${name}`);
  return resolveRef(param.schema);
}
