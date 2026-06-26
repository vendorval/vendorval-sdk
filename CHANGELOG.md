# Changelog

This file is an aggregate index. Per-package changelogs live alongside each package:

- [`packages/node/CHANGELOG.md`](./packages/node/CHANGELOG.md)
- [`packages/python/CHANGELOG.md`](./packages/python/CHANGELOG.md)

## 2026-05-14

- **`entity.regulatory_disclosures[]`** (Node 0.7.0 + Python 0.7.0). Adds a new `RegulatoryDisclosure` type (Node `interface` + Python `TypedDict`) and an optional `regulatory_disclosures` array on `Entity`. Type-only release coordinated with the corresponding vendorval-api change that adds the regulatory-disclosures surface to the lookup response.

  A third lane on the lookup response — distinct from `exclusions` (procurement bars) and `classifications` (self-declared statements). Disclosures are externally-mandated public filings the entity stays bid-eligible under. First source: DOJ FARA — each row is one registrant↔foreign-principal binding; a registrant with N principals lands as N rows sharing `registration_number`.

  Field is optional and populated only when the API has disclosure data for the entity. Empty array otherwise.

## 2026-05-13

- **Certification.entity_legal_name** (Node 0.6.0 + Python 0.6.0). Type-only release: the `Certification` shape gains `entity_legal_name?: string | null` to mirror the new field on `/v1/certifications`. Callers can now render the human-readable entity name alongside `entity_id` without a follow-up `/v1/entities/lookup` per row. Field is nullable — the API returns null when the entity record is missing.

## 2026-05-12

- **Certifications identifier-resolved scoping** (Node 0.5.0 + Python 0.5.0). Adds `tin`, `uei`, `duns`, `lei`, `vat_id`, `state_entity_id`, and `npi` params on `certifications.list`. Server-side `/v1/certifications` already supported these; this release exposes them through the SDK signatures. Saves callers the 2-step lookup-then-query flow.

- **Lookup-response reshape** (Node 0.4.0 + Python 0.4.0). Type-only release coordinated with the vendorval-api `entity.sources` change. Breaking: `Entity.sources` repurposed from an `Array<…>` of per-source registration history records (now `Entity.registrations`) to a `Record<string, Record<string, unknown>>` map of per-source blocks keyed by source name. Also adds typed issuer-qualified identifier inputs (`state_entity_id`, `diversity_cert_id`, `contractor_license_id`, `medicaid_provider_id`, `wcb_employer_number`) accepting either `"<ISSUER>:<value>"` strings or `{value, issuer}` objects.

## 2026-05-08

- **Tier A entity fields + tightened `LookupResponse.match` union** (#5). The Node `Entity` interface (`packages/node/src/types/shared.ts`) and the Python `Entity` TypedDict (`packages/python/src/vendorval_sdk/types.py`) gain `dba_name`, `website_url`, and `state_of_incorporation` (all `string | None`). Node `LookupResponse.match` tightened from `"found" | "not_found" | "ambiguous" | "fuzzy"` to the actual API contract `"exact" | "fuzzy" | "not_found"`; `confidence` documented as fuzzy-only.
- Both packages stay at 0.2.x — types-only change, additive.

## 2026-05-05

- First public release on npm and PyPI as `vendorval-sdk` (Node v0.2.0, Python v0.2.0).
- Includes the package rename from `vendorval` and the country-aware surface (`vat_id`, `vat_validation`, `lei_validation`, `sanctions_screening`, `meta.listSupportedCountries`, `CountryError`).
