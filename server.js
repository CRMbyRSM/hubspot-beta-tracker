import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'state.json');
const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json');
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';

const app = express();
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'public')));

// ─── API Routes ─────────────────────────────────────────────────────────────

app.get('/api/betas', (_req, res) => {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    res.json(state);
  } catch (err) {
    res.status(500).json({ error: 'Could not read state file' });
  }
});

app.get('/api/scan', async (req, res) => {
  const key = req.query.key || req.headers['x-api-key'];
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  try {
    const { execFile } = await import('child_process');
    const { promisify } = await import('util');
    const exec = promisify(execFile);
    const { stdout } = await exec('node', [path.join(__dirname, 'index.js'), '--json'], { timeout: 60000 });
    res.json({ ok: true, output: JSON.parse(stdout.split('\n').filter(l => l.startsWith('{')).pop() || '{}') });
  } catch (err) {
    res.status(500).json({ error: 'Scan failed', message: err.message });
  }
});

app.post('/api/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // Save locally as backup
  let subscribers = [];
  try { subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8')); } catch {}
  const alreadyLocal = subscribers.some(s => s.email === email);
  if (!alreadyLocal) {
    subscribers.push({ email, subscribedAt: new Date().toISOString() });
    fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
  }

  // Push to HubSpot CRM
  const hsToken = process.env.HUBSPOT_ACCESS_TOKEN;
  if (hsToken) {
    try {
      const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${hsToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }] })
      });
      const searchData = await searchRes.json();

      if (searchData.total > 0) {
        // Contact exists — update with beta tracker source
        const contactId = searchData.results[0].id;
        await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${hsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: { beta_tracker_subscriber: 'true', beta_tracker_subscribed_at: new Date().toISOString() } })
        });
      } else {
        // Create new contact
        await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${hsToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ properties: { email, lifecyclestage: 'lead', hs_lead_status: 'NEW', beta_tracker_subscriber: 'true', beta_tracker_subscribed_at: new Date().toISOString() } })
        });
      }
      console.log(`✅ HubSpot contact synced: ${email}`);
    } catch (err) {
      console.error(`⚠️ HubSpot sync failed for ${email}:`, err.message);
      // Don't fail the request — local backup saved
    }
  }

  res.json({ ok: true, message: alreadyLocal ? 'Already subscribed' : 'Subscribed!' });
});

// ─── Frontend ───────────────────────────────────────────────────────────────

app.get('/', (_req, res) => {
  res.send(HTML);
});

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🔬 HubSpot Beta Tracker running at http://localhost:${PORT}`);
});

// ─── HTML ───────────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HubSpot Product Updates Tracker</title>
<meta name="description" content="Track every HubSpot product update, beta, sunset, and breaking change — updated daily.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="icon" type="image/png" href="/static/favicon.png">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0a;--surface:#111;--surface2:#1a1a1a;--surface3:#222;
  --text:#e8e8e8;--text-muted:#999;--text-dim:#666;
  --teal:#17a192;--orange:#f7931a;
  --radius:8px;
}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--teal);text-decoration:none}a:hover{text-decoration:underline}

/* Layout */
.container{max-width:1400px;margin:0 auto;padding:0 24px}

/* Header */
.header{padding:48px 0 32px;border-bottom:1px solid #1e1e1e}
.header-top{display:flex;align-items:center;gap:20px;margin-bottom:20px}
.header-logo{height:44px;width:auto}
.header h1{font-size:2rem;font-weight:700;text-wrap:balance;letter-spacing:-.02em;color:#fff}
.header h1 span{color:var(--teal)}
.header .subtitle{color:var(--text-muted);font-size:1rem;margin-top:8px;text-wrap:balance}
.header .meta-row{display:flex;gap:20px;align-items:center;margin-top:14px;flex-wrap:wrap}
.header .by{color:var(--text-dim);font-size:.85rem}
.header .by a{color:var(--orange)}
.header .last-scan{color:var(--text-dim);font-size:.85rem}
.header .total-badge{
  background:var(--surface2);border:1px solid #333;color:var(--text-muted);
  padding:4px 12px;border-radius:16px;font-size:.8rem;font-weight:500;
}
.header .total-badge strong{color:var(--teal)}

/* Filters */
.filters-bar{padding:24px 0;border-bottom:1px solid #1e1e1e}
.filter-group{margin-bottom:16px}
.filter-group:last-child{margin-bottom:0}
.filter-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:var(--text-dim);margin-bottom:10px;font-weight:600}
.filter-row{display:flex;gap:10px;flex-wrap:wrap}

.filter-btn{
  background:var(--surface);border:1px solid #2a2a2a;color:var(--text-muted);
  padding:10px 20px;border-radius:8px;font-size:.85rem;font-weight:500;
  cursor:pointer;transition:all .15s ease;font-family:inherit;
  display:flex;align-items:center;gap:8px;
}
.filter-btn:hover{border-color:#444;color:var(--text);background:var(--surface2)}
.filter-btn.active{background:rgba(23,161,146,.12);border-color:var(--teal);color:var(--teal)}
.filter-count{
  font-size:.7rem;font-weight:600;opacity:.6;
  background:rgba(255,255,255,.06);padding:2px 7px;border-radius:10px;
}
.filter-btn.active .filter-count{opacity:1;background:rgba(23,161,146,.2)}

/* Cards */
.grid{display:grid;gap:12px;padding:24px 0 80px}
.card{
  background:var(--surface);border-radius:var(--radius);
  padding:20px 24px;border-left:3px solid #333;
  transition:background .15s,border-color .15s;
}
.card:hover{background:var(--surface2)}
.card[data-status="public beta"]{border-left-color:var(--teal)}
.card[data-status="private beta"]{border-left-color:var(--teal);border-left-style:dashed}
.card[data-status="developer preview"]{border-left-color:var(--teal);opacity:.9}
.card[data-status="early access"]{border-left-color:var(--orange)}
.card[data-status="now live"]{border-left-color:#4ade80}
.card[data-status="live"]{border-left-color:#4ade80}
.card[data-status="sunset"]{border-left-color:var(--orange)}
.card[data-status="breaking change"]{border-left-color:#ef4444}
.card[data-status="update"]{border-left-color:#555}

.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px}
.card-title{font-size:.95rem;font-weight:600;line-height:1.4;color:#fff}
.badge{
  font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  padding:4px 10px;border-radius:6px;white-space:nowrap;flex-shrink:0;
}
.badge[data-status="public beta"]{background:rgba(23,161,146,.15);color:var(--teal)}
.badge[data-status="private beta"]{background:rgba(23,161,146,.1);color:rgba(23,161,146,.7)}
.badge[data-status="developer preview"]{background:rgba(23,161,146,.1);color:rgba(23,161,146,.7)}
.badge[data-status="early access"]{background:rgba(247,147,26,.12);color:var(--orange)}
.badge[data-status="now live"]{background:rgba(74,222,128,.12);color:#4ade80}
.badge[data-status="live"]{background:rgba(74,222,128,.12);color:#4ade80}
.badge[data-status="sunset"]{background:rgba(247,147,26,.12);color:var(--orange)}
.badge[data-status="breaking change"]{background:rgba(239,68,68,.12);color:#ef4444}
.badge[data-status="update"]{background:rgba(255,255,255,.05);color:#888}

/* Hub tags on cards */
.hub-tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.hub-tag,.hub-pill{
  font-size:.65rem;font-weight:600;
  padding:3px 10px;border-radius:4px;white-space:nowrap;
}

.card-desc{color:#ccc;font-size:.85rem;line-height:1.5;margin-bottom:12px;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:.75rem;color:var(--text-dim)}
.card-meta a{color:var(--teal);font-size:.75rem}

/* Lead capture banner */
.lead-banner{
  position:fixed;bottom:0;left:0;right:0;
  background:var(--surface2);border-top:1px solid #333;
  padding:20px 24px;
  transform:translateY(100%);transition:transform .4s ease;
  z-index:100;
}
.lead-banner.visible{transform:translateY(0)}
.lead-inner{max-width:900px;margin:0 auto;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.lead-text{flex:1;min-width:280px}
.lead-text strong{color:var(--teal);font-size:.95rem}
.lead-text p{color:var(--text-muted);font-size:.8rem;margin-top:4px}
.lead-form{display:flex;gap:8px}
.lead-form input{
  background:var(--surface);border:1px solid #333;color:var(--text);
  padding:10px 16px;border-radius:6px;font-size:.85rem;font-family:inherit;
  width:260px;outline:none;
}
.lead-form input:focus{border-color:var(--teal)}
.lead-form button{
  background:var(--teal);color:#fff;border:none;padding:10px 20px;
  border-radius:6px;font-size:.85rem;font-weight:600;cursor:pointer;
  font-family:inherit;transition:opacity .2s;white-space:nowrap;
}
.lead-form button:hover{opacity:.9}
.lead-close{
  background:none;border:none;color:var(--text-dim);font-size:1.2rem;
  cursor:pointer;padding:4px 8px;line-height:1;
}

/* Footer */
.footer{border-top:1px solid #1e1e1e;padding:32px 0;text-align:center;color:var(--text-dim);font-size:.8rem}
.footer a{color:var(--orange)}

/* Responsive */
@media(max-width:640px){
  .header h1{font-size:1.5rem}
  .filter-btn{padding:8px 14px;font-size:.8rem}
  .card{padding:16px}
  .lead-inner{flex-direction:column;text-align:center}
  .lead-form{flex-direction:column;width:100%}
  .lead-form input{width:100%}
}

.loading{text-align:center;padding:80px 0;color:var(--text-muted)}
.empty{text-align:center;padding:60px 0;color:var(--text-dim)}
</style>
</head>
<body>

<div class="container">
  <header class="header">
    <div class="header-top">
      <a href="https://crmbyrsm.com" target="_blank" rel="noopener"><img src="/static/rsm-logo.png" alt="RSM Consulting" class="header-logo"></a>
    </div>
    <h1>HubSpot <span>Product Updates Tracker</span></h1>
    <p class="subtitle">Track every product update, beta, sunset, and breaking change — updated daily</p>
    <div class="meta-row">
      <span class="by">Built by <a href="https://crmbyrsm.com" target="_blank" rel="noopener">RSM Consulting</a></span>
      <span class="last-scan" id="lastScan"></span>
      <span class="total-badge" id="totalBadge"></span>
    </div>
  </header>

  <div class="filters-bar">
    <div class="filter-group">
      <div class="filter-label">Status</div>
      <div class="filter-row" id="statusFilters"></div>
    </div>
    <div class="filter-group">
      <div class="filter-label">Hub</div>
      <div class="filter-row" id="hubFilters"></div>
    </div>
  </div>
  <div class="grid" id="grid">
    <div class="loading">Loading updates…</div>
  </div>
</div>

<div class="lead-banner" id="leadBanner">
  <div class="lead-inner">
    <div class="lead-text">
      <strong>Get weekly update digests + actionable insights</strong>
      <p>Know what's changing in HubSpot before it hits your portal.</p>
    </div>
    <form class="lead-form" id="leadForm">
      <input type="email" placeholder="you@company.com" required id="leadEmail">
      <button type="submit">Subscribe</button>
    </form>
    <button class="lead-close" id="leadClose" aria-label="Close">&times;</button>
  </div>
</div>

<footer class="footer container">
  Data sourced from HubSpot Developer Changelog, Community Board &amp; Releasebot &nbsp;·&nbsp;
  Updated daily &nbsp;·&nbsp;
  <a href="https://crmbyrsm.com" target="_blank" rel="noopener">RSM Consulting</a>
</footer>

<script>
const STATUS_ORDER = ['public beta','private beta','developer preview','early access','now live','live','sunset','breaking change','update'];
const HUB_FILTER_ORDER = ['Marketing Hub','Sales Hub','Service Hub','CMS Hub','Operations Hub','Commerce Hub','Developer Platform','Breeze AI'];

let allBetas = [];
let activeStatuses = new Set();  // empty = show all
let activeHubs = new Set();      // empty = show all

function titleCase(s) { return s.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }

async function init() {
  try {
    const res = await fetch('/api/betas');
    const data = await res.json();
    allBetas = Object.values(data.betas || {})
      .sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
    renderMeta(data);
    renderStatusFilters();
    renderHubFilters();
    renderGrid();
  } catch (e) {
    document.getElementById('grid').innerHTML = '<div class="empty">Failed to load data.</div>';
  }
}

function renderMeta(data) {
  const total = Object.keys(data.betas || {}).length;
  const lastScan = data.lastScan
    ? new Date(data.lastScan).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : 'Never';
  document.getElementById('lastScan').textContent = 'Last scan: ' + lastScan;
  document.getElementById('totalBadge').innerHTML = '<strong>' + total + '</strong> items tracked';
}

function renderStatusFilters() {
  const counts = {};
  allBetas.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });

  let html = '';
  STATUS_ORDER.forEach(s => {
    if (counts[s]) {
      html += '<button class="filter-btn" data-status="' + s + '">' +
        titleCase(s) + '<span class="filter-count">' + counts[s] + '</span></button>';
    }
  });
  const el = document.getElementById('statusFilters');
  el.innerHTML = html;
  el.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    const status = btn.dataset.status;
    if (activeStatuses.has(status)) {
      activeStatuses.delete(status);
      btn.classList.remove('active');
    } else {
      activeStatuses.add(status);
      btn.classList.add('active');
    }
    renderGrid();
  });
}

function renderHubFilters() {
  const hubCounts = {};
  allBetas.forEach(b => {
    (b.hubs || ['Platform']).forEach(h => { hubCounts[h] = (hubCounts[h] || 0) + 1; });
  });

  let html = '';
  HUB_FILTER_ORDER.forEach(h => {
    if (hubCounts[h]) {
      html += '<button class="filter-btn" data-hub="' + h + '">' +
        h.replace(' Hub','') + '<span class="filter-count">' + hubCounts[h] + '</span></button>';
    }
  });
  const el = document.getElementById('hubFilters');
  el.innerHTML = html;
  el.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    const hub = btn.dataset.hub;
    if (activeHubs.has(hub)) {
      activeHubs.delete(hub);
      btn.classList.remove('active');
    } else {
      activeHubs.add(hub);
      btn.classList.add('active');
    }
    renderGrid();
  });
}

function renderGrid() {
  let filtered = allBetas;
  if (activeStatuses.size > 0) {
    filtered = filtered.filter(b => activeStatuses.has(b.status));
  }
  if (activeHubs.size > 0) {
    filtered = filtered.filter(b => (b.hubs || ['Platform']).some(h => activeHubs.has(h)));
  }
  if (!filtered.length) {
    document.getElementById('grid').innerHTML = '<div class="empty">No items match these filters.</div>';
    return;
  }
  const now = Date.now();
  document.getElementById('grid').innerHTML = filtered.map(b => {
    const days = Math.max(0, Math.floor((now - new Date(b.firstSeen).getTime()) / 86400000));
    const firstSeen = new Date(b.firstSeen).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
    const desc = (b.description || '').replace(/</g, '&lt;');
    const sourceLabel = { 'dev-changelog':'Dev Changelog', 'community':'Community', 'releasebot':'Releasebot', 'product-updates':'Product Updates' }[b.source] || b.source;
    const hubs = b.hubs || ['Platform'];
    const hubTags = hubs.map(h => '<span class="hub-tag">' + h + '</span>').join('');
    return '<div class="card" data-status="' + b.status + '">' +
      '<div class="card-top">' +
        '<span class="card-title">' + b.title + '</span>' +
        '<span class="badge" data-status="' + b.status + '">' + b.status + '</span>' +
      '</div>' +
      '<div class="hub-tags">' + hubTags + '</div>' +
      (desc ? '<p class="card-desc">' + desc + '</p>' : '') +
      '<div class="card-meta">' +
        '<span>' + firstSeen + '</span>' +
        '<span>' + days + 'd tracked</span>' +
        '<span>' + sourceLabel + '</span>' +
        (b.sourceUrl ? '<a href="' + b.sourceUrl + '" target="_blank" rel="noopener">Source ↗</a>' : '') +
      '</div></div>';
  }).join('');
}

// Lead banner
let bannerDismissed = false;
function showBanner() {
  if (bannerDismissed) return;
  document.getElementById('leadBanner').classList.add('visible');
}
setTimeout(showBanner, 10000);
let scrollShown = false;
window.addEventListener('scroll', () => {
  if (!scrollShown && window.scrollY > 400) { scrollShown = true; showBanner(); }
}, { passive: true });

document.getElementById('leadClose').onclick = () => {
  document.getElementById('leadBanner').classList.remove('visible');
  bannerDismissed = true;
};

document.getElementById('leadForm').onsubmit = async (e) => {
  e.preventDefault();
  const email = document.getElementById('leadEmail').value;
  const btn = e.target.querySelector('button');
  btn.textContent = '…';
  try {
    const res = await fetch('/api/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    btn.textContent = '✓ Subscribed';
    btn.disabled = true;
    setTimeout(() => {
      document.getElementById('leadBanner').classList.remove('visible');
      bannerDismissed = true;
    }, 2000);
  } catch {
    btn.textContent = 'Error — retry';
  }
};

init();
</script>
</body>
</html>`;
