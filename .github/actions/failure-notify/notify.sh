#!/usr/bin/env bash
# Source of truth: vendorval/vendorval-app (generalised from smoke-notify).
# Copied verbatim into the other VendorVal repos; change every copy together.
#
# Keeps one tracking issue per workflow in sync with the latest run. See
# action.yml for inputs and a local dry-run example.
#
#   failure (or timeout) -> open the issue, or refresh its body if already open
#   success              -> comment "Recovered in <run>" and close it
#   cancelled / skipped  -> leave everything as is
#
# Writes `state-change` (opened|updated|closed|none), `issue-url` and `hint`
# to $GITHUB_OUTPUT. DRY_RUN=1 prints the write calls instead of making them.
set -euo pipefail

: "${WORKFLOW_NAME:?}" "${WORKFLOW_REF:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_RUN_ID:?}" "${GH_TOKEN:?}"

repo="$GITHUB_REPOSITORY"
server="${GITHUB_SERVER_URL:-https://github.com}"
attempt="${GITHUB_RUN_ATTEMPT:-1}"
run_url="$server/$repo/actions/runs/$GITHUB_RUN_ID"
if [ "$attempt" != 1 ]; then run_url="$run_url/attempts/$attempt"; fi

# owner/repo/.github/workflows/link-check.yml@refs/heads/main -> link-check.yml
workflow_file="${WORKFLOW_REF%%@*}"
workflow_file="${workflow_file##*/}"
marker="<!-- failure-notify:${workflow_file} -->"
label="${LABEL:-ci-failure}"
title="${TITLE:-$WORKFLOW_NAME failing}"
job_name="${JOB_NAME:-}"
test_step="${TEST_STEP:-}"
now="$(date -u +'%Y-%m-%d %H:%M UTC')"
ref_name="${GITHUB_REF_NAME:-unknown}"
event="${GITHUB_EVENT_NAME:-unknown}"

output() { echo "$1=$2" >> "${GITHUB_OUTPUT:-/dev/stdout}"; }

write() {
  if [ "${DRY_RUN:-}" = 1 ]; then
    echo "[dry-run] $*" >&2
    # Drain a piped body (and show it) so the producer doesn't die of SIGPIPE.
    if [ -p /dev/stdin ]; then cat >&2; fi
    echo "https://github.com/$repo/issues/0"
  else
    "$@"
  fi
}

# --- Overall result: an explicit RESULT wins, else fold the needs context. ---
result="${RESULT:-}"
if [ -z "$result" ]; then
  if [ -z "${NEEDS_JSON:-}" ]; then
    echo "::error::Pass either the result or the needs input." >&2
    exit 1
  fi
  result="$(jq -r '[.[].result] as $r
    | if any($r[]; . == "failure") then "failure"
      elif any($r[]; . == "cancelled") then "cancelled"
      elif any($r[]; . == "success") then "success"
      else "skipped" end' <<<"$NEEDS_JSON")"
fi

open_issue_number() {
  # Matched on the hidden marker, not the title, so renaming a workflow's
  # display name doesn't orphan its issue.
  gh issue list -R "$repo" --label "$label" --state open --limit 100 \
    --json number,body --jq "map(select(.body | contains(\"$marker\"))) | first | .number // empty"
}

issue="$(open_issue_number)"

case "$result" in
  success)
    if [ -z "$issue" ]; then
      echo "Run passed and no open $label issue for $workflow_file. Nothing to do."
      output state-change none
      exit 0
    fi
    write gh issue close "$issue" -R "$repo" --comment "Recovered in $run_url" >/dev/null
    echo "Recovered. Closed #$issue."
    output state-change closed
    output issue-url "$server/$repo/issues/$issue"
    exit 0
    ;;
  failure | cancelled) ;;
  *)
    echo "Result is '$result'. Leaving issues alone."
    output state-change none
    exit 0
    ;;
esac

# --- Work out where it failed and whether it looks like infrastructure. ---
# Failed jobs in this attempt (or just JOB_NAME). The notify job itself is
# still in progress, so it never matches.
all_jobs="$(gh api "repos/$repo/actions/runs/$GITHUB_RUN_ID/attempts/$attempt/jobs?per_page=100" \
  --jq '.jobs' 2>/dev/null || true)"
jobs_json="$(jq -c --arg name "$job_name" '[.[] | select(if $name != "" then .name == $name
  else (.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out") end)]' \
  <<<"${all_jobs:-[]}" 2>/dev/null || echo '[]')"
job_count="$(jq 'length' <<<"${jobs_json:-[]}" 2>/dev/null || echo 0)"
failed_job=""
failed_step=""
steps_run=0
annotations=""
job_summary=""
if [ "$job_count" -gt 0 ]; then
  # The first failed job drives the hint; every failed job is listed.
  first="$(jq -c '(map(select(.conclusion == "failure")) + .)[0]' <<<"$jobs_json")"
  failed_job="$(jq -r '.name' <<<"$first")"
  failed_step="$(jq -r '[.steps[]? | select(.conclusion == "failure")][0].name // empty' <<<"$first")"
  steps_run="$(jq '[.steps[]? | select(.conclusion != null and .conclusion != "skipped")] | length' <<<"$first")"
  job_summary="$(jq -r 'map("`\(.name)`" + (([.steps[]? | select(.conclusion == "failure")][0].name // "") as $s
    | if $s != "" then " (step `\($s)`)" else "" end)) | join(", ")' <<<"$jobs_json")"
  while read -r job_id; do
    annotations+="$(gh api "repos/$repo/check-runs/$job_id/annotations" --jq '.[].message' 2>/dev/null || true)"$'\n'
  done < <(jq -r '.[].id' <<<"$jobs_json")
fi

if grep -qiE 'spending limit|payments have failed' <<<"$annotations"; then
  hint="Infrastructure/billing: GitHub refused to start the job (spending limit or failed payment). Check the org's Billing settings first."
elif grep -qiE 'maximum execution time' <<<"$annotations"; then
  hint="Timed out: the job hit its timeout-minutes. Usually a hung external dependency or a stuck runner rather than a real finding."
elif [ "$result" = cancelled ]; then
  echo "Run was cancelled (not a timeout). Leaving issues alone."
  output state-change none
  exit 0
elif [ "$job_count" -eq 0 ]; then
  hint="Unknown: couldn't read the job's step results, so open the run to see where it failed."
elif [[ "$failed_step" == Simulate* ]]; then
  hint="Simulated: this run was dispatched with simulate_failure=true and did no real work."
elif [ -z "$failed_step" ] && [ "$steps_run" -le 1 ]; then
  hint="Infrastructure: the job failed before running any steps (runner, billing or GitHub outage)."
elif [ -z "$test_step" ]; then
  hint="Failed in step \`${failed_step:-unknown}\` of \`$failed_job\`. The run log has the details."
elif [ "$failed_step" = "$test_step" ]; then
  hint="Check failed: \`$test_step\` itself reported a problem. The run log has the findings."
else
  hint="Infrastructure: failed in setup step \`${failed_step:-unknown}\` before \`$test_step\` ran."
fi

if [ -n "$job_summary" ]; then
  where="failed: $job_summary"
else
  where="failing job unknown"
fi
this_failure="[run $GITHUB_RUN_ID]($run_url), $now, \`$ref_name\` via $event, $where"

render_body() {
  local first="$1" last="$2" count="$3"
  cat <<EOF
$marker
The **$WORKFLOW_NAME** workflow (\`$workflow_file\`) is failing.

**First failure:** $first
**Last failure:** $last
**Failed runs while open:** $count
**Hint:** $hint

This issue is managed by \`.github/actions/failure-notify\`. Its body is refreshed on every failed run and it closes itself on the next green run.
EOF
}

output hint "$hint"

if [ -z "$issue" ]; then
  # --force makes this idempotent: creates the label or updates it in place.
  write gh label create "$label" -R "$repo" --force --color B60205 \
    --description "Opened automatically when a scheduled or monitoring workflow fails" >/dev/null
  url="$(render_body "$this_failure" "$this_failure" 1 \
    | write gh issue create -R "$repo" --title "$title" --label "$label" --body-file -)"
  echo "Opened $url"
  output state-change opened
  output issue-url "$url"
else
  body="$(gh issue view "$issue" -R "$repo" --json body --jq .body)"
  first="$(sed -n 's/^\*\*First failure:\*\* //p' <<<"$body" | head -n1)"
  count="$(sed -n 's/^\*\*Failed runs while open:\*\* \([0-9][0-9]*\).*/\1/p' <<<"$body" | head -n1)"
  render_body "${first:-$this_failure}" "$this_failure" "$((${count:-1} + 1))" \
    | write gh issue edit "$issue" -R "$repo" --body-file - >/dev/null
  echo "Updated #$issue with this failure."
  output state-change updated
  output issue-url "$server/$repo/issues/$issue"
fi
