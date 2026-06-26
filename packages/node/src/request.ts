import { APIConnectionError, APITimeoutError, errorFromResponse, VendorvalError } from "./errors.js";
import { generateIdempotencyKey } from "./idempotency.js";
import { decideRetryFromHeaders } from "./retry.js";
import { sleep } from "./sleep.js";
import { API_VERSION, VERSION } from "./version.js";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
  fetch?: FetchLike;
  /** Set false to disable client-side prefix validation (advanced). */
  validateApiKey?: boolean;
}

export interface ResolvedClientOptions {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  maxRetries: number;
  fetch: FetchLike;
}

export interface RequestOptions {
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  path: string;
  query?: Record<string, string | number | boolean | undefined> | undefined;
  body?: unknown;
  /** When true, auto-inject options.idempotency_key on retry if caller didn't supply one. */
  autoIdempotency?: boolean;
  signal?: AbortSignal | undefined;
  headers?: Record<string, string> | undefined;
  /** Override the client default. */
  maxRetries?: number | undefined;
  timeout?: number | undefined;
}

export interface ApiResponse<T> {
  data: T;
  requestId: string | null;
  headers: Headers;
  status: number;
}

const DEFAULT_BASE_URL = "https://api.vendorval.com";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const USER_AGENT = `vendorval-node/${VERSION} (node/${process.version.slice(1)})`;
const KEY_PREFIX = /^vv_(test|live)_/;

export function resolveOptions(opts: ClientOptions): ResolvedClientOptions {
  const apiKey = opts.apiKey ?? process.env.VENDORVAL_API_KEY ?? "";
  if (!apiKey) {
    throw new VendorvalError({
      message:
        "Missing API key. Pass `apiKey` to the Vendorval constructor or set VENDORVAL_API_KEY in the environment.",
      status: 0,
      type: "configuration_error",
      code: "missing_api_key",
      requestId: null,
    });
  }
  const validate = opts.validateApiKey !== false;
  if (validate && !KEY_PREFIX.test(apiKey)) {
    throw new VendorvalError({
      message:
        "API key has an unexpected prefix. Live keys start with `vv_live_`, test keys with `vv_test_`.",
      status: 0,
      type: "configuration_error",
      code: "invalid_api_key_prefix",
      requestId: null,
    });
  }

  const baseUrl = stripTrailingSlash(
    opts.baseUrl ?? process.env.VENDORVAL_BASE_URL ?? DEFAULT_BASE_URL,
  );

  const fetchImpl = opts.fetch ?? (globalThis.fetch as FetchLike | undefined);
  if (!fetchImpl) {
    throw new VendorvalError({
      message:
        "No fetch implementation found. Pass a `fetch` option (e.g. `node-fetch`) or use Node 18+.",
      status: 0,
      type: "configuration_error",
      code: "no_fetch",
      requestId: null,
    });
  }

  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new VendorvalError({
      message: "timeout must be a positive finite number of milliseconds.",
      status: 0,
      type: "configuration_error",
      code: "invalid_timeout",
      requestId: null,
    });
  }

  const maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new VendorvalError({
      message: "maxRetries must be a non-negative integer.",
      status: 0,
      type: "configuration_error",
      code: "invalid_max_retries",
      requestId: null,
    });
  }

  return {
    apiKey,
    baseUrl,
    timeout,
    maxRetries,
    fetch: fetchImpl,
  };
}

export async function performRequest<T>(
  client: ResolvedClientOptions,
  options: RequestOptions,
): Promise<ApiResponse<T>> {
  const url = buildUrl(client.baseUrl, options.path, options.query);
  const maxRetries = options.maxRetries ?? client.maxRetries;
  const timeout = options.timeout ?? client.timeout;

  // Generate the idempotency key (if requested) BEFORE the first attempt and
  // reuse it on every retry. If the first POST succeeded server-side but the
  // response was lost in transit, the retry sends the same key so the API
  // can deduplicate. Generating per-attempt would defeat that.
  let bodyForSend = options.autoIdempotency ? injectIdempotencyKey(options.body) : options.body;
  let lastError: VendorvalError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const externalAbort = options.signal;
    const onExternalAbort = () => controller.abort(externalAbort?.reason);
    if (externalAbort) {
      if (externalAbort.aborted) {
        controller.abort(externalAbort.reason);
      } else {
        externalAbort.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    let response: Response;
    try {
      response = await client.fetch(url, {
        method: options.method,
        headers: buildHeaders(client.apiKey, options),
        body: serializeBody(bodyForSend, options.method),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      externalAbort?.removeEventListener("abort", onExternalAbort);
      if (controller.signal.aborted && externalAbort?.aborted) {
        // Caller-driven cancellation — propagate as-is.
        throw err;
      }
      if (controller.signal.aborted) {
        lastError = new APITimeoutError(timeout);
      } else {
        lastError = new APIConnectionError(
          err instanceof Error ? err.message : "Network error",
        );
      }
      if (attempt >= maxRetries) throw lastError;
      const { delayMs } = decideRetryFromHeaders(attempt, 0, new Headers());
      await sleep(delayMs || 500 * 2 ** attempt, externalAbort);
      continue;
    } finally {
      clearTimeout(timer);
      externalAbort?.removeEventListener("abort", onExternalAbort);
    }

    const requestId = response.headers.get("x-request-id");

    if (response.ok) {
      const data = await parseBody<T>(response);
      return {
        data,
        requestId,
        headers: response.headers,
        status: response.status,
      };
    }

    const payload = await safeJson(response);
    const decision = decideRetryFromHeaders(attempt, response.status, response.headers);

    if (decision.retry && attempt < maxRetries) {
      await sleep(decision.delayMs, externalAbort);
      continue;
    }

    throw errorFromResponse({
      status: response.status,
      payload,
      headers: response.headers,
      requestId,
    });
  }

  // Unreachable: loop either returns or throws.
  throw lastError ?? new APIConnectionError("Request failed after retries");
}

function buildHeaders(apiKey: string, options: RequestOptions): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "User-Agent": USER_AGENT,
    "X-VendorVal-API-Version": API_VERSION,
    // Opt in to the widened per-result enum
    // (`clear` / `exact_match` / `probable_match`). The API aliases
    // these down to the legacy 4-value enum for callers without the
    // header. Sending the latest version on every install dogfoods the
    // new shape; old SDK installs keep working unchanged.
    "Accept-Version": API_VERSION,
    Accept: "application/json",
    ...options.headers,
  };
  if (options.body !== undefined && options.method !== "GET") {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: RequestOptions["query"],
): string {
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${baseUrl}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function serializeBody(body: unknown, method: RequestOptions["method"]): string | undefined {
  if (method === "GET" || body === undefined) return undefined;
  return JSON.stringify(body);
}

async function parseBody<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    const text = await response.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function injectIdempotencyKey(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const cloned = { ...(body as Record<string, unknown>) };
  const existingOptions = cloned.options;
  if (existingOptions && typeof existingOptions === "object") {
    const opts = { ...(existingOptions as Record<string, unknown>) };
    if (opts.idempotency_key === undefined) {
      opts.idempotency_key = generateIdempotencyKey();
    }
    cloned.options = opts;
  } else {
    cloned.options = { idempotency_key: generateIdempotencyKey() };
  }
  return cloned;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
