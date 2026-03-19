#!/usr/bin/env node

/**
 * Enrich Tracker Descriptions
 * 
 * Two-phase approach:
 * 1. Apply manual descriptions from descriptions-manual.json (curated, high-quality)
 * 2. Fetch remaining descriptions from source pages (Playwright-based)
 */

import fs from 'fs';
import { chromium } from 'playwright';

// Load data
const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const manualDescs = JSON.parse(fs.readFileSync('descriptions-manual.json', 'utf8'));

console.log('📝 Starting description enrichment...');

// Phase 1: Apply manual descriptions
let manualApplied = 0;
for (const [id, item] of Object.entries(state.betas)) {
  if (item.description && item.description.length > 30) continue; // Skip items with good descriptions
  
  // Try to match by title slug
  const titleSlug = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  
  if (manualDescs[titleSlug]) {
    state.betas[id].description = manualDescs[titleSlug];
    manualApplied++;
    console.log(`✓ [manual] ${item.title.substring(0, 50)}`);
  }
}

console.log(`\n✅ Applied ${manualApplied} manual descriptions`);

// Phase 2: Fetch remaining descriptions from source URLs
async function fetchRemaining() {
  const needsFetch = Object.entries(state.betas)
    .filter(([id, item]) => !item.description || item.description.length < 30)
    .slice(0, 30); // Limit to 30 per run to avoid timeouts
  
  if (needsFetch.length === 0) {
    console.log('✅ All items have descriptions!');
    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    process.exit(0);
  }
  
  console.log(`\n📡 Fetching ${needsFetch.length} descriptions from source pages...`);
  
  let browser;
  let fetched = 0;
  
  try {
    browser = await chromium.launch({ headless: true });
    
    for (const [id, item] of needsFetch) {
      try {
        if (!item.sourceUrl) continue;
        
        const desc = await fetchPageDesc(browser, item.sourceUrl);
        if (desc && desc.length > 40) {
          state.betas[id].description = desc;
          fetched++;
          console.log(`✓ [fetch] ${item.title.substring(0, 45)} — ${desc.substring(0, 50).replace(/\n/g, ' ')}`);
        }
      } catch (e) {
        // Silently skip on error
      }
      
      // Throttle requests
      await new Promise(r => setTimeout(r, 300));
    }
    
    await browser.close();
  } catch (e) {
    console.error('Browser error:', e.message);
    if (browser) await browser.close();
  }
  
  console.log(`\n✅ Fetched ${fetched} descriptions from source pages`);
  
  // Save updated state
  fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
  console.log(`✅ Total enriched: ${manualApplied + fetched} descriptions`);
}

async function fetchPageDesc(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 12000 });
    
    // Extract first substantive paragraph
    const desc = await page.evaluate(() => {
      const selectors = [
        'article',
        'main',
        '[role="main"]',
        '.content',
        '.post-body',
        '.entry-content',
        'div[class*="container"]'
      ];
      
      let container = null;
      for (const sel of selectors) {
        container = document.querySelector(sel);
        if (container && container.textContent.length > 150) break;
      }
      
      if (!container) return null;
      
      // Get first real paragraph
      const paragraphs = container.querySelectorAll('p');
      for (const p of paragraphs) {
        const text = p.textContent.trim();
        if (text.length > 50 && !text.match(/^(posted|by|date)/i)) {
          return text;
        }
      }
      
      return null;
    });
    
    if (desc) {
      return desc
        .replace(/\s+/g, ' ')
        .substring(0, 180)
        .trim() + '...';
    }
    
    return null;
  } catch (e) {
    return null;
  } finally {
    await page.close();
  }
}

// Run
fetchRemaining().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
