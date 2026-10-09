# vendorval-sdk (Node)

## 0.10.0

This release brings the SDK in line with the API's current request and response shapes. Several of the old shapes no longer matched what the API accepts or returns, so most of the changes below are breaking. Each one says what to change.

### Added

- **Signed webhook verification for monitors.** `constructEvent(rawBody, headers, secret)` verifies the `X-ETP-Signature: sha256=<hex>` header, an HMAC-SHA256 of `` `${X-ETP-Timestamp}.${rawBody}` `` with the monitor's secret. It compares in constant time and rejects deliveries whose timestamp is more than 300 seconds from now (`{ tolerance }` changes the window). Deliveries are at-least-once, so use `X-ETP-Delivery-Id` to drop repeats. New exports: `WEBHOOK_SIGNATURE_HEADER`, `WEBHOOK_TIMESTAMP_HEADER`, `WEBHOOK_DELIVERY_ID_HEADER`, `WEBHOOK_EVENT_HEADER`, `DEFAULT_WEBHOOK_TOLERANCE_SECONDS`, and the payload types `WebhookEvent`, `MonitoringChangesDetectedEvent` and `VerificationCompletedEvent`.

  ```ts
  const event = constructEvent(rawBody, req.headers, monitor.webhook_secret);
  if (event.event === "monitoring.changes_detected") {
    for (const change of event.data.changes) console.log(change.event_type);
  }
  ```

- **`monitors.rotateSecret(id)`** issues a new signing secret for a monitor. Like `monitors.create()`, it returns `webhook_secret` once.
- **`monitors.create()`** returns `MonitorWithSecret`, which carries the `webhook_secret` for that monitor. It is not returned anywhere else, so store it.
- **Offset pagination that follows `has_more`.** `monitors.list()` and `monitors.events()` take `{ limit, offset }`. Iterating the returned `Page` with `for await`, or calling `.all()`, now walks every page instead of stopping after the first. `page.data`, `page.hasMore`, `page.total` and `page.nextPage()` are available for manual paging.
- **`entities.lookup({ fields })`** returns only the listed `entity` keys (`LookupEntityField`).
- **`verify_via`** on `verifications.create()` / `createAndWait()`. `"fara_only"` reports the entity's FARA filings as one `regulatory_disclosure_check` result without calling providers.
- **New values:** `CheckType` adds `regulatory_disclosure_check` and `small_business_certification`. `CountryCode` adds `GB`, supported through global checks only. `CheckStatus` adds `skipped`.
- **`vv_mcp_` API keys** pass the client-side prefix check.
- New types: `VerificationStatus`, `OverallResult`, `VerificationResultSource`, `MonitorFrequency`, `MonitorStatus`, `LookupIdentifierKey`, `VerifyVia`, `ListEnvelope`, `PageInfo`. `CertificationIssuerScope` is now exported from the package root.

### Changed (breaking)

- **`constructEvent(payload, headers, secret)`** takes the request headers instead of a signature string, and verifies the `X-ETP-*` scheme above. The API does not send the `vendorval-signature` header (`t=…,v1=…`) that the previous helper expected. Pass the raw body (string or `Buffer`) and `req.headers`, or a `Headers` object.
- **`monitors.create()`** takes `frequency` (`"daily"`, `"weekly"` or `"monthly"`) and a required `webhook_url`. `cadence` is gone.
- **`monitors.list()`** takes only `{ limit, offset }`. The API does not apply a `status` filter.
- **`verifications.list()` is removed.** The API has no route that lists verifications, so the call could not succeed. Retrieve verifications by ID, or keep the IDs that `verifications.create()` returns.
- **`entities.lookup()` no longer takes `legal_name`.** The API ignored it. To match on a name, pass `identifiers: { name }` with `mode: "fuzzy"`.
- **`IdentifierType`** no longer includes `name` and `dba`. They are lookup-only match signals; use `LookupIdentifierKey` where they are accepted.
- **`EntityType`** is `corporation`, `llc`, `sole_proprietor`, `partnership`, `government` or `nonprofit`. The API does not return `sole_proprietorship`, `individual` or `other`.
- **`EntityRegion`** is `north_america`, `eu` or `other` (was `european_union`). **`CountryTier`** is `full` or `global_only` (was `limited`).
- **`Verification`, `VerificationResult`, `Monitor` and `MonitorEvent`** now describe the fields the API returns. `Verification.status` uses `in_progress` and `expired` and `overall_result` adds `partial`. `Verification` gains `completed_at` and `initiated_by` and loses `updated_at` and `idempotency_key`. `VerificationResult` gains `id`, `provider_name`, `source`, `explanation`, `executed_at` and `created_at` and loses `details`. `Monitor` has `frequency`, `webhook_url`, `webhook_secret_rotated_at`, `last_run_at` and `next_run_at`, and `status` is `active`, `paused` or `cancelled`. `MonitorEvent` is the `change_event` shape.
- **`Page.all()` and `for await` cover every page,** not only the first. Use `page.data` for a single page.
- **`entities.create()` and `monitors.create()` no longer send an `Idempotency-Key`.** The API does not deduplicate these routes, so the key had no effect.
- **The `X-VendorVal-API-Version` header is no longer sent.** The API does not read it. `Accept-Version`, which the API does read, is still sent with the SDK's pinned API version.

### Documentation

- **`addresses.lookup()` is no longer described as free.** API-key calls to it, to `GET /v1/entities` and to `GET /v1/entities/{id}` are metered per API request; see your plan. `addresses.suggest()` is not metered.

## 0.9.0

### Added

- **`bankAccounts.validate()`** — structural validation of vendor payment details. Checks an IBAN's check digits and country layout across all 89 countries in the ISO 13616 registry, a BIC's structure, and a US ABA routing number's checksum and assigned Federal Reserve range. Also reports when an IBAN and BIC name different countries, which both being individually valid does not rule out.

  The endpoint is free and stateless. Nothing is stored, and the account number is never persisted or logged.

  **`valid: true` means the details are well-formed and internally consistent, and nothing more.** It is not evidence that the account exists, that it is open, or that it belongs to the vendor named. Confirming those is account ownership verification, which this endpoint does not perform. Every response carries a `disclaimer` restating that — surface it rather than swallowing it.

  ```ts
  const res = await client.bankAccounts.validate({
    scheme: "iban",
    iban: "DE89 3704 0044 0532 0130 00",
    bic: "DEUTDEFF",
  });
  for (const f of res.findings.filter((x) => !x.valid)) {
    console.log(f.field, f.code, f.message);
  }
  ```

  A structurally invalid account returns HTTP 200 with `valid: false`. A thrown error means the request itself was malformed.

  New types: `BankValidateRequest`, `BankValidateIbanRequest`, `BankValidateUsAchRequest`, `BankValidateResponse`, `BankValidationFinding`.

- **`LookupResponse.status` and `LookupResponse.hot_pull`** — the richer outcome field on a lookup. `match` is unchanged and still supported; `status` is what new code should branch on. Values are `cache_hit`, `sync_pulled`, `pending_async` and `not_found`.

  `pending_async` is the one to handle deliberately: it means a live fetch is still running, so `match` reads `not_found` and `entity` is `null` while the answer is still on its way. It is **not** a miss. Poll `hot_pull.poll_url`.

  Both fields are optional and appear only where live pulls are enabled, so treat a missing `status` as "fall back to `match`". New types: `LookupStatus`, `LookupHotPull`.

### Changed (breaking, type-level)

- **`LookupRefresh` corrected.** It previously declared `from_cache`, `age_seconds` and `refreshed_at`. The API does not return those fields, so any code reading them was reading `undefined` at runtime. They are replaced by the seven fields the API actually sends: `policy`, `attempted`, `status`, `stale`, `cached_retrieved_at`, `retrieved_at` and `warning`, with `status` typed as the new `RefreshStatus` union.

  This breaks compilation for code that referenced the old names, which is the point — that code was already reading nothing. `refresh.status` is worth handling: `cache_fallback` means an upstream call failed and stored data was served instead, with `stale: true` and a `warning` explaining why.

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

Pairs with the corresponding `?scope=` support in the VendorVal API.

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

**Type-only release for the lookup-response reshape.** Coordinated with the VendorVal API's `entity.sources` change.

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

The default export, named exports, and runtime behavior are unchanged.

**New — country-aware SDK surface:**

- `IdentifierType` extended with `vat_id`; `CheckType` extended with `vat_validation`, `lei_validation`, `sanctions_screening`.
- New `CountryCode`, `EntityRegion`, `CountryTier` types and a typed `SupportedCountrySummary` / `SupportedCountriesResponse` pair mirroring `/v1/meta/countries`.
- New `MetaResource` exposing `client.meta.listSupportedCountries()` and `client.meta.getSupportedCountry(code)`.
- `entities.lookup` / `verifications.create` accept an optional `country` parameter that is forwarded to the API.
- New `CountryError` (subclass of `ValidationError`) wired into the response-to-error mapping for the five 422 codes: `country_required`, `country_not_supported`, `identifier_not_supported_for_country`, `check_not_supported_for_country`, `country_mismatch`. Plain 422 responses now map to `ValidationError` so non-country semantic violations inherit the same catch-all behavior.

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
