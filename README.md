# HubSpot Beta Tracker

Track every HubSpot beta, public release, sunset, and breaking change — updated daily.

**Live:** https://hubspot-beta-tracker-production.up.railway.app/
**By [RSM Consulting](https://crmbyrsm.com)**

---

## What It Does

Aggregates HubSpot product updates from multiple sources, deduplicates them, and serves a public dashboard with filters, hub categorization, and curated highlights for the most important changes.

**1,500+ items tracked · Updated daily · 97% description coverage**

### Sources (priority order)
1. **HubSpot Portal API** — authenticated access to `product-updates/v3` — the most authoritative source with full descriptions via `translatedContent.content`
2. **Releasebot** — releasebot.io/updates/hubspot — catches latest news before it hits the portal
3. **Community Releases & Updates** — community.hubspot.com
4. **Developer Changelog** — developers.hubspot.com/changelog

### Tracked Statuses
Public Beta · Private Beta · Developer Preview · Early Access · Now Live · Sunset · Breaking Change · Update

### Hub Categories
Marketing Hub · Sales Hub · Service Hub · CMS Hub · Operations Hub · Commerce Hub · Developer Platform · Breeze AI

---

## "Important Right Now" Section

The top section is automatically curated using a scoring algorithm that considers:
- **HubSpot `impactLevel >= 10`** → shown as "Major Update" badge (+25 score)
- **Status** (sunset/breaking change = highest risk)
- **Recency** (newer items score higher)
- **Keywords** (migrate, required, deprecated, etc.)

---

## Running Locally

```bash
npm install
node server.js
# → http://localhost:3000
```

Set `PORT` env var to change the port.

---

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/betas` | GET | All tracked items (`{ betas: {...}, lastScan, scanCount }`) |
| `/api/scan?key=YOUR_KEY` | GET | Triggers a fresh scan (requires `API_KEY` env var) |
| `/api/subscribe` | POST | Email signup `{ "email": "..." }` |

---

## Running a Scan

```bash
# CLI (direct)
node index.js

# Via API (when server is running)
curl "http://localhost:3000/api/scan?key=YOUR_API_KEY"
```

---

## Deploying to Railway

1. Push to GitHub
2. Connect repo in Railway
3. Set environment variables (see below)
4. Railway auto-detects `Procfile` and deploys

### Required Environment Variables

| Variable | Description |
|---|---|
| `API_KEY` | Protects the `/api/scan` endpoint |
| `HUBSPOT_PORTAL_COOKIE` | Full HubSpot session cookie for portal API auth |
| `HUBSPOT_PORTAL_CSRF` | CSRF token matching the session cookie |

> ⚠️ `HUBSPOT_PORTAL_COOKIE` and `HUBSPOT_PORTAL_CSRF` are session-based and will expire. When descriptions stop updating, refresh them from your browser's DevTools → Application → Cookies on `app-eu1.hubspot.com`.

---

## Architecture

```
index.js       — CLI scanner (runs daily via cron)
server.js      — Express web server + single-page dashboard
state.json     — Persistent state (~1,500+ items)
history/       — Daily scan snapshots
descriptions-manual.json — Curated description overrides (highest priority)
subscribers.json — Email signups
```

### Description Strategy (priority order)
1. `descriptions-manual.json` override
2. Portal `translatedContent.content` HTML → extracts "What is it?" section (220 char max)
3. Releasebot page text
4. Smart status-based fallback (generated at render time)

### Source URL Strategy
- Portal items with KB article → `kbArticleLink`
- Portal items with community post → `communityForumLink`  
- Everything else → `https://www.hubspot.com/product-updates`
- Never: private `app-eu1.hubspot.com` URLs (require login)

---

## Tech Stack

- **Express** — serves dashboard + API
- **Single HTML page** — inline CSS/JS, no build step required
- **fast-xml-parser** — RSS parsing
- **node-html-parser** — HTML scraping
- **Playwright** — community board scraping (auto-installed via postinstall)
- **ESM** — native ES modules throughout

---

## Brand

Dark theme, RSM brand colors:
- Primary accent: teal `#17a192`
- Background: dark grays `#0a0a0a`, `#111`, `#1a1a1a`
- Hub tags: functional color exceptions allowed
- **Never use orange `#f7931a` or blue `#1a1a2e`**
