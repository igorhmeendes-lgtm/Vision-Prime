// Regras de negócio puras (sem I/O) — testadas em test/scoring.test.js.
// Convenção: valores nulos/inválidos viram 0; prejuízo é reportado em campo próprio (loss), nunca como lucro negativo.

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (v) => Math.round(n(v) * 100) / 100;
const clamp01 = (v) => Math.min(1, Math.max(0, n(v)));

/**
 * Economia unitária de uma venda.
 * saleFee: tarifa de venda do ML (percentual + tarifa fixa), vinda de /listing_prices.
 * shippingCost: parte do frete paga pelo vendedor (frete grátis obrigatório a partir do limite do ML).
 */
function computeEconomics({ price, supplierCost, saleFee, shippingCost, costs }) {
  const p = n(price);
  const tax = p * n(costs.taxRate);
  const reserve = p * n(costs.returnReserveRate);
  const totalCost =
    n(supplierCost) + n(saleFee) + n(shippingCost) + tax + reserve +
    n(costs.supplierFeePerOrder) + n(costs.packagingCost);
  const result = p - totalCost;
  const marginPct = p > 0 ? result / p : 0;
  return {
    price: round2(p),
    supplier_cost: round2(supplierCost),
    sale_fee: round2(saleFee),
    shipping_cost: round2(shippingCost),
    tax: round2(tax),
    reserve: round2(reserve),
    net_profit: round2(Math.max(0, result)),
    loss: round2(Math.max(0, -result)),
    net_margin_pct: round2(Math.max(0, marginPct) * 100),
    viable: p > 0 && n(supplierCost) > 0 && marginPct >= n(costs.targetMargin),
  };
}

/**
 * Menor preço que atinge a margem-alvo. feeFn(price) => { saleFee, shippingCost } consulta a API,
 * pois a tarifa fixa e o frete grátis mudam por faixa de preço — por isso a iteração.
 */
async function recommendPrice({ supplierCost, costs, feeFn, startPrice }) {
  const cost = n(supplierCost);
  if (cost <= 0) return 0;
  const variableRate = n(costs.taxRate) + n(costs.returnReserveRate) + n(costs.targetMargin);
  let price = n(startPrice) > 0 ? n(startPrice) : cost * 2;
  for (let i = 0; i < 6; i++) {
    const { saleFee, shippingCost } = await feeFn(price);
    const feeRate = price > 0 ? n(saleFee) / price : 0; // inclui a tarifa fixa diluída
    const denominator = 1 - variableRate - feeRate;
    if (denominator <= 0.05) return 0; // margem-alvo inatingível
    const next = (cost + n(shippingCost) + n(costs.supplierFeePerOrder) + n(costs.packagingCost)) / denominator;
    if (Math.abs(next - price) < 0.05) { price = next; break; }
    price = next;
  }
  // Arredonda para cima no padrão de varejo (R$ xx,90)
  return round2(Math.ceil(price - 0.9) + 0.9);
}

/**
 * Conversão = Δvendas / Δvisitas entre o snapshot mais antigo e o mais recente da janela.
 * O ML não expõe vendas exatas de concorrentes em todos os casos; sem vendas, a fonte fica "sem dados".
 */
function conversionFromSnapshots(snapshots, windowDays = 30) {
  const since = Date.now() - windowDays * 86400000;
  const rows = snapshots
    .filter((s) => new Date(s.ts).getTime() >= since && s.sold_quantity != null && s.visits_total != null)
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));
  if (rows.length < 2) return { pct: 0, source: 'sem dados' };
  const first = rows[0];
  const last = rows[rows.length - 1];
  const dVisits = n(last.visits_total) - n(first.visits_total);
  const dSold = n(last.sold_quantity) - n(first.sold_quantity);
  if (dVisits <= 0 || dSold < 0) return { pct: 0, source: 'sem dados' };
  return { pct: round2(Math.min(100, (dSold / dVisits) * 100)), source: 'medida' };
}

function conversionPct(sales, visits) {
  return n(visits) > 0 ? round2(Math.min(100, (n(sales) / n(visits)) * 100)) : 0;
}

/** Score de demanda (0–100): só sinais de mercado, independe de fornecedor. */
function demandScore({ highlight_position, highlight_total, visits_30d, conversion }) {
  const demand = highlight_position ? 1 - (n(highlight_position) - 1) / Math.max(n(highlight_total), 1) : 0;
  const traffic = clamp01(Math.log10(n(visits_30d) + 1) / Math.log10(20000)); // 20 mil visitas/mês = teto
  const parts = [[demand, 0.5], [traffic, 0.3]];
  if (conversion?.source === 'medida') parts.push([clamp01(conversion.pct / 10), 0.2]); // 10% = teto
  return weighted(parts);
}

/**
 * Score de oportunidade (0–100): demanda + viabilidade para VOCÊ vender
 * (margem com o seu fornecedor, concorrência e se o seu preço compete com o menor preço do anúncio).
 */
function opportunityScore({ opportunity, economics, recommendedPrice, conversion }) {
  const reasons = [];
  const d = demandScore({ ...opportunity, conversion }) / 100;
  const margin = economics?.viable ? clamp01(n(economics.net_margin_pct) / 35) : 0;
  const sellers = Math.max(1, n(opportunity.sellers_count));
  const competition = 1 / (1 + (sellers - 1) / 5);
  const reference = n(opportunity.min_competitor_price) || n(opportunity.price);
  const priceFit = n(recommendedPrice) > 0 && reference > 0 ? clamp01(reference / n(recommendedPrice)) : 0;

  if (!economics || n(economics.supplier_cost) <= 0) reasons.push('Sem fornecedor vinculado');
  else if (!economics.viable) reasons.push(`Margem abaixo da meta no preço atual (${n(economics.net_margin_pct)}%)`);
  if (priceFit > 0 && priceFit < 0.95) reasons.push('Seu preço mínimo fica acima do menor preço concorrente');
  if (sellers > 10) reasons.push(`Alta concorrência (${sellers} vendedores)`);
  if (conversion?.source === 'medida' && conversion.pct >= 5) reasons.push(`Conversão forte (${conversion.pct}%)`);

  const score = weighted([[d, 0.4], [margin, 0.3], [competition, 0.1], [priceFit, 0.2]]);
  return { score, demand_score: round2(d * 100), reasons };
}

function weighted(parts) {
  const totalW = parts.reduce((s, [, w]) => s + w, 0);
  return round2((parts.reduce((s, [v, w]) => s + clamp01(v) * w, 0) / totalW) * 100);
}

/**
 * Quantidade a publicar no ML a partir do estoque do fornecedor.
 * Abaixo da reserva de segurança publica 0 (evita venda sem estoque = cancelamento + reputação).
 */
function targetStock(supplierStock, { safetyBuffer, maxPublished }) {
  const available = n(supplierStock) - n(safetyBuffer);
  return Math.max(0, Math.min(n(maxPublished), Math.floor(available)));
}

module.exports = {
  computeEconomics,
  recommendPrice,
  conversionFromSnapshots,
  conversionPct,
  demandScore,
  opportunityScore,
  targetStock,
  round2,
  n,
};
