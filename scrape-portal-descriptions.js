import { chromium } from 'playwright';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json'));

async function scrapePortalDescriptions() {
  let browser;
  let updated = 0;

  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--disable-dev-shm-usage']
    });

    // Get all portal items that need descriptions
    const portalItems = Object.entries(state)
      .filter(([id, item]) => 
        item.source === 'portal-updates' && 
        (!item.description || item.description.trim() === '' || item.description.includes('Utilizziamo i cookie'))
      )
      .slice(0, 50); // Limit to 50 per run

    console.log(`📝 Found ${portalItems.length} portal items needing descriptions\n`);

    for (const [id, item] of portalItems) {
      if (!browser.isConnected?.()) {
        console.log('\n⚠️ Browser disconnected, stopping scraper');
        break;
      }

      try {
        const page = await browser.newPage();
        await page.goto(item.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Wait for content to load
        await page.waitForTimeout(2000);

        // Extract description from the product update card
        const description = await page.evaluate(() => {
          // Try multiple selectors for description content
          const selectors = [
            'div[data-testid="update-description"]',
            'div.update-description',
            'article p:first-of-type',
            'main p:first-of-type',
            'div[role="article"] p:first-of-type',
            'div.content p:first-of-type'
          ];

          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && el.textContent?.trim() && !el.textContent.includes('cookie')) {
              return el.textContent.trim().substring(0, 250);
            }
          }

          // Fallback: get first non-cookie paragraph from entire page
          const paragraphs = Array.from(document.querySelectorAll('p'));
          for (const p of paragraphs) {
            const text = p.textContent?.trim();
            if (text && text.length > 30 && !text.includes('cookie') && !text.includes('Utilizziamo')) {
              return text.substring(0, 250);
            }
          }

          return '';
        });

        if (description && !description.includes('cookie')) {
          state[id].description = description;
          updated++;
          console.log(`✓ ${item.title.substring(0, 50)}`);
          console.log(`  "${description.substring(0, 80)}..."\n`);
        } else {
          console.log(`✗ ${item.title.substring(0, 50)} (no description found)\n`);
        }

        await page.close();
      } catch (e) {
        console.log(`✗ ${item.title.substring(0, 50)}`);
        console.log(`  Error: ${e.message.substring(0, 80)}\n`);
        if (e.message.includes('Target page') || e.message.includes('disconnect')) {
          break;
        }
      }

      // Throttle to avoid overwhelming browser
      await new Promise(r => setTimeout(r, 1000));
    }

    // Save updated state
    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    console.log(`\n✅ Scraped ${updated}/${portalItems.length} portal descriptions`);
    console.log('📅 Next run: tomorrow at scan time\n');
  } catch (err) {
    console.error('Fatal error:', err);
  } finally {
    if (browser) await browser.close();
  }
}

scrapePortalDescriptions();
