'use strict';
// Masori-Sama: coordenador leve do ecossistema MASORI. Não carrega modelos adicionais.
const AGENTS = Object.freeze([
  { id: 'masori-sama', name: 'Masori-Sama', role: 'coordenação', description: 'Entende o objetivo, escolhe especialistas e revisa a resposta.' },
  { id: 'masori-dev', name: 'Masori-Dev', role: 'desenvolvimento', description: 'Código, arquitetura, depuração e testes.' },
  { id: 'masori-research', name: 'Masori-Research', role: 'pesquisa', description: 'Pesquisa, comparação, fontes e análise.' },
  { id: 'masori-vision', name: 'Masori-Vision', role: 'visão', description: 'Imagens, capturas de tela e contexto visual autorizado.' },
  { id: 'masori-memory', name: 'Masori-Memory', role: 'memória', description: 'Contexto, preferências e continuidade.' },
  { id: 'masori-voice', name: 'Masori-Voice', role: 'voz', description: 'Reconhecimento, síntese e diálogo por voz.' },
  { id: 'masori-agent', name: 'Masori-Agent', role: 'execução', description: 'Planejamento e execução de tarefas autorizadas.' },
]);
const RULES = [
  { id: 'masori-dev', re: /\b(c[oó]digo|programa|programar|bug|erro|debug|javascript|python|electron|site|aplicativo|desenvolv|reposit[oó]rio|api)\b/i },
  { id: 'masori-research', re: /\b(pesquis|compare|comparar|fontes|estudo|investig|mercado|refer[eê]ncia|projeto|alternativas)\b/i },
  { id: 'masori-vision', re: /\b(imagem|foto|tela|print|captura|visual|reconhecer|v[ií]deo)\b/i },
  { id: 'masori-memory', re: /\b(lembra|mem[oó]ria|hist[oó]rico|prefer[eê]ncia|contexto|conversamos)\b/i },
  { id: 'masori-voice', re: /\b(voz|falar|microfone|[aá]udio|transcri|pron[uú]ncia)\b/i },
  { id: 'masori-agent', re: /\b(execut|automat|organizar|abrir|instalar|agendar|rotina|tarefa|faça|crie|construa)\b/i },
];
function plan(task) {
  const text = String(task || '').trim().slice(0, 4000);
  if (!text) return { ok: false, error: 'Descreva uma tarefa para Masori-Sama.' };
  const selected = RULES.filter((r) => r.re.test(text)).map((r) => r.id);
  if (!selected.length) selected.push('masori-research');
  const agents = ['masori-sama', ...[...new Set(selected)].slice(0, 4)];
  const steps = agents.slice(1).map((id, i) => ({ agent: id, order: i + 1, action: AGENTS.find((a) => a.id === id).description }));
  steps.push({ agent: 'masori-sama', order: steps.length + 1, action: 'Consolidar, verificar limitações e apresentar o resultado.' });
  return { ok: true, task: text, coordinator: 'masori-sama', agents, steps, mode: 'independent-specialists', createdAt: Date.now() };
}
function buildHint(p) {
  const names = p.agents.map((id) => AGENTS.find((a) => a.id === id)?.name || id);
  return [
    'ORQUESTRAÇÃO MASORI — você está respondendo sob coordenação de Masori-Sama.',
    'Masori-Sama é o agente principal. Yoru é a interface/personagem desktop. MASORI é o ecossistema.',
    `Especialistas selecionados: ${names.join(', ')}.`,
    'Os especialistas selecionados podem receber chamadas independentes ao provedor configurado; não afirme uso de ferramentas externas quando elas não foram acionadas.',
    'Entregue um plano claro quando houver várias etapas. Não afirme que executou ações externas, acessou arquivos, pesquisou na internet ou testou código se isso não ocorreu.',
    'Peça confirmação antes de ações destrutivas, compras, envio de mensagens, instalação ou alterações sensíveis.',
    'Preserve privacidade: não solicite nem retenha senhas, tokens, chaves ou dados financeiros sensíveis.',
  ].join('\n');
}
module.exports = { AGENTS, plan, buildHint };
