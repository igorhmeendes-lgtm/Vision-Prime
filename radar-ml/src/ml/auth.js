const crypto = require('node:crypto');
const config = require('../config');
const { getSetting, setSetting } = require('../db');

// OAuth 2.0 Authorization Code + PKCE do Mercado Livre.
// Access token dura ~6h; o refresh token é de uso único e é trocado a cada renovação.

const pending = new Map(); // state -> code_verifier

function buildAuthorizeUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  pending.set(state, verifier);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.ml.clientId,
    redirect_uri: config.ml.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${config.ml.authBase}/authorization?${params}`;
}

async function requestToken(body) {
  const res = await fetch(`${config.ml.apiBase}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OAuth ML ${res.status}: ${data.message || data.error || 'erro desconhecido'}`);
  const token = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user_id: String(data.user_id),
    expires_at: Date.now() + (data.expires_in - 300) * 1000, // renova 5 min antes
  };
  setSetting('ml_token', token);
  return token;
}

async function exchangeCode(code, state) {
  const verifier = pending.get(state);
  if (!verifier) throw new Error('state inválido ou expirado — inicie a conexão novamente');
  pending.delete(state);
  return requestToken({
    grant_type: 'authorization_code',
    client_id: config.ml.clientId,
    client_secret: config.ml.clientSecret,
    code,
    redirect_uri: config.ml.redirectUri,
    code_verifier: verifier,
  });
}

let refreshing = null;

async function getAccessToken({ forceRefresh = false } = {}) {
  if (config.ml.mock) return { access_token: 'mock', user_id: '999' };
  const token = getSetting('ml_token');
  if (!token) throw new Error('Mercado Livre não conectado. Acesse o painel e clique em "Conectar Mercado Livre".');
  if (!forceRefresh && Date.now() < token.expires_at) return token;
  // Evita duas renovações simultâneas (o refresh token só pode ser usado uma vez)
  refreshing ??= requestToken({
    grant_type: 'refresh_token',
    client_id: config.ml.clientId,
    client_secret: config.ml.clientSecret,
    refresh_token: token.refresh_token,
  }).finally(() => { refreshing = null; });
  return refreshing;
}

function connectionStatus() {
  if (config.ml.mock) return { connected: true, mock: true, user_id: '999' };
  const token = getSetting('ml_token');
  return { connected: Boolean(token), mock: false, user_id: token?.user_id || null };
}

module.exports = { buildAuthorizeUrl, exchangeCode, getAccessToken, connectionStatus };
