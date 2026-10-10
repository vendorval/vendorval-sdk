import { Page } from "../pagination.js";
import { performRequest, type ResolvedClientOptions } from "../request.js";
import type { CreateMonitorRequest, ListMonitorsQuery } from "../types/api.js";
import type {
  ListEnvelope,
  Monitor,
  MonitorEvent,
  MonitorWithSecret,
} from "../types/shared.js";

/**
 * Monitors re-run a set of checks on an entity at a fixed frequency and POST
 * each detected change to the monitor's `webhook_url`, signed with that
 * monitor's secret. Verify deliveries with `constructEvent()`.
 */
export class MonitorsResource {
  constructor(private readonly client: ResolvedClientOptions) {}

  /**
   * Create a monitor. The response carries `webhook_secret`, which is shown
   * only here: store it, because it is the key for verifying this monitor's
   * deliveries. Use `rotateSecret()` if it is lost.
   *
   * Not retried with an idempotency key: the API does not deduplicate
   * monitor creation, so a retried request after a lost response can create
   * a second monitor.
   */
  async create(
    request: CreateMonitorRequest,
  ): Promise<MonitorWithSecret & { _requestId: string | null }> {
    const res = await performRequest<MonitorWithSecret>(this.client, {
      method: "POST",
      path: "/v1/monitors",
      body: request,
    });
    return { ...res.data, _requestId: res.requestId };
  }

  async retrieve(id: string): Promise<Monitor & { _requestId: string | null }> {
    const res = await performRequest<Monitor>(this.client, {
      method: "GET",
      path: `/v1/monitors/${encodeURIComponent(id)}`,
    });
    return { ...res.data, _requestId: res.requestId };
  }

  /**
   * List the organization's monitors. Iterating the result with `for await`
   * (or calling `.all()`) follows every page.
   */
  async list(query: ListMonitorsQuery = {}): Promise<Page<Monitor>> {
    const fetchPage = async (offset: number): Promise<Page<Monitor>> => {
      const res = await performRequest<ListEnvelope<Monitor> | Monitor[]>(this.client, {
        method: "GET",
        path: "/v1/monitors",
        query: { limit: query.limit, offset },
      });
      return Page.fromResponse(res.data, fetchPage);
    };
    return fetchPage(query.offset ?? 0);
  }

  /** Cancel a monitor. It stops running and stops sending deliveries. */
  async delete(id: string): Promise<void> {
    await performRequest<void>(this.client, {
      method: "DELETE",
      path: `/v1/monitors/${encodeURIComponent(id)}`,
    });
  }

  /**
   * Issue a new webhook signing secret for a monitor. The new secret is
   * returned once, and the previous one stops being used for future
   * deliveries.
   */
  async rotateSecret(id: string): Promise<MonitorWithSecret & { _requestId: string | null }> {
    const res = await performRequest<MonitorWithSecret>(this.client, {
      method: "POST",
      path: `/v1/monitors/${encodeURIComponent(id)}/rotate-secret`,
    });
    return { ...res.data, _requestId: res.requestId };
  }

  /** Changes a monitor has detected, newest first. Follows every page when iterated. */
  async events(id: string, query: ListMonitorsQuery = {}): Promise<Page<MonitorEvent>> {
    const path = `/v1/monitors/${encodeURIComponent(id)}/events`;
    const fetchPage = async (offset: number): Promise<Page<MonitorEvent>> => {
      const res = await performRequest<ListEnvelope<MonitorEvent> | MonitorEvent[]>(this.client, {
        method: "GET",
        path,
        query: { limit: query.limit, offset },
      });
      return Page.fromResponse(res.data, fetchPage);
    };
    return fetchPage(query.offset ?? 0);
  }
}
