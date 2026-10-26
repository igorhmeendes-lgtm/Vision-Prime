const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeEconomics, recommendPrice, conversionFromSnapshots, conversionPct, opportunityScore, targetStock,
} = require('../src/analysis/scoring');
const { parseCatalog, parseNumber } = require('../src/suppliers/csv');
const { buildIndex, findMatch } = require('../src/analysis/matcher');

const costs = { taxRate: 0, returnReserveRate: 0.03, supplierFeePerOrder: 0, packagingCost: 0, targetMargin: 0.15 };

test('economia: lucro líquido desconta tarifa, frete, reserva', () => {
  const e = computeEconomics({ price: 100, supplierCost: 40, saleFee: 14, shippingCost: 20, costs });
  assert.equal(e.reserve, 3);
  assert.equal(e.net_profit, 23);
  assert.equal(e.net_margin_pct, 23);
  assert.equal(e.loss, 0);
  assert.equal(e.viable, true);
});

test('economia: prejuízo vai para "loss", lucro e margem nunca ficam negativos', () => {
  const e = computeEconomics({ price: 29.9, supplierCost: 25, saleFee: 10.44, shippingCost: 0, costs });
  assert.equal(e.net_profit, 0);
  assert.equal(e.net_margin_pct, 0);
  assert.ok(e.loss > 0);
  assert.equal(e.viable, false);
});

test('economia: entradas nulas/inválidas viram 0', () => {
  const e = computeEconomics({ price: null, supplierCost: undefined, saleFee: 'x', shippingCost: NaN, costs });
  assert.deepEqual([e.price, e.net_profit, e.loss, e.net_margin_pct, e.viable], [0, 0, 0, 0, false]);
});

test('preço recomendado atinge a margem-alvo considerando tarifa fixa por faixa', async () => {
  const feeFn = async (p) => ({ saleFee: p * 0.14 + (p < 79 ? 6.25 : 0), shippingCost: p >= 79 ? 22 : 0 });
  const price = await recommendPrice({ supplierCost: 20, costs, feeFn, startPrice: 30 });
  const { saleFee, shippingCost } = await feeFn(price);
  const e = computeEconomics({ price, supplierCost: 20, saleFee, shippingCost, costs });
  assert.ok(e.net_margin_pct >= 15, `margem ${e.net_margin_pct}% no preço ${price}`);
  assert.equal(Math.round((price % 1) * 100), 90); // termina em ,90
});

test('preço recomendado: margem impossível retorna 0', async () => {
  const feeFn = async (p) => ({ saleFee: p * 0.9, shippingCost: 0 });
  assert.equal(await recommendPrice({ supplierCost: 10, costs, feeFn }), 0);
});

test('conversão medida entre snapshots e proteção contra dados ruins', () => {
  const now = Date.now();
  const snaps = [
    { ts: new Date(now - 5 * 86400000).toISOString(), visits_total: 10000, sold_quantity: 300 },
    { ts: new Date(now).toISOString(), visits_total: 12000, sold_quantity: 380 },
  ];
  assert.deepEqual(conversionFromSnapshots(snaps), { pct: 4, source: 'medida' });
  assert.equal(conversionFromSnapshots([snaps[0]]).source, 'sem dados');
  assert.equal(conversionFromSnapshots(snaps.map((s) => ({ ...s, sold_quantity: null }))).source, 'sem dados');
  assert.equal(conversionPct(5, 0), 0);
  assert.equal(conversionPct(3, 100), 3);
});

test('score: sem fornecedor fica abaixo de produto viável com mesma demanda', () => {
  const opportunity = { highlight_position: 1, highlight_total: 20, visits_30d: 15000, sellers_count: 3, min_competitor_price: 100, price: 100 };
  const economics = computeEconomics({ price: 100, supplierCost: 40, saleFee: 14, shippingCost: 20, costs });
  const withSupplier = opportunityScore({ opportunity, economics, recommendedPrice: 90.9, conversion: { pct: 0, source: 'sem dados' } });
  const without = opportunityScore({ opportunity, economics: null, recommendedPrice: 0, conversion: { pct: 0, source: 'sem dados' } });
  assert.ok(withSupplier.score > without.score);
  assert.ok(without.reasons.includes('Sem fornecedor vinculado'));
  assert.equal(withSupplier.demand_score, without.demand_score);
});

test('estoque alvo: reserva de segurança, teto e nunca negativo', () => {
  const cfg = { safetyBuffer: 2, maxPublished: 50 };
  assert.equal(targetStock(1, cfg), 0);
  assert.equal(targetStock(10, cfg), 8);
  assert.equal(targetStock(999, cfg), 50);
  assert.equal(targetStock(null, cfg), 0);
});

test('CSV: delimitador ;, aspas, BOM, números BR e colunas faltando', () => {
  const csv = '﻿Código;EAN;Nome;Preço Custo;Estoque;Peso_kg\n"A1";789-1;"Cabo ""HDMI"" 2m";1.234,56;10;0,35\n;;sem sku;1;1;\n';
  const { products, errors } = parseCatalog(csv, 'f1');
  assert.equal(products.length, 1);
  assert.deepEqual([products[0].sku, products[0].ean, products[0].title, products[0].cost, products[0].weight_g], ['A1', '7891', 'Cabo "HDMI" 2m', 1234.56, 350]);
  assert.ok(errors[0].includes('SKU vazio'));
  assert.ok(parseCatalog('sku,titulo\nA,B', 'f').errors.some((e) => e.includes('custo')));
  assert.equal(parseNumber('R$ 12,90'), 12.9);
  assert.equal(parseNumber('-5'), 0);
});

test('matcher: EAN tem prioridade, depois título', () => {
  const index = buildIndex([
    { supplier_id: 'f', sku: 'X', ean: '7898000000011', title: 'Produto qualquer' },
    { supplier_id: 'f', sku: 'Y', ean: null, title: 'Luminária De Mesa Led Recarregável USB Touch' },
  ]);
  assert.equal(findMatch({ gtin: '07898000000011', title: 'outro' }, index).sku, 'X');
  const m = findMatch({ gtin: null, title: 'Luminaria Mesa LED Recarregavel Usb Touch 3 Cores' }, index);
  assert.equal(m.sku, 'Y');
  assert.equal(m.method, 'titulo');
  assert.equal(findMatch({ title: 'Panela de pressão elétrica' }, index), null);
});
