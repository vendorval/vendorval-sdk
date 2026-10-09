import { APITimeoutError } from "../errors.js";
import { performRequest, type ResolvedClientOptions } from "../request.js";
import { sleep, throwIfAborted } from "../sleep.js";
import type { CreateVerificationRequest, VerifyRequest } from "../types/api.js";
import type { Verification, VerificationBundle } from "../types/shared.js";

const TERMINAL_STATUSES = new Set<Verification["status"]>(["completed", "failed"]);

export interface CreateAndWaitOptions {
  /** Total wait budget in ms. Default 5 minutes. */
  timeout?: number;
  /** Initial poll interval in ms. Doubles up to a 30s cap. */
  pollInterval?: number;
  signal?: AbortSignal;
}

/** Per-request overrides accepted by the resource methods. */
export interface RequestOverrides {
  signal?: AbortSignal;
  /** Override the client's default request timeout (ms). */
  timeout?: number;
}

export class VerificationsResource {
  constructor(private readonly client: ResolvedClientOptions) {}

  /**
   * Two flavors of "create" exist on the API:
   *
   *   POST /v1/verifications  — requires entity_id; returns a Verification
   *   POST /v1/verify         — looks up/creates the entity then verifies;
   *                             returns a VerificationBundle (sync 200,
   *                             pending 202, ambiguous 409 → ConflictError)
   *
   * `create()` calls `/v1/verify` because it covers both cases. Use
   * `createForEntity()` when you already have an entity id.
   */
  async create(
    request: VerifyRequest,
    reqOptions: RequestOverrides = {},
  ): Promise<VerificationBundle & { _requestId: string | null; _status: number }> {
    const res = await performRequest<VerificationBundle>(this.client, {
      method: "POST",
      path: "/v1/verify",
      body: request,
      autoIdempotency: true,
      signal: reqOptions.signal,
      timeout: reqOptions.timeout,
    });
    return { ...res.data, _requestId: res.requestId, _status: res.status };
  }

  async createForEntity(
    request: CreateVerificationRequest,
    reqOptions: RequestOverrides = {},
  ): Promise<Verification & { _requestId: string | null; _status: number }> {
    const res = await performRequest<Verification>(this.client, {
      method: "POST",
      path: "/v1/verifications",
      body: request,
      autoIdempotency: true,
      signal: reqOptions.signal,
      timeout: reqOptions.timeout,
    });
    return { ...res.data, _requestId: res.requestId, _status: res.status };
  }

  async retrieve(
    id: string,
    reqOptions: RequestOverrides = {},
  ): Promise<Verification & { _requestId: string | null }> {
    const res = await performRequest<Verification>(this.client, {
      method: "GET",
      path: `/v1/verifications/${encodeURIComponent(id)}`,
      signal: reqOptions.signal,
      timeout: reqOptions.timeout,
    });
    return { ...res.data, _requestId: res.requestId };
  }

  /**
   * Submit and poll until the verification reaches a terminal status, the
   * timeout elapses, or the signal aborts.
   */
  async createAndWait(
    request: VerifyRequest,
    options: CreateAndWaitOptions = {},
  ): Promise<VerificationBundle> {
    // Honor an already-aborted signal before we make any server-side change.
    throwIfAborted(options.signal);
    const timeoutMs = options.timeout ?? 5 * 60_000;
    const pollMin = options.pollInterval ?? 1_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError("timeout must be a positive finite number of milliseconds");
    }
    if (!Number.isFinite(pollMin) || pollMin <= 0) {
      throw new RangeError("pollInterval must be a positive finite number of milliseconds");
    }
    const pollMax = 30_000;
    const deadline = Date.now() + timeoutMs;

    // Forward the caller's abort signal AND a per-call timeout equal to the
    // remaining budget to every HTTP call. Otherwise, a single in-flight
    // request would silently overshoot `timeout`, and an `abort()` would only
    // be honored between polls instead of cancelling the live request.
    const remaining = (): number => Math.max(1, deadline - Date.now());

    const initial = await this.create(request, {
      signal: options.signal,
      timeout: remaining(),
    });
    if (initial.verification.status && TERMINAL_STATUSES.has(initial.verification.status)) {
      return initial;
    }

    let interval = pollMin;
    while (Date.now() < deadline) {
      throwIfAborted(options.signal);
      await sleep(Math.min(interval, deadline - Date.now()), options.signal);
      const refreshed = await this.retrieve(initial.verification.id, {
        signal: options.signal,
        timeout: remaining(),
      });
      if (TERMINAL_STATUSES.has(refreshed.status)) {
        return {
          object: "verification_bundle",
          entity: initial.entity,
          verification: refreshed,
        };
      }
      interval = Math.min(pollMax, Math.floor(interval * 2));
    }

    throw new APITimeoutError(timeoutMs, initial._requestId);
  }
}

