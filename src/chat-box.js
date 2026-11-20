// Caixa de chat do avatar (aparece embaixo da janela): abre/fecha e envia o texto digitado para a IA.

export function createChatBox({ api, chat, input, say, showReply }) {
  function toggle() {
    const open = chat.style.display === 'block';
    chat.style.display = open ? 'none' : 'block';
    if (!open) input.focus();
  }
  api.onToggleChat(toggle);

  input.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || e.isComposing || !input.value.trim()) return;
    const text = input.value.trim();
    input.value = '';
    say('...');
    showReply(await api.chat(text));
  });

  return { toggle };
}
