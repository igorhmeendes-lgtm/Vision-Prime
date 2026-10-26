# CriaVende: vídeos UGC com IA

App estático (HTML + Tailwind + JS) que replica o fluxo da plataforma de referência, com nome e identidade próprios.

## Como a geração funciona (igual à referência)

| Etapa | Referência | CriaVende |
|---|---|---|
| Falas por take (máx. 20 palavras) | Gemini via backend `/api/gemini` | Gemini (`generateContent`) direto ou via proxy |
| Imagem de referência (produto + criador + cena, 9:16) | Nano Banana via backend `/api/image` | Modelo Gemini Image ("Nano Banana") com fotos de referência |
| Vídeo | Prompt por take para **Google Flow (VEO 3, 8 s)** ou **Grok (6 s)**; o vídeo é gerado lá | Igual: prompt estruturado por take, com botão de copiar e link para o Flow/Grok |
| Login e histórico | Firebase Auth + Firestore | `localStorage` (trocar por Firebase/Supabase na fase 2) |
| Pagamento | Kirvano / Cakto | Não incluso |

Sem chave de IA, o app continua funcionando: as falas saem de modelos prontos e as imagens do gerador gratuito Pollinations (que usa só texto, sem fotos de referência).

## Provedores gratuitos

1. **Gemini API (texto): grátis.** Crie a chave em <https://aistudio.google.com/apikey> e cole em *Integrações IA*. No plano gratuito o Google pode usar os dados para melhorar os modelos. Os limites diários aparecem no AI Studio.
2. **Nano Banana pela API: pago** (sem plano gratuito desde 2026, cerca de US$ 0,03 por imagem no modelo mais barato). Ative o faturamento no AI Studio para usar dentro do app.
3. **Nano Banana e VEO 3 pelo Google Flow: grátis com limite.** Contas gratuitas recebem créditos diários (cerca de 50, o suficiente para algumas cenas VEO 3.1 Lite/Fast). O app gera o prompt de fusão de imagens e os prompts de vídeo para colar lá: <https://labs.google/fx/tools/flow>.
4. **Pollinations: grátis**, apenas texto para imagem (1 pedido a cada 15 s sem cadastro).
5. **Grok Imagine:** alternativa ao Flow, com takes de 6 s: <https://grok.com/imagine>.

## Publicar a chave com segurança (proxy)

Uma chave colada no navegador pode ser vista por quem usar o computador. Para abrir o app ao público, use o proxy:

```bash
npm i -g wrangler
wrangler login
wrangler deploy ugc/worker/gemini-proxy.js --name criavende-ia
wrangler secret put GEMINI_API_KEY --name criavende-ia
# opcional: wrangler secret put ALLOWED_ORIGIN  (ex.: https://igorhmeendes-lgtm.github.io)
```

Cole a URL do Worker em *Integrações IA → URL do proxy*.

## API do TikTok

- **TikTok Shop Partner Center** (<https://partner.tiktokshop.com>): crie a conta, registre-se como desenvolvedor, crie um app e solicite os escopos (Products, Orders, **Affiliate**). Contas de fora dos EUA usam o portal global. Algumas regiões exigem revisão de compliance, que pode levar 3 semanas ou mais. A API só acessa lojas próprias ou lojas que autorizaram o app por OAuth.
- **Affiliate APIs**: são as APIs para apps de criadores e afiliados (busca de produtos com comissão, colaborações). Registre-se como *Affiliate app developer* no Partner Center.
- **TikTok for Developers** (<https://developers.tiktok.com>): Login Kit e **Content Posting API** (publicar os vídeos gerados direto no perfil). A Research API é restrita a pesquisa acadêmica.
- Não existe API oficial pública de "produtos em alta". O Radar usa dados de demonstração. Para dados reais, use as Affiliate APIs ou um provedor terceiro de dados do TikTok Shop.

## Publicação (GitHub Pages)

Settings → Pages → *Deploy from a branch* → `main` / `(root)`. O app fica em `https://igorhmeendes-lgtm.github.io/vision-prime/ugc/`.
