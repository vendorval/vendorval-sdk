# vendorval-sdk (Python)

## 0.8.0 — 2026-06-19

**Type-only release** — adds Phase 5 of data #155 fan-out on `client.certifications`.

- New `CertificationIssuerScope` Literal (`"state" | "federal" | "international" | "tribal" | "private"`).
- `Certification.issuer_scope: CertificationIssuerScope | None` — populated from the api's first-class `gold.certifications.issuer_scope` column shipped in api migration 0064. 100% non-null in prod 2026-06-16 (federal=21, state=22398); any null is a reconciler regression.
- `CertificationsResource.list(scope=...)` + `AsyncCertificationsResource.list(scope=...)` — comma-separated multi-select. Pass a single value (`'federal'`) or a list; the SDK joins lists with `,` for the api's wire format.

```python
# Every federal cert across all your entities — the canonical
# "show me my SBA certs" filter. Preferred over the older
# certifying_state="FEDERAL", which under-counted federal rows
# split between NULL and 'FEDERAL'.
federal = client.certifications.list(scope="federal")

# Multi-select (OR within the filter).
both = client.certifications.list(scope=["federal", "state"])
```

Pairs with vendorval-api PR #441 (Phase 4 of data #155) and vendorval-app PR #107.

## 0.5.0 — 2026-05-12

**Additive release** — adds identifier-resolved scoping params on `client.certifications.list`.

`certifications.list` (sync + async) now accepts `tin`, `uei`, `duns`, `lei`, `vat_id`, `state_entity_id`, and `npi` keyword arguments alongside the existing `entity_id`. Server-side `/v1/certifications` normalizes + hashes + joins the same way `/v1/entities/lookup` does — saves callers a 2-step lookup-then-query flow. Passing multiple identifiers that resolve to different entities → 400.

```python
# Before: 2 round-trips
lookup = client.entities.lookup(identifiers={"tin": "12-3456789"})
certs = client.certifications.list(entity_id=lookup["entity"]["id"])

# After: 1 round-trip
certs = client.certifications.list(tin="12-3456789")
```

## 0.4.0 — 2026-05-12

**Type-only release for the Phase O.A.reconciler lookup-response reshape.** Coordinated with vendorval-api `entity.sources` change and vendorval-data #19 (NY DOS reconciler Dagster asset).

**Breaking — `Entity["sources"]` shape changed:**

- The legacy `Entity["sources"]: list[Any]` (per-source verification/registration history records) is now `Entity["registrations"]: list[SourceRegistration]`.
- The `Entity["sources"]` field is now `dict[str, dict[str, Any]]` — a map keyed by source name (`ny_dos`, `sam_us`, …) carrying frozen per-source blocks the reconciler produced when it matched silver rows to this entity.

```diff
- for src in entity.get("sources", []):  # render history record
+ for reg in entity.get("registrations", []):  # render history record
+ ny_dos_block = entity.get("sources", {}).get("ny_dos")  # verbatim NY DOS fields
```

**New — issuer-qualified identifier inputs:**

`VerifyIdentifierObject` now declares `state_entity_id`, `diversity_cert_id`, `contractor_license_id`, `medicaid_provider_id`, and `wcb_employer_number` as `Union[str, IssuerQualifiedIdentifier]`. Both forms are collapsed to the canonical `"<ISSUER>:<value>"` string server-side.

```python
client.entities.lookup(
    identifiers={
        "tin": "12-3456789",
        "state_entity_id": {"value": "1234567", "issuer": "NY-DOS"},
        # or equivalently:
        # "state_entity_id": "NY-DOS:1234567",
    },
)
```

## 0.2.0 — 2026-05-05

**Breaking:** Renamed PyPI distribution from `vendorval` to `vendorval-sdk` and import path from `vendorval` to `vendorval_sdk` to avoid collisions with the `vendorval` Frappe app and other downstream packages that want to claim the `vendorval` namespace. Update consumers:

```diff
- pip install vendorval
+ pip install vendorval-sdk
```

```diff
- from vendorval import Vendorval
+ from vendorval_sdk import Vendorval
```

The public class names (`Vendorval`, `AsyncVendorval`, error types, `construct_event`, …) and their behaviour are unchanged.

**New — country-aware SDK surface (Phase J):**

- `IdentifierType` extended with `vat_id`; `CheckType` extended with `vat_validation`, `lei_validation`, `sanctions_screening`.
- New `CountryCode`, `EntityRegion`, `CountryTier` types and a typed `SupportedCountrySummary` / `SupportedCountriesResponse` pair mirroring `/v1/meta/countries`.
- New `MetaResource` exposing `client.meta.list_supported_countries()` and `client.meta.get_supported_country(code)` (sync + async).
- `entities.lookup` / `verifications.create` accept an optional `country` parameter that is forwarded to the API.
- New `CountryError` (subclass of `ValidationError`) wired into the response-to-error mapping for the five 422 codes: `country_required`, `country_not_supported`, `identifier_not_supported_for_country`, `check_not_supported_for_country`, `country_mismatch`. Plain 422 responses now map to `ValidationError` so non-country semantic violations inherit the same catch-all behaviour.

## 0.1.0 — Unreleased

Initial public release.

- `Vendorval` (sync) and `AsyncVendorval` (async) clients with `api_key` / `base_url` / `timeout` / `max_retries` options.
- Resources: `entities`, `verifications` (incl. `create_and_wait`), `monitors`, `providers`, `usage`, `jobs`.
- Auto-retry on `429` and `5xx` honoring `retry-after` and `x-ratelimit-reset`.
- Auto-generated idempotency keys for retried POSTs to verification endpoints.
- Typed errors: `AuthenticationError`, `PermissionError`, `ValidationError`, `RateLimitError`, `NotFoundError`, `ConflictError`, `ProviderError`, `APIError`.
- `request_id` exposed on every response and error.
- Forward-compatible `webhooks.construct_event` (placeholder until outbound delivery ships).
