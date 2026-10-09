/**
 * Request-shape contract tests.
 *
 * Every public resource method is called against a recording `fetch`, and
 * each request it sends is checked against `specs/openapi.json`: the
 * operation must exist, query parameters must be declared, and the JSON body
 * must validate, including enum values. Fields the API does not declare fail
 * the test, because the API drops them silently.
 *
 * The enum section checks that the SDK's string-literal unions list exactly
 * the values the spec declares. When the spec snapshot is refreshed and the
 * API has changed, these tests fail until the SDK follows.
 */
import { describe, expect, it, vi } from "vitest";

import {
  Vendorval,
  type CertificationIssuerScope,
  type CertificationStatus,
  type CheckType,
  type EntityType,
  type IdentifierType,
  type LookupEntityField,
  type LookupIdentifierKey,
  type LookupMode,
  type MonitorFrequency,
  type SamRefreshMode,
  type VerificationMode,
  type VerifyIdentifierObject,
  type VerifyVia,
} from "../src/index.js";
import { AddressesResource } from "../src/resources/addresses.js";
import { BankAccountsResource } from "../src/resources/bank-accounts.js";
import { CertificationsResource } from "../src/resources/certifications.js";
import { EntitiesResource } from "../src/resources/entities.js";
import { JobsResource } from "../src/resources/jobs.js";
import { MetaResource } from "../src/resources/meta.js";
import { MonitorsResource } from "../src/resources/monitors.js";
import { ProvidersResource } from "../src/resources/providers.js";
import { UsageResource } from "../src/resources/usage.js";
import { VerificationsResource } from "../src/resources/verifications.js";
import {
  bodySchemaAt,
  checkRequest,
  querySchema,
  type RecordedRequest,
  type Schema,
} from "./helpers/openapi.js";

/**
 * Query parameters the API accepts but its OpenAPI document does not yet
 * declare. The monitor list routes parse `limit` and `offset` in the handler
 * and return `has_more`, so the SDK paginates with them.
 */
const UNDECLARED_QUERY: Record<string, readonly string[]> = {
  "GET /v1/monitors": ["limit", "offset"],
  "GET /v1/monitors/{id}/events": ["limit", "offset"],
};

function recordingClient() {
  const calls: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method: init?.method ?? "GET", url: String(input), body });
    const isList = /\/v1\/(monitors(\/[^/]+\/events)?|providers|certifications|meta\/countries)$/.test(
      new URL(String(input)).pathname,
    );
    const payload = isList
      ? { object: "list", data: [], total: 0, has_more: false, limit: 20, offset: 0 }
      : { object: "verification_bundle", entity: {}, verification: { id: "ver_1", status: "completed" } };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const client = new Vendorval({
    apiKey: "vv_test_contract",
    baseUrl: "https://api.example",
    fetch: fetchMock,
    maxRetries: 0,
  });
  return { client, calls };
}

type Case = { name: string; call: (c: Vendorval) => Promise<unknown> };

/** One case per public method, using every optional field the SDK can send. */
const CASES: Case[] = [
  {
    name: "entities.lookup",
    call: (c) =>
      c.entities.lookup({
        identifiers: { uei: "LYHWAQBA7Q15", name: "Acme Federal", state_entity_id: { value: "123", issuer: "NY-DOS" } },
        mode: "fuzzy",
        country: "US",
        fields: ["legal_name", "identifiers"],
        options: { sam_refresh: "auto" },
      }),
  },
  {
    name: "entities.create",
    call: (c) =>
      c.entities.create({
        identifiers: [{ type: "uei", value: "LYHWAQBA7Q15" }],
        legal_name: "Acme Federal Services LLC",
        entity_type: "sole_proprietor",
        country: "US",
        address: { line_1: "1 Main St", city: "Albany", state: "NY", postal_code: "12207", country: "US" },
      }),
  },
  { name: "entities.retrieve", call: (c) => c.entities.retrieve("ent_sam/1") },
  {
    name: "verifications.create",
    call: async (c) => {
      await c.verifications.create({
        identifiers: { uei: "LYHWAQBA7Q15", vat_id: "DE123456789" },
        legal_name: "Acme Federal Services LLC",
        entity_type: "llc",
        country: "US",
        address: { line_1: "1 Main St", country: "US" },
        checks: ["sam_registration", "small_business_certification", "regulatory_disclosure_check"],
        mode: "realtime",
        verify_via: "providers",
        options: { sync: false, webhook_url: "https://hooks.example.com/v", create_if_not_found: false, match_threshold: 0.8 },
      });
      await c.verifications.create({
        identifiers: [{ type: "lei", value: "5493001KJTIIGC8Y1R12" }],
        checks: [],
        verify_via: "fara_only",
      });
    },
  },
  {
    name: "verifications.createForEntity",
    call: (c) =>
      c.verifications.createForEntity({
        entity_id: "ent_1",
        checks: ["tin_match"],
        mode: "cached",
        options: { sync: true, webhook_url: "https://hooks.example.com/v" },
      }),
  },
  { name: "verifications.retrieve", call: (c) => c.verifications.retrieve("ver_1") },
  {
    name: "verifications.createAndWait",
    call: (c) => c.verifications.createAndWait({ identifiers: { uei: "LYHWAQBA7Q15" }, checks: ["sam_exclusion"] }),
  },
  {
    name: "certifications.list",
    call: (c) =>
      c.certifications.list({
        entity_id: "ent_1",
        tin: "123456789",
        uei: "LYHWAQBA7Q15",
        duns: "123456789",
        lei: "5493001KJTIIGC8Y1R12",
        vat_id: "DE123456789",
        state_entity_id: "NY-DOS:1",
        npi: "1234567893",
        issuer: "SBA-DSBS",
        status: "active",
        scope: ["federal", "state"],
        expiring_within_days: 30,
        limit: 10,
        offset: 5,
      }),
  },
  { name: "certifications.retrieve", call: (c) => c.certifications.retrieve("cert_1") },
  {
    name: "monitors.create",
    call: (c) =>
      c.monitors.create({
        entity_id: "ent_1",
        checks: ["sam_registration", "sanctions_screening"],
        frequency: "monthly",
        webhook_url: "https://hooks.example.com/vendorval",
      }),
  },
  { name: "monitors.retrieve", call: (c) => c.monitors.retrieve("mon_1") },
  { name: "monitors.list", call: (c) => c.monitors.list({ limit: 50, offset: 100 }) },
  { name: "monitors.delete", call: (c) => c.monitors.delete("mon_1") },
  { name: "monitors.rotateSecret", call: (c) => c.monitors.rotateSecret("mon_1") },
  { name: "monitors.events", call: (c) => c.monitors.events("mon_1", { limit: 10, offset: 0 }) },
  { name: "providers.list", call: (c) => c.providers.list() },
  { name: "meta.listSupportedCountries", call: (c) => c.meta.listSupportedCountries() },
  { name: "meta.getSupportedCountry", call: (c) => c.meta.getSupportedCountry("gb") },
  { name: "usage.retrieve", call: (c) => c.usage.retrieve("org_1") },
  { name: "jobs.retrieve", call: (c) => c.jobs.retrieve("job_1") },
  {
    name: "addresses.lookup",
    call: (c) =>
      c.addresses.lookup({
        street_address: "1 Main St",
        state: "NY",
        city: "Albany",
        zip_code: "12207",
        secondary_address: "Ste 2",
        firm: "Acme",
      }),
  },
  { name: "addresses.suggest", call: (c) => c.addresses.suggest({ q: "1 Main", state: "NY", limit: 5 }) },
  {
    name: "bankAccounts.validate",
    call: async (c) => {
      await c.bankAccounts.validate({ scheme: "iban", iban: "DE89370400440532013000", bic: "DEUTDEFF", account_holder_name: "Acme" });
      await c.bankAccounts.validate({ scheme: "us_ach", routing_number: "011000015", account_number: "1234", account_holder_name: "Acme" });
    },
  },
];

describe("every request matches specs/openapi.json", () => {
  it.each(CASES)("$name", async ({ call }) => {
    const { client, calls } = recordingClient();
    await call(client);
    expect(calls.length).toBeGreaterThan(0);
    const problems = calls.flatMap((req) => {
      const template = `${req.method} ${new URL(req.url).pathname
        .replace(/^\/v1\/monitors\/[^/]+\/events$/, "/v1/monitors/{id}/events")}`;
      return checkRequest(req, { undeclaredQuery: UNDECLARED_QUERY[template] });
    });
    expect(problems).toEqual([]);
  });

  it("the checker catches the drift it exists for", () => {
    // Guards against a checker that passes everything.
    const legacyMonitor = checkRequest({
      method: "POST",
      url: "https://api.example/v1/monitors",
      body: { entity_id: "ent_1", checks: ["sam_registration"], cadence: "weekly" },
    });
    expect(legacyMonitor.join("\n")).toMatch(/frequency: required/);
    expect(legacyMonitor.join("\n")).toMatch(/cadence: not in the API schema/);

    const droppedLegalName = checkRequest({
      method: "POST",
      url: "https://api.example/v1/entities/lookup",
      body: { identifiers: { uei: "X" }, legal_name: "Acme" },
    });
    expect(droppedLegalName.join("\n")).toMatch(/legal_name: not in the API schema/);

    const badEnum = checkRequest({
      method: "POST",
      url: "https://api.example/v1/entities",
      body: { identifiers: [{ type: "uei", value: "X" }], legal_name: "A", entity_type: "individual" },
    });
    expect(badEnum.join("\n")).toMatch(/"individual" is not one of/);

    const noRoute = checkRequest({ method: "GET", url: "https://api.example/v1/verifications", body: undefined });
    expect(noRoute.join("\n")).toMatch(/no such operation/);
  });

  it("covers every public resource method", () => {
    const resources: Record<string, { prototype: object }> = {
      entities: EntitiesResource,
      verifications: VerificationsResource,
      certifications: CertificationsResource,
      monitors: MonitorsResource,
      providers: ProvidersResource,
      meta: MetaResource,
      usage: UsageResource,
      jobs: JobsResource,
      addresses: AddressesResource,
      bankAccounts: BankAccountsResource,
    };
    const methods = Object.entries(resources).flatMap(([name, cls]) =>
      Object.getOwnPropertyNames(cls.prototype)
        .filter((m) => m !== "constructor")
        .map((m) => `${name}.${m}`),
    );
    const covered = new Set(CASES.map((c) => c.name));
    expect(methods.filter((m) => !covered.has(m))).toEqual([]);
  });
});

// ─── Enum parity with the spec ─────────────────────────────────────────────

type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
/** Compile-time check that a literal array lists exactly the members of a union. */
function exactly<U>() {
  return <const A extends readonly U[]>(values: A & (Equals<A[number], U> extends true ? unknown : never)) => values;
}

function enumOf(schema: Schema): unknown[] {
  if (!schema.enum) throw new Error(`no enum: ${JSON.stringify(schema)}`);
  return schema.enum;
}

const sorted = (xs: readonly unknown[]) => [...xs].map(String).sort();

describe("SDK enums list exactly the values the API declares", () => {
  const cases: Array<[string, readonly string[], unknown[]]> = [
    [
      "CheckType",
      exactly<CheckType>()([
        "sam_registration",
        "sam_exclusion",
        "uei_validation",
        "tin_match",
        "vat_validation",
        "lei_validation",
        "sanctions_screening",
        "usps_address",
        "regulatory_disclosure_check",
        "small_business_certification",
      ]),
      enumOf(bodySchemaAt("POST", "/v1/verifications", "checks.items")),
    ],
    [
      "EntityType",
      exactly<EntityType>()(["corporation", "llc", "sole_proprietor", "partnership", "government", "nonprofit"]),
      enumOf(bodySchemaAt("POST", "/v1/entities", "entity_type")),
    ],
    [
      "IdentifierType",
      exactly<IdentifierType>()([
        "tin",
        "uei",
        "duns",
        "cage",
        "lei",
        "state_registration",
        "state_entity_id",
        "diversity_cert_id",
        "contractor_license_id",
        "medicaid_provider_id",
        "wcb_employer_number",
        "npi",
        "vat_id",
        "domain",
        "phone",
      ]),
      enumOf(bodySchemaAt("POST", "/v1/entities", "identifiers.items.type")),
    ],
    [
      "LookupIdentifierKey",
      exactly<LookupIdentifierKey>()([
        "tin",
        "uei",
        "duns",
        "cage",
        "lei",
        "state_registration",
        "state_entity_id",
        "diversity_cert_id",
        "contractor_license_id",
        "medicaid_provider_id",
        "wcb_employer_number",
        "npi",
        "vat_id",
        "domain",
        "phone",
        "name",
        "dba",
      ]),
      Object.keys(bodySchemaAt("POST", "/v1/entities/lookup", "identifiers").properties ?? {}),
    ],
    [
      "keyof VerifyIdentifierObject",
      exactly<keyof VerifyIdentifierObject>()([
        "tin",
        "uei",
        "duns",
        "cage",
        "lei",
        "state_registration",
        "state_entity_id",
        "diversity_cert_id",
        "contractor_license_id",
        "medicaid_provider_id",
        "wcb_employer_number",
        "npi",
        "vat_id",
        "domain",
        "phone",
      ]),
      Object.keys(bodySchemaAt("POST", "/v1/verify", "identifiers.anyOf[0]").properties ?? {}),
    ],
    [
      "VerificationMode",
      exactly<VerificationMode>()(["cached", "realtime"]),
      enumOf(bodySchemaAt("POST", "/v1/verifications", "mode")),
    ],
    ["VerifyVia", exactly<VerifyVia>()(["providers", "fara_only"]), enumOf(bodySchemaAt("POST", "/v1/verify", "verify_via"))],
    [
      "MonitorFrequency",
      exactly<MonitorFrequency>()(["daily", "weekly", "monthly"]),
      enumOf(bodySchemaAt("POST", "/v1/monitors", "frequency")),
    ],
    ["LookupMode", exactly<LookupMode>()(["exact", "fuzzy"]), enumOf(bodySchemaAt("POST", "/v1/entities/lookup", "mode"))],
    [
      "SamRefreshMode",
      exactly<SamRefreshMode>()(["auto", "force", "never"]),
      enumOf(bodySchemaAt("POST", "/v1/entities/lookup", "options.sam_refresh")),
    ],
    [
      "LookupEntityField",
      exactly<LookupEntityField>()([
        "legal_name",
        "normalized_name",
        "dba_name",
        "website_url",
        "state_of_incorporation",
        "entity_type",
        "legal_structure",
        "sector",
        "status",
        "country",
        "confidence",
        "identifiers",
        "sam_gov",
        "addresses",
        "registrations",
        "sources",
        "field_attribution",
        "classifications",
        "regulatory_disclosures",
        "created_at",
        "updated_at",
      ]),
      enumOf(bodySchemaAt("POST", "/v1/entities/lookup", "fields.items")),
    ],
    [
      "CertificationStatus",
      exactly<CertificationStatus>()(["active", "pending", "expired", "suspended", "revoked", "denied", "not_certified"]),
      enumOf(querySchema("GET", "/v1/certifications", "status")),
    ],
    [
      "CertificationIssuerScope",
      exactly<CertificationIssuerScope>()(["state", "federal", "international", "tribal", "private"]),
      enumOf(querySchema("GET", "/v1/certifications", "scope").items ?? {}),
    ],
  ];

  it.each(cases)("%s", (_name, sdkValues, specValues) => {
    expect(sorted(sdkValues)).toEqual(sorted(specValues));
  });
});
