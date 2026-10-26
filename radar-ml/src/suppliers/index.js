const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { open, getSetting, setSetting } = require('../db');
const { parseCatalog } = require('./csv');

// Conectores de fornecedor. Todo hub/fornecedor exporta planilha ou feed CSV;
// tipos: "file" (CSV em data/fornecedores/) e "url" (feed CSV publicado pelo fornecedor, atualizado no agendamento).
// Para plugar uma API específica, adicione um tipo em FETCHERS que retorne o texto CSV ou a lista de produtos.

const FETCHERS = {
  file: async (s) => fs.readFileSync(path.join(config.suppliersDir, path.basename(s.source)), 'utf8'),
  url: async (s) => {
    const res = await fetch(s.source, { headers: s.headers || {} });
    if (!res.ok) throw new Error(`Feed do fornecedor respondeu ${res.status}`);
    return res.text();
  },
};

const slug = (v) => String(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function listSuppliers() {
  const db = open();
  const counts = new Map(db.prepare(`SELECT supplier_id, COUNT(*) AS n, SUM(stock > 0) AS in_stock, MAX(updated_at) AS updated_at
    FROM supplier_products GROUP BY supplier_id`).all().map((r) => [r.supplier_id, r]));
  return (getSetting('suppliers') || []).map((s) => ({
    ...s, products: counts.get(s.id)?.n || 0, in_stock: counts.get(s.id)?.in_stock || 0, updated_at: counts.get(s.id)?.updated_at || null,
  }));
}

function saveSupplier({ name, type, source, handlingDays }) {
  if (!name || !FETCHERS[type] || !source) throw new Error('Informe nome, tipo (file|url) e origem');
  const suppliers = getSetting('suppliers') || [];
  const id = slug(name);
  const entry = { id, name, type, source, handlingDays: Number(handlingDays) || 1 };
  const idx = suppliers.findIndex((s) => s.id === id);
  if (idx >= 0) suppliers[idx] = entry; else suppliers.push(entry);
  setSetting('suppliers', suppliers);
  return entry;
}

function removeSupplier(id) {
  setSetting('suppliers', (getSetting('suppliers') || []).filter((s) => s.id !== id));
  open().prepare('DELETE FROM supplier_products WHERE supplier_id = ?').run(id);
}

function storeProducts(supplierId, products) {
  const db = open();
  const now = new Date().toISOString();
  const stmt = db.prepare(`INSERT OR REPLACE INTO supplier_products
    (supplier_id, sku, ean, title, cost, stock, weight_g, height_cm, width_cm, length_cm, image_url, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    for (const p of products) {
      stmt.run(supplierId, p.sku, p.ean, p.title, p.cost, p.stock, p.weight_g, p.height_cm, p.width_cm, p.length_cm, p.image_url, now);
    }
    // SKU que sumiu do catálogo = estoque 0 (nunca deixar anúncio ativo de item descontinuado)
    db.prepare('UPDATE supplier_products SET stock = 0 WHERE supplier_id = ? AND updated_at < ?').run(supplierId, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

async function importSupplier(supplier) {
  const text = await FETCHERS[supplier.type](supplier);
  const { products, errors } = parseCatalog(text, supplier.id);
  if (!products.length) throw new Error(errors.join(' | ') || 'Nenhum produto válido');
  storeProducts(supplier.id, products);
  return { supplier: supplier.id, imported: products.length, warnings: errors.slice(0, 20) };
}

async function importAll() {
  const results = [];
  for (const s of getSetting('suppliers') || []) {
    try { results.push(await importSupplier(s)); } catch (err) { results.push({ supplier: s.id, imported: 0, error: err.message }); }
  }
  return results;
}

module.exports = { listSuppliers, saveSupplier, removeSupplier, importSupplier, importAll, storeProducts, FETCHERS };
