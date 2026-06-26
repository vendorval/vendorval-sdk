/**
 * Error envelope mirrors the VendorVal API error shape:
 *   { error: { type, code, message, param?, details? } }
 */

export interface ApiErrorPayload {
  error: {
    type: string;
    code: string;
    message: string;
    param?: string;
    details?: unknown;
    candidates?: unknown;
  };
}

export interface VendorvalErrorInit {
  message: string;
  status: number;
  type: string;
  code: string;
  requestId: string | null;
  param?: string | undefined;
  details?: unknown;
  headers?: Headers | undefined;
}

export class VendorvalError extends Error {
  readonly status: number;
  readonly type: string;
  readonly code: string;
  readonly requestId: string | null;
  readonly param: string | undefined;
  readonly details: unknown;
  readonly headers: Headers | undefined;

  constructor(init: VendorvalErrorInit) {
    super(init.message);
    this.name = new.target.name;
    this.status = init.status;
    this.type = init.type;
    this.code = init.code;
    this.requestId = init.requestId;
    this.param = init.param;
    this.details = init.details;
    this.headers = init.headers;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class APIError extends VendorvalError {}

export class AuthenticationError extends VendorvalError {}

export class PermissionError extends VendorvalError {}

export class ValidationError extends VendorvalError {}

/**
 * 422 errors raised when a request can't be routed to a country/provider:
 *   - `country_required` — no explicit country and nothing inferable
 *   - `country_not_supported` — resolved country isn't in SUPPORTED_COUNTRIES
 *   - `identifier_not_supported_for_country` — e.g. `tin` with `country: "DE"`
 *   - `check_not_supported_for_country` — e.g. `sam_registration` for an EU country
 *   - `country_mismatch` — explicit country contradicts identifier inference
 *
 * The structured `details` payload (typed as `CountryErrorDetails`) carries
 * `country_resolved`, `identifiers_seen`, `recommended_action`,
 * `supported_countries`, and `candidates` where applicable. Subclass of
 * `ValidationError` so existing 422 catch-all handlers still match.
 */
export interface CountryErrorDetails {
  /** The country we resolved to (set on country_not_supported / mismatch / partial paths). */
  country_resolved?: string;
  /** Identifier types that were present on the request body. */
  identifiers_seen?: string[];
  /** Suggested next step (e.g. `"supply_country_field"`, `"use_vat_validation_for_eu"`). */
  recommended_action?: string;
  /** ISO 3166-1 alpha-2 codes the API currently supports (set on country_not_supported). */
  supported_countries?: string[];
  /** When `code === "country_mismatch"`, the conflicting country candidates. */
  candidates?: Array<{ country: string; source: string; via?: string }>;
}

export type CountryErrorCode =
  | "country_required"
  | "country_not_supported"
  | "identifier_not_supported_for_country"
  | "check_not_supported_for_country"
  | "country_mismatch";

export class CountryError extends ValidationError {
  declare readonly code: CountryErrorCode;
  declare readonly details: CountryErrorDetails | undefined;
}

const COUNTRY_ERROR_CODES: ReadonlySet<string> = new Set<CountryErrorCode>([
  "country_required",
  "country_not_supported",
  "identifier_not_supported_for_country",
  "check_not_supported_for_country",
  "country_mismatch",
]);

export class NotFoundError extends VendorvalError {}

export class ConflictError extends VendorvalError {
  readonly candidates: unknown[] | undefined;

  constructor(init: VendorvalErrorInit & { candidates?: unknown[] | undefined }) {
    super(init);
    this.candidates = init.candidates;
  }
}

export class RateLimitError extends VendorvalError {
  /** Retry-After in seconds, when the API supplied it. */
  readonly retryAfter: number | undefined;

  constructor(init: VendorvalErrorInit & { retryAfter?: number | undefined }) {
    super(init);
    this.retryAfter = init.retryAfter;
  }
}

export class ProviderError extends VendorvalError {}

export class APIConnectionError extends VendorvalError {
  constructor(message: string, requestId: string | null = null) {
    super({
      message,
      status: 0,
      type: "connection_error",
      code: "connection_error",
      requestId,
    });
  }
}

export class APITimeoutError extends APIConnectionError {
  constructor(timeoutMs: number, requestId: string | null = null) {
    super(`Request timed out after ${timeoutMs}ms`, requestId);
  }
}

const STATUS_CONSTRUCTORS: Record<number, new (init: VendorvalErrorInit) => VendorvalError> = {
  400: ValidationError,
  401: AuthenticationError,
  403: PermissionError,
  404: NotFoundError,
  // 422 is an invalid-request status the API uses for semantic-validation
  // failures (country routing emits 422 + CountryError, but other
  // semantic violations also land here). Mapping to ValidationError keeps
  // catch-all 4xx handlers working consistently.
  422: ValidationError,
  429: RateLimitError,
  502: ProviderError,
};

export function errorFromResponse(args: {
  status: number;
  payload: unknown;
  headers: Headers;
  requestId: string | null;
  fallbackMessage?: string;
}): VendorvalError {
  const { status, payload, headers, requestId } = args;
  const envelope = isApiErrorPayload(payload) ? payload.error : null;

  const type = envelope?.type ?? "api_error";
  const code = envelope?.code ?? `http_${status}`;
  const message =
    envelope?.message ??
    args.fallbackMessage ??
    `VendorVal API error (status ${status})`;
  const param = envelope?.param;
  const details = envelope?.details;

  const init: VendorvalErrorInit = {
    message,
    status,
    type,
    code,
    requestId,
    param,
    details,
    headers,
  };

  if (status === 409) {
    return new ConflictError({
      ...init,
      candidates: extractCandidates(envelope),
    });
  }

  if (status === 429) {
    return new RateLimitError({
      ...init,
      retryAfter: parseRetryAfter(headers),
    });
  }

  // 422 envelopes with a country-routing code surface as CountryError
  // (a ValidationError subclass) so consumers can switch on `err.code` and
  // inspect typed `err.details`.
  if (status === 422 && COUNTRY_ERROR_CODES.has(code)) {
    return new CountryError(init);
  }

  const Ctor = STATUS_CONSTRUCTORS[status] ?? APIError;
  return new Ctor(init);
}

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as Record<string, unknown>).error === "object"
  );
}

function extractCandidates(envelope: ApiErrorPayload["error"] | null): unknown[] | undefined {
  if (!envelope) return undefined;
  if (Array.isArray(envelope.candidates)) return envelope.candidates;
  // /v1/verify embeds candidates directly in the error envelope (see verify.ts:200).
  if (envelope.details && typeof envelope.details === "object" && "candidates" in (envelope.details as object)) {
    const c = (envelope.details as { candidates?: unknown }).candidates;
    if (Array.isArray(c)) return c;
  }
  return undefined;
}

export function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  // Per RFC 7231, Retry-After is either delta-seconds or HTTP-date.
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && !Number.isNaN(seconds)) {
    return seconds;
  }
  const epoch = Date.parse(raw);
  if (Number.isFinite(epoch)) {
    return Math.max(0, Math.ceil((epoch - Date.now()) / 1000));
  }
  return undefined;
}
