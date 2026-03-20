#!/usr/bin/env node

/**
 * Scrape DETAILED Descriptions from Product Update Details
 * 
 * For each item without a good description:
 * 1. Get the item's detail link (e.g., product-updates/{id})
 * 2. Open that link
 * 3. Extract the full description from the detail sidebar/modal
 * 4. Save to state.json
 */

import fs from 'fs';
import { chromium } from 'playwright';

const state = JSON.parse(fs.readFileSync('state.json', 'utf8'));

// Find items without descriptions, prioritize recent
const needsDesc = Object.entries(state.betas)
  .filter(([id, item]) => !item.description || item.description.length < 30)
  .filter(([id, item]) => item.sourceUrl) // Only items with a source URL
  .sort((a, b) => new Date(b[1].lastSeen) - new Date(a[1].lastSeen))
  .slice(0, 100); // Do 100 this run

console.log(`📝 Found ${needsDesc.length} items needing detailed descriptions`);

if (needsDesc.length === 0) {
  console.log('✅ All items have descriptions');
  process.exit(0);
}

async function scrapeDetailedDescriptions() {
  let browser;
  let updated = 0;

  try {
    browser = await chromium.launch({ headless: true });

    for (const [id, item] of needsDesc) {
      try {
        let desc = null;

        console.log(`📄 ${item.title.substring(0, 50)}...`);

        // Try to extract from community thread detail
        if (item.source === 'community' && item.sourceUrl) {
          desc = await scrapeFromCommunityDetail(browser, item.sourceUrl);
        }
        // Try to extract from portal/product update detail
        else if (item.sourceUrl && item.sourceUrl.includes('hubspot.com')) {
          desc = await scrapeFromPortalDetail(browser, item.sourceUrl);
        }

        if (desc && desc.length > 40) {
          state.betas[id].description = desc.substring(0, 500);
          updated++;
          console.log(`  ✓ Extracted: ${desc.substring(0, 70).replace(/\n/g, ' ')}...`);
        } else {
          console.log(`  ⏭ No description found in detail`);
        }
      } catch (e) {
        console.log(`  ✗ Error: ${e.message.substring(0, 50)}`);
      }

      // Throttle requests
      await new Promise(r => setTimeout(r, 1000));
    }

    await browser.close();
  } catch (e) {
    console.error('Browser error:', e.message);
    if (browser) await browser.close();
  }

  // Save
  fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
  console.log(`\n✅ Scraped ${updated}/${needsDesc.length} detailed descriptions\n`);
}

async function scrapeFromCommunityDetail(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });

    // Wait for content to load
    await page.waitForSelector('div[class*="message"], article', { timeout: 5000 }).catch(() => null);

    const desc = await page.evaluate(() => {
      // Get the full post body content
      const postBody = document.querySelector('div[class*="message-body-content"]') ||
                       document.querySelector('article') ||
                       document.querySelector('[role="article"]');

      if (!postBody) return null;

      // Extract first substantial paragraph(s) - up to 2-3 sentences
      const paragraphs = postBody.querySelectorAll('p');
      let text = '';

      for (const p of paragraphs) {
        const pText = p.textContent.trim();
        // Skip metadata, navigation, etc.
        if (pText.length > 50 && 
            !pText.match(/^(posted|by|date|author|tags?:)/i) &&
            !pText.includes('©')) {
          text += (text ? ' ' : '') + pText;
          // Stop after ~2 sentences worth
          if (text.length > 200) break;
        }
      }

      return text || null;
    });

    return desc;
  } catch (e) {
    return null;
  } finally {
    await page.close();
  }
}

async function scrapeFromPortalDetail(browser, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });

    // Wait for the detail modal/sidebar to load
    await page.waitForSelector('[class*="modal"], [class*="sidebar"], [class*="detail"]', { timeout: 5000 }).catch(() => null);

    const desc = await page.evaluate(() => {
      // HubSpot product updates - look for description in detail view
      // Try multiple selectors for the description area
      const selectors = [
        // Detail modal/sidebar content
        'div[class*="detail-content"] p',
        'div[class*="modal-body"] p',
        'div[class*="sidebar"] p',
        'div[class*="description"] p',
        '[role="dialog"] p',
        // Generic content areas
        'main p',
        'article p',
        '.content p'
      ];

      for (const sel of selectors) {
        const p = document.querySelector(sel);
        if (p) {
          const text = p.textContent.trim();
          // Look for substantive content
          if (text.length > 80 && 
              !text.match(/^(posted|released|updated|date)/i) &&
              !text.includes('Sign in')) {
            return text;
          }
        }
      }

      // Fallback: try to get first real paragraph from body
      const allPs = document.querySelectorAll('p');
      for (const p of allPs) {
        const text = p.textContent.trim();
        if (text.length > 100) return text;
      }

      return null;
    });

    return desc ? desc.replace(/\s+/g, ' ').substring(0, 250) : null;
  } catch (e) {
    return null;
  } finally {
    await page.close();
  }
}

scrapeDetailedDescriptions().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
