/* Utilitários compartilhados. Regra: valores nulos/inválidos viram 0, nunca NaN ou negativo. */
window.AC = window.AC || {};

AC.util = {
  num: function (v) {
    if (typeof v === 'string') {
      if (/^\s*-/.test(v)) return 0;
      // Aceita "49,90", "49.90", "1.299,90", "1,299.90" e "R$ 1.299".
      let s = v.replace(/[^\d,.]/g, '');
      const lastC = s.lastIndexOf(','), lastD = s.lastIndexOf('.');
      const dec = Math.max(lastC, lastD);
      const bothSeps = lastC >= 0 && lastD >= 0;
      if (dec >= 0 && (bothSeps || s.length - dec - 1 !== 3)) {
        s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
      } else {
        s = s.replace(/[.,]/g, '');
      }
      v = s;
    }
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  },

  brl: function (v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(AC.util.num(v));
  },

  int: function (v) {
    return new Intl.NumberFormat('pt-BR').format(Math.round(AC.util.num(v)));
  },

  pct: function (part, total) {
    const p = AC.util.num(part), t = AC.util.num(total);
    return t > 0 ? (p / t) * 100 : 0;
  },

  discountPct: function (price, oldPrice) {
    const p = AC.util.num(price), o = AC.util.num(oldPrice);
    return o > p && p > 0 ? Math.round((1 - p / o) * 100) : 0;
  },

  escape: function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  blobToDataURL: function (blob) {
    return new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  },

  loadImage: function (src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('Não foi possível carregar a imagem.')); };
      img.src = src;
    });
  },

  // Reduz a imagem para no máximo `maxSide` px e devolve um Blob JPEG.
  downscale: async function (blobOrUrl, maxSide) {
    const src = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    try {
      const img = await AC.util.loadImage(src);
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      return await new Promise(function (resolve, reject) {
        c.toBlob(function (b) { b ? resolve(b) : reject(new Error('Falha ao converter imagem.')); }, 'image/jpeg', 0.88);
      });
    } finally {
      if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(src);
    }
  },

  // Gerador pseudoaleatório com semente (variações reproduzíveis).
  rng: function (seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) % 100000) / 100000;
    };
  },

  pick: function (arr, rand) {
    return arr[Math.floor(rand() * arr.length) % arr.length];
  },

  download: function (blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  },

  slug: function (s) {
    return String(s || 'video').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'video';
  },

  copy: async function (text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    }
  },
};
