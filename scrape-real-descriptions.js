#!/usr/bin/env node

/**
 * Scrape Real Descriptions from Source Pages
 * 
 * Extracts the actual product description from:
 * - Community threads
 * - Releasebot pages
 * - Portal pages
 * - Dev changelog RSS
 * 
 * Caches results in state.json so we don't re-fetch daily
 */

import fs from 'fs';
import { chromium } from 'playwright';

const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));

// Find items without descriptions, prioritize recent ones
const needsDesc = Object.entries(state.betas)
  .filter(([id, item]) => !item.description || item.description.length < 30)
  .sort((a, b) => new Date(b[1].lastSeen) - new Date(a[1].lastSeen))
  .slice(0, 50);

console.log(`📝 Found ${needsDesc.length} items needing descriptions`);

if (needsDesc.length === 0) {
  console.log('✅ All items have descriptions');
  process.exit(0);
}

async function scrapeDescriptions() {
  let browser;
  let updated = 0;

  try {
    browser = await chromium.launch({ headless: true });

    for (const [id, item] of needsDesc) {
      if (!item.sourceUrl) {
        console.log(`⏭ ${item.title.substring(0, 40)} — no sourceUrl`);
        continue;
      }

      try {
        let desc = null;

        // Extract description based on source type
        if (item.source === 'community') {
          desc = await extractCommunityDesc(browser, item.sourceUrl);
        } else if (item.source === 'releasebot-product' || item.source === 'releasebot-dev') {
          desc = await extractReleasebotDesc(browser, item.sourceUrl);
        } else if (item.source === 'portal-updates') {
          desc = await extractPortalDesc(browser, item.sourceUrl);
        } else if (item.source === 'product-updates') {
          desc = await extractProductDesc(browser, item.sourceUrl);
        }

        if (desc && desc.length > 40) {
          state.betas[id].description = desc.substring(0, 500);
          updated++;
          console.log(`✓ ${item.title.substring(0, 45)} — ${desc.substring(0, 60).replace(/\n/g, ' ')}`);
        }
      } catch (e) {
        // Silently skip on error
      }

      // Throttle
      await new Promise(r => setTimeout(r, 500));
    }

    await browser.close();
  } catch (e) {
    console.error('Browser error:', e.message);
    if (browser) await browser.close();
  }

  // Save
  fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
  console.log(`\n✅ Updated ${updated}/${needsDesc.length} descriptions from source pages`);
}

async function extractCommunityDesc(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    const desc = await page.evaluate(() => {
      // Community thread body - try multiple selectors
      const selectors = [
        'div.lia-message-body-content p',
        'article p',
        '[role="article"] p',
        '.post-body p'
      ];

      for (const sel of selectors) {
        const p = document.querySelector(sel);
        if (p) {
          const text = p.textContent.trim();
          if (text.length > 50 && !text.match(/^(posted|by|date)/i)) {
            return text;
          }
        }
      }
      return null;
    });

    return desc ? desc.replace(/\s+/g, ' ').substring(0, 200) : null;
  } finally {
    await page.close();
  }
}

async function extractReleasebotDesc(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    const desc = await page.evaluate(() => {
      // Releasebot rollup text - find H2 followed by description
      const h2 = document.querySelector('h2');
      if (!h2) return null;

      // Get text after H2 until next section
      let current = h2.nextElementSibling;
      let text = '';

      while (current && current.tagName !== 'H2' && current.tagName !== 'H3') {
        if (current.tagName === 'P') {
          const p = current.textContent.trim();
          if (p.length > 30) {
            text = p;
            break;
          }
        }
        current = current.nextElementSibling;
      }

      return text || null;
    });

    return desc ? desc.replace(/\s+/g, ' ').substring(0, 200) : null;
  } finally {
    await page.close();
  }
}

async function extractPortalDesc(browser, url) {
  // Portal pages require authentication - skip for now
  // Would need HUBSPOT_PORTAL_COOKIE env var
  return null;
}

async function extractProductDesc(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    const desc = await page.evaluate(() => {
      // Product updates page - find first substantive paragraph
      const selectors = [
        'article p',
        'main p',
        '.content p',
        'div[role="main"] p'
      ];

      for (const sel of selectors) {
        const p = document.querySelector(sel);
        if (p) {
          const text = p.textContent.trim();
          if (text.length > 50) return text;
        }
      }
      return null;
    });

    return desc ? desc.replace(/\s+/g, ' ').substring(0, 200) : null;
  } finally {
    await page.close();
  }
}

scrapeDescriptions().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
