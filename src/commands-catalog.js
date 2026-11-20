'use strict';
// Lista única dos comandos que a Yoru já resolve sozinha (sem IA). É usada para ensinar a IA (OpenRouter,
// Anthropic, Ollama ou servidor local) o que existe: assim ela não diz "não consigo abrir o YouTube" nem inventa
// comandos, e sabe orientar o usuário com a frase certa.
// Função pura, sem Electron, para poder ser testada com `npm test`.
const V = require('./voice-logic');

// área -> exemplos de frase que o usuário pode falar/digitar
const COMMANDS = [
  ['Hora e data', ['que horas são', 'que dia é hoje']],
  ['Abrir sites e programas', ['abre o youtube', 'abre o gmail', 'abre a calculadora', 'abre <qualquer programa instalado>']],
  ['Pesquisar', ['pesquisa gatos fofos', 'pesquisa receita de bolo no youtube']],
  ['Música e vídeo (YouTube ou Spotify)', ['toca Evidências', 'toca uma música aleatória', 'coloca um vídeo de culinária']],
  ['Agenda e lembretes', ['marca dentista amanhã às 15h', 'me lembra de beber água às 16h', 'o que tem na agenda', 'apaga dentista da agenda', 'limpa a agenda']],
  ['Timer', ['timer de 10 minutos', 'timer de meia hora']],
  ['Clima e notícias', ['como está o tempo', 'vai chover hoje', 'quais as notícias']],
  ['Contas e sorteios', ['quanto é 12 vezes 5', 'sorteia um número de 1 a 50', 'rola um dado', 'cara ou coroa']],
  ['Controle do computador', [
    'aumenta/diminui o volume, volume 30, tira o som (mudo)',
    'pausa, próxima música, música anterior',
    'minimiza/maximiza/fecha a janela, troca de janela, traz o discord (foca uma janela aberta)',
    'tira um print da tela, o que está aberto, mostra a área de trabalho',
    'bloqueia o computador',
    'limpa o computador (temporários, relatórios de erro e cache dos navegadores), esvazia a lixeira (ela pede confirmação), limpa o dns, limpa o cache do chrome',
    'modo alto desempenho, modo economia de energia, modo energia equilibrado, quanto espaço livre eu tenho',
    'desliga/reinicia/suspende o computador (ela pede confirmação), cancela o desligamento']],
  ['O avatar', ['dança (também samba, disco, robô, balé, hip hop)', 'senta (no chão ou na cadeira)', 'levanta', 'bate palmas', 'continência', 'mãos na cintura', 'se abaixa / agacha', 'faz um joinha / me dá um joinha', 'faz um coração com as mãos', 'manda um beijo / me manda um beijo', 'aponta para mim', 'dá de ombros', 'facepalm / coloca a mão na testa', 'vai para a esquerda', 'vai para a direita', 'vai para o lado', 'sai da frente / está atrapalhando', 'para (interrompe)']],
  ['O próprio app (tema, avatar e item na mão)', ['muda o tema para escuro', 'muda a cor de destaque para roxo', 'troca o avatar para a Noelle', 'pega a katana', 'larga o item', 'quais itens você tem']],
  ['Conversa leve', ['me conta uma piada', 'quem é você', 'o que você sabe fazer / comandos / ajuda', 'obrigado', 'tchau']],
];

const SHORTCUTS = 'Ctrl+Shift+Space abre o chat, Ctrl+Shift+M liga/desliga o microfone, Ctrl+Shift+P abre o painel, Ctrl+Shift+H mostra/oculta o avatar';

// nomes dos sites/programas que ela abre (vem de voice-logic: nunca fica desatualizado)
function siteLabels() {
  return V.SITES.filter((s) => s.key !== 'google').map((s) => s.label.replace(/^(o|a)\s+/i, ''));
}

// opts: { wake: nome para chamá-la, pcActions: abrir sites/programas e controlar o PC está ligado? }
function promptBlock(opts = {}) {
  const wake = (opts.wake || 'Yoru').trim();
  let s = '\n\nCOMANDOS QUE O APP JÁ EXECUTA SOZINHO (você não executa nada: o app reconhece a frase do usuário e age antes de ela chegar a você):\n';
  for (const [area, ex] of COMMANDS) s += `- ${area}: ${ex.map((e) => `“${e}”`).join('; ')}.\n`;
  s += `- Sites e programas que ela conhece: ${siteLabels().join(', ')}.\n`;
  s += `- Atalhos: ${SHORTCUTS}. Por voz, o usuário chama pelo nome (“${wake}”).\n`;
  if (opts.pcActions === false) {
    s += '- ATENÇÃO: abrir sites/programas e controlar o computador está DESLIGADO nas configurações da conversa; se pedirem, diga que dá para ligar na aba Conversa do painel.\n';
  }
  s += 'Como usar isso: (1) se perguntarem o que você sabe fazer, responda com base nesta lista, sem inventar nada fora dela. ' +
    '(2) Se o usuário pedir algo desta lista e a mensagem chegou até você, o app não entendeu a frase: não diga que não consegue e NÃO finja que fez; ' +
    'diga a frase curta e exata que ele pode falar ou digitar (ex.: “Diga: abre o youtube”). ' +
    '(3) Para o que não existe nesta lista (enviar e-mail, editar arquivos, instalar programas...), diga com sinceridade que ainda não faz isso.';
  return s;
}

module.exports = { COMMANDS, SHORTCUTS, siteLabels, promptBlock };
