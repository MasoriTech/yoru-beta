'use strict';

const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9%\s]/g, ' ').replace(/\s+/g, ' ').trim();
const numberWords = Object.freeze({
  zero:0, um:1, uma:1, dois:2, duas:2, tres:3, quatro:4, cinco:5, seis:6,
  sete:7, oito:8, nove:9, dez:10, quinze:15, vinte:20, trinta:30, quarenta:40,
  cinquenta:50, sessenta:60, setenta:70, oitenta:80, noventa:90, cem:100,
  meia:30, meio:30
});
const TAPO_HELP = 'Sobre a lâmpada Tapo eu sei: ligar e desligar, como “acenda a lâmpada”, “apague a lâmpada”, “desligue a lâmpada”, “apaga a luz” e “desliga a luz”; ativar o modo festa e o modo relax, e sair deles com “sai do modo festa”; ajustar o brilho, como “brilho 40%”; mudar a cor, como “luz azul” ou “cor aleatória”; trocar a temperatura entre 2500 e 6500 Kelvin, como “luz quente” ou “luz fria”; ativar cenas como leitura, foco, cinema e noite; usar presets de 1 a 7; programar o desligamento, como “apaga a luz em 10 minutos”; e dizer como ela está agora. Se você disser “estou com sono” ou “vou dormir”, eu apago a luz.';
const COLOR_HUES = Object.freeze({
  vermelho:0, vermelha:0, encarnado:0, encarnada:0,
  laranja:28, coral:12, salmao:12, pessego:25,
  amarelo:58, amarela:58, dourado:46, dourada:46, bege:38, caramelo:30,
  verde:120, lima:90, menta:150, esmeralda:140, oliva:80,
  ciano:180, aqua:180, turquesa:175, teal:175, azul:220, azulmarinho:235, 'azul marinho':235, anil:245, indigo:245,
  violeta:270, roxo:275, roxa:275, lilas:280, lavanda:275,
  magenta:300, fucsia:315, pink:325, rosa:330, 'rosa claro':340, marrom:25,
  prata:210, gelo:195
});
const SCENES = Object.freeze({
  relax:'relax', relaxar:'relax', descanso:'relax', leitura:'reading', ler:'reading',
  foco:'focus', trabalho:'focus', estudar:'focus', estudo:'focus',
  noite:'night', dormir:'night', sono:'night',
  quente:'warm', aconchegante:'warm',
  dia:'daylight', diurna:'daylight', daylight:'daylight',
  cinema:'movie', filme:'movie', filmezinho:'movie',
  romantico:'romantic', romantica:'romantic', jantar:'romantic',
  festa:'party', balada:'party', gamer:'gaming', jogo:'gaming', jogar:'gaming',
  manha:'morning', amanhecer:'morning', nascer:'morning'
});

function parseNumber(token) {
  if (token == null) return null;
  const clean = String(token).trim().toLowerCase().replace(',', '.');
  if (/^\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  return Object.prototype.hasOwnProperty.call(numberWords, clean) ? numberWords[clean] : null;
}
function durationFrom(text) {
  if (/\b(?:em|daqui a|depois de)\s+meia hora\b/.test(text)) return 30 * 60000;
  const m = text.match(/\b(?:em|daqui a|depois de)\s+(uma|um|\d+|[a-z]+)\s*(segundos?|minutos?|min|horas?|h)\b/);
  if (!m) return null;
  const amount = parseNumber(m[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = m[2];
  const multiplier = /^s/.test(unit) ? 1000 : /^(?:h|hora)/.test(unit) ? 3600000 : 60000;
  return Math.round(amount * multiplier);
}
function percentage(text) {
  const withoutSaturation = text.replace(/\bsaturacao\s+(?:para|em|de)?\s*\d{1,3}\s*(?:%|por cento)?/g, '');
  let m = withoutSaturation.match(/\b(\d{1,3})\s*(?:%|por cento)(?:\b|$)/);
  if (!m) m = withoutSaturation.match(/\b(?:brilho|intensidade|luminosidade)\s+(?:para|em|no|de)?\s*(\d{1,3})\b/);
  if (!m && /\b(brilho maximo|brilho no maximo|intensidade maxima)\b/.test(text)) return 100;
  if (!m && /\b(brilho minimo|brilho no minimo|intensidade minima)\b/.test(text)) return 1;
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : null;
}
function saturationValue(text) {
  const explicit = text.match(/\bsaturacao\s+(?:para|em|de)?\s*(\d{1,3})\s*(?:%|por cento)?/);
  if (explicit) {
    const n = Number(explicit[1]);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  }
  if (/\b(pastel|suave|suavizada|desbotada)\b/.test(text)) return 35;
  if (/\b(neon|viva|vivo|vibrante|super saturada)\b/.test(text)) return 100;
  if (/\b(clara|claro)\b/.test(text)) return 70;
  return 100;
}

function parseTapoVoiceCommand(input, { random = Math.random } = {}) {
  const text = normalize(input);
  if (!text) return null;
  const pick = (list) => list[Math.min(list.length - 1, Math.floor((Number(random()) || 0) * list.length))];
  const lampWord = /\b(luz|lampada|tapo|iluminacao)\b/.test(text);

  // "Me ensina sobre a lâmpada" / "o que você sabe fazer com a lâmpada": só aí a Yoru lista o que sabe fazer.
  const asksHelp = (/\b(ensina|ensine|ensinar|explica|explique|explicar|aprender|como (?:funciona|usar|uso|controlar|controlo|mexer))\b/.test(text) && lampWord)
    || /\bo que (?:voce )?(?:sabe|pode|consegue|faz|da pra)(?: fazer)?\b.*\b(?:luz|lampada|tapo|iluminacao)\b/.test(text)
    || (lampWord && /\b(comandos|ajuda)\b/.test(text))
    || /\bquais (?:sao )?(?:os |as )?(?:comandos|funcoes|coisas)\b.*\b(?:luz|lampada|tapo|iluminacao)\b/.test(text);
  if (asksHelp) return { type:'help', say:TAPO_HELP };

  // "Estou com sono" / "vou dormir": apaga a luz sem precisar dizer "luz". Não vale para perguntas, negações,
  // pedidos com tempo ("daqui a 10 minutos") nem quando a pessoa pede para acender.
  const sleepy = /\b(?:estou|to|tou)\s+(?:muito\s+|bem\s+|ja\s+|morrendo de\s+|caindo de\s+)?(?:com\s+)?sono\b|^(?:muito\s+)?(?:com\s+)?sono$/.test(text)
    || /\b(?:vou|vamos|ja vou|to indo|estou indo)\s+(?:me\s+)?(?:dormir|deitar|ir dormir|ir deitar|pra cama|para cama|para a cama|descansar)\b/.test(text)
    || /\bhora de dormir\b/.test(text);
  if (sleepy && !/\?\s*$/.test(String(input || '').trim()) && !/\b(nao|nunca)\b/.test(text) && !durationFrom(text)
      && !/\b(ligar|ligue|liga|acender|acenda|acende)\b/.test(text) && !/\b(modo|cena)\b/.test(text)) {
    const say = /\bsono\b/.test(text)
      ? pick(['Então vai descansar! Apaguei a luz.', 'Apaguei a luz. Descansa, que o sono já chegou.', 'Luz apagada. Vai dormir, eu fico por aqui.'])
      : pick(['Boa noite! Apaguei a luz. Durma bem.', 'Apaguei a luz. Bons sonhos!', 'Luz apagada. Boa noite, descansa bem!']);
    return { type:'actions', soft:true, actions:[{ action:'off', args:{} }], say };
  }

  const hasDevice = /\b(luz|lampada|tapo|iluminacao|iluminar|luminaria|cor|cores|brilho|intensidade|luminosidade|temperatura|kelvin|branco|branca|fria|frio|quente|neutra|neutro|amarela|amarelada|aleatoria|surpresa|temporizador|timer|preset|predefinicao|efeito|animacao|tema|fade|transicao|gradualmente|suavemente|white|ausente|viagem|agenda|agendamento|programacao|horario|consumo|energia|kwh|superaquecimento|superaquecendo|sinal)\b/.test(text);
  const sceneMention = /\b(modo|cena)\b/.test(text) && text.split(' ').some(word => SCENES[word]);
  const randomMention = /\b(cor|cores)\s+(?:aleatoria|aleatorias|surpresa|random)\b|\b(?:aleatoria|surpresa)\s+(?:na\s+)?cor\b|\bmuda(?:r)?\s+(?:a\s+)?cor\b/.test(text);
  const relative = /\b(mais clara|mais forte|mais brilhante|aumenta(?:r)? o brilho|mais fraca|mais escura|menos brilho|diminui(?:r)? o brilho|mais quente|mais amarela|mais fria|mais branca|mais azulada)\b/.test(text);
  const colorMention = Object.keys(COLOR_HUES).some(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`).test(text));
  if (!hasDevice && !relative && !sceneMention && !randomMention && !colorMention) return null;

  if (/\b(como esta|qual o estado|status|situacao|qual a cor|qual o brilho|quanto de brilho|qual temperatura|superaquecendo|superaquecimento|sinal)\b/.test(text) && /\b(luz|lampada|tapo)\b/.test(text)) {
    return { type:'query', say:'Vou consultar o estado atual da lâmpada.' };
  }

  if (/\b(auto white|branco automatico|luz automatica|temperatura automatica|siga a luz natural)\b/.test(text)) {
    const mode = /\b(compense|compensar|compensacao|compensate)\b/.test(text) ? 'compensate' : 'match';
    return { type:'actions', actions:[{ action:'auto-white', args:{ mode } }], say:mode === 'match' ? 'Solicitei o modo branco automático para acompanhar a luz natural.' : 'Solicitei o branco automático para compensar a iluminação ambiente.' };
  }
  if (/\b(consumo|energia|kwh|tempo ligada|horas ligada)\b/.test(text) && /\b(luz|lampada|tapo)\b/.test(text)) {
    return { type:'unsupported', say:'O aplicativo Tapo mostra tempo de uso e consumo de energia da L530E, mas a versão atual da API local usada pelo Yoru não expõe esses dados para consulta. Veja essa medição na tela da lâmpada no aplicativo Tapo.' };
  }
  if (/\b(modo ausente|away mode|modo viagem|simule presenca|simular presenca)\b/.test(text)) {
    return { type:'unsupported', say:'O Modo Ausente existe na L530E, mas a API local do Yoru não oferece esse ajuste com segurança. Configure o período pelo aplicativo Tapo; não vou afirmar que ativei algo que a lâmpada não confirmou.' };
  }
  if (/\b(agende|agenda|agendamento|programe|programacao|programar|nascer do sol|por do sol)\b/.test(text) && /\b(luz|lampada|tapo)\b/.test(text)) {
    return { type:'unsupported', say:'A L530E aceita agendas, inclusive horários de nascer e pôr do sol, pelo aplicativo Tapo. A integração local do Yoru ainda não grava agendas recorrentes na lâmpada. Posso executar temporizadores pontuais enquanto o Yoru estiver aberto.' };
  }

  // "sai do modo festa", "desativa o modo relax", "desliga o modo festa": para o efeito (não ativa de novo)
  const leaves = text.match(/\b(?:desativ\w*|desliga\w*|apag\w*|tir[ae]|sai|saia|sair|cancel\w*|pare|parar|encerr\w*)\s+(?:d?[oa]\s+)?(?:modo|cena|efeito)\s+(?:de\s+)?(festa|party|relax\w*)\b/);
  if (leaves) {
    const nome = /^(festa|party)/.test(leaves[1]) ? 'festa' : 'relax';
    return { type:'actions', actions:[{ action:'effect', args:{ effect:'Off' } }], say:`Saí do modo ${nome}.` };
  }

  const presetMatch = text.match(/\b(?:preset|predefinicao|predefinido)\s*(?:numero\s*)?([1-7])\b/);
  if (presetMatch) {
    const preset = Number(presetMatch[1]);
    return { type:'actions', actions:[{ action:'preset', args:{ preset } }], say:`Ativei o preset ${preset} da lâmpada.` };
  }

  if (/\b(desative|desativar|desligue|desligar|pare|parar)\s+(?:o\s+)?(?:efeito|animacao|tema)\b|\b(efeito|animacao)\s+(?:off|desligado|nenhum)\b/.test(text)) {
    return { type:'actions', actions:[{ action:'effect', args:{ effect:'Off' } }], say:'Desativei o efeito de iluminação.' };
  }
  const effectMatch = text.match(/\b(?:efeito|animacao|tema)\s+(party|festa|relax|relaxamento|arco iris|ciclo de cores)\b/);
  if (effectMatch) {
    const effect = /party|festa|arco iris|ciclo de cores/.test(effectMatch[1]) ? 'Party' : 'Relax';
    const bright = percentage(text);
    return { type:'actions', actions:[{ action:'effect', args:{ effect, ...(bright ? { brightness:bright } : {}) } }], say:`Ativei o efeito ${effect === 'Party' ? 'Festa' : 'Relax'}${bright ? ` com ${bright}% de brilho` : ''}.` };
  }

  const transitionMatch = text.match(/\b(?:transicao|fade|gradualmente|suavemente|devagar|lentamente)\b.*?\b(\d+)\s*(?:segundos?|s)\b|\b(\d+)\s*(?:segundos?|s)\b.*?\b(?:transicao|fade|gradualmente|suavemente|devagar|lentamente)\b/);
  if (transitionMatch || /\b(gradualmente|suavemente|transicao suave|fade)\b/.test(text)) {
    const amount = Number(transitionMatch?.[1] || transitionMatch?.[2] || 3);
    const seconds = Math.max(0, Math.min(60, Number.isFinite(amount) ? amount : 3));
    const target = /\b(desligue|desligar|desliga|apagar|apague|apaga|apagamento|off)\b/.test(text) ? 'off' : 'on';
    return { type:'actions', actions:[{ action:target === 'off' ? 'transition-off' : 'transition-on', args:{ seconds } }], say:`Configurei a transição suave ao ${target === 'off' ? 'desligar' : 'ligar'} em ${seconds} segundo(s).` };
  }

  if (/\b(cancelar|cancela|cancele|pare|parar|anular)\b/.test(text) && /\b(timer|temporizador|agendamento|desligamento|luz|lampada)\b/.test(text)) {
    return { type:'cancel-timer', say:'Cancelei o temporizador da lâmpada.' };
  }

  const delayMs = durationFrom(text);
  if (delayMs && /\b(ligar|ligue|liga|acender|acenda|acende|desligar|desligue|desliga|apagar|apague|apaga)\b/.test(text)) {
    const target = /\b(desligar|desligue|desliga|apagar|apague|apaga)\b/.test(text) ? 'off' : 'on';
    if (delayMs > 24 * 3600000) return { type:'error', say:'Por segurança, aceito temporizadores de até 24 horas.' };
    return { type:'timer', target, delayMs, say:`Programei para ${target === 'off' ? 'desligar' : 'ligar'} a lâmpada ${delayMs < 60000 ? 'em alguns segundos' : `daqui a ${Math.round(delayMs / 60000)} minuto(s)`}.` };
  }

  const sceneToken = text.split(' ').find(word => SCENES[word]);
  if (sceneToken && (hasDevice || /\b(modo|cena)\b/.test(text))) {
    const scene = SCENES[sceneToken];
    const labels = { relax:'relaxamento', focus:'foco', night:'noite', warm:'luz quente', daylight:'luz do dia', reading:'leitura', movie:'cinema', romantic:'romântico', party:'festa', gaming:'gamer', morning:'manhã' };
    const saysMode = scene === 'party' ? 'modo festa' : scene === 'relax' ? 'modo relax' : null;
    return { type:'actions', actions:[{ action:'scene', args:{ scene } }], say:saysMode ? `Ativei o ${saysMode}.` : `Ativei a cena ${labels[scene] || scene}.` };
  }

  if (/\b(cor|cores)\s+(?:aleatoria|aleatorias|surpresa|random)\b|\b(?:aleatoria|surpresa)\s+(?:na\s+)?cor\b|\bmuda(?:r)?\s+(?:a\s+)?cor\b/.test(text)) {
    const hue = Math.max(0, Math.min(359, Math.floor((Number(random()) || 0) * 360)));
    const bright = percentage(text);
    const actions = [{ action:'color', args:{ hue, saturation:100, brightness:bright || null } }];
    return { type:'actions', actions, say:'Escolhi uma cor surpresa para a lâmpada.' };
  }

  const tempMatch = text.match(/\b(?:temperatura|correlacao|kelvin|em)\s*(?:de|para|em)?\s*(2[5-9]\d{2}|[3-5]\d{3}|6[0-5]\d{2})\s*(?:k|kelvin|kelvins)?\b|\b(2[5-9]\d{2}|[3-5]\d{3}|6[0-5]\d{2})\s*(?:k|kelvin|kelvins)\b/);
  let colorTemp = tempMatch ? Number(tempMatch[1] || tempMatch[2]) : null;
  if (colorTemp != null) colorTemp = Math.max(2500, Math.min(6500, colorTemp));
  else if (/\b(branca fria|branco frio|luz fria|branca gelo|branco gelo|mais fria|mais azulada|fria)\b/.test(text)) colorTemp = 6500;
  else if (/\b(branca neutra|branco neutro|neutra|neutro|branco natural|branca natural|luz natural)\b/.test(text)) colorTemp = 4000;
  else if (/\b(branca quente|branco quente|amarela|amarelada|amarelado|luz quente|mais quente|mais amarela|quente|ambar)\b/.test(text)) colorTemp = 2700;
  else if (/\b(branca|branco|luz branca)\b/.test(text)) colorTemp = 4000;

  const bright = percentage(text);
  const colorWord = Object.keys(COLOR_HUES).sort((a, b) => b.length - a.length).find(name => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text));
  const explicitYellowColor = /\bcor(?:es)?\s+amarela\b/.test(text);
  const actions = [];
  const wantsOff = /\b(desligar|desligue|desliga|apagar|apague|apaga|apaga a luz|apaga a lampada)\b/.test(text);
  const wantsOn = /\b(ligar|ligue|liga|acender|acenda|acende|acenda a luz|acenda a lampada)\b/.test(text);
  if (wantsOff) {
    return { type:'actions', actions:[{ action:'off', args:{} }], say:'Apaguei a lâmpada.' };
  }
  if (wantsOn) actions.push({ action:'on', args:{} });

  if (colorWord && (colorTemp == null || explicitYellowColor)) {
    const hue = COLOR_HUES[colorWord];
    const saturation = saturationValue(text);
    const colorBrightness = bright || (/\b(escura|escuro)\b/.test(text) ? 35 : null);
    actions.push({ action:'color', args:{ hue, saturation, brightness:colorBrightness } });
    return { type:'actions', actions, say:`Deixei a lâmpada na cor ${colorWord}${colorBrightness ? ` com ${colorBrightness}% de brilho` : ''}${saturation < 100 ? ` e saturação de ${saturation}%` : ''}.` };
  }
  if (colorTemp != null) actions.push({ action:'temperature', args:{ colorTemp } });
  if (bright != null) actions.push({ action:'brightness', args:{ brightness:bright } });

  let brightnessStep = 0;
  if (bright == null && /\b(mais clara|mais forte|mais brilhante|aumenta(?:r)? o brilho)\b/.test(text)) brightnessStep = 15;
  if (bright == null && /\b(mais fraca|mais escura|menos brilho|diminui(?:r)? o brilho)\b/.test(text)) brightnessStep = -15;
  if (brightnessStep) actions.push({ action:'brightness-step', args:{ step:brightnessStep } });

  if (/\b(mais quente|mais amarela)\b/.test(text) && colorTemp == null) actions.push({ action:'temperature', args:{ colorTemp:2700 } });
  if (/\b(mais fria|mais branca|mais azulada)\b/.test(text) && colorTemp == null) actions.push({ action:'temperature', args:{ colorTemp:6500 } });

  if (actions.length) {
    const say = actions.some(x => x.action === 'brightness') ? `Ajustei a lâmpada para ${bright}% de brilho.`
      : actions.some(x => x.action === 'temperature') ? `Ajustei a luz para ${colorTemp} Kelvin.`
      : brightnessStep > 0 ? 'Aumentei o brilho da lâmpada.'
      : brightnessStep < 0 ? 'Reduzi o brilho da lâmpada.' : 'Lâmpada ligada.';
    return { type:'actions', actions, say };
  }

  return null;
}

module.exports = { parseTapoVoiceCommand, normalizeTapoVoice: normalize, COLOR_HUES, SCENES };
