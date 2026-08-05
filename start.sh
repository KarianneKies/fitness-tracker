#!/bin/bash
# start.sh — Start the Fitness Tracker server safely.
#
# Binds to 127.0.0.1 only (never 0.0.0.0) so the app is NOT reachable from
# the wifi/LAN. The only way in is Tailscale Serve, which proxies HTTPS
# traffic from your tailnet to this local server.
set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

source .venv/bin/activate

TAILSCALE="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
if [ -x "$TAILSCALE" ]; then
    if "$TAILSCALE" serve status 2>&1 | grep -q "No serve config"; then
        echo "Setting up Tailscale Serve (127.0.0.1:8000 -> tailnet HTTPS)..."
        "$TAILSCALE" serve --bg 8000
    fi
    "$TAILSCALE" serve status
else
    echo "Tailscale not found at expected path - skipping serve setup."
fi

echo
echo "Starting server on 127.0.0.1:8000 (not reachable from wifi/LAN)."
echo "Press Ctrl+C to stop."
echo

exec uvicorn backend.main:app --host 127.0.0.1 --port 8000
