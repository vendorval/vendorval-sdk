import { describe, expect, it, vi } from "vitest";

import { computeBackoffMs, decideRetryFromHeaders, shouldRetryStatus } from "../src/retry.js";
import { Vendorval } from "../src/index.js";

describe("retry policy", () => {
  it("retries 408/429/5xx; not 4xx-other", () => {
    expect(shouldRetryStatus(408)).toBe(true);
    expect(shouldRetryStatus(429)).toBe(true);
    expect(shouldRetryStatus(500)).toBe(true);
    expect(shouldRetryStatus(503)).toBe(true);
    expect(shouldRetryStatus(400)).toBe(false);
    expect(shouldRetryStatus(401)).toBe(false);
    expect(shouldRetryStatus(404)).toBe(false);
    expect(shouldRetryStatus(200)).toBe(false);
  });

  it("backoff is bounded and grows with attempt", () => {
    const a0 = computeBackoffMs(0, 0);
    const a3 = computeBackoffMs(3, 0);
    expect(a0).toBeLessThanOrEqual(a3);
    expect(computeBackoffMs(10, 0.99)).toBeLessThanOrEqual(30_000);
  });

  it("honors retry-after on 429", () => {
    const headers = new Headers({ "retry-after": "7" });
    const d = decideRetryFromHeaders(0, 429, headers);
    expect(d.retry).toBe(true);
    expect(d.delayMs).toBe(7000);
  });

  it("honors http-date retry-after on 429", () => {
    const now = Date.UTC(2026, 0, 1, 0, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const headers = new Headers({ "retry-after": new Date(now + 3000).toUTCString() });
      const d = decideRetryFromHeaders(0, 429, headers);
      expect(d.retry).toBe(true);
      expect(d.delayMs).toBe(3000);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("retry behavior at the client level", () => {
  it("retries 5xx then succeeds", async () => {
    const success = new Response(JSON.stringify({ match: "not_found", entity: null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const failure = new Response(JSON.stringify({ error: { type: "x", code: "x", message: "x" } }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);
    const client = new Vendorval({
      apiKey: "vv_test_a",
      baseUrl: "https://api.example",
      fetch: fetchMock,
      maxRetries: 1,
    });
    const r = await client.entities.lookup({ identifiers: { uei: "X" } });
    expect(r.match).toBe("not_found");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("auto-injects idempotency_key on retried POST to /v1/verify", async () => {
    const failure = new Response(JSON.stringify({ error: { type: "rate_limit_error", code: "x", message: "x" } }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "0" },
    });
    const success = new Response(
      JSON.stringify({
        object: "verification_bundle",
        entity: { id: "ent_x" },
        verification: { id: "ver_x", status: "completed" },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure)
      .mockResolvedValueOnce(success);
    const client = new Vendorval({
      apiKey: "vv_test_a",
      baseUrl: "https://api.example",
      fetch: fetchMock,
      maxRetries: 1,
    });
    await client.verifications.create({
      identifiers: [{ type: "uei", value: "X" }],
      checks: ["sam_registration"],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    const secondBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    // Idempotency key must be present from the first attempt and identical
    // on the retry — that is the property that lets the API dedupe when the
    // first request was processed but its response was lost.
    expect(typeof firstBody.options.idempotency_key).toBe("string");
    expect(firstBody.options.idempotency_key.length).toBeGreaterThan(8);
    expect(secondBody.options.idempotency_key).toBe(firstBody.options.idempotency_key);
  });

  it("does not retry 4xx", async () => {
    const failure = new Response(JSON.stringify({ error: { type: "x", code: "x", message: "x" } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(failure);
    const client = new Vendorval({
      apiKey: "vv_test_a",
      baseUrl: "https://api.example",
      fetch: fetchMock,
      maxRetries: 3,
    });
    await expect(client.entities.lookup({ identifiers: {} } as never)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

});
