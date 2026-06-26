import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Vendorval, VendorvalError } from "../src/index.js";

describe("Vendorval client construction", () => {
  let originalApiKey: string | undefined;
  let originalBaseUrl: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.VENDORVAL_API_KEY;
    originalBaseUrl = process.env.VENDORVAL_BASE_URL;
    delete process.env.VENDORVAL_API_KEY;
    delete process.env.VENDORVAL_BASE_URL;
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.VENDORVAL_API_KEY = originalApiKey;
    } else {
      delete process.env.VENDORVAL_API_KEY;
    }
    if (originalBaseUrl !== undefined) {
      process.env.VENDORVAL_BASE_URL = originalBaseUrl;
    } else {
      delete process.env.VENDORVAL_BASE_URL;
    }
  });

  it("requires an API key", () => {
    expect(() => new Vendorval({})).toThrowError(VendorvalError);
  });

  it("rejects an API key without the vv_ prefix", () => {
    expect(() => new Vendorval({ apiKey: "sk_live_abcdef" })).toThrowError(/prefix/);
  });

  it("accepts a vv_test_ prefix", () => {
    const c = new Vendorval({ apiKey: "vv_test_abc123" });
    expect(c.options.apiKey).toBe("vv_test_abc123");
  });

  it("accepts a vv_live_ prefix", () => {
    const c = new Vendorval({ apiKey: "vv_live_xyz789" });
    expect(c.options.apiKey).toBe("vv_live_xyz789");
  });

  it("can be opted out of prefix validation", () => {
    const c = new Vendorval({ apiKey: "custom_internal_key", validateApiKey: false });
    expect(c.options.apiKey).toBe("custom_internal_key");
  });

  it("rejects non-positive timeout", () => {
    expect(() => new Vendorval({ apiKey: "vv_test_x", timeout: 0 })).toThrowError(/timeout/);
    expect(() => new Vendorval({ apiKey: "vv_test_x", timeout: -1 })).toThrowError(/timeout/);
    expect(() => new Vendorval({ apiKey: "vv_test_x", timeout: NaN })).toThrowError(/timeout/);
  });

  it("rejects non-integer or negative maxRetries", () => {
    expect(() => new Vendorval({ apiKey: "vv_test_x", maxRetries: -1 })).toThrowError(/maxRetries/);
    expect(() => new Vendorval({ apiKey: "vv_test_x", maxRetries: 1.5 })).toThrowError(/maxRetries/);
    expect(() => new Vendorval({ apiKey: "vv_test_x", maxRetries: NaN })).toThrowError(/maxRetries/);
  });

  it("falls back to env vars", () => {
    process.env.VENDORVAL_API_KEY = "vv_test_fromenv";
    process.env.VENDORVAL_BASE_URL = "https://staging.example/";
    const c = new Vendorval({});
    expect(c.options.apiKey).toBe("vv_test_fromenv");
    expect(c.options.baseUrl).toBe("https://staging.example");
  });

  it("calls the API with the bearer token, version header, and json body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ match: "not_found", entity: null }), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "req_test_1" },
      }),
    );
    const client = new Vendorval({
      apiKey: "vv_test_abc",
      baseUrl: "https://api.example",
      fetch: fetchMock,
    });

    const r = await client.entities.lookup({ identifiers: { uei: "X" } });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.example/v1/entities/lookup");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer vv_test_abc");
    expect(headers["X-VendorVal-API-Version"]).toBe(Vendorval.API_VERSION);
    expect(headers["User-Agent"]).toMatch(/^vendorval-node\//);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ identifiers: { uei: "X" } });
    expect(r.match).toBe("not_found");
    expect(r._requestId).toBe("req_test_1");
  });

  // Opt-in to the widened per-result enum is
  // SDK-default. Without this header the API would alias the new values
  // (clear / exact_match / probable_match) down to the legacy 4-value
  // enum for backward compatibility.
  it("auto-attaches Accept-Version on every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ match: "not_found", entity: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new Vendorval({
      apiKey: "vv_test_abc",
      baseUrl: "https://api.example",
      fetch: fetchMock,
    });

    await client.entities.lookup({ identifiers: { uei: "X" } });

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["Accept-Version"]).toBe(Vendorval.API_VERSION);
    // Sanity check the date string format. Lex-compared on the server
    // (apps/api/src/plugins/accept-version.ts), so the YYYY-MM-DD
    // shape matters.
    expect(headers["Accept-Version"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("auto-attaches Accept-Version on GET requests too (not just POST)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ object: "list", data: [], total: 0, has_more: false, limit: 50, offset: 0 }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const client = new Vendorval({
      apiKey: "vv_test_abc",
      baseUrl: "https://api.example",
      fetch: fetchMock,
    });

    await client.certifications.list();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/certifications");
    expect(init.method).toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["Accept-Version"]).toBe(Vendorval.API_VERSION);
  });
});

describe("CertificationsResource", () => {
  it("list() forwards filters as query params and unwraps the standard list envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            {
              object: "certification",
              id: "cert_01",
              entity_id: "ent_01",
              entity_legal_name: "Acme Federal LLC",
              issuer: "NY-DMWBD",
              cert_number: "NY-MWBE-1001",
              status: "active",
              issued_at: "2024-01-15",
              expires_at: "2027-01-15",
              expiring_soon: false,
              retrieved_at: "2026-05-11T08:00:00Z",
              classifications: [
                { category: "minority_owned", ethnic_subcategory: "african_american", raw_label: "BAA" },
              ],
              source: { name: "ny_dmwbd", mapping_version: "ny_dmwbd_v1", retrieved_at: "2026-05-11T08:00:00Z" },
            },
          ],
          total: 1,
          has_more: false,
          limit: 50,
          offset: 0,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new Vendorval({
      apiKey: "vv_test_abc",
      baseUrl: "https://api.example",
      fetch: fetchMock,
    });

    const page = await client.certifications.list({
      entity_id: "ent_01",
      issuer: "NY-DMWBD",
      status: "active",
      expiring_within_days: 30,
      limit: 25,
    });

    const [url] = fetchMock.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.searchParams.get("entity_id")).toBe("ent_01");
    expect(parsed.searchParams.get("issuer")).toBe("NY-DMWBD");
    expect(parsed.searchParams.get("status")).toBe("active");
    expect(parsed.searchParams.get("expiring_within_days")).toBe("30");
    expect(parsed.searchParams.get("limit")).toBe("25");

    expect(page.data).toHaveLength(1);
    expect(page.data[0]!.issuer).toBe("NY-DMWBD");
    expect(page.data[0]!.entity_legal_name).toBe("Acme Federal LLC");
    expect(page.data[0]!.classifications[0]!.category).toBe("minority_owned");
    // Pagination metadata surfaces on the Page so callers don't re-query
    // for the count.
    expect(page.total).toBe(1);
    expect(page.has_more).toBe(false);
    expect(page.limit).toBe(50);
    expect(page.offset).toBe(0);
  });

  it("retrieve() returns a single Certification and attaches the request id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "certification",
          id: "cert_01",
          entity_id: "ent_01",
          issuer: "NMSDC",
          cert_number: "NMSDC-12345",
          status: "active",
          issued_at: "2024-08-01",
          expires_at: "2026-08-01",
          expiring_soon: true,
          retrieved_at: "2026-05-11T08:00:00Z",
          classifications: [],
          source: { name: "nmsdc", mapping_version: "nmsdc_v1", retrieved_at: "2026-05-11T08:00:00Z" },
        }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": "req_cert_1" } },
      ),
    );
    const client = new Vendorval({
      apiKey: "vv_test_abc",
      baseUrl: "https://api.example",
      fetch: fetchMock,
    });

    const cert = await client.certifications.retrieve("cert_01");

    expect(cert.id).toBe("cert_01");
    expect(cert.expiring_soon).toBe(true);
    expect(cert.classifications).toEqual([]);
    expect(cert._requestId).toBe("req_cert_1");
  });
});
