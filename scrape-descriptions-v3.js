import { chromium } from 'playwright';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json'));
const cookieString = fs.readFileSync('.auth-cookies', 'utf8').trim();

const cookies = cookieString.split('; ').map(c => {
  const [name, ...valueParts] = c.split('=');
  return {
    name: name.trim(),
    value: valueParts.join('=').trim(),
    domain: 'app-eu1.hubspot.com',
    path: '/'
  };
});

console.log(`🔐 Loaded ${cookies.length} authentication cookies\n`);

async function scrapeDescriptionsV3() {
  let browser;
  let updated = 0;

  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--disable-dev-shm-usage']
    });

    const context = await browser.newContext();
    await context.addCookies(cookies);
    const page = await context.newPage();

    const needsDesc = Object.entries(state)
      .filter(([id, item]) => 
        item.source === 'portal-updates' && 
        (!item.description || item.description.trim() === '' || item.description.includes('See how HubSpot') || item.description.includes('authentication has expired'))
      )
      .slice(0, 100);

    console.log(`📝 Scraping ${needsDesc.length} portal items\n`);

    for (const [id, item] of needsDesc) {
      if (!browser.isConnected?.()) break;

      try {
        const url = item.sourceUrl || `https://app-eu1.hubspot.com/product-updates/${id.replace('portal-', '')}`;
        
        await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
        await page.waitForTimeout(3000); // Give it extra time to render

        const description = await page.evaluate(() => {
          // HubSpot Portal Update Specific Selectors
          const selectors = [
            '.product-update-details-content',
            '[data-test-id="update-details-description"]',
            '.description-container',
            'main article',
            '.uiBodyContent'
          ];

          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText.length > 50) {
              return el.innerText.trim();
            }
          }

          // Fallback to finding the largest text block that isn't a nav/footer
          const elements = Array.from(document.querySelectorAll('p, div, span'));
          let bestText = '';
          for (const el of elements) {
            const text = el.innerText.trim();
            if (text.length > 50 && text.length < 1000 && 
                !text.includes('cookie') && 
                !text.includes('Sign in') &&
                !text.includes('Terms of Service')) {
              if (text.length > bestText.length) {
                bestText = text;
              }
            }
          }
          return bestText;
        });

        if (description && description.length > 40) {
          // Clean up the description
          const cleanDesc = description.split('\n')[0].substring(0, 300);
          state[id].description = cleanDesc;
          updated++;
          console.log(`✓ ${item.title.substring(0, 50)}...`);
          console.log(`  "${cleanDesc.substring(0, 100)}..."\n`);
        } else {
          console.log(`✗ ${item.title.substring(0, 50)} (no content found)\n`);
        }
      } catch (e) {
        console.log(`✗ ${item.title.substring(0, 50)} (Error: ${e.message.substring(0, 50)})\n`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    console.log(`\n✅ Scraped ${updated}/${needsDesc.length} descriptions`);

    await context.close();
  } catch (err) {
    console.error('Fatal error:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

scrapeDescriptionsV3();
