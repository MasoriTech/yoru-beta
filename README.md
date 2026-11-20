# Yoru v0.63.0 — KoboldCpp como cérebro

Assistente que vive na área de trabalho do Windows: avatar VRM 3D (ou chibi 2D) transparente, chat com IA, voz, gestos pela câmera, automação doméstica e controle pelo celular. O cérebro padrão é o **KoboldCpp**, então a IA roda no seu PC, sem conta e sem chave.

> ⚠️ **Versão beta.** Está em teste público e pode ter bugs. Achou algo? [Abra uma issue](../../issues/new/choose). Veja [Reportar problemas](#reportar-problemas).

## O que tem

- **Avatar** VRM 3D com lip-sync, emotes e vida parada; modo chibi 2D com 50 reações.
- **IA com vários provedores:** KoboldCpp (padrão), Ollama, Anthropic, OpenRouter, servidor local compatível com OpenAI e OpenClaw (agente com skills).
- **Voz:** reconhecimento de fala (opcional Faster-Whisper), TTS, comandos de voz em português.
- **Gestos** de mão e corpo pela câmera (MediaPipe).
- **Casa e dispositivos:** lâmpada TP-Link Tapo L530E, Bluetooth por voz, iPhone/Android pelo Hub.
- **Yoru no celular (PWA):** chat e controle do PC protegido por senha.
- **Masori:** agentes especialistas que analisam tarefas e arquivos do workspace.
- **Segurança e suporte:** Central de Saúde, logs com credenciais ocultadas, backup `.yorubackup` e credenciais guardadas com o cofre do Windows.

## Requisitos

- Windows 10/11 x64
- Node.js 20+ (o `iniciar.bat` tenta instalar pelo WinGet)
- Python 3.10+ (só para a lâmpada Tapo e o Faster-Whisper)
- Internet na primeira preparação (dependências e modelo de mão)

## Instalar e iniciar

**Mais fácil:** baixe o ZIP do código (ou clone), extraia tudo e dê dois cliques em `iniciar.bat`. Ele prepara as dependências e abre a Yoru.

**Manual:**

```bash
npm ci        # ou: npm install
npm start
```

O `iniciar.bat` não instala drivers Bluetooth/Wi-Fi, e não baixa modelos Ollama; Ollama, ADB, scrcpy e receptores AirPlay são integrações externas e opcionais.

## Ligar o cérebro (KoboldCpp)

1. Baixe o [KoboldCpp](https://github.com/LostRuins/koboldcpp) e um modelo `.gguf`.
2. Abra: `koboldcpp.exe --model seu-modelo.gguf --port 5001 --contextsize 4096`
3. Confira com `npm run check:kobold`.
4. Na Yoru: aba **IA › Conexão › KoboldCpp** (o botão **Buscar** mostra o modelo).

O prompt da Yoru é longo: use contexto de pelo menos 4096. Em modelos pequenos, desligue "A IA conhece os comandos" na aba IA se ficar lento. Para trocar de provedor, veja `config.example.json` (copie para `config.json`; ele nunca vai para o Git).

## Desenvolvimento

```bash
npm test                 # suíte automatizada (node --test)
npm run check            # diagnóstico de voz
npm run pack             # build sem instalador (dist/)
npm run dist:setup       # instalador NSIS
npm run dist:portable    # versão portátil
```

Estrutura:

| Pasta | Conteúdo |
|---|---|
| `src/` | código do app (Electron: processo principal, painéis, avatar, IA, voz) |
| `src/remote/` | app web do celular (PWA) |
| `assets/` | ícones, avatar padrão, reações 2D, biblioteca |
| `scripts/` | utilitários (vendor, checagens, OpenClaw, Hub, Bluetooth) |
| `test/` | testes automatizados |
| `build/` | recursos do instalador |
| `design/` | referência visual (fora do instalador) |
| `docs/` | guias detalhados |

## Reportar problemas

Use os formulários em **Issues**. Inclua versão, Windows, provedor de IA e passos para repetir. Se anexar logs (Central de Saúde › exportar), **revise antes**: eles podem ter caminhos locais. Nunca cole chaves de API ou tokens. Falhas de segurança: veja [SECURITY.md](SECURITY.md).

## Documentação

- [CHANGELOG.md](CHANGELOG.md): histórico de versões
- [docs/guia-completo.md](docs/guia-completo.md): Tapo, OpenClaw, Hub, PWA e mais
- [CONTRIBUTING.md](CONTRIBUTING.md): como contribuir

## Licença

Todos os direitos reservados (`UNLICENSED`). Veja `build/license.txt`. Os modelos em `assets/` podem ter licenças próprias.
