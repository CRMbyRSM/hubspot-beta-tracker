import { chromium } from 'playwright';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json'));
const cookieString = fs.readFileSync('.auth-cookies', 'utf8').trim();

// Parse cookies
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

async function scrapeDescriptionsAuthenticated() {
  let browser;
  let updated = 0;
  let failed = 0;

  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--disable-dev-shm-usage']
    });

    const context = await browser.newContext();
    
    // Add cookies to context
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Get items that need descriptions
    const needsDesc = Object.entries(state)
      .filter(([id, item]) => 
        item.source === 'portal-updates' && 
        (!item.description || item.description.trim() === '')
      )
      .slice(0, 100);

    console.log(`📝 Scraping ${needsDesc.length} portal items\n`);

    for (const [id, item] of needsDesc) {
      if (!browser.isConnected?.()) {
        console.log('\n⚠️ Browser disconnected');
        break;
      }

      try {
        // Use sourceUrl or construct from ID
        const url = item.sourceUrl || `https://app-eu1.hubspot.com/product-updates/${id}`;
        
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 20000
        });

        // Wait for content to load
        await page.waitForTimeout(1500);

        // Extract description - try multiple strategies
        const description = await page.evaluate(() => {
          // Strategy 1: Look for main content area
          const selectors = [
            'main',
            'article',
            'div[role="main"]',
            'div.content',
            'div[class*="description"]'
          ];

          for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
              const text = el.innerText || el.textContent;
              if (text && text.length > 50) {
                // Clean up and extract first meaningful paragraph
                const lines = text.split('\n').filter(l => l.trim().length > 30);
                if (lines.length > 0) {
                  return lines[0].substring(0, 250);
                }
              }
            }
          }

          // Strategy 2: Get first <p> tag with real content
          const paragraphs = Array.from(document.querySelectorAll('p'));
          for (const p of paragraphs) {
            const text = (p.innerText || p.textContent)?.trim();
            if (text && text.length > 50 && !text.includes('Sign in') && !text.includes('cookie')) {
              return text.substring(0, 250);
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
          failed++;
          console.log(`✗ ${item.title.substring(0, 60)} (no content)\n`);
        }
      } catch (e) {
        failed++;
        const msg = e.message || String(e);
        console.log(`✗ ${item.title.substring(0, 60)}`);
        console.log(`  ${msg.substring(0, 60)}\n`);
        if (msg.includes('disconnected')) break;
      }

      await new Promise(r => setTimeout(r, 500));
    }

    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    console.log(`\n✅ Scraped ${updated}/${needsDesc.length} descriptions (${failed} failed)`);
    console.log('📅 Next run: tomorrow at scan time\n');

    await context.close();
  } catch (err) {
    console.error('Fatal error:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

scrapeDescriptionsAuthenticated();
