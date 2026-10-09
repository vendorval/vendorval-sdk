/**
 * Shared types mirroring the VendorVal API response shapes.
 * Kept loose where the API surface is unstable (refresh, sources) so SDK
 * consumers can opt into stricter shapes once the spec stabilizes.
 */

/**
 * Identifier types the API stores and accepts in the `{ type, value }` form
 * (`entities.create`, the array form of `verifications.create`) and reports in
 * `meta.listSupportedCountries()`.
 *
 * `name` and `dba` are not identifiers: they are fuzzy-match signals accepted
 * only by `entities.lookup`. See `LookupIdentifierKey`.
 */
export type IdentifierType =
  | "tin"
  | "uei"
  | "duns"
  | "cage"
  | "lei"
  // `state_registration` is a deprecated alias for `state_entity_id`.
  // Both are accepted by the API.
  | "state_registration"
  // Issuer-qualified identifier types (`"<ISSUER>:<value>"`).
  | "state_entity_id"
  | "diversity_cert_id"
  | "contractor_license_id"
  | "medicaid_provider_id"
  | "wcb_employer_number"
  | "npi"
  | "vat_id"
  | "domain"
  | "phone";

/** Keys accepted in `entities.lookup({ identifiers })`: every identifier type plus the name signals. */
export type LookupIdentifierKey = IdentifierType | "name" | "dba";

export type CheckType =
  | "sam_registration"
  | "sam_exclusion"
  | "uei_validation"
  | "tin_match"
  | "vat_validation"
  | "lei_validation"
  | "sanctions_screening"
  | "usps_address"
  // Reads the entity's public regulatory filings (FARA today). Used by
  // `verify_via: "fara_only"`; makes no external call.
  | "regulatory_disclosure_check"
  // Reports the entity's active SBA small-business certifications from
  // VendorVal's reconciled certification data. Cached-only.
  | "small_business_certification";

/**
 * ISO 3166-1 alpha-2 country codes the API currently supports.
 * The full list is also discoverable at runtime via `client.meta.listSupportedCountries()`.
 */
export type CountryCode =
  | "US"
  // United Kingdom. Supported through global checks only (`tier: "global_only"`).
  | "GB"
  // EU 27
  | "AT" | "BE" | "BG" | "CY" | "CZ" | "DE" | "DK" | "EE" | "ES" | "FI"
  | "FR" | "GR" | "HR" | "HU" | "IE" | "IT" | "LT" | "LU" | "LV" | "MT"
  | "NL" | "PL" | "PT" | "RO" | "SE" | "SI" | "SK";

/** Coarse grouping returned by `meta.listSupportedCountries()`. GB is `"other"`. */
export type EntityRegion = "north_america" | "eu" | "other";

/**
 * `full`: at least one country-specific provider (SAM.gov, IRS, VIES, …).
 * `global_only`: supported only through global checks (LEI and sanctions).
 */
export type CountryTier = "full" | "global_only";

export interface SupportedCountrySummary {
  code: CountryCode;
  name: string;
  region: EntityRegion;
  tier: CountryTier;
  available_identifiers: IdentifierType[];
  available_checks: CheckType[];
}

export interface SupportedCountriesResponse {
  object: "list";
  total_count: number;
  data: SupportedCountrySummary[];
}

export type VerificationMode = "cached" | "realtime";

export type EntityType =
  | "corporation"
  | "llc"
  | "sole_proprietor"
  | "partnership"
  | "government"
  | "nonprofit";

export type LookupMode = "exact" | "fuzzy";

export type SamRefreshMode = "auto" | "force" | "never";

export interface IdentifierInput {
  type: IdentifierType;
  value: string;
}

export interface AddressInput {
  line_1?: string;
  line_2?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  country?: string;
}

export interface IdentifierRecord {
  id: string;
  entity_id: string;
  type: IdentifierType;
  value: string;
  verified?: boolean;
  confidence?: number;
  issuer?: string | null;
  source?: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

/**
 * Standalone address endpoints (free, rate-limited per tenant). Distinct
 * from `AddressRecord` (which is the per-entity address row returned on
 * entity reads).
 */
export interface AddressLookupRequest {
  street_address: string;
  state: string;
  city?: string;
  zip_code?: string;
  secondary_address?: string;
  firm?: string;
}

export type Deliverability =
  | "deliverable"
  | "undeliverable"
  | "vacant"
  | "unknown";

export type DpvCode = "Y" | "D" | "S" | "N";

export interface AddressLookupResponse {
  input: {
    street_address: string;
    state: string;
    city: string | null;
    zip_code: string | null;
    secondary_address: string | null;
    firm: string | null;
  };
  standardized: {
    firm: string | null;
    line_1: string | null;
    line_2: string | null;
    city: string | null;
    state: string | null;
    postal_code: string | null;
    postal_code_plus_4: string | null;
  } | null;
  deliverability: Deliverability;
  dpv_code: DpvCode | null;
  flags: {
    business: boolean | null;
    vacant: boolean | null;
    central_delivery_point: boolean | null;
    dpv_cmra: boolean | null;
  };
  verified_at: string;
  verified_by_source: "usps";
  warnings: string[];
}

export interface AddressSuggestParams {
  q: string;
  state?: string;
  limit?: number;
}

export interface AddressSuggestion {
  id: string;
  line_1: string;
  line_2: string | null;
  city: string;
  state: string;
  postal_code: string;
  postal_code_plus_4: string | null;
  country: string;
  usps_verified: boolean;
  score: number;
}

export interface AddressSuggestResponse {
  object: "list";
  data: AddressSuggestion[];
  query: { q: string; state: string | null; limit: number };
}

export interface AddressRecord {
  id: string;
  entity_id: string;
  type: string;
  line_1?: string | null;
  line_2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  /**
   * USPS-standardized sibling fields, populated when the address has been
   * verified via `/v1/verify usps_address` or a background sweep. NULL
   * until then.
   */
  standardized?: {
    line_1?: string | null;
    line_2?: string | null;
    city?: string | null;
    state?: string | null;
    postal_code?: string | null;
    postal_code_plus_4?: string | null;
  } | null;
  deliverability?: "deliverable" | "undeliverable" | "vacant" | "unknown" | null;
  dpv_code?: "Y" | "D" | "S" | "N" | null;
  verified_at?: string | null;
  verified_by_source?: string | null;
  created_at: string;
}

/**
 * One per-source verification/registration history record. Previously
 * returned on `entity.sources[]`; it now lives on `entity.registrations[]`
 * because `sources` was repurposed to carry per-source blocks (see
 * `Entity.sources` below).
 */
export type SourceRegistration = Record<string, unknown>;

export interface Entity {
  object: "entity";
  id: string;
  legal_name: string;
  normalized_name?: string;
  entity_type: EntityType;
  status?: string;
  country: string;
  confidence?: number;
  /**
   * Enrichment fields populated from authoritative-source data (e.g.
   * SAM.gov). Null until the entity has been enriched; older entities
   * populate on the next sync.
   */
  dba_name?: string | null;
  website_url?: string | null;
  state_of_incorporation?: string | null;
  created_at: string;
  updated_at: string;
  identifiers: IdentifierRecord[];
  addresses: AddressRecord[];
  sam_gov?: Record<string, unknown> | null;
  /**
   * Per-source verification/registration history. Renamed from the legacy
   * top-level `sources` field — that name now holds the per-source block
   * map below.
   */
  registrations?: SourceRegistration[];
  /**
   * Per-source blocks keyed by source name (`ny_dos`, `sam_us`, etc.).
   * Each value is the source-specific block the API captured for this
   * entity, carrying `retrieved_at` plus the source's verbatim fields.
   * Empty `{}` until the API has data from at least one source. Use this
   * for source-nested display (e.g. "what does NY DOS say about this
   * vendor?"). See `/api-reference/lookup#entitysources--per-source-blocks`.
   */
  sources?: Record<string, Record<string, unknown>>;
  /**
   * Per-attribute provenance. Maps an entity field name (`legal_name`,
   * `dba_name`, `website_url`, `state_of_incorporation`) to the source id
   * that most recently wrote it. Empty `{}` until attribution data is
   * available. Treat absence of a key as "not yet attributed", not
   * "no source." See
   * `/api-reference/lookup#field_attribution--per-attribute-provenance`.
   */
  field_attribution?: Record<string, string>;
  /**
   * Public regulatory disclosures attached to the entity. A third lane
   * distinct from exclusions (procurement bars) and classifications
   * (self-declared statements) — these are externally-mandated
   * filings (FARA today, federal lobbying / state ethics planned).
   *
   * Empty `[]` until disclosure data is available for the entity. Customer
   * compliance code that asks "has this vendor disclosed any regulatory
   * filings?" keys on this lane. See
   * `/api-reference/lookup#entityregulatory_disclosures`.
   */
  regulatory_disclosures?: RegulatoryDisclosure[];
}

/**
 * One public regulatory filing attached to an entity. First source:
 * DOJ FARA (Foreign Agents Registration Act). Each row represents one
 * registrant↔foreign-principal binding. A registrant with N principals
 * lands as N rows sharing `registration_number` but with distinct ids.
 *
 * FARA registrants are still bid-eligible — the disclosure is just
 * regulatory transparency, not a bar. Procurement teams that key on
 * `exclusions` filter "barred"; teams that key on
 * `regulatory_disclosures` filter "needs additional review."
 *
 * Future regulatory feeds (federal lobbying, state ethics) widen
 * `source` and `disclosure_type` (closed sets on the API side that
 * widen with each new feed).
 */
export interface RegulatoryDisclosure {
  id: string;
  /** Currently `"fara_doj"`; widens with each new regulatory feed. */
  source: string;
  /** Currently `"foreign_agent"`; widens with each new feed. */
  disclosure_type: string;
  /** Agency-side filing identifier (FARA Registration Number). */
  registration_number: string;
  /**
   * Denormalized for the common FARA shape. Future disclosure types
   * may leave these null and surface their own fields on the raw row
   * stored server-side.
   */
  foreign_principal_name?: string | null;
  foreign_principal_country?: string | null;
  /** ISO-8601 date (YYYY-MM-DD) when the principal was added. */
  foreign_principal_registration_date?: string | null;
  /** ISO-8601 date when the binding ended, null while active. */
  foreign_principal_termination_date?: string | null;
  /** Free-form address dict; sub-fields nullable per row. */
  foreign_principal_address?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * Per-check result status. The SDK sends `Accept-Version` (see `request.ts`)
 * so the API returns the widened enum (`clear` / `exact_match` /
 * `probable_match`) verbatim instead of aliasing it to the legacy values.
 * `skipped` means the entity lacked the identifier the check needs.
 */
export type CheckStatus =
  | "pass" | "fail" | "inconclusive" | "error" | "pending"
  | "clear" | "exact_match" | "probable_match"
  | "skipped";

/** Lifecycle of a verification. */
export type VerificationStatus = "pending" | "in_progress" | "completed" | "failed" | "expired";

/**
 * Roll-up across every check in a verification. `partial` means some checks
 * passed and others did not reach a definitive pass. Null until the
 * verification completes.
 */
export type OverallResult = "pass" | "fail" | "partial" | "inconclusive";

/** Where a check result's data came from. */
export interface VerificationResultSource {
  name: string;
  display_name: string;
  retrieved_at: string;
  record_reference?: string | null;
  confidence: number;
  mapping_version: string;
  freshness: "daily_sync" | "realtime" | "manual_upload";
  raw_available: boolean;
}

export interface VerificationResult {
  id: string;
  check_type: CheckType;
  status: CheckStatus;
  confidence: number | null;
  explanation?: string | null;
  provider_name: string;
  origin?: string | null;
  determinism?: string | null;
  data_freshness_seconds?: number | null;
  evidence_uri?: string | null;
  executed_at: string | null;
  created_at: string;
  source: VerificationResultSource;
}

export interface Verification {
  object: "verification";
  id: string;
  entity_id: string;
  status: VerificationStatus;
  mode: VerificationMode;
  checks_requested: CheckType[];
  overall_result: OverallResult | null;
  initiated_by?: string | null;
  webhook_url: string | null;
  completed_at: string | null;
  created_at: string;
  results: VerificationResult[];
}

export interface VerificationBundle {
  object: "verification_bundle";
  entity: Entity;
  verification: Verification;
}

export interface UsageSummary {
  org_id: string;
  period_start: string;
  period_end: string;
  used: number;
  quota?: number | null;
  overage?: number;
}

export interface Provider {
  name: string;
  display_name?: string;
  status?: string;
  capabilities: Array<{
    check_type: CheckType;
    enabled: boolean;
    priority: number;
  }>;
}

/** How often a monitor re-runs its checks. */
export type MonitorFrequency = "daily" | "weekly" | "monthly";

export type MonitorStatus = "active" | "paused" | "cancelled";

export interface Monitor {
  object: "monitor";
  id: string;
  entity_id: string;
  checks: CheckType[];
  frequency: MonitorFrequency;
  /** Where change events are delivered. */
  webhook_url: string;
  /** When the signing secret was last issued or rotated. The secret itself is never returned here. */
  webhook_secret_rotated_at: string | null;
  status: MonitorStatus;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

/**
 * Returned by `monitors.create()` and `monitors.rotateSecret()` only.
 *
 * `webhook_secret` is shown exactly once. Store it: it is the key you pass to
 * `constructEvent()` to verify this monitor's deliveries. If you lose it,
 * rotate it.
 */
export interface MonitorWithSecret extends Monitor {
  webhook_secret: string;
}

/** One change a monitor detected, from `monitors.events()`. */
export interface MonitorEvent {
  object: "change_event";
  id: string;
  event_type: string;
  field_path: string | null;
  previous_value: unknown;
  new_value: unknown;
  detected_at: string;
  verification_id: string | null;
  notified: boolean;
}

/** Envelope shared by the API's offset-paginated list endpoints. */
export interface ListEnvelope<T> {
  object: "list";
  data: T[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

// ─── Webhook payloads ────────────────────────────────────────────────────

/** One change carried by a `monitoring.changes_detected` delivery. */
export interface WebhookChange {
  event_type: string;
  field_path: string | null;
  previous_value: unknown;
  new_value: unknown;
  detected_at: string;
}

export interface MonitoringChangesDetectedData {
  monitor_id: string;
  entity_id: string;
  changes: WebhookChange[];
  /** The verification that detected the change, or null if it no longer exists. */
  verification_id: string | null;
}

/**
 * Sent when a monitor detects a change. Each delivery carries exactly one
 * change, so a run that detects N changes sends N deliveries.
 */
export interface MonitoringChangesDetectedEvent {
  event: "monitoring.changes_detected";
  created_at: string;
  data: MonitoringChangesDetectedData;
}

export interface VerificationCompletedResult {
  check_type: CheckType;
  status: CheckStatus;
  confidence: number | null;
  provider_name: string;
  origin?: string | null;
}

export interface VerificationCompletedData {
  id: string;
  entity_id: string;
  status: VerificationStatus;
  overall_result: OverallResult | null;
  completed_at: string | null;
  results: VerificationCompletedResult[];
}

/** Sent when a verification created with `options.webhook_url` completes. */
export interface VerificationCompletedEvent {
  event: "verification.completed";
  created_at: string;
  data: VerificationCompletedData;
}

export type WebhookEvent = MonitoringChangesDetectedEvent | VerificationCompletedEvent;

export interface BulkJob {
  object: "bulk_job";
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  total?: number;
  succeeded?: number;
  failed?: number;
  result_url?: string | null;
}

// ─── Certifications ──────────────────────────────────────────────────────

export type CertificationStatus =
  | "active"
  | "pending"
  | "expired"
  | "suspended"
  | "revoked"
  | "denied"
  | "not_certified";

export type ClassificationCategory =
  | "small_business"
  | "minority_owned"
  | "women_owned"
  | "veteran_owned"
  | "service_disabled_veteran"
  | "disability_owned"
  | "lgbt_owned";

export type ClassificationEthnicSubcategory =
  | "african_american"
  | "hispanic_american"
  | "asian_pacific_american"
  | "subcontinent_asian_american"
  | "native_american"
  | "other";

export interface Classification {
  category: ClassificationCategory;
  /**
   * Meaningful only when `category === "minority_owned"`. The API enforces
   * this — every minority-owned classification carries a subcategory; no
   * other category does.
   */
  ethnic_subcategory: ClassificationEthnicSubcategory | null;
  /** The issuer's exact original wording, preserved verbatim. */
  raw_label: string;
}

/**
 * Coarse geographic + sector scope of the awarding authority. Mirrors
 * the API's `?scope=` filter on `GET /v1/certifications`.
 *
 * Today `'state'` (state UCP issuers — NY, TX, PA, OH, NJ, MI, …) and
 * `'federal'` (SBA 8(a) / HUBZone / SDB / AbilityOne / 8(a) JV) carry
 * data. The other three are reserved for future sources (EU/UK registers
 * → `'international'`, tribal nation authorities → `'tribal'`, private
 * national bodies like NMSDC/WBENC → `'private'`).
 */
export type CertificationIssuerScope =
  | "state"
  | "federal"
  | "international"
  | "tribal"
  | "private";

export interface Certification {
  object?: "certification";
  id: string;
  entity_id: string;
  /**
   * Human-readable legal name of the entity this cert is attached to.
   * Surfaces alongside `entity_id` so callers can render the entity
   * name without a follow-up `/v1/entities/lookup`. Nullable — the
   * API returns null when the entity row is missing (e.g. a cert
   * orphaned by a transactional delete).
   */
  entity_legal_name?: string | null;
  issuer: string;
  cert_number: string;
  status: CertificationStatus;
  issued_at: string | null;
  expires_at: string | null;
  /**
   * Derived at read time from `expires_at` against the per-request
   * `expiring_within_days` threshold (default 60). Always `false` on
   * certs with `expires_at: null` (non-expiring like ISO 9001
   * mid-cycle).
   */
  expiring_soon: boolean;
  retrieved_at: string;
  classifications: Classification[];
  /**
   * Coarse awarding-authority scope. Filter the list via `?scope=` on
   * `CertificationsListParams`.
   */
  issuer_scope?: CertificationIssuerScope | null;
  source: {
    name: string;
    mapping_version: string;
    retrieved_at: string;
  };
  created_at?: string;
  updated_at?: string;
}

export interface CertificationsListResponse {
  object: "list";
  data: Certification[];
  total: number;
  has_more: boolean;
  limit: number;
  offset: number;
}

export interface CertificationsListParams {
  entity_id?: string;
  /**
   * Identifier-resolved scoping. The server resolves these the same way as
   * `/v1/entities/lookup`, saving the caller a 2-step lookup-then-query
   * flow. Passing multiple identifiers that resolve to different
   * entities → 400.
   */
  tin?: string;
  uei?: string;
  duns?: string;
  lei?: string;
  vat_id?: string;
  state_entity_id?: string;
  npi?: string;
  issuer?: string;
  status?: CertificationStatus;
  /**
   * Coarse awarding-authority scope filter. Pass a single value (e.g.
   * `'federal'`) or an array — the SDK joins the array with `,` for the
   * API's comma-separated multi-select form (OR within the param). Closed
   * enum; unknown values 400 at the API.
   */
  scope?: CertificationIssuerScope | CertificationIssuerScope[];
  /** 1–365. Restricts to certs whose `expires_at` is within N days. */
  expiring_within_days?: number;
  /** Default 50, max 200. */
  limit?: number;
  /** Default 0. */
  offset?: number;
}
