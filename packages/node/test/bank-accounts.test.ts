import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Vendorval } from "../src/index.js";
import type { BankValidateResponse } from "../src/index.js";

/**
 * Covers the request the SDK sends and the shape it hands back. The API's own
 * validation rules are tested server-side; what matters here is that the
 * client builds a body the API accepts and does not mangle the response.
 */

const DISCLAIMER =
  "Structural validation only. This confirms the details are well-formed and " +
  "internally consistent. It does not confirm the account exists, and it does " +
  "not confirm the account belongs to this vendor. Do not treat it as approval to pay.";

function okResponse(overrides: Partial<BankValidateResponse> = {}): BankValidateResponse {
  return {
    valid: true,
    scheme: "iban",
    findings: [{ field: "iban", valid: true, code: "ok", message: "Well-formed." }],
    display: { iban: "DE89••••••••••••••3000" },
    countries: { iban: "DE" },
    disclaimer: DISCLAIMER,
    ...overrides,
  };
}

let calls: Array<{ url: string; init: RequestInit }> = [];
const originalFetch = globalThis.fetch;

function stubFetch(body: unknown, status = 200): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    calls.push({ url: input.toString(), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": "req_test" },
    });
  }) as typeof globalThis.fetch;
}

/**
 * The single captured request, asserting there was exactly one. Returns a
 * non-optional value so the tests read cleanly under
 * `noUncheckedIndexedAccess`, and fails loudly if no call was made — which
 * would otherwise show up as a confusing undefined dereference.
 */
function onlyCall(): { url: string; init: RequestInit } {
  if (calls.length !== 1) {
    throw new Error(`expected exactly 1 request, saw ${calls.length}`);
  }
  return calls[0] as { url: string; init: RequestInit };
}

function sentBody(): Record<string, unknown> {
  return JSON.parse(String(onlyCall().init.body)) as Record<string, unknown>;
}

function client(): Vendorval {
  return new Vendorval({ apiKey: "vv_test_key", baseUrl: "https://api.example.test/v1" });
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("bankAccounts.validate — request", () => {
  it("POSTs to the validate path with the IBAN body", async () => {
    stubFetch(okResponse());
    await client().bankAccounts.validate({
      scheme: "iban",
      iban: "DE89 3704 0044 0532 0130 00",
    });

    expect(onlyCall().url).toContain("/v1/bank-accounts/validate");
    expect(onlyCall().init.method).toBe("POST");
    expect(sentBody()).toEqual({
      scheme: "iban",
      iban: "DE89 3704 0044 0532 0130 00",
    });
  });

  it("passes a BIC through when supplied", async () => {
    stubFetch(okResponse());
    await client().bankAccounts.validate({
      scheme: "iban",
      iban: "DE89370400440532013000",
      bic: "DEUTDEFF",
    });
    expect(sentBody()).toEqual({
      scheme: "iban",
      iban: "DE89370400440532013000",
      bic: "DEUTDEFF",
    });
  });

  it("sends the us_ach body without any IBAN field", async () => {
    stubFetch(okResponse({ scheme: "us_ach", display: {}, countries: {} }));
    await client().bankAccounts.validate({
      scheme: "us_ach",
      routing_number: "021000021",
      account_number: "123456789",
    });
    const body = sentBody();
    expect(body).toEqual({
      scheme: "us_ach",
      routing_number: "021000021",
      account_number: "123456789",
    });
    expect(Object.keys(body)).not.toContain("iban");
  });
});

describe("bankAccounts.validate — response", () => {
  it("returns the body plus a request id", async () => {
    stubFetch(okResponse());
    const res = await client().bankAccounts.validate({
      scheme: "iban",
      iban: "DE89370400440532013000",
    });
    expect(res.valid).toBe(true);
    expect(res.scheme).toBe("iban");
    expect(res.display.iban).toBe("DE89••••••••••••••3000");
    expect(res._requestId).toBe("req_test");
  });

  it("does NOT throw on a structurally invalid account — that is a 200", async () => {
    // The distinction the API contract rests on. A thrown error must mean the
    // request was malformed, never that the account was bad.
    stubFetch(
      okResponse({
        valid: false,
        findings: [
          {
            field: "iban",
            valid: false,
            code: "bad_check_digits",
            message: "The check digits do not match the rest of the IBAN.",
          },
        ],
      }),
    );
    const res = await client().bankAccounts.validate({
      scheme: "iban",
      iban: "DE89370400440532013001",
    });
    expect(res.valid).toBe(false);
    expect(res.findings.map((f) => f.code)).toEqual(["bad_check_digits"]);
  });

  it("preserves every finding, including a cross-border mismatch", async () => {
    stubFetch(
      okResponse({
        valid: false,
        countries: { iban: "DE", bic: "NL" },
        findings: [
          { field: "iban", valid: true, code: "ok", message: "Well-formed." },
          { field: "bic", valid: true, code: "ok", message: "Well-formed." },
          {
            field: "iban_bic_agreement",
            valid: false,
            code: "country_mismatch",
            message: "The IBAN is a DE account but the BIC is registered in NL.",
          },
        ],
      }),
    );
    const res = await client().bankAccounts.validate({
      scheme: "iban",
      iban: "DE89370400440532013000",
      bic: "ABNANL2A",
    });
    expect(res.findings).toHaveLength(3);
    expect(res.findings.filter((f) => !f.valid).map((f) => f.code)).toEqual([
      "country_mismatch",
    ]);
  });

  it("carries the disclaimer through unmodified", async () => {
    // Consumers are told to surface this. If the SDK dropped or truncated it,
    // the caveat would silently stop reaching whoever sees the result.
    stubFetch(okResponse());
    const res = await client().bankAccounts.validate({
      scheme: "iban",
      iban: "DE89370400440532013000",
    });
    expect(res.disclaimer).toBe(DISCLAIMER);
    expect(res.disclaimer).toContain("does not confirm the account exists");
    expect(res.disclaimer).toContain("approval to pay");
  });

  it("throws when the REQUEST is rejected", async () => {
    stubFetch({ error: { code: "validation_error", message: "scheme is required" } }, 422);
    await expect(
      client().bankAccounts.validate({ scheme: "iban", iban: "" }),
    ).rejects.toThrow();
  });
});

describe("the resource is reachable from the client", () => {
  it("is exposed as client.bankAccounts", () => {
    const c = client();
    expect(c.bankAccounts).toBeDefined();
    expect(typeof c.bankAccounts.validate).toBe("function");
  });
});
