# LoteClip — app iOS/Android (Capacitor)

Este diretório empacota o mesmo app web do LoteClip (`../index.html`) dentro de
um wrapper nativo usando [Capacitor](https://capacitorjs.com), para gerar um
`.aab` (Google Play) e um `.ipa` (App Store).

```
mobile/
├── www/                 # cópia do index.html usada pelo app nativo
├── resources/           # ícone-fonte e splash-fonte (1024x1024 / 2732x2732)
├── android/             # projeto nativo Android (Android Studio / Gradle)
├── ios/                 # projeto nativo iOS (Xcode) — precisa de macOS
└── capacitor.config.json
```

App ID: `com.loteclip.app` · Nome: `LoteClip`

## 1. Pré-requisitos

| Plataforma | Você precisa de |
|---|---|
| Android | [Android Studio](https://developer.android.com/studio) (inclui JDK e SDK) |
| iOS | Um **Mac** com [Xcode](https://apps.apple.com/app/xcode/id497799835) + `sudo gem install cocoapods` |
| Ambas | Node.js 18+ (já usado para gerar este projeto) |

Contas de desenvolvedor (obrigatórias para publicar, não para testar):
- **Google Play Console** — US$ 25 (pagamento único): https://play.google.com/console/signup
- **Apple Developer Program** — US$ 99/ano: https://developer.apple.com/programs/enroll/

## 2. Manter o app sincronizado com o site

O app nativo carrega uma **cópia local** do `index.html`. Sempre que o site
raiz (`../index.html`) mudar, rode antes de compilar:

```bash
cd mobile
npm run sync-web    # copia ../index.html para www/ e roda `cap sync`
```

## 3. Testar/compilar Android

```bash
cd mobile
npm run open:android   # abre o projeto no Android Studio
```

No Android Studio: `Run ▶` instala num emulador ou aparelho conectado.

### Gerar o pacote para a Play Store (.aab)

1. Crie uma keystore (uma vez só, guarde em local seguro — sem ela você não
   consegue mais atualizar o app depois de publicado):
   ```bash
   keytool -genkey -v -keystore loteclip-release.keystore \
     -alias loteclip -keyalg RSA -keysize 2048 -validity 10000
   ```
2. No Android Studio: `Build → Generate Signed Bundle / APK → Android App Bundle`,
   aponte para a keystore acima.
3. Suba o `.aab` gerado em **Play Console → Produção → Criar versão**.

## 4. Testar/compilar iOS (precisa de Mac)

```bash
cd mobile
pod install --project-directory=ios/App   # primeira vez, instala os pods
npm run open:ios                          # abre no Xcode
```

No Xcode: selecione seu Time (Apple Developer), `Product → Archive`, depois
`Distribute App → App Store Connect`.

## 5. Ícone e splash screen

Os arquivos-fonte ficam em `resources/`:
- `icon.png` — ícone completo 1024×1024
- `icon-foreground.png` / `icon-background.png` — camadas do ícone adaptativo do Android
- `splash.png` / `splash-dark.png` — tela de abertura (clara/escura)

Se quiser trocar o design, edite/substitua esses PNGs e rode:
```bash
npx capacitor-assets generate --android --ios
npx cap sync
```

## 6. Checklist antes de enviar para as lojas

- [ ] Criar as contas de desenvolvedor (Google e Apple, links acima)
- [ ] Política de privacidade publicada (já incluída no site: `/privacidade.html`)
- [ ] Termos de uso publicados (`/termos.html`) e política de reembolso (`/reembolso.html`)
- [ ] Capturas de tela do app (Play Store: mínimo 2; App Store: por tamanho de tela)
- [ ] Descrição curta e longa da loja (pode reaproveitar os textos da landing page)
- [ ] Classificação indicativa / questionário de conteúdo (Play Console e App Store Connect)
- [ ] Formulário de segurança/privacidade de dados (Play Console → "Data safety"; App Store → "App Privacy") — como hoje tudo fica no dispositivo, a resposta é "nenhum dado enviado a servidores"
- [ ] Gerar e guardar a keystore de assinatura do Android em local seguro
- [ ] Testar em pelo menos 1 aparelho Android físico e 1 iPhone antes de enviar

## Observações

- Este container de desenvolvimento (ambiente Linux sem Android SDK/Xcode)
  consegue **gerar e configurar** os projetos `android/` e `ios/`, mas **não
  consegue compilar o binário final** — isso precisa ser feito localmente ou
  em CI, seguindo os passos acima.
- O app hoje processa vídeo de forma **simulada** (sem edição real do
  arquivo), replicando a mesma limitação do site. Se/quando o corte real de
  vídeo for implementado, ele funciona igual nas três plataformas (web, iOS,
  Android), pois é o mesmo `index.html`.
