import { chromium } from 'playwright';

const token = process.env.HUBSPOT_ACCESS_TOKEN;

(async () => {
  const browser = await chromium.launch({ headless: false }); // Show browser so we can see what's happening
  const page = await browser.newPage();
  
  await page.setExtraHTTPHeaders({
    'Authorization': `Bearer ${token}`
  });

  // Try a specific update page
  console.log('Loading portal page...');
  await page.goto('https://app-eu1.hubspot.com/product-updates/298957', {
    waitUntil: 'load',
    timeout: 30000
  });

  console.log('Page loaded. Waiting 5 seconds for content to render...');
  await page.waitForTimeout(5000);

  // Extract ALL text content to see what's actually on the page
  const pageText = await page.evaluate(() => {
    return document.body.innerText;
  });

  console.log('\n=== PAGE TEXT CONTENT (first 2000 chars) ===\n');
  console.log(pageText.substring(0, 2000));

  // Also get the actual DOM structure
  const domStructure = await page.evaluate(() => {
    const main = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    return main.innerHTML.substring(0, 3000);
  });

  console.log('\n=== DOM STRUCTURE (first 3000 chars) ===\n');
  console.log(domStructure);

  // Try to find all paragraphs
  const paragraphs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('p')).map(p => p.textContent?.trim()).filter(t => t && t.length > 20).slice(0, 5);
  });

  console.log('\n=== FIRST 5 PARAGRAPHS ===\n');
  paragraphs.forEach((p, i) => console.log(`${i}: ${p.substring(0, 100)}...`));

  console.log('\n\nBrowser will stay open. Check it manually to see what content is actually displayed.');
  // Don't close - keep browser open so you can inspect
})();
