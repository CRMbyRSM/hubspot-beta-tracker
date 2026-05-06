const DEFAULT_ENDPOINT = 'https://updates.crmbyrsm.com/api/admin/portal-cookies/refresh';
const endpointEl = document.getElementById('endpoint');
const adminKeyEl = document.getElementById('adminKey');
const statusEl = document.getElementById('status');

chrome.storage.sync.get({ endpoint: DEFAULT_ENDPOINT, adminKey: '' }, (cfg) => {
  endpointEl.value = cfg.endpoint;
  adminKeyEl.value = cfg.adminKey;
});

document.getElementById('save').addEventListener('click', () => {
  const endpoint = endpointEl.value.trim() || DEFAULT_ENDPOINT;
  const adminKey = adminKeyEl.value.trim();
  chrome.storage.sync.set({ endpoint, adminKey }, () => {
    statusEl.textContent = 'Saved.';
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  });
});
