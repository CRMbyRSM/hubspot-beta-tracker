#!/usr/bin/env bash
# check-health.sh — Verify Beta Tracker is healthy (cookies working, data fresh)
#
# Usage:
#   ./check-health.sh                    # Check live site
#   ./check-health.sh http://localhost:3000  # Check local instance

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()    { echo -e "${GREEN}✓${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
err()   { echo -e "${RED}✗${NC} $*"; }

BASE_URL="${1:-https://updates.crmbyrsm.com}"

echo -e "${BOLD}Beta Tracker Health Check${NC}"
echo "Target: $BASE_URL"
echo ""

# Fetch state
DATA=$(curl -sf "$BASE_URL/api/betas" 2>/dev/null || true)
if [[ -z "$DATA" ]]; then
    err "Cannot reach $BASE_URL/api/betas"
    exit 1
fi

# Parse
TOTAL=$(echo "$DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get('betas',{})))" 2>/dev/null || echo "0")
SCAN_COUNT=$(echo "$DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('scanCount','?'))" 2>/dev/null || echo "?")
LAST_SCAN=$(echo "$DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('lastScan','never'))" 2>/dev/null || echo "never")

# Portal items count (primary data source)
PORTAL=$(echo "$DATA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
betas=d.get('betas',{})
portal=[b for b in betas.values() if str(b.get('id','')).startswith('portal-')]
print(len(portal))
" 2>/dev/null || echo "0")

# Items with real descriptions (not fallback)
WITH_DESC=$(echo "$DATA" | python3 -c "
import json,sys
d=json.load(sys.stdin)
betas=d.get('betas',{})
fallbacks = [
    'Limited private beta. Request access if you need this feature.',
    'Public beta available for testing. Please share feedback with HubSpot.',
    'Now available in HubSpot. Platform feature update.',
    'Now available in HubSpot. Sales Hub feature update.',
    'Now available in HubSpot. Operations Hub feature update.',
    'Now available in HubSpot. Marketing Hub feature update.',
    'Now available in HubSpot. Service Hub feature update.',
    'Tracked HubSpot update. View the source link for complete details.',
]
real = sum(1 for b in betas.values() if b.get('description','').strip() and b.get('description') not in fallbacks)
print(real)
" 2>/dev/null || echo "0")

# Time since last scan
if [[ "$LAST_SCAN" != "never" && "$LAST_SCAN" != "?" ]]; then
    HOURS_SINCE=$(echo "$LAST_SCAN" | python3 -c "
import sys
from datetime import datetime, timezone
last = datetime.fromisoformat(sys.stdin.read().strip().replace('Z','+00:00'))
now = datetime.now(timezone.utc)
delta = (now - last).total_seconds()
print(f'{delta/3600:.1f}')
" 2>/dev/null || echo "?")
else
    HOURS_SINCE="?"
fi

# Reports
echo -e "${BOLD}Data:${NC}"
echo "  Total items: $TOTAL"
echo "  Portal items: $PORTAL"
echo "  With descriptions: $WITH_DESC"
echo "  Scans completed: $SCAN_COUNT"
echo "  Last scan: ${HOURS_SINCE}h ago"
echo ""

# Warnings
ISSUES=0

if [[ "$TOTAL" -lt 1000 ]]; then
    err "Only $TOTAL items — expected 1500+. Cookies may be expired."
    ISSUES=$((ISSUES + 1))
fi

if [[ "$PORTAL" -lt 500 ]]; then
    err "Only $PORTAL portal items — expected 1000+. Portal API auth likely expired."
    echo "  → Run: ./rotate-auth.sh (with fresh cookies from DevTools)"
    ISSUES=$((ISSUES + 1))
fi

if [[ "$HOURS_SINCE" != "?" ]]; then
    OVERDUE=$(echo "$HOURS_SINCE > 10" | python3 -c "import sys; print(sys.stdin.read().strip())" 2>/dev/null || echo "False")
    if [[ "$OVERDUE" == "True" ]]; then
        warn "Last scan was ${HOURS_SINCE}h ago (expected every 8h)"
        ISSUES=$((ISSUES + 1))
    fi
fi

MISSING=$((TOTAL - WITH_DESC))
if [[ "$MISSING" -gt 100 ]]; then
    warn "$MISSING items missing descriptions"
fi

if [[ "$ISSUES" -eq 0 ]]; then
    ok "All checks passed. System healthy."
fi
