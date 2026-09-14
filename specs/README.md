# OpenAPI snapshot

`openapi.json` is a snapshot of the VendorVal API's public spec, served unauthenticated at <https://api.vendorval.com/v1/openapi.json>. Do not hand-edit it. From the repository root:

```bash
node scripts/sync-openapi.mjs
# Or pull from another deployment, e.g. a local API:
node scripts/sync-openapi.mjs --url http://localhost:3000/v1/openapi.json
node scripts/check-type-parity.mjs
```

Sync overwrites the snapshot only when normalized content changes, and refuses to write anything that isn't an OpenAPI document with paths. No token is needed. Review the diff and update SDK methods/types and tests as needed—the snapshot refresh does not implement API changes in either client.

The [spec-drift workflow](../.github/workflows/spec-drift.yml) runs daily at 06:23 UTC and on manual dispatch, opening (or updating) the `chore/sync-openapi` PR when the snapshot changes and dispatching the required CI checks on that branch.
