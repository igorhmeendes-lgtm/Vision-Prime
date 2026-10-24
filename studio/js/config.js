/* AfiliaClip Studio — configuração central.
 * Tudo que muda quando a ferramenta virar SaaS (nome, planos, limites, backend)
 * fica concentrado aqui. Hoje: modo "pessoal", sem login e sem limites.
 */
window.AC = window.AC || {};

AC.config = {
  appName: 'AfiliaClip Studio',
  version: '1.0.0',

  // 'personal' = uso próprio (sem login, dados no navegador).
  // 'saas'     = multiusuário (exige backend configurado em AC.config.backend).
  mode: 'personal',

  // Workspace padrão. No SaaS, cada cliente terá o seu (id vindo do login).
  workspaceId: 'pessoal',

  // Backend futuro (Supabase). Enquanto 'local', tudo fica em localStorage + IndexedDB.
  backend: {
    provider: 'local',          // 'local' | 'supabase'
    supabaseUrl: '',
    supabaseAnonKey: '',        // chave pública (anon). Nunca coloque a service_role aqui.
  },

  // Planos para venda futura. No modo pessoal, usa-se 'owner' (ilimitado).
  plans: {
    owner:   { label: 'Dono',    videosPerMonth: Infinity, maxProducts: Infinity, watermark: false },
    free:    { label: 'Grátis',  videosPerMonth: 10,       maxProducts: 5,        watermark: true  },
    starter: { label: 'Starter', videosPerMonth: 100,      maxProducts: 50,       watermark: false },
    pro:     { label: 'Pro',     videosPerMonth: 1000,     maxProducts: Infinity, watermark: false },
  },
  currentPlan: 'owner',

  video: {
    fps: 30,
    bitrate: 8_000_000,
    resolutions: {
      '1080': { w: 1080, h: 1920 },
      '720':  { w: 720,  h: 1280 },
    },
    defaultResolution: '1080',
    maxImageSide: 1440,         // imagens são reduzidas antes de salvar
  },

  // Estimativa usada no KPI "horas economizadas" (minutos de edição manual por vídeo).
  manualMinutesPerVideo: 25,
};

AC.plan = function () {
  return AC.config.plans[AC.config.currentPlan] || AC.config.plans.owner;
};
