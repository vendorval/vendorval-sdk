# Releasing

Each SDK has its own version timeline. Tag prefixes determine which package gets released.

Releases go through a pull request, then a tag on the merged commit. Nothing
is committed or tagged on `main` directly.

## Node (`packages/node` → npm `vendorval-sdk`)

1. On a branch, update the version in `packages/node/package.json`, `packages/node/src/version.ts` (the `VERSION` constant sent in the `User-Agent`), `packages/node/CHANGELOG.md` and the root `CHANGELOG.md`.
2. Open a pull request (for example `chore(release): node v0.X.Y`) and merge it once CI is green.
3. Tag the merged commit and push only that tag:
   ```bash
   git fetch origin
   git tag node-v0.X.Y origin/main
   git push origin node-v0.X.Y
   ```
4. The `release-node.yml` workflow typechecks, tests, builds and runs `npm publish --access public --provenance` using OIDC. The tag, `package.json` and the `VERSION` constant must all name the same version.

## Python (`packages/python` → PyPI `vendorval-sdk`)

1. On a branch, update the version in `packages/python/pyproject.toml`, `packages/python/src/vendorval_sdk/_version.py` (the `VERSION` constant sent in the `User-Agent`), `packages/python/CHANGELOG.md` and the root `CHANGELOG.md`. Run `uv lock` in `packages/python` so the lockfile records the new version.
2. Open a pull request (for example `chore(release): python v0.X.Y`) and merge it once CI is green.
3. Tag the merged commit and push only that tag:
   ```bash
   git fetch origin
   git tag python-v0.X.Y origin/main
   git push origin python-v0.X.Y
   ```
4. The `release-python.yml` workflow builds with `hatchling` and uploads via PyPI Trusted Publishing (OIDC, no API tokens). The tag, `pyproject.toml` and the `VERSION` constant must all name the same version (after PEP 440 normalization, so `python-v0.X.Y-rc.0` matches `0.X.Yrc0`).

### One-time PyPI Trusted Publishing setup

Configure a Trusted Publisher under [PyPI Project Settings → Publishing](https://pypi.org/manage/project/vendorval-sdk/settings/publishing/):

- Owner: `vendorval`
- Repository: `vendorval-sdk`
- Workflow: `release-python.yml`
- Environment: `pypi`

## Pre-release smoke (recommended)

To validate the publish pipeline before a GA tag, cut a release candidate first. The version rule applies to RCs too, so the release PR sets the RC version (`0.X.Y-rc.0` in `package.json` and `version.ts`, `0.X.Yrc0` in `pyproject.toml` and `_version.py`) before the tag is pushed:

```bash
# Node
git tag node-v0.X.Y-rc.0 origin/main && git push origin node-v0.X.Y-rc.0
# Python
git tag python-v0.X.Y-rc.0 origin/main && git push origin python-v0.X.Y-rc.0
```

The release workflows publish RCs under the `next` dist-tag on npm (e.g. `vendorval-sdk@0.X.Y-rc.0`) and as a pre-release on PyPI (e.g. `vendorval-sdk==0.X.Yrc0`).

## API version pinning

Both SDKs send `Accept-Version: <ISO date>`, taken from the `API_VERSION` constant (`packages/node/src/version.ts`, `packages/python/src/vendorval_sdk/_version.py`). The API uses it to choose between response shapes that changed in a dated version, so a given SDK release keeps getting the shapes it was built for. Moving to a newer API version is a deliberate change: bump `API_VERSION` in both SDKs, update the types to the new shapes and note it in the CHANGELOGs.

## Spec drift

The `spec-drift.yml` workflow runs nightly: it pulls `openapi.json` from the API's public endpoint (`https://api.vendorval.com/v1/openapi.json`, no token needed) and opens a PR if the snapshot in `specs/openapi.json` has changed. The spec reflects what is deployed, so no API release tag is required.
