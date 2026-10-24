# AfiliaClip Studio — Arquitetura

## Hoje: modo pessoal (custo zero)

```
Página do produto ──(botão Capturar / bookmarklet)──► Studio (#import=...)
                                                        │
  Formulário + fotos ─► AC.repo (localStorage) + AC.blobs (IndexedDB)
                                                        │
                       AC.copy  (Agente Roteirista: 3 ângulos + checagem de conformidade)
                                                        │
                       AC.Renderer (Agente Montador: Canvas 9:16 + MediaRecorder)
                                                        │
                       Download MP4/WEBM ─► post manual no TikTok
                                                        │
                       Vídeos & resultados ─► Painel (Agente Analista: ângulo vencedor)
```

| Arquivo | Responsabilidade |
|---|---|
| `studio/js/config.js` | Nome, modo, planos e limites, backend, parâmetros de vídeo |
| `studio/js/util.js` | Números null-safe (nulo/erro → 0), BRL, imagens, download |
| `studio/js/storage.js` | `AC.repo` (interface de dados) e `AC.blobs` (imagens) |
| `studio/js/copywriter.js` | Banco de ganchos, geração de roteiros, alertas, prompt para IA |
| `studio/js/renderer.js` | Cenas, temas, áreas seguras do TikTok, gravação |
| `studio/js/app.js` | Interface, navegação e fluxo de 3 passos |

## Amanhã: SaaS

A UI só chama `AC.repo.*`. Para vender a ferramenta:

1. **Supabase** (o plano grátis atende ao início): Auth + Postgres + Storage.
2. Criar `SupabaseRepo` com os mesmos métodos do `LocalRepo` e trocar `AC.repo` quando
   `AC.config.backend.provider === 'supabase'`.
3. Trocar `AC.blobs` pelo Supabase Storage (bucket `product-images`, caminho `workspace_id/produto/arquivo`).
4. Ativar `AC.config.mode = 'saas'`, mostrar o login e definir `currentPlan` a partir da assinatura.
5. Cobrança: Stripe ou Mercado Pago (webhook → atualiza `workspaces.plan`).
6. Trocar o Tailwind via CDN por um build (Tailwind CLI) em produção.

### Esquema SQL sugerido

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null,
  plan text not null default 'free',
  created_at timestamptz default now()
);

create table products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  url text, name text not null,
  price numeric(12,2) not null default 0 check (price >= 0),
  old_price numeric(12,2) not null default 0 check (old_price >= 0),
  category text not null default 'geral',
  commission_pct numeric(5,2) not null default 0 check (commission_pct >= 0),
  benefits text[] not null default '{}',
  pain text,
  image_paths text[] not null default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table scripts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid references products(id) on delete cascade,
  angle text not null, hook text, scenes jsonb not null, caption text, narration text,
  created_at timestamptz default now()
);

create table videos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  script_id uuid references scripts(id) on delete set null,
  product_name text, angle text, angle_label text, hook text,
  duration numeric(5,1), format text, theme text, file_name text,
  status text not null default 'gerado',
  views int not null default 0 check (views >= 0),
  clicks int not null default 0 check (clicks >= 0),
  sales int not null default 0 check (sales >= 0),
  commission numeric(12,2) not null default 0 check (commission >= 0),
  created_at timestamptz default now()
);

-- RLS: cada usuário só enxerga o próprio workspace
alter table workspaces enable row level security;
alter table products   enable row level security;
alter table scripts    enable row level security;
alter table videos     enable row level security;

create policy own_ws on workspaces for all using (owner_id = auth.uid());
create policy own_products on products for all using (workspace_id in (select id from workspaces where owner_id = auth.uid()));
create policy own_scripts  on scripts  for all using (workspace_id in (select id from workspaces where owner_id = auth.uid()));
create policy own_videos   on videos   for all using (workspace_id in (select id from workspaces where owner_id = auth.uid()));
```

## Evoluções opcionais (só se valer o custo)

- Narração automática por API de voz (ElevenLabs ou similar) mixada na trilha.
- Roteiros pela API do Claude, no lugar do fluxo "copiar prompt / colar JSON".
- Avatar UGC (HeyGen) como mais um tipo de cena.
- Agendamento pelo Metricool e métricas puxadas automaticamente (Windsor.ai / TikTok Organic).
