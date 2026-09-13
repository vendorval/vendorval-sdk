# live-smoke (Python)

End-to-end smoke test that installs the local Python SDK build (`../../../packages/python`) as an editable package and hits the real VendorVal API. Useful for verifying a pre-release before publishing to PyPI.

## Run

Requires Python >=3.11 and uv. Run from `examples/python/live-smoke/`:

```bash
cp .env.example .env
# edit .env: set VENDORVAL_API_KEY and VENDORVAL_UEI
uv sync
uv run main.py
```

Calls `client.entities.lookup(identifiers={"uei": uei})` against `https://api.vendorval.com/v1` by default and prints the JSON entity record.

The example prints the returned record and can consume API quota. Use an authorized test key/identifier, keep `.env` untracked, and do not publish returned customer data.

Override the target with `VENDORVAL_BASE_URL` (host only, e.g. `https://api.vendorval.com`) in `.env` to hit staging or a local server.
