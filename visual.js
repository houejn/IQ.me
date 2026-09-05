/*
  IQ.me — Visual Engine.

  Renders non-verbal reasoning items as plain SVG built from structured
  rules (rotation, scale, shading) rather than requesting images from an
  LLM. This is deliberate, not just a workaround for not having an image
  API: a rule-based SVG item has one provably unambiguous correct answer,
  which is exactly what a real reasoning-test item needs, and is fast and
  free to generate endlessly.

  Both generators here follow the same shape as the text generators in
  questions.js: generateX(level, prior) -> item, where item.visual=true
  and item.options/promptSvg hold SVG markup strings instead of plain
  text. app.js checks item.visual and injects the markup instead of
  escaping it as text.
*/

const Visual = (() => {

  function rnd(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }
  function pick(arr){ return arr[rnd(0, arr.length-1)]; }
  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){ const j = rnd(0,i); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
  function difficultyForLevel(level, bump=0){
    const base = {1:85,2:95,3:105,4:115,5:125}[level] || 105;
    return base + bump + rnd(-4,4);
  }

  const ACCENT = '#2b5f8a';

  // A single asymmetric triangle "pointer" — asymmetric so rotation is
  // always visually distinguishable (a symmetric shape like a square
  // looks identical at 0/180deg, which would make items unsolvable).
  function pointerShape(cx, cy, rotationDeg, scale, opacity){
    return `<g transform="translate(${cx},${cy}) rotate(${rotationDeg}) scale(${scale})">
      <polygon points="0,-11 9,9 -9,9" fill="${ACCENT}" fill-opacity="${opacity}" stroke="${ACCENT}" stroke-width="1.2"/>
    </g>`;
  }

  function cellSVG(size, attrs){
    const box = `<rect x="1" y="1" width="${size-2}" height="${size-2}" fill="none" stroke="#d7d5cd" stroke-width="1.5"/>`;
    if(attrs.question){
      return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
        ${box}
        <text x="${size/2}" y="${size/2+7}" text-anchor="middle" font-size="22" fill="#6b6b6b" font-family="Georgia, serif">?</text>
      </svg>`;
    }
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      ${box}
      ${pointerShape(size/2, size/2, attrs.rotation, attrs.scale, attrs.opacity)}
    </svg>`;
  }

  function sameAttrs(a,b){
    return a.rotation===b.rotation && a.scale===b.scale && a.opacity===b.opacity;
  }

  // ---------- Matrix reasoning (Raven's-style 3x3 grid) ----------
  function generateMatrix(level, prior={}){
    const rotStep = 90;
    const scaleSteps = [0.7, 1, 1.35];
    const opacitySteps = [0.35, 0.65, 1];

    let dims = prior.nudge !== undefined
      ? clamp((level<=2?1:level<=4?2:3) + (prior.nudge>1?1:prior.nudge<-1?-1:0), 1, 3)
      : (level<=2?1:level<=4?2:3);

    function attrsAt(row,col){
      return {
        rotation: dims>=1 ? (col*rotStep)%360 : 0,
        scale: dims>=2 ? scaleSteps[row] : 1,
        opacity: dims>=3 ? opacitySteps[(row+col)%3] : 1
      };
    }

    const correct = attrsAt(2,2);
    const cellSize = 66;
    let promptCells = '';
    for(let r=0;r<3;r++){
      for(let c=0;c<3;c++){
        const attrs = (r===2 && c===2) ? {question:true} : attrsAt(r,c);
        promptCells += `<div class="mgrid-cell">${cellSVG(cellSize, attrs)}</div>`;
      }
    }
    const promptSvg = `<div class="mgrid">${promptCells}</div>`;

    // Build 4 distinct option combos, guaranteeing the correct one is present.
    const combos = [correct];
    const candidates = [
      Object.assign({}, correct, {rotation:(correct.rotation+rotStep)%360}),
      Object.assign({}, correct, {scale: scaleSteps[(scaleSteps.indexOf(correct.scale)+1)%3]}),
      attrsAt(0,1), attrsAt(1,0), attrsAt(0,2), attrsAt(2,0),
      Object.assign({}, correct, {opacity: opacitySteps[(opacitySteps.indexOf(correct.opacity)+1)%3]})
    ];
    for(const cand of candidates){
      if(combos.length >= 4) break;
      if(!combos.some(x => sameAttrs(x, cand))) combos.push(cand);
    }
    while(combos.length < 4){
      const rand = { rotation: pick([0,90,180,270]), scale: pick(scaleSteps), opacity: pick(opacitySteps) };
      if(!combos.some(x => sameAttrs(x, rand))) combos.push(rand);
    }

    const order = shuffle(combos);
    const options = order.map(c => cellSVG(64, c));
    const correctIndex = order.findIndex(c => sameAttrs(c, correct));

    return {
      type: 'Matrix reasoning',
      visual: true,
      promptSvg,
      options,
      correctIndex,
      difficulty: difficultyForLevel(level, dims*5),
      _kind: 'matrix',
      _priorState: prior
    };
  }

  // ---------- Shape rotation sequence ----------
  function generateRotationSeq(level, prior={}){
    const baseStep = level<=2 ? 90 : level<=4 ? 60 : 45;
    const nudge = prior.nudge || 0;
    const step = clamp(baseStep - nudge*10, 30, 120);
    const startDeg = pick([0,45,90,135,180,225,270,315]) % 360;

    const n = 4;
    const degs = Array.from({length:n}, (_,i) => (startDeg + i*step) % 360);
    const nextDeg = (startDeg + n*step) % 360;

    const size = 56;
    const promptSvg = `<div class="rot-seq">${
      degs.map(d => cellSVG(size, {rotation:d, scale:1, opacity:1})).join('<span class="rot-arrow">→</span>')
    }<span class="rot-arrow">→</span>${cellSVG(size, {question:true})}</div>`;

    const distractDegs = new Set();
    while(distractDegs.size < 3){
      const off = pick([-2,-1,1,2]) * Math.round(step/2 || 15);
      const d = ((nextDeg + off) % 360 + 360) % 360;
      if(d !== nextDeg) distractDegs.add(d);
    }
    const allDegs = shuffle([nextDeg, ...distractDegs]);
    const options = allDegs.map(d => cellSVG(56, {rotation:d, scale:1, opacity:1}));
    const correctIndex = allDegs.indexOf(nextDeg);

    return {
      type: 'Shape rotation',
      visual: true,
      promptSvg,
      options,
      correctIndex,
      difficulty: difficultyForLevel(level, Math.round((120-step)/10)),
      _kind: 'rotation',
      _priorState: prior
    };
  }

  return { generateMatrix, generateRotationSeq };
})();
