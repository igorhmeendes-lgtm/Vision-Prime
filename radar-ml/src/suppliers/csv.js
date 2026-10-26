// Parser de CSV de catálogo de fornecedor: aceita ";" ou ",", aspas, BOM e números no formato BR (1.234,56).

const COLUMN_ALIASES = {
  sku: ['sku', 'codigo', 'cod', 'referencia', 'ref', 'id_produto', 'codigo_produto'],
  ean: ['ean', 'gtin', 'ean13', 'codigo_barras', 'cod_barras', 'barcode'],
  title: ['titulo', 'title', 'nome', 'produto', 'descricao', 'nome_produto'],
  cost: ['custo', 'preco_custo', 'cost', 'preco', 'valor', 'preco_fornecedor', 'preco_atacado'],
  stock: ['estoque', 'stock', 'quantidade', 'qtd', 'saldo', 'disponivel'],
  weight_g: ['peso_g', 'peso', 'weight', 'peso_gramas'],
  weight_kg: ['peso_kg', 'peso_kilos', 'weight_kg'],
  height_cm: ['altura_cm', 'altura', 'height'],
  width_cm: ['largura_cm', 'largura', 'width'],
  length_cm: ['comprimento_cm', 'comprimento', 'profundidade', 'length'],
  image_url: ['imagem', 'image', 'image_url', 'foto', 'url_imagem'],
};

const normHeader = (h) => h.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/[^a-z0-9]+/g, '_');

function parseRows(text) {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0];
  const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

/** "1.234,56" | "1234.56" | "R$ 12,90" -> número; inválido -> 0 */
function parseNumber(value) {
  let s = String(value ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function parseCatalog(text, supplierId) {
  const rows = parseRows(text);
  if (rows.length < 2) return { products: [], errors: ['CSV vazio ou sem linhas de produto'], mapping: {} };
  const headers = rows[0].map(normHeader);
  const mapping = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx >= 0) mapping[field] = idx;
  }
  const errors = [];
  for (const required of ['sku', 'title', 'cost', 'stock']) {
    if (mapping[required] === undefined) errors.push(`Coluna obrigatória não encontrada: ${required} (aceitos: ${COLUMN_ALIASES[required].join(', ')})`);
  }
  if (errors.length) return { products: [], errors, mapping };

  const get = (r, f) => (mapping[f] === undefined ? '' : String(r[mapping[f]] ?? '').trim());
  const products = [];
  rows.slice(1).forEach((r, i) => {
    const sku = get(r, 'sku');
    if (!sku) { errors.push(`Linha ${i + 2}: SKU vazio — ignorada`); return; }
    const weightKg = parseNumber(get(r, 'weight_kg'));
    products.push({
      supplier_id: supplierId,
      sku,
      ean: get(r, 'ean').replace(/\D/g, '') || null,
      title: get(r, 'title'),
      cost: parseNumber(get(r, 'cost')),
      stock: Math.floor(parseNumber(get(r, 'stock'))),
      weight_g: Math.round(weightKg > 0 ? weightKg * 1000 : parseNumber(get(r, 'weight_g'))),
      height_cm: parseNumber(get(r, 'height_cm')),
      width_cm: parseNumber(get(r, 'width_cm')),
      length_cm: parseNumber(get(r, 'length_cm')),
      image_url: get(r, 'image_url') || null,
    });
  });
  return { products, errors, mapping };
}

module.exports = { parseCatalog, parseRows, parseNumber, COLUMN_ALIASES };
