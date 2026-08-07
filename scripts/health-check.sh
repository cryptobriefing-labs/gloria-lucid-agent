#!/usr/bin/env bash
#
# health-check.sh
#
# Asserts LIVENESS, not existence. A `systemctl restart` that succeeds tells you
# systemd accepted the command, not that the agent works. This estate already
# has services that validate green while dead.
#
# FOUR ASSERTIONS, and the specific failure each one catches:
#
#   1. systemctl is-active == active
#      Catches: the unit failed to start (bad ExecStart, missing bun binary).
#
#   2. GET /.well-known/agent-card.json returns 200, parses as JSON, carries a
#      non-empty .name, and carries at least one entry in .skills.
#      Catches: a TypeScript error in src/ (bun exits, the port closes, curl
#      gets connection refused); a broken or half-installed @lucid-agents
#      dependency; the express app booting but the agent framework failing to
#      register its skills, which returns a perfectly valid 200 with an empty
#      skills array and is invisible to a status-code-only check.
#
#   3. NRestarts did not increase during the settle window.
#      Catches: the crash loop. The unit is Restart=on-failure with
#      RestartSec=5, so a process that starts, serves one request and dies is
#      `active` again five seconds later and looks healthy to any point-in-time
#      check. systemd resets NRestarts on an explicit `systemctl restart`, so
#      the baseline is 0 after a deploy that restarted and is whatever it was
#      after a deploy that skipped the restart. Comparing before to after is
#      correct in both cases.
#
#   4. systemctl is-active == active AFTER the settle window.
#      Catches: a death that begins after assertion 2 passed.
#
# Run it by hand on the box any time:
#   cd "$APP_DIRECTORY" && ./scripts/health-check.sh

set -euo pipefail

UNIT="${APP_NAME:-gloria-lucid-agent.service}"
PORT="${AGENT_PORT:-3004}"
CARD_PATH="${CARD_PATH:-/.well-known/agent-card.json}"
ATTEMPTS="${HEALTH_ATTEMPTS:-6}"
SLEEP_BETWEEN="${HEALTH_SLEEP:-5}"
SETTLE="${HEALTH_SETTLE:-12}"

BODY_FILE="$(mktemp -t lucid-health.XXXXXX)"
trap 'rm -f "$BODY_FILE"' EXIT

show_unit_context() {
  systemctl status "$UNIT" --no-pager -l 2>&1 | tail -30 || true
  echo "--- last 40 journal lines ---"
  journalctl -u "$UNIT" -n 40 --no-pager 2>&1 | tail -40 || true
}

# --- 1. the unit is active ----------------------------------------------------

STATE="$(systemctl is-active "$UNIT" 2>&1 || true)"
if [ "$STATE" != "active" ]; then
  echo "ERROR: $UNIT is '$STATE' after the deploy, expected 'active'."
  show_unit_context
  exit 1
fi
echo "OK: $UNIT is active."

NR_BEFORE="$(systemctl show "$UNIT" -p NRestarts --value 2>/dev/null || echo 0)"
[ -n "$NR_BEFORE" ] || NR_BEFORE=0
echo "Baseline NRestarts=$NR_BEFORE"

# --- 2. the agent card is served, is JSON, and has skills ---------------------

CODE=000
for ATTEMPT in $(seq 1 "$ATTEMPTS"); do
  # `|| CODE=000` rather than `|| echo 000` inside the substitution: curl
  # already prints 000 on a transport failure and appending another would
  # produce the nonsense status "000000".
  CODE="$(curl -s -o "$BODY_FILE" -w '%{http_code}' --max-time 20 \
            "http://127.0.0.1:${PORT}${CARD_PATH}")" || CODE=000
  [ -n "$CODE" ] || CODE=000
  [ "$CODE" = "200" ] && break
  echo "  attempt $ATTEMPT: ${CARD_PATH} returned $CODE, retrying in ${SLEEP_BETWEEN}s"
  sleep "$SLEEP_BETWEEN"
done

if [ "$CODE" != "200" ]; then
  echo "ERROR: http://127.0.0.1:${PORT}${CARD_PATH} returned HTTP $CODE after $ATTEMPTS attempts, expected 200."
  if [ "$CODE" = "000" ]; then
    echo "       000 means nothing is listening on port $PORT: the process is not running."
  fi
  head -c 600 "$BODY_FILE" || true
  echo
  show_unit_context
  exit 1
fi

if ! jq -e . "$BODY_FILE" >/dev/null 2>&1; then
  echo "ERROR: ${CARD_PATH} returned 200 but the body is not valid JSON."
  head -c 600 "$BODY_FILE" || true
  echo
  show_unit_context
  exit 1
fi

if ! jq -e '(.name // "") | length > 0' "$BODY_FILE" >/dev/null 2>&1; then
  echo "ERROR: ${CARD_PATH} returned valid JSON with no .name. The agent card is malformed."
  head -c 600 "$BODY_FILE" || true
  echo
  exit 1
fi

SKILLS="$(jq -r '(.skills // []) | length' "$BODY_FILE")"
if [ "$SKILLS" -lt 1 ]; then
  echo "ERROR: ${CARD_PATH} returned an agent card with ZERO skills."
  echo "       The HTTP server booted but the agent framework registered nothing."
  echo "       This is the failure a status-code-only health check would call green."
  head -c 600 "$BODY_FILE" || true
  echo
  show_unit_context
  exit 1
fi

echo "OK: agent card served on port $PORT. name=$(jq -r '.name' "$BODY_FILE") version=$(jq -r '.version // "?"' "$BODY_FILE") skills=$SKILLS"

# --- 3 and 4. settle, then prove it did not crash-loop ------------------------

echo "Settling ${SETTLE}s to catch a crash loop (unit is Restart=on-failure, RestartSec=5)."
sleep "$SETTLE"

NR_AFTER="$(systemctl show "$UNIT" -p NRestarts --value 2>/dev/null || echo 0)"
[ -n "$NR_AFTER" ] || NR_AFTER=0
if [ "$NR_AFTER" -gt "$NR_BEFORE" ]; then
  echo "ERROR: $UNIT auto-restarted during the health window (NRestarts $NR_BEFORE -> $NR_AFTER). That is a crash loop, not a healthy service."
  show_unit_context
  exit 1
fi

STATE="$(systemctl is-active "$UNIT" 2>&1 || true)"
if [ "$STATE" != "active" ]; then
  echo "ERROR: $UNIT is '$STATE' after the settle window, expected 'active'."
  show_unit_context
  exit 1
fi

echo "OK: $UNIT still active, NRestarts unchanged at $NR_AFTER."
echo "HEALTH CHECK PASSED"
