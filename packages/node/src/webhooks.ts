import { createHmac, timingSafeEqual } from "node:crypto";

import { VendorvalError } from "./errors.js";
import type { WebhookEvent } from "./types/shared.js";

/** `sha256=<hex>`: HMAC-SHA256 of `"<timestamp>.<raw body>"` with the signing secret. */
export const WEBHOOK_SIGNATURE_HEADER = "x-etp-signature";
/** Unix time in seconds when the delivery was signed. Part of the signed string. */
export const WEBHOOK_TIMESTAMP_HEADER = "x-etp-timestamp";
/** Stable per logical delivery; retries reuse it. Use it to drop duplicates. */
export const WEBHOOK_DELIVERY_ID_HEADER = "x-etp-delivery-id";
/** The event name, e.g. `monitoring.changes_detected`. */
export const WEBHOOK_EVENT_HEADER = "x-etp-event";

/** Default maximum age (and clock skew) of a delivery, in seconds. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Request headers as most frameworks expose them: a Fetch `Headers` object
 * (Next.js, Hono, Workers) or Node's lower-cased header record (Express,
 * Fastify, `node:http`).
 */
export type WebhookHeaders =
  | Headers
  | Record<string, string | string[] | undefined>;

export interface ConstructEventOptions {
  /**
   * Reject deliveries whose timestamp is further than this from the current
   * time, in seconds. Default 300 (5 minutes). This is what stops a captured
   * delivery from being replayed later.
   */
  tolerance?: number;
  /** Current time in seconds. For tests. */
  now?: number;
}

/**
 * Verify a VendorVal webhook delivery and return its parsed payload.
 *
 * VendorVal signs every delivery with HMAC-SHA256. The signed string is the
 * `X-ETP-Timestamp` value, a `.`, and the raw request body; the result is
 * sent hex-encoded as `X-ETP-Signature: sha256=<hex>`. This function
 * recomputes that signature with your secret, compares it in constant time,
 * and rejects deliveries outside the tolerance window.
 *
 * The secret is the monitor's `webhook_secret`, returned once by
 * `monitors.create()` and `monitors.rotateSecret()`.
 *
 * Pass the body exactly as received. Re-serializing parsed JSON changes the
 * bytes and the signature will not match.
 *
 * Deliveries are at-least-once. Use the `X-ETP-Delivery-Id` header to ignore
 * repeats.
 *
 * @throws VendorvalError with `type: "webhook_error"` and one of these codes:
 *   `missing_secret`, `missing_signature_header`, `missing_timestamp_header`,
 *   `invalid_signature_header`, `invalid_timestamp`, `timestamp_out_of_range`,
 *   `signature_mismatch`, `invalid_payload`.
 */
export function constructEvent(
  payload: string | Uint8Array,
  headers: WebhookHeaders,
  secret: string,
  options: ConstructEventOptions = {},
): WebhookEvent {
  if (typeof headers !== "object" || headers === null) {
    throw new TypeError(
      "constructEvent() takes the request headers, not a signature string. Pass req.headers; " +
        "the SDK reads X-ETP-Signature and X-ETP-Timestamp from it.",
    );
  }
  if (!secret) {
    throw webhookError("A webhook signing secret is required.", "missing_secret");
  }
  const signature = readHeader(headers, WEBHOOK_SIGNATURE_HEADER);
  if (!signature) {
    throw webhookError("The X-ETP-Signature header is missing.", "missing_signature_header");
  }
  const timestamp = readHeader(headers, WEBHOOK_TIMESTAMP_HEADER);
  if (!timestamp) {
    throw webhookError("The X-ETP-Timestamp header is missing.", "missing_timestamp_header");
  }

  const match = /^sha256=([0-9a-f]{64})$/i.exec(signature.trim());
  if (!match) {
    throw webhookError(
      "The X-ETP-Signature header is not in the form sha256=<hex>.",
      "invalid_signature_header",
    );
  }
  const ts = timestamp.trim();
  if (!/^\d{1,12}$/.test(ts)) {
    throw webhookError("The X-ETP-Timestamp header is not a Unix time in seconds.", "invalid_timestamp");
  }

  const tolerance = options.tolerance ?? DEFAULT_WEBHOOK_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const age = Math.abs(now - Number(ts));
  if (age > tolerance) {
    throw webhookError(
      `Webhook timestamp is outside the tolerance window (${age}s > ${tolerance}s).`,
      "timestamp_out_of_range",
    );
  }

  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  const expected = createHmac("sha256", secret).update(`${ts}.`, "utf8").update(body).digest();
  const received = Buffer.from(match[1]!.toLowerCase(), "hex");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw webhookError("Webhook signature does not match.", "signature_mismatch");
  }

  try {
    return JSON.parse(body.toString("utf8")) as WebhookEvent;
  } catch {
    throw webhookError("Webhook payload is not valid JSON.", "invalid_payload");
  }
}

function readHeader(headers: WebhookHeaders, name: string): string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  let value = record[name];
  if (value === undefined) {
    const key = Object.keys(record).find((k) => k.toLowerCase() === name);
    value = key === undefined ? undefined : record[key];
  }
  return Array.isArray(value) ? value[0] : value;
}

function webhookError(message: string, code: string): VendorvalError {
  return new VendorvalError({
    message,
    status: 0,
    type: "webhook_error",
    code,
    requestId: null,
  });
}
