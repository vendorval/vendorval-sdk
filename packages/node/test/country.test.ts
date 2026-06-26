import { describe, expect, it, vi } from "vitest";

import {
  CountryError,
  ValidationError,
  Vendorval,
  type CountryErrorDetails,
  type SupportedCountriesResponse,
  type SupportedCountrySummary,
} from "../src/index.js";

/**
 * Country-routing smoke tests — covers the country surface end-to-end:
 *   - meta endpoints (listSupportedCountries, getSupportedCountry)
 *   - country forwarded on request bodies (lookup, verify, entities.create)
 *   - vat_id is accepted as an identifier
 *   - new check types pass through unchanged
 *   - the five 422 country errors round-trip as `CountryError`
 */

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": "req_phase_j", ...((init.headers as Record<string, string>) ?? {}) },
    ...init,
  });
}

function mockJson(body: unknown, init: ResponseInit = {}): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue(jsonResponse(body, init));
}

function client(fetchMock: typeof globalThis.fetch) {
  return new Vendorval({
    apiKey: "vv_test_phase_j",
    baseUrl: "https://api.example",
    fetch: fetchMock,
    maxRetries: 0,
  });
}

const SAMPLE_COUNTRY: SupportedCountrySummary = {
  code: "DE",
  name: "Germany",
  region: "european_union",
  tier: "full",
  available_identifiers: ["vat_id", "lei", "duns", "domain", "phone"],
  available_checks: ["vat_validation", "lei_validation", "sanctions_screening"],
};

const SAMPLE_LIST: SupportedCountriesResponse = {
  object: "list",
  total_count: 2,
  data: [
    {
      code: "US",
      name: "United States",
      region: "north_america",
      tier: "full",
      available_identifiers: ["uei", "tin", "duns", "cage", "lei", "domain", "phone", "state_registration"],
      available_checks: ["sam_registration", "uei_validation", "tin_match", "lei_validation", "sanctions_screening"],
    },
    SAMPLE_COUNTRY,
  ],
};

describe("meta resource", () => {
  it("listSupportedCountries hits /v1/meta/countries and returns the parsed list", async () => {
    const fetchMock = mockJson(SAMPLE_LIST);
    const c = client(fetchMock);

    const res = await c.meta.listSupportedCountries();

    const [url, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.example/v1/meta/countries");
    expect((init as RequestInit).method).toBe("GET");
    expect(res.object).toBe("list");
    expect(res.total_count).toBe(2);
    expect(res.data.map((c) => c.code)).toEqual(["US", "DE"]);
    expect(res._requestId).toBe("req_phase_j");
  });

  it("getSupportedCountry hits /v1/meta/countries/:code and uppercases the input", async () => {
    const fetchMock = mockJson(SAMPLE_COUNTRY);
    const c = client(fetchMock);

    const de = await c.meta.getSupportedCountry("de"); // mixed case

    const [url] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe("https://api.example/v1/meta/countries/DE");
    expect(de.code).toBe("DE");
    expect(de.region).toBe("european_union");
    expect(de.available_checks).toContain("vat_validation");
  });
});

describe("country routing on request bodies", () => {
  it("entities.lookup forwards `country` and `vat_id` to the API", async () => {
    const fetchMock = mockJson({ match: "not_found", entity: null });
    await client(fetchMock).entities.lookup({
      identifiers: { vat_id: "DE123456789" },
      country: "DE",
    });

    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      identifiers: { vat_id: "DE123456789" },
      country: "DE",
    });
  });

  it("verifications.create forwards `country` and the new check types", async () => {
    const fetchMock = mockJson({
      object: "verification_bundle",
      entity: { id: "ent_x", legal_name: "Acme GmbH", country: "DE" },
      verification: { id: "ver_x", status: "completed" },
    });
    await client(fetchMock).verifications.create({
      identifiers: [{ type: "vat_id", value: "DE123456789" }],
      checks: ["vat_validation", "lei_validation", "sanctions_screening"],
      country: "DE",
    });

    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.country).toBe("DE");
    expect(body.checks).toEqual(["vat_validation", "lei_validation", "sanctions_screening"]);
    expect(body.identifiers).toEqual([{ type: "vat_id", value: "DE123456789" }]);
  });

  it("entities.create forwards `country`", async () => {
    const fetchMock = mockJson({ id: "ent_x", legal_name: "Acme GmbH", country: "DE" });
    await client(fetchMock).entities.create({
      identifiers: [{ type: "vat_id", value: "DE123456789" }],
      legal_name: "Acme GmbH",
      entity_type: "corporation",
      country: "DE",
    });

    const [, init] = (fetchMock as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.country).toBe("DE");
    expect(body.entity_type).toBe("corporation");
  });
});

describe("CountryError mapping", () => {
  function rejects422(code: string, details: CountryErrorDetails) {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            code,
            message: `mocked ${code}`,
            param: "country",
            details,
          },
        }),
        {
          status: 422,
          headers: { "content-type": "application/json", "x-request-id": "req_country_err" },
        },
      ),
    );
    return client(fetchMock);
  }

  it("country_required → CountryError (also a ValidationError)", async () => {
    const c = rejects422("country_required", {
      identifiers_seen: ["domain"],
      recommended_action: "supply_country_field",
    });

    let caught: unknown;
    try {
      await c.entities.lookup({ identifiers: { domain: "acme.example" } });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CountryError);
    expect(caught).toBeInstanceOf(ValidationError); // subclass relationship
    const e = caught as CountryError;
    expect(e.code).toBe("country_required");
    expect(e.status).toBe(422);
    expect(e.details?.identifiers_seen).toEqual(["domain"]);
    expect(e.details?.recommended_action).toBe("supply_country_field");
  });

  it("country_not_supported → CountryError with supported_countries list", async () => {
    const c = rejects422("country_not_supported", {
      country_resolved: "JP",
      supported_countries: ["US", "DE", "FR"],
      recommended_action: "use_a_supported_country",
    });

    await expect(
      c.entities.lookup({ identifiers: { domain: "x.test" }, country: "JP" }),
    ).rejects.toMatchObject({
      name: "CountryError",
      code: "country_not_supported",
      details: expect.objectContaining({
        country_resolved: "JP",
        supported_countries: expect.arrayContaining(["US"]),
      }),
    });
  });

  it("identifier_not_supported_for_country → CountryError with country_resolved + recommendation", async () => {
    const c = rejects422("identifier_not_supported_for_country", {
      country_resolved: "DE",
      recommended_action: "use_vat_id_for_eu_entities",
      identifiers_seen: ["tin"],
    });

    await expect(
      c.entities.lookup({ identifiers: { tin: "12-3456789" }, country: "DE" }),
    ).rejects.toMatchObject({
      name: "CountryError",
      code: "identifier_not_supported_for_country",
      details: expect.objectContaining({
        recommended_action: "use_vat_id_for_eu_entities",
      }),
    });
  });

  it("check_not_supported_for_country → CountryError surfaced from /v1/verify", async () => {
    const c = rejects422("check_not_supported_for_country", {
      country_resolved: "DE",
      recommended_action: "use_vat_validation_for_eu",
    });

    await expect(
      c.verifications.create({
        identifiers: [{ type: "tin", value: "12-3456789" }],
        checks: ["tin_match"],
        country: "DE",
      }),
    ).rejects.toMatchObject({
      name: "CountryError",
      code: "check_not_supported_for_country",
      details: expect.objectContaining({ country_resolved: "DE" }),
    });
  });

  it("country_mismatch → CountryError with conflicting candidates", async () => {
    const c = rejects422("country_mismatch", {
      candidates: [
        { country: "DE", source: "explicit" },
        { country: "FR", source: "identifier", via: "vat_id" },
      ],
      recommended_action: "remove_explicit_country_or_fix_identifier",
    });

    await expect(
      c.entities.lookup({ identifiers: { vat_id: "FR12345678901" }, country: "DE" }),
    ).rejects.toMatchObject({
      name: "CountryError",
      code: "country_mismatch",
      details: expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ country: "DE" }),
          expect.objectContaining({ country: "FR" }),
        ]),
      }),
    });
  });

  it("non-country 422 codes map to plain ValidationError, NOT CountryError", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            code: "invalid_request",
            message: "something else",
          },
        }),
        { status: 422, headers: { "content-type": "application/json" } },
      ),
    );
    let caught: unknown;
    try {
      await client(fetchMock).entities.lookup({ identifiers: { uei: "X" } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught).not.toBeInstanceOf(CountryError);
  });
});
