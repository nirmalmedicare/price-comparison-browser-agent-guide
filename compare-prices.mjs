#!/usr/bin/env node
/**
 * compare-prices.mjs
 *
 * Runnable companion to the README guide. Visits Amazon.in, Reliance Digital,
 * Vijay Sales, and Tata CLiQ, handles each site's quirk (documented in README.md),
 * extracts the price of a product, and prints which store is cheapest.
 *
 * Usage:
 *   npm install
 *   npx playwright install chromium
 *   node compare-prices.mjs                 # defaults to "Sony WH-1000XM5"
 *   node compare-prices.mjs "Sony WH-1000XM5"
 *   HEADLESS=false node compare-prices.mjs  # watch the browser work
 *
 * Notes:
 * - Retail sites change their markup often. If a site returns null, open the
 *   README and re-check that site's selector/URL section — the *method* is the
 *   durable part, not any single CSS selector.
 */

import { chromium } from 'playwright';

const QUERY = process.argv[2] || 'Sony WH-1000XM5';
const HEADLESS = process.env.HEADLESS !== 'false';

// Turn "₹27,627.00" -> 27627 (integer rupees). Returns null if unparseable.
function toNumber(priceStr) {
  if (!priceStr) return null;
  const digits = priceStr.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

// A product is the right one only if it matches WH-1000XM5 and is NOT the earbuds
// (WF-1000XM5), the newer model (XM6), or an accessory.
function isTarget(text) {
  return (
    /WH-?1000XM5/i.test(text) &&
    !/WF-?1000XM5/i.test(text) &&
    !/XM6|repair|hinge|case|cover|cushion|ear\s?pad|pad\b/i.test(text)
  );
}

async function getAmazon(page) {
  await page.goto('https://www.amazon.in/s?k=' + encodeURIComponent(QUERY), {
    waitUntil: 'domcontentloaded',
  });
  const result = await page.evaluate(() => {
    const items = [...document.querySelectorAll('div[data-component-type="s-search-result"]')];
    return items
      .map((it) => ({
        txt: it.innerText.replace(/\n+/g, ' '),
        price: it.querySelector('.a-price .a-offscreen')?.innerText || '',
      }))
      .filter((x) => x.price);
  });
  // Filter in Node so we can reuse isTarget(). Pick the lowest genuine listing.
  const candidates = result
    .filter((x) => isTarget(x.txt))
    .map((x) => ({ ...x, num: toNumber(x.price) }))
    .filter((x) => x.num)
    .sort((a, b) => a.num - b.num);
  return candidates[0] ? { price: candidates[0].price, num: candidates[0].num } : null;
}

async function getRelianceDigital(page) {
  // /search?q= 404s — the working path is /products?q=
  await page.goto('https://www.reliancedigital.in/products?q=' + encodeURIComponent(QUERY), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(3000); // results render client-side
  return await page.evaluate(() => {
    const isTarget = (t) => /WH-?1000XM5/i.test(t) && !/WF-?1000XM5/i.test(t);
    const a = [...document.querySelectorAll('a')].find((a) => isTarget(a.innerText || ''));
    if (!a) return null;
    let card = a;
    for (let i = 0; i < 6 && card; i++) {
      if (/₹/.test(card.innerText)) break;
      card = card.parentElement;
    }
    const price = (card?.innerText.match(/₹\s?[\d,]+/) || [])[0] || '';
    return price ? { price } : null;
  });
}

async function getVijaySales(page) {
  // The on-page search box is a readonly decoy; the real results live at
  // /search-listing?q= , which we can hit directly.
  await page.goto('https://www.vijaysales.com/search-listing?q=' + encodeURIComponent(QUERY), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(3000);
  return await page.evaluate(() => {
    const isTarget = (t) => /WH-?1000XM5/i.test(t) && !/WF-?1000XM5/i.test(t);
    const a = [...document.querySelectorAll('a[href]')].find(
      (a) => isTarget(a.innerText || '') && /\/p\//.test(a.href)
    );
    if (!a) return null;
    let card = a;
    for (let i = 0; i < 6 && card; i++) {
      if (/₹/.test(card.innerText)) break;
      card = card.parentElement;
    }
    const price = (card?.innerText.match(/₹\s?[\d,]+/) || [])[0] || '';
    return price ? { price } : null;
  });
}

async function getTataCliq(page) {
  await page.goto(
    'https://www.tatacliq.com/search/?searchCategory=all&text=' + encodeURIComponent(QUERY),
    { waitUntil: 'domcontentloaded' }
  );
  await page.waitForTimeout(3000);
  return await page.evaluate(() => {
    const isTarget = (t) => /WH-?1000XM5/i.test(t) && !/WF-?1000XM5/i.test(t);
    const a = [...document.querySelectorAll('a[href]')].find(
      (a) => isTarget(a.innerText || '') && /\/p-/.test(a.href)
    );
    if (!a) return null;
    let card = a;
    for (let i = 0; i < 7 && card; i++) {
      if (/₹/.test(card.innerText)) break;
      card = card.parentElement;
    }
    // First ₹ value is the selling price; MRP/EMI/coupon are noise.
    const price = (card?.innerText.match(/₹\s?[\d,]+/) || [])[0] || '';
    return price ? { price } : null;
  });
}

const STORES = [
  { name: 'Amazon.in', fn: getAmazon },
  { name: 'Reliance Digital', fn: getRelianceDigital },
  { name: 'Vijay Sales', fn: getVijaySales },
  { name: 'Tata CLiQ', fn: getTataCliq },
];

async function main() {
  console.log(`\nComparing prices for: "${QUERY}"\n${'-'.repeat(48)}`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-IN',
  });

  const rows = [];
  for (const store of STORES) {
    const page = await ctx.newPage();
    try {
      const res = await store.fn(page);
      const num = res ? toNumber(res.price) : null;
      rows.push({ store: store.name, price: res?.price || 'n/a', num });
      console.log(`${store.name.padEnd(20)} ${res?.price || 'not found'}`);
    } catch (err) {
      rows.push({ store: store.name, price: 'error', num: null });
      console.log(`${store.name.padEnd(20)} ERROR: ${err.message.split('\n')[0]}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  const priced = rows.filter((r) => r.num);
  console.log('-'.repeat(48));
  if (priced.length) {
    const cheapest = priced.reduce((a, b) => (a.num <= b.num ? a : b));
    console.log(`\n🥇 Cheapest: ${cheapest.store} at ${cheapest.price}\n`);
  } else {
    console.log('\nNo prices could be read. Check the README for per-site selector notes.\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
