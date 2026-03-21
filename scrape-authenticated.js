import { chromium } from 'playwright';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json'));
const token = process.env.HUBSPOT_ACCESS_TOKEN;

async function scrapeAuthenticatedPortal() {
  let browser;
  let updated = 0;

  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    
    // Set authentication header
    await page.setExtraHTTPHeaders({
      'Authorization': `Bearer ${token}`
    });

    // Get items that need descriptions
    const needsDesc = Object.entries(state)
      .filter(([id, item]) => 
        item.source === 'portal-updates' && 
        (!item.description || item.description.trim() === '')
      )
      .slice(0, 100);

    console.log(`📝 Found ${needsDesc.length} portal items needing descriptions\n`);

    for (const [id, item] of needsDesc) {
      if (!browser.isConnected?.()) {
        console.log('\n⚠️ Browser disconnected');
        break;
      }

      try {
        // Navigate to the update page
        await page.goto(`https://app-eu1.hubspot.com/product-updates/${item.id || id}`, {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });

        await page.waitForTimeout(1500);

        // Extract description
        const description = await page.evaluate(() => {
          // Try multiple selectors
          const selectors = [
            'div[data-testid="update-description"]',
            'div.update-content p:first-of-type',
            'main p:first-of-type',
            'article p:first-of-type',
            'div.content-area p:first-of-type'
          ];

          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              const text = el.textContent?.trim();
              if (text && text.length > 30) {
                return text.substring(0, 250);
              }
            }
          }

          return '';
        });

        if (description && description.length > 30) {
          state[id].description = description;
          updated++;
          console.log(`✓ ${item.title.substring(0, 60)}`);
          console.log(`  "${description.substring(0, 80)}..."\n`);
        } else {
          console.log(`✗ ${item.title.substring(0, 60)} (no description)\n`);
        }
      } catch (e) {
        console.log(`✗ ${item.title.substring(0, 60)}`);
        console.log(`  ${e.message.substring(0, 80)}\n`);
        if (e.message.includes('disconnected')) break;
      }

      await new Promise(r => setTimeout(r, 800));
    }

    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    console.log(`\n✅ Updated ${updated}/${needsDesc.length} items`);

    await page.close();
  } catch (err) {
    console.error('Fatal:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

scrapeAuthenticatedPortal();
