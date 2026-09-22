#!/usr/bin/env bash
# Rate Indications Workbench — deploy to DEV.
#   ./deploy.sh            build frontend, deploy bundle (jobs), deploy app source
#   ./deploy.sh --no-build  skip the npm build (dist already current)
#
# First deploy is two-phase (the app SP doesn't exist until the app is created):
#   1) databricks apps create rate-indications-workbench --profile DEV
#   2) capture its service principal, set app_service_principal_id + grants, then run this.
set -euo pipefail
cd "$(dirname "$0")"
PROFILE=DEV
APP=rate-indications-workbench

if [[ "${1:-}" != "--no-build" ]]; then
  echo "==> building frontend"
  ( cd src/app/frontend && npm install && npm run build )
fi

echo "==> deploying bundle (jobs + sync)"
databricks bundle deploy --target dev --profile "$PROFILE"

USER=$(databricks --profile "$PROFILE" current-user me | python3 -c 'import json,sys;print(json.load(sys.stdin)["userName"])')
APP_PATH="/Workspace/Users/${USER}/.bundle/${APP}/dev/files/src/app"

echo "==> deploying app source from $APP_PATH"
databricks apps deploy "$APP" --source-code-path "$APP_PATH" --profile "$PROFILE"
echo "==> done. App: https://${APP}-7474656169654171.aws.databricksapps.com"
