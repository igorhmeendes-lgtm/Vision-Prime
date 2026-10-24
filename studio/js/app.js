/* AfiliaClip Studio — orquestração da interface. */
(function () {
  const U = AC.util, repo = AC.repo, C = AC.copy;
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  const state = {
    view: 'dashboard',
    product: null,          // produto em edição/uso
    pending: [],            // fotos no formulário: { blobId?, blob?, url }
    scripts: [],            // variações geradas
    script: null,           // roteiro escolhido (cópia editável)
    images: [],             // HTMLImageElement do produto atual
    music: null,
    renderer: null,
    rendering: false,
  };

  /* ---------- Toast ---------- */
  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3200);
  }

  /* ---------- Tema claro/escuro ---------- */
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    $('#btn-theme').textContent = dark ? '☀️' : '🌙';
  }
  (function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('afiliaclip:theme'); } catch (e) {}
    applyTheme(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    $('#btn-theme').addEventListener('click', function () {
      const dark = !document.documentElement.classList.contains('dark');
      applyTheme(dark);
      try { localStorage.setItem('afiliaclip:theme', dark ? 'dark' : 'light'); } catch (e) {}
    });
  })();

  /* ---------- Navegação ---------- */
  const TITLES = { dashboard: 'Painel', create: 'Criar vídeo', products: 'Produtos', videos: 'Vídeos & resultados', settings: 'Configurações' };
  function go(view) {
    if (state.rendering) { toast('Aguarde a gravação terminar.'); return; }
    state.view = view;
    $$('[data-panel]').forEach(function (p) { p.hidden = p.dataset.panel !== view; });
    $$('#nav .nav-btn').forEach(function (b) { b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'); });
    $('#nav-mobile').value = view;
    $('#view-title').textContent = TITLES[view];
    if (state.renderer && view !== 'create') state.renderer.stop();
    if (view === 'dashboard') renderDashboard();
    if (view === 'products') renderProducts();
    if (view === 'videos') renderVideos();
    if (view === 'settings') renderSettings();
    if (view === 'create') refreshProductPicker();
  }
  $$('#nav .nav-btn').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.view); }); });
  $('#nav-mobile').addEventListener('change', function (e) { go(e.target.value); });
  $('#btn-new').addEventListener('click', function () { resetForm(); go('create'); step(1); });

  function step(n) {
    $$('[data-stepbox]').forEach(function (b) { b.hidden = Number(b.dataset.stepbox) !== n; });
    $$('#stepper .step').forEach(function (s) {
      const active = Number(s.dataset.step) === n;
      s.classList.toggle('bg-accent', active);
      s.classList.toggle('text-white', active);
      s.classList.toggle('border-accent', active);
    });
    if (n !== 3 && state.renderer) state.renderer.stop();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ---------- Painel (KPIs) ---------- */
  function videoStats(list) {
    const posted = list.filter(function (v) { return v.status === 'postado'; });
    const sum = function (k) { return posted.reduce(function (a, v) { return a + U.num(v[k]); }, 0); };
    return { total: list.length, posted: posted.length, views: sum('views'), clicks: sum('clicks'), sales: sum('sales'), commission: sum('commission') };
  }

  function kpiCard(label, value, hint, accent) {
    return '<div class="surface border border-app rounded-2xl p-5">' +
      '<p class="text-xs font-semibold uppercase tracking-wide text-slate-500">' + U.escape(label) + '</p>' +
      '<p class="font-display font-extrabold text-2xl md:text-3xl mt-1 ' + (accent ? 'gradient-text' : '') + '">' + value + '</p>' +
      '<p class="text-xs text-slate-500 mt-1">' + hint + '</p></div>';
  }

  function renderDashboard() {
    const vids = repo.listVideos();
    const s = videoStats(vids);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const thisMonth = vids.filter(function (v) { return new Date(v.createdAt) >= monthStart; }).length;
    const hours = (s.total * AC.config.manualMinutesPerVideo) / 60;
    $('#kpis').innerHTML =
      kpiCard('Vídeos gerados', U.int(s.total), U.int(thisMonth) + ' este mês • ' + U.int(repo.listProducts().length) + ' produtos', false) +
      kpiCard('Visualizações', U.int(s.views), U.int(s.posted) + ' vídeos postados', false) +
      kpiCard('Comissão total', U.brl(s.commission), U.int(s.sales) + ' vendas', true) +
      kpiCard('Conversão', U.pct(s.sales, s.clicks).toFixed(1).replace('.', ',') + '%', 'vendas ÷ cliques • ~' + hours.toFixed(1).replace('.', ',') + ' h economizadas', false);

    // Desempenho por ângulo
    const rows = Object.keys(C.ANGLES).map(function (a) {
      const st = videoStats(vids.filter(function (v) { return v.angle === a; }));
      return { angle: a, label: C.ANGLES[a].label, st: st, avgViews: st.posted ? st.views / st.posted : 0, conv: U.pct(st.sales, st.clicks) };
    });
    const best = rows.slice().sort(function (x, y) { return (y.conv - x.conv) || (y.avgViews - x.avgViews); })[0];
    const hasData = rows.some(function (r) { return r.st.posted > 0; });
    $('#angle-table').innerHTML = hasData
      ? '<div class="overflow-x-auto"><table class="w-full text-sm"><thead class="text-xs uppercase text-slate-500 text-left"><tr><th class="py-2">Ângulo</th><th>Postados</th><th>Views médias</th><th>Vendas</th><th>Conversão</th><th>Comissão</th></tr></thead><tbody>' +
        rows.map(function (r) {
          const win = best && r.angle === best.angle && r.st.posted > 0;
          return '<tr class="border-t border-app"><td class="py-2 font-semibold">' + U.escape(r.label) + (win ? ' <span class="ml-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600">vencedor</span>' : '') + '</td>' +
            '<td>' + U.int(r.st.posted) + '</td><td>' + U.int(r.avgViews) + '</td><td>' + U.int(r.st.sales) + '</td>' +
            '<td>' + r.conv.toFixed(1).replace('.', ',') + '%</td><td>' + U.brl(r.st.commission) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
      : '<div class="text-sm text-slate-500 border border-dashed border-app rounded-xl p-6 text-center">Ainda sem dados. Gere um vídeo, poste e registre os números em <button class="text-accent font-semibold" data-goto="videos">Vídeos & resultados</button>.</div>';

    const recent = vids.slice(0, 6);
    $('#recent-videos').innerHTML = recent.length
      ? recent.map(function (v) {
          return '<li class="flex items-center justify-between gap-2 border-b border-app pb-2"><span class="truncate"><b>' + U.escape(v.productName) + '</b><br><span class="text-xs text-slate-500">' + U.escape(v.angleLabel) + ' • ' + new Date(v.createdAt).toLocaleDateString('pt-BR') + '</span></span>' +
            '<span class="text-xs px-2 py-0.5 rounded-full ' + (v.status === 'postado' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-slate-500/15 text-slate-500') + '">' + U.escape(v.status) + '</span></li>';
        }).join('')
      : '<li class="text-slate-500">Nenhum vídeo ainda. <button class="text-accent font-semibold" data-goto="create">Criar o primeiro</button></li>';
  }
  document.addEventListener('click', function (e) {
    const g = e.target.closest('[data-goto]');
    if (g) { if (g.dataset.goto === 'create') resetForm(); go(g.dataset.goto); if (g.dataset.goto === 'create') step(1); }
  });

  /* ---------- Passo 1: produto ---------- */
  const form = $('#product-form');
  $('#pf-cat').innerHTML = Object.keys(C.CATEGORIES).map(function (k) { return '<option value="' + k + '">' + U.escape(C.CATEGORIES[k].label) + '</option>'; }).join('');

  const CAT_KEYWORDS = {
    cozinha: /panela|frigideira|cozinha|faca|tábua|tabua|air ?fryer|liquidificador|pote|garrafa|copo|utens[ií]lio/i,
    casa: /organiz|limpeza|mop|vassoura|cabide|toalha|cortina|tapete|luminária|luminaria|decor/i,
    beleza: /skin|sérum|serum|creme|batom|maquiagem|base|pincel|cabelo|chapinha|secador|perfume/i,
    moda: /vestido|blusa|camis|cal[çc]a|t[êe]nis|bolsa|rel[óo]gio|óculos|oculos|brinco|colar/i,
    tecnologia: /fone|bluetooth|carregador|cabo|usb|celular|smart|led|caixa de som|power ?bank|mouse|teclado/i,
    fitness: /academia|treino|halter|el[áa]stico|yoga|fitness|garrafa t[ée]rmica|massage/i,
    pet: /pet|cachorro|gato|coleira|ra[çc][ãa]o|arranhador/i,
    infantil: /beb[êe]|infantil|criança|crianca|brinquedo|mamadeira|fralda/i,
    automotivo: /carro|automotivo|veicular|volante|painel/i,
  };
  function guessCategory(name) {
    const k = Object.keys(CAT_KEYWORDS).find(function (c) { return CAT_KEYWORDS[c].test(name || ''); });
    return k || 'geral';
  }

  function resetForm() {
    form.reset();
    form.elements.id.value = '';
    state.pending.forEach(function (p) { if (p.blob) URL.revokeObjectURL(p.url); });
    state.pending = [];
    renderThumbs();
    $('#pf-img-msg').hidden = true;
    $('[data-error="name"]').hidden = true;
  }
  $('#pf-clear').addEventListener('click', resetForm);

  async function fillForm(p) {
    resetForm();
    form.elements.id.value = p.id || '';
    form.elements.url.value = p.url || '';
    form.elements.name.value = p.name || '';
    form.elements.price.value = U.num(p.price) ? U.num(p.price).toFixed(2).replace('.', ',') : '';
    form.elements.oldPrice.value = U.num(p.oldPrice) ? U.num(p.oldPrice).toFixed(2).replace('.', ',') : '';
    form.elements.category.value = p.category || guessCategory(p.name);
    form.elements.commissionPct.value = U.num(p.commissionPct) ? String(U.num(p.commissionPct)).replace('.', ',') : '';
    form.elements.benefits.value = (p.benefits || []).join('\n');
    form.elements.pain.value = p.pain || '';
    for (const bid of p.imageIds || []) {
      const url = await AC.blobs.url(bid);
      if (url) state.pending.push({ blobId: bid, url: url });
    }
    renderThumbs();
  }

  function renderThumbs() {
    $('#pf-thumbs').innerHTML = state.pending.map(function (p, i) {
      return '<div class="relative aspect-square rounded-lg overflow-hidden border border-app">' +
        '<img src="' + p.url + '" alt="Foto ' + (i + 1) + '" class="w-full h-full object-cover">' +
        '<button type="button" data-rm="' + i + '" class="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs" aria-label="Remover foto ' + (i + 1) + '">✕</button>' +
        (i === 0 ? '<span class="absolute bottom-1 left-1 text-[10px] px-1.5 rounded bg-accent text-white">capa</span>' : '') + '</div>';
    }).join('');
  }
  $('#pf-thumbs').addEventListener('click', function (e) {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    const [removed] = state.pending.splice(Number(b.dataset.rm), 1);
    if (removed && removed.blob) URL.revokeObjectURL(removed.url);
    renderThumbs();
  });

  async function addFiles(files) {
    for (const f of Array.from(files).filter(function (f) { return /^image\//.test(f.type); })) {
      try {
        const blob = await U.downscale(f, AC.config.video.maxImageSide);
        state.pending.push({ blob: blob, url: URL.createObjectURL(blob) });
      } catch (err) { toast('Não consegui ler a imagem ' + f.name + '.'); }
    }
    renderThumbs();
  }
  $('#pf-files').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  const drop = $('#pf-files').closest('label');
  ['dragover', 'dragenter'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('border-accent'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function () { drop.classList.remove('border-accent'); }); });
  drop.addEventListener('drop', function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const name = form.elements.name.value.trim();
    $('[data-error="name"]').hidden = !!name;
    if (!name) { form.elements.name.focus(); return; }
    if (!state.pending.length) {
      const msg = $('#pf-img-msg');
      msg.textContent = 'Adicione pelo menos 1 foto do produto — ela é a base do vídeo.';
      msg.hidden = false;
      return;
    }
    const plan = AC.plan();
    if (!form.elements.id.value && repo.listProducts().length >= plan.maxProducts) {
      toast('Seu plano permite até ' + plan.maxProducts + ' produtos.');
      return;
    }
    const prev = form.elements.id.value ? repo.getProduct(form.elements.id.value) : null;
    const keptIds = [];
    for (const p of state.pending) {
      if (p.blobId) { keptIds.push(p.blobId); continue; }
      const id = AC.uid('img');
      await AC.blobs.put(id, p.blob);
      p.blobId = id;
      keptIds.push(id);
    }
    if (prev) (prev.imageIds || []).filter(function (id) { return keptIds.indexOf(id) < 0; }).forEach(function (id) { AC.blobs.remove(id); });

    let saved;
    try {
      saved = repo.saveProduct(Object.assign(prev || {}, {
        url: form.elements.url.value.trim(),
        name: name,
        price: U.num(form.elements.price.value),
        oldPrice: U.num(form.elements.oldPrice.value),
        category: form.elements.category.value,
        commissionPct: U.num(form.elements.commissionPct.value),
        benefits: form.elements.benefits.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean),
        pain: form.elements.pain.value.trim(),
        imageIds: keptIds,
      }));
    } catch (err) { toast(err.message); return; }
    form.elements.id.value = saved.id;
    await useProduct(saved.id);
  });

  function refreshProductPicker() {
    const sel = $('#pick-product');
    sel.innerHTML = '<option value="">Selecione…</option>' + repo.listProducts().map(function (p) {
      return '<option value="' + p.id + '">' + U.escape(p.name) + '</option>';
    }).join('');
  }
  $('#pick-product').addEventListener('change', function (e) { if (e.target.value) useProduct(e.target.value); });

  async function useProduct(id) {
    const p = repo.getProduct(id);
    if (!p) return;
    state.product = p;
    state.images = [];
    for (const bid of p.imageIds || []) {
      const url = await AC.blobs.url(bid);
      if (url) { try { state.images.push(await U.loadImage(url)); } catch (e) {} }
    }
    generateScripts();
    go('create');
    step(2);
  }

  /* ---------- Passo 2: roteiros ---------- */
  function generateScripts() {
    state.scripts = C.generate(state.product, { cta: $('#s2-cta').value, seed: Math.floor(Math.random() * 1e9) });
    renderScripts();
  }

  function renderScripts() {
    $('#s2-product').textContent = state.product.name;
    $('#s2-scripts').innerHTML = state.scripts.map(function (s, i) {
      const issues = C.checkScript(s);
      const total = s.scenes.reduce(function (a, sc) { return a + U.num(sc.dur); }, 0);
      return '<article class="surface border border-app rounded-2xl p-5 flex flex-col">' +
        '<div class="flex items-center justify-between mb-2"><span class="text-xs font-bold uppercase tracking-wide text-accent">' + U.escape(s.angleLabel) + '</span><span class="text-xs text-slate-500">' + total.toFixed(0) + 's • ' + s.scenes.length + ' cenas</span></div>' +
        '<p class="text-xs text-slate-500 mb-3">' + U.escape(s.angleDesc) + '</p>' +
        '<p class="font-display font-extrabold text-lg leading-snug mb-3">“' + U.escape(s.hook) + '”</p>' +
        '<ol class="text-sm space-y-1 mb-4 list-decimal list-inside text-slate-600 dark:text-slate-300">' + s.scenes.slice(1).map(function (sc) { return '<li>' + U.escape(sc.text) + (sc.sub ? ' <span class="text-slate-400">— ' + U.escape(sc.sub) + '</span>' : '') + '</li>'; }).join('') + '</ol>' +
        (issues.length ? '<p class="text-xs text-amber-600 mb-3">⚠️ ' + issues.length + ' alerta(s) de conformidade</p>' : '<p class="text-xs text-emerald-600 mb-3">✓ Sem alertas de conformidade</p>') +
        '<button data-use="' + i + '" class="mt-auto gradient-btn text-white font-semibold px-4 py-2.5 rounded-xl">Usar este roteiro →</button></article>';
    }).join('');
  }
  $('#s2-scripts').addEventListener('click', function (e) {
    const b = e.target.closest('[data-use]');
    if (!b) return;
    state.script = JSON.parse(JSON.stringify(state.scripts[Number(b.dataset.use)]));
    openEditor();
  });
  $('#s2-regen').addEventListener('click', generateScripts);
  $('#s2-cta').addEventListener('change', generateScripts);
  $('#s2-back').addEventListener('click', function () { fillForm(state.product); step(1); });
  $('#s2-ai').addEventListener('click', function () { $('#s2-ai-box').hidden = !$('#s2-ai-box').hidden; });
  $('#s2-copy-prompt').addEventListener('click', async function () {
    const ok = await U.copy(C.aiPrompt(state.product));
    toast(ok ? 'Prompt copiado! Cole no Claude.ai ou no ChatGPT.' : 'Não consegui copiar automaticamente.');
  });
  $('#s2-ai-apply').addEventListener('click', function () {
    const err = $('#s2-ai-err');
    try {
      state.scripts = C.fromAI($('#s2-ai-json').value, state.product);
      err.hidden = true;
      renderScripts();
      toast('Roteiros da IA carregados.');
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
  });

  /* ---------- Passo 3: editor + render ---------- */
  $('#s3-theme').innerHTML = Object.keys(AC.THEMES).map(function (k) { return '<option value="' + k + '">' + AC.THEMES[k].label + '</option>'; }).join('');
  $('#s3-res').value = AC.config.video.defaultResolution;

  function rendererOpts() {
    if (state.music) state.music.volume = Number($('#s3-vol').value);
    return {
      script: state.script, images: state.images, theme: $('#s3-theme').value,
      resolution: $('#s3-res').value, music: state.music, watermark: AC.plan().watermark,
    };
  }

  function reloadPreview(t) {
    state.renderer.load(rendererOpts());
    state.renderer.drawAt(t || 0.6);
    $('#s3-dur').textContent = 'Duração total: ' + state.renderer.duration.toFixed(1).replace('.', ',') + 's';
  }

  async function openEditor() {
    if (document.fonts && document.fonts.load) {
      try { await Promise.all([document.fonts.load('800 40px Manrope'), document.fonts.load('700 40px Manrope'), document.fonts.load('600 20px Inter')]); } catch (e) {}
    }
    if (!state.renderer) state.renderer = AC.Renderer($('#canvas'));
    $('#s3-mime').textContent = state.renderer.mimeLabel();
    $('#s3-caption').value = state.script.caption;
    $('#s3-narration').value = state.script.narration;
    $('#s3-status').textContent = '';
    renderSceneEditor();
    renderIssues();
    step(3);
    reloadPreview();
  }

  function renderSceneEditor() {
    const imgOpts = function (sel) {
      return state.images.map(function (_, i) { return '<option value="' + i + '"' + (i === sel ? ' selected' : '') + '>Foto ' + (i + 1) + '</option>'; }).join('');
    };
    const KIND = { hook: 'Gancho', image: 'Benefício', price: 'Preço', cta: 'Chamada (CTA)' };
    $('#s3-scenes').innerHTML = state.script.scenes.map(function (s, i) {
      const hasSub = s.kind === 'price' || s.kind === 'cta';
      return '<div class="border border-app rounded-xl p-3" data-scene="' + i + '">' +
        '<div class="flex items-center justify-between gap-2 mb-2"><span class="text-xs font-bold uppercase text-slate-500">' + (i + 1) + '. ' + KIND[s.kind] + '</span>' +
        '<div class="flex items-center gap-2">' +
        '<select data-f="image" class="field !py-1 !px-2 text-xs w-auto" aria-label="Foto da cena ' + (i + 1) + '">' + imgOpts(s.image || 0) + '</select>' +
        '<label class="text-xs flex items-center gap-1">Duração <input data-f="dur" type="number" min="1" max="8" step="0.1" value="' + U.num(s.dur) + '" class="field !py-1 !px-2 w-16 text-xs"></label>' +
        '<button data-del="' + i + '" class="text-xs text-rose-500 font-semibold" aria-label="Excluir cena ' + (i + 1) + '">Excluir</button></div></div>' +
        '<input data-f="text" class="field text-sm" value="' + U.escape(s.text) + '" aria-label="Texto da cena ' + (i + 1) + '">' +
        (hasSub ? '<input data-f="sub" class="field text-sm mt-2" value="' + U.escape(s.sub || '') + '" placeholder="Subtítulo" aria-label="Subtítulo da cena ' + (i + 1) + '">' : '') +
        '</div>';
    }).join('') +
      '<button id="s3-add" class="w-full border border-dashed border-app rounded-xl py-2 text-sm font-semibold text-accent">+ Adicionar cena de benefício</button>';
  }

  $('#s3-scenes').addEventListener('input', function (e) {
    const box = e.target.closest('[data-scene]');
    if (!box || !e.target.dataset.f) return;
    const sc = state.script.scenes[Number(box.dataset.scene)];
    const f = e.target.dataset.f;
    sc[f] = f === 'dur' ? Math.min(8, Math.max(1, U.num(e.target.value) || 1)) : f === 'image' ? Number(e.target.value) : e.target.value;
    if (f === 'text' && sc.kind === 'hook') state.script.hook = sc.text;
    reloadPreview(timeOfScene(Number(box.dataset.scene)));
    renderIssues();
  });
  $('#s3-scenes').addEventListener('click', function (e) {
    const del = e.target.closest('[data-del]');
    if (del) {
      if (state.script.scenes.length <= 1) { toast('O vídeo precisa de pelo menos 1 cena.'); return; }
      state.script.scenes.splice(Number(del.dataset.del), 1);
      renderSceneEditor(); reloadPreview(); return;
    }
    if (e.target.id === 's3-add') {
      const at = state.script.scenes.findIndex(function (s) { return s.kind === 'price' || s.kind === 'cta'; });
      const scene = { kind: 'image', text: 'Novo benefício', image: 0, dur: 2.3 };
      if (at < 0) state.script.scenes.push(scene); else state.script.scenes.splice(at, 0, scene);
      renderSceneEditor(); reloadPreview();
    }
  });
  function timeOfScene(i) {
    let t = 0;
    for (let k = 0; k < i; k++) t += U.num(state.script.scenes[k].dur);
    return t + Math.min(0.8, U.num(state.script.scenes[i].dur) * 0.6);
  }

  function renderIssues() {
    state.script.caption = $('#s3-caption').value;
    state.script.narration = $('#s3-narration').value;
    const issues = C.checkScript(state.script);
    $('#s3-issues').innerHTML = issues.length
      ? '<div class="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 text-sm"><p class="font-semibold text-amber-700 dark:text-amber-400 mb-1">Alertas de conformidade (TikTok / CONAR)</p><ul class="list-disc list-inside text-amber-700 dark:text-amber-300">' + issues.map(function (i) { return '<li>' + U.escape(i) + '</li>'; }).join('') + '</ul></div>'
      : '<p class="text-sm text-emerald-600">✓ Nenhum alerta de conformidade. Lembre-se de ativar a marcação de conteúdo comercial ao postar.</p>';
  }
  $('#s3-caption').addEventListener('input', renderIssues);
  $('#s3-narration').addEventListener('input', renderIssues);

  ['#s3-theme', '#s3-res'].forEach(function (id) { $(id).addEventListener('change', function () { reloadPreview(); }); });
  $('#s3-vol').addEventListener('input', function () { if (state.music) state.music.volume = Number($('#s3-vol').value); });
  $('#s3-safe').addEventListener('change', function (e) { $('#safe-overlay').hidden = !e.target.checked; });
  $('#s3-music').addEventListener('change', async function (e) {
    const f = e.target.files[0];
    if (!f) { state.music = null; return; }
    try {
      state.music = await AC.loadMusic(f, Number($('#s3-vol').value));
      toast('Música carregada: ' + f.name);
    } catch (err) { state.music = null; e.target.value = ''; toast('Não consegui ler esse áudio. Tente um MP3.'); }
  });

  function setProgress(t, d) {
    const p = d > 0 ? Math.min(1, t / d) : 0;
    $('#s3-progress').style.width = (p * 100).toFixed(1) + '%';
    $('#s3-time').textContent = Math.min(t, d).toFixed(1).replace('.', ',') + 's / ' + d.toFixed(1).replace('.', ',') + 's';
  }

  $('#s3-play').addEventListener('click', async function () {
    if (state.rendering) return;
    if (state.music && state.music.ctx.state === 'suspended') await state.music.ctx.resume();
    state.renderer.load(rendererOpts());
    state.renderer.play(setProgress);
  });

  $('#s3-back').addEventListener('click', function () { if (!state.rendering) step(2); });

  $('#s3-render').addEventListener('click', async function () {
    if (state.rendering) return;
    const plan = AC.plan();
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const used = repo.listVideos().filter(function (v) { return new Date(v.createdAt) >= monthStart; }).length;
    if (used >= plan.videosPerMonth) { toast('Limite de ' + plan.videosPerMonth + ' vídeos/mês do plano atingido.'); return; }

    state.rendering = true;
    const btn = $('#s3-render');
    btn.disabled = true; btn.classList.add('opacity-60');
    $('#s3-status').textContent = '⏺ Gravando… mantenha esta aba aberta.';
    try {
      if (state.music && state.music.ctx.state === 'suspended') await state.music.ctx.resume();
      state.renderer.load(rendererOpts());
      const out = await state.renderer.record(function (p) { setProgress(p * state.renderer.duration, state.renderer.duration); });
      const fname = U.slug(state.product.name) + '-' + state.script.angle + '-' + new Date().toISOString().slice(0, 10) + '.' + out.ext;
      U.download(out.blob, fname);
      const saved = repo.saveScript({ productId: state.product.id, angle: state.script.angle, hook: state.script.hook, scenes: state.script.scenes, caption: state.script.caption, narration: state.script.narration });
      repo.saveVideo({
        productId: state.product.id, productName: state.product.name, scriptId: saved.id,
        angle: state.script.angle, angleLabel: state.script.angleLabel, hook: state.script.hook,
        duration: Number(out.duration.toFixed(1)), format: out.ext, theme: $('#s3-theme').value, fileName: fname,
      });
      $('#s3-status').textContent = '✅ Vídeo baixado: ' + fname + ' (' + (out.blob.size / 1048576).toFixed(1).replace('.', ',') + ' MB). Copie a legenda e poste!';
    } catch (err) {
      console.error(err);
      $('#s3-status').textContent = '❌ Não foi possível gravar: ' + (err && err.message ? err.message : 'erro desconhecido') + ' Tente a resolução 720.';
    } finally {
      state.rendering = false;
      btn.disabled = false; btn.classList.remove('opacity-60');
    }
  });

  $$('[data-copy]').forEach(function (b) {
    b.addEventListener('click', async function () {
      const ok = await U.copy($('#' + b.dataset.copy).value);
      toast(ok ? 'Copiado!' : 'Não consegui copiar.');
    });
  });

  /* ---------- Produtos ---------- */
  async function renderProducts() {
    const q = $('#prod-search').value.trim().toLowerCase();
    const list = repo.listProducts().filter(function (p) { return !q || p.name.toLowerCase().indexOf(q) >= 0; });
    const grid = $('#prod-grid');
    if (!list.length) {
      grid.innerHTML = '<div class="sm:col-span-2 lg:col-span-3 surface border border-dashed border-app rounded-2xl p-10 text-center">' +
        '<p class="font-display font-bold mb-1">' + (q ? 'Nenhum produto encontrado' : 'Nenhum produto cadastrado') + '</p>' +
        '<p class="text-sm text-slate-500 mb-4">' + (q ? 'Tente outro termo de busca.' : 'Cadastre seu primeiro produto da vitrine para gerar vídeos.') + '</p>' +
        (q ? '' : '<button data-goto="create" class="gradient-btn text-white font-semibold px-4 py-2 rounded-xl text-sm">Cadastrar produto</button>') + '</div>';
      return;
    }
    const counts = {};
    repo.listVideos().forEach(function (v) { counts[v.productId] = (counts[v.productId] || 0) + 1; });
    const cards = await Promise.all(list.map(async function (p) {
      const cover = p.imageIds && p.imageIds[0] ? await AC.blobs.url(p.imageIds[0]) : '';
      const off = U.discountPct(p.price, p.oldPrice);
      return '<article class="surface border border-app rounded-2xl overflow-hidden flex flex-col">' +
        '<div class="aspect-video bg-slate-100 dark:bg-slate-800 relative">' + (cover ? '<img src="' + cover + '" alt="" class="w-full h-full object-cover">' : '') +
        (off ? '<span class="absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-lg bg-rose-500 text-white">-' + off + '%</span>' : '') + '</div>' +
        '<div class="p-4 flex flex-col gap-2 flex-1"><p class="font-semibold leading-snug">' + U.escape(p.name) + '</p>' +
        '<p class="text-sm"><b>' + U.brl(p.price) + '</b> <span class="text-slate-500">• ' + U.escape((C.CATEGORIES[p.category] || C.CATEGORIES.geral).label) + ' • ' + (counts[p.id] || 0) + ' vídeo(s)</span></p>' +
        '<div class="mt-auto flex flex-wrap gap-2 pt-2">' +
        '<button data-act="video" data-id="' + p.id + '" class="gradient-btn text-white text-sm font-semibold px-3 py-1.5 rounded-lg">Criar vídeo</button>' +
        '<button data-act="edit" data-id="' + p.id + '" class="text-sm font-semibold px-3 py-1.5 rounded-lg border border-app">Editar</button>' +
        '<button data-act="del" data-id="' + p.id + '" class="text-sm font-semibold px-3 py-1.5 rounded-lg text-rose-500">Excluir</button></div></div></article>';
    }));
    grid.innerHTML = cards.join('');
  }
  $('#prod-search').addEventListener('input', renderProducts);
  $('#prod-grid').addEventListener('click', async function (e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const p = repo.getProduct(b.dataset.id);
    if (!p) return;
    if (b.dataset.act === 'video') useProduct(p.id);
    if (b.dataset.act === 'edit') { go('create'); await fillForm(p); step(1); }
    if (b.dataset.act === 'del') {
      if (!confirm('Excluir o produto "' + p.name + '" e as fotos dele? Os registros de vídeos continuam no histórico.')) return;
      repo.deleteProduct(p.id);
      renderProducts();
      toast('Produto excluído.');
    }
  });

  /* ---------- Vídeos & resultados ---------- */
  function renderVideos() {
    const vids = repo.listVideos();
    if (!vids.length) {
      $('#vid-rows').innerHTML = '<tr><td colspan="9" class="p-8 text-center text-slate-500">Nenhum vídeo gerado ainda. <button data-goto="create" class="text-accent font-semibold">Criar vídeo</button></td></tr>';
      return;
    }
    const numInput = function (v, f, val, money) {
      return '<input data-vid="' + v.id + '" data-f="' + f + '" inputmode="decimal" class="field !py-1 !px-2 w-24 text-sm" value="' + (U.num(val) ? String(val).replace('.', money ? ',' : '.') : '') + '" placeholder="0" aria-label="' + f + '">';
    };
    $('#vid-rows').innerHTML = vids.map(function (v) {
      return '<tr class="border-b border-app">' +
        '<td class="p-3"><p class="font-semibold">' + U.escape(v.productName) + '</p><p class="text-xs text-slate-500 truncate max-w-[220px]">“' + U.escape(v.hook) + '” • ' + new Date(v.createdAt).toLocaleDateString('pt-BR') + '</p></td>' +
        '<td class="p-3">' + U.escape(v.angleLabel) + '</td>' +
        '<td class="p-3"><select data-vid="' + v.id + '" data-f="status" class="field !py-1 !px-2 text-sm w-auto"><option value="gerado"' + (v.status === 'gerado' ? ' selected' : '') + '>Gerado</option><option value="postado"' + (v.status === 'postado' ? ' selected' : '') + '>Postado</option></select></td>' +
        '<td class="p-3">' + numInput(v, 'views', v.views) + '</td>' +
        '<td class="p-3">' + numInput(v, 'clicks', v.clicks) + '</td>' +
        '<td class="p-3">' + numInput(v, 'sales', v.sales) + '</td>' +
        '<td class="p-3">' + numInput(v, 'commission', v.commission, true) + '</td>' +
        '<td class="p-3 font-semibold" data-conv="' + v.id + '">' + U.pct(v.sales, v.clicks).toFixed(1).replace('.', ',') + '%</td>' +
        '<td class="p-3"><button data-vdel="' + v.id + '" class="text-xs text-rose-500 font-semibold">Excluir</button></td></tr>';
    }).join('');
  }
  $('#vid-rows').addEventListener('change', function (e) {
    const el = e.target, id = el.dataset.vid, f = el.dataset.f;
    if (!id || !f) return;
    const patch = {};
    patch[f] = f === 'status' ? el.value : U.num(el.value);
    let v = repo.updateVideo(id, patch);
    // Comissão estimada automaticamente quando ainda não foi informada
    if (v && f === 'sales' && !U.num(v.commission)) {
      const p = repo.getProduct(v.productId);
      const est = p ? U.num(v.sales) * U.num(p.price) * U.num(p.commissionPct) / 100 : 0;
      if (est > 0) { v = repo.updateVideo(id, { commission: Number(est.toFixed(2)) }); renderVideos(); toast('Comissão estimada: ' + U.brl(est)); return; }
    }
    if (v && f === 'views' && U.num(v.views) > 0 && v.status !== 'postado') { repo.updateVideo(id, { status: 'postado' }); renderVideos(); return; }
    const conv = $('[data-conv="' + id + '"]');
    if (conv && v) conv.textContent = U.pct(v.sales, v.clicks).toFixed(1).replace('.', ',') + '%';
  });
  $('#vid-rows').addEventListener('click', function (e) {
    const b = e.target.closest('[data-vdel]');
    if (!b) return;
    if (!confirm('Excluir este registro de vídeo e os números dele?')) return;
    repo.deleteVideo(b.dataset.vdel);
    renderVideos();
  });

  /* ---------- Configurações / bookmarklet / backup ---------- */
  function bookmarkletCode(studioUrl) {
    const fn = function (STUDIO) {
      var d = document;
      var q = function (s) { var e = d.querySelector(s); return e ? (e.content || e.textContent || '').trim() : ''; };
      var ld = null;
      d.querySelectorAll('script[type="application/ld+json"]').forEach(function (s) {
        try {
          var j = JSON.parse(s.textContent);
          [].concat(j['@graph'] || j).forEach(function (x) { if (x && [].concat(x['@type']).indexOf('Product') >= 0) ld = x; });
        } catch (e) {}
      });
      var imgs = [];
      if (ld && ld.image) imgs = [].concat(ld.image).map(function (i) { return typeof i === 'string' ? i : i && i.url; });
      var og = q('meta[property="og:image"]');
      if (og) imgs.push(og);
      if (imgs.length < 3) {
        [].slice.call(d.images).filter(function (i) { return i.naturalWidth >= 400 && i.naturalHeight >= 400; })
          .slice(0, 8).forEach(function (i) { imgs.push(i.currentSrc || i.src); });
      }
      imgs = imgs.filter(function (v, i, a) { return v && /^https?:/.test(v) && a.indexOf(v) === i; }).slice(0, 6);
      var off = ld && ld.offers ? [].concat(ld.offers)[0] || {} : {};
      var data = {
        url: location.href.split('?')[0],
        name: (ld && ld.name) || q('meta[property="og:title"]') || d.title,
        price: String(off.price || off.lowPrice || q('meta[property="product:price:amount"]') || ''),
        description: (ld && ld.description) || q('meta[property="og:description"]') || q('meta[name="description"]'),
        images: imgs,
      };
      window.open(STUDIO + '#import=' + encodeURIComponent(JSON.stringify(data)), '_blank');
    };
    return 'javascript:(' + fn.toString().replace(/\s*\n\s*/g, ' ') + ')(' + JSON.stringify(studioUrl) + ');void 0';
  }

  function renderSettings() {
    const studioUrl = location.href.split('#')[0];
    const bm = $('#bookmarklet');
    bm.setAttribute('href', bookmarkletCode(studioUrl));
    bm.onclick = function (e) { e.preventDefault(); toast('Arraste este botão para a barra de favoritos.'); };
    $('#bm-warn').hidden = location.protocol !== 'file:';
    $('#about-app').textContent = AC.config.appName + ' v' + AC.config.version;
    $('#about-mode').textContent = AC.config.mode === 'personal' ? 'pessoal (sem login)' : 'SaaS';
  }

  $('#btn-export').addEventListener('click', async function () {
    try {
      const data = await repo.exportAll();
      U.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), 'afiliaclip-backup-' + new Date().toISOString().slice(0, 10) + '.json');
      $('#backup-msg').textContent = '✅ Backup exportado.';
    } catch (e) { $('#backup-msg').textContent = '❌ ' + e.message; }
  });
  $('#btn-import').addEventListener('change', async function (e) {
    const f = e.target.files[0];
    if (!f) return;
    if (!confirm('Importar o backup vai SUBSTITUIR os dados atuais deste navegador. Continuar?')) { e.target.value = ''; return; }
    try {
      await repo.importAll(JSON.parse(await f.text()));
      $('#backup-msg').textContent = '✅ Backup importado.';
    } catch (err) { $('#backup-msg').textContent = '❌ ' + err.message; }
    e.target.value = '';
  });

  /* ---------- Importação vinda do botão Capturar ---------- */
  function benefitsFromDescription(desc) {
    return String(desc || '').split(/[\n.;•✓✔️-]+/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length >= 8 && s.length <= 70; }).slice(0, 4);
  }

  async function handleImport() {
    const m = location.hash.match(/^#import=(.+)$/);
    if (!m) return false;
    history.replaceState(null, '', location.pathname + location.search);
    let data;
    try { data = JSON.parse(decodeURIComponent(m[1])); } catch (e) { toast('Não consegui ler os dados capturados.'); return false; }
    go('create'); step(1);
    await fillForm({
      url: data.url, name: String(data.name || '').slice(0, 140), price: U.num(data.price),
      category: guessCategory(data.name), benefits: benefitsFromDescription(data.description),
    });
    let ok = 0, fail = 0;
    for (const src of (data.images || []).slice(0, 6)) {
      try {
        const res = await fetch(src, { mode: 'cors' });
        if (!res.ok) throw new Error(res.status);
        const blob = await U.downscale(await res.blob(), AC.config.video.maxImageSide);
        state.pending.push({ blob: blob, url: URL.createObjectURL(blob) });
        ok++;
      } catch (e) {
        try {
          const blob = await U.downscale(src, AC.config.video.maxImageSide);
          state.pending.push({ blob: blob, url: URL.createObjectURL(blob) });
          ok++;
        } catch (e2) { fail++; }
      }
    }
    renderThumbs();
    const msg = $('#pf-img-msg');
    if (fail) {
      msg.textContent = ok + ' foto(s) importada(s); ' + fail + ' bloqueada(s) pela loja. Salve essas fotos pelo navegador (botão direito → Salvar imagem) e envie aqui.';
      msg.hidden = false;
    }
    toast('Produto capturado! Confira os dados e salve.');
    return true;
  }

  /* ---------- Início ---------- */
  $('#plan-label').textContent = AC.plan().label;
  handleImport().then(function (imported) { if (!imported) go('dashboard'); });
  window.addEventListener('hashchange', handleImport);
  // Sugere a categoria pelo nome enquanto o usuário não escolheu outra
  form.elements.name.addEventListener('blur', function () {
    if (form.elements.category.value === 'geral') form.elements.category.value = guessCategory(form.elements.name.value);
  });
})();
