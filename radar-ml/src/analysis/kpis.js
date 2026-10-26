const config = require('../config');
const { open } = require('../db');
const { targetStock, round2 } = require('./scoring');

// KPIs operacionais. Sobra e falta de estoque pesam igual como erro de acuracidade.
function computeKpis() {
  const db = open();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const now = new Date().toISOString();

  // OTD (envio no prazo): despachado até o limite de despacho; vencido e não despachado conta como atraso
  const shipments = db.prepare(`SELECT DISTINCT order_id, handling_limit, date_shipped FROM orders
    WHERE status = 'paid' AND handling_limit IS NOT NULL AND date_created >= ?`).all(since);
  let onTime = 0;
  let measured = 0;
  for (const s of shipments) {
    if (s.date_shipped) { measured++; if (s.date_shipped <= s.handling_limit) onTime++; } else if (s.handling_limit < now) measured++;
  }

  // Acuracidade de SKU: anúncio com quantidade diferente do alvo (fornecedor − reserva) é erro, para mais ou para menos
  const supplierStock = new Map(db.prepare('SELECT sku, MAX(stock) AS stock FROM supplier_products GROUP BY sku').all().map((r) => [r.sku, r.stock]));
  let linked = 0; let accurate = 0; let surplus = 0; let shortage = 0;
  for (const item of db.prepare('SELECT * FROM my_items').all()) {
    const variations = JSON.parse(item.variations_json || '[]');
    const units = variations.length ? variations : [{ sku: item.sku, available_quantity: item.available_quantity }];
    for (const u of units) {
      if (!u.sku || !supplierStock.has(u.sku)) continue;
      linked++;
      const target = targetStock(supplierStock.get(u.sku), config.stock);
      if (u.available_quantity === target) accurate++;
      else if (u.available_quantity > target) surplus++;
      else shortage++;
    }
  }

  const cuts = db.prepare(`SELECT COUNT(DISTINCT order_id) AS n, COALESCE(SUM(total), 0) AS value FROM orders
    WHERE status = 'cancelled' AND date_created >= ?`).get(since);
  const sales = db.prepare(`SELECT COUNT(DISTINCT order_id) AS n, COALESCE(SUM(total), 0) AS value, COALESCE(SUM(quantity), 0) AS units
    FROM orders WHERE status = 'paid' AND date_created >= ?`).get(since);
  const funnel = db.prepare('SELECT COALESCE(SUM(visits_30d), 0) AS visits, COALESCE(SUM(sales_30d), 0) AS sales FROM my_items').get();
  const linkedStock = db.prepare(`SELECT COALESCE(SUM(sp.stock), 0) AS stock FROM supplier_products sp
    WHERE sp.sku IN (SELECT sku FROM my_items WHERE sku IS NOT NULL)`).get();
  const opp = db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(viable), 0) AS viable FROM analysis a
    JOIN opportunities o ON o.item_id = a.item_id WHERE o.updated_at >= ?`).get(new Date(Date.now() - 7 * 86400000).toISOString());

  const dailyUnits = Number(sales.units) / 30;
  return {
    otd_pct: measured ? round2((onTime / measured) * 100) : 0,
    otd_sample: measured,
    sku_accuracy_pct: linked ? round2((accurate / linked) * 100) : 0,
    sku_linked: linked,
    sku_surplus: surplus,
    sku_shortage: shortage,
    cuts_orders: Number(cuts.n) || 0,
    cuts_value: round2(cuts.value),
    cuts_rate_pct: (Number(sales.n) + Number(cuts.n)) ? round2((Number(cuts.n) / (Number(sales.n) + Number(cuts.n))) * 100) : 0,
    sales_orders: Number(sales.n) || 0,
    sales_value: round2(sales.value),
    conversion_pct: Number(funnel.visits) ? round2((Number(funnel.sales) / Number(funnel.visits)) * 100) : 0,
    // Dropshipping não tem estoque próprio: "giro" vira cobertura do estoque do fornecedor em dias de venda
    supplier_coverage_days: dailyUnits > 0 ? round2(Number(linkedStock.stock) / dailyUnits) : 0,
    opportunities_total: Number(opp.total) || 0,
    opportunities_viable: Number(opp.viable) || 0,
  };
}

module.exports = { computeKpis };
