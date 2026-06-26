# CLAUDE.md

Guidance for AI assistants (Claude Code and similar) and human contributors working in this repository.

## What this repo is

`vendorval-sdk` is the home of VendorVal's official, open-source client libraries:

- **Node / TypeScript** — `packages/node`, published to npm as [`vendorval-sdk`](https://www.npmjs.com/package/vendorval-sdk).
- **Python** — `packages/python`, published to PyPI as [`vendorval-sdk`](https://pypi.org/project/vendorval-sdk/).

Both wrap the [VendorVal REST API](https://docs.vendorval.com) (`https://api.vendorval.com/v1`) and expose the same surface so the two languages stay at parity. VendorVal is a vendor-verification product by Modali Consulting; `specs/openapi.json` is a snapshot of the VendorVal API's OpenAPI spec, mirrored from its upstream releases.

> **This repository is public.** Treat everything here as world-readable. Do not commit secrets, production or customer data, internal hostnames, internal issue/PR numbers, internal infrastructure details, or internal-only tooling. Write changelog entries and code comments for SDK consumers, not for an internal audience.

## Layout

```
packages/node/      TypeScript SDK (npm)
packages/python/    Python SDK (PyPI)
examples/           Runnable per-language examples
specs/openapi.json  Snapshot of the API spec (generated — do not hand-edit)
scripts/            Spec-sync + type-parity helpers
```

## Working on the Node SDK

```bash
pnpm install
pnpm -r build      # bundle with tsup (ESM + CJS + .d.ts)
pnpm -r test       # vitest
pnpm --filter vendorval-sdk typecheck
```

## Working on the Python SDK

```bash
cd packages/python
uv sync
uv run pytest
uv run ruff check src tests
uv run mypy src
```

## Conventions

- **Keep the two SDKs at parity.** A public type or method added on one side should have an equivalent on the other; `scripts/check-type-parity.mjs` (and the `type-parity` workflow) guards this.
- **Don't hand-edit `specs/openapi.json`.** Run `node scripts/sync-openapi.mjs` to refresh it from the upstream API release.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, …). Each package keeps its own `CHANGELOG.md`; the root `CHANGELOG.md` is an aggregate index.
- **Releases** are tag-driven and publish via OIDC trusted publishing — see [`RELEASING.md`](./RELEASING.md). Bump the runtime `VERSION` constant (`packages/node/src/version.ts`, `packages/python/src/vendorval_sdk/_version.py`) alongside the package manifest.

## Security

Never commit credentials. A local `.env` (used for live smoke tests) is gitignored and must stay that way; its values are for local use only. Publishing uses OIDC, so no registry tokens belong in the repository.
