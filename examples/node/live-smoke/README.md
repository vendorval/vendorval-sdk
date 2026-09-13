# Node live smoke example

Links the local SDK through the pnpm workspace and performs one entity lookup against the real API by default. It prints the returned record and may consume API quota. Use an authorized test key and identifier.

Requires Node >=20.6 for `--env-file` and pnpm 10. From the **repository root**:

```bash
cp examples/node/live-smoke/.env.example examples/node/live-smoke/.env
# Set VENDORVAL_API_KEY and VENDORVAL_UEI in that file.
pnpm install --frozen-lockfile
pnpm --filter vendorval-sdk build
pnpm --filter vendorval-example-live-smoke start
```

`VENDORVAL_BASE_URL` overrides the default `https://api.vendorval.com`; use the host without `/v1`. The start script loads `.env` from the example directory. Keep the file untracked and avoid copying returned customer data into commits or logs shared publicly.
