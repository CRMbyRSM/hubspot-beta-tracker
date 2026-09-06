# Unraid deployment

The tracker runs as `ghcr.io/crmbyrsm/hubspot-beta-tracker:unraid` on CorsoUnraid.

## Persistent data

Mount `/mnt/user/data/appdata/hubspot-beta-tracker` to `/data`. This preserves:

- `state.json` — tracked product updates and scanner health
- `history/` — daily snapshots
- `portal-auth.json` — the cookie pair submitted only by the Chrome extension
- `subscribers.json` and `stats.json`

The Docker image deliberately excludes those files. Do not place HubSpot cookies, API keys, or Discord webhook values in Git, the Docker image, or the DockerMan template.

The Unraid container receives its existing `ADMIN_KEY`, `API_KEY`, and optional
alert/subscriber credentials directly from Railway during migration; their values
are never written to this repository, NFS manifest, or migration output.

## Initial migration

1. Seed `/data/state.json` from the verified live tracker API backup.
2. Start the container privately on Unraid port 3000.
3. Verify `/api/betas` returns the seeded state. `/api/health` will remain unhealthy until portal authentication is refreshed.
4. Use the existing Chrome extension once against the private service, then verify `/api/health/portal` returns `200`.
5. Preserve Railway as rollback. Only after private verification succeeds, route `updates.crmbyrsm.com` through the CorsoNas Cloudflare Tunnel to `http://192.168.0.254:3000` and read the remote tunnel config back.
6. Verify the public hostname, its APIs, and an anonymous page render. Do not decommission Railway until those checks pass.
