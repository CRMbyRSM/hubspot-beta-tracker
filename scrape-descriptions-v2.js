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

async function scrapeDescriptionsV2() {
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
        (!item.description || item.description.trim() === '' || item.description === 'See how HubSpot can help you achieve your growth goals....')
      )
      .slice(0, 120);

    console.log(`📝 Scraping ${needsDesc.length} portal items\n`);

    for (const [id, item] of needsDesc) {
      if (!browser.isConnected?.()) break;

      try {
        const url = item.sourceUrl || `https://app-eu1.hubspot.com/product-updates/${id}`;
        
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(1500);

        // Extract just the title and description - ignore footers
        const description = await page.evaluate(() => {
          // Get all text from the page
          const bodyText = document.body.innerText;
          
          // Split into lines and filter out common navbar/footer junk
          const lines = bodyText
            .split('\n')
            .map(l => l.trim())
            .filter(l => 
              l.length > 20 && 
              !l.includes('Sign in') &&
              !l.includes('Create an account') &&
              !l.includes('cookie') &&
              !l.includes('See how HubSpot') &&
              !l.includes('Get a demo') &&
              !l.includes('Privacy Policy') &&
              !l.includes('©') &&
              !l.includes('Email') &&
              !l.includes('Continue') &&
              !l.includes('Authentication') &&
              !l.startsWith('http')
            );

          // Return the first meaningful line (after title)
          if (lines.length > 1) {
            // Skip first line (usually the title), get next meaningful one
            for (let i = 1; i < lines.length; i++) {
              if (lines[i].length > 40) {
                return lines[i].substring(0, 250);
              }
            }
          }

          return '';
        });

        if (description && description.length > 40) {
          state[id].description = description;
          updated++;
          console.log(`✓ ${item.title.substring(0, 60)}`);
          console.log(`  "${description.substring(0, 75)}..."\n`);
        } else {
          console.log(`✗ ${item.title.substring(0, 60)} (no content)\n`);
        }
      } catch (e) {
        const msg = e.message || String(e);
        console.log(`✗ ${item.title.substring(0, 60)}`);
        console.log(`  ${msg.substring(0, 50)}\n`);
        if (msg.includes('disconnected')) break;
      }

      await new Promise(r => setTimeout(r, 400));
    }

    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    console.log(`\n✅ Scraped ${updated}/${needsDesc.length} real descriptions`);

    await context.close();
  } catch (err) {
    console.error('Fatal error:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

scrapeDescriptionsV2();
