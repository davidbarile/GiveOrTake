#!/usr/bin/env bash
set -euo pipefail

API="${API:-http://localhost:4000/api}"
COOKIE_JAR="${COOKIE_JAR:-/tmp/give-or-take-smoke-cookies.txt}"
rm -f "$COOKIE_JAR"

# Keep smoke deterministic even after manual debug-panel experiments.
curl -sS -H 'Content-Type: application/json' \
  -X POST "$API/pods/debug/settings" \
  -d '{"defaultPodStartingGems":10,"defaultPodActionCooldownSeconds":10}' >/tmp/got-smoke-debug-settings.json

curl -sS -c "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -X POST "$API/session/bootstrap" -d '{}' >/tmp/got-smoke-bootstrap.json

python3 - <<'PY'
import json
with open('/tmp/got-smoke-bootstrap.json') as f:
    data=json.load(f)
assert data['player']['isGuest'] is True
assert data['player']['username']
PY

curl -sS -b "$COOKIE_JAR" "$API/pods" >/tmp/got-smoke-public-before.json
python3 - <<'PY'
import json
pods=json.load(open('/tmp/got-smoke-public-before.json'))
assert isinstance(pods, list)
assert all(p['name'] != 'Quickstart Classic' for p in pods), 'Quickstart pods should not crowd public browse'
for name in ['Classic Pod', 'Power Pod', 'Karma Pod', 'Hybrid Pod']:
    assert any(p['name'] == name for p in pods), f'missing default pod: {name}'
assert any(p['name'] == 'Classic Pod' and p['currentPlayerCount'] == 0 for p in pods), 'unjoined Classic Pod should display 0/25'
PY

POD_ID=$(curl -sS -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -X POST "$API/pods/quickstart" -d '{}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["pod"]["id"])')

curl -sS -b "$COOKIE_JAR" "$API/pods/my" >/tmp/got-smoke-my-pods.json
python3 - <<'PY'
import json
members=json.load(open('/tmp/got-smoke-my-pods.json'))
assert any(m['pod']['name'] == 'Quickstart Classic' for m in members), 'joined pod should appear in active/my pods list'
PY

curl -sS -b "$COOKIE_JAR" "$API/pods/$POD_ID/game/state" >/tmp/got-smoke-state.json
python3 - <<'PY'
import json
with open('/tmp/got-smoke-state.json') as f:
    data=json.load(f)
assert data['currentGems'] == 10
PY

curl -sS -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -X POST "$API/pods/$POD_ID/game/action" \
  -d '{"action":"TAKE","requestId":"smoke-take-1"}' >/tmp/got-smoke-action.json
python3 - <<'PY'
import json
with open('/tmp/got-smoke-action.json') as f:
    data=json.load(f)
assert data['newActorGems'] == 11
PY

STATUS=$(curl -sS -b "$COOKIE_JAR" "$API/pods/$POD_ID" | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])')
test "$STATUS" = "ACTIVE"

GUEST_CREATE_STATUS=$(curl -sS -o /tmp/got-smoke-guest-create.json -w '%{http_code}' \
  -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
  -X POST "$API/pods" \
  -d '{"name":"Guest Pod","sizeLimit":25,"templateType":"CLASSIC","visibility":"PUBLIC"}')
test "$GUEST_CREATE_STATUS" = "403"

echo "Smoke OK: guest bootstrap, public pod counts, active pod re-entry list, quickstart action loop, guest create blocked"
