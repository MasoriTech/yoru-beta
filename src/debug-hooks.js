// Ganchos só para testes de ponta a ponta (abrir com ?debug=1): expõe window.__t com o estado do avatar
// e o método antigo (raycast, pesado) de achar o avatar sob o mouse, para comparar com o hit-test novo.

export function installDebugHooks({ THREE, camera, S, av, ptr, body, player, EMOTES, PUNCH, overAvatar, getFrame }) {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const raycaster = new THREE.Raycaster();
  const m = new THREE.Vector2();
  window.__t = {
    overAvatar,
    rayOver: (x, y) => {
      m.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(m, camera);
      return raycaster.intersectObject(av.vrm.scene, true).length > 0;
    },
    S,
    frames: getFrame,
    emoteId: () => player.id(),
    PUNCH,
    playAt: (id, t) => { if (EMOTES[id]) player.playAt(id, t); },
    state: () => ({ grabbed: ptr.grabbed, falling: ptr.falling, heldW: body.heldW }),
  };
}
