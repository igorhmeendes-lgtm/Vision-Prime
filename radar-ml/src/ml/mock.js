// Simulador da API do ML (ML_MOCK=1): permite testar o sistema inteiro sem credenciais.
// Cada rodada de pesquisa avança "1 dia" de visitas/vendas para a conversão poder ser medida.

const CATALOG = [
  ['Cabo HDMI 2.0 4K 2 Metros Ultra HD', 29.9, '7898000000011'],
  ['Fone De Ouvido Bluetooth Tws Sem Fio Com Case Carregador', 89.9, '7898000000028'],
  ['Luminária De Mesa Led Recarregável Usb Touch 3 Cores', 74.9, null],
  ['Mouse Sem Fio 2.4ghz Recarregável Silencioso Ergonômico', 49.9, '7898000000042'],
  ['Organizador De Gaveta Kit 6 Peças Plástico Multiuso', 39.9, '7898000000059'],
  ['Garrafa Térmica Inox 1 Litro Café Água Parede Dupla', 69.9, '7898000000066'],
  ['Suporte Notebook Ajustável Alumínio Dobrável', 79.9, null],
  ['Carregador Turbo Usb-c 20w Compatível iPhone', 39.9, null],
  ['Ring Light 26cm Com Tripé 2 Metros Suporte Celular', 99.9, null],
  ['Teclado Gamer Semi Mecânico Rgb Abnt2', 119.9, null],
  ['Escova Secadora Rotativa 3 Em 1 Bivolt', 149.9, null],
  ['Kit 10 Potes Herméticos Vidro Tampa Bambu', 129.9, null],
];

let day = 0;
const myItems = new Map([
  ['MLB900001', { id: 'MLB900001', title: 'Cabo HDMI 4K 2m Premium', price: 31.9, available_quantity: 50, status: 'active', seller_custom_field: 'HDMI-2M-4K', variations: [] }],
  ['MLB900002', { id: 'MLB900002', title: 'Mouse Sem Fio Recarregável Silencioso', price: 52.9, available_quantity: 10, status: 'active', seller_custom_field: 'MOUSE-SEMFIO', variations: [] }],
  ['MLB900003', { id: 'MLB900003', title: 'Organizador Gaveta 6 Peças', price: 44.9, available_quantity: 8, status: 'active', seller_custom_field: 'ORG-GAVETA-6', variations: [] }],
]);

const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const itemId = (cat, i) => `MLB${(hash(cat) % 9000) + 1000}${String(i).padStart(4, '0')}`;

function itemBody(id) {
  const my = myItems.get(id);
  if (my) return { ...my, permalink: `https://produto.mercadolivre.com.br/${id}`, thumbnail: '' };
  const i = Number(id.slice(-4));
  const [title, price, gtin] = CATALOG[i % CATALOG.length];
  const h = hash(id);
  const rate = 0.02 + (h % 60) / 1000; // conversão "real" 2% a 8%
  const visitsPerDay = 150 + (h % 900);
  return {
    id, title, price, category_id: 'MLB1648', listing_type_id: 'gold_special',
    permalink: `https://produto.mercadolivre.com.br/${id}`, thumbnail: '',
    sold_quantity: Math.floor(500 + visitsPerDay * rate * day),
    _visits_total: 20000 + visitsPerDay * day, _visits_30d: visitsPerDay * 30,
    attributes: gtin ? [{ id: 'GTIN', value_name: gtin }] : [],
  };
}

function orders() {
  const now = Date.now();
  const mk = (id, item, qty, status, hoursAgo, shippedLate) => ({
    id, status, date_created: new Date(now - hoursAgo * 3600000).toISOString(),
    order_items: [{ item: { id: item.id, title: item.title, seller_sku: item.seller_custom_field }, quantity: qty, unit_price: item.price }],
    shipping: { id: `SHP${id}` },
    cancel_detail: status === 'cancelled' ? { description: 'Sem estoque no fornecedor' } : null,
    _shippedLate: shippedLate,
  });
  const [a, b, c] = [...myItems.values()];
  return [
    mk(2001, a, 2, 'paid', 30, false), mk(2002, a, 1, 'paid', 80, false), mk(2003, b, 1, 'paid', 50, true),
    mk(2004, c, 1, 'cancelled', 100, false), mk(2005, a, 3, 'paid', 200, false), mk(2006, b, 1, 'paid', 10, false),
  ];
}

function handle(method, path, body) {
  const url = new URL(path, 'https://mock.local');
  const p = url.pathname;
  const q = url.searchParams;
  let m;

  if (method === 'PUT' && (m = p.match(/^\/items\/(\w+)$/))) {
    const item = myItems.get(m[1]);
    if (!item) throw new Error('item não encontrado');
    if (body.available_quantity !== undefined) item.available_quantity = body.available_quantity;
    return item;
  }
  if ((m = p.match(/^\/categories\/(\w+)$/))) return { id: m[1], name: `Categoria ${m[1]} (simulada)` };
  if ((m = p.match(/^\/highlights\/MLB\/category\/(\w+)$/))) {
    day++;
    return { content: Array.from({ length: 12 }, (_, i) => ({ id: i % 3 === 0 ? `MLB${m[1].slice(3)}P${i}` : itemId(m[1], i), position: i + 1, type: i % 3 === 0 ? 'PRODUCT' : 'ITEM' })) };
  }
  if ((m = p.match(/^\/products\/MLB(\w+)P(\d+)\/items$/))) {
    const base = CATALOG[Number(m[2]) % CATALOG.length][1];
    return { results: Array.from({ length: 3 + (Number(m[2]) % 15) }, (_, k) => ({ item_id: itemId(`MLB${m[1]}`, Number(m[2])), price: +(base * (0.92 + k * 0.03)).toFixed(2) })) };
  }
  if ((m = p.match(/^\/products\/MLB(\w+)P(\d+)$/))) {
    const [, , gtin] = CATALOG[Number(m[2]) % CATALOG.length];
    return { id: `MLB${m[1]}P${m[2]}`, buy_box_winner: { item_id: itemId(`MLB${m[1]}`, Number(m[2])) }, attributes: gtin ? [{ id: 'GTIN', value_name: gtin }] : [] };
  }
  if (p === '/items') return q.get('ids').split(',').map((id) => ({ code: 200, body: itemBody(id) }));
  if (p === '/visits/items') return Object.fromEntries(q.get('ids').split(',').map((id) => [id, itemBody(id)._visits_total || 0]));
  if ((m = p.match(/^\/items\/(\w+)\/visits\/time_window$/))) {
    const b = itemBody(m[1]);
    return { item_id: m[1], total_visits: b._visits_30d || 300 + (hash(m[1]) % 700) };
  }
  if ((m = p.match(/^\/trends\/MLB\/(\w+)$/))) return ['fone bluetooth', 'cabo hdmi 4k', 'luminaria led', 'garrafa termica'].map((keyword) => ({ keyword }));
  if (p === '/sites/MLB/listing_prices') {
    const price = Number(q.get('price'));
    const fixed = price < 79 ? 6.25 : 0;
    return { listing_type_id: q.get('listing_type_id'), sale_fee_amount: +(price * 0.14 + fixed).toFixed(2) };
  }
  if (/^\/users\/\w+\/shipping_options\/free$/.test(p)) {
    return { coverage: { all_country: { list_cost: Number(q.get('item_price')) >= 79 ? 22.45 : 0 } } };
  }
  if (/^\/users\/\w+\/items\/search$/.test(p)) return { results: [...myItems.keys()], paging: { total: myItems.size } };
  if (p === '/orders/search') return { results: orders(), paging: { total: 6 } };
  if ((m = p.match(/^\/orders\/(\d+)$/))) return orders().find((o) => String(o.id) === m[1]);
  if ((m = p.match(/^\/shipments\/SHP(\d+)$/))) {
    const o = orders().find((x) => String(x.id) === m[1]);
    const created = new Date(o.date_created).getTime();
    const limit = created + 24 * 3600000;
    return {
      id: `SHP${m[1]}`, order_id: o.id, status: o.status === 'cancelled' ? 'cancelled' : 'shipped',
      lead_time: { estimated_handling_limit: { date: new Date(limit).toISOString() } },
      status_history: { date_shipped: o.status === 'cancelled' ? null : new Date(limit + (o._shippedLate ? 6 : -6) * 3600000).toISOString() },
    };
  }
  if (p === '/shipment_labels') return new Response('%PDF-1.4\n% etiqueta simulada\n', { headers: { 'Content-Type': 'application/pdf' } });
  throw Object.assign(new Error(`mock: rota não simulada ${method} ${p}`), { status: 404 });
}

module.exports = { handle, _myItems: myItems };
