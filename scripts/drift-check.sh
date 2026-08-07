#!/usr/bin/env bash
#
# drift-check.sh
#
# Runs ON THE BOX. Asserts that $APP_DIRECTORY contains nothing
# at its top level except what git tracks plus a short, explicitly justified list
# of runtime paths that are deliberately untracked.
#
# WHY THIS EXISTS. The top-level rsync in the deploy runs WITHOUT --delete, on
# purpose: `node_modules/` here is 583 MB and load-bearing, and `.env` is the
# secrets source of truth. A --delete one exclude-list typo away from either is
# a catastrophic failure mode, and bounding the blast radius structurally beats
# guarding it with a check. But an rsync that never deletes cannot remove what
# it did not put there, so files accumulate invisibly. A sibling repo in this
# org accumulated 8,215 untracked files in its target tree exactly this way.
#
# This converts that invisible accumulation into a loud gate: new drift has to
# be either committed to the repo or added to the allowlist below, deliberately,
# by a human.
#
# NOTE ON SCOPE: src/ and scripts/ are synced WITH --delete, so they cannot hold
# extras and are not checked here. This script checks the top level only.
#
# Usage on the box (produce the tracked list from any clone):
#   EXPECTED_TRACKED="$(git ls-tree --name-only HEAD | tr '\n' ' ')" \
#     ./scripts/drift-check.sh      # run from inside the runtime directory

set -euo pipefail

# THIS REPOSITORY IS PUBLIC. The real runtime path is not committed here; it
# comes from the APP_DIRECTORY GitHub Actions variable. The default is simply
# the current directory, so `cd <runtime dir> && ./scripts/drift-check.sh` works.
APP_DIRECTORY="${APP_DIRECTORY:-$(pwd)}"

if [ -z "${EXPECTED_TRACKED:-}" ]; then
  echo "ERROR: EXPECTED_TRACKED is empty. It must carry the space-separated output of"
  echo "       'git ls-tree --name-only HEAD' for the commit being deployed."
  exit 1
fi

# -----------------------------------------------------------------------------
# The ONLY top-level entries allowed to exist on the box without being in git.
# Every addition here needs a reason on its own line. If a file is needed for
# the service to START, it belongs in git, not in this list.
# -----------------------------------------------------------------------------
ALLOWED_UNTRACKED=(
  ".env"          # secrets. bun auto-loads it from the working directory; the unit has
                  # no EnvironmentFile, so this file IS how the service is configured.
  "node_modules"  # 583 MB of installed dependencies. Built on the box by `bun install`,
                  # never synced, and never deleted by a deploy.
  "dist"          # build output, gitignored. Not used by the current ExecStart.
  ".data"         # gitignored local state directory.
)

cd "$APP_DIRECTORY"

UNEXPECTED=""
for ENTRY in $(ls -A); do
  FOUND=0
  for T in $EXPECTED_TRACKED; do
    # git ls-tree lists top-level entries only, so a tracked path like
    # "src/lib/agent.ts" appears here as "src". Compare on the first segment.
    if [ "${T%%/*}" = "$ENTRY" ]; then FOUND=1; break; fi
  done
  if [ "$FOUND" -eq 0 ]; then
    for A in "${ALLOWED_UNTRACKED[@]}"; do
      if [ "$A" = "$ENTRY" ]; then FOUND=1; break; fi
    done
  fi
  [ "$FOUND" -eq 0 ] && UNEXPECTED="$UNEXPECTED $ENTRY"
done

if [ -n "$UNEXPECTED" ]; then
  echo "ERROR: $APP_DIRECTORY holds top-level entries that are neither tracked in git nor allowlisted:$UNEXPECTED"
  echo
  echo "This is drift. Do ONE of these, deliberately:"
  echo "  - commit the file to the repo, if it is source or config the service needs; or"
  echo "  - add it to ALLOWED_UNTRACKED in scripts/drift-check.sh with a reason, if it is genuinely runtime-only; or"
  echo "  - delete it from the box by hand, if it is a leftover."
  echo
  echo "Do NOT silence this by widening the allowlist without reading what the file is."
  exit 1
fi

# A .git directory on the runtime host is its own failure mode: it invites
# `git pull` / `git checkout` on a live box, which is how a sibling runtime lost
# two commits and five stashes on 2026-07-16.
if [ -e "$APP_DIRECTORY/.git" ]; then
  echo "ERROR: $APP_DIRECTORY/.git exists. This runtime must NOT be a git clone."
  echo "       Deploys are rsync-only. Remove it by hand after reading DEPLOY.md."
  exit 1
fi

# node_modules is load-bearing and irreplaceable within a deploy window. If it
# has gone missing, say so here rather than letting the health check report a
# confusing crash.
if [ ! -d "$APP_DIRECTORY/node_modules" ]; then
  echo "ERROR: $APP_DIRECTORY/node_modules is missing. The service cannot run without it."
  echo "       A deploy must never delete it. Rebuild with: \"\$BUN_BIN\" install --frozen-lockfile"
  exit 1
fi

echo "OK: no unexpected top-level entries in $APP_DIRECTORY, node_modules present, and it is not a git clone."
