/**
 * Retry decisions for the VendorVal API.
 *
 * Retryable:
 *   - network failures (no response received)
 *   - HTTP 408 Request Timeout
 *   - HTTP 429 Too Many Requests (honors `retry-after` / `x-ratelimit-reset`)
 *   - HTTP 5xx
 */

export interface RetryDecision {
  retry: boolean;
  /** Sleep before retrying, in ms. */
  delayMs: number;
}

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;

export function shouldRetryStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500 && status <= 599;
}

export function computeBackoffMs(attempt: number, jitter = Math.random()): number {
  // Exponential: 0.5s, 1s, 2s, 4s, ... capped.
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  // Full jitter in [exp/2, exp).
  return Math.floor(exp / 2 + jitter * (exp / 2));
}

export function decideRetryFromHeaders(
  attempt: number,
  status: number,
  headers: Headers,
): RetryDecision {
  if (!shouldRetryStatus(status)) {
    return { retry: false, delayMs: 0 };
  }

  if (status === 429) {
    const retryAfter = headerSeconds(headers.get("retry-after"));
    if (retryAfter !== null) {
      return { retry: true, delayMs: Math.min(MAX_DELAY_MS, retryAfter * 1000) };
    }
    const reset = headers.get("x-ratelimit-reset");
    if (reset) {
      // The header may be either an HTTP-date string (Date.parse-compatible)
      // or a bare unix-epoch-seconds integer. Date.parse returns NaN on the
      // latter, so detect numeric input first.
      const epochMs = /^\d+$/.test(reset.trim())
        ? Number.parseInt(reset, 10) * 1000
        : Date.parse(reset);
      if (Number.isFinite(epochMs)) {
        return {
          retry: true,
          delayMs: Math.min(MAX_DELAY_MS, Math.max(0, epochMs - Date.now())),
        };
      }
    }
  }

  return { retry: true, delayMs: computeBackoffMs(attempt) };
}

function headerSeconds(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n)) return n;
  const epoch = Date.parse(raw);
  if (Number.isFinite(epoch)) return Math.max(0, Math.ceil((epoch - Date.now()) / 1000));
  return null;
}
