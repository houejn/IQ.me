/*
  IQ.me — Core engine (orchestration).

  Ties together: Level Engine (which level is selected — no gating),
  Generation Engine (questions.js / visual.js), Score Engine (engine.js),
  and rendering. This file owns the drill lifecycle: start -> show
  question -> grade -> update both score mechanisms -> next -> finish.
*/

(() => {
  const app = document.getElementById('app');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const timeBar = document.getElementById('timeBar');
  const timeFill = document.getElementById('timeFill');
  const scoreTag = document.getElementById('scoreTag');

  let profile = Engine.loadProfile();
  let session = null;
  let timerHandle = null;

  const LEVELS = [
    {id:1, label:'Level 1', desc:'Warm-up'},
    {id:2, label:'Level 2', desc:'Easy'},
    {id:3, label:'Level 3', desc:'Moderate'},
    {id:4, label:'Level 4', desc:'Hard'},
    {id:5, label:'Level 5', desc:'Advanced'},
  ];
  const LEVEL_BASE = {1:85, 2:95, 3:105, 4:115, 5:125};

  function refreshScoreTag(){
    scoreTag.textContent = `IQ.me score ${Math.round(profile.score)} · ${profile.drillsCompleted} drills`;
  }

  function render(html){ app.innerHTML = html; }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- Home screen ----------
  function showHome(){
    progressBar.hidden = true;
    timeBar.hidden = true;
    clearTimer();
    refreshScoreTag();

    const levelRows = LEVELS.map(l => {
      const stats = profile.levelStats[l.id];
      const meta = stats && stats.n > 1
        ? `${stats.n-1} drill${stats.n-1===1?'':'s'} · target ~${LEVEL_BASE[l.id]}`
        : `target ~${LEVEL_BASE[l.id]}`;
      return `<li><button class="level-item" data-level="${l.id}">
        <span>${l.label} · ${l.desc}</span>
        <span class="lv-meta">${meta}</span>
      </button></li>`;
    }).join('');

    render(`
      <div class="home">
        <h1>IQ.me</h1>
        <p class="sub">Short drills across several reasoning styles, separated by level.</p>

        <div class="rating-block">
          <div class="rating-num">${Math.round(profile.score)}</div>
          <div class="rating-label">your IQ.me score</div>
        </div>

        <ul class="level-list">${levelRows}</ul>
      </div>
    `);

    app.querySelectorAll('.level-item').forEach(btn => {
      btn.addEventListener('click', () => startDrill(Number(btn.dataset.level)));
    });
  }

  // ---------- Drill screen ----------
  function startDrill(level){
    const count = Number(profile.settings.length) || 15;
    const stateApi = { get: (key) => Engine.getGenState(profile, level, key) };
    const items = QGen.generateDrill(level, count, stateApi);
    session = {
      level, items, index: 0,
      selected: null,
      results: [],
      scoreAtStart: profile.score
    };
    Engine.playOpen(profile.settings.sound);
    progressBar.hidden = false;
    timeBar.hidden = profile.settings.timeControl === 'off';
    showQuestion();
  }

  function showQuestion(){
    clearTimer();
    const q = session.items[session.index];
    session.selected = null;
    progressFill.style.width = `${(session.index / session.items.length) * 100}%`;

    const promptHtml = q.visual
      ? `<div class="visual-prompt">${q.promptSvg}</div>`
      : `<div class="prompt">${escapeHtml(q.prompt)}</div>`;

    const optionsHtml = q.options.map((opt,i) => {
      if(q.visual){
        return `<li><button class="opt opt-visual" data-i="${i}">${opt}</button></li>`;
      }
      return `<li><button class="opt" data-i="${i}">${escapeHtml(opt)}</button></li>`;
    }).join('');

    render(`
      <div class="drill">
        <div class="qtype">${q.type} — Level ${session.level}</div>
        <div class="qcount">Question ${session.index+1} of ${session.items.length}</div>
        ${promptHtml}
        <ul class="options ${q.visual ? 'options-visual' : ''}">${optionsHtml}</ul>
        <div class="actions">
          <button id="nextBtn" class="btn" disabled>Next</button>
        </div>
      </div>
    `);

    const optButtons = app.querySelectorAll('.opt');
    const nextBtn = document.getElementById('nextBtn');
    optButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        optButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        session.selected = Number(btn.dataset.i);
        nextBtn.disabled = false;
      });
    });
    nextBtn.addEventListener('click', () => advance(false));

    if(profile.settings.timeControl !== 'off'){
      startTimer(Number(profile.settings.timeControl));
    }
  }

  function startTimer(seconds){
    timeFill.style.transition = 'none';
    timeFill.style.width = '100%';
    timeFill.offsetHeight; // force reflow so the transition below animates
    timeFill.style.transition = `width ${seconds}s linear`;
    timeFill.style.width = '0%';
    timerHandle = setTimeout(() => {
      Engine.playFlag(profile.settings.sound);
      advance(true);
    }, seconds*1000);
  }

  function clearTimer(){
    if(timerHandle){ clearTimeout(timerHandle); timerHandle = null; }
  }

  function advance(timedOut){
    clearTimer();
    const q = session.items[session.index];
    const answered = !timedOut && session.selected !== null;
    const correct = answered && session.selected === q.correctIndex;

    session.results.push({ type:q.type, correct: !!correct });
    profile.score = Engine.updateScore(profile.score, q.difficulty, !!correct);

    const newGenState = QGen.nextGenState(q, !!correct);
    Engine.setGenState(profile, session.level, q._genKey, newGenState);

    session.index++;
    if(session.index >= session.items.length){
      finishDrill();
    } else {
      Engine.playDing(profile.settings.sound);
      showQuestion();
    }
  }

  function finishDrill(){
    progressFill.style.width = '100%';
    timeBar.hidden = true;

    const total = session.results.length;
    const correctCount = session.results.filter(r=>r.correct).length;
    const proportion = correctCount / total;

    const priorStats = Engine.getLevelStats(profile, session.level);
    const { iq, z } = Engine.levelIQForResult(priorStats, proportion);
    const updatedStats = Engine.pushLevelStat(priorStats, proportion);
    Engine.setLevelStats(profile, session.level, updatedStats);

    profile.drillsCompleted++;
    profile.history.push({
      date: new Date().toISOString(),
      level: session.level,
      correct: correctCount, total,
      levelIQ: iq,
      scoreAfter: Math.round(profile.score)
    });
    if(profile.history.length > 50) profile.history = profile.history.slice(-50);

    Engine.saveProfile(profile);
    Engine.playDing(profile.settings.sound);

    const scoreDelta = profile.score - session.scoreAtStart;

    const byType = {};
    session.results.forEach(r => {
      byType[r.type] = byType[r.type] || {correct:0, total:0};
      byType[r.type].total++;
      if(r.correct) byType[r.type].correct++;
    });

    render(`
      <div class="result">
        <h1>Drill complete</h1>
        <p class="delta ${scoreDelta>=0 ? 'up':'down'}">
          ${correctCount} / ${total} correct · IQ.me score ${scoreDelta>=0?'+':''}${Math.round(scoreDelta*10)/10}
          → ${Math.round(profile.score)}
        </p>
        <div class="level-iq-block">
          <div class="level-iq-num">${iq}</div>
          <div class="level-iq-label">Level ${session.level} IQ score (z = ${z >= 0 ? '+' : ''}${z}, vs. your own history at this level)</div>
        </div>
        <table class="breakdown">
          <thead><tr><th>Type</th><th>Correct</th></tr></thead>
          <tbody>
            ${Object.entries(byType).map(([type,v]) => `
              <tr><td>${escapeHtml(type)}</td><td>${v.correct} / ${v.total}</td></tr>
            `).join('')}
          </tbody>
        </table>
        <div class="actions" style="justify-content:space-between;">
          <button id="homeBtn" class="btn secondary">Home</button>
          <button id="againBtn" class="btn">Drill again</button>
        </div>
      </div>
    `);

    document.getElementById('homeBtn').addEventListener('click', showHome);
    document.getElementById('againBtn').addEventListener('click', () => startDrill(session.level));
  }

  // ---------- Settings ----------
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsOverlay = document.getElementById('settingsOverlay');
  const timeControlSelect = document.getElementById('timeControlSelect');
  const soundSelect = document.getElementById('soundSelect');
  const lengthSelect = document.getElementById('lengthSelect');
  const closeSettings = document.getElementById('closeSettings');
  const resetBtn = document.getElementById('resetBtn');

  function openSettings(){
    timeControlSelect.value = profile.settings.timeControl;
    soundSelect.value = profile.settings.sound;
    lengthSelect.value = String(profile.settings.length);
    settingsOverlay.hidden = false;
  }
  settingsBtn.addEventListener('click', openSettings);
  closeSettings.addEventListener('click', () => {
    profile.settings.timeControl = timeControlSelect.value;
    profile.settings.sound = soundSelect.value;
    profile.settings.length = Number(lengthSelect.value);
    Engine.saveProfile(profile);
    settingsOverlay.hidden = true;
  });
  resetBtn.addEventListener('click', () => {
    if(confirm('Reset your IQ.me score and history? This cannot be undone.')){
      profile = Engine.resetProfile();
      settingsOverlay.hidden = true;
      showHome();
    }
  });

  showHome();
})();
