import { chromium } from 'playwright';
import fs from 'fs';

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

async function debugPage() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies);
  const page = await context.newPage();

  // Pick a URL that we know has the footer issue
  const url = 'https://app-eu1.hubspot.com/product-updates/139633041/all?updateId=14069430'; 
  // Wait, let me check a better URL from state.json
  
  console.log(`Navigating to ${url}...`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  const html = await page.content();
  fs.writeFileSync('debug-page.html', html);
  console.log('Saved debug-page.html');

  const innerText = await page.evaluate(() => document.body.innerText);
  console.log('--- Body Inner Text (first 500 chars) ---');
  console.log(innerText.substring(0, 500));

  await browser.close();
}

debugPage();
