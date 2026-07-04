#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/.logs"
API_LOG="$LOG_DIR/api-dev.log"
WEB_LOG="$LOG_DIR/web-dev.log"
API_URL="${API_URL:-http://127.0.0.1:4000/api}"
WEB_URL="${WEB_URL:-http://127.0.0.1:3001}"

mkdir -p "$LOG_DIR"

if command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
elif command -v corepack >/dev/null 2>&1; then
  PNPM=(corepack pnpm)
elif command -v npx >/dev/null 2>&1; then
  PNPM=(npx pnpm)
else
  echo "pnpm not found (and no corepack/npx fallback available)" >&2
  exit 1
fi

log() {
  printf '[recover-local] %s\n' "$*"
}

kill_repo_processes() {
  local patterns=(
    "$ROOT_DIR/apps/web/node_modules/.*/next/dist/bin/next dev -p 3001"
    "$ROOT_DIR/apps/api/node_modules/.*/ts-node-dev/lib/bin.js --respawn --transpile-only src/main.ts"
    "$ROOT_DIR/.nvm/.*/pnpm --filter @got/web dev"
    "$ROOT_DIR/.nvm/.*/pnpm --filter @got/api dev"
    "GiveOrTake/apps/web/node_modules/.*/next/dist/bin/next dev -p 3001"
    "GiveOrTake/apps/api/node_modules/.*/ts-node-dev/lib/bin.js --respawn --transpile-only src/main.ts"
    "pnpm --filter @got/web dev"
    "pnpm --filter @got/api dev"
    "next-server \(v15\.1\.4\)"
  )

  for pattern in "${patterns[@]}"; do
    pkill -f "$pattern" >/dev/null 2>&1 || true
  done
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local expect_body="${3:-}"

  for _ in {1..60}; do
    if curl -fsS "$url" -o /tmp/got-recover-check.$$ 2>/dev/null; then
      if [[ -z "$expect_body" ]] || grep -q "$expect_body" /tmp/got-recover-check.$$; then
        rm -f /tmp/got-recover-check.$$
        log "$label is ready: $url"
        return 0
      fi
    fi
    sleep 1
  done

  rm -f /tmp/got-recover-check.$$
  echo "$label failed readiness check: $url" >&2
  return 1
}

start_api() {
  log "Refreshing Prisma client"
  (cd "$ROOT_DIR" && "${PNPM[@]}" prisma generate >/dev/null)
  log "Starting API dev server"
  nohup bash -lc "cd '$ROOT_DIR' && exec ${PNPM[*]} --filter @got/api dev" >>"$API_LOG" 2>&1 &
}

start_web() {
  log "Starting web dev server"
  nohup bash -lc "cd '$ROOT_DIR' && exec ${PNPM[*]} --filter @got/web dev" >>"$WEB_LOG" 2>&1 &
}

log "Repo: $ROOT_DIR"
log "Stopping existing GiveOrTake dev servers"
kill_repo_processes
sleep 2

log "Clearing stale Next dev artifacts"
rm -rf "$ROOT_DIR/apps/web/.next-dev"

: >"$API_LOG"
: >"$WEB_LOG"

start_api
start_web

wait_for_http "$API_URL/pods" "API"
wait_for_http "$WEB_URL" "Web" "Give or Take"

log "Recovery complete"
log "Web: $WEB_URL"
log "API: $API_URL"
log "Logs: $WEB_LOG | $API_LOG"
