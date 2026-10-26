const ml = require('./client');
const config = require('../config');
const { open } = require('../db');
const { connectionStatus } = require('./auth');
const { conversionPct, targetStock } = require('../analysis/scoring');

// Sua conta de vendedor: anúncios, pedidos (roteados ao fornecedor), conversão real e estoque.

const chunk = (arr, size) => Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
const skuOf = (obj) => obj?.seller_custom_field || (obj?.attributes || []).find((a) => a.id === 'SELLER_SKU')?.value_name || null;
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const iso = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);
const userId = () => {
  const id = connectionStatus().user_id;
  if (!id) throw new Error('Mercado Livre não conectado');
  return id;
};

async function syncMyItems() {
  const uid = userId();
  const ids = [];
  for (let offset = 0; ; offset += 100) {
    const page = await ml.get(`/users/${uid}/items/search?status=active&limit=100&offset=${offset}`);
    ids.push(...(page?.results || []));
    if (!page?.results?.length || offset + 100 >= (page.paging?.total || 0) || offset >= 900) break;
  }

  const db = open();
  const sales = new Map(db.prepare(`
    SELECT item_id, SUM(quantity) AS qty FROM orders
    WHERE status = 'paid' AND date_created >= ? GROUP BY item_id`).all(daysAgo(30))
    .map((r) => [r.item_id, r.qty]));
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO my_items (item_id, title, price, available_quantity, status, sku, permalink, thumbnail,
      visits_30d, sales_30d, conversion_pct, variations_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();

  for (const group of chunk(ids, 20)) {
    const items = await ml.get(`/items?ids=${group.join(',')}`);
    for (const { code, body } of items || []) {
      if (code !== 200 || !body) continue;
      const tw = await ml.tryGet(`/items/${body.id}/visits/time_window?last=30&unit=day`);
      const visits = Number(tw?.total_visits) || 0;
      const sold = Number(sales.get(body.id)) || 0;
      const variations = (body.variations || []).map((v) => ({
        id: String(v.id), sku: skuOf(v), available_quantity: Number(v.available_quantity) || 0,
      }));
      upsert.run(body.id, body.title, Number(body.price) || 0, Number(body.available_quantity) || 0, body.status,
        skuOf(body), body.permalink, body.thumbnail, visits, sold, conversionPct(sold, visits),
        JSON.stringify(variations), now);
    }
  }
  db.prepare('DELETE FROM my_items WHERE updated_at < ?').run(now); // remove anúncios que saíram de "ativos"
  return { items: ids.length };
}

async function upsertOrder(order) {
  const db = open();
  let shipment = null;
  if (order.shipping?.id) shipment = await ml.tryGet(`/shipments/${order.shipping.id}`);
  const handlingLimit = shipment?.lead_time?.estimated_handling_limit?.date
    || shipment?.shipping_option?.estimated_handling_limit?.date || null;
  const stmt = db.prepare(`
    INSERT INTO orders (order_id, item_id, sku, title, quantity, unit_price, total, status, cancel_reason, date_created,
      shipment_id, shipment_status, handling_limit, date_shipped, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id, item_id) DO UPDATE SET status = excluded.status, cancel_reason = excluded.cancel_reason,
      shipment_status = excluded.shipment_status, handling_limit = excluded.handling_limit,
      date_shipped = excluded.date_shipped, updated_at = excluded.updated_at`);
  for (const oi of order.order_items || []) {
    const qty = Number(oi.quantity) || 0;
    const unit = Number(oi.unit_price) || 0;
    stmt.run(String(order.id), oi.item?.id, oi.item?.seller_sku || null, oi.item?.title || '', qty, unit, qty * unit,
      order.status, order.cancel_detail?.description || null, iso(order.date_created), order.shipping?.id ? String(order.shipping.id) : null,
      shipment?.status || null, iso(handlingLimit), iso(shipment?.status_history?.date_shipped), new Date().toISOString());
  }
}

async function syncOrders(days = 30) {
  const uid = userId();
  const from = daysAgo(days);
  let count = 0;
  for (let offset = 0; offset < 2000; offset += 50) {
    const qs = new URLSearchParams({ seller: uid, 'order.date_created.from': from, sort: 'date_desc', offset, limit: 50 });
    const page = await ml.get(`/orders/search?${qs}`);
    for (const order of page?.results || []) { await upsertOrder(order); count++; }
    if (!page?.results?.length || offset + 50 >= (page.paging?.total || 0)) break;
  }
  return { orders: count };
}

// Webhook de notificações do ML (tópicos orders_v2 e shipments)
async function handleNotification({ topic, resource }) {
  if (topic === 'orders_v2' && resource?.startsWith('/orders/')) {
    const order = await ml.get(resource);
    await upsertOrder(order);
  } else if (topic === 'shipments' && resource?.startsWith('/shipments/')) {
    const shipment = await ml.get(resource);
    if (shipment?.order_id) await upsertOrder(await ml.get(`/orders/${shipment.order_id}`));
  }
}

/**
 * Estoque do ML = estoque do fornecedor − reserva de segurança (teto configurável).
 * SKU do anúncio (SELLER_SKU) deve ser igual ao SKU do fornecedor.
 * AUTO_SYNC_STOCK=0 apenas registra o que seria alterado.
 */
async function syncStock({ apply = config.stock.autoSync } = {}) {
  const db = open();
  const supplierStock = new Map(db.prepare('SELECT sku, MAX(stock) AS stock FROM supplier_products GROUP BY sku').all()
    .map((r) => [r.sku, r.stock]));
  const log = db.prepare(`INSERT INTO stock_sync_log (ts, item_id, variation_id, sku, ml_qty, target_qty, applied, message)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const now = new Date().toISOString();
  const result = { checked: 0, divergent: 0, applied: 0, errors: 0 };

  for (const item of db.prepare('SELECT * FROM my_items').all()) {
    const variations = JSON.parse(item.variations_json || '[]');
    const units = variations.length
      ? variations.map((v) => ({ variation_id: v.id, sku: v.sku, ml_qty: v.available_quantity }))
      : [{ variation_id: null, sku: item.sku, ml_qty: item.available_quantity }];
    const changes = [];
    for (const u of units) {
      if (!u.sku || !supplierStock.has(u.sku)) continue;
      result.checked++;
      const target = targetStock(supplierStock.get(u.sku), config.stock);
      if (target === u.ml_qty) continue;
      result.divergent++;
      changes.push({ ...u, target });
    }
    if (!changes.length) continue;

    let applied = 0;
    let message = apply ? 'aplicado' : 'simulação (AUTO_SYNC_STOCK=0)';
    if (apply) {
      try {
        if (variations.length) {
          // O ML exige o envio de todas as variações; as omitidas seriam removidas
          const targets = new Map(changes.map((c) => [c.variation_id, c.target]));
          await ml.put(`/items/${item.item_id}`, {
            variations: variations.map((v) => ({ id: Number(v.id), available_quantity: targets.get(v.id) ?? v.available_quantity })),
          });
        } else {
          await ml.put(`/items/${item.item_id}`, { available_quantity: changes[0].target });
        }
        applied = 1;
        result.applied += changes.length;
      } catch (err) {
        message = `erro: ${err.message}`;
        result.errors++;
      }
    }
    for (const c of changes) log.run(now, item.item_id, c.variation_id, c.sku, c.ml_qty, c.target, applied, message);
  }
  return result;
}

async function shipmentLabel(shipmentId) {
  return ml.raw(`/shipment_labels?shipment_ids=${encodeURIComponent(shipmentId)}&response_type=pdf`);
}

module.exports = { syncMyItems, syncOrders, syncStock, handleNotification, shipmentLabel, upsertOrder };
