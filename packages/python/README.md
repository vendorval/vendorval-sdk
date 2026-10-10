# vendorval-sdk

Official Python SDK for the [VendorVal API](https://docs.vendorval.com).

```bash
pip install vendorval-sdk
```

Requires Python >=3.11. Set `VENDORVAL_API_KEY` before running these examples; identifiers below are illustrative.

## Quick start

```python
from vendorval_sdk import Vendorval

client = Vendorval()  # reads VENDORVAL_API_KEY from env

# 1) Look up an entity by identifier
lookup = client.entities.lookup(identifiers={"uei": "ABCD12345678"})
if lookup.match == "not_found":
    raise SystemExit("entity not in registry")

# 2) Run a verification and wait for the terminal result
bundle = client.verifications.create_and_wait(
    identifiers=[{"type": "uei", "value": "ABCD12345678"}],
    legal_name="Acme Federal Services LLC",
    checks=["sam_registration"],
    mode="cached",
)
print(bundle.verification.overall_result)
```

### Async

```python
import asyncio
from vendorval_sdk import AsyncVendorval

async def main() -> None:
    async with AsyncVendorval() as client:
        result = await client.entities.lookup(identifiers={"uei": "ABCD12345678"})
        print(result.match)

asyncio.run(main())
```

## Configuration

```python
client = Vendorval(
    api_key="vv_live_…",
    base_url="https://api.vendorval.com",
    timeout=30.0,                 # seconds, default 60
    max_retries=2,                # default 2
)
```

API keys are prefixed `vv_test_` (sandbox), `vv_live_` (production) or `vv_mcp_` (keys issued for MCP clients). The client checks the prefix and raises `VendorvalError` with `code="invalid_api_key_prefix"` on anything else, before any request is sent.

## Errors

```python
from vendorval_sdk import RateLimitError, ConflictError, ValidationError

try:
    client.verifications.create(...)
except RateLimitError as err:
    print("rate limited, retry after", err.retry_after, "seconds")
except ConflictError as err:
    print("ambiguous match", err.candidates)
```

All errors carry `request_id`, `status`, `code`, `type`, `message`.

## Pagination

List methods return a page. Iterating it walks every page: while the API reports `has_more`, the SDK requests the next page at the following offset.

```python
for monitor in client.monitors.list(limit=50):
    print(monitor["id"])

monitors = client.monitors.list().all()  # every item, as a list
```

The async client returns an `AsyncPage`: use `async for monitor in await client.monitors.list()` and `await page.all()`. For one page at a time, read `page.data` and `page.has_more`, and call `page.next_page()` (it returns `None` after the last page).

## Monitors and webhooks

A monitor re-runs checks on an entity at a fixed frequency and POSTs each detected change to its `webhook_url`. Every monitor has its own signing secret, returned once when the monitor is created:

```python
monitor = client.monitors.create(
    entity_id="ent_123",
    checks=["sam_exclusion", "sanctions_screening"],
    frequency="daily",  # "daily" | "weekly" | "monthly"
    webhook_url="https://example.com/webhooks/vendorval",
)
# Store this. It is not returned again; client.monitors.rotate_secret(id) issues a new one.
save_secret(monitor["id"], monitor["webhook_secret"])
```

Verify each delivery with `construct_event`, passing the raw request body, the request headers and that monitor's secret:

```python
from vendorval_sdk import WEBHOOK_DELIVERY_ID_HEADER, construct_event

# Flask
event = construct_event(request.get_data(), request.headers, secret)
delivery_id = request.headers.get(WEBHOOK_DELIVERY_ID_HEADER)
```

`construct_event` checks the `X-ETP-Signature` header (`sha256=<hex>`, an HMAC-SHA256 of `<X-ETP-Timestamp>.<raw body>`) in constant time, and rejects deliveries whose `X-ETP-Timestamp` is more than 300 seconds from now (`tolerance=` changes that). It raises `VendorvalError` with `type="webhook_error"` on any failure. Use the raw body: re-serializing parsed JSON changes the bytes and the signature will not match.

Deliveries are at-least-once. Retries of the same delivery reuse `X-ETP-Delivery-Id`, so record it and ignore repeats. Each `monitoring.changes_detected` delivery carries one change in `event["data"]["changes"]`, and `event["data"]["monitor_id"]` tells you which monitor's secret to use.

## License

[MIT](./LICENSE)
