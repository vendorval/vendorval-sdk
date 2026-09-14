## Summary

<!-- What does this PR change and why? -->

## Risk

<!-- Blast radius if this goes wrong. What breaks, and who notices? -->

- [ ] Low — isolated / additive change
- [ ] Medium — touches a shared resource, request layer, or a published API surface
- [ ] High — auth/API-key handling, webhook signature verification, or publish/CI config

## Testing

<!-- Node (`packages/node`) -->
- [ ] `pnpm --filter vendorval-sdk typecheck` passes
- [ ] `pnpm --filter vendorval-sdk lint` passes
- [ ] `pnpm --filter vendorval-sdk test` (Vitest) passes
- [ ] `pnpm --filter vendorval-sdk build` passes
<!-- Python (`packages/python`) -->
- [ ] `uv run ruff check src tests` passes
- [ ] `uv run mypy src` passes
- [ ] `uv run pytest -q` passes
- [ ] Not applicable (docs / CI-only change)

## Rollback

<!-- How do we revert if this misbehaves? Yank/deprecate the published npm or
     PyPI version and revert the commit, etc. -->

## Security impact

- [ ] No new secrets committed; no secrets in logs (gitleaks will gate)
- [ ] No change to API-key handling or webhook signature verification — or reviewed if there is
- [ ] No new external network destinations — or reviewed if there are
- [ ] No new dependency with known advisories (dependency-review will gate)
