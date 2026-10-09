#!/usr/bin/env node
/**
 * Cross-language type parity check between the Node and Python SDKs.
 *
 * What this catches:
 *   - A public type added to one SDK without an equivalent in the other.
 *     Node types are `export interface` / `export type` declarations under
 *     packages/node/src/types; Python types are classes and module-level
 *     aliases (`Name = Literal[...]`, `Name = A | B`) in types.py.
 *   - Renamed types where one side picks up the new name but the other lags.
 *   - String-literal unions whose VALUES differ: when a name is a pure
 *     string-literal union on both sides (TS `"a" | "b"`, Python
 *     `Literal["a", "b"]`), both must list the same values.
 *   - Stale allowlist entries: a name listed as one-sided below that now
 *     exists on both sides fails the check, so the lists stay honest.
 *
 * What this doesn't catch:
 *   - Field-level drift inside interfaces and TypedDicts. Request shapes are
 *     covered by the contract tests in each package, which validate SDK
 *     requests against specs/openapi.json.
 *   - Naming-convention differences: both SDKs use PascalCase type names and
 *     the comparison does no case folding.
 *
 * Exit codes: 0 when parity holds, 1 on drift.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Types that intentionally exist only in the Node SDK. Each entry needs a reason.
const ALLOWED_TS_ONLY = new Set([
  // Generic list envelope. The Python SDK returns Page/AsyncPage instead.
  'ListEnvelope',

  // Backlog: Node types with no Python TypedDict yet. Each wants one in
  // packages/python/src/vendorval_sdk/types.py; delete the entry when it lands.
  'AddressLookupRequest',
  'AddressLookupResponse',
  'AddressRecord',
  'AddressSuggestParams',
  'AddressSuggestResponse',
  'AddressSuggestion',
  'BulkJob',
  'CertificationsListParams',
  'Deliverability',
  'DpvCode',
  'CreateEntityRequest',
  'CreateMonitorRequest',
  'CreateVerificationRequest',
  'ListMonitorsQuery',
  'LookupIdentifiers',
  'LookupRefresh',
  'LookupRequest',
  'LookupResponse',
  'Provider',
  'UsageSummary',
  'VerifyRequest',
])

// Types that intentionally exist only in the Python SDK. Each entry needs a reason.
const ALLOWED_PY_ONLY = new Set([
  'CountryErrorDetails', // Node exports this from errors.ts, outside types/
  'CertificationSource', // Node inlines the certification `source` object
  'BankScheme', // Node inlines "iban" | "us_ach" on the response type
])

/** Parse a union of string literals, e.g. `| "a" | "b"`. Null if anything else is in it. */
function literalUnion(body) {
  const parts = body.split('|').map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const values = []
  for (const p of parts) {
    const m = /^"([^"]*)"$/.exec(p)
    if (!m) return null
    values.push(m[1])
  }
  return values
}

function extractTsTypes(filePath) {
  // Drop comments first: they can contain `;` or quotes that would confuse
  // the declaration scan below.
  const text = readFileSync(filePath, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const types = new Map()
  const decl = /^export\s+(interface|type)\s+([A-Z][A-Za-z0-9]*)/gm
  let match
  while ((match = decl.exec(text)) !== null) {
    const [, kind, name] = match
    let values = null
    if (kind === 'type') {
      const start = text.indexOf('=', match.index) + 1
      const end = text.indexOf(';', start)
      values = literalUnion(text.slice(start, end))
    }
    types.set(name, values)
  }
  return types
}

function extractPyTypes(filePath) {
  const text = readFileSync(filePath, 'utf-8')
  const types = new Map()
  for (const m of text.matchAll(/^class\s+([A-Z][A-Za-z0-9]*)\s*\(/gm)) {
    types.set(m[1], null)
  }
  for (const m of text.matchAll(/^([A-Z][A-Za-z0-9]*)\s*=\s*/gm)) {
    const name = m[1]
    const rest = text.slice(m.index + m[0].length)
    let values = null
    if (rest.startsWith('Literal[')) {
      const body = rest.slice('Literal['.length, rest.indexOf(']'))
      const cleaned = body.replace(/#.*$/gm, '')
      const items = cleaned.split(',').map((s) => s.trim()).filter(Boolean)
      if (items.every((s) => /^"[^"]*"$/.test(s))) values = items.map((s) => s.slice(1, -1))
    }
    types.set(name, values)
  }
  return types
}

function walkTs(dir) {
  const all = new Map()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      for (const [k, v] of walkTs(full)) all.set(k, v)
    } else if (entry.name.endsWith('.ts')) {
      for (const [k, v] of extractTsTypes(full)) all.set(k, v)
    }
  }
  return all
}

const tsTypes = walkTs(join(ROOT, 'packages', 'node', 'src', 'types'))
const pyTypes = extractPyTypes(join(ROOT, 'packages', 'python', 'src', 'vendorval_sdk', 'types.py'))

const tsOnly = [...tsTypes.keys()].filter((t) => !pyTypes.has(t) && !ALLOWED_TS_ONLY.has(t))
const pyOnly = [...pyTypes.keys()].filter((t) => !tsTypes.has(t) && !ALLOWED_PY_ONLY.has(t))
const staleTs = [...ALLOWED_TS_ONLY].filter((t) => tsTypes.has(t) && pyTypes.has(t))
const stalePy = [...ALLOWED_PY_ONLY].filter((t) => tsTypes.has(t) && pyTypes.has(t))

const valueDrift = []
for (const [name, tsValues] of tsTypes) {
  const pyValues = pyTypes.get(name)
  if (!tsValues || !pyValues) continue
  const ts = [...tsValues].sort()
  const py = [...pyValues].sort()
  if (ts.join('\n') !== py.join('\n')) {
    valueDrift.push({
      name,
      onlyTs: ts.filter((v) => !py.includes(v)),
      onlyPy: py.filter((v) => !ts.includes(v)),
    })
  }
}

const literalCount = [...tsTypes].filter(([n, v]) => v && pyTypes.get(n)).length

if (tsOnly.length + pyOnly.length + staleTs.length + stalePy.length + valueDrift.length === 0) {
  console.log(`Type parity OK: ${tsTypes.size} TS types, ${pyTypes.size} Python types.`)
  console.log(`Literal unions compared by value: ${literalCount}.`)
  console.log(`Allowed asymmetries: ${ALLOWED_TS_ONLY.size} TS-only, ${ALLOWED_PY_ONLY.size} Python-only.`)
  process.exit(0)
}

console.error('Type parity FAILED:')
if (tsOnly.length > 0) {
  console.error(`\nTypes present in Node SDK but missing from Python SDK (${tsOnly.length}):`)
  for (const t of tsOnly.sort()) console.error(`  - ${t}`)
  console.error('\n  Add the type to packages/python/src/vendorval_sdk/types.py, or list it in')
  console.error('  ALLOWED_TS_ONLY in this script with a reason.')
}
if (pyOnly.length > 0) {
  console.error(`\nTypes present in Python SDK but missing from Node SDK (${pyOnly.length}):`)
  for (const t of pyOnly.sort()) console.error(`  - ${t}`)
  console.error('\n  Add the type under packages/node/src/types/, or list it in ALLOWED_PY_ONLY')
  console.error('  in this script with a reason.')
}
if (valueDrift.length > 0) {
  console.error(`\nString-literal unions whose values differ (${valueDrift.length}):`)
  for (const d of valueDrift) {
    console.error(`  - ${d.name}: Node only ${JSON.stringify(d.onlyTs)}, Python only ${JSON.stringify(d.onlyPy)}`)
  }
}
if (staleTs.length + stalePy.length > 0) {
  console.error('\nAllowlist entries that now exist in both SDKs (remove them from this script):')
  for (const t of [...staleTs, ...stalePy].sort()) console.error(`  - ${t}`)
}
process.exit(1)
