# Changelog

## 0.63.0 — KoboldCpp como cérebro (2026-11-19)

- Novo: provedor **KoboldCpp** (aba IA › Conexão), servidor local no formato da OpenAI em `http://localhost:5001/v1`. Sem chave obrigatória (senha opcional se o KoboldCpp usar `--password`), o nome do modelo é opcional e o botão **Buscar** mostra o modelo carregado. Streaming, memória, comandos, gestos e imagens (com `--mmproj`) funcionam como nos outros provedores; tempo de espera de 5 min para modelos em CPU.
- Novo: o **KoboldCpp é o cérebro padrão** em instalações novas e em `config.example.json`. Quem já tem `config.json` mantém o provedor escolhido.
- Novo: roteamento **LOCAL** continua no KoboldCpp quando ele é o provedor (antes sempre trocava para o Ollama); o agente Masori também pode usar o KoboldCpp.
- Novo: `npm run check:kobold [endereço]` testa se o KoboldCpp está no ar, qual modelo carregou e se responde (aceita `YORU_KOBOLD_KEY` para senha).
- Mudado: provedor inválido ou ausente no `config.json` agora volta ao KoboldCpp (antes, à Anthropic).
- Testes novos em `test/ai-core.test.js` e `test/ai-router.test.js`.

## 0.62.0 — Yoru menos dura, OpenClaw com skills e PWA com temas (2026-11-19)

### Yoru menos dura
- Parada: joelhos soltos (antes ficavam travados); a perna que não carrega o peso cede um pouco e o quadril acompanha a troca de peso.
- Caminhando: cotovelos dobram no balanço dos braços, mãos soltas, tronco e ombros em contrapeso, cabeça contrabalança o giro e passo com leve irregularidade (2º harmônico).
- Falando: a cabeça e o corpo usam vários ritmos que não se alinham, o pescoço, os ombros e as mãos acompanham, e os braços reagem ao volume da voz de forma suavizada (sem tremer). Novo: gesto de ênfase — de tempos em tempos um braço sobe à frente, abre a mão e volta (1,6 a 2,4 s), alternando os lados e respeitando o braço que segura item.
- Teste novo em `test/idle-life.test.js`.

### OpenClaw: usar as skills do agente
- Novo: **🚀 Abrir e deixar pronto** (antigo Reparar): além de arrumar o `openclaw.json`, agora (a) cria uma configuração mínima válida se o arquivo não existe ou está quebrado sem versão boa (o quebrado fica guardado), (b) instala/inicia o gateway se estiver parado, e (c) se NENHUM token encontrado é aceito, **define um token novo** no OpenClaw (edição direta com cópia de segurança, ou `openclaw config set` se o arquivo for JSON5), reinicia o gateway e guarda o mesmo token na Yoru. A conexão automática (401 no chat / ao abrir o app) escala para esse reparo completo quando a leitura leve falha, no máximo uma vez a cada 10 minutos.
- Novo: **conexão automática com o OpenClaw**. (1) A detecção agora junta todos os lugares onde o token pode estar (openclaw.json, `env.vars`, `~/.openclaw/.env`, `gateway.cmd` do serviço, variáveis de ambiente, SecretRef e, por último, o próprio `openclaw config get`), testa cada um no gateway e usa o que ele aceita (também tenta a senha se o modo declarado for token). (2) Se uma conversa recebe 401, a Yoru reconecta sozinha, atualiza o token e repete o pedido uma vez. (3) Ao abrir o app, se o OpenClaw é o provedor e a conexão guardada não funciona, reconecta em segundo plano (inicia o gateway se estiver parado; reinicia se ele ficou com o token antigo). Esse caminho automático só lê e testa: não reescreve o `openclaw.json` (isso fica no botão Reparar, com confirmação). Novo `src/openclaw-connect.js` + `test/openclaw-connect.test.js`.
- Novo: **🛠 Reparar OpenClaw sozinha** (aba IA) e oferta automática quando a detecção falha. Identifica e resolve: `openclaw.json` ilegível (volta para o `.last-good`, guardando o quebrado), chaves que a versão instalada não reconhece (remove só as que o `openclaw config validate` aponta; migra a `env.OPENROUTER_API_KEY` solta para `env.vars`), gateway não instalado/parado (`gateway install` + `start`), token recusado (reinicia o gateway e relê o token) e endpoint de chat desligado. Só reescreve JSON puro, sempre com cópia de segurança e confirmação. Novo `src/openclaw-repair.js` + `test/openclaw-repair.test.js`.
- Novo: **instalar skills no OpenClaw** pela aba IA (provedor OpenClaw): buscar no ClawHub, instalar pelo resultado ou digitando `@dono/skill`, `git:dono/repo` ou `skills-sh:dono/repo/skill`, ver as instaladas e atualizar todas. Quem baixa e instala é o próprio `openclaw skills install` (que varre a skill); instala no agente que a Yoru usa. Pede confirmação antes de instalar; só aceita essas origens (nada de pasta local) e os argumentos são validados antes de chegar ao comando. Novo `src/openclaw-skills.js` + `test/openclaw-skills.test.js`.
- Corrigido: o modo FAST (220 tokens) cortava as respostas do agente no meio da tarefa. Para o OpenClaw o Yoru não envia mais `max_tokens`.
- Corrigido: o prompt "responda em no máximo 2 frases" escondia o resultado das skills. O agente agora recebe um aviso de que pode usar as skills e relatar o resultado completo.
- Corrigido: o agente aceita todos os formatos atuais do gateway (`openclaw`, `openclaw/default`, `openclaw/<id>`, `openclaw:<id>`, `agent:<id>`). O cabeçalho `x-openclaw-agent-id` só vai quando há um agente específico. Novo padrão: `openclaw/default`.
- Novo: erro 404/405 do gateway explica que o endpoint de chat vem desligado e como ligar; 401 explica onde achar o token.
- Novo: **🆓 Enviar ao OpenClaw e usar modelos gratuitos**: a chave do OpenRouter vai para o `env.vars.OPENROUTER_API_KEY` do `openclaw.json` (o OpenClaw 2026.11 recusa a chave solta em `env`; arquivos gravados do jeito antigo são migrados) (confirmação + cópia de segurança) e o agente passa a usar um modelo `:free` com suporte a ferramentas, enviado pelo cabeçalho `x-openclaw-model`. A chave nunca volta para a tela.
- Novo: botão **Detectar OpenClaw** na aba IA: lê o `openclaw.json`, acha porta e token, testa o gateway, lista os agentes, salva a configuração e oferece ligar o endpoint (com confirmação e cópia de segurança). O token fica só no processo principal. Botão **Quais skills?** pergunta ao agente quais skills ele tem.
- Novo: `npm run setup:openclaw` liga o endpoint no `~/.openclaw/openclaw.json` (simula primeiro; `--apply` grava com cópia de segurança).

### PWA — personalização e acessibilidade

- Adicionado tema claro, escuro e automático (segue a preferência do sistema).
- Adicionada opção para reduzir animações e transições, respeitando preferências de acessibilidade.
- Cor da barra do navegador acompanha o tema escolhido.
- Preferências novas são salvas localmente e preservam as configurações anteriores.

## 0.61.0 — Yoru no celular (app web / PWA para Android e iPhone)
- Novo: **app web instalável** servido pelo próprio Yoru (Configurações › Celular). Funciona no Android e no iPhone pelo navegador, sem loja de apps.
- **Modo 1 — usar a Yoru:** conversa pelo celular com a mesma IA, memória e perfil. O aparelho é pareado uma vez por QR Code/código de 8 números gerado no PC (uso único, vale 10 min). A conversa do celular não executa comandos de voz locais, então este modo nunca mexe no PC.
- **Modo 2 — controlar o PC com senha:** volume, mídia, passar slides, janelas, abrir programas, ver a tela e energia (bloquear, suspender, reiniciar, desligar com 30 s para cancelar). Só funciona com a senha definida **no PC**; a sessão expira por inatividade (5 min a 1 h) e desligar/reiniciar/suspender pedem confirmação.
- Segurança: desligado por padrão; tokens de 256 bits (no disco só o hash); senha com scrypt; bloqueio progressivo após erros; lista fixa de ações (sem comando livre); checagem de Host/Origin; cabeçalhos CSP; limites de taxa; aparelhos revogáveis; o `remote.json` nunca entra no backup.
- 3 novos arquivos de teste cobrem servidor, integração (IPC, painel, PWA, backup) e as regras de segurança.

## 0.60.5 — Float Dock: correções e refinamentos
- Corrigido: o botão de recolher/expandir ficava fora da barra (a regra `.side > *` da 0.60.4 anulava o `position:absolute`) e podia sair da tela. Agora fica preso à barra nas quatro posições.
- Corrigido: a barrinha do atalho ativo e o "pulo" do hover eram cortados pela rolagem interna do dock.
- A barra inferior ganhou 6px de margem extra para o botão de recolher não encostar na borda da janela.
- Novo: ao arrastar o símbolo Y aparece uma área tracejada mostrando onde o dock vai encaixar; Esc cancela o arraste.
- Novo: setas, Home e End navegam entre os atalhos do dock (Tab entra e sai do grupo).
- Novo: a aba ativa é rolada para dentro da vista quando o dock está com rolagem (janelas pequenas).
- Icon Sidebar: o rodapé deixou de gerar rolagem horizontal e os botões se compactam em janelas baixas (≤880px e ≤700px), mantendo Bots, Configurações e o indicador de status visíveis.
- Novos testes de regressão para o botão de recolher, a área de encaixe, a navegação por teclado e o Icon Sidebar compacto.

## 0.60.4 — Float Dock visual polish
- Refined Float Dock with a layered smoked-glass surface, amber highlights, deeper shadows and subtle inner reflections.
- Added clearer grouping separators and more tactile hover/active/focus states for navigation icons.
- Improved the Yoru mark, avatar visibility toggle and collapse handle styling.
- Added orientation-aware active indicators and hover motion for vertical dock positions.
- Preserved dock repositioning, collapse behavior, responsive sizing and accessibility labels.

## 0.60.3 — Float Dock reposicionável e recolhível
- Adicionadas posições superior, inferior, esquerda e direita para o Float Dock.
- O símbolo Y funciona como alça de arraste: solte próximo de uma borda para encaixar o dock.
- Adicionada aba acessível para recolher e expandir a navegação; o controle permanece visível no modo recolhido.
- Posição e estado recolhido são persistidos nas configurações e restaurados ao abrir o painel.
- Espaço do conteúdo ajustado conforme a borda selecionada para evitar sobreposição dos atalhos.

## 0.60.2 — navegação refeita com comportamento por área
- Discord agora usa áreas reais (Pessoal, Comunicação, Inteligência e Sistema); selecionar uma área troca os canais exibidos e preserva a última aba selecionada de cada área durante a sessão.
- Trilho do Discord deixa de apontar para abas isoladas e passa a representar as quatro áreas principais da Yoru.
- Icon Sidebar mantém navegação completa, separadores por grupo, marca da Yoru e nomes via atributos nativos acessíveis, sem tooltips cortados pelo scroll.
- Float Dock mantém a marca da Yoru, o controle de visibilidade e os atalhos em uma doca horizontal com rolagem própria.
- Centralizadas as regras responsivas dos três modelos para impedir que as antigas regras de menu móvel se sobreponham aos layouts.
- Ampliados os testes estruturais e de consistência dos grupos de navegação.

## 0.60.1 — refinamento dos layouts de navegação
- Reorganizada a navegação em grupos claros: Pessoal, Comunicação, Inteligência e Sistema.
- Icon Sidebar agora mantém a marca Yoru, mostra tooltips acessíveis e usa alvos de navegação com dimensões consistentes.
- Float Dock ganhou dock horizontal de verdade, botões compactos, tooltips e rolagem horizontal em telas estreitas.
- Discord agora tem trilho de espaços, menu de canais agrupado e área principal independente, com comportamento adaptado para janelas menores.
- Corrigidas regras responsivas conflitantes que convertiam layouts em coluna em larguras pequenas.
- Melhorada a semântica de navegação e os estados visuais ativos.

## 0.60.0 — layouts de navegação personalizáveis
- Adicionados os layouts Float Dock, Icon Sidebar e Discord, selecionáveis em Configurações › Aparência.
- Float Dock organiza os atalhos em uma doca flutuante inferior; Icon Sidebar compacta a navegação em ícones; Discord separa atalhos, canais e conteúdo.
- A preferência de layout é validada e salva junto às configurações do usuário, sem duplicar ou remover funcionalidades das abas.
- Adicionada prévia visual dos três modelos e suporte a redimensionamento de janela.
- Testes de validação dos layouts permitidos.

## 0.59.0 — Mega Upgrade de estabilidade e recuperação
- Criado logger técnico local em JSON Lines, com rotação de arquivos e limite de armazenamento.
- Credenciais conhecidas, chaves de API, tokens Bearer e senhas em URLs são ocultados antes de gravar os registros.
- Falhas de renderização, encerramento de processos auxiliares, exceções e rejeições não tratadas passam a gerar eventos técnicos locais.
- Adicionada exportação manual dos logs pela Central de Saúde, com aviso explícito sobre privacidade e revisão antes do compartilhamento.
- Central de Saúde ampliada com RAM livre, espaço em disco (quando a plataforma oferece `statfs`), avatar padrão e arquivos de conectividade.
- Restauração de backup agora recusa traversal, arquivos incompletos e destinos simbólicos; todos os temporários são preparados antes da substituição e os arquivos originais são restaurados se uma etapa falhar.
- O backup ignora links simbólicos também na leitura da configuração externa e limita quantidade de arquivos.
- `iniciar.bat` usa `npm ci` quando o lockfile está disponível, mantendo `npm install` como compatibilidade para pacotes sem lockfile.
- Novos testes para logs, remoção de credenciais, rotação, verificações da Central de Saúde e rollback de backup.

## 0.58.3 — seis novos emotes
- Adicionados os gestos Joinha, Coração, Mandar beijo, Apontar, Dar de ombros e Facepalm.
- Criadas animações próprias no VRM e movimentos visuais equivalentes no Chibi 2D.
- Atualizados o seletor de gestos, as descrições da IA e os comandos de voz.
- Migração `emoteVer: 5` adiciona os novos emotes a perfis antigos uma única vez.

## 0.58.2 — ajustes visuais de interface
- Padronizadas proporções e espaçamentos das abas principais e subabas.
- Ajustada a grade dos painéis para priorizar cartões com largura confortável em janelas médias.
- Uniformizados altura e alinhamento de botões, controles, campos e títulos.
- Melhorada a distribuição responsiva das abas da Tapo, conectividade, criação e bots.
- Conferida a apresentação em larguras de 1440 px, 1024 px e 800 px.

## 0.58.1 — correções de estabilidade e comandos de movimento
- Corrigido o empacotamento Windows para incluir `scripts/**/*`.
- Adicionado timeout configurável ao conector Tapo e repetição limitada para descoberta sem dispositivos.
- Corrigido cancelamento de respostas do WhatsApp após desconectar; adicionados deduplicação e limite de fila.
- Reorganizada a lâmpada Tapo em quatro abas internas: Controle, Cores e cenas, Voz e automações, Conexão e diagnóstico.
- Adicionados comandos de voz para deslocar o avatar para esquerda/direita, sair da frente e se abaixar.
- Evitada execução duplicada do empacotamento de recursos ao iniciar pelo `iniciar.bat`.

0.58.1 — WhatsApp Web (sem conta Business) e Tapo sem limite de tempo
- Bots › WhatsApp: novo canal “WhatsApp Web”. Conecte um número lendo um QR code (sem conta WhatsApp Business). O bot responde pelas regras de palavra-chave e, se ligado, com a IA do Yoru usando a personalidade e as instruções do bot escolhido. Só responde a números permitidos (ou a todos, se você marcar), nunca a grupos; limite de respostas por hora por contato e “digitando…” antes de enviar. Reconecta sozinho. Biblioteca: `@whiskeysockets/baileys` (não oficial; rode `npm install` ou use `iniciar.bat`).
- Smart Home › Tapo: o tempo de conexão com a lâmpada agora é infinito. O Yoru tenta de novo a cada 3 s até a lâmpada responder; só para em erros que repetir não resolve (senha errada, biblioteca ausente). Para limitar, defina `YORU_TAPO_TIMEOUT_MS`.
- Voz › lâmpada: “liga a luz”, “desliga a luz” e “apaga a luz” funcionam na forma curta. “Estou com sono” e “vou dormir” apagam a luz e desejam boa noite (não valem para perguntas, negações nem pedidos com tempo; sem Tapo configurada, a conversa segue normal). A Yoru só lista o que sabe fazer com a lâmpada quando você pede (“me ensina sobre a lâmpada”, “o que você sabe fazer com a lâmpada”); antes ela soltava essa lista sempre que não entendia um comando. “Modo festa” e “modo relax” agora falam “modo” (e a Yoru sai deles com “sai do modo festa” / “desativa o modo relax”, que antes ativavam de novo). A explicação da lâmpada cita “apague a lâmpada”, “desligue a lâmpada”, modo festa e modo relax.

## 0.57.0 (ajuste) — Pareamento Bluetooth real
- A Yoru agora pareia de verdade pela API do Windows (`scripts/bt-pair.ps1`), sem depender de você clicar em “Parear” nas configurações. Funciona para dispositivos sem PIN (caixas de som, fones, teclados) em modo de pareamento.
- A busca passou a incluir dispositivos Bluetooth clássicos próximos ainda não pareados (`scripts/bt-classic-scan.ps1`); antes só apareciam os já conhecidos pelo Windows e anúncios BLE.
- Se o dispositivo exigir PIN ou o Windows recusar o pareamento automático, a Yoru abre as configurações de Bluetooth como alternativa.
- Tapo: quando a descoberta por broadcast não acha a lâmpada, a Yoru agora varre os IPs da rede local (porta 80) e conversa direto com os que responderem; mensagem de erro orienta Firewall/rede de convidados/IP manual.
- Modelo de voz: download reforçado. (1) Não baixa mais o modelo integrado em paralelo ao Faster-Whisper (o download cancelado deixava arquivo pela metade no cache). (2) Falha de rede: até 3 novas tentativas com espera crescente. (3) Arquivo corrompido/truncado: apaga só a pasta daquele modelo e baixa de novo. (4) Download sem progresso por 3 min é detectado e repetido. (5) Se a internet cair de vez, a Yoru tenta de novo sozinha a cada 1 min (até 5 vezes) e o painel mostra “Tentando baixar de novo (n/3)”. (6) Faster-Whisper também tenta de novo e limpa o cache corrompido. (7) Corrigida corrida na detecção do Faster-Whisper que fazia pedidos de modelo chegarem fora de ordem. Opcional: `YORU_HF_ENDPOINT` usa um espelho do Hugging Face se o site oficial estiver bloqueado.
- Tapo por IP: o botão “Encontrar” agora usa o IP digitado (antes só fazia broadcast e ignorava o IP). Se a descoberta UDP for bloqueada, a Yoru conecta direto por TCP testando os protocolos da Tapo (KLAP/AES, HTTP/HTTPS). Quando falha, a mensagem diz o motivo real (IP não responde nas portas 80/443, senha recusada, firmware não suportado) em vez de “nenhuma Tapo encontrada”.
- A Yoru só diz “pareado” quando o Windows confirma.
- Depois de parear, a Yoru confere se o dispositivo está conectado (`scripts/bt-connect.ps1`). Se não estiver, pergunta “Quer que eu conecte agora? Diga sim ou não” e tenta conectar quando você confirma.

## 0.57.0 — Inicialização unificada no Windows
- Adicionado `iniciar.bat` para preparar dependências atuais do Yoru e iniciar o aplicativo com duplo clique.
- Verifica Node.js x64 20+ e Python 3.10+; tenta instalar Node.js LTS/Python 3.12 pelo WinGet quando ausentes.
- Instala dependências Node/Electron e prepara recursos locais Three.js/VRM/MediaPipe.
- Instala/atualiza `python-kasa` para disponibilizar a integração Tapo L530E sem exigir comandos manuais.
- Inclui opção `--instalar-whisper` para instalar Faster-Whisper; sem essa opção, o reconhecimento integrado continua como fallback.
- Diagnostica Ollama, ADB e scrcpy sem instalar ou alterar essas integrações externas opcionais.
- O iniciador não instala drivers, não altera pareamento Bluetooth, não configura contas/chaves e não baixa modelos Ollama; essas etapas continuam sob controle do usuário.
- Aba Conectividade organizada em sub-abas: Rede, Celulares, Bluetooth e Wi-Fi, Smart Home, Hardware e Arquivos.
- Bluetooth por voz: a Yoru informa apenas que encontrou dispositivos e a quantidade; ela só fala o dispositivo que você selecionar.
- Janela de dispositivos Bluetooth: lista rolável com rodapé fixo, janela independente do painel/avatar e botão “Buscar novamente”.
- Resposta ao ser chamada pelo nome: 24 variações (antes eram 5, com o “Hm? Diga!” aparecendo toda hora), sem repetir a mesma duas vezes seguidas.
- Resposta às duas palmas: 24 variações, sem repetir a mesma duas vezes seguidas.
- Tapo L530E (correções na integração): descoberta em todas as interfaces de rede (VPN/WSL/Hyper-V não bloqueiam mais); se o IP salvo mudou, a lâmpada é reencontrada sozinha; senha errada/timeout/rede agora têm mensagens claras em português (antes aparecia “0 lâmpadas”); conexões fechadas corretamente; aceita outras lâmpadas Tapo da família L5xx/L9xx; modo cor não mostra mais 2500 K; `iniciar.bat` passa a exigir Python 3.11+ (requisito do python-kasa atual).

## 0.56.0 — Central Bluetooth por voz e janela de seleção
- Corrigida a descoberta solicitada por voz: combina inventário de dispositivos Bluetooth clássicos reconhecidos pelo Windows com anúncios Bluetooth LE próximos; a busca BLE isolada não é mais a única fonte.
- Filtra rádios, adaptadores e enumeradores do inventário para evitar apresentá-los como acessórios.
- Adicionada janela Electron própria, sempre visível, com lista numerada, tipo/estado do dispositivo e seleção por clique ou voz.
- Fluxo por voz: “mostrar dispositivos Bluetooth” → Yoru informa quantos encontrou → “o 2”/nome do dispositivo → confirmação “sim/não” → abertura do fluxo nativo de conexão/pareamento do Windows.
- A seleção por voz aceita números, ordinais e nome do dispositivo; a janela exibe a confirmação antes de iniciar qualquer ação.
- O Yoru não finge concluir a conexão: o pareamento, PIN e confirmação de perfil de áudio permanecem controlados pelo Windows; a interface informa quando a etapa final precisa ser confirmada no sistema.
- Adicionados testes para normalização/deduplicação de dispositivos clássicos e BLE, exclusão de adaptadores, seleção numérica e confirmação/cancelamento por voz.

## 0.55.0 — Comandos de voz ampliados para Tapo L530E
- Reconhecimento direto de voz para ligar/desligar, brilho absoluto e relativo, cores HSV nomeadas/aleatórias e temperatura de branco entre 2.500 e 6.500 K.
- Adicionados comandos para efeitos nativos (ex.: Party/Relax), desligar efeitos, presets 1–7 e transições suaves configuráveis (quando expostas pelo firmware).
- Consulta do estado da lâmpada por voz e exposição das capacidades detectadas no painel Smart Home.
- Temporizadores pontuais por voz gerenciados pelo Yoru, com limite de 24 horas e aviso de que o Yoru precisa permanecer aberto.
- Reconhecimento transparente de Auto White, Modo Ausente, agendas recorrentes, nascer/pôr do sol e consulta de consumo; o Yoru não confirma execução/dados quando a API local/firmware não expõe a capacidade necessária.
- Ampliados testes do parser, validação de ações e fluxo de voz.

## 0.54.0 — Conectividade universal e MASORI Smart Home
- Inventário universal de adaptadores de rede pelo Windows PowerShell/Get-NetAdapter, classificando Wi-Fi, Bluetooth PAN, Ethernet e outros; funciona com marcas/modelos distintos quando o driver é reconhecido pelo Windows.
- Atalhos para as configurações nativas de Wi-Fi e Bluetooth do Windows.
- Integração local da TP-Link Tapo L530E por python-kasa: descoberta, consulta de estado, ligar/desligar, brilho, cor HSV, temperatura (2.500–6.500 K) e cenas.
- Credenciais protegidas pelo Electron safeStorage/Windows DPAPI; armazenamento criptografado e nenhuma senha exposta ao renderer.
- A integração Tapo é opcional e requer Python 3 + `py -3 -m pip install --user python-kasa`; computador e lâmpada devem estar na mesma rede.
- Não tenta instalar drivers universais nem controlar adaptadores que o Windows não reconhece.

## 0.53.0 — Visão computacional autorizada
- Adicionada listagem de janelas e telas pelo módulo Electron desktopCapturer, sem capturar thumbnails durante a listagem.
- Adicionada captura sob ação explícita, prévia local e segundo clique para enviar a imagem ao Masori-Vision.
- Integração multimodal com o provedor/modelo individuais configurados para Masori-Vision.
- Análise orientada a identificar janela/aplicativo, elementos visíveis, mensagens de erro legíveis, hipóteses e passos seguros de diagnóstico.
- Capturas temporárias em memória, uso único e expiração após 3 minutos; nenhuma imagem é gravada no histórico ou no disco.
- Limites de tamanho da imagem e rate limits por IPC.
- Adicionados testes unitários e de integração da captura/visão.

## 0.52.0 — Workspace seguro e execução acompanhada MASORI
- Workspace local escolhido pelo usuário, com navegação, busca textual e leitura somente de arquivos de texto explicitamente selecionados.
- Proteção contra caminhos fora do workspace, links simbólicos, pastas sensíveis, arquivos binários e arquivos excessivamente grandes.
- Busca limitada a 300 arquivos/5 MB; contexto de até oito arquivos e 48 KB fornecido aos especialistas selecionados.
- Progresso das etapas, bloqueio de execuções simultâneas e cancelamento com AbortSignal enviado às chamadas de IA em andamento.
- Exportação dos relatórios em Markdown por janela nativa de salvamento.
- Nenhuma execução de terminal, script ou comando pelo Masori-Agent.

## 0.51.0 — Masori-Sama configurável
- Configuração individual de provedor/modelo por especialista, herdando a configuração principal por padrão.
- Memória persistente por especialista, com até três relatórios anteriores relevantes.
- Histórico local das últimas 30 execuções.
- Uma repetição automática em caso de falha na chamada de cada especialista.
- Configurações e histórico armazenados no diretório de dados do usuário, sem duplicar chaves de API.

## v0.50.0 — Multiagente Masori-Sama

- Chamadas independentes para até três especialistas em paralelo.
- Síntese final feita por Masori-Sama com relatórios individuais visíveis.
- Mantida transparência: agentes ainda compartilham o provedor configurado e não possuem ferramentas/modelos individuais.

## v0.49.0 — Masori-Sama

- Novo agente coordenador Masori-Sama e registro de especialistas Masori-Dev, Research, Vision, Memory, Voice e Agent.
- Nova aba dedicada para planejar tarefas e executá-las pelo provedor de IA já configurado.
- Execução transparente: esta versão usa uma chamada coordenada ao modelo atual; não simula agentes independentes nem paralelismo.
- Mantém Yoru como personagem/interface desktop e MASORI como ecossistema.

## 0.48.0
- Adicionada descoberta automática de agentes Yoru na rede local via multicast UDP, sem transmitir tokens.
- Criada lista de computadores encontrados com preenchimento do endereço; autenticação continua exigindo token manual.
- Android: conexão ADB por Wi-Fi com validação de IP privado e opção de espelhamento com áudio (scrcpy 2.0+).
- Mantidas as conexões existentes de iPhone, Android, Bluetooth, USB, AirPlay e compartilhamento local.

## 0.47.0 — Correções QR e compatibilidade de botões

- Corrigida a penalidade N4 do QR Code para seguir o cálculo de equilíbrio claro/escuro da especificação.
- Padronizado `type="button"` nos botões criados dinamicamente no painel de Conectividade, evitando submissões implícitas de formulário.
- Declarado `type="button"` nos controles de exportação/cópia do QR Code.
- Mantida a interface nativa HTML/CSS/JavaScript do Electron, sem adicionar biblioteca visual externa.

## [0.46.0] - 2026-11-14
### Adicionado — Gerador de QR Code
- Novo módulo `src/qr.js`: gerador de QR Code próprio, sem dependências e sem rede (modo byte UTF-8, versões 1–40, correção L/M/Q/H).
- Novo cartão "Gerador de QR Code" na aba Conectividade: texto/link, rede Wi-Fi (formato lido pelas câmeras do Android e do iOS) e endereço do compartilhamento; escolha do nível de correção; baixar PNG ou SVG; copiar o conteúdo.
- O compartilhamento na rede local agora mostra o botão "QR Code" em cada endereço, para abrir a página direto no celular.
- Testes: estrutura (localizadores, sincronismo, informação de formato), limites, Wi-Fi e vetor de regressão. A saída também foi conferida com um decodificador independente em todas as versões e níveis.

## [0.45.0] - 2026-11-14
### Melhorias — aba Conectividade (2ª rodada)
- Ao abrir a aba, restaura o que já estava ativo: compartilhamento na rede local (com os endereços), agente Windows conectado e pasta local escolhida. Antes, recarregar o painel parecia "desligar" tudo.
- Lista dos arquivos escolhidos para o celular baixar, com tamanhos e total.
- Botão "Copiar IP" em cada interface de rede.
- Histórico das últimas 40 ações (botão 🕘 Histórico), para consultar mensagens que já sumiram da barra de status.
- Seções recolhíveis (clique no título), com a escolha lembrada.

## [0.44.1] - 2026-11-14
### Correção
- Memória do chat: "Editar lembrança" usava `prompt()`, que o Electron não suporta. A edição agora é feita no próprio item (Enter salva, Esc cancela) e o erro aparece junto do campo.

## [0.44.0] - 2026-11-14
### Melhorias — aba Conectividade
- Corrigido: "Baixar arquivo" e "Enviar arquivo" do Android usavam `prompt()`, que o Electron não suporta. Agora usam um diálogo próprio.
- Resumo no topo com o estado de rede, armazenamento, Bluetooth, USB, Android, agente Windows e compartilhamento.
- A primeira verificação do computador passa a rodar só quando a aba é aberta, em vez de na inicialização do painel.
- Botões com estado "ocupado" (verificar, compartilhar, conectar, detectar Android) e horário da última verificação.
- Tamanhos legíveis (KB/MB/GB), pastas antes dos arquivos e ordenação natural nas listas de arquivos.
- Lista "Este computador" com "Enviar ao Android" e "Enviar ao PC" em cada arquivo; a pasta atual do Android sincroniza com o campo de destino.
- Agente Windows: endereço lembrado (o token nunca é gravado), validação, Enter para conectar e erros sem o prefixo técnico do Electron.
- Cópia do endereço de compartilhamento com aviso quando a área de transferência falha.
- Aviso claro quando falta escolher a pasta deste PC antes de baixar do Android ou do agente.

## [0.43.0] - 2026-11-14
### Melhorias — aba Bots
- Corrigido: o script da aba não estava ligado ao layout da v0.41. Agora funcionam os indicadores da Visão geral, os atalhos, a busca, o filtro por status e o botão Cancelar.
- Lista de bots com contagem, estado vazio distinto de "nada encontrado", data de criação, canal legível, instruções resumidas e destaque do bot em edição.
- Novo atalho "Simular" em cada bot; o simulador mostra todas as regras acionadas, destaca a que seria usada e avisa quando o bot está pausado.
- Construtor com contadores de caracteres, título que indica o bot em edição, Enter no nome e Ctrl+Enter nos textos para salvar, e aviso de nome repetido.
- Automações: editar regra, Enter para adicionar e bloqueio de palavra-chave duplicada (ignora acentos e maiúsculas).
- WhatsApp: Phone Number ID, WABA ID e versão da API ficam lembrados; o token continua sem ser gravado. Telefone de destino validado antes do envio.
- Avisos discretos no lugar de alertas do sistema; importação de backup ignora IDs duplicados.

## [0.42.0] - 2026-11-14
### Ajustes — Yoru Chibi
- Aumentado o aproveitamento da tela pelo avatar 2D, mantendo margem responsiva e sem cortar o personagem nas laterais.
- Criado controle independente de tamanho do Yoru Chibi 2D (65% a 150%) na aba Avatar.
- Mantida a proporção original das ilustrações em todas as 50 reações.
- Escala aplicada também ao hit-test e à aura, pois ambos acompanham o retângulo real do sprite.
- Adicionados testes de escala progressiva, limites de tela e sanitização da configuração.

## [0.41.0] - 2026-11-14
### Melhorias — Central de Bots
- Reorganização da navegação e hierarquia visual da aba Bots.
- Visão geral com indicadores de bots cadastrados, ativos e regras.
- Atalhos para construtor, WhatsApp, simulador e automações.
- Construtor e lista de bots em colunas responsivas.
- Busca por nome/canal e filtro por status.
- Estados vazios mais claros e ações de edição/cancelamento.
- Seções de WhatsApp, simulador, regras e backup com agrupamento mais claro.
- Mantidos os identificadores e o armazenamento local existentes para preservar os dados dos usuários.

> **v0.40.0 — Central do iPhone:** detecção de iPhone/Apple Mobile Device USB pelo Windows; atalho para abrir Fotos e seguir a importação oficial; configuração, inicialização e encerramento de receptor AirPlay externo instalado; painel único para USB, importação e espelhamento assistido. O receptor não é distribuído com Yoru e seus recursos de vídeo/áudio dependem do fornecedor. Não há controle remoto universal do iOS nem importação USB nativa dentro do Yoru.

> **v0.39.0 — Conector iPhone/Safari:** página móvel reorganizada com seletores separados para fotos/vídeos e documentos; progresso de transferência e cancelamento mais claros; estados vazios nas listas; removida seção duplicada com IDs HTML repetidos; cabeçalhos de segurança `no-store`, `nosniff` e `no-referrer` no portal local. O envio em blocos retomável, autenticação por token e limites foram preservados. Continua dependendo da mesma rede Wi-Fi e das permissões do Safari/iOS; não oferece AirDrop, USB universal ou controle remoto do iPhone.

## [0.38.0] - 2026-11-14
### Adicionado
- Catálogo local de nomes para serviços e características GATT Bluetooth SIG mais comuns.
- Identificação amigável de bateria, informações do fabricante/modelo, HID e serviços básicos.
- UUID original permanece visível para conferência e compatibilidade com dispositivos não catalogados.

### Limites
- Esta versão apenas identifica metadados já retornados pela inspeção GATT; não lê valores de características nem envia comandos.
- Recursos específicos de fabricante (volume independente, LED, equalizador e efeitos) continuam dependendo de protocolo documentado e testes com o aparelho real.
- Sem teste físico de periférico Bluetooth nesta execução.

## [0.37.0] - 2026-11-14
### Adicionado
- Inspeção dos serviços GATT de dispositivos Bluetooth LE selecionados.
- Listagem de UUIDs de serviços e características.
- Exibição das propriedades de leitura, escrita e notificações/indicações anunciadas.
- Status e erros de acesso/conexão retornados pelo Windows.
- Testes unitários para normalização do inventário GATT.

### Segurança e limites
- Inspeção somente de metadados; nenhuma escrita é enviada ao dispositivo.
- Propriedades GATT não significam que qualquer comando seja universal ou seguro.
- Sem teste físico com periféricos nesta execução.

## [0.36.0] - 2026-11-14
### Adicionado
- Descoberta de dispositivos Bluetooth Low Energy próximos via Windows BluetoothLEAdvertisementWatcher.
- Lista de anúncios BLE com endereço, nome, RSSI e conectabilidade.
- Busca BLE manual na central Conectividade.
- Fluxo de voz Bluetooth baseado na descoberta BLE próxima, com seleção por número.
- Normalização e deduplicação dos resultados BLE, priorizando sinal mais forte.

### Observações
- Inventário Bluetooth reconhecido pelo Windows permanece disponível separadamente.
- Pareamento/conexão continua sendo finalizado nas configurações do Windows.
- Serviços GATT e controles específicos do fabricante ainda não estão disponíveis.
- Não houve teste físico com dispositivos Bluetooth nesta execução.

## 0.35.0 — Fluxo de voz Bluetooth
- Diálogo por voz para escolher Wi-Fi ou Bluetooth.
- Lista numerada de dispositivos Bluetooth reportados pelo Windows.
- Seleção por voz e abertura da central individual do dispositivo escolhido.
- Pareamento e conexão continuam sob confirmação/controle do Windows.

## 0.34.0 — Central dinâmica Bluetooth
- Central individual por dispositivo Bluetooth reconhecido pelo Windows.
- Abertura das configurações nativas do Windows para pareamento/conexão.
- Controle do volume geral de saída do Windows via Core Audio.
- Controles específicos (LED, EQ, bateria e recursos proprietários) ficam condicionados ao suporte do fabricante; não são apresentados como universais.
- Inventário Bluetooth conhecido separado de descoberta BLE de proximidade.

## 0.33.0
- Aba Conectividade restaurada como entrada principal e reorganizada em seções claras: rede, dispositivos móveis, hardware e gerenciador de arquivos.
- Melhorias responsivas e hierarquia visual; controles funcionais existentes preservados.

## 0.32.0 — Simulador e backup de bots
- Simulador local de palavras-chave e respostas sugeridas.
- Exportar/importar bots e regras via JSON com validação e confirmação.

## 0.31.0 — Central de Bots aprimorada
- Bots e regras salvos no perfil local; editar, ativar/pausar, duplicar e excluir.
- Melhorias de validação, feedback de conexão e confirmação de envio WhatsApp.
- Correção de validação de Phone Number ID e telefone.

## 0.30.0 — Central de Bots
- Nova aba Bots com configuração WhatsApp Business Cloud API.
- Teste de credenciais e envio de mensagem de texto de teste via processo principal.
- Construtor local de bots e rascunho de regras de automação.
- Webhook e respostas automáticas ficam para a próxima etapa.

## 0.29.0 — Retomada de transferências iPhone

- Upload em blocos de até 4 MB com offset persistido no computador.
- Retomada ao reabrir o portal e selecionar novamente o mesmo arquivo.
- Finalização separada e publicação do arquivo somente após todos os blocos.
- Teste do portal atualizado para validar a implementação baseada em fetch e sessões retomáveis.

## 0.28.0 — iPhone Transfer Queue
- Fila sequencial de uploads no Safari com progresso individual e agregado.
- Cancelamento do envio ativo e interrupção segura da fila em caso de falha.
- Arquivos acima de 100 MB ignorados no cliente; conflitos não sobrescrevem arquivos existentes.

## 0.27.0 — iPhone & iPad Safari Hub
- Portal móvel redesenhado para Safari em iPhone/iPad, com instruções específicas para selecionar, enviar e salvar arquivos.
- Mensagens de limite de 100 MB e status acessível para leitores de tela.
- Upload com rejeição antecipada por Content-Length, limpeza de arquivos parciais e proteção contra sobrescrita.

## 0.26.0 — Hub Secure Transfer
- Agente Windows agora aceita HTTPS com certificado e chave fornecidos por `YORU_HUB_TLS_CERT` e `YORU_HUB_TLS_KEY` (TLS mínimo 1.2).
- Upload do agente limitado a 100 MB, alinhado ao limite do cliente.
- Agente calcula SHA-256 em uploads e disponibiliza tamanho e SHA-256 em downloads.
- Cliente verifica SHA-256 quando o agente fornece o cabeçalho de integridade.
- HTTP continua disponível para LAN confiável; HTTPS requer certificado confiável no computador cliente.

## [0.25.0] — Hub Consolidation & Transfer Safety
- Unificação das regras de transferência local, Android e agente Windows em limite explícito de 100 MB por arquivo.
- Proteção contra escape de diretório por caminhos relativos e links simbólicos na navegação e nas transferências locais.
- Downloads do agente passam a validar tamanho declarado e efetivo e retornam SHA-256 para auditoria de integridade.
- Testes de regressão para links simbólicos e limites de transferência.
- Mantidas as integrações existentes de rede local, agente Windows, ADB, scrcpy, inventário USB/Bluetooth e ejeção de volumes.

## 0.24.0
- Adicionada solicitação de ejeção segura de volumes pelo Shell do Windows, com confirmação na interface.
- Adicionada navegação para pasta anterior nos painéis local e remoto.
- Mantidas as funções de rede, agente Windows, Android USB e espelhamento existentes.

## 0.23.0 — Mega Hub
- Navegação de diretórios Android no painel com ADB.
- Download de arquivos Android diretamente da listagem.
- Validação de caminhos restrita a `/sdcard/`.
- Consolidação das funções LAN, agente Windows, transferências e espelhamento Android já existentes.

## 0.22.0
- Espelhamento Android autorizado via scrcpy com início e encerramento pelo Yoru Hub.
- Agente Windows com inicialização automática no logon via Agendador de Tarefas e script de remoção.
- Mantida a transferência ADB existente.

## v0.21.0 — Android USB / ADB
- Detecção do ADB e listagem de aparelhos conectados, distinguindo dispositivos autorizados e não autorizados.
- Transferência de arquivos com `adb pull` e `adb push`, limitada ao armazenamento compartilhado `/sdcard/`.
- Validação de serial, caminhos e tamanho máximo de envio local de 100 MB.
- Instruções de instalação do Platform-Tools e autorização RSA no Android.

## 0.20.0 — Agente Windows e gerenciador em duas telas
- Adicionado agente opcional `scripts/yoru-hub-agent.js` para compartilhar uma pasta específica em outro computador Windows via rede local.
- Agente com token Bearer, listagem, upload e download limitados à raiz escolhida.
- Yoru Hub agora permite conectar ao agente, escolher pasta local e navegar nas duas pastas.
- Transferência nos dois sentidos com limite de 100 MB por arquivo no cliente Yoru.
- Operações remotas restritas a endereços privados de rede local.

## 0.19.0 — Yoru Hub (fundação)
- Nova aba Yoru Hub integrada ao painel.
- Inventário de interfaces IPv4, volumes montados, dispositivos Bluetooth e USB presentes no Windows.
- Compartilhamento temporário na rede local com token aleatório, encerramento manual e limite de 100 MB por arquivo.
- Página web responsiva para enviar arquivos ao Yoru e baixar arquivos escolhidos pelo usuário para compartilhamento.
- Arquivos recebidos ficam em `YoruHub/Recebidos` dentro dos dados do usuário.
- O Hub não executa comandos em periféricos nem promete controle universal; MTP/ADB, Bluetooth ativo, agente Windows e app móvel ficam para as próximas etapas.

## 0.18.0 — Relatório técnico e suporte
- Adicionada exportação local de relatório JSON com versão do aplicativo, verificações de saúde e diagnóstico de runtime.
- Relatório limitado a dados técnicos: não inclui conversas, memória, chaves de API ou conteúdo de arquivos pessoais.
- Exportação exige ação explícita do usuário, usa diálogo nativo de salvamento e não envia dados pela rede.
- Adicionado limite IPC para evitar solicitações repetidas de exportação.
- A atualização automática ainda não é ativada: o projeto não contém um endereço de repositório/feed de releases configurado e verificável.

## 0.17.0
- Nova Central de Saúde do Yoru na área Configurações → Desempenho.
- Diagnóstico local de runtime, memória, pasta de dados e dependências principais/opcionais.
- Recomendações objetivas para corrigir itens sinalizados; verificações somente de leitura.

0.16.0 — Estúdio criativo: galeria organizada
- Auditoria confirmou que imagem, texto, vídeo-apresentação, SVG e HTML já existiam, assim como busca, filtro por tipo, grade/lista, prévia, reutilização de prompt, renomear, exportar e excluir. Esses recursos foram preservados.
- Adicionados projetos favoritos com alternância diretamente no cartão e filtro dedicado.
- Adicionada ordenação por mais recentes, mais antigos e nome A–Z.
- Galeria agora informa quantidade exibida, total de projetos, favoritos e espaço aproximado ocupado.
- Preferência de ordenação persiste entre sessões.

## 0.15.0 — Avatar expressivo e animação refinada
- Auditoria dos recursos existentes antes da evolução: VRM já tinha olhar, piscada, expressões e lip-sync por amplitude; Chibi 2D já tinha 50 reações, respiração, balanço e efeitos de emoção. Esses recursos foram preservados, sem criar controles duplicados.
- Refinada a camada de emoção 2D: delta de tempo e nível de áudio limitados, intensidade da aura suavizada e variáveis de energia/movimento efetivamente aplicadas ao efeito visual.
- Transição de filtro do sprite suavizada por CSS; aura reage à emoção e à fala sem adicionar novas imagens ou dependências.
- Rosto VRM mais resiliente a frames longos, dados de áudio ausentes e valores de intensidade fora da faixa; lip-sync suavizado para reduzir movimentos bruscos.
- Mantidos os controles existentes de piscar, força de expressão, olhar, respiração, Chibi, gestos e modo VRM.

## 0.14.0 — Memória contextual
- Categorias automáticas para lembranças: pessoal, preferências, rotina, trabalho, projetos, relacionamentos e outros.
- Busca local na memória e contagem de resultados.
- Edição de lembranças existentes com validação de duplicatas e dados sensíveis.
- Compatibilidade com arquivos antigos: categorias e datas de atualização são inferidas ao carregar.
- Prompt de memória limitado a 3.200 caracteres para reduzir consumo de contexto, priorizando fatos atualizados recentemente.
- Mantidos os limites, filtros de dados sensíveis, remoção individual e limpeza completa.

## 0.13.0 — Central de Voz e Personalidade
- Adicionadas métricas de reconhecimento por sessão: quantidade de frases aceitas, latência média e última latência.
- Adicionados cinco estilos configuráveis de personalidade da Yoru, aplicados às instruções da IA.
- Validação estrita do perfil de personalidade nas configurações.
- Mantidos os fluxos existentes de captura, VAD, Whisper/Faster-Whisper e fallback.

## 0.12.0 — Inteligência adaptativa
- Adicionado roteador FAST/THINK/LOCAL com modo automático baseado no tipo e tamanho da solicitação.
- FAST usa orçamento de até 220 tokens para respostas mais rápidas; THINK mantém o orçamento configurado.
- Modelos FAST e THINK podem ser definidos separadamente no provedor atual.
- LOCAL direciona a conversa ao Ollama já configurado, sem alterar a configuração principal salva.
- Preferências de roteamento são validadas e persistidas na configuração.
- Criados testes unitários para classificação, roteamento, orçamento e preservação da configuração.

## 0.11.0 — Mega atualização: segurança, diagnóstico e recuperação
- Criada camada central de segurança IPC que aceita apenas janelas pertencentes ao aplicativo, frame principal e páginas locais dentro de `src/`.
- Adicionados limites por janela de tempo para chat, TTS, geração de conteúdo, otimização, gestos e operações de backup.
- Adicionado diagnóstico de runtime com versões do Electron, Node e Chromium, uso de memória do processo/sistema e identificação de CPU.
- Criado backup portátil `.yorubackup` para configurações, perfil, memória, histórico de conversas, agenda, projetos criados e biblioteca de avatares/itens.
- Criada restauração com confirmação explícita, validação do formato, allowlist de caminhos, limite de tamanho e gravação atômica por arquivo.
- Adicionada interface de backup e recuperação em Configurações.
- Mantidas as funcionalidades existentes de avatar VRM/Chibi, chat, IA, voz, gestos, criação, biblioteca e otimização.

## 0.10.47 — Robustez e diagnóstico de voz
- Detecção assíncrona do Python/Faster-Whisper, sem bloquear o processo principal.
- Inicialização paralela do backend integrado para reduzir espera quando Faster-Whisper não está instalado.
- Limites de duração do áudio e da fila de transcrição para proteger memória e responsividade.
- Timeout do Faster-Whisper encerra o processo travado e libera chamadas pendentes.
- Painel informa backend e dispositivo ativos, incluindo motivo de fallback.
- Diagnóstico `npm run check` verifica os dois backends e trata Faster-Whisper como opcional.
- Instalador auxiliar para Faster-Whisper no Windows.

## 0.10.46 — Voz robusta e Faster-Whisper opcional

- Adicionado backend opcional Faster-Whisper (CTranslate2) para CPU INT8, com VAD integrado, detecção de fala e transcrição em português.
- O Yoru detecta automaticamente Python + `faster-whisper`; se não estiver instalado ou falhar, retorna ao Whisper integrado baseado em Transformers.js e repete a frase.
- Faster-Whisper roda em CPU; DirectML/GPU continua disponível no backend integrado. Aceleração depende do hardware e do modelo.
- Captura do microfone mais resiliente: cancelamento durante abertura não deixa stream órfão; AudioContext usa taxa compatível quando 16 kHz não está disponível; URL do AudioWorklet é sempre revogada; desconexão é tratada.
- Para ativar Faster-Whisper: instale Python 3 e execute `pip install faster-whisper` no ambiente Python usado pelo Yoru. O modelo selecionado é baixado no primeiro uso e armazenado no cache local.

## 0.10.45 — Painel sem duplicidades
- Centralizados CPU, RAM, disco e processos na aba Ao vivo.
- Removidos os indicadores e a lista de processos repetidos em Otimizar PC.
- Mantido em Otimizar PC o diagnóstico complementar de arquivos temporários e plano de energia do Windows.
- Diferenciados os perfis rápidos do Yoru dos planos e recursos de energia do Windows.
- Preservadas as ações existentes de limpeza, energia e inicialização.

- Busca por nome e caminho do aplicativo.
- Filtros para todos, ativados e desativados.
- Resumo da quantidade de programas em cada estado.
- Lista organizada com os ativados primeiro e caminho do comando visível.
- Mantida a alteração segura da configuração existente em HKCU Run; nenhum serviço ou tarefa do sistema é modificado.

## 0.10.43 — Central de desempenho
- Painel Ao vivo agora separa o consumo do próprio Yoru do uso total de CPU e RAM do computador.
- Adicionados indicadores de CPU total, memória utilizada e espaço livre/ocupado na unidade do usuário.
- Diagnóstico copiado inclui os novos indicadores e detalhes do disco quando disponíveis.
- Leituras são somente informativas; nenhuma tarefa, processo ou arquivo é alterado automaticamente.

## 0.10.42 — Otimizar PC redesenhado
- Reorganizada a aba em visão geral, limpeza segura, energia/jogos e inicialização do Windows.
- Melhorada a hierarquia visual, leitura dos indicadores, cartões de ação e apresentação responsiva.
- Mantidas as ações existentes e suas confirmações de segurança.

## 0.10.41 — Painel reorganizado
- Hierarquia visual renovada, navegação lateral mais clara e cartões com espaçamento consistente.
- Layout adaptável para telas menores, com navegação horizontal no mobile.
- Melhorias de foco por teclado, estados de interação e respeito à preferência por movimento reduzido.

## 0.10.40 — Estabilidade e vida 2D
- Corrigido o gesto `spin`: a escala horizontal não fica mais negativa, evitando espelhamento e hit-test inválido.
- Hitbox do avatar 2D normalizada para escalas positivas.
- Loop 2D protegido contra `dt`, tempo e nível de áudio não finitos ou fora da faixa.
- Fallback visual para a reação `ola` se uma imagem de reação falhar ao carregar.
- Teste de regressão para o giro em múltiplos instantes.
- Mantidos os assets, o avatar VRM, as integrações e as configurações existentes.

> **v0.10.39 — Yoru 2D Vivo:** comportamento idle contínuo com respiração, microinclinações, pequenos desvios de olhar, piscadas sutis por squash, aura dinâmica por emoção e partículas luminosas que acompanham o sprite; efeitos reagem ao estado de fala. Mantém o pack original e o caminho VRM intactos. As artes continuam planas: a piscada é uma microanimação global, não rig independente de olhos/boca.
> **v0.10.38 — Yoru Chibi Emotion Engine:** novo módulo `src/emotion-engine.js` para o avatar 2D. Ele suaviza a troca de estados emocionais, aplica microinclinações e pulsação discretas por emoção, acompanha a intensidade da fala com resposta suavizada. O motor foi integrado ao `avatar2d.js` e reutiliza as reações/imagens já existentes, sem remover nem alterar o caminho do avatar VRM. Não exige dependências novas. As expressões visuais continuam limitadas às artes do pack atual (não há deformação independente de olhos/boca porque os desenhos são imagens planas).

**Histórico de versões do Yoru**

> **v0.10.37 — Criação de SVG e de páginas HTML:** a aba **Criação** ganhou duas ferramentas novas, **🧩 SVG** e **🌐 HTML**: a IA de texto (a mesma da aba Texto, grátis) escreve o código e o painel mostra o resultado na hora. (1) **SVG**: tipo (ilustração, ícone, logotipo, mascote original, cenário, padrão, gráfico, **animação SMIL/CSS**, emblema, fundo), cores (Yoru laranja/escuro, neon, pastel, claro, preto e branco, terrosas, oceano, pôr do sol) e formato (o mesmo das imagens); prévia com fundo xadrez/claro/escuro e botão **Salvar PNG** (2048 px no lado maior, salvo como imagem). (2) **HTML**: página completa com CSS embutido que funciona offline (landing page, cartão de visita, currículo, convite, slide 16:9, post 1:1, infográfico, animação CSS, componente, mini jogo em JavaScript); prévia em largura total, tablet ou celular. (3) **Ver, editar e ajustar**: aba Prévia/Código (a prévia acompanha o que você digita), **“Pedir um ajuste”** (a IA recebe o código atual e devolve o completo; **Desfazer ajuste** volta até 10 passos), Copiar código, **Abrir no navegador** (arquivo temporário, não vira projeto) e Salvar como projeto; **Reutilizar o prompt** traz de volta também o código salvo. Projetos SVG têm miniatura de verdade; os HTML mostram o título ou o início do texto. Filtro novo na lista de projetos. (4) **Segurança**: o SVG é limpo antes de aparecer e de ser salvo (sem `<script>`, `onclick=` e similares, `foreignObject`, links para fora, `@import`, `javascript:`; entidades do HTML e `&` solto são corrigidos, e `xmlns`/`viewBox` que faltam são acrescentados) e a prévia é sempre uma `<img>`, que nunca executa nada. A prévia do HTML é um `<iframe>` com `sandbox` vazio: **não roda JavaScript nem acessa a internet nem o painel**. O arquivo `.html` salvo ganha uma CSP que **bloqueia toda a internet** (a página da IA não consegue enviar nem baixar nada), mas deixa os scripts embutidos funcionarem. A CSP do painel **não mudou**. Código novo em `src/criacao.js` (prompts, extração do código, `sanitizeSvg`, `prepareHtml`); mudanças em `criacao-service.js` (`criaCode`, `criaPreviewFile`), `ipc-criacao.js` (`cria-code`, `cria-open-code`; `cria-read-text` lê também SVG/HTML), `panel-preload.js`, `panel-criacao.js` e `panel.html`; 13 testes novos em `test/criacao.test.js` e `test/criacao-service.test.js`. **Dois limites:** a prévia do HTML não mostra animações/interações em JavaScript (use “Abrir no navegador”) e modelos grátis pequenos às vezes cortam um SVG grande no meio (aparece o aviso “resposta veio cortada”; peça algo mais simples ou troque de modelo). Testado em Chromium de verdade com o painel e o serviço reais e uma IA simulada; **não testado com o Electron nem com uma IA de verdade** (sem rede aqui). Vale conferir no seu PC: gerar um SVG e um HTML, Salvar PNG, Abrir no navegador e Reutilizar o prompt.

> **v0.10.36 — OpenRouter mais confiável e mais rápida:** (1) **erros claros**: a OpenRouter às vezes devolve o erro dentro de uma resposta “200” ou no meio do streaming, e isso virava “resposta vazia do modelo”; agora aparece a causa em português (sem créditos → openrouter.ai/credits, chave inválida, política de privacidade dos modelos `:free`, limite diário, moderação, provedor fora do ar). (2) **novas tentativas automáticas** (até 2; 1 na voz) para 429/408/5xx e falha de rede, respeitando o `Retry-After` (até 8 s); nunca repete chave inválida, falta de crédito ou limite do dia, e no streaming só repete se ainda não chegou texto (nada sai duplicado). (3) **modelos reserva** (Aba IA › Conexão, até 2): a OpenRouter troca de modelo sozinha na mesma pergunta; **ordem do provedor** (menor latência, maior velocidade ou menor preço) e **raciocínio curto e oculto** por padrão: modelos que “pensam” gastavam os ~260 tokens da voz raciocinando e voltavam vazios; agora há aviso claro quando isso acontece. (4) **`<think>…</think>` não aparece mais** no balão nem na voz (OpenRouter e servidores locais), inclusive com a tag partida entre pedaços. (5) **cache de prompt** nos modelos `anthropic/*`: o trecho fixo (personalidade, comandos, memória) fica em cache e a hora da conversa por voz fica de fora. (6) **PDF anexado** agora funciona no OpenRouter (leitor gratuito `pdf-text`). (7) **Buscar** só lista modelos de texto, com `openrouter/auto` e os gratuitos primeiro e o contexto/preço ao lado (“131k · grátis”); **Testar** mostra o saldo/limite da chave. (8) Cabeçalhos `HTTP-Referer` e `X-Title: Yoru` no chat e na geração de imagem (antes: “Avatar Desktop”, e nada na imagem). **Troque `APP_URL` em `src/openrouter.js` pelo endereço do seu projeto, se tiver um.** Código novo em `src/openrouter.js`; mudanças em `ai-core.js`, `ai-stream.js`, `ipc-ia.js`, `attachments.js`, `criacao-service.js`, `panel-ia.js` e `panel.html`; 23 testes novos em `test/openrouter.test.js`. **Não testado contra a OpenRouter de verdade** (sem rede nem Electron aqui): os testes usam respostas simuladas no formato documentado. Vale conferir uma vez no seu PC: Testar com um modelo `:free`, uma conversa por voz, um modelo reserva (derrube o principal com um nome errado) e um PDF.

> **v0.10.35 — o padrão agora é o avatar VRM (3D):** Avatar › Modelo › Estilo do avatar abre em **3D** em vez de 2D (valem `settings.js` e `settings-defaults.js`). Quem já tinha o app muda **uma única vez** para o 3D na primeira abertura (`avatarVer`); se depois escolher 2D, a escolha é mantida. O 2D continua disponível. Como o 3D é o padrão, o leitor de modelos começa a baixar já na abertura (ver v0.10.34). Testes em `test/avatar2d.test.js`.

> **v0.10.34 — abertura mais rápida:** (1) **no 2D (o padrão) o leitor de modelos 3D não é mais carregado**: `GLTFLoader` e `three-vrm` (~1 MB de código) agora entram por `import()` só quando um avatar `.vrm`/`.glb` ou um item `.glb` precisa ser lido (no 3D a baixada começa já na abertura, em paralelo; trocar 2D → 3D no painel carrega na hora); (2) **o WebGL só nasce no primeiro desenho 3D**: no 2D a abertura não cria mais o contexto da placa de vídeo nem gasta a memória dele (se a GPU falhar, continua reiniciando em modo software, uma vez só); (3) **o avatar abre antes do painel**: o painel (página grande, com ~25 scripts) é criado logo depois de o avatar terminar de carregar, com limite de 3 s, e abrir o painel antes (Ctrl+Shift+P ou bandeja) não cria um segundo. Nada muda no que o app faz. Código em `src/renderer.js`, `src/avatar.js`, `src/stage.js` e `src/main.js`; testes em `test/lazy-load.test.js`. **Não medi em segundos** (sem Windows/Electron aqui): os ganhos vêm de menos código e menos trabalho de GPU na abertura; vale conferir no seu PC se o avatar e o painel abrem, e se trocar para o 3D (Avatar › Modelo) ainda carrega o modelo.

> **v0.10.33 — Otimizar PC por voz e cache dos navegadores:** (1) **comandos de voz** (e digitados no chat): “limpa o computador” / “otimiza o pc” (limpeza completa), “limpa os arquivos temporários”, “limpa o dns”, “limpa o cache do chrome”, “esvazia a lixeira” (**pede confirmação**, as outras executam na hora), “modo alto desempenho”, “modo economia de energia”, “modo energia equilibrado” e “quanto espaço livre eu tenho” / “como está o meu pc” (ela fala disco livre, memória, temporários e plano de energia). Entram pelo mesmo caminho do controle do PC: só valem com **Controlar o computador** ligado, “não limpa o computador” não executa e “limpa a agenda” continua sendo da agenda. (2) **Limpar o cache dos navegadores** (Chrome, Edge, Brave e Firefox): só as pastas de cache, nunca senhas, histórico, cookies ou favoritos. (3) **✨ Limpeza completa**: temporários + relatórios de erro + cache dos navegadores num clique (a lixeira fica de fora de propósito). A lista de comandos que a IA recebe no prompt também foi atualizada. Testes novos em `test/pc-optimize.test.js`. **Ainda não testado num Windows de verdade** (os scripts PowerShell só passaram por teste com `exec` falso).

> **v0.10.32 — Otimizar PC:** nova sub-aba **Configurações › Desempenho › 🧹 Otimizar PC** (só Windows, sem pedir administrador). **Diagnóstico**: disco livre, RAM livre, tamanho dos temporários, plano de energia atual e os 6 programas que mais usam memória (só para ver; o Yoru não fecha nada). **Limpeza**: arquivos temporários (só os com mais de 1 dia; em uso são pulados), relatórios de erro do Windows, lixeira (pede confirmação) e cache de DNS; mostra quanto foi liberado. **Energia e jogos**: troca o plano (alto desempenho, equilibrado, economia) e liga o Modo de Jogo do Windows. **Programas que abrem com o Windows**: liga/desliga cada um (só da sua conta, reversível; o programa continua instalado). Ideias tiradas do Optimizer (hellzerg), sem usar o `.exe` dele e sem as opções arriscadas (telemetria, serviços, registro do sistema). Segurança: lista fixa de ações (id desconhecido é recusado), só o painel pode pedir (`isPanelSender`), nome de programa vai por variável de ambiente e só vale se já estiver na lista (nunca entra no código do PowerShell), nada roda até a pessoa abrir a sub-aba. Código em `src/pc-optimize.js` e `src/panel-optimize.js`; testes em `test/pc-optimize.test.js`. **Ainda não testado num Windows de verdade:** os scripts PowerShell foram escritos e conferidos por teste com `exec` falso; vale rodar cada botão uma vez.

> **v0.10.31 — revisão geral do main.js:** (1) **dados no avatar 2D**: "joga o dado" (voz, gesto de mão ou botão do painel) não fazia nada no 2D, porque o dado era um item 3D; agora o resultado é sorteado e falado ("Tirei 3 e 5. Total: 8!"); (2) **segunda instância**: ao abrir o Yoru de novo, a cópia que ia fechar ainda criava janelas e piscava na tela; agora sai sem criar nada; (3) **config.json (chave da IA) gravado de forma atômica**, como o settings.json (uma queda de energia no meio da gravação podia apagar a chave); (4) **settings.json ilegível** ganha uma cópia `.bad` antes de o próximo salvamento sobrescrevê-lo; (5) **Restaurar padrões** não reabre mais a tela de boas-vindas e mantém o estilo 2D/3D escolhido, e agora também desliga a mão livre; (6) promessas rejeitadas sem tratamento só são registradas no console, sem abrir a caixa de erro; (7) todos os envios ao avatar passam pelo `toAvatar()` (mais um tipo de "Object has been destroyed" evitado). Testes: o de estalos de dedo (`vad.test.js`) falhava de vez em quando por usar ruído aleatório e agora é repetível; o de `secrets.test.js` acompanha a gravação atômica; teste novo em `test/package.test.js`.

> **v0.10.30 — revisão do main.js:** sintaxe e uso de janelas conferidos (todo uso de `win` ou está protegido por `alive()`/`toAvatar()` ou roda só na abertura). Achado e corrigido: `applyScale` (mudar o **Tamanho** no painel) em `movement.js` chamava `win.getBounds()` sem checar se a janela do avatar ainda existia, o mesmo tipo de falha do "Object has been destroyed". Também saíram dois nomes que o `main.js` declarava e nunca usava (`THEME_BG`, `PROVIDERS`/`realKey`). O restante está certo: `dialog` está importado para o tratador de erros, não há canal IPC duplicado e a troca 2D/3D chega ao avatar pelo mesmo envio de configurações. Teste novo em `test/package.test.js`.

> **v0.10.29 — revisão do renderer.js:** sintaxe e imports conferidos (nada sobrando). Três ajustes no que a v0.10.28 acrescentou: (1) ao voltar do 2D para o 3D no meio de um passeio, o peso da caminhada ficava preso e o limite de FPS ficava alto; agora ele decai também no 2D; (2) as 50 imagens só são carregadas quando o 2D é usado (no modo 3D não custam memória); (3) o desenho 2D só escreve no DOM o que mudou a cada quadro (menos refazer de layout). Teste novo em `test/avatar2d.test.js`.

> **v0.10.28 — avatar 2D com o pack Yoru Chibi:** novo **Estilo do avatar** em Avatar › Modelo: **2D** (novo padrão) ou **3D** (o modelo VRM/GLB de sempre). No 2D a Yoru aparece como as reações do pack (50 imagens recortadas, sem fundo e sem as legendas, em `assets/reactions/`): cada **emoção** vira uma reação (neutra = Olá!, feliz = Muito bom!, triste = Triste..., brava = Irritada!, surpresa = Uau!) e cada **gesto** também (acenar = Olá!, rir = Haha!, comemorar = Incrível!, dormir na cama/barraca = Dormindo..., dançar = Ouvindo..., pensar = Hmm..., sentar = Pausa, etc.; tabela em `src/avatar2d-logic.js`). Pegar e arrastar mostra Ops!, cair mostra Uau!. Respira, balança ao falar (acompanha a voz), inclina ao passear e pula, gira ou dança conforme o gesto. Os gestos aleatórios, o clique, o carinho, a bolinha de escuta e o balão funcionam como no 3D; o clique atravessa a janela fora do desenho (máscara 32×32 por reação). No 2D o modelo 3D nem é carregado (menos memória e CPU). Código novo: `src/avatar2d.js`, `src/avatar2d-logic.js`, `src/avatar2d-data.js` (gerado do pack); teste novo: `test/avatar2d.test.js`. **Limites:** o pack tem só o busto e uma expressão por reação, então não há boca mexendo nem piscar (a fala é um balanço do desenho); modelo, chibi, itens, cabelo e rotação continuam só no 3D. As imagens têm ~150 px por reação (aumentadas 2×), então ficam um pouco suaves; com a folha em resolução maior o recorte pode ser refeito. Visto só numa página de teste (não dentro do Electron).

> **v0.10.27 — chibi ajustado pelo pack de reações:** com a imagem "Yoru Chibi — Pack de Reações Premium" como referência (cabeça enorme em relação aos ombros), o 🧸 Proporção chibi em 100% agora deixa a cabeça com ~2,8× o tamanho, tronco a 60% e pernas a 45% (antes 2,3×, 65% e 55%). Na conta do teste, a cabeça passa de ~38% para ~46% da altura do avatar; a v0.10.23 dizia "quase metade", mas na prática eram ~38%. A imagem está em `design/` (fora do instalador) com notas em `design/README.md`. Ajuste fino em `CHIBI` (`src/avatar.js`). **Ainda não foi visto num navegador de verdade:** a referência mostra só o busto, então tronco e pernas seguem estimativa; com uma captura do avatar em 100% dá para afinar. Teste novo (cabeça entre 42% e 55% da altura) em `test/renderer-modules.test.js`.

> **v0.10.26 — corrige o erro "Object has been destroyed":** a caixa "A JavaScript error occurred in the main process" aparecia quando um pedido do painel (testar a voz, emote, parar de falar, mudar opção, menu do avatar) chegava depois de a janela do avatar já ter sido fechada ou recriada. O `main.js` agora usa `alive()` e `toAvatar()` em vez de `win.webContents.send` direto, e os mesmos cuidados entraram em `movement.js` (queda, passeio e canto da tela). Como rede de segurança, esse tipo de erro específico é só registrado no console em vez de abrir a caixa; qualquer outro erro continua sendo mostrado. Teste novo em `test/package.test.js`.

> **v0.10.25 — tela de boas-vindas refeita:** os quatro atalhos agora são cartões 2×2 com ícone, título e uma linha explicando cada um (Seu Perfil · Preferências da IA · Modelos e Voz · Avatar), com seta e realce ao passar o mouse. Os ícones passaram de emoji para **SVG**: o 🪪 aparecia como um quadradinho vazio em alguns Windows. A saudação muda conforme a hora (Bom dia, Boa tarde, Boa noite, Boa madrugada), o botão **Começar** ganhou destaque, há um aviso de que tudo pode ser mudado depois no painel e a tecla **Esc** fecha a tela. A direita ficou livre para o avatar, que aparece por cima da janela. Entrada suave, desligada para quem usa "reduzir movimento" no Windows. Continua sem script inline e sem recursos remotos (CSP intacta). Código em `src/welcome.html` e `src/welcome.js`; teste novo em `test/package.test.js`.

> **v0.10.24 — voz de abertura sempre Francisca (feminina):** a voz que fala ao abrir o programa (e em todas as falas) é a **pt-BR-FranciscaNeural**. Antes, o padrão do avatar (`settings-defaults.js`) vinha com a voz vazia; agora vem com a Francisca, igual ao `settings.js`. Configurações antigas (voz vazia, inválida ou salva antes desta versão) voltam **uma única vez** para a Francisca (`voiceVer`); depois vale a escolha da pessoa em Voz. Uma voz vazia ou inválida enviada ao painel também vira Francisca, e o cache das falas passou a usar a voz efetiva. Sem internet, a reserva é a voz **feminina** do Windows (Francisca/Maria...), nunca a primeira voz portuguesa da lista, que podia ser masculina. Testes novos em `test/settings.test.js` e `test/renderer-modules.test.js`. Também: `test/panel-ui.test.js` agora espera 9 abas (o painel foi enxugado nas v0.10.13/14).

> **v0.10.23 — chibi mais fiel à referência:** o 🧸 Proporção chibi em 100% agora deixa a cabeça com ~2,3× o tamanho normal (quase metade da altura do avatar, como na imagem de referência), com tronco a 65% e pernas a 55%. Continua valendo para o avatar em uso (a Yoru), desligado por padrão. As proporções ficam em `CHIBI` (`src/avatar.js`).

> **v0.10.22 — modo chibi:** novo controle **🧸 Proporção chibi** em Avatar › Ajustes (0% normal, 50% meio chibi, 100% chibi). Em qualquer avatar `.vrm` o tronco e as pernas encolhem e a cabeça cresce (a cabeça fica com ~2× o tamanho; as pernas encolhem mais que o tronco), o quadril e o jeito de sentar, deitar e a cadeira acompanham a altura nova, o cabelo e a roupa medem os segmentos de novo e o modelo inteiro cresce até 1,5× para ocupar a janela como os outros (o tamanho final continua no controle Tamanho). Vem **desligado** (0%) e, assim, nada muda para quem não usa; a simulação do avatar com chibi em 0 saiu idêntica à da v0.10.21. Não vale para `.glb` comum (sem esqueleto). Quem já tem um modelo chibi pronto só precisa adicioná-lo em Avatar › Modelo: avatares baixos já são ampliados sozinhos. Código em `src/avatar.js` (`chibiScales`, `chibiHeightRatio`, `applyChibi`), opção `chibi` em `settings.js`; testes em `test/renderer-modules.test.js`. **Ainda não foi visto num navegador de verdade:** as proporções (`CHIBI` em `avatar.js`) podem pedir ajuste fino conforme o modelo.

> **v0.10.21 — renderer.js dividido de vez (712 → 266 linhas):** o que ainda morava no `renderer.js` saiu para módulos próprios, sem mudar nada do que o avatar faz. Novos arquivos: `settings-defaults.js` (configurações padrão), `stage.js` (WebGL, cena, câmera e luzes), `avatar.js` (carregar/descarregar `.vrm` e `.glb`, ossos, ajuste de altura e aplicar a pose do quadro), `emote-player.js` (tocar gestos, peso suave, gesto saindo, sorteio e queda), `body-pose.js` (ser carregada, vida parada, gestos ao falar e braço do item), `face.js` (piscar, expressão e boca), `sleep-props.js` (banquinho, cama, barraca e Z z z), `frame-limit.js` (limite de FPS e medidor), `bubble-style.js`, `chat-box.js` e `debug-hooks.js` (`?debug=1`). O `renderer.js` agora só cria e liga os módulos e roda o loop de quadros. Conferido rodando o renderer antigo e o novo lado a lado num navegador simulado (avatar VRM e `.glb` falsos, todos os gestos, queda, troca de avatar e de configurações): os ~40 mil registros de ossos, expressões, escala e chamadas ao app saíram idênticos. Testes de texto que liam o `renderer.js` agora leem o módulo certo, e `test/renderer-modules.test.js` cobre os módulos novos (e falha se o renderer voltar a passar de 300 linhas).

> **v0.10.20 — bolinha de escuta acompanha a cabeça:** a bolinha agora fica ao lado **direito da cabeça do avatar** (esquerda da tela) e segue a cabeça em qualquer pose, emote ou passeio, deslizando suave mesmo no modo econômico (poucos quadros por segundo). Ela é posicionada no instante em que liga ou muda de estado (antes aparecia por um instante no canto da janela), ancora no meio da cabeça em vez da base do pescoço e, em modelos `.glb` sem esqueleto, fica no canto de cima do modelo. Ajuste fino em `ORB_SIDE`, `ORB_UP` e `ORB_FOLLOW` (`src/renderer.js`).

> **v0.10.19 — aba Gestos reorganizada:** o controle por mão ganhou a sub-aba própria **✋ Mão livre** (Câmera · Mão livre · Gestos e ações · Ajustes). Mouse no ar e mão livre, que eram dois cartões repetindo explicação na sub-aba Câmera, agora ficam juntos: marcadores de estado (câmera, mouse no ar e mão virtual, ligados/desligados na hora), dois botões grandes de modo, uma grade visual “Como controlar” (indicador, pinça, clique direito, punho, paz e amor, palma aberta, carinho e passeio) no lugar da lista, e os ajustes (alcance, mão virtual, tamanho, passeio) lado a lado. A sub-aba Câmera ficou só com a imagem, os passos e o registro. Testes de layout atualizados.

> **v0.10.18 — a mão livre interage com o avatar:** (1) **agarrar:** quando o avatar é pego (mouse ou pinça/punho da câmera), a mão fecha o punho enquanto ela está nas suas mãos e solta ao largar (o arrasto e o arremesso com física já existiam); (2) **carinho:** passar a mão (ou o cursor) em vai e vem sobre a cabeça faz ela gostar (`happy`/`shy`, com pausa de 9 s); (3) **visitas:** com o passeio ligado, de vez em quando a mão voa até a cabeça do avatar, fica ao lado fazendo carinho por ~4 s (vai e vem, acompanhando se ela estiver andando) e ela reage; depois volta a passear. O avatar passa a informar a posição da cabeça só enquanto a mão livre está ligada, e recebe o cursor mesmo com “seguir o cursor” desligado. A janela da mão só envia uma mensagem ao app (“fiz carinho”, sem dados). Testes em `test/hand.test.js`.

> **v0.10.17 — mão livre (aba Gestos › Câmera):** uma **mão virtual flutuante** (luva clara com pulseira na cor de destaque, arte própria) que fica no lugar do cursor, numa janela transparente que **nunca pega o mouse** (os cliques passam direto para os programas). A ponta do indicador fica exatamente em cima do cursor; a mão balança de leve, se inclina para o lado em que vai e, com o cursor parado por ~7 s, **sai passeando pela tela** (opção desligável) e volta assim que você mexe. Sem câmera ela acompanha o seu mouse; o botão **✋ Ativar a mão livre** liga também a câmera e o mouse no ar, e a mão passa a obedecer a sua: **indicador** leva, **pinça** clica (segurar arrasta, com um anel no clique), **punho ✊ agarra e arrasta** (segura o botão esquerdo pelo centro da palma, sem o cursor pular ao fechar a mão) e **✌️ sobe e desce a página** (roda do mouse, cursor parado). Poses: aberta, indicador, pinça, punho e paz. Tamanho de 0,6× a 2×, ação de gesto nova “✋ Ligar/desligar a mão livre” e acompanha o monitor onde está o cursor. Código em `src/hand-logic.js` (mola, passeio e pose, sem Electron), `src/hand-window.js` (janela e leitura do cursor), `src/hand.html`/`hand.js`/`hand-preload.js` (desenho; a janela só recebe, não envia nada ao main) e novo comando `w` (roda, só inteiro limitado) no `air-mouse.js`. Testes em `test/hand.test.js`.

> **v0.10.16 — barra de título nova no painel:** o painel (e as abas destacadas) trocou a barra cinza padrão do Windows por uma barra própria na cor do tema: logo com brilho na cor de destaque, nome, selo com a versão, linha de destaque embaixo e os botões minimizar/maximizar/fechar nas cores do tema (o sistema continua desenhando os botões, então o menu de encaixe do Windows 11 e o arrastar/duplo clique para maximizar funcionam como antes). A cor segue o tema e o zoom da interface na hora (`THEME_BAR` em `settings.js`, `applyBar` em `windows.js`); fora do Windows continua a barra padrão. Testes em `test/titlebar.test.js`.

> **v0.10.15 — correção do erro ao passear:** o app podia abrir a janela “A JavaScript error occurred in the main process — TypeError: Error processing argument at index 0, conversion failure from” (`BrowserWindow.setBounds` ← `setWinPos` ← `stepWalk`). O Electron só aceita inteiros de verdade em `setBounds`, e `Math.round(-0.3)` dá `-0`, o que acontecia quando o avatar andava (ou caía) passando pelo x = 0 da tela. Agora `MOTION.toInt` (em `src/motion.js`) troca `-0` por `0` e descarta `NaN`/`Infinity`; `setWinPos`, `winSize` e `applyScale` passam por ele e uma posição inválida é ignorada em vez de derrubar o app. Testes em `test/movement.test.js` (janela falsa que recusa `-0`/`NaN` como o Electron).

> **v0.10.14 — aba Gestos melhorada e Desempenho dentro de Configurações:** **Gestos** deixou de ser uma página longa e ganhou três sub-abas: **Câmera** (imagem, status, mouse no ar e registro), **Gestos e ações** (predefinições e a tabela) e **Ajustes**. Na Câmera, a imagem fica ao lado de um guia em 3 passos, o gesto que você faz mostra **o que ele vai executar** (“👍 Joinha → 🔊 Aumentar o volume”) e o registro tem botão **Limpar**. Na tabela, cada gesto tem um botão **▶** que testa a ação na hora, sem precisar fazer o gesto (fica desligado se o gesto não tem ação). Dois ajustes novos: **Sensibilidade da detecção** (Rigorosa, Normal ou Sensível; reinicia a câmera sozinha ao mudar, e Normal mantém os valores de antes) e **Desligar a câmera sozinha após N min sem mão** (0 = nunca, o padrão; poupa processador e apaga a luz da câmera). A aba **Desempenho** saiu da barra lateral e virou uma sub-aba de **Configurações** (nome novo da aba Geral), com as pílulas Ao vivo · Qualidade · Economia; a janela destacável de Desempenho deixou de existir. **Correção:** as pílulas de segundo nível (Avatar › Comportamento, adicionadas na v0.10.13) ficavam invisíveis, porque a regra de CSS que esconde os cartões de outras seções também escondia os botões; agora aparecem. Lógica nova em `gesture-logic.js` (`detectConfig`, `idleExpired`) e testes em `test/gesture.test.js`, `test/panel-layout.test.js` e `test/panel-ui.test.js`.

> **v0.10.13 — Comportamento dentro de Avatar:** a aba **Comportamento** saiu da barra lateral e virou uma sub-aba de **Avatar** (Modelo · Ajustes · **Comportamento**). Dentro dela, as quatro seções antigas viraram pílulas: **Movimento**, **Emotes**, **Corpo e descanso** e **Fala**. Todos os controles e configurações continuam os mesmos (só mudaram de lugar). O atalho da aba Conversa agora abre direto Avatar › Comportamento › Fala, e a janela destacável da aba Comportamento deixou de existir (a de Avatar já traz tudo). Novo nível de navegação `nav.subtabs2` / `data-sub2` no painel; testes em `test/panel-ui.test.js` e `test/idle-life.test.js`.

> **v0.10.12 — olhar, braços moles e dedos:** a camada de vida parada (`src/idle-life.js`) ganhou três coisas. **Olhar de um lado para o outro:** a cabeça vira até cerca de 25° para um lado, segura 1,5 a 4,3 s, vai para o outro (quase sempre o oposto), inclinando um pouco junto; o pescoço e o tronco acompanham e a mola da virada é um pouco folgada, sem parar seco. **Braços moles:** cada braço virou um pêndulo frouxo, empurrado pela troca de peso e pela virada da cabeça, que balança e demora a parar, cede o cotovelo, solta um balanço sozinho de vez em quando e leva a mão atrás com mais atraso. **Dedos:** os 30 ossos dos dedos (`FINGER_BONES`) ficam meio fechados, cada dedo no seu ritmo (indicador mais aberto, mindinho mais fechado), com o polegar recolhido e os dedos cedendo quando a mão balança; modelos sem esses ossos continuam funcionando, só não mexem os dedos. Os dedos continuam soltos durante gestos e com o item na mão. `createIdleLife` aceita um sorteio com semente (`seededRng`) para testes repetíveis. Testes novos em `test/idle-life.test.js`.

> **v0.10.11 — Yoru menos robótica parada:** nova camada de "vida parada" em `src/idle-life.js`. **Respiração de verdade:** o peito abre e fecha (antes eram ±0,01 rad, quase invisível), os ombros sobem na inspiração, o ritmo muda sozinho (cerca de 3,5 a 4,5 s por respiração, inspira mais rápido do que solta) e às vezes ela respira mais fundo. **Braços soltos:** afastados do corpo, cotovelo meio dobrado, mãos relaxadas e balançando com um pequeno atraso em relação ao tronco, cada lado com seu ritmo (não é espelho). **Balanço de peso:** o quadril e a coluna trocam de lado devagar, e a cabeça passeia de leve em vez de ficar travada. Os pesos da camada (`idleWeights`) caem sozinhos quando um gesto, a caminhada, ser carregada, dormir ou o item na mão já controlam o corpo (só o braço que segura o item sai), então ela não briga com nada. Liga e desliga na opção de respirar (`breathing`). Ela também passou a piscar duas vezes seguidas de vez em quando. Os ossos das mãos entraram na pose (`leftHand`, `rightHand`). Testes em `test/idle-life.test.js`.

> **v0.10.10 — aba Itens reorganizada, com miniaturas 3D como nos avatares:** cada item (os 7 embutidos e os seus `.glb`) vira um cartão com **miniatura desenhada em 3D** pelo próprio app (`src/item-thumb.js`: segundo renderer pequeno na janela do avatar, de 3/4, fundo transparente, enquadrado pelos 8 cantos da caixa), em grade com os mesmos cartões da aba Avatar. Clique escolhe e mostra o **painel de detalhes** à direita (prévia grande, nome, "Embutido" ou formato e tamanho, descrição, **Segurar este item** / **Na mão · Soltar**, remover); dois cliques colocam na mão; o item em uso ganha o selo "Na mão". Sub-abas **Itens** e **Ajustes e dados** (mão, tamanho, dados), contadores por seção e estado vazio. Enquanto a miniatura não chega fica o ícone piscando e o painel tenta de novo; falha nunca é guardada. Miniaturas pedidas por IPC (`lib-thumb` com `items`), com cache por arquivo (nome, data e tamanho); o main só aceita de volta PNG vindo da janela do avatar. Testes em `test/item-thumbs.test.js`.

> **v0.10.9 — mouse no ar:** na aba Gestos, o **indicador move o cursor**, a **pinça** (polegar + indicador) **clica** (segurar = arrastar) e polegar + médio dá **clique direito**; palma aberta por 1,2 s ou mão fora da imagem por 3 s desligam, sempre soltando o botão. O cursor fica parado enquanto a pinça fecha (o clique cai onde você apontou); punho fechado ou polegar apoiado em dedo dobrado não clicam. Alcance de 1 a 5, cursor desenhado na prévia e ação "Ligar/desligar o mouse no ar" na tabela de gestos. `src/air-mouse.js` mantém um PowerShell aberto que só aceita `m x y`, `d`, `u` e `r` (números limitados a 0..1), e solta o botão e encerra se o painel sumir por 10 s. **Correção importante do MediaPipe:** o navegador não lê `file://` por `fetch`, então o modelo e os `.wasm` agora vêm do processo principal por IPC (`gesture-file`, só nomes simples `.task`/`.wasm` dentro de `vendor/mediapipe`) e entram como bytes/`blob:`. Simulado de ponta a ponta no Chromium com câmera e MediaPipe falsos (armar, gesto, mouse, clique, sair).

> **v0.10.8 — aba Gestos melhorada:** reconhecimento **mais estável** (o gesto só vale se aparecer em 3 dos últimos 5 quadros: `createSmoother`). **Segurar o joinha ou o polegar para baixo repete o volume** (a cada 0,7 s). Ações novas **Próximo slide / Slide anterior** (setas, `pc.arrow`) e **predefinições** da tabela: Padrão, 🎵 Mídia e 📽️ Apresentação. O gesto reconhecido **acende na lista**, o painel mostra os **quadros por segundo** e a Yoru **acena com a cabeça ao armar** (opção `gestureReact`). Testes novos em `test/gesture.test.js`.

> **v0.10.7 — gestos de mão pela webcam (aba Gestos 🖐️):** a Yoru reconhece gestos da sua mão pela câmera e executa comandos, estilo Jarvis. Reconhecimento local com o MediaPipe Hand Landmarker (`@mediapipe/tasks-vision`; o runtime e o modelo vão para `src/vendor/mediapipe/` pelo `scripts/vendor.js`, que agora baixa o modelo uma vez). Gestos: palma aberta, punho, indicador, ✌️, três dedos, joinha, polegar para baixo, OK, rock, hang loose e deslizar a palma. A palma aberta parada por 1 s **arma** o sistema por 8 s (desligável); cada gesto precisa ser segurado ~0,6 s e há pausa entre dois gestos. Tabela **Gesto → ação** editável (mídia, volume, print, área de trabalho, Alt+Tab, minimizar, chat, calar, falar agora, ligar/desligar a escuta, dados, gestos da Yoru), modo teste, registro, bipe, escolha da câmera e opção de ligar ao abrir o app (desligada por padrão). Só ações de uma lista fixa; sem desligar/reiniciar/bloquear. A CSP do painel ganhou `'wasm-unsafe-eval'` (só WebAssembly, para o MediaPipe). Código em `src/gesture-logic.js`, `src/gesture-actions.js` e `src/panel-gestos.js`; testes em `test/gesture.test.js`.

> **v0.10.6 — resposta mais rápida e voz:** o prompt fixo da Anthropic agora vai em cache (`cache_control`), com a data/hora da conversa por voz fora dele (`buildRequest` ganhou o parâmetro `tail`). O chat digitado resolve na hora o que ela faz sozinha (hora, abrir site, timer, volume...) via `voice.tryLocal`, sem ir até a IA. A voz neural é aquecida na abertura também com a voz ligada. No Windows, abrir site usa `rundll32 url.dll,FileProtocolHandler` num processo solto (não prende o app). Pular/voltar/pausar a mídia só vale chamando-a pelo nome ou digitando (o áudio de um vídeo tocando virava "próxima música"). Cauda de eco do microfone de 1,2 s para 0,8 s. Nova opção **interromper falando alto** (`convBargeIn`, desligada por padrão). **Bolinha de escuta** no canto do avatar (opção `convOrb`, ligada por padrão): apagada = não está ouvindo, laranja pulsando = ouvindo, maior e brilhante = captando sua voz, azul = pensando, cinza = falando (microfone mudo). Barra de rolagem do painel na paleta laranja sobre escuro. Testes novos em `ai-core`, `voice-main` e ajuste em `criacao`.

> **v0.10.5 — balão de fala em arquivo próprio:** `say`, `typeSay` e os timers do balão saíram do `renderer.js` para `src/bubble.js` (`createBubble`, com `hideDelay` puro). A resposta em tempo real agora usa `bub.open()` e `bub.finish()` em vez de mexer nos timers diretamente. O renderer ficou com 1.495 linhas (eram 1.744). Testes novos em `test/bubble.test.js` (relógio e elemento falsos). O que sobra no renderer depende de muito estado compartilhado (voz, loop de animação, poses e emotes).

> **v0.10.4 — itens em arquivo próprio:** os itens embutidos da mão (celular, dados, caneca, livro, flor, balão e pirulito) saíram do `renderer.js` para `src/items.js` (`createItemMakers`, com o THREE e a criação de canvas por parâmetro). O renderer ficou com 1.538 linhas (eram 1.744) e continua escolhendo o item, colocando na mão e animando. O teste de consistência agora lê a lista de itens do `items.js`. Testes novos em `test/items.test.js`. Próximo candidato: o balão de fala.

> **v0.10.3 — renderer em partes:** o cenário 3D (banquinho, cama, barraca e os “Z z z” do sono) saiu do `renderer.js` para `src/props.js` (de 1.744 para 1.679 linhas no renderer). São funções que só constroem os objetos e recebem o THREE por parâmetro; o renderer continua colocando na cena e animando. Testes novos em `test/props.test.js`. Os próximos blocos candidatos são os itens da mão (celular, dados, caneca, livro) e o balão de fala.

> **v0.10.2 — segurança:** CSP em todas as janelas (scripts inline movidos para `panel-boot.js`, `welcome.js` e `crack.js`; hashes do `index.html` calculados por `scripts/csp-hashes.js`, `npm run csp`), **chaves de API cifradas** no `config.json` com `safeStorage` (`src/secrets.js`; chaves antigas em texto puro são cifradas sozinhas), testes novos (`csp`, `secrets`, `security`), correção do teste `panel-ui` (esperava o fim das chamadas assíncronas antes de fechar o DOM) e o histórico de versões saiu do README para este arquivo.


> **Aba Criação (✨) com modelos gratuitos:** gere **imagens**, **textos** e **vídeos** só com modelos grátis (sem cartão). **Imagem:** FLUX.1 schnell (melhor qualidade), SDXL Lightning, **SDXL Base 1.0** e DreamShaper 8 pela **Cloudflare Workers AI** (conta grátis; cota de 10 mil “neurons” por dia; precisa do ID da conta e de um token com a permissão *Workers AI*), com **23 estilos**, **9 formatos** (inclui 3:2, 4:5 e 21:9) e **prompt negativo** (SDXL e DreamShaper). **Texto** (e o roteiro do vídeo): 4 serviços grátis, e basta **uma** chave: **Google Gemini** (2.5 Flash e Flash-Lite, chave em aistudio.google.com/apikey), **Groq** (Llama 3.3 70B, GPT-OSS 120B, Qwen 3 32B, Llama 3.1 8B; chave em console.groq.com/keys), **Cloudflare** (Llama 3.3 70B, GPT-OSS 120B, Mistral Small 3.1, Gemma 3; usa a mesma conta da imagem e divide a cota diária com ela) e **OpenRouter** (modelos `:free`: Gemma 4, Qwen 3.8, Nemotron; 20 pedidos/min e 50/dia). O modo *Automático* usa só os serviços que têm chave, na ordem de preferência, e passa para o próximo quando um falha ou atinge o limite; uma chave recusada (401) pula só aquele serviço. Há **24 tipos de texto** (post, legenda, títulos e slogans, nomes, descrição de produto, anúncio, discurso, resposta de mensagem, traduzir, corrigir…), **12 tons**, **5 tamanhos** (de 30 a 1200 palavras) e **9 idiomas de saída**. **Vídeo:** não existe hoje uma API de vídeo por IA realmente grátis e estável, então o vídeo é uma apresentação animada: um modelo de texto escreve as cenas (de 3 a 10), um modelo de imagem gera cada uma e o painel grava tudo com legendas, em WebM, sem som; dá para escolher o **movimento da câmera** (misto, aproximar, afastar, deslizar) e a **transição** entre cenas. O botão **🎲 Ideia** sorteia um pedido em cada ferramenta. Os modelos cuja chave ainda não foi colocada aparecem com 🔒 na lista. O **Pollinations** deixou de ser grátis sem chave em jul/2026 e ficou como opção (precisa de Pollen); o OpenRouter para imagem continua disponível, mas é pago. As chaves ficam em **🔑 Chaves gratuitas**, no topo da aba (com botão para removê-las), e só no seu computador. Escolha estilo e formato, use **Avançado** (quantidade, semente, prompt negativo, melhorar o prompt com a IA) e clique em **Salvar como projeto**. Os **Projetos Salvos** ficam na pasta `criacao` dos dados do app, com busca, filtro, grade/lista, visualização, reutilizar o prompt, renomear, mostrar na pasta, salvar uma cópia e excluir. A aba também abre em janela separada (botão ⧉). Código em `src/criacao.js` e `src/panel-criacao.js`, testes em `test/criacao.test.js`. Os planos grátis mudam sem aviso: as listas estão em `IMAGE_MODELS`, `TEXT_MODELS` e `AUTO_TEXT_ORDER` (`src/criacao.js`); se um modelo sair do ar, o Automático já passa para o seguinte.

> **Aba Voz melhorada:** lista de vozes neurais em **vários idiomas** (com filtro), **estilos prontos** (natural, animada, calma, fofa, séria, rápida), **pausa entre frases**, **saída de áudio** à escolha (alto-falante, fone), **dicionário de pronúncia** (`Yoru = Ioru`), opções do que ela lê (**pular código e links**, **pular ações entre asteriscos**, **falar só o começo de respostas longas**), frases de teste e uma linha de diagnóstico da última voz (tempo, tamanho, se veio da memória ou se a internet falhou) com botão para limpar a memória de falas. Código em `src/speech.js`, testes em `test/speech.test.js`.

> **Aba Desempenho com mais opções:** gráficos ao vivo de FPS, CPU e RAM (últimos 2 min), tabela de **quem gasta por processo**, dados do seu computador (placa de vídeo, núcleos, RAM) e botão **Copiar diagnóstico**. Novas opções: **economizar na bateria** (limite de FPS), modo **longe do PC** (o avatar desenha bem menos depois de X min parado), **prioridade do app** no sistema (normal, abaixo do normal, baixa), **núcleos do reconhecimento de voz**, **liberar a voz da memória** após X min sem uso, perfil **🎮 Modo jogo**, destaque do perfil ativo e **Restaurar padrão de desempenho**. Código em `src/perf.js`, testes em `test/perf.test.js`.

> **A IA mexe no próprio app:** por voz, no chat ou pelo painel, a Yoru muda o **tema** (“muda o tema para escuro”, “modo oceano”), a **cor de destaque** (“cor de destaque roxo”), o **avatar** (“troca para a Noelle”, “volta ao avatar padrão”) e o **item na mão** (“pega a katana”, “segura o celular”, “pega a bola de basquete na mão esquerda”, “larga o item”, “troca de mão”, “quais itens você tem”). Funciona com qualquer modelo da biblioteca (Painel › Itens e Avatar), inclusive os que você adicionar. Os pedidos por voz são resolvidos na hora, sem gastar a IA; no chat, a IA recebe a lista de temas, itens e avatares e escreve uma tag (`[app:item=Katana]`) que o app executa e esconde. Liga/desliga em **IA › A IA pode mudar tema, avatar e item**. Ela só mexe nessas opções visuais, nunca em arquivos, chave da IA ou voz. Código em `src/app-actions.js`, testes em `test/app-actions.test.js`.

> **Falas espontâneas ampliadas (aba Comportamento):** novas frases (“Cadê você?”, “Oi, eu tô aqui!”), o tipo **Reclamar** (“Me chamou pra nada, né?”), o campo **Minhas frases** (uma por linha, entram no sorteio) e o tipo **Socar a tela**: ela fala, dá um soco no “vidro”, a tela racha (com barulho de vidro, opcional) e some sozinha em ~5 s, voltando ao normal. O efeito não pega o mouse. Teste com **Testar soco na tela**.

> **Mais opções na aba Comportamento:** *Quando eu estiver parado* (ela fica sonolenta após X min e te dá oi quando você volta), **horário de silêncio** das falas, **avisar a hora cheia**, **chance de socar** quando o soco é sorteado e por quanto tempo a tela fica rachada.

> **Dormir na cama ou na barraca:** dois gestos novos (🛏️ e ⛺, na lista de emotes; “Levantar” acorda). Ela deita de perfil, de olhos fechados, com “Z z z” subindo. Em *Quando eu estiver parado* dá para escolher “Como ela dorme” (de pé, na cama ou na barraca): ela deita quando você some e levanta, te dando oi, quando você volta. Não entram no sorteio automático de emotes.

## Versão anterior: v0.10.0

> **Correção:** o avatar não aparecia no `.exe` instalado (só no `npm start`). O electron-builder descarta qualquer pasta `examples` dentro de `node_modules`, e o `GLTFLoader` do three.js mora nela. Agora `scripts/vendor.js` copia o three.js/three-vrm para `src/vendor/` (roda sozinho no `npm install` e antes de `npm run dist`). Se `src/vendor` faltar, o `index.html` usa `node_modules` como caminho de backup automaticamente.
>
> **IA conhece os comandos:** a IA de qualquer provedor (OpenRouter, Anthropic, Ollama, servidor local) agora recebe no prompt a lista dos comandos que a Yoru já executa sozinha (`src/commands-catalog.js`). Ela responde direito a "o que você sabe fazer?", não diz que não consegue abrir o YouTube e, se a frase não foi entendida, ensina a frase exata. Um teste confere que cada exemplo da lista é de fato reconhecido pelo app. Também passou a valer "apaga ... da agenda".
>
> **Falas espontâneas (aba Comportamento):** ela puxa assunto sozinha — “Oi, você tá aí?”, diz as horas e comenta o período do dia, manda dormir à noite, “Fala comigo!” e lembra de beber água. Você liga cada tipo, escolhe o intervalo (mínimo e máximo, em minutos), pode exigir que o PC esteja parado há alguns minutos e testa com **Falar agora**. Só fala com o avatar visível.
>
> **Aba IA renovada:** cabeçalho com o provedor, o modelo e se a chave está salva; botão **Comandos da Yoru** (liga/desliga e mostra o que a IA recebe, com o custo aproximado em tokens); contador na personalidade; aviso de "alterações não salvas"; e barra de salvar sempre visível.
>
> **Novidades desta atualização:** saudação ao abrir o app (por horário, com nome, "chefe/chefa" e saudades), balão de fala desligado por padrão, tela de primeiro lançamento e instalador com visual do Yoru (licença em português, imagens laterais e "Executar o Yoru agora" no final).

## v0.10.0 — pronto para virar programa de computador
- **Instalador e versão portátil para Windows** (electron-builder), com ícone, atalhos e instalador em português.
- **Dados na pasta do usuário** quando instalado (antes ficavam ao lado do app, onde o Windows não permite gravar).
- Marca **Yoru** no painel e identificação própria na barra de tarefas.
- Inclui o novo visual do Chat e a aba Perfil (v0.9.11).

## v0.9.11 — aba Perfil
- Nova aba **Perfil** (menu lateral, logo após Avatar): foto (recortada e reduzida automaticamente), nome, apelido, data de nascimento (a idade é calculada), gênero, altura, peso e "Sobre você".
- **Informações opcionais** (localização, profissão, empresa, objetivos, preferências, condições de saúde), **interesses** e **metas** (acompanhar peso, treinos e alimentação; meta de peso).
- **Salvar Alterações / Cancelar**: nada muda até salvar. Fica em `profile.json` na pasta de dados do app.
- **Usar meu perfil nas conversas**: a IA recebe essas informações no prompt (desligue se não quiser). Com provedor online (Anthropic, OpenRouter) elas vão junto das mensagens; com Ollama ficam no seu PC. Senhas e números de documento ou cartão são descartados.
- O Chat passa a dizer "Oi, <apelido ou nome>" e usa a sua foto nas suas mensagens.
- As opções de acompanhamento só informam a IA; ainda não há painel de gráficos.

## v0.9.11 — novo visual da aba Chat
- Cabeçalho com saudação, modelo em uso (clique para ir à aba IA) e relógio/data.
- Balões com ícone, hora e duplo check; avatar da Yoru nas respostas; indicador de "digitando".
- Ações sob a resposta: copiar, gostei, não gostei (só visual) e gerar de novo.
- Atalhos rápidos (viagem, finanças, treinos, cardápio) e barra de digitação com +, microfone (abre a aba Conversa), imagem, anexo e envio.
- O menu **+** reúne Memória e Limpar conversa.
- Cada mensagem guarda a hora, inclusive na conversa restaurada ao reabrir o app.

## v0.9.9 — correções
- **A janela não aumenta mais ao clicar/arrastar.** No Windows com escala de tela de 125%/150%, mover a janela com `setPosition` repetido a fazia crescer; agora todo movimento (arrastar, queda, passeio, cantos) reafirma o tamanho certo.
- **A barra de tarefas é o chão.** Ela já nasce com os pés na barra de tarefas (antes ficava um pouco acima) e o passeio acontece sempre nela. Se ela estiver no alto da tela, cai primeiro e só depois passeia.

## v0.9.8 — mais poses: danças e sentada
10 gestos novos (Painel › Comportamento, entram no sorteio e a IA também pode usar): **disco, robô, samba, balé** (com pirueta), **hip hop**, **palmas**, **mãos na cintura**, **continência**, **sentar no chão** e **sentar na cadeira** (ela traz um banquinho que some quando ela levanta).
- As poses de sentar duram ~30 s. O botão **🧍 Levantar / parar dança** (e o menu do botão direito) interrompe qualquer gesto.
- Por voz: "dança", "dança samba / disco / robô / balé / hip hop", "senta", "senta no chão", "levanta", "bate palmas", "faz uma continência", "mãos na cintura".
- Enquanto faz um gesto ela não passeia; ao terminar, volta a passear normalmente.
- Quem já tinha configurações salvas recebe os gestos novos no sorteio uma vez (pode desmarcar o que não quiser).

## v0.9.7 — ela passeia pela tela
De vez em quando ela sai andando pela tela (na altura em que estiver, geralmente na barra de tarefas), com passinhos, braços balançando e o corpo virado para o lado em que anda.
- **Painel › Avatar › Passear pela tela**: liga/desliga, velocidade (px/s) e intervalo médio entre passeios. O botão **🚶 Passear agora** (e o item no menu do botão direito/bandeja) faz ela andar na hora.
- Ela só anda quando está parada. Falar, balão de fala, chat aberto, gesto, ser pega, cair ou o mouse em cima dela interrompem o passeio.
- Fica dentro da área útil da tela em que estiver (não passa da borda) e não anda com o avatar oculto.
- Funciona com avatares .vrm (pernas e braços) e, de forma simples (balanço do corpo), com modelos .glb.

## v0.9.6 — ela controla o computador (Windows)
Por voz, com o nome dela antes (“Yoru, …”). Liga/desliga em **Conversa › Pode abrir sites e programas e controlar o computador**.
- **Volume**: “aumenta o volume”, “abaixa um pouco”, “volume em 30”, “volume no máximo”, “tira o som” (alterna o mudo).
- **Música e vídeo** (teclas de mídia, valem para Spotify, YouTube no navegador e outros players): “pausa”, “continua a música”, “próxima música”, “música anterior”.
- **Janelas**: “minimiza / maximiza / restaura a janela” (a que você está usando) ou “minimiza o chrome”; “muda para o Discord”, “vai para a janela do Spotify” (se não estiver aberto, ela abre); “troca de janela”; “mostra a área de trabalho”; “o que está aberto?”.
- **Abrir qualquer programa instalado**: “abra o Photoshop”, “abra o Steam”… ela procura no menu Iniciar.
- **Print da tela**: “tira um print da tela” salva em Imagens e copia para colar.
- **Bloquear** o computador: “bloqueia o computador”.
- **Com confirmação (“sim/não”)**: “fecha o Word”, “fecha essa janela”, “fecha o YouTube” (fecha a aba), “desliga / reinicia o computador” (30 s de aviso; “cancela o desligamento” desfaz) e “coloca o computador para dormir”.
- Ela nunca mexe no programa que está **em primeiro plano dentro do próprio avatar/painel**: ao pedir “minimiza a janela” enquanto fala pelo painel, vale a janela de trás.
- Os textos falados vão para o PowerShell por variável de ambiente, nunca dentro do comando (sem injeção de comandos).
- Limites: só Windows por enquanto; ela não clica nem digita em outros programas.

## v0.9.5 — reconhecimento de voz mais preciso
- **Nome mais bem entendido**: além de “Ioru”, “Joru”, “Yoro”, agora vale quando a transcrição **divide** o nome (“Yo ru”), **cola** o “oi/ei” (“oiyoru”), **engole a primeira letra** (“Oru”) ou troca o final (“Jorou”). Continua sem confundir com “Jorge” ou “Yolanda”.
- **Início da frase preservado**: o detector guarda 300 ms antes da fala (eram 200) e o Whisper recebe 0,25 s de silêncio antes e depois — o nome no começo da frase deixa de ser cortado.
- **Volume**: a normalização agora mira o volume médio, não o pico; um estalo isolado não impede de amplificar uma voz baixa.
- **Ruído constante** (ventilador, ar-condicionado): o piso de ruído sobe aos poucos em vez de deixar o microfone “preso” em modo fala.
- **Menos alucinações** do Whisper em silêncio (“deixe seu like”, “thanks for watching”, “legendas por…”, etc.).
- **Seletor de modelo em destaque** (aba Conversa › *Modelo de reconhecimento de voz*): cartões com tamanho, precisão e rapidez de cada modelo; clique para trocar.
- **Todos os modelos do Whisper** na aba Conversa: tiny, base, small, **medium, large-v3-turbo e large-v3** (download único; quanto maior, mais preciso e mais lento/pesado). Para o maior ganho sem pesar muito, use **small** ou **large-v3-turbo**.
- Testes novos para o nome, o detector de voz e o filtro de ruído (`npm test`: 62 testes).

## v0.9.4 — mais comandos sem IA
Tudo abaixo funciona **sem chave de IA e sem internet** (exceto abrir o vídeo no YouTube).
- **Saudações pela hora**: “bom dia”, “boa tarde”, “boa noite”, “oi”. Ela responde conforme o horário real; se você disser a saudação errada, **ela corrige com sarcasmo** (ex.: “Bom dia?! Acordou agora? São 15 horas e 7 minutos, o certo é boa tarde.”). “Bom dia, tudo bem?” também é entendido, e “bom dia, abre o youtube” cumprimenta e já abre.
- **Outras formas de pedir**: além de “abra / abrir”, agora vale “me mostre o YouTube”, “quero ver o Gmail”, “vai no WhatsApp”, “coloca o Spotify”, “preciso do Drive”, ou só dizer o nome do site. Esses verbos só funcionam quando ela conhece o site (frases como “mostre como fazer bolo” continuam indo para a IA).
- **Música e vídeo**: “quero escutar uma música” → ela pergunta **qual?** → você responde (“Legião Urbana”, “toca Evidências”, “qualquer uma”) → ela **já abre o vídeo no YouTube**. Também dá para pedir direto: “toca Evidências”, “quero ouvir Djavan”, “quero ver um vídeo de gatos”. Com “no Spotify” ela abre a busca do Spotify. Se não conseguir achar o vídeo, abre a página de resultados.
- **Mais sites e programas**: Google Docs, Planilhas, Fotos, Tradutor, Prime Video, Disney Plus, Facebook, X, LinkedIn, Reddit, TikTok, Pinterest, Discord, Telegram, Outlook, Canva, ChatGPT, Claude, Wikipédia, Mercado Livre, Amazon, Paint, explorador de arquivos e gerenciador de tarefas.
- **Contas**: “quanto é 15 vezes 4”, “vinte e cinco mais trinta”, “20 por cento de 150”, “raiz quadrada de 81”, “7 ao quadrado”. Dividir por zero ganha um comentário.
- **Timer**: “coloque um timer de 5 minutos”, “timer de meia hora”, “2 minutos e 30 segundos”. Sem dizer o tempo, ela pergunta. Ela avisa falando quando acaba (mesmo com os lembretes da agenda desligados).
- **Conversa leve**: piadas, cara ou coroa, sortear número (“de 1 a 10”), “tudo bem?”, “obrigado”, “quem é você?”, “o que você sabe fazer?”.
- **Correção**: “abra o Google Agenda” e “abra o Google Drive” abriam o Google comum; agora abrem o certo. “O Google caiu?” não vira mais uma pesquisa.
- Novos testes: `npm test` agora cobre as saudações, a classificação dos pedidos, as contas, o timer e o fluxo completo “qual música?” (55 testes).
- Limite conhecido: o YouTube pode bloquear a reprodução automática com som no navegador; nesse caso é só clicar em play.

## v0.9.3 — temas
- **9 temas do painel** (Aparência › Tema), escolhidos em cartões com pré-visualização: Automático, Escuro, Claro, **Meia-noite, Oceano, Floresta, Sakura, Sépia e Alto contraste**.
- **Sem piscar ao abrir**: o tema e a cor de destaque chegam junto com a janela, e o fundo da janela acompanha o tema (antes abria sempre escuro e depois trocava).
- **Texto legível em qualquer cor**: a cor do texto sobre o destaque (botões, aba ativa, mensagens) agora é escolhida pelo brilho da cor, então amarelo ou menta não ficam com letra branca ilegível.
- Campos, barras de rolagem e menus nativos seguem o tema (claro/escuro).
- 4 cores de destaque novas: ciano, menta, amarelo e magenta.
- **Estilo do balão** (Comportamento › Balão de fala): claro, escuro ou na cor de destaque; a caixa de chat acompanha. Mensagens de erro ficam legíveis nos três.

## v0.9.2 — emotes, avatares e itens
**Emotes**
- 7 gestos novos: **comemorar, rir, abatida, brava, sonolenta, pensar e pular** (17 no total). Quem já tinha configurações salvas os recebe no sorteio automaticamente, e a IA também passa a usá-los.
- Troca suave: ao mudar de gesto (ou ao pegarem o avatar com o mouse) o gesto anterior some em 0,3 s em vez de "estalar" para a próxima pose. O giro termina a volta antes de trocar.
- Sem gestos enquanto ela é carregada ou está caindo.
- Botões **Marcar todos / Desmarcar todos** no sorteio aleatório.

**Avatares**
- Se o arquivo escolhido não abrir, o app **volta ao avatar padrão** em vez de ficar sem avatar.
- **Altura automática**: avatares muito altos ou baixos são ajustados para caber no enquadramento.
- **Arraste e solte** arquivos .vrm/.glb no cartão da biblioteca. A importação confere o formato (cabeçalho glTF), recusa arquivos acima de 300 MB e mostra o motivo quando ignora algum.
- Soltar um arquivo fora dos cartões não abre mais o arquivo dentro da janela.

**Itens**
- **Correção:** o slider de tamanho sobrescrevia o ajuste automático dos itens .glb próprios (itens enormes ou minúsculos). Corrigido.
- **Correção:** avatar .vrm sem osso de mão fazia o desenho travar por causa do item; agora o item flutua ao lado.
- 3 itens novos: **flor, balão e pirulito**. A tela do celular agora acompanha a hora de verdade.
- Menos CPU: a posição da mão deixou de atualizar a cena inteira a cada quadro. Texturas de itens próprios também são reduzidas.
- O cartão "Resolução e nitidez" saiu da aba Itens e foi para **Desempenho**, onde faz mais sentido.
- A lista da biblioteca deixou de ser redesenhada a cada ajuste de qualquer controle.

## v0.9.1 — abas em janelas separadas
- Cada aba do painel pode abrir **em sua própria janela**: passe o mouse na aba e clique no **⧉**, dê **duplo clique** na aba, ou use o menu da bandeja / botão direito no avatar › **Abrir em janela separada**.
- A janela mostra só aquela aba (sem o menu lateral), lembra tamanho e posição, e acompanha as configurações em tempo real junto com as outras janelas. Dá para deixar, por exemplo, *Voz* e *Chat* abertas lado a lado.
- A aba **Conversa** continua só na janela principal, porque é onde fica o microfone (duas janelas ouviriam em dobro).

## v0.9.0 — respostas em tempo real, mais rápido e mais robusto
- **Streaming**: o balão se escreve conforme a IA responde (Anthropic, OpenRouter, Ollama e servidores locais) e **ela começa a falar na primeira frase**, enquanto a próxima já está sendo sintetizada. A resposta falada chega bem mais cedo, principalmente em respostas longas. Liga/desliga em **IA › Respostas**. Se o servidor não suportar streaming, volta sozinho ao modo normal.
- **Voz**: cache das falas curtas que se repetem (avisos da agenda, comentários da hora…), uma síntese por vez e nova tentativa automática se a conexão com o serviço de voz cair.
- **Desempenho**: o avatar não busca mais os ossos pelo nome a cada quadro (menos CPU), e a leitura do `config.json` é guardada em cache.
- **Conversa**: duas perguntas ao mesmo tempo (por voz e pelo painel) entram numa fila e não embaralham mais a memória da conversa.
- **Robustez**: `settings.json` é gravado de forma atômica (sem risco de corromper) e salvo ao sair; corrigido um erro de inicialização que podia impedir o avatar de abrir quando ele estava **oculto** na última vez.
- **Segurança**: janelas em modo *sandbox*, sem navegação para fora do app, e mensagens de chat limitadas a 4000 caracteres.
- **Testes**: `npm test` roda os testes do streaming (leitura SSE/NDJSON, tags de emoção/gesto e divisão em frases).

## v0.8.1 — correção do erro do `sharp`
- O reconhecimento de voz não depende mais do binário do `sharp` (que dava `ERR_DLOPEN_FAILED` / “not a valid Win32 application”).
- Novo `npm run check` mostra a arquitetura do Node e se o motor do Whisper carrega. Se algo aparecer com ❌: apague a pasta `node_modules` e o `package-lock.json`, rode `npm install` de novo e use o Node.js **64 bits (x64)** LTS.

## v0.8.0 — tamanho do painel e resolução
- **Geral › Janela do painel**: atalhos de tamanho (Compacto, Padrão, Grande, Alto), tamanho personalizado em pixels, maximizar/restaurar, centralizar, **zoom da interface** (70–150%), painel sempre por cima e opção de **não abrir o painel ao iniciar** (fica só na bandeja). Mostra o tamanho atual em tempo real.
- **Desempenho › Resolução e nitidez**: resolução do avatar (50% a 200% da tela, ou automática pela Qualidade) com efeito imediato, e suavização das bordas (automática/ligada/desligada). Os perfis rápidos (Economia, Equilibrado, Máximo) agora também ajustam a resolução.
- Ao restaurar os padrões, zoom, “sempre por cima” e “abrir ao iniciar” do painel são mantidos.

## v0.7.0 — clima e agenda por voz
- **Clima** (Open-Meteo, grátis e sem chave): “Yoru, como está o clima?”, “vai chover amanhã?”, “clima em Curitiba”, “está frio lá fora?”. Sem cidade dita, usa a cidade da aba Conversa (Jeito dela › *Cidade do clima*) ou descobre pela internet. Ela dá dicas (guarda-chuva, casaco, água).
- **Agenda**: “crie uma agenda” (ela pergunta o que anotar), “agende dentista amanhã às 15 horas”, “marque reunião na sexta às 10”, “me lembre de ligar para a mãe daqui a 20 minutos”, “anote na agenda comprar leite”.
  - Ver: “o que tem na agenda hoje / amanhã / nesta semana?”, “minha agenda”, “tenho algum compromisso hoje?”.
  - Apagar: “apague o compromisso dentista”, “limpe a agenda” (ela pede confirmação).
  - Ela **avisa falando na hora marcada** (app aberto; dá para desligar na aba Conversa). Compromissos ficam em `agenda.json` na pasta do app.
  - A aba **Conversa** tem a lista da agenda, com campo para adicionar e botão para apagar.
- “Abra a agenda” agora mostra a agenda dela; o Google Agenda abre com “abra o Google Agenda”.

## v0.6.1 — reconhecimento de voz mais rápido
- Frase termina com ~0,4 s de silêncio (antes 0,72 s); frases longas ainda esperam 0,6 s.
- Whisper: busca gulosa, limite de tokens pela duração, aquecimento ao carregar e threads ajustadas ao seu PC.
- Modelo pré-carregado ao abrir o app se a escuta estava ligada (sem atraso na 1ª frase).
- Áudio com filtro de graves, volume normalizado e descarte de ruídos/estalos; filtro de alucinações repetidas.
- Dormindo (esperando o nome), só os primeiros 8 s da fala são transcritos. "Falar agora" tem prioridade na fila.
- A lista da aba Conversa mostra, ao passar o mouse, quanto tempo levou o reconhecimento.

## Novidades da v0.6.0 — conversa por voz
- **Aba Conversa**: você fala, ela escuta e responde falando. Ligue em **🎙️ Começar a ouvir** (ou `Ctrl+Shift+M`).
- **Ela escuta quando você chama pelo nome** (padrão: *Yoru*; troque na aba). Depois de responder, você pode continuar falando sem repetir o nome por alguns segundos; “tchau” encerra. Há também o modo *sempre ouvindo* e o botão **🎤 Falar agora**.
- **Pedidos que ela entende** (funcionam mesmo sem chave de IA):
  - “Yoru, que horas são?” → responde a hora e, **de vez em quando**, comenta: *“São 21 horas… nossa, tá ficando tarde! Ou você já vai dormir?”*
  - “abra o navegador” / YouTube / Gmail / WhatsApp / Maps / Spotify / calculadora / bloco de notas
  - “pesquise receita de bolo” (ou “… no YouTube”)
  - “role os dados”
  - “me conte as notícias” (manchetes do Google Notícias/G1, resumidas pela IA)
  - “que dia é hoje?”, “para” (cala a fala), “tchau”
  - qualquer outra coisa vai para a IA configurada na aba IA, que já sabe a data e a hora.
- **Falas espontâneas** (opcional, desligadas por padrão): de vez em quando ela puxa assunto (“Já almoçou?”, “Já é tarde, hein…”).
- **Reconhecimento no seu PC** (Whisper via `@huggingface/transformers`): sem chave e sem enviar seu áudio para ninguém. O modelo (~80 MB no padrão) é baixado **uma vez**, na primeira vez que você liga a escuta, e fica em `.userdata/models`. Escolha tamanho/precisão na aba.
- O microfone fica **mudo enquanto ela fala** (para ela não ouvir a si mesma). Fechar o painel não desliga a escuta; o ícone da bandeja avisa quando o microfone está ligado.
- Depois de atualizar, rode `npm install` de novo (entrou o pacote `@huggingface/transformers`).

**Dicas da conversa por voz**
- Se ela não reconhece o nome, olhe na lista da aba como a transcrição escreveu (🙉) e coloque em **Outras grafias** (ex.: `ioru, joru`).
- Se pega ruído ou não pega sua voz, ajuste a **Sensibilidade** (a barra de volume fica verde quando ela entende que é voz).
- Windows: se o microfone não abrir, libere em Configurações › Privacidade e segurança › Microfone (apps de desktop).
- A voz neural dela e a IA (Anthropic/OpenRouter) usam internet; o reconhecimento, a hora, os dados e abrir sites não dependem da IA.
- Em “Pode abrir navegador, sites e programas” dá para desligar as ações no computador.

## Novidades da v0.5.0
- **Aba Avatar** (biblioteca de modelos em grade, com miniatura do rosto e painel de detalhes ao lado): adicione arquivos `.vrm` ou `.glb`, troque na hora e remova. Ficam em uma pasta própria do app (botão "Abrir pasta"). Modelos `.glb` comuns não têm esqueleto humano: o corpo todo balança, pula e gira.
- **Aba Itens**: celular, dados, caneca e livro (ou um `.glb` seu). Em avatares `.vrm` ela segura o item na mão (direita ou esquerda); em `.glb` o item flutua ao lado. Botão **Rolar os dados**: ela joga e anuncia o resultado.

## Novidades da v0.4.0
- **Painel novo**: janela maior (1040×760), redimensionável, que lembra tamanho e posição. Menu lateral com abas Avatar, Emotes, Voz, Comportamento, Chat, IA, Desempenho e Geral, e cartões em colunas.
- **Aba Voz** própria, com campo para digitar uma frase de teste e botão Parar.
- **Balão de fala**: ligar/desligar, texto digitado aos poucos e tempo na tela.
- **IA**: tamanho máximo da resposta e memória da conversa.
- **Geral**: abrir junto com o Windows, tema do painel (automático/escuro/claro) e cor de destaque.
- **Chat** ocupa a altura toda da janela.

## Novidades da v0.3.0
- **Voz neural**: voz natural (Francisca, Thalita, Antônio...) grátis e sem chave, via serviço do Edge. Escolha em Comportamento › Voz. Se faltar internet, cai sozinha na voz do Windows.
- **Boca sincronizada com o áudio real**: ela abre mais nas sílabas fortes e fecha nas pausas.
- Depois de atualizar, rode `npm install` de novo (entrou o pacote `msedge-tts`).

## Novidades da v0.2.0
- **IA com gestos**: a IA escolhe emoções e emotes (acenar, concordar, dançar...) durante a conversa.
- **Voz**: as respostas podem ser faladas com as vozes do Windows (aba Comportamento), com boca sincronizada.
- **Aba Chat** no painel: converse sem precisar do balão do avatar, com histórico.
- **Aba IA**: troque de provedor, chave, modelo e personalidade sem editar arquivos.
- **Posição**: botões de canto de tela e memória da última posição.
- **Reação ao clique**, **texto digitado aos poucos** e **ícone na bandeja** do Windows.
