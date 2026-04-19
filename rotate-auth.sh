#!/usr/bin/env bash
# rotate-auth.sh — Update HubSpot Portal session cookies on Railway
#
# Usage:
#   ./rotate-auth.sh                          # Interactive (prompts)
#   echo "COOKIE" | ./rotate-auth.sh --stdin  # Pipe cookie from clipboard tool
#
# How to get fresh cookies:
#   1. Open https://app-eu1.hubspot.com in your browser (log in if needed)
#   2. DevTools → Application → Cookies → app-eu1.hubspot.com
#   3. Copy the full cookie string (all cookies combined, semicolon-separated)
#   4. Copy the CSRF token: look for "hubspotapi-csrf" or "csrf.app"

set -euo pipefail

# Unset env vars that override railway CLI
unset RAILWAY_TOKEN RAILWAY_API_KEY 2>/dev/null || true

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${BOLD}→${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*" >&2; }

# Check railway CLI is available
if ! command -v railway &>/dev/null; then
    err "railway CLI not found. Install: https://docs.railway.app/develop/cli"
    exit 1
fi

# Check we're linked to the right project
LINKED=$(railway status 2>&1 || true)
if ! echo "$LINKED" | grep -q "hubspot-beta-tracker"; then
    warn "Not linked to hubspot-beta-tracker. Linking..."
    railway link --project hubspot-beta-tracker --workspace "crmbyrsm's Projects" 2>/dev/null
fi

# Get values
if [[ "${1:-}" == "--stdin" ]]; then
    echo ""
    echo -e "${BOLD}HubSpot Session Cookie Rotation (stdin mode)${NC}"
    echo ""
    info "Reading cookie from stdin..."
    COOKIE=$(cat)
    read -rsp "Paste HUBSPOT_PORTAL_CSRF: " CSRF; echo ""
else
    echo ""
    echo -e "${BOLD}HubSpot Session Cookie Rotation${NC}"
    echo ""
    echo "To get fresh cookies:"
    echo "  1. Open https://app-eu1.hubspot.com"
    echo "  2. DevTools → Application → Cookies → app-eu1.hubspot.com"
    echo "  3. Copy the FULL cookie string (all cookies, semicolon-separated)"
    echo "  4. Copy the CSRF token (hubspotapi-csrf or csrf.app value)"
    echo ""
    echo -e "${YELLOW}Tip: Right-click any cookie → 'Copy all' to get the full string${NC}"
    echo ""
    read -rsp "Paste HUBSPOT_PORTAL_COOKIE: " COOKIE; echo ""
    read -rsp "Paste HUBSPOT_PORTAL_CSRF: " CSRF; echo ""
fi

# Validate
if [[ -z "$COOKIE" ]]; then
    err "Cookie is empty. Aborting."
    exit 1
fi
if [[ -z "$CSRF" ]]; then
    err "CSRF token is empty. Aborting."
    exit 1
fi

# Trim whitespace
COOKIE="$(echo -n "$COOKIE" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
CSRF="$(echo -n "$CSRF" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"

# Show confirmation
COOKIE_LEN=${#COOKIE}
CSRF_LEN=${#CSRF}
echo ""
info "Cookie length: $COOKIE_LEN chars"
info "CSRF length: $CSRF_LEN chars"
echo ""

if [[ $COOKIE_LEN -lt 100 ]]; then
    warn "Cookie looks unusually short. Are you sure it's the full cookie string?"
    read -rp "Continue anyway? (y/N): " CONFIRM
    [[ "$CONFIRM" =~ ^[Yy]$ ]] || exit 0
fi

info "Updating Railway variables (both set before deploying)..."

# Set both variables with --skip-deploys, then deploy once
if railway variable set "HUBSPOT_PORTAL_COOKIE=$COOKIE" --service hubspot-beta-tracker --skip-deploys 2>&1; then
    ok "HUBSPOT_PORTAL_COOKIE updated"
else
    err "Failed to set HUBSPOT_PORTAL_COOKIE"
    exit 1
fi

if railway variable set "HUBSPOT_PORTAL_CSRF=$CSRF" --service hubspot-beta-tracker --skip-deploys 2>&1; then
    ok "HUBSPOT_PORTAL_CSRF updated"
else
    err "Failed to set HUBSPOT_PORTAL_CSRF"
    exit 1
fi

echo ""
info "Triggering redeploy..."

if railway up --service hubspot-beta-tracker 2>&1; then
    ok "Redeploy triggered"
else
    warn "Auto-redeploy may have already been triggered by variable changes."
    warn "If not, run: railway up --service hubspot-beta-tracker"
fi

echo ""
echo -e "${GREEN}${BOLD}Done!${NC} Fresh cookies deployed."
echo ""
echo "Verify in ~2 minutes:"
echo "  ./check-health.sh"
echo ""
echo "Or trigger a manual scan:"
echo '  curl -s "https://updates.crmbyrsm.com/api/scan" | head -5'
