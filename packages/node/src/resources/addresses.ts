import { performRequest, type ResolvedClientOptions } from "../request.js";
import type {
  AddressLookupRequest,
  AddressLookupResponse,
  AddressSuggestParams,
  AddressSuggestResponse,
} from "../types/shared.js";

/**
 * Phase S3 / S4 — standalone address endpoints.
 *
 * Both endpoints are FREE (no per-call meter), rate-limited per tenant to
 * align with USPS upstream + DB-load budgets. Use these for one-shot
 * address typeahead + verification (e.g. inside an onboarding form). For
 * audited verification records tied to an entity (with monitor
 * eligibility) attach the address to an entity and use
 * `verifications.create({ checks: ["usps_address"] })` instead.
 */
export class AddressesResource {
  constructor(private readonly client: ResolvedClientOptions) {}

  /**
   * Verify + standardize a US address via USPS Addresses v3.
   *
   * Outcomes (`deliverability` field):
   *   - `"deliverable"` — DPV Y/D/S and not vacant. Use `standardized` for the
   *     USPS-corrected form.
   *   - `"undeliverable"` — DPV N. USPS cannot route mail.
   *   - `"vacant"` — DPV Y but vacant=Y. Routable but no active recipient.
   *   - `"unknown"` — USPS didn't return a DPV confirmation.
   *
   * On `not_found` the api returns HTTP 404 — the SDK surfaces this as a
   * thrown `ApiError`. Callers that want a non-throw shape should catch
   * the 404 explicitly.
   */
  async lookup(
    request: AddressLookupRequest,
  ): Promise<AddressLookupResponse & { _requestId: string | null }> {
    const res = await performRequest<AddressLookupResponse>(this.client, {
      method: "POST",
      path: "/v1/addresses/lookup",
      body: request,
    });
    return { ...res.data, _requestId: res.requestId };
  }

  /**
   * Typeahead suggestions from the global `canonical_addresses` corpus,
   * ranked by pg_trgm similarity to `q`. NOT a USPS-verified surface —
   * call `lookup()` against the user's selection to USPS-verify before
   * persisting.
   *
   * `q` is required, minimum 3 characters. `state` is optional; when
   * supplied it pre-filters the corpus by USPS state code. `limit` defaults
   * to 10, max 25.
   */
  async suggest(
    params: AddressSuggestParams,
  ): Promise<AddressSuggestResponse & { _requestId: string | null }> {
    const query = new URLSearchParams();
    query.set("q", params.q);
    if (params.state) query.set("state", params.state);
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    const res = await performRequest<AddressSuggestResponse>(this.client, {
      method: "GET",
      path: `/v1/addresses/suggest?${query.toString()}`,
    });
    return { ...res.data, _requestId: res.requestId };
  }
}
