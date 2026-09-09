// HubSpot's productupdates-ui reads the `update` query parameter to open
// the individual product-update panel. This is the product update ID, not rollout ID.
export function sourceLink(item) {
  const match = /^portal-([0-9]+)$/.exec(String(item.id || ''));
  if (item.source === 'portal-updates' && match) {
    return `https://app-eu1.hubspot.com/product-updates/139633041/all?update=${match[1]}`;
  }
  return item.sourceUrl;
}
