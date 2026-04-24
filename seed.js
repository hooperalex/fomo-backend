#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: '.env.local' });

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

async function sql(strings, ...values) {
  const client = await pool.connect();
  try {
    // Build parameterized query from tagged template
    let text = '';
    const params = [];
    strings.forEach((s, i) => {
      text += s;
      if (i < values.length) {
        params.push(values[i]);
        text += `$${params.length}`;
      }
    });
    return client.query(text, params);
  } finally {
    client.release();
  }
}

async function query(text, params = []) {
  const client = await pool.connect();
  try {
    return client.query(text, params);
  } finally {
    client.release();
  }
}

// ── Products ─────────────────────────────────────────────────────────────────

const PRODUCTS = [
  {
    title: 'AirPods Pro (2nd Generation)',
    description: 'Active noise cancellation, Adaptive Transparency, Personalized Spatial Audio. Up to 30 hours battery with case. USB-C charging.',
    brand: 'Apple',
    category: 'electronics',
    subcategory: 'headphones',
    tags: ['wireless', 'noise-cancelling', 'apple', 'earbuds'],
    images: [
      'https://picsum.photos/seed/airpods-pro/600/600',
      'https://picsum.photos/seed/airpods-pro-2/600/600',
    ],
    sku: 'APPLE-APP2-001',
    retail_price: 249.00,
    floor_price: 99.00,
    condition: 'new',
    rating: 4.8,
    rating_count: 24381,
  },
  {
    title: 'PlayStation 5 Console',
    description: 'Experience lightning-fast loading with an ultra-high speed SSD, deeper immersion with haptic feedback and adaptive triggers. 4K gaming at up to 120fps.',
    brand: 'Sony',
    category: 'electronics',
    subcategory: 'gaming',
    tags: ['gaming', 'console', 'sony', '4k', 'ps5'],
    images: [
      'https://picsum.photos/seed/ps5-console/600/600',
      'https://picsum.photos/seed/ps5-console-2/600/600',
    ],
    sku: 'SONY-PS5-001',
    retail_price: 499.99,
    floor_price: 199.00,
    condition: 'new',
    rating: 4.9,
    rating_count: 58204,
  },
  {
    title: 'Nintendo Switch OLED Model',
    description: '7-inch OLED screen, enhanced audio, 64GB internal storage, wide adjustable stand. Play at home or on the go in TV, tabletop, and handheld modes.',
    brand: 'Nintendo',
    category: 'electronics',
    subcategory: 'gaming',
    tags: ['gaming', 'portable', 'nintendo', 'oled'],
    images: [
      'https://picsum.photos/seed/switch-oled/600/600',
      'https://picsum.photos/seed/switch-oled-2/600/600',
    ],
    sku: 'NINT-SWO-001',
    retail_price: 349.99,
    floor_price: 139.00,
    condition: 'new',
    rating: 4.8,
    rating_count: 31052,
  },
  {
    title: 'Apple Watch Ultra 2',
    description: '49mm titanium case with brightest Apple Watch display ever. Up to 60-hour battery life. Precision dual-frequency GPS. Water resistant to 100m.',
    brand: 'Apple',
    category: 'electronics',
    subcategory: 'wearables',
    tags: ['smartwatch', 'fitness', 'apple', 'outdoor', 'titanium'],
    images: [
      'https://picsum.photos/seed/apple-watch-ultra/600/600',
      'https://picsum.photos/seed/apple-watch-ultra-2/600/600',
    ],
    sku: 'APPLE-AWU2-001',
    retail_price: 799.00,
    floor_price: 299.00,
    condition: 'new',
    rating: 4.7,
    rating_count: 9847,
  },
  {
    title: 'Dyson V15 Detect Absolute',
    description: 'Powerful cordless vacuum with laser dust detection. HEPA filtration captures 99.97% of particles. Up to 60 min runtime. LCD screen shows real-time data.',
    brand: 'Dyson',
    category: 'home',
    subcategory: 'appliances',
    tags: ['vacuum', 'cordless', 'dyson', 'smart', 'hepa'],
    images: [
      'https://picsum.photos/seed/dyson-v15/600/600',
      'https://picsum.photos/seed/dyson-v15-2/600/600',
    ],
    sku: 'DYSO-V15-001',
    retail_price: 749.99,
    floor_price: 299.00,
    condition: 'new',
    rating: 4.6,
    rating_count: 12403,
  },
  {
    title: 'iPad Air M2',
    description: '11-inch Liquid Retina display, Apple M2 chip, 5G capable. All-day battery. Works with Apple Pencil Pro and Magic Keyboard. Available in Blue.',
    brand: 'Apple',
    category: 'electronics',
    subcategory: 'tablets',
    tags: ['tablet', 'apple', 'm2', 'ipad', '5g'],
    images: [
      'https://picsum.photos/seed/ipad-air-m2/600/600',
      'https://picsum.photos/seed/ipad-air-m2-2/600/600',
    ],
    sku: 'APPLE-IPA-M2-001',
    retail_price: 599.00,
    floor_price: 239.00,
    condition: 'new',
    rating: 4.8,
    rating_count: 7621,
  },
  {
    title: 'Sony WH-1000XM5 Headphones',
    description: 'Industry-leading noise cancelling with Dual Noise Sensor technology. Up to 30-hour battery. Crystal-clear hands-free calling. Multi-device pairing.',
    brand: 'Sony',
    category: 'electronics',
    subcategory: 'headphones',
    tags: ['headphones', 'wireless', 'noise-cancelling', 'sony', 'over-ear'],
    images: [
      'https://picsum.photos/seed/sony-xm5/600/600',
      'https://picsum.photos/seed/sony-xm5-2/600/600',
    ],
    sku: 'SONY-XM5-001',
    retail_price: 349.99,
    floor_price: 139.00,
    condition: 'new',
    rating: 4.7,
    rating_count: 43219,
  },
  {
    title: 'Stanley Quencher H2.0 FlowState Tumbler 40oz',
    description: 'The iconic tumbler that keeps drinks cold for 2 days, iced for 3 days. Dishwasher safe. Fits most cup holders. Rotating lid with straw.',
    brand: 'Stanley',
    category: 'lifestyle',
    subcategory: 'drinkware',
    tags: ['tumbler', 'hydration', 'stanley', 'insulated', 'trendy'],
    images: [
      'https://picsum.photos/seed/stanley-quencher/600/600',
      'https://picsum.photos/seed/stanley-quencher-2/600/600',
    ],
    sku: 'STAN-QH2-40-001',
    retail_price: 45.00,
    floor_price: 18.00,
    condition: 'new',
    rating: 4.8,
    rating_count: 98034,
  },
];

// ── Bot users ─────────────────────────────────────────────────────────────────

const BOT_USERS = [
  { email: 'dealhunter99@fomo.live', name: 'DealHunter_99' },
  { email: 'bargainbotx@fomo.live', name: 'BargainBot_X' },
  { email: 'sniperbot7@fomo.live', name: 'SniperBot_7' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function minutesFromNow(m) {
  return new Date(Date.now() + m * 60 * 1000);
}

function minutesAgo(m) {
  return new Date(Date.now() - m * 60 * 1000);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('🌱 Seeding FOMO database...\n');

  // ── 1. Insert products ──────────────────────────────────────────────────────
  console.log('📦 Inserting products...');
  const productIds = {};

  for (const p of PRODUCTS) {
    const { rows } = await query(
      `INSERT INTO products
         (title, description, brand, category, subcategory, tags, images,
          sku, retail_price, floor_price, condition, rating, rating_count,
          stock_status, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'in_stock',true)
       ON CONFLICT (sku) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         retail_price = EXCLUDED.retail_price,
         floor_price = EXCLUDED.floor_price,
         is_active = true
       RETURNING id, title`,
      [
        p.title, p.description, p.brand, p.category, p.subcategory,
        p.tags, p.images, p.sku, p.retail_price, p.floor_price,
        p.condition, p.rating, p.rating_count,
      ],
    );
    productIds[p.sku] = rows[0].id;
    console.log(`  ✓ ${rows[0].title} (${rows[0].id})`);
  }

  // ── 2. Insert bot users ─────────────────────────────────────────────────────
  console.log('\n🤖 Inserting bot users...');
  const botIds = [];

  for (const b of BOT_USERS) {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, status, is_admin)
       VALUES ($1, $2, 'active', false)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id, email`,
      [b.email, '$2b$10$placeholder.bot.hash.not.for.login.xxxxxxxxxxxxxxxxxxx'],
    );
    botIds.push(rows[0].id);
    console.log(`  ✓ ${b.name} (${rows[0].id})`);
  }

  // ── 3. Active auctions ──────────────────────────────────────────────────────
  console.log('\n🔴 Creating active auctions...');

  const activeAuctions = [
    {
      sku: 'APPLE-APP2-001',    // AirPods Pro 2 — ends in 28 min
      start_price: 199.00,
      floor_price: 99.00,
      duration_seconds: 30 * 60, // 30 min
      starts_at: minutesAgo(2),
      ends_at: minutesFromNow(28),
      status: 'live',
    },
    {
      sku: 'SONY-PS5-001',      // PS5 — ends in 118 min
      start_price: 399.99,
      floor_price: 199.00,
      duration_seconds: 120 * 60,
      starts_at: minutesAgo(2),
      ends_at: minutesFromNow(118),
      status: 'live',
    },
    {
      sku: 'NINT-SWO-001',      // Switch OLED — ends in ~6 hours
      start_price: 279.99,
      floor_price: 139.00,
      duration_seconds: 360 * 60,
      starts_at: minutesAgo(2),
      ends_at: minutesFromNow(358),
      status: 'live',
    },
    {
      sku: 'SONY-XM5-001',      // Sony headphones — scheduled in 10 min
      start_price: 279.99,
      floor_price: 139.00,
      duration_seconds: 60 * 60,
      starts_at: minutesFromNow(10),
      ends_at: minutesFromNow(70),
      status: 'scheduled',
    },
    {
      sku: 'APPLE-AWU2-001',    // Apple Watch Ultra 2 — scheduled in 30 min
      start_price: 639.00,
      floor_price: 299.00,
      duration_seconds: 90 * 60,
      starts_at: minutesFromNow(30),
      ends_at: minutesFromNow(120),
      status: 'scheduled',
    },
  ];

  for (const a of activeAuctions) {
    const productId = productIds[a.sku];
    const { rows } = await query(
      `INSERT INTO auctions
         (product_id, start_price, floor_price, duration_seconds, jitter_seconds,
          status, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,5,$5,$6,$7)
       RETURNING id, status`,
      [productId, a.start_price, a.floor_price, a.duration_seconds,
       a.status, a.starts_at, a.ends_at],
    );
    const label = PRODUCTS.find(p => p.sku === a.sku).title;
    console.log(`  ✓ [${a.status}] ${label} → ends ${a.ends_at.toISOString()}`);
  }

  // ── 4. Completed auctions ───────────────────────────────────────────────────
  console.log('\n✅ Creating completed (sold) auctions...');

  // Need a real buyer — create a demo user
  const { rows: [buyer] } = await query(
    `INSERT INTO users (email, password_hash, status, is_admin)
     VALUES ('demo@fomo.live', '$2b$10$placeholder.demo.hash.not.for.login.xxxxxxxxx', 'active', false)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [],
  );
  const buyerId = buyer.id;

  const soldAuctions = [
    {
      sku: 'APPLE-IPA-M2-001',
      start_price: 479.00,
      floor_price: 239.00,
      duration_seconds: 45 * 60,
      starts_at: minutesAgo(120),
      ends_at: minutesAgo(75),
      status: 'sold',
      winning_amount: 312.50,
    },
    {
      sku: 'DYSO-V15-001',
      start_price: 599.99,
      floor_price: 299.00,
      duration_seconds: 60 * 60,
      starts_at: minutesAgo(200),
      ends_at: minutesAgo(140),
      status: 'sold',
      winning_amount: 449.99,
    },
    {
      sku: 'STAN-QH2-40-001',
      start_price: 36.00,
      floor_price: 18.00,
      duration_seconds: 20 * 60,
      starts_at: minutesAgo(60),
      ends_at: minutesAgo(40),
      status: 'sold',
      winning_amount: 27.00,
    },
  ];

  for (const a of soldAuctions) {
    const productId = productIds[a.sku];

    // Create auction first (no winning_bid_id yet)
    const { rows: [auction] } = await query(
      `INSERT INTO auctions
         (product_id, start_price, floor_price, duration_seconds, jitter_seconds,
          status, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,3,$5,$6,$7)
       RETURNING id`,
      [productId, a.start_price, a.floor_price, a.duration_seconds,
       a.status, a.starts_at, a.ends_at],
    );

    // Create winning bid
    const idempotencyKey = `seed-win-${auction.id}`;
    const { rows: [bid] } = await query(
      `INSERT INTO bids
         (auction_id, user_id, actor, amount, idempotency_key, status)
       VALUES ($1,$2,'human',$3,$4,'accepted')
       RETURNING id`,
      [auction.id, buyerId, a.winning_amount, idempotencyKey],
    );

    // Link winning bid back to auction
    await query(
      `UPDATE auctions SET winning_bid_id = $1 WHERE id = $2`,
      [bid.id, auction.id],
    );

    // Add some losing bids from bots
    for (let i = 0; i < botIds.length; i++) {
      const loseKey = `seed-lose-${auction.id}-bot${i}`;
      await query(
        `INSERT INTO bids (auction_id, user_id, actor, amount, idempotency_key, status)
         VALUES ($1,$2,'agent',$3,$4,'expired')`,
        [auction.id, botIds[i], a.winning_amount - 5 - i * 2, loseKey],
      );
    }

    const label = PRODUCTS.find(p => p.sku === a.sku).title;
    console.log(`  ✓ [sold] ${label} → won at $${a.winning_amount}`);
  }

  console.log('\n✅ Seed complete!\n');
  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
