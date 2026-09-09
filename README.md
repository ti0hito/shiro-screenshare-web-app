# Shiro Screen Share

Shiro Screen Share é um aplicativo desktop leve para capturar telas e transmitir direto para uma atividade do Discord usando LiveKit.
Este README fornece visão geral do projeto, instruções de desenvolvimento, empacotamento e publicações seguras.

--------------------------------------------------------------------------------

## Estrutura do Repositório (visão ponto a ponto)

- `package.json` — scripts principais (`dev`, `build`, `pack`, `clean`) e dependências.
- `electron-builder.yml` — configuração do `electron-builder` para criar instaladores Windows.
- `src/` — código fonte
  - `src/main/` — processo principal do Electron (janelas, protocolo, IPC). Ex.: `src/main/main.js`.
  - `src/renderer/` — UI e lógica do renderer. Ex.: `src/renderer/app.js`, `src/renderer/index.html`, `src/renderer/renderer-init.js`.
- `scripts/` — utilitários e scripts PowerShell de suporte (recriacao de atalhos, limpeza, cache de ícones).
- `icon.ico` — único ícone usado pelo instalador e UI.
- `dist/` — saída dos builds (artefatos prontos para distribuição).
- `.env.example` — referência das variáveis de ambiente necessárias (sem segredos reais).

--------------------------------------------------------------------------------

## Resumo técnico (curto)

- Base: Electron + LiveKit (client) para WebRTC/streaming.
- Bundling do renderer: `esbuild` (gera `src/renderer/app.bundle.js`).
- Empacotamento: `electron-builder` gera `NSIS` instalador e `portable` builds conforme `electron-builder.yml`.
- Runtime: quando empacotado (`app.isPackaged`) o app lê recursos em `process.resourcesPath`.

--------------------------------------------------------------------------------

## Pré-requisitos de desenvolvimento

- Node.js (versão LTS recomendada) e npm.
- Windows para testes e criação de instaladores (assinatura de código recomendada).

--------------------------------------------------------------------------------

## Desenvolvimento — passo a passo

1. Instalar dependências:

```bash
npm install
```

2. Rodar em modo desenvolvimento (rebundle do renderer + abrir o Electron):

```bash
npm run dev
```

3. Dicas:
- Se alterar arquivos do renderer, `esbuild` recompila `src/renderer/app.bundle.js` durante o `npm run dev` script.
- Use o DevTools do Electron para inspecionar a UI (`Ctrl+Shift+I`).

--------------------------------------------------------------------------------

## Build e empacotamento (release)

1. Gerar build e empacotar para Windows:

```bash
npm run build
```

2. Gerar apenas uma pasta `win-unpacked` (útil para testes sem criar instalador):

```bash
npm run pack
```

3. Os artefatos estarão em `dist/`.

4. Para builds repetíveis em CI, execute em runner Windows ou configure cross-compilation adequada.

--------------------------------------------------------------------------------

## Assinatura de binários (Windows)

- Para reduzir avisos do SmartScreen e garantir confiança, assine o instalador e executáveis com um certificado Authenticode.
- Exemplo de comando `signtool` (supondo que o certificado está configurado no sistema ou armazenado no provedor):

```powershell
signtool sign /fd SHA256 /a /tr http://timestamp.digicert.com /td SHA256 "dist\Shiro Screen Share Setup 1.0.0.exe"
```

Observação: a assinatura pode exigir certificados PFX, hardware/token ou integração com um serviço de assinatura.

--------------------------------------------------------------------------------

## Publicação segura do instalador

- Hospede o instalador em HTTPS (ex.: GitHub Releases, S3 + CloudFront, servidor com TLS).
- Providencie um arquivo `.sha256` com o checksum SHA256 do instalador.
- Configure o `Content-Disposition: attachment` no servidor para forçar download ao clicar.

--------------------------------------------------------------------------------

## Variáveis de ambiente

- Use um arquivo local `.env` (não comitar). Exemplos de chaves em `.env.example`:
  - `BACKEND_URL` — URL do token generator / API.
  - `LIVEKIT_URL` — endpoint do servidor LiveKit (wss://...).
  - `DISCORD_CLIENT_ID` — client id do app Discord.

- Nunca comite chaves ou segredos no repositório.

--------------------------------------------------------------------------------

## Como usar — instruções para usuário final

1. Faça download do instalador a partir da página de releases / site seguro.
2. Execute o instalador e finalize a instalação.
3. Abra o app pelo Menu Iniciar ou atalho na Área de Trabalho.
4. Escolha a fonte a ser compartilhada (tela ou janela), ative captura de áudio se desejar e clique em "Iniciar Transmissão".

Nota: se o app for iniciado via deep-link do Discord (ou protocolo `shiro://`), ele tentará entrar diretamente na sala/usuario informados.

--------------------------------------------------------------------------------

## Integração com Discord

- A atividade do Discord associada a este projeto está em:

  https://www.discord.com/activities/1452768777585299486?link_id=0-1547066146300100678

- Use a Activity/Activity API do Discord para disparar a experiência desde um bot ou site (documentação do Discord fora do escopo aqui).

--------------------------------------------------------------------------------

## Troubleshooting comum

- Erro: arquivos em uso ao rodar `npm run build`.
  - Causa: processos Electron ou explorer segurando `dist/`.
  - Solução rápida (Windows):

```powershell
taskkill /F /IM electron.exe /T || true
taskkill /F /IM app-builder.exe /T || true
npm run clean
```

- Problema: ícones antigos/padrão no Windows.
  - Solução: limpar cache de ícones e reiniciar Explorer:

```powershell
Stop-Process -Name explorer -Force
Remove-Item "$env:LOCALAPPDATA\Microsoft\Windows\Explorer\iconcache*" -Force -ErrorAction SilentlyContinue
Start-Process explorer.exe
```

--------------------------------------------------------------------------------

## Contribuição

- Abra um PR com descrição clara do que foi alterado.
- Execute `npm run build:renderer` para validar mudanças no front-end.
- Inclua testes manuais de empacotamento se alterar a configuração do `electron-builder`.

--------------------------------------------------------------------------------

## Perguntas frequentes (FAQ)

Q: Posso usar esse projeto em Linux/macOS?
A: O código do renderer e da lógica pode rodar, mas o empacotamento e scripts estão orientados para Windows; ajustes são necessários para targets macOS/Linux.

Q: Onde coloco chaves e segredos?
A: No `.env` local. Não comite esse arquivo no repositório.

--------------------------------------------------------------------------------

## Próximos passos recomendados

- Adicionar um script `validate-env` que checa as variáveis mínimas antes de `build`/`dev`.
- Criar workflow de CI (GitHub Actions) que roda `npm run build` e publica artefatos no Releases.

--------------------------------------------------------------------------------

## Licença

- Verifique `package.json` para o campo `license` (atualmente `MIT`).

---

Se quiser, eu adapto este README para inglês ou gero um `CONTRIBUTING.md` e uma workflow de CI automatizada.
