// Cloudflare Worker: proxy do Gemini para o CriaVende.
// Mantém a chave fora do navegador (mesmo papel do /api/gemini e /api/image da plataforma de referência).
// Deploy: npx wrangler deploy worker/gemini-proxy.js --name criavende-ia
//         npx wrangler secret put GEMINI_API_KEY
// Opcional: ALLOWED_ORIGIN (ex.: https://igorhmeendes-lgtm.github.io) e DAILY_LIMIT (padrão 50 por IP).

const API = 'https://generativelanguage.googleapis.com/v1beta';
const counters = new Map(); // limite simples em memória por IP e dia; troque por KV/D1 para limite exato

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (origin !== '*' && request.headers.get('Origin') !== origin) return json({ error: { message: 'Origem não autorizada.' } }, 403);

    const { pathname } = new URL(request.url);
    const headers = { 'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json' };

    if (request.method === 'GET' && pathname === '/models') {
      const res = await fetch(`${API}/models?pageSize=200`, { headers });
      return json(await res.json(), res.status);
    }

    if (request.method === 'POST' && pathname === '/generate') {
      const ip = request.headers.get('CF-Connecting-IP') || 'anon';
      const key = `${ip}:${new Date().toISOString().slice(0, 10)}`;
      const used = (counters.get(key) || 0) + 1;
      if (used > Number(env.DAILY_LIMIT || 50)) return json({ error: { message: 'Limite diário de gerações atingido.' } }, 429);
      counters.set(key, used);

      const { model, body } = await request.json().catch(() => ({}));
      if (!/^[a-z0-9.-]+$/i.test(model || '') || !body) return json({ error: { message: 'Pedido inválido.' } }, 400);
      const res = await fetch(`${API}/models/${model}:generateContent`, { method: 'POST', headers, body: JSON.stringify(body) });
      return json(await res.json(), res.status);
    }

    return json({ error: { message: 'Rota não encontrada.' } }, 404);
  },
};
