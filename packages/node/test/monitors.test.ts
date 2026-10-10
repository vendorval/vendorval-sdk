import { describe, expect, it, vi } from "vitest";

import { Vendorval } from "../src/index.js";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": "req_mon" },
  });
}

function client(fetchMock: ReturnType<typeof vi.fn>) {
  return new Vendorval({
    apiKey: "vv_test_monitors",
    baseUrl: "https://api.example",
    fetch: fetchMock as unknown as typeof fetch,
    maxRetries: 0,
  });
}

const MONITOR = {
  object: "monitor",
  id: "mon_1",
  entity_id: "ent_1",
  checks: ["sam_registration"],
  frequency: "weekly",
  webhook_url: "https://hooks.example.com/vendorval",
  webhook_secret_rotated_at: "2026-10-09T12:00:00.000Z",
  status: "active",
  last_run_at: null,
  next_run_at: "2026-10-16T12:00:00.000Z",
  created_at: "2026-10-09T12:00:00.000Z",
};

function page(ids: string[], offset: number, total: number, limit = 2) {
  return {
    object: "list",
    data: ids.map((id) => ({ ...MONITOR, id })),
    total,
    has_more: offset + ids.length < total,
    limit,
    offset,
  };
}

describe("monitors", () => {
  it("create() sends frequency and webhook_url and returns the one-time secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ...MONITOR, webhook_secret: "whsec_once" }, 201));
    const m = await client(fetchMock).monitors.create({
      entity_id: "ent_1",
      checks: ["sam_registration"],
      frequency: "weekly",
      webhook_url: "https://hooks.example.com/vendorval",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example/v1/monitors");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      entity_id: "ent_1",
      checks: ["sam_registration"],
      frequency: "weekly",
      webhook_url: "https://hooks.example.com/vendorval",
    });
    expect(m.webhook_secret).toBe("whsec_once");
    expect(m.frequency).toBe("weekly");
    expect(m._requestId).toBe("req_mon");
  });

  it("rotateSecret() POSTs to the rotate-secret route with an encoded id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ ...MONITOR, webhook_secret: "whsec_new" }));
    const m = await client(fetchMock).monitors.rotateSecret("mon/1");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example/v1/monitors/mon%2F1/rotate-secret");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(m.webhook_secret).toBe("whsec_new");
  });

  it("list() sends limit/offset only and follows has_more across pages", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(page(["mon_1", "mon_2"], 0, 5)))
      .mockResolvedValueOnce(json(page(["mon_3", "mon_4"], 2, 5)))
      .mockResolvedValueOnce(json(page(["mon_5"], 4, 5)));
    const first = await client(fetchMock).monitors.list({ limit: 2 });

    expect(first.data.map((m) => m.id)).toEqual(["mon_1", "mon_2"]);
    expect(first.hasMore).toBe(true);
    expect(first.total).toBe(5);

    const ids: string[] = [];
    for await (const m of first) ids.push(m.id);
    expect(ids).toEqual(["mon_1", "mon_2", "mon_3", "mon_4", "mon_5"]);

    const urls = fetchMock.mock.calls.map((c) => new URL(c[0] as string));
    expect(urls.map((u) => u.pathname)).toEqual(["/v1/monitors", "/v1/monitors", "/v1/monitors"]);
    expect(urls.map((u) => u.searchParams.get("offset"))).toEqual(["0", "2", "4"]);
    expect(urls.every((u) => u.searchParams.get("limit") === "2")).toBe(true);
    expect(urls.every((u) => !u.searchParams.has("status"))).toBe(true);
  });

  it("all() collects every page, and stops on an empty page that claims more", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(page(["mon_1"], 0, 3, 1)))
      .mockResolvedValueOnce(json({ object: "list", data: [], total: 3, has_more: true, limit: 1, offset: 1 }));
    const all = await (await client(fetchMock).monitors.list({ limit: 1 })).all();
    expect(all.map((m) => m.id)).toEqual(["mon_1"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("events() paginates the change-event list", async () => {
    const event = {
      object: "change_event",
      id: "evt_1",
      event_type: "status_changed",
      field_path: "sam_registration.status",
      previous_value: "pass",
      new_value: "fail",
      detected_at: "2026-10-09T12:00:00.000Z",
      verification_id: "ver_1",
      notified: true,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      json({ object: "list", data: [event], total: 1, has_more: false, limit: 20, offset: 0 }),
    );
    const events = await client(fetchMock).monitors.events("mon_1");
    expect(await events.all()).toEqual([event]);
    expect(new URL(fetchMock.mock.calls[0]![0] as string).pathname).toBe("/v1/monitors/mon_1/events");
  });
});
