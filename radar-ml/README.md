# Radar ML: produtos de alta conversão + dropshipping nacional no Mercado Livre

Sistema para **vender** no Mercado Livre sem estoque próprio. Ele:

1. Pesquisa sozinho os **mais vendidos** das categorias que você escolher, com visitas, conversão, concorrência e tendências de busca.
2. Cruza cada produto com o **catálogo do seu fornecedor** (por EAN ou título) e calcula o **lucro líquido real**, já com a tarifa oficial do ML, o frete grátis, a reserva de devolução e o imposto.
3. Dá um **score de oportunidade (0 a 100)** e o **preço mínimo** que garante a sua margem-alvo.
4. Opera a sua conta: sincroniza o estoque do fornecedor com os anúncios, recebe os pedidos em tempo real (webhook), gera a planilha de pedidos com a etiqueta para o fornecedor e mede OTD, acuracidade de SKU e impacto financeiro de cortes.

## Arquitetura

```
                ┌───────────── Mercado Livre API (OAuth 2.0 + PKCE) ─────────────┐
                │ /highlights (mais vendidos)  /products  /items  /visits        │
                │ /trends  /listing_prices  /shipping_options  /orders  /shipments│
                └──────────────▲──────────────────────────────┬─────────────────┘
                               │ a cada 6h (pesquisa)          │ webhook orders_v2
                               │ a cada 30min (operação)       ▼
 Fornecedor (CSV/feed) ──► [ Radar ML · Node.js + SQLite ] ──► Dashboard (Tailwind)
   sku, custo, estoque         research → matcher → scoring     KPIs, oportunidades,
                               seller (pedidos, estoque)        pedidos, estoque
```

| Módulo | Função |
|---|---|
| `src/ml/auth.js` | OAuth com PKCE; renovação automática do token (expira a cada 6h, refresh token de uso único) |
| `src/ml/client.js` | Cliente HTTP com no máximo 5 requisições simultâneas, retry com backoff em 429/5xx e renovação de token no 401 |
| `src/ml/research.js` | Mais vendidos por categoria → anúncio vencedor do catálogo → visitas de 30 dias e total → snapshots |
| `src/ml/fees.js` | Tarifa de venda (`listing_prices`) e custo do frete grátis do vendedor, ambos direto da API |
| `src/analysis/matcher.js` | Vínculo com o fornecedor: EAN exato, senão similaridade de título ≥ 45% |
| `src/analysis/scoring.js` | Margem, preço recomendado, conversão, score e estoque-alvo (funções puras, testadas) |
| `src/ml/seller.js` | Seus anúncios, pedidos, envios, sincronização de estoque e etiqueta PDF |
| `src/suppliers/` | Conectores de fornecedor: arquivo CSV ou feed CSV por URL. É o ponto para plugar a API de um hub |
| `src/analysis/kpis.js` | OTD, acuracidade de SKU, impacto de cortes, conversão e cobertura do fornecedor |

### Regras de negócio

- **Lucro líquido** = preço − custo do fornecedor − tarifa ML (percentual + tarifa fixa) − frete grátis pago por você − imposto − reserva de devolução − taxa do hub − embalagem.
  O cálculo usa o **menor preço concorrente** do produto, que é o preço que você precisa bater.
- Prejuízo aparece no campo **"prejuízo R$"**. Lucro e margem nunca ficam negativos, e valores nulos viram 0.
- **Preço mínimo alvo**: cálculo iterativo, porque a tarifa fixa e o frete grátis mudam por faixa de preço. Arredonda para R$ x,90.
- **Conversão "medida"** = Δvendas ÷ Δvisitas entre duas coletas. Só aparece quando o ML expõe as vendas do anúncio. Senão fica "sem dados" e o score usa apenas demanda (rank + visitas). **Nunca é estimada.**
- **Score** = 40% demanda (rank + tráfego + conversão) + 30% margem + 20% preço competitivo + 10% concorrência.
- **Estoque no ML** = estoque do fornecedor − reserva de segurança (padrão 2 un), com teto de 50 un. Se o fornecedor está abaixo da reserva, o anúncio vai para **0**. SKU que sai do catálogo do fornecedor também vira 0.
- **Acuracidade de SKU**: **sobra** (ML acima do fornecedor, risco de venda sem estoque) e **falta** (ML abaixo, venda perdida) contam igualmente como erro.
- **OTD**: envio despachado até o limite de despacho do ML. Envio vencido e não despachado conta como atraso.

## Guia de implementação

### 1. Rodar agora em modo simulado (sem credenciais)

```bash
cd radar-ml
npm install
npm run mock          # http://localhost:3000
npm test              # 12 testes, incluindo o fluxo ponta a ponta
```
No painel: **Fornecedores → importe `data/fornecedores/exemplo-fornecedor.csv`**, depois clique em **Pesquisar mercado** e **Sincronizar operação**.

### 2. Criar o app no Mercado Livre

1. Entre em **https://developers.mercadolivre.com.br** com a **mesma conta em que você vai vender** e abra **Minhas aplicações → Criar aplicação**.
2. Preencha nome, descrição e logo.
3. **URI de redirect**: `https://SEU-DOMINIO/auth/callback`. Precisa ser HTTPS e idêntica ao `ML_REDIRECT_URI`.
4. **PKCE**: ative.
5. **Escopos**: leitura + escrita + `offline_access` (o `offline_access` é o que permite o refresh token).
6. **Tópicos de notificação**: marque `orders_v2`, `shipments` e `items`. **URL de notificação**: `https://SEU-DOMINIO/api/ml/notifications`.
7. Salve e copie o **Client ID** (App ID) e o **Client Secret**.

### 3. Publicar o servidor (precisa de HTTPS)

Escolha uma opção: Render, Railway, Fly.io ou uma VPS com Caddy/Nginx.

```bash
cp .env.example .env    # preencha ML_CLIENT_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI e DASHBOARD_PASSWORD
npm install --omit=dev
npm start
```
- Node **22.5 ou mais recente** (usa o SQLite nativo, sem dependências compiladas).
- Persista a pasta `data/`, onde ficam o banco e os CSVs. No Render, use um *Persistent Disk* montado em `radar-ml/data`.
- Configure `DASHBOARD_PASSWORD`. O painel usa Basic Auth com o usuário `admin`, e o webhook fica fora da senha.

### 4. Primeira execução

1. Abra o painel e clique em **Conectar Mercado Livre**. Autorize no ML e você volta para o painel conectado.
2. **Fornecedores**: importe o CSV do catálogo ou conecte o feed por URL. Colunas obrigatórias: `sku, titulo, custo, estoque`. Recomendadas: `ean, peso_g, altura_cm, largura_cm, comprimento_cm`, que são necessárias para calcular o frete grátis.
3. Nos seus anúncios, preencha o **SKU (SELLER_SKU) igual ao SKU do fornecedor**. É por ele que o estoque e os pedidos são vinculados.
4. Confira por alguns dias a aba **Sincronização de estoque** (modo simulação). Depois ative `AUTO_SYNC_STOCK=1`.
5. Escolha as categorias em `RESEARCH_CATEGORIES`. Para descobrir os IDs, use `GET /api/categories` e `GET /api/categories?parent=MLB1648`.

### 5. Rotina diária

- **Oportunidades**: filtre "Só viáveis" e ordene por score ou conversão. Valide o vínculo do fornecedor (o percentual de similaridade aparece ao lado) e corrija em "vincular" quando necessário.
- **Pedidos → fornecedor**: baixe o CSV de pendentes, que já traz o link da etiqueta PDF, envie ao fornecedor e atualize o status.
- **KPIs**: OTD abaixo de 95% ou acuracidade abaixo de 98% pedem ação no mesmo dia, porque derrubam a reputação.

## Limites conhecidos

- **Busca pública bloqueada**: desde 2025 o `/sites/MLB/search` retorna 403 mesmo com token. Por isso a pesquisa usa os **Mais vendidos por categoria** (`/highlights`), que é oficial e autenticado.
- **Vendas de concorrentes**: o ML nem sempre expõe `sold_quantity` de anúncios de terceiros. Nesses casos a conversão fica "sem dados" e não é inventada. A conversão dos **seus** anúncios é sempre real (pedidos ÷ visitas).
- **Venda como CPF**: o ML permite, mas volume recorrente pode ser enquadrado como atividade comercial. `TAX_RATE=0` reflete o CPF. Ao migrar para MEI ou Simples, ajuste a alíquota (cerca de 4% a 6%).
- **Ainda não publica anúncios**: a publicação automática (`POST /items`) é o próximo passo. Por enquanto você cria o anúncio no ML com o SKU do fornecedor e o sistema cuida do resto.
- **Hubs com API própria**: adicione um tipo em `src/suppliers/index.js → FETCHERS` que devolva o catálogo. O restante do sistema não muda.
