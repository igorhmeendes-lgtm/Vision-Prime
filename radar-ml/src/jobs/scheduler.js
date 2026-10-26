const config = require('../config');
const { open } = require('../db');
const { connectionStatus } = require('../ml/auth');
const { researchAll } = require('../ml/research');
const { analyzeAll } = require('../analysis/analyze');
const seller = require('../ml/seller');
const suppliers = require('../suppliers');

// Rotinas automáticas. Cada job registra início/fim/erro em job_runs (visível no painel).
const running = new Set();

async function runJob(name, fn) {
  if (running.has(name)) return { skipped: true, reason: 'já em execução' };
  running.add(name);
  const db = open();
  const started = new Date().toISOString();
  try {
    const result = await fn();
    db.prepare('INSERT INTO job_runs VALUES (?, ?, ?, 1, ?)').run(name, started, new Date().toISOString(), JSON.stringify(result));
    return result;
  } catch (err) {
    db.prepare('INSERT INTO job_runs VALUES (?, ?, ?, 0, ?)').run(name, started, new Date().toISOString(), err.message);
    throw err;
  } finally {
    running.delete(name);
  }
}

const JOBS = {
  // Mercado: mais vendidos + visitas → cruza com fornecedores → score
  research: () => runJob('research', async () => {
    const categories = await researchAll();
    const analysis = await analyzeAll();
    return { categories, ...analysis };
  }),
  // Operação: catálogo do fornecedor → seus anúncios/pedidos → estoque
  operations: () => runJob('operations', async () => {
    const imports = await suppliers.importAll();
    const orders = await seller.syncOrders();
    const items = await seller.syncMyItems();
    const stock = await seller.syncStock();
    return { imports, ...orders, ...items, stock };
  }),
};

function start() {
  const safe = (name) => () => {
    if (!connectionStatus().connected) return;
    JOBS[name]().catch((err) => console.error(`[job ${name}]`, err.message));
  };
  setInterval(safe('research'), config.research.intervalHours * 3600000).unref();
  setInterval(safe('operations'), config.stock.intervalMinutes * 60000).unref();
  // Primeira execução logo após subir o servidor
  setTimeout(() => { safe('operations')(); safe('research')(); }, 3000).unref();
}

module.exports = { start, JOBS, running };
