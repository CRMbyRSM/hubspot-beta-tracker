const DEFAULT_ENDPOINT = 'https://updates.crmbyrsm.com/api/admin/portal-cookies/refresh';
const HUBSPOT_URL = 'https://app-eu1.hubspot.com/product-updates/139633041/all';

const statusEl = document.getElementById('status');
const refreshBtn = document.getElementById('refresh');

function setStatus(message, cls = '') {
  statusEl.className = `status ${cls}`.trim();
  statusEl.textContent = message;
}

async function getConfig() {
  return chrome.storage.sync.get({ endpoint: DEFAULT_ENDPOINT, adminKey: '' });
}

function getCookie(name) {
  return chrome.cookies.get({ url: 'https://app-eu1.hubspot.com/', name });
}

async function refreshTracker() {
  refreshBtn.disabled = true;
  try {
    const { endpoint, adminKey } = await getConfig();
    if (!adminKey) {
      setStatus('Missing admin key. Click Settings and paste the tracker admin key first.', 'warn');
      chrome.runtime.openOptionsPage();
      return;
    }

    setStatus('Reading HubSpot cookies from this Chrome profile…');
    const [hubspotapi, csrf] = await Promise.all([
      getCookie('hubspotapi'),
      getCookie('hubspotapi-csrf'),
    ]);

    if (!hubspotapi?.value || !csrf?.value) {
      setStatus(`Could not find required HubSpot cookies.\n\nOpen this page while logged in, then try again:\n${HUBSPOT_URL}`, 'err');
      return;
    }

    setStatus('Cookies found. Validating with tracker and refreshing Railway…');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Key': adminKey,
      },
      body: JSON.stringify({ hubspotapi: hubspotapi.value, csrf: csrf.value }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      setStatus(`Refresh failed.\n\n${data.error || data.validation?.message || `HTTP ${response.status}`}`, 'err');
      return;
    }

    const portal = data.scan?.portal || {};
    const lines = [
      'Done. Tracker refreshed.',
      `Portal status: ${portal.status || 'ok'}`,
      `Last portal item: ${portal.latestPortalItemDate || data.validation?.latestPortalItem?.pubDate || 'unknown'}`,
    ];
    if (portal.latestPortalItemTitle || data.validation?.latestPortalItem?.title) {
      lines.push(portal.latestPortalItemTitle || data.validation.latestPortalItem.title);
    }
    lines.push('Discord confirmation should arrive shortly.');
    setStatus(lines.join('\n'), 'ok');
  } catch (err) {
    setStatus(`Refresh errored.\n\n${err.message}`, 'err');
  } finally {
    refreshBtn.disabled = false;
  }
}

document.getElementById('refresh').addEventListener('click', refreshTracker);
document.getElementById('openHubSpot').addEventListener('click', () => chrome.tabs.create({ url: HUBSPOT_URL }));
document.getElementById('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
