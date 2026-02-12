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

app.post('/api/subscribe', (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  let subscribers = [];
  try { subscribers = JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8')); } catch {}
  if (subscribers.some(s => s.email === email)) {
    return res.json({ ok: true, message: 'Already subscribed' });
  }
  subscribers.push({ email, subscribedAt: new Date().toISOString() });
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(subscribers, null, 2));
  res.json({ ok: true, message: 'Subscribed!' });
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
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0a;--surface:#111;--surface2:#1a1a1a;--surface3:#222;
  --text:#e8e8e8;--text-muted:#888;--text-dim:#555;
  --teal:#17a192;--orange:#f7931a;
  --purple:#9b59b6;--green:#2ecc71;--red:#e74c3c;--gray:#666;
  --radius:8px;
}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--teal);text-decoration:none}a:hover{text-decoration:underline}

/* Layout */
.container{max-width:1400px;margin:0 auto;padding:0 24px}

/* Header */
.header{padding:48px 0 32px;border-bottom:1px solid #1a1a1a}
.header h1{font-size:2.2rem;font-weight:700;text-wrap:balance;letter-spacing:-.02em}
.header h1 span{color:var(--teal)}
.header .subtitle{color:var(--text-muted);font-size:1.05rem;margin-top:8px;text-wrap:balance}
.header .by{color:var(--text-dim);font-size:.85rem;margin-top:12px}
.header .by a{color:var(--orange)}

/* Stats bar */
.stats{display:flex;gap:24px;flex-wrap:wrap;padding:24px 0;border-bottom:1px solid #1a1a1a}
.stat{display:flex;flex-direction:column}
.stat-value{font-size:1.5rem;font-weight:700;color:var(--teal)}
.stat-label{font-size:.75rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)}
.stats-section{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
.stats-divider{width:1px;height:40px;background:#333;margin:0 8px}

/* Filters */
.filter-section{padding:16px 0;border-bottom:1px solid #1a1a1a}
.filter-label{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim);margin-bottom:8px;font-weight:600}
.filter-row{display:flex;gap:8px;flex-wrap:wrap}
.filter-btn{
  background:var(--surface);border:1px solid #222;color:var(--text-muted);
  padding:8px 16px;border-radius:20px;font-size:.8rem;font-weight:500;
  cursor:pointer;transition:all .2s;font-family:inherit;
}
.filter-btn:hover{border-color:#444;color:var(--text)}
.filter-btn.active{background:var(--teal);border-color:var(--teal);color:#fff}
.filter-count{font-size:.7rem;opacity:.7;margin-left:4px}

/* Hub filter pills */
.hub-filter-btn{
  background:var(--surface);border:1px solid #333;color:var(--text-muted);
  padding:6px 14px;border-radius:16px;font-size:.75rem;font-weight:500;
  cursor:pointer;transition:all .2s;font-family:inherit;
}
.hub-filter-btn:hover{border-color:#555;color:var(--text)}
.hub-filter-btn.active{color:#fff;border-color:transparent}

/* Cards */
.grid{display:grid;gap:16px;padding:8px 0 48px}
.card{
  background:var(--surface);border-radius:var(--radius);
  padding:20px 24px;border-left:3px solid var(--text-dim);
  transition:background .2s,border-color .2s;
}
.card:hover{background:var(--surface2)}
.card[data-status="public beta"]{border-left-color:var(--teal)}
.card[data-status="private beta"]{border-left-color:var(--purple)}
.card[data-status="developer preview"]{border-left-color:#9b59b6}
.card[data-status="early access"]{border-left-color:#f39c12}
.card[data-status="now live"]{border-left-color:var(--green)}
.card[data-status="live"]{border-left-color:#3498db}
.card[data-status="sunset"]{border-left-color:var(--orange)}
.card[data-status="breaking change"]{border-left-color:var(--red)}
.card[data-status="update"]{border-left-color:var(--gray)}

.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:6px}
.card-title{font-size:1rem;font-weight:600;line-height:1.4}
.badge{
  font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  padding:4px 10px;border-radius:12px;white-space:nowrap;flex-shrink:0;
}
.badge[data-status="public beta"]{background:rgba(23,161,146,.15);color:var(--teal)}
.badge[data-status="private beta"]{background:rgba(155,89,182,.15);color:var(--purple)}
.badge[data-status="developer preview"]{background:rgba(155,89,182,.15);color:#b97ed3}
.badge[data-status="early access"]{background:rgba(243,156,18,.15);color:#f39c12}
.badge[data-status="now live"]{background:rgba(46,204,113,.15);color:var(--green)}
.badge[data-status="live"]{background:rgba(52,152,219,.15);color:#3498db}
.badge[data-status="sunset"]{background:rgba(247,147,26,.15);color:var(--orange)}
.badge[data-status="breaking change"]{background:rgba(231,76,60,.15);color:var(--red)}
.badge[data-status="update"]{background:rgba(102,102,102,.15);color:var(--gray)}

/* Hub badges */
.hub-badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.hub-pill{
  font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.04em;
  padding:3px 8px;border-radius:10px;white-space:nowrap;color:#fff;
}

.card-desc{color:var(--text-muted);font-size:.85rem;line-height:1.5;margin-bottom:12px;
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
.footer{border-top:1px solid #1a1a1a;padding:32px 0;text-align:center;color:var(--text-dim);font-size:.8rem}
.footer a{color:var(--orange)}

/* Responsive */
@media(max-width:640px){
  .header h1{font-size:1.6rem}
  .stats{gap:16px}
  .stat-value{font-size:1.2rem}
  .card{padding:16px}
  .lead-inner{flex-direction:column;text-align:center}
  .lead-form{flex-direction:column;width:100%}
  .lead-form input{width:100%}
  .stats-divider{display:none}
}

.loading{text-align:center;padding:80px 0;color:var(--text-muted)}
.empty{text-align:center;padding:60px 0;color:var(--text-dim)}
</style>
</head>
<body>

<div class="container">
  <header class="header">
    <h1>🔬 HubSpot <span>Product Updates Tracker</span></h1>
    <p class="subtitle">Track every product update, beta, sunset, and breaking change — updated daily</p>
    <p class="by">Community-driven HubSpot changelog tracker</p>
  </header>

  <div class="stats" id="stats"></div>
  <div class="filter-section" id="statusFilterSection">
    <div class="filter-label">Filter by Status</div>
    <div class="filter-row" id="filters"></div>
  </div>
  <div class="filter-section" id="hubFilterSection">
    <div class="filter-label">Filter by Hub</div>
    <div class="filter-row" id="hubFilters"></div>
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
  Updated daily
</footer>

<script>
const STATUS_ORDER = ['public beta','private beta','developer preview','early access','now live','live','sunset','breaking change','update'];

const HUB_COLORS = {
  'Marketing Hub':'#ff7a59',
  'Sales Hub':'#00bda5',
  'Service Hub':'#f5c26b',
  'CMS Hub':'#7c98b6',
  'Operations Hub':'#cbd6e2',
  'Commerce Hub':'#f7931a',
  'Developer Platform':'#17a192',
  'Breeze AI':'#a855f7',
  'Platform':'#666'
};

const HUB_FILTER_ORDER = ['Marketing Hub','Sales Hub','Service Hub','CMS Hub','Operations Hub','Commerce Hub','Developer Platform','Breeze AI'];

let allBetas = [];
let activeStatusFilter = 'all';
let activeHubFilter = 'all';

async function init() {
  try {
    const res = await fetch('/api/betas');
    const data = await res.json();
    allBetas = Object.values(data.betas || {})
      .sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
    renderStats(data);
    renderFilters();
    renderHubFilters();
    renderGrid();
  } catch (e) {
    document.getElementById('grid').innerHTML = '<div class="empty">Failed to load data.</div>';
  }
}

function renderStats(data) {
  const betas = Object.values(data.betas || {});
  const statusCounts = {};
  const hubCounts = {};
  betas.forEach(b => {
    statusCounts[b.status] = (statusCounts[b.status] || 0) + 1;
    (b.hubs || ['Platform']).forEach(h => { hubCounts[h] = (hubCounts[h] || 0) + 1; });
  });

  let html = '<div class="stats-section">';
  html += '<div class="stat"><span class="stat-value">' + betas.length + '</span><span class="stat-label">Total Tracked</span></div>';
  STATUS_ORDER.forEach(s => {
    if (statusCounts[s]) {
      html += '<div class="stat"><span class="stat-value">' + statusCounts[s] + '</span><span class="stat-label">' + s + '</span></div>';
    }
  });
  const lastScan = data.lastScan ? new Date(data.lastScan).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : 'Never';
  html += '<div class="stat"><span class="stat-value" style="font-size:1rem">' + lastScan + '</span><span class="stat-label">Last Scan</span></div>';
  html += '</div>';

  html += '<div class="stats-divider"></div>';

  html += '<div class="stats-section">';
  HUB_FILTER_ORDER.forEach(h => {
    if (hubCounts[h]) {
      html += '<div class="stat"><span class="stat-value" style="color:' + HUB_COLORS[h] + '">' + hubCounts[h] + '</span><span class="stat-label">' + h.replace(' Hub','') + '</span></div>';
    }
  });
  html += '</div>';

  document.getElementById('stats').innerHTML = html;
}

function renderFilters() {
  const counts = { all: allBetas.length };
  allBetas.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });

  let html = '<button class="filter-btn active" data-filter="all">All<span class="filter-count">' + counts.all + '</span></button>';
  STATUS_ORDER.forEach(s => {
    if (counts[s]) {
      html += '<button class="filter-btn" data-filter="' + s + '">' +
        s.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') +
        '<span class="filter-count"> ' + counts[s] + '</span></button>';
    }
  });
  const el = document.getElementById('filters');
  el.innerHTML = html;
  el.addEventListener('click', e => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    el.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeStatusFilter = btn.dataset.filter;
    renderGrid();
  });
}

function renderHubFilters() {
  const hubCounts = { all: allBetas.length };
  allBetas.forEach(b => {
    (b.hubs || ['Platform']).forEach(h => { hubCounts[h] = (hubCounts[h] || 0) + 1; });
  });

  let html = '<button class="hub-filter-btn active" data-hub="all" style="background:var(--teal)">All Hubs<span class="filter-count"> ' + hubCounts.all + '</span></button>';
  HUB_FILTER_ORDER.forEach(h => {
    if (hubCounts[h]) {
      const label = h.replace(' Hub','');
      html += '<button class="hub-filter-btn" data-hub="' + h + '" data-color="' + HUB_COLORS[h] + '">' +
        label + '<span class="filter-count"> ' + hubCounts[h] + '</span></button>';
    }
  });
  const el = document.getElementById('hubFilters');
  el.innerHTML = html;
  el.addEventListener('click', e => {
    const btn = e.target.closest('.hub-filter-btn');
    if (!btn) return;
    el.querySelectorAll('.hub-filter-btn').forEach(b => {
      b.classList.remove('active');
      b.style.background = 'var(--surface)';
      b.style.color = 'var(--text-muted)';
    });
    btn.classList.add('active');
    btn.style.background = btn.dataset.hub === 'all' ? 'var(--teal)' : btn.dataset.color;
    btn.style.color = '#fff';
    activeHubFilter = btn.dataset.hub;
    renderGrid();
  });
}

function renderGrid() {
  let filtered = allBetas;
  if (activeStatusFilter !== 'all') {
    filtered = filtered.filter(b => b.status === activeStatusFilter);
  }
  if (activeHubFilter !== 'all') {
    filtered = filtered.filter(b => (b.hubs || ['Platform']).includes(activeHubFilter));
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
    const hubPills = hubs.map(h => {
      const color = HUB_COLORS[h] || '#666';
      const textColor = (h === 'Operations Hub' || h === 'Service Hub') ? '#111' : '#fff';
      return '<span class="hub-pill" style="background:' + color + ';color:' + textColor + '">' + h + '</span>';
    }).join('');
    return '<div class="card" data-status="' + b.status + '">' +
      '<div class="card-top">' +
        '<span class="card-title">' + b.title + '</span>' +
        '<span class="badge" data-status="' + b.status + '">' + b.status + '</span>' +
      '</div>' +
      '<div class="hub-badges">' + hubPills + '</div>' +
      (desc ? '<p class="card-desc">' + desc + '</p>' : '') +
      '<div class="card-meta">' +
        '<span>📅 ' + firstSeen + '</span>' +
        '<span>⏱ ' + days + 'd tracked</span>' +
        '<span>📡 ' + sourceLabel + '</span>' +
        (b.sourceUrl ? '<a href="' + b.sourceUrl + '" target="_blank" rel="noopener">View source ↗</a>' : '') +
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
