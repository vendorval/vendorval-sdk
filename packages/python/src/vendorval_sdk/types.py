"""Public type aliases mirroring the API response shapes.

Kept loose where the API surface is unstable. Consumers can `cast` to these
TypedDicts for editor support without committing to strict shapes.
"""

from __future__ import annotations

import sys
from collections.abc import Mapping
from typing import Any, Literal, Union

if sys.version_info >= (3, 11):
    from typing import TypedDict
else:
    from typing_extensions import TypedDict


IdentifierType = Literal[
    "uei",
    "tin",
    "duns",
    "cage",
    "lei",
    "vat_id",
    "name",
    "dba",
    "domain",
    "phone",
    # `state_registration` stays as a deprecated alias for `state_entity_id`
    # during the Phase N transition window.
    "state_registration",
    # Phase N (Workstream C, memo §4.3) — 6 new issuer-qualified identifier
    # types. The API accepts them today; adapters that emit them will land
    # in Phase O.A onwards.
    "state_entity_id",
    "diversity_cert_id",
    "contractor_license_id",
    "medicaid_provider_id",
    "wcb_employer_number",
    "npi",
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
]

# ISO 3166-1 alpha-2 country codes the API currently supports. Mirrors
# `vendorval-api/packages/common/src/country/supported-countries.ts`. The full
# list is also discoverable at runtime via `client.meta.list_supported_countries()`.
CountryCode = Literal[
    "US",
    # EU 27
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
    "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
    "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]
EntityRegion = Literal["north_america", "european_union"]
CountryTier = Literal["full", "limited"]
VerificationMode = Literal["cached", "realtime"]
EntityType = Literal[
    "corporation",
    "llc",
    "partnership",
    "sole_proprietorship",
    "nonprofit",
    "government",
    "individual",
    "other",
]
LookupMode = Literal["exact", "fuzzy"]
SamRefreshMode = Literal["auto", "force", "never"]


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


IssuerQualifiedIdentifierInput = Union[str, IssuerQualifiedIdentifier]


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
    # Phase N (Workstream C) — issuer-qualified identifiers. Each accepts
    # either an embedded `"<ISSUER>:<value>"` string or an explicit
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
VerifyIdentifiers = Union[
    VerifyIdentifierObject,
    Mapping[str, str],
    list[IdentifierInput],
    list[Mapping[str, str]],
    list[dict[str, str]],
]


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


# One per-source verification/registration history record. Until
# Phase O.A.reconciler shipped this was returned on `entity["sources"]`;
# it now lives on `entity["registrations"]` because `sources` was
# repurposed to carry per-source frozen blocks (see `Entity.sources` below).
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
    # Tier A enrichment — populated by SAM hydration. Null until the next
    # authoritative-source sync.
    dba_name: str | None
    website_url: str | None
    state_of_incorporation: str | None
    created_at: str
    updated_at: str
    identifiers: list[IdentifierRecord]
    addresses: list[Any]
    sam_gov: Any | None
    # Per-source verification/registration history. Renamed from the legacy
    # top-level `sources` field in Phase O.A.reconciler — the name was
    # needed for the frozen-block map below.
    registrations: list[SourceRegistration]
    # Phase O.A.reconciler — per-source frozen blocks keyed by source name
    # (`ny_dos`, `sam_us`, etc.). Each value is the source-specific block
    # the reconciler froze when it matched a silver row to this entity,
    # carrying `retrieved_at` plus the source's verbatim fields. Empty `{}`
    # until a reconciler has run for at least one source.
    sources: dict[str, dict[str, Any]]
    # Phase N (Workstream D) — per-attribute provenance. Maps an entity
    # column name (`legal_name`, `dba_name`, `website_url`,
    # `state_of_incorporation`) to the source id that most recently wrote
    # it. Empty `{}` until the gold-layer reconciler has run.
    field_attribution: dict[str, str]
    # Public regulatory disclosures attached to the entity. A third lane
    # distinct from exclusions (procurement bars) and classifications
    # (self-declared statements) — these are externally-mandated filings
    # (FARA today, federal lobbying / state ethics planned). Empty `[]`
    # until a reconciler writes rows.
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
    `source` and `disclosure_type` as the gold-side CHECK constraints
    widen.
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


# Per-check result status. The SDK auto-attaches `Accept-Version` (see
# `_request.py`) so the wire returns the Phase N (Workstream A) widened
# enum verbatim. Legacy values still appear today because no adapter
# emits the new ones yet; both shapes are listed so when adapters DO
# start emitting them, calling code renders correctly without a type-only
# SDK release.
CheckStatus = Literal[
    "pass",
    "fail",
    "inconclusive",
    "error",
    "pending",
    "clear",
    "exact_match",
    "probable_match",
]


class VerificationResult(TypedDict, total=False):
    check_type: CheckType
    status: CheckStatus
    confidence: float
    origin: str
    determinism: str
    data_freshness_seconds: int
    evidence_uri: str
    details: Any


class Verification(TypedDict, total=False):
    object: Literal["verification"]
    id: str
    entity_id: str
    status: Literal["pending", "running", "completed", "failed"]
    overall_result: Literal["pass", "fail", "inconclusive"]
    checks_requested: list[CheckType]
    mode: VerificationMode
    results: list[VerificationResult]
    webhook_url: str | None
    idempotency_key: str | None
    created_at: str
    updated_at: str


class VerificationBundle(TypedDict):
    object: Literal["verification_bundle"]
    entity: Entity
    verification: Verification


# ─── Certifications (Phase N, Workstream B) ──────────────────────────────

CertificationStatus = Literal[
    "active",
    "pending",
    "expired",
    "suspended",
    "revoked",
    "denied",
    "not_certified",
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
    # Meaningful only when category == "minority_owned". API CHECK
    # constraint enforces this — every minority_owned classification
    # carries a subcategory; no other category does.
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
