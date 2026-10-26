const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const { open, getSetting } = require('./db');
const auth = require('./ml/auth');
const ml = require('./ml/client');
const seller = require('./ml/seller');
const suppliers = require('./suppliers');
const { computeKpis } = require('./analysis/kpis');
const scheduler = require('./jobs/scheduler');

const app = express();
const db = open();
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  res.status(err.status && err.status < 600 ? err.status : 500).json({ error: err.message });
});

// Webhook do ML fica fora da senha (o ML precisa alcançá-lo) e responde 200 em < 500 ms
app.post('/api/ml/notifications', express.json(), (req, res) => {
  res.sendStatus(200);
  const expected = auth.connectionStatus().user_id;
  if (expected && String(req.body?.user_id) !== String(expected)) return;
  seller.handleNotification(req.body || {}).catch((err) => console.error('[notificação]', err.message));
});

if (config.dashboardPassword) {
  app.use((req, res, next) => {
    const [, encoded] = (req.headers.authorization || '').split(' ');
    const [, pass = ''] = Buffer.from(encoded || '', 'base64').toString().split(':');
    const a = crypto.createHash('sha256').update(pass).digest();
    const b = crypto.createHash('sha256').update(config.dashboardPassword).digest();
    if (crypto.timingSafeEqual(a, b)) return next();
    res.set('WWW-Authenticate', 'Basic realm="Radar ML"').status(401).send('Autenticação necessária');
  });
}

app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '20mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- OAuth Mercado Livre ----------
app.get('/auth/connect', (req, res) => {
  if (!config.ml.clientId || !config.ml.clientSecret) return res.status(400).send('Configure ML_CLIENT_ID e ML_CLIENT_SECRET no .env');
  res.redirect(auth.buildAuthorizeUrl());
});
app.get('/auth/callback', wrap(async (req, res) => {
  if (req.query.error) throw Object.assign(new Error(`ML recusou: ${req.query.error}`), { status: 400 });
  await auth.exchangeCode(String(req.query.code), String(req.query.state));
  scheduler.JOBS.operations().catch(() => {});
  scheduler.JOBS.research().catch(() => {});
  res.redirect('/?conectado=1');
}));

// ---------- Status / KPIs ----------
app.get('/api/status', (req, res) => {
  const jobs = db.prepare(`SELECT j.* FROM job_runs j JOIN (SELECT job, MAX(started_at) AS m FROM job_runs GROUP BY job) l
    ON l.job = j.job AND l.m = j.started_at`).all();
  res.json({
    ml: auth.connectionStatus(),
    jobs: jobs.map((j) => ({ ...j, running: scheduler.running.has(j.job) })),
    running: [...scheduler.running],
    config: { categories: config.research.categories, costs: config.costs, stock: config.stock },
  });
});
app.get('/api/kpis', (req, res) => res.json(computeKpis()));

// ---------- Oportunidades ----------
app.get('/api/opportunities', (req, res) => {
  const where = ['o.updated_at >= ?'];
  const params = [new Date(Date.now() - 7 * 86400000).toISOString()];
  if (req.query.category) { where.push('o.category_id = ?'); params.push(String(req.query.category)); }
  if (req.query.viable === '1') where.push('a.viable = 1');
  if (req.query.q) { where.push('o.title LIKE ?'); params.push(`%${req.query.q}%`); }
  const order = { score: 'a.score DESC', demand: 'a.demand_score DESC', margin: 'a.net_margin_pct DESC', conversion: 'a.conversion_pct DESC' }[req.query.sort] || 'a.score DESC';
  const rows = db.prepare(`
    SELECT o.*, a.supplier_cost, a.sale_fee, a.shipping_cost, a.tax, a.net_profit, a.loss, a.net_margin_pct, a.recommended_price,
      a.conversion_pct, a.conversion_source, a.demand_score, a.score, a.viable, a.reasons,
      m.supplier_id, m.sku, m.method AS match_method, m.similarity, sp.title AS supplier_title, sp.stock AS supplier_stock
    FROM opportunities o
    LEFT JOIN analysis a ON a.item_id = o.item_id
    LEFT JOIN matches m ON m.item_id = o.item_id
    LEFT JOIN supplier_products sp ON sp.supplier_id = m.supplier_id AND sp.sku = m.sku
    WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 300`).all(...params);
  res.json(rows.map((r) => ({ ...r, reasons: JSON.parse(r.reasons || '[]') })));
});

// Vínculo manual anúncio ↔ SKU do fornecedor (sku vazio = desvincular e bloquear vínculo automático)
app.put('/api/opportunities/:id/match', wrap(async (req, res) => {
  const { supplier_id = null, sku = null } = req.body || {};
  if (sku && !db.prepare('SELECT 1 FROM supplier_products WHERE supplier_id = ? AND sku = ?').get(supplier_id, sku)) {
    return res.status(404).json({ error: 'SKU não encontrado no fornecedor informado' });
  }
  db.prepare(`INSERT OR REPLACE INTO matches (item_id, supplier_id, sku, method, similarity) VALUES (?, ?, ?, 'manual', 1)`)
    .run(req.params.id, sku ? supplier_id : null, sku || null);
  await require('./analysis/analyze').analyzeAll();
  res.json({ ok: true });
}));

app.get('/api/trends', (req, res) => {
  res.json(config.research.categories.map((c) => ({ category_id: c, keywords: getSetting(`trends:${c}`) || [] })));
});

app.get('/api/categories', wrap(async (req, res) => {
  if (!req.query.parent) return res.json(await ml.get(`/sites/${config.ml.siteId}/categories`));
  const cat = await ml.get(`/categories/${encodeURIComponent(String(req.query.parent))}`);
  res.json(cat.children_categories || []);
}));

// ---------- Minha operação ----------
app.get('/api/my-items', (req, res) => {
  res.json(db.prepare(`SELECT mi.*, (SELECT MAX(stock) FROM supplier_products sp WHERE sp.sku = mi.sku) AS supplier_stock
    FROM my_items mi ORDER BY sales_30d DESC`).all());
});

app.get('/api/orders', (req, res) => {
  const status = req.query.supplier_status;
  res.json(db.prepare(`SELECT * FROM orders ${status ? 'WHERE supplier_status = ?' : ''} ORDER BY date_created DESC LIMIT 500`)
    .all(...(status ? [String(status)] : [])));
});

app.put('/api/orders/:orderId/supplier-status', (req, res) => {
  const allowed = ['pendente', 'enviado_ao_fornecedor', 'despachado', 'problema'];
  if (!allowed.includes(req.body?.status)) return res.status(400).json({ error: `Status válidos: ${allowed.join(', ')}` });
  db.prepare('UPDATE orders SET supplier_status = ? WHERE order_id = ?').run(req.body.status, req.params.orderId);
  res.json({ ok: true });
});

// Planilha de pedidos pagos pendentes para enviar ao fornecedor
app.get('/api/orders/export.csv', (req, res) => {
  const rows = db.prepare(`SELECT order_id, date_created, sku, title, quantity, shipment_id, handling_limit FROM orders
    WHERE status = 'paid' AND supplier_status = 'pendente' AND (shipment_status IS NULL OR shipment_status IN ('ready_to_ship', 'pending', 'handling'))
    ORDER BY handling_limit`).all();
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const host = `${req.protocol}://${req.get('host')}`;
  const lines = [['pedido', 'data', 'sku', 'produto', 'quantidade', 'despachar_ate', 'etiqueta_pdf'].join(';')];
  for (const r of rows) {
    lines.push([r.order_id, r.date_created, r.sku, r.title, r.quantity, r.handling_limit,
      r.shipment_id ? `${host}/api/shipments/${r.shipment_id}/label` : ''].map(esc).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="pedidos-fornecedor.csv"');
  res.send(`﻿${lines.join('\n')}`);
});

app.get('/api/shipments/:id/label', wrap(async (req, res) => {
  const pdf = await seller.shipmentLabel(req.params.id);
  res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="etiqueta-${req.params.id}.pdf"`);
  res.send(Buffer.from(await pdf.arrayBuffer()));
}));

app.get('/api/stock-log', (req, res) => {
  res.json(db.prepare('SELECT * FROM stock_sync_log ORDER BY ts DESC LIMIT 200').all());
});

// ---------- Fornecedores ----------
app.get('/api/suppliers', (req, res) => res.json(suppliers.listSuppliers()));
app.post('/api/suppliers', wrap(async (req, res) => {
  const s = suppliers.saveSupplier(req.body || {});
  res.json({ supplier: s, import: await suppliers.importSupplier(s) });
}));
// Upload de CSV: body = conteúdo do arquivo (Content-Type: text/csv), ?name=Nome do fornecedor
app.post('/api/suppliers/upload', wrap(async (req, res) => {
  const name = String(req.query.name || '').trim();
  if (!name || typeof req.body !== 'string' || !req.body.trim()) return res.status(400).json({ error: 'Envie ?name= e o CSV no corpo' });
  const file = `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-')}.csv`;
  fs.mkdirSync(config.suppliersDir, { recursive: true });
  fs.writeFileSync(path.join(config.suppliersDir, file), req.body);
  const s = suppliers.saveSupplier({ name, type: 'file', source: file, handlingDays: req.query.handlingDays });
  res.json({ supplier: s, import: await suppliers.importSupplier(s) });
}));
app.post('/api/suppliers/:id/import', wrap(async (req, res) => {
  const s = suppliers.listSuppliers().find((x) => x.id === req.params.id);
  if (!s) return res.status(404).json({ error: 'Fornecedor não encontrado' });
  res.json(await suppliers.importSupplier(s));
}));
app.delete('/api/suppliers/:id', (req, res) => { suppliers.removeSupplier(req.params.id); res.json({ ok: true }); });
app.get('/api/suppliers/:id/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM supplier_products WHERE supplier_id = ? ORDER BY title LIMIT 2000').all(req.params.id));
});

// ---------- Jobs manuais ----------
app.post('/api/jobs/:name/run', wrap(async (req, res) => {
  const job = scheduler.JOBS[req.params.name];
  if (!job) return res.status(404).json({ error: 'Job inexistente (research | operations)' });
  if (!auth.connectionStatus().connected) return res.status(400).json({ error: 'Conecte o Mercado Livre primeiro' });
  res.json(await job());
}));

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Radar ML em http://localhost:${config.port}${config.ml.mock ? '  [MODO SIMULADO]' : ''}`);
    scheduler.start();
  });
}

module.exports = app;
