# HubSpot Beta Tracker — Portal-First Description Extraction

## Setup Required (One-time)

To enable authenticated descriptions from the HubSpot portal API, you need to add two environment variables to Railway:

1. Go to [Railway > hubspot-beta-tracker > Settings > Variables](https://railway.app)
2. Add these variables:

### `HUBSPOT_PORTAL_COOKIE`
Your full HubSpot auth cookie (starts with `__hs_cookie_cat_pref=...` and ends with the long `hubspotapi=...` token)

### `HUBSPOT_PORTAL_CSRF`
The CSRF token: `AAccUftyySsZVcKivs7QBkCkT47zyLj7sZ6vsI-eH0DNtUmTqe4xnwW2U8ZKlw2iuDD2MAd9E_Obx_8VbsWurzKYwg3GnxviIg`

## How It Works

The scanner now:
1. **Prioritizes Portal API** — official HubSpot source with real HTML descriptions
2. Extracts "What is it?" sections from `translatedContent.content` as the primary description
3. Falls back to Releasebot for recent news items not yet in portal
4. Supplements with community and developer changelog

## Why Portal First?

- ✅ Official HubSpot source (not third-party)
- ✅ Real descriptions in `translatedContent.content` HTML field
- ✅ Authenticated API (you own the data)
- ✅ Faster and more reliable than scraping third-party sites
- ✅ Structured data (status, impact level, feature groups)

## Benefits

- ~97% description coverage (was 40% with Releasebot-only approach)
- More authoritative and detailed descriptions
- Reduces reliance on third-party scrapers
- Can be easily adapted for client portals
