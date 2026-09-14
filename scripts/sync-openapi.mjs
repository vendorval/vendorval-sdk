#!/usr/bin/env node
/**
 * Pull the VendorVal API's OpenAPI spec from its public endpoint and write it
 * to specs/openapi.json. Used by the spec-drift workflow and runnable locally.
 *
 *   node scripts/sync-openapi.mjs
 *   node scripts/sync-openapi.mjs --url http://localhost:3000/v1/openapi.json
 *
 * The API serves the spec unauthenticated at /v1/openapi.json, so no token
 * is needed. (It used to come from a release asset on the private
 * vendorval-api repo, which needed a PAT with read access to that repo's
 * source; the public endpoint avoids holding one.)
 */
import { writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "specs", "openapi.json");
const DEFAULT_URL = "https://api.vendorval.com/v1/openapi.json";

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf("--url");
const urlArg = urlIdx >= 0 ? argv[urlIdx + 1] : null;
if (urlIdx >= 0 && (urlArg === undefined || urlArg.startsWith("--"))) {
  console.error("--url requires a value (e.g. --url http://localhost:3000/v1/openapi.json)");
  process.exit(1);
}
const url = urlArg ?? process.env.OPENAPI_URL ?? DEFAULT_URL;

async function main() {
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "vendorval-sdk-sync" },
  });
  if (!res.ok) {
    throw new Error(`${url} → ${res.status} ${res.statusText}`);
  }

  const body = await res.text();
  let spec;
  try {
    spec = JSON.parse(body);
  } catch {
    throw new Error(`${url} did not return JSON (got ${res.headers.get("content-type") ?? "no content-type"}).`);
  }
  // Refuse to overwrite the snapshot with something that isn't a real spec,
  // e.g. an error envelope or an empty document from a misconfigured deploy.
  const pathCount = spec && typeof spec.paths === "object" ? Object.keys(spec.paths).length : 0;
  if (typeof spec?.openapi !== "string" || pathCount === 0) {
    throw new Error(`${url} returned JSON that is not an OpenAPI document with paths.`);
  }

  // Re-stringify to normalize formatting so diffs are stable.
  const normalized = `${JSON.stringify(spec, null, 2)}\n`;
  const label = `API ${spec.info?.version ?? "unknown version"}, ${pathCount} paths`;

  let prev = "";
  try {
    prev = await readFile(OUT, "utf8");
  } catch (err) {
    // Only the "file doesn't exist yet" case is fine; everything else
    // (permissions, I/O errors) should fail fast.
    if (!(err && typeof err === "object" && "code" in err && err.code === "ENOENT")) {
      throw err;
    }
  }

  if (prev === normalized) {
    console.log(`No changes (${label}).`);
    return;
  }

  await writeFile(OUT, normalized);
  console.log(`Updated specs/openapi.json from ${url} (${label}).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
