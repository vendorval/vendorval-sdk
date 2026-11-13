#!/usr/bin/env bash
# Validates AGENTS.md-first layout for VendorVal repos.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
errors=0

fail() { echo "ERROR: $1" >&2; errors=$((errors + 1)); }

if [[ ! -f "$ROOT/AGENTS.md" ]]; then
  fail "missing AGENTS.md at repo root"
fi

if [[ -f "$ROOT/CLAUDE.md" ]]; then
  lines=$(wc -l < "$ROOT/CLAUDE.md" | tr -d ' ')
  if ! grep -q '@AGENTS.md' "$ROOT/CLAUDE.md"; then
    fail "CLAUDE.md must import @AGENTS.md (found $lines lines)"
  elif [[ "$lines" -gt 15 ]]; then
    fail "CLAUDE.md looks like a full copy, not a shim ($lines lines)"
  fi
fi

for legacy in .cursorrules .windsurfrules .github/copilot-instructions.md CODEX.md GEMINI.md AIDER.md; do
  if [[ -f "$ROOT/$legacy" ]]; then
    fail "legacy agent file still present: $legacy (migrate to AGENTS.md)"
  fi
done

if [[ -f "$ROOT/AGENTS.md" ]] && [[ -f "$ROOT/.github/copilot-instructions.md" ]]; then
  fail ".github/copilot-instructions.md duplicates AGENTS.md — remove or scope with applyTo"
fi

for override in CLAUDE.local.md AGENTS.override.md .claude/CLAUDE.local.md; do
  if git -C "$ROOT" check-ignore -q "$override" 2>/dev/null; then
    :
  elif [[ -f "$ROOT/$override" ]] && git -C "$ROOT" ls-files --error-unmatch "$override" >/dev/null 2>&1; then
    fail "tracked local override file: $override (should be gitignored, not merged into shared rules)"
  fi
done

if [[ "$errors" -gt 0 ]]; then
  echo "$errors validation error(s)" >&2
  exit 1
fi

echo "AGENTS.md layout OK"
