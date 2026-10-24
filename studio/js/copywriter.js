/* Agente Roteirista (offline, sem custo).
 * Gera 3 ângulos de venda por produto a partir de um banco de ganchos por categoria.
 * Opcional: exporta um prompt para IA gratuita (Claude/ChatGPT) e importa o JSON de volta.
 */
window.AC = window.AC || {};

AC.copy = (function () {
  const U = AC.util;

  const CATEGORIES = {
    geral:      { label: 'Geral / Achadinhos', publico: 'você', dores: ['produto que não funciona', 'dinheiro jogado fora em produto ruim', 'bagunça no dia a dia'], tags: ['achadinhos', 'achadinhosdatiktok', 'utilidades'] },
    casa:       { label: 'Casa & Organização', publico: 'quem cuida da casa', dores: ['casa bagunçada', 'falta de espaço', 'limpeza que nunca acaba'], tags: ['casa', 'organizacao', 'achadinhosparacasa'] },
    cozinha:    { label: 'Cozinha', publico: 'quem cozinha todo dia', dores: ['horas perdidas na cozinha', 'louça acumulada', 'comida que gruda na panela'], tags: ['cozinha', 'utensiliosdecozinha', 'cozinhapratica'] },
    beleza:     { label: 'Beleza & Skincare', publico: 'quem ama se cuidar', dores: ['pele oleosa', 'maquiagem que não dura', 'gasto alto com salão'], tags: ['beleza', 'skincare', 'makeup'] },
    moda:       { label: 'Moda & Acessórios', publico: 'quem gosta de estar bem vestida', dores: ['guarda-roupa sem opção', 'roupa que não valoriza', 'look sem graça'], tags: ['moda', 'lookdodia', 'estilo'] },
    tecnologia: { label: 'Tecnologia & Gadgets', publico: 'quem é fã de tecnologia', dores: ['celular sem bateria', 'fio embolado', 'gadget caro que quebra'], tags: ['tecnologia', 'gadgets', 'tech'] },
    fitness:    { label: 'Fitness & Bem-estar', publico: 'quem treina', dores: ['treino sem resultado', 'dor depois do treino', 'falta de tempo para academia'], tags: ['fitness', 'treinoemcasa', 'bemestar'] },
    pet:        { label: 'Pet', publico: 'quem tem pet', dores: ['pelo pela casa toda', 'pet entediado', 'bagunça na hora de comer'], tags: ['pet', 'cachorro', 'gato'] },
    infantil:   { label: 'Infantil & Bebê', publico: 'mãe e pai', dores: ['criança que não para quieta', 'bagunça de brinquedo', 'rotina corrida com bebê'], tags: ['maternidade', 'bebe', 'infantil'] },
    automotivo: { label: 'Automotivo', publico: 'quem tem carro', dores: ['carro sujo por dentro', 'celular caindo no painel', 'gasto com lava-jato'], tags: ['carro', 'automotivo', 'acessoriosautomotivos'] },
  };

  const HOOKS = {
    dor: [
      'Para de sofrer com {dor}',
      'Se você odeia {dor}, assiste até o final',
      'Eu não aguentava mais {dor}…',
      'Resolvi {dor} por menos de {preco}',
      'Ninguém te conta como resolver {dor}',
    ],
    achado: [
      'Achei o produto mais útil do TikTok Shop',
      'Por que ninguém me mostrou isso antes?',
      'Esse achadinho mudou minha rotina',
      'Comprei achando que era golpe… olha isso',
      '3 motivos para eu não viver mais sem isso',
    ],
    oferta: [
      '{desconto}% OFF hoje — corre!',
      'Isso por apenas {preco}? Sério?',
      'De {precoAntigo} por {preco} só hoje',
      'Preço de achadinho, qualidade de loja cara',
      'O mais vendido da semana tá em promoção',
    ],
  };

  const CTAS = {
    carrinho: ['Toca no carrinho laranja 🛒', 'Link no carrinho aqui embaixo 🛒', 'Garante o seu no carrinho 🛒'],
    bio:      ['Link na bio 🔗', 'Corre no link da bio 🔗', 'Tá no link do meu perfil 🔗'],
    comente:  ['Comenta "EU QUERO" que eu te mando 💬', 'Comenta "LINK" 💬'],
  };

  const ANGLES = {
    dor:    { label: 'Dor → Solução',    desc: 'Começa pelo problema do cliente e apresenta o produto como solução.' },
    achado: { label: 'Achadinho / Curiosidade', desc: 'Prende pela curiosidade e mostra o produto como descoberta.' },
    oferta: { label: 'Oferta / Preço',   desc: 'Foca no preço e na urgência. Ideal quando há desconto.' },
  };

  // Termos que costumam derrubar vídeo ou bloquear afiliado (alegações enganosas).
  const RISKY = [
    { re: /\bcura(r|m)?\b/i, why: 'Alegação de cura (saúde) é proibida.' },
    { re: /\bemagre(ce|cer|ça)\b|\bperca \d+ ?kg\b/i, why: 'Promessa de emagrecimento é restrita.' },
    { re: /\bgarantid[oa]s?\b/i, why: '"Garantido" exige comprovação; prefira "ajuda a".' },
    { re: /\b100 ?%/i, why: '"100%" é alegação absoluta; evite.' },
    { re: /\bmilagr/i, why: '"Milagre" é linguagem enganosa.' },
    { re: /\bgr[áa]tis\b/i, why: 'Só use "grátis" se o produto for realmente gratuito.' },
    { re: /\banvisa\b|\baprovado pela\b/i, why: 'Não cite aprovação de órgãos sem comprovar.' },
    { re: /\bmelhor do mundo\b|\bo melhor do brasil\b/i, why: 'Superlativo absoluto sem prova.' },
  ];

  function fill(tpl, ctx) {
    return tpl.replace(/\{(\w+)\}/g, function (_, k) { return ctx[k] != null ? ctx[k] : ''; });
  }

  function shortName(name) {
    const clean = String(name || 'esse produto').replace(/\s*[-|–].*$/, '').trim();
    const words = clean.split(/\s+/);
    return words.length > 6 ? words.slice(0, 6).join(' ') : clean;
  }

  function benefitsFor(product, cat) {
    const list = (product.benefits || []).map(function (b) { return String(b).trim(); }).filter(Boolean);
    if (list.length >= 3) return list.slice(0, 4);
    const fallback = ['Fácil de usar no dia a dia', 'Acabamento de qualidade', 'Resolve ' + cat.dores[0], 'Cabe em qualquer lugar'];
    return list.concat(fallback).slice(0, 3);
  }

  function generate(product, opts) {
    opts = opts || {};
    const seed = opts.seed || Date.now();
    const rand = U.rng(seed);
    const cat = CATEGORIES[product.category] || CATEGORIES.geral;
    const price = U.num(product.price);
    const oldPrice = U.num(product.oldPrice);
    const desconto = U.discountPct(price, oldPrice);
    const nome = shortName(product.name);
    const dor = product.pain && product.pain.trim() ? product.pain.trim() : U.pick(cat.dores, rand);
    const ctaStyle = opts.cta || 'carrinho';
    const ctx = {
      produto: nome,
      preco: price ? U.brl(price) : 'pouco',
      precoAntigo: oldPrice ? U.brl(oldPrice) : '',
      desconto: desconto,
      dor: dor,
      publico: cat.publico,
    };
    const benefits = benefitsFor(product, cat);
    const imgCount = Math.max(1, (product.imageIds || []).length);

    const angles = ['dor', 'achado', 'oferta'];
    return angles.map(function (angle, ai) {
      let pool = HOOKS[angle];
      if (!desconto) pool = pool.filter(function (h) { return h.indexOf('{desconto}') < 0 && h.indexOf('{precoAntigo}') < 0; });
      if (!price) pool = pool.filter(function (h) { return h.indexOf('{preco}') < 0; });
      if (!pool.length) pool = HOOKS.achado;
      const hook = fill(U.pick(pool, rand), ctx);
      const cta = U.pick(CTAS[ctaStyle] || CTAS.carrinho, rand);

      const scenes = [{ kind: 'hook', text: hook, image: 0, dur: 2.6 }];
      if (angle === 'dor') {
        scenes.push({ kind: 'image', text: 'Conheça: ' + nome, image: 0, dur: 2.4 });
      }
      benefits.forEach(function (b, i) {
        scenes.push({ kind: 'image', text: (angle === 'achado' ? (i + 1) + '. ' : '✓ ') + b, image: (i + 1 + ai) % imgCount, dur: 2.3 });
      });
      if (price) {
        scenes.push({
          kind: 'price',
          text: U.brl(price),
          sub: desconto ? 'de ' + U.brl(oldPrice) + ' • ' + desconto + '% OFF' : (angle === 'oferta' ? 'Preço por tempo limitado' : 'Vale cada centavo'),
          image: (ai + 1) % imgCount,
          dur: 2.6,
        });
      }
      scenes.push({ kind: 'cta', text: cta, sub: nome, image: 0, dur: 2.6 });

      const narration = [hook + '.']
        .concat(angle === 'dor' ? ['Conheça ' + nome + '.'] : [])
        .concat(benefits.map(function (b) { return b + '.'; }))
        .concat(price ? ['E o melhor: sai por ' + U.brl(price) + (desconto ? ', com ' + desconto + '% de desconto.' : '.')] : [])
        .concat([cta.replace(/[^\p{L}\p{N}\s",.!?]/gu, '').trim() + '.'])
        .join(' ');

      const hashtags = ['tiktokshop', 'achadinhos', 'publi'].concat(cat.tags).filter(function (t, i, a) { return a.indexOf(t) === i; });
      const caption = hook + ' 👀\n\n' + benefits.slice(0, 3).map(function (b) { return '✅ ' + b; }).join('\n') +
        (price ? '\n\n💰 ' + U.brl(price) + (desconto ? ' (' + desconto + '% OFF)' : '') : '') +
        '\n' + cta + '\n\n' + hashtags.map(function (t) { return '#' + t; }).join(' ');

      return {
        angle: angle,
        angleLabel: ANGLES[angle].label,
        angleDesc: ANGLES[angle].desc,
        hook: hook,
        scenes: scenes,
        narration: narration,
        caption: caption,
        hashtags: hashtags,
        seed: seed,
      };
    });
  }

  function check(text) {
    const issues = [];
    RISKY.forEach(function (r) { if (r.re.test(text)) issues.push(r.why); });
    return issues;
  }

  function checkScript(script) {
    const all = [script.caption, script.narration].concat(script.scenes.map(function (s) { return s.text + ' ' + (s.sub || ''); })).join(' \n ');
    const issues = check(all);
    if (!/#publi\b/i.test(script.caption)) issues.push('Inclua #publi para identificar conteúdo de afiliado.');
    return issues.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  function aiPrompt(product) {
    const cat = CATEGORIES[product.category] || CATEGORIES.geral;
    return [
      'Você é um copywriter especialista em vídeos curtos de afiliado para o TikTok Shop Brasil.',
      'Crie 3 roteiros de 12 a 18 segundos (ângulos: "dor", "achado", "oferta") para o produto abaixo.',
      '',
      'Produto: ' + (product.name || ''),
      'Categoria: ' + cat.label,
      'Preço: ' + (U.num(product.price) ? U.brl(product.price) : 'não informado'),
      'Preço antigo: ' + (U.num(product.oldPrice) ? U.brl(product.oldPrice) : 'não informado'),
      'Benefícios: ' + ((product.benefits || []).join('; ') || 'não informados'),
      'Dor do público: ' + (product.pain || cat.dores.join(', ')),
      '',
      'Regras: gancho forte nos 2 primeiros segundos; frases de no máximo 8 palavras por cena;',
      'sem promessas de cura, emagrecimento, "100%" ou "garantido"; inclua #publi na legenda.',
      '',
      'Responda SOMENTE com JSON válido neste formato:',
      '[{"angle":"dor","hook":"...","scenes":[{"kind":"hook","text":"..."},{"kind":"image","text":"..."},{"kind":"price","text":"R$ 0,00","sub":"..."},{"kind":"cta","text":"..."}],"narration":"...","caption":"... #publi #tiktokshop"}]',
    ].join('\n');
  }

  // Converte o JSON colado da IA para o formato interno (tolerante a campos faltando).
  function fromAI(raw, product) {
    const match = String(raw || '').match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Não encontrei um JSON de lista ([...]) no texto colado.');
    let arr;
    try { arr = JSON.parse(match[0]); } catch (e) { throw new Error('JSON inválido: ' + e.message); }
    if (!Array.isArray(arr) || !arr.length) throw new Error('A lista de roteiros está vazia.');
    const imgCount = Math.max(1, (product.imageIds || []).length);
    const durs = { hook: 2.6, image: 2.3, price: 2.6, cta: 2.6 };
    return arr.slice(0, 5).map(function (r, ri) {
      const angle = ANGLES[r.angle] ? r.angle : 'achado';
      const scenes = (Array.isArray(r.scenes) ? r.scenes : []).map(function (s, i) {
        const kind = durs[s.kind] ? s.kind : 'image';
        return { kind: kind, text: String(s.text || '').slice(0, 120), sub: s.sub ? String(s.sub).slice(0, 80) : '', image: (i + ri) % imgCount, dur: durs[kind] };
      }).filter(function (s) { return s.text; });
      if (!scenes.length) scenes.push({ kind: 'hook', text: String(r.hook || product.name || ''), image: 0, dur: 2.6 });
      return {
        angle: angle, angleLabel: ANGLES[angle].label + ' (IA)', angleDesc: ANGLES[angle].desc,
        hook: String(r.hook || scenes[0].text), scenes: scenes,
        narration: String(r.narration || ''), caption: String(r.caption || ''),
        hashtags: (String(r.caption || '').match(/#\w+/g) || []).map(function (t) { return t.slice(1); }),
        seed: 0,
      };
    });
  }

  return {
    CATEGORIES: CATEGORIES,
    ANGLES: ANGLES,
    generate: generate,
    check: check,
    checkScript: checkScript,
    aiPrompt: aiPrompt,
    fromAI: fromAI,
  };
})();
