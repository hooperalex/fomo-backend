const { sql } = require('../../lib/db');
const { verifyToken } = require('../../lib/auth');
const { setCors, handleOptions } = require('../../lib/cors');

const CJ_BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

// Maps CJ category names to FOMO categories
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

async function fetchCJProducts(token, { categoryId, keyword, pageNum = 1, pageSize = 20 }) {
  const params = new URLSearchParams({ pageNum, pageSize });
  if (categoryId) params.set('categoryId', categoryId);
  if (keyword) params.set('productNameEn', keyword);

  const res = await fetch(`${CJ_BASE}/product/list?${params}`, {
    headers: { 'CJ-Access-Token': token },
  });
  const data = await res.json();
  return data.success ? data.data : null;
}

async function fetchCJProductDetail(token, pid) {
  const res = await fetch(`${CJ_BASE}/product/query?pid=${pid}`, {
    headers: { 'CJ-Access-Token': token },
  });
  const data = await res.json();
  return data.success ? data.data : null;
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

function mapCategory(cjCategoryName) {
  if (!cjCategoryName) return DEFAULT_CATEGORY;
  // Try exact match first
  if (CATEGORY_MAP[cjCategoryName]) return CATEGORY_MAP[cjCategoryName];
  // Try partial match
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (cjCategoryName.includes(key) || key.includes(cjCategoryName)) return val;
  }
  return DEFAULT_CATEGORY;
}

// POST /api/admin/import-cj
// Body: { categoryId?, keyword?, pageNum?, pageSize?, minPrice?, maxPrice?, createAuctions? }
module.exports = async function handler(req, res) {
  setCors(res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let user_id;
  try {
    user_id = verifyToken(req);
  } catch {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userCheck = await sql`SELECT is_admin FROM users WHERE id = ${user_id}`;
  if (!userCheck.rows[0]?.is_admin) return res.status(403).json({ error: 'Admin access required' });

  const {
    categoryId,
    keyword,
    pageNum = 1,
    pageSize = 10,
    minPrice = 10,
    maxPrice = 500,
    createAuctions = false,
  } = req.body || {};

  const email = process.env.CJ_EMAIL;
  const apiKey = process.env.CJ_API_KEY;
  if (!email || !apiKey) {
    return res.status(500).json({ error: 'CJ_EMAIL and CJ_API_KEY env vars not configured' });
  }

  try {
    const token = await getCJToken(email, apiKey);

    const listData = await fetchCJProducts(token, { categoryId, keyword, pageNum, pageSize });
    if (!listData) return res.status(502).json({ error: 'Failed to fetch CJ product list' });

    const candidates = listData.list.filter(p => {
      try {
        const price = parseFloat(String(p.sellPrice).split('--')[0].trim());
        return price >= minPrice && price <= maxPrice;
      } catch {
        return false;
      }
    });

    const imported = [];
    const skipped = [];
    const errors = [];

    for (const candidate of candidates) {
      const detail = await fetchCJProductDetail(token, candidate.pid);
      if (!detail) {
        skipped.push({ pid: candidate.pid, reason: 'no detail' });
        continue;
      }

      const images = parseImages(detail.productImage);
      if (images.length === 0) {
        skipped.push({ pid: detail.pid, reason: 'no images' });
        continue;
      }

      const cjPrice = parseFloat(detail.sellPrice) || 0;
      const variant = (detail.variants || [])[0] || {};
      const suggestedRetail = parseFloat(variant.variantSugSellPrice || 0);
      // Use suggested retail if available, else 3x CJ price; cap retail markup
      const retailPrice = suggestedRetail > 0
        ? Math.min(suggestedRetail, cjPrice * 4)
        : cjPrice * 2.5;
      const floorPrice = Math.max(cjPrice * 1.1, retailPrice * 0.3);

      if (floorPrice >= retailPrice) {
        skipped.push({ pid: detail.pid, reason: 'price calculation invalid' });
        continue;
      }

      const category = mapCategory(detail.categoryName);
      const description = stripHtml(detail.description).slice(0, 2000);
      const sku = variant.variantSku || detail.productSku;

      try {
        const { rows } = await sql`
          INSERT INTO products (
            title, description, brand, category, subcategory,
            tags, condition, images, sku, retail_price, floor_price
          ) VALUES (
            ${detail.productNameEn.slice(0, 255)},
            ${description || null},
            ${null},
            ${category},
            ${detail.categoryName || null},
            ${[]},
            'new',
            ${images},
            ${sku},
            ${Math.round(retailPrice * 100) / 100},
            ${Math.round(floorPrice * 100) / 100}
          )
          ON CONFLICT (sku) DO NOTHING
          RETURNING id, title, sku, retail_price, floor_price, category
        `;

        if (rows.length === 0) {
          skipped.push({ pid: detail.pid, sku, reason: 'SKU already exists' });
          continue;
        }

        const product = rows[0];
        imported.push(product);

        if (createAuctions) {
          const startPrice = Math.round(retailPrice * 0.82 * 100) / 100;
          await sql`
            INSERT INTO auctions (
              product_id, start_price, floor_price, duration_seconds, jitter_seconds,
              status, starts_at, ends_at
            ) VALUES (
              ${product.id},
              ${startPrice},
              ${Math.round(floorPrice * 100) / 100},
              60,
              5,
              'scheduled',
              NOW() + INTERVAL '10 minutes',
              NOW() + INTERVAL '11 minutes'
            )
          `;
        }
      } catch (err) {
        errors.push({ pid: detail.pid, error: err.message });
      }
    }

    return res.status(200).json({
      total_candidates: candidates.length,
      imported: imported.length,
      skipped: skipped.length,
      errors: errors.length,
      products: imported,
      skipped_details: skipped,
      error_details: errors,
    });
  } catch (err) {
    console.error('import-cj error:', err);
    return res.status(500).json({ error: err.message });
  }
};
