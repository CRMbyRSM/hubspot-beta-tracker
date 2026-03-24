import fs from 'fs';

const cookieString = fs.readFileSync('.auth-cookies', 'utf8').trim();
const csrfToken = 'AAccUftyySsZVcKivs7QBkCkT47zyLj7sZ6vsI-eH0DNtUmTqe4xnwW2U8ZKlw2iuDD2MAd9E_Obx_8VbsWurzKYwg3GnxviIg';

async function testApi() {
  try {
    const url = 'https://app-eu1.hubspot.com/api/product-updates/v3/rollout-product-updates/list?portalId=139633041&limit=1&offset=0';
    const response = await fetch(url, {
      headers: {
        'Cookie': cookieString,
        'X-HubSpot-CSRF-hubspotapi': csrfToken,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    const item = data.rolloutProductUpdates[0];
    
    console.log('--- translatedContent ---');
    console.log(JSON.stringify(item.translatedContent, null, 2));
    
  } catch (err) {
    console.error('Error:', err);
  }
}

testApi();
