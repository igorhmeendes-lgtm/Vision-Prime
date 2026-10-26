const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db;

function open(file = process.env.RADAR_DB || path.join(config.dataDir, 'radar.db')) {
  if (db) return db;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

    -- Anúncios concorrentes encontrados nos "Mais vendidos" das categorias
    CREATE TABLE IF NOT EXISTS opportunities (
      item_id TEXT PRIMARY KEY,
      product_id TEXT,
      category_id TEXT,
      category_name TEXT,
      title TEXT,
      price REAL DEFAULT 0,
      permalink TEXT,
      thumbnail TEXT,
      gtin TEXT,
      listing_type_id TEXT,
      highlight_position INTEGER,
      highlight_total INTEGER,
      sellers_count INTEGER DEFAULT 1,
      min_competitor_price REAL DEFAULT 0,
      visits_30d INTEGER DEFAULT 0,
      sold_quantity INTEGER,
      updated_at TEXT
    );

    -- Histórico para medir conversão por variação (vendas / visitas)
    CREATE TABLE IF NOT EXISTS snapshots (
      item_id TEXT,
      ts TEXT,
      visits_30d INTEGER,
      visits_total INTEGER,
      sold_quantity INTEGER,
      PRIMARY KEY (item_id, ts)
    );

    CREATE TABLE IF NOT EXISTS supplier_products (
      supplier_id TEXT,
      sku TEXT,
      ean TEXT,
      title TEXT,
      cost REAL DEFAULT 0,
      stock INTEGER DEFAULT 0,
      weight_g INTEGER DEFAULT 0,
      height_cm REAL DEFAULT 0,
      width_cm REAL DEFAULT 0,
      length_cm REAL DEFAULT 0,
      image_url TEXT,
      updated_at TEXT,
      PRIMARY KEY (supplier_id, sku)
    );

    CREATE TABLE IF NOT EXISTS matches (
      item_id TEXT PRIMARY KEY,
      supplier_id TEXT,
      sku TEXT,
      method TEXT,
      similarity REAL
    );

    CREATE TABLE IF NOT EXISTS analysis (
      item_id TEXT PRIMARY KEY,
      supplier_cost REAL DEFAULT 0,
      sale_fee REAL DEFAULT 0,
      shipping_cost REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      net_profit REAL DEFAULT 0,
      loss REAL DEFAULT 0,
      net_margin_pct REAL DEFAULT 0,
      recommended_price REAL DEFAULT 0,
      conversion_pct REAL DEFAULT 0,
      conversion_source TEXT,
      demand_score REAL DEFAULT 0,
      score REAL DEFAULT 0,
      viable INTEGER DEFAULT 0,
      reasons TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS my_items (
      item_id TEXT PRIMARY KEY,
      title TEXT,
      price REAL DEFAULT 0,
      available_quantity INTEGER DEFAULT 0,
      status TEXT,
      sku TEXT,
      permalink TEXT,
      thumbnail TEXT,
      visits_30d INTEGER DEFAULT 0,
      sales_30d INTEGER DEFAULT 0,
      conversion_pct REAL DEFAULT 0,
      variations_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT,
      item_id TEXT,
      sku TEXT,
      title TEXT,
      quantity INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      total REAL DEFAULT 0,
      status TEXT,
      cancel_reason TEXT,
      date_created TEXT,
      shipment_id TEXT,
      shipment_status TEXT,
      handling_limit TEXT,
      date_shipped TEXT,
      supplier_status TEXT DEFAULT 'pendente',
      updated_at TEXT,
      PRIMARY KEY (order_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS stock_sync_log (
      ts TEXT,
      item_id TEXT,
      variation_id TEXT,
      sku TEXT,
      ml_qty INTEGER,
      target_qty INTEGER,
      applied INTEGER,
      message TEXT
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      job TEXT,
      started_at TEXT,
      finished_at TEXT,
      ok INTEGER,
      message TEXT
    );
  `);
  return db;
}

function getSetting(key) {
  const row = open().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

function setSetting(key, value) {
  open()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

module.exports = { open, getSetting, setSetting };
