# vendorval-sdk

Official Node.js / TypeScript SDK for the [VendorVal API](https://docs.vendorval.com).

```bash
npm install vendorval-sdk
# or
pnpm add vendorval-sdk
# or
yarn add vendorval-sdk
```

Requires Node >=20. Set `VENDORVAL_API_KEY` before running these examples; identifiers below are illustrative.

## Quick start

```ts
import Vendorval from "vendorval-sdk";

const client = new Vendorval({
  apiKey: process.env.VENDORVAL_API_KEY!,
});

// 1) Look up an entity by identifier
const lookup = await client.entities.lookup({
  identifiers: { uei: "ABCD12345678" },
});

if (lookup.match === "not_found") {
  throw new Error("entity not in registry");
}

// 2) Run a verification and wait for the terminal result
const verified = await client.verifications.createAndWait({
  identifiers: [{ type: "uei", value: "ABCD12345678" }],
  legal_name: "Acme Federal Services LLC",
  checks: ["sam_registration"],
  mode: "cached",
});

console.log(verified.verification.overall_result);
```

The constructor reads `VENDORVAL_API_KEY` and `VENDORVAL_BASE_URL` from `process.env` if you don't pass them.

## Configuration

```ts
const client = new Vendorval({
  apiKey: "vv_live_…",
  baseUrl: "https://api.vendorval.com",
  timeout: 30_000,            // ms, default 60_000
  maxRetries: 2,              // default 2 (network errors, HTTP 408, 429, and 5xx; not 409)
  fetch: globalThis.fetch,    // injectable for tests / proxies
});
```

API keys are prefixed `vv_test_` (sandbox) or `vv_live_` (production). The SDK validates the prefix client-side and raises `AuthenticationError` immediately on a malformed key.

## Errors

All errors inherit from `VendorvalError` and expose `requestId`, `status`, `code`, `type`, and `message`.

```ts
import {
  VendorvalError,
  AuthenticationError,
  RateLimitError,
  ValidationError,
  NotFoundError,
  ConflictError,
} from "vendorval-sdk";

try {
  await client.verifications.create({ /* ... */ });
} catch (err) {
  if (err instanceof RateLimitError) {
    console.error("rate limited; retry after", err.retryAfter, "seconds");
  } else if (err instanceof ConflictError) {
    console.error("ambiguous match", err.candidates);
  }
}
```

## Pagination

`list` methods return an `AsyncIterable` so iteration stays source-compatible when cursor pagination ships:

```ts
for await (const monitor of client.monitors.list()) {
  console.log(monitor.id);
}
```

Materialize with `await client.monitors.list().all()` if you want an array.

## Webhooks

```ts
const event = client.webhooks.constructEvent(rawBody, signatureHeader, secret);
```

Pass the original raw request body and signature header to the verifier. This helper validates incoming events; it does not configure a webhook endpoint or enable delivery. Follow the API documentation for subscription and delivery setup.

## Logging the request id

Every API response (success or error) carries an `x-request-id`. Log it for support:

```ts
try {
  const r = await client.entities.lookup({ identifiers: { uei: "X" } });
  console.log("requestId=", r._requestId);
} catch (err) {
  console.error("requestId=", (err as VendorvalError).requestId);
}
```

## Versioning

The SDK pins to API version `v1`. The current API-version header sent on every request is exposed as `Vendorval.API_VERSION`.

## License

[MIT](./LICENSE)
