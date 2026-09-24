import { performRequest, type ResolvedClientOptions } from "../request.js";
import type {
  BankValidateRequest,
  BankValidateResponse,
} from "../types/api.js";

/**
 * Drop optional fields that are present but empty.
 *
 * The API requires a non-empty value for `bic`, `account_number` and
 * `account_holder_name`, and rejects the ENTIRE request when one arrives as
 * `""` — so a caller wiring a form field straight through would get a
 * validation error for a field they left blank. Required fields are never
 * touched: an empty `iban` still reaches the API and still fails, which is
 * correct, because the caller genuinely did not supply it.
 */
function stripEmptyOptionals(request: BankValidateRequest): BankValidateRequest {
  const keep = (value: string | undefined): boolean =>
    typeof value === "string" && value.trim() !== "";

  // Rebuilt per branch rather than looped over keys. A generic key loop needs a
  // cast back to the union, which TypeScript rightly refuses — and the explicit
  // form also makes it obvious which fields each scheme treats as optional.
  if (request.scheme === "iban") {
    return {
      scheme: "iban",
      iban: request.iban,
      ...(keep(request.bic) ? { bic: request.bic } : {}),
      ...(keep(request.account_holder_name)
        ? { account_holder_name: request.account_holder_name }
        : {}),
    };
  }
  return {
    scheme: "us_ach",
    routing_number: request.routing_number,
    ...(keep(request.account_number) ? { account_number: request.account_number } : {}),
    ...(keep(request.account_holder_name)
      ? { account_holder_name: request.account_holder_name }
      : {}),
  };
}

/**
 * Bank account validation.
 *
 * Structural checks on vendor payment details: an IBAN's check digits and
 * country layout, a BIC's structure, a US ABA routing number's checksum and
 * Federal Reserve range, and whether an IBAN and BIC name the same country.
 *
 * Read the boundary carefully, because it matters more here than elsewhere in
 * the API. These calls answer "are these details well-formed and internally
 * consistent". They do NOT answer "does this account exist" or "does it belong
 * to this vendor". Confirming those is account ownership verification, a
 * separate capability this endpoint does not provide.
 *
 * FREE (no per-call meter) and stateless: nothing is stored, and the account
 * number is never persisted or logged. That makes it safe to call from a
 * vendor-onboarding form's field validation without taking on any obligation
 * to store payment credentials.
 */
export class BankAccountsResource {
  constructor(private readonly client: ResolvedClientOptions) {}

  /**
   * Validate vendor bank details.
   *
   * Returns **HTTP 200 even when the account is structurally invalid** — that
   * is a successful answer to the question asked, reported as
   * `valid: false` with a finding per failed rule. A thrown `ApiError` means
   * the REQUEST was malformed, which is a different problem: check the
   * `scheme` and its required field.
   *
   * Never treat `valid: true` as approval to pay. The response carries a
   * `disclaimer` saying so; pass it through to whoever sees the result.
   *
   * @example
   * ```ts
   * const res = await client.bankAccounts.validate({
   *   scheme: "iban",
   *   iban: "DE89 3704 0044 0532 0130 00",
   *   bic: "DEUTDEFF",
   * });
   * if (!res.valid) {
   *   for (const f of res.findings.filter((x) => !x.valid)) {
   *     console.log(f.field, f.code, f.message);
   *   }
   * }
   * ```
   */
  async validate(
    request: BankValidateRequest,
  ): Promise<BankValidateResponse & { _requestId: string | null }> {
    const res = await performRequest<BankValidateResponse>(this.client, {
      method: "POST",
      path: "/v1/bank-accounts/validate",
      body: stripEmptyOptionals(request),
    });
    return { ...res.data, _requestId: res.requestId };
  }
}
