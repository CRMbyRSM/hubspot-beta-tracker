#!/bin/bash
# HubSpot Beta Tracker — Daily Scan Script
# Run via cron or manually to keep the tracker data fresh
#
# Usage:
#   ./scripts/hubspot-beta-scan.sh
#
# Credentials:
#   Reads from .env in the project root (see .env.example)
#   Falls back to environment variables if .env not found
#
# Cron example (daily at 6 AM UTC):
#   0 6 * * * /path/to/hubspot-beta-tracker/scripts/hubspot-beta-scan.sh >> /var/log/beta-scan.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$REPO_DIR/.env"

echo "[beta-scan] Starting at $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ─── Load credentials ────────────────────────────────────────────────────────

if [[ -f "$ENV_FILE" ]]; then
    echo "[beta-scan] Loading credentials from $ENV_FILE"
    set -a
    # Source .env, skipping comments and blank lines
    while IFS= read -r line; do
        line="${line#"${line%%[![:space:]]*}"}"  # trim leading whitespace
        [[ -z "$line" || "$line" == \#* ]] && continue
        export "$line"
    done < "$ENV_FILE"
    set +a
else
    echo "[beta-scan] No .env file found, using environment variables"
fi

# Validate required vars
MISSING=()
[[ -z "${HUBSPOT_PORTAL_COOKIE:-}" ]] && MISSING+=("HUBSPOT_PORTAL_COOKIE")
[[ -z "${HUBSPOT_PORTAL_CSRF:-}" ]] && MISSING+=("HUBSPOT_PORTAL_CSRF")

if [[ ${#MISSING[@]} -gt 0 ]]; then
    echo "[beta-scan] ERROR: Missing required variables: ${MISSING[*]}"
    echo "[beta-scan] Copy .env.example to .env and fill in values."
    exit 1
fi

# GitHub token for push (optional — only needed if committing state changes)
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

# ─── Ensure we have the latest code ──────────────────────────────────────────

cd "$REPO_DIR"

if [[ -d ".git" ]]; then
    echo "[beta-scan] Pulling latest code..."
    git pull origin master --quiet 2>/dev/null || echo "[beta-scan] Warning: git pull failed, using local code"
else
    echo "[beta-scan] ERROR: $REPO_DIR is not a git repository"
    exit 1
fi

# Install deps if needed
if [[ ! -d "node_modules" ]]; then
    echo "[beta-scan] Installing dependencies..."
    npm install --silent 2>/dev/null || npm install
fi

# ─── Run the scan ────────────────────────────────────────────────────────────

echo "[beta-scan] Running scan..."
SCAN_OUTPUT=$(node index.js --json 2>&1) || {
    echo "[beta-scan] Scan failed"
    echo "$SCAN_OUTPUT" | tail -10
    exit 1
}

# Show summary from last line of JSON output
SCAN_SUMMARY=$(echo "$SCAN_OUTPUT" | grep -o '"summary":{[^}]*}' | tail -1 || echo "")
if [[ -n "$SCAN_SUMMARY" ]]; then
    echo "[beta-scan] $SCAN_SUMMARY"
else
    echo "$SCAN_OUTPUT" | tail -5
fi

# ─── Commit and push state changes ──────────────────────────────────────────

if git diff --quiet && git diff --cached --quiet; then
    echo "[beta-scan] No state changes to push."
else
    echo "[beta-scan] State changed, committing..."

    git config user.email "hermes@crmbyrsm.com" 2>/dev/null || true
    git config user.name "Hermes" 2>/dev/null || true
    git add -A
    git commit -m "chore: daily scan $(date -u +%Y-%m-%dT%H:%M:%SZ)"

    if [[ -n "$GITHUB_TOKEN" ]]; then
        echo "[beta-scan] Pushing with token..."
        git remote set-url origin "https://CRMbyRSM:${GITHUB_TOKEN}@github.com/CRMbyRSM/hubspot-beta-tracker.git"
        git push origin master --quiet
        # Reset to clean URL (don't leave token in config)
        git remote set-url origin "https://github.com/CRMbyRSM/hubspot-beta-tracker.git"
        echo "[beta-scan] Pushed successfully."
    else
        echo "[beta-scan] No GITHUB_TOKEN set — skipping push."
        echo "[beta-scan] Run: git push origin master"
    fi
fi

echo "[beta-scan] Done at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
