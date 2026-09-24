import type {
  AddressInput,
  CheckType,
  EntityType,
  IdentifierInput,
  IdentifierType,
  LookupMode,
  SamRefreshMode,
  VerificationMode,
} from "./shared.js";

/**
 * Issuer-qualified identifier value. The five identifier types whose value
 * is meaningless without an issuer (`state_entity_id`, `diversity_cert_id`,
 * `contractor_license_id`, `medicaid_provider_id`, `wcb_employer_number`)
 * accept either an explicit `{ value, issuer }` object OR a string with
 * the issuer encoded inline as `"<ISSUER>:<value>"` (e.g. `"NY-DOS:1234567"`).
 * The API collapses both forms to the canonical `"<ISSUER>:<value>"` string
 * before lookup, so they're behaviorally equivalent.
 */
export interface IssuerQualifiedIdentifier {
  value: string;
  issuer: string;
}

export type IssuerQualifiedIdentifierInput = string | IssuerQualifiedIdentifier;

export interface LookupIdentifiers {
  uei?: string;
  tin?: string;
  duns?: string;
  cage?: string;
  lei?: string;
  /** EU VAT identification number, e.g. "DE123456789". The 2-letter prefix is the country. */
  vat_id?: string;
  name?: string;
  dba?: string;
  domain?: string;
  phone?: string;
  /** Deprecated alias for `state_entity_id`. */
  state_registration?: string;
  // Issuer-qualified identifiers. Each accepts either an embedded
  // `"<ISSUER>:<value>"` string or an explicit `{ value, issuer }` object.
  state_entity_id?: IssuerQualifiedIdentifierInput;
  diversity_cert_id?: IssuerQualifiedIdentifierInput;
  contractor_license_id?: IssuerQualifiedIdentifierInput;
  medicaid_provider_id?: IssuerQualifiedIdentifierInput;
  wcb_employer_number?: IssuerQualifiedIdentifierInput;
  /** National Provider Identifier (US healthcare). 10-digit numeric string. */
  npi?: string;
}

export interface LookupRequest {
  identifiers: LookupIdentifiers;
  legal_name?: string;
  mode?: LookupMode;
  /**
   * ISO 3166-1 alpha-2 country code (e.g. "US", "DE"). Optional — when
   * omitted the API resolves it via the precedence chain
   * (identifier inference → org default → 422 country_required).
   * See https://docs.vendorval.com/guides/country-handling.
   */
  country?: string;
  options?: {
    sam_refresh?: SamRefreshMode;
    [key: string]: unknown;
  };
}

/**
 * Outcome of the SAM.gov refresh path on a lookup.
 *
 *  - `cache_hit`      stored SAM data was fresh enough to serve; no call made
 *  - `sam_hydrated`   nothing stored; fetched from SAM and stored it
 *  - `sam_refreshed`  stored data was stale; re-fetched and updated
 *  - `sam_searched`   SAM was searched by name rather than resolved by id
 *  - `sam_not_found`  SAM was asked and has no record for the identifier
 *  - `cache_fallback` the SAM call failed, so stored data was served instead;
 *                     `stale` is true and `warning` says why
 *  - `not_attempted`  no call made — `policy` was `never`, or no
 *                     SAM-resolvable identifier was supplied
 */
export type RefreshStatus =
  | "cache_hit"
  | "sam_hydrated"
  | "sam_refreshed"
  | "sam_searched"
  | "sam_not_found"
  | "cache_fallback"
  | "not_attempted";

/**
 * The `refresh` block present on every lookup response.
 *
 * BREAKING in 0.9.0, and a correction rather than a redesign. This interface
 * previously declared `from_cache`, `age_seconds` and `refreshed_at`. The API
 * does not return those fields, so code reading them was reading `undefined`
 * at runtime. The seven fields below are what the API actually sends. Nothing
 * that worked before stops working.
 */
export interface LookupRefresh {
  /** Echoes the `sam_refresh` option sent with the request. */
  policy?: SamRefreshMode;
  /** Whether an upstream call actually went out. */
  attempted?: boolean;
  status?: RefreshStatus;
  /** True when served data is known to be out of date. */
  stale?: boolean;
  /** When the stored copy was fetched. */
  cached_retrieved_at?: string | null;
  /** When this response's live fetch happened, if one did. */
  retrieved_at?: string | null;
  /** Machine-readable reason when something degraded. */
  warning?: string | null;
}

/**
 * The richer outcome field on a lookup. `match` is kept for backward
 * compatibility; `status` is what new code should branch on.
 *
 *  - `cache_hit`     the canonical store already had the entity
 *  - `sync_pulled`   a live hot-pull landed it inside the request budget
 *  - `pending_async` the pull is still running. NOT a miss, even though
 *                    `match` reads `not_found` and `entity` is null
 *  - `not_found`     no match, and no pull is outstanding
 *
 * Optional: the field only appears once live pulls are enabled in the
 * environment being called. Treat a missing `status` as "fall back to `match`".
 */
export type LookupStatus =
  | "cache_hit"
  | "sync_pulled"
  | "pending_async"
  | "not_found";

export interface LookupHotPull {
  correlation_id: string;
  /** Present on `pending_async` — poll `/v1/entities/lookup/jobs/{id}`. */
  poll_url?: string;
  /** Present on a terminal `not_found` that a pull actually attempted. */
  reason?: string;
}

export interface LookupResponse {
  match: "exact" | "fuzzy" | "not_found";
  /**
   * Only present on `match: "fuzzy"`. Omitted on `exact` (where it would
   * conflate identifier strength with match certainty) and `not_found`.
   */
  confidence?: number;
  matched_on?: IdentifierType[] | string[];
  entity: import("./shared.js").Entity | null;
  candidates?: Array<{
    entity: import("./shared.js").Entity;
    score: number;
    matched_identifiers?: string[];
  }>;
  refresh?: LookupRefresh;
  status?: LookupStatus;
  hot_pull?: LookupHotPull;
}

// ─── Bank account validation ──────────────────────────────────────────────

/**
 * Structural validation of vendor payment details.
 *
 * A discriminated union on `scheme`, mirroring the API. The two schemes share
 * nothing, so a union rather than a bag of optional fields: the server rejects
 * `{}` and any cross-scheme payload.
 */
export type BankValidateRequest =
  | BankValidateIbanRequest
  | BankValidateUsAchRequest;

export interface BankValidateIbanRequest {
  scheme: "iban";
  /** Spaces, dashes and lowercase are accepted and normalized server-side. */
  iban: string;
  /** Optional. Validated, and its country compared against the IBAN's. */
  bic?: string;
  /**
   * Optional and NOT validated at this tier. Matching a name to an account
   * requires ownership verification, which this endpoint does not do.
   */
  account_holder_name?: string;
}

export interface BankValidateUsAchRequest {
  scheme: "us_ach";
  /** 9-digit ABA number. Dashes and spaces accepted. */
  routing_number: string;
  /**
   * Optional. US account numbers carry no checksum, so nothing structural can
   * be verified — supplied only so the response can return a masked form. It
   * is never stored or logged.
   */
  account_number?: string;
  account_holder_name?: string;
}

export interface BankValidationFinding {
  /** `iban` | `bic` | `routing_number` | `iban_bic_agreement`. */
  field: string;
  valid: boolean;
  /** `ok` when the rule passed; otherwise the specific failure code. */
  code: string;
  /** Safe to show a user. Never contains the value that was sent. */
  message: string;
}

/** Masked display forms. Safe to store and render; the input is not. */
export interface BankValidateDisplay {
  iban?: string;
  account_number?: string;
}

/** Countries derived from the input. Empty for `us_ach`. */
export interface BankValidateCountries {
  iban?: string;
  bic?: string;
}

/**
 * Result of a structural validation.
 *
 * `valid` means the details are well-formed and internally consistent, and
 * NOTHING more. It is not evidence that the account exists, that it is open,
 * or that it belongs to the vendor named — confirming those is account
 * ownership verification, which this endpoint does not perform.
 *
 * `disclaimer` restates that in the payload. Surface it; do not swallow it.
 */
export interface BankValidateResponse {
  valid: boolean;
  scheme: "iban" | "us_ach";
  /** One entry per rule that ran. Rules are skipped, not piled up. */
  findings: BankValidationFinding[];
  display: BankValidateDisplay;
  countries: BankValidateCountries;
  disclaimer: string;
}

export interface CreateEntityRequest {
  identifiers: IdentifierInput[];
  legal_name: string;
  entity_type: EntityType;
  country?: string;
  address?: AddressInput;
}

export interface CreateVerificationRequest {
  entity_id: string;
  checks: CheckType[];
  mode?: VerificationMode;
  options?: {
    sync?: boolean;
    webhook_url?: string;
    idempotency_key?: string;
  };
}

// Object-keyed identifier input accepted by `/v1/verify`. Mirrors the keys
// the API allows (the canonical IDENTIFIER_TYPES — `name` and `dba` are
// fuzzy-lookup helpers, not identifiers, so they're excluded here).
export type VerifyIdentifierObject = Omit<LookupIdentifiers, "name" | "dba">;

// `/v1/verify` accepts identifiers as either the recommended object form
// (e.g. `{ uei: "..." }`) or the legacy array of `{type, value}` pairs.
export type VerifyIdentifiers = VerifyIdentifierObject | IdentifierInput[];

export interface VerifyRequest {
  identifiers: VerifyIdentifiers;
  legal_name?: string;
  entity_type?: EntityType;
  country?: string;
  address?: AddressInput;
  checks: CheckType[];
  mode?: VerificationMode;
  options?: {
    sync?: boolean;
    webhook_url?: string;
    idempotency_key?: string;
    create_if_not_found?: boolean;
    match_threshold?: number;
  };
}

export interface CreateMonitorRequest {
  entity_id: string;
  checks: CheckType[];
  cadence: string;
}

export type ListMonitorsQuery = {
  status?: "active" | "paused";
  limit?: number;
};
