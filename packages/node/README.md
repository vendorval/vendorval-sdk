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

API keys are prefixed `vv_test_` (sandbox), `vv_live_` (production) or `vv_mcp_` (keys issued for MCP clients). The constructor checks the prefix and throws a `VendorvalError` with `code: "invalid_api_key_prefix"` on anything else, before any request is sent.

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

List methods return a `Page`. Iterating it with `for await` walks every page: while the API reports `has_more`, the SDK requests the next page at the following offset.

```ts
for await (const monitor of await client.monitors.list({ limit: 50 })) {
  console.log(monitor.id);
}

// Or collect every item into an array.
const monitors = await (await client.monitors.list()).all();
```

For one page at a time, read `page.data` and `page.hasMore`, and call `page.nextPage()` (it returns `null` after the last page).

## Monitors and webhooks

A monitor re-runs checks on an entity at a fixed frequency and POSTs each detected change to its `webhook_url`. Every monitor has its own signing secret, returned once when the monitor is created:

```ts
const monitor = await client.monitors.create({
  entity_id: "ent_123",
  checks: ["sam_exclusion", "sanctions_screening"],
  frequency: "daily", // "daily" | "weekly" | "monthly"
  webhook_url: "https://example.com/webhooks/vendorval",
});
// Store this. It is not returned again; client.monitors.rotateSecret(id) issues a new one.
saveSecret(monitor.id, monitor.webhook_secret);
```

Verify each delivery with `constructEvent`, passing the raw request body, the request headers and that monitor's secret:

```ts
import { constructEvent, WEBHOOK_DELIVERY_ID_HEADER } from "vendorval-sdk";

// Express: app.post("/webhooks/vendorval", express.raw({ type: "application/json" }), handler)
const event = constructEvent(req.body, req.headers, secret);
const deliveryId = req.get(WEBHOOK_DELIVERY_ID_HEADER);
```

`constructEvent` checks the `X-ETP-Signature` header (`sha256=<hex>`, an HMAC-SHA256 of `<X-ETP-Timestamp>.<raw body>`) in constant time, and rejects deliveries whose `X-ETP-Timestamp` is more than 300 seconds from now (`{ tolerance }` changes that). It throws a `VendorvalError` with `type: "webhook_error"` on any failure. Use the raw body: re-serializing parsed JSON changes the bytes and the signature will not match.

Deliveries are at-least-once. Retries of the same delivery reuse `X-ETP-Delivery-Id`, so record it and ignore repeats. Each `monitoring.changes_detected` delivery carries one change in `event.data.changes`, and `event.data.monitor_id` tells you which monitor's secret to use.

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

The SDK calls the `v1` API and sends `Accept-Version: <date>` on every request so a given SDK release keeps receiving the response shapes it was built for. The date is exposed as `Vendorval.API_VERSION`.

## License

[MIT](./LICENSE)
