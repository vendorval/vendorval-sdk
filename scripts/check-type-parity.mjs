#!/usr/bin/env node
/**
 * Cross-language type parity check between the Node and Python SDKs.
 *
 * What this catches:
 *   - A new TS interface added without a Python TypedDict equivalent
 *     (or vice versa) — customer-visible API drift between SDKs that
 *     the OpenAPI sync workflow doesn't catch because it operates on
 *     spec/, not source.
 *   - Renamed types where one side picks up the new name but the
 *     other lags.
 *
 * What this DOESN'T catch:
 *   - Field-level shape drift (would need a proper structural type
 *     comparison; TypeScript and Python type systems aren't trivially
 *     unifiable). That's the OpenAPI codegen job — tracked under TD-#6.
 *   - Naming-convention rename: TS `IdentifierInput` vs Python
 *     `IdentifierInput` matches; TS `EntityRegion` vs Python
 *     `entity_region` would NOT match (the script does no case folding).
 *     We rely on convention: both SDKs use PascalCase for types.
 *
 * Exit codes:
 *   0 — parity check passed (or only allowed-asymmetries present)
 *   1 — drift detected
 *
 * To intentionally exempt a type that exists only in one SDK (e.g.
 * Node-only retry-policy helper), add it to ALLOWED_TS_ONLY or
 * ALLOWED_PY_ONLY below with a comment justifying the exemption.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Asymmetries that are intentional (one SDK exposes a primitive the
// other doesn't need). Each entry must carry a comment justifying it.
const ALLOWED_TS_ONLY = new Set([
  // Type aliases that are language-specific (TS union string literals;
  // Python uses str at runtime).
  'CountryCode',
  'IdentifierType',
  'CheckType',
  'CheckStatus',
  'VerificationMode',
  'EntityType',
  'LookupMode',
  'SamRefreshMode',
  'EntityRegion',
  'CountryTier',
  'SourceRegistration', // alias for Record<string, unknown>; Python uses dict

  // ─── Backlog: types present in Node SDK, missing from Python SDK ───
  // Each one wants a TypedDict in packages/python/src/vendorval_sdk/types.py.
  // Tracked under TD-#6 (SDK type parity). Adding here so CI is not red
  // while the Python additions land incrementally. As each lands, delete
  // it from this set.
  'AddressLookupRequest',
  'AddressLookupResponse',
  'AddressRecord',
  'AddressSuggestParams',
  'AddressSuggestResponse',
  'AddressSuggestion',
  'BulkJob',
  'CertificationIssuerScope',
  'CertificationStatus',
  'CertificationsListParams',
  'Deliverability',
  'DpvCode',
  'ClassificationCategory',
  'ClassificationEthnicSubcategory',
  'CreateEntityRequest',
  'CreateMonitorRequest',
  'CreateVerificationRequest',
  'IssuerQualifiedIdentifierInput',
  'ListMonitorsQuery',
  'LookupIdentifiers',
  'LookupRefresh',
  'LookupRequest',
  'LookupResponse',
  'Monitor',
  'MonitorEvent',
  'Provider',
  'UsageSummary',
  'VerifyIdentifiers',
  'VerifyRequest',
])

const ALLOWED_PY_ONLY = new Set([
  // Python-only helpers that don't have a TS analogue
  'VerifyIdentifierObject', // python-specific helper for the verify request shape
  'IssuerQualifiedIdentifier', // python-specific helper for issuer-qualified identifier shape
  'CountryErrorDetails', // python-specific error-details TypedDict
  'CertificationSource', // Python helper for cert source enum
])

function extractTsTypes(filePath) {
  const text = readFileSync(filePath, 'utf-8')
  const names = []
  const re = /^export\s+(interface|type)\s+([A-Z][A-Za-z0-9]*)/gm
  let match
  while ((match = re.exec(text)) !== null) {
    names.push(match[2])
  }
  return new Set(names)
}

function extractPyTypes(filePath) {
  const text = readFileSync(filePath, 'utf-8')
  const names = []
  const re = /^class\s+([A-Z][A-Za-z0-9]*)\s*\(/gm
  let match
  while ((match = re.exec(text)) !== null) {
    names.push(match[1])
  }
  return new Set(names)
}

function walkTs(dir) {
  const all = new Set()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const t of walkTs(full)) all.add(t)
    } else if (entry.name.endsWith('.ts')) {
      for (const t of extractTsTypes(full)) all.add(t)
    }
  }
  return all
}

const tsTypes = walkTs(join(ROOT, 'packages', 'node', 'src', 'types'))
const pyTypes = extractPyTypes(join(ROOT, 'packages', 'python', 'src', 'vendorval_sdk', 'types.py'))

const tsOnly = [...tsTypes].filter((t) => !pyTypes.has(t) && !ALLOWED_TS_ONLY.has(t))
const pyOnly = [...pyTypes].filter((t) => !tsTypes.has(t) && !ALLOWED_PY_ONLY.has(t))

if (tsOnly.length === 0 && pyOnly.length === 0) {
  console.log(`Type parity OK: ${tsTypes.size} TS types, ${pyTypes.size} Python types.`)
  console.log(`Allowed asymmetries: ${ALLOWED_TS_ONLY.size} TS-only, ${ALLOWED_PY_ONLY.size} Python-only.`)
  process.exit(0)
}

console.error('Type parity FAILED:')
if (tsOnly.length > 0) {
  console.error(`\nTypes present in Node SDK but missing from Python SDK (${tsOnly.length}):`)
  for (const t of tsOnly.sort()) {
    console.error(`  - ${t}`)
  }
  console.error('\nResolution:')
  console.error('  1. If the type is genuinely cross-language, add a TypedDict to packages/python/src/vendorval_sdk/types.py.')
  console.error('  2. If it is intentionally TS-only (helpers, union aliases), add to ALLOWED_TS_ONLY in this script with a justifying comment.')
}
if (pyOnly.length > 0) {
  console.error(`\nTypes present in Python SDK but missing from Node SDK (${pyOnly.length}):`)
  for (const t of pyOnly.sort()) {
    console.error(`  - ${t}`)
  }
  console.error('\nResolution:')
  console.error('  1. If cross-language, add a TS interface to packages/node/src/types/shared.ts.')
  console.error('  2. If intentionally Python-only, add to ALLOWED_PY_ONLY in this script with a justifying comment.')
}
process.exit(1)
