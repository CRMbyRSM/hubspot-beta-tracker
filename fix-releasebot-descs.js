import { parse as parseHTML } from 'node-html-parser';
import fs from 'fs';

const state = JSON.parse(fs.readFileSync('state.json'));

// Items that need descriptions from Releasebot
const needsDesc = Object.entries(state).filter(([id, i]) => 
  i.source && i.source.includes('releasebot') && 
  (!i.description || i.description.length < 30)
);

console.log(`📋 ${needsDesc.length} Releasebot items need descriptions\n`);

// Group by source URL so we only fetch each page once
const byUrl = {};
for (const [id, item] of needsDesc) {
  const url = item.sourceUrl || 'https://releasebot.io/updates/hubspot';
  if (!byUrl[url]) byUrl[url] = [];
  byUrl[url].push([id, item]);
}

for (const [url, items] of Object.entries(byUrl)) {
  console.log(`\nFetching: ${url}`);
  const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) { console.log(`  Failed: ${resp.status}`); continue; }
  const html = await resp.text();
  const root = parseHTML(html);
  
  for (const [id, item] of items) {
    const title = item.title;
    // Try to find it in the page text
    const allText = root.text;
    const titleIdx = allText.indexOf(title);
    if (titleIdx >= 0) {
      // Get text after title, up to ~300 chars
      const after = allText.substring(titleIdx + title.length, titleIdx + title.length + 400).trim();
      // Clean up and take first meaningful sentence
      const clean = after.replace(/\s+/g, ' ').trim();
      const sentence = clean.split(/[.!?]/).find(s => s.trim().length > 20);
      if (sentence && sentence.trim().length > 20) {
        const desc = sentence.trim().substring(0, 220);
        state[id].description = desc;
        console.log(`  ✓ ${title.substring(0, 50)}`);
        console.log(`    "${desc.substring(0, 90)}..."`);
        continue;
      }
    }
    console.log(`  ✗ ${title.substring(0, 50)} (not found in page)`);
  }
}

fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
console.log('\n✅ Done. Saved state.json');
