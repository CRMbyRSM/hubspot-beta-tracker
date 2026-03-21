import { chromium } from 'playwright';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json'));
const token = process.env.HUBSPOT_ACCESS_TOKEN;

async function scrapePortalWithCookies() {
  let browser;
  let updated = 0;

  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--disable-dev-shm-usage']
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    // Set auth header and cookies for portal access
    await page.setExtraHTTPHeaders({
      'Authorization': `Bearer ${token}`,
      'X-HubSpot-CSRF-hubspotapi': token
    });

    // Get items that need descriptions - focus on the ones with empty descriptions
    const needsDesc = Object.entries(state)
      .filter(([id, item]) => 
        item.source === 'portal-updates' && 
        (!item.description || item.description.trim() === '')
      )
      .slice(0, 80);

    console.log(`📝 Scraping ${needsDesc.length} portal items\n`);

    for (const [id, item] of needsDesc) {
      if (!browser.isConnected?.()) break;

      try {
        // Try direct portal page
        const url = `https://app-eu1.hubspot.com/product-updates/${id}`;
        
        await page.goto(url, {
          waitUntil: 'networkidle',
          timeout: 20000
        });

        // Wait for JS to render
        await page.waitForTimeout(2000);

        // Try to find description in multiple ways
        const description = await page.evaluate(() => {
          // Method 1: Look for structured data / JSON-LD
          const script = document.querySelector('script[type="application/ld+json"]');
          if (script) {
            try {
              const data = JSON.parse(script.textContent);
              if (data.description) return data.description;
            } catch (e) {}
          }

          // Method 2: Look for content div
          const contentSelectors = [
            '[data-testid="product-update-content"]',
            '.product-update-description',
            '[class*="content"][class*="description"]',
            'article',
            'main section:first-of-type'
          ];

          for (const sel of contentSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const p = el.querySelector('p');
              if (p) {
                const text = p.textContent?.trim();
                if (text && text.length > 40 && !text.includes('cookie')) {
                  return text.substring(0, 250);
                }
              }
            }
          }

          // Method 3: Grab first meaningful paragraph
          const allP = Array.from(document.querySelectorAll('p'));
          for (const p of allP) {
            const text = p.textContent?.trim();
            if (text && text.length > 50 && !text.includes('cookie') && !text.includes('Sign in')) {
              return text.substring(0, 250);
            }
          }

          return '';
        });

        if (description && description.length > 40) {
          state[id].description = description;
          updated++;
          console.log(`✓ ${item.title.substring(0, 55)}`);
          console.log(`  "${description.substring(0, 75)}..."\n`);
        } else {
          console.log(`✗ ${item.title.substring(0, 55)}\n`);
        }
      } catch (e) {
        console.log(`✗ ${item.title.substring(0, 55)}`);
        console.log(`  Error: ${e.message.substring(0, 60)}\n`);
        if (e.message.includes('disconnected')) break;
      }

      await new Promise(r => setTimeout(r, 600));
    }

    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    console.log(`\n✅ Scraped ${updated}/${needsDesc.length} descriptions`);

    await context.close();
  } catch (err) {
    console.error('Fatal:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

scrapePortalWithCookies();
