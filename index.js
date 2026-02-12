#!/usr/bin/env node
/**
 * HubSpot Beta Tracker
 * 
 * Scrapes multiple HubSpot sources for beta features, tracks their status
 * over time, and generates diff reports showing what's new/changed.
 * 
 * Sources:
 *   1. Developer Changelog RSS (developers.hubspot.com/changelog/rss.xml)
 *   2. HubSpot Community "Releases and Updates" board
 *   3. HubSpot Product Updates page (hubspot.com/product-updates)
 * 
 * Usage:
 *   node index.js              # Full scan + report
 *   node index.js --report-only # Just show current state + recent changes
 *   node index.js --json        # Output report as JSON (for cron consumption)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseHTML } from 'node-html-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'state.json');
const HISTORY_DIR = path.join(__dirname, 'history');

// ─── Sources ────────────────────────────────────────────────────────────────

const SOURCES = {
  devChangelog: {
    name: 'Developer Changelog',
    url: 'https://developers.hubspot.com/changelog/rss.xml',
    type: 'rss',
  },
  communityUpdates: {
    name: 'Community Releases & Updates',
    url: 'https://community.hubspot.com/t5/Releases-and-Updates/bg-p/releases-updates',
    type: 'html',
  },
  productUpdates: {
    name: 'Product Updates Blog',
    url: 'https://www.hubspot.com/product-updates',
    type: 'html',
  },
};

const STATUS_KEYWORDS = {
  'public beta': ['public beta'],
  'private beta': ['private beta'],
  'developer preview': ['developer preview'],
  'early access': ['early access'],
  'now live': ['now live', 'general availability', 'ga release', 'now available', 'is live', 'goes live', 'gone live', 'launched'],
  'live': ['live', 'available now', 'rolling out', 'released'],
  'sunset': ['sunset', 'deprecat', 'end of life', 'eol'],
  'breaking change': ['breaking change'],
  'update': ['update', 'improvement', 'enhanced', 'new feature', 'added', 'improved', 'redesigned', 'upgraded'],
};

// Hub/Integration detection keywords
const HUB_KEYWORDS = {
  'Marketing Hub': ['marketing', 'email', 'forms', 'landing pages', 'campaigns', 'seo', 'social', 'ads', 'blog', 'ctas', 'lead scoring', 'lists', 'nurture', 'a/b test'],
  'Sales Hub': ['deals', 'pipeline', 'sequences', 'quotes', 'forecasting', 'playbooks', 'sales', 'prospecting', 'meetings', 'calling', 'tasks'],
  'Service Hub': ['tickets', 'conversations', 'knowledge base', 'customer portal', 'feedback', 'service', 'help desk', 'sla'],
  'CMS Hub': ['cms', 'pages', 'themes', 'templates', 'drag-and-drop', 'hubdb', 'modules', 'website', 'blog'],
  'Operations Hub': ['workflows', 'data sync', 'data quality', 'datasets', 'custom code', 'operations', 'programmable automation'],
  'Commerce Hub': ['payments', 'quotes', 'invoices', 'subscriptions', 'commerce', 'orders', 'carts', 'checkout'],
  'Developer Platform': ['api', 'sdk', 'cli', 'oauth', 'apps', 'extensions', 'sandbox', 'marketplace', 'developer', 'webhook', 'serverless', 'hubl'],
  'Breeze AI': ['breeze', 'ai', 'copilot', 'assistant', 'agent', 'intelligence'],
};

// ─── Helpers ────────────────────────────────────────────────────────────────

async function fetchURL(url, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'HubSpot-Beta-Tracker/1.0 (CRM Consultant Tool)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
      return await res.text();
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`  ✗ Failed to fetch ${url}: ${err.message}`);
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

function detectStatus(text) {
  const lower = text.toLowerCase();
  // Check specific statuses first (order matters — more specific before general)
  const priorityOrder = ['public beta', 'private beta', 'developer preview', 'early access', 'now live', 'sunset', 'breaking change', 'live', 'update'];
  for (const status of priorityOrder) {
    const keywords = STATUS_KEYWORDS[status];
    if (keywords && keywords.some(kw => lower.includes(kw))) return status;
  }
  return 'update';
}

function detectHubs(text) {
  const lower = text.toLowerCase();
  const hubs = [];
  for (const [hub, keywords] of Object.entries(HUB_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw))) {
      hubs.push(hub);
    }
  }
  return hubs.length > 0 ? hubs : ['Platform'];
}

function slugify(title) {
  return title.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 80);
}

// Filter out noise — titles that are clearly section headers, not features
const NOISE_PATTERNS = [
  /^questions or comments/i,
  /^what'?s changing/i,
  /^when is it happening/i,
  /^for \w+/i,  // "For Agencies and Marketing Services", "For Ecommerce..."
  /^for any industry/i,
  /^ready to transform/i,
  /^app theme #?\d/i,
  /^key considerations/i,
  /^starting \w+ \d/i,
  /^all hubspot release notes/i,
  /^over the last month/i,
  /^this month'?s updates focus/i,
  /^node\.?js requirements$/i,
  /^deprecated commands removed$/i,
  /^additional breaking changes$/i,
  /^bug fixes and improvements$/i,
  /^ci\/cd considerations$/i,
  /^sunset notice for/i,
  /^what'?s new/i,
  /^what'?s changing/i,
  /^\d+\.\s/,  // numbered listicle items
  /^the \w+ \d{4} industry edit/i, // "The January 2026 Industry Edit"
];

function isNoise(title) {
  return NOISE_PATTERNS.some(pat => pat.test(title.trim()));
}

// Check if title is a real feature/update name (not a section header)
function isValidTitle(title) {
  if (!title || title.length < 15 || title.length > 200) return false;
  if (isNoise(title)) return false;
  // Must contain at least one uppercase letter (proper name/feature)
  if (!/[A-Z]/.test(title)) return false;
  return true;
}

function stripHTML(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  }
  return { betas: {}, lastScan: null, scanCount: 0 };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function saveHistory(report) {
  fs.mkdirSync(HISTORY_DIR, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const file = path.join(HISTORY_DIR, `${date}.json`);
  
  let existing = [];
  if (fs.existsSync(file)) {
    existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  existing.push({ ...report, timestamp: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify(existing, null, 2));
}

// ─── Source Parsers ─────────────────────────────────────────────────────────

async function parseDevChangelog() {
  console.log('📡 Fetching Developer Changelog RSS...');
  const xml = await fetchURL(SOURCES.devChangelog.url);
  if (!xml) return [];

  const parser = new XMLParser({ ignoreAttributes: false });
  const feed = parser.parse(xml);
  
  const items = feed?.rss?.channel?.item || [];
  const arr = Array.isArray(items) ? items : [items];
  
  const results = [];
  for (const item of arr) {
    const title = item.title || '';
    const desc = stripHTML(item.description || item['content:encoded'] || '');
    const combined = `${title} ${desc}`;
    
    if (!isValidTitle(title)) continue;
    
    results.push({
      id: slugify(title),
      title: title.trim(),
      description: desc.substring(0, 500),
      status: detectStatus(combined),
      hubs: detectHubs(combined),
      source: 'dev-changelog',
      sourceUrl: item.link || SOURCES.devChangelog.url,
      pubDate: item.pubDate || null,
      author: item.author || null,
    });
  }
  
  console.log(`  ✓ Found ${results.length} items`);
  return results;
}

async function parseCommunityUpdates() {
  console.log('📡 Fetching Community Releases & Updates...');
  const html = await fetchURL(SOURCES.communityUpdates.url);
  if (!html) return [];

  const root = parseHTML(html);
  const results = [];
  
  // Parse thread listings from the community board
  const threads = root.querySelectorAll('.lia-message-subject, .message-subject, a[href*="/Releases-and-Updates/"]');
  
  for (const el of threads) {
    const link = el.tagName === 'A' ? el : el.querySelector('a');
    if (!link) continue;
    
    const title = link.text?.trim() || '';
    const href = link.getAttribute('href') || '';
    
    if (!isValidTitle(title)) continue;
    
    const fullUrl = href.startsWith('http') ? href : `https://community.hubspot.com${href}`;
    
    results.push({
      id: slugify(title),
      title,
      description: '',
      status: detectStatus(title),
      hubs: detectHubs(title),
      source: 'community',
      sourceUrl: fullUrl,
      pubDate: null,
    });
  }
  
  console.log(`  ✓ Found ${results.length} items`);
  return results;
}

async function parseProductUpdates() {
  console.log('📡 Fetching Product Updates page...');
  const html = await fetchURL(SOURCES.productUpdates.url);
  if (!html) return [];

  const root = parseHTML(html);
  const results = [];
  
  // The product updates page has cards/articles with titles and descriptions
  const cards = root.querySelectorAll('article, .update-card, [class*="update"], [class*="card"]');
  
  // Also try extracting from general content
  const headings = root.querySelectorAll('h2, h3, h4');
  
  for (const h of headings) {
    const title = h.text?.trim() || '';
    if (!isValidTitle(title)) continue;
    
    const link = h.querySelector('a');
    const href = link?.getAttribute('href') || '';
    const fullUrl = href.startsWith('http') ? href : (href ? `https://www.hubspot.com${href}` : SOURCES.productUpdates.url);
    
    // Try to get sibling description
    let desc = '';
    const next = h.nextElementSibling;
    if (next && (next.tagName === 'P' || next.tagName === 'DIV')) {
      desc = stripHTML(next.text || '').substring(0, 500);
    }
    
    const combined = `${title} ${desc}`;
    results.push({
      id: slugify(title),
      title,
      description: desc,
      status: detectStatus(combined),
      hubs: detectHubs(combined),
      source: 'product-updates',
      sourceUrl: fullUrl,
      pubDate: null,
    });
  }
  
  console.log(`  ✓ Found ${results.length} items`);
  return results;
}

// Releasebot.io aggregator — scrapes individual product updates from their pages.
// Structure: <ul.border-y> contains <li> posts, each with an H2 title and an
// expandable div. Rollup posts have numbered H4 features inside; standalone posts
// are a single feature at the H2 level.
async function parseReleasebot() {
  console.log('📡 Fetching Releasebot product & developer updates...');
  
  const pages = [
    { url: 'https://releasebot.io/updates/hubspot', sourceLabel: 'releasebot-product' },
    { url: 'https://releasebot.io/updates/hubspot/hubspot-developers', sourceLabel: 'releasebot-dev' },
  ];
  
  const results = [];
  
  for (const page of pages) {
    const html = await fetchURL(page.url);
    if (!html) continue;
    
    const root = parseHTML(html);
    const mainUl = root.querySelector('ul.border-y');
    if (!mainUl) { console.log(`  ✗ No main UL found on ${page.url}`); continue; }
    
    const postItems = mainUl.querySelectorAll(':scope > li');
    let pageCount = 0;
    
    for (const li of postItems) {
      const h2 = li.querySelector('h2');
      const postTitle = h2?.text?.trim() || '';
      if (!postTitle || postTitle.length < 10) continue;
      
      // Skip noise posts
      if (isNoise(postTitle)) continue;
      
      // Get the summary paragraph (skip metadata lines)
      const ps = li.querySelectorAll('p');
      let postSummary = '';
      for (const p of ps) {
        const t = p.text?.trim();
        if (t && t.length > 50 && !t.includes('Date parsed') && !t.includes('First seen') && !t.includes('by\n')) {
          postSummary = t;
          break;
        }
      }
      
      // Check expandable content for numbered H4 features
      const expandable = li.querySelector('div.relative');
      let extractedFeatures = false;
      
      if (expandable) {
        const h4s = expandable.querySelectorAll('h4');
        const numberedH4s = [...h4s].filter(h => /^\d+\.\s/.test(h.text?.trim() || ''));
        
        if (numberedH4s.length > 0) {
          // This is a rollup post — extract each numbered feature
          for (const h4 of numberedH4s) {
            const rawTitle = h4.text?.trim() || '';
            const cleanTitle = rawTitle.replace(/^\d+\.\s*/, '').trim();
            if (!cleanTitle || cleanTitle.length < 10) continue;
            
            // Collect description paragraphs until next H4 or end
            let desc = '';
            let sibling = h4.nextElementSibling;
            while (sibling && sibling.tagName !== 'H4' && sibling.tagName !== 'H3' && sibling.tagName !== 'H2') {
              if (sibling.tagName === 'P') {
                const t = sibling.text?.trim();
                if (t) desc += (desc ? ' ' : '') + t;
              }
              sibling = sibling.nextElementSibling;
            }
            
            const combined = `${cleanTitle} ${desc}`;
            results.push({
              id: slugify(cleanTitle),
              title: cleanTitle,
              description: desc.substring(0, 500),
              status: detectStatus(combined),
              hubs: detectHubs(combined),
              source: page.sourceLabel,
              sourceUrl: page.url,
              pubDate: null,
            });
            pageCount++;
          }
          extractedFeatures = true;
        }
      }
      
      // If no numbered features found, treat the post itself as a single entry
      if (!extractedFeatures && isValidTitle(postTitle)) {
        const combined = `${postTitle} ${postSummary}`;
        results.push({
          id: slugify(postTitle),
          title: postTitle,
          description: postSummary.substring(0, 500),
          status: detectStatus(combined),
          hubs: detectHubs(combined),
          source: page.sourceLabel,
          sourceUrl: page.url,
          pubDate: null,
        });
        pageCount++;
      }
    }
    
    console.log(`  ✓ ${page.sourceLabel}: ${pageCount} items`);
  }
  
  console.log(`  ✓ Found ${results.length} items total from Releasebot`);
  return results;
}

// ─── State Management & Diffing ─────────────────────────────────────────────

function mergeResults(state, newItems) {
  const changes = {
    new: [],
    statusChanged: [],
    updated: [],
  };
  
  const now = new Date().toISOString();
  
  for (const item of newItems) {
    const existing = state.betas[item.id];
    
    if (!existing) {
      // Brand new item
      state.betas[item.id] = {
        ...item,
        hubs: item.hubs || ['Platform'],
        firstSeen: now,
        lastSeen: now,
        statusHistory: [{ status: item.status, date: now, source: item.source }],
      };
      changes.new.push(item);
    } else {
      // Update last seen
      existing.lastSeen = now;
      
      // Ensure hubs field exists on legacy items
      if (!existing.hubs) {
        existing.hubs = item.hubs || ['Platform'];
      } else if (item.hubs) {
        // Merge any new hubs detected
        for (const hub of item.hubs) {
          if (!existing.hubs.includes(hub)) {
            existing.hubs.push(hub);
          }
        }
        // Remove "Platform" if real hubs were detected
        if (existing.hubs.length > 1 && existing.hubs.includes('Platform')) {
          existing.hubs = existing.hubs.filter(h => h !== 'Platform');
        }
      }
      
      // Check for status change
      if (existing.status !== item.status && item.status !== 'update') {
        const oldStatus = existing.status;
        existing.status = item.status;
        existing.statusHistory.push({ 
          status: item.status, 
          date: now, 
          source: item.source,
          previousStatus: oldStatus,
        });
        changes.statusChanged.push({
          ...item,
          previousStatus: oldStatus,
        });
      }
      
      // Update description if we got a better one
      if (item.description && item.description.length > (existing.description?.length || 0)) {
        existing.description = item.description;
        changes.updated.push(item);
      }
      
      // Track additional sources
      if (!existing.sources) existing.sources = [existing.source];
      if (!existing.sources.includes(item.source)) {
        existing.sources.push(item.source);
      }
    }
  }
  
  return changes;
}

// ─── Report Generation ──────────────────────────────────────────────────────

function generateReport(state, changes) {
  const now = new Date();
  const lines = [];
  
  lines.push(`# 🔬 HubSpot Beta Tracker Report`);
  lines.push(`**Generated:** ${now.toISOString().replace('T', ' ').substring(0, 19)} UTC`);
  lines.push(`**Total tracked:** ${Object.keys(state.betas).length} items`);
  lines.push(`**Scans completed:** ${state.scanCount}`);
  lines.push('');
  
  // Changes since last scan
  if (changes) {
    if (changes.new.length > 0) {
      lines.push(`## 🆕 New Betas Found (${changes.new.length})`);
      for (const item of changes.new) {
        lines.push(`- **${item.title}** — \`${item.status}\``);
        if (item.description) lines.push(`  ${item.description.substring(0, 200)}`);
        lines.push(`  🔗 ${item.sourceUrl}`);
      }
      lines.push('');
    }
    
    if (changes.statusChanged.length > 0) {
      lines.push(`## 🔄 Status Changes (${changes.statusChanged.length})`);
      for (const item of changes.statusChanged) {
        lines.push(`- **${item.title}**: \`${item.previousStatus}\` → \`${item.status}\``);
        lines.push(`  🔗 ${item.sourceUrl}`);
      }
      lines.push('');
    }
    
    if (changes.new.length === 0 && changes.statusChanged.length === 0) {
      lines.push(`## ✅ No Changes Since Last Scan`);
      lines.push('');
    }
  }
  
  // Current state by status
  const byStatus = {};
  for (const [id, beta] of Object.entries(state.betas)) {
    if (!byStatus[beta.status]) byStatus[beta.status] = [];
    byStatus[beta.status].push(beta);
  }
  
  const statusOrder = ['public beta', 'private beta', 'developer preview', 'early access', 'now live', 'live', 'sunset', 'breaking change', 'update'];
  const statusEmoji = {
    'public beta': '🟢',
    'private beta': '🔒',
    'developer preview': '🔧',
    'early access': '⚡',
    'now live': '✅',
    'live': '🔵',
    'sunset': '🌅',
    'breaking change': '⚠️',
    'update': '📝',
  };
  
  lines.push(`## 📊 All Tracked Betas by Status`);
  
  for (const status of statusOrder) {
    const items = byStatus[status];
    if (!items || items.length === 0) continue;
    
    // Sort by most recently seen
    items.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
    
    lines.push(`\n### ${statusEmoji[status] || '📋'} ${status.toUpperCase()} (${items.length})`);
    for (const item of items) {
      const age = Math.floor((now - new Date(item.firstSeen)) / 86400000);
      lines.push(`- **${item.title}** (tracked ${age}d)`);
      if (item.description) lines.push(`  ${item.description.substring(0, 150)}`);
      lines.push(`  🔗 ${item.sourceUrl}`);
    }
  }
  
  return lines.join('\n');
}

function generateJSON(state, changes) {
  return {
    generated: new Date().toISOString(),
    totalTracked: Object.keys(state.betas).length,
    scanCount: state.scanCount,
    changes: changes || { new: [], statusChanged: [], updated: [] },
    summary: {
      newCount: changes?.new?.length || 0,
      statusChangedCount: changes?.statusChanged?.length || 0,
      byStatus: Object.entries(
        Object.values(state.betas).reduce((acc, b) => {
          acc[b.status] = (acc[b.status] || 0) + 1;
          return acc;
        }, {})
      ).sort(([, a], [, b]) => b - a),
    },
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const reportOnly = args.includes('--report-only');
  const jsonOutput = args.includes('--json');
  
  const state = loadState();
  
  if (reportOnly) {
    const report = jsonOutput 
      ? JSON.stringify(generateJSON(state, null), null, 2)
      : generateReport(state, null);
    console.log(report);
    return;
  }
  
  console.log('🔬 HubSpot Beta Tracker — Starting scan...\n');
  
  // Fetch all sources in parallel
  const [devItems, communityItems, productItems, releasebotItems] = await Promise.all([
    parseDevChangelog(),
    parseCommunityUpdates(),
    parseProductUpdates(),
    parseReleasebot(),
  ]);
  
  const allItems = [...devItems, ...communityItems, ...productItems, ...releasebotItems];
  
  // Deduplicate by ID (prefer items with more info)
  const deduped = new Map();
  for (const item of allItems) {
    const existing = deduped.get(item.id);
    if (!existing || item.description.length > (existing.description?.length || 0)) {
      deduped.set(item.id, item);
    }
  }
  
  console.log(`\n📊 Total unique items found: ${deduped.size}`);
  
  // Merge with existing state
  const changes = mergeResults(state, [...deduped.values()]);
  
  state.lastScan = new Date().toISOString();
  state.scanCount = (state.scanCount || 0) + 1;
  
  saveState(state);
  saveHistory({ changes, itemsFound: deduped.size });
  
  // Output report
  if (jsonOutput) {
    console.log(JSON.stringify(generateJSON(state, changes), null, 2));
  } else {
    console.log('\n' + '='.repeat(60) + '\n');
    console.log(generateReport(state, changes));
  }
  
  // Summary for quick consumption
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Scan complete. ${changes.new.length} new, ${changes.statusChanged.length} changed, ${Object.keys(state.betas).length} total tracked.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
