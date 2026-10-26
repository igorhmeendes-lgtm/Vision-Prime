const ml = require('./client');
const config = require('../config');
const { open, setSetting } = require('../db');

// Coleta de mercado: "Mais vendidos" por categoria (/highlights) + visitas + tendências de busca.

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
const attr = (attributes, id) => (attributes || []).find((a) => a.id === id)?.value_name || null;

async function resolveHighlight(entry) {
  if (entry.type === 'ITEM') return { item_id: entry.id, product_id: null };
  if (entry.type !== 'PRODUCT') return null; // USER_PRODUCT e outros tipos: ignorados

  const product = await ml.tryGet(`/products/${entry.id}`);
  if (!product) return null;
  const offers = await ml.tryGet(`/products/${entry.id}/items`);
  const prices = (offers?.results || []).map((o) => Number(o.price)).filter((p) => p > 0);
  const itemId = product.buy_box_winner?.item_id || offers?.results?.[0]?.item_id;
  if (!itemId) return null;
  return {
    item_id: itemId,
    product_id: entry.id,
    gtin: attr(product.attributes, 'GTIN'),
    sellers_count: offers?.results?.length || 1,
    min_competitor_price: prices.length ? Math.min(...prices) : 0,
  };
}

async function researchCategory(categoryId) {
  const category = await ml.tryGet(`/categories/${categoryId}`);
  const highlights = await ml.get(`/highlights/${config.ml.siteId}/category/${categoryId}`);
  const entries = highlights?.content || [];

  const resolved = [];
  for (const entry of entries) {
    const r = await resolveHighlight(entry);
    if (r) resolved.push({ ...r, highlight_position: entry.position, highlight_total: entries.length });
  }

  const byId = new Map(resolved.map((r) => [r.item_id, r]));
  const fields = 'id,title,price,category_id,permalink,thumbnail,listing_type_id,sold_quantity,attributes,catalog_product_id';
  for (const ids of chunk([...byId.keys()], 20)) {
    const items = await ml.get(`/items?ids=${ids.join(',')}&attributes=${fields}`);
    for (const { code, body } of items || []) {
      if (code !== 200 || !body) continue;
      Object.assign(byId.get(body.id), {
        title: body.title,
        price: Number(body.price) || 0,
        permalink: body.permalink,
        thumbnail: body.thumbnail,
        listing_type_id: body.listing_type_id,
        sold_quantity: Number.isFinite(body.sold_quantity) ? body.sold_quantity : null,
        gtin: byId.get(body.id).gtin || attr(body.attributes, 'GTIN'),
        product_id: byId.get(body.id).product_id || body.catalog_product_id || null,
      });
    }
  }

  // Visitas: total histórico (para Δ de conversão) + últimos 30 dias (tração atual)
  for (const ids of chunk([...byId.keys()], 50)) {
    const totals = (await ml.tryGet(`/visits/items?ids=${ids.join(',')}`)) || {};
    for (const id of ids) byId.get(id).visits_total = Number(totals[id]) || 0;
  }
  for (const r of byId.values()) {
    const tw = await ml.tryGet(`/items/${r.item_id}/visits/time_window?last=30&unit=day`);
    r.visits_30d = Number(tw?.total_visits) || 0;
  }

  const trends = await ml.tryGet(`/trends/${config.ml.siteId}/${categoryId}`);
  if (Array.isArray(trends)) setSetting(`trends:${categoryId}`, trends.slice(0, 20).map((t) => t.keyword));

  persist(categoryId, category?.name || categoryId, [...byId.values()].filter((r) => r.title));
  return byId.size;
}

function persist(categoryId, categoryName, rows) {
  const db = open();
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO opportunities (item_id, product_id, category_id, category_name, title, price, permalink, thumbnail, gtin,
      listing_type_id, highlight_position, highlight_total, sellers_count, min_competitor_price, visits_30d, sold_quantity, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      product_id = excluded.product_id, category_id = excluded.category_id, category_name = excluded.category_name,
      title = excluded.title, price = excluded.price, permalink = excluded.permalink, thumbnail = excluded.thumbnail,
      gtin = excluded.gtin, listing_type_id = excluded.listing_type_id, highlight_position = excluded.highlight_position,
      highlight_total = excluded.highlight_total, sellers_count = excluded.sellers_count,
      min_competitor_price = excluded.min_competitor_price, visits_30d = excluded.visits_30d,
      sold_quantity = excluded.sold_quantity, updated_at = excluded.updated_at`);
  const snap = db.prepare(`INSERT OR REPLACE INTO snapshots (item_id, ts, visits_30d, visits_total, sold_quantity) VALUES (?, ?, ?, ?, ?)`);
  for (const r of rows) {
    upsert.run(r.item_id, r.product_id, categoryId, categoryName, r.title, r.price, r.permalink, r.thumbnail, r.gtin || null,
      r.listing_type_id || null, r.highlight_position || null, r.highlight_total || null, r.sellers_count || 1,
      r.min_competitor_price || 0, r.visits_30d || 0, r.sold_quantity, now);
    snap.run(r.item_id, now, r.visits_30d || 0, r.visits_total || 0, r.sold_quantity);
  }
}

async function researchAll(categories = config.research.categories) {
  const summary = [];
  for (const cat of categories) {
    try {
      summary.push({ category: cat, items: await researchCategory(cat) });
    } catch (err) {
      summary.push({ category: cat, items: 0, error: err.message });
    }
  }
  return summary;
}

module.exports = { researchAll, researchCategory };
