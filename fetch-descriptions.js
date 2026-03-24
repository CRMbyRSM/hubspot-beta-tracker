#!/usr/bin/env node

/**
 * Fetch Missing Descriptions
 * 
 * Augments tracker items with 1-2 sentence descriptions from:
 * - Community thread summaries (via page.evaluate)
 * - Portal item detail pages (via Playwright)
 * - Releasebot rollup text (already in description field)
 * 
 * Runs daily after main scanner. Only fetches for:
 * - Items without descriptions
 * - Added/updated in last 30 days (recent items only)
 */

import fs from 'fs';
import { chromium } from 'playwright';

// Load current state
const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));
const CUTOFF_DAYS = 30;
const cutoffDate = new Date(Date.now() - CUTOFF_DAYS * 24 * 60 * 60 * 1000);

// Find items that need descriptions
const itemsNeedingDesc = Object.entries(state.betas)
  .filter(([id, item]) => {
    if (item.description && item.description.length > 20) return false; // Already has good desc
    const lastSeen = new Date(item.lastSeen || item.firstSeen || 0);
    return lastSeen > cutoffDate; // Only recent items
  })
  .map(([id, item]) => ({ id, ...item }))
  .slice(0, 50); // Limit to 50 per run (to avoid timeout)

console.log(`📝 Found ${itemsNeedingDesc.length} items needing descriptions (last ${CUTOFF_DAYS}d)`);

if (itemsNeedingDesc.length === 0) {
  console.log('✅ All recent items have descriptions.');
  process.exit(0);
}

// Fetch descriptions based on source
async function fetchDescriptions() {
  let updated = 0;
  let browser;

  try {
    browser = await chromium.launch({ headless: true });
    
    for (const item of itemsNeedingDesc) {
      try {
        let desc = null;

        if (item.source === 'community' && item.sourceUrl) {
          // Community thread: grab first paragraph
          desc = await fetchCommunityDesc(browser, item.sourceUrl);
        } else if (item.source === 'portal-updates' && item.sourceUrl) {
          // Portal detail page
          desc = await fetchPortalDesc(browser, item.sourceUrl);
        } else if (item.sourceUrl) {
          // Generic URL: try to extract first paragraph
          desc = await fetchGenericDesc(browser, item.sourceUrl);
        }

        if (desc && desc.length > 20) {
          state.betas[item.id].description = desc.substring(0, 500); // Cap at 500 chars
          updated++;
          console.log(`✓ ${item.title.substring(0, 50)} — ${desc.substring(0, 60).replace(/\n/g, ' ')}`);
        }
      } catch (e) {
        // Silently skip items we can't fetch
      }

      // Small delay between requests to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    await browser.close();
  } catch (e) {
    console.error('Browser error:', e.message);
    if (browser) await browser.close();
  }

  // Save updated state
  fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
  console.log(`\n✅ Updated ${updated}/${itemsNeedingDesc.length} items with descriptions.`);
}

async function fetchCommunityDesc(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    
    // Extract first substantive paragraph from community thread
    const desc = await page.evaluate(() => {
      // Try multiple selectors for community thread body
      const selectors = [
        'div.lia-message-body-content',
        'div[class*="message-body"]',
        'article',
        'div[role="article"]',
        'div.post-body',
        'div.entry-content'
      ];
      
      let post = null;
      for (const sel of selectors) {
        post = document.querySelector(sel);
        if (post && post.textContent.length > 100) break;
      }
      
      if (!post) return null;
      
      // Get first paragraph with substance
      const paragraphs = post.querySelectorAll('p');
      for (const p of paragraphs) {
        const text = p.textContent.trim();
        if (text.length > 50 && !text.includes('Posted') && !text.includes('Tags:')) {
          return text;
        }
      }
      
      // If no paragraphs, try getting text content
      const text = post.textContent.trim().split('\n')[0];
      return text && text.length > 50 ? text : null;
    });
    
    // Clean up the text
    if (desc) {
      const cleaned = desc
        .replace(/\s+/g, ' ')                    // collapse whitespace
        .substring(0, 200)                        // cap length
        .trim();
      return cleaned.length > 50 ? cleaned : null;
    }
    
    return null;
  } catch (e) {
    return null;
  } finally {
    await page.close();
  }
}

async function fetchPortalDesc(browser, url) {
  const page = await browser.newPage();
  try {
    // Need auth cookies for portal — skip for now, use placeholder
    // TODO: Use HUBSPOT_PORTAL_COOKIE when available
    return null;
  } finally {
    await page.close();
  }
}

async function fetchGenericDesc(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    
    const desc = await page.evaluate(() => {
      // Look for main content container
      const contentSelectors = [
        'article',
        'main',
        '[role="main"]',
        '.content',
        '.post-content',
        '.entry-content',
        'div[class*="article"]',
        'div[class*="content"]'
      ];
      
      let container = null;
      for (const sel of contentSelectors) {
        container = document.querySelector(sel);
        if (container && container.textContent.length > 200) break;
      }
      
      if (!container) return null;
      
      // Extract first substantive paragraph
      const paragraphs = container.querySelectorAll('p');
      for (const p of paragraphs) {
        const text = p.textContent.trim();
        // Skip metadata lines, empty paragraphs, and navigation
        if (text.length > 60 && 
            !text.match(/^(by|posted|date|updated|author):/i) &&
            !text.includes('©') &&
            !text.includes('privacy')) {
          return text;
        }
      }
      
      // Fallback: get first meaningful text block
      const text = container.textContent.trim();
      const lines = text.split('\n').filter(l => l.length > 60);
      return lines[0] || null;
    });
    
    if (desc) {
      return desc
        .replace(/\s+/g, ' ')
        .substring(0, 200)
        .trim();
    }
    
    return null;
  } catch (e) {
    return null;
  } finally {
    await page.close();
  }
}

// Run
fetchDescriptions().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
