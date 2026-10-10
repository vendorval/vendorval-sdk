"""Public type aliases mirroring the API response shapes.

Kept loose where the API surface is unstable. Consumers can `cast` to these
TypedDicts for editor support without committing to strict shapes.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypedDict

# Identifier types the API stores and accepts in the `{type, value}` form
# (`entities.create`, the list form of `verifications.create`) and reports in
# `meta.list_supported_countries()`. `name` and `dba` are not identifiers:
# they are fuzzy-match signals accepted only by `entities.lookup`.
IdentifierType = Literal[
    "tin",
    "uei",
    "duns",
    "cage",
    "lei",
    # `state_registration` is a deprecated alias for `state_entity_id`.
    # Both are accepted by the API.
    "state_registration",
    # Issuer-qualified identifier types (`"<ISSUER>:<value>"`).
    "state_entity_id",
    "diversity_cert_id",
    "contractor_license_id",
    "medicaid_provider_id",
    "wcb_employer_number",
    "npi",
    "vat_id",
    "domain",
    "phone",
]
# Keys accepted in `entities.lookup(identifiers=...)`: every identifier type
# plus the name signals.
LookupIdentifierKey = Literal[
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
]
CheckType = Literal[
    "sam_registration",
    "sam_exclusion",
    "uei_validation",
    "tin_match",
    "vat_validation",
    "lei_validation",
    "sanctions_screening",
    "usps_address",
    # Reads the entity's public regulatory filings (FARA today). Used by
    # `verify_via="fara_only"`; makes no external call.
    "regulatory_disclosure_check",
    # Reports the entity's active SBA small-business certifications from
    # VendorVal's reconciled certification data. Cached-only.
    "small_business_certification",
]

# ISO 3166-1 alpha-2 country codes the API currently supports. The full
# list is also discoverable at runtime via `client.meta.list_supported_countries()`.
CountryCode = Literal[
    "US",
    # United Kingdom. Supported through global checks only (tier "global_only").
    "GB",
    # EU 27
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
    "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]
# Coarse grouping returned by `meta.list_supported_countries()`. GB is "other".
EntityRegion = Literal["north_america", "eu", "other"]
# "full": at least one country-specific provider (SAM.gov, IRS, VIES, ...).
# "global_only": supported only through global checks (LEI and sanctions).
CountryTier = Literal["full", "global_only"]
VerificationMode = Literal["cached", "realtime"]
EntityType = Literal[
    "corporation",
    "llc",
    "sole_proprietor",
    "partnership",
    "government",
    "nonprofit",
]
LookupMode = Literal["exact", "fuzzy"]
SamRefreshMode = Literal["auto", "force", "never"]
# `providers` (default) runs `checks` against the verification providers.
# `fara_only` reports the entity's FARA filings as a single
# `regulatory_disclosure_check` result; `checks` is ignored.
VerifyVia = Literal["providers", "fara_only"]
MonitorFrequency = Literal["daily", "weekly", "monthly"]
MonitorStatus = Literal["active", "paused", "cancelled"]
# Top-level `entity` keys `entities.lookup(fields=...)` can select. `id` and
# `object` are always returned.
LookupEntityField = Literal[
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
]


class IdentifierInput(TypedDict):
    type: IdentifierType
    value: str


class IssuerQualifiedIdentifier(TypedDict):
    """Explicit issuer-qualified identifier value.

    The five identifier types whose value is meaningless without an issuer
    (state_entity_id, diversity_cert_id, contractor_license_id,
    medicaid_provider_id, wcb_employer_number) accept either this dict OR a
    string with the issuer encoded inline as ``"<ISSUER>:<value>"``
    (e.g. ``"NY-DOS:1234567"``). The API collapses both forms to the
    canonical ``"<ISSUER>:<value>"`` string before lookup.
    """

    value: str
    issuer: str


IssuerQualifiedIdentifierInput = str | IssuerQualifiedIdentifier


# Object-keyed identifier input accepted by `/v1/verify` (e.g. `{"uei": "..."}`).
# Mirrors the keys the API allows — `name` and `dba` are fuzzy-lookup helpers,
# not identifiers, so they're excluded here.
class VerifyIdentifierObject(TypedDict, total=False):
    uei: str
    tin: str
    duns: str
    cage: str
    lei: str
    vat_id: str
    state_registration: str
    domain: str
    phone: str
    # Issuer-qualified identifiers. Each accepts either an embedded
    # `"<ISSUER>:<value>"` string or an explicit
    # `{"value": ..., "issuer": ...}` dict.
    state_entity_id: IssuerQualifiedIdentifierInput
    diversity_cert_id: IssuerQualifiedIdentifierInput
    contractor_license_id: IssuerQualifiedIdentifierInput
    medicaid_provider_id: IssuerQualifiedIdentifierInput
    wcb_employer_number: IssuerQualifiedIdentifierInput
    npi: str


class SupportedCountrySummary(TypedDict):
    code: CountryCode
    name: str
    region: EntityRegion
    tier: CountryTier
    available_identifiers: list[IdentifierType]
    available_checks: list[CheckType]


class SupportedCountriesResponse(TypedDict):
    object: Literal["list"]
    total_count: int
    data: list[SupportedCountrySummary]


class CountryErrorDetails(TypedDict, total=False):
    """Structured `details` payload on the five 422 country routing errors.

    See https://docs.vendorval.com/api-reference/errors for the full envelope.
    """

    country_resolved: str
    identifiers_seen: list[str]
    recommended_action: str
    supported_countries: list[str]
    candidates: list[Mapping[str, Any]]


# `/v1/verify` accepts identifiers as either the recommended object form
# (e.g. `{"uei": "..."}`) or the legacy list of `{type, value}` pairs.
# All five variants are listed because `list[...]` is invariant in Python
# typing — `list[dict[str, str]]` is not assignable to `list[Mapping[str, str]]`
# even though `dict` is a `Mapping`. This single alias is the canonical type
# used everywhere identifiers cross a public method boundary.
VerifyIdentifiers = (
    VerifyIdentifierObject
    | Mapping[str, str]
    | list[IdentifierInput]
    | list[Mapping[str, str]]
    | list[dict[str, str]]
)


class AddressInput(TypedDict, total=False):
    line_1: str
    line_2: str
    city: str
    state: str
    postal_code: str
    country: str


class IdentifierRecord(TypedDict, total=False):
    id: str
    entity_id: str
    type: IdentifierType
    value: str
    verified: bool
    confidence: float
    issuer: str | None
    source: str | None
    first_seen_at: str
    last_seen_at: str


# One per-source verification/registration history record. Previously
# returned on `entity["sources"]`; it now lives on
# `entity["registrations"]` because `sources` was repurposed to carry
# per-source blocks (see `Entity.sources` below).
SourceRegistration = dict[str, Any]


class Entity(TypedDict, total=False):
    object: Literal["entity"]
    id: str
    legal_name: str
    normalized_name: str
    entity_type: EntityType
    status: str
    country: str
    confidence: float
    # Enrichment fields populated from authoritative-source data (e.g.
    # SAM.gov). Null until the entity has been enriched.
    dba_name: str | None
    website_url: str | None
    state_of_incorporation: str | None
    created_at: str
    updated_at: str
    identifiers: list[IdentifierRecord]
    addresses: list[Any]
    sam_gov: Any | None
    # Per-source verification/registration history. Renamed from the legacy
    # top-level `sources` field — that name now holds the per-source block
    # map below.
    registrations: list[SourceRegistration]
    # Per-source blocks keyed by source name (`ny_dos`, `sam_us`, etc.).
    # Each value is the source-specific block the API captured for this
    # entity, carrying `retrieved_at` plus the source's verbatim fields.
    # Empty `{}` until the API has data from at least one source.
    sources: dict[str, dict[str, Any]]
    # Per-attribute provenance. Maps an entity field name (`legal_name`,
    # `dba_name`, `website_url`, `state_of_incorporation`) to the source id
    # that most recently wrote it. Empty `{}` until attribution data is
    # available.
    field_attribution: dict[str, str]
    # Public regulatory disclosures attached to the entity. A third lane
    # distinct from exclusions (procurement bars) and classifications
    # (self-declared statements) — these are externally-mandated filings
    # (FARA today, federal lobbying / state ethics planned). Empty `[]`
    # until disclosure data is available for the entity.
    regulatory_disclosures: list[RegulatoryDisclosure]


class RegulatoryDisclosure(TypedDict, total=False):
    """One public regulatory filing attached to an entity.

    First source: DOJ FARA. Each row represents one
    registrant↔foreign-principal binding. A registrant with N
    principals lands as N rows sharing `registration_number` but with
    distinct ids.

    FARA registrants stay bid-eligible — the disclosure is regulatory
    transparency, not a bar. Procurement teams that key on
    `exclusions` filter "barred"; teams that key on
    `regulatory_disclosures` filter "needs additional review."

    Future regulatory feeds (federal lobbying, state ethics) widen
    `source` and `disclosure_type` (closed sets on the API side that
    widen with each new feed).
    """

    id: str
    source: str
    """Currently `"fara_doj"`; widens with each new regulatory feed."""

    disclosure_type: str
    """Currently `"foreign_agent"`; widens with each new feed."""

    registration_number: str
    """Agency-side filing identifier (FARA Registration Number)."""

    # Denormalized for the common FARA shape. Future disclosure types
    # may leave these null and surface their own fields on the raw row
    # stored server-side.
    foreign_principal_name: str | None
    foreign_principal_country: str | None
    foreign_principal_registration_date: str | None  # YYYY-MM-DD
    foreign_principal_termination_date: str | None  # null while active
    foreign_principal_address: dict[str, Any] | None

    created_at: str
    updated_at: str


# Per-check result status. The SDK sends `Accept-Version` (see
# `_request.py`) so the API returns the widened enum (`clear` /
# `exact_match` / `probable_match`) verbatim instead of aliasing it to the
# legacy values. `skipped` means the entity lacked the identifier the check
# needs.
CheckStatus = Literal[
    "pass",
    "fail",
    "inconclusive",
    "error",
    "pending",
    "clear",
    "exact_match",
    "probable_match",
    "skipped",
]

VerificationStatus = Literal["pending", "in_progress", "completed", "failed", "expired"]

# Roll-up across every check. `partial` means some checks passed and others
# did not reach a definitive pass. None until the verification completes.
OverallResult = Literal["pass", "fail", "partial", "inconclusive"]


class VerificationResultSource(TypedDict, total=False):
    name: str
    display_name: str
    retrieved_at: str
    record_reference: str | None
    confidence: float
    mapping_version: str
    freshness: Literal["daily_sync", "realtime", "manual_upload"]
    raw_available: bool


class VerificationResult(TypedDict, total=False):
    id: str
    check_type: CheckType
    status: CheckStatus
    confidence: float | None
    explanation: str | None
    provider_name: str
    origin: str | None
    determinism: str | None
    data_freshness_seconds: int | None
    evidence_uri: str | None
    executed_at: str | None
    created_at: str
    source: VerificationResultSource


class Verification(TypedDict, total=False):
    object: Literal["verification"]
    id: str
    entity_id: str
    status: VerificationStatus
    mode: VerificationMode
    checks_requested: list[CheckType]
    overall_result: OverallResult | None
    initiated_by: str | None
    webhook_url: str | None
    completed_at: str | None
    created_at: str
    results: list[VerificationResult]


class VerificationBundle(TypedDict):
    object: Literal["verification_bundle"]
    entity: Entity
    verification: Verification


# ─── Certifications ──────────────────────────────────────────────────────

CertificationStatus = Literal[
    "active",
    "pending",
    "expired",
    "suspended",
    "revoked",
    "denied",
    "not_certified",
]

# Coarse geographic + sector scope of the awarding authority. Mirrors
# the API's `?scope=` filter on GET /v1/certifications.
#
# Today `state` (state UCP issuers) and `federal` (SBA 8(a) / HUBZone /
# SDB / AbilityOne / 8(a) JV) carry data; the other three are reserved
# for future sources.
CertificationIssuerScope = Literal[
    "state",
    "federal",
    "international",
    "tribal",
    "private",
]

ClassificationCategory = Literal[
    "small_business",
    "minority_owned",
    "women_owned",
    "veteran_owned",
    "service_disabled_veteran",
    "disability_owned",
    "lgbt_owned",
]

ClassificationEthnicSubcategory = Literal[
    "african_american",
    "hispanic_american",
    "asian_pacific_american",
    "subcontinent_asian_american",
    "native_american",
    "other",
]


class Classification(TypedDict, total=False):
    category: ClassificationCategory
    # Meaningful only when category == "minority_owned". The API enforces
    # this — every minority_owned classification carries a subcategory; no
    # other category does.
    ethnic_subcategory: ClassificationEthnicSubcategory | None
    raw_label: str


class CertificationSource(TypedDict):
    name: str
    mapping_version: str
    retrieved_at: str


class Certification(TypedDict, total=False):
    object: Literal["certification"]
    id: str
    entity_id: str
    # Human-readable legal name of the entity this cert is attached to.
    # Surfaces alongside `entity_id` so callers can render the entity
    # name without a follow-up `/v1/entities/lookup`. Nullable — the
    # API returns null when the entity row is missing.
    entity_legal_name: str | None
    issuer: str
    cert_number: str
    status: CertificationStatus
    issued_at: str | None
    expires_at: str | None
    # Derived at read time from `expires_at` against the per-request
    # `expiring_within_days` threshold (default 60).
    expiring_soon: bool
    retrieved_at: str
    classifications: list[Classification]
    # Coarse awarding-authority scope. Filter the list via `scope=` on
    # CertificationsResource.list().
    issuer_scope: CertificationIssuerScope | None
    source: CertificationSource
    created_at: str
    updated_at: str


class CertificationsListResponse(TypedDict):
    object: Literal["list"]
    data: list[Certification]
    total: int
    has_more: bool
    limit: int
    offset: int


# ─── Bank account validation ────────────────────────────────────────────────

BankScheme = Literal["iban", "us_ach"]


class BankValidateIbanRequest(TypedDict, total=False):
    """IBAN branch of the validate request. ``scheme`` and ``iban`` required."""

    scheme: Literal["iban"]
    # Spaces, dashes and lowercase are accepted and normalized server-side.
    iban: str
    # Optional. Validated, and its country compared against the IBAN's.
    bic: str
    # Optional and NOT validated at this tier. Matching a name to an account
    # requires ownership verification, which this endpoint does not do.
    account_holder_name: str


class BankValidateUsAchRequest(TypedDict, total=False):
    """US ACH branch. ``scheme`` and ``routing_number`` required."""

    scheme: Literal["us_ach"]
    # 9-digit ABA number. Dashes and spaces accepted.
    routing_number: str
    # Optional. US account numbers carry no checksum, so nothing structural can
    # be verified — supplied only so the response can return a masked form. It
    # is never stored or logged.
    account_number: str
    account_holder_name: str


# The two schemes share nothing, so the request is a union rather than a bag of
# optional fields. The server rejects an empty object and any cross-scheme mix.
BankValidateRequest = BankValidateIbanRequest | BankValidateUsAchRequest


class BankValidationFinding(TypedDict, total=False):
    # `iban` | `bic` | `routing_number` | `iban_bic_agreement`
    field: str
    valid: bool
    # `ok` when the rule passed; otherwise the specific failure code.
    code: str
    # Safe to show a user. Never contains the value that was sent.
    message: str


class BankValidateDisplay(TypedDict, total=False):
    iban: str
    account_number: str


class BankValidateCountries(TypedDict, total=False):
    iban: str
    bic: str


class BankValidateResponse(TypedDict, total=False):
    """Result of a structural validation.

    ``valid`` means the details are well-formed and internally consistent, and
    NOTHING more. It is not evidence that the account exists, that it is open,
    or that it belongs to the vendor named — confirming those is account
    ownership verification, which this endpoint does not perform.

    ``disclaimer`` restates that in the payload. Surface it; do not swallow it.
    """

    valid: bool
    scheme: BankScheme
    # One entry per rule that ran. Rules are skipped, not piled up.
    findings: list[BankValidationFinding]
    # Masked display forms. Safe to store and render; the input is not.
    display: BankValidateDisplay
    # Countries derived from the input. Empty for `us_ach`.
    countries: BankValidateCountries
    disclaimer: str


# Richer outcome field on a lookup response. `match` is kept for backward
# compatibility; branch on `status` in new code. `pending_async` means a live
# fetch is still running, so `match` reads "not_found" and `entity` is None
# while the answer is still on its way — it is NOT a miss.
LookupStatus = Literal[
    "cache_hit",
    "sync_pulled",
    "pending_async",
    "not_found",
]

# Outcome of the SAM.gov refresh path on a lookup. `cache_fallback` is the one
# worth handling: an upstream call failed and stored data was served instead,
# with `stale` true and a `warning` explaining why.
RefreshStatus = Literal[
    "cache_hit",
    "sam_hydrated",
    "sam_refreshed",
    "sam_searched",
    "sam_not_found",
    "cache_fallback",
    "not_attempted",
]


class LookupHotPull(TypedDict, total=False):
    """Present on a lookup whose live fetch is pending or was attempted.

    On ``status == "pending_async"`` the fetch is still running and
    ``poll_url`` says where to re-check. On a terminal ``not_found`` a
    ``reason`` means the authoritative source was asked and had no record.
    """

    correlation_id: str
    poll_url: str
    reason: str


# ─── Monitors ───────────────────────────────────────────────────────────────


class Monitor(TypedDict, total=False):
    object: Literal["monitor"]
    id: str
    entity_id: str
    checks: list[CheckType]
    frequency: MonitorFrequency
    # Where change events are delivered.
    webhook_url: str
    # When the signing secret was last issued or rotated. The secret itself is
    # never returned here.
    webhook_secret_rotated_at: str | None
    status: MonitorStatus
    last_run_at: str | None
    next_run_at: str | None
    created_at: str


class MonitorWithSecret(Monitor, total=False):
    """Returned by ``monitors.create()`` and ``monitors.rotate_secret()`` only.

    ``webhook_secret`` is shown exactly once. Store it: it is the key you pass
    to ``construct_event()`` to verify this monitor's deliveries.
    """

    webhook_secret: str


class MonitorEvent(TypedDict, total=False):
    """One change a monitor detected, from ``monitors.events()``."""

    object: Literal["change_event"]
    id: str
    event_type: str
    field_path: str | None
    previous_value: Any
    new_value: Any
    detected_at: str
    verification_id: str | None
    notified: bool


# ─── Webhook payloads ───────────────────────────────────────────────────────


class WebhookChange(TypedDict, total=False):
    event_type: str
    field_path: str | None
    previous_value: Any
    new_value: Any
    detected_at: str


class MonitoringChangesDetectedData(TypedDict, total=False):
    monitor_id: str
    entity_id: str
    changes: list[WebhookChange]
    # The verification that detected the change, or None if it no longer exists.
    verification_id: str | None


class MonitoringChangesDetectedEvent(TypedDict):
    """Sent when a monitor detects a change. Each delivery carries one change."""

    event: Literal["monitoring.changes_detected"]
    created_at: str
    data: MonitoringChangesDetectedData


class VerificationCompletedResult(TypedDict, total=False):
    check_type: CheckType
    status: CheckStatus
    confidence: float | None
    provider_name: str
    origin: str | None


class VerificationCompletedData(TypedDict, total=False):
    id: str
    entity_id: str
    status: VerificationStatus
    overall_result: OverallResult | None
    completed_at: str | None
    results: list[VerificationCompletedResult]


class VerificationCompletedEvent(TypedDict):
    """Sent when a verification created with ``options.webhook_url`` completes."""

    event: Literal["verification.completed"]
    created_at: str
    data: VerificationCompletedData


WebhookEvent = MonitoringChangesDetectedEvent | VerificationCompletedEvent
