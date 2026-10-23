#!/bin/sh
# Install or remove the launchd job that runs scripts/scheduled_closeout.sh (D16).
#   scripts/install_scheduled_closeout.sh install [interval_seconds]   (default 14400 = 4 h)
#   scripts/install_scheduled_closeout.sh uninstall
#   scripts/install_scheduled_closeout.sh status

LABEL="com.brettcoryell.token-burn-closeout"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/token-burn-closeout.log"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN="gui/$(id -u)"

case "$1" in
install)
    INTERVAL="${2:-14400}"
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array><string>/bin/sh</string><string>$REPO/scripts/scheduled_closeout.sh</string></array>
    <key>StartInterval</key><integer>$INTERVAL</integer>
    <key>RunAtLoad</key><false/>
    <key>StandardOutPath</key><string>$LOG</string>
    <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    if launchctl bootstrap "$DOMAIN" "$PLIST"; then
        echo "installed $LABEL (every ${INTERVAL}s, log $LOG)"
    else
        echo "plist written to $PLIST but launchctl bootstrap failed; it will load at next login" >&2
        exit 1
    fi
    ;;
uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null
    rm -f "$PLIST"
    echo "removed $LABEL"
    ;;
status)
    launchctl print "$DOMAIN/$LABEL" 2>&1 | grep -E "state|last exit|run interval|runs" || echo "not loaded"
    ;;
*)
    echo "usage: $0 install [interval_seconds] | uninstall | status" >&2
    exit 2
    ;;
esac
