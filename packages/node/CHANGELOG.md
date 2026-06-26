# vendorval-sdk (Node)

## 0.8.0 — 2026-06-19

**Type-only release** — adds awarding-authority scope filtering on `client.certifications`.

- New `CertificationIssuerScope` union (`"state" | "federal" | "international" | "tribal" | "private"`).
- `Certification.issuer_scope?: CertificationIssuerScope | null` — populated from the API's `issuer_scope` field.
- `CertificationsListParams.scope?: CertificationIssuerScope | CertificationIssuerScope[]` — comma-separated multi-select. Pass a single value (`'federal'`) or an array; the SDK joins arrays with `,` for the API's wire format.

```ts
// Every federal cert across all your entities — the canonical
// "show me my SBA certs" filter. Preferred over the older
// `?certifying_state=FEDERAL` filter.
const federalCerts = await client.certifications.list({ scope: "federal" });

// Multi-select (OR within the filter).
const both = await client.certifications.list({ scope: ["federal", "state"] });
```

Pairs with the corresponding `?scope=` support in the vendorval-api.

## 0.5.0 — 2026-05-12

**Type-only release** — adds identifier-resolved scoping params on `client.certifications.list`.

`CertificationsListParams` now accepts `tin`, `uei`, `duns`, `lei`, `vat_id`, `state_entity_id`, and `npi` alongside the existing `entity_id`. Server-side `/v1/certifications` normalizes + hashes + joins the same way `/v1/entities/lookup` does — saves callers a 2-step lookup-then-query flow. Passing multiple identifiers that resolve to different entities → 400.

```ts
// Before: 2 round-trips
const lookup = await client.entities.lookup({ identifiers: { tin: "12-3456789" } });
const certs = await client.certifications.list({ entity_id: lookup.entity!.id });

// After: 1 round-trip
const certs = await client.certifications.list({ tin: "12-3456789" });
```

## 0.4.0 — 2026-05-12

**Type-only release for the lookup-response reshape.** Coordinated with the vendorval-api `entity.sources` change.

**Breaking — `Entity.sources` shape changed:**

- The legacy `Entity.sources: Array<Record<string, unknown>>` (per-source verification/registration history records) is now `Entity.registrations: SourceRegistration[]`.
- The `Entity.sources` field is now `Record<string, Record<string, unknown>>` — a map keyed by source name (`ny_dos`, `sam_us`, …) carrying the per-source blocks the API captured for this entity.

```diff
- for (const src of entity.sources ?? []) { /* render history record */ }
+ for (const reg of entity.registrations ?? []) { /* render history record */ }
+ const nyDosBlock = entity.sources?.ny_dos;  // verbatim NY DOS fields
```

**New — issuer-qualified identifier inputs:**

`LookupIdentifiers` now accepts `state_entity_id`, `diversity_cert_id`, `contractor_license_id`, `medicaid_provider_id`, and `wcb_employer_number` as either an embedded string `"<ISSUER>:<value>"` or an explicit `{ value, issuer }` object. Both forms are collapsed to the canonical string server-side.

```ts
client.entities.lookup({
  identifiers: {
    tin: "12-3456789",
    state_entity_id: { value: "1234567", issuer: "NY-DOS" },
    // or equivalently:
    // state_entity_id: "NY-DOS:1234567",
  },
});
```

Also: top-level `npi` is now a typed field on `LookupIdentifiers` (was already in `IdentifierType` union).

## 0.2.0 — 2026-05-05

**Breaking:** Renamed npm package from `vendorval` to `vendorval-sdk`. Update consumers:

```diff
- npm install vendorval
+ npm install vendorval-sdk
```

```diff
- import Vendorval from "vendorval";
+ import Vendorval from "vendorval-sdk";
```

The default export, named exports, and runtime behaviour are unchanged.

**New — country-aware SDK surface:**

- `IdentifierType` extended with `vat_id`; `CheckType` extended with `vat_validation`, `lei_validation`, `sanctions_screening`.
- New `CountryCode`, `EntityRegion`, `CountryTier` types and a typed `SupportedCountrySummary` / `SupportedCountriesResponse` pair mirroring `/v1/meta/countries`.
- New `MetaResource` exposing `client.meta.listSupportedCountries()` and `client.meta.getSupportedCountry(code)`.
- `entities.lookup` / `verifications.create` accept an optional `country` parameter that is forwarded to the API.
- New `CountryError` (subclass of `ValidationError`) wired into the response-to-error mapping for the five 422 codes: `country_required`, `country_not_supported`, `identifier_not_supported_for_country`, `check_not_supported_for_country`, `country_mismatch`. Plain 422 responses now map to `ValidationError` so non-country semantic violations inherit the same catch-all behaviour.

## 0.1.0 — Unreleased

Initial public release.

- `Vendorval` client with `apiKey` / `baseUrl` / `timeout` / `maxRetries` / `fetch` options.
- Resources: `entities`, `verifications` (incl. `createAndWait`), `monitors`, `providers`, `usage`, `jobs`.
- Auto-retry on `429` and `5xx` honoring `retry-after` and `x-ratelimit-reset`.
- Auto-generated idempotency keys for retried POSTs to verification endpoints.
- Typed errors mirroring the API envelope: `AuthenticationError`, `PermissionError`, `ValidationError`, `RateLimitError`, `NotFoundError`, `ConflictError`, `ProviderError`, `APIError`.
- `x-request-id` exposed on responses and errors.
- Forward-compatible `webhooks.constructEvent` (placeholder until outbound delivery ships).
- AsyncIterator-based pagination so list endpoints stay source-compatible when cursors are introduced.
