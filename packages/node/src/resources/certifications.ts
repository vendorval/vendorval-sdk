import { performRequest, type ResolvedClientOptions } from "../request.js";
import type {
  Certification,
  CertificationsListParams,
  CertificationsListResponse,
} from "../types/shared.js";

/**
 * `client.certifications.*` — read access to entity credentials
 * (state MWBE, NMSDC, WBENC, ISO, SOC 2, etc.). Phase N customer-facing
 * reshape, Workstream B.
 *
 * Today this surface is read-only; POST + DELETE (manual upload + revoke)
 * land in a follow-up SDK release once those API routes ship.
 */
export class CertificationsResource {
  constructor(private readonly client: ResolvedClientOptions) {}

  /**
   * List certifications for the calling org. Filters narrow the result
   * set on the server. Returns the full list envelope verbatim so
   * callers see pagination metadata (`total`, `has_more`, `limit`,
   * `offset`) without re-querying for the count.
   *
   * Async iteration helper:
   *
   *   for (const cert of (await client.certifications.list()).data) { … }
   *
   * Cursor pagination is a planned follow-up — when it lands, this
   * shape will accept a `cursor` param + return `next_cursor` without
   * a breaking change.
   */
  async list(
    params: CertificationsListParams = {},
  ): Promise<CertificationsListResponse & { _requestId: string | null }> {
    const query: Record<string, string | number | boolean | undefined> = {};
    if (params.entity_id !== undefined) query.entity_id = params.entity_id;
    // Identifier-resolved scoping — server normalizes + hashes + joins.
    if (params.tin !== undefined) query.tin = params.tin;
    if (params.uei !== undefined) query.uei = params.uei;
    if (params.duns !== undefined) query.duns = params.duns;
    if (params.lei !== undefined) query.lei = params.lei;
    if (params.vat_id !== undefined) query.vat_id = params.vat_id;
    if (params.state_entity_id !== undefined) query.state_entity_id = params.state_entity_id;
    if (params.npi !== undefined) query.npi = params.npi;
    if (params.issuer !== undefined) query.issuer = params.issuer;
    if (params.status !== undefined) query.status = params.status;
    // Phase 5 of data #155 — `?scope=` is comma-separated multi-select
    // at the wire level. SDK consumers can pass a single value or an
    // array; we join the array here so the typing stays ergonomic.
    if (params.scope !== undefined) {
      query.scope = Array.isArray(params.scope) ? params.scope.join(",") : params.scope;
    }
    if (params.expiring_within_days !== undefined) {
      query.expiring_within_days = params.expiring_within_days;
    }
    if (params.limit !== undefined) query.limit = params.limit;
    if (params.offset !== undefined) query.offset = params.offset;

    const res = await performRequest<CertificationsListResponse>(this.client, {
      method: "GET",
      path: "/v1/certifications",
      query,
    });

    return { ...res.data, _requestId: res.requestId };
  }

  /**
   * Fetch a single certification by its public id (`cert_…`).
   * Throws a NotFound error if the id doesn't resolve under the
   * caller's org.
   */
  async retrieve(id: string): Promise<Certification & { _requestId: string | null }> {
    const res = await performRequest<Certification>(this.client, {
      method: "GET",
      path: `/v1/certifications/${encodeURIComponent(id)}`,
    });
    return { ...res.data, _requestId: res.requestId };
  }
}
