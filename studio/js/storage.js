/* Camada de dados.
 * A UI só conversa com AC.repo (interface única). Hoje a implementação é local
 * (metadados em localStorage, imagens em IndexedDB). Para o SaaS, basta criar
 * um SupabaseRepo com os mesmos métodos e trocar em AC.repo — ver docs/ARQUITETURA.md.
 */
window.AC = window.AC || {};

AC.uid = function (prefix) {
  const rnd = Math.random().toString(36).slice(2, 8);
  return (prefix || 'id') + '_' + Date.now().toString(36) + rnd;
};

/* ---------- Blobs (imagens) em IndexedDB ---------- */
AC.blobs = (function () {
  const DB_NAME = 'afiliaclip';
  const STORE = 'blobs';
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        t.oncomplete = function () { resolve(req ? req.result : undefined); };
        t.onerror = function () { reject(t.error); };
      });
    });
  }

  const cache = new Map(); // id -> objectURL

  return {
    put: function (id, blob) {
      cache.delete(id);
      return tx('readwrite', function (s) { return s.put(blob, id); });
    },
    get: function (id) {
      return tx('readonly', function (s) { return s.get(id); });
    },
    remove: function (id) {
      if (cache.has(id)) { URL.revokeObjectURL(cache.get(id)); cache.delete(id); }
      return tx('readwrite', function (s) { return s.delete(id); });
    },
    url: function (id) {
      if (cache.has(id)) return Promise.resolve(cache.get(id));
      return this.get(id).then(function (blob) {
        if (!blob) return null;
        const u = URL.createObjectURL(blob);
        cache.set(id, u);
        return u;
      });
    },
  };
})();

/* ---------- Repositório local ---------- */
AC.LocalRepo = function (workspaceId) {
  const KEY = 'afiliaclip:v1:' + workspaceId;

  function empty() {
    return { products: [], scripts: [], videos: [], settings: {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return empty();
      const data = JSON.parse(raw);
      return Object.assign(empty(), data);
    } catch (e) {
      console.warn('Falha ao ler dados locais; iniciando vazio.', e);
      return empty();
    }
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Falha ao salvar dados locais.', e);
      throw new Error('Não foi possível salvar. O armazenamento do navegador pode estar cheio ou bloqueado.');
    }
  }

  function upsert(list, item) {
    const i = list.findIndex(function (x) { return x.id === item.id; });
    if (i >= 0) list[i] = item; else list.unshift(item);
  }

  return {
    // Produtos
    listProducts: function () { return state.products.slice(); },
    getProduct: function (id) { return state.products.find(function (p) { return p.id === id; }) || null; },
    saveProduct: function (p) {
      const now = new Date().toISOString();
      const item = Object.assign({ id: AC.uid('prd'), createdAt: now, imageIds: [] }, p, { updatedAt: now });
      upsert(state.products, item);
      save();
      return item;
    },
    deleteProduct: function (id) {
      const p = this.getProduct(id);
      if (p) (p.imageIds || []).forEach(function (bid) { AC.blobs.remove(bid); });
      state.products = state.products.filter(function (x) { return x.id !== id; });
      state.scripts = state.scripts.filter(function (x) { return x.productId !== id; });
      save();
    },

    // Roteiros
    listScripts: function (productId) {
      return state.scripts.filter(function (s) { return !productId || s.productId === productId; });
    },
    saveScript: function (s) {
      const item = Object.assign({ id: AC.uid('scr'), createdAt: new Date().toISOString() }, s);
      upsert(state.scripts, item);
      save();
      return item;
    },

    // Vídeos renderizados (só o registro + desempenho; o arquivo vai para download)
    listVideos: function () { return state.videos.slice(); },
    saveVideo: function (v) {
      const item = Object.assign({
        id: AC.uid('vid'), createdAt: new Date().toISOString(),
        status: 'gerado', views: 0, clicks: 0, sales: 0, commission: 0,
      }, v);
      upsert(state.videos, item);
      save();
      return item;
    },
    updateVideo: function (id, patch) {
      const v = state.videos.find(function (x) { return x.id === id; });
      if (!v) return null;
      Object.assign(v, patch);
      save();
      return v;
    },
    deleteVideo: function (id) {
      state.videos = state.videos.filter(function (x) { return x.id !== id; });
      save();
    },

    // Configurações
    getSettings: function () { return Object.assign({}, state.settings); },
    saveSettings: function (patch) { Object.assign(state.settings, patch); save(); },

    // Backup
    exportAll: async function () {
      const images = {};
      for (const p of state.products) {
        for (const bid of p.imageIds || []) {
          const blob = await AC.blobs.get(bid);
          if (blob) images[bid] = await AC.util.blobToDataURL(blob);
        }
      }
      return { app: AC.config.appName, version: AC.config.version, exportedAt: new Date().toISOString(), data: state, images: images };
    },
    importAll: async function (payload) {
      if (!payload || !payload.data) throw new Error('Arquivo de backup inválido.');
      const images = payload.images || {};
      for (const bid of Object.keys(images)) {
        const blob = await (await fetch(images[bid])).blob();
        await AC.blobs.put(bid, blob);
      }
      state = Object.assign(empty(), payload.data);
      save();
    },
  };
};

AC.repo = AC.LocalRepo(AC.config.workspaceId);
