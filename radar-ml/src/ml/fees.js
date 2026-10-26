const ml = require('./client');
const config = require('../config');

// Tarifa de venda e custo de frete do vendedor, direto da API (fonte oficial, muda por faixa de preço).
const cache = new Map();

async function saleFee(price, categoryId, listingType = config.costs.listingType) {
  const key = `fee:${categoryId}:${listingType}:${Math.round(price)}`;
  if (cache.has(key)) return cache.get(key);
  const qs = new URLSearchParams({ price: price.toFixed(2), category_id: categoryId, listing_type_id: listingType });
  const data = await ml.tryGet(`/sites/${config.ml.siteId}/listing_prices?${qs}`);
  const entry = Array.isArray(data) ? data.find((d) => d.listing_type_id === listingType) : data;
  const fee = Number(entry?.sale_fee_amount) || 0;
  cache.set(key, fee);
  return fee;
}

/**
 * Custo de frete grátis pago pelo vendedor (Mercado Envios). Dimensões do fornecedor: AxLxC cm e peso em g.
 * Abaixo do limite de frete grátis obrigatório o comprador paga e o custo para o vendedor é 0.
 */
async function shippingCost(price, categoryId, product, userId) {
  if (!userId || !product?.weight_g) return 0;
  const dims = `${Math.ceil(product.height_cm || 10)}x${Math.ceil(product.width_cm || 10)}x${Math.ceil(product.length_cm || 10)},${Math.ceil(product.weight_g)}`;
  const key = `ship:${categoryId}:${dims}:${Math.round(price)}`;
  if (cache.has(key)) return cache.get(key);
  const qs = new URLSearchParams({
    dimensions: dims,
    item_price: price.toFixed(2),
    listing_type_id: config.costs.listingType,
    mode: 'me2',
    condition: 'new',
    logistic_type: 'drop_off',
    category_id: categoryId,
    verbose: 'true',
  });
  const data = await ml.tryGet(`/users/${userId}/shipping_options/free?${qs}`);
  const cost = Number(data?.coverage?.all_country?.list_cost) || 0;
  cache.set(key, cost);
  return cost;
}

function feeFnFor(categoryId, product, userId) {
  return async (price) => ({
    saleFee: await saleFee(price, categoryId),
    shippingCost: await shippingCost(price, categoryId, product, userId),
  });
}

module.exports = { saleFee, shippingCost, feeFnFor, _cache: cache };
