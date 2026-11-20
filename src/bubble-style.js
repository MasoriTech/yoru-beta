// Estilo do balão e da caixa de chat: claro, escuro ou na cor de destaque do painel.
// Devolve applyBubbleStyle(), que o renderer.js chama ao abrir e quando o estilo ou a cor mudam.

export function createBubbleStyle({ S, bubble, chat }) {
  return function applyBubbleStyle() {
    const st = ['dark', 'accent'].includes(S.bubbleStyle) ? S.bubbleStyle : 'light';
    for (const el of [bubble, chat]) {
      el.classList.toggle('b-dark', st === 'dark');
      el.classList.toggle('b-accent', st === 'accent');
    }
    const hex = /^#[0-9a-f]{6}$/i.test(S.panelAccent || '') ? S.panelAccent : '#ff7a2e';
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const root = document.documentElement.style;
    root.setProperty('--b-accent', hex);
    root.setProperty('--b-on', 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1b1c22' : '#ffffff'); // texto legível sobre a cor
  };
}
