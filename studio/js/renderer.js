/* Agente Montador: renderiza o roteiro em vídeo vertical 9:16 no navegador.
 * Canvas + MediaRecorder (sem servidor, sem custo). Respeita as áreas seguras do
 * TikTok (topo, coluna de botões à direita e legenda/carrinho embaixo).
 */
window.AC = window.AC || {};

AC.THEMES = {
  impacto: { label: 'Impacto (amarelo)', text: '#FFFFFF', stroke: '#000000', accent: '#FACC15', accentText: '#111827', overlay: 'rgba(0,0,0,0.35)', box: false },
  clean:   { label: 'Clean (caixa branca)', text: '#0F172A', stroke: null, accent: '#6366F1', accentText: '#FFFFFF', overlay: 'rgba(15,23,42,0.10)', box: '#FFFFFF' },
  neon:    { label: 'Neon (escuro)', text: '#FFFFFF', stroke: '#0B1120', accent: '#22D3EE', accentText: '#0B1120', overlay: 'rgba(11,17,32,0.55)', box: false, glow: '#22D3EE' },
};

AC.Renderer = function (canvas) {
  const ctx = canvas.getContext('2d');
  const FADE = 0.3;
  let script = null, images = [], theme = AC.THEMES.impacto, music = null, watermark = false;
  let timeline = [], duration = 0;
  let previewRaf = 0, previewAudio = null;

  function setSize(res) {
    const r = AC.config.video.resolutions[res] || AC.config.video.resolutions[AC.config.video.defaultResolution];
    canvas.width = r.w; canvas.height = r.h;
  }

  function load(opts) {
    script = opts.script;
    images = opts.images || [];
    theme = AC.THEMES[opts.theme] || AC.THEMES.impacto;
    music = opts.music || null;
    watermark = !!opts.watermark;
    setSize(opts.resolution);
    let t = 0;
    timeline = script.scenes.map(function (s) {
      const d = Math.max(1, AC.util.num(s.dur) || 2.4);
      const item = { scene: s, start: t, dur: d };
      t += d;
      return item;
    });
    duration = t;
  }

  /* ---------- Desenho ---------- */
  function easeOutBack(x) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  function drawCover(img, zoom, panX, panY, blur) {
    const W = canvas.width, H = canvas.height;
    if (!img) {
      const g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#4F46E5'); g.addColorStop(1, '#22D3EE');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      return;
    }
    const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom;
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const x = (W - w) / 2 + panX * (w - W) / 2;
    const y = (H - h) / 2 + panY * (h - H) / 2;
    ctx.save();
    if (blur) ctx.filter = 'blur(' + blur + 'px) brightness(0.8)';
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  function drawContain(img, cx, cy, maxW, maxH, scale) {
    if (!img) return;
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight) * scale;
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const x = cx - w / 2, y = cy - h / 2, r = canvas.width * 0.04;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = canvas.width * 0.04; ctx.shadowOffsetY = canvas.width * 0.015;
    roundRect(x, y, w, h, r); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowColor = 'transparent';
    roundRect(x, y, w, h, r); ctx.clip();
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrap(text, maxW) {
    const words = String(text).split(/[ \t\n]+/).filter(Boolean); // preserva o espaço fixo de "R$ 79,90"
    const lines = [];
    let line = '';
    words.forEach(function (w) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  // Ajusta o tamanho da fonte até o texto caber na área (máx. 5 linhas).
  function fit(text, maxW, maxH, base, weight) {
    let size = base;
    let lines;
    for (; size > base * 0.35; size *= 0.92) {
      ctx.font = weight + ' ' + Math.round(size) + 'px Manrope, Inter, sans-serif';
      lines = wrap(text, maxW);
      if (lines.length <= 5 && lines.length * size * 1.18 <= maxH && lines.every(function (l) { return ctx.measureText(l).width <= maxW; })) break;
    }
    return { size: Math.round(size), lines: lines };
  }

  function drawTextBlock(text, cx, cy, maxW, maxH, base, opts) {
    opts = opts || {};
    const f = fit(text, maxW, maxH, base, opts.weight || 800);
    const lh = f.size * 1.18;
    const totalH = f.lines.length * lh;
    let y = cy - totalH / 2 + lh / 2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    f.lines.forEach(function (line) {
      const w = ctx.measureText(line).width;
      if (opts.bg) {
        const padX = f.size * 0.35, padY = f.size * 0.14;
        roundRect(cx - w / 2 - padX, y - lh / 2 + padY / 2, w + padX * 2, lh - padY, f.size * 0.22);
        ctx.fillStyle = opts.bg; ctx.fill();
      }
      if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = f.size * 0.5; }
      if (opts.stroke) { ctx.strokeStyle = opts.stroke; ctx.lineWidth = f.size * 0.16; ctx.strokeText(line, cx, y); }
      ctx.fillStyle = opts.color || '#fff';
      ctx.fillText(line, cx, y);
      ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      y += lh;
    });
    return totalH;
  }

  function drawScene(item, local, index) {
    const W = canvas.width, H = canvas.height, s = item.scene;
    const p = clamp01(local / item.dur);
    const pop = easeOutBack(clamp01(local / 0.35));
    const img = images.length ? images[(s.image || 0) % images.length] : null;

    // Área segura do TikTok
    const safeL = W * 0.07, safeR = W * 0.17, safeT = H * 0.13, safeB = H * 0.30;
    const areaW = W - safeL - safeR;
    const cx = safeL + areaW / 2;

    if (s.kind === 'price' || s.kind === 'cta') {
      drawCover(img, 1.15, 0, 0, Math.round(W * 0.035));
      ctx.fillStyle = theme.overlay; ctx.fillRect(0, 0, W, H);
      drawContain(img, cx, safeT + (H - safeT - safeB) * 0.36, areaW * 0.92, H * 0.36, 0.9 + 0.1 * pop);

      const yText = safeT + (H - safeT - safeB) * 0.82;
      ctx.save();
      ctx.translate(cx, yText); ctx.scale(pop, pop); ctx.translate(-cx, -yText);
      if (s.kind === 'price') {
        drawTextBlock(s.text, cx, yText, areaW, H * 0.12, W * 0.15, { color: theme.accentText, bg: theme.accent, weight: 800 });
        if (s.sub) drawTextBlock(s.sub, cx, yText + H * 0.095, areaW, H * 0.06, W * 0.055, { color: '#fff', stroke: '#000', weight: 700 });
      } else {
        drawTextBlock(s.text, cx, yText, areaW, H * 0.13, W * 0.085, { color: theme.accentText, bg: theme.accent, weight: 800 });
        if (s.sub) drawTextBlock(s.sub, cx, yText + H * 0.1, areaW, H * 0.06, W * 0.05, { color: '#fff', stroke: '#000', weight: 700 });
      }
      ctx.restore();
    } else {
      // Ken Burns: zoom suave + pan alternando a direção a cada cena
      const dir = index % 2 === 0 ? 1 : -1;
      drawCover(img, 1.04 + 0.12 * p, dir * (p - 0.5) * 0.6, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.45, 'rgba(0,0,0,0.05)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      if (s.kind === 'hook') { ctx.fillStyle = theme.overlay; ctx.fillRect(0, 0, W, H); }

      const yText = s.kind === 'hook' ? safeT + H * 0.17 : safeT + H * 0.11;
      const base = s.kind === 'hook' ? W * 0.105 : W * 0.085;
      ctx.save();
      ctx.translate(cx, yText); ctx.scale(pop, pop); ctx.translate(-cx, -yText);
      drawTextBlock(s.text, cx, yText, areaW, H * 0.24, base, {
        color: theme.text, stroke: theme.stroke, bg: theme.box || null, glow: theme.glow, weight: 800,
      });
      ctx.restore();
    }
  }

  function drawWatermark() {
    if (!watermark) return;
    const W = canvas.width, H = canvas.height;
    ctx.font = '600 ' + Math.round(W * 0.028) + 'px Inter, sans-serif';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('Feito com ' + AC.config.appName, W * 0.05, H * 0.06);
  }

  function drawAt(t) {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (!timeline.length) return;
    t = Math.max(0, Math.min(t, duration - 0.001));
    let i = timeline.findIndex(function (it) { return t >= it.start && t < it.start + it.dur; });
    if (i < 0) i = timeline.length - 1;
    const cur = timeline[i], local = t - cur.start;
    if (i > 0 && local < FADE) {
      const prev = timeline[i - 1];
      drawScene(prev, prev.dur, i - 1);
      ctx.save(); ctx.globalAlpha = clamp01(local / FADE);
      drawScene(cur, local, i);
      ctx.restore();
    } else {
      drawScene(cur, local, i);
    }
    // Barra de progresso fina no topo (retém atenção)
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(0, 0, W, H * 0.004);
    ctx.fillStyle = theme.accent; ctx.fillRect(0, 0, W * (t / duration), H * 0.004);
    drawWatermark();
  }

  /* ---------- Áudio ---------- */
  function startAudio(destination) {
    if (!music) return null;
    const ac = destination.context;
    const src = ac.createBufferSource();
    src.buffer = music.buffer;
    src.loop = music.buffer.duration < duration;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(music.volume, ac.currentTime);
    // fade-out no último 0,8 s
    gain.gain.setValueAtTime(music.volume, ac.currentTime + Math.max(0, duration - 0.8));
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + duration);
    src.connect(gain).connect(destination);
    src.start();
    return src;
  }

  /* ---------- Preview ---------- */
  function stopPreview() {
    cancelAnimationFrame(previewRaf);
    if (previewAudio) { try { previewAudio.stop(); } catch (e) {} previewAudio = null; }
  }

  function play(onTick) {
    stopPreview();
    if (music) previewAudio = startAudio(music.ctx.destination);
    const t0 = performance.now();
    function frame(now) {
      const t = (now - t0) / 1000;
      drawAt(t);
      if (onTick) onTick(t, duration);
      if (t < duration) previewRaf = requestAnimationFrame(frame);
      else stopPreview();
    }
    previewRaf = requestAnimationFrame(frame);
  }

  /* ---------- Gravação ---------- */
  function pickMime() {
    const candidates = [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    return candidates.find(function (m) { return window.MediaRecorder && MediaRecorder.isTypeSupported(m); }) || '';
  }

  function record(onProgress) {
    stopPreview();
    return new Promise(function (resolve, reject) {
      if (!window.MediaRecorder || !canvas.captureStream) {
        reject(new Error('Seu navegador não suporta gravação de vídeo. Use o Google Chrome ou Edge atualizado.'));
        return;
      }
      const fps = AC.config.video.fps;
      const stream = canvas.captureStream(fps);
      let audioSrc = null, dest = null;
      if (music) {
        dest = music.ctx.createMediaStreamDestination();
        dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
      }
      const mime = pickMime();
      let rec;
      try {
        rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: AC.config.video.bitrate } : { videoBitsPerSecond: AC.config.video.bitrate });
      } catch (e) { reject(e); return; }
      const chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = function (e) { reject(e.error || new Error('Erro na gravação.')); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
        resolve({ blob: new Blob(chunks, { type: type }), ext: type.indexOf('mp4') >= 0 ? 'mp4' : 'webm', duration: duration });
      };

      drawAt(0);
      rec.start(250);
      if (dest) audioSrc = startAudio(dest);
      const t0 = performance.now();
      function frame(now) {
        const t = (now - t0) / 1000;
        drawAt(t);
        if (onProgress) onProgress(Math.min(1, t / duration));
        if (t < duration) requestAnimationFrame(frame);
        else {
          if (audioSrc) { try { audioSrc.stop(); } catch (e) {} }
          setTimeout(function () { rec.stop(); }, 150);
        }
      }
      requestAnimationFrame(frame);
    });
  }

  return {
    load: load,
    drawAt: drawAt,
    play: play,
    stop: stopPreview,
    record: record,
    get duration() { return duration; },
    mimeLabel: function () { const m = pickMime(); return m.indexOf('mp4') >= 0 ? 'MP4' : (m ? 'WEBM' : 'indisponível'); },
  };
};

/* Carrega um arquivo de áudio para usar como trilha (decodificado uma vez). */
AC.loadMusic = async function (file, volume) {
  const ctx = AC._audioCtx || (AC._audioCtx = new (window.AudioContext || window.webkitAudioContext)());
  if (ctx.state === 'suspended') await ctx.resume();
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  return { ctx: ctx, buffer: buf, volume: volume == null ? 0.6 : volume, name: file.name };
};
