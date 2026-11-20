# Referência visual do modo chibi

`yoru-chibi-pack-reacoes.png` é o pack "Yoru Chibi — Pack de Reações Premium" (50 reações). Esta pasta **não vai para o instalador**
(o `package.json` só empacota `src/` e `assets/`); serve de referência para ajustar o modo chibi (`CHIBI` em `src/avatar.js`).

Desde a v0.10.28 este pack também **é** o avatar 2D: as 50 reações foram recortadas (fundo preto e legendas removidos) para `assets/reactions/*.webp`, e `src/avatar2d-data.js` guarda o tamanho, a âncora da cabeça e a máscara de clique de cada uma.

O que a referência mostra (só busto, então não define tronco e pernas):
- Cabeça enorme em relação aos ombros: o rosto e o cabelo ocupam quase toda a largura do busto.
- Olhos grandes e redondos, rosto pequeno e arredondado, cabelo preto, liso e longo até abaixo dos ombros, franja reta.
- Pele morena, terno preto com camisa branca e gravata (o uniforme do avatar padrão).

Como isso virou número: a cabeça do avatar chibi (100%) ocupa ~46% da altura total (antes ~38%), com tronco a 60% e pernas a 45% do normal.
Ajuste fino: `CHIBI = { torso, legs, head }` em `src/avatar.js` (quanto cada parte muda com chibi = 100%).
