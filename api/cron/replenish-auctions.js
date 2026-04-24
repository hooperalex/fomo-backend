const { sql } = require('../../lib/db');

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

// Rotating category keywords for variety
const CJ_KEYWORDS = [
  'smartwatch',
  'bluetooth speaker',
  'wireless headphones',
  'fitness tracker',
  'action camera',
  'gaming controller',
  'led strip lights',
  'smart home',
  'phone accessories',
  'wireless earbuds',
  'portable charger',
  'dash cam',
  'drone',
  'electric toothbrush',
  'mini projector',
];

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

const MIN_ACTIVE_AUCTIONS = 15;
const TARGET_ACTIVE_AUCTIONS = 20;
const MIN_PRODUCT_POOL = 50;
const CJ_BATCH_SIZE = 30; // products per CJ import run

function mapCategory(name) {
  if (!name) return 'phones_and_accessories';
  if (CATEGORY_MAP[name]) return CATEGORY_MAP[name];
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (name.includes(key) || key.includes(name)) return val;
  }
  return 'phones_and_accessories';
}

function parseImages(productImage) {
  if (!productImage) return [];
  if (Array.isArray(productImage)) return productImage.slice(0, 6);
  try {
    const parsed = JSON.parse(productImage);
    return Array.isArray(parsed) ? parsed.slice(0, 6) : [productImage];
  } catch {
    return [productImage];
  }
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function getCJToken(email, apiKey) {
  const res = await fetch(`${CJ_BASE}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: apiKey }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`CJ auth failed: ${data.message}`);
  return data.data.accessToken;
}

async function batchImportFromCJ(email, apiKey, targetCount) {
  const token = await getCJToken(email, apiKey);

  // Pick a random keyword to rotate variety
  const keyword = CJ_KEYWORDS[Math.floor(Math.random() * CJ_KEYWORDS.length)];

  const params = new URLSearchParams({ pageNum: 1, pageSize: CJ_BATCH_SIZE, productNameEn: keyword });
  const listRes = await fetch(`${CJ_BASE}/product/list?${params}`, {
    headers: { 'CJ-Access-Token': token },
  });
  const listData = await listRes.json();
  if (!listData.success || !listData.data?.list?.length) {
    return { imported: 0, keyword };
  }

  const candidates = listData.data.list.filter(p => {
    const price = parseFloat(String(p.sellPrice || '0').split('--')[0].trim());
    return price >= 10 && price <= 200;
  });

  let imported = 0;
  for (const candidate of candidates.slice(0, targetCount)) {
    try {
      const detailRes = await fetch(`${CJ_BASE}/product/query?pid=${candidate.pid}`, {
        headers: { 'CJ-Access-Token': token },
      });
      const detailData = await detailRes.json();
      if (!detailData.success) continue;
      const detail = detailData.data;

      const images = parseImages(detail.productImage);
      if (!images.length) continue;

      const cjPrice = parseFloat(detail.sellPrice) || 0;
      const variant = (detail.variants || [])[0] || {};
      const suggestedRetail = parseFloat(variant.variantSugSellPrice || 0);
      const retailPrice = suggestedRetail > 0
        ? Math.min(suggestedRetail, cjPrice * 4)
        : cjPrice * 2.5;
      const floorPrice = Math.max(cjPrice * 1.1, retailPrice * 0.3);

      if (floorPrice >= retailPrice || retailPrice < 15) continue;

      const sku = variant.variantSku || detail.productSku;
      const description = stripHtml(detail.description).slice(0, 2000);
      const category = mapCategory(detail.categoryName);

      // Build tags from category name and product title keywords
      const titleWords = (detail.productNameEn || '').toLowerCase()
        .split(/\W+/).filter(w => w.length > 3 && w.length < 20);
      const categoryTag = (detail.categoryName || '').toLowerCase().replace(/\s+/g, '_');
      const tags = [...new Set([categoryTag, category, ...titleWords.slice(0, 8)])].filter(Boolean);

      // CJ product rating (productEvaluation or similar field)
      const rating = parseFloat(detail.productEvaluation || detail.rating || 0) || null;
      const ratingCount = parseInt(detail.evaluationCount || detail.ratingCount || 0) || null;

      // Warehouse/shipping origin
      const warehouseLocation = detail.warehouseCountry || detail.warehouseCode || null;
      const cjCategoryId = String(detail.categoryId || '').trim() || null;

      const { rows } = await sql`
        INSERT INTO products (
          title, description, brand, category, subcategory,
          tags, condition, images, sku, retail_price, floor_price,
          rating, rating_count, is_active, used_in_auction,
          warehouse_location, cj_category_id
        ) VALUES (
          ${detail.productNameEn.slice(0, 255)},
          ${description || null},
          ${null},
          ${category},
          ${detail.categoryName || null},
          ${tags},
          'new',
          ${images},
          ${sku},
          ${Math.round(retailPrice * 100) / 100},
          ${Math.round(floorPrice * 100) / 100},
          ${rating},
          ${ratingCount},
          true,
          false,
          ${warehouseLocation},
          ${cjCategoryId}
        )
        ON CONFLICT (sku) DO NOTHING
        RETURNING id
      `;
      if (rows.length > 0) imported++;
    } catch {
      // Skip individual product errors
    }
  }

  return { imported, keyword };
}

// Auction durations staggered so they don't all expire simultaneously
const DURATIONS_HOURS = [12, 14, 16, 18, 20, 22, 24];

function pickDuration(index) {
  return DURATIONS_HOURS[index % DURATIONS_HOURS.length] * 3600;
}

// POST /api/cron/replenish-auctions (called by Vercel cron, secured by CRON_SECRET)
module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Vercel cron authenticates via Authorization header
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const email = process.env.CJ_EMAIL;
  const apiKey = process.env.CJ_API_KEY;

  const report = {
    activeAuctions: 0,
    auctionsCreated: 0,
    productPoolSize: 0,
    cjImport: null,
  };

  try {
    // 1. Count currently active auctions (live or scheduled with future ends_at)
    const { rows: activeRows } = await sql`
      SELECT COUNT(*) AS count FROM auctions
      WHERE status IN ('live', 'scheduled') AND ends_at > NOW()
    `;
    report.activeAuctions = parseInt(activeRows[0].count);

    // 2. Count unused product pool
    const { rows: poolRows } = await sql`
      SELECT COUNT(*) AS count FROM products WHERE is_active = true AND used_in_auction = false
    `;
    report.productPoolSize = parseInt(poolRows[0].count);

    // 3. Batch import from CJ if pool is running low
    if (report.productPoolSize < MIN_PRODUCT_POOL && email && apiKey) {
      const needed = MIN_PRODUCT_POOL - report.productPoolSize + 20; // import a bit extra
      try {
        report.cjImport = await batchImportFromCJ(email, apiKey, Math.min(needed, CJ_BATCH_SIZE));
        // Refresh pool count
        const { rows: refreshed } = await sql`
          SELECT COUNT(*) AS count FROM products WHERE is_active = true AND used_in_auction = false
        `;
        report.productPoolSize = parseInt(refreshed[0].count);
      } catch (err) {
        report.cjImport = { error: err.message };
      }
    }

    // 4. Create auctions if below threshold
    if (report.activeAuctions < MIN_ACTIVE_AUCTIONS) {
      const needed = TARGET_ACTIVE_AUCTIONS - report.activeAuctions;

      // Pick unused products (exclude products already in active auctions)
      const { rows: products } = await sql`
        SELECT id, retail_price, floor_price FROM products
        WHERE is_active = true AND used_in_auction = false
        AND id NOT IN (
          SELECT product_id FROM auctions WHERE status IN ('live', 'scheduled') AND ends_at > NOW()
        )
        ORDER BY RANDOM()
        LIMIT ${needed}
      `;

      let created = 0;
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const retailPrice = parseFloat(p.retail_price);
        const floorPrice = parseFloat(p.floor_price);
        const startPrice = Math.round(retailPrice * 0.85 * 100) / 100;
        const durationSeconds = pickDuration(report.activeAuctions + i);
        // Stagger start times slightly so not all start at the exact same moment
        const staggerMinutes = i * 2;

        await sql`
          INSERT INTO auctions (
            product_id, start_price, floor_price, duration_seconds, jitter_seconds,
            status, starts_at, ends_at, created_at, updated_at
          ) VALUES (
            ${p.id},
            ${startPrice},
            ${floorPrice},
            ${durationSeconds},
            300,
            'live',
            NOW() + ${`${staggerMinutes} minutes`}::interval,
            NOW() + ${`${staggerMinutes} minutes`}::interval + ${`${durationSeconds} seconds`}::interval,
            NOW(),
            NOW()
          )
        `;

        // Mark product as used
        await sql`UPDATE products SET used_in_auction = true WHERE id = ${p.id}`;
        created++;
      }

      report.auctionsCreated = created;
    }

    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    console.error('replenish-auctions error:', err);
    return res.status(500).json({ error: err.message, ...report });
  }
};
