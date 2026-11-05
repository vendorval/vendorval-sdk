import { inspect } from "node:util";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { APIConnectionError, Vendorval, VendorvalError } from "../src/index.js";

const KEY = "vv_test_DUMMYKEY";

function okFetch() {
  return vi.fn(
    async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("API key handling", () => {
  let originalApiKey: string | undefined;
  let originalBaseUrl: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.VENDORVAL_API_KEY;
    originalBaseUrl = process.env.VENDORVAL_BASE_URL;
    delete process.env.VENDORVAL_API_KEY;
    delete process.env.VENDORVAL_BASE_URL;
  });

  afterEach(() => {
    if (originalApiKey !== undefined) process.env.VENDORVAL_API_KEY = originalApiKey;
    else delete process.env.VENDORVAL_API_KEY;
    if (originalBaseUrl !== undefined) process.env.VENDORVAL_BASE_URL = originalBaseUrl;
    else delete process.env.VENDORVAL_BASE_URL;
  });

  describe("error messages", () => {
    it.each([
      ["a line feed", "vv_test_DUMMY\nKEY"],
      ["a carriage return", "vv_test_DUMMY\rKEY"],
      ["a NUL byte", "vv_test_DUMMY\0KEY"],
    ])("keeps a key containing %s out of the error, using the real fetch", async (_label, key) => {
      let message = "";
      try {
        const client = new Vendorval({
          apiKey: key,
          baseUrl: "http://127.0.0.1:9",
          maxRetries: 0,
        });
        await client.certifications.list();
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain("DUMMY");
    });

    it("removes the key from the text of a transport error", async () => {
      const client = new Vendorval({
        apiKey: KEY,
        maxRetries: 0,
        fetch: async () => {
          throw new TypeError(`rejected header value "Bearer ${KEY}"`);
        },
      });
      const err = await client.certifications.list().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(APIConnectionError);
      expect((err as Error).message).not.toContain(KEY);
      expect((err as Error).message).toContain("rejected header value");
    });
  });

  it("redacts the key a request sent, even if options.apiKey changed meanwhile", async () => {
    const client = new Vendorval({
      apiKey: KEY,
      maxRetries: 0,
      fetch: async () => {
        client.options.apiKey = "vv_test_ROTATED";
        throw new TypeError(`rejected header value "Bearer ${KEY}"`);
      },
    });
    const err = await client.certifications.list().catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(KEY);
  });

  describe("key format", () => {
    it.each([
      ["validated", true],
      ["unvalidated", false],
    ])("rejects control characters in a %s key without echoing it", (_label, validateApiKey) => {
      let caught: unknown;
      try {
        new Vendorval({ apiKey: "vv_test_DUMMY\nKEY", validateApiKey });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(VendorvalError);
      expect((caught as VendorvalError).code).toBe("invalid_api_key_format");
      expect((caught as VendorvalError).type).toBe("configuration_error");
      expect((caught as VendorvalError).message).not.toContain("DUMMY");
    });

    it("ignores whitespace around a key, as from a secret file", async () => {
      const fetchMock = okFetch();
      const client = new Vendorval({ apiKey: ` ${KEY}\n`, fetch: fetchMock });
      expect(client.options.apiKey).toBe(KEY);
      await client.certifications.list();
      const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    });

    it("trims a key read from the environment", () => {
      process.env.VENDORVAL_API_KEY = `${KEY}\n`;
      expect(new Vendorval({}).options.apiKey).toBe(KEY);
    });

    it("treats a blank key as missing", () => {
      expect(() => new Vendorval({ apiKey: " \n" })).toThrowError(/Missing API key/);
    });
  });

  describe("logging a client", () => {
    it("does not print the key through util.inspect", () => {
      const client = new Vendorval({ apiKey: KEY, fetch: okFetch() });
      expect(inspect(client, { depth: 8 })).not.toContain(KEY);
      expect(inspect(client.options)).not.toContain(KEY);
      expect(inspect(client.monitors, { depth: 8 })).not.toContain(KEY);
    });

    it("does not print the key through JSON.stringify", () => {
      const client = new Vendorval({ apiKey: KEY, fetch: okFetch() });
      expect(JSON.stringify(client)).not.toContain(KEY);
      expect(JSON.stringify(client.options)).not.toContain(KEY);
      expect(JSON.stringify({ nested: client.monitors })).not.toContain(KEY);
    });

    it("keeps options.apiKey readable and writable", async () => {
      const fetchMock = okFetch();
      const client = new Vendorval({ apiKey: KEY, fetch: fetchMock });
      expect(client.options.apiKey).toBe(KEY);
      client.options.apiKey = "vv_test_ROTATED";
      await client.certifications.list();
      const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer vv_test_ROTATED");
    });
  });

  describe("base URL", () => {
    it.each([
      "http://example.invalid",
      "http://api.vendorval.com",
      "HTTP://example.invalid",
      "http://10.0.0.5:8080",
      "http://localhost.example.com",
      "http://127.0.0.1.example.com",
      "http://localhost@example.com",
    ])("refuses to send the key to %s", (baseUrl) => {
      let caught: unknown;
      try {
        new Vendorval({ apiKey: KEY, baseUrl });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(VendorvalError);
      expect((caught as VendorvalError).code).toBe("insecure_base_url");
      expect((caught as VendorvalError).type).toBe("configuration_error");
      expect((caught as VendorvalError).message).not.toContain(KEY);
    });

    it("applies the same check to VENDORVAL_BASE_URL", () => {
      process.env.VENDORVAL_BASE_URL = "http://example.invalid";
      expect(() => new Vendorval({ apiKey: KEY })).toThrowError(/https/);
    });

    it.each([
      "https://api.vendorval.com",
      "https://staging.example/",
      "http://localhost",
      "http://localhost:3000",
      "http://LOCALHOST:3000",
      "http://api.localhost:3000",
      "http://127.0.0.1:3000",
      "http://127.8.9.10",
      "http://[::1]:3000",
    ])("accepts %s", (baseUrl) => {
      expect(() => new Vendorval({ apiKey: KEY, baseUrl })).not.toThrow();
    });

    it("can be opted out of for a trusted private network", () => {
      const client = new Vendorval({
        apiKey: KEY,
        baseUrl: "http://gateway.internal:8080",
        allowInsecureBaseUrl: true,
      });
      expect(client.options.baseUrl).toBe("http://gateway.internal:8080");
    });

    it("leaves a URL it cannot parse to fail on the first request, as before", () => {
      expect(() => new Vendorval({ apiKey: KEY, baseUrl: "not a url" })).not.toThrow();
    });
  });
});
