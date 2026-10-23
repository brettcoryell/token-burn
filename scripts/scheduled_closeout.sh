#!/bin/sh
# Unattended token-accounting closeout (D16). Run by launchd every few hours.
# Safety net for the manual end-of-session closeout, not a replacement for it.
# Usage: scheduled_closeout.sh   (cd's to its own repo; logs to stdout for launchd)

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd "$(dirname "$0")/.." || exit 1

echo "=== $(date '+%Y-%m-%d %H:%M:%S') scheduled closeout on $(hostname)"

# Pick up collector fixes, but never disturb a checkout someone is working in.
if [ "$(git branch --show-current)" = "master" ] && [ -z "$(git status --porcelain --untracked-files=no)" ]; then
    git pull --ff-only 2>&1 | tail -1 || echo "[scheduled] git pull failed; continuing with current code"
else
    echo "[scheduled] checkout is not clean master; skipping git pull"
fi

if make token-accounting-closeout; then
    echo "=== closeout ok"
else
    status=$?
    echo "=== closeout FAILED (exit $status)"
    osascript -e 'display notification "Scheduled token-accounting closeout failed. See ~/Library/Logs/token-burn-closeout.log" with title "Token Burn"' 2>/dev/null
    exit "$status"
fi
