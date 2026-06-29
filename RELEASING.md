# Releasing

Each SDK has its own version timeline. Tag prefixes determine which package gets released.

## Node (`packages/node` → npm `vendorval-sdk`)

1. Update the version in `packages/node/package.json`, `packages/node/src/version.ts` (the `VERSION` constant sent in the `User-Agent` — keep it in sync with `package.json`), and `packages/node/CHANGELOG.md`.
2. Commit on `main`: `git commit -am "release(node): v0.X.Y"`.
3. Tag: `git tag node-v0.X.Y && git push --tags`.
4. The `release-node.yml` workflow runs `pnpm publish --access public --provenance` using OIDC.

## Python (`packages/python` → PyPI `vendorval-sdk`)

1. Update the version in `packages/python/pyproject.toml`, `packages/python/src/vendorval_sdk/_version.py` (the `VERSION` constant sent in the `User-Agent` — keep it in sync with `pyproject.toml`), and `packages/python/CHANGELOG.md`.
2. Commit on `main`: `git commit -am "release(python): v0.X.Y"`.
3. Tag: `git tag python-v0.X.Y && git push --tags`.
4. The `release-python.yml` workflow builds with `hatchling` and uploads via PyPI Trusted Publishing (OIDC, no API tokens).

### One-time PyPI Trusted Publishing setup

Configure a Trusted Publisher under [PyPI Project Settings → Publishing](https://pypi.org/manage/project/vendorval-sdk/settings/publishing/):

- Owner: `vendorval`
- Repository: `vendorval-sdk`
- Workflow: `release-python.yml`
- Environment: `pypi`

## Pre-release smoke (recommended)

To validate the publish pipeline before a GA tag, cut a release candidate first:

```bash
# Node
git tag node-v0.X.Y-rc.0
# Python
git tag python-v0.X.Y-rc.0
```

The release workflows publish RCs under the `next` dist-tag on npm (e.g. `vendorval-sdk@0.X.Y-rc.0`) and as a pre-release on PyPI (e.g. `vendorval-sdk==0.X.Yrc0`).

## API version pinning

Both SDKs send the header `X-VendorVal-API-Version: <ISO date>`. When the API ships a breaking version, SDK majors bump the header value.

## Spec drift

The `spec-drift.yml` workflow runs nightly: it pulls the latest `openapi.json` from the most recent upstream VendorVal API release and opens a PR if the snapshot in `specs/openapi.json` has changed.
