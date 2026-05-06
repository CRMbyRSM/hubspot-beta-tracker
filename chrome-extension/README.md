# RSM HubSpot Tracker Refresh Chrome Extension

This extension refreshes the HubSpot Product Updates tracker from Ricardo's main Chrome HubSpot session.

## Install locally

1. Open Chrome: `chrome://extensions/`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this `chrome-extension/` folder.
5. Open extension **Details** → **Extension options**.
6. Paste the tracker admin key.

## Use

1. Open `https://app-eu1.hubspot.com/product-updates/139633041/all` while logged into HubSpot.
2. Click the extension button.
3. Click **Refresh tracker from this HubSpot session**.
4. Wait for the popup result and Discord confirmation.

## What it reads

Only these cookies from `app-eu1.hubspot.com`:

- `hubspotapi`
- `hubspotapi-csrf`

The extension does not display or store cookie values. It sends them directly to the tracker refresh endpoint over HTTPS.
