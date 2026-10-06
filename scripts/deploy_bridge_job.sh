#!/usr/bin/env bash
# Create-or-update the audience-facing "monthly refresh" job (kept outside the dev
# bundle so its name carries no "[dev user]" prefix). Idempotent: matches on name.
set -euo pipefail
PROFILE="${PROFILE:-DEV}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SPEC="$HERE/bridge_job.json"
NAME=$(jq -r .name "$SPEC")
JID=$(databricks jobs list -p "$PROFILE" -o json | jq -r --arg n "$NAME" '.[] | select(.settings.name==$n) | .job_id' | head -1)
if [[ -n "$JID" ]]; then
  databricks jobs reset -p "$PROFILE" --json "$(jq -c --argjson id "$JID" '{job_id:$id, new_settings:.}' "$SPEC")"
  echo "updated job $JID"
else
  JID=$(databricks jobs create -p "$PROFILE" --json @"$SPEC" | jq -r .job_id)
  echo "created job $JID"
fi
echo "https://fevm-lr-dev-aws-us.cloud.databricks.com/jobs/$JID?o=7474656169654171"
