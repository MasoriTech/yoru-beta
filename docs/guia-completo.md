> **Guia antigo.** Este arquivo é o README anterior à organização do repositório, mantido por conter passo a passo de Tapo, OpenClaw, Hub e PWA. O resumo atual está no [README](../README.md) e o histórico em [CHANGELOG](../CHANGELOG.md).

# Yoru v0.63.0 — KoboldCpp como cérebro

## v0.63.0 — KoboldCpp como cérebro

A Yoru agora vem com o **KoboldCpp** como cérebro padrão: o modelo de IA roda no seu próprio PC, sem chave, sem conta e sem internet para pensar.

**Como ligar (uma vez):**
1. Baixe o KoboldCpp (github.com/LostRuins/koboldcpp) e um modelo no formato `.gguf`.
2. Abra o KoboldCpp com o modelo, por exemplo: `koboldcpp.exe --model seu-modelo.gguf --port 5001 --contextsize 4096`. O endereço padrão da Yoru já é `http://localhost:5001/v1`.
3. Confira com `npm run check:kobold` (ele diz qual modelo está carregado e se respondeu). Na Yoru: aba **IA › Conexão › KoboldCpp** (botão **Buscar** mostra o modelo).

**Detalhes:**
- Se o KoboldCpp foi aberto com `--password`, coloque a senha no campo "Chave da API (opcional)".
- O campo Modelo pode ficar como `koboldcpp`: ele usa o modelo que você carregou nele.
- O prompt da Yoru (comandos, gestos, memória) é longo. Use um contexto de pelo menos 4096 e, em modelos pequenos, desligue "A IA conhece os comandos" na aba IA se as respostas ficarem lentas.
- Roteamento **LOCAL** continua no KoboldCpp. Imagens funcionam se o KoboldCpp foi aberto com um `--mmproj` de visão; PDF só com Anthropic ou OpenRouter.
- Quem já tinha um `config.json` mantém o provedor que escolheu; o KoboldCpp é o padrão para instalações novas. Os outros provedores (Anthropic, OpenRouter, Ollama, servidor local e OpenClaw) continuam disponíveis.

## v0.62.0 — Yoru menos dura, OpenClaw com skills e PWA com temas

## v0.62.0 — Yoru menos dura, OpenClaw com skills e PWA com temas

- **Animação mais solta:** joelhos que cedem na troca de peso, caminhada com cotovelos e contrapeso da cabeça, e gestos de fala com mais variação. Novo gesto de ênfase: de tempos em tempos um braço sobe à frente, abre a mão e volta. A intensidade continua nos controles de vida parada e de gestos ao falar.
- **OpenClaw:** conexão automática, reparo do `openclaw.json`, instalação de skills pela aba IA e respostas do agente sem corte.
- **App do celular (PWA):** tema claro, escuro ou automático e opção de reduzir animações.
- Lista completa em `CHANGELOG.md`.

## v0.61.0 — Yoru no celular (PWA)

Use a Yoru no Android ou no iPhone por um app web instalável, servido pelo próprio Yoru no seu PC.

**Como ligar (uma vez):**
1. No PC: Yoru › Configurações › **Celular** › ligue "Ativar o acesso pelo celular".
2. No celular (mesmo Wi‑Fi): escaneie o QR Code com a câmera. O app abre e pareia sozinho.
   Se preferir, abra o endereço mostrado e digite o código de 8 números.
3. Instale na tela inicial: **Android** (Chrome) › menu ⋮ › "Adicionar à tela inicial"; **iPhone** (Safari) › Compartilhar › "Adicionar à Tela de Início".

**Modo 1 — usar a Yoru:** aba 💬 do app. Conversa com a mesma IA/memória. Não executa comandos no PC.

**Modo 2 — controlar o PC:** aba 🖥️ do app. No PC, defina uma senha em aba Celular › Controle do PC (Modo 2) e ligue "Permitir o controle do PC". No celular, digite a senha para liberar; o controle bloqueia sozinho por inatividade. Recursos: volume, mídia, slides (setas), janelas, abrir programa, ver a tela e energia (desligar/reiniciar com 30 s para cancelar).

**Fora de casa:** use o [Tailscale](https://tailscale.com) (grátis) no PC e no celular. Forma simples: escolha o endereço marcado como Tailscale (`100.x.x.x`) na aba Celular › Conectar. Para HTTPS (app instalável, tela cheia e ditado por voz): na aba Celular › Fora de casa, desligue a rede Wi‑Fi, rode `tailscale serve --bg 8787` no PC e cole o endereço `https://…ts.net` no campo indicado; o QR passa a usá-lo. Nunca abra a porta do roteador para a internet.

**Segurança em resumo:** vem desligado; só aparelhos pareados falam com a Yoru; a senha só é definida no PC; o servidor aceita apenas uma lista fixa de ações; desligar/reiniciar/suspender pedem confirmação; erros de senha bloqueiam por um tempo; dá para revogar qualquer aparelho. Dados ficam em `remote.json` (somente hashes) e não entram no backup. Sem HTTPS (só Wi‑Fi comum) o tráfego não é criptografado: use redes confiáveis ou o Tailscale.

## v0.60.5 — Float Dock refinado e corrigido

- O botão de recolher o dock agora fica sempre preso à barra (antes podia sair da janela).
- Indicadores do atalho ativo e animações de hover não são mais cortados.
- Ao arrastar o símbolo Y, uma área tracejada mostra a borda de encaixe; **Esc** cancela.
- Navegação por teclado no dock: setas, Home e End; a aba ativa sempre fica visível.
- Icon Sidebar compacta os botões em janelas baixas e não gera mais rolagem horizontal.

## v0.60.4 — Float Dock com acabamento premium

- Dock redesenhada com vidro fumê em camadas, reflexos internos, brilho âmbar e sombras mais profundas.
- Ícones receberam estados hover/ativo/foco mais claros, separadores por grupo e indicadores adaptados à orientação.
- Marca Y, controle de avatar e aba de recolhimento ganharam acabamento visual consistente.

## v0.60.3 — Float Dock com quatro posições e recolhimento

- Float Dock configurável em cima, direita, embaixo ou esquerda.
- Reposicionamento também por arraste do símbolo Y até a borda desejada.
- Aba compacta para recolher/expandir a navegação sem removê-la da tela.
- Posição e estado recolhido salvos nas configurações do usuário.

## v0.60.2 — navegação por áreas e layouts refinados
- Discord usa áreas navegáveis com canais contextuais; Icon Sidebar e Float Dock foram ajustados para manter identificação e acessibilidade.
- Corrigidas colisões de regras responsivas antigas.

## v0.60.1 — refinamento de Float Dock, Icon Sidebar e Discord
- Menus agrupados, tooltips, dock horizontal real e navegação Discord em três áreas.
- Corrigidos conflitos de responsividade em janelas estreitas.

## v0.60.0 — layouts de navegação personalizáveis
- Adicionados Float Dock, Icon Sidebar e Discord, selecionáveis em Configurações › Aparência.
- A preferência é salva no perfil e reorganiza a navegação sem remover funcionalidades.

## v0.59.0 — estabilidade, diagnóstico e recuperação
- Criado registro técnico local com rotação automática, limite de tamanho e ocultação de credenciais conhecidas.
- Adicionada exportação de logs pela Central de Saúde, somente após ação explícita; revise o arquivo antes de compartilhar porque ele pode conter caminhos locais e detalhes de falhas.
- Ampliada a Central de Saúde com memória livre, espaço em disco, avatar padrão e integridade de componentes do aplicativo.
- Fortalecida a restauração de backups: validação mais rígida de caminhos, preparação de temporários e reversão dos arquivos originais se uma etapa da substituição falhar.
- O iniciador do Windows prioriza `npm ci` quando há lockfile, tornando a instalação reproduzível entre computadores.
- Acrescentados testes automatizados para logs, proteção de credenciais, rotação, diagnóstico ampliado e rollback de backup.

## v0.58.3 — seis novos emotes
- Adicionados Joinha, Coração, Mandar beijo, Apontar, Dar de ombros e Facepalm.
- Cada emote ganhou uma animação própria para o avatar 3D e um movimento correspondente para o Chibi 2D.
- Os seis gestos foram incluídos no seletor do painel e no catálogo de instruções da IA.
- Adicionados comandos de voz em português para acionar os novos gestos.
- Configurações antigas recebem os novos emotes uma única vez, respeitando preferências já salvas.

## v0.58.2 — ajustes de proporções e espaçamento
- Padronizadas as alturas, larguras, alinhamentos e distâncias das abas principais e internas.
- Reequilibradas as colunas dos cartões para evitar painéis estreitos em janelas médias.
- Ajustados os espaços internos de cartões, títulos, formulários, campos e botões.
- Reorganizadas as quatro abas da lâmpada Tapo em uma grade proporcional, com quebra para duas colunas em telas menores.
- Melhorada a adaptação da navegação e dos formulários para janelas compactas.

## v0.56.0 — Central Bluetooth por voz

- A descoberta falada agora combina a lista de dispositivos Bluetooth clássicos que o Windows reconhece com dispositivos Bluetooth LE que anunciam presença nas proximidades. Isso corrige o caso de caixas de som clássicas que não aparecem numa busca BLE isolada.
- Ao pedir “Yoru, mostrar dispositivos Bluetooth”, uma janela própria abre com a lista numerada e informa a quantidade encontrada.
- Diga “o 2”, “segundo”, “número 2” ou o nome do dispositivo. Yoru repete o nome selecionado e pergunta se pode iniciar a conexão.
- Diga “sim” para abrir a etapa nativa de conexão/pareamento do Windows; “não” cancela. Também é possível selecionar e confirmar pelos botões da janela.
- Para acessórios de áudio Bluetooth, o Windows continua responsável por concluir perfil, PIN, permissões e conexão efetiva. O Yoru abre a tela do sistema e não declara “conectado” sem confirmação do Windows.

Exemplo: “Yoru, mostrar dispositivos Bluetooth” → “Detectei 5 dispositivos. Qual você quer conectar?” → “o 2” → “Você escolheu JBL Go 3. Quer que eu inicie a conexão?” → “sim”.

## v0.55.0 — Comandos de voz ampliados para Tapo L530E

- Comandos locais de voz para ligar/desligar, brilho absoluto e relativo, cor HSV nomeada, cor aleatória, temperatura de branco (2.500–6.500 K) e combinações de cor/brilho.
- Reconhecimento de branco quente/amarelo, neutro/natural e frio/gelo, além de valores Kelvin falados.
- Acesso aos efeitos nativos que o firmware reportar (ex.: Party e Relax), com parada do efeito.
- Seleção dos presets Light preset 1–7 quando o dispositivo os anunciar.
- Ajuste de transição suave ao ligar/desligar (0–60 segundos) quando o firmware expuser as features `smooth_transition_on` e `smooth_transition_off`.
- Consulta por voz do estado atual (ligada/desligada, brilho e temperatura/cor).
- Temporizadores pontuais por voz gerenciados pelo Yoru, limitados a 24 horas; o aplicativo Yoru precisa permanecer aberto.
- Auto White é detectado dinamicamente caso o firmware/API exponha uma feature correspondente; se não expuser, o Yoru explica que é necessário configurar pelo app Tapo.
- Modo Ausente, agendas recorrentes e Sunrise/Sunset são identificados por voz, mas continuam dependendo do aplicativo Tapo nesta integração local; não há falsa confirmação de execução.
- O Tapo mostra runtime e consumo no aplicativo; esses dados não são expostos atualmente como recursos pela API python-kasa usada aqui, então o Yoru orienta a consulta no app.
- Testes unitários para reconhecimento, validação de ações e integração com o fluxo de voz.

Exemplos: “Yoru, cor aleatória”; “branco frio”; “amarela”; “azul com 40%”; “efeito Festa”; “preset 3”; “desligue suavemente em 8 segundos”; “como está a lâmpada?”; “desligue em 20 minutos”.

- Detecção genérica de adaptadores Wi-Fi e Bluetooth reconhecidos pelo Windows, independentemente de marca/modelo; adaptadores sem driver continuam dependendo do driver do fabricante.
- Integração local da lâmpada TP-Link Tapo L530E via python-kasa: descoberta, estado, ligar/desligar, brilho, cor HSV, temperatura de cor e cenas.
- Credenciais Tapo protegidas com Electron safeStorage/Windows DPAPI; a senha não é enviada ao renderer nem gravada em texto puro.
- Requer Python 3 e `py -3 -m pip install --user python-kasa` para o conector Tapo; computador e lâmpada na mesma rede Wi-Fi.
- A automação usa a rede local; não instala drivers de hardware automaticamente.

## Configurar MASORI Smart Home (Tapo L530E)

1. No Windows, instale Python 3 e confirme que o comando `py -3` funciona.
2. Execute no PowerShell: `py -3 -m pip install --user python-kasa`.
3. Conecte o computador e a lâmpada à mesma rede Wi-Fi de 2,4 GHz.
4. No Yoru, abra Conectividade → MASORI Smart Home, informe o e-mail e a senha da conta TP-Link/Tapo e salve.
5. Clique em **Encontrar L530E na rede**. Se a descoberta automática não localizar a lâmpada, consulte a lista de clientes DHCP do roteador e informe o IP no campo opcional.

A biblioteca python-kasa lista a L530E entre os modelos Tapo suportados. Modelos recentes normalmente exigem credenciais TP-Link/Tapo. O conector usa a comunicação local na rede; algumas versões/firmwares podem ter restrições de compatibilidade. Consulte o CHANGELOG e a documentação do python-kasa antes de diagnosticar falhas de autenticação.

## Limites da conectividade universal

O Yoru enumera interfaces que o Windows reconhece por seus drivers (Wi-Fi, Ethernet e adaptadores Bluetooth PAN) e abre as configurações nativas de Wi-Fi/Bluetooth. Isso evita depender de uma marca/modelo específico, mas não substitui drivers. Se um adaptador aparecer como dispositivo desconhecido, instale o driver fornecido pelo fabricante e verifique novamente. A lista de Bluetooth usa o inventário do Windows; a descoberta BLE permanece sujeita ao suporte do rádio/driver.

## Histórico da versão 0.53.0 — Visão computacional autorizada

- Masori-Vision pode analisar uma captura de janela/tela autorizada, reconhecer a aplicação, descrever elementos visíveis e explicar mensagens de erro legíveis.
- Seleção de janela/tela e captura em duas etapas: prévia local primeiro, envio ao provedor configurado somente após confirmação explícita.
- Capturas temporárias em memória, de uso único, expiração em 3 minutos e sem gravação da imagem no disco/histórico.
- Requer modelo com capacidade de visão no provedor/modelo configurado para Masori-Vision.

## Histórico da versão 0.52.0 — MASORI Workspace e execução segura

- Workspace local escolhido pelo usuário: navegação, busca textual e leitura somente de arquivos selecionados, sem alterar os arquivos.
- Limites de segurança para caminhos, links simbólicos, pastas sensíveis, arquivos binários e tamanho de contexto.
- Busca limitada a 300 arquivos/5 MB; até oito arquivos e 48 KB podem ser enviados como contexto aos especialistas selecionados.
- Progresso das etapas, uma execução por vez, cancelamento com sinal de aborto para chamadas em andamento e exportação de relatórios em Markdown usando o diálogo nativo do Windows.
- O Masori-Agent não recebe terminal nem execução arbitrária de comandos.

# Yoru v0.51.0 — Masori-Sama Multiagente

- Especialistas Masori executam chamadas independentes ao provedor configurado, com até três análises em paralelo.
- Provedores/modelos individuais, memória por agente e histórico de 30 execuções.
- Masori-Sama consolida os relatórios em uma resposta final.

# Yoru v0.50.0 — Masori-Sama

- Novo agente coordenador Masori-Sama e registro de especialistas Masori-Dev, Research, Vision, Memory, Voice e Agent.
- Nova aba dedicada para planejar tarefas e executá-las pelo provedor de IA já configurado.
- Execução transparente: esta versão usa uma chamada coordenada ao modelo atual; não simula agentes independentes nem paralelismo.
- Mantém Yoru como personagem/interface desktop e MASORI como ecossistema.

# Yoru v0.48.0

Yoru: avatar VRM transparente na área de trabalho, com chat de IA (Anthropic ou Ollama local), voz e emotes.

## Novidades da v0.40.0 — Central do iPhone
- Detecção de dispositivos Apple/iPhone presentes no Windows por USB, com orientação de desbloqueio, confiança e driver.
- Atalho para abrir o app Fotos do Windows e concluir a importação pelo fluxo oficial do sistema.
- Configuração de um receptor AirPlay `.exe` já instalado, inicialização e encerramento do processo pela Central de Conectividade.
- Painel do iPhone reúne USB, importação, estado do receptor e espelhamento assistido; o compartilhamento Safari por Wi-Fi foi preservado.
- Limites: o receptor AirPlay é externo e precisa ser instalado/licenciado separadamente; o Yoru não implementa o protocolo AirPlay, não garante áudio em todo receptor e não oferece controle remoto irrestrito do iOS. A importação USB é concluída pelo Fotos do Windows, não por um navegador de arquivos USB próprio do Yoru.

## Novidades da v0.34.0
- Aba Yoru Hub renomeada para **Conectividade**, com navegação e conteúdo reorganizados por Rede, Dispositivos móveis, Hardware conectado e Gerenciador de arquivos.
- Ação de verificação geral posicionada no topo; cartões e controles reorganizados para melhor leitura em telas menores.
- Mantidas as funções e identificadores existentes de rede local, agente Windows, ADB, Bluetooth, USB e transferências.
- Orientações de uso do iPhone pelo Safari e limites de conectividade do iOS mais visíveis.

Histórico de versões: veja o [CHANGELOG.md](CHANGELOG.md).

## Hub: HTTPS e integridade de transferência (v0.26.0)
O agente pode operar com HTTPS quando `YORU_HUB_TLS_CERT` e `YORU_HUB_TLS_KEY` apontam para certificado e chave PEM. Configure ambas as variáveis no ambiente do processo que inicia o agente. O cliente Yoru valida o certificado pela cadeia de confiança do Windows/Node; certificados autoassinados não confiáveis serão rejeitados. Uploads do agente têm limite de 100 MB. O agente fornece SHA-256 para downloads e confirma SHA-256 de uploads. HTTP sem TLS permanece apenas para redes privadas confiáveis; não exponha o agente à internet.

## Novidades da v0.17.0
- Central de Saúde do Yoru com diagnóstico local de runtime, memória, permissões da pasta de dados e dependências.
- Recomendações de correção por item, sem alterar automaticamente arquivos, configurações ou processos.

## Novidades da v0.16.0
- Galeria de criação com favoritos, filtro de favoritos e ordenação por data ou nome.
- Indicadores de quantidade de projetos e espaço utilizado.
- Preservadas as ferramentas e ações existentes da galeria.

## Novidades da v0.15.0
- Avatar 2D com aura reativa à emoção e à fala, transições de filtro suavizadas e intensidade visual interpolada.
- Avatar VRM com lip-sync suavizado e proteção contra frames longos e dados de áudio ausentes.
- Recursos existentes de VRM/Chibi, 50 reações 2D, olhar, piscada, respiração e gestos preservados.

## Novidades da v0.13.0
- Central de voz com métricas da sessão: frases aceitas, latência média e última latência de reconhecimento.
- Personalidade configurável da Yoru: equilibrada, amigável, divertida, profissional ou direta.
- Preferência de personalidade validada e aplicada às instruções enviadas à IA.

## Novidades da v0.11.0
- Camada central de segurança para IPC: valida janela do aplicativo, frame principal e origem local `file://` dentro de `src/`.
- Limites de chamadas para canais de maior custo, incluindo chat, TTS, geração e recuperação.
- Diagnóstico do runtime com versões de Electron/Node/Chromium, memória do processo e do sistema e CPU.
- Backup portátil `.yorubackup` de configurações, perfil, memória, conversas, agenda, projetos criados e biblioteca de avatares/itens.
- Restauração com validação de formato, caminhos permitidos, limites de tamanho e confirmação antes de substituir dados.
- Modelos baixados e caches ficam fora do backup para evitar cópias excessivamente grandes.

## Instalar e iniciar no Windows
**Mais fácil:** extraia o ZIP completo e dê dois cliques em `iniciar.bat`. O iniciador prepara o ambiente e abre o Yoru.

O `iniciar.bat`:
- verifica Windows, Node.js x64 (20+) e Python 3.10+;
- tenta instalar Node.js LTS e Python 3.12 pelo WinGet quando faltarem (se o WinGet não estiver disponível, mostra os endereços oficiais);
- instala/atualiza as dependências Electron/Node com `npm install` quando necessário;
- prepara os arquivos locais Three.js/VRM e o runtime/modelo MediaPipe usado pela aba Gestos;
- instala `python-kasa` para habilitar o conector local da lâmpada Tapo L530E;
- verifica integrações opcionais como Ollama, ADB e scrcpy e, ao final, executa `npm start`.

O reconhecimento de voz integrado continua disponível sem Faster-Whisper. Para instalar também o backend Faster-Whisper (opcional, baseado em CPU), execute `iniciar.bat --instalar-whisper`. O modelo de transcrição escolhido é baixado no primeiro uso.

**Requisitos e observações:** Windows 10/11 x64, conexão com a internet na primeira preparação e espaço em disco para Electron, dependências e modelos. A instalação automática pelo WinGet depende de o WinGet estar disponível no Windows. Node.js e Python são instalados no computador do usuário; o iniciador não instala drivers Bluetooth/Wi-Fi. O pareamento Bluetooth usa o Windows. O conector Tapo precisa que o computador e a lâmpada estejam na mesma rede e que as credenciais sejam configuradas dentro da aba Smart Home. Chaves de IA, conta Tapo e dispositivos não são configurados automaticamente pelo BAT.

Ollama, Android Platform-Tools (ADB), scrcpy e receptores AirPlay são integrações externas/opcionais: o iniciador apenas informa se Ollama/ADB/scrcpy já estão no PATH; não baixa modelos Ollama nem instala esses componentes.

Para executar manualmente: `npm install` e depois `npm start`. Seu modelo de avatar fica em `assets/avatar.vrm` (crie outro no **VRoid Studio** e exporte como VRM, se quiser trocar). No painel, aba **IA**, escolha o provedor e configure sua chave Anthropic/OpenRouter ou o endereço/modelo Ollama.

## OpenClaw: usar as skills do agente

O Yoru conversa com o **gateway do OpenClaw** como um provedor de IA. As skills continuam instaladas e rodando no OpenClaw (ClawHub, workspace do agente etc.); o Yoru manda o pedido ao agente e mostra/fala o resultado.

**Jeito rápido:** painel › aba **IA** › provedor **OpenClaw (agente)** › **🔎 Detectar OpenClaw**. A Yoru lê o `~/.openclaw/openclaw.json`, acha a porta e o token, testa o gateway, lista os agentes e salva tudo. Se o endpoint de chat estiver desligado, ela pergunta se pode ligar (com cópia de segurança). O token nunca aparece na tela. **📋 Quais skills?** pergunta ao próprio agente o que ele sabe fazer. Se o token estiver em variável de ambiente ou SecretRef, ou o arquivo tiver comentários (JSON5), cole o token e/ou use o passo a passo manual abaixo.

**Modelos gratuitos do OpenRouter nas skills:** quem chama o modelo é o OpenClaw, então a chave do OpenRouter precisa estar nele. Em **🆓 Enviar ao OpenClaw e usar modelos gratuitos**, cole a chave `sk-or-...` (ou deixe vazio para usar a que já está salva no Yoru) e confirme. A Yoru põe a chave em `env.OPENROUTER_API_KEY` do `openclaw.json` (com cópia de segurança), escolhe um modelo `:free` que aceita ferramentas (ou use o que você digitar) e passa a mandá-lo em cada chamada pelo cabeçalho `x-openclaw-model`, sem mudar o modelo padrão do seu agente. **Reinicie o gateway** depois, para ele ler a chave nova. **Voltar ao modelo do OpenClaw** desfaz a escolha. Modelos gratuitos têm limite por dia e podem falhar em skills complexas.

**Passo a passo manual**

1. **Ligue o endpoint de chat do gateway** (vem desligado). Rode `npm run setup:openclaw` para ver o que mudaria e `npm run setup:openclaw -- --apply` para gravar (faz cópia de segurança do `~/.openclaw/openclaw.json`). Se preferir à mão, adicione:
   ```json5
   { gateway: { http: { endpoints: { chatCompletions: { enabled: true } } } } }
   ```
2. No Yoru: painel › aba **IA** › provedor **OpenClaw (agente)**.
   - Endereço: `http://127.0.0.1:18789/v1`
   - Chave: o `gateway.auth.token` do `~/.openclaw/openclaw.json` (ou a senha, se o modo for `password`).
   - Modelo: `openclaw/default` (agente padrão) ou `openclaw/<id>` para um agente específico. **Buscar** lista os agentes.
3. Peça pelo chat ou por voz o que a skill faz. O Yoru mantém uma sessão fixa (`user: yoru`), então o agente lembra o fio da tarefa.

Notas:
- O Yoru não envia `max_tokens` ao OpenClaw: o limite curto do modo FAST cortaria a tarefa. Tarefas de agente têm até 10 min de espera.
- Um token do gateway equivale a acesso de operador: mantenha o gateway em `127.0.0.1` (ou Tailscale) e nunca exponha na internet.
- Erro 404/405 = endpoint desligado ou endereço sem `/v1`; 401 = token errado.

## Reconhecimento de voz (opcional: Faster-Whisper)
- O reconhecimento integrado continua funcionando com Transformers.js.
- Para usar Faster-Whisper/CTranslate2 em CPU com quantização INT8, instale Python 3 e rode `pip install faster-whisper` no ambiente Python do sistema.
- O Yoru detecta o pacote automaticamente. Se não estiver instalado, ou se o backend falhar, usa o mecanismo integrado como fallback.
- O Faster-Whisper usa CPU nesta versão; a opção DirectML permanece no backend integrado. A primeira execução baixa o modelo escolhido para o cache local.

## Como usar
- **Arrastar**: clique e segure no avatar. A posição fica salva.
- **Clique simples** no avatar: ela reage. **Duplo clique** ou `Ctrl+Shift+Space`: abre o chat.
- **Mostrar/ocultar**: botão grande no painel (com fade) ou `Ctrl+Shift+H`.
- **Painel** (`Ctrl+Shift+P`, ícone na bandeja ou botão direito no avatar): janela separada, redimensionável, com menu lateral
  (**Avatar** (modelo, ajustes e **Comportamento**: andar, emotes, corpo e fala), Itens, Voz, Chat, **Conversa**, **Gestos**, IA, Criação e **Configurações**, que traz também o Desempenho).
- Fora do avatar, os cliques passam para as janelas por trás.

## Gestos de mão (aba Gestos)
Controle o PC e a Yoru com a mão, pela webcam, estilo Jarvis. A câmera e o reconhecimento (MediaPipe) rodam **só no seu PC**; nada é gravado nem enviado.
- Na primeira vez, `npm install` baixa o runtime e um modelo da mão (~8 MB) para `src/vendor/mediapipe/`; depois funciona offline. Se o download falhar, rode `npm run vendor` com internet.
- Aba **Gestos › Ligar a câmera**. Mostre a **palma aberta parada por 1 s**: o selo fica laranja ("Armado") e dá um bipe. Por 8 s, cada gesto segurado ~0,6 s executa a ação ligada a ele; depois desarma sozinho.
- Gestos: palma aberta, punho, indicador, paz (✌️), três dedos, joinha, polegar para baixo, OK, rock, hang loose e deslizar a palma para esquerda/direita. Padrões: punho = tocar/pausar, joinha = volume +, polegar para baixo = volume −, ✌️ = print da tela, OK = falar com a Yoru, deslizar = faixa seguinte/anterior. Tudo configurável na tabela **Gesto → ação**.
- **Predefinições** (Padrão, 🎵 Mídia, 📽️ Apresentação: deslizar e indicador passam os slides). Segurar o joinha ou o polegar para baixo **repete** o volume. O gesto reconhecido acende na lista e a Yoru acena com a cabeça ao armar.
- **Mouse no ar** (Windows): o indicador move o cursor, a pinça (polegar + indicador) clica e, segurada, arrasta; polegar + médio dá clique direito; palma aberta por 1,2 s desliga (também desliga se a mão sumir por 3 s). O cursor fica parado enquanto a pinça fecha, para o clique cair no alvo. Alcance ajustável de 1 a 5; dá para ligar por um gesto (ação "Ligar/desligar o mouse no ar"). Código em `src/air-mouse.js` (um PowerShell fixo recebe só `m x y`, `d`, `u`, `r`).
- **Modo teste** mostra o que seria reconhecido sem executar nada. Não há ação de desligar, reiniciar ou bloquear por gesto, de propósito.
- **Mão livre** (aba Gestos › Mão livre, junto com o mouse no ar): uma mão virtual flutuante no lugar do cursor, numa janela que não pega o mouse. Segue o mouse comum e passeia sozinha quando ele fica parado; com **✋ Ativar a mão livre** (liga a câmera e o mouse no ar) obedece a sua mão: indicador leva, pinça clica/arrasta, **punho agarra e arrasta**, **✌️ rola a página**. Ela também **interage com o avatar**: fecha o punho quando você agarra a Yoru, faz carinho se passar sobre a cabeça dela e, passeando, às vezes vai sozinha fazer carinho nela. Código em `src/hand-logic.js`, `src/hand-window.js` e `src/hand.js`.
- O painel precisa ficar aberto (pode estar minimizado) para a câmera continuar. Código em `src/gesture-logic.js` (gestos e quando executar), `src/gesture-actions.js` (ações, no processo principal) e `src/panel-gestos.js` (câmera e tela); testes em `test/gesture.test.js`.

## Chat: memória e arquivos
- **Memória de longo prazo** (Chat › 🧠 Memória): fatos curtos sobre você que ela leva para todas as conversas. Diga "lembre que eu gosto de café" (ou "esqueça isso") e a IA guarda/apaga sozinha; também dá para adicionar e apagar à mão. Fica em `memory.json` na pasta de dados do app. Senhas, CPF/RG e números de cartão nunca são guardados. Dá para desligar em "Usar memória de longo prazo".
- **Conversa salva**: ao reabrir o app, a conversa continua de onde parou (desligue em "Lembrar a conversa ao reabrir o app").
- **Enviar arquivos** (📎, arrastar para o chat ou colar com Ctrl+V): até 5 por mensagem. Texto e código (.txt, .md, .csv, .json, .py, .js...) entram na mensagem; imagens (PNG, JPG, GIF, WebP, até 5 MB) vão para a IA ver; PDF (até 20 MB) funciona com o provedor Anthropic. Imagens exigem um modelo com visão.

## Criar o programa para Windows (.exe)
Pré-requisito: **Node.js 64 bits (LTS)**. Na pasta do projeto:
- **Mais fácil:** dê dois cliques em `build-windows.bat`. Ele instala tudo, roda os testes e cria os arquivos em `dist\`.
- **Pelo terminal:** `npm install` e depois `npm run dist`.

Resultado em `dist\`:
- `Yoru-Setup-<versão>.exe`: instalador (escolhe a pasta, cria atalhos na área de trabalho e no menu Iniciar).
- `Yoru-Portatil-<versão>.exe`: roda sem instalar; guarda os dados na pasta `YoruData`, ao lado do .exe.

Outros comandos: `npm run pack` (só a pasta do programa, sem instalador, para testar rápido), `npm run dist:setup` e `npm run dist:portable`.

**Onde ficam os dados (programa instalado):** `%APPDATA%\Yoru` (configurações, `config.json` com a chave da IA, memória, perfil, conversa, avatares e itens que você adicionou). Desinstalar **não** apaga essa pasta. Em desenvolvimento (`npm start`) tudo continua em `.userdata` e `config.json` ao lado do projeto.

**Antes de distribuir:** o Windows pode mostrar o aviso "SmartScreen" para programas sem assinatura digital; para evitar, é preciso um certificado de assinatura de código (opcional, pago). O `config.json` com a sua chave **nunca** entra no pacote.


## Segurança
- **Content-Security-Policy** em todas as janelas: sem scripts inline e sem origens remotas. O `index.html` mantém dois scripts inline (tratamento de erro e escolha do caminho do three.js); os hashes ficam em `scripts/csp-hashes.js`. Se mexer neles, rode `npm run csp`.
- **Chaves de API cifradas** no `config.json` (`enc:v1:...`) com o `safeStorage` do Electron (no Windows, só o seu usuário neste PC abre). Chaves em texto puro são cifradas sozinhas na primeira abertura. Copiou o arquivo ou a versão portátil para outro PC/usuário? Cole as chaves de novo.
- **Controle do PC** (`src/pc-control.js`): textos da fala vão por variável de ambiente, nunca dentro do código do PowerShell. Desligar, reiniciar, dormir e fechar janelas pedem confirmação por voz (20 s) e o desligamento tem 30 s para cancelar. A IA só consegue mexer em tema, cor, avatar e item (tags `[app:...]`); a resposta dela nunca é lida como comando do computador.
- Código em `src/secrets.js`, `scripts/csp-hashes.js`; testes em `test/secrets.test.js`, `test/csp.test.js` e `test/security.test.js`.

## Problemas comuns
- Erros `Unable to move the cache` / `Gpu Cache Creation failed`: o app já usa uma pasta própria de cache (`.userdata`). Feche instâncias antigas do Electron no Gerenciador de Tarefas.
- Tela sem avatar: o app tenta sozinho o modo software. Para forçar: `npm start -- --no-gpu`. Para ver erros: `npm start -- --debug`.
- Sem voz em português: instale em Configurações › Hora e idioma › Fala.

## Próximos passos (ideias)
- Vozes ainda mais expressivas (ElevenLabs ou Piper local) e poder interromper a fala dela falando por cima
- Animações prontas (arquivos VRAMA) e caminhar pela tela
- Sentar na borda das janelas (ler a posição das janelas do Windows)
- Streaming da resposta da IA

## Organização do código (processo principal)

O `src/main.js` só liga o Electron (janelas, bandeja, atalhos, IPC) aos módulos abaixo. Os módulos **não importam o Electron**: tudo que vem de fora (pasta de dados, config, janela, `fetch`) entra por parâmetro, então cada um tem teste automático (`npm test`).

| Módulo | O que tem | Testes |
|---|---|---|
| `src/ai-core.js` | histórico, fila de chamadas, streaming, timeout, troca de provedor, lista de modelos | `test/ai-core.test.js` |
| `src/settings.js` | valores padrão, validação (`sanitize`) e migração do `settings.json` | `test/settings.test.js` |
| `src/library.js` | biblioteca de avatares e itens (`.vrm`/`.glb`), nomes seguros | `test/library.test.js` |
| `src/store.js` | gravação atômica em disco e salvamento com atraso | `test/store.test.js` |
| `src/chat-store.js` | conversa salva (histórico + mensagens do chat) | `test/store.test.js` |
| `src/criacao-service.js` | aba Criação: geração de imagem/texto/SVG/HTML e projetos em disco | `test/criacao-service.test.js` |

Alguns testes conferem, lendo o código, que painel, preload e processo principal estão ligados entre si. Eles leem o `main.js` junto com os módulos acima por `test/helpers/main-source.js`; se criar um módulo novo do processo principal, inclua-o na lista desse arquivo.

## Roteamento inteligente de IA (v0.12.0)
Na aba **IA › Conexão**, escolha o modo **Automático**, **FAST**, **THINK** ou **LOCAL**. O automático encaminha mensagens curtas e conversas por voz para FAST; solicitações longas ou que pedem análise detalhada seguem para THINK. FAST limita a resposta a até 220 tokens. Os campos de modelo alternativo são opcionais e usam o provedor atualmente selecionado. LOCAL usa o endereço e o modelo já configurados no Ollama; confirme que o serviço está em execução antes de selecionar esse modo.


## v0.18.0 — Relatório técnico
A Central de Saúde permite exportar um relatório JSON com verificações locais e informações de runtime para facilitar suporte. O arquivo é salvo somente após confirmação no diálogo do Windows; nenhum dado é enviado automaticamente. O relatório não contém conversas, memória ou chaves de API. A atualização automática permanece desativada até que um feed oficial de releases seja configurado.


## Yoru Hub (v0.19.0)
A aba Yoru Hub inicia um compartilhamento temporário na rede local. Em outro aparelho conectado à mesma rede, abra um dos endereços exibidos para enviar arquivos ao computador Yoru e baixar arquivos que o usuário escolheu compartilhar pelo Yoru. A sessão usa um token temporário, aceita arquivos de até 100 MB e deve ser encerrada após o uso. Os arquivos são guardados em `YoruHub/Recebidos` na pasta de dados do usuário.

No Windows, o inventário também consulta volumes montados, dispositivos Bluetooth e dispositivos USB presentes. Nesta primeira entrega, Bluetooth e USB são apenas inventariados: pareamento, MTP/ADB, escrita em volumes e controle de periféricos exigem adaptadores e permissões específicos que serão implementados em etapas posteriores. A página de transferência usa HTTP na rede local; não exponha a porta à internet e compartilhe o endereço/token somente com pessoas confiáveis.

### Yoru Hub — agente para outro computador (v0.20.0)
Em outro computador com Node.js instalado, extraia o projeto ou copie `scripts/yoru-hub-agent.js` e execute:

```bash
node scripts/yoru-hub-agent.js "C:\\Users\\SeuUsuario\\YoruCompartilhado"
```

O agente imprime o endereço local e um token aleatório. No Yoru Hub, informe o endereço e o token para conectar. O agente expõe somente a pasta indicada, exige token e deve ser usado apenas em rede privada confiável. Não encaminhe a porta para a internet. Para encerrar, pressione Ctrl+C no computador remoto.


### Yoru Hub — Android por USB (v0.21.0)
O Yoru pode detectar aparelhos Android via ADB e transferir arquivos da área compartilhada (`/sdcard/`). Instale Android SDK Platform-Tools no Windows e adicione `adb` ao PATH. No aparelho, habilite Opções do desenvolvedor > Depuração USB e aceite a chave RSA exibida. No Hub, escolha uma pasta local, detecte o aparelho e informe o caminho completo do arquivo para baixar; para enviar, informe o caminho relativo do arquivo local e a pasta Android de destino. O acesso fica restrito a aparelhos autorizados pelo próprio Android. Não há acesso root nem leitura de áreas privadas de aplicativos.


## v0.22.0 — Espelhamento Android e agente em segundo plano

- Espelhamento de tela Android por scrcpy, após autorização ADB no próprio aparelho. Instale Android SDK Platform-Tools e scrcpy e disponibilize ambos no PATH.
- No Yoru Hub, selecione um aparelho autorizado e use “Abrir tela”; “Fechar tela” encerra a sessão iniciada pelo Yoru.
- O agente Windows pode iniciar automaticamente no logon do usuário via Agendador de Tarefas (não é um serviço Windows nativo): execute `npm run hub-agent:install` no PowerShell. Para remover, execute `npm run hub-agent:remove`.
- O agente escuta na rede local e usa token de acesso; utilize somente em rede privada confiável e nunca publique a porta na internet.


## v0.23.0 — Mega Hub

- Consolida compartilhamento LAN, agente Windows em segundo plano, transferências entre PCs e conexão Android via ADB.
- Adiciona navegação de pastas Android pelo painel, limitada ao armazenamento compartilhado `/sdcard/`, com download direto de arquivos listados.
- O espelhamento de tela continua opcional e depende do `scrcpy` instalado.
- O agente Windows usa o Agendador de Tarefas no logon; não é um serviço Windows nativo.
- Bluetooth e dispositivos USB são inventariados pelo Windows; pareamento/controle universal e MTP/iPhone não são prometidos nesta versão.

### Segurança e limites

Use o compartilhamento somente em rede privada confiável. O modo navegador/agente usa HTTP com token de sessão, não criptografia TLS; não encaminhe portas para a internet. ADB exige autorização explícita no Android.


## Yoru v0.24.0 — gerenciamento de volumes

O Hub agora oferece ação de ejeção segura para volumes montados no Windows, usando o mecanismo de ejeção do Shell do Windows. A ação solicita confirmação e pode falhar se algum aplicativo estiver usando a unidade. Navegação local e remota ganhou atalho para voltar à pasta anterior.

## Yoru Hub v0.25.0 — consolidação e segurança
- Transferências entre PC, agente Windows e Android com limite de 100 MB por arquivo.
- Navegação local rejeita links simbólicos que apontem para fora da pasta selecionada.
- Download do agente valida tamanho declarado e efetivo e registra SHA-256 no resultado.
- O agente Windows permanece baseado em tarefa agendada no logon (não é serviço Windows nativo).
- A página de compartilhamento LAN e o agente usam HTTP com token nesta versão. Utilize somente em rede privada confiável; não faça encaminhamento de porta para a internet.
- Android depende de ADB autorizado; espelhamento depende de scrcpy instalado. iPhone, MTP universal e pareamento Bluetooth ainda não estão implementados.


## Hub para iPhone e iPad (v0.27.0)

O Yoru Hub oferece uma página móvel para Safari. No Windows, abra a aba Yoru Hub, clique em **Iniciar compartilhamento** e abra no Safari do iPhone um dos endereços exibidos. Os dois aparelhos precisam estar na mesma rede local. Na página, é possível enviar arquivos do iPhone/iPad para a pasta `YoruHub/Recebidos` do computador e baixar arquivos que o Yoru publicou para compartilhamento.

No iOS, downloads podem abrir uma prévia; use o menu **Compartilhar** do Safari e escolha **Salvar em Arquivos** (ou a opção de salvar mídia quando disponível). O seletor de arquivos do iOS permite escolher itens de Fotos e do app Arquivos, sujeito às permissões do sistema. O portal limita cada arquivo enviado a 100 MB e não substitui AirDrop/iCloud.

**Limitações importantes do iOS:** o Yoru não recebe acesso irrestrito ao sistema de arquivos, não controla remotamente o iPhone e não oferece gerenciamento USB/MTP universal. A integração é feita pelo Safari e pela rede local, sem instalar aplicativo no iPhone. Use apenas em Wi-Fi privado confiável; o portal atual usa HTTP com token de sessão, portanto não o exponha à internet.


## v0.29.0 — Retomada de transferências no iPhone/iPad

O portal Safari envia arquivos em fila sequencial, em blocos de até 4 MB. O Yoru registra no computador o identificador da sessão e o deslocamento confirmado; o navegador guarda a referência da sessão em `localStorage`. Se a conexão cair ou a página for reaberta, ao selecionar novamente o mesmo arquivo (mesmo nome, tamanho e data de modificação), o portal consulta o deslocamento salvo e continua do próximo bloco. O arquivo só aparece na pasta Recebidos após a finalização.

Há progresso por arquivo e agregado, cancelamento da transferência ativa, limite de 100 MB por arquivo e proteção contra sobrescrita. A retomada depende de manter a sessão no computador e de selecionar novamente o arquivo original; limpar os dados do Safari ou trocar o arquivo pode impedir a associação. Sessões parciais ficam na pasta `YoruHub/UploadSessions`. O portal continua usando HTTP com token na rede local; não exponha à internet e prefira Wi-Fi privado confiável.


## v0.30.0 — Central de Bots e WhatsApp
- Nova aba Bots com visão geral, WhatsApp, construtor de bots e rascunho de automações.
- Integração inicial com WhatsApp Business Cloud API oficial: validação do Phone Number ID e envio de mensagem de texto de teste.
- Credenciais não são persistidas nesta versão; são mantidas apenas nos campos da sessão.
- O envio de texto depende das regras da Meta (janela de atendimento de 24 horas e permissões do número). Mensagens iniciadas fora da janela exigem templates aprovados.
- Webhook de recebimento, respostas automáticas com IA, persistência de bots e execução de regras ainda não estão incluídos.


## v0.31.0 — Central de Bots aprimorada
- Cadastro de bots e regras persistido no armazenamento local do perfil do aplicativo.
- Edição, ativação/pausa, duplicação e exclusão de bots.
- Validação melhorada da conexão WhatsApp, incluindo qualidade e status de verificação quando fornecidos pela Meta.
- Confirmação antes de enviar mensagem real de teste, estado de carregamento e mensagens de erro mais claras.
- Corrigida validação dos identificadores e telefones da integração com a Graph API.
- O token de acesso não é armazenado nesta versão. O envio de texto ainda depende das permissões, janela de atendimento e regras de templates da Meta.
- Webhook de mensagens recebidas, respostas com IA e execução automática das regras permanecem como próximas etapas.


### Validação da versão 0.31.0
- `node --check` aprovado em `src/main.js`, `src/panel-preload.js` e `src/panel-bots.js`.
- `npm test`: 562 testes, 558 aprovados, 0 falhas e 4 ignorados.
- Não houve teste de envio com credenciais reais da Meta nem teste físico do aplicativo no Windows nesta sessão.


## v0.32.0 — Ferramentas da Central de Bots
- Simulador local para testar palavras-chave e respostas cadastradas sem enviar mensagens reais.
- Exportação e importação de bots e regras em arquivo JSON, com validação de formato, limites e confirmação antes de substituir os dados locais.
- Lista de bots integrada ao seletor do simulador.
- Backup portátil para transferir configurações entre instalações.
- O simulador é uma prévia determinística: não chama IA, não recebe mensagens do WhatsApp e não executa automações em produção.


## v0.34.0 — Central dinâmica Bluetooth

- Lista dispositivos Bluetooth reconhecidos pelo Windows e permite abrir uma central individual por dispositivo.
- Identificação visual básica por nome/tipo de dispositivo.
- Acesso direto às configurações Bluetooth do Windows para parear e concluir conexões.
- Controle do volume geral de saída do Windows para fones e caixas de som.
- LED, equalização e controles específicos de fabricante não são simulados: dependem de API/protocolo compatível com o modelo.
- A descoberta exibida é o inventário Bluetooth reportado pelo Windows; não representa varredura universal de todos os dispositivos próximos.


## v0.35.0 — Fluxo de voz Bluetooth

- Conversa contextual para pedidos como “Yoru, mostre o Bluetooth” ou “Yoru, conectar dispositivo”.
- Pergunta de escolha entre Wi-Fi e Bluetooth.
- Consulta o inventário Bluetooth do Windows e anuncia a lista numerada de dispositivos.
- Aceita seleção falada por posição (primeiro, segundo, terceiro etc.) e abre a central do dispositivo escolhido.
- Mantém pareamento/conexão no fluxo nativo do Windows; não simula descoberta BLE universal.


## v0.36.0 — Descoberta Bluetooth LE próxima

- Adicionada busca real de anúncios Bluetooth Low Energy próximos no Windows por meio de `BluetoothLEAdvertisementWatcher`.
- A busca apresenta nome anunciado (quando disponível), endereço BLE, intensidade do sinal (RSSI) e indicação de conectabilidade.
- A central Conectividade agora separa o inventário já reconhecido pelo Windows da busca de dispositivos BLE próximos.
- O fluxo de voz “Wi-Fi ou Bluetooth?” passa a procurar anúncios BLE próximos e permite escolher o dispositivo por posição.
- A central de um dispositivo BLE informa os dados detectados e abre as configurações do Windows para pareamento/conexão.

**Limitações desta versão:** a descoberta BLE não encontra necessariamente dispositivos Bluetooth clássicos que não anunciam BLE. A enumeração de serviços/características GATT e controles de fabricante (LED, equalização, bateria etc.) ainda não foram implementados. A busca requer Windows compatível, Bluetooth ligado e adaptador BLE. Não houve teste físico com periféricos nesta execução.

## v0.37.0 — Inspeção de serviços GATT

- A central de dispositivos BLE agora permite consultar serviços e características GATT usando as APIs Bluetooth LE do Windows.
- Exibe UUID de cada serviço e característica, além das propriedades reportadas: leitura, escrita, notificações e indicações (quando reconhecidas pela API).
- Mostra contagem e status retornados pelo Windows, incluindo falhas de acesso ou conexão.
- A interface não envia comandos de escrita e não altera características do periférico: nesta versão a inspeção é somente de metadados/capacidades.

**Limitações:** alguns dispositivos exigem pareamento, autorização, proximidade ou conexão ativa; alguns não expõem serviços GATT públicos. A consulta depende de Windows, Bluetooth LE e APIs WinRT disponíveis. Não foram realizados testes com hardware Bluetooth físico nesta execução. Os flags GATT indicam propriedades anunciadas pelo dispositivo, não garantem que qualquer operação seja permitida ou segura.


## Bluetooth LE — identificação GATT (0.38.0)
A central BLE identifica nomes conhecidos de serviços e características padrão (por exemplo, Battery Service, Battery Level, Device Information e Manufacturer Name), mantendo os UUIDs originais. A identificação é feita localmente a partir dos metadados GATT. Não há leitura de valores, escrita ou controle genérico de LED/volume: esses comandos variam por fabricante e exigem protocolo específico validado.


## v0.39.0 — Conector iPhone aprimorado

- Página móvel do Yoru Hub reorganizada para Safari/iPhone, com seletores separados para fotos/vídeos e documentos.
- Progresso global e por arquivo, cancelamento visível e estados vazios nas listas.
- Removida seção duplicada que reutilizava IDs HTML e fazia as listas atualizarem no elemento errado.
- Cabeçalhos `no-store`, `nosniff` e `no-referrer` aplicados às respostas do portal local.
- Mantidos o envio em blocos retomável, token de sessão e limites existentes.
- Limitação: continua sendo transferência via navegador na mesma rede Wi-Fi; não é integração USB, AirDrop, espelhamento ou controle remoto do iPhone.


## v0.41.0 — Organização da Central de Bots
A aba Bots foi reorganizada com painel de indicadores, atalhos, construtor/lista lado a lado, busca, filtro por status e seções mais claras para WhatsApp, simulador, automações e backup. Os dados locais existentes continuam usando as mesmas chaves de armazenamento.


## v0.42.0 — Yoru Chibi
O avatar 2D agora ocupa melhor a tela e tem um controle próprio de tamanho em Avatar > Ajustes > Yoru Chibi · 2D. O ajuste é independente da escala do modelo 3D e preserva a proporção das 50 reações.


### Masori-Sama 0.51.0
Especialistas agora permitem configurar provedor/modelo individual, possuem memória persistente baseada nos próprios relatórios e mantêm histórico local das últimas 30 tarefas. Uma repetição é feita após falha de chamada. Os agentes ainda não executam ferramentas externas próprias.

## Visão computacional (v0.53.0)
Na aba **Masori-Sama**, a seção **Visão computacional · Masori-Vision** lista janelas e telas disponíveis. A listagem não gera thumbnails. Após escolher uma fonte, clique em **Capturar selecionada** para criar uma prévia local; a imagem só é enviada ao provedor configurado quando você confirmar em **Enviar captura para análise**.

A análise pode identificar a janela/aplicativo, descrever elementos visíveis, transcrever erros legíveis e explicar hipóteses e passos seguros. O recurso requer um modelo com suporte a imagens (visão). A imagem fica somente em memória, é de uso único, expira em até 3 minutos e não é salva no histórico nem no disco. Não há monitoramento contínuo da tela. Oculte senhas, dados pessoais e informações confidenciais antes de enviar.


### Empacotamento Windows v0.58.1
Os instaladores NSIS e portáteis incluem também a pasta `scripts/`, necessária para os recursos de Bluetooth, BLE e agente local.
