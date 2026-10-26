// Vincula anúncios do ML a produtos do catálogo do fornecedor.
// 1º por EAN/GTIN (exato); 2º por similaridade de título (Jaccard sobre tokens normalizados).

const STOPWORDS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'com', 'para', 'p', 'pra', 'em', 'o', 'a', 'os', 'as',
  'kit', 'novo', 'nova', 'original', 'promocao', 'oferta', 'envio', 'imediato', 'frete', 'gratis',
]);

const MIN_SIMILARITY = 0.45;

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(text) {
  return new Set(normalize(text).split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

const cleanEan = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');

function buildIndex(supplierProducts) {
  const byEan = new Map();
  const list = supplierProducts.map((p) => ({ ...p, _tokens: tokens(p.title) }));
  for (const p of list) if (cleanEan(p.ean)) byEan.set(cleanEan(p.ean), p);
  return { byEan, list };
}

function findMatch(opportunity, index) {
  const ean = cleanEan(opportunity.gtin);
  if (ean && index.byEan.has(ean)) {
    const p = index.byEan.get(ean);
    return { supplier_id: p.supplier_id, sku: p.sku, method: 'ean', similarity: 1 };
  }
  const target = tokens(opportunity.title);
  let best = null;
  for (const p of index.list) {
    const sim = jaccard(target, p._tokens);
    if (sim >= MIN_SIMILARITY && (!best || sim > best.similarity)) {
      best = { supplier_id: p.supplier_id, sku: p.sku, method: 'titulo', similarity: Math.round(sim * 100) / 100 };
    }
  }
  return best;
}

module.exports = { normalize, tokens, jaccard, buildIndex, findMatch, MIN_SIMILARITY };
