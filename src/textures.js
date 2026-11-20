// Texturas dos modelos 3D: reduzir as grandes (menos memória de vídeo, carregamento mais rápido)
// e liberar tudo ao descarregar um modelo. Só mexe nos objetos recebidos; o renderer.js decide quando chamar.

// reduz texturas grandes (menos memória de vídeo e carregamento mais rápido)
export function shrinkTexture(tex, max) {
  const img = tex.image;
  if (!img) return 0;
  const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  if (!w || !h || Math.max(w, h) <= max) return 0;
  const r = max / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * r));
  c.height = Math.max(1, Math.round(h * r));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  tex.image = c;
  tex.needsUpdate = true;
  if (img.close) img.close();
  return w * h - c.width * c.height;
}
export function textureProps(m) {
  // texturas do MToon são acessores na classe (não aparecem em for...in): percorre a cadeia de protótipos
  const names = new Set(Object.keys(m));
  for (let o = Object.getPrototypeOf(m); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
    Object.getOwnPropertyNames(o).forEach((n) => names.add(n));
  }
  return [...names];
}
export function downscaleTextures(root, max) {
  if (!max) return;
  const seen = new Set();
  let saved = 0;
  root.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      for (const k of textureProps(m)) {
        let t;
        try { t = m[k]; } catch (_) { continue; }
        if (t && t.isTexture && !seen.has(t)) { seen.add(t); saved += shrinkTexture(t, max); }
      }
    }
  });
  console.log(`[perf] ${seen.size} texturas, ${(saved / 1e6).toFixed(1)} Mpx a menos (limite ${max}px)`);
}

export function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    for (const m of [].concat(o.material || [])) {
      for (const k of textureProps(m)) {
        let t;
        try { t = m[k]; } catch (_) { continue; }
        if (t && t.isTexture) t.dispose();
      }
      if (m.dispose) m.dispose();
    }
  });
}
