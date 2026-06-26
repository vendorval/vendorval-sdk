# VendorVal SDKs

Official client libraries for the [VendorVal API](https://docs.vendorval.com).

[![npm](https://img.shields.io/npm/v/vendorval-sdk?label=npm)](https://www.npmjs.com/package/vendorval-sdk)
[![PyPI](https://img.shields.io/pypi/v/vendorval-sdk?label=PyPI)](https://pypi.org/project/vendorval-sdk/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

| Language | Package | Source |
|----------|---------|--------|
| Node / TypeScript | [`vendorval-sdk`](https://www.npmjs.com/package/vendorval-sdk) on npm | [`packages/node`](./packages/node) |
| Python | [`vendorval-sdk`](https://pypi.org/project/vendorval-sdk/) on PyPI | [`packages/python`](./packages/python) |

Both SDKs target the VendorVal REST API (`https://api.vendorval.com/v1`) and ship the same surface: entity lookup, verification (with polling helper), monitoring, certifications, addresses, providers, usage, jobs, and country metadata.

## Quick start

### Node / TypeScript

```bash
npm install vendorval-sdk
```

```ts
import Vendorval from "vendorval-sdk";

const client = new Vendorval({ apiKey: process.env.VENDORVAL_API_KEY });

const result = await client.entities.lookup({
  identifiers: { uei: "ABCD12345678" },
});
```

### Python

```bash
pip install vendorval-sdk
```

```python
from vendorval_sdk import Vendorval

client = Vendorval()  # reads VENDORVAL_API_KEY from env

result = client.entities.lookup(identifiers={"uei": "ABCD12345678"})
```

## Repository layout

```text
vendorval-sdk/
  packages/
    node/        # TypeScript SDK (publishes to npm as `vendorval-sdk`)
    python/      # Python SDK (publishes to PyPI as `vendorval-sdk`)
  specs/
    openapi.json # Snapshot of the API's OpenAPI spec, mirrored from upstream
  examples/      # Per-language runnable examples
  scripts/       # Spec sync helpers
```

## Development

```bash
pnpm install
pnpm -r build              # build all Node packages
pnpm -r test               # run all Node tests

cd packages/python
uv sync
uv run pytest
```

See [`RELEASING.md`](./RELEASING.md) for how to cut new releases.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for setup, the Node/Python parity and lint expectations, and the PR workflow.

## Issue tracking

Report bugs and feature requests via [GitHub issues](https://github.com/Modali-Consulting/vendorval-sdk/issues). Issues should be added to the [VendorVal project](https://github.com/orgs/Modali-Consulting/projects/3).

## License

[MIT](./LICENSE)
