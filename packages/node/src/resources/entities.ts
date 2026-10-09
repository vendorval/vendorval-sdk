import { performRequest, type ResolvedClientOptions } from "../request.js";
import type { CreateEntityRequest, LookupRequest, LookupResponse } from "../types/api.js";
import type { Entity } from "../types/shared.js";

export class EntitiesResource {
  constructor(private readonly client: ResolvedClientOptions) {}

  async lookup(request: LookupRequest): Promise<LookupResponse & { _requestId: string | null }> {
    const res = await performRequest<LookupResponse>(this.client, {
      method: "POST",
      path: "/v1/entities/lookup",
      body: request,
    });
    return { ...res.data, _requestId: res.requestId };
  }

  /**
   * Create an entity explicitly. Most integrations should use
   * `verifications.create()` instead, which looks up or creates the entity
   * as part of verifying it.
   *
   * Not sent with an idempotency key: the API does not deduplicate this
   * route, so the key would be ignored.
   */
  async create(request: CreateEntityRequest): Promise<Entity & { _requestId: string | null }> {
    const res = await performRequest<Entity>(this.client, {
      method: "POST",
      path: "/v1/entities",
      body: request,
    });
    return { ...res.data, _requestId: res.requestId };
  }

  async retrieve(id: string): Promise<Entity & { _requestId: string | null }> {
    const res = await performRequest<Entity>(this.client, {
      method: "GET",
      path: `/v1/entities/${encodeURIComponent(id)}`,
    });
    return { ...res.data, _requestId: res.requestId };
  }
}
