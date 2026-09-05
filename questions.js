/*
  IQ.me — Generation Engine (text-based generators).

  Each generator: generateX(level, prior) -> item, where `prior` is the
  saved state from the last time THIS level+type combination was drawn
  (or {} the first time). Every item echoes back:
    item._kind          — which sub-variant it used (so next time can
                           lean toward continuing it, for a bit of
                           thematic continuity instead of pure noise)
    item._category       — a category/word-group key, when applicable,
                           so the next draw can avoid immediately
                           repeating it
    item._priorState     — the prior state it was given (nextGenState
                           reads this to build the state to save)

  app.js calls QGen.nextGenState(item, correct) after grading to get the
  state to persist for next time. A "nudge" ticks up on a correct answer
  and down on a miss, and generators use it to gently widen or narrow
  their numeric ranges — so a type doesn't feel identical every time you
  hit it, and drifts with how you're actually doing.

  Difficulty scale is compressed to match Engine.js: level bases are 10
  points apart (85/95/105/115/125), not chess-Elo-sized jumps.
*/

const QGen = (() => {

  function rnd(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }
  function pick(arr){ return arr[rnd(0, arr.length-1)]; }
  function shuffle(arr){
    const a = arr.slice();
    for(let i=a.length-1;i>0;i--){ const j = rnd(0,i); [a[i],a[j]]=[a[j],a[i]]; }
    return a;
  }
  function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

  const LEVEL_BASE = {1:85, 2:95, 3:105, 4:115, 5:125};
  function difficultyForLevel(level, nudge=0){
    return (LEVEL_BASE[level] || 105) + nudge*3 + rnd(-4,4);
  }

  function nextGenState(item, correct){
    const prior = item._priorState || {};
    const nudge = clamp((prior.nudge || 0) + (correct ? 1 : -1), -3, 3);
    return {
      nudge,
      kind: item._kind !== undefined ? item._kind : prior.kind,
      lastCategory: item._category !== undefined ? item._category : prior.lastCategory
    };
  }

  // ---------- Number sequences ----------
  function genSequence(level, prior={}){
    const kinds = level <= 2 ? ['arith'] : level <= 3 ? ['arith','geo'] : ['arith','geo','fib','alt'];
    const kind = (prior.kind && kinds.includes(prior.kind) && Math.random() < 0.7) ? prior.kind : pick(kinds);
    const nudge = prior.nudge || 0;
    const n = level <= 2 ? 4 : 5;
    let seq, next;

    if(kind === 'arith'){
      const start = rnd(1, level*5);
      const step = clamp(rnd(2, level*3) + nudge, 1, 40);
      seq = Array.from({length:n}, (_,i) => start + i*step);
      next = start + n*step;
    } else if(kind === 'geo'){
      const start = rnd(1,4);
      const ratio = clamp(rnd(2,3) + (nudge>1?1:0), 2, 4);
      seq = Array.from({length:n}, (_,i) => start * Math.pow(ratio,i));
      next = start * Math.pow(ratio,n);
    } else if(kind === 'fib'){
      let a = rnd(1,3), b = rnd(a+1, a+4);
      seq = [a,b];
      for(let i=2;i<n;i++) seq.push(seq[i-1]+seq[i-2]);
      next = seq[n-1]+seq[n-2];
    } else {
      const startA = rnd(1,10), stepA = clamp(rnd(1,4)+nudge,1,10);
      const startB = rnd(1,10), stepB = clamp(rnd(2,5)+nudge,1,10);
      seq = [];
      for(let i=0;i<n;i++) seq.push(i%2===0 ? startA+(i/2)*stepA : startB+((i-1)/2)*stepB);
      next = n%2===0 ? startA+(n/2)*stepA : startB+((n-1)/2)*stepB;
    }

    const optSet = new Set([next]);
    while(optSet.size < 4) optSet.add(next + rnd(-9,9) * pick([1,1,-1]) - (optSet.size));
    const finalOpts = shuffle([...optSet]).slice(0,4);
    if(!finalOpts.includes(next)) finalOpts[0] = next;
    const optionsStr = [...new Set(finalOpts)].map(String).slice(0,4);
    const correctIndex = optionsStr.indexOf(String(next));

    return {
      type: 'Number sequence',
      prompt: `${seq.join(', ')}, ?`,
      options: optionsStr,
      correctIndex: correctIndex >= 0 ? correctIndex : 0,
      difficulty: difficultyForLevel(level, nudge),
      _kind: kind,
      _priorState: prior
    };
  }

  // ---------- Letter sequences ----------
  function genLetterSeq(level, prior={}){
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nudge = prior.nudge || 0;
    const step = clamp(rnd(1, level+1) + Math.max(0,nudge), 1, 6);
    const startIdx = rnd(0, Math.max(0, 25 - step*5));
    const n = 4;
    const idxs = Array.from({length:n}, (_,i)=> startIdx + i*step);
    const seq = idxs.map(i=>A[i]);
    const nextIdx = startIdx + n*step;
    const next = A[nextIdx];

    const distractors = new Set();
    while(distractors.size < 3){
      const off = rnd(-3,3);
      if(off===0) continue;
      const idx = nextIdx+off;
      if(idx>=0 && idx<26 && A[idx]!==next) distractors.add(A[idx]);
    }
    const opts = shuffle([next, ...distractors]);

    return {
      type: 'Letter sequence',
      prompt: `${seq.join(' - ')} - ?`,
      options: opts,
      correctIndex: opts.indexOf(next),
      difficulty: difficultyForLevel(level, nudge),
      _kind: 'letters',
      _priorState: prior
    };
  }

  // ---------- Verbal analogies ----------
  const ANALOGY_BANK = {
    1: [['Hot','Cold','Up','Down'], ['Big','Small','Fast','Slow'], ['Cat','Kitten','Dog','Puppy'], ['Sun','Day','Moon','Night']],
    2: [['Bird','Nest','Bee','Hive'], ['Author','Book','Composer','Symphony'], ['Doctor','Hospital','Teacher','School'], ['Knife','Cut','Pen','Write']],
    3: [['Ocean','Wave','Desert','Dune'], ['Painter','Canvas','Sculptor','Marble'], ['Thermometer','Temperature','Clock','Time'], ['Seed','Tree','Egg','Bird']],
    4: [['Mitigate','Reduce','Exacerbate','Worsen'], ['Frugal','Spendthrift','Timid','Reckless'], ['Cartographer','Map','Historian','Chronicle'], ['Wax','Wane','Ascend','Descend']],
    5: [['Ephemeral','Permanent','Verbose','Terse'], ['Ossify','Harden','Atrophy','Weaken'], ['Panacea','Cure-all','Placebo','Inert'], ['Zenith','Peak','Nadir','Bottom']]
  };
  function genAnalogy(level, prior={}){
    const bank = ANALOGY_BANK[level] || ANALOGY_BANK[3];
    let row = pick(bank);
    if(bank.length > 1){
      let tries = 0;
      while(row.join('|') === prior.lastCategory && tries < 5){ row = pick(bank); tries++; }
    }
    const [a,b,c,d] = row;
    const others = Object.values(ANALOGY_BANK).flat().filter(r => r.join('|') !== row.join('|'));
    const distractors = new Set();
    while(distractors.size < 3){
      const word = pick(pick(others));
      if(word !== d) distractors.add(word);
    }
    const opts = shuffle([d, ...distractors]);
    return {
      type: 'Verbal analogy',
      prompt: `${a} is to ${b} as ${c} is to ?`,
      options: opts,
      correctIndex: opts.indexOf(d),
      difficulty: difficultyForLevel(level, prior.nudge||0),
      _category: row.join('|'),
      _priorState: prior
    };
  }

  // ---------- Odd one out ----------
  const GROUPS = [
    {cat:'fruit', words:['Apple','Banana','Mango','Papaya','Guava','Peach']},
    {cat:'tool', words:['Hammer','Wrench','Screwdriver','Pliers','Chisel','Saw']},
    {cat:'ocean', words:['Pacific','Atlantic','Indian','Arctic','Southern']},
    {cat:'shape', words:['Triangle','Square','Pentagon','Hexagon','Octagon']},
    {cat:'metal', words:['Iron','Copper','Gold','Silver','Tin']},
    {cat:'instrument', words:['Violin','Cello','Viola','Trumpet','Flute','Clarinet']},
    {cat:'gas', words:['Oxygen','Nitrogen','Helium','Hydrogen','Argon']},
  ];
  function genOddOneOut(level, prior={}){
    let g1 = pick(GROUPS);
    let tries = 0;
    while(g1.cat === prior.lastCategory && tries < 5){ g1 = pick(GROUPS); tries++; }
    let g2 = pick(GROUPS);
    while(g2.cat === g1.cat) g2 = pick(GROUPS);
    const count = level <= 2 ? 3 : 4;
    const sameGroup = shuffle(g1.words).slice(0, count);
    const odd = pick(g2.words);
    const opts = shuffle([...sameGroup, odd]);
    return {
      type: 'Odd one out',
      prompt: `Which word does not belong with the others?\n${opts.join(', ')}`,
      options: opts,
      correctIndex: opts.indexOf(odd),
      difficulty: difficultyForLevel(level, prior.nudge||0),
      _category: g1.cat,
      _priorState: prior
    };
  }

  // ---------- Simple syllogism / logic ----------
  const NAMES = ['Alex','Sam','Priya','Jonas','Mia','Deo','Rin','Kwame'];
  function genSyllogism(level, prior={}){
    const groupA = pick(['painters','engineers','sailors','musicians','archers']);
    const groupB = pick(['patient','early risers','left-handed','methodical','well-travelled']);
    const person = pick(NAMES);
    const nudge = prior.nudge || 0;
    const baseValidProb = level <= 3 ? 0.8 : 0.5;
    const validProb = clamp(baseValidProb - nudge*0.08, 0.1, 0.9);
    const valid = Math.random() < validProb;
    let prompt, correct;
    if(valid){
      prompt = `All ${groupA} are ${groupB}. ${person} is a ${groupA.slice(0,-1)}. Is ${person} ${groupB}?`;
      correct = 'Yes';
    } else {
      prompt = `All ${groupA} are ${groupB}. ${person} is ${groupB}. Is ${person} a ${groupA.slice(0,-1)}?`;
      correct = 'Cannot be determined';
    }
    const opts = shuffle(['Yes','No','Cannot be determined']);
    return {
      type: 'Logical reasoning',
      prompt,
      options: opts,
      correctIndex: opts.indexOf(correct),
      difficulty: difficultyForLevel(level, nudge) + 5,
      _kind: 'syllogism',
      _priorState: prior
    };
  }

  // ---------- Wiring: generator registry ----------
  const GENERATOR_DEFS = [
    { key:'sequence',  fn: genSequence },
    { key:'letters',   fn: genLetterSeq },
    { key:'analogy',   fn: genAnalogy },
    { key:'oddoneout', fn: genOddOneOut },
    { key:'syllogism', fn: genSyllogism },
    { key:'matrix',    fn: (lvl,prior) => Visual.generateMatrix(lvl,prior) },
    { key:'rotation',  fn: (lvl,prior) => Visual.generateRotationSeq(lvl,prior) },
  ];

  // stateApi: { get(key) -> prior state for (level,key) }
  function generateDrill(level, count, stateApi){
    const items = [];
    for(let i=0;i<count;i++){
      const def = pick(GENERATOR_DEFS);
      const prior = stateApi ? stateApi.get(def.key) : {};
      const item = def.fn(level, prior);
      item._genKey = def.key;
      items.push(item);
    }
    return items;
  }

  return { generateDrill, nextGenState };
})();
