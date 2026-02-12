# 🔬 HubSpot Beta Tracker

Track every HubSpot beta, sunset, and breaking change — updated daily.

**By [RSM Consulting](https://crmbyrsm.com)**

## What It Does

Scrapes multiple HubSpot sources for beta features, tracks their lifecycle over time, and serves a public dashboard showing the current state of all tracked items.

### Sources
- **Developer Changelog RSS** — developers.hubspot.com/changelog
- **Community Releases & Updates** — community.hubspot.com
- **Releasebot** — releasebot.io/updates/hubspot

### Tracked Statuses
Public Beta · Private Beta · Now Live · Sunset · Breaking Change · Mentioned

## Running Locally

```bash
npm install
node server.js
# → http://localhost:3000
```

Set `PORT` env var to change the port.

## API

| Endpoint | Method | Description |
|---|---|---|
| `/api/betas` | GET | Returns all tracked betas (state.json) |
| `/api/scan?key=YOUR_KEY` | GET | Triggers a fresh scan (requires `API_KEY` env var) |
| `/api/subscribe` | POST | Email signup for weekly digest (`{ "email": "..." }`) |

## Running a Scan

```bash
# CLI (direct)
node index.js

# Via API (when server is running)
curl "http://localhost:3000/api/scan?key=YOUR_API_KEY"
```

## Deploying to Railway

1. Push to GitHub
2. Connect repo in Railway
3. Set env vars: `API_KEY` (for scan endpoint protection)
4. Railway auto-detects `Procfile` and deploys

## Tech Stack

- **Express** — serves dashboard + API
- **Single HTML page** — inline CSS/JS, no build step
- **fast-xml-parser** — RSS parsing
- **node-html-parser** — HTML scraping
- **ESM** — native ES modules throughout

## Brand

Dark theme with RSM brand colors: teal (#17a192) and orange (#f7931a) accents on neutral dark grays. No blue.
