// Cabelo do avatar: acha as juntas da física que descem da cabeça (guardando os valores originais do modelo)
// e dá um balanço leve de vento, ou devolve os valores originais quando desligado nas configurações.
// O renderer.js chama pick() ao carregar o avatar, clear() ao descarregar e wind(t) a cada quadro.

export function createHair({ S, getVrm, getSpringMgr }) {
  let hairJoints = []; // juntas da cabeça com os valores originais do modelo (para o balanço e para desligar)
  const hairSwayPower = () => (S.hairSwayAmount ?? 0.5) * 0.4; // força do vento suave (0 = parado; 0,5 no painel = 0,2)
  function pick() {
    hairJoints = [];
    const vrm = getVrm(), springMgr = getSpringMgr();
    const head = vrm && vrm.humanoid.getRawBoneNode('head');
    if (!springMgr || !head) return;
    for (const j of springMgr.joints) {
      for (let o = j.bone; o; o = o.parent) {
        if (o === head) { hairJoints.push({ j, stiff: j.settings.stiffness, drag: j.settings.dragForce }); break; }
      }
    }
  }
  function wind(t) {
    const on = S.springBones && S.hairSway !== false;
    const sx = Math.sin(t * 0.9) * 0.8 + Math.sin(t * 2.1) * 0.25, sz = Math.sin(t * 0.6 + 1) * 0.5;
    for (const h of hairJoints) {
      const st = h.j.settings;
      st.stiffness = on ? h.stiff * 0.8 : h.stiff;       // um pouco mais solto
      st.dragForce = on ? h.drag * 0.6 : h.drag;         // menos atrito: balança mais
      if (on) { st.gravityDir.set(sx, -1, sz).normalize(); st.gravityPower = hairSwayPower(); }
      else { st.gravityDir.set(0, -1, 0); st.gravityPower = 0; }
    }
  }

  const clear = () => { hairJoints = []; };
  return { pick, wind, clear };
}
