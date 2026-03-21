import { chromium } from 'playwright';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json'));

async function scrapeCommunityPage() {
  let browser;
  let updated = 0;

  try {
    browser = await chromium.launch({ 
      headless: true,
      args: ['--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    
    console.log('📄 Loading HubSpot Community Product Updates page...\n');
    await page.goto('https://community.hubspot.com/t5/Releases-and-Updates/ct-p/releases-and-updates', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for content to fully render
    await page.waitForTimeout(3000);

    // Extract all topic cards with their descriptions
    const descriptions = await page.evaluate(() => {
      const items = {};
      
      // Find all topic cards in the release updates section
      const cards = Array.from(document.querySelectorAll('div[id*="topic-"]'));
      
      cards.forEach(card => {
        try {
          // Get title
          const titleEl = card.querySelector('h3 a, .title a');
          if (!titleEl) return;
          
          const title = titleEl.textContent?.trim();
          
          // Get description - it's usually in a subtitle or excerpt
          const descEl = card.querySelector(
            '.subtitle, .message-excerpt, p[class*="excerpt"], p[class*="desc"], .text-sm'
          );
          
          let description = descEl?.textContent?.trim() || '';
          
          // If no description element found, try getting first text content after title
          if (!description) {
            const allText = card.textContent || '';
            const titleIndex = allText.indexOf(title);
            if (titleIndex >= 0) {
              description = allText.substring(titleIndex + title.length).trim().substring(0, 200);
            }
          }
          
          if (title && description && description.length > 20) {
            items[title] = description.substring(0, 250);
          }
        } catch (e) {
          // Skip cards that fail to parse
        }
      });
      
      return items;
    });

    console.log(`Found ${Object.keys(descriptions).length} items on community page\n`);

    // Match descriptions to state items by title
    for (const [title, desc] of Object.entries(descriptions)) {
      const item = Object.values(state).find(x => 
        x.title && x.title.toLowerCase() === title.toLowerCase() && 
        (!x.description || x.description.trim() === '')
      );
      
      if (item) {
        item.description = desc;
        updated++;
        console.log(`✓ ${title.substring(0, 60)}`);
        console.log(`  "${desc.substring(0, 80)}..."\n`);
      }
    }

    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    console.log(`\n✅ Updated ${updated} items from community page`);
    console.log('📅 Next run: tomorrow at scan time\n');
    
    await page.close();
  } catch (err) {
    console.error('Fatal error:', err.message);
  } finally {
    if (browser) await browser.close();
  }
}

scrapeCommunityPage();
