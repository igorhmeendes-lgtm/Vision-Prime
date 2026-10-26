const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

// Carrega .env sem dependência externa (variáveis já definidas no ambiente têm prioridade)
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const num = (name, fallback) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] !== '' ? v : fallback;
};
const list = (name, fallback) =>
  (process.env[name] || fallback).split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  ROOT,
  dataDir: path.join(ROOT, 'data'),
  suppliersDir: path.join(ROOT, 'data', 'fornecedores'),
  port: num('PORT', 3000),
  dashboardPassword: process.env.DASHBOARD_PASSWORD || '',
  ml: {
    clientId: process.env.ML_CLIENT_ID || '',
    clientSecret: process.env.ML_CLIENT_SECRET || '',
    redirectUri: process.env.ML_REDIRECT_URI || 'http://localhost:3000/auth/callback',
    mock: process.env.ML_MOCK === '1',
    apiBase: 'https://api.mercadolibre.com',
    authBase: 'https://auth.mercadolivre.com.br',
    siteId: 'MLB',
  },
  research: {
    categories: list('RESEARCH_CATEGORIES', 'MLB1648,MLB1000,MLB1574,MLB1246,MLB1276'),
    intervalHours: num('RESEARCH_INTERVAL_HOURS', 6),
  },
  costs: {
    taxRate: num('TAX_RATE', 0),
    returnReserveRate: num('RETURN_RESERVE_RATE', 0.03),
    supplierFeePerOrder: num('SUPPLIER_FEE_PER_ORDER', 0),
    packagingCost: num('PACKAGING_COST', 0),
    targetMargin: num('TARGET_MARGIN', 0.15),
    listingType: process.env.LISTING_TYPE || 'gold_special',
  },
  stock: {
    autoSync: process.env.AUTO_SYNC_STOCK === '1',
    safetyBuffer: num('STOCK_SAFETY_BUFFER', 2),
    maxPublished: num('STOCK_MAX_PUBLISHED', 50),
    intervalMinutes: num('STOCK_SYNC_INTERVAL_MINUTES', 30),
  },
};
