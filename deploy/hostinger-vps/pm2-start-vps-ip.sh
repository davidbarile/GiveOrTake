#!/usr/bin/env bash
set -euo pipefail

cd /opt/give-or-take
set -a
source ./.env.vps-ip
set +a

pm2 delete give-or-take-api >/dev/null 2>&1 || true
pm2 delete give-or-take-web >/dev/null 2>&1 || true

pm2 start "pnpm --filter @got/api start" --name give-or-take-api
pm2 start "pnpm --filter @got/web start" --name give-or-take-web
pm2 save
pm2 status
