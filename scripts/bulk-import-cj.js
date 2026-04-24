#!/usr/bin/env node
// Bulk CJ import script — uses list data only (no detail calls) to avoid 1-QPS rate limit
// Usage: node scripts/bulk-import-cj.js

require('dotenv').config({ path: '.env.local' });
const { neon } = require('@neondatabase/serverless');

const sql = neon(process.env.DATABASE_URL);
const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';
const CJ_EMAIL = process.env.CJ_LOGIN_EMAIL || (process.env.CJ_EMAIL || '').trim();
const CJ_API_KEY = (process.env.CJ_API_KEY || '').trim();

const CATEGORY_MAP = {
  'Smart Watches': 'wearables',
  'Smart Wristbands': 'fitness',
  'Wearable Devices': 'wearables',
  'Smart Wearable Accessories': 'wearables',
  'Earphones & Headphones': 'audio',
  'Speakers': 'audio',
  'Portable Audio & Video': 'audio',
  'Home Audio & Video': 'audio',
  'Camera Drones': 'phones_and_accessories',
  'Action Cameras': 'phones_and_accessories',
  'Digital Cameras': 'phones_and_accessories',
  'Video Games': 'gaming',
  'Gamepads': 'gaming',
  'Personal Care Appliances': 'wearables',
  'Health Care Products': 'fitness',
  'LED Lighting': 'home_lighting',
  'Indoor Lighting': 'home_lighting',
  'Outdoor Lighting': 'home_lighting',
  'Smart Home Appliances': 'desk_gear',
  'Charger': 'phones_and_accessories',
  'Fitness & Bodybuilding': 'fitness',
};
const DEFAULT_CATEGORY = 'phones_and_accessories';

const IMPORT_JOBS = [
  { keyword: 'smartwatch',        pages: 5 },
  { keyword: 'bluetooth speaker', pages: 5 },
  { keyword: 'wireless earbuds',  pages: 5 },
  { keyword: 'gaming headset',    pages: 5 },
  { keyword: 'fitness tracker',   pages: 5 },
  { keyword: 'phone case',        pages: 5 },
  { keyword: 'sunglasses',        pages: 5 },
  { keyword: 'led lights',        pages: 5 },
  { keyword: 'drone',             pages: 5 },
  { keyword: 'portable charger',  pages: 5 },
  { keyword: 'makeup brushes',    pages: 3 },
  { keyword: 'yoga mat',          pages: 3 },
  { keyword: 'camping gear',      pages: 3 },
  { keyword: 'kids toys',         pages: 3 },
  { keyword: 'kitchen gadgets',   pages: 3 },
  { keyword: 'hair accessories',  pages: 3 },
  { keyword: 'jewelry',           pages: 3 },
  { keyword: 'backpack',          pages: 3 },
  { keyword: 'ring light',        pages: 3 },
  { keyword: 'action camera',     pages: 3 },
];

const PAGE_SIZE = 50;

async function getCJToken() {
  console.log(`Authenticating with CJ as ${CJ_EMAIL}...`);
  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CJ_EMAIL, password: CJ_API_KEY }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`CJ auth failed: ${data.message}`);
  console.log('CJ auth OK');
  return data.data.accessToken;
}

async function fetchProductList(token, keyword, pageNum) {
  const params = new URLSearchParams({ pageNum, pageSize: PAGE_SIZE, productNameEn: keyword });
  const res = await fetch(`${CJ_BASE}/product/list?${params}`, {
    headers: { 'CJ-Access-Token': token },
  });
  const data = await res.json();
  if (!data.success) {
    console.log(`  [LIST ERROR] ${data.message}`);
    return null;
  }
  return data.data;
}

function mapCategory(cjCategoryName) {
  if (!cjCategoryName) return DEFAULT_CATEGORY;
  if (CATEGORY_MAP[cjCategoryName]) return CATEGORY_MAP[cjCategoryName];
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (cjCategoryName.includes(key) || key.includes(cjCategoryName)) return val;
  }
  return DEFAULT_CATEGORY;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function importFromList(product, keyword) {
  const cjPrice = parseFloat(String(product.sellPrice || '0').split('--')[0].trim());
  if (!cjPrice || cjPrice < 2 || cjPrice > 300) return { status: 'skip', reason: 'price out of range' };

  const sku = product.productSku;
  if (!sku) return { status: 'skip', reason: 'no sku' };

  // Single image from list
  const image = product.productImage;
  if (!image) return { status: 'skip', reason: 'no image' };
  const images = [image];

  const retailPrice = cjPrice * 2.5;
  const floorPrice = Math.max(cjPrice * 1.1, retailPrice * 0.3);

  if (floorPrice >= retailPrice) return { status: 'skip', reason: 'price calc invalid' };
  if (retailPrice > 500) return { status: 'skip', reason: 'price too high' };

  const category = mapCategory(product.categoryName);

  const titleWords = (product.productNameEn || '').toLowerCase()
    .split(/\W+/).filter(w => w.length > 3 && w.length < 20);
  const kwTag = keyword.toLowerCase().replace(/\s+/g, '_');
  const categoryTag = (product.categoryName || '').toLowerCase().replace(/\s+/g, '_');
  const tags = [...new Set([kwTag, categoryTag, category, ...titleWords.slice(0, 8)])].filter(Boolean);

  const cjCategoryId = String(product.categoryId || '').trim() || null;

  try {
    const rows = await sql`
      INSERT INTO products (
        title, description, brand, category, subcategory,
        tags, condition, images, sku, retail_price, floor_price,
        cj_category_id
      ) VALUES (
        ${(product.productNameEn || '').slice(0, 255)},
        ${null},
        ${null},
        ${category},
        ${product.categoryName || null},
        ${tags},
        'new',
        ${images},
        ${sku},
        ${Math.round(retailPrice * 100) / 100},
        ${Math.round(floorPrice * 100) / 100},
        ${cjCategoryId}
      )
      ON CONFLICT (sku) DO NOTHING
      RETURNING id, title, category
    `;
    if (rows.length === 0) return { status: 'skip', reason: 'sku exists' };
    return { status: 'imported', product: rows[0] };
  } catch (err) {
    return { status: 'error', reason: err.message };
  }
}

async function main() {
  if (!CJ_EMAIL || !CJ_API_KEY) {
    console.error('Missing CJ_EMAIL or CJ_API_KEY');
    process.exit(1);
  }

  const token = await getCJToken();
  const totals = {};
  let grandTotal = 0;

  for (const job of IMPORT_JOBS) {
    const { keyword, pages } = job;
    let jobImported = 0, jobSkipped = 0, jobErrors = 0;
    console.log(`\n=== ${keyword.toUpperCase()} (${pages} pages) ===`);

    for (let page = 1; page <= pages; page++) {
      process.stdout.write(`  Page ${page}/${pages}... `);
      let listData;
      try {
        listData = await fetchProductList(token, keyword, page);
      } catch (err) {
        console.log(`[ERROR] ${err.message}`);
        break;
      }

      if (!listData || !listData.list || listData.list.length === 0) {
        console.log('no results');
        break;
      }

      console.log(`${listData.list.length} products`);

      for (const product of listData.list) {
        const result = await importFromList(product, keyword);
        if (result.status === 'imported') {
          jobImported++;
          process.stdout.write('.');
        } else if (result.status === 'error') {
          jobErrors++;
          process.stdout.write('E');
        } else {
          jobSkipped++;
          process.stdout.write('s');
        }
      }
      console.log('');

      if (listData.list.length < PAGE_SIZE / 2) break;
      await sleep(300); // between pages
    }

    console.log(`  => ${keyword}: +${jobImported} imported, ${jobSkipped} skipped, ${jobErrors} errors`);
    totals[keyword] = jobImported;
    grandTotal += jobImported;
  }

  const countResult = await sql`SELECT count(*) as total FROM products`;
  const dbTotal = countResult[0]?.total ?? '?';

  console.log('\n=============================');
  console.log('IMPORT COMPLETE');
  for (const [kw, count] of Object.entries(totals)) {
    console.log(`  ${kw}: +${count}`);
  }
  console.log(`Net new products: +${grandTotal}`);
  console.log(`Total in DB: ${dbTotal}`);
  console.log('=============================');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
