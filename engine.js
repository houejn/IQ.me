/*
  IQ.me — score engine, level stats, generation-state storage, sound.

  Two separate scoring mechanisms, both deliberately on an IQ-like scale
  (roughly 55-145, mean 100) instead of a chess-Elo-like scale:

  1. Overall "IQ.me score" — updates a little after every single answer,
     using the same logistic win-probability idea as Elo, but with the
     sensitivity constant compressed ~10x (D=40 instead of 400) to match
     level steps of 10 instead of chess-style steps of ~100+.

  2. Per-level IQ score — computed once per finished drill. Your percent
     correct that drill is converted to a z-score against the running
     mean/SD of YOUR OWN past drills at that level (Welford's online
     algorithm), then mapped to the familiar 100 + z*15 IQ scale. This
     gets more meaningful the more you drill a given level, and starts
     from a neutral assumed prior (mean 0.5, sd 0.15) before you have
     history there.
*/

const Engine = (() => {

  const D = 40;     // compressed "how much does a rating gap matter" constant
  const K = 2.4;    // per-question score step

  function expected(score, itemDifficulty){
    return 1 / (1 + Math.pow(10, (itemDifficulty - score) / D));
  }

  function updateScore(score, itemDifficulty, correct){
    const exp = expected(score, itemDifficulty);
    const actual = correct ? 1 : 0;
    return score + K * (actual - exp);
  }

  // ---- Per-level running stats (Welford), seeded with a neutral prior ----
  function seedLevelStats(){
    return { n: 1, mean: 0.5, M2: 1 * (0.15*0.15) }; // one pseudo-observation
  }

  function levelIQForResult(stats, proportionCorrect){
    const variance = stats.n > 1 ? stats.M2 / (stats.n - 1) : 0.15*0.15;
    const sd = Math.max(Math.sqrt(variance), 0.05);
    const z = (proportionCorrect - stats.mean) / sd;
    const iq = Math.max(40, Math.min(160, Math.round(100 + z*15)));
    return { iq, z: Math.round(z*100)/100, sd: Math.round(sd*100)/100 };
  }

  function pushLevelStat(stats, proportionCorrect){
    const s = Object.assign({}, stats);
    s.n += 1;
    const delta = proportionCorrect - s.mean;
    s.mean += delta / s.n;
    const delta2 = proportionCorrect - s.mean;
    s.M2 += delta * delta2;
    return s;
  }

  // ---- Storage ----
  const STORE_KEY = 'iqme.profile.v2';

  function defaultProfile(){
    return {
      score: 100,
      drillsCompleted: 0,
      settings: { timeControl: 'off', sound: 'on', length: 15 },
      levelStats: {},   // level -> {n, mean, M2}
      genState: {},     // level -> genKey -> {kind, nudge, lastCategory}
      history: []       // [{date, level, correct, total, levelIQ, scoreAfter}]
    };
  }

  function loadProfile(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      if(!raw) return defaultProfile();
      const parsed = JSON.parse(raw);
      const base = defaultProfile();
      return Object.assign(base, parsed, {
        settings: Object.assign(base.settings, parsed.settings || {}),
        levelStats: parsed.levelStats || {},
        genState: parsed.genState || {},
        history: parsed.history || []
      });
    }catch(e){
      return defaultProfile();
    }
  }

  function saveProfile(profile){
    localStorage.setItem(STORE_KEY, JSON.stringify(profile));
  }

  function resetProfile(){
    localStorage.removeItem(STORE_KEY);
    return defaultProfile();
  }

  function getLevelStats(profile, level){
    return profile.levelStats[level] || seedLevelStats();
  }
  function setLevelStats(profile, level, stats){
    profile.levelStats[level] = stats;
  }

  function getGenState(profile, level, key){
    return (profile.genState[level] && profile.genState[level][key]) || {};
  }
  function setGenState(profile, level, key, state){
    profile.genState[level] = profile.genState[level] || {};
    profile.genState[level][key] = state;
  }

  // ---- Sound (synthesized — no external audio files needed) ----
  let audioCtx = null;
  function ctx(){
    if(!audioCtx){
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
    }
    return audioCtx;
  }

  function tone(freq, startTime, duration, gainPeak=0.15, type='sine'){
    const c = ctx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  function playOpen(soundOn){
    if(soundOn === 'off') return;
    const c = ctx();
    const t = c.currentTime;
    tone(440, t, 0.12);
    tone(660, t + 0.09, 0.16);
  }
  function playDing(soundOn){
    if(soundOn === 'off') return;
    tone(880, ctx().currentTime, 0.14, 0.12);
  }
  function playFlag(soundOn){
    if(soundOn === 'off') return;
    tone(220, ctx().currentTime, 0.2, 0.12, 'triangle');
  }

  return {
    expected, updateScore,
    levelIQForResult, pushLevelStat,
    loadProfile, saveProfile, resetProfile,
    getLevelStats, setLevelStats,
    getGenState, setGenState,
    playOpen, playDing, playFlag
  };
})();
