#!/bin/bash
# HubSpot Beta Tracker — Daily Scan Script
# Run via cron or manually to keep the tracker data fresh

set -e

REPO_DIR="/tmp/hubspot-beta-tracker-scan"
ENV_FILE="$HOME/.openclaw/workspace/.env"

# Use Python to safely load .env and export credentials
export HUBSPOT_PORTAL_CSRF
export HUBSPOT_PORTAL_COOKIE
export GITHUB_TOKEN

python3 - << 'PYEOF'
import os

env_file = os.path.expanduser("~/.openclaw/workspace/.env")
env_vars = {}

if os.path.exists(env_file):
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if '=' in line and not line.startswith('#'):
                key, _, value = line.partition('=')
                env_vars[key.strip()] = value.strip()

for key in ['HUBSPOT_PORTAL_CSRF', 'HUBSPOT_PORTAL_COOKIE', 'GITHUB_TOKEN']:
    val = env_vars.get(key, os.environ.get(key, ''))
    if val:
        os.environ[key] = val
        print(f"[beta-scan] Loaded {key}")
    else:
        print(f"[beta-scan] WARNING: {key} not found")
PYEOF

# Clone/pull the repo
if [ -d "$REPO_DIR/.git" ]; then
    echo "[beta-scan] Pulling latest code..."
    cd "$REPO_DIR"
    git pull origin master
else
    echo "[beta-scan] Cloning repo..."
    rm -rf "$REPO_DIR"
    git clone https://github.com/CRMbyRSM/hubspot-beta-tracker.git "$REPO_DIR"
    cd "$REPO_DIR"
    npm install --silent 2>/dev/null || true
fi

# Install deps if needed
if [ ! -d "node_modules" ]; then
    echo "[beta-scan] Installing dependencies..."
    npm install --silent 2>/dev/null || true
fi

# Run the scan
echo "[beta-scan] Running scan at $(date)..."
SCAN_OUTPUT=$(HUBSPOT_PORTAL_CSRF="$HUBSPOT_PORTAL_CSRF" HUBSPOT_PORTAL_COOKIE="$HUBSPOT_PORTAL_COOKIE" node index.js --json 2>&1)
SCAN_EXIT=$?

echo "$SCAN_OUTPUT" | tail -5

if [ $SCAN_EXIT -ne 0 ]; then
    echo "[beta-scan] Scan failed with exit code $SCAN_EXIT"
    exit 1
fi

# Commit and push if there are changes
cd "$REPO_DIR"
if git diff --quiet && git diff --cached --quiet; then
    echo "[beta-scan] No state changes to push."
else
    echo "[beta-scan] Committing and pushing..."
    git config user.email "antonella@crmbyrsm.com" 2>/dev/null || true
    git config user.name "Antonella" 2>/dev/null || true
    git add -A
    git commit -m "chore: daily scan $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    # Embed token directly in remote URL to avoid credential helper issues
    python3 - << 'PYEOF'
import os, subprocess
token = None
with open(os.path.expanduser("~/.openclaw/workspace/.env")) as f:
    for line in f:
        if line.startswith("GITHUB_TOKEN="):
            token = line.strip().split("=", 1)[1]
            break
if token:
    subprocess.run(["git", "remote", "set-url", "origin",
                    f"https://CRMbyRSM:{token}@github.com/CRMbyRSM/hubspot-beta-tracker.git"], check=True)
PYEOF
    git push origin master
    echo "[beta-scan] Pushed successfully."
fi
