import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'state.json');
const SUBSCRIBERS_FILE = path.join(__dirname, 'subscribers.json');
const PORT = process.env.PORT || 3000;
import { spawn } from 'child_process';
const SCAN_INTERVAL_MS = 24 * 60 * 60 * 1000; // once per day

function runScan() {
  console.log('[scanner] Starting scheduled scan...');
  const child = spawn('node', ['index.js'], { cwd: __dirname, stdio: 'inherit' });
  child.on('exit', code => console.log('[scanner] Scan finished, exit code:', code));
  child.on('error', err => console.error('[scanner] Scan error:', err.message));
}

// Run once on startup (after 30s delay to let server stabilise)
setTimeout(runScan, 30000);
// Then every 8 hours
setInterval(runScan, SCAN_INTERVAL_MS);

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
<title>HubSpot Important Updates by RSM</title>
<meta name="description" content="Curated HubSpot betas, important updates, and change notes that affect your portal or your clients' portals.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="icon" type="image/png" href="/static/favicon.png">
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600&family=Poppins:wght@600;700&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0a0a0a;--surface:#111111;--surface2:#1a1a1a;--surface3:#222222;
  --text:#e0e0e0;--text-muted:#888888;--white:#ffffff;
  --teal:#17a192;--orange:#f7931a;--red:#ef4444;--green:#4ade80;
  --radius:8px;--container:83rem;
}
html{scroll-behavior:smooth}
body{font-family:'Montserrat',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:var(--teal);text-decoration:none}a:hover{text-decoration:underline}
.container{max-width:var(--container);margin:0 auto;padding:0 24px}

.topbar{border-bottom:1px solid #1d1d1d;background:rgba(10,10,10,.95);backdrop-filter:blur(10px);position:sticky;top:0;z-index:80}
.topbar-inner{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:18px 0;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:14px;min-width:0}
.brand-logo{width:38px;height:38px;border-radius:8px;flex-shrink:0}
.brand-copy{min-width:0}
.brand-title{font-family:'Poppins',system-ui,sans-serif;font-size:1.1rem;font-weight:700;line-height:1.2;color:var(--white);text-wrap:balance}
.brand-subtitle{font-size:.88rem;color:var(--text-muted);max-width:760px}
.topbar-actions{display:flex;align-items:center;gap:10px;flex-wrap:nowrap;width:100%}
.meta-chip{background:var(--surface2);border:1px solid #2b2b2b;color:var(--text-muted);padding:8px 12px;border-radius:8px;font-size:.8rem}
.meta-chip strong{color:var(--teal)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:11px 16px;border-radius:6px;font-size:.88rem;font-weight:600;font-family:inherit;cursor:pointer;transition:all .15s ease;text-decoration:none}
.btn-primary{background:var(--teal);color:#000;border:none}
.btn-primary:hover{opacity:.92;text-decoration:none}
.btn-secondary{background:transparent;color:var(--teal);border:1px solid var(--teal)}
.btn-secondary:hover{background:rgba(23,161,146,.1);text-decoration:none}

.section{padding:26px 0}
.section + .section{border-top:1px solid #171717}
.section-head{display:flex;align-items:end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.section-kicker{font-size:.75rem;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:var(--teal)}
.section-title{font-family:'Poppins',system-ui,sans-serif;font-size:1.35rem;font-weight:700;line-height:1.2;color:var(--white);text-wrap:balance}
.section-note{font-size:.9rem;color:var(--text-muted);max-width:760px}
.link-inline{font-size:.88rem;color:var(--orange);font-weight:600}

.important-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.important-card{background:var(--surface);border-left:4px solid var(--teal);border-radius:var(--radius);padding:18px 18px 16px;min-height:100%}
.important-card.beta{border-left-color:var(--teal)}
.important-card.dev{border-left-color:rgba(23,161,146,.6)}
.important-card.update{border-left-color:#444}
.important-card.sunset{border-left-color:var(--orange);background:rgba(247,147,26,.05)}
.important-type{display:inline-flex;align-items:center;gap:8px;font-size:.72rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-muted);margin-bottom:10px}
.important-title{font-family:'Poppins',system-ui,sans-serif;font-size:1rem;font-weight:600;line-height:1.35;color:var(--white);margin-bottom:10px}
.important-copy{font-size:.9rem;color:var(--text);margin-bottom:10px}
.important-meta{display:grid;gap:8px;margin-top:12px}
.important-row{font-size:.82rem;color:var(--text-muted)}
.important-row strong{color:var(--white);font-weight:600}
.important-source{margin-top:12px;font-size:.8rem;color:var(--text-muted)}
.important-source a{color:var(--teal)}

.filters-wrap{padding-top:8px}
.filter-group{margin-bottom:16px}
.filter-group:last-child{margin-bottom:0}
.filter-label{font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:var(--text-muted);margin-bottom:10px;font-weight:600}
.filter-row{display:flex;gap:10px;flex-wrap:wrap}
.filter-btn{background:var(--surface);border:1px solid #2a2a2a;color:var(--text-muted);padding:10px 18px;border-radius:8px;font-size:.84rem;font-weight:500;cursor:pointer;transition:all .15s ease;font-family:inherit;display:flex;align-items:center;gap:8px}
.filter-btn:hover{border-color:#444;color:var(--text);background:var(--surface2)}
.filter-btn.active{background:rgba(23,161,146,.12);border-color:var(--teal);color:var(--teal)}
.filter-count{font-size:.7rem;font-weight:600;opacity:.7;background:rgba(255,255,255,.06);padding:2px 7px;border-radius:10px}
.filter-btn.active .filter-count{opacity:1;background:rgba(23,161,146,.2)}

.grid{display:grid;gap:12px;padding:18px 0 50px}
.card{background:var(--surface);border-radius:var(--radius);padding:20px 22px;border-left:4px solid #333;transition:background .15s,border-color .15s}
.card:hover{background:var(--surface2)}
.card[data-status="public beta"]{border-left-color:var(--teal)}
.card[data-status="private beta"]{border-left-color:var(--teal);border-left-style:dashed}
.card[data-status="developer preview"]{border-left-color:var(--teal);opacity:.95}
.card[data-status="early access"]{border-left-color:var(--orange)}
.card[data-status="now live"]{border-left-color:var(--green)}
.card[data-status="live"]{border-left-color:var(--green)}
.card[data-status="sunset"]{border-left-color:var(--orange)}
.card[data-status="breaking change"]{border-left-color:var(--red)}
.card[data-status="update"]{border-left-color:#555}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px}
.card-title{font-family:'Poppins',system-ui,sans-serif;font-size:.98rem;font-weight:600;line-height:1.4;color:var(--white)}
.badge{font-size:.65rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding:4px 10px;border-radius:6px;white-space:nowrap;flex-shrink:0}
.badge[data-status="public beta"]{background:rgba(23,161,146,.15);color:var(--teal)}
.badge[data-status="private beta"]{background:rgba(23,161,146,.1);color:rgba(23,161,146,.75)}
.badge[data-status="developer preview"]{background:rgba(23,161,146,.1);color:rgba(23,161,146,.75)}
.badge[data-status="early access"]{background:rgba(247,147,26,.12);color:var(--orange)}
.badge[data-status="now live"]{background:rgba(74,222,128,.12);color:var(--green)}
.badge[data-status="live"]{background:rgba(74,222,128,.12);color:var(--green)}
.badge[data-status="sunset"]{background:rgba(247,147,26,.12);color:var(--orange)}
.badge[data-status="breaking change"]{background:rgba(239,68,68,.12);color:var(--red)}
.badge[data-status="update"]{background:rgba(255,255,255,.05);color:#999}
.hub-tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.hub-tag{font-size:.65rem;font-weight:600;padding:3px 10px;border-radius:4px;white-space:nowrap}
.card-desc{color:var(--text);font-size:.86rem;line-height:1.55;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:.76rem;color:var(--text-muted)}
.card-meta a{color:var(--teal)}

.cta-panel{background:var(--surface);border-left:4px solid var(--teal);border-radius:var(--radius);padding:22px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
.cta-copy h3{font-family:'Poppins',system-ui,sans-serif;font-size:1.1rem;line-height:1.2;color:var(--white);margin-bottom:6px}
.cta-copy p{color:var(--text-muted);max-width:760px}

.method-grid{display:grid;grid-template-columns:2fr 1fr;gap:20px}
.method-card{background:var(--surface);border-left:4px solid #333;border-radius:var(--radius);padding:18px}
.method-card h3{font-family:'Poppins',system-ui,sans-serif;font-size:1rem;color:var(--white);margin-bottom:8px}
.method-card p,.method-card li{font-size:.88rem;color:var(--text-muted)}
.method-card ul{padding-left:18px;display:grid;gap:6px}
.section[id="updates"]{scroll-margin-top:90px}
.topbar-subscribe{display:flex;align-items:center;gap:6px;margin-left:auto}
.topbar-subscribe input{background:var(--surface2);border:1px solid #333;color:var(--text);padding:9px 14px;border-radius:6px;font-size:.8rem;font-family:inherit;width:200px;outline:none}
.topbar-subscribe input:focus{border-color:var(--teal)}
.topbar-subscribe input::placeholder{color:var(--text-muted)}
.btn-subscribe{background:var(--surface2);color:var(--teal);border:1px solid var(--teal);padding:9px 14px;font-size:.8rem;font-weight:600;border-radius:6px;cursor:pointer;font-family:inherit;white-space:nowrap;transition:all .15s}
.btn-subscribe:hover{background:rgba(23,161,146,.12)}
.load-more-sentinel{height:1px}
.footer{border-top:1px solid #1d1d1d;padding:24px 0 40px;text-align:center;color:var(--text-muted);font-size:.82rem}
.loading{text-align:center;padding:60px 0;color:var(--text-muted)}
.empty{background:var(--surface);border-radius:var(--radius);padding:24px;text-align:center;color:var(--text-muted)}

@media(max-width:1180px){
  .important-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .method-grid{grid-template-columns:1fr}
}
@media(max-width:760px){
  .important-grid{grid-template-columns:1fr}
}
@media(max-width:980px){
  .topbar-inner{align-items:flex-start}
  .topbar-actions{width:100%;flex-wrap:wrap}
  .topbar-subscribe{margin-left:0}
}
@media(max-width:720px){
  .btn{width:100%}
  .topbar-subscribe{width:100%}
  .topbar-subscribe input{width:100%}
  .card{padding:18px}
  .cta-panel{padding:18px}
}
</style>
</head>
<body>

<header class="topbar">
  <div class="container topbar-inner">
    <div class="brand">
      <a href="https://crmbyrsm.com" target="_blank" rel="noopener"><img src="/static/favicon.png" alt="RSM Consulting" class="brand-logo"></a>
      <div class="brand-copy">
        <div class="brand-title">HubSpot Important Updates by RSM</div>
        <div class="brand-subtitle">Curated HubSpot betas, important updates, and change notes that affect your portal or your clients' portals.</div>
      </div>
    </div>
    <div class="topbar-actions">
      <span class="meta-chip" id="lastScan">Last scan: —</span>
      <span class="meta-chip" id="totalBadge"><strong>0</strong> tracked</span>
      <a class="btn btn-primary" href="https://crmbyrsm.com" target="_blank" rel="noopener">Need help?</a>
      <form class="topbar-subscribe" id="topbarSubscribeForm">
        <input type="email" placeholder="Weekly digest" id="topbarEmail" required>
        <button type="submit" class="btn-subscribe" id="topbarSubscribeBtn">Subscribe</button>
      </form>
    </div>
  </div>
</header>

<main class="container">
  <section class="section" id="importantSection">
    <div class="section-head">
      <div>
        <div class="section-kicker">Start here</div>
        <h2 class="section-title">Important right now</h2>
        <p class="section-note">Time-sensitive or high-impact changes that deserve attention before you get lost in the full feed.</p>
      </div>
      <a class="link-inline" href="#updates">Jump to full updates</a>
    </div>
    <div class="important-grid" id="importantGrid">
      <div class="loading">Loading important updates…</div>
    </div>
  </section>

  <section class="section" id="updates">
    <div class="section-head">
      <div>
        <div class="section-kicker">Tracked feed</div>
        <h2 class="section-title">All tracked updates</h2>
        <p class="section-note">Betas, live rollouts, sunsets, breaking changes, and notable platform updates. Filter by status or hub.</p>
      </div>
    </div>

    <div class="filters-wrap">
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
    <div class="load-more-sentinel" id="loadMoreSentinel"></div>
  </section>

  <section class="section">
    <div class="cta-panel">
      <div class="cta-copy">
        <h3>Need help implementing or updating? RSM is here.</h3>
        <p>If a rollout, beta, or sunset has implications for your portal, we can help you assess the impact and make the changes cleanly.</p>
      </div>
      <a class="btn btn-secondary" href="https://crmbyrsm.com" target="_blank" rel="noopener">Visit RSM Consulting</a>
    </div>
  </section>

  <section class="section">
    <div class="method-grid">
      <div class="method-card">
        <h3>What this tracks</h3>
        <p>We monitor multiple HubSpot surfaces and consolidate them into one feed: product updates, betas, live rollouts, sunsets, breaking changes, and developer-facing notes. Important items are surfaced separately so the top of the page stays useful.</p>
      </div>
      <div class="method-card">
        <h3>Sources</h3>
        <ul>
          <li>HubSpot Developer Changelog</li>
          <li>HubSpot Community updates</li>
          <li>Release tracking sources</li>
        </ul>
      </div>
    </div>
  </section>
</main>

<footer class="footer container">
  Built by <a href="https://crmbyrsm.com" target="_blank" rel="noopener">RSM Consulting</a> · Updated daily · Public HubSpot change monitoring with practical context.
</footer>

<script>
const STATUS_ORDER = ['public beta','private beta','developer preview','early access','now live','live','sunset','breaking change','update'];
const HUB_FILTER_ORDER = ['Marketing Hub','Sales Hub','Service Hub','CMS Hub','Operations Hub','Commerce Hub','Developer Platform','Breeze AI'];
const HUB_COLORS = {
  'Marketing Hub':'#ff7a59','Sales Hub':'#00bda5','Service Hub':'#f5c26b',
  'CMS Hub':'#7c98b6','Operations Hub':'#cbd6e2','Commerce Hub':'#f7931a',
  'Developer Platform':'#17a192','Breeze AI':'#a855f7','Platform':'#666'
};

let allBetas = [];
let activeStatuses = new Set();
let activeHubs = new Set();

function titleCase(s) { return s.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' '); }
function escapeHtml(s='') { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function getImportance(item) {
  const status = item.status || 'update';
  if (status.includes('beta') || status === 'developer preview' || status === 'early access') return 'beta';
  if (item.source === 'dev-changelog' || (item.hubs || []).includes('Developer Platform')) return 'dev';
  return 'update';
}

function isSunsetOrCritical(item) {
  return item.status === 'sunset' || item.status === 'breaking change';
}

function getTypeLabel(item) {
  const status = item.status || 'update';
  if (status === 'breaking change' || status === 'sunset') return 'Important';
  if (status.includes('beta') || status === 'developer preview' || status === 'early access') return 'Beta';
  if (item.source === 'dev-changelog' || (item.hubs || []).includes('Developer Platform')) return 'Dev';
  return 'Update';
}

function buildAction(item) {
  const status = item.status || 'update';
  const text = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
  if (status === 'sunset') return 'Check whether this affects any live processes, customizations, or client portals and plan replacement work now.';
  if (status === 'breaking change') return 'Review dependencies, custom code, and operational workflows before this turns into a support issue.';
  if (text.includes('sandbox')) return 'Validate this in a sandbox first, then decide whether it belongs in production workflows.';
  if (status.includes('beta') || status === 'developer preview' || status === 'early access') return 'Decide whether this is worth testing now or just monitoring until the rollout is more stable.';
  return 'Review the change, check whether it affects reporting, automation, or admin workflows, and log follow-up if needed.';
}

function buildWho(item) {
  const hubs = item.hubs || ['Platform'];
  if (hubs.includes('Developer Platform')) return 'Admins, developers, and teams managing custom integrations.';
  if (hubs.includes('Operations Hub')) return 'Ops teams, admins, and anyone maintaining automation or data quality.';
  if (hubs.includes('Sales Hub')) return 'Sales ops teams, revenue leaders, and portal admins.';
  if (hubs.includes('Marketing Hub')) return 'Marketing ops teams, campaign owners, and portal admins.';
  if (hubs.includes('Service Hub')) return 'Service teams, support leaders, and admins.';
  if (hubs.includes('CMS Hub')) return 'CMS managers, web teams, and admins.';
  return 'Portal admins and teams responsible for HubSpot setup, reporting, and process design.';
}

function getDaysOld(item) {
  return Math.max(0, Math.floor((Date.now() - new Date(item.firstSeen).getTime()) / 86400000));
}

function scoreUrgency(item) {
  const status = item.status || 'update';
  const text = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
  const daysOld = getDaysOld(item);
  let score = 0;

  // hard recency decay — important right now should move
  if (daysOld <= 3) score += 40;
  else if (daysOld <= 7) score += 26;
  else if (daysOld <= 14) score += 14;
  else if (daysOld <= 21) score += 6;
  else score -= Math.min(18, Math.floor((daysOld - 21) / 3));

  if (status === 'breaking change') score += 45;
  if (status === 'sunset') score += 42;
  if (status === 'public beta') score += 20;
  if (status === 'private beta' || status === 'developer preview' || status === 'early access') score += 14;
  if (status === 'now live' || status === 'live') score += 10;

  if (/deadline|by \w+ \d{1,2}|before \w+ \d{1,2}|starting \w+ \d{1,2}|ending \w+ \d{1,2}/.test(text)) score += 18;
  if (/required|must|action required|migrate|migration|turn off|remove|replace|discontinue|deprecated|sunset timeline/.test(text)) score += 16;
  if (/sandbox|oauth|api|workflow|crm|reporting|association|property/.test(text)) score += 8;
  if (/beta|rollout|rolling out|gradual rollout|available now|now live/.test(text)) score += 6;

  if ((item.hubs || []).includes('Developer Platform')) score += 4;
  if ((item.hubs || []).includes('Operations Hub')) score += 4;

  return score;
}

function scoreRisk(item) {
  const text = ((item.title || '') + ' ' + (item.description || '')).toLowerCase();
  let score = scoreUrgency(item);
  if (isSunsetOrCritical(item)) score += 30;
  if (/migrate|migration|required|must|deprecated|remove|sunset|breaking/.test(text)) score += 18;
  return score;
}

function selectSunsetItems(items) {
  return [...items]
    .filter(i => scoreRisk(i) >= 35)
    .sort((a, b) => scoreRisk(b) - scoreRisk(a) || new Date(b.firstSeen) - new Date(a.firstSeen))
    .slice(0, 1);
}

function selectImportantItems(items) {
  return [...items]
    .filter(i => !isSunsetOrCritical(i))
    .sort((a, b) => scoreUrgency(b) - scoreUrgency(a) || new Date(b.firstSeen) - new Date(a.firstSeen))
    .slice(0, 3);
}

const PAGE_SIZE = 30;
let filteredItems = [];
let loadedCount = 0;
let observer = null;

async function init() {
  try {
    const res = await fetch('/api/betas');
    const data = await res.json();
    allBetas = Object.values(data.betas || {}).sort((a, b) => new Date(b.firstSeen) - new Date(a.firstSeen));
    renderMeta(data);
    renderImportant();
    renderStatusFilters();
    renderHubFilters();
    renderGrid();
    initSubscribeForm();
  } catch (e) {
    document.getElementById('importantGrid').innerHTML = '<div class="empty">Failed to load important updates.</div>';
    document.getElementById('grid').innerHTML = '<div class="empty">Failed to load data.</div>';
  }
}

function initSubscribeForm() {
  const form = document.getElementById('topbarSubscribeForm');
  const btn = document.getElementById('topbarSubscribeBtn');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('topbarEmail').value.trim();
    if (!email) return;
    btn.textContent = '...';
    btn.disabled = true;
    try {
      const r = await fetch('/api/subscribe', {
        method: 'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ email })
      });
      const d = await r.json();
      btn.textContent = d.ok ? 'Done!' : 'Error';
      if (d.ok) document.getElementById('topbarEmail').value = '';
    } catch { btn.textContent = 'Error'; }
    setTimeout(() => { btn.textContent = 'Subscribe'; btn.disabled = false; }, 3000);
  });
}

function renderMeta(data) {
  const total = Object.keys(data.betas || {}).length;
  const lastScan = data.lastScan
    ? new Date(data.lastScan).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
    : 'Never';
  document.getElementById('lastScan').textContent = 'Last scan: ' + lastScan;
  document.getElementById('totalBadge').innerHTML = '<strong>' + total + '</strong> tracked';
}

function renderImportant() {
  const items = selectImportantItems(allBetas);
  const sunset = selectSunsetItems(allBetas);
  if (!items.length && !sunset.length) {
    document.getElementById('importantGrid').innerHTML = '<div class="empty">No important items are available yet.</div>';
    return;
  }
  const sourceMap = { 'dev-changelog':'Dev Changelog', 'community':'Community', 'releasebot':'Releasebot', 'releasebot-product':'Releasebot', 'releasebot-dev':'Releasebot (Dev)', 'product-updates':'Product Updates' };
  const normalCards = items.map(item => {
    const typeLabel = getTypeLabel(item);
    const importance = getImportance(item);
    const sourceLabel = sourceMap[item.source] || item.source;
    return '<article class="important-card ' + importance + '">' +
      '<div class="important-type">' + escapeHtml(typeLabel) + ' · ' + escapeHtml(titleCase(item.status || 'update')) + '</div>' +
      '<h3 class="important-title">' + escapeHtml(item.title || 'Untitled update') + '</h3>' +
      '<p class="important-copy">' + escapeHtml((item.description || '').slice(0, 180) || 'Tracked update with platform impact.') + '</p>' +
      '<div class="important-meta">' +
        '<div class="important-row"><strong>Why it matters:</strong> ' + escapeHtml(scoreUrgency(item) >= 45 ? 'This is new enough and impactful enough to deserve attention right now.' : 'This is one of the most relevant recent updates across the tracker.') + '</div>' +
        '<div class="important-row"><strong>Who it affects:</strong> ' + escapeHtml(buildWho(item)) + '</div>' +
        '<div class="important-row"><strong>Action:</strong> ' + escapeHtml(buildAction(item)) + '</div>' +
      '</div>' +
      '<div class="important-source">' + escapeHtml(sourceLabel) + (item.sourceUrl ? ' · <a href="' + item.sourceUrl + '" target="_blank" rel="noopener">Source</a>' : '') + '</div>' +
    '</article>';
  }).join('');
  const sunsetCard = sunset.length ? sunset.map(item => {
    const sourceLabel = sourceMap[item.source] || item.source;
    const label = item.status === 'breaking change' ? 'Breaking Change' : 'Sunsetting';
    return '<article class="important-card sunset">' +
      '<div class="important-type" style="color:var(--orange)">' + escapeHtml(label) + '</div>' +
      '<h3 class="important-title">' + escapeHtml(item.title || 'Untitled update') + '</h3>' +
      '<p class="important-copy">' + escapeHtml((item.description || '').slice(0, 180) || 'Tracked time-sensitive change.') + '</p>' +
      '<div class="important-meta">' +
        '<div class="important-row"><strong>Why it matters:</strong> ' + escapeHtml('This is the highest-risk time-sensitive item in the current feed and may require action soon.') + '</div>' +
        '<div class="important-row"><strong>Who it affects:</strong> ' + escapeHtml(buildWho(item)) + '</div>' +
        '<div class="important-row"><strong>Action:</strong> ' + escapeHtml(buildAction(item)) + '</div>' +
      '</div>' +
      '<div class="important-source">' + escapeHtml(sourceLabel) + (item.sourceUrl ? ' · <a href="' + item.sourceUrl + '" target="_blank" rel="noopener">Source</a>' : '') + '</div>' +
    '</article>';
  }).join('') : '<article class="important-card sunset"><div class="important-type" style="color:var(--orange)">Sunsetting / time-sensitive</div><h3 class="important-title">No active sunset item pinned yet</h3><p class="important-copy">This slot is reserved for the time-sensitive change we want people to notice first when one is active.</p><div class="important-meta"><div class="important-row"><strong>Use:</strong> deprecations, forced migrations, sunsets, or urgent rollout changes.</div></div></article>';
  document.getElementById('importantGrid').innerHTML = normalCards + sunsetCard;
}

function renderStatusFilters() {
  const counts = {};
  allBetas.forEach(b => { counts[b.status] = (counts[b.status] || 0) + 1; });
  let html = '';
  STATUS_ORDER.forEach(s => {
    if (counts[s]) {
      html += '<button class="filter-btn" data-status="' + s + '">' + titleCase(s) + '<span class="filter-count">' + counts[s] + '</span></button>';
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
      html += '<button class="filter-btn" data-hub="' + h + '">' + h.replace(' Hub','') + '<span class="filter-count">' + hubCounts[h] + '</span></button>';
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

function renderCard(b) {
  const now = Date.now();
  const days = Math.max(0, Math.floor((now - new Date(b.firstSeen).getTime()) / 86400000));
  const firstSeen = new Date(b.firstSeen).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
  // Use real description if available, otherwise smart fallback
  let desc = (b.description && b.description.trim().length > 30)
    ? escapeHtml(b.description)
    : generateFallbackDesc(b);
  
  function generateFallbackDesc(item) {
    // Only use fallback if we truly have no description
    // Fallback descriptions based on status
    const statusHints = {
      'live': 'Now available in HubSpot. ' + escapeHtml((item.hubs || ['Platform'])[0]) + ' feature update.',
      'public beta': 'Public beta available for testing. Please share feedback with HubSpot.',
      'private beta': 'Limited private beta. Request access if you need this feature.',
      'sunset': 'This feature is being retired. Plan your migration accordingly.',
      'breaking change': 'Breaking change coming. Review your integrations and workflows.',
      'deprioritized': 'This feature has been deprioritized and may not be developed.',
      'update': 'Important update to existing functionality. Review the details.',
      'in development': 'Coming soon. This feature is currently in development.'
    };
    return statusHints[item.status] || 'Tracked HubSpot update. View the source link for complete details.';
  }
  const sourceLabel = { 'dev-changelog':'Dev Changelog', 'community':'Community', 'releasebot':'Releasebot', 'releasebot-product':'Releasebot', 'releasebot-dev':'Releasebot (Dev)', 'product-updates':'Product Updates' }[b.source] || b.source;
  const hubs = b.hubs || ['Platform'];
  const hubTags = hubs.map(h => {
    const color = HUB_COLORS[h] || '#666';
    const textColor = (h === 'Operations Hub' || h === 'Service Hub') ? '#111' : '#fff';
    return '<span class="hub-tag" style="background:' + color + ';color:' + textColor + '">' + escapeHtml(h) + '</span>';
  }).join('');
  return '<div class="card" data-status="' + b.status + '">' +
    '<div class="card-top">' +
      '<span class="card-title">' + escapeHtml(b.title) + '</span>' +
      '<span class="badge" data-status="' + b.status + '">' + escapeHtml(b.status) + '</span>' +
    '</div>' +
    '<div class="hub-tags">' + hubTags + '</div>' +
    '<p class="card-desc">' + desc + '</p>' +
    '<div class="card-meta">' +
      '<span>' + firstSeen + '</span>' +
      '<span>' + days + 'd tracked</span>' +
      '<span>' + escapeHtml(sourceLabel) + '</span>' +
      (b.sourceUrl ? '<a href="' + b.sourceUrl + '" target="_blank" rel="noopener">Source ↗</a>' : '') +
    '</div></div>';
}

function appendCards() {
  const slice = filteredItems.slice(loadedCount, loadedCount + PAGE_SIZE);
  if (!slice.length) {
    if (observer) { observer.disconnect(); observer = null; }
    return;
  }
  const gridEl = document.getElementById('grid');
  gridEl.insertAdjacentHTML('beforeend', slice.map(renderCard).join(''));
  loadedCount += slice.length;
  if (loadedCount < filteredItems.length) {
    const sentinel = document.getElementById('loadMoreSentinel');
    if (observer) observer.disconnect();
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) appendCards();
    }, { rootMargin: '200px' });
    observer.observe(sentinel);
  } else {
    if (observer) { observer.disconnect(); observer = null; }
  }
}

function renderGrid() {
  if (observer) { observer.disconnect(); observer = null; }
  let filtered = allBetas;
  if (activeStatuses.size > 0) filtered = filtered.filter(b => activeStatuses.has(b.status));
  if (activeHubs.size > 0) filtered = filtered.filter(b => (b.hubs || ['Platform']).some(h => activeHubs.has(h)));
  filteredItems = filtered;
  loadedCount = 0;
  const gridEl = document.getElementById('grid');
  gridEl.innerHTML = '';
  if (!filteredItems.length) {
    gridEl.innerHTML = '<div class="empty">No items match these filters.</div>';
    return;
  }
  appendCards();
}

init();
</script>
</body>
</html>`
