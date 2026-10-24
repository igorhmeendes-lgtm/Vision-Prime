# AfiliaClip Studio

Transforma um produto da sua vitrine de afiliado em vídeo vertical 9:16 pronto para o TikTok.
Roda 100% no navegador: **sem servidor, sem API paga e sem assinatura**.

## O que faz

1. **Captura o produto**: o botão "Capturar" (bookmarklet) lê o nome, o preço, a descrição e as fotos da página da loja.
2. **Escreve 3 roteiros**: Dor → Solução, Achadinho e Oferta, com legenda, hashtags (#publi incluída) e narração.
3. **Checa a conformidade**: alerta sobre "cura", "100%", "garantido", "grátis" e outros termos que derrubam vídeos.
4. **Gera o vídeo**: Ken Burns sobre as fotos, textos animados nas áreas seguras do TikTok, card de preço com desconto, CTA e música opcional.
5. **Mede os resultados**: você registra views, cliques, vendas e comissão, e o Painel mostra qual ângulo converte mais.

## Como usar (grátis)

### Opção A — no seu computador
Abra `studio/index.html` no **Google Chrome**. Tudo funciona, exceto o botão Capturar.

### Opção B — online pelo GitHub Pages (recomendado, grátis)
1. No GitHub, abra o repositório → **Settings → Pages**.
2. Em *Source*, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)` → **Save**.
3. Em 1–2 minutos o Studio fica em `https://<seu-usuario>.github.io/vision-prime/studio/`.
4. Abra **Configurações** no Studio e arraste o botão **📥 Capturar** para a barra de favoritos.

### Fluxo diário
1. Na página do produto, clique em **📥 Capturar**. Confira os dados e salve.
2. Escolha um dos 3 roteiros, ajuste os textos e escolha o tema e a música.
3. Clique em **Gerar e baixar vídeo** e mantenha a aba aberta (a gravação leva o tempo do vídeo, ~15 s).
4. No TikTok: envie o vídeo e cole a legenda. Para narração grátis, use **Texto → Texto para voz** com o texto de narração gerado.
   Ative a **divulgação de conteúdo comercial** e vincule o produto.
5. Depois de 24–48 h, registre os números em **Vídeos & resultados**.

## Observações

- Formato: **MP4 (H.264)** no Chrome e no Edge atualizados; nos demais navegadores, **WEBM** (o TikTok aceita os dois).
- Os dados ficam no navegador. Use **Configurações → Exportar backup** de vez em quando.
- Algumas lojas bloqueiam o download das fotos pelo Studio. Nesse caso, salve as imagens e envie-as manualmente.
- Arquitetura e caminho para virar SaaS: [`docs/ARQUITETURA.md`](../docs/ARQUITETURA.md).
