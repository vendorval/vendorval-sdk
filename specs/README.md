# OpenAPI snapshot

`openapi.json` is generated from an upstream API release. Do not hand-edit it. From the repository root:

```bash
node scripts/sync-openapi.mjs
# Or select a specific upstream release:
node scripts/sync-openapi.mjs --tag <release-tag>
node scripts/check-type-parity.mjs
```

Sync downloads a release asset and overwrites the snapshot only when normalized content changes. Upstream access may require an authorized `GITHUB_TOKEN`; never commit the token. Review the diff and update SDK methods/types and tests as needed—the snapshot refresh does not implement API changes in either client.

The [spec-drift workflow](../.github/workflows/spec-drift.yml) is configured daily at 06:00 UTC and for manual dispatch, opening a PR when the snapshot changes. Its execution depends on configured upstream read access.
