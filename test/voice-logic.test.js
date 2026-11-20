'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/voice-logic');
const YT = require('../src/youtube');

const at = (h, m = 0) => new Date(2026, 10, 1, h, m);
const rndLow = () => 0; // sempre a primeira opção
const intent = (s) => V.parseIntent(s);

test('saudações: reconhece bom dia / boa tarde / boa noite / oi', () => {
  assert.deepEqual(intent('Bom dia'), { type: 'greet', kind: 'dia', howru: false });
  assert.deepEqual(intent('boa tarde!'), { type: 'greet', kind: 'tarde', howru: false });
  assert.deepEqual(intent('Boa noite, Yoru'.replace(', Yoru', '')), { type: 'greet', kind: 'noite', howru: false });
  assert.equal(intent('bom dia, tudo bem?').howru, true);
  assert.deepEqual(intent('oi'), { type: 'greet', kind: 'hello', howru: false });
});

test('saudação certa para o horário: responde normal', () => {
  for (const [kind, h] of [['dia', 9], ['tarde', 15], ['noite', 20]]) {
    const r = V.greetReply(kind, at(h), rndLow);
    assert.equal(r.ok, true, `${kind} às ${h}`);
    assert.match(r.text, new RegExp('^' + { dia: 'Bom dia', tarde: 'Boa tarde', noite: 'Boa noite' }[kind]));
  }
});

test('saudação errada para o horário: ela corrige com sarcasmo', () => {
  const casos = [
    ['dia', at(15, 7), /boa tarde/i], ['dia', at(21), /boa noite/i], ['dia', at(3), /madrugada/i],
    ['tarde', at(9), /bom dia/i], ['tarde', at(20), /boa noite/i], ['tarde', at(2), /madrugada/i],
    ['noite', at(9), /bom dia/i], ['noite', at(15), /boa tarde/i],
  ];
  for (const [kind, d, re] of casos) {
    for (const rnd of [() => 0, () => 0.5, () => 0.99]) {
      const r = V.greetReply(kind, d, rnd);
      assert.equal(r.ok, false, `${kind} às ${d.getHours()}h deveria ser corrigido`);
      assert.match(r.text, re, `${kind} às ${d.getHours()}h: ${r.text}`);
      assert.doesNotMatch(r.text, /\{[cC]\}/, 'sem marcador sobrando');
    }
  }
  // cita o relógio de verdade
  assert.match(V.greetReply('dia', at(15, 7), rndLow).text, /15 horas e 7 minutos/);
});

test('"boa noite" na madrugada não é erro grave, mas ela comenta', () => {
  const r = V.greetReply('noite', at(2), rndLow);
  assert.equal(r.ok, false);
  assert.match(r.text, /madrugada/);
});

test('saudação + pedido: abre o pedido com a saudação curta', () => {
  const i = intent('bom dia abre o youtube');
  assert.equal(i.type, 'open');
  assert.equal(i.key, 'youtube');
  assert.equal(i.lead, 'dia');
  assert.equal(V.greetShort('dia', at(9)), 'Bom dia!');
  assert.match(V.greetShort('dia', at(15)), /Bom dia\? O certo agora é boa tarde/);
  // frase longa vai inteira para a IA
  assert.equal(intent('bom dia, me explica como funciona a fotossíntese').type, 'chat');
});

test('abrir: várias formas de pedir', () => {
  for (const f of ['abra o youtube', 'abre o youtube', 'abrir youtube', 'me mostre o youtube', 'me mostra o youtube', 'quero ver o youtube',
    'quero abrir o youtube', 'vai no youtube', 'coloca o youtube', 'preciso do youtube', 'youtube', 'o youtube por favor', 'acesse o youtube']) {
    const i = intent(f);
    assert.equal(i.type, 'open', f);
    assert.equal(i.key, 'youtube', f);
  }
});

test('abrir: frases comuns não viram "abrir"', () => {
  assert.equal(intent('mostre como fazer bolo').type, 'chat');
  assert.equal(intent('o google caiu?').type, 'chat');
  assert.equal(intent('quero ver meu irmão').type, 'chat');
});

test('abrir: sites específicos vencem o "google" genérico', () => {
  assert.equal(intent('abra o google agenda').key, 'agenda');
  assert.equal(intent('abra o google drive').key, 'drive');
  assert.equal(intent('abra o google').key, 'google');
  assert.equal(intent('abre o paint').app, 'paint');
});

test('música: pergunta "qual?" quando não diz qual', () => {
  for (const f of ['quero escutar uma música', 'quero ouvir música', 'toca uma música', 'coloca uma música', 'bota uma musica pra mim', 'quero ouvir uma musica']) {
    const i = intent(f);
    assert.equal(i.type, 'play', f);
    assert.equal(i.media, 'music', f);
    assert.equal(i.query, null, f);
    assert.equal(i.random, false, f);
  }
});

test('música: já vai direto quando diz qual (com acentos preservados)', () => {
  assert.equal(intent('toca Evidências').query, 'Evidências');
  assert.equal(intent('quero ouvir Legião Urbana').query, 'Legião Urbana');
  assert.equal(intent('toca música do Djavan').query, 'Djavan');
  assert.equal(intent('coloca a música Garota de Ipanema').query, 'Garota de Ipanema');
  assert.equal(intent('quero ouvir Evidências no Spotify').where, 'spotify');
});

test('música: "qualquer uma" sorteia', () => {
  const i = intent('coloca uma música qualquer');
  assert.equal(i.random, true);
  assert.equal(i.query, null);
});

test('vídeo: "quero ver um vídeo de gatos"', () => {
  const i = intent('quero ver um vídeo de gatos');
  assert.equal(i.type, 'play');
  assert.equal(i.media, 'video');
  assert.equal(i.query, 'gatos');
});

test('música: frases parecidas que NÃO são pedido de música', () => {
  assert.equal(intent('não consigo ouvir nada').type, 'chat');
  assert.equal(intent('toque de recolher').type, 'chat');
  assert.equal(intent('pesquise como ouvir música').type, 'search');
});

test('resposta à pergunta "qual música?"', () => {
  assert.equal(V.mediaAnswer('Legião Urbana').query, 'Legião Urbana');
  assert.equal(V.mediaAnswer('toca Evidências').query, 'Evidências');
  assert.equal(V.mediaAnswer('quero ouvir Djavan').query, 'Djavan');
  assert.equal(V.mediaAnswer('qualquer uma').random, true);
  assert.equal(V.mediaAnswer('tanto faz').random, true);
  assert.equal(V.mediaAnswer('pode ser Djavan no Spotify').where, 'spotify');
});

test('contas por voz', () => {
  const v = (s) => V.mathIntent(s) && V.mathIntent(s).value;
  assert.equal(v('quanto é 2 mais 2'), 4);
  assert.equal(v('quanto é dois mais dois'), 4);
  assert.equal(v('quanto é vinte e cinco mais trinta'), 55);
  assert.equal(v('quanto é 10 dividido por 4'), 2.5);
  assert.equal(v('5 vezes 6'), 30);
  assert.equal(v('3 x 4'), 12);
  assert.equal(v('2 + 3 * 4'), 14); // precedência
  assert.equal(v('quanto é 20% de 150'), 30);
  assert.equal(v('quanto é 20 por cento de 150'), 30);
  assert.equal(v('raiz quadrada de 81'), 9);
  assert.equal(v('7 ao quadrado'), 49);
  assert.equal(v('quanto é 2 elevado a 10'), 1024);
  assert.equal(V.mathIntent('quanto é 1 dividido por 0').error, 'div0');
  assert.equal(V.mathIntent('quanto é 3,5 mais 1,5').text, '5');
  // não pode pegar conversa comum
  assert.equal(V.mathIntent('eu tenho 2 filhos e 3 gatos'), null);
  assert.equal(V.mathIntent('amanhã às 15 horas'), null);
});

test('timer: duração falada', () => {
  assert.equal(V.durationMs('5 minutos'), 300000);
  assert.equal(V.durationMs('meia hora'), 1800000);
  assert.equal(V.durationMs('uma hora e meia'), 5400000);
  assert.equal(V.durationMs('2 minutos e 30 segundos'), 150000);
  assert.equal(V.durationMs('10', true), 600000);
  assert.equal(V.durationMs('10'), null);
  assert.equal(V.durationText(150000), '2 minutos e 30 segundos');
  assert.equal(intent('coloca um timer de 5 minutos').ms, 300000);
  assert.equal(intent('coloque um timer').ms, null);
  assert.equal(intent('alarme daqui a 10 minutos').type, 'timer');
});

test('"me lembre daqui a 20 minutos" continua sendo agenda, não timer', () => {
  assert.equal(intent('me lembre de ligar daqui a 20 minutos').type, 'agenda-add');
});

test('sorteio de número', () => {
  assert.deepEqual(intent('sorteie um número de 1 a 10'), { type: 'number', min: 1, max: 10 });
  assert.deepEqual(intent('sorteie um número entre cinco e vinte'), { type: 'number', min: 5, max: 20 });
});

test('conversa leve sem IA', () => {
  assert.equal(intent('tudo bem?').type, 'howru');
  assert.equal(intent('obrigado').type, 'thanks');
  assert.equal(intent('valeu').type, 'thanks');
  assert.equal(intent('quem é você').type, 'who');
  assert.equal(intent('o que você sabe fazer').type, 'help');
  assert.equal(intent('conte uma piada').type, 'joke');
  assert.equal(intent('cara ou coroa').type, 'coin');
  assert.equal(intent('joga uma moeda').type, 'coin');
});

test('pedidos antigos continuam funcionando', () => {
  assert.equal(intent('que horas são').type, 'time');
  assert.equal(intent('que dia é hoje').type, 'date');
  assert.equal(intent('role os dados').type, 'dice');
  assert.equal(intent('me conte as notícias').type, 'news');
  assert.equal(intent('pesquise receita de bolo no youtube').where, 'youtube');
  assert.equal(intent('como está o clima').type, 'weather');
  assert.equal(intent('o que tem na agenda hoje').type, 'agenda-list');
  assert.equal(intent('tchau').type, 'bye');
  assert.equal(intent('para').type, 'stop');
  assert.equal(intent('qual é a capital da França').type, 'chat');
  assert.equal(intent('tempo perdido').type, 'chat');
});

test('youtube: acha o primeiro vídeo e ignora anúncios', () => {
  const html = '<script>var ytInitialData = {"contents":{"adSlotRenderer":{"videoId":"AAAAAAAAAAA"},' +
    '"videoRenderer":{"videoId":"dQw4w9WgXcQ","thumbnail":{},"title":{"runs":[{"text":"Evidências \\u2013 Chitãozinho"}],"accessibility":{}}},' +
    '"videoRenderer":{"videoId":"BBBBBBBBBBB","title":{"runs":[{"text":"outro"}]}}}</script>';
  const v = YT.parseFirstVideo(html);
  assert.equal(v.id, 'dQw4w9WgXcQ');
  assert.equal(v.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(v.title, 'Evidências – Chitãozinho');
  assert.equal(YT.parseFirstVideo('<html>nada</html>'), null);
  assert.equal(YT.searchUrl('legião urbana'), 'https://www.youtube.com/results?search_query=legi%C3%A3o%20urbana');
});

// ---------- reconhecimento do nome (v0.9.5) ----------
test('findWake: entende grafias parecidas, palavra dividida e "oi" colado', () => {
  const V2 = require('../src/voice-logic');
  const ok = (txt, rest) => {
    const r = V2.findWake(txt, 'Yoru', '');
    assert.equal(r.called, true, txt);
    assert.equal(r.rest, rest, txt);
  };
  ok('Yoru, que horas são?', 'que horas são');
  ok('Ioru que horas são', 'que horas são');
  ok('Joru abre o youtube', 'abre o youtube');
  ok('Jorou tchau', 'tchau');
  ok('Yoro abre o gmail', 'abre o gmail');
  ok('Oru, que horas são', 'que horas são');   // primeira letra engolida
  ok('Yo ru, que dia é hoje', 'que dia é hoje'); // dividida em duas
  ok('oiyoru bom dia', 'bom dia');             // "oi" colado
  ok('Que horas são, Yoru?', 'Que horas são'); // nome no fim
});

test('findWake: não confunde com outras palavras', () => {
  for (const txt of ['Jorge abre o gmail', 'Yolanda que horas são', 'Uma coisa qualquer aqui', 'que horas são']) {
    assert.equal(V.findWake(txt, 'Yoru', '').called, false, txt);
  }
});

test('isNoise: alucinações comuns do Whisper em silêncio', () => {
  for (const x of ['Legendas pela comunidade Amara.org', 'Deixe seu like e se inscreva no canal', 'Thanks for watching', '...', 'hmmm', '[Música]']) {
    assert.equal(V.isNoise(x), true, x);
  }
  for (const x of ['que horas são', 'tchau tchau', 'obrigado']) assert.equal(V.isNoise(x), false, x);
});

test('danças e poses por voz', () => {
  assert.deepEqual(intent('dança samba'), { type: 'pose', dance: 'samba' });
  assert.deepEqual(intent('dança pra mim'), { type: 'pose', dance: null });
  assert.deepEqual(intent('senta na cadeira'), { type: 'pose', emote: 'chair' });
  assert.deepEqual(intent('senta no chão'), { type: 'pose', emote: 'sit' });
  assert.deepEqual(intent('levanta'), { type: 'pose', emote: 'stand' });
  assert.deepEqual(intent('para de dançar'), { type: 'pose', emote: 'stand' });
  assert.deepEqual(intent('bate palmas'), { type: 'pose', emote: 'clap' });
  assert.notEqual(intent('que horas são').type, 'pose');
  const l = V.poseLine({ type: 'pose', dance: null }, rndLow);
  assert.equal(l.emote, 'dance');
  assert.equal(V.poseLine({ type: 'pose', dance: 'robot' }, rndLow).emote, 'robot');
});

test('"aula de dança" não vira pedido para dançar', () => {
  assert.notEqual(intent('tenho aula de dança hoje').type, 'pose');
  assert.equal(intent('dança pra mim').type, 'pose');
});

test('saudação de abertura: horário, nome e chefe/chefa', () => {
  assert.equal(V.startupGreeting(null, at(8), rndLow).text, 'Bom dia!');
  assert.equal(V.startupGreeting({}, at(15), rndLow).text, 'Boa tarde!');
  assert.equal(V.startupGreeting({}, at(2), rndLow).text, 'Boa noite!');
  assert.equal(V.startupGreeting({ name: 'Ana', gender: 'f' }, at(8), rndLow).text, 'Bom dia! E aí, chefa Ana! O que vamos fazer hoje?');
  assert.match(V.startupGreeting({ name: 'João', nickname: 'Jão', gender: 'm' }, at(20), rndLow).text, /^Boa noite! E aí, chefe Jão!/);
  assert.equal(V.startupGreeting({ name: 'Sol', gender: 'o' }, at(13), rndLow).text, 'Boa tarde! E aí, Sol! O que vamos fazer hoje?');
});

test('saudação de abertura: saudades depois de alguns dias sem abrir', () => {
  const now = at(9);
  const ago = (days) => now.getTime() - days * 86400000;
  const ana = { name: 'Ana', gender: 'f' };
  assert.equal(V.startupGreeting(ana, now, rndLow, ago(1)).text, 'Bom dia! E aí, chefa Ana! O que vamos fazer hoje?');
  const r = V.startupGreeting(ana, now, rndLow, ago(5));
  assert.equal(r.text, 'Bom dia! Há quanto tempo, chefa Ana! Fazia 5 dias que você não aparecia. Estava com saudades! Me conta, o que vamos fazer hoje?');
  assert.equal(r.missed, true);
  assert.match(V.startupGreeting(ana, now, rndLow, ago(15)).text, /2 semanas/);
  assert.match(V.startupGreeting(ana, now, rndLow, ago(70)).text, /2 meses/);
  // sem perfil não há "saudades", só o cumprimento
  assert.equal(V.startupGreeting({}, now, rndLow, ago(30)).text, 'Bom dia!');
});

test('palavras comuns que soam como o nome não chamam a assistente', () => {
  for (const f of ['meu anel é de ouro', 'eu juro que não sei', 'o euro subiu hoje']) {
    assert.equal(V.findWake(f, 'Yoru', '').called, false, f);
  }
  assert.deepEqual(V.findWake('Yoru que horas são', 'Yoru', ''), { called: true, rest: 'que horas são' });
  assert.equal(V.findWake('que horas são Ioru', 'Yoru', '').called, true); // erro de transcrição continua valendo
});

test('ruído: frase longa que cita "transcrição" é do usuário; número solto não é ruído', () => {
  assert.equal(V.isNoise('pesquisa transcrição de áudio para texto no google'), false);
  assert.equal(V.isNoise('5'), false);
  assert.equal(V.isNoise('Legendas pela comunidade Amara.org'), true);
});

test('comando negado não é executado', () => {
  for (const f of ['não abre o youtube', 'não desliga o computador', 'não tira print', 'não aumenta o volume']) {
    assert.equal(V.parseIntent(f).type, 'chat', f);
  }
  assert.equal(V.parseIntent('Não, abre o youtube').type, 'open'); // correção
  assert.equal(V.parseIntent('abre o youtube').type, 'open');
});


test('comandos de movimento por voz: desloca para os lados e sai da frente', () => {
  assert.deepEqual(intent('vai para a esquerda'), { type: 'avatar-move', direction: 'left' });
  assert.deepEqual(intent('vai pra direita'), { type: 'avatar-move', direction: 'right' });
  assert.deepEqual(intent('vai para o lado'), { type: 'avatar-move', direction: 'right' });
  assert.deepEqual(intent('sai da frente'), { type: 'avatar-move', direction: 'right' });
  assert.deepEqual(intent('está atrapalhando'), { type: 'avatar-move', direction: 'right' });
});

test('comando de abaixar: reconhece se abaixa sem confundir com volume', () => {
  assert.deepEqual(intent('se abaixa'), { type: 'pose', emote: 'duck' });
  assert.deepEqual(intent('agacha'), { type: 'pose', emote: 'duck' });
  assert.equal(intent('abaixa o volume').op, 'volume-down');
});


test('novos comandos de voz acionam os emotes sociais', () => {
  assert.deepEqual(intent('Yoru, faz um joinha'), { type: 'pose', emote: 'thumbs_up' });
  assert.deepEqual(intent('manda um coração'), { type: 'pose', emote: 'heart' });
  assert.deepEqual(intent('me manda um beijo'), { type: 'pose', emote: 'blow_kiss' });
  assert.deepEqual(intent('aponta para mim'), { type: 'pose', emote: 'point' });
  assert.deepEqual(intent('dá de ombros'), { type: 'pose', emote: 'shrug' });
  assert.deepEqual(intent('faz facepalm'), { type: 'pose', emote: 'facepalm' });
});
