import fs from 'fs';

// Cookie auth
const cookieString = fs.readFileSync('.auth-cookies', 'utf8').trim();
const csrfToken = 'AAccUftyySsZVcKivs7QBkCkT47zyLj7sZ6vsI-eH0DNtUmTqe4xnwW2U8ZKlw2iuDD2MAd9E_Obx_8VbsWurzKYwg3GnxviIg';

const state = JSON.parse(fs.readFileSync('state.json'));

function extractTextFromHTML(html) {
  if (!html) return '';
  // Strip HTML tags and normalize whitespace
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/p>/gi, ' ')
    .replace(/<\/h[1-6]>/gi, ': ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function getBestDescription(content) {
  if (!content) return '';
  const text = extractTextFromHTML(content);
  
  // Try to extract just the "What is it?" section which is most descriptive
  const whatIsIt = text.match(/What is it\?:?\s*(.*?)(?:Why does it matter|How does it work|$)/is);
  if (whatIsIt && whatIsIt[1].trim().length > 30) {
    return whatIsIt[1].trim().substring(0, 220);
  }
  
  // Otherwise take first meaningful sentence
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 30);
  if (sentences.length > 0) {
    return sentences[0].substring(0, 220);
  }
  
  return text.substring(0, 220);
}

async function fetchDescription(updateId, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(
        `https://app-eu1.hubspot.com/api/product-updates/v3/rollout-product-updates/${updateId}?portalId=139633041`,
        {
          headers: {
            'Cookie': cookieString,
            'X-HubSpot-CSRF-hubspotapi': csrfToken,
            'Accept': 'application/json'
          },
          signal: AbortSignal.timeout(12000)
        }
      );
      if (!resp.ok) return null;
      const data = await resp.json();
      return data?.translatedContent?.content || null;
    } catch (e) {
      if (i < retries) await new Promise(r => setTimeout(r, 1500));
    }
  }
  return null;
}

async function enrichDescriptions() {
  const needsDesc = Object.entries(state)
    .filter(([id, item]) => 
      id.startsWith('portal-') &&
      (!item.description || item.description.length < 30 || 
       item.description.includes('See how HubSpot') || 
       item.description.includes('authentication has expired'))
    );

  console.log(`📋 ${needsDesc.length} portal items need descriptions\n`);

  let updated = 0;
  let failed = 0;
  const batchSize = 10;

  for (let i = 0; i < needsDesc.length; i += batchSize) {
    const batch = needsDesc.slice(i, i + batchSize);
    
    const results = await Promise.all(
      batch.map(async ([id, item]) => {
        const updateId = id.replace('portal-', '');
        const content = await fetchDescription(updateId);
        return { id, item, content };
      })
    );

    for (const { id, item, content } of results) {
      if (content) {
        const desc = getBestDescription(content);
        if (desc.length > 30) {
          state[id].description = desc;
          updated++;
          process.stdout.write(`✓ ${item.title.substring(0, 50)}\n  "${desc.substring(0, 90)}..."\n\n`);
        } else {
          failed++;
          process.stdout.write(`✗ ${item.title.substring(0, 50)} (content too short)\n\n`);
        }
      } else {
        failed++;
        process.stdout.write(`✗ ${item.title.substring(0, 50)} (no content)\n\n`);
      }
    }

    // Save after each batch
    fs.writeFileSync('state.json', JSON.stringify(state, null, 2));
    console.log(`--- Batch ${Math.floor(i/batchSize)+1} done | ${updated} updated, ${failed} failed | Progress: ${i+batch.length}/${needsDesc.length} ---\n`);
    
    // Short pause between batches
    if (i + batchSize < needsDesc.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\n✅ Complete: ${updated} descriptions added, ${failed} failed`);
  console.log(`📊 Total with descriptions: ${Object.values(state).filter(i => i.description && i.description.length > 30).length}/${Object.keys(state).length}`);
}

enrichDescriptions();
