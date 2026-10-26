// Fluxo completo contra o simulador da API (sem rede): fornecedor → pesquisa → análise → operação → KPIs → HTTP.
process.env.ML_MOCK = '1';
process.env.RADAR_DB = ':memory:';
process.env.AUTO_SYNC_STOCK = '1';
process.env.RESEARCH_CATEGORIES = 'MLB1648';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const { open } = require('../src/db');
const suppliers = require('../src/suppliers');
const { JOBS } = require('../src/jobs/scheduler');
const { computeKpis } = require('../src/analysis/kpis');
const mock = require('../src/ml/mock');

test('fluxo ponta a ponta no modo simulado', async () => {
  const s = suppliers.saveSupplier({ name: 'Fornecedor Exemplo', type: 'file', source: 'exemplo-fornecedor.csv' });
  const imp = await suppliers.importSupplier(s);
  assert.equal(imp.imported, 6);

  await JOBS.research();
  const second = await JOBS.research(); // 2ª coleta permite medir conversão
  assert.equal(second.categories[0].error, undefined);

  const db = open();
  const rows = db.prepare('SELECT o.title, a.* FROM opportunities o JOIN analysis a USING (item_id)').all();
  assert.ok(rows.length >= 8, `oportunidades: ${rows.length}`);
  assert.ok(rows.some((r) => r.conversion_source === 'medida'), 'conversão medida após 2 coletas');
  const hdmi = rows.find((r) => /hdmi/i.test(r.title) && r.supplier_cost > 0);
  assert.ok(hdmi, 'cabo HDMI vinculado ao fornecedor por EAN');
  assert.ok(hdmi.recommended_price > 0);
  for (const r of rows) {
    assert.ok(r.net_profit >= 0 && r.loss >= 0 && r.net_margin_pct >= 0, 'sem valores negativos');
    assert.ok(r.score >= 0 && r.score <= 100);
  }

  const ops = await JOBS.operations();
  assert.equal(ops.orders, 6);
  assert.equal(ops.items, 3);
  // ORG-GAVETA-6 tem estoque 0 no fornecedor → anúncio vai a 0; HDMI (340) → teto de 50; mouse (210) → 50
  assert.equal(mock._myItems.get('MLB900003').available_quantity, 0);
  assert.equal(mock._myItems.get('MLB900002').available_quantity, 50);
  assert.ok(ops.stock.applied >= 2);

  await JOBS.operations(); // após sincronizar, acuracidade deve ser 100%
  const k = computeKpis();
  assert.equal(k.sku_accuracy_pct, 100);
  assert.equal(k.cuts_orders, 1);
  assert.ok(k.cuts_value > 0);
  assert.equal(k.otd_sample, 5);
  assert.equal(k.otd_pct, 80); // 1 de 5 envios atrasado no simulador
  assert.ok(k.opportunities_viable > 0);

  const app = require('../src/server');
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const opps = await (await fetch(`${base}/api/opportunities?viable=1`)).json();
    assert.ok(opps.length > 0 && opps.every((o) => o.viable === 1));
    const csv = Buffer.from(await (await fetch(`${base}/api/orders/export.csv`)).arrayBuffer());
    assert.deepEqual([...csv.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // BOM para o Excel abrir com acentos
    assert.ok(csv.toString('utf8', 3).startsWith('pedido;'));
    const label = await fetch(`${base}/api/shipments/SHP2001/label`);
    assert.equal(label.headers.get('content-type'), 'application/pdf');
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes('Radar ML'));
  } finally {
    server.close();
  }
});

test('o arquivo de exemplo do fornecedor existe no repositório', () => {
  assert.ok(fs.existsSync(path.join(config.suppliersDir, 'exemplo-fornecedor.csv')));
});
