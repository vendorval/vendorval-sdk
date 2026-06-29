#!/usr/bin/env node
/**
 * Pull the latest OpenAPI spec from the vendorval-api GitHub release and
 * write it to specs/openapi.json. Used by the spec-drift workflow and
 * runnable locally.
 *
 *   node scripts/sync-openapi.mjs
 *   node scripts/sync-openapi.mjs --tag v1.2.3
 *
 * Honors GITHUB_TOKEN if present (avoids unauthenticated rate limits).
 */
import { writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "..", "specs", "openapi.json");
const REPO = "vendorval/vendorval-api";
const ASSET_NAME = "openapi.json";

const argv = process.argv.slice(2);
const tagIdx = argv.indexOf("--tag");
const tag = tagIdx >= 0 ? argv[tagIdx + 1] : null;
if (tagIdx >= 0 && (tag === undefined || tag.startsWith("--"))) {
  console.error("--tag requires a value (e.g. --tag v1.2.3)");
  process.exit(1);
}

const headers = { Accept: "application/vnd.github+json", "User-Agent": "vendorval-sdk-sync" };
if (process.env.GITHUB_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

async function ghJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`${url} → ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function main() {
  const url = tag
    ? `https://api.github.com/repos/${REPO}/releases/tags/${tag}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  const release = await ghJson(url);
  const asset = (release.assets ?? []).find((a) => a.name === ASSET_NAME);
  if (!asset) {
    throw new Error(`Release ${release.tag_name} has no ${ASSET_NAME} asset.`);
  }

  // Use the asset API URL (asset.url), not browser_download_url:
  // browser_download_url 404s on private repos even with valid auth, while
  // the API endpoint works for both public and private with `Accept:
  // application/octet-stream`.
  const dl = await fetch(asset.url, {
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "vendorval-sdk-sync",
      ...(process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {}),
    },
  });
  if (!dl.ok) {
    throw new Error(`Download failed: ${dl.status} ${dl.statusText}`);
  }
  const fresh = await dl.text();
  // Re-stringify to normalize formatting so diffs are stable.
  const normalized = `${JSON.stringify(JSON.parse(fresh), null, 2)}\n`;

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
    console.log(`No changes (release ${release.tag_name}).`);
    return;
  }

  await writeFile(OUT, normalized);
  console.log(`Updated specs/openapi.json from release ${release.tag_name}.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
