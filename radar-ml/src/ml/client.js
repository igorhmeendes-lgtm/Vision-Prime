const config = require('../config');
const { getAccessToken } = require('./auth');

// Cliente HTTP da API do ML: autenticação, limite de concorrência e retry com backoff.
// Desde 2025 praticamente todos os recursos (inclusive tendências e tarifas) exigem Bearer token.

const MAX_CONCURRENCY = 5;
let active = 0;
const queue = [];

function acquire() {
  if (active < MAX_CONCURRENCY) { active++; return Promise.resolve(); }
  return new Promise((resolve) => queue.push(resolve));
}
function release() {
  const next = queue.shift();
  if (next) next(); else active--;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MLError extends Error {
  constructor(status, path, body) {
    super(`ML ${status} em ${path}: ${body?.message || body?.error || 'erro'}`);
    this.status = status;
    this.body = body;
  }
}

async function request(method, path, { body, raw = false } = {}) {
  if (config.ml.mock) return require('./mock').handle(method, path, body);

  await acquire();
  try {
    let token = await getAccessToken();
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`${config.ml.apiBase}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token.access_token}`,
          Accept: raw ? '*/*' : 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0) {
        token = await getAccessToken({ forceRefresh: true });
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (raw) {
        if (!res.ok) throw new MLError(res.status, path, null);
        return res;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new MLError(res.status, path, data);
      return data;
    }
    throw new MLError(429, path, { message: 'limite de requisições/instabilidade após 4 tentativas' });
  } finally {
    release();
  }
}

// Retorna null em vez de lançar erro (para enriquecimentos opcionais)
async function tryGet(path) {
  try { return await request('GET', path); } catch { return null; }
}

module.exports = {
  get: (path) => request('GET', path),
  put: (path, body) => request('PUT', path, { body }),
  post: (path, body) => request('POST', path, { body }),
  raw: (path) => request('GET', path, { raw: true }),
  tryGet,
  MLError,
};
