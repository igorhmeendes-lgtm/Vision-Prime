const config = require('../config');
const { open } = require('../db');
const { connectionStatus } = require('../ml/auth');
const fees = require('../ml/fees');
const { buildIndex, findMatch } = require('./matcher');
const {
  computeEconomics, recommendPrice, conversionFromSnapshots, opportunityScore,
} = require('./scoring');

// Cruza cada oportunidade de mercado com o catálogo do fornecedor e calcula margem, preço e score.
async function analyzeAll() {
  const db = open();
  const userId = connectionStatus().user_id;
  const supplierProducts = db.prepare('SELECT * FROM supplier_products WHERE cost > 0').all();
  const index = buildIndex(supplierProducts);
  const bySku = new Map(supplierProducts.map((p) => [`${p.supplier_id}|${p.sku}`, p]));
  const opportunities = db.prepare('SELECT * FROM opportunities WHERE updated_at >= ?')
    .all(new Date(Date.now() - 7 * 86400000).toISOString());
  const snapsStmt = db.prepare('SELECT * FROM snapshots WHERE item_id = ?');
  const saveMatch = db.prepare(`INSERT INTO matches (item_id, supplier_id, sku, method, similarity) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET supplier_id = excluded.supplier_id, sku = excluded.sku, method = excluded.method, similarity = excluded.similarity
    WHERE matches.method != 'manual'`);
  const getMatch = db.prepare('SELECT * FROM matches WHERE item_id = ?');
  const saveAnalysis = db.prepare(`
    INSERT OR REPLACE INTO analysis (item_id, supplier_cost, sale_fee, shipping_cost, tax, net_profit, loss, net_margin_pct,
      recommended_price, conversion_pct, conversion_source, demand_score, score, viable, reasons, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  let analyzed = 0;
  for (const opp of opportunities) {
    const auto = findMatch(opp, index);
    if (auto) saveMatch.run(opp.item_id, auto.supplier_id, auto.sku, auto.method, auto.similarity);
    const match = getMatch.get(opp.item_id); // vínculo manual tem prioridade sobre o automático
    const product = match ? bySku.get(`${match.supplier_id}|${match.sku}`) : null;
    const conversion = conversionFromSnapshots(snapsStmt.all(opp.item_id));

    let economics = null;
    let recommended = 0;
    if (product) {
      const feeFn = fees.feeFnFor(opp.category_id, product, userId);
      const marketPrice = opp.min_competitor_price || opp.price; // preço que você precisa bater
      const { saleFee, shippingCost } = await feeFn(marketPrice);
      economics = computeEconomics({
        price: marketPrice, supplierCost: product.cost, saleFee, shippingCost, costs: config.costs,
      });
      recommended = await recommendPrice({
        supplierCost: product.cost, costs: config.costs, feeFn, startPrice: marketPrice,
      });
    }

    const { score, demand_score, reasons } = opportunityScore({
      opportunity: opp, economics, recommendedPrice: recommended, conversion,
    });
    saveAnalysis.run(
      opp.item_id, economics?.supplier_cost || 0, economics?.sale_fee || 0, economics?.shipping_cost || 0,
      economics?.tax || 0, economics?.net_profit || 0, economics?.loss || 0, economics?.net_margin_pct || 0,
      recommended, conversion.pct, conversion.source, demand_score, score, economics?.viable ? 1 : 0,
      JSON.stringify(reasons), new Date().toISOString(),
    );
    analyzed++;
  }
  return { analyzed, supplierProducts: supplierProducts.length };
}

module.exports = { analyzeAll };
