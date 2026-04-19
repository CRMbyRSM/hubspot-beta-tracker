# Contributing to HubSpot Beta Tracker

Maintained by RSM Consulting. For internal use — keep this file updated when changing architecture.

## Architecture

Two files run the entire app:

| File | Role |
|------|------|
| `index.js` | CLI scanner — fetches 4 sources, merges, deduplicates, saves state |
| `server.js` | Express server + single-page dashboard (inline CSS/JS, no build step) |

```
Sources → index.js (scan) → state.json → server.js (serve) → Dashboard
```

### Data Sources (priority order)

1. **HubSpot Portal API** — session-authenticated, paginated, richest descriptions
2. **Releasebot** — HTML scrape, 3 rollup formats
3. **Community** — Playwright (H4 extraction), RSS fallback
4. **Dev Changelog** — RSS feed

## Setup

```bash
cp .env.example .env       # Fill in your values
npm install                # Installs deps + Playwright chromium
node index.js              # Run scan
node server.js             # Start dashboard at :3000
```

## Auth (Session-Based — Expires)

`HUBSPOT_PORTAL_COOKIE` + `HUBSPOT_PORTAL_CSRF` come from a live browser session. They expire.

**When descriptions stop updating:**
1. Open `app-eu1.hubspot.com` in browser
2. DevTools → Application → Cookies
3. Copy `HUBSPOT_PORTAL_COOKIE` and `HUBSPOT_PORTAL_CSRF`
4. Update in Railway dashboard → Variables
5. Next scan will pick them up automatically

**No token rotation script exists.** Manual refresh is the process.

## Key Gotchas

- **`state.json` is 1.7MB+** — managed by `index.js`. Don't edit manually.
- **`descriptions-manual.json` is hand-curated** — merged at runtime, not regenerated. New descriptions require manual write + commit.
- **Playwright postinstall** — installs chromium only (slimmed from 3 browsers). First `npm install` is still slow.
- **Scoring algorithm** — lives in `server.js` `scoreUrgency()` / `scoreRisk()`. No tests.
- **State format** — handles both flat (`{id: item}`) and wrapped (`{betas: {id: item}}`) formats.
- **Noise filtering** — 15+ regex patterns in `NOISE_PATTERNS`, `ROLLUP_PATTERNS`, `INFORMATIONAL_PATTERNS`, `H4_NOISE_PATTERNS`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `API_KEY` | Recommended | Protects `/api/scan?key=...` |
| `HUBSPOT_PORTAL_COOKIE` | Yes | Session cookie from `app-eu1.hubspot.com` |
| `HUBSPOT_PORTAL_CSRF` | Yes | Matching CSRF token |
| `HUBSPOT_ACCESS_TOKEN` | No | Syncs subscribers to HubSpot CRM |
| `PORT` | No | Server port (default: 3000) |

## Common Operations

```bash
# Run scan
node index.js

# JSON output (for cron/scripts)
node index.js --json

# Report only (no scan)
node index.js --report-only

# Trigger scan via API
curl "https://updates.crmbyrsm.com/api/scan?key=YOUR_KEY"

# Deploy
git push origin main  # Railway auto-deploys
```

## Scoring Algorithm

### `scoreUrgency(item)` — "Important Right Now"
- Recency decay: 40pts (≤3d), 26 (≤7d), 14 (≤14d), 6 (≤21d), negative after
- Status: breaking=45, sunset=42, public beta=20, private beta=14, now live=10
- Keywords: deadline=18, required/migrate=16, sandbox/api=8, beta/rollout=6
- Hub bonuses: Developer Platform+4, Operations Hub+4

### `scoreRisk(item)` — "Highest Priority"
- Urgency + sunset/critical bonus (+30) + migration keywords (+18)
- HubSpot `impactLevel >= 10` → "Major Update" badge (+25)

## Description Priority
1. `descriptions-manual.json` (overrides everything)
2. Portal `translatedContent.content` — "What is it?" section (400 char, sentence-boundary)
3. Community/Releasebot scraped text
4. Smart status-based fallback (generated at render time)

## File Reference

```
index.js              — CLI scanner
server.js             — Express server + dashboard
state.json            — Persistent state (~1580+ items, 1.7MB)
history/              — Daily scan snapshots (YYYY-MM-DD.json)
descriptions-manual.json — Curated description overrides
subscribers.json      — Email signups
stats.json            — Page view tracking
package.json          — Dependencies + scripts
Procfile              — Railway deployment
.env.example          — Environment variable template
.redeploy             — Forced redeploy trigger
```

## Brand Rules

Dark theme, RSM brand colors:
- Primary accent: teal `#17a192`
- Background: dark grays `#0a0a0a`, `#111`, `#1a1a1a`
- Hub tags: functional color exceptions allowed
- **Never use orange `#f7931a` or blue `#1a1a2e`** as primary
