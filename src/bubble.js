// Balão de fala do avatar: mostrar texto, "digitar" aos poucos e sumir sozinho.
// Só mexe no elemento que receber (el) e lê as opções de `settings()`; o renderer.js decide quando falar.
// Os timers vêm do ambiente na hora do uso (setTimeout/setInterval globais), então o teste pode trocá-los por falsos.

// quanto o balão fica na tela: o tempo escolhido no painel (bubbleSeconds) ou ~80 ms por letra, no mínimo 5 s
export function hideDelay(text, S) {
  return S.bubbleSeconds > 0 ? S.bubbleSeconds * 1000 : Math.max(5000, String(text).length * 80);
}

export function createBubble({ el, settings }) {
  let hideTimer;
  let typeTimer;
  const S = () => settings();
  const hide = () => { el.style.display = 'none'; };
  const cancel = () => { clearInterval(typeTimer); clearTimeout(hideTimer); };
  const hideIn = (ms) => { hideTimer = setTimeout(hide, ms); };

  // abre o balão limpo, cancelando o que estava digitando ou prestes a sumir
  function open() {
    cancel();
    el.classList.remove('err');
    el.style.display = 'block';
  }

  // texto de uma vez; com `ms` some depois desse tempo
  function say(text, ms) {
    if (!S().visible) return;
    open();
    el.textContent = text;
    if (ms) hideIn(ms);
  }

  // texto aparecendo aos poucos (~1,5 s no máximo)
  function typeSay(text) {
    const s = S();
    if (!s.visible || !s.bubbleEnabled) return;
    open();
    const delay = hideDelay(text, s);
    if (!s.typeAnimation) {
      el.textContent = text;
      hideIn(delay);
      return;
    }
    el.textContent = '';
    const step = Math.max(1, Math.ceil(text.length / 60));
    let i = 0;
    typeTimer = setInterval(() => {
      i += step;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(typeTimer);
        hideIn(delay);
      }
    }, 25);
  }

  // fim de uma resposta em tempo real: mostra o texto final e agenda o sumiço
  function finish(text) {
    el.textContent = text;
    hideIn(hideDelay(text, S()));
  }

  return { say, typeSay, open, finish, hide, cancel };
}
