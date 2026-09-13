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

API keys are prefixed `vv_test_` (sandbox) or `vv_live_` (production). The SDK validates the prefix client-side.

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

## Webhooks

```python
from vendorval_sdk import construct_event

event = construct_event(raw_body, signature_header, secret)
```

Pass the original raw request body and signature header to the verifier. This helper validates incoming events; it does not configure a webhook endpoint or enable delivery. Follow the API documentation for subscription and delivery setup.

## License

[MIT](./LICENSE)
